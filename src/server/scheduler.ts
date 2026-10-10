// src/server/scheduler.ts — Hourly generation scheduler

import { readFile } from "node:fs/promises";
import { exportRecap } from "../story/recap-export.js";
import type { StoryStore } from "../story/story-store.js";
import type { ReadyStory } from "../story/types.js";
import { composeScenePrompt } from "../story/scene-prompt.js";
import type { Pipeline } from "../engine/pipeline.js";
import type { GenerateResult, RenderMetadata } from "../engine/types.js";
import type { WeatherProvider } from "../weather/types.js";
import { ProviderChainExhaustedError } from "../engine/provider-chain.js";
import { composePromptFromText } from "../engine/prompt.js";
import { describeScenario } from "../engine/scenario.js";
import { getDateString, getImageForToday, getAlternateImages } from "./image-rotation.js";
import { buildScheduledScenario } from "./scenario-builder.js";
import {
  getCurrentHourInTimezone,
  getLocalTimeInTimezone,
} from "./timezone.js";

/** Read the new hour after the wall-clock boundary has safely passed. */
const HOUR_BOUNDARY_SAFETY_MS = 1000;

export interface SchedulerConfig {
  pipeline: Pipeline;
  weatherProvider: WeatherProvider;
  imageDir: string;
  location: { lat: number; lon: number; timezone: string };
  /** Hour (0–23) when scheduled generation starts (inclusive). */
  activeStart?: number;
  /** Hour (0–23) when scheduled generation stops (exclusive). */
  activeEnd?: number;
  /** Presence enables opt-in scheduled daily stories. Overrides remain independent. */
  storyStore?: StoryStore;
  trailerDir?: string;
}

export class StoryUnavailableError extends Error {
  constructor() { super("Today's story or required references are unavailable"); this.name = "StoryUnavailableError"; }
}

