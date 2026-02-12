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

1. _As a user_, I can upload an image, set a folder from my laptop with multiple images or provide an image URL and start “living wallpaper” mode.
    
2. _As a user_, I can set a location and the wallpaper changes to reflect local time and weather.
    
3. _As the developer_, I can tweak the system prompt and regenerate instantly without waiting.
    
4. _As a user_, the wallpaper updates hourly (with optional quiet hours).
    
5. _As a hardcore user_, I can run an always-on TV display from a small dedicated device.

---
## 4) Core Product Requirements (All Phases)

### Artwork input

- Accept:
    
    - File upload (local)
        
    - Image URL (download to local cache)
        
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

## 6) Phase A PRD: Engine + Lab UI + `launchd` Runner

### A1. Deliverables

1. **Engine (shared library / module)**
    
    - Inputs: base image, scenario (time/weather/location), prompt config, model config
        
    - Outputs: generated image file + metadata JSON (scenario, prompt version, timestamps, model, seed if available)
        
    - Responsibilities:
        
        - Fetch scenario (real or overridden)
            
        - Call Gemini image editing
            
        - Write artifacts and logs
            
2. **Lab UI (localhost)**
    
    - Simple local web app (runs at `http://localhost:<port>`)
        
    - Purpose: rapid prompt testing + scenario simulation
        
    - Must-have controls:
        
        - Upload file / paste URL
            
        - Location: search city
            
        - System prompt editor (textbox) + “save prompt version”
            
        - Generate button (“Generate & preview”)
            
        - Apply button (“Apply as wallpaper now”)
            
        - History list: last N generations with thumbnails + metadata
            
3. **Scheduled runner (`launchd`)**
    
    - A background job scheduled hourly using `launchd` (preferred macOS approach; cron is supported but Apple documents `launchd` for scheduled jobs). ([Apple Developer](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html?utm_source=chatgpt.com "Scheduling Timed Jobs - Apple Developer"))
        
    - Runs the engine with “real scenario” (no overrides)
        
    - Logs success/failure, keeps last applied wallpaper path.
        

### A2. macOS wallpaper setting (Phase A)

