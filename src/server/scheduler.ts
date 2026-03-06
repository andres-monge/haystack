// src/server/scheduler.ts — Hourly generation scheduler

import type { Pipeline } from "../engine/pipeline.js";
import type { GenerateResult } from "../engine/types.js";
import type { WeatherProvider } from "../weather/types.js";
import { composePromptFromText } from "../engine/prompt.js";
import { describeScenario } from "../engine/scenario.js";
import { getImageForToday, getAlternateImages } from "./image-rotation.js";
import { buildScheduledScenario } from "./scenario-builder.js";
import { getCurrentHourInTimezone } from "./timezone.js";

export interface SchedulerConfig {
  pipeline: Pipeline;
  weatherProvider: WeatherProvider;
  imageDir: string;
  location: { lat: number; lon: number; timezone: string };
  /** Hour (0–23) when scheduled generation starts (inclusive). */
  activeStart?: number;
  /** Hour (0–23) when scheduled generation stops (exclusive). */
  activeEnd?: number;
}

/**
 * In-process hourly scheduler that generates images at the top of each hour.
 *
 * Uses self-rescheduling setTimeout: after each tick, computes ms until the
 * next top-of-hour and sets a new timeout. This naturally handles macOS
 * sleep/wake, DST transitions, and variable generation durations without
 * drift — the next tick is always recalculated from the current time.
 */
export class HourlyScheduler {
  private config: SchedulerConfig;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private mutex: Promise<void> = Promise.resolve();
  private running = false;

  constructor(config: SchedulerConfig) {
    this.config = config;
  }

  /** Whether the scheduler is actively running (has a pending timer). */
  isRunning(): boolean {
    return this.running;
  }

  /** Check whether the current hour falls within the configured active window. */
  isInActiveHours(): boolean {
    const { activeStart, activeEnd, location } = this.config;
    if (activeStart == null || activeEnd == null) return true; // no window = always active
    const hour = getCurrentHourInTimezone(location.timezone);
    return hour >= activeStart && hour < activeEnd;
  }

  /**
   * Start scheduling. Schedules the first tick at the next top-of-hour.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  /**
   * Stop the scheduler and clear any pending timeout.
   */
  stop(): void {
    this.running = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Trigger an immediate generation. Used by the override endpoint.
   * If a generation is already in progress, waits for it to finish
   * before starting.
   *
   * @param scenarioOverride Optional scenario description text to use
   *   instead of fetching weather. When provided, the description is
   *   passed directly as the prompt scenario slot.
   */
  async runNow(scenarioOverride?: string): Promise<GenerateResult> {
    // Promise-chain mutex: each call waits for the previous to finish,
    // guaranteeing serial execution without race conditions.
    let release: () => void;
    const prev = this.mutex;
    this.mutex = new Promise((resolve) => {
      release = resolve;
    });
    await prev;

    try {
      return await this.tick(scenarioOverride);
    } finally {
      release!();
    }
  }

  /**
   * Compute milliseconds until the next top-of-hour and schedule.
   */
  private scheduleNext(): void {
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    const ms = next.getTime() - now.getTime();

    this.timerId = setTimeout(() => this.onTick(), ms);
  }

  /**
   * Called when the timer fires. Runs generation, then reschedules.
   * Skips generation if the current hour is outside the active window.
   */
  private async onTick(): Promise<void> {
    this.timerId = null;

    // Check active hours before acquiring the mutex
    if (!this.isInActiveHours()) {
      const { activeStart, activeEnd, location } = this.config;
      const hour = getCurrentHourInTimezone(location.timezone);
      console.log(
        `[${new Date().toISOString()}] Skipping generation: hour ${hour} outside active window ${activeStart}–${activeEnd}`,
      );
      this.scheduleNext();
      return;
    }

    let release: () => void;
    const prev = this.mutex;
    this.mutex = new Promise((resolve) => {
      release = resolve;
    });
    await prev;

    try {
      const result = await this.tick();
      console.log(
        `[${new Date().toISOString()}] Scheduled generation complete: ${result.metadata.id}`,
      );
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] Scheduled generation failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      release!();
      this.scheduleNext();
    }
  }

  /**
   * Run a single generation tick.
   *
   * When the primary image is rejected by Gemini (IMAGE_OTHER — typically
   * copyrighted artwork), automatically tries alternate images from the
   * rotation queue before giving up.
   */
  private async tick(scenarioOverride?: string): Promise<GenerateResult> {
    const { pipeline, weatherProvider, imageDir, location } = this.config;

    // Get today's base image (timezone-aware day boundary)
    const imagePath = getImageForToday(imageDir, location.timezone);
    if (!imagePath) {
      throw new Error(
        `No images found in "${imageDir}" — cannot generate`,
      );
    }

    // Build scenario once — reused across fallback attempts
    const scenario = await buildScheduledScenario(
      location.lat,
      location.lon,
      location.timezone,
      weatherProvider,
    );

    // Pre-compute prompt once for override mode (invariant across fallback attempts)
    const prompt = scenarioOverride
      ? composePromptFromText(scenarioOverride)
      : undefined;

    // Try the primary image first, then fall back to alternates on IMAGE_OTHER
    const imagesToTry = [imagePath];
    let lastError: Error | undefined;

    for (let i = 0; i < imagesToTry.length; i++) {
      const img = imagesToTry[i];
      try {
        console.log(
          `[${new Date().toISOString()}] Generating: ${describeScenario(scenario)} | image: ${img}`,
        );

        return await pipeline.generate(img, scenario, prompt);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (!isImageRejection(lastError)) {
          // Non-rejection error (timeout, network, etc.) — don't try other images
          throw lastError;
        }

        // IMAGE_OTHER: this artwork was rejected — try alternates
        console.warn(
          `[${new Date().toISOString()}] Image rejected by Gemini: ${img} — trying fallback`,
        );

        // Lazily populate alternates only on first rejection
        if (imagesToTry.length === 1) {
          const alternates = getAlternateImages(imageDir, [img]);
          imagesToTry.push(...alternates);
        }
      }
    }

    // All images exhausted
    throw lastError ?? new Error("No images available for generation");
  }
}

/**
 * Detect whether a pipeline error is an image rejection (IMAGE_OTHER)
 * as opposed to a transient failure (timeout, network error, etc.).
 * Only rejection errors should trigger fallback to an alternate image.
 */
function isImageRejection(err: Error): boolean {
  return err.message.includes("IMAGE_OTHER");
}
