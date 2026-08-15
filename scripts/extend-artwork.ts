#!/usr/bin/env npx tsx

// scripts/extend-artwork.ts — CLI for provider-neutral two-stage outpainting

import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  loadConfigFromEnv,
  toProviderFactoryConfig,
} from "../src/config/config.js";
import {
  DEFAULT_EXTEND_PROMPT,
  ExtendArtworkError,
  createProductionExtendArtworkService,
} from "../src/engine/extend-artwork.js";
import { GenerationLockBusyError } from "../src/engine/generation-lock.js";
import {
  ProviderChainExhaustedError,
  ProviderChainTerminatedError,
} from "../src/engine/provider-chain.js";

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

class ExtendArtworkCliError extends Error {
  constructor(readonly safeMessage: string) {
    super("Extend-artwork command failed");
    this.name = "ExtendArtworkCliError";
  }
}

/** Detect HEIC format by checking for `ftyp` at offset four. */
function isHeic(buffer: Buffer): boolean {
  return buffer.length >= 12
    && buffer.subarray(4, 8).toString("ascii") === "ftyp";
}

function inputFromArgs(args: readonly string[]): {
  inputPath: string;
  prompt: string;
} {
  if (args.length < 1) {
    throw new ExtendArtworkCliError(
      "Usage: npx tsx scripts/extend-artwork.ts <image_path> [custom_prompt]",
    );
  }
  const inputPath = path.resolve(args[0]);
  if (!fs.existsSync(inputPath)) {
    throw new ExtendArtworkCliError(`File not found: ${inputPath}`);
  }
  const inputBuffer = fs.readFileSync(inputPath);
  if (isHeic(inputBuffer)) {
    const convertedPath = inputPath.replace(/\.heic$/i, ".jpg");
    throw new ExtendArtworkCliError(
      `HEIC is not supported. Convert first with: sips -s format jpeg "${inputPath}" --out "${convertedPath}"`,
    );
  }
  const extension = path.extname(inputPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new ExtendArtworkCliError(
      `Unsupported image format "${extension}". Supported: JPEG, PNG, WebP`,
    );
  }
  return {
    inputPath,
    prompt: args.slice(1).join(" ").trim() || DEFAULT_EXTEND_PROMPT,
  };
}

export async function runExtendArtworkCli(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const { inputPath, prompt } = inputFromArgs(args);
  let config: ReturnType<typeof loadConfigFromEnv>;
  try {
    config = loadConfigFromEnv();
  } catch {
    throw new ExtendArtworkCliError(
      "Direct-provider configuration is invalid. Check provider keys, HAYSTACK_IMAGE_PROVIDER_ORDER, and stable model IDs in .env.local.",
    );
  }
  if (!config.imageDir) {
    throw new ExtendArtworkCliError(
      "HAYSTACK_IMAGE_DIR is required. Set it to the artwork rotation folder in .env.local.",
    );
  }

  console.error(`Providers: ${config.imageProviderOrder.join(" -> ")}`);
  console.error(`Input: ${inputPath}`);
  console.error("Running cleanup, then 16:9 outpainting...");

  const service = createProductionExtendArtworkService(
    { imageDir: config.imageDir, outputDir: config.outputDir },
    toProviderFactoryConfig(config),
    {
      terminalEventSink: event => {
        // Keep stdout machine-readable while retaining one sanitized event per stage.
        console.error(`[haystack:generation] ${JSON.stringify(event)}`);
        if (event.outcome === "successful") {
          console.error(`  ${event.stage} succeeded with ${event.winner}.`);
        }
      },
    },
  );
  const result = await service.extend(inputPath, prompt);

  try {
    execFileSync("open", [result.outputPath], { stdio: "ignore" });
  } catch {
    console.error(`(Could not open Preview; file saved at ${result.outputPath})`);
  }

  // ProviderChain ledgers are already allowlisted and sanitized. Never include
  // credentials, raw provider bodies, authorization headers, or image bytes.
  console.log(JSON.stringify(result, null, 2));
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof ExtendArtworkCliError) return error.safeMessage;
  if (error instanceof GenerationLockBusyError) {
    return "Another image generation is already in progress. Wait for it to finish and retry.";
  }
  if (error instanceof ProviderChainExhaustedError) {
    const summary = error.run.attempts
      .map(attempt => `${attempt.provider}:${attempt.outcome}`)
      .join(", ");
    return `All configured providers were exhausted during ${error.run.stage}${summary ? ` (${summary})` : ""}. No artwork was published.`;
  }
  if (error instanceof ProviderChainTerminatedError) {
    if (error.outcome === "caller_cancelled") {
      return "Artwork extension was cancelled. No artwork was published.";
    }
    if (error.outcome === "chain_deadline") {
      return `The provider chain deadline expired during ${error.run.stage}. No artwork was published.`;
    }
    return `Artwork extension stopped during ${error.run.stage}. No artwork was published.`;
  }
  if (error instanceof ExtendArtworkError) {
    if (error.safeCode === "output_exists") {
      return "A matching -landscape image or sidecar already exists. Keep it, or remove the committed image and sidecar together before retrying.";
    }
    if (error.safeCode === "storage_failed") {
      return "The final artwork could not be published. If a matching -landscape output already exists, keep it or remove its image and sidecar together before retrying.";
    }
    if (error.safeCode === "source_read_failed") {
      return "The source image could not be read. Check its path and permissions.";
    }
    if (error.safeCode === "source_validation_failed") {
      return "The source is not a valid supported JPEG, PNG, or WebP image.";
    }
    return "Artwork extension failed locally. No artwork was published.";
  }
  return "Artwork extension failed unexpectedly. No artwork was published.";
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  runExtendArtworkCli().catch((error: unknown) => {
    console.error(`Error: ${safeFailureMessage(error)}`);
    process.exitCode = 1;
  });
}
