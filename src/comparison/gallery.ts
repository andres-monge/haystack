import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./artifacts.js";
import { ROUND1_PRICE_AS_OF, ROUND1_PROVIDER_SPECS } from "./providers.js";
import type { BakeOffCell, BakeOffManifest } from "./bake-off.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeImagePath(value: string): string | undefined {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (
    normalized === "."
    || normalized.startsWith("../")
    || normalized.startsWith("/")
    || /^[a-z][a-z0-9+.-]*:/i.test(normalized)
  ) return undefined;
  return normalized.split("/").map(encodeURIComponent).join("/");
}

function titleCaseProvider(provider: string): string {
  if (provider === "xai") return "xAI";
  if (provider === "openai") return "OpenAI";
  return "Gemini";
}

function statusCounts(manifest: BakeOffManifest, model: string): string {
  const cells = manifest.cells.filter(cell => cell.model === model);
  const count = (status: BakeOffCell["status"]) =>
    cells.filter(cell => cell.status === status).length;
  return `
    <div class="count-row">
      <span class="count success">Successful ${count("successful")}</span>
      <span class="count unsuccessful">Unsuccessful ${count("unsuccessful")}</span>
      <span class="count error">Error ${count("error")}</span>
    </div>`;
}

function renderCard(cell: Extract<BakeOffCell, { status: "successful" }>): string {
  const imagePath = safeImagePath(cell.imagePath);
  if (!imagePath) return "";
  const imageLabel = `${cell.artworkLabel}, ${cell.weatherLabel}, ${cell.model}`;
  return `
      <article class="card">
        <a class="image-link" href="${escapeHtml(imagePath)}" target="_blank" rel="noopener" aria-label="${escapeHtml(`Open ${imageLabel} at full resolution`)}">
          <img src="${escapeHtml(imagePath)}" alt="${escapeHtml(imageLabel)}">
        </a>
        <div class="card-body">
          <p class="provider">${escapeHtml(titleCaseProvider(cell.provider))}</p>
          <h3>${escapeHtml(cell.model)}</h3>
          <dl>
            <div><dt>Setting</dt><dd>${escapeHtml(cell.outputSetting)}</dd></div>
            <div><dt>Elapsed</dt><dd>${cell.elapsedMs.toLocaleString("en-US")} ms</dd></div>
            <div><dt>Price estimate (${escapeHtml(cell.priceAsOf)})</dt><dd>${escapeHtml(cell.priceEstimate)}</dd></div>
          </dl>
        </div>
      </article>`;
}

