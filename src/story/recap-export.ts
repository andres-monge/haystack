import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDateString } from '../server/image-rotation.js';
import type { OutputStore } from '../storage/output-store.js';
import type { StoryStore } from './story-store.js';

// Queue the snapshot as well as publication: an older caller cannot publish an older prefix.
const publications = new Map<string, Promise<unknown>>();
export function exportRecap(store: StoryStore, date: string, vaultDir: string, outputs?: OutputStore): Promise<string> {
  const target = path.resolve(vaultDir, 'Haystack', 'TV Story So Far.md');
  const previous = publications.get(target) ?? Promise.resolve();
  const publication = previous.catch(() => {}).then(async () => {
    const lease = await store.acquireRecapPublication();
    try {
      const ready = await store.load(date);
      if (!ready || ready.story.timezone !== 'Europe/Madrid') throw new Error('No ready Madrid story for recap export');
      if (outputs) await store.recoverProgress(outputs);
      const now = new Date();
      if (getDateString(now, 'Europe/Madrid') !== date) throw new Error('Recap must belong to the current Madrid date');
      const { story } = ready;
      const hours = store.committedHours(story, now);
      const note = [
        '---', 'schema_version: 1', `date: ${JSON.stringify(story.date)}`,
        `story_id: ${JSON.stringify(story.id)}`, `artwork_id: ${JSON.stringify(story.artworkHash)}`,
        'ready: true', `updated_at: ${JSON.stringify(now.toISOString())}`,
        `latest_scene_hour: ${hours.at(-1) ?? 'null'}`, '---', '', story.trailer.trim(), '',
        ...hours.flatMap(hour => {
          const scene = story.scenes.find(s => s.hour === hour)!;
          return [`## ${String(hour).padStart(2, '0')}:00`, '', scene.state.trim(), '', scene.action.trim(), ''];
        }),
      ].join('\n');
      const dir = path.dirname(target);
      fs.mkdirSync(dir, { recursive: true });
      const temporary = path.join(dir, `.TV Story So Far.${randomUUID()}.tmp`);
      try {
        fs.writeFileSync(temporary, note, { flag: 'wx', mode: 0o600 });
        // No async gap between this date check and atomic promotion.
        if (getDateString(new Date(), 'Europe/Madrid') !== date) throw new Error('Recap date changed before publication');
        fs.renameSync(temporary, target);
      } finally { fs.rmSync(temporary, { force: true }); }
      return target;
    } finally { await lease.release(); }
  });
  publications.set(target, publication);
  void publication.finally(() => { if (publications.get(target) === publication) publications.delete(target); }).catch(() => {});
  return publication;
}
