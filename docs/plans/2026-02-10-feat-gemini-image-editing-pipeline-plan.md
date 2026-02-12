---
title: "Gemini Image Editing Pipeline (Phase A1)"
type: feat
date: 2026-02-10
phase: A1
project: Living Art Wallpaper
---

# Gemini Image Editing Pipeline (Phase A1)

## Overview

Build the core engine that takes a base artwork image and produces an edited output using Google's Gemini image editing API. This is the foundational component that all other phases depend on.

**Scope:** A focused, modular pipeline that:
1. Accepts a base image + scenario context + prompt configuration
2. Calls Gemini's image editing API
3. Returns the edited image + metadata

**Out of scope for A1:**
- Smart extend/outpainting (separate milestone)
- Weather API integration (A5)
- Lab UI (A3)
- Wallpaper application (A2)
- Scheduling (A4)

## Problem Statement

The Living Art Wallpaper needs a reliable, testable core engine that can transform artwork based on time/weather context. Without this foundation, none of the higher-level features can be built. The engine must be designed for:

1. **Rapid iteration** - developers need to test prompts quickly
2. **Reproducibility** - same inputs should produce consistent-ish outputs
3. **Observability** - every generation should be logged with metadata
4. **Modularity** - easy to swap models or add preprocessing steps later
5. **Phase alignment** - code should be reusable in Phase B (Electron) and Phase C (kiosk server)

## Technical Approach

### Technology Stack

**TypeScript + Node.js** is the recommended choice because:

| Factor | TypeScript | Python |
|--------|------------|--------|
| **Gemini SDK** | `@google/genai` - equally capable | `google-genai` |
| **Type safety** | Built-in, enforced at compile time | Optional (mypy) |
| **AI-assisted dev** | Better - types guide completions | Good |
| **Lab UI (A3)** | Same codebase (Vite + React) | Separate Flask server |
| **Phase B** | Same code in Electron | Call via subprocess |
| **Phase C** | Express.js serves kiosk | Separate server |

