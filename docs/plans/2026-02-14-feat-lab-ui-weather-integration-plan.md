# Lab UI + Weather Integration (Phase A2)

---
title: "feat: Lab UI + Weather Integration"
type: feat
date: 2026-02-14
---

## Overview

Build the prompt iteration environment for Haystack: an Express API server, React (Vite) frontend ("Lab UI"), and Open-Meteo weather provider. This is the largest remaining Phase A milestone and the first time a user can interact with the engine visually. The milestone ships as one unit because the components are meaningless in isolation.

**Why A2 before wallpaper/scheduling:** The product's value is in generated image quality. Weather context significantly affects prompt results (rain, fog, sunset vs. generic "evening"). Iterating on prompts visually — before automating wallpaper changes — prevents automating bad output.

**Scope boundary:** "Apply as Wallpaper" is A3. A2 focuses purely on prompt iteration and preview.

## Problem Statement

Phase A1 delivered a working engine that generates edited images via the CLI. But prompt iteration requires:

1. Running CLI commands repeatedly with different `--hour` values
2. Manually opening output files to inspect results
3. No weather context (all scenarios are time-only)
4. No way to compare history visually

A2 solves this by providing a browser-based lab where developers and early adopters can upload an image, set location/time/weather, edit prompts, generate, and review results — all in a tight loop.

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Lab UI (React + Vite)                       │
│  File upload │ Location picker │ Time/Weather │ Prompt │ History    │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ fetch("/api/...")
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Express API Server                             │
│  POST /api/generate │ GET /api/history │ POST /api/location/search  │
│  GET /api/outputs/:id │ GET /api/weather                            │
└────────────┬────────────────────────────────┬───────────────────────┘
             │                                │
             ▼                                ▼
┌────────────────────────┐       ┌────────────────────────────────────┐
│   Engine (Pipeline)    │       │   Weather Provider (Open-Meteo)    │
│   from Phase A1        │       │   src/weather/                     │
└────────────────────────┘       └────────────────────────────────────┘
```

**Key constraint:** The engine uses Node.js APIs (`fs`, `os`, `crypto`) and holds the API key. It cannot run in the browser. The Express server is the bridge between the Lab UI and the engine.

### Data Flow: Generate Request

```
1. User selects image, sets hour/location, edits prompt
2. Frontend POSTs to /api/generate with:
   - image (multipart file upload)
   - scenario overrides (hour, weatherCode, isDay, etc.)
   - promptOverride (optional raw prompt text)
3. Server builds Scenario from overrides + weather data
4. Server writes uploaded image to temp file
5. Server calls Pipeline.generate(tempImagePath, scenario, promptOverride?)
6. Server returns { metadata, imageUrl: "/api/outputs/{id}" }
7. Frontend displays result + metadata
```

### Design Decision: Image Upload Per Request

The image is sent with every generate request (not pre-uploaded separately). Rationale:

- **Simplicity:** No session state, no upload lifecycle to manage
- **Statelessness:** Server can restart without losing "current image" context
- **Size:** Typical artwork is 1-5 MB — well within Express multipart limits
- **Lab use case:** Users may switch images frequently during iteration

A `multer`-based middleware handles multipart parsing with `diskStorage` into `os.tmpdir()`. This avoids buffering the entire image in memory (multer's `memoryStorage` can cause memory pressure with large files). The engine receives `req.file.path` directly, and the temp file is deleted in a `finally` block.

### Design Decision: Scenario Construction on Server

The frontend sends **raw overrides** (hour, location coordinates, etc.). The server constructs the `Scenario` object by:

1. Using the hour override (or current hour if none)
2. Fetching weather from Open-Meteo for the given location + hour (if location is set)
3. Merging into a complete `Scenario` struct
4. Passing to `Pipeline.generate()`

This keeps the engine types out of the frontend and ensures weather data always comes from the server-side provider.

### Design Decision: Lab UI Port

Default to `4321` for the Express server. Port 3000 conflicts too often with other dev tools. The Vite dev server runs on its default port (`5173`) and proxies `/api/*` to Express.

---

## Implementation Plan

### Sub-task 1: Open-Meteo Weather Provider Module

**Files to create:**

```
src/weather/
  types.ts           # WeatherProvider interface, Location, HourlyConditions
  open-meteo.ts      # Open-Meteo implementation
  index.ts           # Barrel exports
tests/weather/
  open-meteo.test.ts # Mocked HTTP response tests
```

#### `src/weather/types.ts` — Provider Interface

```typescript
/** Resolved location from geocoding search. */
export interface Location {
  name: string;           // "Madrid"
  country: string;        // "Spain"
  lat: number;
  lon: number;
  timezone: string;       // "Europe/Madrid"
  admin1?: string;        // State/province for disambiguation
}

