import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateImage } from '../engine/image-validation.js';
import type { OutputStore, ResolvedOutput } from '../storage/output-store.js';
import { assertStoryDate, validateStory } from './schema.js';
import type { ContinuitySnapshot, DailyStory, ImageSnapshot, ReadyStory, StoryFailure, StoryReferences, StoryRenderProvenance } from './types.js';

interface ContinuityRecord extends ContinuitySnapshot { storyId: string; date: string; artworkHash: string }
const extension = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' } as const;

/** Daily story storage is separate from OutputStore retention. JSON promotion is the commit point. */
export class StoryStore {
  private readonly baseDir: string;
  constructor(baseDir: string) { this.baseDir = path.resolve(baseDir); fs.mkdirSync(this.baseDir, { recursive: true }); }

  async snapshotOriginal(date: string, bytes: Buffer): Promise<ImageSnapshot> {
    const inspected = await validateImage(Buffer.from(bytes));
    const existing = this.readJson(this.file(date, 'original.json')) as ImageSnapshot | null;
    if (existing) {
      await this.verifySnapshot(date, existing);
      if (existing.sha256 !== inspected.sha256) throw new Error('Original artwork already frozen for this date');
      return existing;
    }
    const snapshot = await this.snapshot(date, inspected.bytes);
    this.atomicJson(this.file(date, 'original.json'), snapshot);
    return snapshot;
  }

  async loadOriginal(date: string): Promise<ImageSnapshot | null> {
    const value = this.readJson(this.file(date, 'original.json')) as ImageSnapshot | null;
    if (!value) return null;
    await this.verifySnapshot(date, value);
    return value;
  }

  async commit(input: DailyStory, hours: readonly number[]): Promise<ReadyStory> {
    const story = validateStory(input, { date: input.date, artworkHash: input.artworkHash, hours });
    const original = await this.loadOriginal(story.date);
    if (!original || original.sha256 !== story.artworkHash) throw new Error('Story original snapshot mismatch');
    const existing = await this.load(story.date, hours);
    if (existing) return existing; // A ready artifact wins over stale or competing preparation.
    this.atomicJson(this.file(story.date, 'story.json'), story);
    return { story, original };
  }

  async load(date: string, hours?: readonly number[]): Promise<ReadyStory | null> {
    try {
      const raw = this.readJson(this.file(date, 'story.json'));
      if (!raw) return null;
      const original = await this.loadOriginal(date);
      if (!original) return null;
      const stored = raw as DailyStory;
      const story = validateStory(raw, { date, artworkHash: original.sha256, hours: hours ?? stored.scenes.map(scene => scene.hour) });
      return { story, original };
    } catch { return null; }
  }

  recordFailure(date: string, error: string): StoryFailure {
    const failure = { date, error, failedAt: new Date().toISOString() };
    this.atomicJson(this.file(date, 'failure.json'), failure);
    return failure;
  }
  loadFailure(date: string): StoryFailure | null {
    const raw = this.readJson(this.file(date, 'failure.json')) as StoryFailure | null;
    return raw && raw.date === date && typeof raw.error === 'string' && typeof raw.failedAt === 'string' ? raw : null;
  }
  clearFailure(date: string): void { fs.rmSync(this.file(date, 'failure.json'), { force: true }); }

