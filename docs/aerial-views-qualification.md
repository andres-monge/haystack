# Aerial Views 1.8.5 local qualification — 18 October 2026

**Result: stock 1.8.5 does not qualify for Haystack’s ≤120-second visible refresh requirement (R9).** During one running system dream, both the updated unique-URL feed case and the fixed-image-URL case remained on their original images for 127.4 seconds. The app made no fixture requests after publication. Stop at this decisive failure; same-URL error recovery and offline restart were **not tested**, not failed.

The parent reviewed `runtime-result.json` and the final old-image screenshot and accepted the local freshness disqualification. No Aerial Views adoption, Sony installation, fork, patch or full U4 implementation follows. The existing signed static DreamService fixture remains available for the next separately authorized Sony selection/natural-idle/remote-exit capability check. Preserve the accepted Projectivy setup; U3 is deferred by the user.

## Scope and provenance

Andrés authorized this bounded local qualification through the parent chat on 18 October 2026. Work began at 15:14 Madrid; the decisive observation ended at 15:32 and the disposable emulator/fixture were stopped at 15:33, within the intended 45-minute active experiment budget. Documentation/review followed. There were no Sony commands, household-check repetitions, production endpoint calls, generation, server/Pi/router changes or purchases. The heartbeat stayed off.

The [official 1.8.5 release](https://github.com/theothernt/AerialViews/releases/tag/1.8.5), published 2 October 2026, is neither draft nor prerelease. Its `aerial-views-1.8.5.apk` is 9,147,039 bytes; downloaded bytes match the GitHub release API asset SHA-256:

`a20b4bc748da5ce890d96536494952aa4f50a6b589c50dee176415c021407070`

API-28 `apksigner verify --verbose --print-certs` exited 0 with v2 verified. Certificate SHA-256:

`383b3b2df6d2b17cec60542c576408b0deae502f37749eb5ac7fef2f206fa51b`

The installed package was `com.neilturner.aerialviews`, version 1.8.5/code 148, minSdk 23/targetSdk 37. The annotated, unsigned source tag points to [commit 59a1e6667e40c33eea66725cf0f4836cb1bac9c2](https://github.com/theothernt/AerialViews/tree/59a1e6667e40c33eea66725cf0f4836cb1bac9c2). Official release provenance, APK signature validity and source inspection are separate evidence; this was not a reproducible-build comparison between source and APK.

## Configuration and controls

The verified stock APK ran on disposable ARM64 Android TV API 31, explicitly selected as `emulator-5582` with `ro.kernel.qemu=1`. The real framework dream was `com.neilturner.aerialviews/.ui.screensaver.DreamActivity`, started through Android’s dream manager. This is local forced entry, not Sony selection or natural idle proof.

Configuration used the app’s own settings UI. All four built-in feeds were switched OFF; only the custom fixture feed was enabled. The UI validated one feed with two photos. Shuffle was OFF, the photo dwell was visibly set to **5 seconds**, and playlist cache was visibly OFF. Transitions were left at fresh-install source defaults: 600 ms in / 800 ms out; those transition values were not read from private preferences. Repeated cycling between both original photos also established that a long dwell was not hiding an update.

Supported `.avsettings` import attempts encountered Android storage/URI permission errors and did not succeed. A `READ_EXTERNAL_STORAGE` grant was tried only on the disposable emulator during diagnosis; no root, APK edits or direct preference-file changes were used. The successful configuration and validation were observed through the stock UI. No emulator configuration was applied to the Sony.

A separate Python fixture bound only to host loopback on an ephemeral port; the emulator reached it through `10.0.2.2`. Every response sent `Cache-Control: no-store, max-age=0, must-revalidate` and a content-derived ETag. Emulator DNS was pointed at loopback to avoid fetching public feeds. This was not a complete network-isolation or traffic audit.

## Runtime evidence

Two distinct cases were observed within the same uninterrupted dream, with separate URLs, image colors/labels and assertions. The initial playlist contained blue **UNIQUE A** at `/render-a.jpg` and green **ALIAS A** at `/latest.jpg`. Both had to render visibly before publication; they did.

At 15:30:10.559 Madrid the fixture atomically changed state. Its feed now referenced orange **UNIQUE B** at `/render-b.jpg`, while `/latest.jpg` returned purple **ALIAS B** bytes at the unchanged URL. Separately labeled host control requests confirmed HTTP 200 and the changed content for the feed, B image and alias. These controls used a distinct user agent and are excluded from app request counts.

| Evidence boundary | Observation |
|---|---|
| Settings validation before dream | Two `/entries.json` requests; these are configuration validation, not runtime polling. |
| Dream startup | One feed request, then one `/render-a.jpg` and one `/latest.jpg` request. |
| After B publication | **Zero app requests** through the 127.4-second observation; the three host control requests are recorded separately. |
| Unique-URL feed case | Original blue UNIQUE A remained visible at +127.38 seconds; B was never requested or observed. **FAIL** for ≤120-second refresh. |
| Fixed-image alias case | Original green ALIAS A remained visible at +120.31 seconds and repeatedly after publication; replacement bytes were never requested or observed. **FAIL** for ≤120-second refresh. |
| Dream continuity | Every captured dream dump named the actual Aerial DreamService and the same single dream token. No input, activity launch or restart occurred during the observation. |
| Same-ID/URL failure recovery | **NOT TESTED** after decisive freshness failure. Replacing successful alias bytes is not an error-recovery test. |
| Offline process/device restart last-good | **NOT TESTED** after decisive freshness failure. |
| Sony natural entry/remote exit | **NOT TESTED**; no Sony action was authorized by this experiment. |

Screenshots and sampled background colors agree; fade frames were labeled transitional rather than mistaken for B. No app request fetched `/render-b.jpg` at any time, and `/latest.jpg` was fetched only before publication, when it returned A. The request log therefore corroborates the sampled old-image evidence. The stock release was not modified to force cache invalidation or restart its dream.

## Source evidence, separate from runtime observations

At the exact release commit, [ScreenController](https://github.com/theothernt/AerialViews/blob/59a1e6667e40c33eea66725cf0f4836cb1bac9c2/app/src/main/java/com/neilturner/aerialviews/ui/core/ScreenController.kt#L275) constructs the playlist at startup and later advances that in-memory list. The [custom provider](https://github.com/theothernt/AerialViews/blob/59a1e6667e40c33eea66725cf0f4836cb1bac9c2/app/src/main/java/com/neilturner/aerialviews/providers/custom/CustomFeedProvider.kt#L40) fetches the configured feed; no visible-session periodic feed refresh was found. This explains the unique-URL observation without treating settings-validation requests as polling.

[ImagePlayerView](https://github.com/theothernt/AerialViews/blob/59a1e6667e40c33eea66725cf0f4836cb1bac9c2/app/src/main/java/com/neilturner/aerialviews/ui/core/ImagePlayerView.kt#L113) disables memory caching but retains default Coil disk caching. [Coil 3.6.3’s default strategy](https://github.com/coil-kt/coil/blob/3.6.3/coil-network-core/src/commonMain/kotlin/coil3/network/CacheStrategy.kt#L105) returns cached disk responses. That is consistent with the stale fixed alias, but the cache files themselves were not inspected.

Source also clears the previous foreground image while transitioning and offers playlist metadata caching rather than an explicit accepted-image durability contract. Those facts motivated the failure/offline cases; they are not runtime failures or passes for the cases stopped early.

The GitHub release flavor enables Firebase analytics, crash and performance collection in its [build configuration](https://github.com/theothernt/AerialViews/blob/59a1e6667e40c33eea66725cf0f4836cb1bac9c2/app/build.gradle.kts#L87) and manifest; no runtime opt-out was found in the audited source. Its [helper](https://github.com/theothernt/AerialViews/blob/59a1e6667e40c33eea66725cf0f4836cb1bac9c2/app/src/common/java/utils/FirebaseHelper.kt#L11) still sends explicit screen views despite some date-gated event logging. The separate F-Droid flavor is not evidence that this GitHub APK is telemetry-free. Emulator logs show Firebase initialization/request attempts failing DNS; successful telemetry transmission was not established. No Sony privacy setting was changed.

## Evidence and disposition

Raw binaries, source archive, fixture scripts/images, settings UI dumps, logs and screenshots remain ignored under `tv-local/20261018-aerial-qualification/` and `tv-local/20261018-aerial-source/`. Key runtime files are `runtime-result.json`, `runtime-events.json`, `frames.json`, `request-summary.json`, `requests.jsonl`, `publication-controls.json`, `configuration-summary.json`, `after-120.png`, `after-127.png`, matching dream dumps and `cleanup.json`. These private artifacts were not committed. Cleanup verified the emulator stopped and the owned fixture listener closed.

Do not install this release on the Sony for the current requirement, silently adopt another flavor, patch it, or start full U4. The next gate is a separately authorized trial of the already prepared signed static DreamService fixture: normal Sony selection, natural idle entry and physical remote exit under unchanged settings. If the existing one-hour idle policy cannot fit a short active trial, authorize a separate observation window rather than shorten the timer. Only accepted native capability and a separate custom-fallback decision open full delivery/cache work. U3 remains deferred; the user-accepted Projectivy performance and household checks need no repetition.
