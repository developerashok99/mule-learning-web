# Mule Learning Hub — Android app

A personal study app for the MuleSoft course: the same lessons, notes, slides, flashcards and progress as the website, bundled on the phone so it works offline, plus **podcast audio downloads for listening without internet**.

## How it is built

- **Capacitor 8**, in this repository. The website (Astro) is built a second time for the app (`npm run build:app` → `dist-app/`, served from the app's root) and packaged into the APK. There is one source of content: the synced notes and `config/*.json` produce both the website and the app, and a new lesson or episode appears in both after the next build.
- **Why Capacitor:** the study site already has the reading, revision, search and progress features, and Capacitor reuses all of them. Native plugins add what a browser can't do: storing audio files, playing them in the background, lock-screen controls and the back button. A separate native app would duplicate hundreds of lesson pages for no gain.
- **What is bundled (82 MB of web content, 35 MB APK):**
  - every lesson's three levels of notes, revision pages and the 465 flashcards;
  - the glossary and the search index (Pagefind), so search works offline;
  - 560 px slide thumbnails, also used for the images inside the notes.
- **What stays online:**
  - full-size slide images (171 MB). The slide viewer falls back to the thumbnail when offline.
  - lecture videos and video podcasts (YouTube).
  - podcast audio, until you download it.

### App-specific behaviour

| | Website | App |
|---|---|---|
| Bottom tabs | Home · Courses · Videos · Audio · My Study | Home · Courses · **Review** · Audio · My Study (Review works offline; videos need the internet) |
| Podcast audio | streams | streams, or **downloads** to the phone |
| Offline pages | pages you opened before (service worker) | everything bundled; no service worker |
| Study progress | browser localStorage | WebView localStorage, **mirrored to native storage** and restored if the WebView data is cleared |

## Offline audio

- **Source:** the 60 full-episode MP3s (64 kbps, 298 MB in total) are assets of the GitHub release [`podcast-audio-v1`](https://github.com/developerashok99/mule-learning-web/releases/tag/podcast-audio-v1). They are listed in `config/media.json` (`audioUrl`, `audioBytes`). These are the same narration as the video podcasts. YouTube videos are never downloaded.
- **Storage:** `Directory.Data/podcasts/<id>.mp3`, the app's private files folder, removed when you uninstall the app. Download records (state, size, file) are kept in native Preferences, not localStorage.
- **Download manager** (`src/lib/downloads.ts`, platform-independent and unit-tested in `tests/unit/downloads.test.ts`):
  - **Queue:** at most 2 downloads at a time; the others wait in order. You choose each episode; nothing downloads on its own.
  - **Progress:** shown in percent and MB.
  - **Integrity:** a file is downloaded to `<id>.part` and renamed to `<id>.mp3` only after its size matches the expected size. A file with the final name is always complete.
  - **Interruptions:** a download cut off by closing the app shows as failed with **Retry** the next time the app starts, and its partial file is removed. A finished file that has disappeared is forgotten.
  - **Errors:** offline ("No internet connection. Connect, then tap Retry."), out of storage, file missing on the server, and incomplete downloads.
  - **Cancel:** a queued download stops at once. A running download can't be stopped mid-transfer on Android, so it finishes in the background and is then discarded.
  - **Delete:** refused while the episode is downloading or playing. Asks for confirmation and shows the size it frees.
  - **Storage used:** shown on the Downloads page.
- **Playback:** a downloaded episode plays from `Capacitor.convertFileSrc(<file uri>)`, the WebView's local file server, so no network request is made. The player keeps each episode's position, the last episode and the speed, as on the website. Lock-screen and notification controls (play, pause, back 10 s, forward 30 s, previous, next, seek) come from `@capgo/capacitor-media-session`. Its foreground service keeps audio playing with the screen off.

## Build the debug APK

Requirements: Node 22, **JDK 21** (with `javac`), and the Android SDK with platform 36 and build-tools 36.

```bash
# one time
export JAVA_HOME=~/.jdks/jdk-21.0.12.1+1          # any JDK 21
export ANDROID_HOME=~/Android/Sdk
npm ci
npm run sync                                        # notes → .notes/, public/notes-assets/

# every build
npm run app:apk                                     # build:app + cap sync + gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

The GitHub Action **Android APK** (`.github/workflows/android.yml`) builds the same APK on GitHub's machines and attaches it to the run as a downloadable artifact.

## Install on your phone

1. Copy `app-debug.apk` to the phone: USB, Google Drive, or download it from the Actions run or the release.
2. Open it. Android asks to allow installing from that source (Files or Chrome); allow it once.
3. Or, with USB debugging on: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.

On Android 13 and later, allow notifications when asked. They're used only for the playback controls.

A debug APK is signed with a debug key that Android Studio and Gradle create on each computer. Installing a build from a different computer over an existing one fails ("signature conflict"); uninstall first, which deletes downloads and progress, or use a release build.

## Release build

1. Create a signing key once, and keep it out of git:
   `keytool -genkeypair -v -keystore ~/mule-release.jks -alias mule -keyalg RSA -keysize 4096 -validity 10000`
2. Add to `~/.gradle/gradle.properties` (not the repo): `MULE_STORE_FILE=/home/you/mule-release.jks`, `MULE_STORE_PASSWORD=…`, `MULE_KEY_ALIAS=mule`, `MULE_KEY_PASSWORD=…`.
3. Add a `signingConfigs.release` block to `android/app/build.gradle` that reads those properties, then run `cd android && ./gradlew assembleRelease`.

## iOS

The code is platform-independent (Capacitor, Filesystem, Preferences and the media-session plugin all support iOS), but building needs macOS with Xcode, an Apple ID, and a signing team. There is no iOS project in this repository yet. On a Mac: `npx cap add ios && npm run build:app && npx cap sync ios && npx cap open ios`, then set the signing team in Xcode and run it on the phone.

## Limitations

- **Lecture videos and video podcasts** need the internet (YouTube). The app never downloads YouTube videos.
- **Free storage space** isn't available to the web layer, so the app shows the space its downloads use, not how much is left.
- **A running download can't be paused or stopped mid-transfer** (Android's download API has no abort). Cancel discards it when it ends.
- **Old Android WebViews:** the app needs a current Android System WebView (Chrome 111 or later, updated through the Play Store). Very old WebViews show some colours incorrectly.
- **Progress stays on one device.** Use My Study → Back up / Restore to move it between the app and a browser.
