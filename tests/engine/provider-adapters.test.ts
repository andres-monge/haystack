import { NoImageGeneratedError, type GenerateImageResult, type generateImage } from "ai";
import type { createOpenAI } from "@ai-sdk/openai";
import type { createXai } from "@ai-sdk/xai";
import { describe, expect, it, vi } from "vitest";
import {
  GeminiImageProvider,
  GeminiNoImageError,
} from "../../src/engine/gemini-client.js";
import {
  OpenAIClient,
  OpenAIImageProvider,
} from "../../src/engine/openai-client.js";
import {
  XaiClient,
  XaiImageProvider,
} from "../../src/engine/xai-client.js";
import { validateImage } from "../../src/engine/image-validation.js";

const PNG_16X9 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVR4nGP4z8BAEmIY1cAwGEIJACRlj3Er7g4qAAAAAElFTkSuQmCC",
  "base64",
);
const PNG_2X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=",
  "base64",
);

function imageResult(bytes: Uint8Array): GenerateImageResult {
  const image = {
    base64: Buffer.from(bytes).toString("base64"),
    uint8Array: bytes,
    mediaType: "image/png",
  };
  return {
    image,
    images: [image],
    warnings: [],
    responses: [],
    providerMetadata: {},
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
  };
}

function openAIDependencies(generateImageMock: ReturnType<typeof vi.fn>) {
  const imageModel = { provider: "openai.image", modelId: "gpt-image-2" };
  const image = vi.fn().mockReturnValue(imageModel);
  const createOpenAIMock = vi.fn().mockReturnValue({ image });
  return {
    imageModel,
    image,
    createOpenAI: createOpenAIMock as unknown as typeof createOpenAI,
    generateImage: generateImageMock as unknown as typeof generateImage,
  };
}

function xaiDependencies(generateImageMock: ReturnType<typeof vi.fn>) {
  const imageModel = { provider: "xai.image", modelId: "grok-imagine-image-2.0" };
  const image = vi.fn().mockReturnValue(imageModel);
  const createXaiMock = vi.fn().mockReturnValue({ image });
  return {
    imageModel,
    image,
    createXai: createXaiMock as unknown as typeof createXai,
    generateImage: generateImageMock as unknown as typeof generateImage,
  };
}

describe("direct provider clients", () => {
  it("sends the exact low-quality OpenAI edit request without inputFidelity or retries", async () => {
    const generateImageMock = vi.fn().mockResolvedValue(imageResult(PNG_2X1));
    const dependencies = openAIDependencies(generateImageMock);
    const client = new OpenAIClient("secret", "gpt-image-2", dependencies);
    const signal = new AbortController().signal;

    await client.editImage(PNG_2X1, "add rain", {
      size: "2048x1024",
      quality: "low",
      abortSignal: signal,
    });

    expect(dependencies.image).toHaveBeenCalledWith("gpt-image-2");
    const request = generateImageMock.mock.calls[0][0];
    expect(request).toMatchObject({
      model: dependencies.imageModel,
      prompt: { text: "add rain", images: [PNG_2X1] },
      n: 1,
      size: "2048x1024",
      maxRetries: 0,
      abortSignal: signal,
      providerOptions: { openai: { quality: "low" } },
    });
    expect(request.providerOptions.openai).not.toHaveProperty("inputFidelity");
  });

  it("sends the exact xAI ratio/resolution/quality profile without retries", async () => {
    const generateImageMock = vi.fn().mockResolvedValue(imageResult(PNG_16X9));
    const dependencies = xaiDependencies(generateImageMock);
    const client = new XaiClient(
      "secret",
      "grok-imagine-image-2.0",
      dependencies,
    );
    const signal = new AbortController().signal;

    await client.editImage(PNG_16X9, "add fog", {
      aspectRatio: "16:9",
      resolution: "2k",
      quality: "low",
      abortSignal: signal,
    });

    expect(dependencies.image).toHaveBeenCalledWith("grok-imagine-image-2.0");
    expect(generateImageMock.mock.calls[0][0]).toMatchObject({
      model: dependencies.imageModel,
      prompt: { text: "add fog", images: [PNG_16X9] },
      n: 1,
      aspectRatio: "16:9",
      maxRetries: 0,
      abortSignal: signal,
      providerOptions: { xai: { resolution: "2k", quality: "low" } },
    });
  });
});

