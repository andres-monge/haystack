import { describe, it, expect } from "vitest";
import {
  createScenarioFromHour,
  createScenarioFromNow,
  describeScenario,
  getSolarPhase,
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

  it("omits all moon cues when the moon is below the horizon", () => {
    const scenario = createScenarioFromHour(23);
    scenario.moonFraction = 0.5;
    scenario.moonAltitude = -10;
    const desc = describeScenario(scenario);
    expect(desc).not.toContain("moon 50% illuminated");
    expect(desc).not.toContain("moon altitude");
  });

  it("treats an unilluminated new moon above the horizon as moonless", () => {
    const scenario = createScenarioFromHour(23, false);
    scenario.sunElevation = -25;
    scenario.solarPhase = "night";
    scenario.moonAltitude = 20;
    scenario.moonFraction = 0;

    const desc = describeScenario(scenario);

    expect(desc).toContain("moonless, starry dark sky");
    expect(desc).not.toContain("visible moonlight");
    expect(desc).not.toContain("moon 0% illuminated");
  });

  it("front-loads a specific daylight visual target for the reported Madrid failure", () => {
    const scenario = createScenarioFromHour(20, true);
    scenario.timestampLocal = new Date("2026-08-03T18:00:00Z");
    scenario.minute = 0;
    scenario.sunElevation = 15.2;
    scenario.sunAzimuth = 280.2;
    scenario.moonAltitude = -34.1;
    scenario.solarPhase = "daylight";
    scenario.solarTrend = "setting";
    scenario.sunset = new Date("2026-08-03T19:29:31Z");

    const desc = describeScenario(scenario);

    expect(desc).toMatch(/^Solar visual target: bright late-afternoon daylight\./);
    expect(desc).toContain("luminous daylight-blue sky");
    expect(desc).toContain("fully visible in natural daylight");
    expect(desc).toContain("Sunset is about 90 minutes away");
    expect(desc).toContain("moonless and starless");
    expect(desc.indexOf("Solar visual target")).toBeLessThan(desc.indexOf("8 PM"));
    expect(desc).toContain("\nMeasured conditions: 8 PM");
    expect(desc).not.toContain(".,");
  });

  it("describes low positive solar elevation as golden-hour daylight", () => {
    const scenario = createScenarioFromHour(21, true);
    scenario.sunElevation = 4.2;
    scenario.moonAltitude = -25;
    scenario.solarPhase = "golden-hour";
    scenario.solarTrend = "setting";

    const desc = describeScenario(scenario);

    expect(desc).toContain("warm golden-hour daylight");
    expect(desc).toContain("blue upper sky grading toward warm color near the horizon");
  });

  it("includes the exact local minute in the clock description", () => {
    const scenario = createScenarioFromHour(20, true);
    scenario.minute = 34;

    expect(describeScenario(scenario)).toContain("8:34 PM");
  });

  it("derives solar phases from physical elevation rather than clock hour", () => {
    expect(getSolarPhase(15.2)).toBe("daylight");
    expect(getSolarPhase(4.2)).toBe("golden-hour");
    expect(getSolarPhase(-2)).toBe("civil-twilight");
    expect(getSolarPhase(-8)).toBe("nautical-twilight");
    expect(getSolarPhase(-14)).toBe("astronomical-twilight");
    expect(getSolarPhase(-20)).toBe("night");
  });
});
