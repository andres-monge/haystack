import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Pipeline,
  PipelineGenerationError,
  defaultGenerationTerminalEventSink,
  type GenerationTerminalEvent,
  type ImageEditChain,
} from "../../src/engine/pipeline.js";
import {
  ProviderChainExhaustedError,
  ProviderChainTerminatedError,
  type ProviderAttemptRecord,
  type ProviderChainRunData,
  type ProviderChainSuccess,
} from "../../src/engine/provider-chain.js";
import type {
  ImageProviderId,
  ProviderAttemptOutcome,
  ValidatedImage,
} from "../../src/engine/provider-types.js";
import { composePrompt } from "../../src/engine/prompt.js";
import { createScenarioFromHour, describeScenario } from "../../src/engine/scenario.js";
import type { OutputStore } from "../../src/storage/output-store.js";

const PNG_BUFFER = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000970485973000003e8000003e801b57b526b0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082",
  "hex",
);

function validated(bytes = PNG_BUFFER): ValidatedImage {
  return {
    bytes: Buffer.from(bytes),
    mimeType: "image/png",
    width: 1,
    height: 1,
    byteCount: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function attempt(
  provider: ImageProviderId,
  outcome: ProviderAttemptOutcome,
  ordinal: number,
): ProviderAttemptRecord {
  return {
    attemptId: `attempt-${ordinal}`,
    stage: "normal",
    ordinal,
    provider,
    requestedModel: `${provider}-model`,
    startedAt: "2026-08-15T12:00:00.000Z",
    completedAt: "2026-08-15T12:00:01.000Z",
    durationMs: 1000,
    outcome,
  };
}

function run(
  chainId: string,
  providerOrder: readonly ImageProviderId[],
  attempts: readonly ProviderAttemptRecord[],
  terminalOutcome: ProviderChainRunData["terminalOutcome"],
  winner?: ImageProviderId,
): ProviderChainRunData {
  return {
    chainId,
    stage: "normal",
    providerOrder,
    chainTimeoutMs: 120_000,
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
  winner: ImageProviderId,
  providerOrder: readonly ImageProviderId[],
  attempts: readonly ProviderAttemptRecord[],
): ProviderChainSuccess {
  return {
    outcome: "successful",
    provider: winner,
    requestedModel: `${winner}-model`,
    ...(winner === "gemini" ? { resolvedModel: "gemini-resolved-model" } : {}),
    image: validated(),
    responseText: "Edited scene",
    requestId: "safe-request-id",
    usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
    finishReason: "STOP",
    run: run(chainId, providerOrder, attempts, "successful", winner),
  };
}

function mockChain(
  implementation: ImageEditChain["editImage"],
  order: readonly ImageProviderId[] = ["gemini", "openai", "xai"],
): ImageEditChain & { editImage: ReturnType<typeof vi.fn> } {
  return {
    getProviderOrder: () => order,
    editImage: vi.fn(implementation),
  };
}

describe("Pipeline provider-chain integration", () => {
  let tempDir: string;
  let testImagePath: string;
  let events: GenerationTerminalEvent[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-pipeline-"));
    testImagePath = path.join(tempDir, "original.png");
    fs.writeFileSync(testImagePath, PNG_BUFFER);
    events = [];
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function makePipeline(chain: ImageEditChain, overrides: Record<string, unknown> = {}) {
    return new Pipeline(
      { outputDir: tempDir },
      {
        chain,
        terminalEventSink: event => { events.push(event); },
        createId: () => "logical-edit-1",
        ...overrides,
      },
    );
  }

  it.each(["gemini", "openai", "xai"] as const)(
    "persists one truthful %s winner with MIME-aware metadata",
    async winner => {
      const order: ImageProviderId[] = ["gemini", "openai", "xai"];
      const attempts = order.slice(0, order.indexOf(winner) + 1).map((provider, index) =>
        attempt(provider, provider === winner ? "successful" : "refusal", index + 1));
      const chain = mockChain(async input => success(input.chainId!, winner, order, attempts));
      const pipeline = makePipeline(chain);
      const scenario = createScenarioFromHour(18);
      const expectedPrompt = composePrompt(scenario);

      const result = await pipeline.generate(testImagePath, scenario);

      expect(chain.editImage).toHaveBeenCalledOnce();
      expect(chain.editImage.mock.calls[0][0]).toMatchObject({
        prompt: expectedPrompt,
        output: { stage: "normal", aspectRatio: "source" },
      });
      expect(expectedPrompt).toContain("makes the viewer pause and wonder what is happening");
      expect(result.metadata).toMatchObject({
        prompt: expectedPrompt,
        provider: winner,
        model: `${winner}-model`,
        mimeType: "image/png",
        width: 1,
        height: 1,
        byteCount: PNG_BUFFER.length,
        sha256: validated().sha256,
        providerOrder: order,
        attempts,
        responseText: "Edited scene",
        responseId: "safe-request-id",
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 200,
          totalTokenCount: 300,
        },
      });
      expect(result.metadata.resolvedModel).toBe(
        winner === "gemini" ? "gemini-resolved-model" : undefined,
      );
      expect(fs.existsSync(result.imagePath)).toBe(true);
      const persistedMetadata = JSON.parse(
        fs.readFileSync(path.join(tempDir, `${result.metadata.id}.json`), "utf8"),
      ) as { prompt: string };
      expect(persistedMetadata.prompt).toBe(expectedPrompt);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        chainId: "logical-edit-1",
        stage: "normal",
        providerOrder: order,
        chainTimeoutMs: 120_000,
        outcome: "successful",
        winner,
        renderId: result.metadata.id,
      });
      expect(events[0].attempts).toEqual(attempts.map(item => ({
        provider: item.provider,
        outcome: item.outcome,
        durationMs: item.durationMs,
      })));
    },
  );

  it("reads and validates the original once, composes one prompt, and gives the chain one immutable snapshot", async () => {
    const readSource = vi.fn(async () => Buffer.from(PNG_BUFFER));
    const validateSource = vi.fn(async (bytes: Buffer) => validated(bytes));
    const compose = vi.fn(() => "one composed prompt");
    const chain = mockChain(async input => success(
      input.chainId!,
      "openai",
      ["gemini", "openai"],
      [attempt("gemini", "refusal", 1), attempt("openai", "successful", 2)],
    ), ["gemini", "openai"]);
    const pipeline = makePipeline(chain, {
      readSource,
      validateSource,
      composePrompt: compose,
    });

    await pipeline.generate(testImagePath, createScenarioFromHour(12));

    expect(readSource).toHaveBeenCalledOnce();
    expect(readSource).toHaveBeenCalledWith(testImagePath);
    expect(validateSource).toHaveBeenCalledOnce();
    expect(compose).toHaveBeenCalledOnce();
    expect(chain.editImage).toHaveBeenCalledOnce();
    expect(chain.editImage.mock.calls[0][0]).toMatchObject({
      chainId: "logical-edit-1",
      prompt: "one composed prompt",
      output: { stage: "normal", aspectRatio: "source" },
    });
    expect(chain.editImage.mock.calls[0][0].source.bytes).toEqual(PNG_BUFFER);
  });

  it("passes a configured normal ratio and records a seed only for the Gemini winner that used it", async () => {
    const chain = mockChain(async input => ({
      ...success(
        input.chainId!,
        "gemini",
        ["gemini", "openai"],
        [attempt("gemini", "successful", 1)],
      ),
      seed: 42,
    }), ["gemini", "openai"]);
    const pipeline = new Pipeline(
      {
        outputDir: tempDir,
        geminiConfig: { aspectRatio: "16:9", seed: 42 },
      },
      {
        chain,
        terminalEventSink: event => { events.push(event); },
        createId: () => "logical-edit-1",
      },
    );

    const geminiResult = await pipeline.generate(testImagePath, createScenarioFromHour(18));
    expect(chain.editImage.mock.calls[0][0].output).toEqual({
      stage: "normal",
      aspectRatio: "16:9",
    });
    expect(geminiResult.metadata.seed).toBe(42);

    chain.editImage.mockImplementationOnce(async input => ({
      ...success(
        input.chainId!,
        "openai",
        ["gemini", "openai"],
        [attempt("gemini", "refusal", 1), attempt("openai", "successful", 2)],
      ),
      // The pipeline must not trust or persist a seed claimed by a provider
      // that does not receive Haystack's configured Gemini seed.
      seed: 42,
    }));
    const fallbackResult = await pipeline.generate(testImagePath, createScenarioFromHour(19));
    expect(fallbackResult.metadata).not.toHaveProperty("seed");
  });

  it("keeps a complete interactive prompt authoritative without injecting the default contract", async () => {
    const compose = vi.fn(() => "unused");
    const chain = mockChain(async input => success(
      input.chainId!, "gemini", ["gemini"], [attempt("gemini", "successful", 1)],
    ), ["gemini"]);
    const pipeline = makePipeline(chain, {
      composePrompt: compose,
    });
    const scenario = createScenarioFromHour(12);
    const override = "Only repaint the bicycle red. Conditions: {scenario}";
    const expectedPrompt = `Only repaint the bicycle red. Conditions: ${describeScenario(scenario)}`;

    const result = await pipeline.generate(
      testImagePath,
      scenario,
      override,
    );

    expect(compose).not.toHaveBeenCalled();
    expect(chain.editImage.mock.calls[0][0].prompt).toBe(expectedPrompt);
    expect(chain.editImage.mock.calls[0][0].prompt).not.toContain(
      "makes the viewer pause and wonder what is happening",
    );
    expect(result.metadata.prompt).toBe(expectedPrompt);
    const persistedMetadata = JSON.parse(
      fs.readFileSync(path.join(tempDir, `${result.metadata.id}.json`), "utf8"),
    ) as { prompt: string };
    expect(persistedMetadata.prompt).toBe(expectedPrompt);
  });

  it("persists nothing and emits one sanitized event on full exhaustion", async () => {
    const order: ImageProviderId[] = ["gemini", "openai", "xai"];
    const attempts = order.map((provider, index) => attempt(provider, "refusal", index + 1));
    const chain = mockChain(async input => {
      throw new ProviderChainExhaustedError(
        run(input.chainId!, order, attempts, "exhausted"),
      );
    });
    const pipeline = makePipeline(chain);

    await expect(
      pipeline.generate(testImagePath, createScenarioFromHour(18)),
    ).rejects.toBeInstanceOf(ProviderChainExhaustedError);

    expect(fs.readdirSync(tempDir).filter(file => /\.(json|jpg|webp)$/.test(file))).toEqual([]);
    expect(events).toEqual([expect.objectContaining({
      chainId: "logical-edit-1",
      outcome: "exhausted",
      attempts: attempts.map(item => ({
        provider: item.provider,
        outcome: item.outcome,
        durationMs: item.durationMs,
      })),
    })]);
    expect(JSON.stringify(events)).not.toMatch(/request|usage|prompt|source|base64/i);
  });

  it.each(["caller_cancelled", "chain_deadline"] as const)(
    "emits one %s event and saves nothing",
    async outcome => {
      const chain = mockChain(async input => {
        throw new ProviderChainTerminatedError(
          outcome,
          run(input.chainId!, ["gemini"], [], outcome),
        );
      }, ["gemini"]);
      const pipeline = makePipeline(chain);

      await expect(
        pipeline.generate(testImagePath, createScenarioFromHour(18)),
      ).rejects.toBeInstanceOf(ProviderChainTerminatedError);

      expect(events).toEqual([expect.objectContaining({ outcome })]);
      expect(fs.readdirSync(tempDir).filter(file => file.endsWith(".json"))).toEqual([]);
    },
  );

  it("does not call another provider after a successful chain when storage fails", async () => {
    const chain = mockChain(async input => success(
      input.chainId!, "openai", ["gemini", "openai"], [
        attempt("gemini", "refusal", 1),
        attempt("openai", "successful", 2),
      ],
    ), ["gemini", "openai"]);
    const store = {
      cleanupUncommitted: vi.fn(),
      save: vi.fn().mockRejectedValue(new Error("disk full /private/path")),
    } as unknown as OutputStore;
    const pipeline = makePipeline(chain, { store });

    await expect(
      pipeline.generate(testImagePath, createScenarioFromHour(18)),
    ).rejects.toMatchObject({ code: "PIPELINE_GENERATION_FAILED", safeCode: "storage_failed" });

    expect(chain.editImage).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledOnce();
    expect(events).toEqual([expect.objectContaining({
      outcome: "local_failure",
      safeCode: "storage_failed",
      winner: "openai",
    })]);
    expect(JSON.stringify(events)).not.toContain("/private/path");
  });

  it("emits one local failure when the source cannot be read and never calls a provider", async () => {
    const chain = mockChain(async input => success(
      input.chainId!, "gemini", ["gemini"], [attempt("gemini", "successful", 1)],
    ), ["gemini"]);
    const pipeline = makePipeline(chain, {
      readSource: vi.fn().mockRejectedValue(new Error("/private/source missing")),
    });

    const caught = await pipeline.generate(
      testImagePath,
      createScenarioFromHour(18),
    ).catch(error => error);

    expect(caught).toBeInstanceOf(PipelineGenerationError);
    expect(caught.safeCode).toBe("source_read_failed");
    expect(chain.editImage).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({
      chainId: "logical-edit-1",
      outcome: "local_failure",
      safeCode: "source_read_failed",
      attempts: [],
    })]);
  });

  it("sanitizes source-validation failure, writes nothing, and releases the lock", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const chain = mockChain(async input => success(
      input.chainId!, "gemini", ["gemini"], [attempt("gemini", "successful", 1)],
    ), ["gemini"]);
    const pipeline = makePipeline(chain, {
      validateSource: vi.fn().mockRejectedValue(new Error("raw decoder /private/path")),
      generationLock: {
        acquire: vi.fn().mockResolvedValue({ token: "lease-token", release }),
      },
    });

    await expect(
      pipeline.generate(testImagePath, createScenarioFromHour(18)),
    ).rejects.toMatchObject({
      code: "PIPELINE_GENERATION_FAILED",
      safeCode: "source_validation_failed",
    });

    expect(chain.editImage).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(fs.readdirSync(tempDir)).toEqual(["original.png"]);
    expect(events).toEqual([expect.objectContaining({
      outcome: "local_failure",
      safeCode: "source_validation_failed",
      attempts: [],
    })]);
    expect(JSON.stringify(events)).not.toContain("/private/path");
  });

  it("sanitizes cleanup failures, makes no provider call, and releases the lock", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const chain = mockChain(async input => success(
      input.chainId!, "gemini", ["gemini"], [attempt("gemini", "successful", 1)],
    ), ["gemini"]);
    const store = {
      cleanupUncommitted: vi.fn(() => {
        throw new Error("/private/output cleanup failed");
      }),
      save: vi.fn(),
    } as unknown as OutputStore;
    const pipeline = makePipeline(chain, {
      store,
      generationLock: {
        acquire: vi.fn().mockResolvedValue({ token: "lease-token", release }),
      },
    });

    await expect(
      pipeline.generate(testImagePath, createScenarioFromHour(18)),
    ).rejects.toMatchObject({
      code: "PIPELINE_GENERATION_FAILED",
      safeCode: "storage_cleanup_failed",
    });

    expect(store.cleanupUncommitted).toHaveBeenCalledOnce();
    expect(chain.editImage).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(events).toEqual([expect.objectContaining({
      outcome: "local_failure",
      safeCode: "storage_cleanup_failed",
      attempts: [],
    })]);
    expect(JSON.stringify(events)).not.toContain("/private/output");
  });

  it("returns busy before provider work and emits one safe terminal event", async () => {
    const chain = mockChain(async input => success(
      input.chainId!, "gemini", ["gemini"], [attempt("gemini", "successful", 1)],
    ), ["gemini"]);
    const pipeline = makePipeline(chain, {
      generationLock: {
        acquire: vi.fn().mockRejectedValue(Object.assign(new Error("busy"), {
          code: "GENERATION_BUSY",
        })),
      },
    });

    await expect(
      pipeline.generate(testImagePath, createScenarioFromHour(18)),
    ).rejects.toMatchObject({ code: "GENERATION_BUSY" });

    expect(chain.editImage).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({
      outcome: "local_failure",
      safeCode: "generation_busy",
    })]);
  });

  it("releases the shared lock after both success and failure", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const acquire = vi.fn().mockResolvedValue({ token: "lease-token", release });
    const chain = mockChain(async input => success(
      input.chainId!, "gemini", ["gemini"], [attempt("gemini", "successful", 1)],
    ), ["gemini"]);
    const pipeline = makePipeline(chain, { generationLock: { acquire } });

    await pipeline.generate(testImagePath, createScenarioFromHour(18));
    expect(release).toHaveBeenCalledTimes(1);

    chain.editImage.mockRejectedValueOnce(new ProviderChainExhaustedError(
      run(
        "logical-edit-1",
        ["gemini"],
        [attempt("gemini", "refusal", 1)],
        "exhausted",
      ),
    ));
    await expect(
      pipeline.generate(testImagePath, createScenarioFromHour(19)),
    ).rejects.toBeInstanceOf(ProviderChainExhaustedError);
    expect(release).toHaveBeenCalledTimes(2);
    expect(acquire).toHaveBeenCalledTimes(2);
  });
});

