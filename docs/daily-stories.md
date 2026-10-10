# Daily artwork stories

Daily story mode is opt-in. Haystack prepares one standalone story from today's artwork and full forecast, then depicts the current hourly scene. Interactive editing, scenario overrides and artwork extension keep their independent prompts and original-only references.

A local `codex exec` process uses the existing ChatGPT login with `gpt-6.1-sol` at medium effort. It receives the original artwork, today's forecast and up to 14 brief recent-story summaries. One bounded call proposes the cast, complete scene states, ending and a spoiler-free Spanish trailer. Structural validation protects identity and scene slots; narrative taste still needs household review.

## Configuration and activation

Configure these separately from image-provider credentials:

```dotenv
HAYSTACK_STORY_ENABLED=false
HAYSTACK_STORY_PREPARE_TIME=06:45
HAYSTACK_STORY_DIR=/absolute/path/to/story-state
HAYSTACK_CODEX_PATH=/opt/homebrew/bin/codex
# Optional: root of the existing synced Obsidian vault
HAYSTACK_TRAILER_DIR=/absolute/path/to/vault
```

Story mode needs `HAYSTACK_IMAGE_DIR`, latitude, longitude and timezone. Preparation uses the configured timezone, normally Europe/Madrid; the shared trailer handoff requires Europe/Madrid. Active hours are exactly the existing start-inclusive/end-exclusive window, or all 24 hours if unset. Preparation is independent of that window: the resident server checks the morning time and catches up after waking before active end. It prepares only an unprepared date. No writer retry runs automatically after a persisted failed or interrupted attempt.

Authenticate with `codex login` and verify `codex login status` says ChatGPT. The executable path is absolute, so launchd's minimal PATH need not contain Codex. The writer uses a dedicated temporary cwd, ignores user configuration/rules, disables apps, MCP configuration inheritance, hooks, plugins and shell tools, and allowlists runtime/login environment fields. API keys and unrelated credentials never enter its environment. Execution is ephemeral and read-only, bounded to 300 seconds and 1 MiB of captured output. Read-only restricts writes; it is not filesystem read isolation. The writer receives no vault path or note contents.

This implementation does not change live environment files, install launchd jobs or activate any schedule. Restarting the resident server with explicitly enabled configuration is a separate deployment step. The Mac must be awake; launchd cannot overcome clamshell sleep.

## Inspect and recover locally

```bash
npm run story:prepare                 # prepare today, reusing a ready artifact
npm run story:prepare -- --retry      # explicitly retry a failed attempt
npm run story:prepare -- --export     # export an already-ready trailer only
```

These commands use local configuration and can write the configured trailer destination. For trials, point story, rotation and trailer storage at temporary fixtures; do not use the live vault. Export failure does not discard a ready story. `--export` retries only the handoff, with no writer call. Missing forecast or incomplete/non-finite slots cannot produce a ready story or new trailer.

## Rendering and durability

The original is frozen before writing and remains canonical all day even if the rotation directory changes. The first successful image starts from that original, including a late first render. Later images use the original followed by the preceding successful same-story frame. Its story ID, local date, artwork hash and preceding scene hour must all match. Failed attempts and interactive outputs never become story references. The current scene carries cumulative props/location state and only its present characters, allowing missed hours without backlog replay.

Fresh Scenario conditions control weather and light while the prepared cast and premise stay fixed. All providers receive the same ordered references and use geometry from the original. Story mode never changes artwork after provider exhaustion. Changing active hours preserves an already-ready story; rendering holds if its committed slots no longer match the configured window. Missing story, unavailable required snapshots or generation failure retains the displayed Render. Current-slot deduplication matches story identity, so an interactive image in that hour does not suppress the scheduled scene.

Story JSON, original and latest continuity snapshots live outside normal output retention. Image sidecars remain the Render commit authority. On restart, validated committed same-story outputs repair a lagging continuity pointer. A required corrupt frame holds rendering rather than silently dropping the second reference. A new local date owns its own story and references; a late prior-day completion cannot advance the new day's pointer.

## Public trailer contract

Only `Haystack/TV Today.md` is exported, atomically after story commit:

```yaml
---
schema_version: 1
date: "2026-10-10"
story_id: "opaque-story-id"
artwork_id: "content-sha256"
ready: true
generated_at: "2026-10-10T04:45:00.000Z"
---
```

The body contains exactly the Spanish trailer sentence. Full beats, history and image references remain local. The date is never relabeled during re-export. Existing Obsidian Sync transports the note; no additional sync service is introduced. Carson must reject absent, invalid or stale notes and add the eligible trailer under `¿Qué pasa hoy en la tele?` in the established single 08:00 message. That consumer change belongs to its separate plan; the 07:30 priorities planner is unaffected.

## Release checks

Local tests cover identity, persistence, payload order, scheduling and fixture-note format. Five bounded subscription-writer fixture runs have confirmed structured responses using the configured model/effort and ChatGPT login in the production wrapper; actual launchd wake behavior still needs a release check. Review actual stories for specificity, warmth, visual feasibility, late entrances and trailer spoilers. Neither schema validation nor automated tests establish creative quality.

Before live activation, confirm the Mac's morning wake behavior and the synced note's arrival/readiness before 08:00. Carson's active greeting source still needs verification and its own acceptance tests. D was selected from an eight-frame prototype; full-active-window stability and visual quality on Gemini/xAI remain unproven. Additional paid image trials require separate scope and budget.

## Local verification record — 2026-10-10

The TypeScript build passed and all 637 Vitest tests passed with file parallelism disabled. ESLint could not run: the repository has no ESLint 9 configuration file. No live service, launchd job, vault or image provider was changed or called for these checks.

Three actual subscription-backed writer calls used the production wrapper, `gpt-6.1-sol` at medium effort, ChatGPT authentication and the allowlisted environment. Each produced a schema-valid 12-scene story in approximately 98–109 seconds, using temporary state and fixture forecasts:

| Artwork / forecast | Story | Observation |
|---|---|---|
| Hotel Adriano / sunny | El concierto de las cucharas | Visible ensemble premise; initially introduced a sign and overly fixed weather language |
| Waterfall landscape / rain | El concierto de las gotas | Warm, visually concrete family premise; repeated the concert theme with no supplied history |
| France landscape / recent story summaries | El capitán de las tres puertas | Different croquet premise with clear props and relationships |

The writer prompt now forbids added lettering and asks to preserve setting and period; the scene prompt gives current render conditions authority over forecast weather. Two subsequent writer runs exercised that final wording; image rendering has not been trialed with it. Full local JSON samples and invocation receipts remain under `.context/compound-engineering/daily-story-verification/` for household review; they are not exported in the public note. Household creative acceptance, full-day image continuity, morning wake/sync and Carson greeting acceptance remain release checks.

### Follow-up: final calibrated writer prompt

Two further production-wrapper calls used the final prompt at `8a115af`, the same model/effort and temporary state. The lake/clear run received all three earlier summaries; the dancing/rain run received those plus the new lake summary, through the normal newest-first store history. Both returned valid 12-scene stories without retries (115.1 and 118.8 seconds).

| Source / final-prompt story | Creative findings |
|---|---|
| `artwork/lake-landscape.png` — Una montaña con orejas | Painter/horse obstruction and portrait progression; controlled entrances and complete prop state. Tiny figures and canvas details may be hard to read on the TV. |
| `artwork/dancing-landscape.png` — El dragón que no sabía hacer reverencias | Large puppet/branch/hat comedy offers stronger poses. Rain motivates shelter; written puddles need a fresh dry Scenario to override them. |

Neither repeats concerts or croquet, but both reuse Inés/Tomás, helpers solving a practical problem and a warm cooperative finish. The dragon's proud adult learning from another character echoes the croquet arc. No written lettering or modern props were requested, and both trailers leave the resolution unrevealed. Setting preservation and current-weather authority are supported in the text and prompt; no image run demonstrates them.

The compact human review is `.context/compound-engineering/daily-story-verification/final-prompt-review.md`, with source links and clearly marked spoiler scenes. Full prompts, proposals, validated stories and receipts are adjacent. These two runs close the final-writer-prompt smoke gap; they do not establish household acceptance or rendered visual quality. Runtime code is unchanged, so the existing build/637-test result still applies; only documentation verification was repeated.
