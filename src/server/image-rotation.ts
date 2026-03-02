// src/server/image-rotation.ts -- Persistent queue-based daily image selection

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/** Shape of the persisted rotation state. */
interface RotationState {
  queue: string[];
  position: number;
  lastDay: number;
}

/** In-memory cache: avoids re-reading disk on every hourly tick within the same day. */
let cachedSelection: { day: number; imageDir: string; path: string } | null =
  null;

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

/** Read state from disk, or return null if missing/corrupt. */
function loadState(): RotationState | null {
  const filePath = getStateFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed.queue) &&
      typeof parsed.position === "number" &&
      typeof parsed.lastDay === "number"
    ) {
      return parsed as RotationState;
    }
    return null;
  } catch {
    return null;
  }
}

/** Atomic write: temp file → rename. */
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
      if (!entry.isFile()) return false;
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
 * - Removed images are dropped; position is adjusted if it pointed past the end.
 * - New images are inserted into the queue after the current position,
 *   in alphabetical order relative to each other, so they get their turn
 *   without disrupting already-scheduled images.
 */
export function reconcileQueue(
  queue: string[],
  position: number,
  currentFiles: string[],
): { queue: string[]; position: number } {
  const currentSet = new Set(currentFiles);
  const existingSet = new Set(queue);

  // Remove deleted images, track how many were before position
  let removedBeforePos = 0;
  const filtered: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (currentSet.has(queue[i])) {
      filtered.push(queue[i]);
    } else if (i < position) {
      removedBeforePos++;
    }
  }

  let newPos = Math.max(0, position - removedBeforePos);
  if (filtered.length > 0 && newPos >= filtered.length) {
    newPos = 0;
  }

  // Find new images not yet in the queue
  const newImages = currentFiles
    .filter((f) => !existingSet.has(f))
    .sort();

  if (newImages.length === 0) {
    return { queue: filtered, position: newPos };
  }

  // Insert new images after the current position, sorted among themselves
  const before = filtered.slice(0, newPos + 1);
  const after = filtered.slice(newPos + 1);
  const merged = [...before, ...newImages, ...after];

  return { queue: merged, position: newPos };
}

/**
 * Returns the path to today's image from the given directory.
 *
 * Uses a persistent queue stored at ~/.haystack/rotation-state.json
 * so that adding/removing images doesn't reshuffle the rotation order.
 * New images are inserted after the current position and will appear
 * in the remainder of the current cycle or the next one.
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

  // Fast path: in-memory cache for same day
  if (
    cachedSelection &&
    cachedSelection.day === day &&
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
  if (!state) {
    state = { queue: currentFiles, position: 0, lastDay: day };
  }

  // Reconcile queue with current files on disk
  const reconciled = reconcileQueue(state.queue, state.position, currentFiles);
  state.queue = reconciled.queue;
  state.position = reconciled.position;

  if (state.queue.length === 0) return null;

  // Advance position if it's a new day
  if (day !== state.lastDay) {
    state.position = (state.position + 1) % state.queue.length;
    state.lastDay = day;
  }

  // Persist and cache
  saveState(state);
  const selected = path.join(imageDir, state.queue[state.position]);
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
