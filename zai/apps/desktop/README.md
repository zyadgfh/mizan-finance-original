# Z-Ai — Desktop (Tauri 2)

A runnable Tauri 2 scaffold lives in `src-tauri/`. It wraps the same `/zai`
web build the browser and mobile apps use — no separate desktop-only UI code.

## Prerequisites

- Rust toolchain (`rustup`) and the platform-specific Tauri system
  dependencies (WebView2 on Windows, WebKitGTK on Linux, system WebKit on
  macOS) — see https://tauri.app/start/prerequisites/.
- `cargo install tauri-cli --version "^2"`.

## Dev

```
# Terminal 1 — from the repo root, serve the web app
npm run dev

# Terminal 2 — from zai/apps/desktop/src-tauri
cargo tauri dev
```

`tauri.conf.json`'s `build.devUrl` points at `http://localhost:8080/zai` so
the desktop shell loads the same live app as the browser.

## Build

```
# 1. Build the web app for production
npm run build   # from the repo root

# 2. Point tauri.conf.json's build.frontendDist at the built output
#    (e.g. ".vercel/output/static") or deploy it and set a remote URL.

# 3. From zai/apps/desktop/src-tauri
cargo tauri build
```

Produces native installers for Windows (`.msi`/`.exe`), macOS (`.dmg`/`.app`),
and Linux (`.deb`/`.AppImage`) depending on the host OS you build on (Tauri
cross-compilation has platform-specific requirements beyond this scaffold).

## Why Tauri over Electron

Tauri was named explicitly in the task; its native WebView (not a bundled
Chromium) keeps the installer far smaller, which matters for an app whose web
bundle is already budget-constrained (see `docs/architecture.md`).