/** Hourly weather conditions for a single point in time. */
export interface HourlyConditions {
  time: string;                    // ISO 8601 in local timezone
  weatherCode: number;             // WMO code (matches Scenario.weatherCode)
  cloudPercent: number;            // 0-100
  precipProbability: number;       // 0-100
  temperature: number;             // Celsius
  isDay: boolean;
}

/** Current conditions = the hourly slot matching "now" in the location's timezone. */
export interface CurrentConditions extends HourlyConditions {
  sunrise: string;   // ISO 8601
  sunset: string;    // ISO 8601
}

/**
 * Weather provider interface — abstracts the data source.
 * Open-Meteo is the MVP implementation. WeatherAPI.com is the backup.
 */
export interface WeatherProvider {
  /** City search → list of matching locations. */
  searchLocations(query: string): Promise<Location[]>;

  /** Get hourly conditions for a location. Returns conditions for the current day. */
  getHourlyConditions(lat: number, lon: number, timezone: string): Promise<HourlyConditions[]>;

  /** Get current conditions (the hourly slot matching "now"). Includes sunrise/sunset. */
  getCurrentConditions(lat: number, lon: number, timezone: string): Promise<CurrentConditions>;
}
```

#### `src/weather/open-meteo.ts` — Implementation

**Geocoding endpoint:** `GET https://geocoding-api.open-meteo.com/v1/search?name={query}&count=5&language=en`

**Forecast endpoint:** `GET https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&timezone={tz}&hourly=weather_code,cloud_cover,precipitation_probability,temperature_2m,is_day&daily=sunrise,sunset&forecast_days=1`

Key implementation notes:

- Uses native `fetch` (Node 20+, no external HTTP library needed)
- `searchLocations()` maps Open-Meteo geocoding response to `Location[]`
- **Single-fetch design:** A private `fetchForecastDay(lat, lon, timezone)` method makes one Forecast API call requesting both `hourly` and `daily` fields. Both public methods derive from this single response:
  - `getHourlyConditions()` zips the `hourly` parallel arrays into `HourlyConditions[]`
  - `getCurrentConditions()` picks the hourly slot matching the current hour (by parsing the `time` string, not by array index — handles DST days with 23/25 entries) and attaches `sunrise`/`sunset` from the `daily` response
- Match hourly slots by comparing the local hour from the `time` string, not by array index. On DST transition days, entries may be missing or duplicated — use closest match as fallback.
- Throws descriptive errors on non-200 responses

#### Tests: `tests/weather/open-meteo.test.ts`

- Mock `global.fetch` with `vi.fn()` returning canned JSON responses
- Test: `searchLocations("Madrid")` returns array of `Location` with correct fields
- Test: `searchLocations("")` throws or returns empty
- Test: `getHourlyConditions()` correctly zips parallel arrays into objects
- Test: `getCurrentConditions()` finds correct hour slot and includes sunrise/sunset
- Test: API error (500) throws descriptive error
- Test: Empty results from geocoding returns `[]`

---

### Sub-task 2: Express API Server

**Files to create:**

```
src/server/
  server.ts          # Express app factory + route registration
  index.ts           # Barrel exports
tests/server/
  server.test.ts     # Supertest-based API tests
```

**New dependencies:**

```
dependencies:
  express: ^5.0.0
  multer: ^2.0.0

devDependencies:
  @types/express: ^5.0.0
  @types/multer: ^2.0.0
  supertest: ^7.0.0
  @types/supertest: ^6.0.0
```

> **Note on Express 5:** Express 5 is now stable (released 2024). It natively supports async route handlers (no `express-async-errors` needed). If any issues arise, fall back to Express 4 with `express-async-errors`.

