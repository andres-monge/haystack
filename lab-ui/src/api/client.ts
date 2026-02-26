// Typed fetch wrappers for all API endpoints

import type {
  GenerateResult,
  HistoryResult,
  LocationSearchResult,
  OverrideResult,
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

export async function getDefaultTemplate(): Promise<string> {
  const res = await fetch("/api/config/default-template");
  if (!res.ok) throw new Error("Failed to fetch default template");
  const data: { template: string } = await res.json();
  return data.template;
}

export async function postOverride(scenario: string): Promise<OverrideResult> {
  const res = await fetch("/api/override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  if (!res.ok) {
    const err: { error?: string } = await res.json().catch(() => ({ error: "Override failed" }));
    throw new Error(err.error ?? "Override failed");
  }
  return res.json();
}

export async function getScenarioPreview(params: {
  hour: number;
  isDay: boolean;
  lat?: number;
  lon?: number;
  timezone?: string;
  weather?: Record<string, unknown>;
}): Promise<string> {
  const res = await fetch("/api/scenario-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Scenario preview failed");
  const data: { description: string } = await res.json();
  return data.description;
}

export async function getSchedulerStatus(): Promise<{ running: boolean }> {
  const res = await fetch("/api/scheduler/status");
  if (!res.ok) throw new Error("Failed to fetch scheduler status");
  return res.json();
}

export async function pauseScheduler(): Promise<{ running: boolean }> {
  const res = await fetch("/api/scheduler/pause", { method: "POST" });
  if (!res.ok) throw new Error("Failed to pause scheduler");
  return res.json();
}

export async function resumeScheduler(): Promise<{ running: boolean }> {
  const res = await fetch("/api/scheduler/resume", { method: "POST" });
  if (!res.ok) throw new Error("Failed to resume scheduler");
  return res.json();
}
