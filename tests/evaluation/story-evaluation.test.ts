import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORY_ARTWORKS,
  STORY_REVIEW_QUESTIONS,
  STORY_SCENARIO_CASES,
  createStoryEvaluationMatrix,
  createStoryEvaluationPreview,
  formatStoryEvaluationPreview,
  renderStoryEvaluationGallery,
  runStoryEvaluation,
  storyEvaluationRunId,
  type StoryEvaluationManifest,
} from "../../src/evaluation/story-evaluation.js";
import { ImageProviderRegistry } from "../../src/engine/provider-factory.js";
import { validateImage } from "../../src/engine/image-validation.js";
import type {
  ImageProviderAdapter,
  ImageProviderId,
  ProviderEditInput,
  ProviderEditResult,
  ProviderEditSuccess,
} from "../../src/engine/provider-types.js";

const PNG_16X9 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVR4nGP4z8BAEmIY1cAwGEIJACRlj3Er7g4qAAAAAElFTkSuQmCC",
  "base64",
);
const FIXED_NOW = new Date("2026-09-11T20:55:12.345Z");

async function success(provider: ImageProviderId, model: string): Promise<ProviderEditSuccess> {
  return {
    outcome: "successful",
    provider,
    requestedModel: model,
    resolvedModel: `${model}-resolved`,
    image: await validateImage(PNG_16X9),
  };
}

function adapter(
  provider: ImageProviderId,
  implementation?: (input: ProviderEditInput) => Promise<ProviderEditResult>,
): ImageProviderAdapter & { editImage: ReturnType<typeof vi.fn> } {
  const model = `${provider}-production-model`;
  return {
    provider,
    model,
    editImage: vi.fn(
      implementation ?? (async () => success(provider, model)),
    ),
  };
}

function registry(...adapters: ImageProviderAdapter[]): ImageProviderRegistry {
  return new ImageProviderRegistry(adapters);
}

