// src/engine/types.ts — Shared type definitions for the Haystack engine

export type WeatherSource = "live" | "cache" | "none";

export interface Scenario {
  timestampLocal: Date;
  hour: number; // 0-23
  isDay: boolean;

  // Weather source tracking
  weatherSource?: WeatherSource;

  // Weather (optional — populated from weather provider)
  weatherCode?: number;
  cloudPercent?: number;
  precipProbability?: number;
  temperature?: number; // Celsius
  humidity?: number; // 0-100 %
  windSpeed?: number; // km/h
  windGusts?: number; // km/h
  visibility?: number; // meters
  precipitation?: number; // mm (preceding hour sum)
  rain?: number; // mm (preceding hour sum)
  snowfall?: number; // cm (preceding hour sum)
  snowDepth?: number; // meters
  directRadiation?: number; // W/m² (preceding hour mean)
  diffuseRadiation?: number; // W/m² (preceding hour mean)

  // Sun/moon position (optional — computed via suncalc)
  sunElevation?: number; // degrees (negative = below horizon)
  sunAzimuth?: number; // degrees
  moonFraction?: number; // 0-1 illuminated fraction
  moonAltitude?: number; // degrees

  // Sun times (optional)
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
  weatherSource?: WeatherSource;
  weatherCode?: number;
  cloudPercent?: number;
  precipProbability?: number;
  temperature?: number;
  humidity?: number;
  windSpeed?: number;
  windGusts?: number;
  visibility?: number;
  precipitation?: number;
  rain?: number;
  snowfall?: number;
  snowDepth?: number;
  directRadiation?: number;
  diffuseRadiation?: number;
  sunElevation?: number;
  sunAzimuth?: number;
  moonFraction?: number;
  moonAltitude?: number;
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
  model: "gemini-2.5-flash-image" | "gemini-3-pro-image-preview" | "gemini-3.1-flash-image-preview";
  /** Optional — omit to let the API match the input image's aspect ratio. */
  aspectRatio?: AspectRatio;
  imageSize?: "512" | "1K" | "2K" | "4K"; // Supported by 3.1 Flash and Pro (512 is 3.1 Flash only)
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