**Key benefits for future phases:**
- **Phase A3 (Lab UI)**: Engine runs server-side; Lab UI communicates via local HTTP or CLI (see [A3 architecture note](#a3-architecture-note) below)
- **Phase B (Menu Bar)**: Electron app uses the same TypeScript engine in the main process
- **Phase C (Kiosk)**: Express.js server is trivial to add, serves images + manifest

### Gemini API Details

**Models available:**
| Model | ID | Output Resolution (varies by aspect ratio) | Speed | Use Case |
|-------|-----|----------------------------------------------|-------|----------|
| Nano Banana | `gemini-2.5-flash-image` | ~1K class (e.g. 16:9 → 1344x768) | Fast | Hourly updates, iteration |
| Nano Banana Pro | `gemini-3-pro-image-preview` | Up to 4K (e.g. 16:9 at 4K → 5504x3072) | Slower | Final wallpaper quality |

> **Note:** Output resolution depends on the chosen aspect ratio, not a fixed pixel cap. All Flash Image outputs cost 1290 tokens regardless of aspect ratio.

**Image editing approach:**
```typescript
import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";

const ai = new GoogleGenAI({});

const imageData = fs.readFileSync("artwork.png");
const base64Image = imageData.toString("base64");

const response = await ai.models.generateContent({
  model: "gemini-2.5-flash-image",
  contents: [
    { text: "Edit this image to show evening light, warm colors, candles lit" },
    {
      inlineData: {
        mimeType: "image/png",
        data: base64Image,
      },
    },
  ],
  config: {
    responseModalities: ["TEXT", "IMAGE"],
    // aspectRatio is optional — omit to match the input image's ratio
  },
});

// Extract image from response
for (const part of response.candidates[0].content.parts) {
  if (part.inlineData) {
    const buffer = Buffer.from(part.inlineData.data, "base64");
    fs.writeFileSync("output.png", buffer);
  }
}
```

**Pricing:** ~$0.039/image for gemini-2.5-flash-image (1290 output tokens per image). At 24 images/day (hourly) that's ~$28/month. No free tier for Flash Image — a paid API key is needed from day one.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Engine Module                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │   Scenario  │   │    Prompt    │   │     Gemini      │  │
│  │   Builder   │──▶│   Composer   │──▶│     Client      │  │
│  └─────────────┘   └──────────────┘   └────────┬────────┘  │
│         ▲                                       │           │
│         │                                       ▼           │
│  ┌──────┴──────┐                       ┌───────────────┐   │
│  │   Scenario  │                       │    Output     │   │
│  │    Input    │                       │    Store      │   │
│  │ (time/weather)                      │  (files+meta) │   │
│  └─────────────┘                       └───────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Phase Alignment:
┌─────────────────────────────────────────────────────────────┐
│  Phase A1: Engine (this plan)                               │
│  Phase A3: Lab UI ← local HTTP server or Electron shell *   │
│  Phase A4: CLI wrapper calls engine, launchd runs CLI       │
│  Phase B:  Electron app bundles engine                      │
│  Phase C:  Express server uses engine + serves to kiosk     │
└─────────────────────────────────────────────────────────────┘
* See A3 Architecture Note below
```

## Files to Create

```
haystack/
├── src/
│   ├── engine/
│   │   ├── index.ts           # Public exports
│   │   ├── pipeline.ts        # Main pipeline orchestration
│   │   ├── gemini-client.ts   # Gemini API wrapper
│   │   ├── prompt.ts          # Prompt composition logic
│   │   ├── scenario.ts        # Scenario data structures
│   │   └── types.ts           # Shared type definitions
│   ├── storage/
│   │   ├── index.ts           # Public exports
│   │   └── output-store.ts    # File + metadata storage
│   ├── config/
│   │   ├── index.ts           # Public exports
│   │   └── config.ts          # Configuration management
│   ├── cli/
│   │   └── generate.ts        # CLI entry point for launchd
│   └── index.ts               # Main package export
├── tests/
│   ├── engine/
│   │   ├── pipeline.test.ts
│   │   ├── gemini-client.test.ts
│   │   ├── prompt.test.ts
│   │   └── scenario.test.ts
│   └── storage/
│       └── output-store.test.ts
├── examples/
│   └── basic-edit.ts          # Simple usage example
├── package.json
├── tsconfig.json
├── vitest.config.ts           # Test configuration
├── .env.example
└── README.md
```

## Implementation Details

### 1. Type Definitions

```typescript
// src/engine/types.ts

export interface Scenario {
  timestampLocal: Date;
  hour: number; // 0-23
  isDay: boolean;

  // Weather (optional, from A5)
  weatherCode?: number;
  cloudPercent?: number;
  precipPercent?: number;

  // Sun position (optional)
  sunrise?: Date;
  sunset?: Date;
}

/**
 * JSON-safe version of Scenario for metadata storage.
 * Dates are serialized as ISO strings so types match reality after JSON round-trips.
 */
export interface SerializedScenario {
  timestampLocal: string; // ISO 8601
  hour: number;
  isDay: boolean;
  weatherCode?: number;
  cloudPercent?: number;
  precipPercent?: number;
  sunrise?: string; // ISO 8601
  sunset?: string;  // ISO 8601
}

export type AspectRatio =
  | "1:1" | "16:9" | "9:16"
  | "4:3" | "3:4" | "3:2" | "2:3"
  | "4:5" | "5:4" | "21:9";

export interface GeminiConfig {
  model: "gemini-2.5-flash-image" | "gemini-3-pro-image-preview";
  /** Optional — omit to let the API match the input image's aspect ratio. */
  aspectRatio?: AspectRatio;
  imageSize?: "1K" | "2K" | "4K"; // Only for pro model
  /** Optional seed for more reproducible outputs. */
  seed?: number;
}

export interface PromptConfig {
  template: string;
  extraContext?: string;
}

export interface RenderMetadata {
  id: string;
  artworkSource: string;
  scenario: SerializedScenario; // JSON-safe, uses strings not Dates
  prompt: string;
  model: string;
  createdAt: string;
  outputPath: string;
  responseText?: string;
  seed?: number;

  // Observability — captured from the API response
  responseId?: string;
  modelVersion?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  finishReason?: string;
}

export interface GenerateResult {
  metadata: RenderMetadata;
  imagePath: string;
  imageBuffer: Buffer;
}

export interface PipelineConfig {
  outputDir: string;
  maxOutputs: number;
  geminiConfig: GeminiConfig;
  promptConfig: PromptConfig;
}

/**
 * Convert a runtime Scenario (with Date objects) to a JSON-safe SerializedScenario.
 */
export function serializeScenario(scenario: Scenario): SerializedScenario {
  return {
    ...scenario,
    timestampLocal: scenario.timestampLocal.toISOString(),
    sunrise: scenario.sunrise?.toISOString(),
    sunset: scenario.sunset?.toISOString(),
  };
}
```

### 2. Scenario Builder

```typescript
// src/engine/scenario.ts

import type { Scenario } from "./types.js";

/**
 * Create a scenario from just an hour (for testing/manual overrides)
 */
export function createScenarioFromHour(hour: number, isDay?: boolean): Scenario {
  const autoIsDay = isDay ?? (hour >= 6 && hour <= 20);

  return {
    timestampLocal: new Date(),
    hour,
    isDay: autoIsDay,
  };
}

/**
 * Create a scenario from current time
 */
export function createScenarioFromNow(): Scenario {
  const now = new Date();
  const hour = now.getHours();

  return {
    timestampLocal: now,
    hour,
    isDay: hour >= 6 && hour <= 20,
  };
}

/**
 * Generate human-readable description for prompt composition
 */
export function describeScenario(scenario: Scenario): string {
  const timeOfDay = getTimeOfDayDescription(scenario.hour);
  const weather = getWeatherDescription(scenario.weatherCode);

  return `${timeOfDay}${weather}`;
}

function getTimeOfDayDescription(hour: number): string {
  if (hour >= 5 && hour < 7) return "early morning, dawn breaking";
  if (hour >= 7 && hour < 12) return "morning, bright daylight";
  if (hour >= 12 && hour < 14) return "midday, sun high overhead";
  if (hour >= 14 && hour < 17) return "afternoon, warm light";
  if (hour >= 17 && hour < 20) return "evening, golden hour, sunset";
  if (hour >= 20 && hour < 22) return "dusk, twilight";
  return "night, darkness, moonlight";
}

function getWeatherDescription(weatherCode?: number): string {
  if (weatherCode === undefined) return "";

  // WMO weather codes (used by Open-Meteo)
  const weatherMap: Record<number, string> = {
    0: ", clear sky",
    1: ", mainly clear",
    2: ", partly cloudy",
    3: ", overcast",
    45: ", foggy",
    48: ", foggy with frost",
    51: ", light drizzle",
    61: ", light rain",
    63: ", moderate rain",
    65: ", heavy rain",
    71: ", light snow",
    73: ", moderate snow",
    95: ", thunderstorm",
  };

  return weatherMap[weatherCode] ?? "";
}
```

### 3. Prompt Composition

```typescript
// src/engine/prompt.ts

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
 * Compose the full prompt from scenario and config
 */
export function composePrompt(scenario: Scenario, config: PromptConfig = DEFAULT_PROMPT_CONFIG): string {
  const scenarioDescription = describeScenario(scenario);
  let prompt = config.template.replace("{scenario}", scenarioDescription);

  if (config.extraContext) {
    prompt += `\n\nAdditional context: ${config.extraContext}`;
  }

  return prompt;
}
```

### 4. Gemini Client Wrapper

```typescript
// src/engine/gemini-client.ts

import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import type { GeminiConfig } from "./types.js";

export interface EditImageResult {
  imageBuffer: Buffer;
  responseText?: string;
  // Observability fields from the API response
  responseId?: string;
  modelVersion?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  finishReason?: string;
}

export const DEFAULT_GEMINI_CONFIG: GeminiConfig = {
  model: "gemini-2.5-flash-image",
  // aspectRatio intentionally omitted — API will match input image's ratio
};

export class GeminiClient {
  private client: GoogleGenAI;

  constructor(apiKey?: string) {
    // Only pass apiKey when explicitly provided, so the SDK can fall back
    // to GOOGLE_API_KEY / GEMINI_API_KEY from environment automatically.
    this.client = new GoogleGenAI(apiKey ? { apiKey } : {});
  }

  /**
   * Edit an image based on a text prompt
   */
  async editImage(
    imageInput: Buffer | string,
    prompt: string,
    config: GeminiConfig = DEFAULT_GEMINI_CONFIG
  ): Promise<EditImageResult> {
    // Handle file path or buffer
    const imageBuffer = typeof imageInput === "string"
      ? fs.readFileSync(imageInput)
      : imageInput;

    const base64Image = imageBuffer.toString("base64");
    const mimeType = this.detectMimeType(imageBuffer);

    // Build imageConfig only with fields that are set
    const imageConfig: Record<string, unknown> = {};
    if (config.aspectRatio) {
      imageConfig.aspectRatio = config.aspectRatio;
    }
    if (config.imageSize && config.model.includes("pro")) {
      imageConfig.imageSize = config.imageSize;
    }

    const response = await this.client.models.generateContent({
      model: config.model,
      contents: [
        { text: prompt },
        {
          inlineData: {
            mimeType,
            data: base64Image,
          },
        },
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
        ...(config.seed !== undefined ? { seed: config.seed } : {}),
      },
    });

    let resultBuffer: Buffer | null = null;
    let resultText: string | undefined;

    const candidate = response.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.text) {
        resultText = part.text;
      } else if (part.inlineData) {
        resultBuffer = Buffer.from(part.inlineData.data, "base64");
      }
    }

    if (!resultBuffer) {
      throw new Error("Gemini did not return an image");
    }

    return {
      imageBuffer: resultBuffer,
      responseText: resultText,
      // Capture observability data from the response
      responseId: (response as any).responseId,
      modelVersion: (response as any).modelVersion,
      usageMetadata: (response as any).usageMetadata,
      finishReason: candidate?.finishReason,
    };
  }

  private detectMimeType(buffer: Buffer): string {
    // Check magic bytes
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
    // WebP: must match full "RIFF....WEBP" header (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
    if (
      buffer[0] === 0x52 && buffer[1] === 0x49 &&
      buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 &&
      buffer[10] === 0x42 && buffer[11] === 0x50
    ) {
      return "image/webp";
    }
    return "image/png"; // Default fallback
  }
}
```

### 5. Output Storage

```typescript
// src/storage/output-store.ts

