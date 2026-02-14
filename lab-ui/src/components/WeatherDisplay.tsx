import type { CurrentConditions } from "../types";

interface Props {
  current: CurrentConditions | null;
  isLoading: boolean;
}

const WMO_DESCRIPTIONS: Record<number, string> = {
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

export function WeatherDisplay({ current, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="weather-display">
        <label className="section-label">Weather</label>
        <div className="weather-loading">Loading weather...</div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="weather-display">
        <label className="section-label">Weather</label>
        <div className="weather-empty">No location selected</div>
      </div>
    );
  }

  const description =
    WMO_DESCRIPTIONS[current.weatherCode] ?? `Code ${current.weatherCode}`;

  return (
    <div className="weather-display">
      <label className="section-label">Weather</label>
      <div className="weather-conditions">
        <div className="weather-main">
          <span className="weather-description">{description}</span>
          <span className="weather-temp">{Math.round(current.temperature)}°C</span>
        </div>
        <div className="weather-details">
          <span>Clouds: {current.cloudPercent}%</span>
          <span>Precip: {current.precipProbability}%</span>
          <span>{current.isDay ? "Day" : "Night"}</span>
        </div>
      </div>
      <div className="weather-attribution">
        Weather data by{" "}
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
          Open-Meteo
        </a>
        {" · "}
        <a
          href="https://open-meteo.com/en/licence"
          target="_blank"
          rel="noopener noreferrer"
        >
          CC BY 4.0
        </a>
      </div>
    </div>
  );
}
