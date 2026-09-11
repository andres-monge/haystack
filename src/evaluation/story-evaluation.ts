import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "../comparison/artifacts.js";
import { validateImage, ImageValidationError } from "../engine/image-validation.js";
import { composePrompt } from "../engine/prompt.js";
import type { ImageProviderRegistry } from "../engine/provider-factory.js";
import { isProviderEditSuccess } from "../engine/provider-types.js";
import type {
  ConfiguredAspectRatio,
  ImageOutputSpec,
  ImageProviderAdapter,
  ImageProviderId,
  ProviderAttemptOutcome,
  ProviderEditFailure,
  ProviderEditResult,
  SupportedImageMimeType,
  ValidatedImage,
} from "../engine/provider-types.js";
import { serializeScenario } from "../engine/types.js";
import type { Scenario, SerializedScenario } from "../engine/types.js";

export const STORY_ARTWORKS = [
  {
    id: "hopper",
    label: "Hopper",
    source: "artwork/hopper.jpg",
  },
  {
    id: "cabin-in-the-woods",
    label: "Cabin in the Woods",
    source: "artwork/cabin-in-the-woods.png",
  },
] as const;

export interface StoryScenarioSummary {
  time: string;
  daylight: string;
  weather: string;
}

export const STORY_SCENARIO_CASES: ReadonlyArray<{
  id: "ordinary-clear-daytime" | "mild-twilight" | "significant-weather-night";
  label: string;
  summary: StoryScenarioSummary;
  scenario: Scenario;
}> = [
  {
    id: "ordinary-clear-daytime",
    label: "Ordinary clear daytime",
    summary: {
      time: "16:00 local time",
      daylight: "Full daylight",
      weather: "Clear, dry, and mild",
    },
    scenario: {
      timestampLocal: new Date("2026-06-15T16:00:00.000Z"),
      hour: 16,
      minute: 0,
      isDay: true,
      weatherSource: "none",
      weatherCode: 0,
      cloudPercent: 8,
      precipProbability: 0,
      temperature: 22,
      humidity: 45,
      windSpeed: 8,
      windGusts: 13,
      visibility: 30_000,
      precipitation: 0,
      rain: 0,
      snowfall: 0,
      snowDepth: 0,
      directRadiation: 680,
      diffuseRadiation: 80,
      sunElevation: 49,
      sunAzimuth: 245,
      solarPhase: "daylight",
      solarTrend: "setting",
    },
  },
  {
    id: "mild-twilight",
    label: "Mild twilight",
    summary: {
      time: "18:45 local time",
      daylight: "Civil twilight, sun just below the horizon",
      weather: "Mild with scattered clouds and no precipitation",
    },
    scenario: {
      timestampLocal: new Date("2026-09-15T18:45:00.000Z"),
      hour: 18,
      minute: 45,
      isDay: false,
      weatherSource: "none",
      weatherCode: 2,
      cloudPercent: 35,
      precipProbability: 5,
      temperature: 16,
      humidity: 62,
      windSpeed: 9,
      windGusts: 15,
      visibility: 24_000,
      precipitation: 0,
      rain: 0,
      snowfall: 0,
      snowDepth: 0,
      directRadiation: 0,
      diffuseRadiation: 20,
      sunElevation: -2,
      sunAzimuth: 270,
      solarPhase: "civil-twilight",
      solarTrend: "setting",
    },
  },
  {
    id: "significant-weather-night",
    label: "Significant weather at night",
    summary: {
      time: "23:00 local time",
      daylight: "Night",
      weather: "Heavy snow, strong gusts, and low visibility",
    },
    scenario: {
      timestampLocal: new Date("2026-01-15T23:00:00.000Z"),
      hour: 23,
      minute: 0,
      isDay: false,
      weatherSource: "none",
      weatherCode: 75,
      cloudPercent: 100,
      precipProbability: 100,
      temperature: -5,
      humidity: 94,
      windSpeed: 24,
      windGusts: 48,
      visibility: 1_200,
      precipitation: 5,
      rain: 0,
      snowfall: 5,
      snowDepth: 0.18,
      directRadiation: 0,
      diffuseRadiation: 0,
      sunElevation: -48,
      sunAzimuth: 330,
      solarPhase: "night",
      solarTrend: "setting",
      moonFraction: 0.68,
      moonAltitude: 28,
    },
  },
];

export const STORY_REVIEW_QUESTIONS = [
  "Does the image trigger an immediate “What is going on here?” response?",
  "Is there visible evidence of an action, reaction, consequence, or implied before-and-after?",
  "Does the situation fit the artwork and use Scenario conditions meaningfully without forcing drama?",
  "Are the permanent setting, style, camera, framing, and composition preserved?",
  "Is this a more specific situation than the most predictable stock reading of the artwork and Scenario?",
] as const;

