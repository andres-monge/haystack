// src/engine/extend-artwork.ts — Two-stage provider-neutral outpainting

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  GenerationLock,
  GenerationLockBusyError,
  generationLockPath,
  type GenerationLockLease,
} from "./generation-lock.js";
import { validateImage } from "./image-validation.js";
import {
  ProviderChain,
  ProviderChainExhaustedError,
  ProviderChainTerminatedError,
  type ProviderAttemptRecord,
  type ProviderChainRunData,
  type ProviderChainSuccess,
} from "./provider-chain.js";
import {
  createProviderRegistry,
  type ProviderFactoryConfig,
} from "./provider-factory.js";
import type {
  ImageEditStage,
  ImageProviderId,
  ValidatedImage,
} from "./provider-types.js";
import type {
  ExtendArtworkStageMetadata,
  RenderMetadata,
  UsageMetadata,
} from "./types.js";
import {
  type GenerationTerminalEvent,
  type GenerationTerminalEventSink,
  type ImageEditChain,
  type SafeTerminalAttempt,
} from "./pipeline.js";
import { OutputStore } from "../storage/output-store.js";

export const EXTEND_CLEANUP_PROMPT = `Remove any Instagram or social media UI overlays from this image.
This includes: navigation arrows (< >) on the left and right edges, pagination
dots or circles at the bottom, like/comment/share icons, username overlays,
and any other semi-transparent UI elements. Replace the removed areas with a
natural continuation of the underlying artwork. Do NOT change the art style,
composition, or any actual content of the image — only remove the UI overlays.
If there are no overlays present, return the image unchanged.`;

export const DEFAULT_EXTEND_PROMPT = `Seamlessly extend this artwork to a wide 16:9 landscape. The existing edges
must continue naturally with no visible seam — elements at the boundaries
(trees, buildings, terrain) should flow uninterrupted into the new space.
Expand by revealing more of the same scene, not by generating new disconnected
content. Preserve the EXACT artistic style, medium, color palette, and lighting
throughout.`;

export interface ExtendArtworkConfig {
  imageDir: string;
  /** Shared normal-render output directory used to locate the global paid lock. */
  outputDir?: string;
}

export interface ExtendArtworkGenerationLock {
  acquire(input: { kind: "extend" }): Promise<GenerationLockLease>;
}

export interface ExtendArtworkStore {
  save(imageBuffer: Buffer, metadata: RenderMetadata): Promise<string>;
}

export interface ExtendArtworkDependencies {
  chain: ImageEditChain;
  store?: ExtendArtworkStore;
  generationLock?: ExtendArtworkGenerationLock;
  terminalEventSink?: GenerationTerminalEventSink;
  readSource?: (imagePath: string) => Promise<Buffer>;
  validateSource?: (bytes: Buffer) => Promise<ValidatedImage>;
  isOutputAvailable?: (renderId: string) => Promise<boolean>;
  createId?: () => string;
  now?: () => number;
}

export type ExtendArtworkTerminalEvent = GenerationTerminalEvent;

export interface ExtendArtworkStageResult {
  stage: "extend-cleanup" | "extend-outpaint";
  chainId: string;
  winner: ImageProviderId;
  requestedModel: string;
  resolvedModel?: string;
  providerOrder: readonly ImageProviderId[];
  attempts: readonly ProviderAttemptRecord[];
}

export interface ExtendArtworkResult {
  outputPath: string;
  provider: ImageProviderId;
  model: string;
  resolvedModel?: string;
  mimeType: ValidatedImage["mimeType"];
  width: number;
  height: number;
  byteCount: number;
  sha256: string;
  providerOrder: readonly ImageProviderId[];
  stages: readonly ExtendArtworkStageResult[];
  responseText?: string;
}

export class ExtendArtworkError extends Error {
  readonly code = "EXTEND_ARTWORK_FAILED";

  constructor(readonly safeCode: string) {
    super("Artwork extension failed");
    this.name = "ExtendArtworkError";
  }
}

function defaultTerminalEventSink(event: GenerationTerminalEvent): void {
  console.info(`[haystack:generation] ${JSON.stringify(event)}`);
}

function safeAttempts(
  attempts: readonly ProviderAttemptRecord[],
): readonly SafeTerminalAttempt[] {
  return Object.freeze(attempts.map(attempt => Object.freeze({
    provider: attempt.provider,
    outcome: attempt.outcome,
    durationMs: attempt.durationMs,
  })));
}

