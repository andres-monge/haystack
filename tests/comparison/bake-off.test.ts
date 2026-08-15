import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRound1Matrix,
  preflightRound1,
  runRound1,
  type BakeOffManifest,
} from "../../src/comparison/bake-off.js";
import type {
  ComparisonProvider,
  ComparisonProviderResult,
  Round1ProviderId,
} from "../../src/comparison/types.js";
import {
  createMockComparisonProvider,
  TEST_PNG_BUFFER,
} from "../helpers/mock-factories.js";

const FIXED_NOW = new Date("2026-08-15T12:34:56.000Z");

function createArtworkFixtures(repoRoot: string): void {
  const artworkDir = path.join(repoRoot, "artwork");
  fs.mkdirSync(artworkDir, { recursive: true });
  fs.writeFileSync(path.join(artworkDir, "hopper.jpg"), Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]));
  fs.writeFileSync(path.join(artworkDir, "hotel-adriano.png"), TEST_PNG_BUFFER);
}

function manifestPath(comparisonRoot: string, runId: string): string {
  return path.join(comparisonRoot, runId, "manifest.json");
}

describe("Round 1 bake-off", () => {
  let tempDir: string;
  let repoRoot: string;
  let comparisonRoot: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-bake-off-"));
    repoRoot = path.join(tempDir, "repo");
    comparisonRoot = path.join(tempDir, "comparisons");
    createArtworkFixtures(repoRoot);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("defines the fixed two-artwork, three-weather, three-model matrix", () => {
    const providers = [
      createMockComparisonProvider("gemini"),
      createMockComparisonProvider("openai"),
      createMockComparisonProvider("xai"),
    ];

    const matrix = createRound1Matrix(providers);

    expect(new Set(matrix.map(cell => cell.artworkId))).toEqual(
      new Set(["hopper", "hotel-adriano"]),
    );
    expect(new Set(matrix.map(cell => cell.weatherId))).toEqual(
      new Set(["heavy-rain", "heavy-snow", "dense-fog"]),
    );
    expect(new Set(matrix.map(cell => cell.provider.provider))).toEqual(
      new Set(["gemini", "openai", "xai"]),
    );
    expect(matrix).toHaveLength(18);
  });

  it("processes six cases sequentially while starting all three providers together", async () => {
    const events: string[] = [];
    const calls: Array<{ provider: Round1ProviderId; bytes: Buffer; prompt: string }> = [];
    let startedInCase = 0;
    let releaseCase: (() => void) | undefined;

    const providers = (["gemini", "openai", "xai"] as const).map(provider => {
      const base = createMockComparisonProvider(provider);
      return {
        ...base,
        async editImage(bytes: Buffer, prompt: string): Promise<ComparisonProviderResult> {
          const caseNumber = Math.floor(calls.length / 3);
          calls.push({ provider, bytes, prompt });
          events.push(`start-${caseNumber}-${provider}`);
          startedInCase += 1;
          await new Promise<void>(resolve => {
            if (startedInCase === 3) {
              startedInCase = 0;
              resolve();
              releaseCase?.();
              releaseCase = undefined;
            } else {
              const previous = releaseCase;
              releaseCase = () => {
                previous?.();
                resolve();
              };
            }
          });
          events.push(`finish-${caseNumber}-${provider}`);
          return {
            status: "successful",
            imageBuffer: TEST_PNG_BUFFER,
            mimeType: "image/png",
          };
        },
      } satisfies ComparisonProvider;
    });
    const readFile = vi.fn((filePath: fs.PathLike) => fs.promises.readFile(filePath));

    const result = await runRound1({
      repoRoot,
      comparisonRoot,
      runId: "stable-run",
      providers,
      now: () => FIXED_NOW,
      readFile,
    });

    expect(result.replayed).toBe(false);
    expect(result.manifest.state).toBe("completed");
    expect(result.manifest.cells).toHaveLength(18);
    expect(calls).toHaveLength(18);
    expect(readFile).toHaveBeenCalledTimes(6);
    for (let offset = 0; offset < calls.length; offset += 3) {
      expect(new Set(calls.slice(offset, offset + 3).map(call => call.prompt)).size).toBe(1);
      expect(calls[offset].bytes).toEqual(calls[offset + 1].bytes);
      expect(calls[offset].bytes).toEqual(calls[offset + 2].bytes);
      expect(calls[offset].bytes).not.toBe(calls[offset + 1].bytes);
    }
    for (let caseNumber = 0; caseNumber < 6; caseNumber += 1) {
      const starts = events.filter(event => event.startsWith(`start-${caseNumber}-`));
      const firstNextStart = events.findIndex(event => event.startsWith(`start-${caseNumber + 1}-`));
      const lastFinish = Math.max(
        ...events.map((event, index) => event.startsWith(`finish-${caseNumber}-`) ? index : -1),
      );
      expect(starts).toHaveLength(3);
      if (caseNumber < 5) expect(firstNextStart).toBeGreaterThan(lastFinish);
    }
  });

  it("persists successful, unsuccessful, and safe error outcomes without raw errors", async () => {
    const secret = "synthetic-secret";
    const providers = [
      createMockComparisonProvider("gemini"),
      createMockComparisonProvider("openai", {
        status: "unsuccessful",
        reason: "policy",
      }),
      {
        ...createMockComparisonProvider("xai"),
        editImage: vi.fn().mockRejectedValue(new Error(secret)),
      },
    ];

    const result = await runRound1({
      repoRoot,
      comparisonRoot,
      runId: "outcomes",
      providers,
      now: () => FIXED_NOW,
    });
    const serialized = fs.readFileSync(manifestPath(comparisonRoot, "outcomes"), "utf8");

    expect(result.manifest.cells.filter(cell => cell.status === "successful")).toHaveLength(6);
    expect(result.manifest.cells.filter(cell => cell.status === "unsuccessful")).toHaveLength(6);
    expect(result.manifest.cells.filter(cell => cell.status === "error")).toHaveLength(6);
    expect(result.manifest.cells.filter(cell => cell.status === "error"))
      .toSatisfy((cells: Array<{ category?: string }>) => cells.every(cell => cell.category === "unknown"));
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("API_KEY");
  });

  it("writes JSON-safe allowlisted sidecars only inside the comparison run", async () => {
    const result = await runRound1({
      repoRoot,
      comparisonRoot,
      runId: "safe-sidecars",
      providers: [
        createMockComparisonProvider("gemini"),
        createMockComparisonProvider("openai"),
        createMockComparisonProvider("xai"),
      ],
      now: () => FIXED_NOW,
    });
    const sidecarPath = path.join(
      result.runDir,
      "images",
      "hopper--heavy-rain--gemini.json",
    );
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8")) as Record<string, unknown>;

    expect(Object.keys(sidecar).sort()).toEqual([
      "artworkId",
      "artworkLabel",
      "artworkSource",
      "createdAt",
      "elapsedMs",
      "id",
      "imagePath",
      "mimeType",
      "model",
      "outputSetting",
      "priceAsOf",
      "priceEstimate",
      "prompt",
      "provider",
      "scenario",
      "status",
      "weatherId",
      "weatherLabel",
    ]);
    expect(sidecar.createdAt).toBe(FIXED_NOW.toISOString());
    expect((sidecar.scenario as { timestampLocal: string }).timestampLocal)
      .toBe("2026-01-15T12:00:00.000Z");
    expect(String(sidecar.imagePath)).not.toMatch(/^\//);
    expect(path.resolve(result.runDir).startsWith(path.resolve(comparisonRoot))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, ".haystack"))).toBe(false);
  });

  it.each([
    ["empty", Buffer.alloc(0), "image/png"],
    ["unsupported", Buffer.from("not-an-image"), "image/png"],
    ["mismatched", TEST_PNG_BUFFER, "image/jpeg"],
    ["oversized", Buffer.concat([TEST_PNG_BUFFER, Buffer.alloc(20 * 1024 * 1024)]), "image/png"],
  ] as const)("does not write a successful image for %s bytes", async (_name, bytes, mimeType) => {
    const invalidProvider = {
      ...createMockComparisonProvider("gemini"),
      editImage: vi.fn().mockResolvedValue({
        status: "successful",
        imageBuffer: bytes,
        mimeType,
      }),
    } as ComparisonProvider;

    const result = await runRound1({
      repoRoot,
      comparisonRoot,
      runId: `invalid-${_name}`,
      providers: [
        invalidProvider,
        createMockComparisonProvider("openai", { status: "unsuccessful", reason: "no_image" }),
        createMockComparisonProvider("xai", { status: "unsuccessful", reason: "no_image" }),
      ],
      now: () => FIXED_NOW,
    });

    expect(result.manifest.cells.every(cell => cell.status === "unsuccessful")).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, "images"))).toBe(false);
  });

  it("replays a completed run without reading inputs or invoking providers", async () => {
    const firstProviders = [
      createMockComparisonProvider("gemini"),
      createMockComparisonProvider("openai"),
      createMockComparisonProvider("xai"),
    ];
    await runRound1({
      repoRoot,
      comparisonRoot,
      runId: "once-only",
      providers: firstProviders,
      now: () => FIXED_NOW,
    });
    const replayProviders = [
      createMockComparisonProvider("gemini"),
      createMockComparisonProvider("openai"),
      createMockComparisonProvider("xai"),
    ];
    const readFile = vi.fn();

    const replay = await runRound1({
      repoRoot,
      comparisonRoot,
      runId: "once-only",
      providers: replayProviders,
      now: () => new Date("2026-08-16T00:00:00.000Z"),
      readFile,
    });

    expect(replay.replayed).toBe(true);
    expect(readFile).not.toHaveBeenCalled();
    for (const provider of replayProviders) {
      expect(provider.editImage).not.toHaveBeenCalled();
    }
  });

  it("marks unfinished cells interrupted on re-open and never resumes them", async () => {
    const runId = "interrupted-run";
    const runDir = path.join(comparisonRoot, runId);
    fs.mkdirSync(runDir, { recursive: true });
    const matrix = createRound1Matrix([
      createMockComparisonProvider("gemini"),
      createMockComparisonProvider("openai"),
      createMockComparisonProvider("xai"),
    ]);
    const completedCell = matrix[0];
    const partial: BakeOffManifest = {
      schemaVersion: 1,
      runId,
      round: "round1",
      state: "running",
      createdAt: FIXED_NOW.toISOString(),
      updatedAt: FIXED_NOW.toISOString(),
      priceAsOf: "2026-08-15",
      plannedCellCount: 18,
      cells: [{
        id: completedCell.id,
        artworkId: completedCell.artworkId,
        artworkLabel: completedCell.artworkLabel,
        artworkSource: completedCell.artworkSource,
        weatherId: completedCell.weatherId,
        weatherLabel: completedCell.weatherLabel,
        scenario: completedCell.scenario,
        prompt: completedCell.prompt,
        provider: completedCell.provider.provider,
        model: completedCell.provider.model,
        outputSetting: completedCell.provider.outputSetting,
        priceEstimate: "$0 test",
        priceAsOf: "2026-08-15",
        elapsedMs: 10,
        createdAt: FIXED_NOW.toISOString(),
        status: "unsuccessful",
        reason: "no_image",
      }],
    };
    fs.writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify(partial));
    const providers = [
      createMockComparisonProvider("gemini"),
      createMockComparisonProvider("openai"),
      createMockComparisonProvider("xai"),
    ];

    const result = await runRound1({
      repoRoot,
      comparisonRoot,
      runId,
      providers,
      now: () => new Date("2026-08-15T13:00:00.000Z"),
    });

    expect(result.replayed).toBe(true);
    expect(result.manifest.state).toBe("interrupted");
    expect(result.manifest.cells).toHaveLength(18);
    expect(result.manifest.cells.filter(cell => cell.status === "error"))
      .toSatisfy((cells: Array<{ category?: string }>) => cells.every(cell => cell.category === "interrupted"));
    for (const provider of providers) expect(provider.editImage).not.toHaveBeenCalled();
  });

  it("preflight blocks on missing keys before remote checks and reports only unavailable models", async () => {
    const fetchImpl = vi.fn();

    const report = await preflightRound1({
      repoRoot,
      keys: {
        googleApiKey: "google-secret",
        openaiApiKey: undefined,
        xaiApiKey: "xai-secret",
      },
      fetchImpl,
    });

    expect(report.ready).toBe(false);
    expect(report.unavailable).toEqual([{
      provider: "openai",
      model: "gpt-image-2",
      reason: "missing_key",
    }]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("preflight checks each exact model without generating images", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const report = await preflightRound1({
      repoRoot,
      keys: {
        googleApiKey: "google-secret",
        openaiApiKey: "openai-secret",
        xaiApiKey: "xai-secret",
      },
      fetchImpl,
    });

    expect(report.ready).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(call => String(call[0]))).toEqual([
      expect.stringContaining("gemini-3.1-flash-lite-image"),
      expect.stringContaining("gpt-image-2"),
      expect.stringContaining("grok-imagine-image-2.0"),
    ]);
    expect(report.unavailable).toEqual([{
      provider: "openai",
      model: "gpt-image-2",
      reason: "unreachable",
    }]);
  });

  it("rejects unsafe run IDs before creating directories", async () => {
    await expect(runRound1({
      repoRoot,
      comparisonRoot,
      runId: "../escape",
      providers: [
        createMockComparisonProvider("gemini"),
        createMockComparisonProvider("openai"),
        createMockComparisonProvider("xai"),
      ],
    })).rejects.toThrow("Invalid run ID");
    expect(fs.existsSync(path.join(tempDir, "escape"))).toBe(false);
  });
});