import * as fs from "node:fs";
import * as path from "node:path";
import type { RenderMetadata } from "../engine/types.js";

export class OutputStore {
  private baseDir: string;
  private maxOutputs: number;

  constructor(baseDir: string, maxOutputs: number = 24) {
    this.baseDir = baseDir;
    this.maxOutputs = maxOutputs;

    // Ensure directory exists
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  /**
   * Save an image and its metadata
   */
  save(imageBuffer: Buffer, metadata: RenderMetadata): string {
    const imagePath = path.join(this.baseDir, `${metadata.id}.png`);
    const metaPath = path.join(this.baseDir, `${metadata.id}.json`);

    // Save image
    fs.writeFileSync(imagePath, imageBuffer);

    // Update metadata with actual path and save
    const metadataWithPath = { ...metadata, outputPath: imagePath };
    fs.writeFileSync(metaPath, JSON.stringify(metadataWithPath, null, 2));

    // Purge old outputs
    this.purgeOldOutputs();

    return imagePath;
  }

  /**
   * Get the most recent render metadata
   */
  getLatest(): RenderMetadata | null {
    const metaFiles = this.getMetaFilesSorted();
    if (metaFiles.length === 0) return null;

    return this.loadMetadata(metaFiles[0]);
  }

  /**
   * List all stored renders, newest first
   */
  listAll(): RenderMetadata[] {
    return this.getMetaFilesSorted().map((f) => this.loadMetadata(f));
  }

  private getMetaFilesSorted(): string[] {
    if (!fs.existsSync(this.baseDir)) return [];

    return fs
      .readdirSync(this.baseDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(this.baseDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  }

  private loadMetadata(filePath: string): RenderMetadata {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as RenderMetadata;
  }

  private purgeOldOutputs(): void {
    const metaFiles = this.getMetaFilesSorted();

    while (metaFiles.length > this.maxOutputs) {
      const oldest = metaFiles.pop()!;
      const imagePath = oldest.replace(".json", ".png");

      fs.unlinkSync(oldest);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }
  }
}
```

### 6. Main Pipeline

```typescript
// src/engine/pipeline.ts

import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import type {
  Scenario,
  PipelineConfig,
  RenderMetadata,
  GenerateResult,
} from "./types.js";
import { serializeScenario } from "./types.js";
import { GeminiClient, DEFAULT_GEMINI_CONFIG } from "./gemini-client.js";
import { composePrompt, DEFAULT_PROMPT_CONFIG } from "./prompt.js";
import { OutputStore } from "../storage/output-store.js";

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  outputDir: path.join(os.homedir(), ".haystack", "outputs"),
  maxOutputs: 24,
  geminiConfig: DEFAULT_GEMINI_CONFIG,
  promptConfig: DEFAULT_PROMPT_CONFIG,
};

export class Pipeline {
  private config: PipelineConfig;
  private client: GeminiClient;
  private store: OutputStore;

  constructor(config: Partial<PipelineConfig> = {}, apiKey?: string) {
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    this.client = new GeminiClient(apiKey);
    this.store = new OutputStore(this.config.outputDir, this.config.maxOutputs);
  }

  /**
   * Generate an edited image based on scenario
   */
  async generate(
    imagePath: string,
    scenario: Scenario,
    promptOverride?: string
  ): Promise<GenerateResult> {
    // Compose prompt
    const prompt = promptOverride ?? composePrompt(scenario, this.config.promptConfig);

    // Call Gemini
    const result = await this.client.editImage(
      imagePath,
      prompt,
      this.config.geminiConfig
    );

    // Create metadata (using SerializedScenario for JSON safety)
    const renderId = `${this.formatDate(new Date())}_${randomUUID().slice(0, 8)}`;
    const metadata: RenderMetadata = {
      id: renderId,
      artworkSource: imagePath,
      scenario: serializeScenario(scenario),
      prompt,
      model: this.config.geminiConfig.model,
      createdAt: new Date().toISOString(),
      outputPath: "", // Will be set by store
      responseText: result.responseText,
      seed: this.config.geminiConfig.seed,
      // Observability — store what the API already gave us
      responseId: result.responseId,
      modelVersion: result.modelVersion,
      usageMetadata: result.usageMetadata,
      finishReason: result.finishReason,
    };

    // Save output
    const outputPath = this.store.save(result.imageBuffer, metadata);
    metadata.outputPath = outputPath;

    return {
      metadata,
      imagePath: outputPath,
      imageBuffer: result.imageBuffer,
    };
  }

  /**
   * Generate from an image URL (downloads first)
   */
  async generateFromUrl(
    imageUrl: string,
    scenario: Scenario,
    promptOverride?: string
  ): Promise<GenerateResult> {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    // Use a unique temp filename to avoid collisions between concurrent runs
    const tempPath = path.join(this.config.outputDir, `temp_${randomUUID()}.png`);

    fs.writeFileSync(tempPath, buffer);

    try {
      return await this.generate(tempPath, scenario, promptOverride);
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }

  /**
   * Get the output store for listing/querying past renders
   */
  getStore(): OutputStore {
    return this.store;
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 19).replace(/[-:T]/g, "").replace(/(\d{8})(\d{6})/, "$1_$2");
  }
}
```

### 7. Public Exports

```typescript
// src/engine/index.ts

export * from "./types.js";
export * from "./scenario.js";
export * from "./prompt.js";
export * from "./gemini-client.js";
export * from "./pipeline.js";
```

```typescript
// src/index.ts

// Main package exports - what other phases will import
export * from "./engine/index.js";
export * from "./storage/output-store.js";
export * from "./config/index.js";
```

### 8. Configuration

```typescript
// src/config/config.ts

import * as path from "node:path";
import * as os from "node:os";
import type { PipelineConfig, GeminiConfig } from "../engine/types.js";

export interface HaystackConfig {
  googleApiKey: string;
  outputDir: string;
  baseArtworkDir: string;
  defaultModel: GeminiConfig["model"];
  defaultAspectRatio?: GeminiConfig["aspectRatio"]; // Optional — omit to match input
  defaultSeed?: number;
  maxStoredOutputs: number;
}

/**
 * Load configuration from environment variables
 */
export function loadConfigFromEnv(): HaystackConfig {
  const aspectRatio = process.env.HAYSTACK_ASPECT_RATIO as GeminiConfig["aspectRatio"] | undefined;
  const seed = process.env.HAYSTACK_SEED ? parseInt(process.env.HAYSTACK_SEED, 10) : undefined;

  return {
    googleApiKey: process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "",
    outputDir: process.env.HAYSTACK_OUTPUT_DIR ?? path.join(os.homedir(), ".haystack", "outputs"),
    baseArtworkDir: process.env.HAYSTACK_ARTWORK_DIR ?? path.join(os.homedir(), ".haystack", "artworks"),
    defaultModel: (process.env.HAYSTACK_MODEL as GeminiConfig["model"]) ?? "gemini-2.5-flash-image",
    defaultAspectRatio: aspectRatio, // undefined = match input image
    defaultSeed: seed,
    maxStoredOutputs: parseInt(process.env.HAYSTACK_MAX_OUTPUTS ?? "24", 10),
  };
}

/**
 * Convert HaystackConfig to PipelineConfig
 */
export function toPipelineConfig(config: HaystackConfig): Partial<PipelineConfig> {
  return {
    outputDir: config.outputDir,
    maxOutputs: config.maxStoredOutputs,
    geminiConfig: {
      model: config.defaultModel,
      ...(config.defaultAspectRatio ? { aspectRatio: config.defaultAspectRatio } : {}),
      ...(config.defaultSeed !== undefined ? { seed: config.defaultSeed } : {}),
    },
  };
}
```

### 9. CLI Entry Point

```typescript
// src/cli/generate.ts

#!/usr/bin/env node

import { Pipeline, createScenarioFromHour, createScenarioFromNow } from "../index.js";
import { loadConfigFromEnv, toPipelineConfig } from "../config/index.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log("Usage: haystack-generate <image_path> [hour]");
    console.log("  image_path: Path to the base artwork");
    console.log("  hour: Optional hour (0-23) to simulate. Defaults to current time.");
    process.exit(1);
  }

