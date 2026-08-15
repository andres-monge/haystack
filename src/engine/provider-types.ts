/** Provider-neutral contracts for one direct image-edit attempt. */

export type ImageProviderId = "gemini" | "openai" | "xai";

export type ImageEditStage =
  | "normal"
  | "extend-cleanup"
  | "extend-outpaint";

export type SupportedImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp";

export const DEFAULT_PROVIDER_TIMEOUT_MS = 180_000;

export const CONFIGURED_ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "4:5",
  "5:4",
  "21:9",
] as const;

export type ConfiguredAspectRatio = typeof CONFIGURED_ASPECT_RATIOS[number];

const CONFIGURED_ASPECT_RATIO_SET: ReadonlySet<string> = new Set(
  CONFIGURED_ASPECT_RATIOS,
);

export function isConfiguredAspectRatio(
  value: unknown,
): value is ConfiguredAspectRatio {
  return typeof value === "string" && CONFIGURED_ASPECT_RATIO_SET.has(value);
}

export function configuredAspectRatioValue(
  ratio: ConfiguredAspectRatio,
): number {
  const [width, height] = ratio.split(":").map(Number);
  return width / height;
}

interface ImageOutputSpecBase {
  /** Absolute ratio delta. Defaults to 0.01 (one percentage point). */
  aspectRatioTolerance?: number;
}

/** Normal can override geometry; cleanup preserves source; outpaint is 16:9. */
export type ImageOutputSpec = ImageOutputSpecBase & (
  | {
      stage: "normal";
      aspectRatio: "source" | ConfiguredAspectRatio;
    }
  | {
      stage: "extend-cleanup";
      aspectRatio: "source";
    }
  | {
      stage: "extend-outpaint";
      aspectRatio: "16:9";
    }
);

export interface ValidatedImage {
  /** Original provider bytes. Validation never transcodes this buffer. */
  bytes: Buffer;
  mimeType: SupportedImageMimeType;
  width: number;
  height: number;
  byteCount: number;
  sha256: string;
}

export type AbortProvenance = "caller_cancelled" | "chain_deadline";

export interface ProviderEditInput {
  source: ValidatedImage;
  prompt: string;
  output: ImageOutputSpec;
  /** Optional chain-owned cancellation. Provider deadlines remain adapter-owned. */
  abort?: {
    signal: AbortSignal;
    provenance: AbortProvenance;
  };
}

export type ProviderAttemptOutcome =
  | "successful"
  | "refusal"
  | "no_image"
  | "invalid_image"
  | "unsupported_output_spec"
  | "provider_timeout"
  | "chain_deadline"
  | "rate_limited"
  | "authentication"
  | "quota"
  | "provider_error"
  | "caller_cancelled";

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costInUsdTicks?: number;
}

export interface RawProviderImageResult {
  bytes?: Uint8Array;
  usage?: ProviderUsage;
}

export interface ProviderEditSuccess {
  outcome: "successful";
  provider: ImageProviderId;
  requestedModel: string;
  resolvedModel?: string;
  image: ValidatedImage;
  responseText?: string;
  requestId?: string;
  usage?: ProviderUsage;
  finishReason?: string;
  /** Present only when this successful provider attempt actually sent a seed. */
  seed?: number;
}

export interface ProviderEditFailure {
  outcome: Exclude<ProviderAttemptOutcome, "successful">;
  provider: ImageProviderId;
  requestedModel: string;
  /** Allowlisted machine-readable provider or validator code only. */
  safeCode?: string;
  requestId?: string;
}

export type ProviderEditResult = ProviderEditSuccess | ProviderEditFailure;

export interface ImageProviderAdapter {
  readonly provider: ImageProviderId;
  readonly model: string;
  editImage(input: ProviderEditInput): Promise<ProviderEditResult>;
}

