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

  it("uses a concise open-ended double-take direction instead of story mechanics", () => {
    expect(DEFAULT_TEMPLATE).toContain(
      "Tell an interesting story within this artwork that makes the viewer do a double take and wonder what is going on.",
    );
    expect(DEFAULT_TEMPLATE).toContain(
      "Invent the situation freely based on the artwork, time, and weather.",
    );
    expect(DEFAULT_TEMPLATE).not.toContain(
      "visible action, reaction, relationships, consequences, or other evidence",
    );
    expect(DEFAULT_TEMPLATE).not.toContain(
      "Subtle intrigue is valid; do not force a dramatic incident",
    );
  });

  it("asks for an interesting situation without prescribing its structure", () => {
    expect(DEFAULT_TEMPLATE).toContain(
      "Something genuinely interesting should be happening, not merely an ordinary everyday activity",
    );
    expect(DEFAULT_TEMPLATE).toContain(
      "Arrange the action compellingly within the artwork's existing composition",
    );
    expect(DEFAULT_TEMPLATE).toContain("Invent the situation freely");
    expect(DEFAULT_TEMPLATE).not.toContain("micro-story");
    expect(DEFAULT_TEMPLATE).not.toContain("Decide who is present");
    expect(DEFAULT_TEMPLATE).not.toMatch(/for example|such as|choose from|catalog|taxonomy/i);
  });

  it("does not impose a quiet-versus-dramatic distribution rule", () => {
    expect(DEFAULT_TEMPLATE).not.toContain("quiet-versus-dramatic");
    expect(DEFAULT_TEMPLATE).not.toContain("quota");
    expect(DEFAULT_TEMPLATE).not.toMatch(/\b\d+% (quiet|dramatic)\b/i);
  });

  it("orders outcome, conditions, preservation, then lighting and weather", () => {
    const outcomeIndex = DEFAULT_TEMPLATE.indexOf("Outcome:");
    const conditionsIndex = DEFAULT_TEMPLATE.indexOf("Current conditions:");
    const preservationIndex = DEFAULT_TEMPLATE.indexOf("Preservation invariants:");
    const lightingIndex = DEFAULT_TEMPLATE.indexOf("Lighting and weather:");

    expect(outcomeIndex).toBeGreaterThanOrEqual(0);
    expect(outcomeIndex).toBeLessThan(conditionsIndex);
    expect(conditionsIndex).toBeLessThan(preservationIndex);
    expect(preservationIndex).toBeLessThan(lightingIndex);
    expect(DEFAULT_TEMPLATE).toContain(
      "authoritative for lighting and sky only",
    );
  });
});

describe("composePrompt", () => {
  it("includes scenario description for daytime hour", () => {
    const scenario = createScenarioFromHour(18);
    const prompt = composePrompt(scenario);
    expect(prompt).toContain("6 PM, day");
    expect(prompt).toContain("When a Solar visual target is present");
    expect(prompt).toContain("otherwise use the available clock and day/night state");
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
    expect(prompt).toContain("Tell an interesting story within this artwork");
  });

  it("includes weather in scenario description when set", () => {
    const scenario = createScenarioFromHour(12);
    scenario.weatherCode = 63;
    const prompt = composePrompt(scenario);
    expect(prompt).toContain("moderate rain");
  });

  it("invites weather to shape the situation while preserving the artwork", () => {
    const scenario = createScenarioFromHour(22, false);
    scenario.weatherCode = 75;
    scenario.snowfall = 2.4;
    scenario.snowDepth = 0.3;

    const prompt = composePrompt(scenario);

    expect(prompt).toContain("heavy snow");
    expect(prompt).toContain("snowfall 2.4cm/h");
    expect(prompt).toContain(
      "When the weather offers an interesting opportunity, let it influence what is happening",
    );
    expect(prompt).toContain(
      "Preserve the EXACT artistic style, medium, and rendering technique",
    );
    expect(prompt).toContain(
      "Do NOT change the camera angle, framing, scale, or composition",
    );
  });

  it("asks for a genuinely interesting moment in ordinary clear conditions", () => {
    const scenario = createScenarioFromHour(14, true);
    scenario.weatherCode = 0;
    scenario.temperature = 21;

    const prompt = composePrompt(scenario);

    expect(prompt).toContain("clear sky");
    expect(prompt).toContain(
      "Something genuinely interesting should be happening, not merely an ordinary everyday activity",
    );
  });

  it("keeps the open-ended story direction when weather is unavailable", () => {
    const prompt = composePrompt(createScenarioFromHour(9, true));

    expect(prompt).toContain("9 AM, day");
    expect(prompt).toContain(
      "Tell an interesting story within this artwork",
    );
  });

  it("turns the reported 8 PM failure into ordered, positive daylight instructions", () => {
    const scenario = createScenarioFromHour(20, true);
    scenario.minute = 0;
    scenario.sunElevation = 15.2;
    scenario.sunAzimuth = 280.2;
    scenario.moonAltitude = -34.1;
    scenario.solarPhase = "daylight";
    scenario.solarTrend = "setting";
    scenario.directRadiation = 210;
    scenario.diffuseRadiation = 75;

    const prompt = composePrompt(scenario);

    expect(prompt).toContain("Solar visual target: bright late-afternoon daylight");
    expect(prompt).toContain("Establish the sky and ambient illumination from the Solar visual target");
    expect(prompt).toContain("Set overall exposure from the Solar visual target");
    expect(prompt).toContain("Use radiation values only to refine light direction and softness");
    expect(prompt.indexOf("Solar visual target")).toBeLessThan(prompt.indexOf("8 PM"));
    expect(prompt.indexOf("Current conditions:")).toBeLessThan(
      prompt.indexOf("Lighting and weather:"),
    );
  });
});
