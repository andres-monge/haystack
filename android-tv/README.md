# Haystack TV screensaver

Native Android TV DreamService for Android 9 / API 28 and later. Package `dev.haystack.tv`, service `dev.haystack.tv/.HaystackDreamService`, version code 5 (`0.5-crossfade`). It displays the last accepted Haystack render with aspect ratio preserved and dark letterboxing. Final bitmap placement aligns to whole physical pixels; an odd spare pixel can make opposite margins differ by one pixel. An original built-in vector landscape appears when no valid cache exists. The system owns dream start/stop; the noninteractive dream dismisses on input and does not request a brightness override.

Newly accepted artwork fades in over two seconds with the same ease-in-out curve as the Pi kiosk. The outgoing frame stays opaque, and the incoming frame includes its letterboxing. Initial cached or first downloaded art appears immediately; repeated IDs and failed downloads leave the image unchanged. Rapid changes finish the prior destination before starting the next fade. Stop/detach cancels the animation and releases its image references. Two fitted Full HD ARGB images occupy 16,588,800 bytes during a fade; encoded/decoded candidates, queued delivery, renderer and framework memory are additional. A blocked UI retains only the latest undelivered candidate.

While dreaming, one background worker fetches the existing `GET /api/latest` contract immediately and then every 60 seconds after each completed attempt. The expected JSON contains `metadata.id` and `imageUrl: "/api/outputs/<id>"`. Only that same-origin image endpoint is accepted; redirects, foreign hosts/ports/schemes, queries and fragments are rejected. No request triggers generation. Stops/detaches cancel the session, disconnect HTTP and remove pending display callbacks; duplicate starts do not create another poller. A new session first loads cached artwork off the UI thread, independently of network availability.

Downloads are capped at 32 MiB (metadata at 64 KiB), images at 40 megapixels before decoding. PNG, JPEG and WebP containers must be complete and decode successfully. Bounds-first sampling retains at least the detail needed for the fitted image, then a filtered downscale produces at most 1920×1080 pixels (8,294,400 final bitmap bytes). Smaller sources are not enlarged. The intermediate sampled bitmap is bounded by 3840×2160 (33,177,600 bytes); the old visible image, encoded bytes and temporary fitted bitmap also contribute to process memory. HTTP connect/read timeouts are five seconds, with a 15-second elapsed read budget per response checked between reads; a blocking read can extend that budget by at most its five-second timeout. Failed requests keep the visible and durable last-good artwork, including when the same render ID fails repeatedly. An ID is accepted only after validated bytes and that ID are committed together in one versioned, SHA-256 checked app-private `AtomicFile` record. Interrupted replacements recover the preceding complete record. There is one retained render, unrelated to server retention; cache writes never alter server outputs.

`INTERNET` is the only requested permission. There is no launcher/viewer/settings activity, analytics, billing, receiver, scheduler outside the dream lifecycle or foreground service. The exported dream requires the framework signature permission `android.permission.BIND_DREAM_SERVICE`. Its label and `android.service.dream` XML metadata support normal screensaver discovery. The deliberate no-launcher manifest suppression applies only to `MissingLeanbackLauncher`.

The separately authorized Sony trial on 18 October 2026 passed normal selection, preview, natural idle entry and physical remote exit **for version 1's static fixture**. See the [Sony capability evidence and current configuration](../docs/tv-integration.md#accepted-sony-static-dream-capability--18-october-2026). The separately authorized version-2 Sony update subsequently reached actual artwork through natural idle and physical exit passed, but image quality failed because decoding undersampled the source. Version 3 corrected that detail loss, but physical quality remained unaccepted: Andrés found it better yet still less crisp than the same artwork on Pi HDMI 1. Version 4 aligns bitmap placement to whole pixels. Andrés accepted its quality and physical remote exit on the Sony; a same-session fixture check passed retained-last-good and same-ID retry freshness. Offline process recovery, post-dismissal request stopping, exact production restoration and an online device restart with natural artwork passed. Netflix’s six-minute normal playback/audio/no-screensaver result passed by owner report, corroborated by shorter metadata samples. The owner also passed the six-minute phone-sent Cast picture/audio/no-screensaver check; offline device reboot and a new v4 standby/wake trial were not combined into those passes. Scoped U6/U7 verification and handoff are complete; see the final requirement matrix and operating/recovery instructions in the integration guide. That paragraph records the v4 handoff; the v5 follow-up in the integration guide supersedes its reboot/wake coverage limits. No command in this document authorizes contact with the household TV.

## Mac origin

The default build pins `http://192.168.0.20:4321`. A build can select another explicit private/loopback IPv4 and port with `-PhaystackOrigin=http://192.168.0.20:4321`. DNS names, public IPs, credentials, paths, queries and fragments are rejected at build time. The generated Android network-security configuration permits cleartext only for that selected host (no subdomains); the client additionally pins the exact origin and presentation endpoint. LAN HTTP is not authenticated or encrypted; use this only on the existing trusted LAN.

