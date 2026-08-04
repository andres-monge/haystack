// src/engine/scenario.ts — Scenario builder for time/weather context

import type { Scenario, SolarPhase } from "./types.js";

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
  const solarTarget = getSolarVisualTarget(scenario);
  const parts: string[] = [
    getTimeOfDayDescription(scenario.hour, scenario.isDay, scenario.minute),
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
  // Computed: direct_fraction — how "sunny" vs "overcast" the light is (0–1)
  if (scenario.directRadiation !== undefined && scenario.diffuseRadiation !== undefined) {
    const total = scenario.directRadiation + scenario.diffuseRadiation;
    if (total > 0) {
      const directFraction = Math.round((scenario.directRadiation / total) * 100) / 100;
      parts.push(`direct_fraction ${directFraction}`);
    }
  }
  if (scenario.sunElevation !== undefined) {
    parts.push(`sun elevation ${scenario.sunElevation}°`);
    // Computed: shadow_ratio — shadow length as multiple of object height
    if (scenario.sunElevation > 0) {
      const radians = scenario.sunElevation * (Math.PI / 180);
      const shadowRatio = Math.min(Math.round((1 / Math.tan(radians)) * 10) / 10, 50);
      parts.push(`shadow_ratio ${shadowRatio}×`);
    }
  }
  if (scenario.sunAzimuth !== undefined) {
    parts.push(`sun azimuth ${scenario.sunAzimuth}°`);
  }
  const moonCanBeSeen = (
    (scenario.moonAltitude === undefined || scenario.moonAltitude > 0)
    && (scenario.moonFraction === undefined || scenario.moonFraction > 0.02)
  );
  if (scenario.moonFraction !== undefined && !scenario.isDay && moonCanBeSeen) {
    parts.push(`moon ${Math.round(scenario.moonFraction * 100)}% illuminated`);
  }
  if (scenario.moonAltitude !== undefined && !scenario.isDay && moonCanBeSeen) {
    parts.push(`moon altitude ${scenario.moonAltitude}°`);
  }

  const measuredConditions = parts.join(", ");
  return solarTarget
    ? `Solar visual target: ${solarTarget}\nMeasured conditions: ${measuredConditions}`
    : measuredConditions;
}

/** Derive a physically meaningful solar phase from elevation, not clock time. */
export function getSolarPhase(sunElevation: number): SolarPhase {
  if (sunElevation > 6) return "daylight";
  if (sunElevation > 0) return "golden-hour";
  if (sunElevation > -6) return "civil-twilight";
  if (sunElevation > -12) return "nautical-twilight";
  if (sunElevation > -18) return "astronomical-twilight";
  return "night";
}

/**
 * Describe the intended visible result in concrete, positive language.
 * Gemini's image guide recommends specific scene descriptions and semantic
 * negatives over relying on terse labels or lists of prohibitions.
 */
function getSolarVisualTarget(scenario: Scenario): string | undefined {
  if (scenario.sunElevation === undefined) return undefined;

  const phase = scenario.solarPhase ?? getSolarPhase(scenario.sunElevation);
  const setting = scenario.solarTrend !== "rising";
  const moonless = (
    (scenario.moonAltitude !== undefined && scenario.moonAltitude <= 0)
    || (scenario.moonFraction !== undefined && scenario.moonFraction <= 0.02)
  );
  const brightSkyEnding = moonless
    ? " The visible sky is moonless and starless."
    : "";
  const twilightSkyEnding = moonless ? " The visible sky is moonless." : "";
  const darkSkyEnding = moonless
    ? " The dark sky is moonless, with stars providing only faint natural light."
    : "";
  const eventTiming = getRelevantSolarEventTiming(scenario);

  switch (phase) {
    case "daylight":
      return setting
        ? `bright late-afternoon daylight.${eventTiming} Render a luminous daylight-blue sky and keep the landscape, foliage, and buildings fully visible in natural daylight.${brightSkyEnding}`
        : `bright morning daylight.${eventTiming} Render a luminous daylight-blue sky and keep the landscape, foliage, and buildings fully visible in natural daylight.${brightSkyEnding}`;
    case "golden-hour":
      return setting
        ? `warm golden-hour daylight with the sun still above the horizon.${eventTiming} Render long warm shadows and a blue upper sky grading toward warm color near the horizon.${brightSkyEnding}`
        : `warm early-morning daylight with the sun just above the horizon.${eventTiming} Render long warm shadows and a blue upper sky grading from dawn color near the horizon.${brightSkyEnding}`;
    case "civil-twilight":
      return setting
        ? `soft civil twilight just after sunset.${eventTiming} Render a blue upper sky with a warm residual horizon glow and keep the landscape clearly readable in soft ambient light.${twilightSkyEnding}`
        : `soft civil twilight before sunrise.${eventTiming} Render a blue upper sky with a warm developing horizon glow and keep the landscape clearly readable in soft ambient light.${twilightSkyEnding}`;
    case "nautical-twilight":
      return setting
        ? `deep blue nautical twilight after dusk. Render a darkening blue sky with a faint horizon glow and subdued landscape detail.${darkSkyEnding}`
        : `deep blue nautical twilight before dawn. Render a dark blue sky with the first faint horizon glow and subdued landscape detail.${darkSkyEnding}`;
    case "astronomical-twilight":
      return setting
        ? `very dark astronomical twilight. Render a nearly black-blue sky and low ambient illumination.${darkSkyEnding}`
        : `very dark astronomical twilight before dawn. Render a nearly black-blue sky with the earliest trace of ambient illumination.${darkSkyEnding}`;
    case "night":
      return moonless
        ? `full night. Render a moonless, starry dark sky and illuminate the scene only with faint starlight and practical light sources.`
        : `full night. Render a dark sky and illuminate the scene only with visible moonlight and practical light sources.`;
  }
}

function getRelevantSolarEventTiming(scenario: Scenario): string {
  if (scenario.solarTrend === "setting" && scenario.sunset) {
    const minutes = Math.round(
      (scenario.sunset.getTime() - scenario.timestampLocal.getTime()) / 60_000,
    );
    if (minutes > 0 && minutes <= 180) {
      return ` Sunset is about ${minutes} minutes away.`;
    }
    if (minutes <= 0 && minutes >= -180) {
      return ` Sunset was about ${Math.abs(minutes)} minutes ago.`;
    }
  }

  if (scenario.solarTrend === "rising" && scenario.sunrise) {
    const minutes = Math.round(
      (scenario.sunrise.getTime() - scenario.timestampLocal.getTime()) / 60_000,
    );
    if (minutes > 0 && minutes <= 180) {
      return ` Sunrise is about ${minutes} minutes away.`;
    }
    if (minutes <= 0 && minutes >= -180) {
      return ` Sunrise was about ${Math.abs(minutes)} minutes ago.`;
    }
  }

  return "";
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function getTimeOfDayDescription(
  hour: number,
  isDay: boolean,
  minute?: number,
): string {
  const formattedHour = formatHour(hour);
  const formattedTime = minute
    ? formattedHour.replace(/ (AM|PM)$/, `:${String(minute).padStart(2, "0")} $1`)
    : formattedHour;
  return `${formattedTime}, ${isDay ? "day" : "night"}`;
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
