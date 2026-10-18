# Haystack TV static dream fixture

U2 capability fixture for Android TV, Android 9 / API 28 and later. Package `dev.haystack.tv`, service `dev.haystack.tv/.HaystackDreamService`, version code 1. This is an original static vector landscape, displayed with aspect ratio preserved and dark letterboxing. The system owns dream start/stop; the noninteractive dream dismisses on input. It does not request a brightness override.

There is no launcher/viewer activity, network permission/client, artwork cache, analytics, billing, receiver, scheduler or foreground service. The exported dream requires the framework signature permission `android.permission.BIND_DREAM_SERVICE`. Its label and `android.service.dream` XML metadata support normal screensaver discovery; there is no settings activity. The deliberate no-launcher manifest suppression applies only to `MissingLeanbackLauncher`.

This fixture does not prove Sony selection, natural idle, remote exit, playback protection or hourly art delivery. Follow the [live gate and recovery sheet](../docs/tv-integration.md#future-live-sheet-independent-home-and-dream-results). No command here authorizes contact with the household TV.

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

Build outputs, APKs, SDKs, local settings and signing material stay ignored or outside the repository. Do not put passwords in command arguments or commit private evidence. The fixture should be roughly 11 KB; inspect the release manifest and DEX when changing capabilities.

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

Instrumentation checks installed framework discovery and permission protection. If this disposable emulator already contains the release-signed fixture, uninstall `dev.haystack.tv` from that emulator before installing the differently signed debug build; otherwise Android rejects the update with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. The test runner may remove its test app after completion. This is an emulator preparation step only. A separate emulator-only selection/preview/screenshot/input-exit smoke test exercises the real dream window; forced preview is not natural-idle evidence. Leave Sony-only selection, natural idle under unchanged policy, physical remote, restart/wake and active-playback checks pending until separately authorized. The fixture does not implement U4 networking/cache or U6 refreshed artwork.

## Recorded U2 local verification

On 18 October 2026, debug and signed release builds, four Robolectric cases (API 28/35), lint and the API-28/all-supported-platform signature checks passed. Lint retains three warnings: two newer test dependencies and Android-12 data-extraction rules for this stateless `allowBackup=false` fixture. All five checks in the plan's build/instrumentation command set passed in the final combined run. One instrumentation test passed on ARM64 Android TV API 31 (`emulator-5580`, qemu verified). A separate signed-release framework preview showed the intended 1920×1080 art and exited on D-pad center. Raw logs and screenshots remain private/ignored. These results establish local preparation only; every Sony/live acceptance gate remains pending.
