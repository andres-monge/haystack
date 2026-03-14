// src/server/image-rotation.ts -- Persistent queue-based daily image selection

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/** Shape of the persisted rotation state. */
interface RotationState {
  queue: string[];
  position: number;
  /** ISO date string (YYYY-MM-DD) of the last day the position was advanced. */
  lastDate: string;
}

/** In-memory cache: avoids re-reading disk on every hourly tick within the same day. */
let cachedSelection: {
  date: string;
  imageDir: string;
  path: string;
} | null = null;

/** Override for state file directory (testing). */
let stateDirOverride: string | null = null;

/** Reset the in-memory cache (for testing). Does not affect state dir override. */
export function resetImageCache(): void {
  cachedSelection = null;
}

/** Reset the state dir override (for testing teardown). */
export function resetStateDir(): void {
  stateDirOverride = null;
}

/** Set a custom directory for the state file (for testing). */
export function setStateDir(dir: string): void {
  stateDirOverride = dir;
}

function getStateFilePath(): string {
  const dir = stateDirOverride ?? path.join(os.homedir(), ".haystack");
  return path.join(dir, "rotation-state.json");
}

/** Read state from disk, or return null if missing/corrupt/invalid. */
function loadState(): RotationState | null {
  const filePath = getStateFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed.queue) &&
      parsed.queue.every(
        (e: unknown) => typeof e === "string" && e.length > 0,
      ) &&
      typeof parsed.position === "number" &&
      Number.isInteger(parsed.position) &&
      parsed.position >= 0 &&
      typeof parsed.lastDate === "string" &&
      parsed.lastDate.length > 0
    ) {
      return parsed as RotationState;
    }
    return null;
  } catch {
    return null;
  }
}

/** Atomic write: temp file → rename. Logs warning on failure. */
function saveState(state: RotationState): void {
  const filePath = getStateFilePath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, filePath);
}

/** Scan the image directory and return sorted filenames. */
function scanImages(imageDir: string): string[] | null {
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

  return entries
    .filter((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) return false;
      if (entry.name.startsWith(".")) return false;
      const ext = path.extname(entry.name).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext);
    })
    .map((entry) => entry.name)
    .sort();
}

/**
 * Reconcile the persisted queue with the current files on disk.
 *
 * The queue is always kept in alphabetical order. When files are added or
 * removed, the position is adjusted to keep pointing at the same image.
 * If the current image was removed, the position is clamped to the nearest
 * valid index so rotation continues forward.
 */
export function reconcileQueue(
  queue: string[],
  position: number,
  currentFiles: string[],
): { queue: string[]; position: number } {
  if (currentFiles.length === 0) {
    return { queue: [], position: 0 };
  }

  // Remember which image is currently selected
  const currentImage = position < queue.length ? queue[position] : null;

  // New queue is always sorted alphabetically
  const newQueue = [...currentFiles].sort();

  // Find the current image in the new sorted queue
  if (currentImage) {
    const idx = newQueue.indexOf(currentImage);
    if (idx !== -1) {
      return { queue: newQueue, position: idx };
    }
  }

  // Current image was removed — clamp to valid range
  const newPos = Math.min(position, newQueue.length - 1);
  return { queue: newQueue, position: newPos };
}

/**
 * Returns the path to today's image from the given directory.
 *
 * Uses a persistent queue stored at ~/.haystack/rotation-state.json.
 * The queue is always kept in strict alphabetical order. Adding or
 * removing images re-sorts the queue while keeping the position
 * pointing at the same current image.
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
  const today = getDateString(now ?? new Date(), timezone);

  // Fast path: in-memory cache for same day
  if (
    cachedSelection &&
    cachedSelection.date === today &&
    cachedSelection.imageDir === imageDir &&
    fs.existsSync(cachedSelection.path)
  ) {
    return cachedSelection.path;
  }

  // Scan disk for current images
  const currentFiles = scanImages(imageDir);
  if (!currentFiles || currentFiles.length === 0) return null;

  // Load or initialize state
  let state = loadState();
  let dirty = false;

  if (!state) {
    state = { queue: currentFiles, position: 0, lastDate: today };
    dirty = true;
  }

  // Reconcile queue with current files on disk
  const reconciled = reconcileQueue(state.queue, state.position, currentFiles);
  if (
    reconciled.queue !== state.queue ||
    reconciled.position !== state.position
  ) {
    state.queue = reconciled.queue;
    state.position = reconciled.position;
    dirty = true;
  }

  if (state.queue.length === 0) return null;

  // Clamp position in case state file was hand-edited or corrupted
  if (state.position >= state.queue.length) {
    state.position = 0;
    dirty = true;
  }

  // Advance position if it's a new day
  if (today !== state.lastDate) {
    state.position = (state.position + 1) % state.queue.length;
    state.lastDate = today;
    dirty = true;
  }

  // Persist (only if changed) and cache
  if (dirty) {
    try {
      saveState(state);
    } catch (err: unknown) {
      console.warn(
        `[${new Date().toISOString()}] Failed to save rotation state: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  const selected = path.join(imageDir, state.queue[state.position]);
  cachedSelection = { date: today, imageDir, path: selected };
  return selected;
}

/**
 * Returns alternate image paths from the directory, excluding any in `skipFiles`.
 *
 * Used by the scheduler when the primary image is rejected by Gemini
 * (e.g. IMAGE_OTHER). Returns full paths in rotation-queue order starting
 * from the position after the current image, wrapping around. This ensures
 * the fallback tries nearby images in the queue (e.g. the next day's image)
 * rather than always jumping to the alphabetically first file.
 *
 * Falls back to alphabetical order if no rotation state exists.
 * Does not mutate persisted rotation state.
 */
export function getAlternateImages(
  imageDir: string,
  skipFiles: string[],
): string[] {
  const currentFiles = scanImages(imageDir);
  if (!currentFiles || currentFiles.length === 0) return [];

  const skipSet = new Set(skipFiles.map((f) => path.basename(f)));
  const currentSet = new Set(currentFiles);

  const state = loadState();
  if (!state || state.queue.length === 0) {
    // No rotation state — fall back to alphabetical
    return currentFiles
      .filter((f) => !skipSet.has(f))
      .map((f) => path.join(imageDir, f));
  }

  // Walk the queue starting from position+1, wrapping around
  const result: string[] = [];
  for (let i = 1; i < state.queue.length; i++) {
    const idx = (state.position + i) % state.queue.length;
    const name = state.queue[idx];
    if (currentSet.has(name) && !skipSet.has(name)) {
      result.push(path.join(imageDir, name));
    }
  }
  return result;
}

/**
 * Returns an ISO date string (YYYY-MM-DD) for the given date.
 * When timezone is provided, uses Intl to determine the calendar day
 * in that timezone rather than the system's local time.
 */
export function getDateString(date: Date, timezone?: string): string {
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

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
