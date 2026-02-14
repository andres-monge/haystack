import type {
  CurrentConditions,
  HourlyConditions,
  Location,
  WeatherProvider,
} from "./types.js";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds
const MAX_RESPONSE_BYTES = 512 * 1024; // 512 KB sanity limit

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
  private formatters = new Map<string, Intl.DateTimeFormat>();

  async searchLocations(query: string): Promise<Location[]> {
    if (!query.trim()) {
      return [];
    }

    const url = new URL(GEOCODING_URL);
    url.searchParams.set("name", query);
    url.searchParams.set("count", "5");
    url.searchParams.set("language", "en");

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `Open-Meteo geocoding request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await this.readJson(response)) as {
      results?: GeocodingResult[];
    };
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
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new RangeError(`Invalid latitude: ${lat}`);
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new RangeError(`Invalid longitude: ${lon}`);
    }

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

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `Open-Meteo forecast request failed: ${response.status} ${response.statusText}`,
      );
    }

    return (await this.readJson(response)) as ForecastResponse;
  }

  /** Read and parse JSON with a size guard to prevent OOM on malformed responses. */
  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error(
        `Open-Meteo response exceeds maximum allowed size (${text.length} bytes)`,
      );
    }
    return JSON.parse(text) as unknown;
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
   * Single-pass search: short-circuits on exact match, otherwise returns closest.
   * Parses hours from time strings (not array index) to handle DST days.
   */
  private findCurrentSlot(
    hourly: HourlyConditions[],
    timezone: string,
  ): HourlyConditions {
    const currentHour = this.getHourInTimezone(new Date(), timezone);
    let closest = hourly[0];
    let minDiff = Math.abs(this.parseHour(closest.time) - currentHour);

    for (const slot of hourly) {
      const diff = Math.abs(this.parseHour(slot.time) - currentHour);
      if (diff === 0) return slot;
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

  /** Get the current hour in a given IANA timezone. Caches formatters. */
  private getHourInTimezone(date: Date, timezone: string): number {
    let fmt = this.formatters.get(timezone);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
      });
      this.formatters.set(timezone, fmt);
    }

    const parts = fmt.formatToParts(date);
    const hourPart = parts.find((p) => p.type === "hour");
    // Intl hour12:false returns "24" for midnight in some locales
    const hour = parseInt(hourPart?.value ?? "0", 10);
    return hour === 24 ? 0 : hour;
  }
}
