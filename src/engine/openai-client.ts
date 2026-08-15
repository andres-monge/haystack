import { NoImageGeneratedError, generateImage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  ImageProviderAdapter,
  ProviderEditFailure,
  ProviderEditInput,
  ProviderEditResult,
  RawProviderImageResult,
} from "./provider-types.js";
import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  expectedAspectRatio,
  normalizeProviderFailure,
} from "./provider-types.js";
import {
  ImageValidationError,
  validateImage,
  validateImageOutput,
} from "./image-validation.js";

export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2";

export interface OpenAIEditOptions {
  size: `${number}x${number}`;
  quality: "low" | "medium" | "high";
  abortSignal?: AbortSignal;
}

export interface OpenAIClientDependencies {
  generateImage?: typeof generateImage;
  createOpenAI?: typeof createOpenAI;
}

/** Thin direct OpenAI transport reused by production and the fixed comparison. */
export class OpenAIClient {
  private readonly imageModel: ReturnType<ReturnType<typeof createOpenAI>["image"]>;
  private readonly generate: typeof generateImage;

  constructor(
    apiKey: string,
    public readonly model: string = DEFAULT_OPENAI_IMAGE_MODEL,
    dependencies: OpenAIClientDependencies = {},
  ) {
    const openai = (dependencies.createOpenAI ?? createOpenAI)({ apiKey });
    this.imageModel = openai.image(model);
    this.generate = dependencies.generateImage ?? generateImage;
  }

  async editImage(
    imageBuffer: Buffer,
    prompt: string,
    options: OpenAIEditOptions,
  ): Promise<RawProviderImageResult> {
    const result = await this.generate({
      model: this.imageModel,
      prompt: { images: [imageBuffer], text: prompt },
      n: 1,
      size: options.size,
      maxRetries: 0,
      abortSignal: options.abortSignal,
      providerOptions: { openai: { quality: options.quality } },
    });
    return {
      bytes: result.images[0]?.uint8Array,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      },
    };
  }
}

export interface OpenAIImageProviderOptions {
  client?: OpenAIClient;
  model?: string;
  timeoutMs?: number;
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
}

function roundToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

/** Derive a near-2K size whose edges remain API-compliant multiples of 16. */
export function openAIOutputSize(
  input: Pick<ProviderEditInput, "source" | "output">,
): `${number}x${number}` {
  const ratio = expectedAspectRatio(input.source, input.output);
  const longEdge = 2048;
  const multiple = 16;
  const width = ratio >= 1
    ? longEdge
    : roundToMultiple(longEdge * ratio, multiple);
  const height = ratio >= 1
    ? roundToMultiple(longEdge / ratio, multiple)
    : longEdge;
  return `${width}x${height}`;
}

function invalidImageFailure(
  model: string,
  error: ImageValidationError,
): ProviderEditFailure {
  return {
    outcome: "invalid_image",
    provider: "openai",
    requestedModel: model,
    safeCode: error.code,
  };
}

function sizeAspectRatio(size: `${number}x${number}`): number {
  const [width, height] = size.split("x").map(Number);
  return width / height;
}

export class OpenAIImageProvider implements ImageProviderAdapter {
  readonly provider = "openai" as const;
  readonly model: string;
  private readonly client: OpenAIClient;
  private readonly timeoutMs: number;
  private readonly createTimeoutSignal: (timeoutMs: number) => AbortSignal;

  constructor(apiKey: string, options: OpenAIImageProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_OPENAI_IMAGE_MODEL;
    this.client = options.client ?? new OpenAIClient(apiKey, this.model);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    this.createTimeoutSignal = options.createTimeoutSignal
      ?? ((timeoutMs: number) => AbortSignal.timeout(timeoutMs));
  }

  async editImage(input: ProviderEditInput): Promise<ProviderEditResult> {
    if (input.abort?.signal.aborted) {
      return normalizeProviderFailure("openai", this.model, undefined, {
        abort: input.abort,
      });
    }
    const providerTimeoutSignal = this.createTimeoutSignal(this.timeoutMs);
    const abortSignal = input.abort
      ? AbortSignal.any([input.abort.signal, providerTimeoutSignal])
      : providerTimeoutSignal;

    try {
      const size = openAIOutputSize(input);
      const result = await this.client.editImage(input.source.bytes, input.prompt, {
        size,
        quality: "low",
        abortSignal,
      });
      if (!result.bytes) {
        return normalizeProviderFailure("openai", this.model, undefined, {
          noImage: true,
        });
      }
      try {
        const image = input.output.stage === "extend-outpaint"
          ? await validateImageOutput(
              Buffer.from(result.bytes),
              input.source,
              input.output,
            )
          : await validateImage(Buffer.from(result.bytes), {
              // OpenAI requires multiples of 16. Validate the geometry it was
              // actually asked to return instead of the pre-quantized ratio.
              expectedAspectRatio: sizeAspectRatio(size),
              aspectRatioTolerance: input.output.aspectRatioTolerance,
            });
        return {
          outcome: "successful",
          provider: "openai",
          requestedModel: this.model,
          image,
          usage: result.usage,
        };
      } catch (error) {
        if (error instanceof ImageValidationError) {
          return invalidImageFailure(this.model, error);
        }
        throw error;
      }
    } catch (error) {
      return normalizeProviderFailure("openai", this.model, error, {
        noImage: NoImageGeneratedError.isInstance(error),
        abort: input.abort,
        providerTimeoutSignal,
      });
    }
  }
}
