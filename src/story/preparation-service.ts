import { getDateString } from "../server/image-rotation.js";
import { getLocalTimeInTimezone } from "../server/timezone.js";
import type { DailyStoryPreparer } from "./prepare-story.js";
import type { StoryStore } from "./story-store.js";
import type { ReadyStory } from "./types.js";
import { exportTrailer } from "./trailer-export.js";

export interface StoryPreparationServiceConfig {
  store: StoryStore;
  preparer: Pick<DailyStoryPreparer, "prepare">;
  timezone: string;
  prepareTime: string;
  activeStart?: number;
  activeEnd?: number;
  trailerDir?: string;
  onReady?: () => Promise<void>;
}

/** Resident morning preparation, independent of the hourly image window. */
export class StoryPreparationService {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private inspectedDate: string | undefined;
  private pending: Promise<ReadyStory | null> | undefined;

  constructor(private readonly config: StoryPreparationServiceConfig) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }
  stop(): void {
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  checkNow(now: Date = new Date()): Promise<ReadyStory | null> {
    if (this.pending) return this.pending;
    const local = getLocalTimeInTimezone(now, this.config.timezone);
    const date = getDateString(now, this.config.timezone);
    const [hour, minute] = this.config.prepareTime.split(":").map(Number);
    if (date === this.inspectedDate
      || local.hour * 60 + local.minute < hour * 60 + minute
      || local.hour >= (this.config.activeEnd ?? 24)) return Promise.resolve(null);
    this.pending = this.prepareAndPublish(now, date).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async prepareAndPublish(now: Date, date: string): Promise<ReadyStory | null> {
    const ready = await this.config.preparer.prepare({now});
    // Lock contention is pending, not a failed attempt: inspect again for the owner's commit.
    if (ready || this.config.store.loadFailure(date)) this.inspectedDate = date;
    if (!ready) {
      console.warn(`[${new Date().toISOString()}] Daily story pending or unavailable for ${date}; persisted failures require explicit retry`);
      return null;
    }
    console.log(`[${new Date().toISOString()}] Daily story ready: ${ready.story.id}`);
    if (this.config.trailerDir) {
      try { await exportTrailer(this.config.store, date, this.config.trailerDir); }
      catch { console.warn(`[${new Date().toISOString()}] Daily trailer export failed; use story:prepare -- --export to retry`); }
    }
    // A preparation crossing the day/end boundary must not trigger today's missed slot.
    const current = getLocalTimeInTimezone(new Date(), this.config.timezone);
    if (getDateString(new Date(), this.config.timezone) === date
      && current.hour >= (this.config.activeStart ?? 0)
      && current.hour < (this.config.activeEnd ?? 24)) await this.config.onReady?.();
    return ready;
  }

  private async tick(): Promise<void> {
    try { await this.checkNow(); }
    catch { console.error(`[${new Date().toISOString()}] Daily story preparation unavailable`); }
    if (!this.running) return;
    const now = Date.now();
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick(); }, 60_000 - now % 60_000 + 1000);
  }
}
