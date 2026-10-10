import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StoryStore } from '../../src/story/story-store.js';
import { OutputStore } from '../../src/storage/output-store.js';
import { hours, image, story } from './fixtures.js';
import type { RenderMetadata } from '../../src/engine/types.js';
const dirs: string[] = [];
function dir() { const d = mkdtempSync(join(tmpdir(), 'story-')); dirs.push(d); return d; }
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
async function ready() { const d = dir(); const store = new StoryStore(join(d, 'stories')); const original = await store.snapshotOriginal('2026-10-10', await image()); const s = story(original.sha256); await store.commit(s, hours); return { d, store, s, original }; }
function metadata(s: ReturnType<typeof story>, id: string, hour: number): RenderMetadata {
  return { id, artworkSource: 'original.png', scenario: { timestampLocal: '2026-10-10T08:00:00.000Z', hour, isDay: true }, prompt: 'scene', model: 'fake', createdAt: `2026-10-10T${hour}:00:00.000Z`, outputPath: '', story: { id: s.id, date: s.date, artworkHash: s.artworkHash, sceneHour: hour, originalHash: s.artworkHash } } as RenderMetadata;
}
describe('durable story store', () => {
  it('ignores interrupted JSON writes and commits ready only with valid original', async () => {
    const { d, store, s } = await ready();
    expect((await store.load(s.date, hours))?.story).toEqual(s);
    writeFileSync(join(d, 'stories', s.date, '.story.interrupted.tmp'), JSON.stringify(s));
    rmSync(join(d, 'stories', s.date, 'story.json'));
    expect(await store.load(s.date, hours)).toBeNull();
  });
  it('never exposes malformed committed JSON as a ready story', async () => {
    const { d, store, s } = await ready();
    writeFileSync(join(d, 'stories', s.date, 'story.json'), '{');
    expect(await store.load(s.date, hours)).toBeNull();
  });
  it('rejects wrong-artwork commits and retains the frozen original', async () => {
    const { store, s, original } = await ready();
    await expect(store.commit({ ...s, artworkHash: 'b'.repeat(64) }, hours)).rejects.toThrow();
    await expect(store.snapshotOriginal(s.date, await image('blue'))).rejects.toThrow();
    expect((await store.load(s.date, hours))?.original.sha256).toBe(original.sha256);
  });
  it('retains the existing story when a competing commit uses different configured hours', async () => {
    const { store, s } = await ready();
    const extended = { ...s, id: 'replacement-story', scenes: [...s.scenes, { ...s.scenes[0], hour: 12 }] };
    const result = await store.commit(extended, [9, 10, 11, 12]);
    expect(result.story).toEqual(s);
    expect((await store.load(s.date))?.story).toEqual(s);
  });
  it('preserves original and continuity after output purge', async () => {
    const { d, store, s } = await ready(); const outputs = new OutputStore(join(d, 'outputs'), 1);
    await outputs.save(await image('blue'), metadata(s, 'render-1', 9));
    await store.commitContinuity(s, (await outputs.resolve('render-1'))!);
    await outputs.save(await image('green'), { ...metadata(s, 'render-2', 10), story: undefined } as RenderMetadata);
    expect(await outputs.resolve('render-1')).toBeNull();
    const refs = await store.getReferences(s, 11, outputs);
    expect(refs.original.sha256).toBe(s.artworkHash); expect(refs.previous?.renderId).toBe('render-1');
  });
  it('recovers a committed same-story render after restart but rejects wrong-story and future renders', async () => {
    const { d, store, s } = await ready(); const outputs = new OutputStore(join(d, 'outputs'));
    await outputs.save(await image('blue'), metadata(s, 'render-1', 9));
    await outputs.save(await image('green'), metadata({ ...s, id: 'other' }, 'render-2', 10));
    await outputs.save(await image('yellow'), metadata(s, 'render-3', 11));
    const restarted = new StoryStore(join(d, 'stories'));
    const refs = await restarted.getReferences(s, 11, outputs);
    expect(refs.previous?.renderId).toBe('render-1');
    rmSync(join(d, 'outputs'), { recursive: true });
    expect((await restarted.getReferences(s, 11)).previous?.renderId).toBe('render-1');
    expect((await restarted.getReferences(s, 9)).previous).toBeUndefined();
  });
  it('replaces only the prior continuity snapshot after a committed update', async () => {
    const { d, store, s, original } = await ready(); const outputs = new OutputStore(join(d, 'outputs'));
    await outputs.save(await image('blue'), metadata(s, 'render-1', 9));
    const first = await store.commitContinuity(s, (await outputs.resolve('render-1'))!);
    await outputs.save(await image('green'), metadata(s, 'render-2', 10));
    await store.commitContinuity(s, (await outputs.resolve('render-2'))!);
    expect(readdirSync(join(d, 'stories', s.date))).not.toContain(first.path.split('/').at(-1));
    expect((await store.getReferences(s, 11)).original.path).toBe(original.path);
  });
  it('uses an eligible preceding committed output without moving a future pointer backwards', async () => {
    const { d, store, s } = await ready(); const outputs = new OutputStore(join(d, 'outputs'));
    await outputs.save(await image('blue'), metadata(s, 'render-1', 9));
    await outputs.save(await image('green'), metadata(s, 'render-2', 11));
    await store.commitContinuity(s, (await outputs.resolve('render-2'))!);
    expect((await store.getReferences(s, 10, outputs)).previous?.renderId).toBe('render-1');
    expect((await store.getReferences(s, 12)).previous?.renderId).toBe('render-2');
  });
  it('holds when a required persisted snapshot is corrupt', async () => {
    const { d, store, s } = await ready(); const outputs = new OutputStore(join(d, 'outputs'));
    await outputs.save(await image('blue'), metadata(s, 'render-1', 9));
    await store.commitContinuity(s, (await outputs.resolve('render-1'))!);
    const refs = await store.getReferences(s, 10); writeFileSync(refs.previous!.path, 'broken');
    await expect(store.getReferences(s, 10)).rejects.toThrow();
    expect(readdirSync(join(d, 'stories', s.date))).toContain('story.json');
  });
});


it('holds if a same-story committed frame was corrupted before continuity recovery', async () => {
  const { d, store, s } = await ready();
  const outputs = new OutputStore(join(d, 'outputs'));
  const outputPath = await outputs.save(await image('blue'), metadata(s, 'render-broken', 9));
  writeFileSync(outputPath, 'broken');
  await expect(store.getReferences(s, 10, outputs)).rejects.toThrow(/continuity|committed/i);
});


it('rejects yesterday-dated sidecar conditions even when story fields were copied', async () => {
  const { d, store, s } = await ready(); const outputs = new OutputStore(join(d, 'outputs'));
  const copied = metadata(s, 'copied-story', 9);
  await outputs.save(await image('blue'), {...copied,scenario:{...copied.scenario,timestampLocal:'2026-10-09T07:00:00Z'}});
  expect((await store.getReferences(s, 10, outputs)).previous).toBeUndefined();
});
