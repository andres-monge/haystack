// src/engine/prompt.ts — Prompt composition for Gemini image editing

import type { Scenario, PromptConfig } from "./types.js";
import { describeScenario } from "./scenario.js";

export const DEFAULT_TEMPLATE = `Using the provided artwork, reimagine this scene at the current moment in time — as if the painting were a living world that changes with the hour and weather.

Time: {scenario}

The setting, architecture, and environment are permanent — but the scene is alive. People and animals go about their day naturally for this time and weather. Consider who would be here now, what they would be doing, how the light falls at this hour, and how people would be dressed for the current conditions.

Interpreting the lighting data (use these as continuous scales, not categories):
- shadow_ratio: shadow length as a multiple of object height. 1× = shadows same length as object (45° sun). 3× = long afternoon shadows. 10×+ = extremely long shadows near sunrise/sunset. Apply this ratio to all cast shadows in the scene.
- direct_fraction (0–1): how directional vs diffuse the light is. Near 1.0 = crisp hard-edged shadows, strong highlights, high contrast (clear sun). Near 0.0 = soft shadowless light, low contrast (overcast or twilight). This controls shadow edge sharpness and scene contrast continuously.
- Sun elevation: negative = below horizon (night). As elevation drops toward 0°, sunlight passes through more atmosphere — direct light warms gradually from neutral white (~5500K) toward orange (~2500K near horizon). Only render a visible sun disk if elevation is very low and it would naturally appear in-frame.
- Direct radiation (W/m²): scene brightness scales with total radiation (direct + diffuse). Clear-sky peak is roughly 1000 W/m². 0 = no direct sunlight (night or dense cloud).
- Visibility (meters): lower visibility = paler/whiter sky near horizon, atmospheric haze softens distant objects, more glow around light sources.
- Moon illuminated %: 0% = new moon (very dark night), 100% = full moon (bright silvery nightscape). Only relevant at night.

Rules:
- Preserve the EXACT artistic style, medium, and rendering technique of the original
- Keep the architecture, signage, furniture, vehicles, and environment layout identical
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
