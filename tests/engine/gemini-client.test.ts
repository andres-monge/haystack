import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeminiClient, DEFAULT_GEMINI_CONFIG } from "../../src/engine/gemini-client.js";

// Mock the @google/genai SDK
const mockGenerateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

describe("GeminiClient", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  describe("DEFAULT_GEMINI_CONFIG", () => {
    it("defaults to gemini-2.5-flash-image model", () => {
      expect(DEFAULT_GEMINI_CONFIG.model).toBe("gemini-2.5-flash-image");
    });

    it("does not set aspectRatio by default", () => {
      expect(DEFAULT_GEMINI_CONFIG.aspectRatio).toBeUndefined();
    });
  });

  describe("editImage", () => {
    it("returns image buffer and response text from API", async () => {
      const fakeImageData = Buffer.from("fake-output-image").toString("base64");
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [
                { text: "Here is your edited image" },
                { inlineData: { data: fakeImageData } },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 1290,
          totalTokenCount: 1390,
        },
      });

      const client = new GeminiClient("fake-key");
      // PNG magic bytes
      const inputImage = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
      const result = await client.editImage(inputImage, "Edit this image");

      expect(result.imageBuffer).toEqual(Buffer.from("fake-output-image"));
      expect(result.responseText).toBe("Here is your edited image");
      expect(result.finishReason).toBe("STOP");
      expect(result.usageMetadata?.totalTokenCount).toBe(1390);
    });

    it("throws when Gemini returns no image", async () => {
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: "I cannot edit this image" }],
            },
            finishReason: "SAFETY",
          },
        ],
      });

      const client = new GeminiClient("fake-key");
      const inputImage = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);

      await expect(
        client.editImage(inputImage, "Edit this image"),
      ).rejects.toThrow("Gemini did not return an image");
    });

    it("detects PNG mime type from magic bytes", async () => {
      const fakeImageData = Buffer.from("output").toString("base64");
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: fakeImageData } }],
            },
          },
        ],
      });

      const client = new GeminiClient("fake-key");
      // PNG header: 89 50 4E 47
      const pngInput = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
      await client.editImage(pngInput, "test");

      const call = mockGenerateContent.mock.calls[0][0];
      const inlineDataPart = call.contents[1];
      expect(inlineDataPart.inlineData.mimeType).toBe("image/png");
    });

    it("detects JPEG mime type from magic bytes", async () => {
      const fakeImageData = Buffer.from("output").toString("base64");
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: fakeImageData } }],
            },
          },
        ],
      });

      const client = new GeminiClient("fake-key");
      // JPEG header: FF D8
      const jpegInput = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
      await client.editImage(jpegInput, "test");

      const call = mockGenerateContent.mock.calls[0][0];
      const inlineDataPart = call.contents[1];
      expect(inlineDataPart.inlineData.mimeType).toBe("image/jpeg");
    });

    it("detects WebP mime type from magic bytes", async () => {
      const fakeImageData = Buffer.from("output").toString("base64");
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: fakeImageData } }],
            },
          },
        ],
      });

      const client = new GeminiClient("fake-key");
      // WebP header: RIFF....WEBP (bytes 0-3 = RIFF, 8-11 = WEBP)
      const webpInput = Buffer.alloc(12);
      webpInput[0] = 0x52; // R
      webpInput[1] = 0x49; // I
      webpInput[2] = 0x46; // F
      webpInput[3] = 0x46; // F
      webpInput[8] = 0x57; // W
      webpInput[9] = 0x45; // E
      webpInput[10] = 0x42; // B
      webpInput[11] = 0x50; // P
      await client.editImage(webpInput, "test");

      const call = mockGenerateContent.mock.calls[0][0];
      const inlineDataPart = call.contents[1];
      expect(inlineDataPart.inlineData.mimeType).toBe("image/webp");
    });

    it("falls back to image/png for unknown formats", async () => {
      const fakeImageData = Buffer.from("output").toString("base64");
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: fakeImageData } }],
            },
          },
        ],
      });

      const client = new GeminiClient("fake-key");
      const unknownInput = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      await client.editImage(unknownInput, "test");

      const call = mockGenerateContent.mock.calls[0][0];
      const inlineDataPart = call.contents[1];
      expect(inlineDataPart.inlineData.mimeType).toBe("image/png");
    });

    it("passes imageConfig when aspectRatio is set", async () => {
      const fakeImageData = Buffer.from("output").toString("base64");
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: fakeImageData } }],
            },
          },
        ],
      });

      const client = new GeminiClient("fake-key");
      const inputImage = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      await client.editImage(inputImage, "test", {
        model: "gemini-2.5-flash-image",
        aspectRatio: "16:9",
      });

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.config.imageConfig).toEqual({ aspectRatio: "16:9" });
    });

    it("passes seed when configured", async () => {
      const fakeImageData = Buffer.from("output").toString("base64");
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: fakeImageData } }],
            },
          },
        ],
      });

      const client = new GeminiClient("fake-key");
      const inputImage = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      await client.editImage(inputImage, "test", {
        model: "gemini-2.5-flash-image",
        seed: 42,
      });

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.config.seed).toBe(42);
    });

    it("passes imageSize only for pro model", async () => {
      const fakeImageData = Buffer.from("output").toString("base64");
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: fakeImageData } }],
            },
          },
        ],
      });

      const client = new GeminiClient("fake-key");
      const inputImage = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

      // Pro model — imageSize should be included
      await client.editImage(inputImage, "test", {
        model: "gemini-3-pro-image-preview",
        imageSize: "4K",
      });
      const proCall = mockGenerateContent.mock.calls[0][0];
      expect(proCall.config.imageConfig).toEqual({ imageSize: "4K" });

      mockGenerateContent.mockClear();

      // Flash model — imageSize should be excluded
      await client.editImage(inputImage, "test", {
        model: "gemini-2.5-flash-image",
        imageSize: "4K",
      });
      const flashCall = mockGenerateContent.mock.calls[0][0];
      expect(flashCall.config.imageConfig).toBeUndefined();
    });

    it("reads image from file path when string is provided", async () => {
      const fakeImageData = Buffer.from("output").toString("base64");
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: fakeImageData } }],
            },
          },
        ],
      });

      // Create a temporary test file with PNG magic bytes
      const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      const tempDir = mkdtempSync(join(tmpdir(), "haystack-test-"));
      const testFilePath = join(tempDir, "test.png");
      writeFileSync(testFilePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      try {
        const client = new GeminiClient("fake-key");
        const result = await client.editImage(testFilePath, "test");

        expect(result.imageBuffer).toEqual(Buffer.from("output"));
        const call = mockGenerateContent.mock.calls[0][0];
        expect(call.contents[1].inlineData.mimeType).toBe("image/png");
      } finally {
        rmSync(tempDir, { recursive: true });
      }
    });
  });
});
