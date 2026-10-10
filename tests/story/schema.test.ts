import { describe, expect, it } from 'vitest';
import { validateStory } from '../../src/story/schema.js';
import { hours, story } from './fixtures.js';
const hash = 'a'.repeat(64);
const expected = { date: '2026-10-10', artworkHash: hash, hours, timezone: 'Europe/Madrid' };
describe('daily story schema', () => {
  it('accepts complete identity and exact active slots', () => expect(validateStory(story(hash), expected)).toEqual(story(hash)));
  it.each([
    { date: '2026-10-09' }, { artworkHash: 'b'.repeat(64) }, { scenes: story(hash).scenes.slice(1) },
    { scenes: [story(hash).scenes[0], story(hash).scenes[0], story(hash).scenes[2]] },
    { scenes: [{ ...story(hash).scenes[0], presentCast: ['unknown'] }, ...story(hash).scenes.slice(1)] },
    { extra: 'not in schema' }, { trailer: 'Primera frase. Segunda frase.' },
  ])('rejects incompatible or malformed story %j', change => expect(() => validateStory({ ...story(hash), ...change }, expected)).toThrow());
});
