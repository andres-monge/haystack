#!/usr/bin/env node

// src/cli/generate.ts — CLI entry point for scheduled generation (launchd)

import * as fs from "node:fs";
import {
  Pipeline,
  createScenarioFromHour,
  createScenarioFromNow,
} from "../index.js";
import { loadConfigFromEnv, toPipelineConfig } from "../config/index.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error("Usage: haystack-generate <image_path> [hour]");
    console.error("  image_path: Path to the base artwork");
    console.error(
      "  hour: Optional hour (0-23) to simulate. Defaults to current time.",
    );
    process.exit(1);
  }

  const imagePath = args[0];

  if (!fs.existsSync(imagePath)) {
    console.error(`Error: image file not found: ${imagePath}`);
    process.exit(1);
  }

  const hourRaw = args[1] ? Number(args[1]) : undefined;

  if (
    hourRaw !== undefined &&
    (!Number.isInteger(hourRaw) || hourRaw < 0 || hourRaw > 23)
  ) {
    console.error("Error: hour must be an integer between 0 and 23");
    process.exit(1);
  }

  const config = loadConfigFromEnv();

  if (!config.googleApiKey) {
    console.error(
      "Error: GOOGLE_API_KEY or GEMINI_API_KEY environment variable is required",
    );
    process.exit(1);
  }

  const pipeline = new Pipeline(toPipelineConfig(config), config.googleApiKey);

  const scenario =
    hourRaw !== undefined
      ? createScenarioFromHour(hourRaw)
      : createScenarioFromNow();

  console.log(`Generating for: hour=${scenario.hour}, isDay=${scenario.isDay}`);
  console.log(`Base image: ${imagePath}`);

  const result = await pipeline.generate(imagePath, scenario);

  console.log(`\nGenerated: ${result.imagePath}`);
  console.log(`Model: ${result.metadata.model}`);
  if (result.metadata.responseText) {
    console.log(`Response: ${result.metadata.responseText}`);
  }
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
