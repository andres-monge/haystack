# Brainstorm: TV Kiosk Display (Phase C Fast-Track)

**Date:** 2026-02-15
**Status:** Complete

## What We're Building

A TV display for Haystack powered by a Raspberry Pi 4, fast-tracked from Phase C. The Pi acts as a thin display client (fullscreen browser) pointing at the existing Mac-hosted Express server. All generation logic, scheduling, and image serving stays on the Mac.

### Core capabilities

1. **Fullscreen kiosk display** on TV via Raspberry Pi 4, showing the latest generated image with smooth crossfade transitions when updates arrive.

2. **Hourly scheduled generation** via setInterval inside the Express server. Uses the real weather/time scenario. Runs automatically when the Mac is awake; pauses naturally when the Mac sleeps (lid closed). Zero API cost when idle.

3. **Daily image rotation** from a configured folder of base artworks. One image per day, cycling through the folder.

4. **Scenario override from laptop** — send a short scenario description from the Lab UI that replaces the `{scenario}` portion of the prompt and triggers an immediate generation. The override lasts until the next hourly scheduled generation, which uses the real weather/time data.

## Why This Approach

### Decision: Pi as thin display client (not a smart node)

The Pi runs Chromium in kiosk mode pointing to `http://<mac-ip>:4321/kiosk`. No Node.js, no caching, no logic on the Pi. All image generation, scheduling, and serving happens on the Mac's Express server.

**Rationale:** Both devices are always on the same LAN. The Mac server must be running anyway for generation. Adding complexity to the Pi (local caching, Node.js, sync logic) only protects against the edge case of "Pi reboots while Mac is off," which doesn't justify the added complexity.

### Decision: setInterval over launchd for scheduling

The scheduler is a setInterval timer inside the Express server, not a separate launchd daemon.

**Rationale:** The server must be running for the Pi to fetch images, so coupling the timer to the server process makes the override feature trivial (same process handles both scheduled and on-demand generation). macOS sleep/wake naturally suspends and resumes the timer, gating API costs with zero manual intervention. A launchd plist can still be used to auto-start the server on login, but scheduling stays in-process.

### Decision: Override lasts until next hourly tick

The scenario override doesn't need TTL tracking. It simply triggers an immediate generation with the user's scenario text. The next hourly scheduled generation uses the real weather/time scenario, naturally overwriting the override. If the user wants the override to persist, they send it again.

**Rationale:** Simplicity. The override is a "party trick" — no need for expiry logic, state tracking, or persistence. The hourly scheduler is the natural reset mechanism.

### Decision: Folder-based daily rotation for base images

A configured folder path (`HAYSTACK_IMAGE_DIR`) contains multiple base artworks. Each day, the server picks a different image from the folder (e.g., `dayOfYear % imageCount`). All hourly generations that day use that image as the base.

**Rationale:** Avoids manual base-image switching. Provides variety across days without requiring UI for image management. Simple deterministic rotation.

## Key Decisions

| Decision | Choice | Alternative considered |
|----------|--------|----------------------|
| Pi role | Thin browser client | Smart node with local caching |
| Scheduling mechanism | setInterval in Express server | launchd macOS daemon |
| Override lifetime | Until next hourly generation | TTL-based (rest of hour / rest of day) |
| Base image selection | Daily rotation from configured folder | Last uploaded via Lab UI / single file path |
| Network model | Same LAN, Pi accesses Mac via local IP | Cloud relay / remote access |
| Server bind address | `0.0.0.0` (configurable via env var) | `127.0.0.1` (current, localhost only) |

## What Needs to Be Built

### Mac-side (Express server extensions)

1. **Hourly scheduler** — setInterval that triggers generation at the top of each hour using the real weather/time scenario and the day's base image.

2. **Folder-based image rotation** — reads `HAYSTACK_IMAGE_DIR`, sorts images, picks one per day. New env var for folder path.

3. **`GET /api/latest`** — returns the latest render metadata + image URL. Used by the kiosk page to poll for updates.

4. **`POST /api/override`** — accepts a `{ scenario: string }` body, triggers an immediate generation using that scenario text (injected into the `{scenario}` slot of the prompt template). Uses the day's base image.

5. **Kiosk page** — a standalone HTML page served at `/kiosk` with fullscreen image display, CSS crossfade transitions, and JS polling of `/api/latest` every ~60 seconds.

6. **Bind to `0.0.0.0`** — new `HAYSTACK_BIND_HOST` env var (default `127.0.0.1`, set to `0.0.0.0` for LAN access).

7. **Location + weather config persistence** — the scheduler needs a configured location to fetch weather. Store lat/lon/timezone so the server doesn't need the Lab UI open to know where to get weather from.

### Pi-side

1. **Raspberry Pi OS setup** — Lite image, Chromium in kiosk mode, auto-start on boot.
2. **Network config** — connect to home Wi-Fi, point browser to Mac's LAN IP + port.
3. **No application code** — the Pi runs zero Haystack code.

### Lab UI additions

1. **Override input** — a text field + "Send Override" button that POSTs to `/api/override` with a scenario string.

## Open Questions

1. **Location persistence** — Currently location is selected per-session in the Lab UI. The scheduler needs a persisted location. Options: env vars (`HAYSTACK_LAT`, `HAYSTACK_LON`, `HAYSTACK_TIMEZONE`), a config file, or a simple JSON state file. Env vars are simplest and consistent with existing config pattern.

2. **Prompt template persistence** — Similarly, the scheduler needs to know which prompt template to use. The default template is likely fine for scheduled generation, with overrides only through Lab UI.

3. **Pi hardware** — Need to purchase a Raspberry Pi 4. Minimum requirements: any RAM config works (even 1GB is fine for a kiosk browser), need a micro-HDMI to HDMI cable, USB-C power supply, and a microSD card.

4. **Image folder format** — Should the rotation be purely deterministic (`dayOfYear % count`) or shuffled? Deterministic is simpler and predictable.

5. **Kiosk polling interval** — 60 seconds seems reasonable. Too frequent wastes resources; too infrequent delays showing new images after generation.
