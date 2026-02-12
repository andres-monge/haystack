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
 */
export function describeScenario(scenario: Scenario): string {
  const timeOfDay = getTimeOfDayDescription(scenario.hour);
  const weather = getWeatherDescription(scenario.weatherCode);

  return `${timeOfDay}${weather}`;
}

function getTimeOfDayDescription(hour: number): string {
  if (hour >= 5 && hour < 7) return "early morning, dawn breaking";
  if (hour >= 7 && hour < 12) return "morning, bright daylight";
  if (hour >= 12 && hour < 14) return "midday, sun high overhead";
  if (hour >= 14 && hour < 17) return "afternoon, warm light";
  if (hour >= 17 && hour < 20) return "evening, golden hour, sunset";
  if (hour >= 20 && hour < 22) return "dusk, twilight";
  return "night, darkness, moonlight";
}

// WMO weather codes (used by Open-Meteo)
const WEATHER_MAP: Record<number, string> = {
  0: ", clear sky",
  1: ", mainly clear",
  2: ", partly cloudy",
  3: ", overcast",
  45: ", foggy",
  48: ", foggy with frost",
  51: ", light drizzle",
  61: ", light rain",
  63: ", moderate rain",
  65: ", heavy rain",
  71: ", light snow",
  73: ", moderate snow",
  95: ", thunderstorm",
};

function getWeatherDescription(weatherCode?: number): string {
  if (weatherCode === undefined) return "";
  return WEATHER_MAP[weatherCode] ?? "";
}
