// src/server/scheduler.ts — Hourly generation scheduler

import type { Pipeline } from "../engine/pipeline.js";
import type { GenerateResult } from "../engine/types.js";
import type { WeatherProvider } from "../weather/types.js";
import { composePromptFromText } from "../engine/prompt.js";
import { describeScenario } from "../engine/scenario.js";
import { getImageForToday } from "./image-rotation.js";
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
    const { activeStart, activeEnd, location } = this.config;
    if (activeStart != null && activeEnd != null) {
      const hour = getCurrentHourInTimezone(location.timezone);
      if (hour < activeStart || hour >= activeEnd) {
        console.log(
          `[${new Date().toISOString()}] Skipping generation: hour ${hour} outside active window ${activeStart}–${activeEnd}`,
        );
        this.scheduleNext();
        return;
      }
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

    if (scenarioOverride) {
      // Override mode: use the provided text as the scenario description.
      // Build a minimal scenario with current time, then override the prompt.
      const scenario = await buildScheduledScenario(
        location.lat,
        location.lon,
        location.timezone,
        weatherProvider,
      );
      const prompt = composePromptFromText(scenarioOverride);
      return pipeline.generate(imagePath, scenario, prompt);
    }

    // Normal mode: build scenario from real weather + time + sun/moon
    const scenario = await buildScheduledScenario(
      location.lat,
      location.lon,
      location.timezone,
      weatherProvider,
    );

    console.log(
      `[${new Date().toISOString()}] Generating: ${describeScenario(scenario)} | image: ${imagePath}`,
    );

    return pipeline.generate(imagePath, scenario);
  }
}
