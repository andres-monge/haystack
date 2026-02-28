---
title: "launchd Server Daemon + Hourly Scheduler (Phase A4)"
type: feat
date: 2026-02-28
brainstorm: docs/brainstorms/2026-02-15-tv-kiosk-phase-c-brainstorm.md
---

# launchd Server Daemon + Hourly Scheduler (Phase A4)

## Overview

Make the Haystack Express server persistent via macOS `launchd` so it auto-starts on login and restarts on crash. This is the missing piece for the Phase C kiosk — the Pi needs the server running 24/7 without manual intervention.

Adds a `POST /api/scheduler/trigger` endpoint for external callers, a server wrapper script for launchd's minimal environment, two `.plist` files (server daemon + optional hourly backup), and install/uninstall scripts.

## Problem Statement / Motivation

The Express server currently requires manual startup (`npm run lab`). If the Mac reboots, the terminal closes, or the process crashes:

1. The Pi kiosk shows a stale image indefinitely (server is unreachable)
2. The in-process hourly scheduler stops generating
3. The user must physically restart the server

For a "living art display" that's always on, the server must self-heal and persist across reboots.

## Proposed Solution

Two launchd user agents:

1. **Server daemon** (`com.haystack.server`) — keeps the Express server running via `RunAtLoad` + `KeepAlive`. This is the primary deliverable.
2. **Hourly trigger** (`com.haystack.hourly`, optional) — curls `POST /api/scheduler/trigger` at HH:05 each hour. Belt-and-suspenders backup for the in-process scheduler.

The in-process `HourlyScheduler` (built in Phase C) remains the primary hourly generation mechanism. The launchd hourly trigger catches edge cases where the in-process timer missed a tick after a long sleep.

## Technical Approach

### Architecture

```
launchd (macOS, runs on login)
  │
  ├── com.haystack.server.plist (KeepAlive)
  │   └── scripts/start-server.sh
  │       └── npx tsx src/server/start.ts
  │           ├── Express server (port 4321)
  │           └── HourlyScheduler (in-process, fires at HH:00)
  │               └── pipeline.generate() → OutputStore
  │
  └── com.haystack.hourly.plist (optional, fires at HH:05)
      └── curl -s --max-time 120 --retry 3 --retry-connrefused -X POST .../api/scheduler/trigger
          └── pause check → active hours → dedup → scheduler.runNow() → OutputStore

Raspberry Pi (Phase C, unchanged)
  └── Chromium kiosk → http://192.168.0.20:4321/kiosk
      └── polls GET /api/latest every 60s → crossfade on new image
```

### Compatibility with Phase C Kiosk

The kiosk is **completely unaffected** — it continues polling `/api/latest`. The only change is that the server now auto-starts and self-heals, making the kiosk more reliable. No changes needed to the kiosk page, polling mechanism, or any existing endpoints.

### Implementation Phases

#### Phase 1: New Trigger Endpoint

Add `POST /api/scheduler/trigger` — triggers a generation using real weather/time (not a custom override). Respects active hours and includes deduplication to prevent waste when both in-process scheduler and launchd fire in the same hour.

**Files to modify:**

- `src/server/scheduler.ts` — add `isInActiveHours()` method
- `src/server/server.ts` — add route

**Scheduler addition (`src/server/scheduler.ts`):**

```typescript
/** Check whether the current hour falls within the configured active window. */
isInActiveHours(): boolean {
  const { activeStart, activeEnd, location } = this.config;
  if (activeStart == null || activeEnd == null) return true; // no window = always active
  const hour = getCurrentHourInTimezone(location.timezone);
  return hour >= activeStart && hour < activeEnd;
}
```

**Route (`src/server/server.ts`):**