  const imagePath = args[0];
  const hour = args[1] ? parseInt(args[1], 10) : undefined;

  // Load config
  const config = loadConfigFromEnv();

  if (!config.googleApiKey) {
    console.error("Error: GOOGLE_API_KEY or GEMINI_API_KEY environment variable is required");
    process.exit(1);
  }

  // Create pipeline
  const pipeline = new Pipeline(toPipelineConfig(config), config.googleApiKey);

  // Create scenario
  const scenario = hour !== undefined
    ? createScenarioFromHour(hour)
    : createScenarioFromNow();

  console.log(`Generating for: hour=${scenario.hour}, isDay=${scenario.isDay}`);
  console.log(`Base image: ${imagePath}`);

  try {
    const result = await pipeline.generate(imagePath, scenario);

    console.log(`\nGenerated: ${result.imagePath}`);
    console.log(`Model: ${result.metadata.model}`);
    if (result.metadata.responseText) {
      console.log(`Response: ${result.metadata.responseText}`);
    }
  } catch (error) {
    console.error("Generation failed:", error);
    process.exit(1);
  }
}

main();
```

### 10. Example Usage

```typescript
// examples/basic-edit.ts

/**
 * Basic example of using the Haystack pipeline.
 *
 * Usage:
 *   export GOOGLE_API_KEY="your-api-key"
 *   npx tsx examples/basic-edit.ts path/to/artwork.png
 */

