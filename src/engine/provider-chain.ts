import { createHash, randomUUID } from "node:crypto";
import type {
  AbortProvenance,
  ImageEditStage,
  ImageOutputSpec,
  ImageProviderId,
  ProviderEditFailure,
  ProviderEditInput,
  ProviderEditSuccess,
  ProviderUsage,
  SupportedImageMimeType,
  ValidatedImage,
} from "./provider-types.js";
import { isConfiguredAspectRatio } from "./provider-types.js";
import type { ImageProviderRegistry } from "./provider-factory.js";

export const DEFAULT_PROVIDER_CHAIN_TIMEOUT_MS = 570_000;

const FALLBACK_OUTCOMES = new Set<ProviderEditFailure["outcome"]>([
  "refusal",
  "no_image",
  "invalid_image",
  "unsupported_output_spec",
  "provider_timeout",
  "rate_limited",
  "authentication",
  "quota",
  "provider_error",
]);

const SUPPORTED_MIME_TYPES = new Set<SupportedImageMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export interface ProviderAttemptImageData {
  mimeType: SupportedImageMimeType;
  width: number;
  height: number;
  byteCount: number;
  sha256: string;
}

export interface ProviderAttemptRecord {
  attemptId: string;
  stage: ImageEditStage;
  ordinal: number;
  provider: ImageProviderId;
  requestedModel: string;
  resolvedModel?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  outcome: ProviderEditFailure["outcome"] | "successful";
  abortProvenance?: AbortProvenance;
  safeCode?: string;
  requestId?: string;
  usage?: ProviderUsage;
  image?: ProviderAttemptImageData;
}

export type ProviderChainTerminalOutcome =
  | "successful"
  | "exhausted"
  | "caller_cancelled"
  | "chain_deadline"
  | "local_failure";

export interface ProviderChainRunData {
  chainId: string;
  stage: ImageEditStage;
  providerOrder: readonly ImageProviderId[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  terminalOutcome: ProviderChainTerminalOutcome;
  winner?: ImageProviderId;
  attempts: readonly ProviderAttemptRecord[];
}

export interface ProviderChainEditInput {
  /** Optional application-owned ID used to correlate pre/post-chain failures. */
  chainId?: string;
  source: ValidatedImage;
  prompt: string;
  output: ImageOutputSpec;
  signal?: AbortSignal;
}

export type ProviderChainSuccess = ProviderEditSuccess & {
  run: ProviderChainRunData;
};

export interface ProviderChainOptions {
  providerOrder?: readonly ImageProviderId[];
  chainTimeoutMs?: number;
  createDeadlineSignal?: (timeoutMs: number) => AbortSignal;
  now?: () => number;
  createId?: () => string;
}

class ChainInputError extends Error {
  constructor(readonly safeCode: string) {
    super("Image edit input is invalid");
  }
}

export class ProviderChainExhaustedError extends Error {
  readonly code = "PROVIDER_CHAIN_EXHAUSTED";

  constructor(readonly run: ProviderChainRunData) {
    super("All configured image providers were exhausted");
    this.name = "ProviderChainExhaustedError";
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, message: this.message, run: this.run };
  }
}

export class ProviderChainTerminatedError extends Error {
  readonly code = "PROVIDER_CHAIN_TERMINATED";

  constructor(
    readonly outcome: Exclude<ProviderChainTerminalOutcome, "successful" | "exhausted">,
    readonly run: ProviderChainRunData,
    readonly safeCode?: string,
  ) {
    super("Image provider chain stopped before completion");
    this.name = "ProviderChainTerminatedError";
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      outcome: this.outcome,
      ...(this.safeCode ? { safeCode: this.safeCode } : {}),
      run: this.run,
    };
  }
}

interface RunAbortContext {
  abort: NonNullable<ProviderEditInput["abort"]>;
  provenance: () => AbortProvenance | undefined;
  dispose: () => void;
}

function createRunAbortContext(
  callerSignal: AbortSignal | undefined,
  deadlineSignal: AbortSignal,
): RunAbortContext {
  const controller = new AbortController();
  let provenance: AbortProvenance | undefined;
  const abortWith = (next: AbortProvenance) => {
    if (provenance) return;
    provenance = next;
    controller.abort();
  };
  const callerListener = () => abortWith("caller_cancelled");
  const deadlineListener = () => abortWith("chain_deadline");

  callerSignal?.addEventListener("abort", callerListener, { once: true });
  deadlineSignal.addEventListener("abort", deadlineListener, { once: true });
  if (callerSignal?.aborted) abortWith("caller_cancelled");
  if (deadlineSignal.aborted) abortWith("chain_deadline");

  const abort = {
    signal: controller.signal,
    get provenance(): AbortProvenance {
      return provenance ?? (callerSignal ? "caller_cancelled" : "chain_deadline");
    },
  };

  return {
    abort,
    provenance: () => provenance,
    dispose: () => {
      callerSignal?.removeEventListener("abort", callerListener);
      deadlineSignal.removeEventListener("abort", deadlineListener);
    },
  };
}