```typescript
app.post("/api/scheduler/trigger", async (req: Request, res: Response) => {
  if (!scheduler) {
    res.status(503).json({ error: "Scheduler not configured" });
    return;
  }

  // Respect Lab UI pause — if the user paused the scheduler, don't trigger
  if (!scheduler.isRunning()) {
    res.json({ triggered: false, reason: "Scheduler paused" });
    return;
  }

  // Respect active hours
  if (!scheduler.isInActiveHours()) {
    res.json({ triggered: false, reason: "Outside active hours" });
    return;
  }

  // Dedup: skip if a render happened within the last 30 minutes
  const latest = pipeline.getStore().getLatest();
  if (latest) {
    const ageMs = Date.now() - new Date(latest.createdAt).getTime();
    if (ageMs < 30 * 60 * 1000) {
      res.json({ triggered: false, reason: "Recent generation exists", latestId: latest.id });
      return;
    }
  }

  try {
    const result = await scheduler.runNow();
    res.json({
      triggered: true,
      metadata: result.metadata,
      imageUrl: `/api/outputs/${result.metadata.id}`,
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Trigger error:`, err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Trigger generation failed" });
  }
});
```

**Pause/resume contract:** The trigger endpoint checks `scheduler.isRunning()` first. When the user pauses the scheduler from the Lab UI (`POST /api/scheduler/pause`), it sets `running = false`. The launchd hourly curl still fires, but the trigger endpoint sees `isRunning() === false` and returns `{ triggered: false, reason: "Scheduler paused" }` — zero API calls. When the user resumes (`POST /api/scheduler/resume`), the next launchd curl (or the in-process timer) picks up normally. No manual plist management needed.

Note: `POST /api/override` (custom scenario from Lab UI) does NOT check `isRunning()` — user-initiated overrides always work, even when paused. Only the automated trigger respects pause state.

**Dedup logic:** Compare `Date.now()` against `latest.createdAt` (ISO 8601 string). If the most recent render is less than 30 minutes old, skip. This means:

- In-process scheduler fires at HH:00 → generates
- launchd curl fires at HH:05 → sees render from 5 min ago → skips (200, `triggered: false`)
- If Mac was asleep and in-process missed → launchd fires after wake → no recent render → generates

**Acceptance criteria:**

- [ ] `POST /api/scheduler/trigger` triggers generation with real weather/time — `server.ts`
- [ ] Endpoint skips when scheduler is paused (`isRunning() === false`) — `server.ts`
- [ ] Endpoint respects active hours (returns `{ triggered: false }` when outside window) — `server.ts`
- [ ] Endpoint deduplicates: skips if last render < 30 min old — `server.ts`
- [ ] Returns 503 when scheduler is not configured — `server.ts`
- [ ] Returns 500 with error message on generation failure — `server.ts`
- [ ] `scheduler.isInActiveHours()` returns correct result for boundary hours — `scheduler.ts`

#### Phase 2: Server Wrapper Script

Create a shell script that launchd can execute. launchd runs in a minimal environment (PATH is typically just `/usr/bin:/bin`) — the wrapper resolves Node.js from common installation locations.

**File to create:** `scripts/start-server.sh`

```bash
#!/bin/bash
# Wrapper for launchd to start the Haystack Express server.
# launchd runs in a minimal environment — this script ensures
# Node.js is on PATH and the working directory is correct.

set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

