// src/server/image-rotation.ts — Folder-based daily image selection

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
 */
export function getImageForToday(imageDir: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(imageDir);
  } catch {
    return null;
  }

  const images = entries
    .filter((name) => {
      if (name.startsWith(".")) return false;
      const ext = path.extname(name).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext);
    })
    .sort();

  if (images.length === 0) return null;

  const dayOfYear = getDayOfYear(new Date());
  return path.join(imageDir, images[dayOfYear % images.length]);
}

/** Returns 1-based day of year (Jan 1 = 1, Dec 31 = 365/366). */
function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}
