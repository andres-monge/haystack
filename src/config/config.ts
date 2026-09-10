// src/config/config.ts -- Environment-based configuration loader

import * as path from "node:path";
import * as os from "node:os";
import type { PipelineConfig, GeminiConfig, AspectRatio } from "../engine/types.js";
import {
  CONFIGURED_ASPECT_RATIOS,
  type ImageProviderId,
} from "../engine/provider-types.js";
import {
  PROVIDER_KEY_NAMES,
  isProviderApiKeyPresent,
  type ProviderApiKeys,
  type ProviderFactoryConfig,
} from "../engine/provider-factory.js";
import type { ComparisonProviderKeys } from "../comparison/types.js";

const VALID_MODELS: ReadonlySet<GeminiConfig["model"]> = new Set([
  "gemini-3.1-flash-lite-image",
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
  "gemini-2.5-flash-image",
]);

const RETIRED_MODEL_REPLACEMENTS: Readonly<Record<string, GeminiConfig["model"]>> = Object.freeze({
  "gemini-3.1-flash-image-preview": "gemini-3.1-flash-image",
  "gemini-3-pro-image-preview": "gemini-3-pro-image",
});

const PREFERRED_PROVIDER_ORDER = Object.freeze([
  "openai",
  "gemini",
  "xai",
] as const satisfies readonly ImageProviderId[]);

const VALID_ASPECT_RATIOS: ReadonlySet<AspectRatio> = new Set([
  ...CONFIGURED_ASPECT_RATIOS,
]);

export interface HaystackConfig {
  googleApiKey: string;
  /** Direct credentials retained server-side for provider construction only. */
  providerKeys: Readonly<ProviderApiKeys>;
  /** Frozen production provider order snapshot. */
  imageProviderOrder: readonly ImageProviderId[];
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
  /** Model used by extend-artwork (defaults to stable gemini-3.1-flash-image). */
  extendModel: GeminiConfig["model"];
}

/**
 * Load the direct-provider credentials used only by the local comparison tool.
 * Keeping these separate prevents challenger keys from entering PipelineConfig.
 */
