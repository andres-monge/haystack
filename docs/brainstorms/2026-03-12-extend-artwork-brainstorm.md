# Brainstorm: Extend Artwork — Reimagine Any Image as 16:9 Landscape

**Date:** 2026-03-12
**Status:** Complete

## What We're Building

A Claude Code skill (`/extend-artwork`) that takes any image — a portrait Instagram post, a square Pinterest pin, a cropped screenshot — and uses Gemini's image editing to reimagine it as a 16:9 landscape suitable for Haystack's daily artwork rotation.

### Core capabilities

1. **Image-to-landscape transformation** via Gemini's native outpainting. Provide any image, get back a 16:9 landscape at 1K resolution. Gemini intelligently expands the composition, extending the environment while preserving the original artistic style.

2. **Claude Code skill** (`/extend-artwork <image-path>`) — user-triggered only. Claude runs a bundled script, inspects the result, and reports back. Supports an optional custom prompt for tricky images.

3. **Source-agnostic** — works with any image file (JPEG, PNG, WebP). The user saves the image however they want (right-click save, screenshot, Instaloader, browser extension). The tool doesn't care where it came from.

### Workflow

```
1. Save an image you like to your Mac (any location)
2. Run: /extend-artwork ~/Downloads/cool-porsche.jpg
3. Script calls Gemini to reimagine as 16:9 landscape
4. Result saved to HAYSTACK_IMAGE_DIR, opened in Preview.app
5. Claude reports the result — you inspect and keep or retry
```

## Why This Approach

### Decision: Claude Code skill over standalone script

A skill wraps the script with Claude's intelligence. The script handles the deterministic work (Gemini API call, file I/O), while the skill lets Claude handle the fuzzy parts (inspecting results, suggesting retries, adapting to errors). The skill is discoverable via `/extend-artwork` and lives in the project repo.

**Rationale:** The complexity lives in convention (remember to run the skill), not in code or infrastructure. No pipeline changes, no auto-detection logic, no new server endpoints.

### Decision: Source-agnostic input (no Instagram API)

Instagram has no clean public API for downloading images. Tools like Instaloader exist but require login and break frequently. The practical reality: you save an image to disk (right-click, screenshot, whatever) and feed the file to the tool.

**Rationale:** The bottleneck isn't getting the image off Instagram — it's transforming it to 16:9. Building Instagram-specific fetching adds fragile complexity for a problem that's already solved by "Save Image As." This also makes the tool work for any image source (Pinterest, Twitter/X, stock photos, AI art, etc.).

### Decision: Use configured HAYSTACK_MODEL (not hardcoded)

The script uses whatever model is set in `.env.local` as `HAYSTACK_MODEL`. This respects the user's existing model choice and avoids a separate config.

**Rationale:** If Flash is good enough for hourly generation, it's good enough for artwork extension. If you later switch to Pro for higher quality, the extend tool benefits automatically.

### Decision: Reuse existing GeminiClient

The script imports and reuses the existing `GeminiClient` from `src/engine/gemini-client.ts` rather than making raw API calls. The only difference: it passes explicit `aspectRatio: "16:9"` and `imageSize: "1K"` in the image config.

**Rationale:** DRY. The existing client already handles base64 encoding, MIME detection, error handling, and API key resolution.

### Decision: Save directly to HAYSTACK_IMAGE_DIR

The output goes straight into the artwork rotation folder. If you don't like the result, delete it. No staging area or approval step needed — the daily rotation won't pick it up until the next day boundary.

**Rationale:** An extra "staging" folder adds a manual move step for no benefit. The rotation system already handles new images gracefully (inserted after current position in queue).

### Decision: User-triggered only (disable-model-invocation: true)

The skill should never fire automatically. It's an intentional creative act — you choose which images to extend.

## Implementation Shape

### Skill file

`.claude/skills/extend-artwork/SKILL.md` with:
- `name: extend-artwork`
- `disable-model-invocation: true`
- Instructions for Claude to run the script, inspect the output, offer retry with custom prompt

### Script

`scripts/extend-artwork.ts` — a focused script that:
1. Reads the input image
2. Loads config (model, API key, output dir) from existing `loadConfigFromEnv()`
3. Calls Gemini with the input image + extension prompt + `aspectRatio: "16:9"` + `imageSize: "1K"`
4. Derives output filename from input (e.g., `cool-porsche-landscape.png`)
5. Saves to `HAYSTACK_IMAGE_DIR`
6. Opens in Preview.app (`open` command on macOS)
7. Prints result path and metadata to stdout

### Prompt

Default prompt (tuned for artwork extension):
```
Reimagine this artwork as a wide 16:9 landscape scene. Expand the composition
naturally — extend the environment, architecture, and atmosphere to fill the
wider frame. Preserve the EXACT artistic style, medium, color palette, and
rendering technique of the original. Do not crop, stretch, or distort any
existing elements. The extended areas should feel like a natural continuation
of the original scene.
```

Optional override via skill argument for images that need specific guidance.

## Open Questions

None — ready for planning.

## Research Notes

### Gemini capabilities (confirmed)
- Both Flash and Pro support `imageConfig.aspectRatio: "16:9"` for output
- Both support `imageConfig.imageSize: "1K"` (Pro also supports "2K", "4K")
- Image editing accepts input image + text prompt, outputs at the requested aspect ratio
- This is "layout-aware outpainting" — Gemini reasons about what should fill extended canvas

### Instagram image acquisition (researched, decided against)
- No public API for downloading images
- Instaloader (Python CLI) works but requires login, breaks with Instagram changes
- Web-based downloaders exist but are unreliable and sketchy
- Manual save (right-click, screenshot) is the simplest reliable approach
- Making the tool source-agnostic is strictly better than Instagram-specific
