import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../../src/server/server.js";
import { OutputStore } from "../../src/storage/output-store.js";
import type { Pipeline } from "../../src/engine/pipeline.js";
import type { WeatherProvider } from "../../src/weather/types.js";
import type { HourlyScheduler } from "../../src/server/scheduler.js";
import {
  makeMetadata,
  makeGenerateResult,
  createMockPipeline,
  createMockWeatherProvider,
  getGenerateCallArgs,
} from "../helpers/mock-factories.js";
import { clearWeatherCache } from "../../src/server/scenario-builder.js";
import { ProviderChainExhaustedError } from "../../src/engine/provider-chain.js";
import type { ProviderChainRunData } from "../../src/engine/provider-chain.js";
import { composePrompt, DEFAULT_TEMPLATE } from "../../src/engine/prompt.js";

/** Create a small valid PNG buffer (1x1 pixel) for upload tests. */
function createTestPng(): Buffer {
  return Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000970485973000003e8000003e801b57b526b0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082",
    "hex",
  );
}

let testJpeg: Buffer;
let testWebp: Buffer;

beforeAll(async () => {
  testJpeg = await sharp({
    create: {
      width: 2,
      height: 1,
      channels: 3,
      background: { r: 200, g: 100, b: 40 },
    },
  }).jpeg().toBuffer();
  testWebp = await sharp({
    create: {
      width: 2,
      height: 1,
      channels: 3,
      background: { r: 40, g: 120, b: 200 },
    },
  }).webp().toBuffer();
});

