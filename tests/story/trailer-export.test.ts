import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StoryStore } from "../../src/story/story-store.js";
import { exportTrailer } from "../../src/story/trailer-export.js";
import { hours, image, story } from "./fixtures.js";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, {recursive:true,force:true})));
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "haystack-trailer-")); dirs.push(dir);
  const store = new StoryStore(join(dir,"stories"));
  const original = await store.snapshotOriginal("2026-10-10", await image());
  const value = story(original.sha256);
  return {dir,store,value};
}
describe("public trailer handoff", () => {
  it("publishes only a committed ready story with the exact shared fields", async () => {
    const {dir,store,value} = await fixture();
    await expect(exportTrailer(store,value.date,join(dir,"vault"))).rejects.toThrow(/ready/);
    await store.commit(value,hours);
    const file = await exportTrailer(store,value.date,join(dir,"vault"));
    expect(file).toBe(join(dir,"vault","Haystack","TV Today.md"));
    expect(readFileSync(file,"utf8")).toBe(`---\nschema_version: 1\ndate: "2026-10-10"\nstory_id: "${value.id}"\nartwork_id: "${value.artworkHash}"\nready: true\ngenerated_at: "${value.createdAt}"\n---\n\n${value.trailer}\n`);
    expect(readFileSync(file,"utf8")).not.toContain(value.ending);
  });
  it("retries publishing the ready artifact and never relabels a stale date", async () => {
    const {dir,store,value} = await fixture(); await store.commit(value,hours);
    const obstruction = join(dir,"not-a-vault"); writeFileSync(obstruction,"file");
    await expect(exportTrailer(store,value.date,obstruction)).rejects.toThrow();
    const file = await exportTrailer(store,value.date,join(dir,"vault"));
    expect(readFileSync(file,"utf8")).toContain('date: "2026-10-10"');
    await expect(exportTrailer(store,"2026-10-11",join(dir,"vault"))).rejects.toThrow(/ready/);
    expect(readFileSync(file,"utf8")).toContain('date: "2026-10-10"');
  });
  it("rejects a timezone different from the shared Europe/Madrid handoff", async () => {
    const {dir,store,value} = await fixture();
    await store.commit({...value,timezone:"UTC"},hours);
    await expect(exportTrailer(store,value.date,join(dir,"vault"))).rejects.toThrow(/Europe\/Madrid/);
  });
});
