import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GenerationLock,
  GenerationLockBusyError,
} from "../../src/engine/generation-lock.js";

describe("GenerationLock", () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-generation-lock-"));
    lockPath = path.join(tempDir, "paid-generation.lock");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects same-instance and separate-instance contention", async () => {
    const first = new GenerationLock({ lockPath });
    const second = new GenerationLock({ lockPath });
    const lease = await first.acquire({ kind: "manual" });

    await expect(first.acquire({ kind: "scheduler" })).rejects.toBeInstanceOf(
      GenerationLockBusyError,
    );
    await expect(second.acquire({ kind: "cli" })).rejects.toBeInstanceOf(
      GenerationLockBusyError,
    );

    await lease.release();
    const nextLease = await second.acquire({ kind: "cli" });
    await nextLease.release();
  });

  it("lets exactly one contender reclaim a verified dead stale owner", async () => {
    const now = 10_000;
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
      token: "dead-owner-token",
      pid: 424242,
      hostname: os.hostname(),
      createdAt: new Date(0).toISOString(),
      kind: "scheduler",
    }));

    const locks = [1, 2].map(() => new GenerationLock({
      lockPath,
      reclaimAfterMs: 100,
      now: () => now,
      isProcessAlive: () => false,
    }));
    const settled = await Promise.allSettled(
      locks.map(lock => lock.acquire({ kind: "manual" })),
    );

    expect(settled.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((settled.find(result => result.status === "rejected") as PromiseRejectedResult).reason)
      .toBeInstanceOf(GenerationLockBusyError);
    for (const result of settled) {
      if (result.status === "fulfilled") await result.value.release();
    }
  });

  it("never reclaims a stale lock whose owner is still alive", async () => {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
      token: "live-owner-token",
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: new Date(0).toISOString(),
      kind: "manual",
    }));
    const lock = new GenerationLock({
      lockPath,
      reclaimAfterMs: 1,
      now: () => Date.now() + 100_000,
      isProcessAlive: () => true,
    });

    await expect(lock.acquire({ kind: "manual" })).rejects.toBeInstanceOf(
      GenerationLockBusyError,
    );
    expect(JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")))
      .toMatchObject({ token: "live-owner-token" });
  });

  it("does not reclaim a dead owner until the bounded stale interval passes", async () => {
    const now = 10_000;
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
      token: "fresh-dead-owner-token",
      pid: 424242,
      hostname: os.hostname(),
      createdAt: new Date(now - 99).toISOString(),
      kind: "scheduler",
    }));
    const lock = new GenerationLock({
      lockPath,
      reclaimAfterMs: 100,
      now: () => now,
      isProcessAlive: () => false,
    });

    await expect(lock.acquire({ kind: "manual" })).rejects.toBeInstanceOf(
      GenerationLockBusyError,
    );
    expect(JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")))
      .toMatchObject({ token: "fresh-dead-owner-token" });
  });

  it("does not reclaim malformed owner metadata even when the directory is old", async () => {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
      token: "malformed-owner",
      pid: "not-a-pid",
      hostname: os.hostname(),
      createdAt: new Date(0).toISOString(),
      kind: "manual",
    }));
    const lock = new GenerationLock({
      lockPath,
      reclaimAfterMs: 1,
      now: () => Date.now() + 100_000,
      isProcessAlive: () => false,
    });

    await expect(lock.acquire({ kind: "manual" })).rejects.toBeInstanceOf(
      GenerationLockBusyError,
    );
    expect(fs.existsSync(path.join(lockPath, "owner.json"))).toBe(true);
  });

  it("uses the lease token so an old lease cannot release a replacement owner", async () => {
    const lock = new GenerationLock({ lockPath });
    const lease = await lock.acquire({ kind: "manual" });
    fs.rmSync(lockPath, { recursive: true, force: true });
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
      token: "replacement-token",
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: new Date().toISOString(),
      kind: "scheduler",
    }));

    await lease.release();

    expect(fs.existsSync(lockPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")))
      .toMatchObject({ token: "replacement-token" });
  });
});
