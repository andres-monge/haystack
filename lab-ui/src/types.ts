// Frontend type definitions — mirrors server-side types for API communication

export type WeatherSource = "live" | "cache" | "none";

export interface SerializedScenario {
  timestampLocal: string;
  hour: number;
  minute?: number;
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
  solarPhase?: "daylight" | "golden-hour" | "civil-twilight" | "nautical-twilight" | "astronomical-twilight" | "night";
  solarTrend?: "rising" | "setting";
  moonFraction?: number;
  moonAltitude?: number;
  sunrise?: string;
  sunset?: string;
}

export type ImageProviderId = "gemini" | "openai" | "xai";
export type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/webp";

/** LAN-safe render presentation returned by the server. */
export interface RenderMetadata {
  id: string;
  scenario: SerializedScenario;
  model: string;
  resolvedModel?: string;
  provider?: ImageProviderId;
  mimeType?: SupportedImageMimeType;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface Location {
  name: string;
  country: string;
  lat: number;
  lon: number;
  timezone: string;
  admin1?: string;
}

export interface HourlyConditions {
  time: string;
  weatherCode: number;
  cloudPercent: number;
  precipProbability: number;
  temperature: number;
  isDay: boolean;
  humidity: number;
  windSpeed: number;
  windGusts: number;
  visibility: number;
  precipitation: number;
  rain: number;
  snowfall: number;
  snowDepth: number;
  directRadiation: number;
  diffuseRadiation: number;
}

export interface CurrentConditions extends HourlyConditions {
  sunrise: string;
  sunset: string;
}

export interface GenerateResult {
  metadata: RenderMetadata;
  imageUrl: string;
  downloadUrl: string;
}

export interface HistoryResult {
  renders: Array<RenderMetadata & { imageUrl: string; downloadUrl: string }>;
}

export type OverrideResult = GenerateResult;

export interface WeatherResult {
  current: CurrentConditions;
  hourly: HourlyConditions[];
}

export interface LocationSearchResult {
  locations: Location[];
}

/** A location selected by the user (composed display name from geocoding result). */
export interface SelectedLocation {
  lat: number;
  lon: number;
  timezone: string;
  name: string;
}
