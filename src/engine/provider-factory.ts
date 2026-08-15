import type { GeminiConfig } from "./types.js";
import {
  GeminiImageProvider,
  type GeminiImageProviderOptions,
} from "./gemini-client.js";
import {
  OpenAIImageProvider,
  type OpenAIImageProviderOptions,
} from "./openai-client.js";
import {
  XaiImageProvider,
  type XaiImageProviderOptions,
} from "./xai-client.js";
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  type ImageProviderAdapter,
  type ImageProviderId,
} from "./provider-types.js";

export interface ProviderApiKeys {
  gemini?: string;
  openai?: string;
  xai?: string;
}

export interface ProviderFactoryConfig {
  providerOrder: readonly ImageProviderId[];
  providerKeys: Readonly<ProviderApiKeys>;
  geminiModels: {
    normal: GeminiConfig["model"];
    extend: GeminiConfig["model"];
  };
  providerTimeoutMs?: number;
}

export interface ProviderAdapterFactories {
  gemini: (
    apiKey: string,
    options: GeminiImageProviderOptions,
  ) => ImageProviderAdapter;
  openai: (
    apiKey: string,
    options: OpenAIImageProviderOptions,
  ) => ImageProviderAdapter;
  xai: (
    apiKey: string,
    options: XaiImageProviderOptions,
  ) => ImageProviderAdapter;
}

const DEFAULT_FACTORIES: ProviderAdapterFactories = Object.freeze({
  gemini: (apiKey: string, options: GeminiImageProviderOptions) =>
    new GeminiImageProvider(apiKey, options),
  openai: (apiKey: string, options: OpenAIImageProviderOptions) =>
    new OpenAIImageProvider(apiKey, options),
  xai: (apiKey: string, options: XaiImageProviderOptions) =>
    new XaiImageProvider(apiKey, options),
});

const PROVIDER_KEY_NAMES: Readonly<Record<ImageProviderId, string>> = Object.freeze({
  gemini: "GOOGLE_API_KEY or GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
});

function hasKey(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Read-only adapter registry. SDK clients are constructed once and reused. */
export class ImageProviderRegistry {
  readonly ids: readonly ImageProviderId[];
  readonly #providers: Readonly<Partial<Record<ImageProviderId, ImageProviderAdapter>>>;

  constructor(providers: readonly ImageProviderAdapter[]) {
    if (providers.length === 0) {
      throw new Error("At least one image provider must be configured");
    }
    const entries: Partial<Record<ImageProviderId, ImageProviderAdapter>> = {};
    for (const provider of providers) {
      if (entries[provider.provider]) {
        throw new Error(`Duplicate image provider adapter: ${provider.provider}`);
      }
      entries[provider.provider] = provider;
    }
    this.ids = Object.freeze(providers.map(provider => provider.provider));
    this.#providers = Object.freeze(entries);
    Object.freeze(this);
  }

  has(provider: ImageProviderId): boolean {
    return this.#providers[provider] !== undefined;
  }

  get(provider: ImageProviderId): ImageProviderAdapter {
    const adapter = this.#providers[provider];
    if (!adapter) {
      throw new Error(`Image provider ${provider} is not configured`);
    }
    return adapter;
  }
}

/** Construct exactly the configured direct adapters after validating all keys. */
export function createProviderRegistry(
  config: ProviderFactoryConfig,
  factories: ProviderAdapterFactories = DEFAULT_FACTORIES,
): ImageProviderRegistry {
  const providerOrder = Object.freeze([...config.providerOrder]);
  if (providerOrder.length === 0) {
    throw new Error("At least one image provider must be configured");
  }
  const seen = new Set<ImageProviderId>();
  for (const provider of providerOrder) {
    if (seen.has(provider)) {
      throw new Error(`Duplicate image provider adapter: ${provider}`);
    }
    seen.add(provider);
    if (!hasKey(config.providerKeys[provider])) {
      throw new Error(
        `${PROVIDER_KEY_NAMES[provider]} is missing for selected provider ${provider}`,
      );
    }
  }

  const timeoutMs = config.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Provider timeout must be a positive number");
  }
  const providers = providerOrder.map(provider => {
    const apiKey = config.providerKeys[provider] as string;
    switch (provider) {
      case "gemini":
        return factories.gemini(apiKey, {
          timeoutMs,
          models: {
            normal: config.geminiModels.normal,
            "extend-cleanup": config.geminiModels.extend,
            "extend-outpaint": config.geminiModels.extend,
          },
        });
      case "openai":
        return factories.openai(apiKey, { timeoutMs });
      case "xai":
        return factories.xai(apiKey, { timeoutMs });
    }
  });

  return new ImageProviderRegistry(providers);
}