For an **owned local emulator only**, build with `-PhaystackOrigin=http://10.0.2.2:62291` and run a fixture on the Mac's `127.0.0.1:62291`. This changes that build's selected host, rather than adding a permanent debug-wide cleartext exception. Rebuild without the override before preparing a LAN release. Never let a fixture smoke test contact the default production origin.

## Toolchain

Use JDK 17, Gradle 8.11.1 (included wrapper), Android Gradle Plugin 8.9.2, SDK platform 35 and Build Tools 35.0.0. Set `JAVA_HOME` to an actual JDK and `ANDROID_HOME` to your SDK, or use an ignored `local.properties` with `sdk.dir=...`. The distribution checksum is pinned in wrapper properties. Wrapper JAR SHA-256 from Gradle's official checksum endpoint:

`2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046`

Install SDK packages through Android Studio or the official SDK manager after reviewing its licences:

```sh
sdkmanager 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools'
```

The official command-line-tools 16.0 shell launchers mishandle paths containing spaces on this Mac. If encountered, invoke the same SDK manager Java entry point with quoted arguments:

```sh
"$JAVA_HOME/bin/java" -cp "$ANDROID_HOME/cmdline-tools/16.0/lib/*" \
  com.android.sdklib.tool.sdkmanager.SdkManagerCli \
  "--sdk_root=$ANDROID_HOME" 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools'
```

Production code has no third-party dependencies. JUnit/Robolectric and AndroidX are test-only dependencies pinned in the app build file. API-28 resource/manifest/render checks run on the JVM; Android instrumentation supplements those on an emulator.

## Signing and builds

Keep the **existing** update key and password outside Git, under `~/.haystack/android-signing/` on the preparation Mac. Back up both securely before relying on update continuity. Reuse that key for future updates and increment `versionCode`; generating a new key breaks update compatibility. The public certificate SHA-256 of the prepared release is:

`b53cfddf0d9cc37f70f8481e96d818ef2255d4c73dd456957f27cc39392ffd55`

On a different workstation, recover that key securely to preserve the identity. Only for an entirely new signing identity, create a separate private directory and key (do not overwrite the existing files):

```sh
umask 077
mkdir -p "$HOME/.haystack/android-signing"
test ! -e "$HOME/.haystack/android-signing/haystack-tv.p12" && \
  test ! -e "$HOME/.haystack/android-signing/password" && \
  openssl rand -base64 36 > "$HOME/.haystack/android-signing/password"
# Run keytool only when intentionally creating a new identity, never over an existing key.
"$JAVA_HOME/bin/keytool" -genkeypair -alias haystack-tv -keyalg RSA -keysize 3072 \
  -validity 10000 -storetype PKCS12 \
  -keystore "$HOME/.haystack/android-signing/haystack-tv.p12" \
  -storepass:file "$HOME/.haystack/android-signing/password" \
  -keypass:file "$HOME/.haystack/android-signing/password" \
  -dname 'CN=Haystack TV, OU=Local Signing, O=Haystack'
```

From `android-tv/`:

```sh
export HAYSTACK_TV_KEYSTORE="$HOME/.haystack/android-signing/haystack-tv.p12"
export HAYSTACK_TV_PASSWORD_FILE="$HOME/.haystack/android-signing/password"
./gradlew :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest :app:lint
"$JAVA_HOME/bin/java" -jar "$ANDROID_HOME/build-tools/35.0.0/lib/apksigner.jar" \
  verify --verbose --print-certs --min-sdk-version 28 --max-sdk-version 28 \
  app/build/outputs/apk/release/app-release.apk
```

Both signing paths must be set for a signed release. Without them Gradle produces an explicitly named unsigned release APK; do not install it. Debug uses Android's development certificate and is for emulator testing, not stable TV updates. The release verifier must exit 0 and print the expected certificate above. APK bytes may vary with build environment; source/toolchain reproducibility is not a claim of byte-identical APKs.

Build outputs, APKs, SDKs, local settings and signing material stay ignored or outside the repository. Do not put passwords in command arguments or commit private evidence. Inspect the release manifest, selected origin/network policy, version and signing certificate when changing capabilities. Version 1 was roughly 11 KB; version 2 includes networking and cache code.

## Local emulator verification

On Apple Silicon, the official API-28 Android TV image is x86-only. Use an ARM64 Android TV emulator (API 31 was used here) for framework smoke tests, while retaining API-28 JVM checks. This is not Sony Android-9 runtime proof.

For a **local emulator only**, install the official emulator and `system-images;android-31;android-tv;arm64-v8a`, create a `tv_1080p` AVD and boot it. Use an explicitly selected `emulator-*` serial. Never substitute the TV's network address, run `adb connect`, or let a connected-test command choose an arbitrary device.

