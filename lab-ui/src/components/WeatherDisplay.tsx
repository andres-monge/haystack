import type { CurrentConditions } from "../types";
import { WMO_DESCRIPTIONS } from "../utils/scenario";

interface Props {
  current: CurrentConditions | null;
  isLoading: boolean;
}

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
