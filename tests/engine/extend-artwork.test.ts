import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExtendArtworkError,
  ExtendArtworkService,
  deriveLandscapeId,
  type ExtendArtworkTerminalEvent,
} from "../../src/engine/extend-artwork.js";
import {
  ProviderChainExhaustedError,
  ProviderChainTerminatedError,
  type ProviderAttemptRecord,
  type ProviderChainRunData,
  type ProviderChainSuccess,
} from "../../src/engine/provider-chain.js";
import type { ImageEditChain } from "../../src/engine/pipeline.js";
import type {
  ImageEditStage,
  ImageProviderId,
  ProviderAttemptOutcome,
  SupportedImageMimeType,
  ValidatedImage,
} from "../../src/engine/provider-types.js";

function validated(
  bytes: Buffer,
  mimeType: SupportedImageMimeType,
  width: number,
  height: number,
): ValidatedImage {
  return {
    bytes: Buffer.from(bytes),
    mimeType,
    width,
    height,
    byteCount: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function attempt(
  stage: ImageEditStage,
  provider: ImageProviderId,
  outcome: ProviderAttemptOutcome,
  ordinal: number,
): ProviderAttemptRecord {
  return {
    attemptId: `${stage}-${ordinal}`,
    stage,
    ordinal,
    provider,
    requestedModel: `${provider}-model`,
    startedAt: "2026-08-15T12:00:00.000Z",
    completedAt: "2026-08-15T12:00:01.000Z",
    durationMs: 1000,
    outcome,
    requestId: "safe-request-id",
    usage: { totalTokens: 42 },
  };
}

function run(
  chainId: string,
  stage: ImageEditStage,
  providerOrder: readonly ImageProviderId[],
  attempts: readonly ProviderAttemptRecord[],
  terminalOutcome: ProviderChainRunData["terminalOutcome"],
  winner?: ImageProviderId,
): ProviderChainRunData {
  return {
    chainId,
    stage,
    providerOrder,
    startedAt: "2026-08-15T12:00:00.000Z",
    completedAt: "2026-08-15T12:00:02.000Z",
    durationMs: 2000,
    terminalOutcome,
    ...(winner ? { winner } : {}),
    attempts,
  };
}

function success(
  chainId: string,
  stage: ImageEditStage,
  winner: ImageProviderId,
  providerOrder: readonly ImageProviderId[],
  attempts: readonly ProviderAttemptRecord[],
  image: ValidatedImage,
): ProviderChainSuccess {
  return {
    outcome: "successful",
    provider: winner,
    requestedModel: `${winner}-model`,
    resolvedModel: `${winner}-resolved`,
    image,
    responseText: `${stage} response`,
    requestId: "safe-request-id",
    run: run(chainId, stage, providerOrder, attempts, "successful", winner),
  };
}

describe("ExtendArtworkService", () => {
  let tempDir: string;
  let imageDir: string;
  let sourcePath: string;
  let source: ValidatedImage;
  let cleanup: ValidatedImage;
  let finalPng: ValidatedImage;
  let finalJpeg: ValidatedImage;
  let finalWebp: ValidatedImage;
  let events: ExtendArtworkTerminalEvent[];
  let release: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    source = validated(
      await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } })
        .png().toBuffer(),
      "image/png",
      20,
      10,
    );
    cleanup = validated(
      await sharp({ create: { width: 20, height: 10, channels: 3, background: "blue" } })
        .png().toBuffer(),
      "image/png",
      20,
      10,
    );
    finalPng = validated(
      await sharp({ create: { width: 16, height: 9, channels: 3, background: "green" } })
        .png().toBuffer(),
      "image/png",
      16,
      9,
    );
    const jpegBytes = await sharp(finalPng.bytes).jpeg().toBuffer();
    finalJpeg = validated(jpegBytes, "image/jpeg", 16, 9);
    const webpBytes = await sharp(finalPng.bytes).webp().toBuffer();
    finalWebp = validated(webpBytes, "image/webp", 16, 9);
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-extend-"));
    imageDir = path.join(tempDir, "artworks");
    fs.mkdirSync(imageDir);
    sourcePath = path.join(tempDir, "hotel-adriano.png");
    fs.writeFileSync(sourcePath, source.bytes);
    events = [];
    release = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function makeService(
    implementation: ImageEditChain["editImage"],
    overrides: Record<string, unknown> = {},
  ) {
    const order = ["gemini", "openai", "xai"] as const;
    const chain = {
      getProviderOrder: () => order,
      editImage: vi.fn(implementation),
    };
    const ids = ["cleanup-chain", "outpaint-chain"];
    const service = new ExtendArtworkService(
      { imageDir },
      {
        chain,
        generationLock: { acquire: vi.fn().mockResolvedValue({ token: "lease", release }) },
        terminalEventSink: event => { events.push(event); },
        createId: () => ids.shift() ?? "unexpected-chain",
        now: () => Date.parse("2026-08-15T12:00:03.000Z"),
        ...overrides,
      },
    );
    return { service, chain };
  }

  it("restarts provider order for stage 2 and passes exact validated cleanup bytes", async () => {
    const { service, chain } = makeService(async input => {
      expect(release).not.toHaveBeenCalled();
      if (input.output.stage === "extend-cleanup") {
        return success(input.chainId!, input.output.stage, "openai", ["gemini", "openai", "xai"], [
          attempt(input.output.stage, "gemini", "refusal", 1),
          attempt(input.output.stage, "openai", "successful", 2),
        ], cleanup);
      }
      return success(input.chainId!, input.output.stage, "gemini", ["gemini", "openai", "xai"], [
        attempt(input.output.stage, "gemini", "successful", 1),
      ], finalPng);
    });

    const result = await service.extend(sourcePath, "extend this exact scene");

    expect(chain.editImage).toHaveBeenCalledTimes(2);
    expect(chain.editImage.mock.calls[0][0]).toMatchObject({
      chainId: "cleanup-chain",
      output: { stage: "extend-cleanup", aspectRatio: "source" },
    });
    expect(chain.editImage.mock.calls[1][0]).toMatchObject({
      chainId: "outpaint-chain",
      prompt: "extend this exact scene",
      output: { stage: "extend-outpaint", aspectRatio: "16:9" },
    });
    expect(chain.editImage.mock.calls[1][0].source).toBe(cleanup);
    expect(chain.editImage.mock.calls[1][0].source.bytes).toEqual(cleanup.bytes);
    expect(chain.editImage.mock.calls[1][0].source.bytes).not.toEqual(source.bytes);
    expect(result).toMatchObject({
      provider: "gemini",
      model: "gemini-model",
      mimeType: "image/png",
      stages: [
        { stage: "extend-cleanup", winner: "openai", requestedModel: "openai-model" },
        { stage: "extend-outpaint", winner: "gemini", requestedModel: "gemini-model" },
      ],
    });
    expect(path.basename(result.outputPath)).toBe("hotel-adriano-landscape.png");
    expect(fs.readFileSync(result.outputPath)).toEqual(finalPng.bytes);

    const sidecar = JSON.parse(
      fs.readFileSync(path.join(imageDir, "hotel-adriano-landscape.json"), "utf8"),
    );
    expect(sidecar).toMatchObject({
      id: "hotel-adriano-landscape",
      provider: "gemini",
      model: "gemini-model",
      mimeType: "image/png",
      providerOrder: ["gemini", "openai", "xai"],
      extendStages: [
        { stage: "extend-cleanup", provider: "openai", requestedModel: "openai-model" },
        { stage: "extend-outpaint", provider: "gemini", requestedModel: "gemini-model" },
      ],
    });
    expect(sidecar.attempts).toEqual(sidecar.extendStages[1].attempts);
    expect(events).toEqual([
      expect.objectContaining({
        chainId: "cleanup-chain",
        stage: "extend-cleanup",
        outcome: "successful",
        winner: "openai",
      }),
      expect.objectContaining({
        chainId: "outpaint-chain",
        stage: "extend-outpaint",
        outcome: "successful",
        winner: "gemini",
        renderId: "hotel-adriano-landscape",
      }),
    ]);
    expect(events[0].attempts).toEqual([
      { provider: "gemini", outcome: "refusal", durationMs: 1000 },
      { provider: "openai", outcome: "successful", durationMs: 1000 },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/request|usage|prompt|source|base64/i);
    expect(release).toHaveBeenCalledOnce();
  });

  it("stops before stage 2 and publishes nothing when cleanup exhausts", async () => {
    const { service, chain } = makeService(async input => {
      const attempts = [attempt(input.output.stage, "gemini", "refusal", 1)];
      throw new ProviderChainExhaustedError(
        run(input.chainId!, input.output.stage, ["gemini", "openai", "xai"], attempts, "exhausted"),
      );
    });

    await expect(service.extend(sourcePath)).rejects.toBeInstanceOf(ProviderChainExhaustedError);

    expect(chain.editImage).toHaveBeenCalledOnce();
    expect(fs.readdirSync(imageDir)).toEqual([]);
    expect(events).toEqual([expect.objectContaining({
      stage: "extend-cleanup",
      outcome: "exhausted",
    })]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("publishes no intermediate or final when outpainting exhausts", async () => {
    const { service, chain } = makeService(async input => {
      if (input.output.stage === "extend-cleanup") {
        return success(input.chainId!, input.output.stage, "gemini", ["gemini", "openai", "xai"], [
          attempt(input.output.stage, "gemini", "successful", 1),
        ], cleanup);
      }
      const attempts = [
        attempt(input.output.stage, "gemini", "refusal", 1),
        attempt(input.output.stage, "openai", "provider_error", 2),
        attempt(input.output.stage, "xai", "unsupported_output_spec", 3),
      ];
      throw new ProviderChainExhaustedError(
        run(input.chainId!, input.output.stage, ["gemini", "openai", "xai"], attempts, "exhausted"),
      );
    });

    await expect(service.extend(sourcePath)).rejects.toBeInstanceOf(ProviderChainExhaustedError);

    expect(chain.editImage).toHaveBeenCalledTimes(2);
    expect(fs.readdirSync(imageDir)).toEqual([]);
    expect(events.map(event => [event.stage, event.outcome])).toEqual([
      ["extend-cleanup", "successful"],
      ["extend-outpaint", "exhausted"],
    ]);
  });

  it.each(["caller_cancelled", "chain_deadline"] as const)(
    "emits one sanitized %s event for an interrupted cleanup",
    async outcome => {
      const { service, chain } = makeService(async input => {
        throw new ProviderChainTerminatedError(
          outcome,
          run(input.chainId!, input.output.stage, ["gemini", "openai", "xai"], [], outcome),
        );
      });

      await expect(service.extend(sourcePath)).rejects.toBeInstanceOf(ProviderChainTerminatedError);

      expect(chain.editImage).toHaveBeenCalledOnce();
      expect(events).toEqual([expect.objectContaining({ outcome, attempts: [] })]);
      expect(fs.readdirSync(imageDir)).toEqual([]);
    },
  );

  it.each(["caller_cancelled", "chain_deadline"] as const)(
    "emits cleanup success and one sanitized %s event when outpainting stops",
    async outcome => {
      const { service, chain } = makeService(async input => {
        if (input.output.stage === "extend-cleanup") {
          return success(input.chainId!, input.output.stage, "openai", ["gemini", "openai", "xai"], [
            attempt(input.output.stage, "gemini", "refusal", 1),
            attempt(input.output.stage, "openai", "successful", 2),
          ], cleanup);
        }
        throw new ProviderChainTerminatedError(
          outcome,
          run(input.chainId!, input.output.stage, ["gemini", "openai", "xai"], [], outcome),
        );
      });

      await expect(service.extend(sourcePath)).rejects.toBeInstanceOf(ProviderChainTerminatedError);

      expect(chain.editImage).toHaveBeenCalledTimes(2);
      expect(events.map(event => [event.stage, event.outcome])).toEqual([
        ["extend-cleanup", "successful"],
        ["extend-outpaint", outcome],
      ]);
      expect(fs.readdirSync(imageDir)).toEqual([]);
      expect(release).toHaveBeenCalledOnce();
    },
  );

  it("returns busy before any provider call and records a safe cleanup failure", async () => {
    const { service, chain } = makeService(async () => {
      throw new Error("provider must not run");
    }, {
      generationLock: {
        acquire: vi.fn().mockRejectedValue(Object.assign(new Error("secret lock path"), {
          code: "GENERATION_BUSY",
        })),
      },
    });

    await expect(service.extend(sourcePath)).rejects.toMatchObject({ code: "GENERATION_BUSY" });

    expect(chain.editImage).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({
      stage: "extend-cleanup",
      outcome: "local_failure",
      safeCode: "generation_busy",
    })]);
    expect(JSON.stringify(events)).not.toContain("secret lock path");
  });

  it("maps local source and storage failures without leaking raw errors", async () => {
    const unreadable = makeService(async () => {
      throw new Error("unused");
    }, { readSource: vi.fn().mockRejectedValue(new Error("/secret/source")) });

    await expect(unreadable.service.extend(sourcePath)).rejects.toMatchObject({
      code: "EXTEND_ARTWORK_FAILED",
      safeCode: "source_read_failed",
    });
    expect(events).toEqual([expect.objectContaining({
      stage: "extend-cleanup",
      outcome: "local_failure",
      safeCode: "source_read_failed",
    })]);
    expect(JSON.stringify(events)).not.toContain("/secret/source");

    events = [];
    const storage = makeService(async input => success(
      input.chainId!,
      input.output.stage,
      "gemini",
      ["gemini", "openai", "xai"],
      [attempt(input.output.stage, "gemini", "successful", 1)],
      input.output.stage === "extend-cleanup" ? cleanup : finalPng,
    ), {
      store: { save: vi.fn().mockRejectedValue(new Error("/secret/disk")) },
    });

    await expect(storage.service.extend(sourcePath)).rejects.toBeInstanceOf(ExtendArtworkError);
    expect(events.map(event => event.outcome)).toEqual(["successful", "local_failure"]);
    expect(events[1]).toMatchObject({ safeCode: "storage_failed", winner: "gemini" });
    expect(JSON.stringify(events)).not.toContain("/secret/disk");
  });

  it.each([
    ["image/png", ".png"],
    ["image/jpeg", ".jpg"],
    ["image/webp", ".webp"],
  ] as const)("uses truthful %s final filenames and sidecars", async (mimeType, extension) => {
    const final = mimeType === "image/png"
      ? finalPng
      : mimeType === "image/jpeg" ? finalJpeg : finalWebp;
    const { service } = makeService(async input => success(
      input.chainId!,
      input.output.stage,
      "gemini",
      ["gemini", "openai", "xai"],
      [attempt(input.output.stage, "gemini", "successful", 1)],
      input.output.stage === "extend-cleanup" ? cleanup : final,
    ));

    const result = await service.extend(sourcePath);

    expect(result.mimeType).toBe(mimeType);
    expect(result.outputPath).toBe(path.join(imageDir, `hotel-adriano-landscape${extension}`));
    const sidecar = JSON.parse(
      fs.readFileSync(path.join(imageDir, "hotel-adriano-landscape.json"), "utf8"),
    );
    expect(sidecar).toMatchObject({ mimeType, outputPath: result.outputPath });
  });

  it("does not duplicate an existing landscape suffix", () => {
    expect(deriveLandscapeId("/tmp/Hotel Adriano-landscape.JPG"))
      .toBe("Hotel-Adriano-landscape");
    expect(deriveLandscapeId("/tmp/hopper.png")).toBe("hopper-landscape");
  });

  it("keeps an existing landscape pair unchanged without making a provider call", async () => {
    const imagePath = path.join(imageDir, "hotel-adriano-landscape.png");
    const sidecarPath = path.join(imageDir, "hotel-adriano-landscape.json");
    fs.writeFileSync(imagePath, finalPng.bytes);
    fs.writeFileSync(sidecarPath, "existing sidecar");
    const { service, chain } = makeService(async () => {
      throw new Error("provider must not run");
    });

    await expect(service.extend(sourcePath)).rejects.toMatchObject({
      code: "EXTEND_ARTWORK_FAILED",
      safeCode: "output_exists",
    });

    expect(chain.editImage).not.toHaveBeenCalled();
    expect(fs.readFileSync(imagePath)).toEqual(finalPng.bytes);
    expect(fs.readFileSync(sidecarPath, "utf8")).toBe("existing sidecar");
    expect(events).toEqual([expect.objectContaining({
      stage: "extend-cleanup",
      outcome: "local_failure",
      safeCode: "output_exists",
    })]);
  });

  it("keeps stdout machine-readable on CLI errors and documents provider-neutral no-clobber retry", () => {
    const command = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/extend-artwork.ts"],
      { cwd: path.resolve("."), encoding: "utf8" },
    );
    expect(command.status).toBe(1);
    expect(command.stdout).toBe("");
    expect(command.stderr).toMatch(/Usage: npx tsx scripts\/extend-artwork\.ts/);

    const agentDoc = fs.readFileSync(".agents/skills/extend-artwork/SKILL.md", "utf8");
    const claudeDoc = fs.readFileSync(".claude/skills/extend-artwork/SKILL.md", "utf8");
    for (const document of [agentDoc, claudeDoc]) {
      expect(document).toMatch(/configured direct-provider order/i);
      expect(document).toMatch(/\.png.*\.jpg.*\.webp/i);
      expect(document).toMatch(/no-clobber/i);
      expect(document).not.toMatch(/Gemini|IMAGE_OTHER|-landscape\.png result/i);
    }
  });
});
