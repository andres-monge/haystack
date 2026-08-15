import * as fs from "node:fs";
import * as path from "node:path";
import { composePrompt } from "../engine/prompt.js";
import { serializeScenario } from "../engine/types.js";
import type { Scenario, SerializedScenario } from "../engine/types.js";
import { atomicWriteFile } from "./artifacts.js";
import { detectSupportedImage } from "./image-validation.js";
import {
  ROUND1_MODELS,
  ROUND1_PRICE_AS_OF,
  ROUND1_PROVIDER_SPECS,
} from "./providers.js";
import type {
  ComparisonErrorCategory,
  ComparisonProvider,
  ComparisonProviderKeys,
  ComparisonProviderResult,
  ComparisonUnsuccessfulReason,
  Round1ProviderId,
  SupportedImageMimeType,
} from "./types.js";
import { writeGallery } from "./gallery.js";

export const ROUND1_PLANNED_CELL_COUNT = 18;

const SAFE_RUN_ID = /^(?=.*[^.])[A-Za-z0-9._-]{1,128}$/;

export const ROUND1_ARTWORKS = [
  {
    id: "hopper",
    label: "Hopper",
    source: "artwork/hopper.jpg",
  },
  {
    id: "hotel-adriano",
    label: "Hotel Adriano",
    source: "artwork/hotel-adriano.png",
  },
] as const;

export const ROUND1_WEATHER_CASES: ReadonlyArray<{
  id: "heavy-rain" | "heavy-snow" | "dense-fog";
  label: string;
  scenario: Scenario;
}> = [
  {
    id: "heavy-rain",
    label: "Heavy rain",
    scenario: {
      timestampLocal: new Date("2026-01-15T12:00:00.000Z"),
      hour: 12,
      isDay: true,
      weatherSource: "none",
      weatherCode: 65,
      cloudPercent: 100,
      precipProbability: 100,
      temperature: 8,
      humidity: 96,
      windSpeed: 28,
      windGusts: 52,
      visibility: 3_000,
      precipitation: 15,
      rain: 15,
      snowfall: 0,
      snowDepth: 0,
      directRadiation: 0,
      diffuseRadiation: 30,
    },
  },
  {
    id: "heavy-snow",
    label: "Heavy snow",
    scenario: {
      timestampLocal: new Date("2026-01-15T12:00:00.000Z"),
      hour: 12,
      isDay: true,
      weatherSource: "none",
      weatherCode: 75,
      cloudPercent: 100,
      precipProbability: 100,
      temperature: -4,
      humidity: 94,
      windSpeed: 18,
      windGusts: 35,
      visibility: 2_000,
      precipitation: 4,
      rain: 0,
      snowfall: 4,
      snowDepth: 0.15,
      directRadiation: 0,
      diffuseRadiation: 45,
    },
  },
  {
    id: "dense-fog",
    label: "Dense fog",
    scenario: {
      timestampLocal: new Date("2026-01-15T12:00:00.000Z"),
      hour: 12,
      isDay: true,
      weatherSource: "none",
      weatherCode: 45,
      cloudPercent: 100,
      precipProbability: 10,
      temperature: 7,
      humidity: 100,
      windSpeed: 3,
      windGusts: 6,
      visibility: 100,
      precipitation: 0,
      rain: 0,
      snowfall: 0,
      snowDepth: 0,
      directRadiation: 0,
      diffuseRadiation: 20,
    },
  },
];

export type BakeOffErrorCategory = ComparisonErrorCategory | "interrupted";

interface BakeOffCellBase {
  id: string;
  artworkId: string;
  artworkLabel: string;
  artworkSource: string;
  weatherId: string;
  weatherLabel: string;
  scenario: SerializedScenario;
  prompt: string;
  provider: Round1ProviderId;
  model: string;
  outputSetting: string;
  priceEstimate: string;
  priceAsOf: string;
  elapsedMs: number;
  createdAt: string;
}

