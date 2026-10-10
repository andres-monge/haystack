import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoryPreparationService } from "../../src/story/preparation-service.js";
import { StoryStore } from "../../src/story/story-store.js";
import { hours, image, story } from "./fixtures.js";
const dirs:string[]=[];
afterEach(()=>{vi.useRealTimers(); dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true}));});
async function fixture() {
  const dir=mkdtempSync(join(tmpdir(),"haystack-prep-service-"));dirs.push(dir);
  const store=new StoryStore(join(dir,"stories"));
  const original=await store.snapshotOriginal("2026-10-10",await image());
  const ready=await store.commit(story(original.sha256),hours);
  const prepare=vi.fn(async()=>ready);const onReady=vi.fn(async()=>{});
  const service=new StoryPreparationService({store,preparer:{prepare},timezone:"Europe/Madrid",prepareTime:"06:45",activeStart:9,activeEnd:21,trailerDir:join(dir,"vault"),onReady});
  return {dir,store,ready,prepare,onReady,service};
}
describe("morning preparation service",()=>{
  it("prepares before image hours, exports once, and does not render before the active window",async()=>{
    const {dir,prepare,onReady,service}=await fixture();
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T04:44:00Z"));await service.checkNow();expect(prepare).not.toHaveBeenCalled();
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T04:45:00Z"));await service.checkNow();
    expect(prepare).toHaveBeenCalledTimes(1);expect(onReady).not.toHaveBeenCalled();
    expect(readFileSync(join(dir,"vault","Haystack","TV Today.md"),"utf8")).toContain('date: "2026-10-10"');
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T07:00:00Z"));await service.checkNow();expect(prepare).toHaveBeenCalledTimes(1);
  });
  it("startup catch-up prepares once then requests the current scene during active hours",async()=>{
    const {prepare,onReady,service}=await fixture();
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T10:30:00Z"));await service.checkNow();
    expect(prepare).toHaveBeenCalledTimes(1);expect(onReady).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T11:30:00Z"));await service.checkNow();expect(onReady).toHaveBeenCalledTimes(1);
  });
  it("does not prepare after active end or retry a failed day on each minute",async()=>{
    const {prepare,store,service}=await fixture();
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T19:00:00Z"));await service.checkNow();expect(prepare).not.toHaveBeenCalled();
    store.recordFailure("2026-10-10", "preparation_failed");
    prepare.mockResolvedValue(null);
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T10:00:00Z"));await service.checkNow();
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T11:00:00Z"));await service.checkNow();expect(prepare).toHaveBeenCalledTimes(1);
  });
  it("publishes a ready story after another preparation owner releases the date",async()=>{
    const {dir,prepare,onReady,service}=await fixture();
    prepare.mockResolvedValueOnce(null);
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T10:00:00Z"));
    expect(await service.checkNow()).toBeNull();
    vi.setSystemTime(new Date("2026-10-10T10:01:00Z"));
    expect(await service.checkNow()).not.toBeNull();
    expect(prepare).toHaveBeenCalledTimes(2);expect(onReady).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(dir,"vault","Haystack","TV Today.md"),"utf8")).toContain('ready: true');
  });
  it("resident timer reaches morning preparation and stop clears the timer",async()=>{
    const {prepare,service}=await fixture();vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T04:44:30Z"));
    service.start();await vi.advanceTimersByTimeAsync(32_000);expect(prepare).toHaveBeenCalledTimes(1);
    service.stop();expect(vi.getTimerCount()).toBe(0);
  });
});
