---
title: "Extend Artwork — Reimagine Any Image as 16:9 Landscape"
type: feat
date: 2026-03-12
---

# ✨ Extend Artwork — Reimagine Any Image as 16:9 Landscape

## Overview

A Claude Code skill (`/extend-artwork`) that takes any image — portrait, square, cropped — and uses Gemini's layout-aware outpainting to reimagine it as a 16:9 landscape suitable for Haystack's daily artwork rotation. The skill wraps a TypeScript script that handles the deterministic work (Gemini API, file I/O), while Claude handles the fuzzy parts (inspecting results, suggesting retries, adapting to errors).

## Problem Statement / Motivation

Haystack's artwork rotation needs 16:9 landscape images, but interesting art is everywhere — Instagram posts (4:5), Pinterest pins (2:3), screenshots (arbitrary), stock photos (random ratios). Manually cropping or resizing loses composition. Gemini's outpainting can intelligently extend the canvas, preserving style and adding natural continuation of the scene.

**The bottleneck isn't finding art — it's transforming it to 16:9.**

## Proposed Solution

Two deliverables:

1. **`scripts/extend-artwork.ts`** — A standalone script (run via `npx tsx`) that reads an image, calls Gemini with `aspectRatio: "16:9"`, and saves the result to `HAYSTACK_IMAGE_DIR`.

2. **`.claude/skills/extend-artwork/SKILL.md`** — A user-triggered Claude Code skill that invokes the script, inspects the result, and offers retry with custom prompts.

### Workflow

```
1. Save an image you like to your Mac (any method)
2. Run:  /extend-artwork ~/Downloads/cool-porsche.jpg
3. Script calls Gemini → reimagines as 16:9 landscape
4. Result saved to HAYSTACK_IMAGE_DIR, opened in Preview.app
5. Claude reports the result — you inspect and keep or retry
```

## Technical Considerations

### Architecture

The script is a thin wrapper around the existing `GeminiClient` — no new abstractions needed. It imports `GeminiClient` and `loadConfigFromEnv()` from the engine, not `Pipeline` or `OutputStore`.

```
scripts/extend-artwork.ts
  ├── imports: GeminiClient, loadConfigFromEnv
  ├── reads: input image path (argv), optional custom prompt (argv)
  ├── calls: GeminiClient.editImage(path, prompt, { aspectRatio: "16:9" })
  ├── writes: output to HAYSTACK_IMAGE_DIR (atomic: .tmp → rename)
  ├── writes: metadata sidecar JSON alongside output
  ├── opens: result in Preview.app (best-effort)
  └── prints: JSON result to stdout for skill to parse

.claude/skills/extend-artwork/SKILL.md
  ├── name: extend-artwork
  ├── disable-model-invocation: true
  └── instructions: run script, inspect, offer retry
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Image source | Source-agnostic (file path) | "Save Image As" already solves acquisition for any platform |
| Model | Use configured `HAYSTACK_MODEL` | Respects user's existing choice, no separate config |
| API client | Reuse `GeminiClient` | DRY — already handles encoding, MIME, errors, timeout |
| Output location | Direct to `HAYSTACK_IMAGE_DIR` | Rotation system auto-reconciles; no staging step needed |
| Trigger | User-only (`disable-model-invocation: true`) | Extending artwork is an intentional creative act |
| Metadata | JSON sidecar alongside image | Provenance tracking: source, prompt, model, timestamp |

### Filename Derivation

```
Input:  ~/Downloads/cool-porsche.jpg
Output: $HAYSTACK_IMAGE_DIR/cool-porsche-landscape.png
Sidecar: $HAYSTACK_IMAGE_DIR/cool-porsche-landscape.json
```

Rules:
- Strip directory and extension from input filename
- Strip existing `-landscape` suffix if present (prevents `foo-landscape-landscape.png`)
- Sanitize to alphanumeric + dash + underscore only
- Append `-landscape.png`
- On collision: **overwrite** (user is present and supervising; retry replaces previous attempt)

### Error Handling Matrix

| Scenario | Script Behavior | Skill Behavior |
|----------|----------------|----------------|
| File not found | Exit 1, clear message | Claude reports, suggests checking path |
| HEIC format detected | Exit 1, suggest `sips` conversion command | Claude offers to run the conversion |
| File too large (>20MB) | Exit 1, report size limit | Claude suggests resizing first |
| `HAYSTACK_IMAGE_DIR` not set | Exit 1, explain which env var to set | Claude guides setup |
| Gemini timeout (60s) | Exit 1, report timeout | Claude suggests retry |
| IMAGE_OTHER (copyright) | Exit 1, report rejection reason | Claude explains and suggests different image |
| Safety filter triggered | Exit 1, report filter category | Claude explains the limitation |
| 429 rate limit | Exit 1, report rate limit | Claude suggests waiting |
| `open` command fails | Warn to stderr, continue (best-effort) | Claude reports path regardless |

### HEIC Handling

iPhones save photos as HEIC by default. AirDropping art from phone to Mac is a natural workflow. The script should detect HEIC magic bytes (`ftyp` at offset 4) and fail early with an actionable message:

```
HEIC format not supported by Gemini. Convert first:
  sips -s format jpeg input.heic --out output.jpg
