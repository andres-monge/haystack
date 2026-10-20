# Daily artwork stories

Daily story mode is opt-in. Haystack prepares one standalone story from today's artwork and full forecast, then depicts the current hourly scene. Interactive editing, scenario overrides and artwork extension keep their independent prompts and original-only references.

A local `codex exec` process uses the existing ChatGPT login with `gpt-6.1-sol` at medium effort, falling back to `gpt-6-sol` when the primary reports model capacity or times out. It receives the original artwork, today's forecast and up to 14 brief recent-story summaries. One bounded preparation operation proposes the cast, complete scene states, ending and a spoiler-free Spanish trailer. Both models share a five-minute deadline and 1 MiB output budget; the primary has at most 150 seconds so a silent hang leaves time for the fallback. Other errors do not start a second model attempt. Safe writer failure codes are persisted and logged without raw child diagnostics. The visual-first baseline plans distinct visible situations before connecting them into a simple causal story. Adjacent scenes should change substantially in dominant activity, prominent shapes/groups and arrangement, rather than merely moving an object or continuing preparation. Physically plausible temporary foreground objects and activity can use the whole existing frame beyond a main building or its immediate surroundings. The camera, permanent architecture, artistic style and character identities remain fixed. Comedy, adventure, suspense, tenderness and inspiration are available, with a warm, hopeful or satisfying ending; moral growth is not required. Structural validation protects identity and scene slots; narrative taste still needs household review.

## Configuration and activation

Configure these separately from image-provider credentials:

```dotenv
HAYSTACK_STORY_ENABLED=false
HAYSTACK_STORY_PREPARE_TIME=06:45
HAYSTACK_STORY_DIR=/absolute/path/to/story-state
HAYSTACK_CODEX_PATH=/opt/homebrew/bin/codex
# Optional: root of the existing synced Obsidian vault (both public notes)
HAYSTACK_TRAILER_DIR=/absolute/path/to/vault
```

Story mode needs `HAYSTACK_IMAGE_DIR`, latitude, longitude and timezone. Preparation uses the configured timezone, normally Europe/Madrid; the shared trailer handoff requires Europe/Madrid. Active hours are exactly the existing start-inclusive/end-exclusive window, or all 24 hours if unset. For example, an 08:00–22:00 configuration gives fourteen slots, 08 through 21. Preparation is independent of that window: the resident server checks the morning time and catches up after waking before active end. It prepares only an unprepared date. Failed or interrupted preparation retries automatically in each later local hour before active end, preserving the frozen original and stopping once a story is ready. The persisted failure timestamp prevents restarting the server from retrying again in the same hour. A successful retry during active hours requests the current scene without replaying missed hours.

Authenticate with `codex login` and verify `codex login status` says ChatGPT. The executable path is absolute, so launchd's minimal PATH need not contain Codex. The writer uses a dedicated temporary cwd, ignores user configuration/rules, disables apps, MCP configuration inheritance, hooks, plugins and shell tools, and allowlists runtime/login environment fields. API keys and unrelated credentials never enter its environment. Execution is ephemeral and read-only, bounded to 300 seconds and 1 MiB of captured output. Read-only restricts writes; it is not filesystem read isolation. The writer receives no vault path or note contents.

Activation requires explicitly enabled configuration and a resident-server restart. The approved production deployment is recorded below. The Mac must be awake; launchd cannot overcome clamshell sleep.

## Inspect and recover locally

```bash
npm run story:prepare                 # prepare today, reusing a ready artifact
npm run story:prepare -- --retry      # explicitly retry a failed attempt
npm run story:prepare -- --export     # re-export the ready trailer and committed recap; no generation
```

These commands use local configuration and can write the configured trailer destination. For trials, point story, rotation and trailer storage at temporary fixtures; do not use the live vault. Export failure does not discard a ready story. `--export` retries only the handoff, with no writer call. Missing forecast or incomplete/non-finite slots cannot produce a ready story or new trailer.

## Rendering and durability

The original is frozen before writing and remains canonical all day even if the rotation directory changes. The first successful image starts from that original, including a late first render. Later images use the original followed by the preceding successful same-story frame. Its story ID, local date, artwork hash and preceding scene hour must all match. Failed attempts and interactive outputs never become story references. The current scene carries cumulative props/location state and only its present characters, allowing missed hours without backlog replay.

