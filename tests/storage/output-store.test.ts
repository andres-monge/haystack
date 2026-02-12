import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
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
    model: "gemini-2.5-flash-image",
    createdAt: createdAt ?? new Date().toISOString(),
    outputPath: "",
  };
}

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

  it("saves image and metadata sidecar", () => {
    const store = new OutputStore(tempDir);
    const meta = makeMetadata("render-001");
    const imageBuffer = Buffer.from("fake-png-data");

    const imagePath = store.save(imageBuffer, meta);

    expect(fs.existsSync(imagePath)).toBe(true);
    expect(fs.readFileSync(imagePath).toString()).toBe("fake-png-data");

    const metaPath = imagePath.replace(".png", ".json");
    expect(fs.existsSync(metaPath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as RenderMetadata;
    expect(saved.id).toBe("render-001");
    expect(saved.outputPath).toBe(imagePath);
  });

  it("does not leave temp files after save", () => {
    const store = new OutputStore(tempDir);
    store.save(Buffer.from("img"), makeMetadata("render-001"));

    const files = fs.readdirSync(tempDir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("getLatest returns null on empty store", () => {
    const store = new OutputStore(tempDir);
    expect(store.getLatest()).toBeNull();
  });

  it("getLatest returns most recently saved render", () => {
    const store = new OutputStore(tempDir);
    // IDs sort lexicographically: "a" < "b", so "b" is newest
    store.save(Buffer.from("img-a"), makeMetadata("a"));
    store.save(Buffer.from("img-b"), makeMetadata("b"));

    const latest = store.getLatest();
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe("b");
  });

  it("listAll returns all renders sorted newest first", () => {
    const store = new OutputStore(tempDir);
    // Lexicographic order: "first" < "second" < "third"
    store.save(Buffer.from("img-1"), makeMetadata("first"));
    store.save(Buffer.from("img-2"), makeMetadata("second"));
    store.save(Buffer.from("img-3"), makeMetadata("third"));

    const all = store.listAll();
    expect(all).toHaveLength(3);
    expect(all[0].id).toBe("third");
    expect(all[1].id).toBe("second");
    expect(all[2].id).toBe("first");
  });

  it("purges oldest outputs when exceeding maxOutputs", () => {
    const store = new OutputStore(tempDir, 2);

    // Lexicographic order: "a-old" < "b-mid" < "c-new"
    store.save(Buffer.from("img-old"), makeMetadata("a-old"));
    store.save(Buffer.from("img-mid"), makeMetadata("b-mid"));
    store.save(Buffer.from("img-new"), makeMetadata("c-new"));

    const all = store.listAll();
    expect(all).toHaveLength(2);
    expect(all.map((m) => m.id)).toContain("c-new");
    expect(all.map((m) => m.id)).toContain("b-mid");
    expect(all.map((m) => m.id)).not.toContain("a-old");

    // Old files should be deleted from disk
    expect(fs.existsSync(path.join(tempDir, "a-old.png"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "a-old.json"))).toBe(false);
  });

  it("does not purge when at exactly maxOutputs", () => {
    const store = new OutputStore(tempDir, 2);
    store.save(Buffer.from("img-a"), makeMetadata("a"));
    store.save(Buffer.from("img-b"), makeMetadata("b"));

    const all = store.listAll();
    expect(all).toHaveLength(2);
    expect(fs.existsSync(path.join(tempDir, "a.png"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "b.png"))).toBe(true);
  });

  it("listAll returns empty array on empty store", () => {
    const store = new OutputStore(tempDir);
    expect(store.listAll()).toEqual([]);
  });

  // Validation tests

  it("throws for invalid maxOutputs", () => {
    expect(() => new OutputStore(tempDir, 0)).toThrow(RangeError);
    expect(() => new OutputStore(tempDir, -1)).toThrow(RangeError);
    expect(() => new OutputStore(tempDir, 2.5)).toThrow(RangeError);
    expect(() => new OutputStore(tempDir, NaN)).toThrow(RangeError);
  });

  it("rejects metadata.id with path traversal characters", () => {
    const store = new OutputStore(tempDir);
    const traversal = makeMetadata("../../etc/evil");

    expect(() => store.save(Buffer.from("img"), traversal)).toThrow(/Invalid metadata id/);
  });

  it("rejects metadata.id with slashes", () => {
    const store = new OutputStore(tempDir);

    expect(() => store.save(Buffer.from("img"), makeMetadata("a/b"))).toThrow(/Invalid metadata id/);
    expect(() => store.save(Buffer.from("img"), makeMetadata("a\\b"))).toThrow(/Invalid metadata id/);
  });

  it("accepts valid metadata.id with dashes and underscores", () => {
    const store = new OutputStore(tempDir);
    const meta = makeMetadata("20260212_180000_a1b2c3d4");
    const imagePath = store.save(Buffer.from("img"), meta);
    expect(fs.existsSync(imagePath)).toBe(true);
  });

  // Error handling tests

  it("skips corrupted JSON files in listAll", () => {
    const store = new OutputStore(tempDir);
    store.save(Buffer.from("img"), makeMetadata("valid"));

    // Write a corrupted JSON file
    fs.writeFileSync(path.join(tempDir, "zzz-corrupt.json"), "not valid json{{{");

    const all = store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("valid");
  });

  it("returns null from getLatest when only corrupted files exist", () => {
    const store = new OutputStore(tempDir);
    fs.writeFileSync(path.join(tempDir, "corrupt.json"), "{bad");

    expect(store.getLatest()).toBeNull();
  });
});
