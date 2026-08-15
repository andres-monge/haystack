import { NoImageGeneratedError, generateImage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { GeminiClient, GeminiNoImageError } from "../engine/gemini-client.js";
import type { GeminiClientOptions } from "../engine/gemini-client.js";
import { detectSupportedImage } from "./image-validation.js";
import type {
  ComparisonErrorCategory,
  ComparisonProvider,
  ComparisonProviderKeys,
  ComparisonProviderResult,
  Round1ProviderKeys,
} from "./types.js";

export const ROUND1_MODELS = {
  gemini: "gemini-3.1-flash-lite-image",
  openai: "gpt-image-2",
  xai: "grok-imagine-image-2.0",
} as const;

export const ROUND1_PRICE_AS_OF = "2026-08-15";

export const ROUND1_PROVIDER_SPECS = {
  gemini: {
    provider: "gemini",
    model: ROUND1_MODELS.gemini,
    outputSetting: "input-matched / default",
    priceEstimate: "~$0.0336 output + input tokens",
  },
  openai: {
    provider: "openai",
    model: ROUND1_MODELS.openai,
    outputSetting: "1536x1024 / low",
    priceEstimate: "~$0.005 output + input text/image tokens",
  },
  xai: {
    provider: "xai",
    model: ROUND1_MODELS.xai,
    outputSetting: "1K / low",
    priceEstimate: "~$0.05 ($0.04 output + $0.01 input image)",
  },
} as const;

/** Paid comparison calls get a longer deadline than production generation. */
export const COMPARISON_TIMEOUT_MS = 180_000;

interface GeneratedImageDependencies {
  generateImage?: typeof generateImage;
  createAbortSignal?: (timeoutMs: number) => AbortSignal;
  comparisonTimeoutMs?: number;
}

interface OpenAIDependencies extends GeneratedImageDependencies {
  createOpenAI?: typeof createOpenAI;
}

interface XaiDependencies extends GeneratedImageDependencies {
  createXai?: typeof createXai;
}

interface GeminiDependencies {
  client?: Pick<GeminiClient, "editImage">;
  createGeminiClient?: (
    apiKey: string,
    options: GeminiClientOptions,
  ) => Pick<GeminiClient, "editImage">;
  timeoutMs?: number;
}

export interface Round1ProviderDependencies
  extends OpenAIDependencies,
    XaiDependencies {
  geminiClient?: Pick<GeminiClient, "editImage">;
  createGeminiClient?: GeminiDependencies["createGeminiClient"];
  geminiTimeoutMs?: number;
}

function createComparisonAbortSignal(
  dependencies: GeneratedImageDependencies,
): AbortSignal {
  const createSignal = dependencies.createAbortSignal
    ?? ((timeoutMs: number) => AbortSignal.timeout(timeoutMs));
  return createSignal(
    dependencies.comparisonTimeoutMs ?? COMPARISON_TIMEOUT_MS,
  );
}

function normalizeImage(bytes: Uint8Array | undefined): ComparisonProviderResult {
  if (!bytes) return { status: "unsuccessful", reason: "no_image" };

  const imageBuffer = Buffer.from(bytes);
  const mimeType = detectSupportedImage(imageBuffer);
  if (!mimeType) return { status: "unsuccessful", reason: "unusable_image" };

  return { status: "successful", imageBuffer, mimeType };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(value: unknown, field: string): string | undefined {
  const record = asRecord(value);
  return typeof record?.[field] === "string" ? record[field] : undefined;
}

function numberField(value: unknown, field: string): number | undefined {
  const record = asRecord(value);
  return typeof record?.[field] === "number" ? record[field] : undefined;
}

function structuredCodes(error: unknown): string[] {
  const record = asRecord(error);
  const data = asRecord(record?.data);
  const dataError = asRecord(data?.error);
  const cause = asRecord(record?.cause);
  return [
    stringField(record, "code"),
    stringField(record, "type"),
    stringField(data, "code"),
    stringField(data, "type"),
    stringField(dataError, "code"),
    stringField(dataError, "type"),
    stringField(cause, "code"),
    stringField(cause, "type"),
  ].filter((value): value is string => value !== undefined)
    .map(value => value.toLowerCase());
}

function isPolicyFailure(error: unknown): boolean {
  const policyCodes = new Set([
    "content_filter",
    "content_policy_violation",
    "moderation_blocked",
    "policy_violation",
    "safety",
  ]);
  return structuredCodes(error).some(code => policyCodes.has(code));
}

function errorStatus(error: unknown): number | undefined {
  const record = asRecord(error);
  return numberField(record, "statusCode")
    ?? numberField(record, "status")
    ?? numberField(record?.cause, "statusCode")
    ?? numberField(record?.cause, "status");
}

function safeErrorCategory(error: unknown): ComparisonErrorCategory {
  const status = errorStatus(error);
  const name = stringField(error, "name")?.toLowerCase();
  const codes = structuredCodes(error);

  if (name === "loadapikeyerror" || codes.includes("missing_api_key")) {
    return "configuration";
  }
  if (status === 401 || status === 403) return "authentication";
  if (
    status === 402 ||
    codes.some(code => [
      "billing_hard_limit_reached",
      "insufficient_credits",
      "insufficient_quota",
    ].includes(code))
  ) {
    return "quota";
  }
  if (status === 429) return "rate_limit";
  if (
    status === 408 ||
    status === 504 ||
    name === "aborterror" ||
    name === "timeouterror" ||
    name === "geminitimeouterror" ||
    name === "apiconnectiontimeouterror" ||
    codes.includes("etimedout") ||
    codes.includes("deadline_exceeded") ||
    codes.includes("gemini_timeout")
  ) {
    return "timeout";
  }
  if (
    codes.some(code => [
      "econnrefused",
      "econnreset",
      "enetwork",
      "enotfound",
      "eproto",
    ].includes(code))
  ) {
    return "transport";
  }
  if (status !== undefined) return "provider";
  return "unknown";
}

function normalizeFailure(error: unknown): ComparisonProviderResult {
  if (NoImageGeneratedError.isInstance(error)) {
    return { status: "unsuccessful", reason: "no_image" };
  }
  if (isPolicyFailure(error)) {
    return { status: "unsuccessful", reason: "policy" };
  }
  return { status: "error", category: safeErrorCategory(error) };
}

export function createOpenAIComparisonProvider(
  apiKey: string,
  dependencies: OpenAIDependencies = {},
): ComparisonProvider {
  const openai = (dependencies.createOpenAI ?? createOpenAI)({ apiKey });
  const model = openai.image(ROUND1_MODELS.openai);
  const generate = dependencies.generateImage ?? generateImage;

  return {
    ...ROUND1_PROVIDER_SPECS.openai,
    async editImage(imageBuffer, prompt) {
      try {
        const result = await generate({
          model,
          prompt: { images: [imageBuffer], text: prompt },
          n: 1,
          size: "1536x1024",
          maxRetries: 0,
          abortSignal: createComparisonAbortSignal(dependencies),
          providerOptions: { openai: { quality: "low" } },
        });
        return normalizeImage(result.images[0]?.uint8Array);
      } catch (error) {
        return normalizeFailure(error);
      }
    },
  };
}

export function createXaiComparisonProvider(
  apiKey: string,
  dependencies: XaiDependencies = {},
): ComparisonProvider {
  const xai = (dependencies.createXai ?? createXai)({ apiKey });
  const model = xai.image(ROUND1_MODELS.xai);
  const generate = dependencies.generateImage ?? generateImage;

  return {
    ...ROUND1_PROVIDER_SPECS.xai,
    async editImage(imageBuffer, prompt) {
      try {
        const result = await generate({
          model,
          prompt: { images: [imageBuffer], text: prompt },
          n: 1,
          maxRetries: 0,
          abortSignal: createComparisonAbortSignal(dependencies),
          providerOptions: { xai: { resolution: "1k", quality: "low" } },
        });
        return normalizeImage(result.images[0]?.uint8Array);
      } catch (error) {
        return normalizeFailure(error);
      }
    },
  };
}

export function createGeminiComparisonProvider(
  apiKey: string,
  dependencies: GeminiDependencies = {},
): ComparisonProvider {
  const timeoutMs = dependencies.timeoutMs ?? COMPARISON_TIMEOUT_MS;
  const createClient = dependencies.createGeminiClient
    ?? ((key: string, options: GeminiClientOptions) => new GeminiClient(key, options));
  const client = dependencies.client
    ?? createClient(apiKey, { timeoutMs });

  return {
    ...ROUND1_PROVIDER_SPECS.gemini,
    async editImage(imageBuffer, prompt) {
      try {
        const result = await client.editImage(imageBuffer, prompt, {
          model: ROUND1_MODELS.gemini,
        });
        return normalizeImage(result.imageBuffer);
      } catch (error) {
        if (error instanceof GeminiNoImageError) {
          return {
            status: "unsuccessful",
            reason: error.policyReason ? "policy" : "no_image",
          };
        }
        return normalizeFailure(error);
      }
    },
  };
}

export function requireRound1ProviderKeys(
  keys: ComparisonProviderKeys,
): Round1ProviderKeys {
  const missing = [
    ["GOOGLE_API_KEY or GEMINI_API_KEY", keys.googleApiKey],
    ["OPENAI_API_KEY", keys.openaiApiKey],
    ["XAI_API_KEY", keys.xaiApiKey],
  ].filter((entry): entry is [string, undefined] => !entry[1])
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing comparison API keys: ${missing.join(", ")}`);
  }

  return keys as Round1ProviderKeys;
}

export function createRound1Providers(
  keys: ComparisonProviderKeys,
  dependencies: Round1ProviderDependencies = {},
): ComparisonProvider[] {
  const required = requireRound1ProviderKeys(keys);
  return [
    createGeminiComparisonProvider(required.googleApiKey, {
      client: dependencies.geminiClient,
      createGeminiClient: dependencies.createGeminiClient,
      timeoutMs: dependencies.geminiTimeoutMs,
    }),
    createOpenAIComparisonProvider(required.openaiApiKey, dependencies),
    createXaiComparisonProvider(required.xaiApiKey, dependencies),
  ];
}
