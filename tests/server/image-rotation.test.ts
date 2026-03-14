import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getImageForToday,
  getAlternateImages,
  resetImageCache,
  resetStateDir,
  setStateDir,
  getDateString,
  reconcileQueue,
} from "../../src/server/image-rotation.js";

interface RotationState {
  queue: string[];
  position: number;
  lastDate: string;
}

describe("getImageForToday", () => {
  let tmpDir: string;
  let stateDir: string;

  beforeEach(() => {
    resetImageCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-img-test-"));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-state-test-"));
    setStateDir(stateDir);
  });

  afterEach(() => {
    resetStateDir();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  function readState(): RotationState {
    const raw = fs.readFileSync(
      path.join(stateDir, "rotation-state.json"),
      "utf-8",
    );
    return JSON.parse(raw) as RotationState;
  }

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

  describe("queue-based rotation", () => {
    it("initializes queue alphabetically on first call", () => {
      fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");

      getImageForToday(tmpDir, undefined, new Date(2026, 0, 1));
      const state = readState();
      expect(state.queue).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    });

    it("advances position on each new day", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");

      const day1 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 1));
      resetImageCache();
      const day2 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 2));
      resetImageCache();
      const day3 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 3));

      // First call initializes at position 0 (a.jpg), then advances
      expect(day1).toBe(path.join(tmpDir, "a.jpg"));
      expect(day2).toBe(path.join(tmpDir, "b.jpg"));
      expect(day3).toBe(path.join(tmpDir, "c.jpg"));
    });

    it("wraps around after exhausting all images", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");

      const day1 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 1));
      resetImageCache();
      const day2 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 2));
      resetImageCache();
      const day3 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 3));

      expect(day1).toBe(path.join(tmpDir, "a.jpg"));
      expect(day2).toBe(path.join(tmpDir, "b.jpg"));
      expect(day3).toBe(path.join(tmpDir, "a.jpg")); // wraps
    });

    it("persists state across cache resets (simulating restart)", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");

      // Day 1: initializes at a.jpg
      getImageForToday(tmpDir, undefined, new Date(2026, 0, 1));

      // Simulate restart: reset in-memory cache, state file remains on disk
      resetImageCache();

      // Day 2: should load from disk and advance to b.jpg
      const result = getImageForToday(tmpDir, undefined, new Date(2026, 0, 2));
      expect(result).toBe(path.join(tmpDir, "b.jpg"));
    });

    it("handles corrupt state file by reinitializing", () => {
      fs.writeFileSync(
        path.join(stateDir, "rotation-state.json"),
        "not valid json",
      );
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");

      const result = getImageForToday(tmpDir);
      expect(result).toBe(path.join(tmpDir, "a.jpg"));
    });

    it("handles state file with missing fields by reinitializing", () => {
      fs.writeFileSync(
        path.join(stateDir, "rotation-state.json"),
        JSON.stringify({ queue: ["a.jpg"] }), // missing position and lastDate
      );
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");

      const result = getImageForToday(tmpDir);
      expect(result).not.toBeNull();
    });

    it("handles state file with non-string queue elements by reinitializing", () => {
      fs.writeFileSync(
        path.join(stateDir, "rotation-state.json"),
        JSON.stringify({
          queue: [42, null, "a.jpg"],
          position: 0,
          lastDate: "2026-01-01",
        }),
      );
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");

      const result = getImageForToday(tmpDir);
      expect(result).toBe(path.join(tmpDir, "a.jpg"));
    });

    it("handles state file with out-of-bounds position", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");

      fs.writeFileSync(
        path.join(stateDir, "rotation-state.json"),
        JSON.stringify({
          queue: ["a.jpg", "b.jpg"],
          position: 999,
          lastDate: "2026-01-01",
        }),
      );

      // position 999 should be clamped to 0, then advance to 1 on new day
      const result = getImageForToday(tmpDir, undefined, new Date(2026, 0, 2));
      expect(result).not.toBeNull();
      const state = readState();
      expect(state.position).toBeLessThan(state.queue.length);
    });

    it("stores lastDate as ISO date string", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");

      getImageForToday(tmpDir, undefined, new Date(2026, 2, 2)); // Mar 2
      const state = readState();
      expect(state.lastDate).toBe("2026-03-02");
    });
  });

  describe("adding images mid-cycle", () => {
    it("does not change today's image when new images are added", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");

      const now = new Date(2026, 1, 26);
      const first = getImageForToday(tmpDir, undefined, now);

      // Add images mid-day
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "d.jpg"), "");
      resetImageCache(); // force re-read

      const second = getImageForToday(tmpDir, undefined, now);
      expect(second).toBe(first);
    });

    it("sorts new files into alphabetical position", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");

      // Day 1: queue = [a, c], position 0 (a.jpg)
      getImageForToday(tmpDir, undefined, new Date(2026, 0, 1));

      // Add b.jpg — should go after position 0
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
      resetImageCache();

      // Day 2: should advance to next in queue
      const day2 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 2));
      const state = readState();

      // Queue re-sorts to [a, b, c]; position 0 still points to a.jpg
      // Advance to position 1 = b.jpg
      expect(state.queue).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
      expect(day2).toBe(path.join(tmpDir, "b.jpg"));
    });

    it("maintains alphabetical order when images are added mid-cycle", () => {
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "d.jpg"), "");

      // Day 1: queue = [b, d], position 0 (b.jpg)
      const day1 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 1));
      expect(day1).toBe(path.join(tmpDir, "b.jpg"));
      resetImageCache();

      // Day 2: position 1 (d.jpg)
      const day2 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 2));
      expect(day2).toBe(path.join(tmpDir, "d.jpg"));
      resetImageCache();

      // Add a.jpg and c.jpg — alphabetically before/between existing
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");

      // Day 3: queue re-sorts to [a, b, c, d], d.jpg is now at index 3
      // Advance from 3 → (3+1)%4 = 0 → a.jpg
      const day3 = getImageForToday(tmpDir, undefined, new Date(2026, 0, 3));
      expect(day3).toBe(path.join(tmpDir, "a.jpg"));
    });
  });

  describe("removing images", () => {
    it("removes deleted images from queue", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");

      // Initialize queue
      getImageForToday(tmpDir, undefined, new Date(2026, 0, 1));
      resetImageCache();

      // Delete b.jpg
      fs.unlinkSync(path.join(tmpDir, "b.jpg"));

      // Next day: should skip b.jpg
      resetImageCache();
      getImageForToday(tmpDir, undefined, new Date(2026, 0, 2));
      const state = readState();
      expect(state.queue).not.toContain("b.jpg");
    });

    it("adjusts position when images before current are removed", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");

      // Day 1: position 0 (a.jpg)
      getImageForToday(tmpDir, undefined, new Date(2026, 0, 1));
      resetImageCache();

      // Day 2: position 1 (b.jpg)
      getImageForToday(tmpDir, undefined, new Date(2026, 0, 2));
      resetImageCache();

      // Delete a.jpg (before current position)
      fs.unlinkSync(path.join(tmpDir, "a.jpg"));

      // Same day re-read: should still show b.jpg, not shift
      resetImageCache();
      const result = getImageForToday(tmpDir, undefined, new Date(2026, 0, 2));
      expect(result).toBe(path.join(tmpDir, "b.jpg"));
    });
  });

  describe("cache stability", () => {
    it("returns the same image even if folder changes between calls", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");

      const now = new Date(2026, 1, 26);
      const first = getImageForToday(tmpDir, undefined, now);

      // Add more images — should not change today's selection
      fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "d.jpg"), "");

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

      // Should re-read and return a valid image
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

      expect(first).not.toBe(second);
    });
  });

  describe("timezone-aware day boundary", () => {
    it("advances position based on timezone day boundary", () => {
      fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
      fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");

      // Initialize state on Feb 26 afternoon (same calendar day in both UTC and Madrid)
      const afternoon = new Date("2026-02-26T12:00:00Z");
      const result1 = getImageForToday(tmpDir, "Europe/Madrid", afternoon);
      expect(result1).toBe(path.join(tmpDir, "a.jpg")); // position 0

      // Feb 26 at 23:30 UTC = Feb 27 at 00:30 in Europe/Madrid
      const utcLateNight = new Date("2026-02-26T23:30:00Z");

      // In UTC it's still Feb 26 → same day, no advance
      resetImageCache();
      const resultUTC = getImageForToday(tmpDir, "UTC", utcLateNight);
      expect(resultUTC).toBe(path.join(tmpDir, "a.jpg")); // still position 0

      // In Madrid it's already Feb 27 → new day, position advances
      resetImageCache();
      const resultMadrid = getImageForToday(
        tmpDir,
        "Europe/Madrid",
        utcLateNight,
      );
      expect(resultMadrid).toBe(path.join(tmpDir, "b.jpg")); // advanced to position 1
    });
  });
});

