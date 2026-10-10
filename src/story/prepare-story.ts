import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GenerationLock, isGenerationLockBusyError } from '../engine/generation-lock.js';
import { getImageForToday } from '../server/image-rotation.js';
import { getLocalTimeInTimezone } from '../server/timezone.js';
import { OpenMeteoProvider } from '../weather/open-meteo.js';
import type { HourlyConditions, WeatherProvider } from '../weather/types.js';
import type { StoryWriter } from './codex-writer.js';
import { buildWriterPrompt } from './writer-prompt.js';
import { STORY_JSON_SCHEMA, validateStory } from './schema.js';
import { StoryStore } from './story-store.js';
import type { ReadyStory } from './types.js';

export interface DailyStoryPreparerConfig {
  store: StoryStore;
  stateDir: string;
  writer: StoryWriter;
  imageDir: string;
  location: { lat: number; lon: number; timezone: string };
  weather?: WeatherProvider;
  activeStart?: number;
  activeEnd?: number;
}
const pending = new Map<string, Promise<ReadyStory | null>>();

function activeHours(start?: number, end?: number): number[] {
  if (start === undefined || end === undefined) return Array.from({ length: 24 }, (_, hour) => hour);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 23 || start >= end) throw new Error('Invalid story active hours');
  return Array.from({ length: end - start }, (_, index) => start + index);
}
function validatedForecast(hourly: HourlyConditions[], date: string): HourlyConditions[] {
  const byHour = new Map<number, HourlyConditions>();
  const numeric = ['weatherCode', 'cloudPercent', 'precipProbability', 'temperature', 'humidity', 'windSpeed', 'windGusts', 'visibility', 'precipitation', 'rain', 'snowfall', 'snowDepth', 'directRadiation', 'diffuseRadiation'] as const;
  for (const slot of hourly) {
    const match = typeof slot?.time === 'string' ? slot.time.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):00(?::00)?$/) : null;
    if (!match || match[1] !== date || Number(match[2]) > 23 || typeof slot.isDay !== 'boolean' || numeric.some(key => typeof slot[key] !== 'number' || !Number.isFinite(slot[key]))) throw new Error('Invalid daily forecast');
    const hour = Number(match[2]);
    if (byHour.has(hour)) throw new Error('Duplicate forecast hour');
    // Copy only the weather contract, never arbitrary provider fields into the writer prompt.
    byHour.set(hour, { time: slot.time, isDay: slot.isDay, ...Object.fromEntries(numeric.map(key => [key, slot[key]])) } as HourlyConditions);
  }
  if (byHour.size !== 24) throw new Error('Incomplete daily forecast');
  return Array.from({ length: 24 }, (_, hour) => byHour.get(hour)!);
}

/** Owns a single daily writer attempt; ready state and frozen bytes survive restart. */
export class DailyStoryPreparer {
  readonly hours: readonly number[];
  private readonly weather: WeatherProvider;
  constructor(private readonly config: DailyStoryPreparerConfig) {
    this.hours = activeHours(config.activeStart, config.activeEnd);
    this.weather = config.weather ?? new OpenMeteoProvider();
  }

  prepare(options: { retryFailed?: boolean; now?: Date } = {}): Promise<ReadyStory | null> {
    const now = options.now ?? new Date();
    const local = getLocalTimeInTimezone(now, this.config.location.timezone);
    const date = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
    const key = path.join(path.resolve(this.config.stateDir), `.story-preparation-${date}.lock`);
    const existing = pending.get(key);
    if (existing) return existing;
    const attempt = this.prepareOwned(date, now, key, options.retryFailed === true).finally(() => { if (pending.get(key) === attempt) pending.delete(key); });
    pending.set(key, attempt);
    return attempt;
  }

  private async prepareOwned(date: string, now: Date, lockPath: string, retryFailed: boolean): Promise<ReadyStory | null> {
    const { store, location, writer } = this.config;
    const ready = await store.load(date, this.hours);
    if (ready) return ready;
    const lock = new GenerationLock({ lockPath });
    let lease;
    try { lease = await lock.acquire({ kind: 'scheduler' }); }
    catch (error) { if (isGenerationLockBusyError(error)) return store.load(date, this.hours); throw error; }
    try {
      const committed = await store.load(date, this.hours);
      if (committed) return committed;
      if (store.loadFailure(date) && !retryFailed) return null;
      // Journal before any awaited preparation or writer work: restart never silently retries an interrupted attempt.
      store.recordFailure(date, 'preparation_interrupted');
      try {
        let original = await store.loadOriginal(date);
        if (!original) {
          const selected = getImageForToday(this.config.imageDir, location.timezone, now);
          if (!selected) throw new Error('No daily artwork');
          original = await store.snapshotOriginal(date, fs.readFileSync(selected));
        }
        const forecast = await this.weather.getForecast(location.lat, location.lon, location.timezone);
        const hourly = validatedForecast(forecast.hourly, date);
        const identity = { id: randomUUID(), date, timezone: location.timezone, artworkHash: original.sha256, createdAt: now.toISOString() };
        const recentStories = await store.recentSummaries(14);
        const proposal = await writer.write({ imagePath: original.path, schema: STORY_JSON_SCHEMA, prompt: buildWriterPrompt({ identity, hours: this.hours, forecast: hourly, recentStories }) });
        const story = validateStory(proposal, { ...identity, hours: this.hours });
        const result = await store.commit(story, this.hours);
        store.clearFailure(date);
        return result;
      } catch {
        // A competing committed artifact is authoritative, and failure text must not leak child credentials or paths.
        const committedAfterFailure = await store.load(date, this.hours);
        if (committedAfterFailure) { store.clearFailure(date); return committedAfterFailure; }
        store.recordFailure(date, 'preparation_failed');
        return null;
      }
    } finally { await lease.release(); }
  }
}