```sh
# Example only: confirm this serial belongs to your local emulator first.
export ANDROID_SERIAL=emulator-5580
case "$ANDROID_SERIAL" in emulator-*) ;; *) echo 'Local emulator required'; exit 1 ;; esac
test "$(adb -s "$ANDROID_SERIAL" shell getprop ro.kernel.qemu | tr -d '\r')" = 1 || exit 1
./gradlew :app:connectedDebugAndroidTest
```

Instrumentation checks installed framework discovery and permission protection. If this disposable emulator already contains the release-signed fixture, uninstall `dev.haystack.tv` from that emulator before installing the differently signed debug build; otherwise Android rejects the update with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. The test runner may remove its test app after completion. This is an emulator preparation step only. A separate emulator-only selection/preview/screenshot/input-exit smoke test exercises the real dream window; forced preview is not natural-idle evidence. Emulator results alone leave Sony selection, natural idle, physical remote, restart/wake and active-playback checks pending. The separately authorized Sony static capability result is recorded above; its five-minute screensaver delay is an explicit user-approved final configuration. The local version-2 implementation below does not extend the accepted static Sony capability result into U6 acceptance.

## Recorded U2 local verification

On 18 October 2026, debug and signed release builds, four Robolectric cases (API 28/35), lint and the API-28/all-supported-platform signature checks passed. Lint retains three warnings: two newer test dependencies and Android-12 data-extraction rules for this stateless `allowBackup=false` fixture. All five checks in the plan's build/instrumentation command set passed in the final combined run. One instrumentation test passed on ARM64 Android TV API 31 (`emulator-5580`, qemu verified). A separate signed-release framework preview showed the intended 1920×1080 art and exited on D-pad center. Raw logs and screenshots remain private/ignored. These results establish local preparation only. The subsequent Sony static capability pass has separate device and human evidence; it does not extend these emulator results into playback, restart/wake or refreshed-artwork acceptance.

## Recorded U4 local verification

On 18 October 2026, repository/cache tests were added and run before production implementation; the expected missing-class compilation failure was captured privately. The resulting 19 Robolectric cases cover API-28/35 cache recovery from an abandoned real AtomicFile replacement, PNG/JPEG/WebP decoding and measured sampled bitmap allocation, oversized/truncated/corrupt data, the 40 MP bound, same-ID retry after purge/corruption, empty latest, foreign URLs/redirects, HTTP timeout, duplicate starts, cancellation and offline cache-first display. Debug and stable-key signed release builds and lint passed (zero errors, one data-extraction-rules warning). API-28 release signature verification passed with the existing certificate above.

Two instrumentation cases passed on an owned ARM64 Android TV API-31 emulator: protected framework discovery and interrupted atomic-record recovery. These checks do not stand in for Sony Android-9 runtime acceptance. An uninterrupted actual emulator dream retained A on B’s HTTP 404, retried the unchanged B ID, and visibly showed valid B within 61.63 seconds of successful publication. After force-stop (new process PID), offline cold start displayed cached B; without cache it displayed the built-in landscape. After input dismissal there were no further fixture requests for 65 seconds. Request timestamps, dream tokens and screen captures support those observations; forced emulator preview does not establish natural idle or household playback behavior. Raw fixture servers, images, request logs and screen captures stay ignored under `tv-local/`.

## Recorded v5 Sony follow-up

Version 5 adds the Pi-style two-second fade. All 39 JVM cases, debug/release and lint passed; independent Opus review completed with no retained findings (low requested, actual effort unverified). Andrés accepted the transition as smooth. An isolated Sony fixture trial passed followed by a real offline-device reboot with natural cached artwork; the exact production APK was restored and verified. Injected standby/wake and natural current artwork then passed, with the settled 1920×1065 image aligned at y=8. The final production SHA-256 is `2ecf42870e216c191d0036e77a6188f41104602ecdea5b989cd24736068585bc`, signed by the existing certificate, with origin `http://192.168.0.20:4321`.

Actual fixture transition PSS peaked at a sampled 29,909 KiB and settled near 21,611 KiB; this is not a worst-case or whole-GPU bound. Native video capture was unusable, so no hardware frame-duration measurement is claimed. Earlier v4 human physical exit and Netflix/Cast playback passes were not repeated for v5. See the final v5 integration record for precise evidence, operational recovery and remaining limits.

Final normal-UI inspection found Continue Watching already populated, master channels and launcher override on, usage reporting off and crash reporting on. Home showed only TV apps, Continue Watching and Inputs. No launcher preference was changed and no history item launched; the cause of its earlier absence is unknown. All fixture/watchdog processes exited and ADB was disconnected before host-only documentation wrap-up. The owner reported turning the TV off; no reconnection or wake was needed. The optional Home idle UI-opacity setting remains unchanged.