describe("reconcileQueue", () => {
  it("returns queue unchanged when files match", () => {
    const result = reconcileQueue(["a.jpg", "b.jpg", "c.jpg"], 1, [
      "a.jpg",
      "b.jpg",
      "c.jpg",
    ]);
    expect(result.queue).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(result.position).toBe(1);
  });

  it("removes deleted files and adjusts position", () => {
    // Position 2 (c.jpg), remove a.jpg (before position)
    const result = reconcileQueue(["a.jpg", "b.jpg", "c.jpg"], 2, [
      "b.jpg",
      "c.jpg",
    ]);
    expect(result.queue).toEqual(["b.jpg", "c.jpg"]);
    expect(result.position).toBe(1); // was 2, minus 1 removed before
  });

  it("inserts new files after current position", () => {
    const result = reconcileQueue(["a.jpg", "c.jpg"], 0, [
      "a.jpg",
      "b.jpg",
      "c.jpg",
    ]);
    expect(result.queue).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(result.position).toBe(0);
  });

  it("re-sorts queue alphabetically and tracks current image", () => {
    const result = reconcileQueue(["c.jpg"], 0, [
      "a.jpg",
      "b.jpg",
      "c.jpg",
      "d.jpg",
    ]);
    // Queue is always alphabetical; position follows c.jpg to index 2
    expect(result.queue).toEqual(["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
    expect(result.position).toBe(2);
  });

  it("handles removing the current image", () => {
    // Position 1 (b.jpg), remove b.jpg
    const result = reconcileQueue(["a.jpg", "b.jpg", "c.jpg"], 1, [
      "a.jpg",
      "c.jpg",
    ]);
    expect(result.queue).toEqual(["a.jpg", "c.jpg"]);
    // Position 1 pointed to b.jpg which was removed, now filtered queue
    // has a.jpg at 0 and c.jpg at 1; position stays at 1
    expect(result.position).toBe(1);
  });

  it("wraps position when all images after position are removed", () => {
    // Position 2 (c.jpg), remove b.jpg and c.jpg
    const result = reconcileQueue(["a.jpg", "b.jpg", "c.jpg"], 2, ["a.jpg"]);
    expect(result.queue).toEqual(["a.jpg"]);
    expect(result.position).toBe(0); // wrapped
  });

  it("handles empty queue after all removals", () => {
    const result = reconcileQueue(["a.jpg", "b.jpg"], 0, []);
    expect(result.queue).toEqual([]);
    expect(result.position).toBe(0);
  });
});

describe("getAlternateImages", () => {
  let tmpDir: string;
  let stateDir: string;

  beforeEach(() => {
    resetImageCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-alt-test-"));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-alt-state-"));
    setStateDir(stateDir);
  });

  afterEach(() => {
    resetStateDir();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  function writeState(state: RotationState): void {
    fs.writeFileSync(
      path.join(stateDir, "rotation-state.json"),
      JSON.stringify(state, null, 2),
    );
  }

  it("returns images in queue order starting after current position", () => {
    fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "b.png"), "");
    fs.writeFileSync(path.join(tmpDir, "c.webp"), "");

    // Position 0 = a.jpg, so alternates should start from b, then c
    writeState({ queue: ["a.jpg", "b.png", "c.webp"], position: 0, lastDate: "2026-03-10" });

    const result = getAlternateImages(tmpDir, [path.join(tmpDir, "a.jpg")]);
    expect(result).toEqual([
      path.join(tmpDir, "b.png"),
      path.join(tmpDir, "c.webp"),
    ]);
  });

  it("wraps around the queue when position is near the end", () => {
    fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "d.jpg"), "");

    // Position 2 = c.jpg, so alternates should be: d, a, b (wrapping around)
    writeState({
      queue: ["a.jpg", "b.jpg", "c.jpg", "d.jpg"],
      position: 2,
      lastDate: "2026-03-10",
    });

    const result = getAlternateImages(tmpDir, [path.join(tmpDir, "c.jpg")]);
    expect(result).toEqual([
      path.join(tmpDir, "d.jpg"),
      path.join(tmpDir, "a.jpg"),
      path.join(tmpDir, "b.jpg"),
    ]);
  });

  it("accepts basenames in skipFiles", () => {
    fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");

    writeState({ queue: ["a.jpg", "b.jpg"], position: 0, lastDate: "2026-03-10" });

    // Full path with different prefix — should still skip by basename
    const result = getAlternateImages(tmpDir, ["/other/dir/a.jpg"]);
    expect(result).toEqual([path.join(tmpDir, "b.jpg")]);
  });

  it("returns empty array when all images are skipped", () => {
    fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");

    writeState({ queue: ["a.jpg"], position: 0, lastDate: "2026-03-10" });

    const result = getAlternateImages(tmpDir, [path.join(tmpDir, "a.jpg")]);
    expect(result).toEqual([]);
  });

  it("returns empty array for missing directory", () => {
    const result = getAlternateImages("/nonexistent/path", []);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty directory", () => {
    const result = getAlternateImages(tmpDir, []);
    expect(result).toEqual([]);
  });

  it("returns all images in queue order when skipFiles is empty", () => {
    fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");

    // Position 1 = b.jpg, so order should be: c, a (starting after position 1)
    writeState({ queue: ["a.jpg", "b.jpg", "c.jpg"], position: 1, lastDate: "2026-03-10" });

    const result = getAlternateImages(tmpDir, []);
    expect(result).toEqual([
      path.join(tmpDir, "c.jpg"),
      path.join(tmpDir, "a.jpg"),
    ]);
  });

  it("ignores non-image files", () => {
    fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "readme.md"), "");

    writeState({ queue: ["a.jpg"], position: 0, lastDate: "2026-03-10" });

    const result = getAlternateImages(tmpDir, []);
    expect(result).toEqual([]);
  });

  it("falls back to alphabetical order when no rotation state exists", () => {
    fs.writeFileSync(path.join(tmpDir, "b.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");

    // No state file written — should use alphabetical fallback
    const result = getAlternateImages(tmpDir, [path.join(tmpDir, "b.jpg")]);
    expect(result).toEqual([
      path.join(tmpDir, "a.jpg"),
      path.join(tmpDir, "c.jpg"),
    ]);
  });

  it("skips queue entries that no longer exist on disk", () => {
    fs.writeFileSync(path.join(tmpDir, "a.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "c.jpg"), "");
    // b.jpg is in queue but not on disk

    writeState({
      queue: ["a.jpg", "b.jpg", "c.jpg"],
      position: 0,
      lastDate: "2026-03-10",
    });

    const result = getAlternateImages(tmpDir, [path.join(tmpDir, "a.jpg")]);
    expect(result).toEqual([path.join(tmpDir, "c.jpg")]);
  });
});

describe("getDateString", () => {
  it("returns ISO date for a given date", () => {
    expect(getDateString(new Date(2026, 0, 1))).toBe("2026-01-01");
  });

  it("pads month and day with zeros", () => {
    expect(getDateString(new Date(2026, 2, 2))).toBe("2026-03-02");
  });

  it("returns December 31 correctly", () => {
    expect(getDateString(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("respects timezone when provided", () => {
    // Feb 26 at 23:30 UTC = Feb 27 at 00:30 in Europe/Madrid
    const utcLateNight = new Date("2026-02-26T23:30:00Z");

    const dateUTC = getDateString(utcLateNight, "UTC");
    const dateMadrid = getDateString(utcLateNight, "Europe/Madrid");

    expect(dateUTC).toBe("2026-02-26");
    expect(dateMadrid).toBe("2026-02-27");
  });

  it("handles year boundary correctly", () => {
    // Dec 31 at 23:30 UTC = Jan 1 at 00:30 in Europe/Madrid
    const newYearsEve = new Date("2026-12-31T23:30:00Z");

    const dateUTC = getDateString(newYearsEve, "UTC");
    const dateMadrid = getDateString(newYearsEve, "Europe/Madrid");

    expect(dateUTC).toBe("2026-12-31");
    expect(dateMadrid).toBe("2027-01-01");
  });
});
