// src/engine/scenario.ts — Scenario builder for time/weather context

import type { Scenario } from "./types.js";

/**
 * Create a scenario from just an hour (for testing/manual overrides).
 */
export function createScenarioFromHour(
  hour: number,
  isDay?: boolean,
): Scenario {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`Hour must be an integer between 0 and 23, got ${hour}`);
  }

  const autoIsDay = isDay ?? (hour >= 6 && hour <= 20);

  return {
    timestampLocal: new Date(),
    hour,
    isDay: autoIsDay,
  };
}

/**
 * Create a scenario from the current time.
 */
export function createScenarioFromNow(): Scenario {
  const now = new Date();
  const hour = now.getHours();

  return {
    timestampLocal: now,
    hour,
    isDay: hour >= 6 && hour <= 20,
  };
}

/**
 * Generate a human-readable description for prompt composition.
 * When isDay is available (from weather API), it takes priority over
 * hardcoded hour ranges — accounting for latitude and season.
 */
export function describeScenario(scenario: Scenario): string {
  const parts: string[] = [
    getTimeOfDayDescription(scenario.hour, scenario.isDay),
  ];

  if (scenario.weatherCode !== undefined) {
    const desc = WEATHER_MAP[scenario.weatherCode];
    if (desc) parts.push(desc);
  }
  if (scenario.temperature !== undefined) parts.push(`${scenario.temperature}°C`);
  if (scenario.humidity !== undefined) parts.push(`humidity ${scenario.humidity}%`);
  if (scenario.windSpeed !== undefined) parts.push(`wind ${scenario.windSpeed} km/h`);
  if (scenario.visibility !== undefined) parts.push(`visibility ${scenario.visibility}m`);
  if (scenario.precipitation !== undefined && scenario.precipitation > 0) {
    parts.push(`precipitation ${scenario.precipitation}mm/h`);
  }
  if (scenario.snowfall !== undefined && scenario.snowfall > 0) {
    parts.push(`snowfall ${scenario.snowfall}cm/h`);
  }
  if (scenario.snowDepth !== undefined && scenario.snowDepth > 0) {
    parts.push(`snow depth ${scenario.snowDepth}m`);
  }
  if (scenario.directRadiation !== undefined) {
    parts.push(`direct radiation ${scenario.directRadiation} W/m²`);
  }
  if (scenario.diffuseRadiation !== undefined) {
    parts.push(`diffuse radiation ${scenario.diffuseRadiation} W/m²`);
  }
  if (scenario.sunElevation !== undefined) {
    parts.push(`sun elevation ${scenario.sunElevation}°`);
  }
  if (scenario.sunAzimuth !== undefined) {
    parts.push(`sun azimuth ${scenario.sunAzimuth}°`);
  }
  if (scenario.moonFraction !== undefined && !scenario.isDay) {
    parts.push(`moon ${Math.round(scenario.moonFraction * 100)}% illuminated`);
  }
  if (scenario.moonAltitude !== undefined && !scenario.isDay && scenario.moonAltitude > 0) {
    parts.push(`moon altitude ${scenario.moonAltitude}°`);
  }

  return parts.join(", ");
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function getTimeOfDayDescription(hour: number, isDay: boolean): string {
  return `${formatHour(hour)}, ${isDay ? "day" : "night"}`;
}

// WMO weather codes (used by Open-Meteo)
const WEATHER_MAP: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "foggy",
  48: "foggy with frost",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  56: "light freezing drizzle",
  57: "dense freezing drizzle",
  61: "light rain",
  63: "moderate rain",
  65: "heavy rain",
  66: "light freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "moderate snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light rain showers",
  81: "moderate rain showers",
  82: "violent rain showers",
  85: "light snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with light hail",
  99: "thunderstorm with heavy hail",
};