export interface StoryEvaluationMatrixCell {
  id: string;
  artworkId: string;
  artworkLabel: string;
  artworkSource: string;
  scenarioId: string;
  scenarioLabel: string;
  scenarioSummary: StoryScenarioSummary;
  scenario: SerializedScenario;
  prompt: string;
}

export interface StoryEvaluationProviderIdentity {
  provider: ImageProviderId;
  requestedModel: string;
}

export interface StoryEvaluationPreview {
  matrix: StoryEvaluationMatrixCell[];
  providers: StoryEvaluationProviderIdentity[];
  outputSpec: ImageOutputSpec;
  plannedPaidCalls: number;
}

export interface StoryEvaluationArtworkRecord {
  id: string;
  label: string;
  source: string;
  copiedSourcePath: string;
  sourceMimeType: SupportedImageMimeType;
  sourceWidth: number;
  sourceHeight: number;
  sourceByteCount: number;
  sourceSha256: string;
}

interface StoryEvaluationCellBase extends StoryEvaluationMatrixCell {
  provider: ImageProviderId;
  requestedModel: string;
  outputSpec: ImageOutputSpec;
  copiedSourcePath: string;
  sourceSha256: string;
  createdAt: string;
}

export type StoryEvaluationCell = StoryEvaluationCellBase & (
  | { status: "pending" }
  | {
      status: "successful";
      outcome: "successful";
      resolvedModel?: string;
      imagePath: string;
      mimeType: SupportedImageMimeType;
      width: number;
      height: number;
      byteCount: number;
      sha256: string;
    }
  | {
      status: "unsuccessful";
      outcome: Exclude<ProviderAttemptOutcome, "successful">;
      safeCode?: string;
    }
);

export interface StoryEvaluationManifest {
  schemaVersion: 1;
  kind: "story-prompt-evaluation";
  runId: string;
  state: "running" | "completed";
  operationalReadiness: "ready" | "not_ready";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  expectedCellCount: number;
  outputSpec: ImageOutputSpec;
  providers: StoryEvaluationProviderIdentity[];
  artworks: StoryEvaluationArtworkRecord[];
  matrix: StoryEvaluationMatrixCell[];
  cells: StoryEvaluationCell[];
}

export interface StoryReviewChecklistRow {
  cellId: string;
  artwork: string;
  scenario: string;
  provider: ImageProviderId;
  requestedModel: string;
  immediateDoubleTake: boolean | null;
  visibleActionReactionConsequenceOrBeforeAfter: boolean | null;
  scenarioArtworkFit: boolean | null;
  sourcePreservation: boolean | null;
  specificOverStockInterpretation: boolean | null;
  reviewerNotes: string | null;
}

export interface StoryReviewChecklist {
  schemaVersion: 1;
  runId: string;
  questions: readonly string[];
  rows: StoryReviewChecklistRow[];
}

type StoryProviderRegistry = Pick<ImageProviderRegistry, "ids" | "get">;

export interface RunStoryEvaluationOptions {
  repoRoot: string;
  evaluationRoot: string;
  registry: StoryProviderRegistry;
  aspectRatio?: ConfiguredAspectRatio;
  now?: () => Date;
  readFile?: (filePath: string) => Promise<Buffer>;
}

export interface RunStoryEvaluationResult {
  runDir: string;
  manifestPath: string;
  checklistPath: string;
  galleryPath: string;
  manifest: StoryEvaluationManifest;
}

const TERMINAL_FAILURES: ReadonlySet<string> = new Set([
  "refusal",
  "no_image",
  "invalid_image",
  "unsupported_output_spec",
  "provider_timeout",
  "chain_deadline",
  "rate_limited",
  "authentication",
  "quota",
  "provider_error",
  "caller_cancelled",
]);

const SAFE_CODES: ReadonlySet<string> = new Set([
  "aspect_ratio_mismatch",
  "billing_hard_limit_reached",
  "content_filter",
  "content_policy_violation",
  "deadline_exceeded",
  "decode_failed",
  "econnrefused",
  "econnreset",
  "empty",
  "enetwork",
  "enotfound",
  "eproto",
  "etimedout",
  "gemini_timeout",
  "image_metadata_mismatch",
  "insufficient_credits",
  "insufficient_quota",
  "invalid_dimensions",
  "IMAGE_OTHER",
  "IMAGE_RECITATION",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "PROHIBITED_CONTENT",
  "SAFETY",
  "BLOCKLIST",
  "SPII",
  "MODEL_ARMOR",
  "JAILBREAK",
  "mime_mismatch",
  "moderation_blocked",
  "NO_IMAGE",
  "OTHER",
  "policy_violation",
  "RECITATION",
  "safety",
  "too_large",
  "unsupported_signature",
  "xai_edit_preserves_input_ratio",
  "xai_unsupported_aspect_ratio",
]);

