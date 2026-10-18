# Sony TV integration: baseline and recovery

Status on 18 October 2026: **U2 live trial attempted and restored to stock; blocked on reliable settings control. U2 is not complete.**
The [implementation plan](plans/2026-10-18-0839-feat-sony-tv-haystack-integration-plan.md) governs the phase boundaries. The U2 attempt below installed and then removed Projectivy and restored stock Home. No U3–U7 work has started; final settings/package restoration evidence is recorded below. Opening screens during U1 can change app/task state and navigation history.

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

## Acceptance ledger and next session

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

## U2 preparation: Projectivy launcher trial

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

### Prepared installation and Home route (not executed)

Once Andres confirms the TV is free, refresh the per-user/settings/package ledger described under recovery. Confirm stock Home still resolves to `com.google.android.tvlauncher/.MainActivity`, user 0 is intended, and the physical remote, Settings and Inputs recovery path are reachable. The original snapshot contains no Projectivy package; recheck before installing and preserve any subsequently existing installation/configuration. Do not uninstall or downgrade an unexpected version to force this recipe.

Install only the inspected APK or the verified official Play version, then open Projectivy as an ordinary app while stock Home remains the default. For a first installation of the inspected APK, the prepared command from the repository root is:

```sh
# FUTURE LIVE U2 ONLY: not run during preparation; no automatic permission grants.
adb -s 192.168.0.24:5555 install --user 0 tv-local/20261018-u2/ProjectivyLauncher-4.72-c97-xda-release.apk
```

Skip optional accessibility/notification onboarding requests, configure the minimal layout and confirm app/Settings/Inputs access before changing default Home. Prefer Projectivy's `Change default launcher` and Sony's supported Home/default-app chooser. The resource label does not establish that this Sony exposes that chooser. If the UI route is absent, the Sony's already-captured `pm help` supports the platform preferred-Home setter; it is an alternative to disabling stock Home:

```sh
# FUTURE LIVE U2 ONLY: choose this route only after recovery preparation and opening the app.
adb -s 192.168.0.24:5555 shell pm set-home-activity --user 0 com.spocky.projengmenu/.ui.home.MainActivity
# Then inspect the resolved default; success text alone is insufficient.
adb -s 192.168.0.24:5555 shell cmd package resolve-activity --brief --user 0 -a android.intent.action.MAIN -c android.intent.category.HOME
```

Record the setter result and resolved component, then test physical Home and Back from apps. A direct component launch proves neither default routing nor persistent Home behaviour. Keep `Override current launcher` and accessibility off if supported Home selection works. Avoid modern `cmd role`/LauncherX recipes: this Sony is API 28 with Android TV Launcher, not the Google TV Streamer described in other reports.

If supported Home selection fails, stop that attempt and record the failure. Only then consider the app's `Override current launcher` with its exact accessibility service as a separate intervention within the live U2 trial. Save the new launcher's override/remapping preferences and fresh secure-setting presence/value first; do not blindly replace the enabled-service list. The resource description warns that remapping can affect long-press volume; keep remapping off if the tested override works without it. Verify the actual route and volume/remote behaviour. Do not assume an accessibility interception is equivalent to a proper Home task or prevents stock-home ad flashes on Back, reboot or wake. Stock launcher disabling is not part of this initial recipe; if both routes fail, report the limitation before escalating. No launcher-manager app or disable command is prepared or installed.

### Recovery and live acceptance still pending

Restore only trial-owned changes using the fresh ledger. Turn off the trial's override and remove only its accessibility membership if those were enabled. The captured initial secure state was accessibility_enabled=`0` with enabled_accessibility_services absent; preserve any newer household state rather than overwriting it. Sony `settings delete/list` lacks `--user`, so use the validated owner-context procedure above. Stock package enabled state was `0` (default), its MainActivity component override explicitly enabled, with a separate disabled AppLauncher and thirteen enabled-component overrides. Do not reset the whole component list.

