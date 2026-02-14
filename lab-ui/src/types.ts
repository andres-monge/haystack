// Frontend type definitions — mirrors server-side types for API communication

export interface SerializedScenario {
  timestampLocal: string;
  hour: number;
  isDay: boolean;
  weatherCode?: number;
  cloudPercent?: number;
  precipPercent?: number;
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

export interface WeatherResult {
  current: CurrentConditions;
  hourly: HourlyConditions[];
}

export interface LocationSearchResult {
  locations: Location[];
}
