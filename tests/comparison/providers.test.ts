import { describe, expect, it, vi } from "vitest";
import { NoImageGeneratedError, type GenerateImageResult, type generateImage } from "ai";
import type { createOpenAI } from "@ai-sdk/openai";
import type { createXai } from "@ai-sdk/xai";
import {
  createGeminiComparisonProvider,
  createOpenAIComparisonProvider,
  createRound1Providers,
  createXaiComparisonProvider,
} from "../../src/comparison/providers.js";
import {
  GeminiNoImageError,
  GeminiTimeoutError,
} from "../../src/engine/gemini-client.js";
import { TEST_PNG_BUFFER as PNG_BUFFER } from "../helpers/mock-factories.js";

function imageResult(bytes: Uint8Array = PNG_BUFFER): GenerateImageResult {
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
    usage: {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    },
  };
}

function openAIDependencies(generateImageMock: ReturnType<typeof vi.fn>) {
  const imageModel = { provider: "openai.image", modelId: "gpt-image-2" };
  const image = vi.fn().mockReturnValue(imageModel);
  const createOpenAIMock = vi.fn().mockReturnValue({ image });
  const abortSignal = new AbortController().signal;
  const createAbortSignal = vi.fn().mockReturnValue(abortSignal);
  return {
    abortSignal,
    createAbortSignal,
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
  const abortSignal = new AbortController().signal;
  const createAbortSignal = vi.fn().mockReturnValue(abortSignal);
  return {
    abortSignal,
    createAbortSignal,
    imageModel,
    image,
    createXai: createXaiMock as unknown as typeof createXai,
    generateImage: generateImageMock as unknown as typeof generateImage,
  };
}

describe("Round 1 comparison providers", () => {
  it("uses the fixed Flash Lite Gemini model through the existing client", async () => {
    const editImage = vi.fn().mockResolvedValue({ imageBuffer: PNG_BUFFER });
    const provider = createGeminiComparisonProvider("google-secret", {
      client: { editImage },
    });

    const result = await provider.editImage(PNG_BUFFER, "add heavy snow");

    expect(provider.model).toBe("gemini-3.1-flash-lite-image");
    expect(editImage).toHaveBeenCalledWith(PNG_BUFFER, "add heavy snow", {
      model: "gemini-3.1-flash-lite-image",
    });
    expect(result.status).toBe("successful");
  });

  it("sends one original image to gpt-image-2 with fixed low/1536x1024 options and no retries", async () => {
    const generateImageMock = vi.fn().mockResolvedValue(imageResult());
    const dependencies = openAIDependencies(generateImageMock);
    const provider = createOpenAIComparisonProvider("openai-secret", dependencies);

    const result = await provider.editImage(PNG_BUFFER, "add heavy rain");

    expect(dependencies.image).toHaveBeenCalledWith("gpt-image-2");
    const options = generateImageMock.mock.calls[0][0];
    expect(options).toMatchObject({
      model: dependencies.imageModel,
      prompt: { text: "add heavy rain" },
      n: 1,
      size: "1536x1024",
      maxRetries: 0,
      providerOptions: { openai: { quality: "low" } },
      abortSignal: dependencies.abortSignal,
    });
    expect(dependencies.createAbortSignal).toHaveBeenCalledWith(180_000);
    expect(options.prompt.images).toHaveLength(1);
    expect(Buffer.from(options.prompt.images[0])).toEqual(PNG_BUFFER);
    expect(result).toMatchObject({ status: "successful", mimeType: "image/png" });
  });

  it("sends one original image to grok-imagine-image-2.0 at 1K/low with no retries", async () => {
    const generateImageMock = vi.fn().mockResolvedValue(imageResult());
    const dependencies = xaiDependencies(generateImageMock);
    const provider = createXaiComparisonProvider("xai-secret", dependencies);

    const result = await provider.editImage(PNG_BUFFER, "add dense fog");

    expect(dependencies.image).toHaveBeenCalledWith("grok-imagine-image-2.0");
    const options = generateImageMock.mock.calls[0][0];
    expect(options).toMatchObject({
      model: dependencies.imageModel,
      prompt: { text: "add dense fog" },
      n: 1,
      maxRetries: 0,
      providerOptions: { xai: { resolution: "1k", quality: "low" } },
      abortSignal: dependencies.abortSignal,
    });
    expect(dependencies.createAbortSignal).toHaveBeenCalledWith(180_000);
    expect(options).not.toHaveProperty("size");
    expect(options.prompt.images).toHaveLength(1);
    expect(Buffer.from(options.prompt.images[0])).toEqual(PNG_BUFFER);
    expect(result.status).toBe("successful");
  });

  it("maps no-image and explicit policy outcomes to unsuccessful", async () => {
    const noImage = new NoImageGeneratedError({
      message: "provider details must not escape",
      responses: [],
    });
    const noImageMock = vi.fn().mockRejectedValue(noImage);
    const policyMock = vi.fn().mockRejectedValue({
      message: "policy error containing synthetic-secret",
      data: { error: { code: "content_policy_violation" } },
    });

    const noImageProvider = createOpenAIComparisonProvider(
      "openai-secret",
      openAIDependencies(noImageMock),
    );
    const policyProvider = createXaiComparisonProvider(
      "xai-secret",
      xaiDependencies(policyMock),
    );

    await expect(noImageProvider.editImage(PNG_BUFFER, "test")).resolves.toEqual({
      status: "unsuccessful",
      reason: "no_image",
    });
    await expect(policyProvider.editImage(PNG_BUFFER, "test")).resolves.toEqual({
      status: "unsuccessful",
      reason: "policy",
    });
  });

  it("maps Gemini safety refusals to policy without returning response text", async () => {
    const client = {
      editImage: vi.fn().mockRejectedValue(
        new GeminiNoImageError("SAFETY", "synthetic-secret"),
      ),
    };
    const provider = createGeminiComparisonProvider("google-secret", { client });

    const result = await provider.editImage(PNG_BUFFER, "test");

    expect(result).toEqual({ status: "unsuccessful", reason: "policy" });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });

  it.each([
    new GeminiNoImageError("IMAGE_SAFETY", "synthetic-secret"),
    new GeminiNoImageError(undefined, "synthetic-secret", "PROHIBITED_CONTENT"),
    new GeminiNoImageError(undefined, "synthetic-secret", "MODEL_ARMOR"),
    new GeminiNoImageError(undefined, "synthetic-secret", "JAILBREAK"),
  ])("maps Gemini image and prompt-feedback policy blocks to policy", async (failure) => {
    const client = { editImage: vi.fn().mockRejectedValue(failure) };
    const provider = createGeminiComparisonProvider("google-secret", { client });

    const result = await provider.editImage(PNG_BUFFER, "test");

    expect(result).toEqual({ status: "unsuccessful", reason: "policy" });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });

  it.each([
    "NO_IMAGE",
    "RECITATION",
    "IMAGE_RECITATION",
    "OTHER",
    "IMAGE_OTHER",
  ])("keeps Gemini %s outcomes classified as no-image", async (finishReason) => {
    const client = {
      editImage: vi.fn().mockRejectedValue(
        new GeminiNoImageError(finishReason, "synthetic-secret"),
      ),
    };
    const provider = createGeminiComparisonProvider("google-secret", { client });

    await expect(provider.editImage(PNG_BUFFER, "test")).resolves.toEqual({
      status: "unsuccessful",
      reason: "no_image",
    });
  });

  it("maps the stable Gemini transport timeout to timeout", async () => {
    const client = {
      editImage: vi.fn().mockRejectedValue(new GeminiTimeoutError()),
    };
    const provider = createGeminiComparisonProvider("google-secret", { client });

    await expect(provider.editImage(PNG_BUFFER, "test")).resolves.toEqual({
      status: "error",
      category: "timeout",
    });
  });

  it("maps unusable bytes to unsuccessful", async () => {
    const generateImageMock = vi.fn().mockResolvedValue(imageResult(Buffer.from("not-an-image")));
    const provider = createOpenAIComparisonProvider(
      "openai-secret",
      openAIDependencies(generateImageMock),
    );

    await expect(provider.editImage(PNG_BUFFER, "test")).resolves.toEqual({
      status: "unsuccessful",
      reason: "unusable_image",
    });
  });

  it("returns only a safe category for unrecognized errors", async () => {
    const generateImageMock = vi.fn().mockRejectedValue(
      new Error("synthetic-secret must never be persisted"),
    );
    const provider = createOpenAIComparisonProvider(
      "openai-secret",
      openAIDependencies(generateImageMock),
    );

    const result = await provider.editImage(PNG_BUFFER, "test");

    expect(result).toEqual({ status: "error", category: "unknown" });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });

  it.each([
    [{ name: "LoadAPIKeyError" }, "configuration"],
    [{ statusCode: 401 }, "authentication"],
    [{ statusCode: 402 }, "quota"],
    [{ statusCode: 429 }, "rate_limit"],
    [{ name: "TimeoutError" }, "timeout"],
    [{ code: "ENOTFOUND" }, "transport"],
    [{ statusCode: 500 }, "provider"],
  ] as const)("maps provider failures to safe error category %s", async (failure, category) => {
    const generateImageMock = vi.fn().mockRejectedValue(failure);
    const provider = createXaiComparisonProvider(
      "xai-secret",
      xaiDependencies(generateImageMock),
    );

    await expect(provider.editImage(PNG_BUFFER, "test")).resolves.toEqual({
      status: "error",
      category,
    });
  });

  it("fails key validation before constructing any Round 1 provider", () => {
    const createOpenAIMock = vi.fn();
    const createXaiMock = vi.fn();

    expect(() =>
      createRound1Providers(
        {
          googleApiKey: "google-secret",
          openaiApiKey: undefined,
          xaiApiKey: "xai-secret",
        },
        {
          createOpenAI: createOpenAIMock as unknown as typeof createOpenAI,
          createXai: createXaiMock as unknown as typeof createXai,
        },
      ),
    ).toThrow("Missing comparison API keys: OPENAI_API_KEY");
    expect(createOpenAIMock).not.toHaveBeenCalled();
    expect(createXaiMock).not.toHaveBeenCalled();
  });

  it("constructs the Round 1 Gemini adapter with the 180-second comparison deadline", () => {
    const createGeminiClient = vi.fn().mockReturnValue({ editImage: vi.fn() });
    const openai = openAIDependencies(vi.fn());
    const xai = xaiDependencies(vi.fn());

    createRound1Providers(
      {
        googleApiKey: "google-secret",
        openaiApiKey: "openai-secret",
        xaiApiKey: "xai-secret",
      },
      {
        createGeminiClient,
        createOpenAI: openai.createOpenAI,
        createXai: xai.createXai,
      },
    );

    expect(createGeminiClient).toHaveBeenCalledWith("google-secret", {
      timeoutMs: 180_000,
    });
  });

  it("allows one explicit comparison deadline override for every provider", async () => {
    const customTimeoutMs = 12_345;
    const abortSignal = new AbortController().signal;
    const createAbortSignal = vi.fn().mockReturnValue(abortSignal);
    const generateImageMock = vi.fn().mockResolvedValue(imageResult());
    const openai = openAIDependencies(generateImageMock);
    const createGeminiClient = vi.fn().mockReturnValue({ editImage: vi.fn() });

    const provider = createOpenAIComparisonProvider("openai-secret", {
      ...openai,
      comparisonTimeoutMs: customTimeoutMs,
      createAbortSignal,
    });
    await provider.editImage(PNG_BUFFER, "test");

    createRound1Providers(
      {
        googleApiKey: "google-secret",
        openaiApiKey: "openai-secret",
        xaiApiKey: "xai-secret",
      },
      {
        createGeminiClient,
        geminiTimeoutMs: customTimeoutMs,
        createOpenAI: openai.createOpenAI,
        createXai: xaiDependencies(vi.fn()).createXai,
      },
    );

    expect(createAbortSignal).toHaveBeenCalledWith(customTimeoutMs);
    expect(generateImageMock.mock.calls[0][0].abortSignal).toBe(abortSignal);
    expect(createGeminiClient).toHaveBeenCalledWith("google-secret", {
      timeoutMs: customTimeoutMs,
    });
  });
});
