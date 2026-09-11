#!/usr/bin/env npx tsx

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import * as os from "node:os";
import * as path from "node:path";
import { loadConfigFromEnv, toProviderFactoryConfig } from "../src/config/index.js";
import {
  createStoryEvaluationPreview,
  formatStoryEvaluationPreview,
  runStoryEvaluation,
} from "../src/evaluation/story-evaluation.js";
import { createProviderRegistry } from "../src/engine/provider-factory.js";

function usage(): string {
  return [
    "Usage:",
    "  npm run evaluate:stories",
    "  npm run evaluate:stories -- --execute",
    "",
    "Preview is the default and makes zero provider requests.",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!(args.length === 0 || (args.length === 1 && args[0] === "--execute"))) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const config = loadConfigFromEnv();
  const registry = createProviderRegistry(toProviderFactoryConfig(config));
  const preview = createStoryEvaluationPreview({
    registry,
    aspectRatio: config.defaultAspectRatio,
  });

  if (args.length === 0) {
    console.log(formatStoryEvaluationPreview(preview));
    return;
  }

  const result = await runStoryEvaluation({
    repoRoot: process.cwd(),
    evaluationRoot: path.join(os.homedir(), ".haystack", "story-evaluations"),
    registry,
    aspectRatio: config.defaultAspectRatio,
  });
  const successful = result.manifest.cells.filter(cell => cell.status === "successful").length;
  const unsuccessful = result.manifest.cells.filter(cell => cell.status === "unsuccessful").length;
  const pending = result.manifest.cells.filter(cell => cell.status === "pending").length;
  console.log(`Run directory: ${result.runDir}`);
  console.log(`Manifest: ${result.manifestPath}`);
  console.log(`Review checklist: ${result.checklistPath}`);
  console.log(`Gallery: ${result.galleryPath}`);
  console.log(`Operational readiness: ${result.manifest.operationalReadiness}`);
  console.log(`Status: successful=${successful} unsuccessful=${unsuccessful} pending=${pending}`);
}

main().catch(() => {
  console.error("Story prompt evaluation failed. No provider response details were printed.");
  process.exitCode = 1;
});
