import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Pipeline } from "../../src/engine/pipeline.js";
import { createScenarioFromHour } from "../../src/engine/scenario.js";

// Mock the @google/genai SDK
const mockGenerateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

/** Minimal valid PNG buffer (>= 12 bytes for mime detection). */
const PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function mockImageResponse(text?: string) {
  const fakeImageData = Buffer.from("fake-output-image").toString("base64");
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

describe("Pipeline", () => {
  let tempDir: string;
  let testImagePath: string;

  beforeEach(() => {
    mockGenerateContent.mockReset();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-pipeline-"));
    testImagePath = path.join(tempDir, "test.png");
    fs.writeFileSync(testImagePath, PNG_BUFFER);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("generates output and saves metadata", async () => {
    mockImageResponse("Edited for evening");

    const pipeline = new Pipeline({ outputDir: tempDir }, "fake-key");
    const scenario = createScenarioFromHour(18);
    const result = await pipeline.generate(testImagePath, scenario);

    expect(result.imagePath).toContain(".png");
    expect(result.imageBuffer).toEqual(Buffer.from("fake-output-image"));
    expect(fs.existsSync(result.imagePath)).toBe(true);

    // Verify metadata sidecar was written
    const metaPath = result.imagePath.replace(".png", ".json");
    expect(fs.existsSync(metaPath)).toBe(true);
  });

  it("metadata contains expected fields", async () => {
    mockImageResponse("Here is your image");

    const pipeline = new Pipeline({ outputDir: tempDir }, "fake-key");
    const scenario = createScenarioFromHour(14);
    const result = await pipeline.generate(testImagePath, scenario);

    const { metadata } = result;
    expect(metadata.model).toBe("gemini-3.1-flash-lite-image");
    expect(metadata.artworkSource).toBe(testImagePath);
    expect(metadata.outputPath).toBe(result.imagePath);
    expect(metadata.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(metadata.responseText).toBe("Here is your image");

    // Scenario serialization
    expect(metadata.scenario.hour).toBe(14);
    expect(metadata.scenario.isDay).toBe(true);
    expect(typeof metadata.scenario.timestampLocal).toBe("string");

    // Observability fields from mocked response
    expect(metadata.responseId).toBe("mock-response-id");
    expect(metadata.modelVersion).toBe("gemini-2.5-flash-image-001");
    expect(metadata.usageMetadata?.totalTokenCount).toBe(1390);
    expect(metadata.finishReason).toBe("STOP");
  });

  it("uses prompt override when provided", async () => {
    mockImageResponse();

    const pipeline = new Pipeline({ outputDir: tempDir }, "fake-key");
    const scenario = createScenarioFromHour(12);
    const customPrompt = "Make it look like a watercolor painting";

    const result = await pipeline.generate(testImagePath, scenario, customPrompt);
    expect(result.metadata.prompt).toBe(customPrompt);

    // Verify the custom prompt was sent to the API
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.contents[0].text).toBe(customPrompt);
  });

  it("composes prompt from scenario when no override given", async () => {
    mockImageResponse();

    const pipeline = new Pipeline({ outputDir: tempDir }, "fake-key");
    const scenario = createScenarioFromHour(22);
    const result = await pipeline.generate(testImagePath, scenario);

    // Prompt should contain scenario-derived text (dusk/twilight for hour 22)
    expect(result.metadata.prompt).toContain("night");
  });

  it("passes seed through to metadata and deep-merges geminiConfig", async () => {
    mockImageResponse();

    // Only pass seed — model should inherit from DEFAULT_GEMINI_CONFIG
    const pipeline = new Pipeline(
      { outputDir: tempDir, geminiConfig: { seed: 42 } },
      "fake-key",
    );
    const scenario = createScenarioFromHour(10);
    const result = await pipeline.generate(testImagePath, scenario);

    expect(result.metadata.seed).toBe(42);
    expect(result.metadata.model).toBe("gemini-3.1-flash-lite-image");
  });

  it("getStore returns the output store", async () => {
    mockImageResponse();

    const pipeline = new Pipeline({ outputDir: tempDir }, "fake-key");
    const scenario = createScenarioFromHour(8);
    await pipeline.generate(testImagePath, scenario);

    const store = pipeline.getStore();
    const latest = store.getLatest();
    expect(latest).not.toBeNull();
    expect(latest!.model).toBe("gemini-3.1-flash-lite-image");
  });

  it("render ID has expected format", async () => {
    mockImageResponse();

    const pipeline = new Pipeline({ outputDir: tempDir }, "fake-key");
    const scenario = createScenarioFromHour(15);
    const result = await pipeline.generate(testImagePath, scenario);

    // ID format: YYYYMMDD_HHmmss_<8-char uuid>
    expect(result.metadata.id).toMatch(/^\d{8}_\d{6}_[a-f0-9]{8}$/);
  });
});
