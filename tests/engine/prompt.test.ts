import { describe, it, expect } from "vitest";
import {
  composePrompt,
  DEFAULT_TEMPLATE,
  DEFAULT_PROMPT_CONFIG,
} from "../../src/engine/prompt.js";
import { createScenarioFromHour } from "../../src/engine/scenario.js";

describe("DEFAULT_TEMPLATE", () => {
  it("contains the {scenario} placeholder", () => {
    expect(DEFAULT_TEMPLATE).toContain("{scenario}");
  });
});

describe("composePrompt", () => {
  it("includes scenario description for daytime hour", () => {
    const scenario = createScenarioFromHour(18);
    const prompt = composePrompt(scenario);
    expect(prompt).toContain("6 PM, day");
  });

  it("includes scenario description for morning hour", () => {
    const scenario = createScenarioFromHour(9);
    const prompt = composePrompt(scenario);
    expect(prompt).toContain("9 AM, day");
  });

  it("includes scenario description for night", () => {
    const scenario = createScenarioFromHour(23);
    const prompt = composePrompt(scenario);
    expect(prompt).toContain("11 PM, night");
  });

  it("replaces {scenario} placeholder (no raw placeholder in output)", () => {
    const scenario = createScenarioFromHour(14);
    const prompt = composePrompt(scenario);
    expect(prompt).not.toContain("{scenario}");
  });

  it("appends extra context when provided", () => {
    const scenario = createScenarioFromHour(22);
    const prompt = composePrompt(scenario, {
      ...DEFAULT_PROMPT_CONFIG,
      extraContext: "The room has electric lights",
    });
    expect(prompt).toContain("Additional context: The room has electric lights");
  });

  it("does not append extra context section when extraContext is undefined", () => {
    const scenario = createScenarioFromHour(12);
    const prompt = composePrompt(scenario);
    expect(prompt).not.toContain("Additional context:");
  });

  it("uses custom template when provided", () => {
    const scenario = createScenarioFromHour(10);
    const prompt = composePrompt(scenario, {
      template: "Light the scene for: {scenario}",
    });
    expect(prompt).toBe("Light the scene for: 10 AM, day");
  });

  it("defaults to DEFAULT_PROMPT_CONFIG when config is omitted", () => {
    const scenario = createScenarioFromHour(14);
    const prompt = composePrompt(scenario);
    expect(prompt).toContain("Using the provided artwork");
  });

  it("includes weather in scenario description when set", () => {
    const scenario = createScenarioFromHour(12);
    scenario.weatherCode = 63;
    const prompt = composePrompt(scenario);
    expect(prompt).toContain("moderate rain");
  });
});
