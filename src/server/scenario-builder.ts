// src/server/scenario-builder.ts — Shared scenario builder for routes and scheduler

import SunCalc from "suncalc";
import type { Scenario } from "../engine/types.js";
import type { WeatherProvider } from "../weather/types.js";
import { createScenarioFromHour } from "../engine/scenario.js";

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
  const now = new Date();
  const hourStr = now.toLocaleString("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: timezone,
  });
  const hour = parseInt(hourStr, 10);

  const scenario = createScenarioFromHour(hour);
  await enrichWithWeather(scenario, hour, lat, lon, timezone, weatherProvider);
  computeSunMoon(scenario, hour, lat, lon, timezone);

  return scenario;
}

/**
 * Fetch hourly weather and apply the matching slot to the scenario.
 */
async function enrichWithWeather(
  scenario: Scenario,
  hour: number,
  lat: number,
  lon: number,
  timezone: string,
  weatherProvider: WeatherProvider,
): Promise<void> {
  try {
    const hourly = await weatherProvider.getHourlyConditions(
      lat,
      lon,
      timezone,
    );

    // Find the slot matching the requested hour
    const slot = hourly.find((h) => {
      const slotHour = parseInt(h.time.split("T")[1].split(":")[0], 10);
      return slotHour === hour;
    });

    if (slot) {
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
  } catch (err) {
    // Weather fetch failed — fall back to time-only scenario
    console.error(
      `[${new Date().toISOString()}] Weather fetch failed, using time-only scenario: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/**
 * Compute sun/moon position and apply to the scenario.
 */
function computeSunMoon(
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
