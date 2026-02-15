// src/server/scheduler.ts — Hourly generation scheduler

import type { Pipeline } from "../engine/pipeline.js";
import type { GenerateResult } from "../engine/types.js";
import type { WeatherProvider } from "../weather/types.js";
import { describeScenario } from "../engine/scenario.js";
import { getImageForToday } from "./image-rotation.js";
import { buildScheduledScenario } from "./scenario-builder.js";

export interface SchedulerConfig {
  pipeline: Pipeline;
  weatherProvider: WeatherProvider;
  imageDir: string;
  location: { lat: number; lon: number; timezone: string };
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
  private generating = false; // mutex to serialize generation calls

  constructor(config: SchedulerConfig) {
    this.config = config;
  }

  /**
   * Start scheduling. Schedules the first tick at the next top-of-hour.
   */
  start(): void {
    this.scheduleNext();
  }

  /**
   * Stop the scheduler and clear any pending timeout.
   */
  stop(): void {
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
    // Simple mutex: wait if a generation is already running
    while (this.generating) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    this.generating = true;
    try {
      return await this.tick(scenarioOverride);
    } finally {
      this.generating = false;
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
   */
  private async onTick(): Promise<void> {
    this.timerId = null;

    if (this.generating) {
      // Another generation (e.g., override) is in progress — skip this tick
      this.scheduleNext();
      return;
    }

    this.generating = true;
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
      this.generating = false;
      this.scheduleNext();
    }
  }

  /**
   * Run a single generation tick.
   */
  private async tick(scenarioOverride?: string): Promise<GenerateResult> {
    const { pipeline, weatherProvider, imageDir, location } = this.config;

    // Get today's base image
    const imagePath = getImageForToday(imageDir);
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
      const prompt = `Transform this artwork to reflect: ${scenarioOverride}`;
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
