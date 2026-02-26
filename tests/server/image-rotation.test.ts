import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getImageForToday, resetImageCache, getDayOfYear } from "../../src/server/image-rotation.js";

describe("getImageForToday", () => {
  let tmpDir: string;

  beforeEach(() => {
    resetImageCache();
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

    const day1 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 1)); // Jan 1
    resetImageCache();
    const day2 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 2)); // Jan 2
    expect(day1).not.toBe(day2);
  });

  it("cycles back to first image after exhausting all", () => {
    fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");

    const day1 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 1));
    resetImageCache();
    const day3 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 3)); // 2 days later = same index
    expect(day1).toBe(day3);
  });

  describe("cache stability", () => {
    it("returns the same image even if folder changes between calls", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");

      const now = new Date(2026, 1, 26);
      const first = getImageForToday(tmpDir, undefined, now);

      // Add more images — would normally change the modulus
      fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "d.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "e.jpg"), "");

      const second = getImageForToday(tmpDir, undefined, now);
      expect(second).toBe(first);
    });

    it("invalidates cache when cached file is deleted", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");

      const now = new Date(2026, 1, 26);
      const first = getImageForToday(tmpDir, undefined, now);
      expect(first).not.toBeNull();

      // Delete the cached file
      fs.unlinkSync(first!);

      // Should re-read and return the remaining image
      const second = getImageForToday(tmpDir, undefined, now);
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);
    });

    it("invalidates cache on day rollover", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");

      const day1 = new Date(2026, 1, 26);
      const day2 = new Date(2026, 1, 27);

      const first = getImageForToday(tmpDir, undefined, day1);
      // Don't reset cache — the day change should invalidate it
      const second = getImageForToday(tmpDir, undefined, day2);

      // With 3 images: day 57 % 3 = 0, day 58 % 3 = 1 → different
      expect(first).not.toBe(second);
    });
  });

  describe("timezone-aware day boundary", () => {
    it("uses configured timezone for day boundary", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");

      // Feb 26 at 23:30 UTC = Feb 27 at 00:30 in Europe/Madrid (CET = UTC+1)
      const utcLateNight = new Date("2026-02-26T23:30:00Z");

      const resultUTC = getImageForToday(tmpDir, "UTC", utcLateNight);
      resetImageCache();
      const resultMadrid = getImageForToday(tmpDir, "Europe/Madrid", utcLateNight);

      // UTC sees day 57 (Feb 26), Madrid sees day 58 (Feb 27)
      // With 3 images: 57 % 3 = 0, 58 % 3 = 1 → different images
      expect(resultUTC).not.toBe(resultMadrid);
    });
  });
});

describe("getDayOfYear", () => {
  it("returns 1 for January 1", () => {
    expect(getDayOfYear(new Date(2026, 0, 1))).toBe(1);
  });

  it("returns 365 for December 31 (non-leap year)", () => {
    expect(getDayOfYear(new Date(2026, 11, 31))).toBe(365);
  });

  it("respects timezone when provided", () => {
    // Feb 26 at 23:30 UTC = Feb 27 at 00:30 in Europe/Madrid
    const utcLateNight = new Date("2026-02-26T23:30:00Z");

    const dayUTC = getDayOfYear(utcLateNight, "UTC");
    const dayMadrid = getDayOfYear(utcLateNight, "Europe/Madrid");

    expect(dayUTC).toBe(57);   // Feb 26
    expect(dayMadrid).toBe(58); // Feb 27
  });
});
