import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { HourlyScheduler, type SchedulerConfig } from "../../src/server/scheduler.js";
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
    searchLocations: vi.fn().mockResolvedValue([]),
    getHourlyConditions: vi.fn().mockResolvedValue([
      {
        time: "2026-02-14T12:00",
        weatherCode: 0,
        cloudPercent: 10,
        precipProbability: 0,
        temperature: 15,
        isDay: true,
        humidity: 55,
        windSpeed: 8,
        windGusts: 15,
        visibility: 20000,
        precipitation: 0,
        rain: 0,
        snowfall: 0,
        snowDepth: 0,
        directRadiation: 320,
        diffuseRadiation: 80,
      },
    ]),
    getCurrentConditions: vi.fn().mockResolvedValue({}),
    getForecast: vi.fn().mockResolvedValue({ current: {}, hourly: [] }),
  };
}

function createSchedulerConfig(overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
  return {
    pipeline: createMockPipeline(),
    weatherProvider: createMockWeatherProvider(),
    imageDir: "/tmp/test-images",
    location: { lat: 34.05, lon: -118.25, timezone: "America/Los_Angeles" },
    ...overrides,
  };
}

// --- Tests ---

describe("HourlyScheduler", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-sched-test-"));
    // Create test images so getImageForToday returns a valid path
    fs.writeFileSync(path.join(tmpDir, "art1.jpg"), "fake-image-data");
    fs.writeFileSync(path.join(tmpDir, "art2.png"), "fake-image-data");
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("start / stop lifecycle", () => {
    it("schedules a timeout on start()", () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      scheduler.start();

      // Should have one pending timer
      expect(vi.getTimerCount()).toBe(1);

      scheduler.stop();
    });

    it("clears the timeout on stop()", () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      scheduler.start();
      expect(vi.getTimerCount()).toBe(1);

      scheduler.stop();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("stop() is safe to call when not started", () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      // Should not throw
      scheduler.stop();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("stop() is safe to call multiple times", () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      scheduler.start();
      scheduler.stop();
      scheduler.stop();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("scheduling timing", () => {
    it("fires at the next top of hour", async () => {
      // Set time to 2:30 PM — next tick should be at 3:00 PM (30 min away)
      vi.setSystemTime(new Date(2026, 1, 14, 14, 30, 0, 0));

      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      scheduler.start();

      // Advance 29 minutes — should NOT have fired yet
      await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
      expect(config.pipeline.generate).not.toHaveBeenCalled();

      // Advance 1 more minute to hit 3:00 PM
      await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
      expect(config.pipeline.generate).toHaveBeenCalledOnce();

      scheduler.stop();
    });

    it("reschedules after each tick", async () => {
      vi.setSystemTime(new Date(2026, 1, 14, 14, 59, 59, 0));

      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      scheduler.start();

      // Advance to next top of hour
      await vi.advanceTimersByTimeAsync(1001);
      expect(config.pipeline.generate).toHaveBeenCalledOnce();

      // Should have rescheduled — a new timer should exist
      expect(vi.getTimerCount()).toBe(1);

      scheduler.stop();
    });
  });

  describe("runNow()", () => {
    it("generates immediately without waiting for timer", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      const result = await scheduler.runNow();

      expect(config.pipeline.generate).toHaveBeenCalledOnce();
      expect(result.metadata.id).toBe("20260214_120000_abc12345");
    });

    it("uses today's image from imageDir", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      await scheduler.runNow();

      const generateCall = (config.pipeline.generate as ReturnType<typeof vi.fn>).mock.calls[0];
      const imagePath = generateCall[0] as string;
      expect(imagePath.startsWith(tmpDir)).toBe(true);
    });

    it("passes scenario override text as a prompt", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      await scheduler.runNow("A stormy night scene");

      const generateCall = (config.pipeline.generate as ReturnType<typeof vi.fn>).mock.calls[0];
      const prompt = generateCall[2] as string;
      expect(prompt).toContain("A stormy night scene");
    });

    it("builds scenario from weather provider in normal mode", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      await scheduler.runNow();

      expect(config.weatherProvider.getHourlyConditions).toHaveBeenCalledWith(
        34.05,
        -118.25,
        "America/Los_Angeles",
      );
    });

    it("also fetches weather for override mode (for scenario context)", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      await scheduler.runNow("Override text");

      expect(config.weatherProvider.getHourlyConditions).toHaveBeenCalled();
    });

    it("throws when imageDir is empty", async () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-empty-"));
      const config = createSchedulerConfig({ imageDir: emptyDir });
      const scheduler = new HourlyScheduler(config);

      await expect(scheduler.runNow()).rejects.toThrow(/No images found/);

      fs.rmSync(emptyDir, { recursive: true, force: true });
    });

    it("throws when imageDir does not exist", async () => {
      const config = createSchedulerConfig({ imageDir: "/nonexistent/path" });
      const scheduler = new HourlyScheduler(config);

      await expect(scheduler.runNow()).rejects.toThrow(/No images found/);
    });
  });

  describe("mutex (serial execution)", () => {
    it("serializes concurrent runNow() calls", async () => {
      let callCount = 0;
      const config = createSchedulerConfig({ imageDir: tmpDir });
      (config.pipeline.generate as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          callCount++;
          const currentCall = callCount;
          // Simulate async work
          await new Promise((r) => setTimeout(r, 100));
          return makeGenerateResult({ id: `result_${currentCall}` });
        },
      );

      const scheduler = new HourlyScheduler(config);

      // Launch two concurrent calls
      const p1 = scheduler.runNow();
      const p2 = scheduler.runNow("override");

      // Advance timers to let the first complete
      await vi.advanceTimersByTimeAsync(100);
      // Advance again for the second
      await vi.advanceTimersByTimeAsync(100);

      const [r1, r2] = await Promise.all([p1, p2]);

      // Both should complete, called sequentially
      expect(config.pipeline.generate).toHaveBeenCalledTimes(2);
      expect(r1.metadata.id).toBe("result_1");
      expect(r2.metadata.id).toBe("result_2");
    });
  });

  describe("error handling", () => {
    it("propagates pipeline errors in runNow()", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      (config.pipeline.generate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Gemini API error"),
      );

      const scheduler = new HourlyScheduler(config);

      await expect(scheduler.runNow()).rejects.toThrow("Gemini API error");
    });

    it("continues scheduling after a failed tick", async () => {
      vi.setSystemTime(new Date(2026, 1, 14, 14, 59, 59, 0));

      const config = createSchedulerConfig({ imageDir: tmpDir });
      // First call fails, second succeeds
      (config.pipeline.generate as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error("Temporary failure"))
        .mockResolvedValueOnce(makeGenerateResult());

      const scheduler = new HourlyScheduler(config);
      scheduler.start();

      // Advance to first tick (should fail)
      await vi.advanceTimersByTimeAsync(1001);
      expect(config.pipeline.generate).toHaveBeenCalledOnce();

      // Should still have a rescheduled timer
      expect(vi.getTimerCount()).toBe(1);

      // Advance to next tick (should succeed)
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(config.pipeline.generate).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });

    it("falls back to time-only scenario when weather fetch fails", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      (config.weatherProvider.getHourlyConditions as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error("Network error"));

      const scheduler = new HourlyScheduler(config);

      // Should not throw — falls back to time-only scenario
      const result = await scheduler.runNow();
      expect(result).toBeDefined();
      expect(config.pipeline.generate).toHaveBeenCalledOnce();
    });
  });

  describe("scenario building", () => {
    it("computes sun/moon positions for the scenario", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      await scheduler.runNow();

      const generateCall = (config.pipeline.generate as ReturnType<typeof vi.fn>).mock.calls[0];
      const scenario = generateCall[1];

      // buildScheduledScenario computes sun/moon via SunCalc
      expect(scenario.sunElevation).toBeDefined();
      expect(typeof scenario.sunElevation).toBe("number");
      expect(scenario.sunAzimuth).toBeDefined();
      expect(scenario.moonFraction).toBeDefined();
      expect(scenario.moonAltitude).toBeDefined();
    });

    it("applies weather data to the scenario", async () => {
      // Set UTC time so that America/Los_Angeles (PST = UTC-8) is at hour 12
      vi.setSystemTime(new Date("2026-02-14T20:00:00Z"));

      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      await scheduler.runNow();

      const generateCall = (config.pipeline.generate as ReturnType<typeof vi.fn>).mock.calls[0];
      const scenario = generateCall[1];

      // Weather data should be applied from mock (hour 12 matches the LA local time)
      expect(scenario.weatherCode).toBe(0);
      expect(scenario.temperature).toBe(15);
      expect(scenario.cloudPercent).toBe(10);
    });
  });
});