Fresh Scenario conditions control weather and light while the prepared cast and premise stay fixed. All providers receive the same ordered references and use geometry from the original. Story mode never changes artwork after provider exhaustion. Changing active hours preserves an already-ready story; rendering holds if its committed slots no longer match the configured window. Missing story, unavailable required snapshots or generation failure retains the displayed Render. Current-slot deduplication matches story identity, so an interactive image in that hour does not suppress the scheduled scene.

Story JSON, original and latest continuity snapshots live outside normal output retention. Image sidecars remain the Render commit authority. On restart, validated committed same-story outputs repair a lagging continuity pointer. A required corrupt frame holds rendering rather than silently dropping the second reference. A new local date owns its own story and references; a late prior-day completion cannot advance the new day's pointer.

## Public trailer contract

`Haystack/TV Today.md` keeps its exact original contract, atomically after story commit:

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

The body contains exactly the Spanish trailer sentence. Future beats, full premise/cast, separate ending, history and image references remain local. The date is never relabeled during re-export. Existing Obsidian Sync transports the note; no additional sync service is introduced. A downstream assistant must reject absent, invalid or stale notes and may include the eligible trailer under `¿Qué pasa hoy en la tele?` in an existing message. Consumer integration belongs to a separate plan.

## Current story so far

The same configured vault root receives one fixed `Haystack/TV Story So Far.md`. Its header contains `schema_version: 1`, the quoted Madrid-local `date`, `story_id`, `artwork_id`, `ready: true`, ISO `updated_at`, and nullable `latest_scene_hour`. The body starts with the spoiler-free trailer, followed only by chronological `## HH:00` sections containing the committed scenes' state/action. These hours identify story slots; they do not mean an action lasted an hour.

Preparation initially publishes trailer-only zero progress. Only successfully committed same-story renders can advance it. Failed, skipped, interactive, wrong-story and future slots are excluded; skipped hours remain gaps. A later successful scene may describe current cumulative state without claiming the missing scene occurred. The full premise, cast catalogue, future scenes and separate ending field are never exported. The final scene's visible result becomes eligible when its render commits.

Progress is captured durably outside normal image retention before purge. Retained commit evidence can repair a missed capture on restart, and `story:prepare -- --export` republishes without another writer or image call. Publication is atomic and ordered, with current-date/identity checks: delayed yesterday work cannot replace today's note, nor can an older prefix replace a newer one. Export failure does not invalidate an already successful render. No exported recap archive is created.

A busy or failed final publication needs restart or explicit re-export if no later scene succeeds. During a progress-storage outage, cleanup preserves uncaptured sidecars and may temporarily retain more images than the configured limit; normal cleanup resumes after recovery.

The downstream assistant's separately owned Spanish `tv-story-so-far` skill reads this exact note through its existing Obsidian capability. It validates current Madrid date/readiness/identity and never extrapolates the plot. Before the first render, it can give only the trailer and say that no story scene has been generated. A missing or stale note yields an honest unavailable response. Generated progress is not an acknowledgement that the TV displayed an image; the kiosk has no display acknowledgement. Delayed sync means the consumer reports the last available generated update.

## Release checks

Local tests cover identity, persistence, payload order, scheduling and fixture-note format. Five bounded subscription-writer fixture runs have confirmed structured responses using the configured model/effort and ChatGPT login in the production wrapper; actual launchd wake behavior still needs a release check. Review actual stories for specificity, warmth, visual feasibility, late entrances and trailer spoilers. Neither schema validation nor automated tests establish creative quality.

For each rollout, verify the synced note's arrival/readiness and the downstream assistant's active message source. The deployment below records those current runtime checks. Morning wake behavior and the next natural downstream delivery still need observation. D was selected from an eight-frame prototype; full-active-window stability and visual quality on Gemini/xAI remain unproven. Additional paid image trials require separate scope and budget.

## Local verification record — 2026-10-10

The TypeScript build passed and all 637 Vitest tests passed with file parallelism disabled. ESLint could not run: the repository has no ESLint 9 configuration file. No live service, launchd job, vault or image provider was changed or called for these checks.

Three actual subscription-backed writer calls used the production wrapper, `gpt-6.1-sol` at medium effort, ChatGPT authentication and the allowlisted environment. Each produced a schema-valid 12-scene story in approximately 98–109 seconds, using temporary state and fixture forecasts:

| Artwork / forecast | Story | Observation |
|---|---|---|
| Hotel Adriano / sunny | El concierto de las cucharas | Visible ensemble premise; initially introduced a sign and overly fixed weather language |
| Waterfall landscape / rain | El concierto de las gotas | Warm, visually concrete family premise; repeated the concert theme with no supplied history |
| France landscape / recent story summaries | El capitán de las tres puertas | Different croquet premise with clear props and relationships |

The writer prompt now forbids added lettering and asks to preserve setting and period; the scene prompt gives current render conditions authority over forecast weather. Two subsequent writer runs exercised that final wording; image rendering has not been trialed with it. Full local JSON samples and invocation receipts remain under `.context/compound-engineering/daily-story-verification/` for household review; they are not exported in the public note. Household creative acceptance, full-day image continuity, morning wake/sync and downstream delivery acceptance remain release checks.

### Follow-up: final calibrated writer prompt

Two further production-wrapper calls used the final prompt at `8a115af`, the same model/effort and temporary state. The lake/clear run received all three earlier summaries; the dancing/rain run received those plus the new lake summary, through the normal newest-first store history. Both returned valid 12-scene stories without retries (115.1 and 118.8 seconds).

| Source / final-prompt story | Creative findings |
|---|---|
| `artwork/lake-landscape.png` — Una montaña con orejas | Painter/horse obstruction and portrait progression; controlled entrances and complete prop state. Tiny figures and canvas details may be hard to read on the TV. |
| `artwork/dancing-landscape.png` — El dragón que no sabía hacer reverencias | Large puppet/branch/hat comedy offers stronger poses. Rain motivates shelter; written puddles need a fresh dry Scenario to override them. |

Neither repeats concerts or croquet, but both reuse Inés/Tomás, helpers solving a practical problem and a warm cooperative finish. The dragon's proud adult learning from another character echoes the croquet arc. No written lettering or modern props were requested, and both trailers leave the resolution unrevealed. Setting preservation and current-weather authority are supported in the text and prompt; no image run demonstrates them.

The compact human review is `.context/compound-engineering/daily-story-verification/final-prompt-review.md`, with source links and clearly marked spoiler scenes. Full prompts, proposals, validated stories and receipts are adjacent. These two runs close the final-writer-prompt smoke gap; they do not establish household acceptance or rendered visual quality. Runtime code is unchanged, so the existing build/637-test result still applies; only documentation verification was repeated.

### Recap producer verification

The U7 review completed with local receipts retained outside Git. Both confirmed findings were resolved: unavailable story storage now postpones purge of uncaptured commit evidence, and the future-scene recovery test retains its evidence through the late-clock assertion. The outage regression failed before the fix and passed afterward. Exact zero-progress and committed-progress notes assert every header field and the visible trailer/state/action content.

Final TypeScript build and all 646 tests across 31 files passed after the fixes. ESLint remains unavailable because the existing repository has no ESLint 9 configuration. Three simplification reviewers found no useful reuse or clarity change; two bounded-work efficiency suggestions were skipped to retain conservative recovery timing.

The approved single-call creative baseline produced today's real `El retrato del dueño`, using `gpt-6.1-sol` at medium effort and the frozen current `ghibli-bar.jpeg`. All fourteen slots, 08 through 21, validated. Its artwork hash matches the current rotation selection; preparation neither selected tomorrow nor regenerated an existing ready story. This is writer and identity evidence, not a full-day image-continuity trial.

## Production deployment — 2026-10-10

Reviewed code `93068f2` was fast-forwarded into clean `main` and pushed. Story mode was enabled with 06:45 preparation in Europe/Madrid, the existing 08:00–22:00 image window, the configured synced vault and durable state under `~/.haystack/stories`. The installed server job was restarted without reinstalling launchd. Its startup log records Node v22.22.0; the scheduler health endpoint reports running. The unchanged backup trigger remains HH:05, with a 660-second wait and no curl retry.

Today's ready story is `ce4cd9a2-9655-41ac-a1a0-884bf738bb17`. Both notes initially exported only its trailer. Normal late-wake catch-up then committed `20261010_191715_801220c2` for slot 21 through OpenAI in 22.35 seconds. This first story render correctly bootstrapped from the frozen original. Durable progress and the recap contain only scene 21; earlier ungenerated slots remain absent. The downstream parser accepts the two Mac public notes and verifies the recap body matches that committed scene's state/action. The kiosk-facing latest-image API returns the same render and serves bytes matching its saved SHA-256.

