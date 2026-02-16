---
title: "TV Kiosk Display (Phase C Fast-Track)"
type: feat
date: 2026-02-15
brainstorm: docs/brainstorms/2026-02-15-tv-kiosk-phase-c-brainstorm.md
---

# TV Kiosk Display (Phase C Fast-Track)

## Overview

Add always-on TV display support to Haystack via a Raspberry Pi 4 acting as a thin browser client. The Pi runs Chromium in kiosk mode pointing at the existing Mac-hosted Express server. All generation logic, scheduling, and image serving stays on the Mac.

This requires server-side extensions (hourly scheduler, new endpoints, kiosk page, folder rotation) and a small Lab UI addition (scenario override input). Zero application code runs on the Pi.

## Problem Statement / Motivation

Haystack currently supports manual generation via the Lab UI. To function as a "living art display" on a TV, it needs:

1. **Automatic hourly generation** — no human interaction required once configured
2. **A display endpoint** — a fullscreen browser page the Pi can point to
3. **Base image variety** — daily rotation through a folder of artworks
4. **On-demand overrides** — ability to send a custom scenario from the laptop for instant "party trick" generations

## Proposed Solution

Extend the Express server with an in-process scheduler, new API endpoints, a kiosk HTML page, and folder-based image rotation. The Pi simply opens `http://<mac-ip>:4321/kiosk` in fullscreen Chromium.

## Technical Approach

### Architecture

```
┌──────────────────────────────────────────────┐
│  Mac (Express Server)                        │
│                                              │
│  ┌─────────────┐   ┌──────────────────────┐  │
│  │  Scheduler   │──▶│  Pipeline.generate() │  │
│  │ (setTimeout) │   └──────────┬───────────┘  │
│  └─────────────┘              │              │
│                               ▼              │
│  ┌─────────────┐   ┌──────────────────────┐  │
│  │ Image Folder │──▶│   OutputStore        │  │
│  │  Rotation    │   └──────────┬───────────┘  │
│  └─────────────┘              │              │
│                               ▼              │
│  ┌─────────────────────────────────────────┐ │
│  │  Express Routes                         │ │
│  │  GET /api/latest  ← kiosk polls this    │ │
│  │  POST /api/override ← Lab UI sends this │ │
│  │  GET /kiosk ← Pi loads this page        │ │
│  └─────────────────────────────────────────┘ │
└──────────────────────┬───────────────────────┘
                       │ LAN (http)
                       ▼
              ┌────────────────┐
              │  Raspberry Pi  │
              │  Chromium      │
              │  (kiosk mode)  │
              └────────────────┘
```

### Implementation Phases

#### Phase 1: Config & Image Rotation

Extend configuration and add folder-based image selection.

**Files to create/modify:**

- `src/config/config.ts` — add new env vars to `HaystackConfig`
- `src/server/image-rotation.ts` — new module for folder-based daily image selection

**Config additions (`src/config/config.ts`):**

New fields on `HaystackConfig`:

```typescript
// Phase C: Kiosk scheduling
bindHost: string;                   // HAYSTACK_BIND_HOST (default: "127.0.0.1")
imageDir?: string;                  // HAYSTACK_IMAGE_DIR (folder of base artworks)
schedulerLocation?: {               // HAYSTACK_LAT, HAYSTACK_LON, HAYSTACK_TIMEZONE
  lat: number;
  lon: number;
  timezone: string;
};
```

New env vars:

| Variable | Default | Purpose |
|----------|---------|---------|
| `HAYSTACK_BIND_HOST` | `127.0.0.1` | Server bind address. Set to `0.0.0.0` for LAN access |
| `HAYSTACK_IMAGE_DIR` | *(none)* | Folder of base artworks for daily rotation |
| `HAYSTACK_LAT` | *(none)* | Latitude for scheduled weather fetch |
| `HAYSTACK_LON` | *(none)* | Longitude for scheduled weather fetch |
| `HAYSTACK_TIMEZONE` | *(none)* | IANA timezone (e.g., `America/Los_Angeles`) |

**Image rotation module (`src/server/image-rotation.ts`):**

```typescript
export function getImageForToday(imageDir: string): string | null
```