describe("defaultGenerationTerminalEventSink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns when wall-clock suspension lets an attempt exceed its configured chain timeout", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const event: GenerationTerminalEvent = {
      chainId: "chain-after-sleep",
      stage: "normal",
      providerOrder: ["gemini", "openai"],
      chainTimeoutMs: 120_000,
      attempts: [{
        provider: "gemini",
        outcome: "provider_timeout",
        durationMs: 908_098,
      }],
      outcome: "chain_deadline",
      occurredAt: "2026-08-16T17:21:30.045Z",
    };

    defaultGenerationTerminalEventSink(event);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(
      "system sleep or event-loop suspension",
    ));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("chain-after-sleep"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("chainTimeoutMs=120000"));
    expect(info).toHaveBeenCalledOnce();
  });

  it("does not warn for an attempt within the chain deadline", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const event: GenerationTerminalEvent = {
      chainId: "normal-chain",
      stage: "normal",
      providerOrder: ["gemini"],
      chainTimeoutMs: 570_000,
      attempts: [{
        provider: "gemini",
        outcome: "successful",
        durationMs: 12_000,
      }],
      outcome: "successful",
      winner: "gemini",
      renderId: "render-1",
      occurredAt: "2026-08-17T10:00:15.732Z",
    };

    defaultGenerationTerminalEventSink(event);

    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
  });
});