export type BakeOffCell = BakeOffCellBase & (
  | {
      status: "successful";
      imagePath: string;
      mimeType: SupportedImageMimeType;
    }
  | {
      status: "unsuccessful";
      reason: ComparisonUnsuccessfulReason;
    }
  | {
      status: "error";
      category: BakeOffErrorCategory;
    }
);

export interface BakeOffManifest {
  schemaVersion: 1;
  runId: string;
  round: "round1";
  state: "running" | "completed" | "interrupted";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  priceAsOf: string;
  plannedCellCount: 18;
  cells: BakeOffCell[];
}

export interface Round1MatrixCell {
  id: string;
  artworkId: string;
  artworkLabel: string;
  artworkSource: string;
  weatherId: string;
  weatherLabel: string;
  scenario: SerializedScenario;
  prompt: string;
  provider: ComparisonProvider;
}

export interface RunRound1Options {
  repoRoot: string;
  comparisonRoot: string;
  runId: string;
  providers: readonly ComparisonProvider[];
  now?: () => Date;
  readFile?: (filePath: string) => Promise<Buffer>;
}

export interface RunRound1Result {
  manifest: BakeOffManifest;
  runDir: string;
  manifestPath: string;
  galleryPath: string;
  replayed: boolean;
}

export type PreflightFailureReason =
  | "missing_key"
  | "missing_input"
  | "unreadable_input"
  | "unsupported_input"
  | "unreachable";

export interface PreflightIssue {
  provider?: Round1ProviderId;
  model?: string;
  artworkId?: string;
  reason: PreflightFailureReason;
}

export interface PreflightReport {
  ready: boolean;
  unavailable: PreflightIssue[];
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface PreflightRound1Options {
  repoRoot: string;
  keys: ComparisonProviderKeys;
  fetchImpl?: FetchLike;
  createAbortSignal?: (timeoutMs: number) => AbortSignal;
}

function validateProviderCatalog(
  providers: readonly ComparisonProvider[],
): Map<Round1ProviderId, ComparisonProvider> {
  const expected: Array<[Round1ProviderId, string]> = [
    ["gemini", ROUND1_MODELS.gemini],
    ["openai", ROUND1_MODELS.openai],
    ["xai", ROUND1_MODELS.xai],
  ];
  const providerMap = new Map(providers.map(provider => [provider.provider, provider]));

  for (const [providerId, model] of expected) {
    const provider = providerMap.get(providerId);
    if (!provider || provider.model !== model) {
      throw new Error(`Round 1 requires ${providerId}/${model}`);
    }
  }
  if (providers.length !== expected.length || providerMap.size !== expected.length) {
    throw new Error("Round 1 requires exactly Gemini, OpenAI, and xAI providers");
  }
  return providerMap;
}

export function createRound1Matrix(
  providers: readonly ComparisonProvider[],
): Round1MatrixCell[] {
  const providerMap = validateProviderCatalog(providers);
  const orderedProviders = (["gemini", "openai", "xai"] as const)
    .map(providerId => providerMap.get(providerId)!);

  return ROUND1_ARTWORKS.flatMap(artwork =>
    ROUND1_WEATHER_CASES.flatMap(weather => {
      const prompt = composePrompt(weather.scenario);
      const scenario = serializeScenario(weather.scenario);
      return orderedProviders.map(provider => ({
        id: `${artwork.id}--${weather.id}--${provider.provider}`,
        artworkId: artwork.id,
        artworkLabel: artwork.label,
        artworkSource: artwork.source,
        weatherId: weather.id,
        weatherLabel: weather.label,
        scenario,
        prompt,
        provider,
      }));
    }),
  );
}

export function resolveRound1RunDirectory(
  comparisonRoot: string,
  runId: string,
): string {
  if (!SAFE_RUN_ID.test(runId)) {
    throw new Error("Invalid run ID: use 1-128 letters, numbers, dots, dashes, or underscores");
  }
  return path.join(comparisonRoot, runId);
}

function writeManifest(filePath: string, manifest: BakeOffManifest): void {
  atomicWriteFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function loadManifest(filePath: string, runId: string): BakeOffManifest {
  let manifest: BakeOffManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(filePath, "utf8")) as BakeOffManifest;
  } catch {
    throw new Error(`Existing comparison manifest is unreadable: ${filePath}`);
  }
  if (
    manifest.schemaVersion !== 1
    || manifest.runId !== runId
    || manifest.round !== "round1"
    || !(["running", "completed", "interrupted"] as const).includes(manifest.state)
    || !Array.isArray(manifest.cells)
  ) {
    throw new Error(`Existing comparison manifest is incompatible: ${filePath}`);
  }
  return manifest;
}