export function isProviderEditSuccess(
  result: ProviderEditResult,
): result is ProviderEditSuccess {
  return result.outcome === "successful";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(value: unknown, field: string): string | undefined {
  const record = asRecord(value);
  return typeof record?.[field] === "string" ? record[field] : undefined;
}

function numberField(value: unknown, field: string): number | undefined {
  const record = asRecord(value);
  return typeof record?.[field] === "number" ? record[field] : undefined;
}

function structuredCodes(error: unknown): string[] {
  const record = asRecord(error);
  const data = asRecord(record?.data);
  const dataError = asRecord(data?.error);
  const cause = asRecord(record?.cause);
  return [
    stringField(record, "code"),
    stringField(record, "type"),
    stringField(data, "code"),
    stringField(data, "type"),
    stringField(dataError, "code"),
    stringField(dataError, "type"),
    stringField(cause, "code"),
    stringField(cause, "type"),
  ].filter((value): value is string => value !== undefined)
    .map(value => value.toLowerCase());
}

function errorStatus(error: unknown): number | undefined {
  const record = asRecord(error);
  return numberField(record, "statusCode")
    ?? numberField(record, "status")
    ?? numberField(record?.cause, "statusCode")
    ?? numberField(record?.cause, "status");
}

const POLICY_CODES = new Set([
  "content_filter",
  "content_policy_violation",
  "moderation_blocked",
  "policy_violation",
  "safety",
]);

const QUOTA_CODES = new Set([
  "billing_hard_limit_reached",
  "insufficient_credits",
  "insufficient_quota",
]);

const TIMEOUT_CODES = new Set([
  "deadline_exceeded",
  "etimedout",
  "gemini_timeout",
]);

const TRANSPORT_CODES = new Set([
  "econnrefused",
  "econnreset",
  "enetwork",
  "enotfound",
  "eproto",
]);

/** Convert provider exceptions into a small, sanitized fallback taxonomy. */
export function normalizeProviderFailure(
  provider: ImageProviderId,
  requestedModel: string,
  error: unknown,
  options: {
    noImage?: boolean;
    abort?: ProviderEditInput["abort"];
    providerTimeoutSignal?: AbortSignal;
  } = {},
): ProviderEditFailure {
  const codes = structuredCodes(error);
  const status = errorStatus(error);
  const name = stringField(error, "name")?.toLowerCase();
  const safeCode = codes.find(code =>
    POLICY_CODES.has(code)
    || QUOTA_CODES.has(code)
    || TIMEOUT_CODES.has(code)
    || TRANSPORT_CODES.has(code)
  );

  if (options.abort?.signal.aborted) {
    return {
      outcome: options.abort.provenance,
      provider,
      requestedModel,
    };
  }
  if (codes.some(code => POLICY_CODES.has(code))) {
    return { outcome: "refusal", provider, requestedModel, safeCode };
  }
  if (options.noImage) {
    return { outcome: "no_image", provider, requestedModel };
  }
  if (status === 401 || status === 403) {
    return { outcome: "authentication", provider, requestedModel };
  }
  if (status === 402 || codes.some(code => QUOTA_CODES.has(code))) {
    return { outcome: "quota", provider, requestedModel, safeCode };
  }
  if (status === 429) {
    return { outcome: "rate_limited", provider, requestedModel };
  }
  if (
    options.providerTimeoutSignal?.aborted
    || status === 408
    || status === 504
    || [
      "aborterror",
      "timeouterror",
      "geminitimeouterror",
      "apiconnectiontimeouterror",
    ].includes(name ?? "")
    || codes.some(code => TIMEOUT_CODES.has(code))
  ) {
    return {
      outcome: "provider_timeout",
      provider,
      requestedModel,
      safeCode,
    };
  }

  return {
    outcome: "provider_error",
    provider,
    requestedModel,
    safeCode: codes.find(code => TRANSPORT_CODES.has(code)),
  };
}

export function expectedAspectRatio(
  source: Pick<ValidatedImage, "width" | "height">,
  output: ImageOutputSpec,
): number {
  if (output.aspectRatio === "source") return source.width / source.height;
  return configuredAspectRatioValue(output.aspectRatio);
}
