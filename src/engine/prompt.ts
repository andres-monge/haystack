import type { Scenario, PromptConfig } from "./types.js";
import { describeScenario } from "./scenario.js";

export const DEFAULT_TEMPLATE = `Outcome:
Tell an interesting story within this artwork that makes the viewer do a double take and wonder what is going on. Something genuinely interesting should be happening, not merely an ordinary everyday activity. Invent the situation freely based on the artwork, time, and weather. When the weather offers an interesting opportunity, let it influence what is happening rather than only changing the scene's appearance. Arrange the action compellingly within the artwork's existing composition.

Current conditions: {scenario}

Preservation invariants:
- Preserve the EXACT artistic style, medium, and rendering technique of the original
- Keep the permanent setting, architecture, signage, furniture, vehicles, and environment layout identical
- Do NOT change the camera angle, framing, scale, or composition
- People, animals, and temporary objects may change as needed for the new moment, but place them only where physically plausible
- Do NOT add modern or anachronistic elements
- Do NOT add text, watermarks, or UI elements

Lighting and weather:
- When a Solar visual target is present, it is authoritative for lighting and sky only — including sky color, ambient brightness, and whether the scene reads as daylight, twilight, or night; otherwise use the available clock and day/night state.
- Establish the sky and ambient illumination from the Solar visual target when present; otherwise use the clock and day/night state. Treat a supplied physical solar phase as authoritative rather than inferring a generic mood from the clock time.
- Apply the current weather and atmospheric visibility to that solar state. Lighting must be physically consistent with the time of day and weather, and weather should affect the scene naturally.

Interpreting the lighting data (use these as continuous scales, not categories):
- shadow_ratio: shadow length as a multiple of object height. 1× = shadows same length as object (45° sun). 3× = long afternoon shadows. 10×+ = extremely long shadows near sunrise/sunset. Apply this ratio to all cast shadows in the scene.
- direct_fraction (0–1): how directional vs diffuse the light is. Near 1.0 = crisp hard-edged shadows, strong highlights, high contrast (clear sun). Near 0.0 = soft shadowless light, low contrast (overcast or twilight). This controls shadow edge sharpness and scene contrast continuously.
- Sun elevation: negative = below horizon (night). As elevation drops toward 0°, sunlight passes through more atmosphere — direct light warms gradually from neutral white (~5500K) toward orange (~2500K near horizon). Only render a visible sun disk if elevation is very low and it would naturally appear in-frame.
- Set overall exposure from the Solar visual target when present, or from the available day/night state otherwise. Use radiation values only to refine light direction and softness within that phase; low late-day radiation does not by itself make an above-horizon scene look like night.
- Visibility (meters): lower visibility = paler/whiter sky near horizon, atmospheric haze softens distant objects, more glow around light sources.
- Moon illuminated %: 0% = new moon (very dark night), 100% = full moon (bright silvery nightscape).`;

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
