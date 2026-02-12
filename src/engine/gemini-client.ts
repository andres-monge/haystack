// src/engine/gemini-client.ts — Gemini API wrapper for image editing

import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import type { GeminiConfig } from "./types.js";

export interface EditImageResult {
  imageBuffer: Buffer;
  responseText?: string;
  responseId?: string;
  modelVersion?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  finishReason?: string;
}

export const DEFAULT_GEMINI_CONFIG: GeminiConfig = {
  model: "gemini-2.5-flash-image",
  // aspectRatio intentionally omitted — API will match input image's ratio
};

export class GeminiClient {
  private client: GoogleGenAI;

  constructor(apiKey?: string) {
    // Only pass apiKey when explicitly provided, so the SDK can fall back
    // to GOOGLE_API_KEY / GEMINI_API_KEY from environment automatically.
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : new GoogleGenAI({});
  }

  /**
   * Edit an image based on a text prompt.
   */
  async editImage(
    imageInput: Buffer | string,
    prompt: string,
    config: GeminiConfig = DEFAULT_GEMINI_CONFIG,
  ): Promise<EditImageResult> {
    const imageBuffer =
      typeof imageInput === "string" ? fs.readFileSync(imageInput) : imageInput;

    const base64Image = imageBuffer.toString("base64");
    const mimeType = this.detectMimeType(imageBuffer);

    // Build imageConfig only with fields that are set
    const imageConfig: Record<string, unknown> = {};
    if (config.aspectRatio) {
      imageConfig.aspectRatio = config.aspectRatio;
    }
    if (config.imageSize && config.model.includes("pro")) {
      imageConfig.imageSize = config.imageSize;
    }

    const response = await this.client.models.generateContent({
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

    let resultBuffer: Buffer | null = null;
    let resultText: string | undefined;

    const candidate = response.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.text) {
        resultText = part.text;
      } else if (part.inlineData) {
        resultBuffer = Buffer.from(part.inlineData.data!, "base64");
      }
    }

    if (!resultBuffer) {
      throw new Error("Gemini did not return an image");
    }

    return {
      imageBuffer: resultBuffer,
      responseText: resultText,
      responseId: (response as unknown as Record<string, unknown>)
        .responseId as string | undefined,
      modelVersion: (response as unknown as Record<string, unknown>)
        .modelVersion as string | undefined,
      usageMetadata: response.usageMetadata as
        | EditImageResult["usageMetadata"]
        | undefined,
      finishReason: candidate?.finishReason as string | undefined,
    };
  }

  private detectMimeType(buffer: Buffer): string {
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
