---
name: extend-artwork
description: Reimagine an image as a 16:9 landscape suitable for Haystack's daily artwork rotation. Use only when the user explicitly invokes $extend-artwork with an image path; run the repository's Gemini outpainting script and save the result to HAYSTACK_IMAGE_DIR.
---

# Extend Artwork — Reimagine as 16:9 Landscape

Take an image (portrait, square, or cropped) and use Gemini outpainting to reimagine it as a wide 16:9 landscape for Haystack's artwork rotation. Automatically clean Instagram or social-media UI overlays, including carousel arrows and pagination dots, before extending.

This is a macOS workflow: the script opens the result in Preview, and the HEIC helper uses `sips`. Running the script writes directly to `HAYSTACK_IMAGE_DIR`; retrying the same source overwrites its existing `*-landscape.png` result.

## Usage

```text
$extend-artwork <image_path> [custom_prompt]
```

## Workflow

### 1. Run the script

From the repository root, run:

```bash
npx tsx scripts/extend-artwork.ts <image_path> [custom_prompt]
```

The script prints a JSON result to **stdout** and progress or errors to **stderr**.

### 2. Parse the result

On success, stdout contains:

```json
{
  "outputPath": "/path/to/image-landscape.png",
  "model": "gemini-3.1-flash-image-preview",
  "modelVersion": "...",
  "responseText": "..."
}
```

Report the output path and model to the user. The image also opens in Preview.app automatically.

### 3. Ask the user

After reporting the result, ask whether to:

- Keep it. This is feedback on the file already written to `HAYSTACK_IMAGE_DIR`, so the rotation system will pick it up automatically.
- Retry with a custom prompt. Re-run the script with a custom prompt as the second argument; this overwrites the previous attempt.

### Error handling

| Error | What to do |
|-------|------------|
| `HEIC format not supported` | Offer to run the `sips` conversion command shown in the error, then retry with the converted file |
| `copyright/IP concern` (`IMAGE_OTHER`) | Explain that Gemini detected copyrighted content and suggest a different source image |
| `safety filter triggered` | Explain the limitation and suggest a different image or toned-down prompt |
| `rate limit hit` | Suggest waiting 30–60 seconds and retrying |
| `timed out` | Suggest retrying because this is usually a transient API issue |
| `HAYSTACK_IMAGE_DIR not set` | Guide the user to add `HAYSTACK_IMAGE_DIR=/path/to/artworks` to `.env.local` |
| `file not found` | Check the path; suggest tab completion or drag-and-drop into the terminal |
| `unsupported format` | Explain that only JPEG, PNG, and WebP are supported |

### HEIC conversion helper

If the user has a HEIC file, offer to run:

```bash
sips -s format jpeg "<input.heic>" --out "<output.jpg>"
```

Then retry with the converted JPEG.
