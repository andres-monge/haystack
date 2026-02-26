// src/server/scenario-builder.ts — Shared scenario builder for routes and scheduler

import SunCalc from "suncalc";
import type { Scenario, WeatherSource } from "../engine/types.js";
import type { WeatherProvider, HourlyConditions } from "../weather/types.js";
import { createScenarioFromHour } from "../engine/scenario.js";
import { getCurrentHourInTimezone } from "./timezone.js";

/** In-memory cache of last successful weather response, keyed by "lat,lon". */
interface WeatherCacheEntry {
  hourly: HourlyConditions[];
  fetchedAt: number; // Date.now() timestamp
}

const weatherCache = new Map<string, WeatherCacheEntry>();

/** Max age before cached weather is considered too stale (3 hours). */
const CACHE_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** Clear the weather cache (for testing). */
export function clearWeatherCache(): void {
  weatherCache.clear();
}

/**
 * Retry an async function with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  baseDelayMs: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Build a Scenario from an hour + location, fetching weather and computing
 * sun/moon positions. Used by both the /api/generate route and the scheduler.
 *
 * Priority:
 * 1. If explicit weather overrides provided (weatherCode, etc.) → use those
 * 2. If lat/lon/timezone provided → fetch from weather provider for the given hour
 * 3. Otherwise → time-only scenario
 */
export async function buildScenario(
  hour: number,
  body: Record<string, string | undefined>,
  weatherProvider: WeatherProvider,
): Promise<Scenario> {
  const scenario = createScenarioFromHour(
    hour,
    body.isDay !== undefined ? body.isDay === "true" : undefined,
  );

  const hasExplicitWeather =
    body.weatherCode !== undefined ||
    body.cloudPercent !== undefined ||
    body.precipProbability !== undefined;

  if (hasExplicitWeather) {
    // Use explicit overrides, ignoring non-numeric values
    if (body.weatherCode !== undefined) {
      const val = parseInt(body.weatherCode, 10);
      if (!isNaN(val)) scenario.weatherCode = val;
    }
    if (body.cloudPercent !== undefined) {
      const val = parseInt(body.cloudPercent, 10);
      if (!isNaN(val)) scenario.cloudPercent = val;
    }
    if (body.precipProbability !== undefined) {
      const val = parseInt(body.precipProbability, 10);
      if (!isNaN(val)) scenario.precipProbability = val;
    }
    return scenario;
  }

  const lat = body.lat ? parseFloat(body.lat) : undefined;
  const lon = body.lon ? parseFloat(body.lon) : undefined;
  const timezone = body.timezone;

  if (lat !== undefined && lon !== undefined && timezone) {
    await enrichWithWeather(scenario, hour, lat, lon, timezone, weatherProvider);
    computeSunMoon(scenario, hour, lat, lon, timezone);
  }

  return scenario;
}

/**
 * Build a scenario for the scheduler: fetches weather and computes sun/moon
 * for the current hour at the configured location.
 */
export async function buildScheduledScenario(
  lat: number,
  lon: number,
  timezone: string,
  weatherProvider: WeatherProvider,
): Promise<Scenario> {
  // Get the current hour in the configured timezone
  const hour = getCurrentHourInTimezone(timezone);

  const scenario = createScenarioFromHour(hour);
  await enrichWithWeather(scenario, hour, lat, lon, timezone, weatherProvider);
  computeSunMoon(scenario, hour, lat, lon, timezone);

  return scenario;
}

/**
 * Apply weather data from an hourly slot to the scenario.
 */
function applyWeatherSlot(scenario: Scenario, slot: HourlyConditions): void {
  scenario.weatherCode = slot.weatherCode;
  scenario.cloudPercent = slot.cloudPercent;
  scenario.precipProbability = slot.precipProbability;
  scenario.isDay = slot.isDay;
  scenario.temperature = slot.temperature;
  scenario.humidity = slot.humidity;
  scenario.windSpeed = slot.windSpeed;
  scenario.windGusts = slot.windGusts;
  scenario.visibility = slot.visibility;
  scenario.precipitation = slot.precipitation;
  scenario.rain = slot.rain;
  scenario.snowfall = slot.snowfall;
  scenario.snowDepth = slot.snowDepth;
  scenario.directRadiation = slot.directRadiation;
  scenario.diffuseRadiation = slot.diffuseRadiation;
}

/**
 * Find the hourly slot matching the requested hour.
 */
function findSlot(hourly: HourlyConditions[], hour: number): HourlyConditions | undefined {
  return hourly.find((h) => {
    const slotHour = parseInt(h.time.split("T")[1].split(":")[0], 10);
    return slotHour === hour;
  });
}

/**
 * Fetch hourly weather (with retry + cache fallback) and apply to the scenario.
 */
async function enrichWithWeather(
  scenario: Scenario,
  hour: number,
  lat: number,
  lon: number,
  timezone: string,
  weatherProvider: WeatherProvider,
): Promise<void> {
  const cacheKey = `${lat},${lon}`;
  let hourly: HourlyConditions[];
  let source: WeatherSource = "none";

  try {
    hourly = await withRetry(
      () => weatherProvider.getHourlyConditions(lat, lon, timezone),
      3,    // 3 attempts total
      1000, // 1s, 2s exponential backoff
    );
    source = "live";

    // Update cache on success
    weatherCache.set(cacheKey, { hourly, fetchedAt: Date.now() });
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Weather fetch failed after retries: ${err instanceof Error ? err.message : err}`,
    );

    // Try cache fallback
    const cached = weatherCache.get(cacheKey);
    if (cached && (Date.now() - cached.fetchedAt) <= CACHE_MAX_AGE_MS) {
      hourly = cached.hourly;
      source = "cache";
      const ageMin = Math.round((Date.now() - cached.fetchedAt) / 60_000);
      console.warn(
        `[${new Date().toISOString()}] Using cached weather data (${ageMin} min old)`,
      );
    } else {
      scenario.weatherSource = "none";
      return;
    }
  }

  const slot = findSlot(hourly!, hour);

  if (slot) {
    applyWeatherSlot(scenario, slot);
    scenario.weatherSource = source;
  } else {
    const availableHours = hourly!.map((h) =>
      parseInt(h.time.split("T")[1].split(":")[0], 10),
    );
    console.warn(
      `[${new Date().toISOString()}] Weather slot miss: wanted hour ${hour}, ` +
      `available: [${availableHours.join(", ")}] (timezone: ${timezone})`,
    );
    scenario.weatherSource = "none";
  }
}

/**
 * Compute sun/moon position and apply to the scenario.
 */
export function computeSunMoon(
  scenario: Scenario,
  hour: number,
  lat: number,
  lon: number,
  timezone: string,
): void {
  const dateForHour = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: timezone }) +
      `T${String(hour).padStart(2, "0")}:00:00`,
  );
  const sunPos = SunCalc.getPosition(dateForHour, lat, lon);
  scenario.sunElevation =
    Math.round(sunPos.altitude * (180 / Math.PI) * 10) / 10;
  scenario.sunAzimuth =
    Math.round(((sunPos.azimuth * (180 / Math.PI)) + 180) * 10) / 10;

  const moonIllum = SunCalc.getMoonIllumination(dateForHour);
  scenario.moonFraction = Math.round(moonIllum.fraction * 100) / 100;

  const moonPos = SunCalc.getMoonPosition(dateForHour, lat, lon);
  scenario.moonAltitude =
    Math.round(moonPos.altitude * (180 / Math.PI) * 10) / 10;
}
