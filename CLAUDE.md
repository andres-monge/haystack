# Haystack — Living Art Wallpaper

AI-powered macOS wallpaper that evolves hourly based on time and weather. Uses Gemini image editing to transform a base artwork.

## Project status

Early development. Phase A1 (engine + pipeline + CLI) and A2 (Lab UI + weather integration) are complete.

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
npm run lab          # start Lab UI (Express server + Vite dev server)
npx tsx examples/basic-edit.ts <image> [hour]  # quick test
```

## Code style

- ES modules only — use `import`/`export`, never `require`
- Use `.js` extensions in relative imports (TypeScript NodeNext resolution)
- Strict TypeScript — no implicit `any`
- Prefer `node:` prefix for built-in modules (`import * as fs from "node:fs"`)

## Architecture

The engine is a pure Node.js module — it CANNOT run in browsers. It uses `fs`, `os`, `crypto` and holds the API key. The Lab UI communicates with the engine via a local Express server, not direct imports.

```
src/engine/     — Core pipeline: scenario → prompt → Gemini API → output
src/storage/    — Output store (images + metadata JSON sidecars)
src/config/     — Environment-based configuration
src/cli/        — CLI entry point for launchd scheduler
src/weather/    — Weather provider interface + Open-Meteo implementation
src/server/     — Express API server for Lab UI
lab-ui/         — React (Vite) frontend for prompt iteration
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
| 3.1 Flash Image | `gemini-3.1-flash-image-preview` | Extend artwork (2K default), thinking mode |
| Pro Image | `gemini-3-pro-image-preview` | High quality, up to 4K |

## Environment variables

```
GOOGLE_API_KEY or GEMINI_API_KEY  — Required. Gemini API key.
HAYSTACK_OUTPUT_DIR               — Output directory (default: ~/.haystack/outputs)
HAYSTACK_MODEL                    — Model ID (default: gemini-2.5-flash-image)
HAYSTACK_EXTEND_MODEL             — Model for /extend-artwork (default: gemini-3.1-flash-image-preview)
HAYSTACK_ASPECT_RATIO             — Optional, omit to match input
HAYSTACK_SEED                     — Optional, for reproducible outputs
HAYSTACK_MAX_OUTPUTS              — Max stored outputs (default: 24)
HAYSTACK_LAB_PORT                 — Lab UI server port (default: 4321)
HAYSTACK_BIND_HOST                — Server bind address (default: 127.0.0.1, use 0.0.0.0 for LAN)
HAYSTACK_IMAGE_DIR                — Folder of base artworks for daily rotation
HAYSTACK_LAT                      — Latitude for scheduled weather fetch
HAYSTACK_LON                      — Longitude for scheduled weather fetch
HAYSTACK_TIMEZONE                 — IANA timezone (e.g., Europe/Madrid)
HAYSTACK_ACTIVE_START             — Hour (0–23) when scheduler starts (inclusive, e.g., 9)
HAYSTACK_ACTIVE_END               — Hour (0–23) when scheduler stops (exclusive, e.g., 21)
```

## Raspberry Pi kiosk setup

The Pi runs zero application code — it's Chromium in kiosk mode pointing at the Mac's Express server over LAN.

**Hardware:** Raspberry Pi 4, micro-HDMI (use HDMI0 — closest to USB-C power port), ethernet.

**OS:** Raspberry Pi OS (64-bit) with Desktop, flashed via Raspberry Pi Imager. Configure hostname (`haystack`), SSH, and user account in Imager settings before flashing.

**SSH access from Mac:**
```bash
ssh-copy-id andresm@haystack.local   # one-time, then passwordless
ssh andresm@haystack.local
```

**Kiosk configuration — two files:**

System autostart (`/etc/xdg/labwc/autostart`) — strip default desktop, keep only kanshi:
```
/usr/bin/kanshi &
/usr/bin/lxsession-xdg-autostart
```

User autostart (`~/.config/labwc/autostart`) — Chromium kiosk:
```
unclutter -idle 0 &
chromium --kiosk --noerrdialogs --disable-infobars --no-first-run --check-for-update-interval=31536000 --disable-features=Translate --password-store=basic --ozone-platform=wayland --enable-features=OverlayScrollbar --start-fullscreen --start-maximized http://<mac-ip>:4321/kiosk &
```

**Critical flags:**
- `--ozone-platform=wayland` — required, Chromium renders blank white without it
- `--password-store=basic` — prevents keyring popup on first boot
- Binary is `chromium`, not `chromium-browser` (Debian/RPi OS naming)
- Use Mac's IP address (`192.168.0.20`), not mDNS hostname — Pi may not resolve `.local`
- Mac has a DHCP reservation on the router so `192.168.0.20` is stable across WiFi networks

**Other setup:**
- Disable screen blanking: `sudo raspi-config nonint do_blanking 1`
- Hide cursor: `sudo apt install unclutter` (already in autostart above)
- Screen blanking must be plugged into HDMI0 before powering on
- No green LED on boot = bad SD card flash, re-flash with Imager

**Mac-side:** Run the server with `HAYSTACK_BIND_HOST=0.0.0.0` (set in `.env.local`).

## launchd (Phase A4)

Auto-start the server on login and keep it alive across reboots.

**Install:**
```bash
./scripts/launchd-install.sh
```

**Uninstall:**
```bash
./scripts/launchd-uninstall.sh
```

**What it does:**
- `com.haystack.server` — starts Express server on login, restarts on crash
- `com.haystack.hourly` — curls `POST /api/scheduler/trigger` at HH:05 (backup for in-process scheduler)

**Logs:**
```bash
tail -f ~/.haystack/launchd-server.log   # server output
tail -f ~/.haystack/launchd-hourly.log   # hourly trigger output
```

**Troubleshooting:**
- Check status: `launchctl list | grep haystack`
- Manual trigger: `curl -X POST http://127.0.0.1:4321/api/scheduler/trigger`
- If server won't start: check `~/.haystack/launchd-server.log` and verify `.env.local` has `GOOGLE_API_KEY`
- To stop temporarily: `launchctl bootout gui/$(id -u)/com.haystack.server`

## Phased roadmap

- **Phase A1** ✓: Engine + pipeline + CLI
- **A2** ✓: Lab UI + weather integration (Express server, React frontend, Open-Meteo provider)
- **A3**: Wallpaper apply via `desktoppr`
- **A4** ✓: `launchd` server daemon + hourly scheduler
- **Phase B**: macOS Menu Bar app (Electron)
- **Phase C** ✓: Always-on TV kiosk (Raspberry Pi)

## Weather API

Open-Meteo (no API key required). Uses WMO weather codes. Provider interface is abstracted for swapping.
