import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildScenario,
  buildScheduledScenario,
  computeSunMoon,
  clearWeatherCache,
} from "../../src/server/scenario-builder.js";
import { createScenarioFromHour } from "../../src/engine/scenario.js";
import { getCurrentHourInTimezone } from "../../src/server/timezone.js";
import { createMockWeatherProvider, BASE_CONDITIONS } from "../helpers/mock-factories.js";
import type { WeatherProvider } from "../../src/weather/types.js";
import type { Scenario } from "../../src/engine/types.js";

describe("buildScenario", () => {
  let weatherProvider: WeatherProvider;

  beforeEach(() => {
    clearWeatherCache();
    weatherProvider = createMockWeatherProvider();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns time-only scenario when no weather or location provided", async () => {
    const scenario = await buildScenario(14, {}, weatherProvider);

    expect(scenario.hour).toBe(14);
    expect(scenario.isDay).toBe(true);
    expect(scenario.weatherCode).toBeUndefined();
    expect(weatherProvider.getHourlyConditions).not.toHaveBeenCalled();
  });

  it("uses explicit weather overrides (priority 1)", async () => {
    const scenario = await buildScenario(
      12,
      { weatherCode: "63", cloudPercent: "90", precipProbability: "80" },
      weatherProvider,
    );

    expect(scenario.weatherCode).toBe(63);
    expect(scenario.cloudPercent).toBe(90);
    expect(scenario.precipProbability).toBe(80);
    // Should NOT fetch from provider
    expect(weatherProvider.getHourlyConditions).not.toHaveBeenCalled();
  });

  it("ignores non-numeric explicit weather values", async () => {
    const scenario = await buildScenario(
      12,
      { weatherCode: "abc" },
      weatherProvider,
    );

    expect(scenario.weatherCode).toBeUndefined();
  });

  it("fetches weather from provider when lat/lon/timezone provided (priority 2)", async () => {
    const scenario = await buildScenario(
      12,
      { lat: "40.4168", lon: "-3.7038", timezone: "Europe/Madrid" },
      weatherProvider,
    );

    expect(weatherProvider.getHourlyConditions).toHaveBeenCalledWith(
      40.4168,
      -3.7038,
      "Europe/Madrid",
    );
    expect(scenario.weatherCode).toBe(0);
    expect(scenario.temperature).toBe(15);
    expect(scenario.weatherSource).toBe("live");
    expect(scenario.sunElevation).toBeDefined();
  });

  it("falls back to time-only when weather fetch fails after retries", async () => {
    vi.mocked(weatherProvider.getHourlyConditions).mockRejectedValue(
      new Error("Network error"),
    );

    const scenario = await buildScenario(
      12,
      { lat: "40.4168", lon: "-3.7038", timezone: "Europe/Madrid" },
      weatherProvider,
    );

    expect(scenario.hour).toBe(12);
    expect(scenario.weatherCode).toBeUndefined();
    expect(scenario.weatherSource).toBe("none");
    // Should retry 3 times
    expect(weatherProvider.getHourlyConditions).toHaveBeenCalledTimes(3);
    // Sun/moon should still be computed even when weather fails
    expect(scenario.sunElevation).toBeDefined();
  });

  it("retries weather fetch on transient failure then succeeds", async () => {
    vi.mocked(weatherProvider.getHourlyConditions)
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce([{ ...BASE_CONDITIONS }]);

    const scenario = await buildScenario(
      12,
      { lat: "40.4168", lon: "-3.7038", timezone: "Europe/Madrid" },
      weatherProvider,
    );

    expect(weatherProvider.getHourlyConditions).toHaveBeenCalledTimes(2);
    expect(scenario.weatherCode).toBe(0);
    expect(scenario.weatherSource).toBe("live");
  });

  it("returns time-only when no matching weather slot exists", async () => {
    // Return hourly data for hour 6 only, but request hour 12
    vi.mocked(weatherProvider.getHourlyConditions).mockResolvedValue([
      { ...BASE_CONDITIONS, time: "2026-02-14T06:00" },
    ]);

    const scenario = await buildScenario(
      12,
      { lat: "40.4168", lon: "-3.7038", timezone: "Europe/Madrid" },
      weatherProvider,
    );

    // No matching slot for hour 12 — weather fields should be undefined
    expect(scenario.weatherCode).toBeUndefined();
    expect(scenario.temperature).toBeUndefined();
    expect(scenario.weatherSource).toBe("none");
  });

  it("warns when no matching weather slot exists", async () => {
    const warnSpy = vi.mocked(console.warn);
    vi.mocked(weatherProvider.getHourlyConditions).mockResolvedValue([
      { ...BASE_CONDITIONS, time: "2026-02-14T06:00" },
    ]);

    await buildScenario(
      12,
      { lat: "40.4168", lon: "-3.7038", timezone: "Europe/Madrid" },
      weatherProvider,
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Weather slot miss: wanted hour 12"),
    );
  });

  it("respects isDay override from body", async () => {
    const scenario = await buildScenario(14, { isDay: "false" }, weatherProvider);

    expect(scenario.hour).toBe(14);
    expect(scenario.isDay).toBe(false);
  });

  it("skips weather fetch when lat/lon are missing", async () => {
    const scenario = await buildScenario(
      12,
      { timezone: "Europe/Madrid" },
      weatherProvider,
    );

    expect(weatherProvider.getHourlyConditions).not.toHaveBeenCalled();
    expect(scenario.sunElevation).toBeUndefined();
  });
});