function validateExistingCells(
  manifest: BakeOffManifest,
  matrix: readonly Round1MatrixCell[],
  manifestPath: string,
): void {
  const plannedIds = new Set(matrix.map(cell => cell.id));
  const storedIds = new Set<string>();
  const invalid = manifest.cells.some(cell => {
    if (
      typeof cell !== "object"
      || cell === null
      || typeof cell.id !== "string"
      || !plannedIds.has(cell.id)
      || storedIds.has(cell.id)
      || !(["successful", "unsuccessful", "error"] as const).includes(cell.status)
    ) return true;
    storedIds.add(cell.id);
    return false;
  });
  if (
    invalid
    || manifest.cells.length > ROUND1_PLANNED_CELL_COUNT
    || (manifest.state !== "running" && manifest.cells.length !== ROUND1_PLANNED_CELL_COUNT)
  ) {
    throw new Error(`Existing comparison manifest has invalid cells: ${manifestPath}`);
  }
}

function baseCell(
  planned: Round1MatrixCell,
  now: Date,
  elapsedMs: number,
): BakeOffCellBase {
  return {
    id: planned.id,
    artworkId: planned.artworkId,
    artworkLabel: planned.artworkLabel,
    artworkSource: planned.artworkSource,
    weatherId: planned.weatherId,
    weatherLabel: planned.weatherLabel,
    scenario: planned.scenario,
    prompt: planned.prompt,
    provider: planned.provider.provider,
    model: planned.provider.model,
    outputSetting: planned.provider.outputSetting,
    priceEstimate: ROUND1_PROVIDER_SPECS[planned.provider.provider].priceEstimate,
    priceAsOf: ROUND1_PRICE_AS_OF,
    elapsedMs,
    createdAt: now.toISOString(),
  };
}

function extensionForMimeType(mimeType: SupportedImageMimeType): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function writeSuccessfulArtifact(
  runDir: string,
  base: BakeOffCellBase,
  result: Extract<ComparisonProviderResult, { status: "successful" }>,
): BakeOffCell {
  const detectedMimeType = detectSupportedImage(result.imageBuffer);
  if (!detectedMimeType || detectedMimeType !== result.mimeType) {
    return { ...base, status: "unsuccessful", reason: "unusable_image" };
  }

  const imageDirectory = path.join(runDir, "images");
  fs.mkdirSync(imageDirectory, { recursive: true });
  const filename = `${base.id}.${extensionForMimeType(detectedMimeType)}`;
  const relativeImagePath = path.posix.join("images", filename);
  const imagePath = path.join(runDir, relativeImagePath);
  const sidecarPath = path.join(imageDirectory, `${base.id}.json`);
  const cell: BakeOffCell = {
    ...base,
    status: "successful",
    imagePath: relativeImagePath,
    mimeType: detectedMimeType,
  };

  try {
    atomicWriteFile(imagePath, result.imageBuffer);
    atomicWriteFile(sidecarPath, `${JSON.stringify(cell, null, 2)}\n`);
    return cell;
  } catch {
    try {
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
      if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath);
    } catch {
      // Best-effort cleanup; the terminal manifest still reports a safe error.
    }
    return { ...base, status: "error", category: "unknown" };
  }
}

