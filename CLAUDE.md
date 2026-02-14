# Haystack — Living Art Wallpaper

AI-powered macOS wallpaper that evolves hourly based on time and weather. Uses Gemini image editing to transform a base artwork.

## Project status

Early development.

## Task tracking

Build tasks are in `.claude/tasks/`. Read `tasks.md` for the roadmap and dependency graph, then `{1..11}.json` for full details on each task. Update the checkboxes and progress table in `tasks.md` as tasks are completed.

## Tech stack

- TypeScript + Node.js (ES modules, `"type": "module"`)
- `@google/genai` SDK for Gemini image editing
- Vitest for testing
- `tsx` for running TypeScript directly

## Build & run

```bash
npm run build        # tsc
npm run dev          # tsc --watch
npm run test         # vitest (watch mode)
npm run test:run     # vitest run (single pass)
npx tsx examples/basic-edit.ts <image> [hour]  # quick test
```

## Code style

- ES modules only — use `import`/`export`, never `require`
- Use `.js` extensions in relative imports (TypeScript NodeNext resolution)
- Strict TypeScript — no implicit `any`
- Prefer `node:` prefix for built-in modules (`import * as fs from "node:fs"`)

## Architecture

The engine is a pure Node.js module — it CANNOT run in browsers. It uses `fs`, `os`, `crypto` and holds the API key. Lab UI (Phase A3) must communicate with the engine via a local HTTP server or Electron IPC, not direct imports.

```
src/engine/     — Core pipeline: scenario → prompt → Gemini API → output
src/storage/    — Output store (images + metadata JSON sidecars)
src/config/     — Environment-based configuration
src/cli/        — CLI entry point for launchd scheduler
```

## Key design rules

- ALWAYS generate from the original base image, never from previous output (prevents drift)
- Every generation saves a metadata JSON sidecar alongside the image
- Metadata must be JSON-safe — use ISO 8601 strings for dates, not Date objects
- Purge policy: keep last N outputs (default 24), delete older
- Aspect ratio: omit `aspectRatio` config to let API match the input image's ratio

## Gemini models

| Model | ID | Use case |
|-------|----|----------|
| Flash Image | `gemini-2.5-flash-image` | Fast iteration, hourly updates |
| Pro Image | `gemini-3-pro-image-preview` | High quality, up to 4K |

## Environment variables

```
GOOGLE_API_KEY or GEMINI_API_KEY  — Required. Gemini API key.
HAYSTACK_OUTPUT_DIR               — Output directory (default: ~/.haystack/outputs)
HAYSTACK_MODEL                    — Model ID (default: gemini-2.5-flash-image)
HAYSTACK_ASPECT_RATIO             — Optional, omit to match input
HAYSTACK_SEED                     — Optional, for reproducible outputs
HAYSTACK_MAX_OUTPUTS              — Max stored outputs (default: 24)
```

## Phased roadmap

- **Phase A1** (current): Engine + pipeline + CLI
- **A2**: Wallpaper apply via `desktoppr`
- **A3**: Lab UI (localhost web app for prompt iteration)
- **A4**: `launchd` hourly scheduler
- **A5**: Weather integration (Open-Meteo)
- **Phase B**: macOS Menu Bar app (Electron)
- **Phase C**: Always-on TV kiosk (Raspberry Pi)

## Weather API

Open-Meteo (no API key required). Uses WMO weather codes. Provider interface is abstracted for swapping.