# Resolve Node.js: try nvm, volta, homebrew, system
for dir in "$HOME/.nvm/versions/node"/*/bin "$HOME/.volta/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
  if [ -d "$dir" ] && [ -x "$dir/node" ]; then
    export PATH="$dir:$PATH"
    break
  fi
done

if ! command -v node &>/dev/null; then
  echo "ERROR: node not found in PATH. Install Node.js or update this script." >&2
  exit 1
fi

# Ensure output + log directories exist
mkdir -p "$HOME/.haystack"

echo "[$(date -u +%FT%TZ)] Starting Haystack server (node $(node -v))"
exec npx tsx src/server/start.ts
```

Key design choices:

- `exec` replaces the shell process with the Node process, so launchd tracks the correct PID
- `set -euo pipefail` fails fast on errors
- nvm directory glob (`*/bin`) picks whatever version is installed
- `dotenv.config({ path: ".env.local" })` in `start.ts` handles environment variables — no need to source `.env.local` in the shell

**Acceptance criteria:**

- [ ] Script resolves Node.js from nvm, volta, homebrew, or /usr/local — `start-server.sh`
- [ ] Script fails with a clear error if node is not found — `start-server.sh`
- [ ] Script uses `exec` so the Node process inherits the launchd PID — `start-server.sh`
- [ ] Script creates `~/.haystack/` if missing — `start-server.sh`
- [ ] Script is executable (`chmod +x`) — `start-server.sh`

#### Phase 3: launchd Plist Files

Two plist files in a `launchd/` directory at the project root. They use `__PROJECT_DIR__` and `__HOME__` placeholders that the install script replaces with actual paths.

**File to create:** `launchd/com.haystack.server.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.haystack.server</string>

    <key>Program</key>
    <string>__PROJECT_DIR__/scripts/start-server.sh</string>

    <key>WorkingDirectory</key>
    <string>__PROJECT_DIR__</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>__HOME__/.haystack/launchd-server.log</string>

    <key>StandardErrorPath</key>
    <string>__HOME__/.haystack/launchd-server.log</string>
</dict>
</plist>
```

- `RunAtLoad` starts the server immediately when the plist is loaded (including on login)
- `KeepAlive` restarts the process if it exits for any reason (crash recovery)
- `ThrottleInterval: 10` prevents rapid restart loops (minimum 10s between restarts)
- Logs go to `~/.haystack/launchd-server.log`

**File to create:** `launchd/com.haystack.hourly.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.haystack.hourly</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/curl</string>
        <string>-s</string>
        <string>--max-time</string>
        <string>120</string>
        <string>--retry</string>
        <string>3</string>
        <string>--retry-delay</string>
        <string>10</string>
        <string>--retry-connrefused</string>
        <string>-X</string>
        <string>POST</string>
        <string>http://127.0.0.1:4321/api/scheduler/trigger</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Minute</key>
        <integer>5</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>__HOME__/.haystack/launchd-hourly.log</string>

    <key>StandardErrorPath</key>
    <string>__HOME__/.haystack/launchd-hourly.log</string>
</dict>
</plist>
```

- `StartCalendarInterval` with `Minute: 5` fires at HH:05 every hour (5 minutes after the in-process scheduler's HH:00 tick)
- `--max-time 120` gives curl 2 minutes before timing out (Gemini generation can take 30-60s)
- `--retry 3 --retry-delay 10 --retry-connrefused` retries up to 3 times with 10s between attempts if the server isn't ready yet (e.g., launchd just restarted it after a crash)
- `-s` suppresses progress output (keeps logs clean)
- Fires at HH:05 even after Mac wake (launchd catches up missed intervals)

**Why HH:05 offset:** The in-process scheduler fires at HH:00. By firing at HH:05, the launchd trigger gives the in-process scheduler time to generate first. The dedup check on the endpoint then skips if a recent render exists. This means zero wasted API calls under normal operation — the hourly plist only actually generates when the in-process scheduler missed.

**Acceptance criteria:**

- [ ] Server plist auto-starts the server on login — `com.haystack.server.plist`
- [ ] Server plist restarts the process on crash — `com.haystack.server.plist`
- [ ] Hourly plist fires curl at HH:05 — `com.haystack.hourly.plist`
- [ ] Curl includes 120s timeout — `com.haystack.hourly.plist`
- [ ] Both plists log to `~/.haystack/` — plists

#### Phase 4: Install/Uninstall Scripts

**File to create:** `scripts/launchd-install.sh`

```bash
#!/bin/bash
# Install Haystack launchd agents.
# Copies plist templates to ~/Library/LaunchAgents/ with paths resolved,
# then loads them via launchctl.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_DIR="$HOME/Library/LaunchAgents"

echo "Installing Haystack launchd agents..."
echo "  Project: $PROJECT_DIR"

# Ensure directories exist
mkdir -p "$HOME/.haystack"
mkdir -p "$PLIST_DIR"

