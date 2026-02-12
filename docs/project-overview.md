# Living Art Wallpaper - Project Overview

A beginner-friendly guide to understanding the system architecture and key concepts.

---

## What This Project Does (The Big Picture)

**Living Art Wallpaper** is a macOS app that makes your desktop wallpaper "come alive." Here's the core idea:

1. You provide a base artwork image
2. Every hour, AI (Gemini) edits that image based on the current time and weather at your location
3. The edited image becomes your new wallpaper

So if you have a painting of a street scene, at night it might show streetlamps glowing, and during rain it might show wet reflections on the ground.

---

## System Architecture (How Things Connect)

Think of the system as having **4 main parts**:

```
┌─────────────────────────────────────────────────────────┐
│                      USER INTERFACE                      │
│   (Lab UI in browser → later Menu Bar App)              │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                        ENGINE                            │
│  The "brain" that coordinates everything:               │
│  • Takes your base image                                │
│  • Gets weather/time data                               │
│  • Sends prompt + image to Gemini AI                    │
│  • Saves the result                                     │
└─────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ Weather API  │ │  Gemini AI   │ │   Wallpaper  │
    │ (Open-Meteo) │ │  (editing)   │ │   Setter     │
    └──────────────┘ └──────────────┘ └──────────────┘
```

### The 4 Components Explained

| Component | What It Does | Analogy |
|-----------|--------------|---------|
| **Engine** | Core logic that orchestrates everything | The "chef" who follows the recipe |
| **Scheduler** | Triggers the engine every hour | An alarm clock |
| **UI** | How you configure and test | The control panel |
| **External APIs** | Weather data + AI image editing | Ingredients from suppliers |

---

## The 3 Development Phases

The project is built incrementally:

