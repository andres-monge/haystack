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
  61: "Light rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Moderate snow",
  95: "Thunderstorm",
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
  61: "Rain",
  63: "Rain",
  65: "Rain",
  71: "Snow",
  73: "Snow",
  95: "Storm",
};

export function getTimeOfDayDescription(hour: number): string {
  if (hour >= 5 && hour < 7) return "Early morning, dawn breaking";
  if (hour >= 7 && hour < 12) return "Morning, bright daylight";
  if (hour >= 12 && hour < 14) return "Midday, sun high overhead";
  if (hour >= 14 && hour < 17) return "Afternoon, warm light";
  if (hour >= 17 && hour < 20) return "Evening, golden hour, sunset";
  if (hour >= 20 && hour < 22) return "Dusk, twilight";
  return "Night, darkness, moonlight";
}

export function getWeatherDescription(weatherCode?: number): string {
  if (weatherCode === undefined) return "";
  const desc = WMO_DESCRIPTIONS[weatherCode];
  return desc ? `, ${desc.toLowerCase()}` : "";
}