- Reads the directory, filters for `.jpg`, `.png`, `.webp` files (case-insensitive)
- Ignores hidden files (starting with `.`)
- Sorts alphabetically for deterministic ordering
- Returns `sortedImages[dayOfYear % sortedImages.length]`
- Returns `null` if directory is empty or doesn't exist

**Acceptance criteria:**

- [x] `loadConfigFromEnv()` parses all new env vars — `config.ts`
- [x] `bindHost` defaults to `"127.0.0.1"` when `HAYSTACK_BIND_HOST` is unset
- [x] `schedulerLocation` is only populated when all three of `HAYSTACK_LAT`, `HAYSTACK_LON`, `HAYSTACK_TIMEZONE` are set
- [x] `getImageForToday()` returns a different image each day, cycling through the folder
- [x] Hidden files and non-image files are ignored
- [x] Returns `null` for empty or missing directory

#### Phase 2: Scheduler

Add in-process hourly generation tied to the Express server lifecycle.

**Files to create/modify:**

- `src/server/scheduler.ts` — new module for hourly generation scheduling
- `src/server/start.ts` — wire up scheduler, use configurable bind host

**Scheduler module (`src/server/scheduler.ts`):**

```typescript
export interface SchedulerConfig {
  pipeline: Pipeline;
  weatherProvider: WeatherProvider;
  imageDir: string;
  location: { lat: number; lon: number; timezone: string };
}

export class HourlyScheduler {
  start(): void    // begins scheduling
  stop(): void     // clears timers
  runNow(): Promise<GenerateResult>  // manual trigger (used by override)
}
```

Scheduling strategy (self-rescheduling `setTimeout`):
1. On `start()`, compute milliseconds until the next top-of-hour, call `setTimeout`
2. When the timer fires: run the generation, then compute ms until the *next* top-of-hour and `setTimeout` again
3. Each tick: get today's image via `getImageForToday()`, build real scenario (weather + time + sun/moon), call `pipeline.generate()`
4. On `stop()`, clear the pending timeout

Self-rescheduling is simpler than setTimeout+setInterval (one timer ID instead of two) and handles edge cases better — macOS sleep/wake, DST transitions, and generation duration don't cause drift because the next tick is always recalculated from the current time.

The scheduler builds a full scenario using the same `buildScenario()` logic from the server — fetch weather from the configured location, compute sun/moon positions via SunCalc, and compose the prompt. Extract `buildScenario` from `server.ts` into a shared utility so both the server route and scheduler can use it.

**Integration in `start.ts`:**

```typescript
// After app.listen()
if (config.imageDir && config.schedulerLocation) {
  const scheduler = new HourlyScheduler({ ... });
  scheduler.start();
  console.log(`Hourly scheduler started (location: ${config.schedulerLocation.lat}, ${config.schedulerLocation.lon})`);

  process.on("SIGINT", () => {
    scheduler.stop();
    server.close(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    scheduler.stop();
    server.close(() => process.exit(0));
  });
}
```

**Bind host change in `start.ts`:**

