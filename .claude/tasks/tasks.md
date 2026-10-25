# Phase A1 — Build Roadmap

> Source plan: `docs/plans/2026-02-10-feat-gemini-image-editing-pipeline-plan.md`
> Task details: `.claude/tasks/{1..11}.json`
> How to use: Open a Claude Code session and say _"Read .claude/tasks/ and do the next unchecked task"_

## Dependency Graph

```
  #1  Scaffold project
   │
  #2  Type definitions
   │
   ├──────────┬──────────┬──────────┐
   │          │          │          │
  #3 Scenario #5 Gemini  #6 Store  #7 Config
   │          │  Client  │          │
  #4 Prompt   │          │          │
   │          │          │          │
   ├──────────┴──────────┘          │
   │                                │
  #8  Pipeline + exports            │
   │                                │
   ├────────────────────────────────┘
   │          │
  #9  CLI    #10 Example
   │          │
   └──────┬───┘
          │
  #11  Verify build + tests
```

---

## Step 1 — Foundation

Must be done in order. Each unlocks the next.

- [x] **#1 Scaffold project** — `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `npm install`
- [x] **#2 Type definitions** — `src/engine/types.ts` (Scenario, SerializedScenario, GeminiConfig, RenderMetadata, etc.)

## Step 2 — Core modules (parallel)

After #2 is done, these four have **no dependencies on each other**. Do in any order or all at once.

- [x] **#3 Scenario builder** — `src/engine/scenario.ts` + `tests/engine/scenario.test.ts`
- [x] **#5 Gemini client** — `src/engine/gemini-client.ts` + `tests/engine/gemini-client.test.ts`
- [x] **#6 Output store** — `src/storage/output-store.ts` + `src/storage/index.ts` + `tests/storage/output-store.test.ts`
- [x] **#7 Config module** — `src/config/config.ts` + `src/config/index.ts`

## Step 3 — Prompt composer

Depends on #3 (uses `describeScenario` from scenario builder).

- [x] **#4 Prompt composer** — `src/engine/prompt.ts` + `tests/engine/prompt.test.ts`

## Step 4 — Pipeline

Depends on #4 + #5 + #6 all being done. Creates the export barrel files too.

- [x] **#8 Main pipeline** — `src/engine/pipeline.ts` + `src/engine/index.ts` + `src/index.ts` + `tests/engine/pipeline.test.ts`

## Step 5 — CLI + Example (parallel)

After #8 is done, these two are independent.

- [x] **#9 CLI entry point** — `src/cli/generate.ts` (also needs #7)
- [x] **#10 Example script** — `examples/basic-edit.ts`

## Step 6 — Final verification

- [x] **#11 Verify build + tests** — `npm run build`, `npm run test:run`, check `dist/` structure, `.gitignore`

---

## Progress

| Task | Status | Date |
|------|--------|------|
| #1 Scaffold | done | 2026-02-12 |
| #2 Types | done | 2026-02-12 |
| #3 Scenario | done | 2026-02-12 |
| #4 Prompt | done | 2026-02-12 |
| #5 Gemini client | done | 2026-02-12 |
| #6 Output store | done | 2026-02-12 |
| #7 Config | done | 2026-02-12 |
| #8 Pipeline | done | 2026-02-12 |
| #9 CLI | done | 2026-02-12 |
| #10 Example | done | 2026-02-12 |
| #11 Verify | done | 2026-02-12 |

## Daily artwork stories (2026-10-10)

Plan: `docs/plans/2026-10-10-1307-feat-daily-artwork-stories-plan.md`

- [x] U1 Durable daily story and reference state
- [x] U2 Subscription-backed local writer and preparation
- [x] U3 Ordered references across image providers
- [x] U4 Scheduled story scenes, deduplication and continuity
- [x] U5 Trailer export and preparation scheduling
- [x] U6 Local verification and activation documentation (household acceptance remains a release check)
- [x] U7 Current-day committed-scene recap, purge-safe evidence and recovery

| Unit | Status | Date |
|------|--------|------|
| U1 | done | 2026-10-10 |
| U2 | done; real writer smoke verified | 2026-10-10 |
| U3 | done | 2026-10-10 |
| U4 | done | 2026-10-10 |
| U5 | done; temporary-vault contract verified | 2026-10-10 |
| U6 | local verification done; release checks documented | 2026-10-10 |
| U7 | done; full review findings fixed, build and 646 tests pass | 2026-10-10 |

## Gemini fallback upgrade (2026-10-11)

- [x] Upgrade normal Gemini renders to Nano Banana 2.1 at 1K; preserve OpenAI priority/settings and extension models.

