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
  const ready={story:story(original.sha256),original};
  const prepare=vi.fn(async()=>store.commit(ready.story,hours));const onReady=vi.fn(async()=>{});
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
    expect(readFileSync(join(dir,"vault","Haystack","TV Story So Far.md"),"utf8")).toContain('latest_scene_hour: null');
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T07:00:00Z"));await service.checkNow();expect(prepare).toHaveBeenCalledTimes(1);
  });
  it("startup catch-up prepares once then requests the current scene during active hours",async()=>{
    const {prepare,onReady,service}=await fixture();
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T10:30:00Z"));await service.checkNow();
    expect(prepare).toHaveBeenCalledTimes(1);expect(onReady).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T11:30:00Z"));await service.checkNow();expect(onReady).toHaveBeenCalledTimes(1);
  });
  it("retries a failed preparation in the next local hour and stops once ready",async()=>{
    const {prepare,store,service}=await fixture();
    prepare.mockImplementationOnce(async()=>{store.recordFailure("2026-10-10","preparation_failed");return null;});
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T04:45:00Z"));await service.checkNow();
    expect(prepare).toHaveBeenLastCalledWith({now:new Date("2026-10-10T04:45:00Z")});
    vi.setSystemTime(new Date("2026-10-10T04:59:00Z"));await service.checkNow();expect(prepare).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-10T05:00:00Z"));await service.checkNow();
    expect(prepare).toHaveBeenLastCalledWith({now:new Date("2026-10-10T05:00:00Z"),retryFailed:true});
    vi.setSystemTime(new Date("2026-10-10T06:00:00Z"));await service.checkNow();expect(prepare).toHaveBeenCalledTimes(2);
  });
  it("honors the persisted failure hour after a restart",async()=>{
    const {prepare,store,service}=await fixture();
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T04:50:00Z"));store.recordFailure("2026-10-10","preparation_failed");
    vi.setSystemTime(new Date("2026-10-10T04:59:00Z"));await service.checkNow();expect(prepare).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-10-10T05:00:00Z"));await service.checkNow();
    expect(prepare).toHaveBeenCalledExactlyOnceWith({now:new Date("2026-10-10T05:00:00Z"),retryFailed:true});
  });
  it("publishes a committed story immediately when a crash left a same-hour failure",async()=>{
    const {dir,prepare,store,ready,onReady,service}=await fixture();
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T10:00:00Z"));
    store.recordFailure("2026-10-10","preparation_interrupted");await store.commit(ready.story,hours);
    const first=service.checkNow();const second=service.checkNow();expect(second).toBe(first);
    expect(await first).toEqual(ready);expect(prepare).not.toHaveBeenCalled();expect(onReady).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(dir,"vault","Haystack","TV Today.md"),"utf8")).toContain('ready: true');
    vi.setSystemTime(new Date("2026-10-10T10:01:00Z"));await service.checkNow();expect(onReady).toHaveBeenCalledTimes(1);
  });
  it("requests the current scene when an hourly retry succeeds during active hours",async()=>{
    const {prepare,store,onReady,service}=await fixture();
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T08:50:00Z"));store.recordFailure("2026-10-10","preparation_failed");
    vi.setSystemTime(new Date("2026-10-10T09:00:00Z"));await service.checkNow();
    expect(prepare).toHaveBeenCalledExactlyOnceWith({now:new Date("2026-10-10T09:00:00Z"),retryFailed:true});
    expect(onReady).toHaveBeenCalledTimes(1);
  });
  it("limits repeated failures to one attempt per hour and stops at active end",async()=>{
    const {prepare,store,service}=await fixture();
    prepare.mockImplementation(async()=>{store.recordFailure("2026-10-10","preparation_failed");return null;});
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T17:00:00Z"));await service.checkNow();
    vi.setSystemTime(new Date("2026-10-10T17:01:00Z"));await service.checkNow();expect(prepare).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-10T18:00:00Z"));await service.checkNow();
    vi.setSystemTime(new Date("2026-10-10T18:01:00Z"));await service.checkNow();expect(prepare).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date("2026-10-10T19:00:00Z"));await service.checkNow();expect(prepare).toHaveBeenCalledTimes(2);
  });
  it("waits until the hour after a failure finishes when preparation crosses an hour",async()=>{
    const {prepare,store,service}=await fixture();
    prepare.mockImplementationOnce(async()=>{
      vi.setSystemTime(new Date("2026-10-10T13:03:00Z"));store.recordFailure("2026-10-10","preparation_failed");return null;
    });
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T12:58:00Z"));await service.checkNow();
    vi.setSystemTime(new Date("2026-10-10T13:04:00Z"));await service.checkNow();expect(prepare).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-10T14:00:00Z"));await service.checkNow();expect(prepare).toHaveBeenCalledTimes(2);
  });
  it("deduplicates concurrent checks while an hourly retry is pending",async()=>{
    const {prepare,store,ready,service}=await fixture();
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T04:50:00Z"));store.recordFailure("2026-10-10","preparation_failed");
    vi.setSystemTime(new Date("2026-10-10T05:00:00Z"));
    let resolve!: (value:typeof ready)=>void;
    prepare.mockImplementation(()=>new Promise<typeof ready>(done=>{resolve=done;}));
    const first=service.checkNow();const second=service.checkNow();expect(first).toBe(second);
    expect(prepare).toHaveBeenCalledTimes(1);resolve(await store.commit(ready.story,hours));await first;
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
  it("keeps polling a contended retry when the previous failure is unchanged",async()=>{
    const {prepare,store,onReady,service}=await fixture();
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T04:50:00Z"));store.recordFailure("2026-10-10","preparation_failed");
    prepare.mockResolvedValueOnce(null);
    vi.setSystemTime(new Date("2026-10-10T10:00:00Z"));expect(await service.checkNow()).toBeNull();
    vi.setSystemTime(new Date("2026-10-10T10:01:00Z"));expect(await service.checkNow()).not.toBeNull();
    expect(prepare).toHaveBeenCalledTimes(2);expect(onReady).toHaveBeenCalledTimes(1);
  });
  it("resident timer reaches morning preparation and stop clears the timer",async()=>{
    const {prepare,service}=await fixture();vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-10T04:44:30Z"));
    service.start();await vi.advanceTimersByTimeAsync(32_000);expect(prepare).toHaveBeenCalledTimes(1);
    service.stop();expect(vi.getTimerCount()).toBe(0);
  });
});