A local rollback procedure restores the previous server source/configuration and exact predeployment public-note state without resetting the repository or discarding durable stories. Sanitized writer, export, runtime and review-resolution receipts and private configuration backups stay local.

The separately reviewed downstream consumer was deployed. Its `tv-story-so-far` skill was reported eligible, model-visible and user-invocable. Both exact public-note hashes on its synced mount matched the Mac, and its runtime reader returned the eligible trailer and only committed scene 21. The existing message integration received the reviewed TV appendix after drift checks. Private deployment identifiers, schedule details and rollback locations are omitted here.

Generation, serving and public-note export are verified. The next scheduled preparation and downstream delivery, full-day reference continuity and physical TV display have not been observed; there is no kiosk display acknowledgement.

## Accepted visual-first calibration — 2026-10-13

The household accepted the Hotel Adriano visual-first comparison for real use. The writer first plans distinct visual situations with substantial adjacent-frame changes, then connects them through simple causality and varied emotions. The renderer preserves the original camera/framing and permanent architecture while allowing temporary staging to change across the existing frame, including prominent foreground objects through natural perspective. The hotel/pier-specific prototype sentence was generalized to all artworks. All remaining Spanish, schema, artistic, physical-condition, character and data-boundary instructions are preserved.

The accepted evidence is under `.context/compound-engineering/ce-prototype/2026-10-13-adriano-story-interest/visual-first/`: `prompt-changes.json`, `verification.json` and `parent-visual-review.md`. Four revised frames showed clear foreground-scale/staging gains against the matched control; the 12→13 transition remained weaker. The household accepted that limitation. This comparison used a matched GPT 6 Sol prototype writer; its shim is not production code. Production keeps configured GPT 6.1 Sol medium with its existing capacity/timeout fallback, the existing image chain/quality, D continuity and schedules.

No new prompt-text unit tests were added: they would mirror the prose rather than prove visual variety. The accepted rendered comparison is the creative evidence; existing prompt/privacy, writer, scheduler and provider tests supply regression coverage. No further paid trial, today-story regeneration, scheduler trigger or downstream assistant change is part of this rollout. Tomorrow was not already prepared at preflight, so its normal preparation will use the new prompt. Tomorrow's run and physical TV display remain unobserved.

TypeScript build and all 662 tests pass. The first full run had a five-second timeout in an unchanged legacy-image HTTP test; that test passed in isolation and the subsequent full run passed without assertion changes. ESLint remains unavailable because the repository has no ESLint 9 configuration. Focused `ce-code-review` completed with no findings; it verified the approved substitutions and collected a local adversarial pass.

## Source-style fidelity — 2026-10-20

Andrés selected option B from the isolated localhost comparison: stronger source-style instructions while retaining the existing prominent foreground staging. The renderer now makes the canonical original authoritative for rendering technique, texture, edge treatment, detail and abstraction, including every added character and prop. Pixel-like features are preserved when present; painted and other originals retain their own technique. Narrative details must be simplified when necessary to preserve that technique, and continuity images may guide identity/state without overriding the original style. The writer, story data, provider order/quality and schedules are unchanged.

The accepted visual sample, exact experiment prompts, original and metadata remain in ignored `.context/compound-engineering/style-fidelity-2026-10-20/`. B used Sunburst with explicit granular-source wording; production generalizes that wording to follow each source's actual medium. That generalization and continuity behavior have not had a separate rendered trial. Three fresh Sunburst samples completed; both Gemini model attempts returned provider errors without an image, so this experiment does not establish a provider comparison or consistent success rate.

TypeScript build and all 662 tests passed. Existing prompt/privacy and scheduler/provider tests remain unchanged; new prose assertions would mirror the implementation without proving style fidelity. The owner-selected B render supplies visual acceptance for the approach. Lint remains blocked by the pre-existing missing ESLint 9 configuration.

Focused `ce-code-review` completed with no findings (`20261020-124958-dd3f4479`). It confirmed the original-first reference order and unchanged staging/physical-condition instructions; generative adherence remains probabilistic.
