## PRD: Living Art Wallpaper (macOS) + Optional Always-On TV Track

### Document status

- Version: 0.1 (MVP-focused)
    
- Scope: MVP (not production-ready)
    

---

## 1) Summary

**Product idea:** A “living” piece of art that evolves over time (hourly) by editing a base image using Gemini’s image editing API (Nano Banana / Nano Banana Pro), then applying the generated image as the **macOS wallpaper** (primary display only). ([Google AI for Developers](https://ai.google.dev/gemini-api/docs/image-generation?utm_source=chatgpt.com "Image generation with Gemini (aka Nano Banana & Nano Banana Pro)"))

**Key constraint:** We need a fast loop for prompt iteration and scenario testing (manual time/weather overrides) without waiting an hour.

**Phased delivery:**

- **Phase A:** Engine + Lab UI + `launchd` runner (developer/early adopter MVP).
    
- **Phase B:** macOS Menu Bar app (user-friendly packaging).
    
- **Phase C:** Always-on TV track via Raspberry Pi / tiny HDMI kiosk (optional “hardcore” mode).
    

---

## 2) Goals

1. Make a base artwork “age through time” via scheduled hourly updates.
2. Provide **Lab Mode** to rapidly iterate: edit prompts, pick time/weather/location overrides, generate instantly.
3. Support location-driven edits (time of day + weather context).
4. Apply wallpaper on macOS reliably (primary display only).
5. Keep artifacts ephemeral (local storage in a designated folder, minimal retention).
6. Refine the prompt to update the image according to the image context (candlelight vs electric, etc.)

---

## 3) Target Users & Primary Use Cases

### Personas

- **Prompt Tuner (dev):** needs fast iteration and controls.
    
- **Ambient Art User:** wants a wallpaper that changes hourly and feels alive.
    
- **Hardcore Display User:** wants an always-on TV art display (Phase C).
    

### Top user stories

1. _As a user_, I can upload an image or set a folder from my laptop with multiple images and start "living wallpaper" mode.
    
2. _As a user_, I can set a location and the wallpaper changes to reflect local time and weather.
    
3. _As the developer_, I can tweak the system prompt and regenerate instantly without waiting.
    
4. _As a user_, the wallpaper updates hourly (with optional quiet hours).
    
5. _As a hardcore user_, I can run an always-on TV display from a small dedicated device.

---
## 4) Core Product Requirements (All Phases)

### Artwork input

- Accept:

    - File upload (local)

- Validate:
    
    - Supported formats: jpg/png/webp (others optional)
        
    - Enforce max dimensions/file size (configurable)
        
- Storage:
    
    - Ephemeral local directory for base + outputs
        
    - Purge policy (e.g., keep last N=24 outputs, delete older)
        

### Time simulation

- Hourly updates (at top of hour or “every 60 minutes since start”—choose one; see Decisions)
    
- Optional quiet window: 00:00–05:00 (skip generation/apply)
    

### Location & weather context

- User can set location:
    
    - Basic: city search → lat/lon + timezone
        
- Weather data should support:
    
    - Hourly conditions (precip, cloud cover, etc.)
        
    - Sunrise/sunset or day/night indicator
        
    - Timezone/local time handling
        

**Recommended baseline API:** Open-Meteo (no key; includes hourly variables, day/night variable, timezone support). ([Open Meteo](https://open-meteo.com/en/docs "️ Docs | Open-Meteo.com")). Plan B: WeatherAPI.com

### “Smart extend background” (aspect ratio handling)

- Goal: fit base art to screen ratio without ugly crop.
    
- MVP approach:
    
    - Determine target wallpaper resolution from display.
        
    - Create a new canvas sized to target ratio.
        
    - Place the original artwork centered (no distortion).
        
    - Generate/extend background via image editing (outpainting) prompt.
        
- Fallback if outpainting is weird:
    
    - Blur/texture extend (non-AI) behind the original (still acceptable for early MVP).
        

### Gemini image editing

- Must support: text+image → edited image.
    
- Use Gemini API “Nano Banana” family models with model selectable via env/config (default: Nano Banana Pro). ([Google AI for Developers](https://ai.google.dev/gemini-api/docs/image-generation?utm_source=chatgpt.com "Image generation with Gemini (aka Nano Banana & Nano Banana Pro)"))
    

---

## 6) Phase A PRD: Engine + Lab UI + Wallpaper + Scheduler

### A1. Core engine + pipeline + CLI *(Done)*

Gemini API client, scenario builder, prompt composer, output store, environment-based configuration, CLI entry point, and tests.

1. **Engine (shared library / module)**

    - Inputs: base image, scenario (time/weather/location), prompt config, model config

    - Outputs: generated image file + metadata JSON (scenario, prompt version, timestamps, model, seed if available)

    - Responsibilities:

        - Build scenario from time/weather data (real or overridden)

        - Compose prompt from scenario + template

        - Call Gemini image editing API

        - Write image + metadata JSON sidecar to output store

2. **CLI entry point** (`haystack-generate`)

    - Accepts image path + optional hour override

    - Loads configuration from environment variables

    - Runs the engine pipeline and outputs result path

    - Designed for `launchd` compatibility (A4)

### A2. Lab UI + Weather integration

Express API server + React (Vite) frontend. Open-Meteo weather provider. City search, time/weather controls, prompt editor, generate & preview, history panel.

1. **Open-Meteo weather provider module** (`src/weather/`)

    - `resolveLocation(query)` — city search via Open-Meteo geocoding API

    - `getHourlyConditions(lat, lon, timezone)` — current weather conditions

    - Provider interface for future swapping (see provider interface below)

    - Unit tests with mocked HTTP responses

2. **Express API server** (`src/server/`)

    - POST `/api/generate` — accepts image + scenario overrides + prompt config, returns image + metadata

    - GET `/api/history` — returns last N generations

    - GET `/api/outputs/:id` — serves generated images (no file extension in URL)

    - POST `/api/location/search` — proxies city search to Open-Meteo

    - GET `/api/weather` — gets current conditions for configured location

    - GET `/api/config/default-template` — returns the default prompt template

    - POST `/api/scenario-preview` — returns a human-readable scenario description for given hour/weather/location

    - Static file serving for React frontend

3. **React frontend** (`lab-ui/`)

    - Vite + React + TypeScript

    - File upload control (drag & drop or file picker)

    - Location picker (city search → lat/lon)

    - Time override (hour slider or dropdown)

    - Weather display (current conditions from location)

    - Prompt editor (editable textarea with template)

    - "Generate & Preview" button → shows result

    - History panel with thumbnails + metadata

4. **Integration wiring**

    - `npm run lab` script to start server + Vite dev server

    - Proxy config so Vite dev server forwards API calls to Express

**Note:** The "Apply as Wallpaper" button is added in A3, not here. Lab UI in A2 focuses purely on prompt iteration.

**Weather provider interface**

- `searchLocations(query) -> Location[]` — city search returning `{ name, country, lat, lon, timezone, admin1? }`

- `getHourlyConditions(lat, lon, timezone) -> HourlyConditions[]` — hourly weather slots for current day

- `getCurrentConditions(lat, lon, timezone) -> CurrentConditions` — the hourly slot matching "now", includes sunrise/sunset

- `getForecast(lat, lon, timezone) -> { current, hourly }` — both current and hourly in a single call

Support _at least one_ provider + a clean interface for swapping providers.

**Top 3 candidate APIs**

1. **Open-Meteo**: no key required; hourly variables; timezone support; includes "is day or night". ([Open Meteo](https://open-meteo.com/en/docs "️ Docs | Open-Meteo.com"))

2. **WeatherAPI.com**: free tier shows **$0/month** with **1M calls/month** and includes **Astronomy API**. ([WeatherAPI](https://www.weatherapi.com/pricing.aspx "Pricing - WeatherAPI.com"))

3. **Visual Crossing**: 1,000 free records/day, with metered pricing beyond. ([Visual Crossing](https://www.visualcrossing.com/resources/blog/how-do-i-get-free-weather-api-access/ "How do I get free weather API access? | Visual Crossing"))

**MVP recommendation:** start with Open-Meteo for minimal friction; add WeatherAPI.com next if you need a more integrated "one vendor" experience.

### A3. Wallpaper apply

`desktoppr` CLI integration. Apply generated image as macOS wallpaper (primary display only).

- Use `desktoppr` CLI (external dependency, but simple and proven). ([GitHub](https://github.com/scriptingosx/desktoppr?utm_source=chatgpt.com "GitHub - scriptingosx/desktoppr: Simple command line tool to set the ..."))

- **Requirement:** primary display only.

- Adds "Apply as Wallpaper" button to Lab UI.

### A4. launchd hourly scheduler

`.plist` file for hourly generation. Triggers generation via the running Express server. Sleep-proof alternative to the in-process `setTimeout` scheduler.

- A background job scheduled hourly using `launchd` (preferred macOS approach; survives sleep/wake cycles unlike in-process timers). ([Apple Developer](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html?utm_source=chatgpt.com "Scheduling Timed Jobs - Apple Developer"))

- Triggers generation by hitting the server's override endpoint (`curl -X POST http://localhost:4321/api/scheduler/override`). The server handles weather fetch, image generation, and output storage — the kiosk (Phase C) picks up new images automatically.

- Active hours enforced server-side via `HAYSTACK_ACTIVE_START` / `HAYSTACK_ACTIVE_END` env vars.

- Logs output to `~/.haystack/launchd.log` for debugging.

- **Why curl instead of CLI:** The kiosk depends on the Express server's output store. Running the CLI directly would bypass the server and generate to a separate pipeline the kiosk can't see. Using curl keeps a single generation path.

- **Future (A3):** When wallpaper apply is added, `desktoppr` can be called server-side after generation or the plist command can be replaced with a wrapper script that does both.

### Phase A: General requirements

**Drift control**

- Always generate each hour from the **original base** (or "base + smart-extend") rather than from the last output.

- Store prompt versions and scenario metadata to reproduce outputs.

**Error handling**

- If generation fails:

    - Keep current wallpaper unchanged

    - Log the failure and surface in Lab UI

    - Retry policy (simple): 1 retry after 2 minutes

- If weather fetch fails:

    - Fall back to "time-only" scenario

    - Mark scenario as degraded in metadata

**Privacy & security**

- Store Gemini API key locally:

    - MVP: environment variable acceptable for dev

    - Recommended: macOS Keychain once Phase B begins

- Art and generated images remain local and ephemeral (purge policy).
    

---

## 7) Phase B PRD: macOS Menu Bar App

### Goal

Replace "Lab UI + scripts" with a friendly, installable Mac experience while reusing the Phase A Engine.

### B1. Electron shell + menu bar

Status icon with quick actions. Bundles the Phase A engine.

- Start/Stop living wallpaper

- Generate now

- Open "Lab/Settings" window

- View last output

### B2. Settings UI

- Artwork picker (file or folder)

- Location picker (search + map optional)

- Schedule settings:

    - hourly cadence

    - quiet hours toggle + range

- Model settings:

    - default model (Nano Banana Pro) with override via advanced settings

### B3. Prompt editor + preview

Port Lab UI prompt editor into Electron. In-app preview before applying.

### B4. Folder-based artwork management

- Users can designate a local folder as an "artwork source"

- The app watches the folder for new/removed images

- Selection modes:

    - **Single image:** User picks one image from the folder to use as the active base

    - **Rotation:** All images in the folder rotate automatically

- Rotation frequency options:

    - Daily (change base image once per day)

    - Weekly (change base image once per week)

    - Monthly (change base image once per month)

- Folder requirements:

    - Supports jpg/png/webp files

    - Ignores hidden files and non-image files

    - Shows thumbnail grid for easy selection

### B5. Keychain integration

Store API key in macOS Keychain instead of environment variable.

### B6. Scheduling hardening

- App-managed scheduling + `launchd` for persistence

- Ensure it works after reboot/login

### UX requirements

- Minimal friction onboarding:

    1. Add art → 2) Set location → 3) Start

- Fast "Generate now" loop for prompt iteration (no need to open a browser).

### Technical requirements

- Use desktoppr or `NSWorkspace.setDesktopImageURL` directly from the app for wallpaper setting. ([Apple Developer](https://developer.apple.com/documentation/appkit/nsworkspace/setdesktopimageurl%28_%3Afor%3Aoptions%3A%29?utm_source=chatgpt.com "setDesktopImageURL(_:for:options:) | Apple Developer Documentation"))

- Store API key and sensitive config in Keychain (recommended for packaged app).
    

---

## 8) Phase C PRD: Always-On TV Track (Raspberry Pi / Tiny HDMI Kiosk)

### Goal

Provide an "ambient art display" that can run on a TV continuously without depending on a Mac being awake.

### Concept

A dedicated device connected via HDMI runs a kiosk browser that displays the current "living art" and updates automatically.

### C1. Kiosk display page

Fullscreen image view with CSS crossfade transitions. Polls for updates.

- Fullscreen image view

- Smooth transitions:

    - Crossfade built into the page (CSS fade)

- Update mechanism:

    - Poll every X minutes for "latest image manifest" (simple)

    - Or WebSocket push (phase 2)

### C2. Mac-side "serve latest" endpoint

Tiny HTTP server on Mac serving `/latest.json` manifest + `/images/:id.png`.

- Option A (local network, simplest): Mac runs a tiny HTTP server that serves:

    - `/latest.json` (manifest)

    - `/images/<id>.jpg`

- Option B (more robust): upload to a cloud bucket (deferred; not MVP unless needed)

### C3. Pairing + configuration

- "Hardcore mode": user inputs Mac's local IP/URL into Pi once

- Optional: QR code pairing shown by the Mac app

### C4. Folder sync + rotation

Kiosk reuses folder settings from Phase B. Manifest includes rotation schedule.

- Reuses folder settings from Phase B menu bar app

- Mac serves images from the designated folder to the kiosk

- Selection modes (configured on Mac, applied to kiosk):

    - **Single image:** Kiosk displays the same active base as Mac

    - **Rotation:** Kiosk rotates through folder images on configured schedule

- Rotation frequency options:

    - Daily / Weekly / Monthly (synced with Mac settings)

- Manifest includes:

    - Current active image

    - Full image list for rotation mode

    - Next rotation timestamp

### C5. Autostart + recovery

- Runs headless, auto-start on boot

- Recovers from power loss

- Doesn't require constant user interaction
    

---

## 9) System Architecture (Common)

### Components

- **Engine**
    
    - Scenario provider (real vs override)
        
    - Smart-extend compositor
        
    - Gemini image editing client
        
    - Output store (files + metadata)
        
- **UI**
    
    - Phase A: localhost Lab UI
        
    - Phase B: menu bar UI
        
- **Scheduler**
    
    - Phase A: `launchd` job ([Apple Developer](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html?utm_source=chatgpt.com "Scheduling Timed Jobs - Apple Developer"))
        
    - Phase B: app-integrated + `launchd` for persistence
        
- **(Phase C) Display**
    
    - Kiosk browser page + image fetch
        

### Data model (suggested)

- `Artwork { id, sourceType(file/folder), sourcePath, createdAt }`

- `ArtworkFolder { id, folderPath, selectionMode(single/rotation), rotationFrequency(daily/weekly/monthly), activeImageId, lastRotatedAt }`

- `Location { name, lat, lon, timezone }`
    
- `Scenario { timestampLocal, hour, isDay, weatherCode?, cloudPercent?, precipProbability?, temperature?, humidity?, windSpeed?, windGusts?, visibility?, precipitation?, rain?, snowfall?, snowDepth?, directRadiation?, diffuseRadiation?, sunElevation?, sunAzimuth?, moonFraction?, moonAltitude?, sunrise?, sunset? }`
    
- `PromptVersion { id, text, createdAt, notes }`
    
- `Render { id, artworkId, scenario, promptVersionId, modelId, outputPath, createdAt, status }`
    

---

## 10) Key Product Decisions (Lock these early)

1. **Schedule semantics**
    
    - Option 1: generate at top of hour
        
    - Option 2: generate every 60 minutes since start
        
    - Recommendation: top-of-hour for “time passing” coherence.
        
2. **Weather provider choice**
    
    - Recommendation: Open-Meteo first (no key, rich hourly + timezone + is_day). ([Open Meteo](https://open-meteo.com/en/docs "️ Docs | Open-Meteo.com"))
        
3. **Wallpaper application method**
    
    - Phase A: Swift CLI helper (preferred) or `desktoppr` dependency. ([Apple Developer](https://developer.apple.com/documentation/appkit/nsworkspace/setdesktopimageurl%28_%3Afor%3Aoptions%3A%29?utm_source=chatgpt.com "setDesktopImageURL(_:for:options:) | Apple Developer Documentation"))
        
    - Phase B: native call via AppKit.
        
4. **Outpainting strategy**
    
    - MVP: “smart extend” using Gemini edit prompt; fallback to blur extend.
        

---

## 11) Risks & Mitigations

1. **Generative drift / undesired edits**
    
    - Mitigation: always generate from base; strict prompt constraints; keep prompt version history.
        
2. **Latency / rate limits**
    
    - Mitigation: pre-generate “next hour” a few minutes early; backoff on errors.
        
3. **Weather API fragility**
    
    - Mitigation: provider abstraction; cache last successful hourly forecast; fall back to time-only.
        
4. **macOS wallpaper quirks**
    
    - Mitigation: primary display only; use Apple’s supported API. ([Apple Developer](https://developer.apple.com/documentation/appkit/nsworkspace/setdesktopimageurl%28_%3Afor%3Aoptions%3A%29?utm_source=chatgpt.com "setDesktopImageURL(_:for:options:) | Apple Developer Documentation"))
        
5. **Phase C network reliability**
    
    - Mitigation: manifest polling; local caching on device; reconnect logic.
        

---

## 12) Milestones

### Phase A (Engine + Lab + Wallpaper + Scheduler)

- A1: Core engine + pipeline + CLI *(Done)*

- A2: Lab UI + Weather integration (Open-Meteo)

- A3: Wallpaper apply via `desktoppr`

- A4: `launchd` hourly scheduler + quiet hours

### Phase B (Menu bar app)

- B1: Electron shell + menu bar

- B2: Settings UI

- B3: Prompt editor + preview

- B4: Folder-based artwork management + rotation scheduling

- B5: Keychain integration

- B6: Scheduling hardening + reliability

### Phase C (TV kiosk)

- C1: Kiosk display page + manifest polling

- C2: Mac-side "serve latest" endpoint

- C3: Pairing + configuration

- C4: Folder sync + rotation

- C5: Autostart kiosk on boot + recovery
    

---

## 13) Appendix: External Dependencies (Shortlist)

- **Gemini image generation/editing models** (Nano Banana / Nano Banana Pro). ([Google AI for Developers](https://ai.google.dev/gemini-api/docs/image-generation?utm_source=chatgpt.com "Image generation with Gemini (aka Nano Banana & Nano Banana Pro)"))
    
- **macOS wallpaper API:** `NSWorkspace.setDesktopImageURL`. ([Apple Developer](https://developer.apple.com/documentation/appkit/nsworkspace/setdesktopimageurl%28_%3Afor%3Aoptions%3A%29?utm_source=chatgpt.com "setDesktopImageURL(_:for:options:) | Apple Developer Documentation"))
    
- **macOS scheduling:** `launchd` recommended for recurring jobs. ([Apple Developer](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html?utm_source=chatgpt.com "Scheduling Timed Jobs - Apple Developer"))
    
- **Weather APIs:** Open-Meteo, WeatherAPI.com, Visual Crossing. ([Open Meteo](https://open-meteo.com/en/docs "️ Docs | Open-Meteo.com"))

- **Sun/moon position:** `suncalc` npm package for computing sun elevation/azimuth, moon fraction, and moon altitude from coordinates and time.
    

---

