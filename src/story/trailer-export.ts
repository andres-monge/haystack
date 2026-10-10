import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { StoryStore } from "./story-store.js";

/** Publish the exact public handoff only after the local story commit. */
export async function exportTrailer(store: StoryStore, date: string, vaultDir: string): Promise<string> {
  const ready = await store.load(date);
  if (!ready) throw new Error("No ready story for trailer export");
  const { story } = ready;
  if (story.timezone !== "Europe/Madrid") throw new Error("Trailer handoff requires Europe/Madrid");
  const dir = path.join(vaultDir, "Haystack");
  fs.mkdirSync(dir, {recursive:true});
  const target = path.join(dir, "TV Today.md");
  const temporary = path.join(dir, `.TV Today.${randomUUID()}.tmp`);
  const note = [
    "---", "schema_version: 1", `date: ${JSON.stringify(story.date)}`,
    `story_id: ${JSON.stringify(story.id)}`, `artwork_id: ${JSON.stringify(story.artworkHash)}`,
    "ready: true", `generated_at: ${JSON.stringify(story.createdAt)}`, "---", "",
    story.trailer.trim(), "",
  ].join("\n");
  try {
    fs.writeFileSync(temporary, note, {flag:"wx",mode:0o600});
    fs.renameSync(temporary,target);
  } finally {
    fs.rmSync(temporary, {force:true});
  }
  return target;
}