| Task | Status | Date |
|------|--------|------|
| Nano Banana 2.1 fallback | build and 648 tests pass; reviewed; API compatibility confirmed; live server restarted; lint unavailable because the repo has no ESLint configuration | 2026-10-11 |

## Hourly story preparation recovery (2026-10-13)

- [x] Retry failed or interrupted preparation in each later local hour before active end; preserve same-hour restart and concurrent-attempt guards.
- [x] Verify retry cadence, readiness, contention and active-end cutoff; build and all 655 tests pass.
- [x] Activate the retry policy in the running server; scheduler health confirmed after restart.

| Task | Status | Date |
|------|--------|------|
| Hourly story preparation recovery | done; build and 655 tests pass | 2026-10-13 |

## Story writer capacity recovery (2026-10-13)

- [x] Reproduce primary model capacity failure with the production login/environment and verify the fallback model responds.
- [x] Fall back from `gpt-6.1-sol` to `gpt-6-sol` on capacity or primary timeout within shared 300-second/1 MiB limits.
- [x] Persist safe writer failure codes; verify build and all 662 tests.
- [x] Recover today's real story and publish its TV notes using the fallback.
- [x] Verify a new 09:46 Madrid image is committed and served by `/api/latest`; activate the writer fallback in the resident server.

| Task | Status | Date |
|------|--------|------|
| Story writer capacity recovery | build and 662 tests pass; real story recovered | 2026-10-13 |

## Visual-first story calibration (2026-10-13)

- [x] Apply accepted visual-first writer paragraphs and temporary-composition renderer clause, with artwork-neutral staging language.
- [x] Preserve production models/fallback, image chain/quality, continuity, schedules and public-note contracts; verify build, 662 tests and focused review.

| Task | Status | Date |
|------|--------|------|
| Visual-first story calibration | verified; accepted rendered evidence retains the weaker 12→13 transition | 2026-10-13 |

## Sony TV performance and Haystack integration (2026-10-18)

Plan: `docs/plans/2026-10-18-0839-feat-sony-tv-haystack-integration-plan.md`

- [x] Read-only Sony KD-55XE8096 inventory and app preferences captured; no TV app or setting changes made by the agent.
- [ ] U1 Baseline and conditional exact recovery prepared; initial automated probes retained historically. Later Home/household checks passed by owner report; this accepted setup has not been rolled back to prove recovery execution.
- [x] Historical U2 Projectivy preparation recorded; old trial ended and was restored. Later accepted manual Home/setup evidence is recorded separately below.
- [x] Revised U2 local preparation: candidate release/signature rechecked, exact free-control checklist and Home-routing blocker/permission proposal documented, static native dream fixture built/signed and verified locally.
- [x] Revised U2 Home/setup branch: Andrés confirmed clean Settings→Home and Netflix→Back/Exit returns, all 13 apps, Settings/Inputs, hidden unwanted rows, restart/wake persistence, remote controls, app access, Chromecast and Pi HDMI 1 (human-reported, 2026-10-18). Historical privacy report was both OFF; latest accepted usage OFF/crash ON is corroborated separately.
- [x] Revised U2 independent static Sony dream capability: signed fixture installed; selected through normal Sony UI, owner-photo preview and physical preview exit passed, natural entry observed by 16:00:10, and owner confirmed physical exit cleanly to Projectivy. Full delivery/cache/lifecycle remains separate.
- [ ] U3 Deferred by user scope decision (2026-10-18), not completed: current Projectivy performance is accepted; no cleanup/package removal/manufacturer privacy/voice changes required or authorized.
- [x] Local Aerial Views 1.8.5 qualification completed: stock release disqualified by ≤120-second freshness failure; old images persisted for 127.4 seconds in one dream with zero app requests after publication. Same-ID/URL error retry and offline restart NOT TESTED after early stop; no adoption or full U4.
- [x] U4 Local custom delivery/cache implemented and verified after qualification and accepted Sony capability. No TV upgrade, server deployment/restart or production change; existing API reused.
- U5 Retired: dynamic Home artwork is optional/deferred; no custom launcher or standalone fullscreen viewer.
- [x] U6 Scoped native idle artwork accepted: v4 quality/physical exit, refresh/retry, offline process recovery and human Netflix/phone-Cast playback passed; v5 adds accepted smooth fades, a combined offline-device reboot, exact restoration and injected standby/wake with natural current art. HDMI-idle activation remains unverified.
- [x] U7 Scoped evidence reconciliation and operational/recovery handoff complete; v5 follow-up and remaining limits recorded. Continue Watching was observed populated without a preference change.

