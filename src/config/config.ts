// src/config/config.ts -- Environment-based configuration loader

import * as path from "node:path";
import * as os from "node:os";
import type { PipelineConfig, GeminiConfig, AspectRatio } from "../engine/types.js";

const VALID_MODELS: ReadonlySet<GeminiConfig["model"]> = new Set([
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
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
}

function parseIntStrict(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${name}: "${raw}" is not a valid integer`);
  }
  return parsed;
}

function parseModel(raw: string | undefined): GeminiConfig["model"] {
  if (!raw) return "gemini-2.5-flash-image";
  if (!VALID_MODELS.has(raw as GeminiConfig["model"])) {
    throw new Error(
      `Invalid HAYSTACK_MODEL: "${raw}". Valid values: ${[...VALID_MODELS].join(", ")}`,
    );
  }
  return raw as GeminiConfig["model"];
}

function parseFloat64(raw: string | undefined, name: string): number | undefined {
  if (!raw) return undefined;
  const parsed = parseFloat(raw);
  if (Number.isNaN(parsed)) {
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
    return { lat, lon, timezone };
  }
  return undefined;
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
