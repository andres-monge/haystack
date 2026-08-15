// src/engine/gemini-client.ts — Gemini API wrapper for image editing

import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";
import type { GeminiConfig, UsageMetadata } from "./types.js";

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
  /** Per-request deadline. Production callers retain the 60-second default. */
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
      timeout: options.timeoutMs ?? API_TIMEOUT_MS,
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

    const apiPromise = this.client.models.generateContent({
      model: config.model,
      contents: [
        { text: prompt },
        {
          inlineData: {
            mimeType,
            data: base64Image,
          },
        },
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        ...(Object.keys(imageConfig).length > 0
          ? { imageConfig }
          : {}),
        ...(config.seed !== undefined ? { seed: config.seed } : {}),
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
