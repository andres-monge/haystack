// src/storage/output-store.ts -- File + metadata storage for render outputs

import * as fs from "node:fs";
import * as path from "node:path";
import type { RenderMetadata } from "../engine/types.js";

const VALID_ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;

export class OutputStore {
  private baseDir: string;
  private maxOutputs: number;

  constructor(baseDir: string, maxOutputs: number = 24) {
    if (!Number.isInteger(maxOutputs) || maxOutputs < 1) {
      throw new RangeError(`maxOutputs must be a positive integer, got ${maxOutputs}`);
    }
    this.baseDir = baseDir;
    this.maxOutputs = maxOutputs;
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  /**
   * Save an image and its metadata sidecar.
   * Returns the path to the saved image file.
   */
  save(imageBuffer: Buffer, metadata: RenderMetadata): string {
    if (!VALID_ID_PATTERN.test(metadata.id)) {
      throw new Error(
        `Invalid metadata id: must contain only alphanumeric characters, dashes, and underscores, got "${metadata.id}"`,
      );
    }

    const imagePath = path.join(this.baseDir, `${metadata.id}.png`);
    const metaPath = path.join(this.baseDir, `${metadata.id}.json`);

    // Atomic write: write to temp file, then rename into place
    const tmpImagePath = `${imagePath}.tmp`;
    const tmpMetaPath = `${metaPath}.tmp`;

    fs.writeFileSync(tmpImagePath, imageBuffer);
    fs.renameSync(tmpImagePath, imagePath);

    const metadataWithPath = { ...metadata, outputPath: imagePath };
    fs.writeFileSync(tmpMetaPath, JSON.stringify(metadataWithPath, null, 2));
    fs.renameSync(tmpMetaPath, metaPath);

    this.purgeOldOutputs();

    return imagePath;
  }

  /**
   * Get the most recent render metadata, or null if the store is empty.
   */
  getLatest(): RenderMetadata | null {
    const metaFiles = this.getMetaFilesSorted();
    if (metaFiles.length === 0) return null;
    return this.loadMetadata(metaFiles[0]);
  }

  /**
   * List all stored renders, newest first.
   */
  listAll(): RenderMetadata[] {
    return this.getMetaFilesSorted()
      .map((f) => this.loadMetadata(f))
      .filter((m): m is RenderMetadata => m !== null);
  }

  private getMetaFilesSorted(): string[] {
    return fs
      .readdirSync(this.baseDir)
      .filter((f) => f.endsWith(".json"))
      .sort((a, b) => b.localeCompare(a)) // descending: newest first (IDs are timestamp-prefixed)
      .map((f) => path.join(this.baseDir, f));
  }

  private loadMetadata(filePath: string): RenderMetadata | null {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as RenderMetadata;
    } catch {
      return null;
    }
  }

  private purgeOldOutputs(): void {
    const metaFiles = this.getMetaFilesSorted();

    while (metaFiles.length > this.maxOutputs) {
      const oldest = metaFiles.pop()!;
      const parsed = path.parse(oldest);
      const imagePath = path.join(parsed.dir, `${parsed.name}.png`);

      try {
        fs.unlinkSync(oldest);
      } catch {
        // Best-effort deletion; skip if file is locked or already removed
      }
      try {
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      } catch {
        // Best-effort deletion
      }
    }
  }
}