function snapshotSource(source: ValidatedImage): ValidatedImage {
  if (!Buffer.isBuffer(source.bytes) || source.bytes.length === 0) {
    throw new ChainInputError("invalid_source");
  }
  if (
    !SUPPORTED_MIME_TYPES.has(source.mimeType)
    || !Number.isInteger(source.width)
    || source.width <= 0
    || !Number.isInteger(source.height)
    || source.height <= 0
    || source.byteCount !== source.bytes.length
  ) {
    throw new ChainInputError("invalid_source_metadata");
  }
  const sha256 = createHash("sha256").update(source.bytes).digest("hex");
  if (source.sha256 !== sha256) {
    throw new ChainInputError("invalid_source_digest");
  }
  return Object.freeze({ ...source, bytes: Buffer.from(source.bytes) });
}

function snapshotOutput(output: ImageOutputSpec): ImageOutputSpec {
  const validShape = output.stage === "normal"
    ? output.aspectRatio === "source" || isConfiguredAspectRatio(output.aspectRatio)
    : output.stage === "extend-cleanup"
      ? output.aspectRatio === "source"
    : output.stage === "extend-outpaint" && output.aspectRatio === "16:9";
  if (
    !validShape
    || (output.aspectRatioTolerance !== undefined
      && (!Number.isFinite(output.aspectRatioTolerance) || output.aspectRatioTolerance < 0))
  ) {
    throw new ChainInputError("invalid_output_spec");
  }
  return Object.freeze({ ...output });
}

function safeToken(value: string | undefined, maxLength: number): string | undefined {
  if (
    value === undefined
    || value.length === 0
    || value.length > maxLength
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
  ) {
    return undefined;
  }
  return value;
}

function safeUsage(usage: ProviderUsage | undefined): ProviderUsage | undefined {
  if (!usage) return undefined;
  const safe: ProviderUsage = {};
  for (const key of [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "costInUsdTicks",
  ] as const) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length > 0 ? Object.freeze(safe) : undefined;
}

function safeAttempt(
  result: ProviderEditFailure | ProviderEditSuccess,
  input: {
    attemptId: string;
    stage: ImageEditStage;
    ordinal: number;
    startedMs: number;
    completedMs: number;
    forcedAbort?: AbortProvenance;
  },
): ProviderAttemptRecord {
  const outcome = input.forcedAbort ?? result.outcome;
  const success = result.outcome === "successful" && !input.forcedAbort ? result : undefined;
  const failure = result.outcome !== "successful" ? result : undefined;
  const usage = safeUsage(success?.usage);
  const record: ProviderAttemptRecord = {
    attemptId: input.attemptId,
    stage: input.stage,
    ordinal: input.ordinal,
    provider: result.provider,
    requestedModel: safeToken(result.requestedModel, 160) ?? "unknown",
    ...(success?.resolvedModel
      ? { resolvedModel: safeToken(success.resolvedModel, 160) }
      : {}),
    startedAt: new Date(input.startedMs).toISOString(),
    completedAt: new Date(input.completedMs).toISOString(),
    durationMs: Math.max(0, input.completedMs - input.startedMs),
    outcome,
    ...(outcome === "caller_cancelled" || outcome === "chain_deadline"
      ? { abortProvenance: outcome }
      : {}),
    ...(failure?.safeCode ? { safeCode: safeToken(failure.safeCode, 80) } : {}),
    ...(result.requestId ? { requestId: safeToken(result.requestId, 160) } : {}),
    ...(usage ? { usage } : {}),
    ...(success
      ? {
          image: Object.freeze({
            mimeType: success.image.mimeType,
            width: success.image.width,
            height: success.image.height,
            byteCount: success.image.byteCount,
            sha256: success.image.sha256,
          }),
        }
      : {}),
  };
  return Object.freeze(Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  )) as unknown as ProviderAttemptRecord;
}

export class ProviderChain {
  readonly #registry: ImageProviderRegistry;
  readonly #providerOrder: readonly ImageProviderId[];
  readonly #chainTimeoutMs: number;
  readonly #createDeadlineSignal: (timeoutMs: number) => AbortSignal;
  readonly #now: () => number;
  readonly #createId: () => string;

