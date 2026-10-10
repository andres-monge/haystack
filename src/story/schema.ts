import type { DailyStory, StoryExpectation } from './types.js';

const text = { type: 'string', minLength: 1 } as const;
export const STORY_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'id', 'date', 'timezone', 'artworkHash', 'title', 'premise', 'trailer', 'cast', 'scenes', 'ending', 'createdAt'],
  properties: {
    schemaVersion: { type: 'integer', const: 1 }, id: text,
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, timezone: text,
    artworkHash: { type: 'string', pattern: '^[0-9a-f]{64}$' }, title: text, premise: text, trailer: text,
    cast: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['id', 'identity'], properties: { id: text, identity: text } } },
    scenes: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['hour', 'presentCast', 'state', 'action'], properties: { hour: { type: 'integer', minimum: 0, maximum: 23 }, presentCast: { type: 'array', items: text }, state: text, action: text } } },
    ending: text, createdAt: text,
  },
} as const;

function record(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Invalid ${name}`);
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).length !== fields.length || fields.some(k => !(k in obj))) throw new Error(`Unexpected or missing ${name} fields`);
  return obj;
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
export function assertStoryDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Invalid story date');
}
/** Reject identity drift, undeclared cast and missing/duplicate configured slots. */
export function validateStory(input: unknown, expected: StoryExpectation): DailyStory {
  const obj = record(input, STORY_JSON_SCHEMA.required, 'story');
  if (obj.schemaVersion !== 1) throw new Error('Unsupported story schema');
  for (const key of ['id', 'date', 'timezone', 'artworkHash', 'title', 'premise', 'trailer', 'ending', 'createdAt']) {
    if (!nonempty(obj[key])) throw new Error(`Invalid story ${key}`);
  }
  assertStoryDate(obj.date as string);
  if (!/^[a-zA-Z0-9_-]+$/.test(obj.id as string) || !/^[0-9a-f]{64}$/.test(obj.artworkHash as string)) throw new Error('Invalid story identity');
  try { new Intl.DateTimeFormat('en', { timeZone: obj.timezone as string }); } catch { throw new Error('Invalid story timezone'); }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(obj.createdAt as string) || !Number.isFinite(Date.parse(obj.createdAt as string))) throw new Error('Invalid story timestamp');
  if (obj.date !== expected.date || obj.artworkHash !== expected.artworkHash || (expected.timezone !== undefined && obj.timezone !== expected.timezone) || (expected.id !== undefined && obj.id !== expected.id) || (expected.createdAt !== undefined && obj.createdAt !== expected.createdAt)) throw new Error('Story identity mismatch');
  const trailer = obj.trailer as string;
  if (/[\r\n]/.test(trailer) || [...new Intl.Segmenter('es', { granularity: 'sentence' }).segment(trailer.trim())].length !== 1) throw new Error('Trailer must be one sentence');
  if (!Array.isArray(obj.cast) || obj.cast.length === 0) throw new Error('Story needs identifiable cast');
  const ids = new Set<string>();
  for (const entry of obj.cast) {
    const character = record(entry, ['id', 'identity'], 'character');
    if (!nonempty(character.id) || !/^[a-zA-Z0-9_-]+$/.test(character.id) || !nonempty(character.identity) || ids.has(character.id)) throw new Error('Invalid or duplicate cast identity');
    ids.add(character.id);
  }
  if (expected.hours.length === 0 || new Set(expected.hours).size !== expected.hours.length || expected.hours.some(h => !Number.isInteger(h) || h < 0 || h > 23)) throw new Error('Invalid expected story slots');
  if (!Array.isArray(obj.scenes) || obj.scenes.length !== expected.hours.length) throw new Error('Missing story slots');
  const slots = new Set<number>();
  let previousHour = -1;
  for (const entry of obj.scenes) {
    const scene = record(entry, ['hour', 'presentCast', 'state', 'action'], 'scene');
    if (typeof scene.hour !== 'number' || scene.hour <= previousHour || !expected.hours.includes(scene.hour) || slots.has(scene.hour) || !nonempty(scene.state) || !nonempty(scene.action) || !Array.isArray(scene.presentCast) || new Set(scene.presentCast).size !== scene.presentCast.length || scene.presentCast.some(id => typeof id !== 'string' || !ids.has(id))) throw new Error('Invalid story slot or cast presence');
    slots.add(scene.hour);
    previousHour = scene.hour;
  }
  return structuredClone(obj) as unknown as DailyStory;
}
