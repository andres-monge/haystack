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
          <span className="weather-temp">{current.temperature}°C</span>
          <span>{current.isDay ? "Day" : "Night"}</span>
        </div>
        <div className="weather-details">
          <span>Humidity: {current.humidity}%</span>
          <span>Wind: {current.windSpeed} km/h (gusts {current.windGusts})</span>
          <span>Visibility: {current.visibility}m</span>
          <span>Clouds: {current.cloudPercent}%</span>
        </div>
        <div className="weather-details">
          <span>Direct: {current.directRadiation} W/m²</span>
          <span>Diffuse: {current.diffuseRadiation} W/m²</span>
        </div>
        {(current.precipitation > 0 || current.snowfall > 0 || current.snowDepth > 0) && (
          <div className="weather-details">
            {current.precipitation > 0 && <span>Rain: {current.precipitation}mm/h</span>}
            {current.snowfall > 0 && <span>Snow: {current.snowfall}cm/h</span>}
            {current.snowDepth > 0 && <span>Snow depth: {current.snowDepth}m</span>}
          </div>
        )}
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