  constructor(registry: ImageProviderRegistry, options: ProviderChainOptions = {}) {
    const order = options.providerOrder ?? registry.ids;
    if (order.length === 0 || new Set(order).size !== order.length) {
      throw new Error("Provider chain order must contain unique configured providers");
    }
    for (const provider of order) {
      if (!registry.has(provider)) {
        throw new Error(`Provider chain order includes unconfigured provider ${provider}`);
      }
    }
    const timeoutMs = options.chainTimeoutMs ?? DEFAULT_PROVIDER_CHAIN_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Provider chain timeout must be a positive number");
    }
    this.#registry = registry;
    this.#providerOrder = Object.freeze([...order]);
    this.#chainTimeoutMs = timeoutMs;
    this.#createDeadlineSignal = options.createDeadlineSignal
      ?? (value => AbortSignal.timeout(value));
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? randomUUID;
  }

  getProviderOrder(): readonly ImageProviderId[] {
    return Object.freeze([...this.#providerOrder]);
  }

  async editImage(input: ProviderChainEditInput): Promise<ProviderChainSuccess> {
    const chainId = safeToken(input.chainId, 200) ?? this.#createId();
    const startedMs = this.#now();
    const providerOrder = Object.freeze([...this.#providerOrder]);
    const attempts: ProviderAttemptRecord[] = [];
    const stage = input.output.stage;

    const finalize = (
      terminalOutcome: ProviderChainTerminalOutcome,
      winner?: ImageProviderId,
    ): ProviderChainRunData => {
      const completedMs = this.#now();
      return Object.freeze({
        chainId,
        stage,
        providerOrder,
        startedAt: new Date(startedMs).toISOString(),
        completedAt: new Date(completedMs).toISOString(),
        durationMs: Math.max(0, completedMs - startedMs),
        terminalOutcome,
        ...(winner ? { winner } : {}),
        attempts: Object.freeze([...attempts]),
      });
    };

    if (input.signal?.aborted) {
      throw new ProviderChainTerminatedError(
        "caller_cancelled",
        finalize("caller_cancelled"),
      );
    }

    let source: ValidatedImage;
    let output: ImageOutputSpec;
    let prompt: string;
    try {
      if (typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
        throw new ChainInputError("invalid_prompt");
      }
      prompt = input.prompt;
      source = snapshotSource(input.source);
      output = snapshotOutput(input.output);
    } catch (error) {
      const safeCode = error instanceof ChainInputError
        ? error.safeCode
        : "invalid_edit_input";
      throw new ProviderChainTerminatedError(
        "local_failure",
        finalize("local_failure"),
        safeCode,
      );
    }

    const deadlineSignal = this.#createDeadlineSignal(this.#chainTimeoutMs);
    const runAbort = createRunAbortContext(input.signal, deadlineSignal);
    try {
      const initialAbort = runAbort.provenance();
      if (initialAbort) {
        throw new ProviderChainTerminatedError(
          initialAbort,
          finalize(initialAbort),
        );
      }

      for (let index = 0; index < providerOrder.length; index += 1) {
        const providerId = providerOrder[index];
        const preCallAbort = runAbort.provenance();
        if (preCallAbort) {
          throw new ProviderChainTerminatedError(
            preCallAbort,
            finalize(preCallAbort),
          );
        }

        const adapter = this.#registry.get(providerId);
        const attemptStartedMs = this.#now();
        let result: ProviderEditFailure | ProviderEditSuccess;
        try {
          result = await adapter.editImage({
            source: Object.freeze({ ...source, bytes: Buffer.from(source.bytes) }),
            prompt,
            output: Object.freeze({ ...output }),
            abort: runAbort.abort,
          });
        } catch {
          const abort = runAbort.provenance();
          if (abort) {
            result = {
              outcome: abort,
              provider: providerId,
              requestedModel: adapter.model,
            };
          } else {
            throw new ProviderChainTerminatedError(
              "local_failure",
              finalize("local_failure"),
              "adapter_contract_failure",
            );
          }
        }

        if (result.provider !== providerId) {
          throw new ProviderChainTerminatedError(
            "local_failure",
            finalize("local_failure"),
            "adapter_provider_mismatch",
          );
        }

        const completedMs = this.#now();
        const forcedAbort = runAbort.provenance();
        attempts.push(safeAttempt(result, {
          attemptId: this.#createId(),
          stage,
          ordinal: index + 1,
          startedMs: attemptStartedMs,
          completedMs,
          forcedAbort,
        }));

        if (forcedAbort) {
          throw new ProviderChainTerminatedError(
            forcedAbort,
            finalize(forcedAbort),
          );
        }
        if (result.outcome === "successful") {
          return Object.freeze({
            ...result,
            run: finalize("successful", result.provider),
          });
        }
        if (result.outcome === "caller_cancelled" || result.outcome === "chain_deadline") {
          throw new ProviderChainTerminatedError(
            result.outcome,
            finalize(result.outcome),
          );
        }
        if (!FALLBACK_OUTCOMES.has(result.outcome)) {
          throw new ProviderChainTerminatedError(
            "local_failure",
            finalize("local_failure"),
            "unknown_provider_outcome",
          );
        }
      }

      throw new ProviderChainExhaustedError(finalize("exhausted"));
    } finally {
      runAbort.dispose();
    }
  }
}