Use `desktoppr` CLI (external dependency, but simple and proven). ([GitHub](https://github.com/scriptingosx/desktoppr?utm_source=chatgpt.com "GitHub - scriptingosx/desktoppr: Simple command line tool to set the ..."))
    
**Requirement:** primary display only.

### A3. Weather/Time providers (Phase A)

Support _at least one_ provider + a clean interface for swapping providers.

**Provider interface**

- `resolveLocation(query) -> {lat, lon, timezone, displayName}`
    
- `getHourlyConditions(lat, lon, timezone, timeRange) -> hourly[]`
    

**Top 3 candidate APIs**

1. **Open-Meteo**: no key required; hourly variables; timezone support; includes “is day or night”. ([Open Meteo](https://open-meteo.com/en/docs "️ Docs | Open-Meteo.com"))
    
2. **WeatherAPI.com**: free tier shows **$0/month** with **1M calls/month** and includes **Astronomy API**. ([WeatherAPI](https://www.weatherapi.com/pricing.aspx "Pricing - WeatherAPI.com"))
    
3. **Visual Crossing**: 1,000 free records/day, with metered pricing beyond. ([Visual Crossing](https://www.visualcrossing.com/resources/blog/how-do-i-get-free-weather-api-access/ "How do I get free weather API access? | Visual Crossing"))
    

**MVP recommendation:** start with Open-Meteo for minimal friction; add WeatherAPI.com next if you need a more integrated “one vendor” experience.

### A4. Drift control requirements

- Always generate each hour from the **original base** (or “base + smart-extend”) rather than from the last output.
    
- Store prompt versions and scenario metadata to reproduce outputs.
    

### A5. Error handling (Phase A)

- If generation fails:
    
    - Keep current wallpaper unchanged
        
    - Log the failure and surface in Lab UI
        
    - Retry policy (simple): 1 retry after 2 minutes
        
- If weather fetch fails:
    
    - Fall back to “time-only” scenario
        
    - Mark scenario as degraded in metadata
        

### A6. Privacy & security (Phase A)

- Store Gemini API key locally:
    
    - MVP: environment variable acceptable for dev
        
    - Recommended: macOS Keychain once Phase B begins
        
- Art and generated images remain local and ephemeral (purge policy).
    

---

## 7) Phase B PRD: macOS Menu Bar App

### B1. Goal

Replace “Lab UI + scripts” with a friendly, installable Mac experience while reusing the Phase A Engine.

### B2. Deliverables

1. **Menu bar app shell**
    
    - Status icon with quick actions:
        
        - Start/Stop living wallpaper
            
        - Generate now
            
        - Open “Lab/Settings” window
            
        - View last output
            
2. **Settings UI**

    - Artwork picker (file, URL, or folder)

    - Location picker (search + map optional)

    - Schedule settings:

        - hourly cadence

        - quiet hours toggle + range

    - Model settings:

        - default model (Nano Banana Pro) with override via advanced settings

3. **Folder-based artwork management**

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

4. **Local preview + apply**

    - Preview output in-app before applying

5. **Background scheduling**
    
    - Use `launchd` or app-managed scheduling (Timer) as appropriate
        
    - Ensure it works after reboot/login
        

### B3. UX requirements

- Minimal friction onboarding:
    
    1. Add art → 2) Set location → 3) Start
        
- Fast “Generate now” loop for prompt iteration (no need to open a browser).
    

### B4. Technical requirements

- Use desktopper or `NSWorkspace.setDesktopImageURL` directly from the app for wallpaper setting. ([Apple Developer](https://developer.apple.com/documentation/appkit/nsworkspace/setdesktopimageurl%28_%3Afor%3Aoptions%3A%29?utm_source=chatgpt.com "setDesktopImageURL(_:for:options:) | Apple Developer Documentation"))
    
- Store API key and sensitive config in Keychain (recommended for packaged app).
    

---

## 8) Phase C PRD: Always-On TV Track (Raspberry Pi / Tiny HDMI Kiosk)

### C1. Goal

Provide an “ambient art display” that can run on a TV continuously without depending on a Mac being awake.

### C2. Concept

A dedicated device connected via HDMI runs a kiosk browser that displays the current “living art” and updates automatically.

### C3. Deliverables

1. **Kiosk display page**
    
    - Fullscreen image view
        
    - Smooth transitions:
        
        - Crossfade built into the page (CSS fade)
            
    - Update mechanism:
        
        - Poll every X minutes for “latest image manifest” (simple)
            
        - Or WebSocket push (phase 2)
            
2. **Image distribution**
    
    - Option A (local network, simplest): Mac runs a tiny HTTP server that serves:
        
        - `/latest.json` (manifest)
            
        - `/images/<id>.jpg`
            
    - Option B (more robust): upload to a cloud bucket (deferred; not MVP unless needed)
        
3. **Pairing / configuration**

    - "Hardcore mode": user inputs Mac's local IP/URL into Pi once

    - Optional: QR code pairing shown by the Mac app

4. **Folder-based artwork management (synced from Mac)**

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


### C4. Requirements

- Runs headless, auto-start on boot
    
- Recovers from power loss
    
- Doesn’t require constant user interaction
    

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

- `Artwork { id, sourceType(file/url/folder), sourcePath, createdAt }`

- `ArtworkFolder { id, folderPath, selectionMode(single/rotation), rotationFrequency(daily/weekly/monthly), activeImageId, lastRotatedAt }`

- `Location { name, lat, lon, timezone }`
    
- `Scenario { timestampLocal, hour, weatherCode, cloudPct, precipPct, isDay, sunrise, sunset }`
    
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

## 12) Milestones (Suggested)

### Phase A (Engine + Lab + runner)

- A0: Repo + basic engine skeleton + local output store
    
- A1: Gemini edit pipeline (base → output)
    
- A2: Wallpaper apply via helper
    
- A3: Lab UI with manual time/weather + prompt editor
    
- A4: `launchd` hourly runner + logs
    
- A5: Location + weather integration (Open-Meteo)
    

### Phase B (Menu bar app)

- B1: Shell app + settings + start/stop

- B2: Prompt editor + preview

- B3: Folder-based artwork management + rotation scheduling

- B4: Keychain integration

- B5: Harden scheduling + reliability
    

### Phase C (TV kiosk)

- C1: Kiosk display page + manifest polling
    
- C2: Mac-side “serve latest” endpoint
    
- C3: Autostart kiosk on boot + recovery
    

---

## 13) Appendix: External Dependencies (Shortlist)

- **Gemini image generation/editing models** (Nano Banana / Nano Banana Pro). ([Google AI for Developers](https://ai.google.dev/gemini-api/docs/image-generation?utm_source=chatgpt.com "Image generation with Gemini (aka Nano Banana & Nano Banana Pro)"))
    
- **macOS wallpaper API:** `NSWorkspace.setDesktopImageURL`. ([Apple Developer](https://developer.apple.com/documentation/appkit/nsworkspace/setdesktopimageurl%28_%3Afor%3Aoptions%3A%29?utm_source=chatgpt.com "setDesktopImageURL(_:for:options:) | Apple Developer Documentation"))
    
- **macOS scheduling:** `launchd` recommended for recurring jobs. ([Apple Developer](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html?utm_source=chatgpt.com "Scheduling Timed Jobs - Apple Developer"))
    
- **Weather APIs:** Open-Meteo, WeatherAPI.com, Visual Crossing. ([Open Meteo](https://open-meteo.com/en/docs "️ Docs | Open-Meteo.com"))
    

---

