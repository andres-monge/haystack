import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import request from "supertest";
import { createApp } from "../../src/server/server.js";
import type { Pipeline } from "../../src/engine/pipeline.js";
import type { OutputStore } from "../../src/storage/output-store.js";
import type { WeatherProvider } from "../../src/weather/types.js";
import type { RenderMetadata, GenerateResult } from "../../src/engine/types.js";

// --- Test fixtures ---

function makeMetadata(overrides: Partial<RenderMetadata> = {}): RenderMetadata {
  return {
    id: "20260214_120000_abc12345",
    artworkSource: "/tmp/test-image.png",
    scenario: {
      timestampLocal: "2026-02-14T12:00:00.000Z",
      hour: 12,
      isDay: true,
    },
    prompt: "Transform this artwork...",
    model: "gemini-2.5-flash-image",
    createdAt: "2026-02-14T12:00:00.000Z",
    outputPath: "",
    ...overrides,
  };
}

function makeGenerateResult(
  overrides: Partial<RenderMetadata> = {},
): GenerateResult {
  const metadata = makeMetadata(overrides);
  return {
    metadata,
    imagePath: "/tmp/output.png",
    imageBuffer: Buffer.from("fake-png-data"),
  };
}

/** Create a small valid PNG buffer (1x1 pixel) for upload tests. */
function createTestPng(): Buffer {
  // Minimal valid PNG: 8-byte signature + IHDR + IDAT + IEND
  return Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415478016360000000000200012721cd2a0000000049454e44ae426082",
    "hex",
  );
}

// --- Mock factories ---

function createMockPipeline(): Pipeline {
  const mockStore = {
    listAll: vi.fn().mockReturnValue([]),
    getLatest: vi.fn().mockReturnValue(null),
    save: vi.fn(),
  } as unknown as OutputStore;

  return {
    generate: vi.fn().mockResolvedValue(makeGenerateResult()),
    getStore: vi.fn().mockReturnValue(mockStore),
  } as unknown as Pipeline;
}

function createMockWeatherProvider(): WeatherProvider {
  return {
    searchLocations: vi.fn().mockResolvedValue([
      {
        name: "Madrid",
        country: "Spain",
        lat: 40.4168,
        lon: -3.7038,
        timezone: "Europe/Madrid",
        admin1: "Community of Madrid",
      },
    ]),
    getHourlyConditions: vi.fn().mockResolvedValue([
      {
        time: "2026-02-14T12:00",
        weatherCode: 0,
        cloudPercent: 10,
        precipProbability: 0,
        temperature: 15,
        isDay: true,
      },
    ]),
    getCurrentConditions: vi.fn().mockResolvedValue({
      time: "2026-02-14T12:00",
      weatherCode: 0,
      cloudPercent: 10,
      precipProbability: 0,
      temperature: 15,
      isDay: true,
      sunrise: "2026-02-14T07:30",
      sunset: "2026-02-14T18:15",
    }),
  };
}

// --- Tests ---

