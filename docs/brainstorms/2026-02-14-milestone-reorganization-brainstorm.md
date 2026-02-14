# Milestone Reorganization Brainstorm

**Date:** 2026-02-14
**Status:** Final
**Participants:** Andres + Claude

---

## What We're Solving

The PRD (`docs/idea-draft.md`) has two conflicting numbering schemes for Phase A milestones:

| Section 6 (PRD Deliverables) | Section 12 (Milestones) |
|------------------------------|------------------------|
| A1 = Engine + Lab UI + launchd | A0 = Repo skeleton |
| A2 = Wallpaper setting method | A1 = Gemini pipeline only |
| A3 = Weather/Time providers | A2 = Wallpaper apply |
| | A3 = Lab UI |
| | A4 = launchd runner |
| | A5 = Weather integration |

Same conflict exists for Phases B and C. Section 6 groups by *capability area*, Section 12 breaks into *buildable milestones*. We followed Section 12's granular approach for Phase A1 and it worked well.

Beyond the numbering conflict, the **ordering** also needs rethinking. The current Section 12 order puts wallpaper apply (A2) and launchd (A4) before weather integration (A5), but it makes more sense to:

1. Get weather data flowing into prompts first
2. Iterate on prompt quality via the Lab UI
3. Only then automate (wallpaper apply + scheduling)

---

## Why This Approach

**Adopt Section 12's granular milestone style, but reorder for quality-first iteration.**

Rationale:

- **Granular milestones work for agents.** Each milestone is atomic: it has clear inputs, outputs, and can be verified independently. Section 6's "A1 = Engine + Lab UI + launchd" bundles three unrelated concerns.

- **Prompt quality before automation.** The product's value is in the generated images. If the prompts don't produce good results, automating wallpaper changes just automates bad results. Weather context significantly affects prompt quality (rain, fog, sunset vs. generic "evening"), so it should come before automation.

- **Open-Meteo is simple.** No API key, straightforward REST API, well-documented. It's not a heavy lift to bundle with Lab UI.

- **Wallpaper apply and launchd are output concerns.** They don't affect image quality — they just deploy the result. They belong at the end once you know the outputs are good.

---

## Reorganized Milestone Scheme

### Phase A: Engine + Lab + Automation

| Milestone | Name | Description | Status |
|-----------|------|-------------|--------|
| **A1** | Core engine + pipeline + CLI | Gemini API client, scenario builder, prompt composer, output store, config, CLI, tests | **Done** |
| **A2** | Lab UI + Weather integration | Express API server + React (Vite) frontend. Open-Meteo weather provider. City search, time/weather controls, prompt editor, generate & preview, history panel. | Pending |
| **A3** | Wallpaper apply | `desktoppr` CLI integration. Apply generated image as macOS wallpaper (primary display only). | Pending |
| **A4** | launchd hourly scheduler | `.plist` file for hourly generation. Runs CLI with real scenario (no overrides). Quiet hours support (00:00-05:00). | Pending |

**Key change from original Section 12:** Weather (was A5) moves into A2 alongside Lab UI. Wallpaper (was A2) and launchd (was A4) move to end.

### A2 Internal Breakdown

A2 is the largest remaining milestone. For agent buildability, it breaks into ordered sub-tasks:

1. **Open-Meteo weather provider module** (`src/weather/`)
   - `resolveLocation(query)` — city search via Open-Meteo geocoding API
   - `getHourlyConditions(lat, lon, timezone)` — current weather conditions
   - Provider interface for future swapping
   - Unit tests with mocked HTTP responses

2. **Express API server** (`src/server/`)
   - POST `/api/generate` — accepts image + scenario overrides + prompt config, returns image + metadata
   - GET `/api/history` — returns last N generations
   - GET `/api/outputs/:id.png` — serves generated images
   - POST `/api/location/search` — proxies city search to Open-Meteo
   - GET `/api/weather` — gets current conditions for configured location
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

### Phase B: macOS Menu Bar App

| Milestone | Name | Description |
|-----------|------|-------------|
| **B1** | Electron shell + menu bar | Status icon, start/stop, generate now, open settings. Bundles the Phase A engine. |
| **B2** | Settings UI | Artwork picker, location picker, schedule settings (cadence + quiet hours), model settings. |
| **B3** | Prompt editor + preview | Port Lab UI prompt editor into Electron. In-app preview before applying. |
| **B4** | Folder-based artwork management | Folder watching, single image / rotation modes, daily/weekly/monthly rotation. |
| **B5** | Keychain integration | Store API key in macOS Keychain instead of environment variable. |
| **B6** | Scheduling hardening | App-managed scheduling + launchd for persistence. Survives reboot/login. |

### Phase C: Always-On TV Kiosk

| Milestone | Name | Description |
|-----------|------|-------------|
| **C1** | Kiosk display page | Fullscreen image view with CSS crossfade transitions. Polls for updates. |
| **C2** | Mac-side "serve latest" endpoint | Tiny HTTP server on Mac serving `/latest.json` manifest + `/images/:id.png`. |
| **C3** | Pairing + configuration | User inputs Mac's local IP into Pi. Optional QR code pairing. |
| **C4** | Folder sync + rotation | Kiosk reuses folder settings from Phase B. Manifest includes rotation schedule. |
| **C5** | Autostart + recovery | Headless boot, auto-start kiosk browser, recover from power loss. |

---

## Key Decisions

1. **Single numbering scheme.** Section 12's granular milestones win. Section 6 subsections get rewritten to use matching A1-A4 labels. Both sections stay in sync.

2. **Weather bundled with Lab UI (A2).** Open-Meteo is simple enough to include, and weather context meaningfully affects prompt quality iteration.

3. **Wallpaper + launchd are last (A3, A4).** These are deployment/automation concerns. Get the images right first.

4. **Lab UI stack: Express + React (Vite).** Feeds into Phase B (Electron wraps React). Interactive enough for 6+ controls. TypeScript throughout.

5. **Lab UI lives at `lab-ui/` in the project root.** Separate `package.json` for clean build isolation from the Node.js engine.

6. **"Apply as Wallpaper" button added entirely in A3.** Lab UI in A2 focuses purely on prompt iteration. No disabled placeholder buttons.

7. **A2 has internal sub-tasks but ships as one milestone.** The weather provider, server, and frontend are tested together because they're meaningless in isolation from the user's perspective.

8. **PRD gets updated.** Both Section 6 and Section 12 of `idea-draft.md` will be rewritten to use the new milestone scheme. This happens as part of planning, before implementation begins.

---

## Resolved Questions

1. **PRD update:** Both Section 6 and Section 12 get rewritten with matching milestone labels (A1-A4, B1-B6, C1-C5).
2. **Lab UI location:** `lab-ui/` at project root with its own `package.json`.
3. **Wallpaper button scope:** Added entirely in A3. Lab UI (A2) focuses on prompt iteration only.

## Remaining Open Questions

1. **Lab UI port number?** Default to 3000? Or something less likely to conflict (3141, 4321)?

---

## What This Enables

```
A1 (done) → A2 (Lab UI + Weather) → A3 (Wallpaper) → A4 (launchd)
                    ↓
              "Is the art good?"
              "Do the prompts work?"
              "Does weather context help?"
                    ↓
              Only then automate
                    ↓
            B1-B6 (Menu Bar App)
                    ↓
            C1-C5 (TV Kiosk)
```

The reorganized flow ensures you never automate something you haven't manually verified.