```

The skill can offer to run this conversion command for the user.

### Atomic Writes

Follow the established pattern from `output-store.ts`:
1. Write to `<output-path>.tmp`
2. `fs.renameSync` to final path
3. Same for sidecar JSON

This prevents corrupt files in the rotation directory if the script is interrupted.

### imageSize Consideration

The brainstorm specifies `imageSize: "1K"`. The TypeScript types comment says "Only for pro model" but brainstorm research says Flash supports it too. **Implementation should test empirically with Flash.** If Flash rejects it, make conditional (only set for Pro). If it works, update the type comment.

## Acceptance Criteria

### Script (`scripts/extend-artwork.ts`)

- [x] Accepts image path as first argument, optional custom prompt as second
- [x] Loads config via `loadConfigFromEnv()` (dotenv loaded first)
- [x] Validates: file exists, supported format (JPEG/PNG/WebP), `HAYSTACK_IMAGE_DIR` is set
- [x] Detects HEIC and exits with actionable conversion instructions
- [x] Calls `GeminiClient.editImage()` with `aspectRatio: "16:9"` and configured model
- [x] Derives output filename: sanitized input name + `-landscape.png`
- [x] Writes output using atomic pattern (`.tmp` → rename) to `HAYSTACK_IMAGE_DIR`
- [x] ~~Writes metadata sidecar JSON~~ — removed, unnecessary
- [x] Opens result in Preview.app (best-effort, does not fail if `open` errors)
- [x] Prints JSON result to stdout: `{ outputPath, sidecarPath, model, dimensions }`
- [x] Handles all error scenarios with clear exit codes and messages

### Skill (`.claude/skills/extend-artwork/SKILL.md`)

- [x] Named `extend-artwork`, `disable-model-invocation: true`
- [x] Instructions tell Claude to run `npx tsx scripts/extend-artwork.ts <path> [prompt]`
- [x] Claude parses stdout JSON, reports result path and key metadata
- [x] On success: ask if user wants to keep or retry with custom prompt
- [x] On retry: re-run with user's custom prompt (overwrites previous attempt)
- [x] On HEIC error: offer to run `sips` conversion, then retry
- [x] On IMAGE_OTHER: explain copyright concern, suggest different image
- [x] On other errors: report clearly, suggest next steps

### Integration

- [x] New file in `HAYSTACK_IMAGE_DIR` is picked up by rotation system (existing `reconcileQueue` — no changes needed)
- [x] Metadata sidecar does not interfere with rotation (`.json` not in image extension list)

## Dependencies & Risks

**Dependencies:**
- Existing `GeminiClient` API (stable, no changes needed)
- Existing `loadConfigFromEnv()` (stable, no changes needed)
- `HAYSTACK_IMAGE_DIR` must be configured in `.env.local`
- Gemini API access (already required for Haystack)

**Risks:**
- **imageSize: "1K" on Flash** — may not be supported despite brainstorm research. Mitigation: test and make conditional if needed.
- **Gemini outpainting quality** — results vary by input. Mitigation: retry with custom prompt is a core feature of the skill.
- **Copyright detection (IMAGE_OTHER)** — found art is more likely to trigger this than curated base images. Mitigation: clear error messaging and user education via skill.

## Implementation Checklist

### Files to Create

| File | Purpose |
|------|---------|
| `scripts/extend-artwork.ts` | Main script — Gemini outpainting |
| `.claude/skills/extend-artwork/SKILL.md` | Claude Code skill definition |

### Files to Reference (read-only)

| File | What to Reuse |
|------|---------------|
| `src/engine/gemini-client.ts` | `GeminiClient` class, `editImage()` API |
| `src/config/config.ts` | `loadConfigFromEnv()` |
| `src/engine/types.ts` | `GeminiConfig`, `EditImageResult` types |
| `src/storage/output-store.ts` | Atomic write pattern, sidecar pattern |
| `src/cli/generate.ts` | dotenv loading pattern, CLI error handling |
| `.claude/skills/agent-browser/SKILL.md` | Skill YAML structure reference |
| `src/server/image-rotation.ts` | Verify `scanImages()` ignores `.json` files |

### Default Prompt

```
Reimagine this artwork as a wide 16:9 landscape scene. Expand the composition
naturally — extend the environment, architecture, and atmosphere to fill the
wider frame. Preserve the EXACT artistic style, medium, color palette, and
rendering technique of the original. Do not crop, stretch, or distort any
existing elements. The extended areas should feel like a natural continuation
of the original scene.
```

## References & Research

### Internal

- Brainstorm: [2026-03-12-extend-artwork-brainstorm.md](docs/brainstorms/2026-03-12-extend-artwork-brainstorm.md)
- GeminiClient: [gemini-client.ts](src/engine/gemini-client.ts) — `editImage()` at line 51, `detectMimeType` at line 127
- Config: [config.ts](src/config/config.ts) — `loadConfigFromEnv()` at line 134, `imageDir` at line 153
- Output store: [output-store.ts](src/storage/output-store.ts) — atomic write pattern at line 21
- Rotation: [image-rotation.ts](src/server/image-rotation.ts) — `reconcileQueue()` at line 116, `scanImages()` at line 83
- CLI pattern: [generate.ts](src/cli/generate.ts) — dotenv + config loading pattern
- Existing skill: [agent-browser/SKILL.md](.claude/skills/agent-browser/SKILL.md) — YAML structure

### Gemini Capabilities (Confirmed in Brainstorm)

- Both Flash and Pro support `imageConfig.aspectRatio: "16:9"` for output
- Both support `imageConfig.imageSize: "1K"` (Pro also: "2K", "4K") — needs empirical verification on Flash
- Image editing: input image + text prompt → output at requested aspect ratio
- This is "layout-aware outpainting" — Gemini reasons about what should fill the extended canvas
