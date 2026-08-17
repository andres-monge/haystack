// src/engine/pipeline.ts — Provider-neutral production orchestration

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  GenerationLock,
  generationLockPath,
  isGenerationLockBusyError,
  type GenerationLockLease,
} from "./generation-lock.js";
import { validateImage } from "./image-validation.js";
import {
  ProviderChain,
  ProviderChainExhaustedError,
  ProviderChainTerminatedError,
  type ProviderAttemptRecord,
  type ProviderChainEditInput,
  type ProviderChainRunData,
  type ProviderChainSuccess,
  type ProviderChainTerminalOutcome,
} from "./provider-chain.js";
import {
  createProviderRegistry,
  type ProviderFactoryConfig,
} from "./provider-factory.js";
import type {
  ImageEditStage,
  ImageProviderId,
  ProviderAttemptOutcome,
  ValidatedImage,
} from "./provider-types.js";
import { composePrompt, composePromptFromText, DEFAULT_PROMPT_CONFIG } from "./prompt.js";
import { describeScenario } from "./scenario.js";
import type {
  GenerateResult,
  GeminiConfig,
  PipelineConfig,
  PromptConfig,
  RenderMetadata,
  Scenario,
} from "./types.js";
import { serializeScenario } from "./types.js";
import { OutputStore } from "../storage/output-store.js";
import { DEFAULT_GEMINI_CONFIG } from "./gemini-client.js";

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  outputDir: path.join(os.homedir(), ".haystack", "outputs"),
  maxOutputs: 24,
  geminiConfig: DEFAULT_GEMINI_CONFIG,
  promptConfig: DEFAULT_PROMPT_CONFIG,
};

export type PipelineConfigInput = Omit<Partial<PipelineConfig>, "geminiConfig" | "promptConfig"> & {
  geminiConfig?: Partial<GeminiConfig>;
  promptConfig?: Partial<PromptConfig>;
};

export interface ImageEditChain {
  getProviderOrder(): readonly ImageProviderId[];
  editImage(input: ProviderChainEditInput): Promise<ProviderChainSuccess>;
}

export interface PipelineGenerationLock {
  acquire(input: { kind: "normal" }): Promise<GenerationLockLease>;
}

export interface SafeTerminalAttempt {
  provider: ImageProviderId;
  outcome: ProviderAttemptOutcome;
  durationMs: number;
}

export interface GenerationTerminalEvent {
  chainId: string;
  stage: ImageEditStage;
  providerOrder: readonly ImageProviderId[];
  chainTimeoutMs?: number;
  attempts: readonly SafeTerminalAttempt[];
  outcome: ProviderChainTerminalOutcome;
  winner?: ImageProviderId;
  renderId?: string;
  safeCode?: string;
  occurredAt: string;
}

export type GenerationTerminalEventSink = (
  event: GenerationTerminalEvent,
) => void | Promise<void>;

export interface PipelineDependencies {
  chain: ImageEditChain;
  store?: OutputStore;
  generationLock?: PipelineGenerationLock;
  terminalEventSink?: GenerationTerminalEventSink;
  readSource?: (imagePath: string) => Promise<Buffer>;
  validateSource?: (bytes: Buffer) => Promise<ValidatedImage>;
  composePrompt?: (scenario: Scenario, config: PromptConfig) => string;
  composePromptFromText?: (text: string, config?: PromptConfig) => string;
  createId?: () => string;
  now?: () => number;
}

export interface GenerateOptions {
  signal?: AbortSignal;
}

export class PipelineGenerationError extends Error {
  readonly code = "PIPELINE_GENERATION_FAILED";

  constructor(readonly safeCode: string) {
    super("Image generation failed");
    this.name = "PipelineGenerationError";
  }
}

function formatDate(date: Date): string {
  return date
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, "")
    .replace(/(\d{8})(\d{6})/, "$1_$2");
}

export function sanitizeTerminalAttempts(
  attempts: readonly ProviderAttemptRecord[],
): readonly SafeTerminalAttempt[] {
  return Object.freeze(attempts.map(attempt => Object.freeze({
    provider: attempt.provider,
    outcome: attempt.outcome,
    durationMs: attempt.durationMs,
  })));
}

export function defaultGenerationTerminalEventSink(
  event: GenerationTerminalEvent,
): void {
  const delayedAttempt = event.attempts.find(
    attempt => event.chainTimeoutMs !== undefined
      && attempt.durationMs > event.chainTimeoutMs,
  );
  if (delayedAttempt) {
    console.warn(
      `[haystack:generation] system sleep or event-loop suspension may have delayed timeout handling: chainId=${event.chainId} provider=${delayedAttempt.provider} durationMs=${delayedAttempt.durationMs} chainTimeoutMs=${event.chainTimeoutMs}`,
    );
  }
  console.info(`[haystack:generation] ${JSON.stringify(event)}`);
}