describe("production provider adapters", () => {
  it("uses the production Gemini normal, cleanup, and 16:9 outpaint profiles", async () => {
    const editImage = vi.fn().mockImplementation(
      async (_bytes: Buffer, _prompt: string, config: { aspectRatio?: string }) => ({
        imageBuffer: config.aspectRatio === "16:9" ? PNG_16X9 : PNG_2X1,
        modelVersion: "resolved-gemini",
      }),
    );
    const provider = new GeminiImageProvider("secret", { client: { editImage } });
    const normalSource = await validateImage(PNG_2X1);
    const outpaintSource = await validateImage(PNG_16X9);

    const normal = await provider.editImage({
      source: normalSource,
      prompt: "add snow",
      output: { stage: "normal", aspectRatio: "source" },
    });
    const cleanup = await provider.editImage({
      source: normalSource,
      prompt: "clean overlays",
      output: { stage: "extend-cleanup", aspectRatio: "source" },
    });
    const outpaint = await provider.editImage({
      source: outpaintSource,
      prompt: "extend",
      output: { stage: "extend-outpaint", aspectRatio: "16:9" },
    });

    expect(normal).toMatchObject({
      outcome: "successful",
      requestedModel: "gemini-3.1-flash-lite-image",
      resolvedModel: "resolved-gemini",
    });
    expect(cleanup).toMatchObject({
      outcome: "successful",
      requestedModel: "gemini-3.1-flash-image",
    });
    expect(outpaint).toMatchObject({
      outcome: "successful",
      requestedModel: "gemini-3.1-flash-image",
    });
    expect(editImage.mock.calls[0][2]).toEqual({
      model: "gemini-3.1-flash-lite-image",
      imageSize: "1K",
      thinkingLevel: "high",
      inputMediaResolution: "ultra_high",
    });
    expect(editImage.mock.calls[1][2]).toEqual({
      model: "gemini-3.1-flash-image",
      imageSize: "2K",
      thinkingLevel: "high",
      inputMediaResolution: "ultra_high",
    });
    expect(editImage.mock.calls[2][2]).toEqual({
      model: "gemini-3.1-flash-image",
      aspectRatio: "16:9",
      imageSize: "2K",
      thinkingLevel: "high",
      inputMediaResolution: "ultra_high",
    });
  });

  it("uses the explicit OpenAI 2048x1152 profile for 16:9 outpainting", async () => {
    const generateImageMock = vi.fn().mockResolvedValue(imageResult(PNG_16X9));
    const dependencies = openAIDependencies(generateImageMock);
    const provider = new OpenAIImageProvider("secret", {
      client: new OpenAIClient("secret", "gpt-image-2", dependencies),
      createTimeoutSignal: () => new AbortController().signal,
    });
    const source = await validateImage(PNG_16X9);

    const result = await provider.editImage({
      source,
      prompt: "extend",
      output: { stage: "extend-outpaint", aspectRatio: "16:9" },
    });

    expect(result.outcome).toBe("successful");
    expect(generateImageMock.mock.calls[0][0]).toMatchObject({
      size: "2048x1152",
      maxRetries: 0,
      providerOptions: { openai: { quality: "low" } },
    });
  });

  it("maps Gemini refusals without exposing response text", async () => {
    const client = {
      editImage: vi.fn().mockRejectedValue(
        new GeminiNoImageError("IMAGE_SAFETY", "secret-body"),
      ),
    };
    const provider = new GeminiImageProvider("secret", { client });
    const source = await validateImage(PNG_2X1);

    const result = await provider.editImage({
      source,
      prompt: "test",
      output: { stage: "normal", aspectRatio: "source" },
    });

    expect(result).toMatchObject({
      outcome: "refusal",
      safeCode: "IMAGE_SAFETY",
    });
    expect(JSON.stringify(result)).not.toContain("secret-body");
  });

  it("validates an OpenAI result and derives a compliant source-ratio size", async () => {
    const generateImageMock = vi.fn().mockResolvedValue(imageResult(PNG_2X1));
    const dependencies = openAIDependencies(generateImageMock);
    const provider = new OpenAIImageProvider("secret", {
      client: new OpenAIClient("secret", "gpt-image-2", dependencies),
      createTimeoutSignal: () => new AbortController().signal,
    });
    const source = await validateImage(PNG_2X1);

    const result = await provider.editImage({
      source,
      prompt: "add snow",
      output: {
        stage: "normal",
        aspectRatio: "source",
      },
    });

    expect(generateImageMock.mock.calls[0][0].size).toBe("2048x1024");
    expect(result).toMatchObject({
      outcome: "successful",
      provider: "openai",
      requestedModel: "gpt-image-2",
      image: { mimeType: "image/png", width: 2, height: 1 },
    });
  });

  it("rejects non-16:9 xAI outpainting locally without a network call", async () => {
    const generateImageMock = vi.fn();
    const dependencies = xaiDependencies(generateImageMock);
    const provider = new XaiImageProvider("secret", {
      client: new XaiClient("secret", "grok-imagine-image-2.0", dependencies),
    });
    const source = await validateImage(PNG_2X1);

    await expect(
      provider.editImage({
        source,
        prompt: "extend",
        output: {
          stage: "extend-outpaint",
          aspectRatio: "16:9",
        },
      }),
    ).resolves.toMatchObject({
      outcome: "unsupported_output_spec",
      safeCode: "xai_edit_preserves_input_ratio",
    });
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it("uses the exact xAI 2K outpaint profile when the source is already 16:9", async () => {
    const generateImageMock = vi.fn().mockResolvedValue(imageResult(PNG_16X9));
    const dependencies = xaiDependencies(generateImageMock);
    const provider = new XaiImageProvider("secret", {
      client: new XaiClient("secret", "grok-imagine-image-2.0", dependencies),
      createTimeoutSignal: () => new AbortController().signal,
    });
    const source = await validateImage(PNG_16X9);

    const result = await provider.editImage({
      source,
      prompt: "extend",
      output: {
        stage: "extend-outpaint",
        aspectRatio: "16:9",
      },
    });

    expect(result.outcome).toBe("successful");
    expect(generateImageMock.mock.calls[0][0]).toMatchObject({
      aspectRatio: "16:9",
      providerOptions: { xai: { resolution: "2k", quality: "low" } },
      maxRetries: 0,
    });
  });

  it("lets xAI preserve source geometry and uses 2K only for extend cleanup", async () => {
    const generateImageMock = vi.fn().mockResolvedValue(imageResult(PNG_2X1));
    const dependencies = xaiDependencies(generateImageMock);
    const provider = new XaiImageProvider("secret", {
      client: new XaiClient("secret", "grok-imagine-image-2.0", dependencies),
      createTimeoutSignal: () => new AbortController().signal,
    });
    const source = await validateImage(PNG_2X1);

    await provider.editImage({
      source,
      prompt: "add rain",
      output: { stage: "normal", aspectRatio: "source" },
    });
    await provider.editImage({
      source,
      prompt: "clean overlays",
      output: { stage: "extend-cleanup", aspectRatio: "source" },
    });

    expect(generateImageMock.mock.calls[0][0]).not.toHaveProperty("aspectRatio");
    expect(generateImageMock.mock.calls[0][0]).toMatchObject({
      providerOptions: { xai: { resolution: "1k", quality: "low" } },
    });
    expect(generateImageMock.mock.calls[1][0]).not.toHaveProperty("aspectRatio");
    expect(generateImageMock.mock.calls[1][0]).toMatchObject({
      providerOptions: { xai: { resolution: "2k", quality: "low" } },
    });
  });

  it.each([
    [new NoImageGeneratedError({ message: "secret-body", responses: [] }), "no_image"],
    [{ data: { error: { code: "content_policy_violation" } } }, "refusal"],
    [{ name: "TimeoutError" }, "provider_timeout"],
    [{ statusCode: 429 }, "rate_limited"],
    [{ statusCode: 401 }, "authentication"],
    [{ statusCode: 402 }, "quota"],
    [{ statusCode: 500 }, "provider_error"],
    [{ code: "ECONNRESET" }, "provider_error"],
  ] as const)("maps provider failure to safe outcome %s", async (failure, outcome) => {
    const generateImageMock = vi.fn().mockRejectedValue(failure);
    const dependencies = openAIDependencies(generateImageMock);
    const provider = new OpenAIImageProvider("secret", {
      client: new OpenAIClient("secret", "gpt-image-2", dependencies),
      createTimeoutSignal: () => new AbortController().signal,
    });
    const source = await validateImage(PNG_2X1);

    const result = await provider.editImage({
      source,
      prompt: "test",
      output: { stage: "normal", aspectRatio: "source" },
    });

    expect(result.outcome).toBe(outcome);
    expect(JSON.stringify(result)).not.toContain("secret-body");
  });

  it("maps fully undecodable provider bytes to invalid_image", async () => {
    const generateImageMock = vi.fn().mockResolvedValue(
      imageResult(Buffer.from("not-an-image")),
    );
    const dependencies = openAIDependencies(generateImageMock);
    const provider = new OpenAIImageProvider("secret", {
      client: new OpenAIClient("secret", "gpt-image-2", dependencies),
      createTimeoutSignal: () => new AbortController().signal,
    });
    const source = await validateImage(PNG_2X1);

    await expect(
      provider.editImage({
        source,
        prompt: "test",
        output: { stage: "normal", aspectRatio: "source" },
      }),
    ).resolves.toMatchObject({
      outcome: "invalid_image",
      safeCode: "unsupported_signature",
    });
  });

  it("stops an already-cancelled edit before calling a provider", async () => {
    const generateImageMock = vi.fn();
    const dependencies = openAIDependencies(generateImageMock);
    const provider = new OpenAIImageProvider("secret", {
      client: new OpenAIClient("secret", "gpt-image-2", dependencies),
    });
    const source = await validateImage(PNG_2X1);
    const controller = new AbortController();
    controller.abort();

    await expect(provider.editImage({
      source,
      prompt: "test",
      output: { stage: "normal", aspectRatio: "source" },
      abort: { signal: controller.signal, provenance: "caller_cancelled" },
    })).resolves.toMatchObject({ outcome: "caller_cancelled" });
    expect(generateImageMock).not.toHaveBeenCalled();
  });
});
