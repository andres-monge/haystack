---
name: extend-artwork
description: Reimagine any image as a 16:9 landscape suitable for Haystack's daily artwork rotation. Takes a file path, calls Gemini outpainting, and saves the result to HAYSTACK_IMAGE_DIR.
disable-model-invocation: true
---

# Extend Artwork — Reimagine as 16:9 Landscape

Takes any image (portrait, square, cropped) and uses Gemini outpainting to reimagine it as a wide 16:9 landscape for Haystack's artwork rotation.

## Usage

```
/extend-artwork <image_path> [custom_prompt]
```

## Workflow

### 1. Run the script

```bash
npx tsx scripts/extend-artwork.ts <image_path> [custom_prompt]
```

The script prints a JSON result to **stdout** and progress/errors to **stderr**.

### 2. Parse the result

On success, stdout contains:

```json
{
  "outputPath": "/path/to/image-landscape.png",
  "model": "gemini-2.5-flash-image",
  "modelVersion": "...",
  "responseText": "..."
}
```

Report the output path and model to the user. The image will also open in Preview.app automatically.

### 3. Ask the user

After reporting the result, ask:

- **Keep it?** The image is already in `HAYSTACK_IMAGE_DIR` — the rotation system will pick it up automatically.
- **Retry with a custom prompt?** Re-run the script with a custom prompt as the second argument. This overwrites the previous attempt.

### Error handling

| Error | What to do |
|-------|------------|
| `HEIC format not supported` | Offer to run the `sips` conversion command shown in the error, then retry with the converted file |
| `copyright/IP concern` (IMAGE_OTHER) | Explain that Gemini detected copyrighted content. Suggest trying a different source image |
| `safety filter triggered` | Explain the limitation. Suggest a different image or a toned-down prompt |
| `rate limit hit` | Suggest waiting 30-60 seconds and retrying |
| `timed out` | Suggest retrying — transient API issue |
| `HAYSTACK_IMAGE_DIR not set` | Guide the user to add `HAYSTACK_IMAGE_DIR=/path/to/artworks` to `.env.local` |
| `file not found` | Check the path — suggest using tab completion or drag-and-drop into terminal |
| `unsupported format` | Only JPEG, PNG, and WebP are supported |

### HEIC conversion helper

If the user has a HEIC file, offer to run:

```bash
sips -s format jpeg "<input.heic>" --out "<output.jpg>"
```

Then retry with the converted JPEG.