#### `src/server/server.ts` — App Factory

```typescript
export function createApp(config: {
  pipeline: Pipeline;
  weatherProvider: WeatherProvider;
  outputDir: string;
}): Express;
```

The function creates an Express app with:

1. **JSON body parser** for non-file routes
2. **Static file serving** for Lab UI production build (`lab-ui/dist`)
3. **Routes** (see below)

This pattern makes the app testable — tests create an app with mocked dependencies.

#### API Routes

**POST `/api/generate`**

```
Content-Type: multipart/form-data

Fields:
  image: File (required) — the base artwork (jpg/png/webp, max 20MB)
  hour: number (optional) — hour override 0-23
  weatherCode: number (optional) — WMO code override
  cloudPercent: number (optional) — 0-100
  precipProbability: number (optional) — 0-100
  isDay: string (optional) — "true" or "false"
  promptOverride: string (optional) — full raw prompt text
  lat: number (optional) — latitude for weather fetch
  lon: number (optional) — longitude for weather fetch
  timezone: string (optional) — IANA timezone for weather fetch

Response 200:
  {
    metadata: RenderMetadata,
    imageUrl: "/api/outputs/{id}"
  }

Response 400: { error: "No image provided" }
Response 500: { error: "<generation error message>" }
```

**Behavior:**

1. Parse multipart with `multer` (`diskStorage` into `os.tmpdir()`, 20MB limit)
2. Determine hour: from `hour` field, or current hour
3. Build scenario:
   - If `lat`/`lon`/`timezone` provided AND no explicit weather overrides → fetch from Open-Meteo
   - If explicit weather fields provided → use those directly
   - Otherwise → time-only scenario (no weather)
4. Normalize `promptOverride`: if empty or whitespace-only (`!promptOverride?.trim()`), treat as `undefined` so the engine uses `DEFAULT_TEMPLATE`
5. Call `pipeline.generate(req.file.path, scenario, promptOverride)` — multer already wrote the file to disk
6. Clean up temp file in `finally` block
7. Return metadata + image URL

**GET `/api/history`**

```
Query params:
  limit: number (optional, default 24)

Response 200:
  {
    renders: Array<RenderMetadata & { imageUrl: string }>
  }
```

Uses `pipeline.getStore().listAll()`, slices to limit, adds `imageUrl` to each entry.

**GET `/api/outputs/:id`**

Looks up the output file path from the store's metadata (by ID), then serves it with `res.sendFile()` and the correct `Content-Type`. Validates the ID against `VALID_ID_PATTERN` to prevent directory traversal. Returns 404 if the ID doesn't exist in the store.

**POST `/api/location/search`**

```
Content-Type: application/json
Body: { query: string }

Response 200:
  { locations: Location[] }

Response 400: { error: "Query is required" }
```

Proxies to `weatherProvider.searchLocations(query)`.

**GET `/api/weather`**

```
Query params:
  lat: number (required)
  lon: number (required)
  timezone: string (required)

Response 200:
  { current: CurrentConditions, hourly: HourlyConditions[] }

Response 400: { error: "lat, lon, and timezone are required" }
```

Calls `weatherProvider.getCurrentConditions()` and `weatherProvider.getHourlyConditions()`. Both derive from a single internal Forecast API call (see weather provider design), so this does not double-fetch.

#### Error Handling

- Wrap route handlers in try/catch (Express 5 handles async rejections natively)
- Return structured `{ error: string }` on all failures
- Log errors to stderr with timestamps
- If weather fetch fails during generate: fall back to time-only scenario, set `metadata.weatherDegraded = true`

#### Tests: `tests/server/server.test.ts`

Use `supertest` against the app factory with mocked `Pipeline` and `WeatherProvider`:

- Test: POST `/api/generate` with valid image + hour override returns 200 with metadata
- Test: POST `/api/generate` without image returns 400
- Test: POST `/api/generate` with lat/lon fetches weather and includes in scenario
- Test: GET `/api/history` returns list sorted newest-first
- Test: GET `/api/outputs/:id` serves existing image
- Test: GET `/api/outputs/:id` returns 404 for non-existent
- Test: POST `/api/location/search` with query returns locations
- Test: GET `/api/weather` with valid params returns conditions
- Test: Weather fetch failure during generate falls back to time-only scenario
- Test: POST `/api/generate` with whitespace-only `promptOverride` uses default template