function isBusyError(error: unknown): error is GenerationLockBusyError {
  return error instanceof GenerationLockBusyError
    || (
      typeof error === "object"
      && error !== null
      && (error as { code?: unknown }).code === "GENERATION_BUSY"
    );
}

function sameOrder(
  left: readonly ImageProviderId[],
  right: readonly ImageProviderId[],
): boolean {
  return left.length === right.length
    && left.every((provider, index) => provider === right[index]);
}

function isSuccessfulRun(
  result: ProviderChainSuccess,
  chainId: string,
  stage: ImageEditStage,
  providerOrder: readonly ImageProviderId[],
): boolean {
  const lastAttempt = result.run.attempts.at(-1);
  return result.run.chainId === chainId
    && result.run.stage === stage
    && sameOrder(result.run.providerOrder, providerOrder)
    && result.run.terminalOutcome === "successful"
    && result.run.winner === result.provider
    && lastAttempt?.outcome === "successful"
    && lastAttempt.provider === result.provider
    && lastAttempt.requestedModel === result.requestedModel;
}

function stageMetadata(
  result: ProviderChainSuccess,
): ExtendArtworkStageMetadata {
  return Object.freeze({
    stage: result.run.stage as "extend-cleanup" | "extend-outpaint",
    chainId: result.run.chainId,
    provider: result.provider,
    requestedModel: result.requestedModel,
    ...(result.resolvedModel ? { resolvedModel: result.resolvedModel } : {}),
    providerOrder: Object.freeze([...result.run.providerOrder]),
    attempts: Object.freeze([...result.run.attempts]),
  });
}

function publicStageResult(
  metadata: ExtendArtworkStageMetadata,
): ExtendArtworkStageResult {
  return Object.freeze({
    stage: metadata.stage,
    chainId: metadata.chainId,
    winner: metadata.provider,
    requestedModel: metadata.requestedModel,
    ...(metadata.resolvedModel ? { resolvedModel: metadata.resolvedModel } : {}),
    providerOrder: metadata.providerOrder,
    attempts: metadata.attempts,
  });
}

function usageMetadata(result: ProviderChainSuccess): UsageMetadata | undefined {
  if (!result.usage) return undefined;
  return {
    promptTokenCount: result.usage.inputTokens,
    candidatesTokenCount: result.usage.outputTokens,
    totalTokenCount: result.usage.totalTokens,
  };
}

/**
 * Derive the committed artwork ID. OutputStore uses this ID as the filename,
 * so normalize unsafe filename characters without ever doubling `-landscape`.
 */
