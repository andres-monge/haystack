// Shared time-of-day and weather code descriptions for the Lab UI.
// Mirrors the logic in src/engine/scenario.ts (server-side).

/** WMO weather code descriptions (full form). */
export const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Foggy with frost",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Light rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Light snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with light hail",
  99: "Thunderstorm with heavy hail",
};

/** WMO weather code short labels (for badges/thumbnails). */
export const WMO_SHORT: Record<number, string> = {
  0: "Clear",
  1: "Clear",
  2: "Cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Drizzle",
  53: "Drizzle",
  55: "Drizzle",
  56: "Freezing Drizzle",
  57: "Freezing Drizzle",
  61: "Rain",
  63: "Rain",
  65: "Rain",
  66: "Freezing Rain",
  67: "Freezing Rain",
  71: "Snow",
  73: "Snow",
  75: "Snow",
  77: "Snow",
  80: "Showers",
  81: "Showers",
  82: "Showers",
  85: "Snow",
  86: "Snow",
  95: "Storm",
  96: "Hail",
  99: "Hail",
};

export function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

export function getTimeOfDayDescription(hour: number, isDay: boolean): string {
  return `${formatHour(hour)}, ${isDay ? "Day" : "Night"}`;
}
