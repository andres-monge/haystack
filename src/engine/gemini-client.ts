// src/engine/gemini-client.ts — Gemini API wrapper for image editing

import {
  GoogleGenAI,
  PartMediaResolutionLevel,
  ThinkingLevel,
} from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";
import type { GeminiConfig, UsageMetadata } from "./types.js";
import type {
  ImageEditStage,
  ImageProviderAdapter,
  ProviderEditFailure,
  ProviderEditInput,
  ProviderEditResult,
} from "./provider-types.js";
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  normalizeProviderFailure,
} from "./provider-types.js";
import {
  ImageValidationError,
  validateImageOutput,
} from "./image-validation.js";

type SupportedMimeType = "image/png" | "image/jpeg" | "image/webp";

/** Result returned from a Gemini image editing call. */
export interface EditImageResult {
  imageBuffer: Buffer;
  responseText?: string;
  responseId?: string;
  modelVersion?: string;
  usageMetadata?: UsageMetadata;
  finishReason?: string;
}

/** Interface for image editing clients, enabling DI and future provider swapping. */
export interface ImageEditClient {
  editImage(
    imageInput: Buffer | string,
    prompt: string,
    config?: GeminiConfig,
  ): Promise<EditImageResult>;
}

/** Default Gemini configuration — uses the fast flash model with no aspect ratio override. */
export const DEFAULT_GEMINI_CONFIG: GeminiConfig = {
  model: "gemini-3.1-flash-lite-image",
  // aspectRatio intentionally omitted — API will match input image's ratio
};

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB
const API_TIMEOUT_MS = 60_000; // 60 seconds

export interface GeminiClientOptions {
  /** Per-request deadline. Direct legacy callers retain the 60-second default. */
  timeoutMs?: number;
}

const GEMINI_POLICY_REASONS = new Set([
  "SAFETY",
  "IMAGE_SAFETY",
  "PROHIBITED_CONTENT",
  "IMAGE_PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "MODEL_ARMOR",
  "JAILBREAK",
]);

function policyReason(
  finishReason?: string,
  blockReason?: string,
): string | undefined {
  return [finishReason, blockReason].find(
    reason => reason !== undefined && GEMINI_POLICY_REASONS.has(reason),
  );
}

function isGeminiTransportTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const name = error.name.toLowerCase();
  const code = "code" in error && typeof error.code === "string"
    ? error.code.toLowerCase()
    : undefined;
  return ["aborterror", "timeouterror", "apiconnectiontimeouterror"].includes(name)
    || ["etimedout", "deadline_exceeded"].includes(code ?? "");
}

export class GeminiNoImageError extends Error {
  public readonly policyReason: string | undefined;

  constructor(
    public readonly finishReason?: string,
    _responseText?: string,
    public readonly blockReason?: string,
  ) {
    const reasons = [
      finishReason ? `finishReason: ${finishReason}` : undefined,
      blockReason ? `blockReason: ${blockReason}` : undefined,
    ].filter((reason): reason is string => reason !== undefined);
    const detail = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";
    super(`Gemini did not return an image${detail}`);
    this.name = "GeminiNoImageError";
    this.policyReason = policyReason(finishReason, blockReason);
  }
}

/** Stable signal for an SDK transport deadline expiring. */
export class GeminiTimeoutError extends Error {
  public readonly code = "GEMINI_TIMEOUT";

  constructor() {
    super("Gemini API call timed out");
    this.name = "GeminiTimeoutError";
  }
}

/** Wraps the @google/genai SDK for image editing operations. */
export class GeminiClient implements ImageEditClient {
  private client: GoogleGenAI;

  constructor(apiKey?: string, options: GeminiClientOptions = {}) {
    const httpOptions = {
      apiVersion: "v1beta",
      timeout: options.timeoutMs ?? API_TIMEOUT_MS,
      retryOptions: { attempts: 1 },
    };
    // Only pass apiKey when explicitly provided, so the SDK can fall back
    // to GOOGLE_API_KEY / GEMINI_API_KEY from environment automatically.
    this.client = apiKey
      ? new GoogleGenAI({ apiKey, httpOptions })
      : new GoogleGenAI({ httpOptions });
  }

