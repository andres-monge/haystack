import type {
  CurrentConditions,
  HourlyConditions,
  Location,
  WeatherProvider,
} from "./types.js";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/** Raw Open-Meteo geocoding result. */
interface GeocodingResult {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  admin1?: string;
}

/** Raw Open-Meteo forecast response shape. */
interface ForecastResponse {
  hourly: {
    time: string[];
    weather_code: number[];
    cloud_cover: number[];
    precipitation_probability: number[];
    temperature_2m: number[];
    is_day: number[];
  };
  daily: {
    sunrise: string[];
    sunset: string[];
  };
}

/**
 * Open-Meteo weather provider.
 * Free, no API key required. Uses WMO weather codes.
 * See https://open-meteo.com/en/docs
 */
export class OpenMeteoProvider implements WeatherProvider {
  async searchLocations(query: string): Promise<Location[]> {
    if (!query.trim()) {
      return [];
    }

    const url = new URL(GEOCODING_URL);
    url.searchParams.set("name", query);
    url.searchParams.set("count", "5");
    url.searchParams.set("language", "en");

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(
        `Open-Meteo geocoding request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { results?: GeocodingResult[] };
    if (!data.results) {
      return [];
    }

    return data.results.map((r) => ({
      name: r.name,
      country: r.country,
      lat: r.latitude,
      lon: r.longitude,
      timezone: r.timezone,
      admin1: r.admin1,
    }));
  }

  async getHourlyConditions(
    lat: number,
    lon: number,
    timezone: string,
  ): Promise<HourlyConditions[]> {
    const forecast = await this.fetchForecastDay(lat, lon, timezone);
    return this.zipHourly(forecast);
  }

  async getCurrentConditions(
    lat: number,
    lon: number,
    timezone: string,
  ): Promise<CurrentConditions> {
    const forecast = await this.fetchForecastDay(lat, lon, timezone);
    const hourly = this.zipHourly(forecast);
    const slot = this.findCurrentSlot(hourly, timezone);

    return {
      ...slot,
      sunrise: forecast.daily.sunrise[0],
      sunset: forecast.daily.sunset[0],
    };
  }

  /** Single fetch for both hourly + daily data. */
  private async fetchForecastDay(
    lat: number,
    lon: number,
    timezone: string,
  ): Promise<ForecastResponse> {
    const url = new URL(FORECAST_URL);
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("timezone", timezone);
    url.searchParams.set(
      "hourly",
      "weather_code,cloud_cover,precipitation_probability,temperature_2m,is_day",
    );
    url.searchParams.set("daily", "sunrise,sunset");
    url.searchParams.set("forecast_days", "1");

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(
        `Open-Meteo forecast request failed: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as ForecastResponse;
  }

  /** Zip parallel arrays from the hourly response into typed objects. */
  private zipHourly(forecast: ForecastResponse): HourlyConditions[] {
    const { time, weather_code, cloud_cover, precipitation_probability, temperature_2m, is_day } =
      forecast.hourly;

    return time.map((t, i) => ({
      time: t,
      weatherCode: weather_code[i],
      cloudPercent: cloud_cover[i],
      precipProbability: precipitation_probability[i],
      temperature: temperature_2m[i],
      isDay: is_day[i] === 1,
    }));
  }

  /**
   * Find the hourly slot matching the current hour in the given timezone.
   * Matches by parsing the local hour from the time string rather than
   * using array index — handles DST days with 23 or 25 entries.
   */
  private findCurrentSlot(
    hourly: HourlyConditions[],
    timezone: string,
  ): HourlyConditions {
    const now = new Date();
    const currentHour = this.getHourInTimezone(now, timezone);

    // Try exact match first
    const exact = hourly.find((h) => this.parseHour(h.time) === currentHour);
    if (exact) {
      return exact;
    }

    // Fallback: find closest match (handles DST edge cases)
    let closest = hourly[0];
    let minDiff = Math.abs(this.parseHour(closest.time) - currentHour);
    for (const slot of hourly) {
      const diff = Math.abs(this.parseHour(slot.time) - currentHour);
      if (diff < minDiff) {
        closest = slot;
        minDiff = diff;
      }
    }
    return closest;
  }

  /** Extract the hour (0-23) from a time string like "2026-02-14T14:00". */
  private parseHour(timeStr: string): number {
    const match = timeStr.match(/T(\d{2}):/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /** Get the current hour in a given IANA timezone. */
  private getHourInTimezone(date: Date, timezone: string): number {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(date);

    const hourPart = parts.find((p) => p.type === "hour");
    // Intl hour12:false returns "24" for midnight in some locales
    const hour = parseInt(hourPart?.value ?? "0", 10);
    return hour === 24 ? 0 : hour;
  }
}