**Phase A (Developer MVP)**
- Command-line tools + a simple web page to test
- Uses `launchd` (macOS's built-in scheduler) to run hourly
- For developers and early testers

**Phase B (User-Friendly App)**
- A proper macOS menu bar app (like Dropbox or 1Password icons)
- Settings UI, folder management, no command line needed

**Phase C (TV Display)**
- An always-on display using a Raspberry Pi
- For people who want "digital art frames"

---

## Key Decisions to Understand

### 1. Always Edit from Original Base Image

This is critical. Each hour, the system edits the *original* image, NOT the previous output. Why?

```
✅ Correct: Original → Hour 1 output
           Original → Hour 2 output
           Original → Hour 3 output

❌ Wrong:   Original → Hour 1 → Hour 2 → Hour 3
           (This causes "drift" - errors compound)
```

### 2. Top-of-Hour Schedule

Updates happen at 1:00, 2:00, 3:00... not "60 minutes since you started." This keeps the "time of day" consistent with reality.

### 3. Weather API Choice: Open-Meteo

Chosen because:
- No API key required (simpler setup)
- Includes "is it day or night" data
- Handles timezones properly

### 4. Smart Extend Background

Your image might not match your screen's aspect ratio. The system:
1. Creates a canvas matching your screen size
2. Centers your artwork
3. Uses AI to "extend" the background (outpainting)

Fallback: If AI outpainting looks weird, just blur-extend the edges.

---

## Things to Pay Attention To

### Error Handling

- If image generation fails → keep current wallpaper (don't show broken image)
- If weather API fails → fall back to "time-only" mode (no weather context)
- Retry once after 2 minutes on failure

### Data Flow for Each Generation

```
1. Scheduler triggers → "It's time to update!"
2. Engine fetches scenario:
   - Current local time (e.g., 8 PM)
   - Weather conditions (e.g., cloudy, 70% clouds)
   - Is it day or night? (night)
3. Engine builds a prompt:
   "Modify this street scene for evening, cloudy weather..."
4. Gemini AI receives: image + prompt → returns edited image
5. Image saved locally
6. Wallpaper setter applies it to your desktop
```

### Key Data Models

| Model | Purpose |
|-------|---------|
| `Artwork` | Your source image (local file path) |
| `Location` | Where you are (lat/lon/timezone) |
| `Scenario` | Current conditions (time, weather, day/night) |
| `PromptVersion` | The text instructions sent to AI (versioned for testing) |
| `Render` | Each generated output with metadata |

---

## Risks the Document Highlights

1. **Generative Drift** - Solved by always using original base image
2. **Rate Limits** - Gemini might throttle you; solution is to generate slightly early
3. **Weather API Down** - Abstraction layer lets you swap providers
4. **macOS Quirks** - Only target primary display to avoid bugs

---

---

# Phase A: Engine + Lab UI + launchd Runner

Phase A is the **developer MVP** - a working system you can use, but it requires some technical comfort. No fancy app yet, just the core machinery.

---

## What Phase A Delivers

Three main pieces:

```
┌─────────────────────────────────────────────────────────┐
│                     PHASE A SYSTEM                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   ┌──────────────┐    ┌──────────────┐                  │
│   │   Lab UI     │───▶│    ENGINE    │                  │
│   │  (browser)   │    │   (library)  │                  │
│   └──────────────┘    └──────┬───────┘                  │
│                              │                           │
│   ┌──────────────┐           │                          │
│   │   launchd    │───────────┘                          │
│   │  (scheduler) │    (both trigger the engine)         │
│   └──────────────┘                                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

| Deliverable | What It Is | When You Use It |
|-------------|------------|-----------------|
| **Engine** | Shared code library that does the actual work | Always running behind the scenes |
| **Lab UI** | Web page at `localhost:xxxx` for testing | When tweaking prompts, testing scenarios |
| **launchd Runner** | Background job that runs hourly | Automatic updates while you work/sleep |

---

## 1. The Engine (The Core Brain)

The Engine is a **reusable module** (code library) that other parts call. It does NOT run on its own.

### Inputs It Accepts

```javascript
Engine.generate({
  baseImage: "/path/to/artwork.jpg",
  scenario: {
    hour: 20,              // 8 PM
    weatherCode: "cloudy",
    cloudPct: 70,
    isDay: false
  },
  promptConfig: "Make the scene feel like evening...",
  modelConfig: "gemini-2.0-flash-exp"  // or other model
})
```

### What It Does (Step by Step)

```
Step 1: Fetch Scenario
        ├── Real mode: Call weather API for actual conditions
        └── Override mode: Use manually specified time/weather

Step 2: Build the Prompt
        └── Combine your base prompt + scenario details
            "Modify this image for 8 PM, cloudy, nighttime..."

Step 3: Call Gemini API
        └── Send: base image + prompt
        └── Receive: edited image

Step 4: Save Artifacts
        ├── output-2024-01-15-20-00.jpg  (the image)
        └── output-2024-01-15-20-00.json (metadata)
```

### Output Metadata JSON

Every generation saves a JSON file alongside the image:

```json
{
  "artworkId": "street-scene-001",
  "scenario": {
    "timestampLocal": "2024-01-15T20:00:00",
    "hour": 20,
    "weatherCode": "cloudy",
    "cloudPct": 70,
    "isDay": false
  },
  "promptVersionId": "v3",
  "model": "gemini-2.0-flash-exp",
  "outputPath": "/outputs/output-2024-01-15-20-00.jpg",
  "createdAt": "2024-01-15T20:00:12Z",
  "status": "success"
}
```

This metadata is crucial for **debugging** and **reproducing** outputs later.

---

## 2. Lab UI (Your Testing Workbench)

A simple web app running locally in your browser. This is where you **iterate fast**.

### The Controls

| Control | What It Does |
|---------|--------------|
| **Upload Image** | Set your base artwork |
| **Location Search** | Type "San Francisco" → gets lat/lon/timezone |
| **Time Override** | Force "8 PM" instead of real time |
| **Weather Override** | Force "rainy" instead of real weather |
| **Prompt Editor** | Edit the system prompt sent to Gemini |
| **Generate Button** | Run the engine NOW, see result |
| **Apply Button** | Set the generated image as wallpaper |
| **History List** | Thumbnails of last N generations |

### Why Lab UI Matters

Without Lab UI, testing would be painful:

```
❌ Without Lab UI:
   - Change prompt in code
   - Wait for next hour
   - See result
   - Repeat (takes hours to iterate)

✅ With Lab UI:
   - Change prompt in text box
   - Click "Generate"
   - See result in 10 seconds
   - Repeat (iterate in minutes)
```

---

## 3. launchd Runner (Automatic Hourly Updates)

`launchd` is macOS's built-in task scheduler (like cron, but Apple's preferred way).

### How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    macOS System                          │
│                                                          │
│   launchd (always running)                              │
│      │                                                   │
│      ├── "It's 3:00 PM, run the job"                   │
│      │         │                                        │
│      │         ▼                                        │
│      │   ┌─────────────────┐                           │
│      │   │ generate.sh     │  ← Your script            │
│      │   │ (calls engine)  │                           │
│      │   └────────┬────────┘                           │
│      │            │                                     │
│      │            ▼                                     │
│      │   Engine runs → Image generated → Wallpaper set │
│      │                                                  │
│      ├── "It's 4:00 PM, run the job"                   │
│      │         │                                        │
│      │        ...                                       │
└─────────────────────────────────────────────────────────┘
```

### The launchd Plist File

You create a `.plist` file that tells macOS what to run and when:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.livingart.hourly</string>

    <key>ProgramArguments</key>
    <array>
        <string>/path/to/generate.sh</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Minute</key>
        <integer>0</integer>  <!-- Run at minute 0 of every hour -->
    </dict>

    <key>StandardOutPath</key>
    <string>/path/to/logs/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>/path/to/logs/stderr.log</string>
</dict>
</plist>
```

### Key launchd Commands

```bash
# Load the job (start scheduling)
launchctl load ~/Library/LaunchAgents/com.livingart.hourly.plist

# Unload the job (stop scheduling)
launchctl unload ~/Library/LaunchAgents/com.livingart.hourly.plist

# Run immediately (for testing)
launchctl start com.livingart.hourly

# Check if it's loaded
launchctl list | grep livingart
```

---

## 4. Wallpaper Setting (Phase A Approach)

Phase A uses `desktoppr`, a simple command-line tool.

### Why desktoppr?

| Option | Pros | Cons |
|--------|------|------|
| **desktoppr** | Simple, proven, one command | External dependency |
| **Swift CLI** | No dependency | More code to write/maintain |
| **AppleScript** | Built-in | Finicky, permission issues |

### Usage

```bash
# Install
brew install desktoppr

# Set wallpaper (primary display only)
desktoppr /path/to/generated-image.jpg
```

---

## 5. Weather/Time Providers

### The Provider Interface

A clean abstraction so you can swap weather APIs easily:

```
┌─────────────────────────────────────────────────────────┐
│              WeatherProvider Interface                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  resolveLocation(query)                                 │
│    Input:  "San Francisco"                              │
│    Output: { lat: 37.77, lon: -122.41,                 │
│              timezone: "America/Los_Angeles",           │
│              displayName: "San Francisco, CA" }         │
│                                                          │
│  getHourlyConditions(lat, lon, timezone, timeRange)     │
│    Input:  coordinates + time range                     │
│    Output: [                                            │
│      { hour: 14, weatherCode: "sunny", cloudPct: 10 }, │
│      { hour: 15, weatherCode: "cloudy", cloudPct: 45 },│
│      ...                                                │
│    ]                                                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Open-Meteo (Recommended for Phase A)

```
Pros:
  ✓ No API key needed (just call it)
  ✓ Includes "is_day" field (day/night)
  ✓ Handles timezones properly
  ✓ Hourly forecast data

Example API call:
  https://api.open-meteo.com/v1/forecast
    ?latitude=37.77
    &longitude=-122.41
    &hourly=temperature,cloudcover,precipitation
    &timezone=America/Los_Angeles
```

---

## 6. Error Handling (Phase A)

### Generation Fails

```
┌─────────────────────────────────────────────────────────┐
│  Gemini API returns error                               │
│                     │                                    │
│                     ▼                                    │
│  ┌─────────────────────────────────┐                   │
│  │ Keep current wallpaper unchanged │                   │
│  │ Log the error                    │                   │
│  │ Wait 2 minutes                   │                   │
│  │ Retry once                       │                   │
│  └─────────────────────────────────┘                   │
│                     │                                    │
│         ┌───────────┴───────────┐                       │
│         ▼                       ▼                       │
│   Retry succeeds          Retry fails                   │
│   (apply new image)       (log, give up until next hr) │
└─────────────────────────────────────────────────────────┘
```

### Weather Fetch Fails

```
Normal scenario:
  { hour: 20, weatherCode: "rainy", cloudPct: 90, isDay: false }

Degraded scenario (weather unavailable):
  { hour: 20, weatherCode: null, cloudPct: null, isDay: false, degraded: true }

The prompt adjusts: "Modify for 8 PM, nighttime" (no weather mention)
```

---

## 7. Privacy & Security (Phase A)

| Item | Phase A Approach | Notes |
|------|------------------|-------|
| **Gemini API Key** | Environment variable | `export GEMINI_API_KEY=xxx` |
| **Images** | Local only | Stored in designated folder |
| **Purge Policy** | Keep last 24 outputs | Delete older automatically |

---

## Phase A Milestones (Build Order)

| Milestone | What You Build | Dependencies |
|-----------|----------------|--------------|
| **A0** | Repo + engine skeleton + output storage | None |
| **A1** | Gemini edit pipeline (image in → image out) | A0 |
| **A2** | Wallpaper apply via desktoppr | A1 |
| **A3** | Lab UI with overrides + prompt editor | A1 |
| **A4** | launchd hourly runner + logging | A2 |
| **A5** | Location + weather integration | A3, A4 |

---

## Key Takeaways for Phase A

1. **Engine is the core** - Everything else just calls it
2. **Lab UI is for iteration** - Don't wait an hour to test prompts
3. **launchd runs unattended** - Works even when you're not at your computer
4. **Always from original base** - Never chain edits together
5. **Weather is optional** - System degrades gracefully without it
6. **Logs everything** - Metadata JSON helps you debug and improve