import { Pipeline, createScenarioFromHour } from "../src/index.js";

async function main() {
  const imagePath = process.argv[2];
  const hour = process.argv[3] ? parseInt(process.argv[3], 10) : 18;

  if (!imagePath) {
    console.log("Usage: npx tsx examples/basic-edit.ts <image_path> [hour]");
    process.exit(1);
  }

  // Create pipeline with defaults
  const pipeline = new Pipeline();

  // Create an evening scenario
  const scenario = createScenarioFromHour(hour);

  console.log(`Generating for hour ${hour}...`);

  const result = await pipeline.generate(imagePath, scenario);

  console.log(`Done! Output: ${result.imagePath}`);
  console.log(`Prompt used:\n${result.metadata.prompt}`);
}

main().catch(console.error);
```

## Acceptance Criteria

### Functional Requirements

- [ ] Pipeline accepts a local image file path and produces an edited image
- [ ] Pipeline accepts a scenario with hour (0-23) and produces contextually appropriate edits
- [ ] Pipeline saves output image as PNG with metadata JSON sidecar
- [ ] Metadata JSON is fully serializable (no `Date` objects — uses ISO strings)
- [ ] Metadata includes observability fields: `responseId`, `modelVersion`, `usageMetadata`, `finishReason`
- [ ] Pipeline respects `maxOutputs` and purges oldest files
- [ ] Pipeline uses configurable Gemini model (default: gemini-2.5-flash-image)
- [ ] Aspect ratio defaults to matching input image when not specified
- [ ] Optional `seed` parameter for reproducible outputs
- [ ] Pipeline composes prompts from scenario data using template
- [ ] Configuration can be loaded from environment variables
- [ ] CLI can be invoked for scheduled generation (launchd compatibility)

### Non-Functional Requirements

- [ ] Generation completes in under 30 seconds for typical images
- [ ] Error handling for API failures (rate limits, invalid images, network issues)
- [ ] Logging of all generation attempts with timestamps
- [ ] Clean separation between engine, storage, and configuration
- [ ] All code has TypeScript types (no `any` except where unavoidable)

### Quality Gates

- [ ] Unit tests for scenario, prompt, and output-store modules
- [ ] Integration test with mocked Gemini responses
- [ ] At least one end-to-end test with real API (can be marked skip by default)
- [ ] Example script runs successfully
- [ ] TypeScript compiles with strict mode

## Edge Cases to Handle

1. **Image format issues** - Validate input is JPG/PNG/WebP, detect via magic bytes
2. **API rate limits** - Implement exponential backoff retry (max 3 attempts)
3. **Large images** - Warn if over 4096px (resize not implemented in A1)
4. **Missing API key** - Clear error message pointing to setup docs
5. **Network failures** - Retry with backoff, eventually fail gracefully
6. **Disk space** - Check available space before saving, warn if low
7. **Invalid scenarios** - Validate hour is 0-23, handle gracefully

## Test Strategy

### Unit Tests

```typescript
// tests/engine/scenario.test.ts