| Unit | Status | Date |
|------|--------|------|
| Device inspection | complete; Android 9, 198 packages, about 2 GB RAM; ADB disconnected after inspection | 2026-10-18 |
| U1 | baseline/recovery preparation retained; later Home/household passes are human-reported; no measured speed gain or executed rollback of the accepted manual setup | 2026-10-18 |
| Historical U2 preparation | withdrawn; prior package inspection remains evidence only | 2026-10-18 |
| U2 local preparation | complete: minimal static DreamService; debug/release, four API-28/35 JVM cases, lint, API-28 signing, one API-31 ARM64 TV instrumentation case and emulator preview/input-exit passed; Home no-grant routing blocked and precise permission option documented | 2026-10-18 |
| U2 Home/setup | accepted from Andrés’s physical observations and explicit completed-list confirmation via parent chat; read-only package/signer/accessibility/stock-state corroboration recorded separately | 2026-10-18 |
| U2 Sony dream proof | accepted minimal static capability: signed install/selection, preview, natural idle entry and human physical exit; supported five-minute delay retained by explicit user direction, separate sleep unchanged | 2026-10-18 |
| R1 qualitative responsiveness | accepted: Andrés says Projectivy is “blisteringly fast”, exactly what he wanted, and is happy with current performance; directly confirms HDMI is now fast with Projectivy; no numerical gain claimed | 2026-10-18 |
| U3 | deferred by user scope decision; not complete, no manufacturer telemetry reduction claimed, not required for U7 | 2026-10-18 |
| Local Aerial Views qualification | complete, stock 1.8.5 disqualified by local freshness failure; source/runtime evidence separate; retry/offline restart not tested; emulator and fixture stopped | 2026-10-18 |
| U4 | local implementation verified; subsequent live verification is recorded under U6 | 2026-10-18 |
| U6 | v4 quality/physical exit, refresh/cache and Netflix/Cast passes retained; v5 smooth fade, combined offline reboot, exact restoration, injected wake and natural current art passed | 2026-10-18 |
| U7 | scoped handoff complete with v5 follow-up; HDMI-idle, physical panel-ready latency and worst-case/GPU memory remain unverified | 2026-10-18 |

The reduced scope permits a plain/static Home, with hourly Haystack artwork required only in the native screensaver. Projectivy free Home/setup is now accepted on the explicitly attributed human evidence; preserve the successful manual override and do not repeat completed owner checks. Andrés’s qualitative performance acceptance and decision that U3 is unnecessary were relayed through parent chat `01a14da5-d80c-7773-8251-f866efd4e1c2` on 2026-10-18. No numerical speedup, quantified HDMI improvement, manufacturer telemetry reduction or executed exact recovery is claimed. Bounded local Aerial Views 1.8.5 qualification ended early on decisive freshness failure; see `docs/aerial-views-qualification.md`. Same-ID/URL error retry and offline restart were NOT TESTED after disqualification. The later separately authorized signed static Sony fixture passed selection, preview, natural idle entry and physical exit. Andrés requested keeping the supported five-minute delay (`screen_off_timeout=300000`); the original hour is recovery history, not an automatic restore target, and `sleep_timeout=-1` remains unchanged. No enabled Projectivy screensaver/idle conflict was found or preference changed. Latest explicit usage OFF/crash ON preference matches associated switch readback; earlier privacy evidence is retained chronologically in the runbook. Direct HDMI feedback says it is now fast with Projectivy; no numerical improvement or extra optimization is claimed. At that stage the custom-fallback decision authorized U4 local implementation/testing only; later U6 authority and evidence are recorded below. No cleanup, additional Sony grants/remapping, purchase, server/Pi/network change, paid generation or heartbeat activation is authorized.

Subsequent U4 authority: Andrés explicitly approved local live-art refresh and durable offline-cache implementation/testing after the accepted Sony capability. U4 was locally implemented and verified; that authorization did not itself permit a TV upgrade, server deployment/restart or production-output changes. Later U6 authority was separate.

U4 verification: 19 JVM cases, two API-31 instrumentation cases, signed/debug builds and lint passed; actual emulator dream refreshed failed-then-retried same-ID B within 61.623 seconds, restored B offline in a new process, showed the built-in fallback without cache and issued no requests for 65 seconds after dismissal. This was local-only verification; at U4 completion Sony remained on the accepted version-1 static fixture. Subsequent U6 updates and checks are recorded below.

Subsequent U6 authority and results: Andrés explicitly authorized the live native-art trial and necessary quality fixes. Version 2 undersampled the source; version 3 improved detail but was still softer than the same artwork on Pi HDMI 1. Reviewed v4 preserves fitted detail and uses integer bitmap placement. Andrés accepted “Quality is satisfactory; exit works.” At the v4 handoff, production was version 4, stable-key signed, SHA-256 `a1c671a04545acbc1c845b644f5123db02b9093524ad81616426c1f8470b0dd2`. Debug/release, 27 JVM cases, lint and API-28 signing passed. Independent Opus reviews requested low effort; receipts verify the served model but not internal effort.

