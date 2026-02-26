// src/server/image-rotation.ts -- Folder-based daily image selection

import * as fs from "node:fs";
import * as path from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/** Cached selection: once an image is picked for a day, stick with it. */
let cachedSelection: { day: number; imageDir: string; path: string } | null = null;

/** Reset the cache (for testing). */
export function resetImageCache(): void {
  cachedSelection = null;
}

/**
 * Returns the path to today's image from the given directory.
 *
 * Images are sorted alphabetically for deterministic ordering,
 * then selected using `dayOfYear % count` so a different image
 * is shown each day, cycling through the folder.
 *
 * Once an image is selected for a calendar day, the result is cached
 * so that adding/removing files mid-day doesn't shift the selection.
 * The cache invalidates on day rollover or if the cached file is deleted.
 *
 * Returns `null` if the directory is empty, missing, or contains no images.
 * Pass `timezone` to use a specific IANA timezone for the day boundary.
 * Pass `now` to override the current date (useful for testing).
 */
export function getImageForToday(
  imageDir: string,
  timezone?: string,
  now?: Date,
): string | null {
  const day = getDayOfYear(now ?? new Date(), timezone);

  // Return cached selection if still valid
  if (
    cachedSelection &&
    cachedSelection.day === day &&
    cachedSelection.imageDir === imageDir &&
    fs.existsSync(cachedSelection.path)
  ) {
    return cachedSelection.path;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(imageDir, { withFileTypes: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return null;
    }
    console.warn(
      `[${new Date().toISOString()}] Failed to read image directory "${imageDir}": ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }

  const images = entries
    .filter((entry) => {
      if (!entry.isFile()) return false;
      if (entry.name.startsWith(".")) return false;
      const ext = path.extname(entry.name).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext);
    })
    .map((entry) => entry.name)
    .sort();

  if (images.length === 0) return null;

  const selected = path.join(imageDir, images[day % images.length]);
  cachedSelection = { day, imageDir, path: selected };
  return selected;
}

/**
 * Returns 1-based day of year (Jan 1 = 1, Dec 31 = 365/366).
 * When timezone is provided, uses Intl to determine the calendar day
 * in that timezone rather than the system's local time.
 */
export function getDayOfYear(date: Date, timezone?: string): number {
  let year: number;
  let month: number;
  let day: number;

  if (timezone) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    const parts = formatter.formatToParts(date);
    year = parseInt(parts.find((p) => p.type === "year")!.value, 10);
    month = parseInt(parts.find((p) => p.type === "month")!.value, 10);
    day = parseInt(parts.find((p) => p.type === "day")!.value, 10);
  } else {
    year = date.getFullYear();
    month = date.getMonth() + 1;
    day = date.getDate();
  }

  // Compute day-of-year from year/month/day
  const start = new Date(year, 0, 0);
  const target = new Date(year, month - 1, day);
  const diff = target.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}
