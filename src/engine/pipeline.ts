// src/engine/pipeline.ts — Main pipeline orchestration

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

    const renderId = `${this.formatDate(new Date())}_${randomUUID().slice(0, 8)}`;
    const metadata: RenderMetadata = {
      id: renderId,
      artworkSource: imagePath,
      scenario: serializeScenario(scenario),
      prompt,
      model: this.config.geminiConfig.model,
      createdAt: new Date().toISOString(),
      outputPath: "", // Set by store.save
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
   * Generate from an image URL (downloads first, cleans up temp file).
   */
  async generateFromUrl(
    imageUrl: string,
    scenario: Scenario,
    promptOverride?: string,
  ): Promise<GenerateResult> {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const tempPath = path.join(
      this.config.outputDir,
      `temp_${randomUUID()}.png`,
    );

    fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    fs.writeFileSync(tempPath, buffer);

    try {
      return await this.generate(tempPath, scenario, promptOverride);
    } finally {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Best-effort cleanup
      }
    }
  }

  /**
   * Get the output store for listing/querying past renders.
   */
  getStore(): OutputStore {
    return this.store;
  }

  private formatDate(date: Date): string {
    // Produce "YYYYMMDD_HHmmss" for human-readable, sortable render IDs
    return date
      .toISOString()
      .slice(0, 19)
      .replace(/[-:T]/g, "")
      .replace(/(\d{8})(\d{6})/, "$1_$2");
  }
}
