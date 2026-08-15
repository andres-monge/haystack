import { createHash } from "node:crypto";
import sharp from "sharp";
import type {
  ImageOutputSpec,
  SupportedImageMimeType,
  ValidatedImage,
} from "./provider-types.js";
import { expectedAspectRatio } from "./provider-types.js";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 100_000_000;
export const DEFAULT_ASPECT_RATIO_TOLERANCE = 0.01;

export type ImageValidationCode =
  | "empty"
  | "too_large"
  | "unsupported_signature"
  | "decode_failed"
  | "mime_mismatch"
  | "invalid_dimensions"
  | "aspect_ratio_mismatch";

export class ImageValidationError extends Error {
  constructor(public readonly code: ImageValidationCode) {
    super(`Image validation failed: ${code}`);
    this.name = "ImageValidationError";
  }
}

export interface DecodedImageMetadata {
  format?: string;
  width?: number;
  height?: number;
}

export interface ImageValidationDependencies {
  decode?: (
    bytes: Buffer,
    maxPixels: number,
  ) => Promise<DecodedImageMetadata>;
}

export interface ImageValidationOptions {
  maxBytes?: number;
  maxPixels?: number;
  expectedAspectRatio?: number;
  aspectRatioTolerance?: number;
}

export function detectSupportedImage(
  bytes: Buffer,
): SupportedImageMimeType | undefined {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return undefined;

  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";

  if (
    bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) return "image/jpeg";

  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";

  return undefined;
}

async function decodeWithSharp(
  bytes: Buffer,
  maxPixels: number,
): Promise<DecodedImageMetadata> {
  const image = sharp(bytes, {
    failOn: "error",
    limitInputPixels: maxPixels,
  });
  const metadata = await image.metadata();
  // stats() walks the decoded pixels, catching truncation that header-only
  // metadata inspection can miss. The original bytes remain authoritative.
  await image.stats();
  return metadata;
}

function mimeForFormat(format?: string): SupportedImageMimeType | undefined {
  if (format === "png") return "image/png";
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return undefined;
}

export async function validateImage(
  bytes: Buffer,
  options: ImageValidationOptions = {},
  dependencies: ImageValidationDependencies = {},
): Promise<ValidatedImage> {
  if (bytes.length === 0) throw new ImageValidationError("empty");
  if (bytes.length > (options.maxBytes ?? MAX_IMAGE_BYTES)) {
    throw new ImageValidationError("too_large");
  }

  const signatureMime = detectSupportedImage(bytes);
  if (!signatureMime) throw new ImageValidationError("unsupported_signature");

  let decoded: DecodedImageMetadata;
  try {
    decoded = await (dependencies.decode ?? decodeWithSharp)(
      bytes,
      options.maxPixels ?? MAX_IMAGE_PIXELS,
    );
  } catch {
    throw new ImageValidationError("decode_failed");
  }

  const decodedMime = mimeForFormat(decoded.format);
  if (!decodedMime || decodedMime !== signatureMime) {
    throw new ImageValidationError("mime_mismatch");
  }
  if (
    decoded.width === undefined
    || decoded.height === undefined
    || !Number.isInteger(decoded.width)
    || !Number.isInteger(decoded.height)
    || decoded.width <= 0
    || decoded.height <= 0
  ) {
    throw new ImageValidationError("invalid_dimensions");
  }

  if (options.expectedAspectRatio !== undefined) {
    const actual = decoded.width / decoded.height;
    const tolerance = options.aspectRatioTolerance
      ?? DEFAULT_ASPECT_RATIO_TOLERANCE;
    if (Math.abs(actual - options.expectedAspectRatio) > tolerance) {
      throw new ImageValidationError("aspect_ratio_mismatch");
    }
  }

  return {
    bytes,
    mimeType: decodedMime,
    width: decoded.width,
    height: decoded.height,
    byteCount: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function validateImageOutput(
  bytes: Buffer,
  source: Pick<ValidatedImage, "width" | "height">,
  output: ImageOutputSpec,
): Promise<ValidatedImage> {
  return validateImage(bytes, {
    expectedAspectRatio: expectedAspectRatio(source, output),
    aspectRatioTolerance: output.aspectRatioTolerance,
  });
}