```typescript
// Before: app.listen(port, "127.0.0.1", ...)
// After:
app.listen(port, config.bindHost, () => {
  console.log(`Haystack Lab server running at http://${config.bindHost}:${port}`);
});
```

**Acceptance criteria:**

- [x] Scheduler fires at the top of each hour — `scheduler.ts`
- [x] Each tick uses `getImageForToday()` for the base image — `scheduler.ts`
- [x] Each tick fetches real weather from configured location — `scheduler.ts`
- [x] Scheduler computes sun/moon positions via SunCalc — `scheduler.ts`
- [x] `stop()` cleanly clears the pending timeout — `scheduler.ts`
- [x] Server binds to `config.bindHost` instead of hardcoded `127.0.0.1` — `start.ts`
- [x] Scheduler only starts when both `imageDir` and `schedulerLocation` are configured — `start.ts`
- [x] Graceful shutdown clears scheduler on SIGINT/SIGTERM — `start.ts`
- [x] `buildScenario` is extracted from `server.ts` into a shared module both routes and scheduler can use

#### Phase 3: New API Endpoints

Add `GET /api/latest` and `POST /api/override` to the Express app.

**Files to modify:**

- `src/server/server.ts` — add new routes
- `src/server/server.ts` — expand `CreateAppConfig` to accept optional scheduler reference

**`GET /api/latest`:**

Returns the most recent render metadata + image URL. Used by the kiosk page for polling.

```typescript
app.get("/api/latest", (req, res) => {
  const latest = pipeline.getStore().getLatest();
  if (!latest) {
    res.status(404).json({ error: "No renders available" });
    return;
  }
  res.json({
    metadata: latest,
    imageUrl: `/api/outputs/${latest.id}`,
  });
});
```

Note: `OutputStore.getLatest()` already exists ([output-store.ts:55](src/storage/output-store.ts#L55)).

**`POST /api/override`:**

Accepts a scenario description string, triggers an immediate generation using the day's base image and that scenario text injected into the prompt template's `{scenario}` slot.

```typescript
app.post("/api/override", async (req, res) => {
  const { scenario } = req.body;
  if (!scenario || typeof scenario !== "string") {
    res.status(400).json({ error: "scenario string is required" });
    return;
  }
  // Requires scheduler to be configured (need imageDir + location)
  // Use scheduler.runNow() with the override scenario
});
```

Implementation detail: The override doesn't store any state. It triggers a one-off generation where the scenario description is the user's text. The next hourly tick generates from real weather/time, naturally replacing the override output.

**Acceptance criteria:**

- [x] `GET /api/latest` returns latest render with `metadata` and `imageUrl` — `server.ts`
- [x] `GET /api/latest` returns 404 when no renders exist — `server.ts`
- [x] `POST /api/override` validates `scenario` is a non-empty string — `server.ts`
- [x] `POST /api/override` triggers generation with override scenario text — `server.ts`
- [x] `POST /api/override` uses the day's base image from `getImageForToday()` — `server.ts`
- [x] `POST /api/override` returns the generated result (metadata + imageUrl) — `server.ts`
- [x] `POST /api/override` returns 400 if scheduler is not configured (no imageDir/location) — `server.ts`

#### Phase 4: Kiosk Page

A standalone HTML page served at `/kiosk` with fullscreen image display, CSS crossfade transitions, and JS polling.

**Files to create:**

- `public/kiosk.html` — static HTML page in a `public/` directory at the project root

**Why `public/` and not `src/server/`:** Using `path.resolve("src/server/kiosk.html")` would break after TypeScript compiles to `dist/` — the compiled JS would look for a file relative to the project root that may not exist in production. Placing it in `public/` (a non-compiled static assets directory) keeps the path stable regardless of build output. Express serves it by resolving relative to the project root, which works identically in dev and production.

**Page behavior:**

1. On load, fetch `GET /api/latest` to get the current image
2. Display the image fullscreen (CSS: `object-fit: cover`, black background)
3. Poll `/api/latest` every 60 seconds
4. When the `metadata.id` changes, crossfade to the new image using two overlapping `<img>` elements with CSS opacity transitions
5. No framework needed — vanilla HTML/CSS/JS

**CSS crossfade approach:**

```
Two <img> elements stacked (position: absolute, inset: 0)
  - "front" image: opacity 1
  - "back" image: opacity 0
When new image arrives:
  1. Set back image src to new URL
  2. Wait for load event
  3. Transition back to opacity 1, front to opacity 0
  4. Swap roles
```

**Route:**

```typescript
// In server.ts — resolve from project root, works in both dev and compiled builds
app.get("/kiosk", (req, res) => {
  res.sendFile(path.resolve("public/kiosk.html"));
});
```

**Acceptance criteria:**

- [x] `/kiosk` serves a fullscreen HTML page — `server.ts`
- [x] Page displays the latest generated image covering the full viewport — `kiosk.html`
- [x] Page polls `/api/latest` every 60 seconds — `kiosk.html`
- [x] When a new image is detected (different `id`), it crossfades smoothly — `kiosk.html`
- [x] Black background when no image is available — `kiosk.html`
- [x] Page works in Chromium on Raspberry Pi (no fancy APIs, keep it simple) — `kiosk.html`
- [x] No visible cursor, scrollbars, or browser chrome needed (kiosk mode handles this)

#### Pi Setup Notes (no Haystack code — just configuration)

The Pi runs zero application code. It's a browser pointing at the Mac. These notes are for when the hardware arrives.

**OS choice:** Use **Raspberry Pi OS (64-bit) with Desktop**, not Lite. Lite means assembling the GUI stack yourself (X11/Wayland, window manager, Chromium) — more things to break. Desktop includes everything out of the box. Get it working first, optimize later.

**Kiosk autostart:** Raspberry Pi OS now uses **labwc** (a Wayland compositor), not the older X11/LXDE setup. Many online tutorials are outdated. Follow the [official Raspberry Pi kiosk tutorial](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/) which uses `~/.config/labwc/autostart` to launch Chromium with kiosk flags:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars --no-first-run http://<mac-ip>:4321/kiosk
```

