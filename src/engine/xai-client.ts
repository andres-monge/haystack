import { NoImageGeneratedError, generateImage } from "ai";
import { createXai } from "@ai-sdk/xai";
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
  DEFAULT_ASPECT_RATIO_TOLERANCE,
  ImageValidationError,
  validateImageOutput,
} from "./image-validation.js";

export const DEFAULT_XAI_IMAGE_MODEL = "grok-imagine-image-2.0";
const XAI_SOURCE_ASPECT_RATIO_RELATIVE_TOLERANCE = 0.01;

export const XAI_EDIT_ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "19.5:9",
  "9:19.5",
  "20:9",
  "9:20",
] as const;

export type XaiEditAspectRatio = typeof XAI_EDIT_ASPECT_RATIOS[number];

export interface XaiEditOptions {
  aspectRatio?: XaiEditAspectRatio;
  resolution: "1k" | "2k";
  quality: "low" | "medium";
  abortSignal?: AbortSignal;
}

export interface XaiClientDependencies {
  generateImage?: typeof generateImage;
  createXai?: typeof createXai;
}

/** Thin direct xAI transport reused by production and the fixed comparison. */
export class XaiClient {
  private readonly imageModel: ReturnType<ReturnType<typeof createXai>["image"]>;
  private readonly generate: typeof generateImage;

  constructor(
    apiKey: string,
    public readonly model: string = DEFAULT_XAI_IMAGE_MODEL,
    dependencies: XaiClientDependencies = {},
  ) {
    const xai = (dependencies.createXai ?? createXai)({ apiKey });
    this.imageModel = xai.image(model);
    this.generate = dependencies.generateImage ?? generateImage;
  }

  async editImage(
    imageBuffer: Buffer,
    prompt: string,
    options: XaiEditOptions,
  ): Promise<RawProviderImageResult> {
    const result = await this.generate({
      model: this.imageModel,
      prompt: { images: [imageBuffer], text: prompt },
      n: 1,
      ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
      maxRetries: 0,
      abortSignal: options.abortSignal,
      providerOptions: {
        xai: {
          resolution: options.resolution,
          quality: options.quality,
        },
      },
    });
    const xaiMetadata = result.providerMetadata.xai;
    const cost = typeof xaiMetadata === "object"
      && xaiMetadata !== null
      && !Array.isArray(xaiMetadata)
      && "costInUsdTicks" in xaiMetadata
      ? xaiMetadata.costInUsdTicks
      : undefined;
    return {
      bytes: result.images[0]?.uint8Array,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        costInUsdTicks: typeof cost === "number" ? cost : undefined,
      },
    };
  }
}

export interface XaiImageProviderOptions {
  client?: XaiClient;
  model?: string;
  timeoutMs?: number;
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
}

function failure(
  model: string,
  outcome: ProviderEditFailure["outcome"],
  safeCode?: string,
): ProviderEditFailure {
  return { outcome, provider: "xai", requestedModel: model, safeCode };
}

export class XaiImageProvider implements ImageProviderAdapter {
  readonly provider = "xai" as const;
  readonly model: string;
  private readonly client: XaiClient;
  private readonly timeoutMs: number;
  private readonly createTimeoutSignal: (timeoutMs: number) => AbortSignal;

  constructor(apiKey: string, options: XaiImageProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_XAI_IMAGE_MODEL;
    this.client = options.client ?? new XaiClient(apiKey, this.model);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    this.createTimeoutSignal = options.createTimeoutSignal
      ?? ((timeoutMs: number) => AbortSignal.timeout(timeoutMs));
  }

  async editImage(input: ProviderEditInput): Promise<ProviderEditResult> {
    if (input.abort?.signal.aborted) {
      return normalizeProviderFailure("xai", this.model, undefined, {
        abort: input.abort,
      });
    }
    const targetRatio = expectedAspectRatio(input.source, input.output);
    let aspectRatio: XaiEditAspectRatio | undefined;
    if (
      input.output.stage === "extend-outpaint"
      || (input.output.stage === "normal" && input.output.aspectRatio !== "source")
    ) {
      const sourceRatio = input.source.width / input.source.height;
      const tolerance = input.output.aspectRatioTolerance
        ?? DEFAULT_ASPECT_RATIO_TOLERANCE;
      if (Math.abs(sourceRatio - targetRatio) > tolerance) {
        return failure(
          this.model,
          "unsupported_output_spec",
          "xai_edit_preserves_input_ratio",
        );
      }
      if (!XAI_EDIT_ASPECT_RATIOS.includes(
        input.output.aspectRatio as XaiEditAspectRatio,
      )) {
        return failure(
          this.model,
          "unsupported_output_spec",
          "xai_unsupported_aspect_ratio",
        );
      }
      aspectRatio = input.output.aspectRatio as XaiEditAspectRatio;
    }

    const providerTimeoutSignal = this.createTimeoutSignal(this.timeoutMs);
    const abortSignal = input.abort
      ? AbortSignal.any([input.abort.signal, providerTimeoutSignal])
      : providerTimeoutSignal;

    try {
      const result = await this.client.editImage(input.source.bytes, input.prompt, {
        // A one-image xAI edit preserves its source geometry. Only the
        // already-16:9 outpaint path needs an explicit provider ratio.
        ...(aspectRatio ? { aspectRatio } : {}),
        resolution: input.output.stage === "normal" ? "1k" : "2k",
        quality: "low",
        abortSignal,
      });
      if (!result.bytes) {
        return normalizeProviderFailure("xai", this.model, undefined, {
          noImage: true,
        });
      }
      try {
        const validationOutput = input.output.aspectRatio === "source"
          && input.output.aspectRatioTolerance === undefined
          ? {
              ...input.output,
              aspectRatioTolerance:
                targetRatio * XAI_SOURCE_ASPECT_RATIO_RELATIVE_TOLERANCE,
            }
          : input.output;
        const image = await validateImageOutput(
          Buffer.from(result.bytes),
          input.source,
          validationOutput,
        );
        return {
          outcome: "successful",
          provider: "xai",
          requestedModel: this.model,
          image,
          usage: result.usage,
        };
      } catch (error) {
        if (error instanceof ImageValidationError) {
          return failure(this.model, "invalid_image", error.code);
        }
        throw error;
      }
    } catch (error) {
      return normalizeProviderFailure("xai", this.model, error, {
        noImage: NoImageGeneratedError.isInstance(error),
        abort: input.abort,
        providerTimeoutSignal,
      });
    }
  }
}
