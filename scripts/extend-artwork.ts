#!/usr/bin/env npx tsx

// scripts/extend-artwork.ts — Reimagine any image as 16:9 landscape via Gemini outpainting

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { GeminiClient } from "../src/engine/gemini-client.js";
import { loadConfigFromEnv } from "../src/config/config.js";

const CLEANUP_PROMPT = `Remove any Instagram or social media UI overlays from this image.
This includes: navigation arrows (< >) on the left and right edges, pagination
dots or circles at the bottom, like/comment/share icons, username overlays,
and any other semi-transparent UI elements. Replace the removed areas with a
natural continuation of the underlying artwork. Do NOT change the art style,
composition, or any actual content of the image — only remove the UI overlays.
If there are no overlays present, return the image unchanged.`;

const DEFAULT_PROMPT = `Seamlessly extend this artwork to a wide 16:9 landscape. The existing edges
must continue naturally with no visible seam — elements at the boundaries
(trees, buildings, terrain) should flow uninterrupted into the new space.
Expand by revealing more of the same scene, not by generating new disconnected
content. Preserve the EXACT artistic style, medium, color palette, and lighting
throughout.`;

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// --- Helpers ---

/** Detect HEIC format by checking for 'ftyp' at offset 4. */
function isHeic(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  return (
    buffer[4] === 0x66 && // f
    buffer[5] === 0x74 && // t
    buffer[6] === 0x79 && // y
    buffer[7] === 0x70    // p
  );
}

/** Derive output filename: strip extension and existing `-landscape` suffix, append `-landscape.png`. */
function deriveOutputName(inputPath: string): string {
  const stem = path.basename(inputPath, path.extname(inputPath)).replace(/-landscape$/i, "");
  return `${stem}-landscape.png`;
}

// --- Main ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error("Usage: npx tsx scripts/extend-artwork.ts <image_path> [custom_prompt]");
    console.error("  image_path:     Path to the source image (JPEG, PNG, or WebP)");
    console.error("  custom_prompt:  Optional prompt override for the outpainting");
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const customPrompt = args.slice(1).join(" ") || undefined;

  // --- Validate input file ---

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: file not found: ${inputPath}`);
    process.exit(1);
  }

  const inputBuffer = fs.readFileSync(inputPath);

  if (isHeic(inputBuffer)) {
    console.error("Error: HEIC format is not supported by Gemini. Convert first:");
    console.error(`  sips -s format jpeg "${inputPath}" --out "${inputPath.replace(/\.heic$/i, ".jpg")}"`);
    process.exit(1);
  }

  const ext = path.extname(inputPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    console.error(`Error: unsupported format "${ext}". Supported: JPEG, PNG, WebP`);
    process.exit(1);
  }

  // --- Validate config ---

  const config = loadConfigFromEnv();

  if (!config.googleApiKey) {
    console.error("Error: GOOGLE_API_KEY or GEMINI_API_KEY environment variable is required");
    process.exit(1);
  }

  if (!config.imageDir) {
    console.error("Error: HAYSTACK_IMAGE_DIR environment variable is required");
    console.error("  Set it in .env.local to the folder where base artworks are stored");
    process.exit(1);
  }

  fs.mkdirSync(config.imageDir, { recursive: true });

  // --- Call Gemini ---

  const prompt = customPrompt ?? DEFAULT_PROMPT;
  const client = new GeminiClient(config.googleApiKey);

  console.error(`Model: ${config.extendModel}`);
  console.error(`Input: ${inputPath}`);

  // --- Step 1: Clean Instagram UI overlays ---

  console.error("Step 1/2: Cleaning social media overlays...");

  const cleanResult = await client.editImage(inputBuffer, CLEANUP_PROMPT, {
    model: config.extendModel,
  });

  const cleanedBuffer = cleanResult.imageBuffer;
  console.error("  Cleanup complete.");

  // --- Step 2: Extend to 16:9 landscape ---

  console.error(`Step 2/2: Extending to 16:9 landscape...`);
  console.error(`Prompt: ${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}`);

  const result = await client.editImage(cleanedBuffer, prompt, {
    model: config.extendModel,
    aspectRatio: "16:9",
    imageSize: "2K",
  });

  // --- Write output ---

  const outputName = deriveOutputName(inputPath);
  const outputPath = path.join(config.imageDir, outputName);

  fs.writeFileSync(outputPath, result.imageBuffer);

  // --- Open in Preview (best-effort) ---

  try {
    execFileSync("open", [outputPath], { stdio: "ignore" });
  } catch {
    console.error(`(Could not open Preview — file saved at ${outputPath})`);
  }

  // --- Print result to stdout (for skill to parse) ---

  const output = {
    outputPath,
    model: config.extendModel,
    modelVersion: result.modelVersion,
    responseText: result.responseText,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);

  if (msg.includes("IMAGE_OTHER") || msg.includes("image_other")) {
    console.error("Error: Gemini rejected the image (likely copyright/IP concern).");
    console.error("  Try a different source image or one with a less recognizable subject.");
    process.exit(1);
  }

  if (msg.includes("SAFETY") || msg.includes("safety")) {
    console.error(`Error: Gemini safety filter triggered — ${msg}`);
    process.exit(1);
  }

  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("RESOURCE_EXHAUSTED")) {
    console.error("Error: Gemini rate limit hit. Wait a moment and retry.");
    process.exit(1);
  }

  if (msg.includes("timed out")) {
    console.error("Error: Gemini API call timed out (60s). Try again.");
    process.exit(1);
  }

  console.error(`Fatal: ${msg}`);
  process.exit(1);
});
