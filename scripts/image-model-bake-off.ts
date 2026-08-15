#!/usr/bin/env npx tsx

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  preflightRound1,
  resolveRound1RunDirectory,
  runRound1,
  type PreflightIssue,
} from "../src/comparison/bake-off.js";
import {
  createRound1Providers,
  ROUND1_PROVIDER_SPECS,
} from "../src/comparison/providers.js";
import { writeFixtureGallery } from "../src/comparison/gallery.js";
import { loadComparisonKeysFromEnv } from "../src/config/config.js";
import type { ComparisonProvider } from "../src/comparison/types.js";

const repoRoot = process.cwd();
const comparisonRoot = path.join(os.homedir(), ".haystack", "comparisons");

const REPLAY_PROVIDER_CATALOG: readonly ComparisonProvider[] = Object.values(
  ROUND1_PROVIDER_SPECS,
).map(spec => ({
  provider: spec.provider,
  model: spec.model,
  outputSetting: spec.outputSetting,
  editImage: async () => { throw new Error("Replay provider must not be called"); },
}));

function usage(): string {
  return [
    "Usage:",
    "  npm run compare:images",
    "  npm run compare:images -- --fixture",
    "  npm run compare:images -- --execute round1 --run-id <safe-id>",
  ].join("\n");
}

function safeIssue(issue: PreflightIssue): string {
  if (issue.provider && issue.model) {
    return `${issue.provider}/${issue.model}: ${issue.reason}`;
  }
  return `${issue.artworkId ?? "input"}: ${issue.reason}`;
}

async function runPreflight(): Promise<boolean> {
  const report = await preflightRound1({
    repoRoot,
    keys: loadComparisonKeysFromEnv(),
  });
  if (report.ready) {
    console.log("Round 1 preflight: ready (Gemini, OpenAI, xAI; 18 planned calls)");
    return true;
  }
  console.error("Round 1 preflight: not ready");
  for (const issue of report.unavailable) console.error(`- ${safeIssue(issue)}`);
  return false;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    if (!await runPreflight()) process.exitCode = 1;
    return;
  }

  if (args.length === 1 && args[0] === "--fixture") {
    const result = writeFixtureGallery(
      path.join(comparisonRoot, "fixture-round1"),
    );
    console.log(`Fixture gallery: ${result.galleryPath}`);
    return;
  }

  if (
    args.length === 4
    && args[0] === "--execute"
    && args[1] === "round1"
    && args[2] === "--run-id"
  ) {
    const runId = args[3];
    const runDirectory = resolveRound1RunDirectory(comparisonRoot, runId);
    const existingManifest = path.join(runDirectory, "manifest.json");
    let providers: readonly ComparisonProvider[];

    // The core runner checks existing state before reading inputs or invoking an
    // adapter. Avoid remote preflight too, so a same-ID replay makes zero calls.
    if (fs.existsSync(existingManifest)) {
      providers = REPLAY_PROVIDER_CATALOG;
    } else {
      if (!await runPreflight()) {
        process.exitCode = 1;
        return;
      }
      providers = createRound1Providers(loadComparisonKeysFromEnv());
    }

    const result = await runRound1({
      repoRoot,
      comparisonRoot,
      runId,
      providers,
    });
    const counts = {
      successful: result.manifest.cells.filter(cell => cell.status === "successful").length,
      unsuccessful: result.manifest.cells.filter(cell => cell.status === "unsuccessful").length,
      error: result.manifest.cells.filter(cell => cell.status === "error").length,
    };
    console.log(`Run directory: ${result.runDir}`);
    console.log(`Manifest: ${result.manifestPath}`);
    console.log(`Gallery: ${result.galleryPath}`);
    console.log(`Status: successful=${counts.successful} unsuccessful=${counts.unsuccessful} error=${counts.error}`);
    if (result.replayed) console.log("Replay: no provider calls made");
    return;
  }

  console.error(usage());
  process.exitCode = 1;
}

main().catch(() => {
  console.error("Image model bake-off failed. No provider response details were printed.");
  process.exitCode = 1;
});