# Check prerequisites
if [ ! -f "$PROJECT_DIR/scripts/start-server.sh" ]; then
  echo "ERROR: scripts/start-server.sh not found" >&2
  exit 1
fi
chmod +x "$PROJECT_DIR/scripts/start-server.sh"

# Unload existing agents (ignore errors if not loaded)
for label in com.haystack.server com.haystack.hourly; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
done

# Process and install plist templates
for plist in com.haystack.server.plist com.haystack.hourly.plist; do
  sed -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
      -e "s|__HOME__|$HOME|g" \
      "$PROJECT_DIR/launchd/$plist" \
      > "$PLIST_DIR/$plist"
  launchctl bootstrap "gui/$(id -u)" "$PLIST_DIR/$plist"
  echo "  Loaded: $plist"
done

echo ""
echo "Done! Haystack agents installed."
echo "  Server daemon: com.haystack.server (auto-starts, KeepAlive)"
echo "  Hourly trigger: com.haystack.hourly (fires at HH:05)"
echo ""
echo "Useful commands:"
echo "  launchctl list | grep haystack       # check status"
echo "  tail -f ~/.haystack/launchd-server.log  # server logs"
echo "  tail -f ~/.haystack/launchd-hourly.log  # hourly trigger logs"
```

**File to create:** `scripts/launchd-uninstall.sh`

```bash
#!/bin/bash
# Uninstall Haystack launchd agents.

set -euo pipefail

PLIST_DIR="$HOME/Library/LaunchAgents"

echo "Uninstalling Haystack launchd agents..."

for label in com.haystack.server com.haystack.hourly; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$PLIST_DIR/$label.plist"
  echo "  Removed: $label"
done

echo ""
echo "Done! Agents uninstalled."
echo "Logs and outputs in ~/.haystack/ are preserved (delete manually if desired)."
```

Note: Uses `launchctl bootstrap`/`bootout` (modern API) instead of the deprecated `load`/`unload`.

**Acceptance criteria:**

- [ ] Install script resolves project directory and fills plist placeholders — `launchd-install.sh`
- [ ] Install script makes `start-server.sh` executable — `launchd-install.sh`
- [ ] Install script unloads existing agents before re-installing (idempotent) — `launchd-install.sh`
- [ ] Uninstall script removes agents and plist files — `launchd-uninstall.sh`
- [ ] Uninstall script preserves `~/.haystack/` data — `launchd-uninstall.sh`

#### Phase 5: Tests

**Files to create/modify:**

- `tests/server/server.test.ts` — add tests for `POST /api/scheduler/trigger`
- `tests/server/scheduler.test.ts` — add test for `isInActiveHours()`

**Test cases for `POST /api/scheduler/trigger`:**

| Test | Setup | Expected |
|------|-------|----------|
| Happy path: triggers generation | Scheduler configured, running, no recent render | 200, `triggered: true`, metadata returned |
| Scheduler paused | `isRunning() === false` | 200, `triggered: false`, reason: "Scheduler paused" |
| Dedup: skips recent render | Latest render 5 min ago | 200, `triggered: false`, reason: "Recent generation exists" |
| Dedup boundary: 30 min | Latest render exactly 30 min ago | 200, `triggered: true` (>= 30 min passes) |
| Active hours: outside window | Hour 22, active 9–21 | 200, `triggered: false`, reason: "Outside active hours" |
| Active hours: inside window | Hour 14, active 9–21 | 200, `triggered: true` |
| Active hours: no window | activeStart/End not configured | 200, `triggered: true` |
| No scheduler | scheduler undefined | 503, error message |
| Generation error | pipeline.generate throws | 500, error message |

**Test cases for `isInActiveHours()`:**

| Test | activeStart | activeEnd | Hour | Expected |
|------|------------|-----------|------|----------|
| Inside window | 9 | 21 | 14 | true |
| At start boundary (inclusive) | 9 | 21 | 9 | true |
| At end boundary (exclusive) | 9 | 21 | 21 | false |
| Before window | 9 | 21 | 6 | false |
| No window configured | undefined | undefined | any | true |

**Acceptance criteria:**

- [ ] Trigger endpoint tests cover happy path, dedup, active hours, and error cases — `server.test.ts`
- [ ] `isInActiveHours()` tests cover boundaries — `scheduler.test.ts`
- [ ] All existing tests continue to pass

#### Phase 6: Log Rotation

The server runs 24/7 via launchd, so `launchd-server.log` will grow indefinitely. Use macOS `newsyslog` to rotate it weekly.

**File to create:** `launchd/haystack.newsyslog.conf`

```
# logfile                                    mode count size  when  flags
/Users/__USER__/.haystack/launchd-server.log 644  4     1024  $W0   J
/Users/__USER__/.haystack/launchd-hourly.log 644  4     1024  $W0   J
```

- `4` archived copies, `1024` KB max size, `$W0` rotates weekly on Sunday
- `J` compresses archived logs with bzip2
- Install script copies this to `/etc/newsyslog.d/haystack.conf` (requires sudo)

**Install script addition:**

```bash
# Log rotation (optional, requires sudo)
if [ -w /etc/newsyslog.d ] || sudo -n true 2>/dev/null; then
  sed "s|__USER__|$(whoami)|g" "$PROJECT_DIR/launchd/haystack.newsyslog.conf" \
    | sudo tee /etc/newsyslog.d/haystack.conf >/dev/null
  echo "  Installed: log rotation (weekly, 4 archives)"
