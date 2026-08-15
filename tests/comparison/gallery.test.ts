import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFixtureManifest,
  renderGallery,
  writeGallery,
  writeFixtureGallery,
} from "../../src/comparison/gallery.js";
import type { BakeOffManifest } from "../../src/comparison/bake-off.js";

describe("comparison gallery", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("shows successful images only with grouped labels, counts, and relative paths", () => {
    const manifest = createFixtureManifest();
    const html = renderGallery(manifest);

    expect(html).toContain("Hopper");
    expect(html).toContain("Heavy rain");
    expect(html).toContain("gemini-3.1-flash-lite-image");
    expect(html).toContain("gpt-image-2");
    expect(html).toContain("grok-imagine-image-2.0");
    expect(html).toContain("1536x1024 / low");
    expect(html).toContain("~$0.005 output + input text/image tokens");
    expect(html).toContain("Price estimate (2026-08-15)");
    expect(html).toContain('src="images/');
    expect(html).toContain('class="image-link" href="images/');
    expect(html).toContain('target="_blank" rel="noopener"');
    expect(html).toContain("Click any image to open it at full resolution.");
    expect(html).toContain("Successful 2");
    expect(html).toContain("Unsuccessful 2");
    expect(html).toContain("Error 2");
    expect(html).not.toContain("no_image");
    expect(html).not.toContain("rate_limit");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain(".card img { display: block; width: 100%; height: auto;");
    expect(html).not.toContain("object-fit: cover");
  });

  it("escapes labels and rejects unsafe image paths", () => {
    const manifest = createFixtureManifest();
    const successful = manifest.cells.find(cell => cell.status === "successful");
    if (!successful || successful.status !== "successful") {
      throw new Error("Fixture must contain a successful cell");
    }
    manifest.runId = '<img src=x onerror="alert(1)">';
    successful.imagePath = "../secret.png";

    const html = renderGallery(manifest);

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("../secret.png");
    expect(html).not.toContain("onerror=\"alert(1)\"");
  });

  it("renders an explicit empty-success state and responsive CSS", () => {
    const manifest = createFixtureManifest();
    manifest.cells = manifest.cells.map(cell => ({
      ...cell,
      status: "unsuccessful" as const,
      reason: "no_image" as const,
      imagePath: undefined,
      mimeType: undefined,
    })).map(({ imagePath: _imagePath, mimeType: _mimeType, ...cell }) => cell);

    const html = renderGallery(manifest as BakeOffManifest);

    expect(html).toContain("No successful transformations in this run.");
    expect(html).toContain("@media (max-width: 720px)");
    expect(html).not.toContain("<img");
  });

  it("writes a standalone gallery atomically", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-gallery-"));
    const outputPath = path.join(tempDir, "gallery.html");

    writeGallery(createFixtureManifest(), outputPath);

    expect(fs.readFileSync(outputPath, "utf8")).toContain("<!doctype html>");
    expect(fs.existsSync(`${outputPath}.tmp`)).toBe(false);
  });

  it("materializes a complete fixture gallery without provider dependencies", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-fixture-gallery-"));

    const result = writeFixtureGallery(tempDir);

    expect(result.manifest.cells).toHaveLength(18);
    expect(fs.existsSync(result.galleryPath)).toBe(true);
    expect(fs.existsSync(result.manifestPath)).toBe(true);
    for (const cell of result.manifest.cells) {
      if (cell.status === "successful") {
        expect(fs.existsSync(path.join(tempDir, cell.imagePath))).toBe(true);
      }
    }
  });
});
