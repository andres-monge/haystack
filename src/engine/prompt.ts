// src/engine/prompt.ts — Prompt composition for Gemini image editing

import type { Scenario, PromptConfig } from "./types.js";
import { describeScenario } from "./scenario.js";

export const DEFAULT_TEMPLATE = `Transform this artwork to reflect the current moment:

Time: {scenario}

Guidelines:
- Adjust lighting naturally (sun position, shadows, ambient light)
- If the scene has artificial light sources (lamps, candles), light them appropriately for the time
- Maintain the original composition and subjects
- Preserve the artistic style of the original
- Make changes subtle and atmospheric, not dramatic
- If night: add moonlight, starlight, or warm indoor lighting
- If day: adjust sun position and shadow direction
- Do not add new objects, people, or text
- Preserve the original scale, framing, and composition exactly`;

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  template: DEFAULT_TEMPLATE,
};

/**
 * Compose the full prompt from scenario and config.
 * Replaces {scenario} in the template with a human-readable scenario description,
 * and appends extraContext if provided.
 */
export function composePrompt(
  scenario: Scenario,
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
): string {
  const scenarioDescription = describeScenario(scenario);
  let prompt = config.template.replace("{scenario}", scenarioDescription);

  if (config.extraContext) {
    prompt += `\n\nAdditional context: ${config.extraContext}`;
  }

  return prompt;
}
