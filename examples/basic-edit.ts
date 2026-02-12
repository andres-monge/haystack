/**
 * Basic example of using the Haystack pipeline.
 *
 * Usage:
 *   export GOOGLE_API_KEY="your-api-key"
 *   npx tsx examples/basic-edit.ts path/to/artwork.png [hour]
 *
 * Arguments:
 *   image_path  Path to the base artwork image (PNG, JPEG, or WebP)
 *   hour        Optional hour (0-23) to simulate. Defaults to 18 (evening).
 */

import { Pipeline, createScenarioFromHour } from "../src/index.js";

async function main(): Promise<void> {
  const imagePath = process.argv[2];
  const hour = process.argv[3] ? parseInt(process.argv[3], 10) : 18;

  if (!imagePath) {
    console.log("Usage: npx tsx examples/basic-edit.ts <image_path> [hour]");
    process.exit(1);
  }

  const pipeline = new Pipeline();
  const scenario = createScenarioFromHour(hour);

  console.log(`Generating for hour ${hour}...`);

  const result = await pipeline.generate(imagePath, scenario);

  console.log(`Done! Output: ${result.imagePath}`);
  console.log(`Prompt used:\n${result.metadata.prompt}`);
}

main().catch(console.error);
