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
import { resetImageCache, setStateDir, resetStateDir } from "../../src/server/image-rotation.js";
import { clearWeatherCache } from "../../src/server/scenario-builder.js";
import {
  ProviderChainExhaustedError,
  ProviderChainTerminatedError,
  type ProviderChainRunData,
} from "../../src/engine/provider-chain.js";
import { PipelineGenerationError } from "../../src/engine/pipeline.js";
import { GenerationLockBusyError } from "../../src/engine/generation-lock.js";
import type {
  ImageProviderId,
  ProviderAttemptOutcome,
} from "../../src/engine/provider-types.js";
import {
  makeMetadata,
  makeGenerateResult,
  createMockPipeline,
  createMockWeatherProvider,
  getGenerateCallArgs,
} from "../helpers/mock-factories.js";
import { composePrompt, composePromptFromText } from "../../src/engine/prompt.js";

function createSchedulerConfig(overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
  return {
    pipeline: createMockPipeline(),
    weatherProvider: createMockWeatherProvider(),
    imageDir: "/tmp/test-images",
    location: { lat: 34.05, lon: -118.25, timezone: "America/Los_Angeles" },
    ...overrides,
  };
}

function exhausted(
  outcomes: readonly Exclude<ProviderAttemptOutcome, "successful">[] = [
    "refusal",
    "provider_timeout",
    "provider_error",
  ],
): ProviderChainExhaustedError {
  const providers: readonly ImageProviderId[] = ["gemini", "openai", "xai"];
  const run: ProviderChainRunData = {
    chainId: `chain-${outcomes.join("-")}`,
    stage: "normal",
    providerOrder: providers,
    chainTimeoutMs: 570_000,
    startedAt: "2026-02-14T12:00:00.000Z",
    completedAt: "2026-02-14T12:00:03.000Z",
    durationMs: 3_000,
    terminalOutcome: "exhausted",
    attempts: outcomes.map((outcome, index) => ({
      attemptId: `attempt-${index + 1}`,
      stage: "normal",
      ordinal: index + 1,
      provider: providers[index] ?? "xai",
      requestedModel: `model-${index + 1}`,
      startedAt: "2026-02-14T12:00:00.000Z",
      completedAt: "2026-02-14T12:00:01.000Z",
      durationMs: 1_000,
      outcome,
    })),
  };
  return new ProviderChainExhaustedError(run);
}

function terminated(
  outcome: "caller_cancelled" | "chain_deadline" | "local_failure",
): ProviderChainTerminatedError {
  const run: ProviderChainRunData = {
    chainId: `chain-${outcome}`,
    stage: "normal",
    providerOrder: ["gemini", "openai", "xai"],
    chainTimeoutMs: 570_000,
    startedAt: "2026-02-14T12:00:00.000Z",
    completedAt: "2026-02-14T12:00:01.000Z",
    durationMs: 1_000,
    terminalOutcome: outcome,
    attempts: [],
  };
  return new ProviderChainTerminatedError(outcome, run);
}