**Networking tip:** Use mDNS if available (e.g., `http://haystack.local:4321/kiosk`) so you don't get bitten by DHCP reassigning the Mac's IP address.

**Durability (optional):** For an always-on device, consider enabling Raspberry Pi's **Overlay File System** (read-only root). This reduces SD card wear from constant writes. The official kiosk tutorial covers this.

#### Phase 5: Lab UI Override

Add a scenario override input to the Lab UI.

**Files to modify:**

- `lab-ui/src/App.tsx` or a new component — add override input + button
- `lab-ui/src/api/` — add `postOverride()` API function

**UI addition:**

A text input field + "Send Override" button, placed in a section of the Lab UI (e.g., below the generate controls or in a dedicated "Kiosk Controls" section). On submit, POST to `/api/override` with `{ scenario: string }`.

Should show:
- Success: flash confirmation + show the generated image
- Error: display error message
- Loading state while generation is in progress

**Acceptance criteria:**

- [x] Override text input and "Send Override" button in Lab UI — `App.tsx`
- [x] Button POSTs to `/api/override` — `api/`
- [x] Shows loading state during generation — `App.tsx`
- [x] Displays result or error after completion — `App.tsx`
- [x] Input clears or stays (user preference) after successful override

#### Phase 6: Tests

Add tests for the new modules.

**Files to create:**

- `src/server/image-rotation.test.ts` — unit tests for image folder rotation
- `src/server/scheduler.test.ts` — unit tests for scheduler logic (timer setup, scenario building)
- `src/server/server.test.ts` — extend existing server tests with `/api/latest`, `/api/override`, `/kiosk` route tests

**Test focus areas:**

- Image rotation: deterministic selection, empty folder, missing folder, mixed file types, hidden files
- Scheduler: timer lifecycle (start/stop), scenario building with weather, graceful shutdown
- API endpoints: happy path, validation errors, 404 when no renders exist
- Config: parsing new env vars, defaults, partial configuration

**Acceptance criteria:**

- [x] Image rotation unit tests pass — `image-rotation.test.ts`
- [x] Scheduler unit tests pass (use fake timers) — `scheduler.test.ts`
- [x] API endpoint tests cover `/api/latest` and `/api/override` — `server.test.ts`
- [x] Config tests cover new env vars — `config.test.ts`
- [x] All existing tests continue to pass

## Alternative Approaches Considered

| Approach | Why rejected |
|----------|-------------|
| Pi as smart node (local caching, Node.js) | Unnecessary complexity — both devices are on the same LAN, Mac must be running anyway |
| launchd daemon for scheduling | Server must be running for Pi; coupling timer to server makes override trivial |
| WebSocket push (instead of polling) | Adds complexity for marginal benefit — 60s polling is fine for hourly updates |
| Cloud relay for Pi connectivity | Overkill for same-LAN setup; would add latency and cost |
| TTL-based override expiry | Unnecessary state tracking — hourly tick naturally resets |
| Random/shuffled image rotation | Less predictable; deterministic `dayOfYear % count` is simpler and debuggable |

## Acceptance Criteria

### Functional Requirements

- [ ] Server generates a new image every hour at the top of the hour (when scheduler is configured)
- [ ] Each day uses a different base image from the configured folder
- [ ] `GET /api/latest` returns the most recent generation
- [ ] `POST /api/override` triggers immediate generation with custom scenario
- [ ] Override is replaced by next hourly generation (no persistence)
- [ ] `/kiosk` page displays images fullscreen with smooth crossfade transitions
- [ ] Kiosk page polls for updates and transitions when new image arrives
- [ ] Server is accessible from LAN when `HAYSTACK_BIND_HOST=0.0.0.0`
- [ ] Lab UI has override input for sending custom scenarios

