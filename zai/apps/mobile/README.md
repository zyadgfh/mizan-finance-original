# Z-Ai — Mobile (Capacitor)

This repo already ships a configured Capacitor Android project at the repo
root (`capacitor.config.ts`, `android/`). Z-Ai does **not** need a second
Capacitor project — the `/zai` route is part of the same web build that the
existing app already packages for native.

## Build & sync

```
npm run build:native     # builds the web app (incl. /zai) into native-dist/
npx cap sync android      # copies native-dist/ into the Android project
```

Then open `android/` in Android Studio to run on a device/emulator, or
`npx cap run android` for a quick device run.

## iOS

An iOS platform is not yet added to this repo. To add it:

```
npm install @capacitor/ios
npx cap add ios
npm run build:native && npx cap sync ios
```

## Mobile-specific Z-Ai behavior already implemented

- Model picker / chat actions / message actions / settings / search / trash /
  share / export / security-center all switch to bottom sheets with a grabber
  and swipe-to-dismiss below 768px (`src/zai/components/Sheet.tsx`).
- Sidebar becomes an off-canvas RTL-aware drawer on mobile widths.
- `--zai-safe-b`/`--zai-safe-t` respect the device's safe-area insets
  (notch/home-indicator) via `env(safe-area-inset-*)`.
- Arabic dictation uses the device's native Web Speech API inside the
  Capacitor WebView where supported; it degrades to a disabled mic button
  with a toast otherwise (never a crash).
