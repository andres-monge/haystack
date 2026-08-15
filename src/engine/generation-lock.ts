import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const DEFAULT_GENERATION_LOCK_RECLAIM_MS = 15 * 60 * 1000;

const OWNER_FILE = "owner.json";
const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,200}$/;

export type GenerationOwnerKind =
  | "normal"
  | "scheduler"
  | "manual"
  | "cli"
  | "extend";

export interface GenerationLockOwnerInput {
  kind: GenerationOwnerKind;
}

export interface GenerationLockOptions {
  lockPath: string;
  reclaimAfterMs?: number;
  now?: () => number;
  createToken?: () => string;
  isProcessAlive?: (pid: number) => boolean;
  hostname?: string;
}

interface StoredOwner {
  token: string;
  pid: number;
  hostname: string;
  createdAt: string;
  kind: GenerationOwnerKind;
}

export interface GenerationLockLease {
  readonly token: string;
  release(): Promise<void>;
}

export class GenerationLockBusyError extends Error {
  readonly code = "GENERATION_BUSY";

  constructor() {
    super("Another image generation is already in progress");
    this.name = "GenerationLockBusyError";
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // EPERM still proves that the process exists; only ESRCH proves death.
    return code !== "ESRCH";
  }
}

function isStoredOwner(value: unknown): value is StoredOwner {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const owner = value as Record<string, unknown>;
  return (
    typeof owner.token === "string"
    && SAFE_TOKEN.test(owner.token)
    && Number.isInteger(owner.pid)
    && (owner.pid as number) > 0
    && typeof owner.hostname === "string"
    && owner.hostname.length > 0
    && owner.hostname.length <= 255
    && typeof owner.createdAt === "string"
    && Number.isFinite(Date.parse(owner.createdAt))
    && ["normal", "scheduler", "manual", "cli", "extend"].includes(
      owner.kind as string,
    )
  );
}

/**
 * Atomic filesystem lock shared by server, scheduler, CLI, and extend flows.
 * A fully prepared directory is renamed into place as the ownership claim.
 */
export class GenerationLock {
  readonly #lockPath: string;
  readonly #reclaimAfterMs: number;
  readonly #now: () => number;
  readonly #createToken: () => string;
  readonly #isProcessAlive: (pid: number) => boolean;
  readonly #hostname: string;

  constructor(options: GenerationLockOptions) {
    if (!path.isAbsolute(options.lockPath)) {
      throw new Error("Generation lock path must be absolute");
    }
    const reclaimAfterMs = options.reclaimAfterMs
      ?? DEFAULT_GENERATION_LOCK_RECLAIM_MS;
    if (!Number.isFinite(reclaimAfterMs) || reclaimAfterMs <= 0) {
      throw new Error("Generation lock reclaim interval must be positive");
    }
    this.#lockPath = path.resolve(options.lockPath);
    this.#reclaimAfterMs = reclaimAfterMs;
    this.#now = options.now ?? Date.now;
    this.#createToken = options.createToken ?? randomUUID;
    this.#isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
    this.#hostname = options.hostname ?? os.hostname();
    fs.mkdirSync(path.dirname(this.#lockPath), { recursive: true });
  }

  async acquire(input: GenerationLockOwnerInput): Promise<GenerationLockLease> {
    const token = this.#createToken();
    if (!SAFE_TOKEN.test(token)) {
      throw new Error("Generation lock token must be a safe non-empty identifier");
    }
    const owner: StoredOwner = {
      token,
      pid: process.pid,
      hostname: this.#hostname,
      createdAt: new Date(this.#now()).toISOString(),
      kind: input.kind,
    };

    if (!this.#claim(owner)) {
      if (!this.#reclaimVerifiedDeadOwner()) {
        throw new GenerationLockBusyError();
      }
      if (!this.#claim(owner)) {
        throw new GenerationLockBusyError();
      }
    }

    let released = false;
    return Object.freeze({
      token,
      release: async () => {
        if (released) return;
        released = true;
        this.#releaseIfOwner(token);
      },
    });
  }

  #claim(owner: StoredOwner): boolean {
    const candidatePath = `${this.#lockPath}.claim-${process.pid}-${owner.token}`;
    try {
      fs.mkdirSync(candidatePath, { mode: 0o700 });
      fs.writeFileSync(
        path.join(candidatePath, OWNER_FILE),
        `${JSON.stringify(owner)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      fs.renameSync(candidatePath, this.#lockPath);
      return true;
    } catch (error) {
      fs.rmSync(candidatePath, { recursive: true, force: true });
      const code = (error as NodeJS.ErrnoException).code;
      if (["EEXIST", "ENOTEMPTY", "ENOENT"].includes(code ?? "")) {
        return false;
      }
      throw error;
    }
  }

  #readOwner(directory = this.#lockPath): StoredOwner | undefined {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(directory, OWNER_FILE), "utf8"),
      ) as unknown;
      return isStoredOwner(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  #reclaimVerifiedDeadOwner(): boolean {
    const owner = this.#readOwner();
    if (!owner || owner.hostname !== this.#hostname) return false;
    if (!this.#isVerifiedDeadAndStale(owner)) {
      return false;
    }

    // A fixed exclusive marker elects one reclaimer while the stale directory
    // still blocks every new owner. A contender that observed the old owner
    // but reaches a replacement directory can only add/remove the marker: it
    // must re-read the token before it is allowed to delete anything.
    const markerPath = path.join(this.#lockPath, ".reclaim");
    try {
      fs.writeFileSync(markerPath, owner.token, { flag: "wx", mode: 0o600 });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (["EEXIST", "ENOENT"].includes(code ?? "")) return false;
      throw error;
    }

    const currentOwner = this.#readOwner();
    if (
      currentOwner?.token !== owner.token
      || !this.#isVerifiedDeadAndStale(currentOwner)
    ) {
      try {
        fs.unlinkSync(markerPath);
      } catch {
        // The observed directory may already have been replaced or released.
      }
      return false;
    }

    try {
      fs.rmSync(this.#lockPath, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  #isVerifiedDeadAndStale(owner: StoredOwner): boolean {
    const ageMs = this.#now() - Date.parse(owner.createdAt);
    return Number.isFinite(ageMs)
      && ageMs >= this.#reclaimAfterMs
      && !this.#isProcessAlive(owner.pid);
  }

  #releaseIfOwner(token: string): void {
    const owner = this.#readOwner();
    if (owner?.token !== token) return;
    const releasePath = `${this.#lockPath}.release-${process.pid}-${token}`;
    try {
      fs.renameSync(this.#lockPath, releasePath);
    } catch {
      return;
    }
    const movedOwner = this.#readOwner(releasePath);
    if (movedOwner?.token === token) {
      fs.rmSync(releasePath, { recursive: true, force: true });
      return;
    }
    try {
      fs.renameSync(releasePath, this.#lockPath);
    } catch {
      // Never remove an owner whose token does not match this lease.
    }
  }
}

export function generationLockPath(outputDir: string): string {
  return path.join(path.resolve(outputDir), ".paid-generation.lock");
}