function normalOutputSpec(aspectRatio?: ConfiguredAspectRatio): ImageOutputSpec {
  return Object.freeze({
    stage: "normal" as const,
    aspectRatio: aspectRatio ?? "source",
  });
}

export function createStoryEvaluationMatrix(): StoryEvaluationMatrixCell[] {
  return STORY_ARTWORKS.flatMap(artwork =>
    STORY_SCENARIO_CASES.map(scenarioCase => ({
      id: `${artwork.id}--${scenarioCase.id}`,
      artworkId: artwork.id,
      artworkLabel: artwork.label,
      artworkSource: artwork.source,
      scenarioId: scenarioCase.id,
      scenarioLabel: scenarioCase.label,
      scenarioSummary: { ...scenarioCase.summary },
      scenario: serializeScenario(scenarioCase.scenario),
      prompt: composePrompt(scenarioCase.scenario),
    })),
  );
}

function providerIdentities(registry: StoryProviderRegistry): StoryEvaluationProviderIdentity[] {
  return registry.ids.map(provider => {
    const adapter = registry.get(provider);
    if (adapter.provider !== provider) {
      throw new Error(`Provider registry returned a mismatched adapter for ${provider}`);
    }
    return { provider, requestedModel: adapter.model };
  });
}

export function createStoryEvaluationPreview(options: {
  registry: StoryProviderRegistry;
  aspectRatio?: ConfiguredAspectRatio;
}): StoryEvaluationPreview {
  const matrix = createStoryEvaluationMatrix();
  const providers = providerIdentities(options.registry);
  return {
    matrix,
    providers,
    outputSpec: normalOutputSpec(options.aspectRatio),
    plannedPaidCalls: matrix.length * providers.length,
  };
}

export function formatStoryEvaluationPreview(preview: StoryEvaluationPreview): string {
  const cells = preview.matrix.map(cell =>
    `- ${cell.id}: ${cell.artworkLabel} — ${cell.scenarioLabel}`,
  );
  const providers = preview.providers.map(identity =>
    `- ${identity.provider} / ${identity.requestedModel}`,
  );
  return [
    "Story prompt evaluation preview (no provider requests)",
    "Matrix: 2 artworks × 3 scenarios = 6 cells",
    ...cells,
    "Configured providers and production models:",
    ...providers,
    `Output: normal stage, aspect ratio ${preview.outputSpec.aspectRatio}`,
    `Planned paid calls: ${preview.plannedPaidCalls}`,
    "Run with --execute to create a fresh paid evaluation.",
  ].join("\n");
}

export function storyEvaluationRunId(now: Date): string {
  return now.toISOString().replaceAll(":", "-").replace(".", "-");
}