import { describe, it, expect } from "vitest";
import { createScenarioFromHour, describeScenario } from "../../src/engine/scenario.js";

describe("createScenarioFromHour", () => {
  it("creates scenario with correct hour", () => {
    const scenario = createScenarioFromHour(14);
    expect(scenario.hour).toBe(14);
    expect(scenario.isDay).toBe(true);
  });

  it("auto-detects night for late hours", () => {
    const scenario = createScenarioFromHour(23);
    expect(scenario.isDay).toBe(false);
  });
});

describe("describeScenario", () => {
  it("describes morning correctly", () => {
    const scenario = createScenarioFromHour(9);
    expect(describeScenario(scenario).toLowerCase()).toContain("morning");
  });

  it("describes night correctly", () => {
    const scenario = createScenarioFromHour(23);
    expect(describeScenario(scenario).toLowerCase()).toContain("night");
  });
});
```

```typescript
// tests/engine/prompt.test.ts

import { describe, it, expect } from "vitest";
import { composePrompt, DEFAULT_PROMPT_CONFIG } from "../../src/engine/prompt.js";
import { createScenarioFromHour } from "../../src/engine/scenario.js";

describe("composePrompt", () => {
  it("includes scenario description", () => {
    const scenario = createScenarioFromHour(18);
    const prompt = composePrompt(scenario);
    expect(prompt.toLowerCase()).toMatch(/evening|golden hour/);
  });

  it("appends extra context when provided", () => {
    const scenario = createScenarioFromHour(22);
    const prompt = composePrompt(scenario, {
      ...DEFAULT_PROMPT_CONFIG,
      extraContext: "The room has electric lights",
    });
    expect(prompt).toContain("electric lights");
  });
});
```

### Integration Tests

```typescript
// tests/engine/pipeline.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Pipeline } from "../../src/engine/pipeline.js";
import { createScenarioFromHour } from "../../src/engine/scenario.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Mock the Gemini client
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn().mockResolvedValue({
        responseId: "mock-response-id",
        modelVersion: "gemini-2.5-flash-image-001",
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 1290, totalTokenCount: 1390 },
        candidates: [{
          content: {
            parts: [
              { inlineData: { data: Buffer.from("fake-image").toString("base64") } },
            ],
          },
          finishReason: "STOP",
        }],
      }),
    },
  })),
}));

