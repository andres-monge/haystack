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

export function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

export function getTimeOfDayDescription(hour: number, isDay: boolean): string {
  return `${formatHour(hour)}, ${isDay ? "Day" : "Night"}`;
}
