---
name: extend-artwork
description: Reimagine any image as a 16:9 landscape suitable for Haystack's daily artwork rotation. Takes a file path, runs the configured direct-provider chain, and saves one final result to HAYSTACK_IMAGE_DIR.
disable-model-invocation: true
---

# Extend Artwork — Reimagine as 16:9 Landscape

Take a JPEG, PNG, or WebP image and reimagine it as a wide 16:9 landscape for
Haystack's artwork rotation. The script first cleans social-media UI overlays,
then outpaints only the cleaned result. Each stage starts a fresh pass through
the configured direct-provider order. Only the final, validated 16:9 image and
its metadata sidecar are published.

This is a macOS workflow: the script opens a successful result in Preview, and
the HEIC helper uses `sips`.

## Usage

```text
/extend-artwork <image_path> [custom_prompt]
```

## Workflow

### 1. Run the script

From the repository root, run:

```bash
npx tsx scripts/extend-artwork.ts <image_path> [custom_prompt]
```

The script prints one JSON result to **stdout**. Progress, sanitized stage
events, and errors go to **stderr**. It uses `HAYSTACK_IMAGE_PROVIDER_ORDER`
and the corresponding direct API keys from `.env.local`; never print key
values.

### 2. Parse the result

On success, stdout contains the output path, actual MIME type and dimensions,
final winning provider and model, configured provider order, and separate
cleanup/outpaint winners and safe attempt ledgers. The filename extension can
be `.png`, `.jpg`, or `.webp` because it always matches the returned bytes.

Report the output path and both stage winners to the user. The image also opens
in Preview.app automatically.

### 3. Ask the user

After reporting the result, ask whether to keep it or try another source or
prompt. The committed image is already in `HAYSTACK_IMAGE_DIR`, so the rotation
system can select it automatically.

Publication is deliberately no-clobber. If the same deterministic
`*-landscape` image and sidecar already exist, the script keeps that committed
pair unchanged. Before retrying the same source, ask the user whether to keep
the existing result or remove its image and `.json` sidecar together. Do not
delete either file without explicit confirmation.

### Error handling

| Error | What to do |
|-------|------------|
| `HEIC is not supported` | Offer to run the `sips` conversion command shown in the error, then retry with the converted file |
| `all configured providers were exhausted` | Report the sanitized per-provider outcomes; no intermediate or final artwork was published |
| `provider chain deadline expired` | Explain that the stage timed out and no result was published; retry only if the user wants another paid attempt |
| `another image generation is already in progress` | Wait for the current generation to finish before retrying |
| `final artwork could not be published` | Check for an existing matching image/sidecar pair or local storage problems; never remove a committed pair without confirmation |
| `HAYSTACK_IMAGE_DIR is required` | Guide the user to set the artwork rotation folder in `.env.local` |
| `direct-provider configuration is invalid` | Check the configured order, selected providers' keys, and stable model IDs without displaying credential values |
| `file not found` | Check the path; suggest tab completion or drag-and-drop into the terminal |
| `unsupported image format` | Explain that only JPEG, PNG, and WebP inputs are supported |

Do not reinterpret raw provider text or promise that a retry will succeed.
Fallback is driven only by the service's typed, sanitized outcomes.

### HEIC conversion helper

If the user has a HEIC file, offer to run:

```bash
sips -s format jpeg "<input.heic>" --out "<output.jpg>"
```

Then retry with the converted JPEG.