describe("Express API Server", () => {
  let outputDir: string;
  let pipeline: Pipeline;
  let weatherProvider: WeatherProvider;
  let testPngPath: string;

  beforeEach(() => {
    clearWeatherCache();
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-server-test-"));
    pipeline = createMockPipeline();
    weatherProvider = createMockWeatherProvider();

    const pngBuffer = createTestPng();
    const renderId = "20260214_120000_abc12345";
    fs.writeFileSync(path.join(outputDir, `${renderId}.png`), pngBuffer);
    fs.writeFileSync(
      path.join(outputDir, `${renderId}.json`),
      JSON.stringify(makeMetadata({ id: renderId })),
    );
    vi.mocked(pipeline.getStore().resolve).mockImplementation(
      id => new OutputStore(outputDir).resolve(id),
    );

    testPngPath = path.join(outputDir, "upload-test.png");
    fs.writeFileSync(testPngPath, pngBuffer);
  });

  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  function createTestApp() {
    return createApp({ pipeline, weatherProvider, outputDir });
  }

  function exhaustedWith(outcomes: Array<"rate_limited" | "provider_error">) {
    const providerOrder = outcomes.map((_, index) =>
      (["gemini", "openai", "xai"] as const)[index]);
    const run: ProviderChainRunData = {
      chainId: "safe-chain-id",
      stage: "normal",
      providerOrder,
      chainTimeoutMs: 570_000,
      startedAt: "2026-08-15T12:00:00.000Z",
      completedAt: "2026-08-15T12:00:03.000Z",
      durationMs: 3000,
      terminalOutcome: "exhausted",
      attempts: outcomes.map((outcome, index) => ({
        attemptId: `attempt-${index + 1}`,
        stage: "normal",
        ordinal: index + 1,
        provider: providerOrder[index],
        requestedModel: `${providerOrder[index]}-model`,
        startedAt: "2026-08-15T12:00:00.000Z",
        completedAt: "2026-08-15T12:00:01.000Z",
        durationMs: 1000,
        outcome,
      })),
    };
    return new ProviderChainExhaustedError(run);
  }

  // --- POST /api/generate ---

  describe("POST /api/generate", () => {
    it("returns 200 with metadata and imageUrl for valid image + hour", async () => {
      const app = createTestApp();

      const res = await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "14");

      expect(res.status).toBe(200);
      expect(res.body.metadata).toBeDefined();
      expect(res.body.metadata.id).toBe("20260214_120000_abc12345");
      expect(res.body.metadata).not.toHaveProperty("artworkSource");
      expect(res.body.metadata).not.toHaveProperty("outputPath");
      expect(res.body.metadata).not.toHaveProperty("prompt");
      expect(res.body.imageUrl).toBe("/api/outputs/20260214_120000_abc12345");
      expect(pipeline.generate).toHaveBeenCalledOnce();
    });

    it("returns 400 when no image is provided", async () => {
      const app = createTestApp();

      const res = await request(app)
        .post("/api/generate")
        .field("hour", "14");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("No image provided");
      expect(pipeline.generate).not.toHaveBeenCalled();
    });

    it("passes hour override to scenario builder", async () => {
      const app = createTestApp();

      await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "22");

      const { scenario } = getGenerateCallArgs(pipeline);
      expect(scenario.hour).toBe(22);
    });

    it("fetches weather when lat/lon/timezone provided", async () => {
      const app = createTestApp();

      await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12")
        .field("lat", "40.4168")
        .field("lon", "-3.7038")
        .field("timezone", "Europe/Madrid");

      expect(weatherProvider.getHourlyConditions).toHaveBeenCalledWith(
        40.4168,
        -3.7038,
        "Europe/Madrid",
      );

      const { scenario } = getGenerateCallArgs(pipeline);
      expect(scenario.weatherCode).toBe(0);
      expect(scenario.cloudPercent).toBe(10);
    });

    it("uses explicit weather overrides instead of fetching", async () => {
      const app = createTestApp();

      await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12")
        .field("weatherCode", "63")
        .field("cloudPercent", "90")
        .field("precipProbability", "80");

      expect(weatherProvider.getHourlyConditions).not.toHaveBeenCalled();

      const { scenario } = getGenerateCallArgs(pipeline);
      expect(scenario.weatherCode).toBe(63);
      expect(scenario.cloudPercent).toBe(90);
      expect(scenario.precipProbability).toBe(80);
    });

    it("routes a whitespace-only Lab override through the default story-rich prompt", async () => {
      const app = createTestApp();

      await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12")
        .field("promptOverride", "   ");

      const { promptOverride, scenario } = getGenerateCallArgs(pipeline);
      expect(promptOverride).toBeUndefined();
      expect(composePrompt(scenario)).toContain(
        "makes the viewer pause and wonder what is happening",
      );
    });

    it("passes a complete Lab prompt without injecting the default story contract", async () => {
      const app = createTestApp();
      const completePrompt = "Only repaint the bicycle red.";

      await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12")
        .field("promptOverride", completePrompt);

      const { promptOverride } = getGenerateCallArgs(pipeline);
      expect(promptOverride).toBe(completePrompt);
      expect(promptOverride).not.toContain(
        "makes the viewer pause and wonder what is happening",
      );
    });

    it("falls back to time-only scenario when weather fetch fails", async () => {
      vi.mocked(weatherProvider.getHourlyConditions)
        .mockRejectedValue(new Error("Network error"));

      const app = createTestApp();

      const res = await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12")
        .field("lat", "40.4168")
        .field("lon", "-3.7038")
        .field("timezone", "Europe/Madrid");

      expect(res.status).toBe(200);
      expect(pipeline.generate).toHaveBeenCalledOnce();

      const { scenario } = getGenerateCallArgs(pipeline);
      expect(scenario.weatherCode).toBeUndefined();
    });

    it("returns 500 when pipeline.generate throws", async () => {
      vi.mocked(pipeline.generate).mockRejectedValue(
        new Error("Gemini API error"),
      );

      const app = createTestApp();

      const res = await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Generation failed");
    });

    it("returns 429 only when every exhausted provider attempt was rate limited", async () => {
      vi.mocked(pipeline.generate).mockRejectedValue(
        exhaustedWith(["rate_limited", "rate_limited"]),
      );

      const res = await request(createTestApp())
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12");

      expect(res.status).toBe(429);
      expect(res.body).toEqual({ error: "Rate limited — try again later" });

      vi.mocked(pipeline.generate).mockRejectedValue(
        exhaustedWith(["rate_limited", "provider_error"]),
      );
      const mixed = await request(createTestApp())
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12");
      expect(mixed.status).toBe(500);
      expect(mixed.body).toEqual({ error: "Generation failed" });
    });

    it("returns a safe busy response for cross-process lock contention", async () => {
      vi.mocked(pipeline.generate).mockRejectedValue(
        Object.assign(new Error("internal lock detail"), {
          code: "GENERATION_BUSY",
        }),
      );

      const res = await request(createTestApp())
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12");

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "Generation already in progress" });
      expect(JSON.stringify(res.body)).not.toContain("internal lock detail");
    });

    it("cleans up temp file after generation", async () => {
      const app = createTestApp();

      let uploadedPath: string | undefined;
      vi.mocked(pipeline.generate).mockImplementation(
        (imagePath: string) => {
          uploadedPath = imagePath;
          return Promise.resolve(makeGenerateResult());
        },
      );

      await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12");

      await new Promise((r) => setTimeout(r, 50));

      expect(uploadedPath).toBeDefined();
      expect(fs.existsSync(uploadedPath!)).toBe(false);
    });

    it("returns 400 for invalid hour (non-numeric)", async () => {
      const app = createTestApp();

      const res = await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "banana");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("hour must be an integer 0-23");
      expect(pipeline.generate).not.toHaveBeenCalled();
    });

    it("returns 400 for out-of-range hour", async () => {
      const app = createTestApp();

      const res = await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "99");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("hour must be an integer 0-23");
      expect(pipeline.generate).not.toHaveBeenCalled();
    });

    it("ignores non-numeric weather override values", async () => {
      const app = createTestApp();

      await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12")
        .field("weatherCode", "abc");

      const { scenario } = getGenerateCallArgs(pipeline);
      expect(scenario.weatherCode).toBeUndefined();
    });

    it("cleans up temp file even when generation fails", async () => {
      const app = createTestApp();

      let uploadedPath: string | undefined;
      vi.mocked(pipeline.generate).mockImplementation(
        (imagePath: string) => {
          uploadedPath = imagePath;
          throw new Error("Generation failed");
        },
      );

      await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12");

      await new Promise((r) => setTimeout(r, 50));

      expect(uploadedPath).toBeDefined();
      expect(fs.existsSync(uploadedPath!)).toBe(false);
    });
  });

  // --- GET /api/history ---

  describe("GET /api/history", () => {
    it("returns list sorted newest-first", async () => {
      const renders = [
        makeMetadata({ id: "20260214_140000_def45678" }),
        makeMetadata({ id: "20260214_120000_abc12345" }),
      ];
      vi.mocked(pipeline.getStore().listAll).mockReturnValue(renders);

      const app = createTestApp();
      const res = await request(app).get("/api/history");

      expect(res.status).toBe(200);
      expect(res.body.renders).toHaveLength(2);
      expect(res.body.renders[0].imageUrl).toBe(
        "/api/outputs/20260214_140000_def45678",
      );
      expect(res.body.renders[1].imageUrl).toBe(
        "/api/outputs/20260214_120000_abc12345",
      );
    });

    it("respects limit query parameter", async () => {
      const renders = Array.from({ length: 10 }, (_, i) =>
        makeMetadata({ id: `render_${String(i).padStart(2, "0")}` }),
      );
      vi.mocked(pipeline.getStore().listAll).mockReturnValue(renders);

      const app = createTestApp();
      const res = await request(app).get("/api/history?limit=3");

      expect(res.status).toBe(200);
      expect(res.body.renders).toHaveLength(3);
    });

    it("defaults to 24 items when no limit specified", async () => {
      const renders = Array.from({ length: 30 }, (_, i) =>
        makeMetadata({ id: `render_${String(i).padStart(2, "0")}` }),
      );
      vi.mocked(pipeline.getStore().listAll).mockReturnValue(renders);

      const app = createTestApp();
      const res = await request(app).get("/api/history");

      expect(res.status).toBe(200);
      expect(res.body.renders).toHaveLength(24);
    });

    it("returns empty array when no renders exist", async () => {
      const app = createTestApp();
      const res = await request(app).get("/api/history");

      expect(res.status).toBe(200);
      expect(res.body.renders).toEqual([]);
    });

    it("serializes an explicit presentation allowlist", async () => {
      vi.mocked(pipeline.getStore().listAll).mockReturnValue([
        makeMetadata({
          provider: "openai",
          model: "gpt-image-2",
          resolvedModel: "gpt-image-2-2026-08-01",
          mimeType: "image/jpeg",
          width: 2048,
          height: 1152,
          byteCount: 1234,
          sha256: "a".repeat(64),
          providerOrder: ["gemini", "openai", "xai"],
          attempts: [{
            attemptId: "private-request-id",
            stage: "normal",
            ordinal: 1,
            provider: "gemini",
            requestedModel: "gemini-3.1-flash-lite-image",
            startedAt: "2026-02-14T12:00:00.000Z",
            completedAt: "2026-02-14T12:00:01.000Z",
            durationMs: 1000,
            outcome: "refusal",
            requestId: "provider-request-id",
            usage: { inputTokens: 500, costInUsdTicks: 100 },
          }],
          artworkSource: "/private/source/hopper.jpg",
          outputPath: "/private/outputs/render.jpg",
          prompt: "private prompt",
          responseId: "private-response-id",
          responseText: "raw provider response",
          usageMetadata: { totalTokenCount: 900 },
          finishReason: "STOP",
          scenario: {
            ...makeMetadata().scenario,
            weatherSource: "live",
            privateDiagnostic: "nested-secret",
          } as RenderMetadata["scenario"],
        }),
      ]);

      const res = await request(createTestApp()).get("/api/history");

      expect(res.status).toBe(200);
      expect(res.body.renders[0]).toEqual({
        id: "20260214_120000_abc12345",
        scenario: expect.objectContaining({ hour: 12, isDay: true }),
        model: "gpt-image-2",
        resolvedModel: "gpt-image-2-2026-08-01",
        provider: "openai",
        mimeType: "image/jpeg",
        width: 2048,
        height: 1152,
        createdAt: "2026-02-14T12:00:00.000Z",
        imageUrl: "/api/outputs/20260214_120000_abc12345",
        downloadUrl: "/api/outputs/20260214_120000_abc12345?download=1",
      });
      expect(JSON.stringify(res.body)).not.toMatch(
        /attempt|request|usage|cost|artworkSource|outputPath|prompt|response|finishReason/i,
      );
      expect(JSON.stringify(res.body)).not.toContain("nested-secret");
      expect(res.body.renders[0].scenario.weatherSource).toBe("live");
    });

    it("handles negative limit by returning empty array", async () => {
      const renders = [makeMetadata()];
      vi.mocked(pipeline.getStore().listAll).mockReturnValue(renders);

      const app = createTestApp();
      const res = await request(app).get("/api/history?limit=-1");

      expect(res.status).toBe(200);
      // slice(0, -1) drops last element — returns empty for single-item array
      expect(res.body.renders).toHaveLength(0);
    });

    it("handles non-numeric limit by returning empty array", async () => {
      const renders = [makeMetadata()];
      vi.mocked(pipeline.getStore().listAll).mockReturnValue(renders);

      const app = createTestApp();
      const res = await request(app).get("/api/history?limit=abc");

      expect(res.status).toBe(200);
      // parseInt("abc") = NaN; slice(0, NaN) returns []
      expect(res.body.renders).toHaveLength(0);
    });
  });

  // --- GET /api/outputs/:id ---

  describe("GET /api/outputs/:id", () => {
    it("serves existing image with correct content type", async () => {
      const app = createTestApp();

      const res = await request(app).get(
        "/api/outputs/20260214_120000_abc12345",
      );

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/image\/png/);
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it("serves a legacy .png containing JPEG bytes as JPEG", async () => {
      const id = "legacy_jpeg";
      fs.writeFileSync(path.join(outputDir, `${id}.png`), testJpeg);
      fs.writeFileSync(
        path.join(outputDir, `${id}.json`),
        JSON.stringify(makeMetadata({ id })),
      );

      const res = await request(createTestApp()).get(`/api/outputs/${id}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/image\/jpeg/);
      expect(res.body).toEqual(testJpeg);
    });

    it.each([
      ["JPEG", "new_jpeg", () => testJpeg, "image/jpeg", ".jpg"],
      ["WebP", "new_webp", () => testWebp, "image/webp", ".webp"],
    ] as const)("serves and downloads a new %s render truthfully", async (_label, id, getBytes, mimeType, extension) => {
      const store = new OutputStore(outputDir);
      await store.save(getBytes(), makeMetadata({ id }));

      const display = await request(createTestApp()).get(`/api/outputs/${id}`);
      expect(display.status).toBe(200);
      expect(display.headers["content-type"]).toMatch(new RegExp(mimeType));
      expect(display.body).toEqual(getBytes());

      const download = await request(createTestApp()).get(
        `/api/outputs/${id}?download=1`,
      );
      expect(download.status).toBe(200);
      expect(download.headers["content-type"]).toMatch(new RegExp(mimeType));
      expect(download.headers["content-disposition"]).toBe(
        `attachment; filename="haystack-${id}${extension}"`,
      );
    });

    it("downloads using the extension detected from bytes", async () => {
      const id = "legacy_download";
      fs.writeFileSync(path.join(outputDir, `${id}.png`), testJpeg);
      fs.writeFileSync(
        path.join(outputDir, `${id}.json`),
        JSON.stringify(makeMetadata({ id })),
      );

      const res = await request(createTestApp()).get(
        `/api/outputs/${id}?download=1`,
      );

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/image\/jpeg/);
      expect(res.headers["content-disposition"]).toBe(
        `attachment; filename="haystack-${id}.jpg"`,
      );
    });

    it("ignores malicious outputPath metadata and serves only the local sibling", async () => {
      const id = "safe_local";
      const outside = path.join(outputDir, "..", "server-secret.jpg");
      fs.writeFileSync(outside, testJpeg);
      fs.writeFileSync(path.join(outputDir, `${id}.png`), createTestPng());
      fs.writeFileSync(
        path.join(outputDir, `${id}.json`),
        JSON.stringify(makeMetadata({ id, outputPath: outside })),
      );

      const res = await request(createTestApp()).get(`/api/outputs/${id}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/image\/png/);
      fs.rmSync(outside, { force: true });
    });

    it("returns 404 for non-existent output", async () => {
      const app = createTestApp();

      const res = await request(app).get("/api/outputs/nonexistent_id");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Output not found");
    });

    it("returns 400 for invalid ID (directory traversal attempt)", async () => {
      const app = createTestApp();

      const res = await request(app).get("/api/outputs/..%2F..%2Fetc%2Fpasswd");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid output ID");
    });

    it.each([
      ["dot-dot (..)", ".."],
      ["single dot (.)", "."],
      ["slash separator", "foo/bar"],
    ])("returns 404 for path-resolved ID: %s (handled by Express router)", async (_label, id) => {
      const app = createTestApp();

      // These are resolved by Express's path normalization before reaching the handler
      const res = await request(app).get(`/api/outputs/${id}`);
      expect(res.status).toBe(404);
    });
  });

  // --- POST /api/location/search ---

  describe("POST /api/location/search", () => {
    it("returns locations from weather provider", async () => {
      const app = createTestApp();

      const res = await request(app)
        .post("/api/location/search")
        .send({ query: "Madrid" });

      expect(res.status).toBe(200);
      expect(res.body.locations).toHaveLength(1);
      expect(res.body.locations[0].name).toBe("Madrid");
      expect(weatherProvider.searchLocations).toHaveBeenCalledWith("Madrid");
    });

    it("returns 400 when query is missing", async () => {
      const app = createTestApp();

      const res = await request(app)
        .post("/api/location/search")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Query is required");
    });

    it("returns 400 when query is not a string", async () => {
      const app = createTestApp();

      const res = await request(app)
        .post("/api/location/search")
        .send({ query: 123 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Query is required");
    });
  });

  // --- GET /api/weather ---

  describe("GET /api/weather", () => {
    it("returns current and hourly conditions via single getForecast call", async () => {
      const app = createTestApp();

      const res = await request(app).get(
        "/api/weather?lat=40.4168&lon=-3.7038&timezone=Europe/Madrid",
      );

      expect(res.status).toBe(200);
      expect(res.body.current).toBeDefined();
      expect(res.body.current.sunrise).toBe("2026-02-14T07:30");
      expect(res.body.current.sunset).toBe("2026-02-14T18:15");
      expect(res.body.hourly).toHaveLength(1);

      expect(weatherProvider.getForecast).toHaveBeenCalledWith(
        40.4168,
        -3.7038,
        "Europe/Madrid",
      );
    });

    it("returns 400 when params are missing", async () => {
      const app = createTestApp();

      const res = await request(app).get("/api/weather?lat=40.4168");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("lat, lon, and timezone are required");
    });

    it("returns 400 when lat is not a number", async () => {
      const app = createTestApp();

      const res = await request(app).get(
        "/api/weather?lat=abc&lon=-3.7038&timezone=Europe/Madrid",
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("lat, lon, and timezone are required");
    });

    it("returns 500 when weather provider throws", async () => {
      vi.mocked(weatherProvider.getForecast).mockRejectedValue(new Error("API down"));

      const app = createTestApp();

      const res = await request(app).get(
        "/api/weather?lat=40.4168&lon=-3.7038&timezone=Europe/Madrid",
      );

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Weather fetch failed");
    });
  });

  // --- GET /api/config/default-template ---

  describe("GET /api/config/default-template", () => {
    it("returns the default prompt template", async () => {
      const app = createTestApp();

      const res = await request(app).get("/api/config/default-template");

      expect(res.status).toBe(200);
      expect(res.body.template).toBe(DEFAULT_TEMPLATE);
      expect(res.body.template).toContain("makes the viewer pause and wonder what is happening");
      expect(res.body.template).toContain(
        "Passive companionship, socializing, or leisure is not sufficient on its own",
      );
    });
  });

  // --- POST /api/scenario-preview ---

  describe("POST /api/scenario-preview", () => {
    it("returns scenario description for time-only request", async () => {
      const app = createTestApp();

      const res = await request(app)
        .post("/api/scenario-preview")
        .send({ hour: 14, isDay: true });

      expect(res.status).toBe(200);
      expect(res.body.description).toBe("2 PM, day");
    });

    it("includes weather data when provided", async () => {
      const app = createTestApp();

      const res = await request(app)
        .post("/api/scenario-preview")
        .send({
          hour: 12,
          isDay: true,
          weather: { weatherCode: 61, temperature: 15, humidity: 80 },
        });

      expect(res.status).toBe(200);
      expect(res.body.description).toContain("light rain");
      expect(res.body.description).toContain("15°C");
      expect(res.body.description).toContain("humidity 80%");
    });

    it("includes sun/moon data when location provided", async () => {
      const app = createTestApp();

      const res = await request(app)
        .post("/api/scenario-preview")
        .send({
          hour: 12,
          isDay: true,
          lat: 40.4168,
          lon: -3.7038,
          timezone: "Europe/Madrid",
        });

      expect(res.status).toBe(200);
      expect(res.body.description).toContain("sun elevation");
      expect(res.body.description).toContain("sun azimuth");
    });

    it("returns 400 for missing hour", async () => {
      const app = createTestApp();

      const res = await request(app)
        .post("/api/scenario-preview")
        .send({ isDay: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("hour must be an integer 0-23");
    });

    it("returns 400 for invalid hour", async () => {
      const app = createTestApp();

      const res = await request(app)
        .post("/api/scenario-preview")
        .send({ hour: 99, isDay: true });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("hour must be an integer 0-23");
    });
  });

  // --- GET /api/latest ---

  describe("GET /api/latest", () => {
    it("returns latest render with metadata and imageUrl", async () => {
      const latestMeta = makeMetadata({
        id: "20260214_150000_xyz99999",
        provider: "xai",
        mimeType: "image/webp",
        attempts: [],
        artworkSource: "/private/art.jpg",
        prompt: "private prompt",
      });
      vi.mocked(pipeline.getStore().getLatest).mockReturnValue(latestMeta);

      const app = createTestApp();
      const res = await request(app).get("/api/latest");

      expect(res.status).toBe(200);
      expect(res.body.metadata).toBeDefined();
      expect(res.body.metadata.id).toBe("20260214_150000_xyz99999");
      expect(res.body.metadata.provider).toBe("xai");
      expect(res.body.metadata.mimeType).toBe("image/webp");
      expect(res.body.metadata).not.toHaveProperty("attempts");
      expect(res.body.metadata).not.toHaveProperty("artworkSource");
      expect(res.body.metadata).not.toHaveProperty("prompt");
      expect(res.body.imageUrl).toBe("/api/outputs/20260214_150000_xyz99999");
    });

    it("returns 404 when no renders exist", async () => {
      const app = createTestApp();
      const res = await request(app).get("/api/latest");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("No renders available");
    });

    it("returns imageUrl matching /api/outputs/ pattern", async () => {
      const latestMeta = makeMetadata({ id: "20260214_150000_xyz99999" });
      vi.mocked(pipeline.getStore().getLatest).mockReturnValue(latestMeta);

      const app = createTestApp();
      const res = await request(app).get("/api/latest");

      expect(res.body.imageUrl).toMatch(/^\/api\/outputs\/[a-zA-Z0-9_-]+$/);
    });
  });

  // --- POST /api/scheduler/trigger ---

  describe("POST /api/scheduler/trigger", () => {
    function createMockSchedulerForTrigger(overrides: {
      running?: boolean;
      inActiveHours?: boolean;
    } = {}): HourlyScheduler {
      const { running = true, inActiveHours = true } = overrides;
      const result = makeGenerateResult();
      return {
        start: vi.fn(),
        stop: vi.fn(),
        runNow: vi.fn().mockResolvedValue(result),
        runNowIfNoRecentRender: vi.fn().mockResolvedValue({
          generated: true,
          result,
        }),
        isRunning: vi.fn().mockReturnValue(running),
        isInActiveHours: vi.fn().mockReturnValue(inActiveHours),
        isRenderForCurrentPeriod: vi.fn().mockReturnValue(true),
        isRecentRenderForCurrentPeriod: vi.fn().mockReturnValue(true),
      } as unknown as HourlyScheduler;
    }

    function createAppWithTriggerScheduler(overrides: {
      running?: boolean;
      inActiveHours?: boolean;
    } = {}) {
      const mockScheduler = createMockSchedulerForTrigger(overrides);
      const app = createApp({
        pipeline,
        weatherProvider,
        outputDir,
        scheduler: mockScheduler,
      });
      return { app, mockScheduler };
    }

    it("returns 503 when scheduler is not configured", async () => {
      const app = createTestApp();

      const res = await request(app).post("/api/scheduler/trigger");

      expect(res.status).toBe(503);
      expect(res.body.error).toBe("Scheduler not configured");
    });

    it("returns triggered: false when scheduler is paused", async () => {
      const { app } = createAppWithTriggerScheduler({ running: false });

      const res = await request(app).post("/api/scheduler/trigger");

      expect(res.status).toBe(200);
      expect(res.body.triggered).toBe(false);
      expect(res.body.reason).toBe("Scheduler paused");
    });

    it("returns triggered: false when outside active hours", async () => {
      const { app } = createAppWithTriggerScheduler({ inActiveHours: false });

      const res = await request(app).post("/api/scheduler/trigger");

      expect(res.status).toBe(200);
      expect(res.body.triggered).toBe(false);
      expect(res.body.reason).toBe("Outside active hours");
    });

    it("returns triggered: false when recent generation exists (dedup)", async () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const recentMeta = makeMetadata({ id: "recent_render", createdAt: fiveMinAgo });
      vi.mocked(pipeline.getStore().getLatest).mockReturnValue(recentMeta);

      const { app } = createAppWithTriggerScheduler();

      const res = await request(app).post("/api/scheduler/trigger");

      expect(res.status).toBe(200);
      expect(res.body.triggered).toBe(false);
      expect(res.body.reason).toBe("Recent generation exists");
      expect(res.body.latestId).toBe("recent_render");
    });

    it("honors the scheduler dedup recheck after waiting on its mutex", async () => {
      const recentMeta = makeMetadata({ id: "just_finished_render" });
      vi.mocked(pipeline.getStore().getLatest)
        .mockReturnValueOnce(null)
        .mockReturnValue(recentMeta);

      const mockScheduler = {
        start: vi.fn(),
        stop: vi.fn(),
        runNow: vi.fn().mockResolvedValue(makeGenerateResult()),
        runNowIfNoRecentRender: vi.fn().mockResolvedValue({
          generated: false,
          latest: recentMeta,
        }),
        isRunning: vi.fn().mockReturnValue(true),
        isInActiveHours: vi.fn().mockReturnValue(true),
        isRenderForCurrentPeriod: vi.fn().mockReturnValue(true),
        isRecentRenderForCurrentPeriod: vi.fn().mockReturnValue(false),
      } as unknown as HourlyScheduler;
      const app = createApp({ pipeline, weatherProvider, outputDir, scheduler: mockScheduler });

      const res = await request(app).post("/api/scheduler/trigger");

      expect(res.status).toBe(200);
      expect(res.body.triggered).toBe(false);
      expect(res.body.reason).toBe("Recent generation exists");
      expect(res.body.latestId).toBe("just_finished_render");
      expect(mockScheduler.runNowIfNoRecentRender).toHaveBeenCalledWith(30 * 60 * 1000);
      expect(mockScheduler.runNow).not.toHaveBeenCalled();
    });

    it("repairs a recent render from the previous hourly period", async () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const recentMeta = makeMetadata({ id: "early_previous_hour", createdAt: fiveMinAgo });
      vi.mocked(pipeline.getStore().getLatest).mockReturnValue(recentMeta);
      const { app, mockScheduler } = createAppWithTriggerScheduler();
      vi.mocked(mockScheduler.isRecentRenderForCurrentPeriod).mockReturnValue(false);

      const res = await request(app).post("/api/scheduler/trigger");

      expect(res.status).toBe(200);
      expect(res.body.triggered).toBe(true);
      expect(mockScheduler.runNowIfNoRecentRender).toHaveBeenCalledOnce();
    });

    it("triggers when latest render is exactly 30 min old (boundary)", async () => {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const oldMeta = makeMetadata({ createdAt: thirtyMinAgo });
      vi.mocked(pipeline.getStore().getLatest).mockReturnValue(oldMeta);

      const { app, mockScheduler } = createAppWithTriggerScheduler();
      vi.mocked(mockScheduler.isRecentRenderForCurrentPeriod).mockReturnValue(false);

      const res = await request(app).post("/api/scheduler/trigger");

      expect(res.status).toBe(200);
      expect(res.body.triggered).toBe(true);
      expect(res.body.metadata).toBeDefined();
    });

    it("triggers generation (happy path, no recent render)", async () => {
      const { app, mockScheduler } = createAppWithTriggerScheduler();

      const res = await request(app).post("/api/scheduler/trigger");

      expect(res.status).toBe(200);
      expect(res.body.triggered).toBe(true);
      expect(res.body.metadata).toBeDefined();
      expect(res.body.imageUrl).toBe("/api/outputs/20260214_120000_abc12345");
      expect(mockScheduler.runNowIfNoRecentRender).toHaveBeenCalledOnce();
    });

    it("triggers generation when store is empty (no latest)", async () => {
      vi.mocked(pipeline.getStore().getLatest).mockReturnValue(null);

      const { app, mockScheduler } = createAppWithTriggerScheduler();

      const res = await request(app).post("/api/scheduler/trigger");

      expect(res.status).toBe(200);
      expect(res.body.triggered).toBe(true);
      expect(mockScheduler.runNowIfNoRecentRender).toHaveBeenCalledOnce();
    });

    it("triggers when no active hours configured", async () => {
      const { app, mockScheduler } = createAppWithTriggerScheduler({ inActiveHours: true });

      const res = await request(app).post("/api/scheduler/trigger");

      expect(res.status).toBe(200);
      expect(res.body.triggered).toBe(true);
      expect(mockScheduler.runNowIfNoRecentRender).toHaveBeenCalledOnce();
    });

    it("returns 500 when generation fails with non-rate-limit error", async () => {
      const { app, mockScheduler } = createAppWithTriggerScheduler();
      vi.mocked(mockScheduler.runNowIfNoRecentRender).mockRejectedValue(
        new Error("Gemini API error"),
      );

      const res = await request(app).post("/api/scheduler/trigger");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Trigger generation failed");
    });

    it("returns 429 when generation fails with rate limit error", async () => {
      const { app, mockScheduler } = createAppWithTriggerScheduler();
      vi.mocked(mockScheduler.runNowIfNoRecentRender).mockRejectedValue(
        exhaustedWith(["rate_limited", "rate_limited"]),
      );

      const res = await request(app).post("/api/scheduler/trigger");

      expect(res.status).toBe(429);
      expect(res.body.error).toContain("Rate limited");
    });

    it("skips dedup when createdAt is corrupted (NaN guard)", async () => {
      const corruptMeta = makeMetadata({ createdAt: "not-a-date" });
      vi.mocked(pipeline.getStore().getLatest).mockReturnValue(corruptMeta);

      const { app } = createAppWithTriggerScheduler();

      const res = await request(app).post("/api/scheduler/trigger");

      expect(res.status).toBe(200);
      expect(res.body.triggered).toBe(false);
      expect(res.body.reason).toBe("Recent generation exists");
    });

    it("returns triggered: false when generation already in progress", async () => {
      let resolveGeneration!: (value: {
        generated: true;
        result: ReturnType<typeof makeGenerateResult>;
      }) => void;
      const mockScheduler = {
        start: vi.fn(),
        stop: vi.fn(),
        runNow: vi.fn().mockResolvedValue(makeGenerateResult()),
        runNowIfNoRecentRender: vi.fn().mockImplementation(
          () => new Promise((resolve) => { resolveGeneration = resolve; }),
        ),
        isRunning: vi.fn().mockReturnValue(true),
        isInActiveHours: vi.fn().mockReturnValue(true),
        isRenderForCurrentPeriod: vi.fn().mockReturnValue(true),
        isRecentRenderForCurrentPeriod: vi.fn().mockReturnValue(false),
      } as unknown as HourlyScheduler;

      const app = createApp({ pipeline, weatherProvider, outputDir, scheduler: mockScheduler });

      // Use native http to test concurrent requests — supertest serializes
      // on keep-alive connections, making true concurrency impossible.
      const server = app.listen(0);
      const port = (server.address() as { port: number }).port;

      function postTrigger(): Promise<{ status: number; body: Record<string, unknown> }> {
        return new Promise((resolve, reject) => {
          const req = http.request(
            { hostname: "127.0.0.1", port, path: "/api/scheduler/trigger", method: "POST" },
            (res) => {
              let data = "";
              res.on("data", (chunk: string) => { data += chunk; });
              res.on("end", () => {
                resolve({ status: res.statusCode!, body: JSON.parse(data) });
              });
            },
          );
          req.on("error", reject);
          req.end();
        });
      }

      try {
        // Fire first request (will block on the mutex-protected trigger)
        const first = postTrigger();

        // Wait for the first request to enter the handler and set triggerInFlight
        await new Promise((r) => setTimeout(r, 100));

        // Fire second request while first is in-flight
        const second = await postTrigger();

        expect(second.status).toBe(200);
        expect(second.body.triggered).toBe(false);
        expect(second.body.reason).toBe("Generation already in progress");

        // Resolve the first request so it completes cleanly
        resolveGeneration({ generated: true, result: makeGenerateResult() });
        const firstRes = await first;
        expect(firstRes.status).toBe(200);
        expect(firstRes.body.triggered).toBe(true);
      } finally {
        server.close();
      }
    });
  });

  // --- POST /api/override ---

  describe("POST /api/override", () => {
    function createMockScheduler(): HourlyScheduler {
      return {
        start: vi.fn(),
        stop: vi.fn(),
        runNow: vi.fn().mockResolvedValue(makeGenerateResult()),
        isRunning: vi.fn().mockReturnValue(true),
      } as unknown as HourlyScheduler;
    }

    function createAppWithScheduler() {
      const mockScheduler = createMockScheduler();
      const app = createApp({
        pipeline,
        weatherProvider,
        outputDir,
        scheduler: mockScheduler,
      });
      return { app, mockScheduler };
    }

    it("returns 503 when scheduler is not configured", async () => {
      const app = createTestApp();
      const res = await request(app)
        .post("/api/override")
        .send({ scenario: "A snowy winter night" });

      expect(res.status).toBe(503);
      expect(res.body.error).toContain("scheduler configuration");
    });

    it.each([
      ["missing", {}],
      ["not a string", { scenario: 123 }],
      ["empty string", { scenario: "" }],
    ])("returns 400 when scenario is %s", async (_label, body) => {
      const { app } = createAppWithScheduler();

      const res = await request(app)
        .post("/api/override")
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("scenario string is required");
    });

    it("returns 400 when scenario exceeds 500 characters", async () => {
      const { app } = createAppWithScheduler();

      const res = await request(app)
        .post("/api/override")
        .send({ scenario: "x".repeat(501) });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("500 characters");
    });

    it("triggers generation with valid scenario", async () => {
      const { app, mockScheduler } = createAppWithScheduler();

      const res = await request(app)
        .post("/api/override")
        .send({ scenario: "A stormy night scene" });

      expect(res.status).toBe(200);
      expect(res.body.metadata).toBeDefined();
      expect(res.body.metadata).not.toHaveProperty("prompt");
      expect(res.body.imageUrl).toBe("/api/outputs/20260214_120000_abc12345");
      expect(mockScheduler.runNow).toHaveBeenCalledWith("A stormy night scene");
    });

    it("returns 500 when scheduler.runNow throws with non-rate-limit error", async () => {
      const { app, mockScheduler } = createAppWithScheduler();
      vi.mocked(mockScheduler.runNow).mockRejectedValue(
        new Error("Generation failed"),
      );

      const res = await request(app)
        .post("/api/override")
        .send({ scenario: "A rainy day" });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Override generation failed");
    });

    it("returns 429 when scheduler.runNow throws with rate limit error", async () => {
      const { app, mockScheduler } = createAppWithScheduler();
      vi.mocked(mockScheduler.runNow).mockRejectedValue(
        exhaustedWith(["rate_limited", "rate_limited"]),
      );

      const res = await request(app)
        .post("/api/override")
        .send({ scenario: "A rainy day" });

      expect(res.status).toBe(429);
      expect(res.body.error).toContain("Rate limited");
    });

    it("accepts scenario with HTML-like content (stored verbatim)", async () => {
      const { app, mockScheduler } = createAppWithScheduler();

      const res = await request(app)
        .post("/api/override")
        .send({ scenario: '<script>alert("xss")</script>' });

      expect(res.status).toBe(200);
      expect(mockScheduler.runNow).toHaveBeenCalledWith(
        '<script>alert("xss")</script>',
      );
    });

    it("validates input before checking scheduler availability", async () => {
      // No scheduler configured AND invalid scenario — should get 400 (validation first)
      const app = createTestApp();
      const res = await request(app)
        .post("/api/override")
        .send({ scenario: "" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("scenario string is required");
    });
  });

  // --- Scheduler pause/resume/status ---

  describe("scheduler endpoints", () => {
    function createMockSchedulerWithState(): HourlyScheduler {
      let running = false;
      return {
        start: vi.fn(() => { running = true; }),
        stop: vi.fn(() => { running = false; }),
        runNow: vi.fn().mockResolvedValue(makeGenerateResult()),
        isRunning: vi.fn(() => running),
      } as unknown as HourlyScheduler;
    }

    function createAppWithScheduler() {
      const mockScheduler = createMockSchedulerWithState();
      const app = createApp({
        pipeline,
        weatherProvider,
        outputDir,
        scheduler: mockScheduler,
      });
      return { app, mockScheduler };
    }

    describe("GET /api/scheduler/status", () => {
      it("returns running: false when no scheduler configured", async () => {
        const app = createTestApp();
        const res = await request(app).get("/api/scheduler/status");

        expect(res.status).toBe(200);
        expect(res.body.running).toBe(false);
      });

      it("returns current running state from scheduler", async () => {
        const { app, mockScheduler } = createAppWithScheduler();

        // Initially not running
        let res = await request(app).get("/api/scheduler/status");
        expect(res.body.running).toBe(false);

        // Start it
        mockScheduler.start();
        res = await request(app).get("/api/scheduler/status");
        expect(res.body.running).toBe(true);
      });
    });

    describe("POST /api/scheduler/pause", () => {
      it("returns 503 when no scheduler configured", async () => {
        const app = createTestApp();
        const res = await request(app).post("/api/scheduler/pause");

        expect(res.status).toBe(503);
        expect(res.body.error).toBe("Scheduler not configured");
      });

      it("stops the scheduler and returns running: false", async () => {
        const { app, mockScheduler } = createAppWithScheduler();
        mockScheduler.start();

        const res = await request(app).post("/api/scheduler/pause");

        expect(res.status).toBe(200);
        expect(res.body.running).toBe(false);
        expect(mockScheduler.stop).toHaveBeenCalled();
      });
    });

    describe("POST /api/scheduler/resume", () => {
      it("returns 503 when no scheduler configured", async () => {
        const app = createTestApp();
        const res = await request(app).post("/api/scheduler/resume");

        expect(res.status).toBe(503);
        expect(res.body.error).toBe("Scheduler not configured");
      });

      it("starts the scheduler and returns running: true", async () => {
        const { app, mockScheduler } = createAppWithScheduler();

        const res = await request(app).post("/api/scheduler/resume");

        expect(res.status).toBe(200);
        expect(res.body.running).toBe(true);
        expect(mockScheduler.start).toHaveBeenCalled();
      });
    });
  });

  describe("local mutation guard", () => {
    function createGuardedApp(remoteAddress: string) {
      const mockScheduler = {
        start: vi.fn(),
        stop: vi.fn(),
        runNow: vi.fn().mockResolvedValue(makeGenerateResult()),
        runNowIfNoRecentRender: vi.fn().mockResolvedValue({
          generated: true,
          result: makeGenerateResult(),
        }),
        isRunning: vi.fn().mockReturnValue(true),
        isInActiveHours: vi.fn().mockReturnValue(true),
        isRecentRenderForCurrentPeriod: vi.fn().mockReturnValue(false),
      } as unknown as HourlyScheduler;
      return {
        app: createApp({
          pipeline,
          weatherProvider,
          outputDir,
          scheduler: mockScheduler,
          labPort: 4321,
          getSocketPeerAddress: () => remoteAddress,
        }),
        mockScheduler,
      };
    }

    it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])(
      "accepts socket-derived loopback address %s and ignores forwarding headers",
      async remoteAddress => {
        const { app } = createGuardedApp(remoteAddress);
        const res = await request(app)
          .post("/api/generate")
          .set("X-Forwarded-For", "203.0.113.40")
          .attach("image", testPngPath)
          .field("hour", "12");

        expect(res.status).toBe(200);
        expect(pipeline.generate).toHaveBeenCalledOnce();
      },
    );

    it("rejects a LAN peer before multer or provider work while keeping read-only routes available", async () => {
      const { app, mockScheduler } = createGuardedApp("192.168.0.44");

      // No body is needed: 403 (rather than the route's normal 400 for a
      // missing upload) proves the guard ran before multer.
      const mutation = await request(app).post("/api/generate");
      const trigger = await request(app).post("/api/scheduler/trigger");
      const readOnly = await request(app).get("/api/history");

      expect(mutation.status).toBe(403);
      expect(trigger.status).toBe(403);
      expect(readOnly.status).toBe(200);
      expect(pipeline.generate).not.toHaveBeenCalled();
      expect(mockScheduler.runNowIfNoRecentRender).not.toHaveBeenCalled();
    });

    it("rejects an untrusted browser Origin before JSON parsing and scheduler work", async () => {
      const { app, mockScheduler } = createGuardedApp("127.0.0.1");

      const res = await request(app)
        .post("/api/override")
        .set("Origin", "https://evil.example")
        .set("Content-Type", "application/json")
        .send("{not valid json");

      expect(res.status).toBe(403);
      expect(mockScheduler.runNow).not.toHaveBeenCalled();
    });

    it.each([
      "http://localhost:4321",
      "http://127.0.0.1:4321",
      "http://[::1]:4321",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://[::1]:5173",
    ])("allows the explicit local Lab origin %s", async origin => {
      const { app, mockScheduler } = createGuardedApp("127.0.0.1");

      const res = await request(app)
        .post("/api/override")
        .set("Origin", origin)
        .send({ scenario: "Soft rain" });

      expect(res.status).toBe(200);
      expect(mockScheduler.runNow).toHaveBeenCalledOnce();
    });

    it.each([
      "/api/scheduler/pause",
      "/api/scheduler/resume",
      "/api/scheduler/trigger",
      "/api/override",
    ])("protects state-changing scheduler route %s", async route => {
      const { app, mockScheduler } = createGuardedApp("10.0.0.50");

      const res = await request(app).post(route).send({ scenario: "Rain" });

      expect(res.status).toBe(403);
      expect(mockScheduler.start).not.toHaveBeenCalled();
      expect(mockScheduler.stop).not.toHaveBeenCalled();
      expect(mockScheduler.runNow).not.toHaveBeenCalled();
      expect(mockScheduler.runNowIfNoRecentRender).not.toHaveBeenCalled();
    });
  });

  // --- GET /kiosk ---

  describe("GET /kiosk", () => {
    it("serves the kiosk HTML page", async () => {
      const app = createTestApp();
      const res = await request(app).get("/kiosk");

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/html/);
      expect(res.text).toContain("<!DOCTYPE html>");
    });
  });
});
