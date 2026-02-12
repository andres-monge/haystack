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