export type ConditionalRunResult =
  | { generated: true; result: GenerateResult }
  | { generated: false; latest: RenderMetadata };

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
    if (config.storyStore) {
      config.pipeline.getStore().setCommitObserver(output => config.storyStore!.recordCommittedProgress(output));
    }
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

  /** Whether stored metadata belongs to the current local hourly period. */
  isRenderForCurrentPeriod(
    metadata: RenderMetadata,
    now: Date = new Date(),
  ): boolean {
    const renderedAt = new Date(metadata.scenario.timestampLocal);
    if (!Number.isFinite(renderedAt.getTime())) return false;

    const current = getLocalTimeInTimezone(now, this.config.location.timezone);
    const rendered = getLocalTimeInTimezone(
      renderedAt,
      this.config.location.timezone,
    );

    return rendered.year === current.year
      && rendered.month === current.month
      && rendered.day === current.day
      && rendered.hour === current.hour
      && metadata.scenario.hour === current.hour;
  }

  /** Whether metadata is both recent enough and from the current local hour. */
  isRecentRenderForCurrentPeriod(
    metadata: RenderMetadata,
    dedupWindowMs: number,
    now: Date = new Date(),
  ): boolean {
    const ageMs = now.getTime() - new Date(metadata.createdAt).getTime();
    const isRecent = !Number.isFinite(ageMs) || ageMs < dedupWindowMs;
    return isRecent && this.isRenderForCurrentPeriod(metadata, now);
  }

  /** Both trigger precheck and mutex check use exactly the same story-slot ownership. */
  async findRecentRender(dedupWindowMs: number, now: Date = new Date()): Promise<RenderMetadata | null> {
    const outputs = this.config.pipeline.getStore();
    if (!this.config.storyStore) {
      const latest = await outputs.getLatest();
      return latest && this.isRecentRenderForCurrentPeriod(latest, dedupWindowMs, now) ? latest : null;
    }
    const ready = await this.loadCurrentStory(now);
    return this.findStorySlotRender(ready, now);
  }

  private async findStorySlotRender(ready: ReadyStory, now: Date): Promise<RenderMetadata | null> {
    const outputs = this.config.pipeline.getStore();
    const hour = getCurrentHourInTimezone(this.config.location.timezone, now);
    const candidates = outputs.listCommittedMetadata().filter(meta => {
      const p = meta.story;
      return p?.id === ready.story.id && p.date === ready.story.date
        && p.artworkHash === ready.story.artworkHash && p.originalHash === ready.story.artworkHash
        && p.sceneHour === hour && this.isRenderForCurrentPeriod(meta, now);
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const candidate of candidates) {
      const resolved = await outputs.resolve(candidate.id);
      if (resolved) return resolved.metadata;
    }
    return null;
  }

  private async loadCurrentStory(now: Date = new Date()): Promise<ReadyStory> {
    const local = getLocalTimeInTimezone(now, this.config.location.timezone);
    const date = getDateString(now, this.config.location.timezone);
    const start = this.config.activeStart ?? 0;
    const end = this.config.activeEnd ?? 24;
    const hours = Array.from({ length: end - start }, (_, i) => start + i);
    const ready = await this.config.storyStore!.load(date, hours);
    if (!ready || ready.story.timezone !== this.config.location.timezone || !ready.story.scenes.some(scene => scene.hour === local.hour)) {
      throw new StoryUnavailableError();
    }
    return ready;
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
    return this.runWithMutex(() => this.tick(scenarioOverride));
  }

  /**
   * Trigger a backup generation only when the current hourly period still
   * lacks a recent render. The check runs after acquiring the same mutex as
   * scheduled generations, closing the race where a queued backup trigger
   * inspected the store before the in-process render finished.
   */
  async runNowIfNoRecentRender(
    dedupWindowMs: number,
  ): Promise<ConditionalRunResult> {
    return this.runWithMutex(async () => {
      const latest = await this.findRecentRender(dedupWindowMs);
      if (latest) {
        return { generated: false, latest };
      }

      return { generated: true, result: await this.tick() };
    });
  }

  /** Serialize scheduled, manual, and backup-trigger generations. */
  private async runWithMutex<T>(operation: () => Promise<T>): Promise<T> {
    // Promise-chain mutex: each call waits for the previous to finish,
    // guaranteeing serial execution without race conditions.
    let release: () => void;
    const prev = this.mutex;
    this.mutex = new Promise((resolve) => {
      release = resolve;
    });
    await prev;

    try {
      return await operation();
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
    const ms = next.getTime() - now.getTime() + HOUR_BOUNDARY_SAFETY_MS;

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

    try {
      const result = await this.runWithMutex(() => this.tick());
      console.log(
        `[${new Date().toISOString()}] Scheduled generation complete: ${result.metadata.id}`,
      );
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] Scheduled generation failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.scheduleNext();
    }
  }

  /**
   * Run a single generation tick.
   *
   * Each Pipeline call owns the complete configured provider chain for one
   * artwork. Only typed, complete chain exhaustion advances to an alternate;
   * cancellation, deadlines, local failures, and busy results stop the run.
   */
  private async tick(scenarioOverride?: string): Promise<GenerateResult> {
    const { pipeline, weatherProvider, imageDir, location } = this.config;

    if (this.config.storyStore && scenarioOverride === undefined) {
      const startedAt = new Date();
      const ready = await this.loadCurrentStory(startedAt);
      const hour = getCurrentHourInTimezone(location.timezone, startedAt);
      const scene = ready.story.scenes.find(slot => slot.hour === hour)!;
      const latest = await this.findStorySlotRender(ready, startedAt);
      if (latest) {
        const output = await pipeline.getStore().resolve(latest.id);
        if (!output) throw new StoryUnavailableError();
        return { metadata: latest, imagePath: output.imagePath, imageBuffer: await readFile(output.imagePath) };
      }
      let references;
      try { references = await this.config.storyStore.getReferences(ready.story, hour, pipeline.getStore()); }
      catch { throw new StoryUnavailableError(); }
      const scenario = await buildScheduledScenario(location.lat, location.lon, location.timezone, weatherProvider, startedAt);
      const result = await pipeline.generate(references.original.path, scenario,
        composeScenePrompt(ready.story, scene, scenario, Boolean(references.previous)), {
          referenceImagePaths: references.previous ? [references.previous.path] : [],
          story: {
            id: ready.story.id, date: ready.story.date, artworkHash: ready.story.artworkHash,
            sceneHour: hour, originalHash: references.original.sha256,
            ...(references.previous ? { previousRenderId: references.previous.renderId, previousHash: references.previous.sha256 } : {}),
          },
        });
      const committed = await pipeline.getStore().resolve(result.metadata.id);
      if (!committed) throw new Error('Successful story render is not committed');
      await this.config.storyStore.commitContinuity(ready.story, committed);
      if (this.config.trailerDir) {
        try { await exportRecap(this.config.storyStore, ready.story.date, this.config.trailerDir, pipeline.getStore()); }
        catch { console.warn(`[${new Date().toISOString()}] Daily recap export failed; use story:prepare -- --export to retry`); }
      }
      return result;
    }

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

    // This list is invocation-local. Every later invocation starts again from
    // today's selected artwork, regardless of what happened to alternates here.
    const imagesToTry = [
      imagePath,
      ...getAlternateImages(imageDir, [imagePath]),
    ];
    let lastExhaustion: ProviderChainExhaustedError | undefined;

    for (const img of imagesToTry) {
      try {
        console.log(
          `[${new Date().toISOString()}] Generating: ${describeScenario(scenario)} | image: ${img}`,
        );

        return await pipeline.generate(img, scenario, prompt);
      } catch (err) {
        if (!(err instanceof ProviderChainExhaustedError)) {
          throw err;
        }

        lastExhaustion = err;
        console.warn(
          `[${new Date().toISOString()}] Provider chain exhausted for artwork: ${img} — trying next artwork`,
        );
      }
    }

    // Every artwork received one full provider chain. Preserve the last typed,
    // sanitized aggregate so callers can handle exhaustion without parsing text.
    throw lastExhaustion ?? new Error("No images available for generation");
  }
}
