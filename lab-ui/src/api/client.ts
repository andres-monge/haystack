// Typed fetch wrappers for all API endpoints

import type {
  GenerateResult,
  HistoryResult,
  LocationSearchResult,
  WeatherResult,
} from "../types";

export async function generate(params: {
  image: File;
  hour?: number;
  weatherCode?: number;
  cloudPercent?: number;
  precipProbability?: number;
  isDay?: boolean;
  promptOverride?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
}): Promise<GenerateResult> {
  const form = new FormData();
  form.append("image", params.image);

  if (params.hour !== undefined) form.append("hour", String(params.hour));
  if (params.weatherCode !== undefined)
    form.append("weatherCode", String(params.weatherCode));
  if (params.cloudPercent !== undefined)
    form.append("cloudPercent", String(params.cloudPercent));
  if (params.precipProbability !== undefined)
    form.append("precipProbability", String(params.precipProbability));
  if (params.isDay !== undefined) form.append("isDay", String(params.isDay));
  if (params.promptOverride !== undefined)
    form.append("promptOverride", params.promptOverride);
  if (params.lat !== undefined) form.append("lat", String(params.lat));
  if (params.lon !== undefined) form.append("lon", String(params.lon));
  if (params.timezone !== undefined) form.append("timezone", params.timezone);

  const res = await fetch("/api/generate", { method: "POST", body: form });
  if (!res.ok) {
    const err: { error?: string } = await res.json().catch(() => ({ error: "Generation failed" }));
    throw new Error(err.error ?? "Generation failed");
  }
  return res.json();
}

export async function getHistory(limit?: number): Promise<HistoryResult> {
  const url = limit ? `/api/history?limit=${limit}` : "/api/history";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

export async function searchLocations(
  query: string,
): Promise<LocationSearchResult> {
  const res = await fetch("/api/location/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error("Location search failed");
  return res.json();
}

export async function getWeather(params: {
  lat: number;
  lon: number;
  timezone: string;
}): Promise<WeatherResult> {
  const url = `/api/weather?lat=${params.lat}&lon=${params.lon}&timezone=${encodeURIComponent(params.timezone)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather fetch failed");
  return res.json();
}