### Non-Functional Requirements

- [ ] Scheduler stops cleanly on SIGINT/SIGTERM
- [ ] macOS sleep/wake naturally pauses and resumes the scheduler (zero API cost when sleeping)
- [ ] Kiosk page works in Chromium on Raspberry Pi 4 (low-resource browser environment)
- [ ] No new npm dependencies required for server-side changes
- [ ] All existing tests continue to pass

### Quality Gates

- [x] Unit tests for image rotation, scheduler, and new endpoints
- [x] `npm run build` passes with no TypeScript errors
- [x] `npm run test:run` passes

## Dependencies & Prerequisites

- **Existing:** Phase A2 complete (Express server, weather provider, pipeline, Lab UI)
- **Hardware (Pi-side, out of scope for this plan):** Raspberry Pi 4 + micro-HDMI cable + USB-C power + microSD card
- **No new npm dependencies** — uses `setInterval`, `fs`, existing Express, existing weather provider

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Scheduler drift after sleep/DST | Low | Low | Self-rescheduling `setTimeout` recalculates next tick from current time each run |
| Image folder empty or misconfigured | Medium | Medium | Return clear error on startup, skip generation if no image available |
| Generation fails during scheduled tick | Medium | Low | Log error, keep current wallpaper, next tick will retry naturally |
| Weather fetch fails during scheduled tick | Medium | Low | Fall back to time-only scenario (existing pattern in `buildScenario`) |
| Pi loses network to Mac | Medium | Low | Kiosk page retains last image, resumes polling — no user action needed |
| Binding to `0.0.0.0` exposes server to network | Low | Medium | Default remains `127.0.0.1`; only `0.0.0.0` when explicitly configured |
| Concurrent generation (override while scheduled tick runs) | Low | Medium | Use a mutex/lock in the scheduler to serialize generation calls |

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `src/config/config.ts` | Modify | Add `bindHost`, `imageDir`, `schedulerLocation` to config |
| `src/server/image-rotation.ts` | Create | Folder-based daily image selection |
| `src/server/scheduler.ts` | Create | Hourly generation scheduler (self-rescheduling setTimeout) |
| `src/server/scenario-builder.ts` | Create | Extract `buildScenario()` from `server.ts` for shared use |
| `src/server/server.ts` | Modify | Add `GET /api/latest`, `POST /api/override`, `GET /kiosk` routes |
| `src/server/start.ts` | Modify | Wire scheduler, use `config.bindHost` |
| `public/kiosk.html` | Create | Standalone kiosk display page (static asset, not compiled) |
| `lab-ui/src/App.tsx` | Modify | Add override input + button |
| `lab-ui/src/api/` | Modify | Add `postOverride()` function |
| `src/server/image-rotation.test.ts` | Create | Unit tests for image rotation |
| `src/server/scheduler.test.ts` | Create | Unit tests for scheduler |
| `src/server/server.test.ts` | Modify | Add tests for new endpoints |

## References & Research

### Internal References

- Brainstorm: [2026-02-15-tv-kiosk-phase-c-brainstorm.md](../brainstorms/2026-02-15-tv-kiosk-phase-c-brainstorm.md)
- PRD: [idea-draft.md](../idea-draft.md) (Phase C section, line 393)
- Server app factory: [server.ts](../../src/server/server.ts)
- Server entry point: [start.ts:21](../../src/server/start.ts#L21) — current hardcoded `127.0.0.1` bind
- Config loader: [config.ts](../../src/config/config.ts)
- Pipeline: [pipeline.ts:54](../../src/engine/pipeline.ts#L54) — `generate()` method
- Output store: [output-store.ts:55](../../src/storage/output-store.ts#L55) — `getLatest()` already exists
- Scenario builder: [scenario.ts](../../src/engine/scenario.ts) — `createScenarioFromHour()`, `describeScenario()`
- `buildScenario()` in server: [server.ts:286](../../src/server/server.ts#L286) — needs extraction to shared module