function normalizeProviderResult(
  runDir: string,
  base: BakeOffCellBase,
  result: ComparisonProviderResult,
): BakeOffCell {
  if (result.status === "successful") {
    return writeSuccessfulArtifact(runDir, base, result);
  }
  if (result.status === "unsuccessful") {
    return { ...base, status: "unsuccessful", reason: result.reason };
  }
  return { ...base, status: "error", category: result.category };
}

function interruptedCell(planned: Round1MatrixCell, now: Date): BakeOffCell {
  return {
    ...baseCell(planned, now, 0),
    status: "error",
    category: "interrupted",
  };
}

function completedResult(
  manifest: BakeOffManifest,
  runDir: string,
  manifestPath: string,
  replayed: boolean,
): RunRound1Result {
  const galleryPath = path.join(runDir, "gallery.html");
  writeGallery(manifest, galleryPath);
  return { manifest, runDir, manifestPath, galleryPath, replayed };
}

export async function runRound1(
  options: RunRound1Options,
): Promise<RunRound1Result> {
  const now = options.now ?? (() => new Date());
  const readFile = options.readFile ?? (filePath => fs.promises.readFile(filePath));
  const runDir = resolveRound1RunDirectory(options.comparisonRoot, options.runId);
  const manifestPath = path.join(runDir, "manifest.json");
  const matrix = createRound1Matrix(options.providers);

  if (fs.existsSync(manifestPath)) {
    const existing = loadManifest(manifestPath, options.runId);
    validateExistingCells(existing, matrix, manifestPath);
    if (existing.state === "running") {
      const completedIds = new Set(existing.cells.map(cell => cell.id));
      for (const planned of matrix) {
        if (!completedIds.has(planned.id)) {
          existing.cells.push(interruptedCell(planned, now()));
        }
      }
      existing.state = "interrupted";
      existing.updatedAt = now().toISOString();
      existing.completedAt = existing.updatedAt;
      writeManifest(manifestPath, existing);
    }
    return completedResult(existing, runDir, manifestPath, true);
  }

  if (fs.existsSync(runDir)) {
    throw new Error(`Comparison run directory already exists without a manifest: ${runDir}`);
  }

  fs.mkdirSync(runDir, { recursive: true });
  const startedAt = now();
  const manifest: BakeOffManifest = {
    schemaVersion: 1,
    runId: options.runId,
    round: "round1",
    state: "running",
    createdAt: startedAt.toISOString(),
    updatedAt: startedAt.toISOString(),
    priceAsOf: ROUND1_PRICE_AS_OF,
    plannedCellCount: ROUND1_PLANNED_CELL_COUNT,
    cells: [],
  };
  writeManifest(manifestPath, manifest);

  for (let offset = 0; offset < matrix.length; offset += 3) {
    const plannedCase = matrix.slice(offset, offset + 3);
    const inputPath = path.join(options.repoRoot, plannedCase[0].artworkSource);
    let original: Buffer;
    try {
      original = await readFile(inputPath);
    } catch {
      for (const planned of plannedCase) {
        manifest.cells.push({
          ...baseCell(planned, now(), 0),
          status: "error",
          category: "configuration",
        });
        manifest.updatedAt = now().toISOString();
        writeManifest(manifestPath, manifest);
      }
      continue;
    }

    const pending = plannedCase.map(async planned => {
      const callStartedAt = Date.now();
      try {
        const result = await planned.provider.editImage(
          Buffer.from(original),
          planned.prompt,
        );
        return {
          planned,
          result,
          elapsedMs: Math.max(0, Date.now() - callStartedAt),
        };
      } catch {
        return {
          planned,
          result: { status: "error", category: "unknown" } as const,
          elapsedMs: Math.max(0, Date.now() - callStartedAt),
        };
      }
    });

    for (const settled of await Promise.all(pending)) {
      const cell = normalizeProviderResult(
        runDir,
        baseCell(settled.planned, now(), settled.elapsedMs),
        settled.result,
      );
      manifest.cells.push(cell);
      manifest.updatedAt = now().toISOString();
      writeManifest(manifestPath, manifest);
    }
  }

  manifest.state = "completed";
  manifest.updatedAt = now().toISOString();
  manifest.completedAt = manifest.updatedAt;
  writeManifest(manifestPath, manifest);
  return completedResult(manifest, runDir, manifestPath, false);
}