---

### Sub-task 3: React Frontend (Lab UI)

**Directory structure:**

```
lab-ui/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/
    main.tsx
    App.tsx
    App.css
    components/
      ImageUpload.tsx        # Drag & drop + file picker
      LocationPicker.tsx     # City search input + results dropdown
      TimeControls.tsx       # Hour slider (0-23) + isDay toggle
      WeatherDisplay.tsx     # Current conditions read-only display
      PromptEditor.tsx       # Textarea with default template
      GenerateButton.tsx     # "Generate & Preview" button with loading state
      PreviewPanel.tsx       # Generated image display + metadata
      HistoryPanel.tsx       # Thumbnail grid of past generations
    hooks/
      useGenerate.ts         # API call hook for /api/generate
      useHistory.ts          # API call hook for /api/history
      useWeather.ts          # API call hooks for /api/weather + /api/location/search
    api/
      client.ts              # Typed fetch wrappers for all API endpoints
    types.ts                 # Frontend-side type definitions
```

**lab-ui/package.json dependencies:**

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

> **No UI framework (Tailwind, Material, etc.).** Plain CSS for the MVP. The Lab UI is a developer tool, not a consumer product. Functional > pretty. Add styling frameworks if/when Phase B (Electron) warrants it.

#### Component Breakdown

**`App.tsx`** — Main layout

Single-page layout with two columns:
- **Left column:** Controls (upload, location, time, weather, prompt, generate button)
- **Right column:** Preview (generated image + metadata) and History (thumbnail grid)

State lives in `App.tsx` (lifted state):
- `selectedImage: File | null`
- `location: { lat, lon, timezone, name } | null`
- `hour: number` (default: current hour)
- `weather: CurrentConditions | null`
- `promptOverride: string` (empty = use default template)
- `generatedResult: { metadata, imageUrl } | null`
- `isGenerating: boolean`

**`ImageUpload.tsx`**

- Drop zone + file input
- Validates file type (jpg/png/webp) and size (< 20MB) client-side
- Shows filename and thumbnail preview after selection
- Accepts prop: `onImageSelected(file: File)`

**`LocationPicker.tsx`**

- Text input with debounced search (300ms)
- Dropdown showing results from `/api/location/search`
- Each result shows: name, admin1 (state/region), country
- On selection: calls `onLocationSelected({ lat, lon, timezone, name })`
- Triggers weather fetch via parent

**`TimeControls.tsx`**

- Range input (`<input type="range" min={0} max={23}>`) with hour label
- Displays human-readable time description (same mapping as `getTimeOfDayDescription`)
- `isDay` toggle (auto-calculated from hour by default, but overrideable)

**`WeatherDisplay.tsx`**

- Read-only display of current conditions for selected location
- Shows: weather description, temperature, cloud cover, precipitation probability, day/night
- Shows "No location selected" when location is null
- Attribution footer: "Weather data by [Open-Meteo](https://open-meteo.com/) · [CC BY 4.0](https://open-meteo.com/en/licence)" — displayed whenever any Open-Meteo data is visible (weather display or geocoding results)

**`PromptEditor.tsx`**

- Textarea pre-filled with `DEFAULT_TEMPLATE`
- "Reset to default" button
- Shows the composed `{scenario}` substitution as a preview line above the textarea
- Accepts: `value`, `onChange`, `scenarioPreview`

**`GenerateButton.tsx`**

- Disabled when no image is selected or generation is in progress
- Shows spinner/loading state during generation
- `onClick` triggers the API call

**`PreviewPanel.tsx`**

- Shows the generated image (`<img src={imageUrl}>`)
- Collapsible metadata panel: model, prompt used, scenario details, token usage, response text
- "No generation yet" placeholder when empty

**`HistoryPanel.tsx`**

- Thumbnail grid of past generations (from `/api/history`)
- Each thumbnail is clickable → loads that result into PreviewPanel
- Shows timestamp, hour, and weather code badge per thumbnail
- Auto-refreshes after each generation

