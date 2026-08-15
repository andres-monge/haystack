// src/storage/output-store.ts -- MIME-aware render storage and safe resolution

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { RenderMetadata } from "../engine/types.js";
import {
  validateImage,
} from "../engine/image-validation.js";
import type { SupportedImageMimeType } from "../engine/provider-types.js";

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const IMAGE_FILE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;

const EXTENSION_BY_MIME: Record<SupportedImageMimeType, ".png" | ".jpg" | ".webp"> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

export interface ResolvedOutput {
  metadata: RenderMetadata;
  imagePath: string;
  mimeType: SupportedImageMimeType;
  extension: ".png" | ".jpg" | ".webp";
  downloadFilename: string;
  width: number;
  height: number;
  byteCount: number;
  sha256: string;
}

export interface OutputStoreHooks {
  /** Test seam for simulating a crash after image promotion. */
  beforeSidecarCommit?: () => void;
}

interface InspectedImage {
  mimeType: SupportedImageMimeType;
  extension: ResolvedOutput["extension"];
  width: number;
  height: number;
  byteCount: number;
  sha256: string;
}

async function inspectImage(bytes: Buffer): Promise<InspectedImage | null> {
  try {
    const validated = await validateImage(bytes);
    return {
      mimeType: validated.mimeType,
      extension: EXTENSION_BY_MIME[validated.mimeType],
      width: validated.width,
      height: validated.height,
      byteCount: validated.byteCount,
      sha256: validated.sha256,
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMetadata(value: unknown, expectedId: string): value is RenderMetadata {
  if (!isRecord(value) || value.id !== expectedId || !VALID_ID_PATTERN.test(expectedId)) {
    return false;
  }
  return (
    typeof value.artworkSource === "string"
    && isRecord(value.scenario)
    && typeof value.scenario.timestampLocal === "string"
    && typeof value.scenario.hour === "number"
    && typeof value.scenario.isDay === "boolean"
    && typeof value.prompt === "string"
    && typeof value.model === "string"
    && typeof value.createdAt === "string"
    && typeof value.outputPath === "string"
  );
}

export class OutputStore {
  private readonly baseDir: string;
  private readonly maxOutputs: number;
  private readonly hooks: OutputStoreHooks;

  constructor(
    baseDir: string,
    maxOutputs: number = 24,
    hooks: OutputStoreHooks = {},
  ) {
    if (!Number.isInteger(maxOutputs) || maxOutputs < 1) {
      throw new RangeError(`maxOutputs must be a positive integer, got ${maxOutputs}`);
    }
    this.baseDir = path.resolve(baseDir);
    this.maxOutputs = maxOutputs;
    this.hooks = hooks;
    fs.mkdirSync(this.baseDir, { recursive: true });
    this.cleanupUncommitted();
  }

  /** Save an image, promoting the sidecar last as the commit point. */
  async save(imageBuffer: Buffer, metadata: RenderMetadata): Promise<string> {
    this.assertValidId(metadata.id);
    const inspected = await inspectImage(imageBuffer);
    if (!inspected) {
      throw new Error("Output must contain valid PNG, JPEG, or WebP bytes");
    }

    const imagePath = this.pathFor(`${metadata.id}${inspected.extension}`);
    const metaPath = this.pathFor(`${metadata.id}.json`);
    if (fs.existsSync(metaPath) || this.findImageSiblings(metadata.id).length > 0) {
      throw new Error(`Output already exists for render ${metadata.id}`);
    }

    const nonce = randomUUID();
    const tmpImagePath = this.pathFor(`.${metadata.id}.${nonce}.image.tmp`);
    const tmpMetaPath = this.pathFor(`.${metadata.id}.${nonce}.json.tmp`);
    const orphanMarkerPath = this.pathFor(`.${metadata.id}.orphan`);
    const persisted: RenderMetadata = {
      ...metadata,
      outputPath: imagePath,
      mimeType: inspected.mimeType,
      width: inspected.width,
      height: inspected.height,
      byteCount: inspected.byteCount,
      sha256: inspected.sha256,
    };

    try {
      fs.writeFileSync(tmpImagePath, imageBuffer, { flag: "wx" });
      const tempInspection = await inspectImage(fs.readFileSync(tmpImagePath));
      if (!tempInspection || tempInspection.sha256 !== inspected.sha256) {
        throw new Error("Temporary output image validation failed");
      }

      const serialized = JSON.stringify(persisted, null, 2);
      fs.writeFileSync(tmpMetaPath, serialized, { flag: "wx" });
      const parsed = JSON.parse(fs.readFileSync(tmpMetaPath, "utf8")) as unknown;
      if (!isMetadata(parsed, metadata.id)) {
        throw new Error("Temporary output metadata validation failed");
      }

      fs.writeFileSync(orphanMarkerPath, metadata.id, { flag: "wx" });
      fs.renameSync(tmpImagePath, imagePath);
      this.hooks.beforeSidecarCommit?.();
      fs.renameSync(tmpMetaPath, metaPath);
      this.unlinkBestEffort(orphanMarkerPath);
    } finally {
      this.unlinkBestEffort(tmpImagePath);
      this.unlinkBestEffort(tmpMetaPath);
    }

    try {
      await this.purgeOldOutputs();
    } catch {
      // The render is already committed; retention remains best effort.
    }
    return imagePath;
  }

  /** Resolve a committed ID without trusting outputPath or file extensions. */
  async resolve(id: string): Promise<ResolvedOutput | null> {
    if (!VALID_ID_PATTERN.test(id)) return null;
    const metadata = this.loadMetadata(this.pathFor(`${id}.json`), id);
    if (!metadata) return null;

    const candidates = this.findImageSiblings(id);
    if (candidates.length !== 1) return null;
    const imagePath = candidates[0];
    let inspected: InspectedImage | null;
    try {
      inspected = await inspectImage(fs.readFileSync(imagePath));
    } catch {
      return null;
    }
    if (!inspected) return null;
    if (
      (metadata.mimeType !== undefined && metadata.mimeType !== inspected.mimeType)
      || (metadata.width !== undefined && metadata.width !== inspected.width)
      || (metadata.height !== undefined && metadata.height !== inspected.height)
      || (metadata.byteCount !== undefined && metadata.byteCount !== inspected.byteCount)
      || (metadata.sha256 !== undefined && metadata.sha256 !== inspected.sha256)
    ) return null;

    return {
      metadata: {
        ...metadata,
        outputPath: imagePath,
        mimeType: inspected.mimeType,
        width: inspected.width,
        height: inspected.height,
        byteCount: inspected.byteCount,
        sha256: inspected.sha256,
      },
      imagePath,
      ...inspected,
      downloadFilename: `haystack-${id}${inspected.extension}`,
    };
  }

  async getLatest(): Promise<RenderMetadata | null> {
    for (const id of this.getCommittedIdsSorted()) {
      const output = await this.resolve(id);
      if (output) return output.metadata;
    }
    return null;
  }

  async listAll(): Promise<RenderMetadata[]> {
    return (await this.listResolved()).map(output => output.metadata);
  }

  private async listResolved(): Promise<ResolvedOutput[]> {
    const outputs: ResolvedOutput[] = [];
    for (const id of this.getCommittedIdsSorted()) {
      const output = await this.resolve(id);
      if (output) outputs.push(output);
    }
    return outputs;
  }

  private getCommittedIdsSorted(): string[] {
    return fs.readdirSync(this.baseDir)
      .filter(file => file.endsWith(".json") && !file.startsWith("."))
      .sort((a, b) => b.localeCompare(a))
      .map(file => file.slice(0, -".json".length));
  }

  private loadMetadata(filePath: string, expectedId: string): RenderMetadata | null {
    try {
      if (!fs.lstatSync(filePath).isFile()) return null;
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      return isMetadata(parsed, expectedId) ? parsed : null;
    } catch {
      return null;
    }
  }

  private findImageSiblings(id: string): string[] {
    this.assertValidId(id);
    return IMAGE_FILE_EXTENSIONS
      .map(extension => this.pathFor(`${id}${extension}`))
      .filter(candidate => {
        try {
          return fs.lstatSync(candidate).isFile();
        } catch {
          return false;
        }
      });
  }

  private cleanupUncommitted(): void {
    const files = fs.readdirSync(this.baseDir);
    for (const file of files) {
      if (file.endsWith(".tmp")) {
        this.unlinkBestEffort(this.pathFor(file));
      }
    }
    for (const file of files) {
      const match = /^\.([a-zA-Z0-9_-]+)\.orphan$/.exec(file);
      if (!match) continue;
      const id = match[1];
      const metadataPath = this.pathFor(`${id}.json`);
      if (!this.loadMetadata(metadataPath, id)) {
        for (const imagePath of this.findImageSiblings(id)) {
          this.unlinkBestEffort(imagePath);
        }
      }
      this.unlinkBestEffort(this.pathFor(file));
    }
  }

  private async purgeOldOutputs(): Promise<void> {
    const committed = await this.listResolved();
    for (const output of committed.slice(this.maxOutputs)) {
      // Remove the sidecar first so a crash cannot leave a listed missing image.
      const metadataPath = this.pathFor(`${output.metadata.id}.json`);
      this.unlinkBestEffort(metadataPath);
      if (!fs.existsSync(metadataPath)) {
        this.unlinkBestEffort(output.imagePath);
      }
    }
  }

  private pathFor(basename: string): string {
    if (path.basename(basename) !== basename) {
      throw new Error("Output basename must not contain a directory");
    }
    const candidate = path.join(this.baseDir, basename);
    if (path.dirname(candidate) !== this.baseDir) {
      throw new Error("Output path escapes the configured directory");
    }
    return candidate;
  }

  private assertValidId(id: string): void {
    if (!VALID_ID_PATTERN.test(id)) {
      throw new Error(
        `Invalid metadata id: must contain only alphanumeric characters, dashes, and underscores, got "${id}"`,
      );
    }
  }

  private unlinkBestEffort(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Cleanup and retention are best effort.
    }
  }
}
