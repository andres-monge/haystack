import * as path from "node:path";
import * as os from "node:os";
import type { PipelineConfig, GeminiConfig } from "../engine/types.js";

export interface HaystackConfig {
  googleApiKey: string;
  outputDir: string;
  baseArtworkDir: string;
  defaultModel: GeminiConfig["model"];
  defaultAspectRatio?: GeminiConfig["aspectRatio"];
  defaultSeed?: number;
  maxStoredOutputs: number;
}

/**
 * Load configuration from environment variables.
 */
export function loadConfigFromEnv(): HaystackConfig {
  const aspectRatio = process.env.HAYSTACK_ASPECT_RATIO as
    | GeminiConfig["aspectRatio"]
    | undefined;
  const seed = process.env.HAYSTACK_SEED
    ? parseInt(process.env.HAYSTACK_SEED, 10)
    : undefined;

  return {
    googleApiKey:
      process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "",
    outputDir:
      process.env.HAYSTACK_OUTPUT_DIR ??
      path.join(os.homedir(), ".haystack", "outputs"),
    baseArtworkDir:
      process.env.HAYSTACK_ARTWORK_DIR ??
      path.join(os.homedir(), ".haystack", "artworks"),
    defaultModel:
      (process.env.HAYSTACK_MODEL as GeminiConfig["model"]) ??
      "gemini-2.5-flash-image",
    defaultAspectRatio: aspectRatio,
    defaultSeed: seed,
    maxStoredOutputs: parseInt(process.env.HAYSTACK_MAX_OUTPUTS ?? "24", 10),
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
      ...(config.defaultAspectRatio
        ? { aspectRatio: config.defaultAspectRatio }
        : {}),
      ...(config.defaultSeed !== undefined
        ? { seed: config.defaultSeed }
        : {}),
    },
  };
}