  /**
   * Edit an image based on a text prompt.
   */
  async editImage(
    imageInput: Buffer | string,
    prompt: string,
    config: GeminiConfig = DEFAULT_GEMINI_CONFIG,
  ): Promise<EditImageResult> {
    let imageBuffer: Buffer;

    if (typeof imageInput === "string") {
      const resolved = path.resolve(imageInput);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Image file not found: ${resolved}`);
      }
      imageBuffer = await fs.promises.readFile(resolved);
    } else {
      imageBuffer = imageInput;
    }

    if (imageBuffer.length < 12) {
      throw new Error("Input is too small to be a valid image file");
    }
    if (imageBuffer.length > MAX_IMAGE_SIZE) {
      throw new Error(
        `Image exceeds maximum size of ${MAX_IMAGE_SIZE / (1024 * 1024)} MB`,
      );
    }

    const base64Image = imageBuffer.toString("base64");
    const mimeType = this.detectMimeType(imageBuffer);

    // Build imageConfig only with fields that are set
    const imageConfig: { aspectRatio?: string; imageSize?: string } = {};
    if (config.aspectRatio) {
      imageConfig.aspectRatio = config.aspectRatio;
    }
    if (config.imageSize) {
      imageConfig.imageSize = config.imageSize;
    }

    const imagePart = {
      inlineData: {
        mimeType,
        data: base64Image,
      },
      ...(config.inputMediaResolution === "ultra_high"
        ? {
            mediaResolution: {
              level: PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH,
            },
          }
        : {}),
    };

    const apiPromise = this.client.models.generateContent({
      model: config.model,
      contents: [
        { text: prompt },
        imagePart,
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        ...(Object.keys(imageConfig).length > 0
          ? { imageConfig }
          : {}),
        ...(config.seed !== undefined ? { seed: config.seed } : {}),
        ...(config.abortSignal ? { abortSignal: config.abortSignal } : {}),
        ...(config.thinkingLevel === "high"
          ? {
              thinkingConfig: {
                thinkingLevel: ThinkingLevel.HIGH,
              },
            }
          : {}),
      },
    });

    let response: Awaited<typeof apiPromise>;
    try {
      response = await apiPromise;
    } catch (error) {
      if (isGeminiTransportTimeout(error)) {
        throw new GeminiTimeoutError();
      }
      throw error;
    }

    let resultBuffer: Buffer | null = null;
    let resultText: string | undefined;

    const candidate = response.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.thought) continue;
      if (part.text) {
        resultText = part.text;
      } else if (part.inlineData?.data) {
        resultBuffer = Buffer.from(part.inlineData.data, "base64");
      }
    }

    if (!resultBuffer) {
      throw new GeminiNoImageError(
        candidate?.finishReason as string | undefined,
        resultText,
        response.promptFeedback?.blockReason as string | undefined,
      );
    }

    return {
      imageBuffer: resultBuffer,
      responseText: resultText,
      responseId: response.responseId,
      modelVersion: response.modelVersion,
      usageMetadata: response.usageMetadata
        ? {
            promptTokenCount: response.usageMetadata.promptTokenCount,
            candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
            totalTokenCount: response.usageMetadata.totalTokenCount,
          }
        : undefined,
      finishReason: candidate?.finishReason as string | undefined,
    };
  }

  private detectMimeType(buffer: Buffer): SupportedMimeType {
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
    // JPEG: FF D8
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
    // WebP: RIFF....WEBP
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return "image/webp";
    }
    return "image/png"; // Default fallback
  }
}

export const DEFAULT_GEMINI_PROVIDER_MODELS = {
  normal: "gemini-3.1-flash-lite-image",
  "extend-cleanup": "gemini-3.1-flash-image",
  "extend-outpaint": "gemini-3.1-flash-image",
} as const;

export interface GeminiImageProviderOptions {
  client?: Pick<GeminiClient, "editImage">;
  timeoutMs?: number;
  models?: Partial<Record<ImageEditStage, GeminiConfig["model"]>>;
}

const SAFE_GEMINI_NO_IMAGE_CODES = new Set([
  "NO_IMAGE",
  "RECITATION",
  "IMAGE_RECITATION",
  "OTHER",
  "IMAGE_OTHER",
]);

function geminiImageFailure(
  model: string,
  error: ImageValidationError,
): ProviderEditFailure {
  return {
    outcome: "invalid_image",
    provider: "gemini",
    requestedModel: model,
    safeCode: error.code,
  };
}

/** Production Gemini adapter with the quality profile proven by the bake-off. */
export class GeminiImageProvider implements ImageProviderAdapter {
  readonly provider = "gemini" as const;
  readonly model: string;
  private readonly client: Pick<GeminiClient, "editImage">;
  private readonly models: Record<ImageEditStage, GeminiConfig["model"]>;

  constructor(apiKey: string, options: GeminiImageProviderOptions = {}) {
    this.models = {
      normal: options.models?.normal ?? DEFAULT_GEMINI_PROVIDER_MODELS.normal,
      "extend-cleanup": options.models?.["extend-cleanup"]
        ?? DEFAULT_GEMINI_PROVIDER_MODELS["extend-cleanup"],
      "extend-outpaint": options.models?.["extend-outpaint"]
        ?? DEFAULT_GEMINI_PROVIDER_MODELS["extend-outpaint"],
    };
    this.model = this.models.normal;
    this.client = options.client
      ?? new GeminiClient(apiKey, {
        timeoutMs: options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
      });
  }

  async editImage(input: ProviderEditInput): Promise<ProviderEditResult> {
    const model = this.models[input.output.stage];
    const aspectRatio = input.output.aspectRatio === "source"
      ? undefined
      : input.output.aspectRatio as GeminiConfig["aspectRatio"];
    if (input.abort?.signal.aborted) {
      return normalizeProviderFailure("gemini", model, undefined, {
        abort: input.abort,
      });
    }

    try {
      const result = await this.client.editImage(input.source.bytes, input.prompt, {
        model,
        ...(aspectRatio ? { aspectRatio } : {}),
        imageSize: input.output.stage === "normal" ? "1K" : "2K",
        thinkingLevel: "high",
        inputMediaResolution: "ultra_high",
        ...(input.abort ? { abortSignal: input.abort.signal } : {}),
      });
      try {
        const image = await validateImageOutput(
          result.imageBuffer,
          input.source,
          input.output,
        );
        return {
          outcome: "successful",
          provider: "gemini",
          requestedModel: model,
          resolvedModel: result.modelVersion,
          image,
          responseText: result.responseText,
          requestId: result.responseId,
          usage: result.usageMetadata
            ? {
                inputTokens: result.usageMetadata.promptTokenCount,
                outputTokens: result.usageMetadata.candidatesTokenCount,
                totalTokens: result.usageMetadata.totalTokenCount,
              }
            : undefined,
          finishReason: result.finishReason,
        };
      } catch (error) {
        if (error instanceof ImageValidationError) {
          return geminiImageFailure(model, error);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof GeminiNoImageError) {
        if (error.policyReason) {
          return {
            outcome: "refusal",
            provider: "gemini",
            requestedModel: model,
            safeCode: error.policyReason,
          };
        }
        return {
          outcome: "no_image",
          provider: "gemini",
          requestedModel: model,
          safeCode: error.finishReason
            && SAFE_GEMINI_NO_IMAGE_CODES.has(error.finishReason)
            ? error.finishReason
            : undefined,
        };
      }
      return normalizeProviderFailure("gemini", model, error, {
        abort: input.abort,
      });
    }
  }
}
