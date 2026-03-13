// src/config/config.ts -- Environment-based configuration loader

import * as path from "node:path";
import * as os from "node:os";
import type { PipelineConfig, GeminiConfig, AspectRatio } from "../engine/types.js";

const VALID_MODELS: ReadonlySet<GeminiConfig["model"]> = new Set([
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
]);

const VALID_ASPECT_RATIOS: ReadonlySet<AspectRatio> = new Set([
  "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9",
]);

export interface HaystackConfig {
  googleApiKey: string;
  outputDir: string;
  defaultModel: GeminiConfig["model"];
  defaultAspectRatio?: GeminiConfig["aspectRatio"];
  defaultSeed?: number;
  maxStoredOutputs: number;
  // Phase C: Kiosk scheduling
  bindHost: string;
  imageDir?: string;
  schedulerLocation?: {
    lat: number;
    lon: number;
    timezone: string;
  };
  /** Hour (0–23) when scheduled generation starts (inclusive). */
  activeStart?: number;
  /** Hour (0–23) when scheduled generation stops (exclusive). */
  activeEnd?: number;
  /** Model used by extend-artwork script (defaults to gemini-3.1-flash-image-preview). */
  extendModel: GeminiConfig["model"];
}

function parseIntStrict(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${name}: "${raw}" is not a valid integer`);
  }
  return parsed;
}

function parseModel(raw: string | undefined, name = "HAYSTACK_MODEL"): GeminiConfig["model"] {
  if (!raw) return "gemini-2.5-flash-image";
  if (!VALID_MODELS.has(raw as GeminiConfig["model"])) {
    throw new Error(
      `Invalid ${name}: "${raw}". Valid values: ${[...VALID_MODELS].join(", ")}`,
    );
  }
  return raw as GeminiConfig["model"];
}

function parseFloat64(raw: string | undefined, name: string): number | undefined {
  if (!raw) return undefined;
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: "${raw}" is not a valid number`);
  }
  return parsed;
}

function parseSchedulerLocation(env: NodeJS.ProcessEnv): HaystackConfig["schedulerLocation"] {
  const lat = parseFloat64(env.HAYSTACK_LAT, "HAYSTACK_LAT");
  const lon = parseFloat64(env.HAYSTACK_LON, "HAYSTACK_LON");
  const timezone = env.HAYSTACK_TIMEZONE;

  // Only populate when all three are set
  if (lat !== undefined && lon !== undefined && timezone) {
    if (lat < -90 || lat > 90) {
      throw new Error(`Invalid HAYSTACK_LAT: ${lat} is outside range -90..90`);
    }
    if (lon < -180 || lon > 180) {
      throw new Error(`Invalid HAYSTACK_LON: ${lon} is outside range -180..180`);
    }
    const validTimezones = Intl.supportedValuesOf("timeZone");
    if (!validTimezones.includes(timezone)) {
      throw new Error(`Invalid HAYSTACK_TIMEZONE: "${timezone}" is not a recognized IANA timezone`);
    }
    return { lat, lon, timezone };
  }
  return undefined;
}

function parseActiveHours(env: NodeJS.ProcessEnv): { activeStart?: number; activeEnd?: number } {
  const startRaw = env.HAYSTACK_ACTIVE_START;
  const endRaw = env.HAYSTACK_ACTIVE_END;

  // Both unset → no active hours restriction (24/7 generation)
  if (!startRaw && !endRaw) {
    return { activeStart: undefined, activeEnd: undefined };
  }

  // Both must be set together
  if (!startRaw || !endRaw) {
    throw new Error(
      "HAYSTACK_ACTIVE_START and HAYSTACK_ACTIVE_END must both be set or both be omitted",
    );
  }

  const start = parseIntStrict(startRaw, 0, "HAYSTACK_ACTIVE_START");
  const end = parseIntStrict(endRaw, 0, "HAYSTACK_ACTIVE_END");

  if (start < 0 || start > 23) {
    throw new Error(`Invalid HAYSTACK_ACTIVE_START: ${start} is outside range 0..23`);
  }
  if (end < 0 || end > 23) {
    throw new Error(`Invalid HAYSTACK_ACTIVE_END: ${end} is outside range 0..23`);
  }
  if (start >= end) {
    throw new Error(
      `Invalid active hours: HAYSTACK_ACTIVE_START (${start}) must be less than HAYSTACK_ACTIVE_END (${end})`,
    );
  }

  return { activeStart: start, activeEnd: end };
}

function parseAspectRatio(raw: string | undefined): AspectRatio | undefined {
  if (!raw) return undefined;
  if (!VALID_ASPECT_RATIOS.has(raw as AspectRatio)) {
    throw new Error(
      `Invalid HAYSTACK_ASPECT_RATIO: "${raw}". Valid values: ${[...VALID_ASPECT_RATIOS].join(", ")}`,
    );
  }
  return raw as AspectRatio;
}

/**
 * Load configuration from environment variables.
 */
export function loadConfigFromEnv(): HaystackConfig {
  const { activeStart, activeEnd } = parseActiveHours(process.env);
  return {
    googleApiKey:
      process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "",
    outputDir:
      process.env.HAYSTACK_OUTPUT_DIR ??
      path.join(os.homedir(), ".haystack", "outputs"),
    defaultModel: parseModel(process.env.HAYSTACK_MODEL),
    defaultAspectRatio: parseAspectRatio(process.env.HAYSTACK_ASPECT_RATIO),
    defaultSeed: process.env.HAYSTACK_SEED
      ? parseIntStrict(process.env.HAYSTACK_SEED, 0, "HAYSTACK_SEED")
      : undefined,
    maxStoredOutputs: parseIntStrict(
      process.env.HAYSTACK_MAX_OUTPUTS,
      24,
      "HAYSTACK_MAX_OUTPUTS",
    ),
    bindHost: process.env.HAYSTACK_BIND_HOST ?? "127.0.0.1",
    imageDir: process.env.HAYSTACK_IMAGE_DIR || undefined,
    schedulerLocation: parseSchedulerLocation(process.env),
    activeStart,
    activeEnd,
    extendModel: parseModel(process.env.HAYSTACK_EXTEND_MODEL ?? "gemini-3.1-flash-image-preview", "HAYSTACK_EXTEND_MODEL"),
  };
}

/**
 * Convert HaystackConfig to Partial<PipelineConfig>.
 */
export function toPipelineConfig(config: HaystackConfig): Partial<PipelineConfig> {
  return {
    outputDir: config.outputDir,
    maxOutputs: config.maxStoredOutputs,
    geminiConfig: {
      model: config.defaultModel,
      aspectRatio: config.defaultAspectRatio,
      seed: config.defaultSeed,
    },
  };
}
