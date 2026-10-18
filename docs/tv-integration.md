# Sony TV integration: baseline and recovery

Status on 18 October 2026: **Projectivy Home and qualitative Home/HDMI responsiveness are accepted. Production v5 now adds the Pi-style two-second artwork fade, accepted as smooth by Andrés. Native current art, whole-pixel end placement, same-ID refresh/retry, offline process recovery and a combined offline-device reboot passed; exact production restoration and injected standby/wake with natural current art passed. Netflix and phone-Cast six-minute playback checks passed on v4; they were not repeated for v5. No numerical navigation speedup, measured panel-wake time or universal HDMI-idle support is claimed. Continue Watching is currently populated, with no repair or preference change made during the final inspection.**

The [revised proposal](plans/2026-10-18-0839-feat-sony-tv-haystack-integration-plan.md) keeps dynamic Home art optional, targeted cleanup/privacy separate, and native idle artwork independent. Following a new explicit free-TV authorization and disclosure of the accessibility service's broader window-content/key-filtering capability, Andrés installed Projectivy and enabled its own launcher override manually. Stock Home remains enabled. See [the current Home evidence](#accepted-home-and-manual-setup--18-october-2026) for the accepted checks and their source.

The earlier restored trial and the subsequent local-preparation sections below are historical records. Their pending-Home statements describe those earlier stages; the current Home evidence supersedes them. Old commands and gate sheets do not authorize new actions. Preserve the successful manual override; missing screensaver proof is not a reason to roll it back. No purchase was made. U3 cleanup is deferred by the user’s scope decision. The later separately authorized Sony static-fixture result is recorded below; U4 local implementation and the separately authorized scoped U6/U7 verification are complete; the final matrix below defines their evidence limits. The heartbeat remains off.

## Evidence and scope

The private inspection at `~/.haystack/tv-inspections/20261018-083837/` is the original 18 October configuration evidence. It contains selected settings, Home/Dream resolution, package inventories and selected package dumps, memory and storage reports. It is **not a full backup**: accounts, app data, APK recovery, firmware and boot-loop recovery are not secured by those files.

Local follow-up evidence belongs under ignored `tv-local/`; the root exclusion was added before creating that directory. Never force-add it. Keep raw dumps, account data, device/host keys and screen recordings out of Git. Commit only reviewed configuration summaries. An enabled-package list does not distinguish default from explicitly enabled state.

The original inspection ended with ADB disconnected. A later U1-only session began at 08:52 Europe/Madrid on 18 October. Its initial 09:02 cutoff was explicitly lifted by Andres in the worker chat to prioritise completing exploration. Debugging availability and physical results must be recorded independently of host disconnection. Do not reconnect solely to repeat saved evidence. Outside an explicitly free-TV window, do not navigate, inject keys, launch apps, switch inputs, start a screensaver, capture the screen, cast, restart, sleep or wake the TV.

## Recorded baseline

| Item | Observed configuration | Evidence file in original private inspection |
|---|---|---|
| Device | Household retail model KD-55XE8096; Android model BRAVIA 4K GB; Sony BRAVIA_ATV2_EU | Human identification; selected-settings.json |
| Connection | Ethernet; ADB endpoint `192.168.0.24:5555` at inspection | Inspection session |
| OS | Android 9 / API 28; build `BRAVIA_ATV2_EU-user 9 PTT1.190515.001.S54 672201 release-keys` | selected-settings.json |
| Security patch | 2022-01-05; full installed Sony firmware still needs physical confirmation | selected-settings.json |
| Memory | 1,993,356 KiB physical; 159,888 KiB available; no swap | memory.txt |
| Stock launcher PSS | 170,109 KiB in one process snapshot | memory-processes.txt |
| Storage | `/data` 8.1G, 5.6G used, 2.0G available, 74% | storage.txt |
| UI | 1920×1080; panel is 4K | display.txt; household model |
| Packages | 198 total, 178 system, 20 third-party; disabled list empty | packages-all/system/user/disabled.txt |
| Resolved Home | `com.google.android.tvlauncher/.MainActivity` | home.txt |
| Dream services | Backdrop and `com.android.dreams.basic/.Colors`; no active dream | dream-services.txt; dream-state.txt |

Memory figures describe one instant, not a responsiveness benchmark or promised saving. No firmware-update recommendation follows from the build suffix alone.

### Exact settings to preserve

Values below are strings returned by the original snapshot, with presence checked against fresh post-restart namespace listings. `get` alone cannot distinguish a missing key from a literal `null` string. Sony help exposes `settings list NAMESPACE` and rejects `--user` for list/delete. Confirm `am get-current-user` is 0 and the intended owner context before using these forms; stop on another user or ambiguous context. Record presence separately from value before any later mutation. Do not overwrite a household change made since the snapshot.

| Namespace | Key | Original value / presence |
|---|---|---|
| secure | screensaver_components | `com.google.android.backdrop/.Backdrop` |
| secure | screensaver_default_component | `com.google.android.backdrop/.Backdrop` |
| secure | screensaver_enabled | `1` |
| secure | screensaver_activate_on_sleep | `1` |
| secure | screensaver_activate_on_dock | `1` |
| secure | sleep_timeout | `-1` |
| secure | default_input_method | `com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME` |
| secure | enabled_accessibility_services | absent (`null` reported) |
| secure | accessibility_enabled | `0` |
| system | screen_off_timeout | `3600000` ms |
| global | window_animation_scale | absent (`null` reported) |
| global | transition_animation_scale | absent (`null` reported) |
| global | animator_duration_scale | absent (`null` reported) |
| global | stay_on_while_plugged_in | `0` |
| global | device_idle_constants | present, literal string `null` (fresh listing confirmed) |

### Household preservation

Preserve Netflix, Prime Video, YouTube, Spotify, Disney+, Apple TV, current Max/HBO, Movistar+, Filmin, RTVE, Atresplayer, Crunchyroll, VLC and Chromecast. Preserve other installed apps until use is confirmed. Preserve broadcast TV, HDMI/Inputs and Pi HDMI 1, remote/Bluetooth, audio, keyboard, updates, Google dependencies and DRM. Voice search is unused but this is not authority to disable its dependencies. Any broadcast removal needs significant measured benefit and a separate human decision.

| Package | Installed version | Update date in dump | User-0 state | Disposition |
|---|---|---|---|---|
| com.google.android.tvlauncher | 7.7.15-968255986-f | 2026-08-27 | installed=true; enabled=0 | Stock Home recovery; preserve |
| com.wbd.stream | 7.13.1.2 | 2026-10-09 | installed=true; enabled=0 | Current Max candidate; playback identification pending |
| com.hbo_android_tv | 1.2.16 | 2023-08-18 | installed=true; enabled=0 | Preserve until physical Max identification in later cleanup |
| com.hbo.hbonow | 54.25.0 | 2024-05-31 | installed=true; enabled=0 | Preserve until physical Max identification in later cleanup |
| com.skyshowtime.skyshowtime.google | 7.10.200 | 2026-10-08 | installed=true; enabled=0 | Removal authorized for U3 only |
| com.google.android.katniss | 7.55.87+964183260.01 | 2026-09-18 | installed=true; enabled=0 | Investigate dependencies later; preserve now |
| com.sony.dtv.promos | 4.8.4 | 2026-09-29 | installed=true; enabled=0 | Inspection candidate only |
| tv.samba.ssm | 2.0.16.1_3.0.12.0 | 2023-07-25 | installed=true; enabled=0 | Inspection candidate only |

These values come from the active installed-package section of each package-specific dump; some dumps also contain an older factory/hidden-system section. All listed installed-package User-0 rows also report hidden=false and suspended=false. Empty disabled inventory does not prove every uninspected package has enabled=0. No batch may infer an exact restore state from inventory alone.

## Recovery preparation (documented, not physically rehearsed)

Before a later authorized intervention, save a fresh private change ledger containing: timestamp/timezone, phase and batch, target package/component/key, user ID, installed/hidden/suspended state, exact enabled integer, enabled/disabled component overrides, settings namespace/presence/value, Home resolution, launcher override preferences, intended change, expected benefit, exact restore command and observed result. Inspect user 0 explicitly; never restore from another user's row or a hidden factory-package block. Unknown state or purpose stops that change.

For each changed setting, restore the fresh pre-change value with Sony's documented `settings put --user 0 NAMESPACE KEY VALUE`; when originally absent use `settings delete NAMESPACE KEY` only after confirming the owner/user-0 context, then verify absence with `settings list NAMESPACE`. Sony rejects `--user` on delete/list; do not blindly use generic Android examples. Preserve a present literal `null` value such as device_idle_constants by writing that saved string; do not write `null` for an absent key. Do not assume animation `1.0`, reset a namespace, clear app data, or remove unrelated accessibility services. Escape saved values as shell data. The selected-settings table supplies the original baseline; a fresh ledger protects subsequent household changes.

Per-package/component enabled-state restoration maps as follows:

| Saved integer | Meaning | Restore command after `adb -s 192.168.0.24:5555 shell` |
|---|---|---|
| 0 | default | `pm default-state --user 0 PACKAGE_OR_COMPONENT` |
| 1 | explicitly enabled | `pm enable --user 0 PACKAGE_OR_COMPONENT` |
| 2 | disabled | `pm disable --user 0 PACKAGE_OR_COMPONENT` |
| 3 | disabled for user | `pm disable-user --user 0 PACKAGE_OR_COMPONENT` |
| 4 | disabled until used | `pm disable-until-used --user 0 PACKAGE_OR_COMPONENT` |

Default is distinct from enabled: stock Home's captured package enabled=0 restores with `default-state`, not a blanket `enable`. Its MainActivity has a separate explicit enabled override in the original dump. The dump also records AppLauncher disabled and thirteen enabled component overrides; preserve that full list in the private ledger and never reset components indiscriminately. Restore component overrides separately if changed. A missing package is not an enabled-state case: stop and use its confirmed installation source; account data is not restored by reinstallation. System-package experimentation uses disable-user in its separately authorized phase, never uninstall/root/firmware operations.

If a later launcher trial loses Home, stop that phase. While the TV is free and ADB is available, use the fresh ledger to restore stock launcher/package and component states first, undo only the trial's own override/accessibility changes, then restore Home selection. The known baseline Home target is:

```sh
# Recovery-only examples; not executed during baseline preparation.
adb -s 192.168.0.24:5555 shell pm default-state --user 0 com.google.android.tvlauncher
# Only if this component override was changed: its captured override was enabled.
adb -s 192.168.0.24:5555 shell pm enable --user 0 com.google.android.tvlauncher/.MainActivity
adb -s 192.168.0.24:5555 shell pm set-home-activity --user 0 com.google.android.tvlauncher/.MainActivity
```

Verify Home resolution and physically press Home, Settings and Inputs before removing a trial launcher. The TV's `pm help` exposes `set-home-activity` and `default-state`; the earlier trial demonstrated exact captured package/settings/component restoration and stock Home/Inputs screenshots. Those historical restoration screenshots did not establish physical remote, audio, HDMI/Pi picture or full household recovery. Later human-reported Home/household passes are recorded separately below; they do not establish execution of rollback for the current accepted setup. Do not disable stock Home before the replacement and recovery route work. If ADB is unavailable, use physical controls/default-app UI only when verified accessible; do not promise ADB recovery from a boot loop. Retain the stock launcher and Pi so a failed experiment does not require uninstalling household apps.

