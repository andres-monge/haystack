import { describe, expect, it } from "vitest";
import {
  ImageValidationError,
  detectSupportedImage,
  validateImage,
  validateImageOutput,
} from "../../src/engine/image-validation.js";

const PNG_2X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=",
  "base64",
);

const JPEG_2X1 = Buffer.from(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAbEAEAAAcAAAAAAAAAAAAAAAAAAQMEBTVzsv/EABQBAQAAAAAAAAAAAAAAAAAAAAf/xAAdEQABAgcAAAAAAAAAAAAAAAAAAQMCBTI0cXKy/9oADAMBAAIRAxEAPwCjZcPQaJfMABE5WuQVm9+/vF0p/9k=",
  "base64",
);

const WEBP_2X1 = Buffer.from(
  "UklGRjwAAABXRUJQVlA4IDAAAACwAQCdASoCAAEAAUAmJaACdAEO/gLsAM4/Whd1iCP/9NI//ppH/9NI+YsrSaSSAAA=",
  "base64",
);

describe("engine image validation", () => {
  it.each([
    ["PNG", PNG_2X1, "image/png"],
    ["JPEG", JPEG_2X1, "image/jpeg"],
    ["WebP", WEBP_2X1, "image/webp"],
  ] as const)("fully decodes supported %s bytes", async (_label, bytes, mimeType) => {
    const image = await validateImage(bytes);

    expect(image).toMatchObject({
      bytes,
      mimeType,
      width: 2,
      height: 1,
      byteCount: bytes.length,
    });
    expect(image.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps synchronous signature detection available for the fixed comparison", () => {
    expect(detectSupportedImage(PNG_2X1)).toBe("image/png");
    expect(detectSupportedImage(JPEG_2X1)).toBe("image/jpeg");
    expect(detectSupportedImage(WEBP_2X1)).toBe("image/webp");
  });

  it.each([
    ["empty", Buffer.alloc(0), "empty"],
    ["truncated", PNG_2X1.subarray(0, 20), "decode_failed"],
    ["unsupported", Buffer.from("not-an-image"), "unsupported_signature"],
    ["oversized", Buffer.concat([PNG_2X1, Buffer.alloc(20 * 1024 * 1024)]), "too_large"],
  ] as const)("rejects %s image bytes with safe code", async (_label, bytes, code) => {
    await expect(validateImage(bytes)).rejects.toMatchObject<Partial<ImageValidationError>>({
      name: "ImageValidationError",
      code,
    });
  });

  it("rejects a supported signature whose decoder reports a different format", async () => {
    await expect(
      validateImage(PNG_2X1, {}, {
        decode: async () => ({ format: "jpeg", width: 2, height: 1 }),
      }),
    ).rejects.toMatchObject({ code: "mime_mismatch" });
  });

  it("rejects decoded images with zero dimensions", async () => {
    await expect(
      validateImage(PNG_2X1, {}, {
        decode: async () => ({ format: "png", width: 0, height: 1 }),
      }),
    ).rejects.toMatchObject({ code: "invalid_dimensions" });
  });

  it("enforces source-preserving and exact aspect-ratio contracts", async () => {
    const source = await validateImage(PNG_2X1);

    await expect(
      validateImageOutput(PNG_2X1, source, {
        stage: "normal",
        aspectRatio: "source",
      }),
    ).resolves.toMatchObject({ width: 2, height: 1 });

    await expect(
      validateImageOutput(PNG_2X1, source, {
        stage: "extend-outpaint",
        aspectRatio: "16:9",
      }),
    ).rejects.toMatchObject({ code: "aspect_ratio_mismatch" });
  });
});