#### `lab-ui/src/api/client.ts` — API Client

```typescript
export async function generate(params: {
  image: File;
  hour?: number;
  weatherCode?: number;
  cloudPercent?: number;
  precipProbability?: number;
  isDay?: boolean;
  promptOverride?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
}): Promise<{ metadata: RenderMetadata; imageUrl: string }>;

export async function getHistory(limit?: number): Promise<{ renders: Array<RenderMetadata & { imageUrl: string }> }>;

export async function searchLocations(query: string): Promise<{ locations: Location[] }>;

export async function getWeather(params: {
  lat: number;
  lon: number;
  timezone: string;
}): Promise<{ current: CurrentConditions; hourly: HourlyConditions[] }>;
```

All functions use `fetch()` with the relative URL (Vite proxy handles forwarding to Express).

---

### Sub-task 4: Integration Wiring

#### Vite Proxy Config (`lab-ui/vite.config.ts`)

```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4321",
        changeOrigin: true,
      },
    },
  },
});
```

#### NPM Scripts

Add to root `package.json`:

```json
{
  "scripts": {
    "lab": "concurrently \"npm run lab:server\" \"npm run lab:ui\"",
    "lab:server": "tsx src/server/index.ts",
    "lab:ui": "cd lab-ui && npm run dev"
  }
}
```

**New devDependency:** `concurrently` (runs server + Vite in parallel from one command).

#### Server Entry Point (`src/server/index.ts`)

```typescript
import { createApp } from "./server.js";
import { Pipeline } from "../engine/pipeline.js";
import { OpenMeteoProvider } from "../weather/open-meteo.js";
import { loadConfigFromEnv, toPipelineConfig } from "../config/config.js";

const config = loadConfigFromEnv();
const pipeline = new Pipeline(toPipelineConfig(config), config.googleApiKey);
const weatherProvider = new OpenMeteoProvider();
const port = parseInt(process.env.HAYSTACK_LAB_PORT ?? "4321", 10);

const app = createApp({ pipeline, weatherProvider, outputDir: config.outputDir });

app.listen(port, () => {
  console.log(`Haystack Lab server running at http://localhost:${port}`);
});
```

---

## Acceptance Criteria

### Functional Requirements

- [x] Weather provider searches cities and returns locations with lat/lon/timezone (`src/weather/open-meteo.ts`)
- [x] Weather provider fetches hourly conditions including weatherCode, cloudPercent, precipProbability, isDay (`src/weather/open-meteo.ts`)
- [x] Weather provider fetches current conditions with sunrise/sunset (`src/weather/open-meteo.ts`)
- [ ] Express server accepts image upload + scenario overrides and returns generated image + metadata (`src/server/server.ts`)
- [ ] Express server serves generated images by ID (`src/server/server.ts`)
- [ ] Express server returns generation history sorted newest-first (`src/server/server.ts`)
- [ ] Express server proxies location search to Open-Meteo (`src/server/server.ts`)
- [ ] Express server returns weather data for a given location (`src/server/server.ts`)
- [ ] Lab UI allows image upload via drag & drop or file picker (`lab-ui/`)
- [ ] Lab UI allows city search and location selection (`lab-ui/`)
- [ ] Lab UI allows hour override via slider (0-23) (`lab-ui/`)
- [ ] Lab UI displays current weather conditions for selected location (`lab-ui/`)
- [ ] Lab UI provides editable prompt textarea with default template (`lab-ui/`)
- [ ] Lab UI generates and previews result with metadata (`lab-ui/`)
- [ ] Lab UI shows history panel with clickable thumbnails (`lab-ui/`)
- [ ] Weather data flows into Scenario → prompt → Gemini (end-to-end)
- [ ] If weather fetch fails during generation, falls back to time-only scenario
- [ ] Open-Meteo attribution displayed in Lab UI (CC BY 4.0)

### Non-Functional Requirements

- [ ] Weather API calls complete in under 2 seconds
- [ ] Server handles concurrent requests without crashing (at least 2 simultaneous)
- [ ] Image upload limited to 20MB (matches engine's `MAX_IMAGE_SIZE`)
- [ ] Server validates all inputs and returns structured error responses
- [ ] Temp files from image uploads are cleaned up after generation

### Quality Gates

- [x] Unit tests for weather provider with mocked HTTP responses
- [ ] API tests for Express server with mocked Pipeline and WeatherProvider (supertest)
- [ ] TypeScript compiles with strict mode (both root and lab-ui)
- [ ] `npm run lab` starts both server and frontend from a single command
- [x] All existing A1 tests continue to pass

---

## Edge Cases

1. **No location set** — Generate with time-only scenario (no weather). UI shows "No location selected" in weather display.
2. **Open-Meteo rate limiting** — No API key means no rate limit headers. If we get 429, retry once after 1 second, then fall back to time-only.
3. **Geocoding returns no results** — Frontend shows "No results found" in dropdown. No error.
4. **Image too large** — Client-side validation at 20MB. Server-side multer rejects with 413 status.
5. **Invalid image format** — Engine's `detectMimeType` falls back to PNG. GeminiClient validates further.
6. **Server restart during generation** — Client gets network error. Frontend shows error and enables retry.
7. **Concurrent generations** — Pipeline is stateless per-call. Multiple requests can run in parallel (Gemini API handles its own concurrency).
8. **Hour slider vs. weather time mismatch** — When user sets hour to 14 but weather was fetched for "now" (hour 10): weather data may not match the selected hour. The server uses the hourly forecast array and picks the slot matching the selected hour when available.
9. **Prompt template editing** — User clears the textarea entirely → sends empty string as `promptOverride` → server trims and treats empty/whitespace-only as `undefined`, falling back to `DEFAULT_TEMPLATE`. To use a truly custom prompt, user must type non-whitespace content.
10. **History pagination** — MVP returns all (up to `maxOutputs` = 24). No pagination needed for 24 items.

---

## Dependencies & New Packages

### Root `package.json` additions

```
dependencies:
  express: ^5.0.0
  multer: ^2.0.0

