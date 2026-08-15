import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import sharp from "sharp";
import { OutputStore } from "../../src/storage/output-store.js";
import type { RenderMetadata } from "../../src/engine/types.js";

function makeMetadata(id: string, createdAt?: string): RenderMetadata {
  return {
    id,
    artworkSource: "/art/test.png",
    scenario: {
      timestampLocal: "2026-02-12T18:00:00.000Z",
      hour: 18,
      isDay: true,
    },
    prompt: "test prompt",
    model: "gemini-3.1-flash-lite-image",
    createdAt: createdAt ?? new Date().toISOString(),
    outputPath: "",
  };
}

let pngBuffer: Buffer;
let jpegBuffer: Buffer;
let webpBuffer: Buffer;

beforeAll(async () => {
  const input = {
    create: {
      width: 3,
      height: 2,
      channels: 3 as const,
      background: { r: 30, g: 80, b: 140 },
    },
  };
  pngBuffer = await sharp(input).png().toBuffer();
  jpegBuffer = await sharp(input).jpeg().toBuffer();
  webpBuffer = await sharp(input).webp().toBuffer();
});

describe("OutputStore", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-store-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates base directory if it does not exist", () => {
    const nested = path.join(tempDir, "a", "b", "c");
    new OutputStore(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it.each([
    ["PNG", () => pngBuffer, ".png", "image/png"],
    ["JPEG", () => jpegBuffer, ".jpg", "image/jpeg"],
    ["WebP", () => webpBuffer, ".webp", "image/webp"],
  ] as const)("saves %s bytes with truthful metadata and filename", async (_label, getBytes, extension, mimeType) => {
    const store = new OutputStore(tempDir);
    const bytes = getBytes();
    const id = `render-${extension.slice(1)}`;
    const imagePath = await store.save(bytes, makeMetadata(id));

    expect(imagePath).toBe(path.join(tempDir, `${id}${extension}`));
    expect(fs.readFileSync(imagePath)).toEqual(bytes);

    const resolved = await store.resolve(id);
    expect(resolved).toMatchObject({
      imagePath,
      mimeType,
      extension,
      downloadFilename: `haystack-${id}${extension}`,
      width: 3,
      height: 2,
      byteCount: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(resolved?.metadata).toMatchObject({
      mimeType,
      width: 3,
      height: 2,
      byteCount: bytes.length,
    });
    expect(resolved?.metadata.outputPath).toBe(imagePath);
  });

  it("persists provider provenance while keeping the requested model at model", async () => {
    const store = new OutputStore(tempDir);
    const metadata: RenderMetadata = {
      ...makeMetadata("provider-win"),
      provider: "gemini",
      model: "gemini-3.1-flash-lite-image",
      resolvedModel: "gemini-3.1-flash-lite-image-2026-08-01",
      providerOrder: ["gemini", "openai", "xai"],
      attempts: [{
        attemptId: "attempt-1",
        stage: "normal",
        ordinal: 1,
        provider: "gemini",
        requestedModel: "gemini-3.1-flash-lite-image",
        startedAt: "2026-08-15T10:00:00.000Z",
        completedAt: "2026-08-15T10:00:01.000Z",
        durationMs: 1_000,
        outcome: "successful",
      }],
    };

    await store.save(jpegBuffer, metadata);

    expect((await store.resolve("provider-win"))?.metadata).toMatchObject({
      provider: "gemini",
      model: "gemini-3.1-flash-lite-image",
      resolvedModel: "gemini-3.1-flash-lite-image-2026-08-01",
      providerOrder: ["gemini", "openai", "xai"],
      attempts: [expect.objectContaining({ outcome: "successful" })],
      mimeType: "image/jpeg",
    });
  });

  it("uses the sidecar rename as the commit point", async () => {
    const store = new OutputStore(tempDir, 24, {
      beforeSidecarCommit: () => {
        throw new Error("simulated crash");
      },
    });

    await expect(store.save(pngBuffer, makeMetadata("render-crash"))).rejects.toThrow(
      "simulated crash",
    );
    expect(fs.existsSync(path.join(tempDir, "render-crash.png"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "render-crash.json"))).toBe(false);
    expect(await store.listAll()).toEqual([]);
    expect(await store.resolve("render-crash")).toBeNull();

    new OutputStore(tempDir);
    expect(fs.existsSync(path.join(tempDir, "render-crash.png"))).toBe(false);
    expect(fs.readdirSync(tempDir).some(file => file.endsWith(".tmp"))).toBe(false);
  });

  it("ignores malformed sidecars and removes stale temp files", async () => {
    fs.writeFileSync(path.join(tempDir, "bad.json"), "not-json");
    fs.writeFileSync(path.join(tempDir, ".render.image.tmp"), pngBuffer);
    const store = new OutputStore(tempDir);

    expect(await store.listAll()).toEqual([]);
    expect(fs.existsSync(path.join(tempDir, ".render.image.tmp"))).toBe(false);
  });

  it("does not delete unrelated artwork just because it has no sidecar", () => {
    const artworkPath = path.join(tempDir, "source-artwork.png");
    fs.writeFileSync(artworkPath, pngBuffer);

    new OutputStore(tempDir);

    expect(fs.readFileSync(artworkPath)).toEqual(pngBuffer);
  });

  it("keeps legacy sidecars readable when new metadata fields are absent", async () => {
    const legacy = makeMetadata("legacy");
    fs.writeFileSync(path.join(tempDir, "legacy.png"), pngBuffer);
    fs.writeFileSync(path.join(tempDir, "legacy.json"), JSON.stringify(legacy));
    const store = new OutputStore(tempDir);

    expect(await store.listAll()).toEqual([
      expect.objectContaining({ id: "legacy", model: legacy.model }),
    ]);
    expect(await store.getLatest()).toEqual(
      expect.objectContaining({ id: "legacy", model: legacy.model }),
    );
    expect(await store.resolve("legacy")).toMatchObject({
      mimeType: "image/png",
      extension: ".png",
    });
  });

  it("treats bytes as authoritative for a legacy .png containing JPEG", async () => {
    const legacy = makeMetadata("legacy-jpeg");
    fs.writeFileSync(path.join(tempDir, "legacy-jpeg.png"), jpegBuffer);
    fs.writeFileSync(path.join(tempDir, "legacy-jpeg.json"), JSON.stringify(legacy));
    const store = new OutputStore(tempDir);

    expect(await store.resolve("legacy-jpeg")).toMatchObject({
      imagePath: path.join(tempDir, "legacy-jpeg.png"),
      mimeType: "image/jpeg",
      extension: ".jpg",
      downloadFilename: "haystack-legacy-jpeg.jpg",
    });
  });

  it("never follows a sidecar outputPath outside the output directory", async () => {
    const outside = path.join(tempDir, "..", "secret.png");
    fs.writeFileSync(outside, pngBuffer);
    fs.writeFileSync(path.join(tempDir, "safe.png"), jpegBuffer);
    fs.writeFileSync(
      path.join(tempDir, "safe.json"),
      JSON.stringify({ ...makeMetadata("safe"), outputPath: outside }),
    );
    const store = new OutputStore(tempDir);

    expect(await store.resolve("safe")).toMatchObject({
      imagePath: path.join(tempDir, "safe.png"),
      mimeType: "image/jpeg",
    });
    expect(fs.readFileSync(outside)).toEqual(pngBuffer);
    fs.rmSync(outside, { force: true });
  });

  it.each([
    ["missing image", "missing", () => undefined],
    ["ambiguous siblings", "ambiguous", () => {
      fs.writeFileSync(path.join(tempDir, "ambiguous.png"), pngBuffer);
      fs.writeFileSync(path.join(tempDir, "ambiguous.jpg"), jpegBuffer);
    }],
    ["unsupported bytes", "unsupported", () => {
      fs.writeFileSync(path.join(tempDir, "unsupported.png"), Buffer.from("not an image"));
    }],
    ["corrupt image", "corrupt", () => {
      fs.writeFileSync(path.join(tempDir, "corrupt.png"), pngBuffer.subarray(0, 20));
    }],
  ] as const)("fails safely for %s", async (_label, id, prepare) => {
    prepare();
    fs.writeFileSync(path.join(tempDir, `${id}.json`), JSON.stringify(makeMetadata(id)));
    const store = new OutputStore(tempDir);

    expect(await store.resolve(id)).toBeNull();
    expect((await store.listAll()).map(metadata => metadata.id)).not.toContain(id);
  });

  it("rejects metadata IDs containing traversal or separators", async () => {
    const store = new OutputStore(tempDir);
    for (const id of ["../../etc/evil", "a/b", "a\\b"]) {
      await expect(store.save(pngBuffer, makeMetadata(id))).rejects.toThrow(/Invalid metadata id/);
    }
  });

  it("rejects unsupported or corrupt bytes before writing anything", async () => {
    const store = new OutputStore(tempDir);
    await expect(store.save(Buffer.from("not an image"), makeMetadata("bad"))).rejects.toThrow(
      /valid PNG, JPEG, or WebP/,
    );
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it("purges mixed formats with their sidecars", async () => {
    const store = new OutputStore(tempDir, 2);
    await store.save(pngBuffer, makeMetadata("a-old"));
    await store.save(jpegBuffer, makeMetadata("b-mid"));
    await store.save(webpBuffer, makeMetadata("c-new"));

    expect((await store.listAll()).map(metadata => metadata.id)).toEqual(["c-new", "b-mid"]);
    expect(fs.existsSync(path.join(tempDir, "a-old.png"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "a-old.json"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "b-mid.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "c-new.webp"))).toBe(true);
  });

  it("purges a legacy .png-with-JPEG record without touching outside paths", async () => {
    const outside = path.join(tempDir, "..", "do-not-delete.png");
    fs.writeFileSync(outside, pngBuffer);
    fs.writeFileSync(path.join(tempDir, "a-legacy.png"), jpegBuffer);
    fs.writeFileSync(
      path.join(tempDir, "a-legacy.json"),
      JSON.stringify({ ...makeMetadata("a-legacy"), outputPath: outside }),
    );
    const store = new OutputStore(tempDir, 1);
    await store.save(webpBuffer, makeMetadata("z-new"));

    expect(fs.existsSync(path.join(tempDir, "a-legacy.png"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "a-legacy.json"))).toBe(false);
    expect(fs.existsSync(outside)).toBe(true);
    fs.rmSync(outside, { force: true });
  });

  it("validates maxOutputs", () => {
    expect(() => new OutputStore(tempDir, 0)).toThrow(RangeError);
    expect(() => new OutputStore(tempDir, -1)).toThrow(RangeError);
    expect(() => new OutputStore(tempDir, 2.5)).toThrow(RangeError);
  });
});