function imageExtension(mimeType: SupportedImageMimeType): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function writeJson(filePath: string, value: unknown): void {
  atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function expectedCellId(matrixCell: StoryEvaluationMatrixCell, provider: ImageProviderId): string {
  return `${matrixCell.id}--${provider}`;
}

function expectedIds(manifest: StoryEvaluationManifest): string[] {
  return manifest.matrix.flatMap(matrixCell =>
    manifest.providers.map(provider => expectedCellId(matrixCell, provider.provider)),
  );
}

function safeRelativeImagePath(value: string): string | undefined {
  if (
    value.length === 0
    || value.includes("\\")
    || value.startsWith("/")
    || /^[a-z][a-z0-9+.-]*:/i.test(value)
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return undefined;
  const segments = value.split("/");
  if (segments.some(segment => segment.length === 0 || segment === "." || segment === "..")) {
    return undefined;
  }
  return segments.map(encodeURIComponent).join("/");
}

export function isStoryEvaluationReady(manifest: StoryEvaluationManifest): boolean {
  const canonicalMatrixIds = createStoryEvaluationMatrix().map(cell => cell.id);
  const manifestMatrixIds = manifest.matrix.map(cell => cell.id);
  if (
    manifestMatrixIds.length !== canonicalMatrixIds.length
    || canonicalMatrixIds.some(id => !manifestMatrixIds.includes(id))
  ) return false;
  const ids = expectedIds(manifest);
  if (ids.length !== manifest.expectedCellCount || manifest.cells.length !== ids.length) {
    return false;
  }
  const expected = new Set(ids);
  const seen = new Set<string>();
  for (const cell of manifest.cells) {
    if (seen.has(cell.id) || !expected.has(cell.id)) return false;
    seen.add(cell.id);
    if (cell.status !== "successful" || safeRelativeImagePath(cell.imagePath) === undefined) {
      return false;
    }
  }
  return seen.size === expected.size;
}

function createChecklist(manifest: StoryEvaluationManifest): StoryReviewChecklist {
  return {
    schemaVersion: 1,
    runId: manifest.runId,
    questions: STORY_REVIEW_QUESTIONS,
    rows: manifest.matrix.flatMap(matrixCell =>
      manifest.providers.map(provider => ({
        cellId: expectedCellId(matrixCell, provider.provider),
        artwork: matrixCell.artworkLabel,
        scenario: matrixCell.scenarioLabel,
        provider: provider.provider,
        requestedModel: provider.requestedModel,
        immediateDoubleTake: null,
        visibleActionReactionConsequenceOrBeforeAfter: null,
        scenarioArtworkFit: null,
        sourcePreservation: null,
        specificOverStockInterpretation: null,
        reviewerNotes: null,
      })),
    ),
  };
}

function sanitizedFailure(
  base: StoryEvaluationCellBase,
  outcome: Exclude<ProviderAttemptOutcome, "successful">,
  safeCode?: string,
): StoryEvaluationCell {
  return {
    ...base,
    status: "unsuccessful",
    outcome,
    ...(safeCode && SAFE_CODES.has(safeCode) ? { safeCode } : {}),
  };
}

function isFailureOutcome(value: unknown): value is Exclude<ProviderAttemptOutcome, "successful"> {
  return typeof value === "string" && TERMINAL_FAILURES.has(value);
}

function normalizeFailureResult(
  base: StoryEvaluationCellBase,
  adapter: ImageProviderAdapter,
  result: ProviderEditFailure,
): StoryEvaluationCell {
  if (result.provider !== adapter.provider || result.requestedModel !== adapter.model) {
    return sanitizedFailure(base, "provider_error");
  }
  const outcome = isFailureOutcome(result.outcome) ? result.outcome : "provider_error";
  return sanitizedFailure(base, outcome, result.safeCode);
}

function imageMetadataMatches(claimed: ValidatedImage, actual: ValidatedImage): boolean {
  return claimed.mimeType === actual.mimeType
    && claimed.width === actual.width
    && claimed.height === actual.height
    && claimed.byteCount === actual.byteCount
    && claimed.sha256 === actual.sha256;
}

async function persistSuccessfulResult(
  runDir: string,
  base: StoryEvaluationCellBase,
  adapter: ImageProviderAdapter,
  result: Extract<ProviderEditResult, { outcome: "successful" }>,
): Promise<StoryEvaluationCell> {
  if (result.provider !== adapter.provider || result.requestedModel !== adapter.model) {
    return sanitizedFailure(base, "provider_error");
  }

  const bytes = Buffer.from(result.image.bytes);
  let validated: ValidatedImage;
  try {
    // Production adapters already validate their provider-specific output
    // geometry. Re-validate the bytes and claimed metadata here without
    // replacing those provider-specific rules with a second generic ratio test.
    validated = await validateImage(bytes);
  } catch (error) {
    if (error instanceof ImageValidationError) {
      return sanitizedFailure(base, "invalid_image", error.code);
    }
    throw error;
  }
  if (!imageMetadataMatches(result.image, validated)) {
    const safeCode = result.image.mimeType !== validated.mimeType
      ? "mime_mismatch"
      : "image_metadata_mismatch";
    return sanitizedFailure(base, "invalid_image", safeCode);
  }
  const extension = imageExtension(validated.mimeType);
  const imagePath = `images/${base.id}.${extension}`;
  const terminal: StoryEvaluationCell = {
    ...base,
    status: "successful",
    outcome: "successful",
    ...(typeof result.resolvedModel === "string" && result.resolvedModel.length > 0
      ? { resolvedModel: result.resolvedModel }
      : {}),
    imagePath,
    mimeType: validated.mimeType,
    width: validated.width,
    height: validated.height,
    byteCount: validated.byteCount,
    sha256: validated.sha256,
  };
  const imagesDirectory = path.join(runDir, "images");
  fs.mkdirSync(imagesDirectory, { recursive: true });
  atomicWriteFile(path.join(runDir, imagePath), validated.bytes);
  writeJson(path.join(imagesDirectory, `${base.id}.json`), terminal);
  return terminal;
}

function replaceCell(manifest: StoryEvaluationManifest, cell: StoryEvaluationCell): void {
  const index = manifest.cells.findIndex(candidate => candidate.id === cell.id);
  if (index < 0) throw new Error("Story evaluation cell is not part of the manifest");
  manifest.cells[index] = cell;
}

function persistRunArtifacts(
  manifest: StoryEvaluationManifest,
  manifestPath: string,
  galleryPath: string,
): void {
  manifest.operationalReadiness = isStoryEvaluationReady(manifest) ? "ready" : "not_ready";
  writeJson(manifestPath, manifest);
  atomicWriteFile(galleryPath, renderStoryEvaluationGallery(manifest));
}

export async function runStoryEvaluation(
  options: RunStoryEvaluationOptions,
): Promise<RunStoryEvaluationResult> {
  const now = options.now ?? (() => new Date());
  const created = now();
  const runId = storyEvaluationRunId(created);
  const runDir = path.join(options.evaluationRoot, runId);
  fs.mkdirSync(options.evaluationRoot, { recursive: true });
  try {
    fs.mkdirSync(runDir);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
    if (code === "EEXIST") throw new Error(`Story evaluation directory already exists: ${runDir}`);
    throw error;
  }

  const readFile = options.readFile ?? (filePath => fs.promises.readFile(filePath));
  const preview = createStoryEvaluationPreview(options);
  const sourcesDirectory = path.join(runDir, "sources");
  fs.mkdirSync(sourcesDirectory);
  const validatedSources = new Map<string, ValidatedImage>();
  const artworkRecords: StoryEvaluationArtworkRecord[] = [];

  for (const artwork of STORY_ARTWORKS) {
    const sourceBytes = await readFile(path.join(options.repoRoot, artwork.source));
    const source = await validateImage(Buffer.from(sourceBytes));
    validatedSources.set(artwork.id, source);
    const sourceExtension = path.extname(artwork.source).toLowerCase() || `.${imageExtension(source.mimeType)}`;
    const copiedSourcePath = `sources/${artwork.id}${sourceExtension}`;
    atomicWriteFile(path.join(runDir, copiedSourcePath), source.bytes);
    artworkRecords.push({
      id: artwork.id,
      label: artwork.label,
      source: artwork.source,
      copiedSourcePath,
      sourceMimeType: source.mimeType,
      sourceWidth: source.width,
      sourceHeight: source.height,
      sourceByteCount: source.byteCount,
      sourceSha256: source.sha256,
    });
  }

  const createdAt = created.toISOString();
  const manifest: StoryEvaluationManifest = {
    schemaVersion: 1,
    kind: "story-prompt-evaluation",
    runId,
    state: "running",
    operationalReadiness: "not_ready",
    createdAt,
    updatedAt: createdAt,
    expectedCellCount: preview.plannedPaidCalls,
    outputSpec: preview.outputSpec,
    providers: preview.providers,
    artworks: artworkRecords,
    matrix: preview.matrix,
    cells: preview.matrix.flatMap(matrixCell =>
      preview.providers.map(provider => {
        const artwork = artworkRecords.find(item => item.id === matrixCell.artworkId);
        if (!artwork) throw new Error("Story evaluation artwork record is missing");
        return {
          ...matrixCell,
          id: expectedCellId(matrixCell, provider.provider),
          provider: provider.provider,
          requestedModel: provider.requestedModel,
          outputSpec: { ...preview.outputSpec },
          copiedSourcePath: artwork.copiedSourcePath,
          sourceSha256: artwork.sourceSha256,
          createdAt,
          status: "pending" as const,
        };
      }),
    ),
  };

  const manifestPath = path.join(runDir, "manifest.json");
  const checklistPath = path.join(runDir, "review-checklist.json");
  const galleryPath = path.join(runDir, "gallery.html");
  writeJson(checklistPath, createChecklist(manifest));
  persistRunArtifacts(manifest, manifestPath, galleryPath);

  for (const matrixCell of preview.matrix) {
    const source = validatedSources.get(matrixCell.artworkId);
    if (!source) throw new Error("Story evaluation source is missing after validation");
    for (const provider of preview.providers) {
      const adapter = options.registry.get(provider.provider);
      const cellId = expectedCellId(matrixCell, provider.provider);
      const pending = manifest.cells.find(cell => cell.id === cellId);
      if (!pending) throw new Error("Story evaluation pending cell is missing");
      const { status: _pendingStatus, ...pendingBase } = pending;
      const base: StoryEvaluationCellBase = {
        ...pendingBase,
        createdAt: now().toISOString(),
      };
      let result: ProviderEditResult;
      try {
        const output = normalOutputSpec(options.aspectRatio);
        result = await adapter.editImage({
          source: {
            ...source,
            bytes: Buffer.from(source.bytes),
          },
          prompt: matrixCell.prompt,
          output,
        });
      } catch {
        result = {
          outcome: "provider_error",
          provider: adapter.provider,
          requestedModel: adapter.model,
        };
      }
      let terminal: StoryEvaluationCell;
      if (isProviderEditSuccess(result)) {
        terminal = await persistSuccessfulResult(
          runDir,
          base,
          adapter,
          result,
        );
      } else if (isFailureOutcome(result.outcome)) {
        terminal = normalizeFailureResult(base, adapter, result);
      } else {
        terminal = sanitizedFailure(base, "provider_error");
      }
      replaceCell(manifest, terminal);
      manifest.updatedAt = now().toISOString();
      persistRunArtifacts(manifest, manifestPath, galleryPath);
    }
  }

  const completedAt = now().toISOString();
  manifest.state = "completed";
  manifest.updatedAt = completedAt;
  manifest.completedAt = completedAt;
  persistRunArtifacts(manifest, manifestPath, galleryPath);
  return { runDir, manifestPath, checklistPath, galleryPath, manifest };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function providerLabel(provider: ImageProviderId): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "xai") return "xAI";
  return "Gemini";
}

function unsuccessfulLabel(cell: Extract<StoryEvaluationCell, { status: "unsuccessful" }>): string {
  const labels: Readonly<Record<Exclude<ProviderAttemptOutcome, "successful">, string>> = {
    refusal: "Provider refusal",
    no_image: "No image returned",
    invalid_image: "Invalid image output",
    unsupported_output_spec: "Unsupported output specification",
    provider_timeout: "Provider timeout",
    chain_deadline: "Request deadline",
    rate_limited: "Rate limited",
    authentication: "Authentication failure",
    quota: "Quota unavailable",
    provider_error: "Provider error",
    caller_cancelled: "Request cancelled",
  };
  return labels[cell.outcome];
}

interface DisplayCell {
  status: "successful" | "unsuccessful" | "pending";
  cell?: StoryEvaluationCell;
  label: string;
}

function displayCell(
  manifest: StoryEvaluationManifest,
  matrixCell: StoryEvaluationMatrixCell,
  provider: StoryEvaluationProviderIdentity,
): DisplayCell {
  const cell = manifest.cells.find(candidate =>
    candidate.id === expectedCellId(matrixCell, provider.provider),
  );
  if (!cell || cell.status === "pending") return { status: "pending", cell, label: "Pending or missing" };
  if (cell.status === "unsuccessful") {
    return { status: "unsuccessful", cell, label: unsuccessfulLabel(cell) };
  }
  if (!safeRelativeImagePath(cell.imagePath)) {
    return { status: "unsuccessful", cell, label: "Unsafe or missing image path" };
  }
  return { status: "successful", cell, label: "Successful" };
}

function galleryCounts(manifest: StoryEvaluationManifest): Record<DisplayCell["status"], number> {
  const counts = { successful: 0, unsuccessful: 0, pending: 0 };
  for (const matrixCell of manifest.matrix) {
    for (const provider of manifest.providers) {
      counts[displayCell(manifest, matrixCell, provider).status] += 1;
    }
  }
  return counts;
}

function renderSourceCard(artwork: StoryEvaluationArtworkRecord): string {
  const sourcePath = safeRelativeImagePath(artwork.copiedSourcePath);
  const media = sourcePath
    ? `<a class="image-link" href="${escapeHtml(sourcePath)}" target="_blank" rel="noopener" aria-label="${escapeHtml(`Open original ${artwork.label} at full resolution`)}"><img src="${escapeHtml(sourcePath)}" alt="${escapeHtml(`Original artwork: ${artwork.label}`)}"></a>`
    : '<div class="placeholder"><strong>Original unavailable</strong><span>Unsafe or missing source path</span></div>';
  return `<article class="art-card source-card">
      <p class="eyebrow">Original artwork</p>
      ${media}
      <div class="caption"><strong>${escapeHtml(artwork.label)}</strong><span>${artwork.sourceWidth} × ${artwork.sourceHeight}</span></div>
    </article>`;
}

function renderResultCard(
  manifest: StoryEvaluationManifest,
  matrixCell: StoryEvaluationMatrixCell,
  provider: StoryEvaluationProviderIdentity,
): string {
  const display = displayCell(manifest, matrixCell, provider);
  const successful = display.cell?.status === "successful"
    ? display.cell
    : undefined;
  const imagePath = successful ? safeRelativeImagePath(successful.imagePath) : undefined;
  const media = display.status === "successful" && imagePath
    ? `<a class="image-link" href="${escapeHtml(imagePath)}" target="_blank" rel="noopener" aria-label="${escapeHtml(`Open ${providerLabel(provider.provider)} result for ${matrixCell.artworkLabel}, ${matrixCell.scenarioLabel}`)}"><img class="result-image" src="${escapeHtml(imagePath)}" alt="${escapeHtml(`${providerLabel(provider.provider)} result: ${matrixCell.artworkLabel}, ${matrixCell.scenarioLabel}`)}"></a>`
    : `<div class="placeholder ${display.status}"><strong>${escapeHtml(display.label)}</strong><span>No reviewable image for this expected cell</span></div>`;
  const resolved = successful?.resolvedModel
    ? `<span>Resolved: ${escapeHtml(successful.resolvedModel)}</span>`
    : "";
  return `<article class="art-card result-card ${display.status}">
      <div class="provider-line"><span>${escapeHtml(providerLabel(provider.provider))}</span><span class="status-pill">${escapeHtml(display.status)}</span></div>
      ${media}
      <div class="caption"><strong>${escapeHtml(provider.requestedModel)}</strong>${resolved}</div>
    </article>`;
}

export function renderStoryEvaluationGallery(manifest: StoryEvaluationManifest): string {
  const ready = isStoryEvaluationReady(manifest);
  const counts = galleryCounts(manifest);
  const artworkSections = manifest.artworks.map(artwork => {
    const matrixCells = manifest.matrix.filter(cell => cell.artworkId === artwork.id);
    const scenarios = matrixCells.map(matrixCell => `
      <section class="scenario-block" aria-labelledby="scenario-${escapeHtml(matrixCell.id)}">
        <div class="scenario-heading">
          <div><p class="eyebrow">Evaluation condition</p><h3 id="scenario-${escapeHtml(matrixCell.id)}">${escapeHtml(matrixCell.scenarioLabel)}</h3></div>
          <dl class="conditions">
            <div><dt>Time</dt><dd>${escapeHtml(matrixCell.scenarioSummary.time)}</dd></div>
            <div><dt>Daylight</dt><dd>${escapeHtml(matrixCell.scenarioSummary.daylight)}</dd></div>
            <div><dt>Weather</dt><dd>${escapeHtml(matrixCell.scenarioSummary.weather)}</dd></div>
          </dl>
        </div>
        <div class="contact-sheet">
          ${renderSourceCard(artwork)}
          ${manifest.providers.map(provider => renderResultCard(manifest, matrixCell, provider)).join("")}
        </div>
      </section>`).join("");
    return `<section class="artwork-section" aria-labelledby="artwork-${escapeHtml(artwork.id)}">
      <header class="artwork-heading"><p>Source study</p><h2 id="artwork-${escapeHtml(artwork.id)}">${escapeHtml(artwork.label)}</h2></header>
      ${scenarios}
    </section>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src &#39;self&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;; frame-ancestors &#39;none&#39;">
  <title>Haystack story prompt evaluation</title>
  <style>
    :root { color-scheme: light; --ink: #24221d; --muted: #6c675d; --paper: #f1eee6; --panel: #faf8f2; --line: #c9c1b2; --green: #285e49; --red: #8c342d; --amber: #8a611d; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(1560px, calc(100% - 48px)); margin: 0 auto; padding: 56px 0 96px; }
    h1, h2, h3, p { margin: 0; }
    h1, h2, h3 { font-family: Iowan Old Style, Baskerville, Georgia, serif; font-weight: 600; }
    h1 { max-width: 960px; font-size: clamp(2.5rem, 7vw, 6rem); line-height: .92; letter-spacing: -.045em; }
    .masthead { display: grid; gap: 18px; padding-bottom: 32px; border-bottom: 1px solid var(--ink); }
    .kicker, .eyebrow, .artwork-heading p { color: var(--muted); font-size: .72rem; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
    .readiness { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: center; padding: 22px; border: 2px solid currentColor; background: var(--panel); }
    .readiness.ready { color: var(--green); }
    .readiness.not-ready { color: var(--red); }
    .readiness strong { display: block; font-size: clamp(1.15rem, 2vw, 1.6rem); letter-spacing: .035em; }
    .readiness p { max-width: 760px; color: var(--ink); }
    .counts { display: flex; flex-wrap: wrap; gap: 8px; }
    .counts span, .status-pill { padding: 4px 9px; border: 1px solid currentColor; border-radius: 999px; font-size: .72rem; font-weight: 750; text-transform: uppercase; }
    .review-contract { display: grid; grid-template-columns: minmax(220px, .55fr) 1.45fr; gap: 36px; margin: 44px 0 72px; padding: 28px 0; border-block: 1px solid var(--line); }
    .review-contract h2 { font-size: clamp(1.6rem, 3vw, 2.5rem); line-height: 1; }
    .review-contract ol { display: grid; gap: 10px; margin: 0; padding-left: 1.4rem; }
    .artwork-section { margin-top: 82px; }
    .artwork-heading { display: flex; align-items: baseline; gap: 18px; padding-bottom: 14px; border-bottom: 3px double var(--ink); }
    .artwork-heading h2 { font-size: clamp(2rem, 4vw, 3.6rem); line-height: 1; }
    .scenario-block { padding: 34px 0 46px; border-bottom: 1px solid var(--line); }
    .scenario-heading { display: grid; grid-template-columns: minmax(220px, .6fr) 1.4fr; gap: 30px; align-items: end; margin-bottom: 18px; }
    .scenario-heading h3 { margin-top: 3px; font-size: clamp(1.5rem, 2.5vw, 2.2rem); line-height: 1.05; }
    .conditions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0; }
    .conditions div { padding-left: 12px; border-left: 1px solid var(--line); }
    dt { color: var(--muted); font-size: .68rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    dd { margin: 3px 0 0; font-size: .86rem; }
    .contact-sheet { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 14px; align-items: start; }
    .art-card { min-width: 0; border: 1px solid var(--line); background: var(--panel); }
    .source-card { border-color: var(--ink); }
    .source-card > .eyebrow { padding: 9px 12px; color: var(--ink); }
    .provider-line { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 40px; padding: 7px 10px; font-size: .74rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .art-card img { display: block; width: 100%; height: auto; background: #ddd7cc; }
    .image-link { display: block; cursor: zoom-in; }
    .image-link:focus-visible { outline: 4px solid var(--green); outline-offset: -4px; }
    .caption { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 5px 14px; padding: 11px 12px; border-top: 1px solid var(--line); font-size: .75rem; overflow-wrap: anywhere; }
    .caption span { color: var(--muted); }
    .placeholder { display: grid; place-content: center; gap: 5px; min-height: 210px; padding: 28px; background: repeating-linear-gradient(-45deg, #eee9df, #eee9df 10px, #f6f3ec 10px, #f6f3ec 20px); text-align: center; }
    .placeholder strong { font-family: Iowan Old Style, Baskerville, Georgia, serif; font-size: 1.1rem; }
    .placeholder span { color: var(--muted); font-size: .78rem; }
    .result-card.unsuccessful .status-pill { color: var(--red); }
    .result-card.pending .status-pill { color: var(--amber); }
    .result-card.successful .status-pill { color: var(--green); }
    @media (max-width: 920px) { .review-contract, .scenario-heading { grid-template-columns: 1fr; } .conditions { grid-template-columns: 1fr 1fr 1fr; } }
    @media (max-width: 760px) { main { width: min(100% - 28px, 680px); padding-top: 30px; } .readiness { grid-template-columns: 1fr; } .conditions { grid-template-columns: 1fr; } .conditions div { padding: 7px 0 7px 10px; } .artwork-heading { align-items: flex-start; flex-direction: column; gap: 4px; } .contact-sheet { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header class="masthead">
      <p class="kicker">Haystack · Story prompt evaluation · ${escapeHtml(manifest.runId)}</p>
      <h1>Moments that ask for a second look.</h1>
      <div class="readiness ${ready ? "ready" : "not-ready"}" role="status">
        <div><strong>${ready ? "READY FOR PRODUCT REVIEW" : "NOT READY FOR PRODUCT REVIEW"}</strong><p>${ready ? "Every expected provider cell has a locally reviewable image. Human narrative judgment is still required." : "The operational matrix is incomplete or contains an unsuccessful output. Resolve that before judging the narrative baseline."}</p></div>
        <div class="counts" aria-label="Operational counts"><span>Successful ${counts.successful}</span><span>Unsuccessful ${counts.unsuccessful}</span><span>Pending ${counts.pending}</span></div>
      </div>
    </header>
    <section class="review-contract" aria-labelledby="rubric-heading">
      <div><p class="eyebrow">Human judgment only</p><h2 id="rubric-heading">Five-question review rubric</h2></div>
      <ol>${STORY_REVIEW_QUESTIONS.map(question => `<li>${escapeHtml(question)}</li>`).join("")}</ol>
    </section>
    ${artworkSections}
  </main>
</body>
</html>
`;
}
