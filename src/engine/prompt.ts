// src/engine/prompt.ts — Prompt composition for Gemini image editing

import type { Scenario, PromptConfig } from "./types.js";
import { describeScenario } from "./scenario.js";

export const DEFAULT_TEMPLATE = `Using the provided artwork, reimagine this scene at the current moment in time — as if the painting were a living world that changes with the hour and weather.

Time: {scenario}

The setting, architecture, and environment are permanent — but the scene is alive. People and animals go about their day naturally for this time and weather. Consider who would be here now, what they would be doing, how the light falls at this hour, and how people would be dressed for the current conditions.

Reading the weather data:
- Sun elevation: negative = below horizon, 0° = at horizon (sunrise/sunset), 90° = directly overhead. Low positive angles produce long shadows and warm golden light.
- Direct radiation (W/m²): 0 = no direct sunlight (night or dense clouds), high values = crisp hard shadows.
- Diffuse radiation (W/m²): high relative to direct = soft, even, shadowless overcast light.
- Moon illuminated %: 0% = new moon (very dark night), 100% = full moon (bright silvery nightscape). Only relevant at night.
- Visibility (meters): below 1000 = dense fog, 1000-5000 = haze/mist, above 10000 = clear air.

Rules:
- Preserve the EXACT artistic style, medium, and rendering technique of the original
- Keep the architecture, signage, furniture, and environment layout identical
- Characters may change position, appear, or leave — but must match the original art style exactly
- Lighting must be physically consistent with the time of day and weather
- Weather should affect the scene naturally (wet surfaces, fog, snow, etc.)
- Do NOT change the camera angle, framing, scale, or composition
- Do NOT add modern or anachronistic elements
- Do NOT add text, watermarks, or UI elements`;

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  template: DEFAULT_TEMPLATE,
};

/**
 * Safe template substitution: replaces {scenario} with the given text.
 * Uses function form to prevent JavaScript's special replacement patterns
 * ($`, $', $&) from being interpreted in user-provided text.
 */
function fillTemplate(template: string, scenarioText: string): string {
  return template.replace("{scenario}", () => scenarioText);
}

/**
 * Compose the full prompt from a pre-formed scenario text string.
 * Use this when you already have the scenario description as text
 * (e.g., a user-provided override), rather than a Scenario object.
 */
export function composePromptFromText(
  scenarioText: string,
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
): string {
  let prompt = fillTemplate(config.template, scenarioText);

  if (config.extraContext) {
    prompt += `\n\nAdditional context: ${config.extraContext}`;
  }

  return prompt;
}

/**
 * Compose the full prompt from scenario and config.
 * Replaces {scenario} in the template with a human-readable scenario description,
 * and appends extraContext if provided.
 */
export function composePrompt(
  scenario: Scenario,
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
): string {
  return composePromptFromText(describeScenario(scenario), config);
}