describe("Pipeline", () => {
  const tempDir = path.join(os.tmpdir(), "haystack-test");

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  it("generates output and saves metadata", async () => {
    const pipeline = new Pipeline({ outputDir: tempDir }, "fake-key");
    const scenario = createScenarioFromHour(18);

    // Create a test image
    const testImagePath = path.join(tempDir, "test.png");
    fs.writeFileSync(testImagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG header

    const result = await pipeline.generate(testImagePath, scenario);

    expect(result.imagePath).toContain(".png");
    expect(result.metadata.model).toBe("gemini-2.5-flash-image");
    expect(fs.existsSync(result.imagePath)).toBe(true);
  });
});
```

## Dependencies

```json
// package.json
{
  "name": "haystack",
  "version": "0.1.0",
  "description": "Living Art Wallpaper Engine",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "haystack-generate": "./dist/cli/generate.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest",
    "test:run": "vitest run",
    "lint": "eslint src tests",
    "example": "tsx examples/basic-edit.ts"
  },
  "dependencies": {
    "@google/genai": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "tsx": "^4.19.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

> **Why `rootDir: "src"`:** With `rootDir: "."`, TypeScript emits `dist/src/index.js` instead of `dist/index.js`, breaking `"main"` and `"bin"` paths in package.json. Setting `rootDir: "src"` (with `cli/` moved inside `src/`) makes the output structure match what package.json expects.

## Environment Setup

```bash
# .env.example

# Required: Your Google AI API key
# Get one at: https://aistudio.google.com/apikey
GOOGLE_API_KEY=your-api-key-here

# Optional: Custom output directory
# HAYSTACK_OUTPUT_DIR=~/.haystack/outputs

# Optional: Default model (gemini-2.5-flash-image or gemini-3-pro-image-preview)
# HAYSTACK_MODEL=gemini-2.5-flash-image

# Optional: Default aspect ratio (omit to match input image)
# HAYSTACK_ASPECT_RATIO=16:9

# Optional: Seed for more reproducible outputs
# HAYSTACK_SEED=42

# Optional: Max stored outputs
# HAYSTACK_MAX_OUTPUTS=24
```

## Phase Alignment Details

### How Phase A1 Enables Future Phases

| Phase | How A1 Integrates |
|-------|-------------------|
| **A3: Lab UI** | Engine runs server-side via local HTTP or Electron shell (see note below) |
| **A4: Scheduler** | `haystack-generate` CLI called by launchd plist |
| **B: Menu Bar** | Electron bundles the same TypeScript. Uses `Pipeline` directly in main process |
| **C: Kiosk** | Express server on Mac imports `OutputStore.getLatest()` to serve images |

#### A3 Architecture Note

The engine uses Node.js APIs (`fs`, `os`, `crypto`) and holds the API key — it **cannot run in a browser environment**. A Vite/React Lab UI cannot `import { Pipeline }` directly without bundler hacks, and exposing the API key client-side is a security risk.

**Practical options for A3:**
1. **Local HTTP server** — Engine runs as a small Express/Fastify server, Lab UI is a normal React app that calls it via `fetch`. Simple, clear separation.
2. **Electron shell** — Lab UI runs in Electron, engine runs in the main process. Direct imports work. Reuses Phase B infrastructure.

This doesn't affect A1 code at all — just keep the engine as a pure Node.js module and don't add browser compatibility shims.

### Code Sharing Example (Phase B Preview)

```typescript
// Future: Phase B Electron main process
import { Pipeline, createScenarioFromNow } from "haystack";

// Same engine code, running in Electron
const pipeline = new Pipeline();

ipcMain.handle("generate-now", async () => {
  const scenario = createScenarioFromNow();
  const result = await pipeline.generate(currentArtworkPath, scenario);
  return result.imagePath;
});
```

### Code Sharing Example (Phase C Preview)

```typescript
// Future: Phase C Express server
import express from "express";
import { OutputStore } from "haystack";

const app = express();
const store = new OutputStore("~/.haystack/outputs");

app.get("/latest.json", (req, res) => {
  const latest = store.getLatest();
  res.json({
    id: latest?.id,
    url: `/images/${latest?.id}.png`,
    updatedAt: latest?.createdAt,
  });
});

app.use("/images", express.static("~/.haystack/outputs"));
```

## Success Metrics

1. **API integration works** - Successfully calls Gemini and receives edited images
2. **Prompt iteration is fast** - Can test new prompts in <30 seconds
3. **Output quality** - Generated images show appropriate time-of-day changes
4. **Reproducibility** - Same scenario + prompt produces stylistically consistent results
5. **Modularity** - Engine can be imported by Lab UI, Electron, and Express without modification

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Gemini API changes | Low | High | Pin SDK version, monitor deprecation notices |
| Rate limiting | Medium | Medium | Implement backoff, use flash model for iteration |
| Poor edit quality | Medium | High | Iterate on prompts, document what works |
| Cost overruns | Low | Low | Track usage via `usageMetadata`, set alerts in Google Cloud console |
| Node.js version issues | Low | Medium | Pin Node 20+, use `engines` in package.json |
| SDK ignores `aspectRatio`/`imageSize` | Low | Medium | Known class of JS SDK bug ([#1009](https://github.com/googleapis/js-genai/issues/1009)). Fix: bump SDK version, or fall back to raw REST call for that request |

## References

### API Documentation
- [Gemini Image Generation Docs](https://ai.google.dev/gemini-api/docs/image-generation)
- [Gemini Cookbook - Image Editing](https://github.com/google-gemini/cookbook)
- [@google/genai npm package](https://www.npmjs.com/package/@google/genai)

### Models
- `gemini-2.5-flash-image` - Fast, ~1K class output (resolution varies by aspect ratio), $0.039/image
- `gemini-3-pro-image-preview` - High quality, up to 4K output, uses Thinking

### Related PRD Sections
- Phase A1 in `idea-draft.md` lines 527-531
- Engine requirements in `idea-draft.md` lines 142-158
- Phase B (Menu Bar) in `idea-draft.md` lines 253-342
- Phase C (Kiosk) in `idea-draft.md` lines 346-419
