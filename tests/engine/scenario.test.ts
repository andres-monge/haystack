import { describe, it, expect } from "vitest";
import {
  createScenarioFromHour,
  createScenarioFromNow,
  describeScenario,
} from "../../src/engine/scenario.js";

describe("createScenarioFromHour", () => {
  it("creates scenario with correct hour", () => {
    const scenario = createScenarioFromHour(14);
    expect(scenario.hour).toBe(14);
    expect(scenario.isDay).toBe(true);
  });

  it("auto-detects day for daytime hours", () => {
    for (const hour of [6, 12, 18, 20]) {
      const scenario = createScenarioFromHour(hour);
      expect(scenario.isDay).toBe(true);
    }
  });

  it("auto-detects night for late hours", () => {
    const scenario = createScenarioFromHour(23);
    expect(scenario.isDay).toBe(false);
  });

  it("auto-detects night for early hours", () => {
    const scenario = createScenarioFromHour(4);
    expect(scenario.isDay).toBe(false);
  });

  it("respects explicit isDay override", () => {
    const scenario = createScenarioFromHour(14, false);
    expect(scenario.hour).toBe(14);
    expect(scenario.isDay).toBe(false);
  });

  it("sets timestampLocal to a Date", () => {
    const scenario = createScenarioFromHour(10);
    expect(scenario.timestampLocal).toBeInstanceOf(Date);
  });

  it("throws for out-of-range hour", () => {
    expect(() => createScenarioFromHour(25)).toThrow(RangeError);
    expect(() => createScenarioFromHour(-1)).toThrow(RangeError);
  });

  it("throws for non-integer hour", () => {
    expect(() => createScenarioFromHour(3.5)).toThrow(RangeError);
    expect(() => createScenarioFromHour(NaN)).toThrow(RangeError);
  });
});

describe("createScenarioFromNow", () => {
  it("creates scenario with current hour", () => {
    const now = new Date();
    const scenario = createScenarioFromNow();
    expect(scenario.hour).toBe(now.getHours());
  });

  it("sets timestampLocal close to now", () => {
    const before = Date.now();
    const scenario = createScenarioFromNow();
    const after = Date.now();
    expect(scenario.timestampLocal.getTime()).toBeGreaterThanOrEqual(before);
    expect(scenario.timestampLocal.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("describeScenario", () => {
  it("includes hour and day/night for daytime hour", () => {
    const scenario = createScenarioFromHour(9);
    expect(describeScenario(scenario)).toBe("9 AM, day");
  });

  it("includes hour and day/night for nighttime hour", () => {
    const scenario = createScenarioFromHour(23);
    expect(describeScenario(scenario)).toContain("11 PM, night");
  });

  it("formats midnight correctly", () => {
    const scenario = createScenarioFromHour(0);
    expect(describeScenario(scenario)).toContain("12 AM");
  });

  it("formats noon correctly", () => {
    const scenario = createScenarioFromHour(12);
    expect(describeScenario(scenario)).toContain("12 PM");
  });

  it("respects isDay override for early morning", () => {
    const scenario = createScenarioFromHour(5, true);
    expect(describeScenario(scenario)).toBe("5 AM, day");
  });

  it("includes weather description when weatherCode is set", () => {
    const scenario = createScenarioFromHour(12);
    scenario.weatherCode = 61;
    const desc = describeScenario(scenario);
    expect(desc).toContain("light rain");
  });

  it("omits weather when weatherCode is undefined", () => {
    const scenario = createScenarioFromHour(12);
    const desc = describeScenario(scenario);
    expect(desc).toBe("12 PM, day");
  });

  it("handles unknown weather codes gracefully", () => {
    const scenario = createScenarioFromHour(12);
    scenario.weatherCode = 999;
    const desc = describeScenario(scenario);
    // Unknown codes are silently omitted
    expect(desc).toBe("12 PM, day");
  });

  it("includes all weather fields when populated", () => {
    const scenario = createScenarioFromHour(14);
    scenario.weatherCode = 3;
    scenario.temperature = 22;
    scenario.humidity = 65;
    scenario.windSpeed = 12;
    scenario.visibility = 10000;
    scenario.directRadiation = 450;
    scenario.diffuseRadiation = 120;
    const desc = describeScenario(scenario);
    expect(desc).toContain("overcast");
    expect(desc).toContain("22°C");
    expect(desc).toContain("humidity 65%");
    expect(desc).toContain("wind 12 km/h");
    expect(desc).toContain("visibility 10000m");
    expect(desc).toContain("direct radiation 450 W/m²");
    expect(desc).toContain("diffuse radiation 120 W/m²");
  });

  it("includes precipitation only when > 0", () => {
    const scenario = createScenarioFromHour(14);
    scenario.precipitation = 0;
    expect(describeScenario(scenario)).not.toContain("precipitation");

    scenario.precipitation = 2.5;
    expect(describeScenario(scenario)).toContain("precipitation 2.5mm/h");
  });

  it("includes moon data only at night", () => {
    const dayScenario = createScenarioFromHour(12);
    dayScenario.moonFraction = 0.75;
    dayScenario.moonAltitude = 30;
    expect(describeScenario(dayScenario)).not.toContain("moon");

    const nightScenario = createScenarioFromHour(23);
    nightScenario.moonFraction = 0.75;
    nightScenario.moonAltitude = 30;
    const desc = describeScenario(nightScenario);
    expect(desc).toContain("moon 75% illuminated");
    expect(desc).toContain("moon altitude 30°");
  });

  it("omits moon altitude when below horizon", () => {
    const scenario = createScenarioFromHour(23);
    scenario.moonFraction = 0.5;
    scenario.moonAltitude = -10;
    const desc = describeScenario(scenario);
    expect(desc).toContain("moon 50% illuminated");
    expect(desc).not.toContain("moon altitude");
  });
});