export function renderGallery(manifest: BakeOffManifest): string {
  const models = [...new Set(manifest.cells.map(cell => cell.model))];
  const successful = manifest.cells.filter(
    (cell): cell is Extract<BakeOffCell, { status: "successful" }> =>
      cell.status === "successful" && safeImagePath(cell.imagePath) !== undefined,
  );
  const groupKeys = [...new Set(successful.map(cell => `${cell.artworkId}\u0000${cell.weatherId}`))];
  const groups = groupKeys.map(key => {
    const [artworkId, weatherId] = key.split("\u0000");
    const cells = successful.filter(
      cell => cell.artworkId === artworkId && cell.weatherId === weatherId,
    );
    const first = cells[0];
    return `
    <section class="case">
      <div class="case-heading">
        <p>${escapeHtml(first.artworkLabel)}</p>
        <h2>${escapeHtml(first.weatherLabel)}</h2>
      </div>
      <div class="cards">${cells.map(renderCard).join("")}
      </div>
    </section>`;
  }).join("");

  const content = successful.length > 0
    ? groups
    : '<p class="empty">No successful transformations in this run.</p>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'">
  <title>Haystack image model bake-off</title>
  <style>
    :root { color-scheme: light; --ink: #17211c; --muted: #5c6962; --paper: #f5f0e7; --card: #fffdf8; --line: #d8d1c5; --green: #256a4b; --amber: #93641e; --red: #94443d; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(1480px, calc(100% - 48px)); margin: 0 auto; padding: 56px 0 80px; }
    header { display: grid; gap: 12px; margin-bottom: 36px; }
    h1, h2, h3, p { margin: 0; }
    h1 { max-width: 850px; font: 700 clamp(2.2rem, 6vw, 5.2rem)/.95 Georgia, serif; letter-spacing: -.04em; }
    .run-meta { color: var(--muted); }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 30px 0 48px; }
    .model-summary { padding: 18px; border: 1px solid var(--line); border-radius: 14px; background: rgba(255, 253, 248, .75); }
    .model-summary h2 { overflow-wrap: anywhere; font-size: 1rem; }
    .count-row { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
    .count { padding: 3px 8px; border-radius: 999px; font-size: .75rem; font-weight: 700; }
    .success { color: var(--green); background: #dfeee6; }
    .unsuccessful { color: var(--amber); background: #f6e9ca; }
    .error { color: var(--red); background: #f3dcda; }
    .case { margin-top: 48px; }
    .case-heading { display: flex; align-items: baseline; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
    .case-heading p { color: var(--muted); font-size: .82rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .case-heading h2 { font: 700 2rem/1.1 Georgia, serif; }
    .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin-top: 18px; }
    .card { overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: var(--card); box-shadow: 0 12px 32px rgba(49, 42, 31, .07); }
    .image-link { display: block; overflow: hidden; cursor: zoom-in; }
    .image-link:focus-visible { outline: 4px solid var(--green); outline-offset: -4px; }
    .card img { display: block; width: 100%; height: auto; background: #dfd9ce; }
    .image-link img { transition: transform 160ms ease, filter 160ms ease; }
    .image-link:hover img { transform: scale(1.015); filter: brightness(.96); }
    .card-body { padding: 18px; }
    .provider { color: var(--muted); font-size: .75rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .card h3 { margin-top: 3px; overflow-wrap: anywhere; font-size: 1.05rem; }
    dl { display: grid; gap: 8px; margin: 18px 0 0; }
    dl div { display: grid; grid-template-columns: 104px 1fr; gap: 10px; }
    dt { color: var(--muted); font-size: .78rem; }
    dd { margin: 0; font-size: .78rem; font-weight: 650; }
    .empty { padding: 54px 24px; border: 1px dashed var(--line); border-radius: 16px; text-align: center; color: var(--muted); background: rgba(255, 253, 248, .55); }
    @media (max-width: 980px) { .summary, .cards { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 720px) { main { width: min(100% - 28px, 640px); padding-top: 32px; } .summary, .cards { grid-template-columns: 1fr; } .case-heading { align-items: flex-start; flex-direction: column; gap: 3px; } dl div { grid-template-columns: 92px 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="run-meta">Round 1 · ${escapeHtml(manifest.runId)} · ${escapeHtml(manifest.state)}</p>
      <h1>Successful weather transformations</h1>
      <p class="run-meta">Only supported image outputs are shown. Visual judgment stays with you.</p>
      <p class="run-meta">Click any image to open it at full resolution.</p>
    </header>
    <section class="summary" aria-label="Per-model status counts">${models.map(model => `
      <article class="model-summary">
        <h2>${escapeHtml(model)}</h2>${statusCounts(manifest, model)}
      </article>`).join("")}
    </section>
    ${content}
  </main>
</body>
</html>
`;
}

export function writeGallery(manifest: BakeOffManifest, outputPath: string): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  atomicWriteFile(outputPath, renderGallery(manifest));
}

const FIXTURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export function createFixtureManifest(): BakeOffManifest {
  const createdAt = "2026-08-15T12:00:00.000Z";
  const models = Object.values(ROUND1_PROVIDER_SPECS);
  const cases = [
    ["hopper", "Hopper", "heavy-rain", "Heavy rain"],
    ["hopper", "Hopper", "heavy-snow", "Heavy snow"],
    ["hopper", "Hopper", "dense-fog", "Dense fog"],
    ["hotel-adriano", "Hotel Adriano", "heavy-rain", "Heavy rain"],
    ["hotel-adriano", "Hotel Adriano", "heavy-snow", "Heavy snow"],
    ["hotel-adriano", "Hotel Adriano", "dense-fog", "Dense fog"],
  ] as const;
  const scenario = {
    timestampLocal: "2026-01-15T12:00:00.000Z",
    hour: 12,
    isDay: true,
  };
  const cells: BakeOffCell[] = cases.flatMap((caseDetails, caseIndex) =>
    models.map((modelDetails, modelIndex): BakeOffCell => {
      const [artworkId, artworkLabel, weatherId, weatherLabel] = caseDetails;
      const { provider, model, outputSetting, priceEstimate } = modelDetails;
      const base = {
        id: `${artworkId}--${weatherId}--${provider}`,
        artworkId,
        artworkLabel,
        artworkSource: `artwork/${artworkId}.png`,
        weatherId,
        weatherLabel,
        scenario,
        prompt: `Fixture prompt for ${weatherLabel}`,
        provider,
        model,
        outputSetting,
        priceEstimate,
        priceAsOf: ROUND1_PRICE_AS_OF,
        elapsedMs: 1_200 + (caseIndex * 100) + modelIndex,
        createdAt,
      };
      const outcome = (caseIndex + modelIndex) % 3;
      if (outcome === 0) {
        return {
          ...base,
          status: "successful",
          imagePath: `images/${base.id}.png`,
          mimeType: "image/png",
        };
      }
      if (outcome === 1) {
        return { ...base, status: "unsuccessful", reason: "no_image" };
      }
      return { ...base, status: "error", category: "rate_limit" };
    }),
  );
  return {
    schemaVersion: 1,
    runId: "fixture-round1",
    round: "round1",
    state: "completed",
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
    priceAsOf: ROUND1_PRICE_AS_OF,
    plannedCellCount: 18,
    cells,
  };
}

export function writeFixtureGallery(runDir: string): {
  manifest: BakeOffManifest;
  manifestPath: string;
  galleryPath: string;
} {
  const manifest = createFixtureManifest();
  const imageDirectory = path.join(runDir, "images");
  fs.mkdirSync(imageDirectory, { recursive: true });
  for (const cell of manifest.cells) {
    if (cell.status === "successful") {
      atomicWriteFile(path.join(runDir, cell.imagePath), FIXTURE_PNG);
    }
  }
  const manifestPath = path.join(runDir, "manifest.json");
  atomicWriteFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const galleryPath = path.join(runDir, "gallery.html");
  writeGallery(manifest, galleryPath);
  return { manifest, manifestPath, galleryPath };
}
