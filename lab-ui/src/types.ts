// Frontend type definitions — mirrors server-side types for API communication

export interface SerializedScenario {
  timestampLocal: string;
  hour: number;
  isDay: boolean;
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
  sunrise?: string;
  sunset?: string;
}

export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface RenderMetadata {
  id: string;
  artworkSource: string;
  scenario: SerializedScenario;
  prompt: string;
  model: string;
  createdAt: string;
  outputPath: string;
  responseText?: string;
  seed?: number;
  responseId?: string;
  modelVersion?: string;
  usageMetadata?: UsageMetadata;
  finishReason?: string;
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
}

export interface HistoryResult {
  renders: Array<RenderMetadata & { imageUrl: string }>;
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