export class Pipeline {
  readonly #config: PipelineConfig;
  readonly #chain: ImageEditChain;
  readonly #store: OutputStore;
  readonly #generationLock: PipelineGenerationLock;
  readonly #terminalEventSink: GenerationTerminalEventSink;
  readonly #readSource: (imagePath: string) => Promise<Buffer>;
  readonly #validateSource: (bytes: Buffer) => Promise<ValidatedImage>;
  readonly #composePrompt: (scenario: Scenario, config: PromptConfig) => string;
  readonly #composePromptFromText: (text: string, config?: PromptConfig) => string;
  readonly #createId: () => string;
  readonly #now: () => number;

  constructor(config: PipelineConfigInput = {}, dependencies: PipelineDependencies) {
    if (!dependencies?.chain) {
      throw new Error("Pipeline requires an injected provider chain");
    }
    this.#config = {
      ...DEFAULT_PIPELINE_CONFIG,
      ...config,
      geminiConfig: { ...DEFAULT_GEMINI_CONFIG, ...config.geminiConfig },
      promptConfig: { ...DEFAULT_PROMPT_CONFIG, ...config.promptConfig },
    };
    this.#chain = dependencies.chain;
    this.#store = dependencies.store
      ?? new OutputStore(this.#config.outputDir, this.#config.maxOutputs);
    this.#generationLock = dependencies.generationLock
      ?? new GenerationLock({ lockPath: generationLockPath(this.#config.outputDir) });
    this.#terminalEventSink = dependencies.terminalEventSink
      ?? defaultGenerationTerminalEventSink;
    this.#readSource = dependencies.readSource ?? (file => fs.promises.readFile(file));
    this.#validateSource = dependencies.validateSource ?? (bytes => validateImage(bytes));
    this.#composePrompt = dependencies.composePrompt ?? composePrompt;
    this.#composePromptFromText = dependencies.composePromptFromText
      ?? composePromptFromText;
    this.#createId = dependencies.createId ?? randomUUID;
    this.#now = dependencies.now ?? Date.now;
  }

  /** Always edits the original source once; provider fallback never chains outputs. */
  async generate(
    imagePath: string,
    scenario: Scenario,
    promptOverride?: string,
    options: GenerateOptions = {},
  ): Promise<GenerateResult> {
    const chainId = this.#createId();
    const stage = "normal" as const;
    const providerOrder = Object.freeze([...this.#chain.getProviderOrder()]);
    let lease: GenerationLockLease | undefined;
    let run: ProviderChainRunData | undefined;
    let winner: ImageProviderId | undefined;
    let terminalEvent: GenerationTerminalEvent | undefined;

    const eventFor = (
      outcome: ProviderChainTerminalOutcome,
      extras: { renderId?: string; safeCode?: string } = {},
    ): GenerationTerminalEvent => Object.freeze({
      chainId,
      stage,
      providerOrder,
      ...(run ? { chainTimeoutMs: run.chainTimeoutMs } : {}),
      attempts: sanitizeTerminalAttempts(run?.attempts ?? []),
      outcome,
      ...(winner ? { winner } : {}),
      ...(extras.renderId ? { renderId: extras.renderId } : {}),
      ...(extras.safeCode ? { safeCode: extras.safeCode } : {}),
      occurredAt: new Date(this.#now()).toISOString(),
    });

    try {
      try {
        lease = await this.#generationLock.acquire({ kind: "normal" });
      } catch (error) {
        if (isGenerationLockBusyError(error)) {
          terminalEvent = eventFor("local_failure", { safeCode: "generation_busy" });
          throw error;
        }
        terminalEvent = eventFor("local_failure", { safeCode: "lock_failed" });
        throw new PipelineGenerationError("lock_failed");
      }

      try {
        this.#store.cleanupUncommitted();
      } catch {
        throw new PipelineGenerationError("storage_cleanup_failed");
      }

      let sourceBytes: Buffer;
      try {
        sourceBytes = await this.#readSource(imagePath);
      } catch {
        throw new PipelineGenerationError("source_read_failed");
      }

      let source: ValidatedImage;
      try {
        source = await this.#validateSource(sourceBytes);
      } catch {
        throw new PipelineGenerationError("source_validation_failed");
      }

      let prompt: string;
      try {
        prompt = promptOverride
          ? this.#composePromptFromText(describeScenario(scenario), {
              template: promptOverride,
            })
          : this.#composePrompt(scenario, this.#config.promptConfig);
        if (prompt.trim().length === 0) {
          throw new Error("empty prompt");
        }
      } catch {
        throw new PipelineGenerationError("prompt_construction_failed");
      }

      let providerResult: ProviderChainSuccess;
      try {
        providerResult = await this.#chain.editImage({
          chainId,
          source,
          prompt,
          output: Object.freeze({
            stage,
            aspectRatio: this.#config.geminiConfig.aspectRatio ?? "source",
          }),
          ...(options.signal ? { signal: options.signal } : {}),
        });
        run = providerResult.run;
      } catch (error) {
        if (
          error instanceof ProviderChainExhaustedError
          || error instanceof ProviderChainTerminatedError
        ) {
          run = error.run;
          terminalEvent = eventFor(error.run.terminalOutcome, {
            ...(error instanceof ProviderChainTerminatedError && error.safeCode
              ? { safeCode: error.safeCode }
              : {}),
          });
          throw error;
        }
        throw new PipelineGenerationError("chain_contract_failure");
      }

      if (
        run.chainId !== chainId
        || run.stage !== stage
        || run.providerOrder.length !== providerOrder.length
        || run.providerOrder.some((provider, index) => provider !== providerOrder[index])
        || run.terminalOutcome !== "successful"
        || run.winner !== providerResult.provider
        || run.attempts.at(-1)?.outcome !== "successful"
        || run.attempts.at(-1)?.provider !== providerResult.provider
        || run.attempts.at(-1)?.requestedModel !== providerResult.requestedModel
      ) {
        throw new PipelineGenerationError("chain_contract_failure");
      }
      winner = providerResult.provider;

      const now = new Date(this.#now());
      const renderId = `${formatDate(now)}_${randomUUID().slice(0, 8)}`;
      const metadata: RenderMetadata = {
        id: renderId,
        artworkSource: imagePath,
        scenario: serializeScenario(scenario),
        prompt,
        model: providerResult.requestedModel,
        createdAt: now.toISOString(),
        outputPath: "",
        responseText: providerResult.responseText,
        ...(providerResult.provider === "gemini" && providerResult.seed !== undefined
          ? { seed: providerResult.seed }
          : {}),
        responseId: providerResult.requestId,
        modelVersion: providerResult.resolvedModel,
        usageMetadata: providerResult.usage
          ? {
              promptTokenCount: providerResult.usage.inputTokens,
              candidatesTokenCount: providerResult.usage.outputTokens,
              totalTokenCount: providerResult.usage.totalTokens,
            }
          : undefined,
        finishReason: providerResult.finishReason,
        provider: providerResult.provider,
        resolvedModel: providerResult.resolvedModel,
        mimeType: providerResult.image.mimeType,
        width: providerResult.image.width,
        height: providerResult.image.height,
        byteCount: providerResult.image.byteCount,
        sha256: providerResult.image.sha256,
        providerOrder: run.providerOrder,
        attempts: run.attempts,
      };

      let outputPath: string;
      try {
        outputPath = await this.#store.save(providerResult.image.bytes, metadata);
      } catch {
        throw new PipelineGenerationError("storage_failed");
      }
      metadata.outputPath = outputPath;
      terminalEvent = eventFor("successful", { renderId });

      return {
        metadata,
        imagePath: outputPath,
        imageBuffer: providerResult.image.bytes,
      };
    } catch (error) {
      if (!terminalEvent) {
        const safeCode = error instanceof PipelineGenerationError
          ? error.safeCode
          : "local_failure";
        terminalEvent = eventFor("local_failure", { safeCode });
      }
      throw error;
    } finally {
      try {
        await lease?.release();
      } catch {
        // Ownership release is token-safe and best effort; never replace the
        // logical edit's real terminal outcome with cleanup diagnostics.
      }
      if (terminalEvent) {
        try {
          await this.#terminalEventSink(terminalEvent);
        } catch {
          // Observability must never change persistence or fallback semantics.
        }
      }
    }
  }

  getStore(): OutputStore {
    return this.#store;
  }
}

/** Shared direct-BYOK construction path for server, scheduler, CLI, and examples. */
export function createProductionPipeline(
  pipelineConfig: PipelineConfigInput,
  providerConfig: ProviderFactoryConfig,
  dependencies: Omit<PipelineDependencies, "chain"> = {},
): Pipeline {
  const registry = createProviderRegistry(providerConfig);
  const chain = new ProviderChain(registry, {
    providerOrder: providerConfig.providerOrder,
  });
  return new Pipeline(pipelineConfig, { ...dependencies, chain });
}