devDependencies:
  @types/express: ^5.0.0
  @types/multer: ^2.0.0
  supertest: ^7.0.0
  @types/supertest: ^6.0.0
  concurrently: ^9.0.0
```

### New `lab-ui/package.json`

```
dependencies:
  react: ^19.0.0
  react-dom: ^19.0.0

devDependencies:
  @types/react: ^19.0.0
  @types/react-dom: ^19.0.0
  @vitejs/plugin-react: ^4.0.0
  typescript: ^5.7.0
  vite: ^6.0.0
```

---

## Files Summary

### New files (server-side)

| File | Purpose |
|------|---------|
| `src/weather/types.ts` | WeatherProvider interface, Location, HourlyConditions, CurrentConditions types |
| `src/weather/open-meteo.ts` | Open-Meteo API implementation of WeatherProvider |
| `src/weather/index.ts` | Barrel exports |
| `src/server/server.ts` | Express app factory with all routes |
| `src/server/index.ts` | Server entry point (instantiates Pipeline + WeatherProvider, starts listening) |
| `tests/weather/open-meteo.test.ts` | Weather provider unit tests with mocked fetch |
| `tests/server/server.test.ts` | API integration tests with supertest |

### New files (frontend)

| File | Purpose |
|------|---------|
| `lab-ui/package.json` | Frontend dependencies |
| `lab-ui/tsconfig.json` | Frontend TypeScript config |
| `lab-ui/vite.config.ts` | Vite config with API proxy |
| `lab-ui/index.html` | HTML entry point |
| `lab-ui/src/main.tsx` | React entry point |
| `lab-ui/src/App.tsx` | Main app layout + state management |
| `lab-ui/src/App.css` | Styles |
| `lab-ui/src/types.ts` | Frontend type definitions |
| `lab-ui/src/api/client.ts` | Typed API client |
| `lab-ui/src/components/ImageUpload.tsx` | Image upload component |
| `lab-ui/src/components/LocationPicker.tsx` | City search + selection |
| `lab-ui/src/components/TimeControls.tsx` | Hour slider + isDay toggle |
| `lab-ui/src/components/WeatherDisplay.tsx` | Weather conditions display |
| `lab-ui/src/components/PromptEditor.tsx` | Prompt template editor |
| `lab-ui/src/components/GenerateButton.tsx` | Generate button with loading state |
| `lab-ui/src/components/PreviewPanel.tsx` | Result image + metadata display |
| `lab-ui/src/components/HistoryPanel.tsx` | Thumbnail history grid |
| `lab-ui/src/hooks/useGenerate.ts` | Generate API hook |
| `lab-ui/src/hooks/useHistory.ts` | History API hook |
| `lab-ui/src/hooks/useWeather.ts` | Weather/location API hooks |

### Modified files

| File | Change |
|------|--------|
| `package.json` | Add `express`, `multer`, `concurrently`, types, supertest; add `lab`, `lab:server`, `lab:ui` scripts |
| `src/index.ts` | Add `export * from "./weather/index.js"` |
| `.env.example` | Add `HAYSTACK_LAB_PORT` |
| `CLAUDE.md` | Update roadmap status; add Lab UI section |

### Unchanged files

All existing `src/engine/`, `src/storage/`, `src/config/`, `src/cli/` files remain untouched. The weather provider populates the same `Scenario` fields that the engine already supports.

---

## Config Changes

### New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HAYSTACK_LAB_PORT` | `4321` | Express server port for Lab UI |

