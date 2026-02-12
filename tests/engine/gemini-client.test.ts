import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
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

/** Helper to set up a mock response with an image (and optional text). */
function mockImageResponse(
  text?: string,
  extras: Record<string, unknown> = {},
) {
  const fakeImageData = Buffer.from("output").toString("base64");
  mockGenerateContent.mockResolvedValue({
    candidates: [
      {
        content: {
          parts: [
            ...(text ? [{ text }] : []),
            { inlineData: { data: fakeImageData } },
          ],
        },
        finishReason: "STOP",
        ...extras,
      },
    ],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 1290,
      totalTokenCount: 1390,
    },
    responseId: "mock-response-id",
    modelVersion: "gemini-2.5-flash-image-001",
  });
}

/** Minimal valid PNG buffer (>= 12 bytes for mime detection). */
const PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe("GeminiClient", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
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
        responseId: "resp-123",
        modelVersion: "gemini-2.5-flash-image-001",
      });

      const client = new GeminiClient("fake-key");
      const result = await client.editImage(PNG_BUFFER, "Edit this image");

      expect(result.imageBuffer).toEqual(Buffer.from("fake-output-image"));
      expect(result.responseText).toBe("Here is your edited image");
      expect(result.finishReason).toBe("STOP");
      expect(result.usageMetadata?.totalTokenCount).toBe(1390);
      expect(result.responseId).toBe("resp-123");
      expect(result.modelVersion).toBe("gemini-2.5-flash-image-001");
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

      await expect(
        client.editImage(PNG_BUFFER, "Edit this image"),
      ).rejects.toThrow("Gemini did not return an image");
    });

    it("throws for buffers smaller than 12 bytes", async () => {
      const client = new GeminiClient("fake-key");
      const tinyBuffer = Buffer.from([0x89, 0x50]);

      await expect(
        client.editImage(tinyBuffer, "test"),
      ).rejects.toThrow("too small");
    });

    it("throws for images exceeding max size", async () => {
      const client = new GeminiClient("fake-key");
      // Create a buffer just over 20 MB
      const hugeBuffer = Buffer.alloc(20 * 1024 * 1024 + 1);
      // Add PNG header so it passes mime detection
      hugeBuffer[0] = 0x89;
      hugeBuffer[1] = 0x50;

      await expect(
        client.editImage(hugeBuffer, "test"),
      ).rejects.toThrow("exceeds maximum size");
    });

    it("detects PNG mime type from magic bytes", async () => {
      mockImageResponse();

      const client = new GeminiClient("fake-key");
      await client.editImage(PNG_BUFFER, "test");

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.contents[1].inlineData.mimeType).toBe("image/png");
    });

    it("detects JPEG mime type from magic bytes", async () => {
      mockImageResponse();

      const client = new GeminiClient("fake-key");
      const jpegInput = Buffer.alloc(12);
      jpegInput[0] = 0xff;
      jpegInput[1] = 0xd8;
      await client.editImage(jpegInput, "test");

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.contents[1].inlineData.mimeType).toBe("image/jpeg");
    });

    it("detects WebP mime type from magic bytes", async () => {
      mockImageResponse();

      const client = new GeminiClient("fake-key");
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
      expect(call.contents[1].inlineData.mimeType).toBe("image/webp");
    });

    it("falls back to image/png for unknown formats", async () => {
      mockImageResponse();

      const client = new GeminiClient("fake-key");
      const unknownInput = Buffer.alloc(12); // all zeros
      await client.editImage(unknownInput, "test");

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.contents[1].inlineData.mimeType).toBe("image/png");
    });

    it("passes imageConfig when aspectRatio is set", async () => {
      mockImageResponse();

      const client = new GeminiClient("fake-key");
      await client.editImage(PNG_BUFFER, "test", {
        model: "gemini-2.5-flash-image",
        aspectRatio: "16:9",
      });

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.config.imageConfig).toEqual({ aspectRatio: "16:9" });
    });

    it("passes seed when configured", async () => {
      mockImageResponse();

      const client = new GeminiClient("fake-key");
      await client.editImage(PNG_BUFFER, "test", {
        model: "gemini-2.5-flash-image",
        seed: 42,
      });

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.config.seed).toBe(42);
    });

    it("passes imageSize through to API for any model", async () => {
      mockImageResponse();

      const client = new GeminiClient("fake-key");
      await client.editImage(PNG_BUFFER, "test", {
        model: "gemini-2.5-flash-image",
        imageSize: "4K",
      });

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.config.imageConfig).toEqual({ imageSize: "4K" });
    });

    it("reads image from file path when string is provided", async () => {
      mockImageResponse();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-test-"));
      const testFilePath = path.join(tempDir, "test.png");
      fs.writeFileSync(testFilePath, PNG_BUFFER);

      try {
        const client = new GeminiClient("fake-key");
        const result = await client.editImage(testFilePath, "test");

        expect(result.imageBuffer).toEqual(Buffer.from("output"));
        const call = mockGenerateContent.mock.calls[0][0];
        expect(call.contents[1].inlineData.mimeType).toBe("image/png");
      } finally {
        fs.rmSync(tempDir, { recursive: true });
      }
    });

    it("throws when file path does not exist", async () => {
      const client = new GeminiClient("fake-key");

      await expect(
        client.editImage("/nonexistent/image.png", "test"),
      ).rejects.toThrow("Image file not found");
    });
  });
});