describe("buildScheduledScenario", () => {
  let weatherProvider: WeatherProvider;

  beforeEach(() => {
    clearWeatherCache();
    weatherProvider = createMockWeatherProvider();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  /** Return mock hourly data that matches the current hour in the given timezone. */
  function mockHourlyForCurrentHour(tz: string) {
    const hour = getCurrentHourInTimezone(tz);
    const timeStr = `2026-02-26T${String(hour).padStart(2, "0")}:00`;
    vi.mocked(weatherProvider.getHourlyConditions).mockResolvedValue([
      { ...BASE_CONDITIONS, time: timeStr },
    ]);
  }

  it("builds scenario for current hour in configured timezone", async () => {
    mockHourlyForCurrentHour("America/Los_Angeles");

    const scenario = await buildScheduledScenario(
      34.05,
      -118.25,
      "America/Los_Angeles",
      weatherProvider,
    );

    expect(scenario.hour).toBeGreaterThanOrEqual(0);
    expect(scenario.hour).toBeLessThanOrEqual(23);
    expect(weatherProvider.getHourlyConditions).toHaveBeenCalledWith(
      34.05,
      -118.25,
      "America/Los_Angeles",
    );
  });

  it("computes sun/moon positions", async () => {
    mockHourlyForCurrentHour("America/Los_Angeles");

    const scenario = await buildScheduledScenario(
      34.05,
      -118.25,
      "America/Los_Angeles",
      weatherProvider,
    );

    expect(scenario.sunElevation).toBeDefined();
    expect(typeof scenario.sunElevation).toBe("number");
    expect(scenario.sunAzimuth).toBeDefined();
    expect(scenario.moonFraction).toBeDefined();
    expect(scenario.moonAltitude).toBeDefined();
  });

  it("falls back gracefully when weather provider fails", async () => {
    vi.mocked(weatherProvider.getHourlyConditions).mockRejectedValue(
      new Error("API down"),
    );

    const scenario = await buildScheduledScenario(
      34.05,
      -118.25,
      "America/Los_Angeles",
      weatherProvider,
    );

    // Should still have time + sun/moon, just no weather
    expect(scenario.hour).toBeDefined();
    expect(scenario.sunElevation).toBeDefined();
    expect(scenario.weatherCode).toBeUndefined();
    expect(scenario.weatherSource).toBe("none");
  });

  it("sets weatherSource to live on successful fetch", async () => {
    mockHourlyForCurrentHour("America/Los_Angeles");

    const scenario = await buildScheduledScenario(
      34.05,
      -118.25,
      "America/Los_Angeles",
      weatherProvider,
    );

    expect(scenario.weatherSource).toBe("live");
  });
});

describe("computeSunMoon", () => {
  it("populates sun elevation, azimuth, moon fraction, and altitude", () => {
    const scenario = createScenarioFromHour(12);
    computeSunMoon(scenario, 12, 40.4168, -3.7038, "Europe/Madrid");

    expect(typeof scenario.sunElevation).toBe("number");
    expect(typeof scenario.sunAzimuth).toBe("number");
    expect(typeof scenario.moonFraction).toBe("number");
    expect(typeof scenario.moonAltitude).toBe("number");
  });

  it("computes plausible sun elevation for midday at mid-latitude", () => {
    const scenario = createScenarioFromHour(12);
    computeSunMoon(scenario, 12, 40.4168, -3.7038, "Europe/Madrid");

    // Midday sun at 40°N in February should be positive (above horizon)
    expect(scenario.sunElevation!).toBeGreaterThan(0);
  });

  it("computes negative sun elevation for midnight", () => {
    const scenario = createScenarioFromHour(0);
    computeSunMoon(scenario, 0, 40.4168, -3.7038, "Europe/Madrid");

    // Midnight sun at 40°N should be negative (below horizon)
    expect(scenario.sunElevation!).toBeLessThan(0);
  });

  it("moon fraction is between 0 and 1", () => {
    const scenario = createScenarioFromHour(22);
    computeSunMoon(scenario, 22, 34.05, -118.25, "America/Los_Angeles");

    expect(scenario.moonFraction!).toBeGreaterThanOrEqual(0);
    expect(scenario.moonFraction!).toBeLessThanOrEqual(1);
  });

  it("sun azimuth is between 0 and 360", () => {
    const scenario = createScenarioFromHour(12);
    computeSunMoon(scenario, 12, 40.4168, -3.7038, "Europe/Madrid");

    expect(scenario.sunAzimuth!).toBeGreaterThanOrEqual(0);
    expect(scenario.sunAzimuth!).toBeLessThanOrEqual(360);
  });
});