describe("HourlyScheduler", () => {
  let tmpDir: string;
  let stateDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetImageCache();
    clearWeatherCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-sched-test-"));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-sched-state-"));
    setStateDir(stateDir);
    fs.writeFileSync(path.join(tmpDir, "art1.jpg"), "fake-image-data");
    fs.writeFileSync(path.join(tmpDir, "art2.png"), "fake-image-data");

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    resetStateDir();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
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

      // Advance through the boundary plus the one-second safety margin
      await vi.advanceTimersByTimeAsync(1 * 60 * 1000 + 1001);
      expect(config.pipeline.generate).toHaveBeenCalledOnce();

      scheduler.stop();
    });

    it("reschedules after each tick", async () => {
      vi.setSystemTime(new Date(2026, 1, 14, 14, 59, 59, 0));

      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      scheduler.start();

      // Advance to next top of hour
      await vi.advanceTimersByTimeAsync(2001);
      expect(config.pipeline.generate).toHaveBeenCalledOnce();

      // Should have rescheduled — a new timer should exist
      expect(vi.getTimerCount()).toBe(1);

      scheduler.stop();
    });

    it("waits safely past the wall-clock boundary before reading the new hour", async () => {
      vi.setSystemTime(new Date("2026-08-03T17:59:59.900Z"));

      const weatherProvider = createMockWeatherProvider();
      vi.mocked(weatherProvider.getHourlyConditions).mockResolvedValue([
        {
          time: "2026-08-03T20:00",
          weatherCode: 0,
          cloudPercent: 10,
          precipProbability: 0,
          temperature: 30,
          isDay: true,
        },
      ]);
      const config = createSchedulerConfig({
        imageDir: tmpDir,
        weatherProvider,
        location: { lat: 40.53, lon: -3.64, timezone: "Europe/Madrid" },
      });
      const scheduler = new HourlyScheduler(config);
      scheduler.start();

      await vi.advanceTimersByTimeAsync(100);
      expect(config.pipeline.generate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);
      expect(config.pipeline.generate).toHaveBeenCalledOnce();
      const { scenario } = getGenerateCallArgs(config.pipeline);
      expect(scenario.hour).toBe(20);
      expect(scenario.minute).toBe(0);
      expect(scenario.isDay).toBe(true);
      expect(scenario.solarPhase).toBe("daylight");
      expect(scenario.solarTrend).toBe("setting");
      expect(scenario.sunElevation).toBeCloseTo(15.2, 1);

      scheduler.stop();
    });
  });

  describe("runNow()", () => {
    it("forwards scheduled generation through the default story-rich prompt path", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      const result = await scheduler.runNow();

      expect(config.pipeline.generate).toHaveBeenCalledOnce();
      expect(result.metadata.id).toBe("20260214_120000_abc12345");
      const { scenario, promptOverride } = getGenerateCallArgs(config.pipeline);
      expect(promptOverride).toBeUndefined();
      expect(composePrompt(scenario)).toContain(
        "makes the viewer pause and wonder what is happening",
      );
    });

    it("uses today's image from imageDir", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);

      await scheduler.runNow();

      const { imagePath } = getGenerateCallArgs(config.pipeline);
      expect(imagePath.startsWith(tmpDir)).toBe(true);
    });

    it("wraps a Kiosk Scenario override in the default contract and retains the effective metadata prompt", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      vi.mocked(config.pipeline.generate).mockImplementation(
        async (_imagePath, _scenario, promptOverride) => makeGenerateResult({
          prompt: promptOverride,
        }),
      );
      const scheduler = new HourlyScheduler(config);
      const scenarioOverride = "A stormy night scene";
      const expectedPrompt = composePromptFromText(scenarioOverride);

      const result = await scheduler.runNow(scenarioOverride);

      const { promptOverride } = getGenerateCallArgs(config.pipeline);
      expect(promptOverride).toBe(expectedPrompt);
      expect(promptOverride).toContain(scenarioOverride);
      expect(promptOverride).toContain("makes the viewer pause and wonder what is happening");
      expect(result.metadata.prompt).toBe(expectedPrompt);
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

    it("generates when the backup check finds no recent render", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const expected = makeGenerateResult({ id: "backup_render" });
      vi.mocked(config.pipeline.getStore().getLatest).mockReturnValue(null);
      vi.mocked(config.pipeline.generate).mockResolvedValue(expected);

      const scheduler = new HourlyScheduler(config);
      await expect(
        scheduler.runNowIfNoRecentRender(30 * 60 * 1000),
      ).resolves.toEqual({ generated: true, result: expected });

      expect(config.pipeline.getStore().getLatest).toHaveBeenCalledOnce();
      expect(config.pipeline.generate).toHaveBeenCalledOnce();
    });

    it("uses earlier metadata only for dedup and never for the next prompt", async () => {
      const now = new Date("2026-02-14T20:45:00.000Z");
      vi.setSystemTime(now);
      const priorPrompt = "PRIOR_RENDER_STORY_MUST_NOT_BE_REUSED";
      const previous = makeMetadata({
        createdAt: new Date(now.getTime() - 31 * 60 * 1000).toISOString(),
        prompt: priorPrompt,
        scenario: {
          timestampLocal: "2026-02-14T12:00:00-08:00",
          hour: 12,
          isDay: true,
        },
      });
      const config = createSchedulerConfig({ imageDir: tmpDir });
      vi.mocked(config.pipeline.getStore().getLatest).mockResolvedValue(previous);
      const scheduler = new HourlyScheduler(config);

      await expect(
        scheduler.runNowIfNoRecentRender(30 * 60 * 1000),
      ).resolves.toMatchObject({ generated: true });

      const { scenario, promptOverride } = getGenerateCallArgs(config.pipeline);
      const effectivePrompt = composePrompt(scenario);
      expect(promptOverride).toBeUndefined();
      expect(effectivePrompt).toContain("makes the viewer pause and wonder what is happening");
      expect(effectivePrompt).not.toContain(priorPrompt);
      expect(scenario).not.toEqual(previous.scenario);
    });

    it("rechecks dedup after waiting for an in-progress generation", async () => {
      const now = new Date("2026-08-10T19:05:00.000Z");
      vi.setSystemTime(now);

      const config = createSchedulerConfig({
        imageDir: tmpDir,
        location: { lat: 40.53, lon: -3.64, timezone: "Europe/Madrid" },
      });
      const completedResult = makeGenerateResult({
        id: "scheduled_render",
        createdAt: now.toISOString(),
        scenario: {
          timestampLocal: now.toISOString(),
          hour: 21,
          minute: 5,
          isDay: true,
        },
      });
      let resolveGeneration!: (
        value: ReturnType<typeof makeGenerateResult>,
      ) => void;
      vi.mocked(config.pipeline.generate).mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveGeneration = resolve;
        }),
      );

      const scheduler = new HourlyScheduler(config);
      const scheduledRun = scheduler.runNow();
      await vi.advanceTimersByTimeAsync(0);
      expect(config.pipeline.generate).toHaveBeenCalledOnce();

      const backupRun = scheduler.runNowIfNoRecentRender(30 * 60 * 1000);
      vi.mocked(config.pipeline.getStore().getLatest).mockReturnValue(
        completedResult.metadata,
      );
      resolveGeneration(completedResult);

      await expect(scheduledRun).resolves.toEqual(completedResult);
      await expect(backupRun).resolves.toEqual({
        generated: false,
        latest: completedResult.metadata,
      });
      expect(config.pipeline.generate).toHaveBeenCalledOnce();
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
      await vi.advanceTimersByTimeAsync(2001);
      expect(config.pipeline.generate).toHaveBeenCalledOnce();

      // Should still have a rescheduled timer
      expect(vi.getTimerCount()).toBe(1);

      // Advance to next tick (should succeed)
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(config.pipeline.generate).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });

    it("rotates artwork only after the complete provider chain exhausts", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      vi.mocked(config.pipeline.generate)
        .mockRejectedValueOnce(exhausted())
        .mockResolvedValueOnce(makeGenerateResult({ id: "fallback_success" }));

      const scheduler = new HourlyScheduler(config);

      const result = await scheduler.runNow();

      expect(config.pipeline.generate).toHaveBeenCalledTimes(2);
      expect(result.metadata.id).toBe("fallback_success");

      // Verify the second call used a different image
      const calls = vi.mocked(config.pipeline.generate).mock.calls;
      const firstImage = calls[0][0] as string;
      const secondImage = calls[1][0] as string;
      expect(firstImage).not.toBe(secondImage);
      expect(path.dirname(firstImage)).toBe(tmpDir);
      expect(path.dirname(secondImage)).toBe(tmpDir);
      expect(firstImage).not.toBe(makeGenerateResult().imagePath);
      expect(secondImage).not.toBe(makeGenerateResult().imagePath);

      const firstScenario = calls[0][1];
      const secondScenario = calls[1][1];
      expect(secondScenario).toBe(firstScenario);
      expect(calls[0][2]).toBeUndefined();
      expect(calls[1][2]).toBeUndefined();
      expect(composePrompt(secondScenario)).toBe(composePrompt(firstScenario));
      expect(composePrompt(firstScenario)).toContain(
        "makes the viewer pause and wonder what is happening",
      );
    });

    it("does not rotate when a fallback provider succeeds inside one Pipeline call", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      vi.mocked(config.pipeline.generate).mockResolvedValueOnce(
        makeGenerateResult({ id: "openai_success", provider: "openai" }),
      );

      const scheduler = new HourlyScheduler(config);
      const result = await scheduler.runNow();

      expect(result.metadata.provider).toBe("openai");
      expect(config.pipeline.generate).toHaveBeenCalledOnce();
    });

    it.each([
      ["refusal-only", ["refusal", "refusal", "refusal"]],
      ["technical-only", ["provider_timeout", "rate_limited", "provider_error"]],
      ["mixed", ["refusal", "invalid_image", "quota"]],
    ] as const)("rotates after %s exhaustion", async (_label, outcomes) => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      vi.mocked(config.pipeline.generate)
        .mockRejectedValueOnce(exhausted(outcomes))
        .mockResolvedValueOnce(makeGenerateResult({ id: "alternate_success" }));

      const scheduler = new HourlyScheduler(config);
      await expect(scheduler.runNow()).resolves.toMatchObject({
        metadata: { id: "alternate_success" },
      });

      const calls = vi.mocked(config.pipeline.generate).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).not.toBe(calls[1][0]);
    });

    it.each([
      ["caller cancellation", terminated("caller_cancelled")],
      ["chain deadline", terminated("chain_deadline")],
      ["local chain failure", terminated("local_failure")],
      ["pipeline storage/input/config failure", new PipelineGenerationError("storage_failed")],
      ["generation busy", new GenerationLockBusyError()],
      ["unknown failure", new Error("unexpected scheduler failure")],
    ])("does not rotate after %s", async (_label, error) => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      vi.mocked(config.pipeline.generate).mockRejectedValue(error);

      const scheduler = new HourlyScheduler(config);

      await expect(scheduler.runNow()).rejects.toBe(error);
      expect(config.pipeline.generate).toHaveBeenCalledOnce();
    });

    it("tries every artwork exactly once and rethrows the last typed exhaustion", async () => {
      fs.writeFileSync(path.join(tmpDir, "art3.webp"), "fake-image-data");
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const failures = [exhausted(["refusal"]), exhausted(["quota"]), exhausted(["provider_error"])];
      vi.mocked(config.pipeline.generate)
        .mockRejectedValueOnce(failures[0])
        .mockRejectedValueOnce(failures[1])
        .mockRejectedValueOnce(failures[2]);

      const scheduler = new HourlyScheduler(config);

      await expect(scheduler.runNow()).rejects.toBe(failures[2]);
      expect(config.pipeline.generate).toHaveBeenCalledTimes(3);
      const attempted = vi.mocked(config.pipeline.generate).mock.calls
        .map(([imagePath]) => path.basename(imagePath as string));
      expect(attempted).toHaveLength(new Set(attempted).size);
      expect(attempted).toEqual(["art1.jpg", "art2.png", "art3.webp"]);
    });

    it("logs a safe warning when rotating after typed exhaustion", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn");
      const config = createSchedulerConfig({ imageDir: tmpDir });
      vi.mocked(config.pipeline.generate)
        .mockRejectedValueOnce(exhausted())
        .mockResolvedValueOnce(makeGenerateResult());

      const scheduler = new HourlyScheduler(config);
      await scheduler.runNow();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Provider chain exhausted"),
      );
    });

    it("passes the same composed Kiosk prompt and Scenario to every artwork chain", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      vi.mocked(config.pipeline.generate)
        .mockRejectedValueOnce(exhausted())
        .mockResolvedValueOnce(makeGenerateResult({ id: "override_fallback" }));

      const scheduler = new HourlyScheduler(config);

      const result = await scheduler.runNow("A stormy night scene");

      expect(config.pipeline.generate).toHaveBeenCalledTimes(2);
      expect(result.metadata.id).toBe("override_fallback");

      // Verify the override prompt was passed to the fallback image
      const calls = vi.mocked(config.pipeline.generate).mock.calls;
      const firstPrompt = calls[0][2] as string | undefined;
      const secondPrompt = calls[1][2] as string | undefined;
      expect(firstPrompt).toBe(composePromptFromText("A stormy night scene"));
      expect(secondPrompt).toBe(firstPrompt);
      expect(secondPrompt).toContain("makes the viewer pause and wonder what is happening");
      expect(calls[1][1]).toBe(calls[0][1]);

      // Verify different image was used
      const firstImage = calls[0][0] as string;
      const secondImage = calls[1][0] as string;
      expect(firstImage).not.toBe(secondImage);
    });

    it("starts consecutive invocations from today's selected artwork", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      vi.mocked(config.pipeline.generate)
        .mockRejectedValueOnce(exhausted())
        .mockResolvedValueOnce(makeGenerateResult({ id: "alternate_success" }))
        .mockResolvedValueOnce(makeGenerateResult({ id: "primary_success" }));

      const scheduler = new HourlyScheduler(config);
      await scheduler.runNow();
      await scheduler.runNow();

      const calls = vi.mocked(config.pipeline.generate).mock.calls;
      expect(calls).toHaveLength(3);
      expect(calls[0][0]).not.toBe(calls[1][0]);
      expect(calls[2][0]).toBe(calls[0][0]);
    });

    it("falls back to time-only scenario when weather fetch fails", async () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      vi.mocked(config.weatherProvider.getHourlyConditions)
        .mockRejectedValue(new Error("Network error"));

      const scheduler = new HourlyScheduler(config);

      // runNow triggers retries with exponential backoff (setTimeout).
      // With fake timers we must advance time to let the retries complete.
      const resultPromise = scheduler.runNow();
      await vi.advanceTimersByTimeAsync(10_000);

      const result = await resultPromise;
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

      // Advance to trigger the tick, including the boundary safety margin
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1001);

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

      await vi.advanceTimersByTimeAsync(2001);

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

      await vi.advanceTimersByTimeAsync(2001);

      expect(config.pipeline.generate).toHaveBeenCalledOnce();

      scheduler.stop();
    });
  });

  describe("isInActiveHours()", () => {
    it("returns true when hour is inside window", () => {
      // 14:00 in America/Los_Angeles (UTC-8 → 22:00 UTC)
      vi.setSystemTime(new Date("2026-02-15T22:00:00Z"));

      const config = createSchedulerConfig({
        imageDir: tmpDir,
        activeStart: 9,
        activeEnd: 21,
      });
      const scheduler = new HourlyScheduler(config);

      expect(scheduler.isInActiveHours()).toBe(true);
    });

    it("returns true at start boundary (inclusive)", () => {
      // 9:00 in America/Los_Angeles (UTC-8 → 17:00 UTC)
      vi.setSystemTime(new Date("2026-02-15T17:00:00Z"));

      const config = createSchedulerConfig({
        imageDir: tmpDir,
        activeStart: 9,
        activeEnd: 21,
      });
      const scheduler = new HourlyScheduler(config);

      expect(scheduler.isInActiveHours()).toBe(true);
    });

    it("returns false at end boundary (exclusive)", () => {
      // 21:00 in America/Los_Angeles (UTC-8 → 05:00 UTC next day)
      vi.setSystemTime(new Date("2026-02-16T05:00:00Z"));

      const config = createSchedulerConfig({
        imageDir: tmpDir,
        activeStart: 9,
        activeEnd: 21,
      });
      const scheduler = new HourlyScheduler(config);

      expect(scheduler.isInActiveHours()).toBe(false);
    });

    it("returns false when hour is before window", () => {
      // 6:00 in America/Los_Angeles (UTC-8 → 14:00 UTC)
      vi.setSystemTime(new Date("2026-02-15T14:00:00Z"));

      const config = createSchedulerConfig({
        imageDir: tmpDir,
        activeStart: 9,
        activeEnd: 21,
      });
      const scheduler = new HourlyScheduler(config);

      expect(scheduler.isInActiveHours()).toBe(false);
    });

    it("returns true when no active window configured", () => {
      vi.setSystemTime(new Date("2026-02-15T11:00:00Z")); // 3 AM PST

      const config = createSchedulerConfig({
        imageDir: tmpDir,
        activeStart: undefined,
        activeEnd: undefined,
      });
      const scheduler = new HourlyScheduler(config);

      expect(scheduler.isInActiveHours()).toBe(true);
    });
  });

  describe("isRenderForCurrentPeriod()", () => {
    it("rejects a recent render whose scenario belongs to the previous local hour", () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);
      const render = makeGenerateResult({
        scenario: {
          timestampLocal: "2026-08-03T16:59:59.965Z",
          hour: 9,
          isDay: true,
        },
      }).metadata;

      expect(
        scheduler.isRenderForCurrentPeriod(
          render,
          new Date("2026-08-03T17:05:00Z"),
        ),
      ).toBe(false);
    });

    it("accepts a render generated within the current configured local hour", () => {
      const config = createSchedulerConfig({ imageDir: tmpDir });
      const scheduler = new HourlyScheduler(config);
      const render = makeGenerateResult({
        scenario: {
          timestampLocal: "2026-08-03T17:00:01.000Z",
          hour: 10,
          isDay: true,
        },
      }).metadata;

      expect(
        scheduler.isRenderForCurrentPeriod(
          render,
          new Date("2026-08-03T17:05:00Z"),
        ),
      ).toBe(true);
    });
  });

  describe("isRecentRenderForCurrentPeriod()", () => {
    const now = new Date("2026-08-03T17:05:00Z");

    function currentPeriodRender(createdAt: string) {
      return makeGenerateResult({
        createdAt,
        scenario: {
          timestampLocal: "2026-08-03T17:00:01.000Z",
          hour: 10,
          isDay: true,
        },
      }).metadata;
    }

    it("does not deduplicate a render exactly at the age boundary", () => {
      const scheduler = new HourlyScheduler(createSchedulerConfig({ imageDir: tmpDir }));
      const render = currentPeriodRender("2026-08-03T16:35:00.000Z");

      expect(
        scheduler.isRecentRenderForCurrentPeriod(render, 30 * 60 * 1000, now),
      ).toBe(false);
    });

    it("conservatively deduplicates malformed creation timestamps", () => {
      const scheduler = new HourlyScheduler(createSchedulerConfig({ imageDir: tmpDir }));
      const render = currentPeriodRender("not-a-date");

      expect(
        scheduler.isRecentRenderForCurrentPeriod(render, 30 * 60 * 1000, now),
      ).toBe(true);
    });
  });
});
