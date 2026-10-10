import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DailyStoryPreparer } from '../../src/story/prepare-story.js';
import { GenerationLock } from '../../src/engine/generation-lock.js';
import { StoryStore } from '../../src/story/story-store.js';
import { setStateDir, resetStateDir, resetImageCache } from '../../src/server/image-rotation.js';
import type { WriterRequest } from '../../src/story/codex-writer.js';
import type { WeatherProvider, HourlyConditions } from '../../src/weather/types.js';
import { image, story } from './fixtures.js';
const dirs: string[] = [];
const now = new Date('2026-10-10T04:45:00Z');
const date = '2026-10-10';
const location = { lat: 40, lon: -3, timezone: 'Europe/Madrid' };
function slot(hour: number): HourlyConditions {
  return { time: `${date}T${String(hour).padStart(2, '0')}:00`, weatherCode: 1, cloudPercent: 10, precipProbability: 0, temperature: 20, isDay: true, humidity: 30, windSpeed: 1, windGusts: 2, visibility: 10000, precipitation: 0, rain: 0, snowfall: 0, snowDepth: 0, directRadiation: 50, diffuseRadiation: 20 };
}
async function setup() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'story-preparation-')); dirs.push(d); setStateDir(d); resetImageCache();
  const imageDir = path.join(d, 'images'); fs.mkdirSync(imageDir); fs.writeFileSync(path.join(imageDir, 'art.png'), await image());
  const store = new StoryStore(path.join(d, 'stories'));
  const getForecast = vi.fn(async () => ({ current: { ...slot(6), sunrise: `${date}T07:30`, sunset: `${date}T19:30` }, hourly: Array.from({ length: 24 }, (_, h) => slot(h)) }));
  const weather = { getForecast } as unknown as WeatherProvider;
  const write = vi.fn(async (request: WriterRequest) => {
    const input = JSON.parse(request.prompt.split('INPUT DATA (JSON):\n')[1]);
    return { ...story(input.identity.artworkHash), ...input.identity, scenes: input.hours.map((hour: number) => ({ hour, presentCast: ['ana'], state: 'La maceta está junto a la puerta.', action: 'Ana riega las flores.' })) };
  });
  const config = { store, stateDir: path.join(d, 'stories'), writer: { write }, imageDir, location, weather, activeStart: 9, activeEnd: 12 };
  return { d, store, config, write, getForecast };
}
afterEach(() => { resetStateDir(); resetImageCache(); dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })); });
describe('daily preparation', () => {
  it('freezes original, validates identity, and reuses one ready story across concurrent preparers', async () => {
    const { store, config, write } = await setup();
    const a = new DailyStoryPreparer(config); const b = new DailyStoryPreparer(config);
    const [first, second] = await Promise.all([a.prepare({ now }), b.prepare({ now })]);
    expect(first).toEqual(second); expect(first?.story.scenes.map(s => s.hour)).toEqual([9, 10, 11]);
    expect(first?.story.createdAt).toBe(now.toISOString()); expect(first?.story.timezone).toBe(location.timezone);
    expect(await store.load(date)).toEqual(first); expect(write).toHaveBeenCalledTimes(1);
    expect(await a.prepare({ now, retryFailed: true })).toEqual(first); expect(write).toHaveBeenCalledTimes(1);
  });
  it('journals interruption before writer and requires explicit retry preserving frozen artwork', async () => {
    const { store, config, write } = await setup();
    const valid = write.getMockImplementation()!;
    write.mockImplementationOnce(async () => { expect(store.loadFailure(date)?.error).toBe('preparation_interrupted'); throw new Error('secret provider credential'); });
    expect(await new DailyStoryPreparer(config).prepare({ now })).toBeNull();
    expect(store.loadFailure(date)?.error).toBe('preparation_failed');
    const frozen = await store.loadOriginal(date);
    fs.writeFileSync(path.join(config.imageDir, 'art.png'), await image('blue'));
    expect(await new DailyStoryPreparer(config).prepare({ now })).toBeNull(); expect(write).toHaveBeenCalledTimes(1);
    write.mockImplementation(valid);
    const ready = await new DailyStoryPreparer(config).prepare({ now, retryFailed: true });
    expect(ready?.original).toEqual(frozen); expect(store.loadFailure(date)).toBeNull(); expect(write).toHaveBeenCalledTimes(2);
  });
  it.each(['id', 'date', 'timezone', 'artworkHash', 'createdAt'])('rejects changed writer identity %s', async key => {
    const { store, config, write } = await setup(); const valid = write.getMockImplementation()!;
    write.mockImplementation(async req => ({ ...await valid(req), [key]: 'changed' }));
    expect(await new DailyStoryPreparer(config).prepare({ now })).toBeNull(); expect(await store.load(date)).toBeNull();
  });
  it.each(['hole', 'wrong-date', 'nonfinite'])('does not invoke writer with invalid forecast %s', async kind => {
    const { config, write, getForecast } = await setup(); const forecast = await getForecast();
    if (kind === 'hole') forecast.hourly.splice(10, 1);
    if (kind === 'wrong-date') forecast.hourly[10].time = '2026-10-09T10:00';
    if (kind === 'nonfinite') forecast.hourly[10].windSpeed = NaN;
    getForecast.mockResolvedValue(forecast);
    expect(await new DailyStoryPreparer(config).prepare({ now })).toBeNull(); expect(write).not.toHaveBeenCalled();
  });
  it('respects a filesystem preparation owner without starting or journaling a second attempt', async () => {
    const { store, config, write } = await setup();
    const lock = new GenerationLock({ lockPath: path.join(config.stateDir, `.story-preparation-${date}.lock`) });
    const lease = await lock.acquire({ kind: 'cli' });
    try {
      expect(await new DailyStoryPreparer(config).prepare({ now })).toBeNull();
      expect(write).not.toHaveBeenCalled(); expect(store.loadFailure(date)).toBeNull();
    } finally { await lease.release(); }
    expect(await new DailyStoryPreparer(config).prepare({ now })).not.toBeNull();
  });
  it('passes frozen attachment and bounded summary data without state or destination paths', async () => {
    const { d, store, config, write } = await setup();
    const recentSummaries = vi.spyOn(store, 'recentSummaries');
    const ready = await new DailyStoryPreparer(config).prepare({ now });
    const request = write.mock.calls[0][0];
    expect(request.imagePath).toBe(ready?.original.path);
    expect(request.prompt).not.toContain(d);
    expect(recentSummaries).toHaveBeenCalledWith(14);
    const data = JSON.parse(request.prompt.split('INPUT DATA (JSON):\n')[1]);
    expect(Object.keys(data).sort()).toEqual(['forecast', 'hours', 'identity', 'recentStories']);
    expect(data.forecast).toHaveLength(24);
    expect(data.hours).toEqual([9, 10, 11]);
    expect(request.prompt).toContain('spoiler-free Spanish sentence');
  });
  it('suppresses persisted interrupted attempt and prepares all hours with no active window', async () => {
    const { store, config, write } = await setup(); store.recordFailure(date, 'preparation_interrupted');
    const preparer = new DailyStoryPreparer({ ...config, activeStart: undefined, activeEnd: undefined });
    expect(await preparer.prepare({ now })).toBeNull(); expect(write).not.toHaveBeenCalled();
    const ready = await preparer.prepare({ now, retryFailed: true }); expect(ready?.story.scenes).toHaveLength(24);
  });
});