function keyIssues(keys: ComparisonProviderKeys): PreflightIssue[] {
  const candidates: Array<[Round1ProviderId, string, string | undefined]> = [
    ["gemini", ROUND1_MODELS.gemini, keys.googleApiKey],
    ["openai", ROUND1_MODELS.openai, keys.openaiApiKey],
    ["xai", ROUND1_MODELS.xai, keys.xaiApiKey],
  ];
  return candidates
    .filter((candidate): candidate is [Round1ProviderId, string, undefined] => !candidate[2])
    .map(([provider, model]) => ({ provider, model, reason: "missing_key" }));
}

function inputIssues(repoRoot: string): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  for (const artwork of ROUND1_ARTWORKS) {
    const filePath = path.join(repoRoot, artwork.source);
    if (!fs.existsSync(filePath)) {
      issues.push({ artworkId: artwork.id, reason: "missing_input" });
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(filePath);
    } catch {
      issues.push({ artworkId: artwork.id, reason: "unreadable_input" });
      continue;
    }
    if (!detectSupportedImage(bytes)) {
      issues.push({ artworkId: artwork.id, reason: "unsupported_input" });
    }
  }
  return issues;
}

function modelChecks(
  keys: Required<ComparisonProviderKeys>,
): Array<{
  provider: Round1ProviderId;
  model: string;
  url: string;
  headers?: HeadersInit;
}> {
  return [
    {
      provider: "gemini",
      model: ROUND1_MODELS.gemini,
      url: `https://generativelanguage.googleapis.com/v1beta/models/${ROUND1_MODELS.gemini}?key=${encodeURIComponent(keys.googleApiKey)}`,
    },
    {
      provider: "openai",
      model: ROUND1_MODELS.openai,
      url: `https://api.openai.com/v1/models/${ROUND1_MODELS.openai}`,
      headers: { Authorization: `Bearer ${keys.openaiApiKey}` },
    },
    {
      provider: "xai",
      model: ROUND1_MODELS.xai,
      url: `https://api.x.ai/v1/models/${ROUND1_MODELS.xai}`,
      headers: { Authorization: `Bearer ${keys.xaiApiKey}` },
    },
  ];
}

export async function preflightRound1(
  options: PreflightRound1Options,
): Promise<PreflightReport> {
  const localIssues = [...keyIssues(options.keys), ...inputIssues(options.repoRoot)];
  if (localIssues.length > 0) return { ready: false, unavailable: localIssues };

  const fetchImpl = options.fetchImpl ?? fetch;
  const createAbortSignal = options.createAbortSignal
    ?? ((timeoutMs: number) => AbortSignal.timeout(timeoutMs));
  const checks = modelChecks(options.keys as Required<ComparisonProviderKeys>);
  const results = await Promise.all(checks.map(async check => {
    try {
      const response = await fetchImpl(check.url, {
        method: "GET",
        headers: check.headers,
        signal: createAbortSignal(15_000),
      });
      return response.ok
        ? undefined
        : { provider: check.provider, model: check.model, reason: "unreachable" as const };
    } catch {
      return { provider: check.provider, model: check.model, reason: "unreachable" as const };
    }
  }));
  const unavailable: PreflightIssue[] = results.flatMap(issue =>
    issue === undefined ? [] : [issue],
  );
  return { ready: unavailable.length === 0, unavailable };
}
