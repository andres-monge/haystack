# Sony TV integration: baseline and recovery

Status on 18 October 2026: **U1 documentation and automated baseline prepared; physical acceptance remains unverified.**
The [implementation plan](plans/2026-10-18-0839-feat-sony-tv-haystack-integration-plan.md) governs the phase boundaries. U2–U7 have not started. No package, launcher, animation, idle or other TV setting has been changed by this work. Opening screens during U1 can change app/task state and navigation history.

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

Verify Home resolution and physically press Home, Settings and Inputs before removing a trial launcher. The TV's `pm help` exposes `set-home-activity` and `default-state`; successful restoration has not been demonstrated. Do not disable stock Home before the replacement and recovery route work. If ADB is unavailable, use physical controls/default-app UI only when verified accessible; do not promise ADB recovery from a boot loop. Retain the stock launcher and Pi so a failed experiment does not require uninstalling household apps.

Pi fallback: physically open Inputs and select HDMI 1 using the Sony remote. Confirm the existing Haystack image and return to the previous viewing source. HDMI 1 is the documented Pi connection; its label/path and actual picture require physical confirmation. Do not guess an Android TV input ID from HW numbering. If the Pi image is stale, consult the [existing LAN recovery guide](solutions/integration-issues/raspberry-pi-kiosk-hardcoded-mac-ip.md); changing Pi/server/router state is outside U1.

On any later loss of Home, Inputs, remote, keyboard, audio, casting or a preserved app, stop, restore the last changed batch to its recorded states and repeat the failed action. Do not continue disabling packages to troubleshoot. Recovery preparation is not proof of physical rollback.

Android command semantics are documented in [PackageManager shell source](https://android.googlesource.com/platform/frameworks/base/%2B/8517e8d998be/services/core/java/com/android/server/pm/PackageManagerShellCommand.java) and [Settings command source](https://android.googlesource.com/platform/frameworks/base/%2B/c484f54/cmds/settings/src/com/android/commands/settings/SettingsCmd.java). Local Sony help is the compatibility evidence; physical effects remain to be tested. The generic Settings source documents syntax families; the Sony help takes precedence for argument placement and its list/delete limitations.

## Repeatable timing and acceptance protocol

Use the same remote, seat/distance, network, app versions, Home arrangement, animation state and start/end definitions for baseline, U2, each U3 batch and artwork-enabled comparison. Record date/time/timezone, observer, screen/source, warm-up, device uptime, versions and background playback/downloads. Keep the three animation keys absent throughout this comparison. Do not clear caches, force-stop apps or change background limits to manufacture a result.

For each flow, perform one unscored warm-up followed by five comparable warm trials. Use a stopwatch or live observer; no screen recording is authorized by default. Start at the physical button press and stop when the stated destination is visibly usable and accepts the next action. Record all five seconds, median and maximum, plus missed keys, loading delays and invalid trials with reasons. Replace invalid trials rather than silently excluding slow valid results. Startup command duration, `am -W` WaitTime and TotalTime are separate diagnostic metrics and do not measure physical remote-to-visible latency; TotalTime=0 on task reuse is not instant UI.

| Flow | Fixed start → endpoint | Baseline visible samples / median / maximum |
|---|---|---|
| Home | Same chosen app screen, Home press → app menu usable | pending |
| App grid | Same Home focus, agreed route → app grid usable | pending; exact route to record |
| Settings | Same Home focus, agreed Settings route → menu usable | pending |
| Inputs chooser | Same Home focus, Inputs button → chooser usable | pending |
| HDMI selection | Same starting source, choose the same HDMI entry → stable picture and audio; record chooser time separately | pending; Andres reports this is slow |
| Netflix | Same Home tile focus, Select → same profile/content landing usable | pending |
| Current Max | Same Home tile focus, Select → same profile/content landing usable | pending; confirm current household app |
| D-pad | Same Home focus, ten specified directional keys at one-second cadence → ten corresponding visible focus responses | pending; record exact directions and misses |

App landing latency and time-to-first-playback are separate. After warm trials, start a familiar title in each representative app and have Andres confirm video/audio and volume/mute. Test physical Home/Back/Inputs and keyboard text entry without changing accounts or sharing search text in Git. Test a normal Chromecast start/stop from a household device and confirm return to TV control. Check broadcast and Pi HDMI 1, preserving previous input. An ADB activity success cannot substitute for any of these observations.

Andres explicitly requested practical speed improvements on 18 October, especially Home navigation, launches of household apps, Chromecast and HDMI input selection, without stopwatch work or choosing numeric targets. Use the same engineering probes before/after each intervention, report median/maximum, and investigate regressions separately from improvements. Human-only observations are evidence gaps, not an owner questionnaire or a timing-target gate. Ad removal and RAM reduction alone do not close R1; activity timings cannot establish visible responsiveness.

Record one post-restart sample separately from warm results, including restart-to-usable-Home and the first app launch. Record one standby/wake sample separately, including wake-to-usable-Home and remote/input/audio recovery. Do not mix cold, post-restart or wake numbers into warm medians. Restart and standby are different checks; if either cannot finish in the free-TV window, leave it pending.

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

## Acceptance ledger and next session

- [x] Original private configuration snapshot read; stock Home, selected settings and selected installed package states documented.
- [x] Household preservation and U3-only removal scope recorded.
- [x] `tv-local/` excluded before local follow-up evidence creation.
- [ ] Five visible warm trials per flow; median/maximum and ten-key D-pad response check.
- [x] Engineer-selected repeatable comparison method documented; no owner timing-target selection required.
- [ ] Netflix/current-Max playback, physical remote/Back/Home, keyboard, volume/audio confirmed.
- [ ] Chromecast start/stop, broadcast, Inputs and Pi HDMI 1 confirmed.
- [ ] Separate restart and standby/wake samples; recovery readiness physically confirmed.
- [x] Host ADB disconnected at session close.
- [ ] TV-side debugging disabled by Andres when finished (unconfirmed).

U1 automated preparation may be assessed independently; the unchecked physical acceptance items remain unverified and must not be described as passed. Next live work needs an explicitly free-TV session. Physical observations remain unverified until available; do not require Andres to select timing targets or perform stopwatch trials. Andres additionally reports slow HDMI channel selection and requests improvement. Track chooser opening and source-to-stable-picture/audio separately, preserving HDMI 1/Pi and broadcast; do not infer switching latency from InputsPanelActivity timing. No U2 installation or setting change follows automatically from U1 preparation.

Repository verification uses snapshot comparison, private-file boundary checks and diff hygiene. Application build, unit tests and lint are deliberately not run for this documentation/ignore-only change; they cannot verify TV behavior. Generation, credentials, scheduler, providers, server, Pi and daily-story/public-note behavior are untouched.
