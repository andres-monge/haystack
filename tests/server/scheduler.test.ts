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
import { resetImageCache } from "../../src/server/image-rotation.js";
import {
  makeGenerateResult,
  createMockPipeline,
  createMockWeatherProvider,
  getGenerateCallArgs,
} from "../helpers/mock-factories.js";

function createSchedulerConfig(overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
  return {
    pipeline: createMockPipeline(),
    weatherProvider: createMockWeatherProvider(),
    imageDir: "/tmp/test-images",
    location: { lat: 34.05, lon: -118.25, timezone: "America/Los_Angeles" },
    ...overrides,
  };
}

describe("HourlyScheduler", () => {
  let tmpDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetImageCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-sched-test-"));
    fs.writeFileSync(path.join(tmpDir, "art1.jpg"), "fake-image-data");
    fs.writeFileSync(path.join(tmpDir, "art2.png"), "fake-image-data");

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("start / stop lifecycle", () => {
    it("schedules a timeout on start()", () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      scheduler.start();
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

    it("stop() is safe to call when not started or called multiple times", () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      // Not started — should not throw
      scheduler.stop();
      expect(vi.getTimerCount()).toBe(0);

      // Start then stop twice — should not throw
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

      const { imagePath } = getGenerateCallArgs(config.pipeline);
      expect(imagePath.startsWith(tmpDir)).toBe(true);
    });

    it("passes scenario override text as a prompt", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      await scheduler.runNow("A stormy night scene");

      const { promptOverride } = getGenerateCallArgs(config.pipeline);
      expect(promptOverride).toContain("A stormy night scene");
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
      try {
        const config = createSchedulerConfig({ imageDir: emptyDir });
        const scheduler = new HourlyScheduler(config);

        await expect(scheduler.runNow()).rejects.toThrow(/No images found/);
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
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
      vi.mocked(config.pipeline.generate).mockImplementation(async () => {
        callCount++;
        const currentCall = callCount;
        await new Promise((r) => setTimeout(r, 100));
        return makeGenerateResult({ id: `result_${currentCall}` });
      });

      const scheduler = new HourlyScheduler(config);

      const p1 = scheduler.runNow();
      const p2 = scheduler.runNow("override");

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(config.pipeline.generate).toHaveBeenCalledTimes(2);
      expect(r1.metadata.id).toBe("result_1");
      expect(r2.metadata.id).toBe("result_2");
    });
  });

  describe("error handling", () => {
    it("propagates pipeline errors in runNow()", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      vi.mocked(config.pipeline.generate).mockRejectedValue(
        new Error("Gemini API error"),
      );

      const scheduler = new HourlyScheduler(config);

      await expect(scheduler.runNow()).rejects.toThrow("Gemini API error");
    });

    it("continues scheduling after a failed tick", async () => {
      vi.setSystemTime(new Date(2026, 1, 14, 14, 59, 59, 0));

      const config = createSchedulerConfig({ imageDir: tmpDir });
      vi.mocked(config.pipeline.generate)
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
      vi.mocked(config.weatherProvider.getHourlyConditions)
        .mockRejectedValue(new Error("Network error"));

      const scheduler = new HourlyScheduler(config);

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

      const { scenario } = getGenerateCallArgs(config.pipeline);
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

      const { scenario } = getGenerateCallArgs(config.pipeline);
      expect(scenario.weatherCode).toBe(0);
      expect(scenario.temperature).toBe(15);
      expect(scenario.cloudPercent).toBe(10);
    });
  });

  describe("isRunning()", () => {
    it("returns false before start()", () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      expect(scheduler.isRunning()).toBe(false);
    });

    it("returns true after start()", () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();
    });

    it("returns false after stop()", () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe("active hours", () => {
    it("skips generation when current hour is before active window", async () => {
      // 3 AM in America/Los_Angeles
      vi.setSystemTime(new Date("2026-02-15T11:00:00Z")); // 3 AM PST

      const config = createSchedulerConfig({
        imageDir: tmpDir,
        activeStart: 9,
        activeEnd: 21,
      });
      const scheduler = new HourlyScheduler(config);
      scheduler.start();

      // Advance to trigger the tick
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(config.pipeline.generate).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Skipping generation"),
      );

      scheduler.stop();
    });

    it("skips generation when current hour is at or after active end", async () => {
      // 22:00 in America/Los_Angeles (UTC-8 → 06:00 UTC next day)
      vi.setSystemTime(new Date("2026-02-15T05:59:59Z")); // just before 10 PM PST

      const config = createSchedulerConfig({
        imageDir: tmpDir,
        activeStart: 9,
        activeEnd: 21,
      });
      const scheduler = new HourlyScheduler(config);
      scheduler.start();

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(config.pipeline.generate).not.toHaveBeenCalled();

      scheduler.stop();
    });

    it("generates within active hours", async () => {
      // 10 AM in America/Los_Angeles (UTC-8 → 18:00 UTC)
      vi.setSystemTime(new Date("2026-02-15T17:59:59Z"));

      const config = createSchedulerConfig({
        imageDir: tmpDir,
        activeStart: 9,
        activeEnd: 21,
      });
      const scheduler = new HourlyScheduler(config);
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1001);

      expect(config.pipeline.generate).toHaveBeenCalledOnce();

      scheduler.stop();
    });

    it("runNow() bypasses active hours check", async () => {
      // 3 AM in America/Los_Angeles — outside active window
      vi.setSystemTime(new Date("2026-02-15T11:00:00Z"));

      const config = createSchedulerConfig({
        imageDir: tmpDir,
        activeStart: 9,
        activeEnd: 21,
      });
      const scheduler = new HourlyScheduler(config);

      const result = await scheduler.runNow();

      expect(config.pipeline.generate).toHaveBeenCalledOnce();
      expect(result).toBeDefined();
    });

    it("generates normally when no active hours configured", async () => {
      // 3 AM — but no active hours set
      vi.setSystemTime(new Date("2026-02-15T10:59:59Z"));

      const config = createSchedulerConfig({
        imageDir: tmpDir,
        activeStart: undefined,
        activeEnd: undefined,
      });
      const scheduler = new HourlyScheduler(config);
      scheduler.start();

      await vi.advanceTimersByTimeAsync(1001);

      expect(config.pipeline.generate).toHaveBeenCalledOnce();

      scheduler.stop();
    });
  });
});
