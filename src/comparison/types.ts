/** Providers included in the first comparison round. */
export type Round1ProviderId = "gemini" | "openai" | "xai";

export type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export type ComparisonErrorCategory =
  | "configuration"
  | "authentication"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "transport"
  | "provider"
  | "unknown";

export type ComparisonUnsuccessfulReason =
  | "no_image"
  | "policy"
  | "unusable_image";

export type ComparisonProviderResult =
  | {
      status: "successful";
      imageBuffer: Buffer;
      mimeType: SupportedImageMimeType;
    }
  | {
      status: "unsuccessful";
      reason: ComparisonUnsuccessfulReason;
    }
  | {
      status: "error";
      category: ComparisonErrorCategory;
    };

export interface ComparisonProvider {
  readonly provider: Round1ProviderId;
  readonly model: string;
  readonly outputSetting: string;
  editImage(imageBuffer: Buffer, prompt: string): Promise<ComparisonProviderResult>;
}

/** Optional until the comparison preflight validates the full Round 1 set. */
export interface ComparisonProviderKeys {
  googleApiKey?: string;
  openaiApiKey?: string;
  xaiApiKey?: string;
}

export interface Round1ProviderKeys {
  googleApiKey: string;
  openaiApiKey: string;
  xaiApiKey: string;
}