describe("Express API Server", () => {
  let outputDir: string;
  let pipeline: Pipeline;
  let weatherProvider: WeatherProvider;
  let testPngPath: string;

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-server-test-"));
    pipeline = createMockPipeline();
    weatherProvider = createMockWeatherProvider();

    // Write a test PNG to the output dir for output serving tests
    const pngBuffer = createTestPng();
    const meta = makeMetadata({ outputPath: path.join(outputDir, "20260214_120000_abc12345.png") });
    fs.writeFileSync(path.join(outputDir, "20260214_120000_abc12345.png"), pngBuffer);
    fs.writeFileSync(
      path.join(outputDir, "20260214_120000_abc12345.json"),
      JSON.stringify(meta),
    );

    // Write a temp PNG for upload
    testPngPath = path.join(outputDir, "upload-test.png");
    fs.writeFileSync(testPngPath, pngBuffer);
  });

  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  function createTestApp() {
    return createApp({ pipeline, weatherProvider, outputDir });
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

      const generateCall = (pipeline.generate as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const scenario = generateCall[1];
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

      const generateCall = (pipeline.generate as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const scenario = generateCall[1];
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

      // Should NOT fetch weather
      expect(weatherProvider.getHourlyConditions).not.toHaveBeenCalled();

      const generateCall = (pipeline.generate as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const scenario = generateCall[1];
      expect(scenario.weatherCode).toBe(63);
      expect(scenario.cloudPercent).toBe(90);
      expect(scenario.precipPercent).toBe(80);
    });

    it("treats whitespace-only promptOverride as undefined", async () => {
      const app = createTestApp();

      await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12")
        .field("promptOverride", "   ");

      const generateCall = (pipeline.generate as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const promptOverride = generateCall[2];
      expect(promptOverride).toBeUndefined();
    });

    it("passes non-empty promptOverride to pipeline", async () => {
      const app = createTestApp();

      await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12")
        .field("promptOverride", "Custom prompt text");

      const generateCall = (pipeline.generate as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const promptOverride = generateCall[2];
      expect(promptOverride).toBe("Custom prompt text");
    });

    it("falls back to time-only scenario when weather fetch fails", async () => {
      (weatherProvider.getHourlyConditions as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error("Network error"));

      const app = createTestApp();

      const res = await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12")
        .field("lat", "40.4168")
        .field("lon", "-3.7038")
        .field("timezone", "Europe/Madrid");

      // Should still succeed with time-only scenario
      expect(res.status).toBe(200);
      expect(pipeline.generate).toHaveBeenCalledOnce();

      const generateCall = (pipeline.generate as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const scenario = generateCall[1];
      // No weather data set
      expect(scenario.weatherCode).toBeUndefined();
    });

    it("returns 500 when pipeline.generate throws", async () => {
      (pipeline.generate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Gemini API error"),
      );

      const app = createTestApp();

      const res = await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Gemini API error");
    });

    it("cleans up temp file after generation", async () => {
      const app = createTestApp();

      // Track which file path multer writes to
      let uploadedPath: string | undefined;
      (pipeline.generate as ReturnType<typeof vi.fn>).mockImplementation(
        (imagePath: string) => {
          uploadedPath = imagePath;
          return makeGenerateResult();
        },
      );

      await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12");

      // The temp file should have been cleaned up
      expect(uploadedPath).toBeDefined();
      expect(fs.existsSync(uploadedPath!)).toBe(false);
    });

    it("cleans up temp file even when generation fails", async () => {
      const app = createTestApp();

      let uploadedPath: string | undefined;
      (pipeline.generate as ReturnType<typeof vi.fn>).mockImplementation(
        (imagePath: string) => {
          uploadedPath = imagePath;
          throw new Error("Generation failed");
        },
      );

      await request(app)
        .post("/api/generate")
        .attach("image", testPngPath)
        .field("hour", "12");

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
      (pipeline.getStore().listAll as ReturnType<typeof vi.fn>).mockReturnValue(
        renders,
      );

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
      (pipeline.getStore().listAll as ReturnType<typeof vi.fn>).mockReturnValue(
        renders,
      );

      const app = createTestApp();
      const res = await request(app).get("/api/history?limit=3");

      expect(res.status).toBe(200);
      expect(res.body.renders).toHaveLength(3);
    });

    it("defaults to 24 items when no limit specified", async () => {
      const renders = Array.from({ length: 30 }, (_, i) =>
        makeMetadata({ id: `render_${String(i).padStart(2, "0")}` }),
      );
      (pipeline.getStore().listAll as ReturnType<typeof vi.fn>).mockReturnValue(
        renders,
      );

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
    it("returns current and hourly conditions", async () => {
      const app = createTestApp();

      const res = await request(app).get(
        "/api/weather?lat=40.4168&lon=-3.7038&timezone=Europe/Madrid",
      );

      expect(res.status).toBe(200);
      expect(res.body.current).toBeDefined();
      expect(res.body.current.sunrise).toBe("2026-02-14T07:30");
      expect(res.body.current.sunset).toBe("2026-02-14T18:15");
      expect(res.body.hourly).toHaveLength(1);
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
      (
        weatherProvider.getCurrentConditions as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("API down"));

      const app = createTestApp();

      const res = await request(app).get(
        "/api/weather?lat=40.4168&lon=-3.7038&timezone=Europe/Madrid",
      );

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("API down");
    });
  });
});