export function deriveLandscapeId(inputPath: string): string {
  const originalStem = path.basename(inputPath, path.extname(inputPath));
  const withoutSuffix = originalStem.replace(/-landscape$/i, "");
  const safeStem = withoutSuffix
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safeStem || "artwork"}-landscape`;
}

interface StageState {
  chainId: string;
  stage: "extend-cleanup" | "extend-outpaint";
  run?: ProviderChainRunData;
  winner?: ImageProviderId;
}

export class ExtendArtworkService {
  readonly #config: ExtendArtworkConfig;
  readonly #chain: ImageEditChain;
  readonly #store: ExtendArtworkStore;
  readonly #generationLock: ExtendArtworkGenerationLock;
  readonly #terminalEventSink: GenerationTerminalEventSink;
  readonly #readSource: (imagePath: string) => Promise<Buffer>;
  readonly #validateSource: (bytes: Buffer) => Promise<ValidatedImage>;
  readonly #isOutputAvailable: (renderId: string) => Promise<boolean>;
  readonly #createId: () => string;
  readonly #now: () => number;

  constructor(config: ExtendArtworkConfig, dependencies: ExtendArtworkDependencies) {
    if (!config.imageDir || !dependencies?.chain) {
      throw new Error("ExtendArtworkService requires an image directory and provider chain");
    }
    this.#config = {
      imageDir: path.resolve(config.imageDir),
      ...(config.outputDir ? { outputDir: path.resolve(config.outputDir) } : {}),
    };
    this.#chain = dependencies.chain;
    // Rotation artwork is not a retention queue: never purge older artworks.
    this.#store = dependencies.store
      ?? new OutputStore(this.#config.imageDir, Number.MAX_SAFE_INTEGER);
    this.#generationLock = dependencies.generationLock
      ?? new GenerationLock({
        lockPath: generationLockPath(this.#config.outputDir ?? this.#config.imageDir),
      });
    this.#terminalEventSink = dependencies.terminalEventSink
      ?? defaultTerminalEventSink;
    this.#readSource = dependencies.readSource ?? (file => fs.promises.readFile(file));
    this.#validateSource = dependencies.validateSource ?? (bytes => validateImage(bytes));
    this.#isOutputAvailable = dependencies.isOutputAvailable ?? (async renderId =>
      ![".json", ".png", ".jpg", ".jpeg", ".webp"].some(extension =>
        fs.existsSync(path.join(this.#config.imageDir, `${renderId}${extension}`))));
    this.#createId = dependencies.createId ?? randomUUID;
    this.#now = dependencies.now ?? Date.now;
  }

  async extend(
    imagePath: string,
    outpaintPrompt = DEFAULT_EXTEND_PROMPT,
    options: { signal?: AbortSignal } = {},
  ): Promise<ExtendArtworkResult> {
    const providerOrder = Object.freeze([...this.#chain.getProviderOrder()]);
    const cleanupState: StageState = {
      chainId: this.#createId(),
      stage: "extend-cleanup",
    };
    let outpaintState: StageState | undefined;
    let lease: GenerationLockLease | undefined;

    const eventFor = (
      state: StageState,
      outcome: GenerationTerminalEvent["outcome"],
      extras: { renderId?: string; safeCode?: string } = {},
    ): ExtendArtworkTerminalEvent => Object.freeze({
      chainId: state.chainId,
      stage: state.stage,
      providerOrder,
      attempts: safeAttempts(state.run?.attempts ?? []),
      outcome,
      ...(state.winner ? { winner: state.winner } : {}),
      ...(extras.renderId ? { renderId: extras.renderId } : {}),
      ...(extras.safeCode ? { safeCode: extras.safeCode } : {}),
      occurredAt: new Date(this.#now()).toISOString(),
    });
    const emit = async (event: ExtendArtworkTerminalEvent): Promise<void> => {
      try {
        await this.#terminalEventSink(event);
      } catch {
        // Observability must never alter provider, persistence, or lock behavior.
      }
    };

    const runStage = async (
      state: StageState,
      source: ValidatedImage,
      prompt: string,
    ): Promise<ProviderChainSuccess> => {
      try {
        const result = await this.#chain.editImage({
          chainId: state.chainId,
          source,
          prompt,
          output: state.stage === "extend-cleanup"
            ? Object.freeze({ stage: state.stage, aspectRatio: "source" as const })
            : Object.freeze({ stage: state.stage, aspectRatio: "16:9" as const }),
          ...(options.signal ? { signal: options.signal } : {}),
        });
        state.run = result.run;
        if (!isSuccessfulRun(result, state.chainId, state.stage, providerOrder)) {
          throw new ExtendArtworkError("chain_contract_failure");
        }
        state.winner = result.provider;
        return result;
      } catch (error) {
        if (
          error instanceof ProviderChainExhaustedError
          || error instanceof ProviderChainTerminatedError
        ) {
          state.run = error.run;
          await emit(eventFor(state, error.run.terminalOutcome, {
            ...(error instanceof ProviderChainTerminatedError && error.safeCode
              ? { safeCode: error.safeCode }
              : {}),
          }));
          throw error;
        }
        const safeCode = error instanceof ExtendArtworkError
          ? error.safeCode
          : "chain_contract_failure";
        await emit(eventFor(state, "local_failure", { safeCode }));
        throw error instanceof ExtendArtworkError
          ? error
          : new ExtendArtworkError(safeCode);
      }
    };

    try {
      try {
        lease = await this.#generationLock.acquire({ kind: "extend" });
      } catch (error) {
        const safeCode = isBusyError(error) ? "generation_busy" : "lock_failed";
        await emit(eventFor(cleanupState, "local_failure", { safeCode }));
        if (isBusyError(error)) throw error;
        throw new ExtendArtworkError(safeCode);
      }

      const renderId = deriveLandscapeId(imagePath);
      let outputAvailable: boolean;
      try {
        outputAvailable = await this.#isOutputAvailable(renderId);
      } catch {
        await emit(eventFor(cleanupState, "local_failure", {
          safeCode: "output_preflight_failed",
        }));
        throw new ExtendArtworkError("output_preflight_failed");
      }
      if (!outputAvailable) {
        await emit(eventFor(cleanupState, "local_failure", {
          safeCode: "output_exists",
        }));
        throw new ExtendArtworkError("output_exists");
      }

      let sourceBytes: Buffer;
      try {
        sourceBytes = await this.#readSource(imagePath);
      } catch {
        await emit(eventFor(cleanupState, "local_failure", {
          safeCode: "source_read_failed",
        }));
        throw new ExtendArtworkError("source_read_failed");
      }

      let source: ValidatedImage;
      try {
        source = await this.#validateSource(sourceBytes);
      } catch {
        await emit(eventFor(cleanupState, "local_failure", {
          safeCode: "source_validation_failed",
        }));
        throw new ExtendArtworkError("source_validation_failed");
      }
      if (outpaintPrompt.trim().length === 0) {
        await emit(eventFor(cleanupState, "local_failure", {
          safeCode: "prompt_construction_failed",
        }));
        throw new ExtendArtworkError("prompt_construction_failed");
      }

      const cleanupResult = await runStage(
        cleanupState,
        source,
        EXTEND_CLEANUP_PROMPT,
      );
      await emit(eventFor(cleanupState, "successful"));

      outpaintState = {
        chainId: this.#createId(),
        stage: "extend-outpaint",
      };
      const outpaintResult = await runStage(
        outpaintState,
        cleanupResult.image,
        outpaintPrompt,
      );

      try {
        const now = new Date(this.#now());
        const cleanupMetadata = stageMetadata(cleanupResult);
        const outpaintMetadata = stageMetadata(outpaintResult);
        const metadata: RenderMetadata = {
          id: renderId,
          artworkSource: path.resolve(imagePath),
          scenario: {
            timestampLocal: now.toISOString(),
            hour: now.getHours(),
            isDay: now.getHours() >= 6 && now.getHours() < 18,
          },
          prompt: outpaintPrompt,
          model: outpaintResult.requestedModel,
          createdAt: now.toISOString(),
          outputPath: "",
          responseText: outpaintResult.responseText,
          responseId: outpaintResult.requestId,
          modelVersion: outpaintResult.resolvedModel,
          usageMetadata: usageMetadata(outpaintResult),
          finishReason: outpaintResult.finishReason,
          provider: outpaintResult.provider,
          resolvedModel: outpaintResult.resolvedModel,
          mimeType: outpaintResult.image.mimeType,
          width: outpaintResult.image.width,
          height: outpaintResult.image.height,
          byteCount: outpaintResult.image.byteCount,
          sha256: outpaintResult.image.sha256,
          providerOrder: outpaintResult.run.providerOrder,
          attempts: outpaintResult.run.attempts,
          extendStages: Object.freeze([cleanupMetadata, outpaintMetadata]),
        };

        const outputPath = await this.#store.save(
          outpaintResult.image.bytes,
          metadata,
        );
        metadata.outputPath = outputPath;
        await emit(eventFor(outpaintState, "successful", { renderId }));

        return Object.freeze({
          outputPath,
          provider: outpaintResult.provider,
          model: outpaintResult.requestedModel,
          ...(outpaintResult.resolvedModel
            ? { resolvedModel: outpaintResult.resolvedModel }
            : {}),
          mimeType: outpaintResult.image.mimeType,
          width: outpaintResult.image.width,
          height: outpaintResult.image.height,
          byteCount: outpaintResult.image.byteCount,
          sha256: outpaintResult.image.sha256,
          providerOrder: outpaintResult.run.providerOrder,
          stages: Object.freeze([
            publicStageResult(cleanupMetadata),
            publicStageResult(outpaintMetadata),
          ]),
          ...(outpaintResult.responseText
            ? { responseText: outpaintResult.responseText }
            : {}),
        });
      } catch {
        await emit(eventFor(outpaintState, "local_failure", {
          safeCode: "storage_failed",
        }));
        throw new ExtendArtworkError("storage_failed");
      }
    } finally {
      try {
        await lease?.release();
      } catch {
        // Lease release is token-safe and cannot replace the logical outcome.
      }
    }
  }
}

/** Shared direct-BYOK construction used by the extend-artwork CLI. */
export function createProductionExtendArtworkService(
  config: { imageDir: string; outputDir: string },
  providerConfig: ProviderFactoryConfig,
  dependencies: Omit<ExtendArtworkDependencies, "chain" | "generationLock"> = {},
): ExtendArtworkService {
  const registry = createProviderRegistry(providerConfig);
  const chain = new ProviderChain(registry, {
    providerOrder: providerConfig.providerOrder,
  });
  const generationLock = new GenerationLock({
    lockPath: generationLockPath(config.outputDir),
  });
  return new ExtendArtworkService(config, {
    ...dependencies,
    chain,
    generationLock,
  });
}
