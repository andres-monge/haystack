/** Resolved location from geocoding search. */
export interface Location {
  name: string; // "Madrid"
  country: string; // "Spain"
  lat: number;
  lon: number;
  timezone: string; // "Europe/Madrid"
  admin1?: string; // State/province for disambiguation
}

/** Hourly weather conditions for a single point in time. */
export interface HourlyConditions {
  time: string; // ISO 8601 in local timezone
  weatherCode: number; // WMO code (matches Scenario.weatherCode)
  cloudPercent: number; // 0-100
  precipProbability: number; // 0-100
  temperature: number; // Celsius
  isDay: boolean;
}

/** Current conditions = the hourly slot matching "now" in the location's timezone. */
export interface CurrentConditions extends HourlyConditions {
  sunrise: string; // ISO 8601
  sunset: string; // ISO 8601
}

/**
 * Weather provider interface — abstracts the data source.
 * Open-Meteo is the MVP implementation.
 */
export interface WeatherProvider {
  /** City search -> list of matching locations. */
  searchLocations(query: string): Promise<Location[]>;

  /** Get hourly conditions for a location. Returns conditions for the current day. */
  getHourlyConditions(
    lat: number,
    lon: number,
    timezone: string,
  ): Promise<HourlyConditions[]>;

  /** Get current conditions (the hourly slot matching "now"). Includes sunrise/sunset. */
  getCurrentConditions(
    lat: number,
    lon: number,
    timezone: string,
  ): Promise<CurrentConditions>;

  /** Get both current and hourly conditions in a single API call. */
  getForecast(
    lat: number,
    lon: number,
    timezone: string,
  ): Promise<{ current: CurrentConditions; hourly: HourlyConditions[] }>;
}
