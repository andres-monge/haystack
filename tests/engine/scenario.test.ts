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
  it("describes early morning correctly", () => {
    const scenario = createScenarioFromHour(5);
    expect(describeScenario(scenario).toLowerCase()).toContain("dawn");
  });

  it("describes morning correctly", () => {
    const scenario = createScenarioFromHour(9);
    expect(describeScenario(scenario).toLowerCase()).toContain("morning");
  });

  it("describes midday correctly", () => {
    const scenario = createScenarioFromHour(12);
    expect(describeScenario(scenario).toLowerCase()).toContain("midday");
  });

  it("describes afternoon correctly", () => {
    const scenario = createScenarioFromHour(15);
    expect(describeScenario(scenario).toLowerCase()).toContain("afternoon");
  });

  it("describes evening correctly", () => {
    const scenario = createScenarioFromHour(18);
    expect(describeScenario(scenario).toLowerCase()).toContain("evening");
  });

  it("describes dusk correctly", () => {
    const scenario = createScenarioFromHour(21);
    expect(describeScenario(scenario).toLowerCase()).toContain("dusk");
  });

  it("describes night correctly", () => {
    const scenario = createScenarioFromHour(23);
    expect(describeScenario(scenario).toLowerCase()).toContain("night");
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
    expect(desc).toBe("midday, sun high overhead");
  });

  it("handles unknown weather codes gracefully", () => {
    const scenario = createScenarioFromHour(12);
    scenario.weatherCode = 999;
    const desc = describeScenario(scenario);
    // Unknown codes return empty string, so description is just the time
    expect(desc).toBe("midday, sun high overhead");
  });
});