Pi fallback: physically open Inputs and select HDMI 1 using the Sony remote. Confirm the existing Haystack image and return to the previous viewing source. HDMI 1 is the documented Pi connection; its label/path and actual picture require physical confirmation. Do not guess an Android TV input ID from HW numbering. If the Pi image is stale, consult the [existing LAN recovery guide](solutions/integration-issues/raspberry-pi-kiosk-hardcoded-mac-ip.md); changing Pi/server/router state is outside U1.

On any later loss of Home, Inputs, remote, keyboard, audio, casting or a preserved app, stop, restore the last changed batch to its recorded states and repeat the failed action. Do not continue disabling packages to troubleshoot. Recovery preparation is not proof of physical rollback.

Android command semantics are documented in [PackageManager shell source](https://android.googlesource.com/platform/frameworks/base/%2B/8517e8d998be/services/core/java/com/android/server/pm/PackageManagerShellCommand.java) and [Settings command source](https://android.googlesource.com/platform/frameworks/base/%2B/c484f54/cmds/settings/src/com/android/commands/settings/SettingsCmd.java). Local Sony help is the compatibility evidence; physical effects remain to be tested. The generic Settings source documents syntax families; the Sony help takes precedence for argument placement and its list/delete limitations.

## Repeatable timing and acceptance protocol

The unverified boundaries below describe U1 automated measurement coverage. Later human-reported functional passes do not supply elapsed timings or retroactively turn those probes into visible-readiness measurements.

Use repeatable automated engineering probes as the default for baseline, U2, each U3 batch and artwork-enabled comparison. Keep the command, destination component, starting activity, network, app versions, Home arrangement, animation state and warm-up method comparable. Record date/time/timezone, device uptime, versions, background playback/downloads and the exact probe definition. Keep the three animation keys absent throughout this comparison. Do not clear caches, force-stop apps or change background limits to manufacture a result.

Where practical, use one unscored warm-up followed by five bounded automated trials per comparable flow. Record every returned metric, its unit, median and maximum, plus timeouts, errors and invalid samples with reasons. Distinguish task reuse from startup and keep incompletely warmed series labelled. Do not silently exclude slow valid results. Host subprocess duration and Android `am -W` WaitTime/TotalTime describe different technical boundaries; none measures physical remote-to-visible latency. TotalTime=0 on task reuse is not instant UI. Unsupported or unreliable probes remain evidence gaps rather than a request for owner stopwatch work.

Observer timing is optional when an observer is already available and willing; it is never an owner prerequisite or launch gate. If collected, keep the remote, seat/distance and visible endpoint consistent, start at the physical button press and stop when the destination visibly accepts the next action. Label these samples separately from automated metrics. No screen recording is authorized by default.

| Flow | Default automated comparison | Optional physical evidence / current gap |
|---|---|---|
| Home | Same direct Home component from the same starting app; report task-reuse/startup metrics | Remote Home press → usable app menu unverified |
| App grid | Same bounded stock app-grid activity probe; verify returned activity where available | Visible grid presentation and remote route unverified |
| Settings | Same Settings intent from Home | Remote route → usable menu unverified |
| Inputs chooser | Same bounded Inputs activity from Home | Physical Inputs button → usable chooser unverified |
| HDMI selection | Record technical source-switch evidence only if a safe, repeatable probe is available in an authorized phase; keep chooser metrics separate | Selection → stable picture/audio unverified; Andres reports this is slow |
| Netflix | Same resolved activity and starting Home state; separate warm and post-restart samples | Content readiness and playback unverified |
| Current Max | Same resolved candidate activity and starting Home state | Household app identity, content readiness and playback unverified |
| D-pad | Bounded key-delivery probe only where reliable; record exact sequence and timeouts | Ten corresponding visible focus responses unverified; delivery alone is insufficient |

Activity launch, app landing and first playback are separate boundaries. Record playback/audio, physical Home/Back/Inputs, keyboard, Chromecast start/stop, broadcast and Pi HDMI 1 observations when available during authorized checks, without changing accounts or publishing search text. These remain explicit evidence gaps until observed; do not make their collection an owner questionnaire or a prerequisite for independent U1 preparation. Preserved-app and Chromecast functionality remain mandatory product outcomes. ADB activity success or Cast discovery cannot establish playback, actual casting or visible responsiveness.

Andres explicitly requested practical speed improvements on 18 October, especially Home navigation, launches of household apps, Chromecast and HDMI input selection, without stopwatch work or choosing numeric targets. Use the same engineering probes before/after each intervention, report median/maximum, and investigate regressions separately from improvements. Human-only observations are evidence gaps, not an owner questionnaire or a timing-target gate. Ad removal and RAM reduction alone do not close R1; activity timings cannot establish visible responsiveness.

Keep automated post-restart and standby/wake probes separate from warm results, using explicit technical endpoints such as boot completion, resolved Home and first activity launch. Visible Home readiness and remote/input/audio recovery may be added as optional observer evidence when available; never infer them from technical endpoints. Do not mix cold, post-restart or wake numbers into warm medians. Restart and standby are different checks; unsupported or unfinished checks remain labelled gaps, with no owner stopwatch prerequisite.

## Automated U1 session: 18 October, from 08:52 Madrid

ADB reconnected successfully. The first Home `am start -W` timed out after 18 seconds; it is an invalid sample and is excluded from timing summaries. Subsequent bounded activity probes succeeded. These direct activity invocations bypass physical remote and tile-selection paths and often reuse existing tasks. They establish a repeatable Android diagnostic baseline, not visual readiness, playback or a speed improvement.

Each row below has five samples in milliseconds. Settings/Home and Netflix/Max were alternated with one-second pauses; Netflix/Max trial 0 was an unscored prime. App-grid and Inputs have five direct-activity probes without a separate prime, so their first sample is retained and is not claimed as a fully warmed series. All are Android `WaitTime`, including lifecycle/task handling; none is stopwatch or host subprocess duration.

| Direct activity path | Five WaitTime samples (ms) | Median | Maximum |
|---|---|---|---|
| Settings | 349, 233, 204, 207, 202 | 207 | 349 |
| Home from Settings | 40, 36, 39, 38, 38 | 38 | 40 |
| Netflix | 151, 199, 139, 193, 107 | 151 | 199 |
| Home from Netflix | 70, 466, 458, 458, 607 | 458 | 607 |
| Current Max candidate | 117, 261, 187, 168, 195 | 187 | 261 |
| Home from Max | 425, 451, 422, 416, 451 | 425 | 451 |
| Stock app-grid activity | 133, 66, 71, 76, 80 | 76 | 133 |
| Stock Inputs activity | 383, 160, 147, 193, 151 | 160 | 383 |

Corresponding TotalTime medians/maxima: Settings 191/292 ms; Home-from-Settings 0/0; Netflix 57/154; Home-from-Netflix 409/558; Max 173/233; Home-from-Max 378/410. Task reuse produces zero startup times and is not proof of an instant menu. App-grid responses did not name an Activity, and Home afterward reported an already-top instance; visible grid presentation is unconfirmed. The Inputs activity reports Android success but no HDMI source was selected.

The ten-key probe intended RIGHT×5 then LEFT×5 at one-second pauses. Its first RIGHT `input keyevent` command timed out at three seconds, so the sequence aborted. A key may have been delivered despite host timeout; no successful traversal, focus response or latency is claimed. No screen was captured or recorded. The private pre-probe gfxinfo snapshot is cumulative and not an isolated navigation benchmark.

An authorized restart succeeded: the kernel boot ID changed and `sys.boot_completed=1` was observed about 64.7 host seconds after the restart request, with eight-second polling plus bounded connection attempts. This is a sampled upper bound for that technical check, not restart-to-visible-Home. Post-restart Home resolved to the stock component and a direct activity call succeeded. Standby/wake and physical restart readiness remain unverified. Fresh post-restart settings listings preserve all 15 selected settings' reported values; they additionally establish that device_idle_constants is present as literal `null`, while the three animation keys and enabled_accessibility_services are absent. No setting writes occurred.

| Preserved service | Installed package / launch mapping |
|---|---|
| Netflix | `com.netflix.ninja/.MainActivity` |
| Prime Video | `com.amazon.amazonvideo.livingroom/com.amazon.ignition.IgnitionActivity` |
| YouTube | `com.google.android.youtube.tv/com.google.android.apps.youtube.tv.activity.ShellActivity` |
| Spotify | `com.spotify.tv.android/.SpotifyTVActivity` |
| Disney+ | `com.disney.disneyplus/com.bamtechmedia.dominguez.main.MainActivity` |
| Apple TV | `com.apple.atve.androidtv.appletv/.MainActivity` |
| Current Max candidate | `com.wbd.stream/com.wbd.beam.BeamActivity` |
| Movistar+ | `com.movistarplus.androidtv/.MainActivity` |
| Filmin | `com.filmin.androidtv/.MainActivity` |
| RTVE | `com.rtve.androidtv/.Activity.SplashActivity` |
| Atresplayer | `com.antena3.atresplayer.tv/.ui.splash.SplashActivity` |
| Crunchyroll | `com.crunchyroll.crunchyroid/.splash.ui.SplashActivity` |
| VLC | `org.videolan.vlc/.StartActivity` |
| Chromecast receiver | `com.google.android.apps.mediashell`; no Leanback launch activity, as expected for a receiver; actual casting untested |

Resolution is not a launch/playback check. Netflix and Max received five warm probes; the other eleven household apps also received one direct-activity launch after restart, each with Android Status: ok. Those single startup samples are not comparable warm medians. Initial guesses for Movistar+/Filmin/RTVE/Atresplayer resolved no activity; the table uses corrected installed package IDs confirmed by resolution. Preserve both legacy HBO packages unchanged. Local raw results live in ignored `tv-local/20261018-u1/`; publish only this reviewed summary.

### Additional post-restart launch and discovery evidence

| App | Single Android WaitTime (ms) |
|---|---|
| Prime Video | 919 |
| YouTube | 1,564 |
| Spotify | 3,145 |
| Disney+ | 2,204 |
| Apple TV | 3,920 |
| Crunchyroll | 8,187 |
| VLC | 2,249 |
| Movistar+ | 7,140 |
| Filmin | 5,159 |
| RTVE | 4,351 |
| Atresplayer | 7,379 |

Each was followed by a direct return to stock Home. These are sequential first probes after reboot with different app lifecycle/network work; they are diagnostic startup evidence, not proof of content readiness, login, playback or speed improvement. Future comparisons must repeat the same method and separate these from warmed results. Home's Android WaitTime after Filmin reached 2,381 ms in this sequence; this is a useful path to investigate during a later authorized performance trial, not a cause diagnosis.

Passive mDNS browsing discovered a BRAVIA `_googlecast._tcp` advertisement. Receiver package inventory was retained privately. This proves advertisement on the LAN, not that a sender can start/stop a cast or play protected content. No cast was initiated. The second bounded RIGHT-key delivery attempt also timed out after twelve seconds; no further keys, standby or wake tests followed. Passive input diagnostics were saved privately without capturing the screen.

At session close the package-ID set still matched the original 198-package inventory. ADB was explicitly disconnected; TV-side debugging-off status remains unconfirmed. Neither remote input timeout nor host disconnect proves a TV setting change or rollback. No packages/settings were altered by the agent; no app/data restore was attempted.

## Historical U1 acceptance ledger and next-session notes

This ledger records the earlier U1/withdrawn-trial evidence gaps. The current accepted Home and household passes are recorded separately at the end; these old unchecked boxes do not revoke them.

- [x] Original private configuration snapshot read; stock Home, selected settings and selected installed package states documented.
- [x] Household preservation and U3-only removal scope recorded.
- [x] `tv-local/` excluded before local follow-up evidence creation.
- [x] Available bounded automated baseline samples, median/maximum and probe limitations recorded.
- [ ] Optional observer evidence: visible latency and ten-key focus responses remain unverified; no owner timing task or preparation gate.
- [x] Engineer-selected repeatable comparison method documented; no owner timing-target selection required.
- [ ] Netflix/current-Max playback, physical remote/Back/Home, keyboard, volume/audio confirmed.
- [ ] Chromecast start/stop, broadcast, Inputs and Pi HDMI 1 confirmed.
- [x] Automated reboot completion and post-restart Home evidence recorded separately.
- [x] Stock technical standby/wake observed during the restored U2 attempt: Asleep → Awake/display ON.
- [ ] Physical remote/audio/recovery readiness remains unverified; not inferred from technical power states.
- [x] Host ADB disconnected at session close.
- [ ] TV-side debugging disabled by Andres when finished (unconfirmed).

U1 automated preparation may be assessed independently; the unchecked physical acceptance items remain unverified and must not be described as passed. Next live work needs an explicitly free-TV session. Physical observations remain unverified until available; do not require Andres to select timing targets or perform stopwatch trials. Andres additionally reports slow HDMI channel selection and requests improvement. Track chooser opening and source-to-stable-picture/audio separately, preserving HDMI 1/Pi and broadcast; do not infer switching latency from InputsPanelActivity timing. No U2 installation or setting change follows automatically from U1 preparation.

Repository verification uses snapshot comparison, private-file boundary checks and diff hygiene. Application build, unit tests and lint are deliberately not run for this documentation/ignore-only change; they cannot verify TV behavior. Generation, credentials, scheduler, providers, server, Pi and daily-story/public-note behavior are untouched.

## Historical U2 preparation: withdrawn Projectivy launcher trial

**Preparation snapshot from 18 October 2026, before the live attempt below; not an acceptance claim.** At preparation time the TV was in use. That preparation made no ADB connection or TV action and changed no Haystack/Pi/router state. The subsequently authorized live attempt is recorded below. Preparation can be complete independently of installation and physical acceptance; the preservation outcomes remain mandatory.

### Official package and compatibility evidence

The [developer repository](https://github.com/spocky/miproja1) directs manual downloads to its own releases. The [official latest-release API](https://api.github.com/repos/spocky/miproja1/releases/latest) selected the stable [4.72 release](https://github.com/spocky/miproja1/releases/tag/4.72), published 3 October 2026 at 16:23:50 UTC, with prerelease=false and draft=false. This repository is a configuration/release/support repository, not a reproducible source build of the launcher.

| Locally checked item | Result |
|---|---|
| Release asset | `ProjectivyLauncher-4.72-c97-xda-release.apk`, 11,432,750 bytes |
| Download origin | Developer's GitHub release asset, not an APK mirror |
| APK SHA-256 | `a312935837b7cf323880455c322f4c98060e3e37e8c6187963fb2c4764534aae` |
| Integrity | Downloaded size and SHA-256 match the official release API; unchanged after inspection |
| Package / version | `com.spocky.projengmenu`, versionName `4.72`, versionCode `97` |
| Manifest SDK | minSdkVersion 23 (Android 6), targetSdkVersion 37; no maxSdkVersion |
| Native code | Includes `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64` |
| Device match | Saved Sony CPU snapshot reports ARMv7; API 28 exceeds manifest minimum 23 |
| TV feature | Leanback required; touchscreen and Wi-Fi hardware optional in manifest; Ethernet is not excluded |
| Home activity | `com.spocky.projengmenu/.ui.home.MainActivity`; exported and enabled; MAIN/HOME/DEFAULT and Leanback entry present |
| Signer certificate SHA-256 | `f6697bf4082ee97511e4de07863193884a015b7ab5860430321bda1042b0aadd` |
| Android 9 signature check | Official Android build-tools 36.0.0 `apksigner verify --verbose --print-certs --min-sdk-version 28 --max-sdk-version 28` exits 0; APK Signature Scheme v2 verifies; one RSA-2048 signer |
| Broader signature check | Default `apksigner verify --verbose --print-certs` exits 0; v1 and v2 verify; warns about unsigned META-INF entries in JAR signing |

Manifest parsing used Androguard 4.1.4 in a local isolated Python environment. Signature verification used Google's official build-tools JAR and a portable local Temurin runtime, not a system Java installation. Tool archives matched their upstream published checksums before extraction. No APK code was run on the Mac. There is no v3/v4 signature or verified SourceStamp in the verifier report. The GitHub commit's Verified badge is separate from APK signing. Matching the release hash and verifying the embedded signer establish this artifact's integrity/provenance chain; they are not a malware audit or an independent out-of-band authentication of the developer's signing key. The Google Play build's certificate was not obtained or compared.

These checks establish an Android-9/ARMv7-compatible installation candidate, not successful operation on this Sony. Keep APK, tools, API metadata, decoded manifest/resources and verifier reports in ignored `tv-local/20261018-u2/`; none belongs in Git. If the asset changes before installation, recheck size, digest, manifest and signatures rather than trusting the filename. An alternative [official Google Play listing](https://play.google.com/store/apps/details?id=com.spocky.projengmenu) exists, but record the actually delivered version and signature if choosing that route; do not assume it is byte-identical to this APK.

### Permissions and initial configuration

The manifest requests network state/Internet, boot completion, wake/foreground execution, Android media/storage access, TV listings/EPG, launcher shortcuts, package-install/delete requests, billing, install-referrer and advertising/attribution identifiers. A permission declaration is not proof that it is granted or used. READ_EXTERNAL_STORAGE is capped at API 32; the newer media/advertising permission names do not establish an Android-9 grant. Manifest analytics/crash/performance collection defaults are false, but this is not a network-traffic audit.

The optional services are `com.spocky.projengmenu.services.ProjectivyAccessibilityService` (system binding requires BIND_ACCESSIBILITY_SERVICE) and the notification-listener service. Those service binding permissions do not grant the app accessibility or notification access. Keep both user grants off initially. Do not use `adb install -g`, grant-all scripts, unknown-app installation permission, root, device-admin, secure-settings grants or package disable lists. Do not enter the launcher's engineering/root/firmware tools. Static app rows do not justify enabling these capabilities.

Use this minimal proposed layout; it is a trial specification, not an imported Projectivy backup or a claim that these settings were applied:

| Visible area | Initial contents |
|---|---|
| First app row | Netflix, Prime Video, YouTube, current Max candidate, Disney+, Apple TV |
| Second app row | Spotify, Movistar+, Filmin, RTVE, Atresplayer, Crunchyroll, VLC |
| System controls | Keep Settings, Inputs and the full Applications panel reachable; retain physical remote shortcuts |
| Background | Static built-in/default image if available without purchase; otherwise `Launcher wallpaper` → `None` for a static control background |
| Content rows | Hide recommendation/promotional/content channels inside Projectivy; keep only app rows for the first comparison |
| Optional automation | Off: launcher override/accessibility, notification access, remote remapping, boot app/HDMI actions, CEC/power automation, ambient-mode shortcuts and wallpaper plugins |

Use the package mapping in the U1 table for shortcuts. Keep both legacy HBO packages installed and available in the full Applications panel until household identification in U3. Hiding launcher content rows does not mean disabling the broadcast tuner, uninstalling apps or hiding access to household functions. Leave Android animation, sleep, screensaver and global system settings unchanged. Prefer default icons and layout sizes; do not add animated icons, video, changing Reddit/program artwork, custom providers or Haystack URLs during the trial. A static control background isolates launcher performance; custom Haystack art belongs to later phases.

Exact labels found in the inspected APK's English/Spanish resources include `Change default launcher` / `Cambiar launcher por defecto`, `Override current launcher` / `Reemplazar el launcher actual`, `Launcher wallpaper` / `Fondo de pantalla del launcher`, and category `Visible`. Use the settings sections labelled `General` and `Appearance` to locate the relevant options, and category editing to set visibility/order. These labels are verified resources, not a physically checked Sony menu path or proof that every option is free. Record actual screen paths during the live trial instead of inventing a click sequence.

The [developer's Play description](https://play.google.com/store/apps/details?id=com.spocky.projengmenu) identifies custom wallpaper and advanced icon customization as Premium features and describes accessibility as optional. The [developer's external Premium page](https://premium.projectivylauncher.com/) currently displays **€6.99**; release 4.72 supports an external licence in the GitHub build. The localized Play purchase price, tax/checkout terms and device allowance were not verified. No purchase is needed or authorized for the initial app-menu/static-control trial. If a requested static-image choice is paywalled, keep the static control background and record the gap; do not buy Premium or claim custom wallpaper is enabled.

### Historical routing and recovery preparation

The withdrawn recipe proposed opening Projectivy as an ordinary app, testing supported Home selection, then separately considering its accessibility override. Those instructions are no longer active and their executable installation/settings snippets have been removed. The actual trial below is the authoritative record of what ran and what was restored.

The inspected APK, signature and permission evidence above remain historical facts, not a reason to resume the candidate. No paid wallpaper option was purchased, no accessibility/notification grant was applied, and there is no accepted replacement Home.

## Historical U2 live attempt and stock restoration — 18 October 2026

**Outcome: blocked, restored, not complete.** The free-TV authorization covered the live U2 trial; it did not authorize U3 cleanup, a purchase or stock-launcher disabling. ADB connected without a new physical authorization prompt. Fresh user-0 Home/package and full secure/system/global namespace snapshots were captured before installation. Private logs, focused screenshots and the mutation ledger are in ignored `tv-local/20261018-u2-live/`; no account/profile imagery, raw dumps or binaries are committed.

### What was actually established

- The verified 4.72/code97 APK installed successfully as a new package. Projectivy onboarding completed and a screenshot showed its ordinary Home activity with app/input/content rows and the default background. This was not a configured app-only/static-background trial or a default-Home acceptance result.
- The supported `pm set-home-activity` call reported Success for Projectivy, but an immediate HOME resolution and an unqualified HOME launch still selected `com.google.android.tvlauncher/.MainActivity`. The setter was restored to the stock component. Sony resolved HOME_SETTINGS to its EmptyStubActivity, so no usable default-Home chooser was established.
- Projectivy's settings sidepanel was present in window diagnostics and UI text. Repeated bounded settings-navigation attempts could not reliably enter and control the intended preferences: UIAutomation sometimes returned a null/underlying root, and injected events reached Sony TVX. The desired app rows/static background/override settings were not confirmed or accepted. Blind injection was stopped.
- The settings window had the observed `LOCAL_FOCUS_MODE` flag. Android's [window API documentation](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_LOCAL_FOCUS_MODE) explains that such windows can use local input independently of ordinary window-manager dispatch. This is a possible automation limitation, not proof of physical-remote incompatibility or a 4.72 regression. Local APK inspection found no direct assignment of that flag and no mandatory missing extras for AppSettingsActivity.
- Official 4.71 was inspected locally as a possible comparison: its release digest/signature matched, but SDK targets and sidepanel styles did not provide evidence for a focus fix. It was not installed. No downgrade, patched APK, root, launcher-manager app, stock disable, accessibility/notification grant or broad permission grant was used.

The first ordinary Projectivy launch reported Android WaitTime 5,438 ms including onboarding; the attempted unqualified HOME launch after the ineffective setter reported 873 ms for the stock launcher. These are lifecycle diagnostics, not visible navigation timings. No accepted replacement Home exists to compare against U1's five-sample Home/app-launch baseline. The restored stock Inputs invocation reported one WaitTime sample of 603 ms; this post-wake/recovery sample is not comparable to U1's warmed median of 160 ms and does not establish an improvement or regression. HDMI selection-to-picture/audio latency was not measured.

### Actual Cast attempt, without a playback claim

A Mac sender used the existing BRAVIA receiver with a temporary LAN HTTP server serving only an owned, generated non-DRM color-pattern MP4 and quiet tone. The receiver connection and Default Media Receiver application were established, but both sampled media states remained IDLE at time zero, the fixture server received no media GET, and pause/stop requests timed out. A focused screenshot was black; no successful video/audio rendering or actual casting playback is claimed.

Actual casting playback had never been verified in the original baseline, so this failure does **not** establish that Projectivy broke casting. No cast, network or receiver setting was changed to troubleshoot it. Explicit receiver quit then returned successfully; a fresh receiver status had app_id=None, session_id=None and no namespaces. The sender disconnected and its temporary server closed. No fixture server or Cast test session was left running.

### Mutations and exact restoration evidence

| Attempt / incidental effect | Restoration and observed proof |
|---|---|
| First-install Projectivy 4.72; ordinary app/onboarding/navigation | Newly installed package uninstalled with Success. Final package list exactly matches all 198 IDs from this session's fresh baseline; Projectivy `pm path` is empty. |
| Preferred-Home setter attempted for Projectivy | Setter restored to stock; HOME resolves to stock, HOME launch and final window focus identify its MainActivity. Focused screenshots show usable stock Home and the Inputs chooser with Channels/HDMI 1–4 entries. |
| UIAutomation inserted system.user_rotation=`0` where absent | Restored absence with Sony-supported `settings delete system user_rotation` in confirmed user-0 context. Final full namespace comparison is exact, including presence/literal values. |
| Cast receiver/test fixture | Explicit quit verified no receiver app/session; sender and temporary fixture server closed. No successful playback or physical sound claim. |
| Stock standby/wake recovery check | Sleep key produced mWakefulness=Asleep; wake key recovered Awake/display ON. Stock Home screenshot followed. This is technical stock recovery, not replacement-Home restart/wake persistence or physical remote/audio proof. |

After restoring the incidental rotation key, **all** captured namespace entries matched the fresh pre-install baseline: 99 secure, 47 system and 141 global keys, with no presence/value differences. This includes accessibility_enabled=`0`, absent enabled_accessibility_services and the original animation/idle values. No notification-access grant changed. Stock package user-0 enabled state remained `0` (default), its thirteen explicit enabled-component overrides and one disabled AppLauncher override matched exactly. The final disabled-package inventory is empty. No unrelated package install/uninstall/disable was performed; per-package grants for all 198 apps were not independently snapshotted, so namespace/package comparisons are not a full account/app-data backup claim.

Own temporary screenshot/XML files on the TV were removed after saving the evidence privately. Final screen is the **stock Home**, power is **Awake / display ON**, and no external HDMI picture is being claimed from that Home screen. A separate device screenshot confirms the Inputs chooser is available; HDMI/Pi picture/audio acceptance is still unverified. The remembered input/session diagnostics are retained privately rather than guessed from HW numbering. ADB disconnected at 10:41:58 Europe/Madrid. TV-side debugging-off remains unconfirmed; host disconnect does not disable it.

### Revised next step and remaining acceptance

Do not reinstall Projectivy or resume its settings trial without a new explicit live-phase decision. The agreed planning direction is Projectivy-free-first with a separate native screensaver. The next handoff is U2 local preparation only: recheck package evidence, prepare an explicit non-repetitive routing proposal and signed dream fixture without connecting to the TV. A later new free-TV authorization is required for either live capability gate; no custom launcher or separate fullscreen viewer is proposed. Dynamic Home art is deferred. The previous oracle review of a three-surface custom client does not endorse this changed architecture. No live changes are authorized by the planning revision.

Existing baseline and restore evidence can be reused, but refresh exact state before a future authorized trial. Clean default Home/Back, used apps, restart and standby/wake persistence, actual DRM/casting/audio/remote/keyboard operation and HDMI/Pi picture/latency remain unaccepted. Casting playback needs a successful current baseline before a later failure can be called a regression. U2 is unchecked; restoration success does not satisfy its product requirements. U3 and artwork work remain unstarted.


## U2 local preparation record — 18 October 2026

This is the preparation-time record before the separately authorized manual Home trial. The accepted Home/setup evidence later in this document supersedes its pending Home and free-control checks. The final Sony capability record supersedes the historical pending dream/timer sheet below; it preserves the separate U4/U6 boundaries.

This section supersedes the historical trial recipe. Its scope is local package rechecking, a routing decision, the independent static DreamService fixture and a future live test sheet. No ADB connection, TV action, installation, permission grant, purchase, network/Cast trial, Haystack server change or Pi/router change is authorized by this preparation. There is no new accepted Home or Sony dream result. Dynamic Home artwork is deferred; no custom launcher, HomeActivity, app catalog or standalone ArtActivity is proposed. FLauncher remains a separately considered alternative, not an automatic fallback installation.

### Rechecked candidate and exact free-control checks

The [official latest-release API](https://api.github.com/repos/spocky/miproja1/releases/latest) was rechecked during this local preparation: stable release remains [4.72](https://github.com/spocky/miproja1/releases/tag/4.72), published 3 October 2026, with neither draft nor prerelease set. The saved APK still matches the API's 11,432,750-byte size and SHA-256 `a312935837b7cf323880455c322f4c98060e3e37e8c6187963fb2c4764534aae`. A fresh local API-28 `apksigner` verification exits 0 with v2 verified and signer SHA-256 `f6697bf4082ee97511e4de07863193884a015b7ab5860430321bda1042b0aadd`. The historical manifest compatibility findings remain unchanged; no APK was installed or executed during this recheck. Keep binaries and raw inspection evidence in ignored `tv-local/`.

The controls below are exact resource labels from that APK, not verified Sony click paths or proof of free-tier entitlement. Locate them through the visible settings using the physical remote in a separately authorized session; record actual paths, values, any paywall and persistence. The [developer listing](https://play.google.com/store/apps/details?id=com.spocky.projengmenu) advertises categories and input shortcuts, and identifies custom wallpapers/advanced icons as premium. It does not establish that every required combination below is free. No purchase is permitted.

| Candidate control | Exact English / Spanish resource label | Required future observation |
|---|---|---|
| App rows | `Edit categories` / `Editar categorías`; `Manage apps` / `Gestionar aplicaciones`; `Visible` / `Visible` | After Home proof, retain app-only rows covering all 13 household apps using the recorded package mapping; preserve all-app access, including both legacy HBO packages until U3 identification. |
| Content rows | `Edit channels` / `Editar Canales`; `Categories / Channels` / `Categorías / Canales` | Hide recommendation/content categories inside the launcher. Do not disable the Sony tuner, shared TV services or broadcast access. |
| Background | `Appearance` / `Apariencia` → `Launcher wallpaper` / `Fondo de pantalla del launcher`; choices `Default wallpaper` / `Fondo de pantalla predefinido`, `None` / `Nada` | Use the free built-in default if static, or None for a plain background. Verify actual behavior; no folder, custom image, Reddit, program art, plugin or animated source. A required control behind a paywall fails the free candidate check. |
| Inputs | `Input sources popup` / `Ventana emergente de fuentes de entrada`; `HDMI 1` through `HDMI 4` | Preserve the physical Inputs route, Settings and broadcast. Check any proposed input shortcuts against physically identified sources; resource labels do not map Sony hardware IDs. Pi remains on HDMI 1. Do not enable boot-input, CEC or power automation. |
| Usage opt-out | `General` / `General`; `Enable anonymous usage reports` / `Habilitar informes de uso anónimo` | Set OFF and verify it remains OFF after reopening settings and later restart/wake. |
| Crash opt-out | `Enable anonymous crash reports` / `Habilitar informes de error anónimos` | Set OFF and verify persistence separately from usage reporting. |
| Routing controls | `Change default launcher` / `Cambiar launcher por defecto`; `Override current launcher` / `Reemplazar el launcher actual` | The first has no newly established working Sony route; the second stays OFF without a separate accessibility-trial authorization. Neither is an acceptance result. |

The [developer privacy policy](https://spocky.github.io/apps-privacy-policy/) describes Firebase usage/crash reporting and settings opt-outs. Manifest defaults of false and visible OFF preferences are configuration evidence only; neither proves absence of network tracking. Notification access, accessibility, remote remapping, boot actions and engineering/root tools remain unused in the ordinary-app/free-control proposal. Manufacturer telemetry work belongs to U3, not this table.

### Home routing: current blocker and one permission proposal

**No new supported Home route is established under the current permission boundary.** The saved supported setter returned Success yet HOME still resolved/launched stock; the Sony HOME_SETTINGS resolver was `com.android.tv.settings/com.sony.dtv.settings.EmptyStubActivity`. Reinstalling Projectivy to repeat that setter or launch that stub is not a new hypothesis. A direct Projectivy activity launch proves ordinary-app access only. Skip both known ineffective attempts unless genuinely new device or platform evidence changes their premise. Leave stock Home enabled and report Home acceptance as blocked under the present boundary; an unrelated launcher swap would not establish a bypass.

The single concrete next routing proposal, requiring a **separate explicit permission decision**, is a bounded test of Projectivy's own `Override current launcher` with only its known accessibility service `com.spocky.projengmenu/com.spocky.projengmenu.services.ProjectivyAccessibilityService` enabled through the normal accessibility settings. The intended configuration intercepts returns to stock Home and opens Projectivy; all remote remapping, volume changes, notification access, boot actions and stock disabling stay off. This is a proposed escalation, not a supported-default-Home claim or authority to execute it.

The inspected service is exported/enabled and protected by `android.permission.BIND_ACCESSIBILITY_SERVICE`. Its accessibility metadata declares `canRetrieveWindowContent=true` and `canRequestFilterKeyEvents=true`. Consequently, enabling it grants broader window/key capability than Home alone; a Home-only configuration does **not** make the system permission technically Home-only. The saved evidence does not establish a separately packaged narrow Home-only service. Present this exact capability and intended use with the authorization request; do not describe the existing service as a narrowly scoped permission. If that permission is unacceptable, leave the Home branch blocked rather than building a new remapper or disabling stock.

If authorized later, first confirm physical settings control works, capture the fresh accessibility-service list and override value, then test ordinary Home/Back and app task returns. Any stock-ad flash, routing loop, broken key, input/audio/keyboard/app/Cast regression or expired experiment budget fails this route and triggers restoration. Revert only this trial's override/service changes while preserving any pre-existing services; verify stock Home and controls before uninstalling its trial package. This permission trial needs its own explicit scope and budget; it is not an automatic extension of U2's 30 minutes.

### Future live sheet: independent Home and dream results

No row below is executable authority. A new free-TV authorization must identify the exact live branch and any separately approved permission scope. The combined active U2 compatibility experiment is capped at **30 minutes total**, plus whatever restoration is necessary. Record elapsed time across both branches; do not allocate 30 minutes to each. Stop experimentation at the cap and restore incomplete/failed changes. Do not use remaining preparation time as permission to contact the TV.

| Checkpoint | Required evidence and decision |
|---|---|
| Before mutation | Refresh user/owner context, Home resolution, installed trial-package state, full setting presence/values and affected component states. Capture selected/default dream and accessibility state. Confirm the prior viewing source privately, physical stock Home/Settings/Inputs access and actual current casting playback baseline if comparing a later Cast failure. Reuse U1 package mappings, not stale restore values. |
| Ordinary launcher | Only if included in the new authorization: install the verified candidate normally, without grant-all, and open it as an app. Establish physical D-pad/settings control; the earlier injection failure does not prove a physical remote failure. Keep optional grants off. Stop if controls are unreliable. |
| Home branch | Current no-grant route is blocked as above; do not repeat known failures. If new supported-route evidence or the precisely authorized permission trial permits a real test, verify HOME resolution as applicable, physical Home/Back, app exit paths and no sponsored flashes. Record restart/wake as separate pending checks if omitted. Ordinary launch or setter Success is insufficient. |
| Free configuration | Only after accepted Home proof, verify the candidate controls above, all 13 app shortcuts, full app access, Settings/Inputs, usage/crash OFF and persistence. No unlock, custom art or unrelated package cleanup. |
| Dream branch | Independently install only the locally built/signed static fixture if authorized. Use Sony's normal screensaver UI: record whether Haystack is selectable and whether selection persists. A preview may verify image presentation/remote exit from preview, but record it only as preview. No secure-settings grant, forced idle or power-policy change. Home failure does not invalidate this separate check. |
| Hardware/performance | Preserve broadcast, Bluetooth remote, volume, keyboard and actual used-app playback/audio. Measure Inputs-button-to-usable-chooser separately from source-confirmation-to-stable-picture/audio, with matching initial source, target, signal and warm-up. Confirm HDMI 1 still shows Pi picture/audio and return to the prior source. Five comparable probes when practical; otherwise retain a visible-timing gap. Never derive switching speed from InputsPanelActivity WaitTime or promise a launcher will fix HDMI negotiation. |
| Close or restore | Restore rejected/incomplete trial installs, exact setting presence/values and component states using the fresh ledger. Re-select the original dream if changed, verify Home/Settings/Inputs and required physical functions, remove only trial-owned packages, end any own test sessions and disconnect. Keep necessary restoration outside the experiment cap; never stop halfway because the cap expired. |

The original baseline has `system.screen_off_timeout=3600000` (one hour), secure `sleep_timeout=-1`, and Backdrop selected/default. These values do not prove Sony's actual dream-entry delay. Under unchanged policy, a 30-minute active experiment cannot establish a one-hour idle observation. If still true after the fresh read, leave natural entry pending and propose a **separately authorized observation window of at least 75 minutes**, extended only by a further decision if Sony has not entered the dream. Record the actual idle context, last interaction, natural entry and physical remote exit to usable controls. No timed key injection, forced dream preview, HDMI auto-switch, timer shortening or screen/power setting change can stand in for natural entry.

Selection, preview, natural idle entry, remote exit and restart/wake persistence are separate ledger entries. Natural entry **and** remote exit with the fixture are required before U4 networking/cache work; selection or preview alone does not open that gate. Test first in an idle Android Home context with no playback; this establishes no claim about universal HDMI idle or playback protection. Any later playback-protection test belongs to its authorized scope. Preserve the successful result of either branch while reporting the other's limitation; neither branch substitutes for the other.

### Local fixture evidence boundary

The new [`android-tv/` fixture](../android-tv/README.md) is a minimal native Java DreamService, minSdk 28 / targetSdk 35. Its original static vector art has no external asset licence or generation dependency. The package has one framework-permission-protected exported service and dream metadata, no activity or requested permissions, and no network, cache, analytics, billing, receiver, scheduler or foreground service. Fullscreen noninteractive presentation uses framework input dismissal and preserves artwork aspect ratio; it does not override brightness.

Local toolchain: portable Temurin JDK 17, checksum-pinned Gradle 8.11.1 wrapper, AGP 8.9.2, SDK platform 35 / Build Tools 35.0.0. SDKs, generated APKs and raw logs/screenshots stay in ignored local storage. The stable RSA-3072 update key and password are outside Git under the preparation Mac's private Haystack signing directory; the README records recovery/build instructions and public certificate SHA-256 `b53cfddf0d9cc37f70f8481e96d818ef2255d4c73dd456957f27cc39392ffd55`. Reuse that key for updates; the public fingerprint cannot recover it.

| Local check | Actual outcome |
|---|---|
| Debug and signed release builds | `:app:assembleDebug :app:assembleRelease` passed. Signed release is about 11 KB. |
| API 28 and API 35 JVM tests | Four Robolectric checks passed: protected service/metadata discovery with no activity/requested permissions, and actual vector rendering across landscape/portrait bounds. Rendering first failed with a blank placeholder on both API levels, then passed with the completed art. |
| Android lint | `:app:lint` passed with zero errors. Three warnings remain: two newer test-library versions are available, and the stateless fixture uses `allowBackup=false` without Android-12 extraction rules. No app data is written. The no-launcher lint exception is explicit and scoped; no activity was added to satisfy a launcher-app assumption. |
| API 28 signature | `apksigner verify --min-sdk-version 28 --max-sdk-version 28 --verbose --print-certs` exited 0, v2 verified, public signer matches the fingerprint above. |
| Local ARM64 Android TV API 31 instrumentation | `:app:connectedDebugAndroidTest` passed one installed-package discovery/protection test on explicitly selected `emulator-5580` after verifying `ro.kernel.qemu=1`. An initial differently signed release/debug conflict was resolved by removing the fixture from that disposable emulator; no TV action occurred. |
| Local ARM64 Android TV API 31 smoke | Signed release installed on the explicitly selected local emulator. Framework forced dream entry identified the Haystack service; a 1920×1080 screenshot showed the intended artwork, and D-pad center dismissed it with current dream returning to null. This is preview/input smoke only. |

The official API-28 Android TV system image is x86-only, so this Apple Silicon Mac uses API-31 ARM64 for actual framework runtime checks and API-28 JVM resource/manifest/render coverage. It is not an Android-9 Sony runtime test. The final combined debug/release/unit/lint/instrumentation run passed after comment-only simplification. No TV connection or installation happened. No Sony service-selection, natural-idle, physical-remote, restart/wake or playback result is implied. U4 refresh/cache and U6 full delivery/playback verification remain deferred behind their gates.


## Accepted Home and manual setup — 18 October 2026

**Source and evidence type:** Andrés's physical observations and explicit confirmation in the parent chat, relayed to this implementer on 18 October 2026. These are accepted human-reported passes, not automated observations or a request to repeat the checks. The source is parent chat `01a14da5-d80c-7773-8251-f866efd4e1c2`; the owner confirmed that he had completed every item in the quoted manual setup/household-check list.

| Check | Current accepted evidence |
|---|---|
| Settings → physical Home | In response to the explicit clean-return/no-stock-sponsored-flash question, Andrés reported: “Projectivy opens cleanly.” |
| Netflix → physical Back/Exit | In response to opening Netflix and exiting it with Back/Exit, Andrés reported: “Returns cleanly to Projectivy.” |
| Free launcher setup | Andrés explicitly confirmed Projectivy free setup covering all 13 household apps, Settings/Inputs access and hiding unwanted content rows. This confirms the reported required setup; individual preference values not reported separately are not invented. |
| Responsiveness | Andrés describes Projectivy as “blisteringly fast”, exactly what he wanted, and says he is happy with current performance (parent relay, 18 October 2026). This is accepted qualitative human evidence, not a numerical benchmark or quantified HDMI gain. |
| Launcher privacy configuration | Historical completed-list confirmation reported usage/crash OFF. The later explicit user preference is usage OFF, crash ON; actual associated switch states match it. See the Sony capability record below for the intervening discrepancy. No network-tracking or manufacturer-telemetry claim follows. |
| Persistence and household operation | Andrés confirmed restart/wake persistence, remote controls, app access, Chromecast and Pi HDMI 1. These passes are human-reported; no new automated playback, casting, restart, wake or input-switch probe was run to duplicate them. |

### Read-only corroboration and exact-state preservation

Before the manual installation, a fresh frozen baseline at 14:30–14:32 Madrid recorded Sony Android 9/API 28, user 0, 198 packages, Projectivy absent and stock Home selected. It preserved exact secure/system/global key presence and values and all 198 package user states, including stock Home's default package state and 13 enabled/one disabled component overrides. Speaker volume had changed from the earlier historical value 10 to **3**; the fresh value 3 was preserved rather than reset.

After Andrés reported enabling Override, read-only verification at 14:45 Madrid found Projectivy 4.72/code 97 installed by `com.android.vending`. The installed Play Store base APK verified on API 28 with v3 and a verified source stamp; its certificate SHA-256 matches the earlier official standalone release: `f6697bf4082ee97511e4de07863193884a015b7ab5860430321bda1042b0aadd`. The split-package base has a different byte digest from the standalone APK, as expected. Only Projectivy was added; no package was removed.

The secure changes were exactly `accessibility_enabled: 0 → 1` and previously absent `enabled_accessibility_services` becoming only `com.spocky.projengmenu/com.spocky.projengmenu.services.ProjectivyAccessibilityService`. That service was bound. System/global settings, volume 3, selected/default Backdrop, dream/idle timers and stock Home package/component state were unchanged at this readback. Projectivy was the resumed/focused activity. The preferred HOME resolver still named stock Home; that is distinct from the subsequently observed successful physical Home interception.

The app-private Override value **before** Andrés enabled it was not observed. His manual action was reported before the planned post-install observation; do not infer an initial OFF value. No root, run-as or app-private-data access was used. Raw captures, exact deltas, conditional restore plan and the two individual physical-route reports remain private under ignored `tv-local/20261018-u2-home-baseline-143010/`, with post-override evidence in its `post-override-144515/` child. The broader completed-setup confirmation is recorded here from the parent relay; it is not backed by an invented device capture.

### Remaining independent gates

The **Home/setup branch is accepted on the stated human evidence**. The later independently authorized static Sony dream capability is also accepted, as recorded below. Restart/wake confirmation above concerns the Home setup; it does not establish screensaver restart/wake persistence. The Home confirmation itself did not authorize screensaver installation or timer changes; those received separate subsequent authority.

Andrés’s qualitative performance acceptance meets the current responsiveness outcome; another owner benchmark is not a gate. No comparable before/after timing supplies a numerical Home, app, Chromecast or HDMI speedup. If numerical measurement is later requested, keep Inputs-menu opening separate from source-selection-to-stable-picture/audio; Pi HDMI 1 working does not supply those latency measurements. The fresh recovery plan is prepared, but exact rollback of this accepted manual setup was **not executed** and is not claimed. Full-project completion, U4/U6 delivery/cache and broader unreported playback/broadcast details are not implied. U3 manufacturer cleanup/privacy work is deferred by user decision and is no longer an acceptance blocker.

On 18 October 2026 Andrés authorized bounded **local Aerial Views 1.8.5 qualification** before full custom screensaver development. It used only isolated fixtures and a disposable emulator and ended on a decisive ≤120-second freshness failure; it does not adopt Aerial Views, authorize its Sony installation, extend the Home experiment or turn the heartbeat on. Preserve the current working manual Projectivy override and do not ask Andrés to repeat the completed checks. See [the local qualification record](aerial-views-qualification.md).


## U3 deferred by user decision — 18 October 2026

After accepting Projectivy’s responsiveness as “blisteringly fast”, exactly what he wanted, Andrés said U3 was unnecessary. The parent chat relayed the scope decision and authorization to record it. Defer targeted package cleanup, SkyShowtime removal, legacy HBO/Max retirement, manufacturer privacy/telemetry changes and voice-search changes; none is required to close the revised scope. U3 is **deferred, not completed**. No package or manufacturer setting was changed to produce this decision, and no remaining household check is being assigned to the owner.

The latest launcher configuration contract is usage reporting OFF and crash reporting ON, explicitly accepted by Andrés and corroborated by associated checked switch states below. Manufacturer telemetry has not been reduced or audited; this limitation is explicit and is not silently counted as completed privacy work. Historical cleanup reasoning stays in the earlier dated proposal for traceability and is not an active instruction. Reopening U3 requires a new user scope decision.


## Local screensaver qualification result — 18 October 2026

Stock Aerial Views 1.8.5 is disqualified for the current refresh contract: both its updated unique-URL feed and changed fixed image alias kept showing the old images for 127.4 seconds during a single active dream with five-second photo dwell. Request logs show zero app requests after publication; the three successful host control requests are distinguished from app fetches. The parent reviewed the runtime result and old-image screenshot and accepted this local failure. See [the complete qualification record](aerial-views-qualification.md) for provenance, source facts, configuration and evidence.

Same-ID/URL failure recovery and offline process/device restart are **NOT TESTED**, not failed: qualification stopped after the decisive freshness failure. The local emulator and fixture listener were stopped. No Aerial installation or Sony screensaver/timer change occurred during that local qualification. The later separately authorized static-fixture trial is recorded below; the accepted Projectivy override remains untouched.

The later Sony capability trial below used the prepared signed static DreamService fixture and separate live authorization, including an explicitly requested five-minute delay. Full U4 delivery/cache work still requires a separate custom-fallback decision and authorization; do not repeat completed Home/household checks or reopen deferred U3 automatically.


## Accepted Sony static dream capability — 18 October 2026

**Scope and source:** Andrés separately authorized the live signed static-fixture trial, then explicitly requested “use 5 minutes and keep, we want to favour seeing haystack” and a check for conflicting Projectivy screensaver settings. Physical observations and the final exit quote below came through parent chat `01a14da5-d80c-7773-8251-f866efd4e1c2`; device observations are distinguished separately. All times are Europe/Madrid. The parent accepted this minimal capability gate after the natural-session exit confirmation.

Before installation, a fresh user-0 identity, package and exact settings ledger recorded Backdrop selected/default, the accepted Projectivy accessibility service, `system.screen_off_timeout=3600000` and `secure.sleep_timeout=-1`. The fixture was absent. Only the reviewed signed `dev.haystack.tv` static fixture was installed; its 11,000-byte APK SHA-256 was `8ffc828b529f19ec5b068c5a24558f50c6b40f709d7ca150499be9d2d6a13b68`, with API-28 verification and signer SHA-256 `b53cfddf0d9cc37f70f8481e96d818ef2255d4c73dd456957f27cc39392ffd55`. It has no networking or live-art cache.

| Capability | Accepted evidence and boundary |
|---|---|
| Normal Sony selection | Owner selected Haystack through Sony screensaver settings; settings readback names `dev.haystack.tv/.HaystackDreamService`. The default fallback remains Backdrop. |
| Preview rendering | Owner supplied `IMG_9966.HEIC` from the Sony-settings preview; the parent inspected the intended blue mountains/white moon filling the panel. This proves static rendering only. |
| Physical preview exit | Owner replied “done” to the parent’s remote-exit/return-Home request. No specific key is inferred. This is separate from natural-session exit. |
| Natural idle entry | After returning to idle Projectivy Home without playback, no forced dream or further injected key was used. A 15:59:07 read-only checkpoint had no dream; at 16:00:10, power reported `mWakefulness=Dreaming` and the actual `HaystackDreamService` was active. Owner independently reported “now screensaver is showing”. Entry occurred within that observed interval; exact onset and an exact five-minute delay were not measured. |
| Physical exit from that natural session | Owner explicitly replied “Yes, returns cleanly to Projectivy” to the parent’s natural-session remote-exit question. This closes the minimal Sony capability gate, independently of the earlier preview exit. |

Sony’s supported path was **Salvapantallas → Cuándo se activa → 5 minutos**. The 15:51:30 timeout readback and 15:53:45 configuration comparison with the fresh 15:50 pre-delay snapshot record `screen_off_timeout: 3600000 → 300000` as the sole system/secure namespace delta for this delay change; `sleep_timeout=-1` was unchanged. Five minutes is the user’s desired retained state, not a temporary value to restore automatically. Keep the original hour in recovery history only. No separate sleep, CEC, boot or HDMI switching policy was changed.

The 16:01:20 final read-only capture found the dream token/name cleared, power Awake, Haystack still selected, Backdrop still default, timeout `300000` and sleep `-1`. The resumed activity was Projectivy’s `AppSettingsActivity`, not its Home activity, possibly because of owner navigation; it corroborates that the dream ended, not the exact Home return. The clean Home exit is accepted from the owner’s explicit quote.

Compared with the initial 15:41 trial snapshot, `system.user_rotation` also changed from absent to `0`; it was already `0` in the 15:50 pre-delay snapshot. No issued command set rotation, so its cause is unattributed and it was preserved. The initial-to-final secure delta selects Haystack, and the global namespace delta is empty. Do not describe every initial system setting as unchanged or reset this value to an older snapshot.

The diagnostic injected HOME at 15:53:36 reached stock Home, so a later explicit ordinary Projectivy launch established the observed idle context by 15:54:39. A later no-change-lights timestamp around 15:54:41 supplies the conservative last-interaction bound for idle timing; no override setting was changed. This injected result does not replace or negate the accepted physical Home evidence.

Actual associated Projectivy switches showed **Prevent system screensaver OFF**, **simulated user activity OFF** and **internal idle detection OFF**. The internal idle action displayed “Apagar”, but detection was disabled; it was not an enabled competing shutdown action. No enabled conflict was found and no Projectivy preference was changed. The existing Home override remained ON. No new notification/accessibility grant was made.

Privacy evidence is chronological: the earlier completed-list human report said both reporting controls were OFF; a 15:42 capture instead associated both switches with `checked=true`. This conflict does not establish when or why either value changed. Andrés then explicitly requested **usage OFF and allowed crash ON**. At 15:52:07 the correctly associated switches showed usage `checked=false`, crash `checked=true`, unchanged by this inspection. This matches the latest preference; crash ON is accepted. These settings are configuration evidence, not a traffic audit or manufacturer cleanup.

HDMI needs no additional optimization: Andrés directly answered “with the change to projectivy it is fast now”. This is accepted qualitative input-selection evidence; neither Inputs-menu latency nor source-confirmation-to-stable-picture/audio was numerically measured. No input setting or shortcut was changed for a claimed speedup.

Private fresh ledger, install/signature evidence, configuration deltas, associated-switch captures and sparse idle observations remain under ignored `tv-local/20261018-sony-dream-hdmi-154154/`. The host explicitly disconnected this Sony ADB endpoint at 16:01:53 after removing its two temporary device XML files; this did not disable TV-side debugging or stop global ADB. Keep Haystack selected and the five-minute delay. Preserve Projectivy and Pi HDMI 1. U2 Home plus minimal Sony capability is accepted; **U4, U6 and U7 remain pending**, with full custom delivery/cache requiring its own decision and authorization. This static result proves neither current Haystack artwork refresh, same-ID retry, offline cache, screensaver restart/wake persistence, active-playback protection nor universal HDMI idle. No full U4, server/Pi/network change, cleanup, paid generation or heartbeat activation occurred.


## Subsequent local U4 authorization and Continue Watching diagnosis

After accepting the static Sony capability, Andrés explicitly authorized U4 local implementation and testing of artwork refresh and durable offline caching. This authorizes isolated fixtures and emulator verification, not a TV upgrade, server deployment/restart, generation, production-output change or Pi change. The retained TV setup remains the selected static fixture, five-minute delay, separate sleep `-1`, working Projectivy override and usage OFF/crash ON.

Andrés clarified that the missing row is **Continue Watching / Continuar viendo**, with show/movie cards to resume. Installed Projectivy 4.72 code checks the independent **General → Habilitar canales** preference before querying Android's Watch Next provider. This switch was OFF in the captured UI; the usage-reporting handler configures Firebase independently and does not supply that channel gate. Enabling analytics is not justified by the observed mechanism. The separate **Reproduciendo / Now Playing** row uses active media sessions and notification access; it is not the reported missing row and no notification grant is proposed.

A separately authorized narrow repair may enable **Habilitar canales** if still OFF and make **Continuar viendo** visible if hidden, preserving every other category's visibility and usage OFF/crash ON. At the fresh repair inspection the Sony TV viewing activity was foreground with a playing media state, so no UI input or preference change was made. The host disconnected and supplied the precise remote steps through the parent. Actual cards still require eligible provider content and a visible category; neither an empty row nor an unexecuted instruction is a verified repair. Private diagnosis and read-only state are retained under the existing ignored evidence folder and its `watch-next-repair/` child.


## U4 local artwork refresh and durable cache — 18 October 2026

The separately authorized local version-2 implementation reuses the existing metadata/image GET endpoints, one dream-owned background worker and a durable app-private ID/image record. It rejects foreign origins and redirects, permits cleartext only to the build-selected numeric LAN host, bounds metadata/downloads/pixels and samples decoding for the 1080p display. Failed or cancelled candidates preserve the last accepted image and are retried even when the Render ID is unchanged. There is no new server API, generation call, Home/viewer activity or persistent background service. The stable signing identity is retained; the Sony still has version 1's accepted static fixture.

Nineteen JVM tests cover API-28/35 interrupted-record recovery, supported formats and bitmap allocation bounds, malformed/truncated/oversized inputs, same-ID retry, transport errors and the production timeout, origin/redirect rejection, single-flight and lifecycle cancellation. Two emulator instrumentation checks passed for framework discovery/protection and an abandoned real AtomicFile transaction. Debug/signed release builds and lint passed, with zero lint errors and one data-extraction warning. The initial proof-first run failed because the new repository/cache types did not yet exist; final host combined verification passed after implementation.

During a local API-31 emulator dream, a B image returning 404 left A visible. The same B ID subsequently succeeded and became visible in **61.623 seconds** after successful publication, under the same uninterrupted dream token. Force-stopping the process and starting a new dream while the fixture returned 503 recovered cached B from disk. With storage empty and the fixture unavailable, the built-in landscape appeared. After dismissal, request counts stayed unchanged for **65 seconds**. The host inspected the B, offline B and no-cache fallback screenshots. These forced emulator dreams are local runtime tests, not new Sony natural-idle or household acceptance.

Interrupted-write recovery and actual offline process death were separate tests; the process was not killed mid-write. The final committed-record verification guard was added after runtime smoke and passed the final test/build/lint checks. Private evidence is under ignored `tv-local/20261018-u4-local/`; the owned emulator, fixture listener and worker Gradle daemons were stopped. No TV upgrade, production-server request/deployment/restart, production-output mutation, paid generation or Pi/network change occurred. Full Sony artwork refresh, restart/wake and playback protection remain in the separately authorized U6 live phase.


The completed U4 review covered correctness, standards, testing, maintainability, security, performance, reliability and adversarial risks with **no actionable findings**. The configured Claude peer failed before egress because its transport dependency was unavailable; the adversarial pass ran locally instead. Review coverage limits remain explicit: JPEG/WebP internal damage with intact envelopes was not separately tested against the native decoder; cancellation during a controlled mid-write checkpoint was not separately exercised. The existing cases cover invalid/truncated containers, pre-write cancellation, interrupted atomic replacement and actual offline new-process recovery. These are coverage limits without an observed defect, not claims of exhaustive integrity or power-loss recovery. LAN HTTP remains unauthenticated and unencrypted as documented in the native README; the client accepts only its configured trusted endpoint.

## U6 image-quality correction — 18 October 2026

The separately authorized version-2 Sony update displayed the current production artwork after natural idle; Andrés confirmed clean physical remote exit to Projectivy. Image quality failed acceptance, so offline/restart/playback trials were paused before any isolated-origin APK was installed. The production image was 2048×1136, but the decoder selected a 1024×568 bitmap and the screen enlarged it. Earlier tests enforced maximum dimensions/allocation without requiring enough detail for the fitted image.

The correction retains at least the fitted detail during power-of-two sampling, then uses filtered downscaling to at most 1920×1080. It preserves aspect ratio with integer rounding and leaves smaller sources at their original dimensions. A regression matrix covers the actual dimensions, a rounding boundary, near-4K, portrait, ultrawide and small sources in PNG/JPEG/WebP on native API-28/35 graphics. A separate private probe of the actual production PNG measured 2048×1136 decoded pixels (9,306,112 bytes), then 1920×1065 fitted pixels (8,179,200 bytes). Comparable renders use the same source and fit; these are local QA images, not corrected Sony acceptance. Independent review identified that flat-color fixtures could not detect disabled filtering. A separate high-frequency stripe test fails when filtering is deliberately disabled and passes after restoration, covering that gap.

Read-only inspection also found the Pi's active Sony output and framebuffer at 1920×1080, 60 Hz, scale 1. Advertised 4K modes were inactive. Chromium uses the production kiosk and its source specifies `object-fit: cover`; live DOM viewport/DPR were unavailable. Cable capability alone does not establish active 4K. No Pi configuration changed.

The corrected version-3 debug/release builds, 23 JVM tests and lint passed (zero errors; one retained data-extraction warning). API-28 signature verification passed with the existing update key. Production origin was verified in the APK. The corrected version-3 artifact requires review before another Sony update. Natural corrected artwork quality, refresh/offline/restart/wake and active DRM/Cast protection remain pending. Retain the accepted five-minute delay, sleep setting, Projectivy override and usage OFF/crash ON preferences.

### Remaining v3 softness and pixel placement

The reviewed v3 update was installed in place with the existing key. Pulling its installed APK verified the exact approved hash; the selected dream, 300000 ms delay, sleep -1 and Projectivy accessibility service matched the pre-update values. At 17:30:50 Europe/Madrid, the non-test dream entered naturally after 308 seconds idle and displayed the current production render `20261018_150035_05c44a8f`. Its metadata records OpenAI `gpt-image-2.5-sunburst`, PNG, 2048×1136. Andrés reported that v3 was better but still not crisp, and that the same current artwork on Pi HDMI 1 was noticeably crisper. This is partial improvement, not quality acceptance; no physical-exit pass follows from that answer. Other U6 trials remain paused.

A local native API-28 diagnostic decoded those exact source bytes to 1920×1065 at density 320. Standard ImageView FIT_CENTER produced scale 1 and vertical translation 7.5 inside 1920×1080. Density did not introduce another half-resolution bitmap. Native software Canvas snapped this fractional placement, so its screenshots and a high-frequency control alone could not reproduce the Sony hardware behavior. However, averaging each adjacent row of the native integer-position reference matched the existing Sony capture at RMSE 0.429 per 8-bit channel (55.49 dB); without that half-row blend the difference was 8.788 (29.25 dB). This tightly supports an additional filtered half-pixel placement as a source of softness. It does not measure panel processing or prove that correcting placement will close the full human-observed HDMI quality gap.

The authorized next correction aligns final drawable placement to whole physical pixels while preserving aspect fit, filtered decoding and the built-in fixture. It changes neither global display size nor source pixels, and adds no sharpening or nearest-neighbor mode. A reviewed version-4 artifact and renewed physical quality acceptance are required before resuming lifecycle/playback trials.

Version 4 applies a bitmap-only Canvas translation around standard ImageView drawing; it does not replace layout or affect vector drawing. Native API-28/35 regression tests first failed on physical drawable bounds at y=7.5, then passed with y=8. Coverage includes odd horizontal margins, view resize, drawable replacement, density conversion and retained bitmap filtering. The vector test observes the physical Canvas transform against standard ImageView; deliberately applying the bitmap adjustment to vectors makes that test fail. The restored full build passes 27 JVM tests, debug/release and lint (zero errors, one retained data-extraction warning); API-28 signing and the production origin are verified. These tests establish local placement behavior, not corrected physical Sony quality. Review and exact-artifact approval precede another TV update.

## U6 version-4 live checks — 18 October 2026

The exact reviewed version-4 production APK was installed with data preserved, then pulled back and checked against its approved hash and update certificate. Screensaver selection, 300000 ms idle delay, sleep -1 and the Projectivy accessibility service were unchanged. Its non-test dream entered naturally and showed the current production render. The Sony capture matched an integer-position native reference of the same image at RMSE 0.216/255 (61.43 dB); the previous half-row-blended model fit substantially worse. Andrés then explicitly reported: “Quality is satisfactory; exit works.” This establishes human quality acceptance and physical remote exit for v4, separately from the screenshot measurement.

The temporary v4 test-origin build has the same version and certificate. Independent comparison found identical manifests and non-DEX ZIP payloads; all 53 DEX methods, string tables, fields and class definitions matched after normalizing only the configured port from 62293 to 4321. This supports the origin-only configuration difference, not a reproducible-build or runtime equivalence claim. The fixture listener bound only the Mac's existing LAN IP; production server and household networking stayed available.

On the Sony, one naturally entered dream displayed A, retained A through B's HTTP 404, then retried the unchanged B ID and visibly displayed B within an observed upper bound of 49.7 seconds after successful publication. The same dream token persisted through those observations. Logs distinguish actual Sony requests from host control requests. Offline recovery, exact production restoration and final playback checks are recorded separately; this freshness result alone does not complete U6.

With the owned test listener stopped, the original app process was force-stopped without clearing data. A different PID then entered the dream naturally and displayed cached B while that endpoint was still unavailable. This is a real offline **process** restart, not an offline device-reboot claim. For the separate stop check, the owned listener was made available and an injected Home key dismissed the dream. Over 92.8 seconds, requests stayed at 8 while the same app PID remained alive. That technical dismissal does not replace the separately accepted physical remote exit.

The exact accepted production v4 APK (`a1c671a04545acbc1c845b644f5123db02b9093524ad81616426c1f8470b0dd2`) was restored before any device reboot. Its pulled hash, certificate, production origin and selected system settings matched; current production art then naturally replaced the distinct fixture. Production-cache replacement is inferred from that visible image and the reviewed commit-before-publish code, not direct access to app-private ID/bytes. The owned listeners were stopped, and the local default release output was rebuilt to the identical production hash.

A separate online device reboot changed the kernel boot ID and recovered authenticated TCP ADB access. The production APK hash, screensaver selection, five-minute delay, sleep -1 and Projectivy accessibility service persisted. Post-reboot natural-art and final playback observations are recorded separately. No persistent ADB, household network or production server configuration was changed. Offline device reboot was deliberately not combined with the fixture trial, avoiding a temporary-origin build being stranded if ADB did not return.

Post-reboot, the production dream entered naturally and displayed the current Mac render `20261018_170030_46095313`. This confirms actual artwork after the online device restart, rather than selection alone. A new v4 standby/wake injection was not repeated; earlier U2 physical wake evidence remains separate.

| Current v4 check | Result |
|---|---|
| On-panel quality and physical remote exit | Human accepted: “Quality is satisfactory; exit works” |
| Natural current-art entry | Passed before and after the real device reboot |
| Failed B download retains A; same B ID retries | Passed under one dream token; B visible within 49.7 seconds of successful publication |
| Offline new-process startup | Passed with cached B, a changed PID and the test endpoint unavailable |
| Polling ends after dismissal | Passed: no requests for 92.8 seconds while the same process stayed alive and listener was available; dismissal used an injected Home key |
| Exact production restoration | Pulled APK matches `a1c671a04545acbc1c845b644f5123db02b9093524ad81616426c1f8470b0dd2`; certificate/origin/settings verified, real art replaced fixture |
| Online device restart | Changed kernel boot ID, ADB returned, settings/APK survived and natural artwork returned |
| Offline device reboot | Not tested as a combined scenario; offline process and online device restart were separate |
| New v4 standby/wake trial | Not repeated; earlier physical U2 evidence is separate |
| Active Netflix DRM playback | Human six-minute pass: normal playback/audio and no screensaver; metadata corroborates 313.2 seconds of active advancing playback, not a host-observed six-minute window |
| Actual Google Cast | Human phone-sent six-minute pass: normal casting/audio and no screensaver; first technical sample playing, final sample paused, no six-minute host playback claim |

The heartbeat stays off. U3 cleanup remains deferred, and no manufacturer telemetry reduction is claimed. The accepted launcher usage OFF/crash ON preference was carried forward without changing Projectivy settings; those internal switches were not freshly read during the v4 playback preparation. Continue Watching repair remains unconfirmed and does not justify enabling unwanted recommendation rows.

Final Netflix result: Andrés explicitly reported, “After 6 minutes: playback/audio normal, no screensaver.” Metadata samples showed Netflix active/playing with advancing position and no dream from 19:10:19 to 19:15:32 Madrid (313.2 seconds); the later sample found Netflix stopped and Projectivy foreground after the human check was complete. The six-minute duration and picture/audio result are human evidence, corroborated by the shorter sampled window. No screenshots or device inputs were taken during playback. Retained playback evidence contains technical fields only, with stream titles omitted.

Final Cast result: in response to the phone-sent Chromecast instruction, Andrés reported, “After 6 minutes: casting/audio normal, no screensaver.” The 19:19:48 Madrid sample showed YouTube actively playing; at 19:25:01 it was paused, with no dream and the TV awake. The 312.8-second endpoint span does not establish continuous playback or a six-minute host observation. Actual phone casting, duration and picture/audio are established by the human response.


## V4 scoped acceptance and operation — 18 October 2026 (historical)

This section records the v4 handoff. The v5 follow-up below supersedes its artifact identity and any reboot/wake limits subsequently verified.

U6 and U7 were complete for the revised scope at that handoff. Independent final evidence review reconciled the device receipts, source durability, reviewed builds and human playback reports. This is scoped acceptance: AE3’s combined offline device reboot was not executed; offline process startup and online device restart were verified separately. New v4 standby/wake and HDMI-idle activation were not verified. These remain explicit coverage limits, without a claim that every acceptance-example combination passed.

| Requirement | Final evidence and boundary |
|---|---|
| R1 responsiveness | Andrés accepted Projectivy Home and HDMI selection as fast; no numerical speedup claimed |
| R2 clean Home | Human accepted normal return paths, hidden unwanted rows and earlier reboot/wake persistence; streaming-app ads are outside this Home result |
| R3 household apps/Cast | Earlier human confirmation of all 13 app entries; final Netflix and actual phone Cast six-minute picture/audio/no-screensaver passes; no exhaustive playback test of every app |
| R4 cleanup | Deferred by the user; no package removal or manufacturer cleanup performed |
| R5 shared functions | Earlier human controls, audio, keyboard, Inputs and Pi HDMI 1 confirmation; household dependencies preserved, no new v4 wake or universal HDMI-idle claim |
| R6 recovery | Fresh change ledgers, retained stock Home/Backdrop and exact restoration of the trial-origin APK to production; full rollback of the accepted manual Home setup was not rehearsed |
| R7 display scope | Plain Home accepted; dynamic Home and separate fullscreen viewer deferred; Pi HDMI 1 retained |
| R8 native idle | Normal selection and natural entry, human quality/physical exit, online reboot persistence and final active-playback protection passed |
| R9 refresh/cache | Same-ID error/retry visible within 49.7 seconds, offline new-process last-good recovery and stop-after-dismissal passed; local corruption/no-cache/atomic-recovery tests passed. Durable synced storage plus separate online reboot support restart durability; combined offline device reboot remains untested |
| R10 production boundaries | TV performs presentation GETs only; generation, credentials, canonical art, continuity, schedules, retention and public notes unchanged |
| R11 cost | Required Projectivy controls and custom screensaver used without purchase; existing generation costs unchanged |
| R12 reporting | Latest accepted usage OFF/crash ON preserved; v4 did not freshly inspect internal toggles. No manufacturer telemetry reduction or network privacy audit claimed |

For everyday use, Home opens Projectivy. Leave the TV idle at Home for the accepted five minutes to display Haystack; use the remote to exit. Playback protection passed for the observed Netflix and phone-Cast sessions. Inputs → HDMI 1 still opens the independent Pi display. No automatic input switching or display while the panel is off is promised.

The Mac must remain awake and reachable at the configured LAN address for new artwork. The dream checks immediately on entry and every 60 seconds after an attempt completes; while unavailable, the last accepted image remains. With no valid cache, the built-in landscape appears. A stale image therefore need not mean the TV is broken: first check Mac availability and the existing server using its normal operating instructions. No extra Render is needed to test connectivity. The TV app never starts generation.

The installed production app is version 4 (`0.4-pixels`), SHA-256 `a1c671a04545acbc1c845b644f5123db02b9093524ad81616426c1f8470b0dd2`, configured only for `http://192.168.0.20:4321`. Keep the stable signing key outside Git and follow [the build/signing instructions](../android-tv/README.md) for a future update; data-preserving updates must use that certificate. Verify origin, version, certificate and installed APK hash. A debug or test-origin APK is not a household update.

For screensaver recovery, use Sony’s normal screensaver selector to choose the retained stock Backdrop. Keep the accepted five-minute timeout and sleep `-1` unless the owner requests a change; the original one-hour delay is historical recovery data. For Home recovery, use the exact fresh ledger procedure above rather than enabling every package or clearing app data. Existing stock Home, household apps and Pi remain available. No full firmware/account backup or boot-loop recovery is implied. Continue Watching restoration remains unconfirmed and separate from this handoff.

The quality-correction record above preserves the reusable lesson: maximum-size checks missed undersampling, and software Canvas behavior missed physical half-pixel filtering. Regression checks now cover fitted detail and physical placement, with actual Sony acceptance recorded separately. Private keys, APKs, images and raw evidence remain outside Git. Owned fixture listeners are stopped; the default local release artifact matches the installed production hash. The heartbeat remains off.


## Optional v5 transition follow-up — 18 October 2026

After the v4 handoff, Andrés reopened TV testing and requested a progressive transition like the Pi. The Pi source uses `opacity 2s ease-in-out`; v5 uses a two-second native incoming-frame fade with the equivalent cubic easing. Both layers retain the reviewed whole-pixel `ArtworkImageView`. The old layer remains opaque, including during changed-aspect-ratio letterboxing. Initial art is immediate, repeated IDs/errors do not animate, rapid changes settle the previous destination, and stop/detach clears animation and image references. Only the latest undelivered candidate is retained when the UI is blocked.

All 39 JVM cases, debug/release builds and lint passed (zero errors, one retained data-extraction warning). Native API-28/35 tests observe intermediate composite pixels, changed letterboxing, first/same-ID art, interrupted transitions, cleanup/restart and actual two-frame bitmap allocation. Controller coverage includes queued delivery and failed-refresh retention. The exact dequeued-callback race is guarded by synchronization/null checking by inspection; that precise interleaving is not forced by a test. Independent Claude Opus 5.5 review completed with no retained findings; low effort was requested and actual effort was not adapter-verifiable.

The reviewed production artifact is version 5 (`0.5-crossfade`), SHA-256 `2ecf42870e216c191d0036e77a6188f41104602ecdea5b989cd24736068585bc`, signed with the existing certificate and configured only for production port 4321. A new independent origin-only audit matched all 63 DEX methods, 20 classes, references, strings and non-DEX payloads after normalizing only test port 62293. Both signatures verified for API 28. The exact production artifact was installed/pulled/verified before the bounded fixture trial, with selection, five-minute delay, sleep `-1` and Projectivy accessibility preserved.

During one naturally entered v5 dream, A, B and changed-aspect-ratio C appeared under the same token. Andrés explicitly reported, “looked smooth, just saw it”; the colour pair was not specified. A native fixture-only video attempt produced an MP4 that failed decoding, so it provides no hardware frame-timing evidence. The configured two-second duration is covered locally; physical smoothness is human evidence. An injected Home command was issued 0.622 seconds after the next B image request, within the nominal fade interval; the exact hardware key dispatch instant was not measured. Subsequent metadata confirmed the dream had ended and Projectivy was foreground.

Actual app PSS sampling included three A samples, nine download/transition samples and three settled B samples. The sampled transition maximum was 29,909 KiB; settled B was 21,610–21,611 KiB. The first A sample was 41,240 KiB before garbage collection, so it is not a matched v4 comparison. Samples took 0.412–0.500 seconds each, starting 0.018 seconds after B’s request. This sampled maximum is a lower bound on a transient peak, not a worst-case allocation or total GPU measurement; the app summary reported Graphics 0. Two actual Full HD bitmap allocations measured 16,588,800 bytes in the local test, dropping to one 8,294,400-byte drawable after completion.

The combined offline-device reboot subsequently passed: after the single restart, the kernel boot ID changed from `ddc02b40-dd23-4018-ae93-30a0063e4522` to `ba369942-a61c-41b2-9647-b06d6c29c673`. Identity-verified ADB and `boot_completed=1` were observed within a sampled upper bound of 54.983 seconds; this is not physical screen/Home readiness. With only the owned test endpoint unavailable, a non-test dream naturally displayed cached orange B at 20:46:46 Madrid. All 25 sampled pixel locations matched B, the fixture APK hash survived the reboot and settings were preserved. No household network or production service was stopped.

The observer immediately requested restoration. The independent watchdog installed the immutable production APK, pulled it back to verify the exact `2ecf42870e216c191d0036e77a6188f41104602ecdea5b989cd24736068585bc` hash, and verified retained settings before exiting. The production origin was independently rechecked. The test listener is stopped and no temporary-origin app remains. Before the reboot, a cross-process monotonic-clock mismatch in the host helper was corrected by using Unix-epoch deadlines/heartbeats and replacing only the owned helper; no reboot occurred under the earlier helper. Restoration attempts were triggered by the explicit signal, nine-minute deadline or stale observer heartbeat, with device identity checked before installation. A deadline cannot guarantee restoration if ADB is unavailable; this run completed and verified restoration successfully.

The restored production build then passed injected standby/wake with the same kernel boot ID: Android reported Asleep, then Awake and Projectivy Home within a sampled 2.527 seconds of the wake request. At that initial probe `mDisplayReady` was false; a later passive sample reported ready/ON. Neither sample measures physical remote-to-picture readiness. No power policy was changed. Around 20:53 Madrid, the non-test production dream naturally displayed current render `20261018_180032_c39bbc4e` after wake. The same stable source was fetched read-only around the capture: 2048×1136 PNG, SHA-256 `5a64f7b5be14bbdfce7c699857eb290bcf2c62c034c2bcb784d4e03c1c77fb80`. The settled 1920×1065 image occupied rows 8–1072, preserving whole-pixel placement. An approximate independent Pillow bilinear fit differed by RMSE 1.087/255; this is not an exact Android/Skia or panel calibration. Native placement tests provide the framework geometry proof. Current real art replaced the temporary fixture visibly; app-private production cache bytes were not read directly.


Current household configuration is the exact v5 production hash above, production origin 4321, native Haystack selection, five-minute delay and sleep `-1`, with the accepted Projectivy override intact. Both owned test listener and restoration watchdog have exited. v5’s smooth transition is human accepted; its final static screenshot/current-art and injected exit/wake checks are technical evidence. The earlier v4 human physical remote exit and six-minute Netflix/phone-Cast checks remain separately attributed, without inventing fresh v5 repeats. HDMI-idle activation, worst-case accepted-image/GPU peak memory and physical panel-ready latency remain unverified. Core production generation, Pi, networking, credentials, schedules and heartbeat configuration were unchanged.

Projectivy’s separate clock-only Home stage is configurable at **Ajustes → Ajustes de Projectivy → Apariencia → Modo inactivo del lanzador**. Saved UI and the installed APK identify **Tiempo de espera antes de estar inactivo (min)**, **Opacidad de UI**, **Mantener reloj** and **Evitar el protector de pantalla del sistema**. Setting UI opacity to 100% prevents this Home fade; it does not change Android’s five-minute screensaver delay. Numeric current values were not recorded; saved evidence shows keep-clock on and prevent-system-screensaver off. This was a read-only diagnosis and no preference was changed. Keeping the icons visible until the native screensaver starts remains an optional user preference, not an applied setting.

The final normal-UI inspection found **Continuar viendo already present and populated before any preference change**: six clickable cards and three progress bars. Home contained only **Aplicaciones de TV**, **Continuar viendo** and **Entradas**. The associated General switches showed **Habilitar canales on**, the launcher override on, **usage reporting off** and **crash reporting on**. No category, channel, reporting, idle or permission setting was changed, and no viewing-history item was launched. The cause of the earlier missing row, and when its master switch changed from the historical off state, were not established; this is observed current functionality, not a repair attributed to the test or reboot.

The owner then paused work to use the TV and later reported turning it off. ADB was disconnected at the pause. The final documentation wrap-up used only saved evidence: no reconnection, waking, testing, monitoring or new preference changes. Source commit `17d27d6` contains the reviewed v5 implementation. No slow startup app or Sony service was identified from the saved reboot observations, and none was disabled. The 54.983-second boot observation and 2.527-second OS wake observation use different technical boundaries and do not establish physical screen-ready times.