describe("story prompt evaluation", () => {
  let tempDir: string;
  let repoRoot: string;
  let evaluationRoot: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-story-evaluation-"));
    repoRoot = path.join(tempDir, "repo");
    evaluationRoot = path.join(tempDir, "evaluations");
    fs.mkdirSync(path.join(repoRoot, "artwork"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "artwork", "hopper.jpg"), PNG_16X9);
    fs.writeFileSync(path.join(repoRoot, "artwork", "cabin-in-the-woods.png"), PNG_16X9);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("defines exactly two artworks crossed with three fixed named Scenario types", () => {
    const matrix = createStoryEvaluationMatrix();

    expect(STORY_ARTWORKS.map(artwork => artwork.source)).toEqual([
      "artwork/hopper.jpg",
      "artwork/cabin-in-the-woods.png",
    ]);
    expect(STORY_SCENARIO_CASES.map(item => item.id)).toEqual([
      "ordinary-clear-daytime",
      "mild-twilight",
      "significant-weather-night",
    ]);
    expect(matrix).toHaveLength(6);
    expect(new Set(matrix.map(cell => cell.artworkId))).toEqual(
      new Set(["hopper", "cabin-in-the-woods"]),
    );
    expect(new Set(matrix.map(cell => cell.scenarioId))).toEqual(
      new Set(STORY_SCENARIO_CASES.map(item => item.id)),
    );
    expect(matrix.every(cell => cell.prompt.includes("Outcome:"))).toBe(true);
    expect(matrix.every(cell => cell.prompt.includes("Current conditions:"))).toBe(true);
    expect(matrix.every(cell => typeof cell.scenario.timestampLocal === "string")).toBe(true);
    expect(JSON.parse(JSON.stringify(matrix))).toEqual(matrix);
  });

  it("previews matrix, configured identities, and exact call count without adapter calls", () => {
    const gemini = adapter("gemini");
    const openai = adapter("openai");

    const preview = createStoryEvaluationPreview({
      registry: registry(gemini, openai),
      aspectRatio: "16:9",
    });
    const output = formatStoryEvaluationPreview(preview);

    expect(preview.matrix).toHaveLength(6);
    expect(preview.providers).toEqual([
      { provider: "gemini", requestedModel: "gemini-production-model" },
      { provider: "openai", requestedModel: "openai-production-model" },
    ]);
    expect(preview.plannedPaidCalls).toBe(12);
    expect(preview.outputSpec).toEqual({ stage: "normal", aspectRatio: "16:9" });
    expect(createStoryEvaluationPreview({ registry: registry(gemini) }).outputSpec).toEqual({
      stage: "normal",
      aspectRatio: "source",
    });
    expect(output).toContain("2 artworks × 3 scenarios = 6 cells");
    expect(output).toContain("gemini / gemini-production-model");
    expect(output).toContain("Planned paid calls: 12");
    expect(gemini.editImage).not.toHaveBeenCalled();
    expect(openai.editImage).not.toHaveBeenCalled();
  });

  it("invokes each configured production adapter directly once per cell with prompt and output parity", async () => {
    const gemini = adapter("gemini");
    const openai = adapter("openai");
    const result = await runStoryEvaluation({
      repoRoot,
      evaluationRoot,
      registry: registry(gemini, openai),
      aspectRatio: "16:9",
      now: () => FIXED_NOW,
    });

    expect(gemini.editImage).toHaveBeenCalledTimes(6);
    expect(openai.editImage).toHaveBeenCalledTimes(6);
    for (let index = 0; index < 6; index += 1) {
      const geminiInput = gemini.editImage.mock.calls[index][0] as ProviderEditInput;
      const openaiInput = openai.editImage.mock.calls[index][0] as ProviderEditInput;
      expect(geminiInput.prompt).toBe(openaiInput.prompt);
      expect(geminiInput.output).toEqual({ stage: "normal", aspectRatio: "16:9" });
      expect(openaiInput.output).toEqual({ stage: "normal", aspectRatio: "16:9" });
      expect(geminiInput.source.bytes).toEqual(openaiInput.source.bytes);
      expect(geminiInput.source.bytes).not.toBe(openaiInput.source.bytes);
    }
    expect(result.manifest.operationalReadiness).toBe("ready");
    expect(result.manifest.cells).toHaveLength(12);
    expect(result.manifest.cells.every(cell => cell.status === "successful")).toBe(true);
    expect(fs.existsSync(result.galleryPath)).toBe(true);
  });

  it("writes JSON-safe audit fields and a complete blank review checklist without secrets or raw errors", async () => {
    const secret = "sk-do-not-persist-this";
    const gemini = adapter("gemini", async () => ({
      outcome: "refusal",
      provider: "gemini",
      requestedModel: "gemini-production-model",
      safeCode: "IMAGE_SAFETY",
    }));
    const xai = adapter("xai", async () => {
      const error = new Error(`remote body ${secret}`) as Error & { code: string; body: string };
      error.code = "totally_secret_code";
      error.body = secret;
      throw error;
    });

    const result = await runStoryEvaluation({
      repoRoot,
      evaluationRoot,
      registry: registry(gemini, xai),
      now: () => FIXED_NOW,
    });
    const manifestText = fs.readFileSync(result.manifestPath, "utf8");
    const checklist = JSON.parse(fs.readFileSync(result.checklistPath, "utf8")) as {
      rows: Array<Record<string, unknown>>;
    };

    expect(JSON.parse(manifestText)).toEqual(result.manifest);
    expect(manifestText).not.toContain(secret);
    expect(manifestText).not.toContain("totally_secret_code");
    expect(manifestText).not.toContain("API_KEY");
    expect(manifestText).not.toContain("base64");
    expect(result.manifest.cells.find(cell => cell.provider === "xai")).toMatchObject({
      status: "unsuccessful",
      outcome: "provider_error",
    });
    expect(result.manifest.cells.find(cell => cell.provider === "gemini")).toMatchObject({
      status: "unsuccessful",
      outcome: "refusal",
      safeCode: "IMAGE_SAFETY",
    });
    expect(result.manifest.artworks.every(artwork => !path.isAbsolute(artwork.copiedSourcePath))).toBe(true);
    expect(result.manifest.artworks.every(artwork => /^[a-f0-9]{64}$/.test(artwork.sourceSha256))).toBe(true);
    expect(checklist.rows).toHaveLength(12);
    expect(checklist.rows[0]).toMatchObject({
      immediateDoubleTake: null,
      visibleActionReactionConsequenceOrBeforeAfter: null,
      scenarioArtworkFit: null,
      sourcePreservation: null,
      specificOverStockInterpretation: null,
      reviewerNotes: null,
    });
    expect(STORY_REVIEW_QUESTIONS).toHaveLength(5);
  });

  it("fails exclusive timestamp creation before reading sources or calling providers", async () => {
    const gemini = adapter("gemini");
    fs.mkdirSync(evaluationRoot, { recursive: true });
    fs.mkdirSync(path.join(evaluationRoot, storyEvaluationRunId(FIXED_NOW)));
    const readFile = vi.fn((filePath: string) => fs.promises.readFile(filePath));

    await expect(runStoryEvaluation({
      repoRoot,
      evaluationRoot,
      registry: registry(gemini),
      now: () => FIXED_NOW,
      readFile,
    })).rejects.toThrow(/already exists/i);

    expect(readFile).not.toHaveBeenCalled();
    expect(gemini.editImage).not.toHaveBeenCalled();
  });

  it("turns mismatched bytes and unsuccessful responses into safe labeled placeholders", async () => {
    const gemini = adapter("gemini", async () => ({
      ...await success("gemini", "gemini-production-model"),
      image: {
        ...await validateImage(PNG_16X9),
        mimeType: "image/jpeg",
      },
    }));
    const openai = adapter("openai", async () => ({
      outcome: "refusal",
      provider: "openai",
      requestedModel: "openai-production-model",
      safeCode: "content_policy_violation",
    }));
    const xai = adapter("xai", async () => ({
      ...await success("xai", "xai-production-model"),
      image: {
        ...await validateImage(PNG_16X9),
        bytes: Buffer.from("not-an-image"),
      },
    }));

    const result = await runStoryEvaluation({
      repoRoot,
      evaluationRoot,
      registry: registry(gemini, openai, xai),
      now: () => FIXED_NOW,
    });
    const html = fs.readFileSync(result.galleryPath, "utf8");

    expect(result.manifest.operationalReadiness).toBe("not_ready");
    expect(result.manifest.cells.every(cell => cell.status === "unsuccessful")).toBe(true);
    expect(result.manifest.cells.filter(cell => cell.outcome === "invalid_image")).toHaveLength(12);
    expect(html).toContain("NOT READY FOR PRODUCT REVIEW");
    expect(html).toContain("Invalid image output");
    expect(html).toContain("Provider refusal");
    expect(html).toContain("Successful 0");
    expect(html).toContain("Unsuccessful 18");
    expect(html).toContain("Pending 0");
    expect(html).not.toContain('class="result-image"');
  });

  it("renders original comparisons, readable conditions, every status, rubric, responsiveness, and safe escaped paths", async () => {
    const gemini = adapter("gemini");
    const result = await runStoryEvaluation({
      repoRoot,
      evaluationRoot,
      registry: registry(gemini),
      now: () => FIXED_NOW,
    });
    const manifest = structuredClone(result.manifest) as StoryEvaluationManifest;
    manifest.artworks[0].label = '<img src=x onerror="alert(1)">';
    const successful = manifest.cells.find(cell => cell.status === "successful");
    if (!successful || successful.status !== "successful") throw new Error("expected success");
    successful.imagePath = "../outside.png";

    const html = renderStoryEvaluationGallery(manifest);

    expect(html).toContain("Original artwork");
    expect(html).toContain("Ordinary clear daytime");
    expect(html).toContain("Mild twilight");
    expect(html).toContain("Significant weather at night");
    expect(html).toContain("Time");
    expect(html).toContain("Daylight");
    expect(html).toContain("Weather");
    expect(html).toContain("Five-question review rubric");
    for (const question of STORY_REVIEW_QUESTIONS) expect(html).toContain(question);
    expect(html).toContain("NOT READY FOR PRODUCT REVIEW");
    expect(html).toContain("Unsafe or missing image path");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("../outside.png");
    expect(html).not.toContain("onerror=\"alert(1)\"");
    expect(html).toContain("@media (max-width: 760px)");
    expect(html).toContain(":focus-visible");
    expect(html).toContain("default-src &#39;none&#39;");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html.toLowerCase()).not.toContain("drama score");
    expect(html.toLowerCase()).not.toContain("motif score");
    expect(html.toLowerCase()).not.toContain("diversity score");
  });

  it("marks empty, partial, and unsuccessful matrices not ready and only all-success ready", async () => {
    const result = await runStoryEvaluation({
      repoRoot,
      evaluationRoot,
      registry: registry(adapter("gemini")),
      now: () => FIXED_NOW,
    });
    const allSuccess = result.manifest;
    const partial = structuredClone(allSuccess) as StoryEvaluationManifest;
    partial.cells.pop();
    const unsuccessful = structuredClone(allSuccess) as StoryEvaluationManifest;
    unsuccessful.cells[0] = {
      ...unsuccessful.cells[0],
      status: "unsuccessful",
      outcome: "no_image",
    };
    const empty = structuredClone(allSuccess) as StoryEvaluationManifest;
    empty.cells = [];

    expect(renderStoryEvaluationGallery(allSuccess)).toContain("READY FOR PRODUCT REVIEW");
    expect(renderStoryEvaluationGallery(partial)).toContain("NOT READY FOR PRODUCT REVIEW");
    expect(renderStoryEvaluationGallery(unsuccessful)).toContain("NOT READY FOR PRODUCT REVIEW");
    expect(renderStoryEvaluationGallery(empty)).toContain("NOT READY FOR PRODUCT REVIEW");
    expect(renderStoryEvaluationGallery(partial)).toContain("Pending 1");
    expect(renderStoryEvaluationGallery(empty)).toContain("Pending 6");
  });
});
