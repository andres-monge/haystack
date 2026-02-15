import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenMeteoProvider } from "../../src/weather/open-meteo.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Canned geocoding response for "Madrid". */
function geocodingResponse() {
  return {
    results: [
      {
        name: "Madrid",
        country: "Spain",
        latitude: 40.4168,
        longitude: -3.7038,
        timezone: "Europe/Madrid",
        admin1: "Community of Madrid",
      },
      {
        name: "Madrid",
        country: "Colombia",
        latitude: 4.7333,
        longitude: -73.6333,
        timezone: "America/Bogota",
      },
    ],
  };
}

/** Canned forecast response with 24 hourly slots. */
function forecastResponse() {
  const times: string[] = [];
  const weatherCodes: number[] = [];
  const cloudCovers: number[] = [];
  const precipProbs: number[] = [];
  const temps: number[] = [];
  const isDays: number[] = [];
  const humidity: number[] = [];
  const windSpeed: number[] = [];
  const windGusts: number[] = [];
  const visibility: number[] = [];
  const precipitation: number[] = [];
  const rain: number[] = [];
  const snowfall: number[] = [];
  const snowDepth: number[] = [];
  const directRadiation: number[] = [];
  const diffuseRadiation: number[] = [];

  for (let h = 0; h < 24; h++) {
    times.push(`2026-02-14T${String(h).padStart(2, "0")}:00`);
    weatherCodes.push(h < 12 ? 0 : 61); // Clear morning, rain afternoon
    cloudCovers.push(h < 12 ? 10 : 80);
    precipProbs.push(h < 12 ? 0 : 60);
    temps.push(5 + h); // 5°C at midnight, 29°C at midnight
    isDays.push(h >= 7 && h <= 20 ? 1 : 0);
    humidity.push(50 + h);
    windSpeed.push(5 + h * 0.5);
    windGusts.push(10 + h);
    visibility.push(h < 12 ? 20000 : 5000);
    precipitation.push(h < 12 ? 0 : 1.5);
    rain.push(h < 12 ? 0 : 1.2);
    snowfall.push(0);
    snowDepth.push(0);
    directRadiation.push(h >= 7 && h <= 20 ? 200 + h * 10 : 0);
    diffuseRadiation.push(h >= 7 && h <= 20 ? 50 + h * 5 : 0);
  }

  return {
    hourly: {
      time: times,
      weather_code: weatherCodes,
      cloud_cover: cloudCovers,
      precipitation_probability: precipProbs,
      temperature_2m: temps,
      is_day: isDays,
      relative_humidity_2m: humidity,
      wind_speed_10m: windSpeed,
      wind_gusts_10m: windGusts,
      visibility,
      precipitation,
      rain,
      snowfall,
      snow_depth: snowDepth,
      direct_radiation: directRadiation,
      diffuse_radiation: diffuseRadiation,
    },
    daily: {
      sunrise: ["2026-02-14T07:30"],
      sunset: ["2026-02-14T18:15"],
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Internal Server Error",
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenMeteoProvider", () => {
  describe("searchLocations", () => {
    it("returns array of Location with correct fields", async () => {
      mockFetch.mockResolvedValue(jsonResponse(geocodingResponse()));

      const provider = new OpenMeteoProvider();
      const results = await provider.searchLocations("Madrid");

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        name: "Madrid",
        country: "Spain",
        lat: 40.4168,
        lon: -3.7038,
        timezone: "Europe/Madrid",
        admin1: "Community of Madrid",
      });
      expect(results[1]).toEqual({
        name: "Madrid",
        country: "Colombia",
        lat: 4.7333,
        lon: -73.6333,
        timezone: "America/Bogota",
        admin1: undefined,
      });
    });

    it("calls the geocoding URL with correct parameters", async () => {
      mockFetch.mockResolvedValue(jsonResponse(geocodingResponse()));

      const provider = new OpenMeteoProvider();
      await provider.searchLocations("Madrid");

      expect(mockFetch).toHaveBeenCalledOnce();
      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.origin + url.pathname).toBe(
        "https://geocoding-api.open-meteo.com/v1/search",
      );
      expect(url.searchParams.get("name")).toBe("Madrid");
      expect(url.searchParams.get("count")).toBe("5");
      expect(url.searchParams.get("language")).toBe("en");
    });

    it("returns empty array for empty query", async () => {
      const provider = new OpenMeteoProvider();
      const results = await provider.searchLocations("");

      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns empty array for whitespace-only query", async () => {
      const provider = new OpenMeteoProvider();
      const results = await provider.searchLocations("   ");

      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns empty array when geocoding returns no results", async () => {
      mockFetch.mockResolvedValue(jsonResponse({}));

      const provider = new OpenMeteoProvider();
      const results = await provider.searchLocations("xyznonexistent");

      expect(results).toEqual([]);
    });

    it("throws descriptive error on API failure", async () => {
      mockFetch.mockResolvedValue(jsonResponse({}, 500));

      const provider = new OpenMeteoProvider();

      await expect(provider.searchLocations("Madrid")).rejects.toThrow(
        /geocoding request failed.*500/,
      );
    });
  });

  describe("getHourlyConditions", () => {
    it("correctly zips parallel arrays into HourlyConditions objects", async () => {
      mockFetch.mockResolvedValue(jsonResponse(forecastResponse()));

      const provider = new OpenMeteoProvider();
      const hourly = await provider.getHourlyConditions(
        40.4168,
        -3.7038,
        "Europe/Madrid",
      );

      expect(hourly).toHaveLength(24);

      // Check first slot (midnight)
      expect(hourly[0]).toEqual({
        time: "2026-02-14T00:00",
        weatherCode: 0,
        cloudPercent: 10,
        precipProbability: 0,
        temperature: 5,
        isDay: false,
        humidity: 50,
        windSpeed: 5,
        windGusts: 10,
        visibility: 20000,
        precipitation: 0,
        rain: 0,
        snowfall: 0,
        snowDepth: 0,
        directRadiation: 0,
        diffuseRadiation: 0,
      });

      // Check a daytime slot (hour 10)
      expect(hourly[10]).toEqual({
        time: "2026-02-14T10:00",
        weatherCode: 0,
        cloudPercent: 10,
        precipProbability: 0,
        temperature: 15,
        isDay: true,
        humidity: 60,
        windSpeed: 10,
        windGusts: 20,
        visibility: 20000,
        precipitation: 0,
        rain: 0,
        snowfall: 0,
        snowDepth: 0,
        directRadiation: 300,
        diffuseRadiation: 100,
      });

      // Check an afternoon slot with rain (hour 14)
      expect(hourly[14]).toEqual({
        time: "2026-02-14T14:00",
        weatherCode: 61,
        cloudPercent: 80,
        precipProbability: 60,
        temperature: 19,
        isDay: true,
        humidity: 64,
        windSpeed: 12,
        windGusts: 24,
        visibility: 5000,
        precipitation: 1.5,
        rain: 1.2,
        snowfall: 0,
        snowDepth: 0,
        directRadiation: 340,
        diffuseRadiation: 120,
      });
    });

    it("calls the forecast URL with correct parameters", async () => {
      mockFetch.mockResolvedValue(jsonResponse(forecastResponse()));

      const provider = new OpenMeteoProvider();
      await provider.getHourlyConditions(40.4168, -3.7038, "Europe/Madrid");

      expect(mockFetch).toHaveBeenCalledOnce();
      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.origin + url.pathname).toBe(
        "https://api.open-meteo.com/v1/forecast",
      );
      expect(url.searchParams.get("latitude")).toBe("40.4168");
      expect(url.searchParams.get("longitude")).toBe("-3.7038");
      expect(url.searchParams.get("timezone")).toBe("Europe/Madrid");
      expect(url.searchParams.get("forecast_days")).toBe("1");
      expect(url.searchParams.get("hourly")).toContain("weather_code");
      expect(url.searchParams.get("daily")).toBe("sunrise,sunset");
    });

    it("throws descriptive error on API failure", async () => {
      mockFetch.mockResolvedValue(jsonResponse({}, 500));

      const provider = new OpenMeteoProvider();

      await expect(
        provider.getHourlyConditions(40.4168, -3.7038, "Europe/Madrid"),
      ).rejects.toThrow(/forecast request failed.*500/);
    });
  });

  describe("getCurrentConditions", () => {
    it("finds correct hour slot and includes sunrise/sunset", async () => {
      mockFetch.mockResolvedValue(jsonResponse(forecastResponse()));

      const provider = new OpenMeteoProvider();
      const current = await provider.getCurrentConditions(
        40.4168,
        -3.7038,
        "Europe/Madrid",
      );

      // Should match some hour slot from the forecast
      expect(current.weatherCode).toBeDefined();
      expect(current.cloudPercent).toBeDefined();
      expect(current.precipProbability).toBeDefined();
      expect(current.temperature).toBeDefined();
      expect(typeof current.isDay).toBe("boolean");

      // Must include sunrise/sunset from daily data
      expect(current.sunrise).toBe("2026-02-14T07:30");
      expect(current.sunset).toBe("2026-02-14T18:15");
    });

    it("makes only a single fetch call for both hourly and daily data", async () => {
      mockFetch.mockResolvedValue(jsonResponse(forecastResponse()));

      const provider = new OpenMeteoProvider();
      await provider.getCurrentConditions(40.4168, -3.7038, "Europe/Madrid");

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("falls back to closest slot when exact hour match is missing", async () => {
      // Simulate a DST day where hour 2 is missing (spring forward)
      const forecast = forecastResponse();
      // Remove the 02:00 entry
      const idx = forecast.hourly.time.findIndex((t) =>
        t.includes("T02:"),
      );
      forecast.hourly.time.splice(idx, 1);
      forecast.hourly.weather_code.splice(idx, 1);
      forecast.hourly.cloud_cover.splice(idx, 1);
      forecast.hourly.precipitation_probability.splice(idx, 1);
      forecast.hourly.temperature_2m.splice(idx, 1);
      forecast.hourly.is_day.splice(idx, 1);
      forecast.hourly.relative_humidity_2m.splice(idx, 1);
      forecast.hourly.wind_speed_10m.splice(idx, 1);
      forecast.hourly.wind_gusts_10m.splice(idx, 1);
      forecast.hourly.visibility.splice(idx, 1);
      forecast.hourly.precipitation.splice(idx, 1);
      forecast.hourly.rain.splice(idx, 1);
      forecast.hourly.snowfall.splice(idx, 1);
      forecast.hourly.snow_depth.splice(idx, 1);
      forecast.hourly.direct_radiation.splice(idx, 1);
      forecast.hourly.diffuse_radiation.splice(idx, 1);

      mockFetch.mockResolvedValue(jsonResponse(forecast));

      const provider = new OpenMeteoProvider();
      // Should not throw — falls back to closest
      const current = await provider.getCurrentConditions(
        40.4168,
        -3.7038,
        "Europe/Madrid",
      );

      expect(current.sunrise).toBe("2026-02-14T07:30");
      expect(current.sunset).toBe("2026-02-14T18:15");
    });

    it("throws descriptive error on API failure", async () => {
      mockFetch.mockResolvedValue(jsonResponse({}, 500));

      const provider = new OpenMeteoProvider();

      await expect(
        provider.getCurrentConditions(40.4168, -3.7038, "Europe/Madrid"),
      ).rejects.toThrow(/forecast request failed.*500/);
    });
  });

  describe("input validation", () => {
    it("throws RangeError for invalid latitude", async () => {
      const provider = new OpenMeteoProvider();

      await expect(
        provider.getHourlyConditions(91, 0, "UTC"),
      ).rejects.toThrow(RangeError);
      await expect(
        provider.getHourlyConditions(-91, 0, "UTC"),
      ).rejects.toThrow(RangeError);
      await expect(
        provider.getHourlyConditions(NaN, 0, "UTC"),
      ).rejects.toThrow(RangeError);
      await expect(
        provider.getHourlyConditions(Infinity, 0, "UTC"),
      ).rejects.toThrow(RangeError);
    });

    it("throws RangeError for invalid longitude", async () => {
      const provider = new OpenMeteoProvider();

      await expect(
        provider.getHourlyConditions(0, 181, "UTC"),
      ).rejects.toThrow(RangeError);
      await expect(
        provider.getHourlyConditions(0, -181, "UTC"),
      ).rejects.toThrow(RangeError);
    });

    it("accepts boundary coordinate values", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(forecastResponse()))
        .mockResolvedValueOnce(jsonResponse(forecastResponse()));

      const provider = new OpenMeteoProvider();
      // Should not throw for boundary values
      await provider.getHourlyConditions(90, 180, "UTC");
      await provider.getHourlyConditions(-90, -180, "UTC");
    });
  });

  describe("fetch options", () => {
    it("passes abort signal timeout to fetch calls", async () => {
      mockFetch.mockResolvedValue(jsonResponse(forecastResponse()));

      const provider = new OpenMeteoProvider();
      await provider.getHourlyConditions(40.4168, -3.7038, "Europe/Madrid");

      const fetchOptions = mockFetch.mock.calls[0][1];
      expect(fetchOptions).toBeDefined();
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it("passes abort signal timeout to geocoding fetch", async () => {
      mockFetch.mockResolvedValue(jsonResponse(geocodingResponse()));

      const provider = new OpenMeteoProvider();
      await provider.searchLocations("Madrid");

      const fetchOptions = mockFetch.mock.calls[0][1];
      expect(fetchOptions).toBeDefined();
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
