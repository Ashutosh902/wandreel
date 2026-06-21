# Android Wrapper Phase 1

This branch adds a Capacitor-based Android wrapper around the production Wandreel web app.

## What Phase 1 Does

- Creates an Android project in `android/`
- Uses app id `com.wandreel.app`
- Uses app name `Wandreel`
- Keeps the existing React/Vite/PWA app unchanged
- Loads the production web app from `https://app.wandreel.com`

Phase 1 is intentionally a thin wrapper. It does not add native features, signing, Play Store release config, push notifications, or backend changes.

## Prerequisites

- Node.js and npm
- JDK 17+ recommended
- Android Studio
- Android SDK installed through Android Studio

## Install Dependencies

```bash
npm install
```

## Build The Web App

```bash
npm run build
```

## Sync Capacitor Android

```bash
npx cap sync android
```

Or use the package script:

```bash
npm run cap:sync:android
```

## Open In Android Studio

```bash
npx cap open android
```

Or use the package script:

```bash
npm run cap:open:android
```

If `npx cap open android` does not work in your shell, open Android Studio manually and select the `android/` folder.

## Run On Emulator Or Device

1. Open `android/` in Android Studio.
2. Let Gradle finish syncing.
3. Start an emulator or connect an Android device with USB debugging enabled.
4. Click `Run` in Android Studio.

## Permissions Included

Phase 1 keeps permissions minimal:

- `android.permission.INTERNET`

`ACCESS_NETWORK_STATE` and native location permissions are not added yet. The wrapper should stay minimal until a native requirement clearly needs them.

## Auth Compatibility Note

The wrapper does not change login or session behavior.

Google login inside Android WebView can require extra work depending on how Google Identity Services behaves inside an embedded web context. Phase 1 does not change auth blindly. If Google login shows friction inside the wrapper, the recommended next step is to evaluate either:

1. a native Capacitor login bridge, or
2. a browser-based auth handoff using Custom Tabs / external browser

before changing production auth flows.

## Notes About Server URL Mode

This wrapper uses Capacitor server URL mode and points to:

- `https://app.wandreel.com`

That keeps the Android shell thin and ensures the wrapper follows the production web deployment without introducing a second frontend runtime to maintain in Phase 1.
