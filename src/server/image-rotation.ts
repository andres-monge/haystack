// src/server/image-rotation.ts -- Folder-based daily image selection

import * as fs from "node:fs";
import * as path from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/**
 * Returns the path to today's image from the given directory.
 *
 * Images are sorted alphabetically for deterministic ordering,
 * then selected using `dayOfYear % count` so a different image
 * is shown each day, cycling through the folder.
 *
 * Returns `null` if the directory is empty, missing, or contains no images.
 * Pass `now` to override the current date (useful for testing).
 */
export function getImageForToday(imageDir: string, now?: Date): string | null {
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

  const dayOfYear = getDayOfYear(now ?? new Date());
  return path.join(imageDir, images[dayOfYear % images.length]);
}

/** Returns 1-based day of year (Jan 1 = 1, Dec 31 = 365/366). */
function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}