else
  echo "  Skipped: log rotation (run with sudo to enable)"
fi
```

**Acceptance criteria:**

- [ ] newsyslog config rotates server and hourly logs weekly — `haystack.newsyslog.conf`
- [ ] Install script installs log rotation when sudo is available — `launchd-install.sh`
- [ ] Uninstall script removes newsyslog config — `launchd-uninstall.sh`

#### Phase 7: Documentation

**File to modify:** `CLAUDE.md` — add launchd setup section

Add to the existing CLAUDE.md:

```markdown
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
- `com.haystack.hourly` — curls `POST /api/scheduler/trigger` at HH:05 (backup)

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
```

**Acceptance criteria:**

- [ ] CLAUDE.md has launchd install/uninstall instructions
- [ ] Troubleshooting section covers common issues

## Acceptance Criteria

### Functional Requirements

- [ ] Server auto-starts on Mac login when launchd agents are installed
- [ ] Server restarts automatically after a crash (within 10 seconds)
- [ ] `POST /api/scheduler/trigger` triggers generation using real weather/time
- [ ] Trigger endpoint respects scheduler pause (Lab UI pause = zero API calls)
- [ ] Trigger endpoint respects active hours (`HAYSTACK_ACTIVE_START`/`END`)
- [ ] Trigger endpoint deduplicates (skips if render < 30 min old)
- [ ] Hourly launchd job fires at HH:05 and curls the trigger endpoint
- [ ] Kiosk (Phase C) continues working unchanged — polls `/api/latest`, displays images
- [ ] Install/uninstall scripts work idempotently

### Non-Functional Requirements

- [ ] Zero wasted API calls under normal operation (dedup prevents double-generation)
- [ ] Server logs to `~/.haystack/launchd-server.log`
- [ ] No new npm dependencies required
- [ ] All existing tests continue to pass

### Quality Gates

- [ ] Unit tests for trigger endpoint (happy path, dedup, active hours, errors)
- [ ] Unit tests for `isInActiveHours()` (boundary cases)
- [ ] `npm run build` passes
- [ ] `npm run test:run` passes

## Dependencies & Prerequisites

- **Existing:** Phase C complete (Express server, in-process scheduler, kiosk page, all endpoints)
- **macOS:** launchd available (all macOS versions)
- **Node.js:** Must be installed via nvm, volta, homebrew, or system package
- **No new npm dependencies**

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Node.js not found by wrapper script | Medium | High | Script checks common locations (nvm, volta, brew, system); fails with clear error |
| Port 4321 already in use (user starts server manually while launchd runs) | Medium | Low | Second process fails with EADDRINUSE; document that `launchctl` manages the server |
| Rapid restart loop (bad config, missing API key) | Medium | Medium | `ThrottleInterval: 10` limits restarts; user checks logs |
| Double generation (in-process + launchd in same hour) | Low | Low | 30-min dedup window on trigger endpoint; HH:05 offset |
| .env.local not found or missing API key | Medium | Medium | Server starts but generation fails; logged clearly |
| Mac firewall blocks Pi access | Low | Medium | Document: allow port 4321 in System Preferences > Firewall |

## Edge Cases (from SpecFlow analysis)

1. **Mac sleeps for 3+ hours, wakes at 17:00:** In-process scheduler recalculates next tick for 18:00. launchd fires catch-up curl → no recent render → generates for 17:xx. Kiosk shows new image within 60s.

2. **Server crashes mid-generation:** launchd restarts server within 10s. In-progress Gemini API call is lost (no retry). Next hourly tick generates normally. Kiosk retains the last successful image.

3. **`HAYSTACK_IMAGE_DIR` folder is empty:** `getImageForToday()` returns null → `scheduler.tick()` throws → logged as error → no generation. Server stays up and kiosk keeps last image.

4. **User pauses scheduler via Lab UI, then launchd fires:** The trigger endpoint checks `scheduler.isRunning()` first. Since pause sets `running = false`, the endpoint returns `{ triggered: false, reason: "Scheduler paused" }` — zero API calls. No manual plist management needed. When the user resumes from the Lab UI, the next launchd curl picks up normally.

5. **curl fires before server is ready after restart:** Server hasn't started listening yet → curl gets connection refused → `--retry-connrefused` kicks in → retries up to 3 times with 10s delay → server is usually ready within 10-20s → generation succeeds on retry.

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `src/server/scheduler.ts` | Modify | Add `isInActiveHours()` method |
| `src/server/server.ts` | Modify | Add `POST /api/scheduler/trigger` route |
| `scripts/start-server.sh` | Create | Shell wrapper for launchd (PATH resolution) |
| `launchd/com.haystack.server.plist` | Create | Server daemon plist (RunAtLoad + KeepAlive) |
| `launchd/com.haystack.hourly.plist` | Create | Hourly curl trigger plist (HH:05) |
| `scripts/launchd-install.sh` | Create | Install script (copies plists, loads agents) |
| `scripts/launchd-uninstall.sh` | Create | Uninstall script (unloads agents, removes plists) |
| `launchd/haystack.newsyslog.conf` | Create | Log rotation config (weekly, 4 archives) |
| `tests/server/server.test.ts` | Modify | Tests for trigger endpoint |
| `tests/server/scheduler.test.ts` | Modify | Tests for `isInActiveHours()` |
| `CLAUDE.md` | Modify | launchd setup documentation |

## References

### Internal References

- Phase C plan: [2026-02-15-phase-c-feat-tv-kiosk-display-phase-c-plan.md](2026-02-15-phase-c-feat-tv-kiosk-display-phase-c-plan.md)
- Phase C brainstorm: [2026-02-15-tv-kiosk-phase-c-brainstorm.md](../brainstorms/2026-02-15-tv-kiosk-phase-c-brainstorm.md)
- PRD (Phase A4 section): [idea-draft.md](../idea-draft.md) — lines 259–273
- Scheduler: [scheduler.ts](../../src/server/scheduler.ts) — `HourlyScheduler` class
- Server routes: [server.ts](../../src/server/server.ts) — existing scheduler endpoints at line 290
- Server entry: [start.ts](../../src/server/start.ts) — scheduler wiring
- Config: [config.ts](../../src/config/config.ts) — `activeStart`/`activeEnd` parsing

### External References

- Apple launchd docs: [Scheduling Timed Jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html)
- launchd plist man page: `man launchd.plist`
- `launchctl bootstrap`/`bootout`: modern replacement for deprecated `load`/`unload`