Restore the stock preferred Home with `pm set-home-activity --user 0 com.google.android.tvlauncher/.MainActivity`; restore package/component enabled state only if this trial changed it. Resolve Home and verify physical Home/Settings/Inputs before removing a trial installation. Only uninstall `com.spocky.projengmenu` if the fresh ledger proves it was newly installed by this trial and stock recovery works; keep any pre-existing app/data intact. This is a prepared recovery sequence, not a verified physical rollback.

Use the automated comparison protocol as the default, preserving the same app launch/return paths and metric definitions; substitute the verified new Home component and label that difference. Do not treat its faster activity response as proof of faster visible navigation. In the next authorized live session, record the following observed results or explicit gaps:

- Ordinary Home and repeated Back exits from Netflix/current Max and other household apps; no sponsored rows or stock-home ad flash in normal return paths; all 13 app shortcuts remain accessible.
- Settings and Inputs access, keyboard, physical remote/Bluetooth, short/long volume and playback/audio; actual Chromecast start/stop from a household sender, distinct from passive discovery.
- Inputs chooser opening and HDMI-source selection → stable picture/audio separately, including Pi HDMI 1, return to the prior source and broadcast access. A shortcut may reduce menu steps; HDMI negotiation time is not established by activity timing and cannot be promised away by a launcher.
- Restart and standby/wake independently: persistent clean Home, no lost shortcuts/control paths, no unexpected app/input launch and working recovery. Capture technical boot/Home resolution separately from any optional observer evidence.

No owner stopwatch or target-selection questionnaire is required. Human-only observations are explicit gaps until available; app launch success cannot stand in for DRM playback, audio, actual casting or HDMI picture. U2's clean-Home and preserved-function acceptance remains pending until its live trial. Do not start U3 cleanup, artwork delivery or a custom launcher to bypass a failed trial.

### U2 preparation ledger

- [x] Official stable release and asset origin/size/digest checked locally.
- [x] Manifest SDK/architecture/features, permissions, Home/service components and resource labels inspected.
- [x] Official Android signature verification passed for API 28; signer fingerprint and broader-check warnings recorded.
- [x] Minimal app layout/static-control configuration, supported Home routes and exact-state recovery prepared.
- [x] Premium requirement/advertised external price documented; no purchase made.
- [ ] Live U2 acceptance: initial installation attempted and removed after settings/routing blockers; no accepted replacement Home remains.
- [ ] Clean Home/Back, app/playback/casting/controls/HDMI/restart/wake and physical recovery acceptance: unverified.

Documentation verification uses package/API/signature evidence, source checks, scoped review, private-file exclusions and diff hygiene. No build, application tests or lint apply to this documentation-only preparation. The current home network has no extender; moving the laptop between rooms on the same Wi-Fi does not call for a router/Pi configuration change. Preserve its fixed private MAC, reserved `192.168.0.20` and LAN reachability as documented in the updated historical recovery guide.

## U2 live attempt and stock restoration — 18 October 2026

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

### Minimal next step and remaining acceptance

The next visit needs a person with the physical Sony remote to open Projectivy from its normal app entry after a fresh reinstall, then enter **Settings → Projectivy settings → General** and establish whether the intended menu actually accepts remote input. That specific control check is the blocker; an ADB injection failure does not answer it. If it works, continue the prepared minimal layout and separately recorded Home-override trial with fresh restore state, without disabling stock Home. If it fails physically too, record that device-level evidence before choosing another release or launcher route.

No broad owner questionnaire, stopwatch work or timing-target selection is required. Clean default Home/Back, configured app shortcuts/static background, current Max verification, restart **and** standby/wake persistence under the replacement route, actual app/DRM/casting/audio/remote/keyboard operation and HDMI/Pi picture/latency remain unaccepted. U2 is unchecked; restoration success does not close its product requirements. U3 and all artwork work remain unstarted.