### Existing Variables (unchanged)

All existing env vars (`GOOGLE_API_KEY`, `HAYSTACK_OUTPUT_DIR`, `HAYSTACK_MODEL`, etc.) continue to work as before.

---

## Open-Meteo Attribution

Per CC BY 4.0 license requirements, any user-facing display of weather data must include attribution with a link to the license. The Lab UI includes a footer visible whenever Open-Meteo data is displayed (weather conditions or geocoding results):

> Weather data by [Open-Meteo](https://open-meteo.com/) · [CC BY 4.0](https://open-meteo.com/en/licence)

This covers both the weather display and the geocoding-powered location picker. Phase B (menu bar app) will need the same attribution in its settings/about screen.

---

## Implementation Order

The sub-tasks have dependencies and should be built in this order:

```
1. Weather Provider Module (no dependencies on other A2 work)
   ↓
2. Express API Server (depends on weather provider + existing engine)
   ↓
3. React Frontend (depends on server API being defined)
   ↓
4. Integration Wiring (depends on all three above)
```

Each sub-task is independently testable. The weather provider can be tested with mocked HTTP. The server can be tested with mocked Pipeline + WeatherProvider. The frontend can be tested manually against the running server.

---

## References

### Internal

- [types.ts](src/engine/types.ts) — `Scenario`, `SerializedScenario`, `RenderMetadata`, `PipelineConfig`
- [scenario.ts](src/engine/scenario.ts) — `createScenarioFromHour()`, `describeScenario()`, WMO `WEATHER_MAP`
- [pipeline.ts](src/engine/pipeline.ts) — `Pipeline.generate()`, `Pipeline.getStore()`
- [output-store.ts](src/storage/output-store.ts) — `OutputStore.listAll()`, `OutputStore.getLatest()`
- [config.ts](src/config/config.ts) — `loadConfigFromEnv()`, `toPipelineConfig()`
- [gemini-client.ts](src/engine/gemini-client.ts) — `ImageEditClient` interface, `MAX_IMAGE_SIZE` (20MB)
- [prompt.ts](src/engine/prompt.ts) — `DEFAULT_TEMPLATE`, `composePrompt()`
- [Milestone brainstorm](docs/brainstorms/2026-02-14-milestone-reorganization-brainstorm.md) — A2 scope decisions
- [A1 plan](docs/plans/2026-02-10-feat-gemini-image-editing-pipeline-plan.md) — Engine architecture, A3 note
- [PRD](docs/idea-draft.md) — Phase A2 requirements (lines 169-240)

### External

- [Open-Meteo Forecast API](https://open-meteo.com/en/docs) — Hourly weather variables, WMO codes, timezone support
- [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) — City search endpoint
- [Open-Meteo License](https://open-meteo.com/en/licence) — CC BY 4.0 attribution requirements
- [Express 5 docs](https://expressjs.com/) — Async handler support
- [Multer docs](https://github.com/expressjs/multer) — Multipart file upload middleware