Actual Sony v4 verification passed same-session A→B failure/retry freshness (49.7-second visible upper bound), retained-last-good, offline new-process cached B, and 92.8 seconds without polling after injected Home while the process remained alive. The exact production APK/hash/signature/origin/settings and current artwork were restored before an online device reboot. A changed kernel boot ID, ADB recovery, preserved APK/settings and natural current art then passed. Offline device reboot was not combined with the fixture test; new v4 standby/wake was not repeated. Owned listeners are stopped and the default local release output matches production. Netflix’s explicit human six-minute normal playback/audio/no-screensaver result passed; metadata corroborated 313.2 seconds of advancing playback rather than a full host-observed six-minute window. Actual phone-sent Google Cast picture/audio/no-screensaver also passed by explicit six-minute owner report. Its first metadata sample was playing and final sample paused; no continuous six-minute host playback claim is made. Independent final review supports scoped U6/U7 closure; the final runbook matrix records each requirement and its limits. No production server, Pi, household network, schedule or generation configuration changes, or heartbeat activation, occurred. Continue Watching repair remains unconfirmed.

### Optional Sony transition follow-up — 18 October 2026

Fresh owner authorization reopened targeted TV testing for a smooth transition like the Pi. The reviewed v5 production update was approved, verified and retained; the owner then paused live work, and the remaining wrap-up was host-only.

- [x] Add a two-second fade between newly accepted artworks, preserve initial/cache/error behavior and whole-pixel placement; bound layer and queued-bitmap references.
- [x] Local transition/interruption/stop/restart/failure/same-ID and bitmap-allocation tests passed (39 JVM cases), debug/release/lint and simplification passed; independent Opus review Ready to merge (low requested; actual effort unverified). Human fade smoothness and sampled live PSS passed; native video was unusable, with no hardware duration or GPU-bound claim.
- [x] Reviewed v5 Sony fixtures, combined offline-device reboot with natural cached B, exact production restoration, injected standby/wake and natural current art passed. Final image retained whole-pixel placement. No fresh v5 physical-remote or six-minute playback repeat is claimed.
- [x] Final normal-UI inspection found Continue Watching already populated (six cards, three progress bars), master channels and override on, usage off/crash on, and only TV apps/Continue Watching/Inputs rows. No preferences changed or title launched; the cause of the prior absence is unknown.

Final retained production: v5 (`0.5-crossfade`), SHA-256 `2ecf42870e216c191d0036e77a6188f41104602ecdea5b989cd24736068585bc`, stable certificate and origin 4321, five-minute delay and sleep `-1`. Owned fixture and watchdog exited; ADB disconnected. The owner subsequently reported turning the TV off; final documentation used saved evidence only. Optional Home UI opacity 100% was documented but not applied. Source implementation is committed as `17d27d6`.

### Source-style fidelity follow-up — 20 October 2026

- [x] Compare current Sunburst prompting, explicit source-style matching, and restrained staging through isolated pipeline generations; retain original, prompts and metadata for visual review.
- [x] Apply owner-selected B source-style priority to scheduled story rendering, preserving current staging and making the original authoritative over continuity-frame style; build and all 662 tests pass. See `docs/daily-stories.md` for visual evidence and validation limits.

### Targeted TV privacy follow-up — 25 October 2026

- [x] Record owner-reported Samba opt-out and read-only permission/app-operation/recording-monitor snapshots; no traffic-wide or always-on microphone claim.
- [x] Revoke unused user-0 microphone permission from Google voice search, YouTube, RTVE and Play Store; verify active runtime-grant readbacks and record exact per-package restore actions.
- [x] Change Google's Usage & Diagnostics from on to off through Sony's normal UI; verify unchecked switch and the sole settings delta `global.multi_cb=0`. Observe Google Assistant off without an additional toggle.
- [x] Inspect the TV's advertising controls without resetting or deleting its identifier; keep ad-debug logging off.
- [x] Record owner's decision to retain the advertising ID after discussing the tradeoffs; no deletion/reset or further TV changes are pending. Microphone restrictions and Usage & Diagnostics off remain in place.

No package removal, account-history change, location-permission change, new grant, network/DNS configuration or Haystack/Projectivy change is included. See `docs/tv-integration.md` for evidence boundaries and recovery; private UI and identifier evidence remain ignored under `tv-local/20261025-privacy-hardening/`.