export function loadComparisonKeysFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ComparisonProviderKeys {
  return {
    googleApiKey: isProviderApiKeyPresent(env.GOOGLE_API_KEY)
      ? env.GOOGLE_API_KEY
      : env.GEMINI_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    xaiApiKey: env.XAI_API_KEY,
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

function parseModel(raw: string | undefined, name = "HAYSTACK_MODEL"): GeminiConfig["model"] {
  if (!raw) return "gemini-3.1-flash-lite-image";
  const replacement = RETIRED_MODEL_REPLACEMENTS[raw];
  if (replacement) {
    throw new Error(
      `Invalid ${name}: "${raw}" is retired. Use stable replacement "${replacement}".`,
    );
  }
  if (!VALID_MODELS.has(raw as GeminiConfig["model"])) {
    throw new Error(
      `Invalid ${name}: "${raw}". Valid values: ${[...VALID_MODELS].join(", ")}`,
    );
  }
  if (raw === "gemini-2.5-flash-image") {
    const replacement = name === "HAYSTACK_EXTEND_MODEL"
      ? "gemini-3.1-flash-image"
      : "gemini-3.1-flash-lite-image";
    console.warn(
      `${name}=gemini-2.5-flash-image retires in October 2026; migrate to ${replacement}.`,
    );
  }
  return raw as GeminiConfig["model"];
}

function loadProviderKeys(env: NodeJS.ProcessEnv): Readonly<ProviderApiKeys> {
  const gemini = isProviderApiKeyPresent(env.GOOGLE_API_KEY)
    ? env.GOOGLE_API_KEY
    : env.GEMINI_API_KEY;
  const keys: ProviderApiKeys = {
    ...(isProviderApiKeyPresent(gemini) ? { gemini } : {}),
    ...(isProviderApiKeyPresent(env.OPENAI_API_KEY)
      ? { openai: env.OPENAI_API_KEY }
      : {}),
    ...(isProviderApiKeyPresent(env.XAI_API_KEY)
      ? { xai: env.XAI_API_KEY }
      : {}),
  };
  Object.defineProperty(keys, "toJSON", {
    value: () => undefined,
    enumerable: false,
  });
  return Object.freeze(keys);
}

function parseProviderOrder(
  raw: string | undefined,
  keys: Readonly<ProviderApiKeys>,
): readonly ImageProviderId[] {
  if (raw === undefined) {
    const derived = PREFERRED_PROVIDER_ORDER.filter(provider =>
      isProviderApiKeyPresent(keys[provider]));
    if (derived.length === 0) {
      throw new Error(
        "Haystack requires at least one direct image provider key: set GOOGLE_API_KEY or GEMINI_API_KEY, OPENAI_API_KEY, or XAI_API_KEY.",
      );
    }
    return Object.freeze([...derived]);
  }

  if (raw.trim().length === 0) {
    throw new Error("Invalid HAYSTACK_IMAGE_PROVIDER_ORDER: value must not be empty or whitespace-only");
  }

  const rawProviders = raw.split(",");
  if (rawProviders.some(provider => provider.trim().length === 0)) {
    throw new Error(
      "Invalid HAYSTACK_IMAGE_PROVIDER_ORDER: empty provider entries are not allowed",
    );
  }

  const providers = rawProviders.map(provider => provider.trim());
  for (const provider of providers) {
    if (!PREFERRED_PROVIDER_ORDER.includes(provider as ImageProviderId)) {
      throw new Error(
        `Invalid HAYSTACK_IMAGE_PROVIDER_ORDER provider "${provider}". Valid values: ${PREFERRED_PROVIDER_ORDER.join(", ")}`,
      );
    }
  }

  const unique = new Set(providers);
  if (unique.size !== providers.length) {
    throw new Error("Invalid HAYSTACK_IMAGE_PROVIDER_ORDER: duplicate providers are not allowed");
  }

  const order = providers as ImageProviderId[];
  for (const provider of order) {
    if (!isProviderApiKeyPresent(keys[provider])) {
      throw new Error(
        `${PROVIDER_KEY_NAMES[provider]} is missing for selected provider ${provider} in HAYSTACK_IMAGE_PROVIDER_ORDER`,
      );
    }
  }
  return Object.freeze([...order]);
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
  const providerKeys = loadProviderKeys(process.env);
  const imageProviderOrder = parseProviderOrder(
    process.env.HAYSTACK_IMAGE_PROVIDER_ORDER,
    providerKeys,
  );
  const config = {
    imageProviderOrder,
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
    extendModel: parseModel(
      process.env.HAYSTACK_EXTEND_MODEL ?? "gemini-3.1-flash-image",
      "HAYSTACK_EXTEND_MODEL",
    ),
  } as Omit<HaystackConfig, "googleApiKey" | "providerKeys">;
  // Compatibility for pre-chain entry points until U4 migrates them. Keeping
  // this property non-enumerable prevents accidental config serialization.
  Object.defineProperty(config, "googleApiKey", {
    value: providerKeys.gemini ?? "",
    enumerable: false,
  });
  Object.defineProperty(config, "providerKeys", {
    value: providerKeys,
    enumerable: false,
  });
  return config as HaystackConfig;
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

/** Isolate server-side provider construction from serializable pipeline config. */
export function toProviderFactoryConfig(config: HaystackConfig): ProviderFactoryConfig {
  return {
    providerOrder: config.imageProviderOrder,
    providerKeys: config.providerKeys,
    geminiModels: {
      normal: config.defaultModel,
      extend: config.extendModel,
    },
    ...(config.defaultSeed !== undefined
      ? { defaultSeed: config.defaultSeed }
      : {}),
  };
}
