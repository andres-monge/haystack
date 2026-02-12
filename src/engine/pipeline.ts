// src/engine/pipeline.ts — Main pipeline orchestration

import * as path from "node:path";
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

/** Produce "YYYYMMDD_HHmmss" for human-readable, sortable render IDs. */
function formatDate(date: Date): string {
  return date
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, "")
    .replace(/(\d{8})(\d{6})/, "$1_$2");
}

export class Pipeline {
  private config: PipelineConfig;
  private client: GeminiClient;
  private store: OutputStore;

  constructor(config: Partial<PipelineConfig> = {}, apiKey?: string) {
    this.config = {
      ...DEFAULT_PIPELINE_CONFIG,
      ...config,
      geminiConfig: { ...DEFAULT_GEMINI_CONFIG, ...config.geminiConfig },
      promptConfig: { ...DEFAULT_PROMPT_CONFIG, ...config.promptConfig },
    };
    this.client = new GeminiClient(apiKey);
    this.store = new OutputStore(this.config.outputDir, this.config.maxOutputs);
  }

  /**
   * Generate an edited image based on scenario.
   * Always generates from the original base image (never from previous output).
   */
  async generate(
    imagePath: string,
    scenario: Scenario,
    promptOverride?: string,
  ): Promise<GenerateResult> {
    const prompt =
      promptOverride ?? composePrompt(scenario, this.config.promptConfig);

    const result = await this.client.editImage(
      imagePath,
      prompt,
      this.config.geminiConfig,
    );

    const now = new Date();
    const renderId = `${formatDate(now)}_${randomUUID().slice(0, 8)}`;
    const metadata: RenderMetadata = {
      id: renderId,
      artworkSource: imagePath,
      scenario: serializeScenario(scenario),
      prompt,
      model: this.config.geminiConfig.model,
      createdAt: now.toISOString(),
      outputPath: "", // Updated after save
      responseText: result.responseText,
      seed: this.config.geminiConfig.seed,
      responseId: result.responseId,
      modelVersion: result.modelVersion,
      usageMetadata: result.usageMetadata,
      finishReason: result.finishReason,
    };

    const outputPath = this.store.save(result.imageBuffer, metadata);
    metadata.outputPath = outputPath;

    return {
      metadata,
      imagePath: outputPath,
      imageBuffer: result.imageBuffer,
    };
  }

  /**
   * Get the output store for listing/querying past renders.
   */
  getStore(): OutputStore {
    return this.store;
  }
}
