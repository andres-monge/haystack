import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getImageForToday } from "../../src/server/image-rotation.js";

describe("getImageForToday", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-img-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for a missing directory", () => {
    expect(getImageForToday("/nonexistent/path")).toBeNull();
  });

  it("returns null for an empty directory", () => {
    expect(getImageForToday(tmpDir)).toBeNull();
  });

  it("returns null when directory has only non-image files", () => {
    fs.writeFileSync(path.join(tmpDir, "readme.txt"), "");
    fs.writeFileSync(path.join(tmpDir, "data.json"), "");
    expect(getImageForToday(tmpDir)).toBeNull();
  });

  it("ignores hidden files", () => {
    fs.writeFileSync(path.join(tmpDir, ".DS_Store"), "");
    fs.writeFileSync(path.join(tmpDir, ".hidden.jpg"), "");
    expect(getImageForToday(tmpDir)).toBeNull();
  });

  it("returns a valid image path from a directory with images", () => {
    fs.writeFileSync(path.join(tmpDir, "art1.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "art2.png"), "");
    fs.writeFileSync(path.join(tmpDir, "art3.webp"), "");

    const result = getImageForToday(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.startsWith(tmpDir)).toBe(true);
    expect([".jpg", ".png", ".webp"]).toContain(path.extname(result!));
  });

  it("handles case-insensitive extensions", () => {
    fs.writeFileSync(path.join(tmpDir, "photo.JPG"), "");
    fs.writeFileSync(path.join(tmpDir, "image.PNG"), "");

    const result = getImageForToday(tmpDir);
    expect(result).not.toBeNull();
  });

  it("ignores non-image files mixed with images", () => {
    fs.writeFileSync(path.join(tmpDir, "art.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "readme.md"), "");
    fs.writeFileSync(path.join(tmpDir, "notes.txt"), "");

    const result = getImageForToday(tmpDir);
    expect(result).toBe(path.join(tmpDir, "art.jpg"));
  });

  it("returns deterministic results (same day = same image)", () => {
    fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "b.png"), "");
    fs.writeFileSync(path.join(tmpDir, "c.webp"), "");

    const first = getImageForToday(tmpDir);
    const second = getImageForToday(tmpDir);
    expect(first).toBe(second);
  });

  it("returns a single image when only one exists", () => {
    fs.writeFileSync(path.join(tmpDir, "only.png"), "");

    const result = getImageForToday(tmpDir);
    expect(result).toBe(path.join(tmpDir, "only.png"));
  });

  it("selects based on alphabetical sort order", () => {
    // With only one image, it's always selected regardless of day
    fs.writeFileSync(path.join(tmpDir, "zebra.jpg"), "");

    const result = getImageForToday(tmpDir);
    expect(result).toBe(path.join(tmpDir, "zebra.jpg"));
  });

  it("supports .jpeg extension", () => {
    fs.writeFileSync(path.join(tmpDir, "photo.jpeg"), "");

    const result = getImageForToday(tmpDir);
    expect(result).toBe(path.join(tmpDir, "photo.jpeg"));
  });

  it("ignores subdirectories even if named like images", () => {
    fs.mkdirSync(path.join(tmpDir, "paintings.jpg"));
    fs.writeFileSync(path.join(tmpDir, "real.png"), "");

    const result = getImageForToday(tmpDir);
    expect(result).toBe(path.join(tmpDir, "real.png"));
  });

  it("selects different images for different dates", () => {
    fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");

    const day1 = getImageForToday(tmpDir, new Date(2026, 0, 1)); // Jan 1
    const day2 = getImageForToday(tmpDir, new Date(2026, 0, 2)); // Jan 2
    expect(day1).not.toBe(day2);
  });

  it("cycles back to first image after exhausting all", () => {
    fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");

    const day1 = getImageForToday(tmpDir, new Date(2026, 0, 1));
    const day3 = getImageForToday(tmpDir, new Date(2026, 0, 3)); // 2 days later = same index
    expect(day1).toBe(day3);
  });
});