  async recentSummaries(limit = 14): Promise<{ date: string; title: string; premise: string; ending: string }[]> {
    const summaries = [];
    for (const date of fs.readdirSync(this.baseDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse()) {
      if (summaries.length >= limit) break;
      const ready = await this.load(date);
      if (ready) summaries.push({ date, title: ready.story.title, premise: ready.story.premise, ending: ready.story.ending });
    }
    return summaries;
  }

  async commitContinuity(story: DailyStory, output: ResolvedOutput): Promise<ContinuitySnapshot> {
    const provenance = this.provenance(output, story);
    if (!provenance) throw new Error('Render does not belong to this story');
    // Revalidate bytes from the resolved commit before owning a durable independent copy.
    const snapshot = await this.snapshot(story.date, fs.readFileSync(output.imagePath));
    if (snapshot.sha256 !== output.sha256) throw new Error('Committed render changed before snapshot');
    const current = this.readContinuity(story);
    if (current && current.sceneHour > provenance.sceneHour) {
      await this.verifySnapshot(story.date, current);
      return current;
    }
    const next: ContinuityRecord = { ...snapshot, renderId: output.metadata.id, sceneHour: provenance.sceneHour, storyId: story.id, date: story.date, artworkHash: story.artworkHash };
    this.atomicJson(this.file(story.date, 'continuity.json'), next);
    if (current && current.sha256 !== story.artworkHash && current.path !== next.path && current.mimeType in extension && current.path === this.file(story.date, `${current.sha256}${extension[current.mimeType]}`)) {
      try { fs.rmSync(current.path, { force: true }); } catch { /* The new pointer is already committed. */ }
    }
    return next;
  }

  async getReferences(story: DailyStory, hour: number, outputs?: OutputStore): Promise<StoryReferences> {
    const original = await this.loadOriginal(story.date);
    if (!original || original.sha256 !== story.artworkHash) throw new Error('Required story original unavailable');
    let previous = this.readContinuity(story);
    if (outputs) {
      // OutputStore resolves the committed sidecar and validates its bytes. Uncommitted files never enter this list.
      const candidates = outputs.listCommittedMetadata().filter(metadata => {
        const p = (metadata as { story?: StoryRenderProvenance }).story;
        return p && this.matches(p, story) && p.sceneHour < hour;
      }).sort((a, b) => {
        const ah = (a as { story: StoryRenderProvenance }).story.sceneHour;
        const bh = (b as { story: StoryRenderProvenance }).story.sceneHour;
        return bh - ah || b.createdAt.localeCompare(a.createdAt);
      });
      for (const candidate of candidates) {
        const resolved = await outputs.resolve(candidate.id);
        if (!resolved) {
          if (previous?.renderId === candidate.id && previous.sha256 === candidate.sha256) break;
          throw new Error('Required committed continuity image unavailable');
        }
        if (!this.provenance(resolved, story)) continue;
        if (previous && previous.sceneHour >= hour) {
          const snapshot = await this.snapshot(story.date, fs.readFileSync(resolved.imagePath));
          if (snapshot.sha256 !== resolved.sha256) throw new Error('Committed render changed before snapshot');
          return { original, previous: { ...snapshot, renderId: resolved.metadata.id, sceneHour: (candidate as { story: StoryRenderProvenance }).story.sceneHour } };
        }
        if (!previous || previous.sceneHour < (candidate as { story: StoryRenderProvenance }).story.sceneHour) {
          previous = { ...await this.commitContinuity(story, resolved), storyId: story.id, date: story.date, artworkHash: story.artworkHash };
        }
        break;
      }
    }
    if (previous && previous.sceneHour < hour) {
      await this.verifySnapshot(story.date, previous);
      return { original, previous };
    }
    return { original };
  }

  private matches(p: StoryRenderProvenance, story: DailyStory): boolean {
    return p.id === story.id && p.date === story.date && p.artworkHash === story.artworkHash && p.originalHash === story.artworkHash && Number.isInteger(p.sceneHour) && story.scenes.some(s => s.hour === p.sceneHour);
  }
  private provenance(output: ResolvedOutput, story: DailyStory): StoryRenderProvenance | null {
    const p = (output.metadata as { story?: StoryRenderProvenance }).story;
    return p && this.matches(p, story) && output.metadata.scenario.hour === p.sceneHour ? p : null;
  }
  private readContinuity(story: DailyStory): ContinuityRecord | null {
    const raw = this.readJson(this.file(story.date, 'continuity.json')) as ContinuityRecord | null;
    if (!raw) return null;
    if (raw.storyId !== story.id || raw.date !== story.date || raw.artworkHash !== story.artworkHash || !story.scenes.some(s => s.hour === raw.sceneHour) || typeof raw.renderId !== 'string') throw new Error('Invalid required continuity identity');
    return raw;
  }
  private async snapshot(date: string, bytes: Buffer): Promise<ImageSnapshot> {
    const inspected = await validateImage(bytes);
    const target = this.file(date, `${inspected.sha256}${extension[inspected.mimeType]}`);
    if (!fs.existsSync(target)) this.atomicFile(target, inspected.bytes);
    const snapshot = { path: target, sha256: inspected.sha256, mimeType: inspected.mimeType };
    await this.verifySnapshot(date, snapshot);
    return snapshot;
  }
  private async verifySnapshot(date: string, snapshot: ImageSnapshot): Promise<void> {
    if (!snapshot || typeof snapshot.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(snapshot.sha256) || !(snapshot.mimeType in extension) || snapshot.path !== this.file(date, `${snapshot.sha256}${extension[snapshot.mimeType]}`) || !fs.lstatSync(snapshot.path).isFile()) throw new Error('Required story snapshot unavailable');
    const validated = await validateImage(fs.readFileSync(snapshot.path));
    if (validated.sha256 !== snapshot.sha256 || validated.mimeType !== snapshot.mimeType) throw new Error('Required story snapshot corrupt');
  }
  private file(date: string, name: string): string {
    assertStoryDate(date);
    const dir = path.join(this.baseDir, date); fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, name);
  }
  private readJson(file: string): unknown { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
  private atomicJson(file: string, value: unknown): void { this.atomicFile(file, Buffer.from(JSON.stringify(value, null, 2))); }
  private atomicFile(file: string, bytes: Buffer): void {
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
    try { fs.writeFileSync(temporary, bytes, { flag: 'wx' }); fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
  }
}
