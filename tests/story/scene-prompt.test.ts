import { describe, expect, it } from 'vitest';
import { composeScenePrompt } from '../../src/story/scene-prompt.js';
import { story } from './fixtures.js';
import { createScenarioFromHour } from '../../src/engine/scenario.js';
describe('current story scene prompt', () => {
  it('includes complete visible state and only present identities with fresh physical conditions', () => {
    const s = story('a'.repeat(64));
    s.cast.push({ id: 'later', identity: 'FUTURE_CAST_SECRET' });
    s.ending = 'FUTURE_ENDING_SECRET';
    const scene = s.scenes[2];
    const scenario = createScenarioFromHour(11); scenario.temperature = 7;
    const prompt = composeScenePrompt(s, scene, scenario, true);
    expect(prompt).toContain(scene.state); expect(prompt).toContain(scene.action);
    expect(prompt).toContain(s.cast[0].identity); expect(prompt).toContain('7');
    expect(prompt).toContain('original'); expect(prompt).toContain('previous');
    expect(prompt).not.toContain('FUTURE_'); expect(prompt).not.toContain('invent freely');
  });
});
