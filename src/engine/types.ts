// src/engine/types.ts — Shared type definitions for the Haystack engine

export interface Scenario {
  timestampLocal: Date;
  hour: number; // 0-23
  isDay: boolean;

  // Weather (optional, from A5)
  weatherCode?: number;
  cloudPercent?: number;
  precipPercent?: number;

  // Sun position (optional)
  sunrise?: Date;
  sunset?: Date;
}

/**
 * JSON-safe version of Scenario for metadata storage.
 * Dates are serialized as ISO strings so types match reality after JSON round-trips.
 */
export interface SerializedScenario {
  timestampLocal: string; // ISO 8601
  hour: number;
  isDay: boolean;
  weatherCode?: number;
  cloudPercent?: number;
  precipPercent?: number;
  sunrise?: string; // ISO 8601
  sunset?: string; // ISO 8601
}

export type AspectRatio =
  | "1:1"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3"
  | "4:5"
  | "5:4"
  | "21:9";

export interface GeminiConfig {
  model: "gemini-2.5-flash-image" | "gemini-3-pro-image-preview";
  /** Optional — omit to let the API match the input image's aspect ratio. */
  aspectRatio?: AspectRatio;
  imageSize?: "1K" | "2K" | "4K"; // Only for pro model
  /** Optional seed for more reproducible outputs. */
  seed?: number;
}

export interface PromptConfig {
  template: string;
  extraContext?: string;
}

export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface RenderMetadata {
  id: string;
  artworkSource: string;
  scenario: SerializedScenario; // JSON-safe, uses strings not Dates
  prompt: string;
  model: string;
  createdAt: string;
  outputPath: string;
  responseText?: string;
  seed?: number;

  // Observability — captured from the API response
  responseId?: string;
  modelVersion?: string;
  usageMetadata?: UsageMetadata;
  finishReason?: string;
}

export interface GenerateResult {
  metadata: RenderMetadata;
  imagePath: string;
  imageBuffer: Buffer;
}

export interface PipelineConfig {
  outputDir: string;
  maxOutputs: number;
  geminiConfig: GeminiConfig;
  promptConfig: PromptConfig;
}

/**
 * Convert a runtime Scenario (with Date objects) to a JSON-safe SerializedScenario.
 */
export function serializeScenario(scenario: Scenario): SerializedScenario {
  return {
    ...scenario,
    timestampLocal: scenario.timestampLocal.toISOString(),
    sunrise: scenario.sunrise?.toISOString(),
    sunset: scenario.sunset?.toISOString(),
  };
}
