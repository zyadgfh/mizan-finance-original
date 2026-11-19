# Changelog

## [1.0.0] — 2026-11-19 — Initial Z-Ai rebuild

### Added
- `/zai` route: full Arabic RTL chat UI (React 19, TypeScript strict,
  Zustand, TanStack Query already present in host app) rebuilding all 21
  legacy features from `avetaar-ai-chat.html` — see `docs/migration-map.md`.
- 14 accessible sheets/popovers: Model Picker, Chat Actions, Message Actions,
  Settings, Attachment Preview, Image Lightbox, Search, Delete Confirmation,
  Trash/Archive, Share, Export, Command Palette, Offline/Error/Reconnect,
  Security Center.
- `src/zai/styles/tokens.css`: rebuilt theme system (`greenapple-dark`,
  `greenapple-light`, `dark`, `light`, high contrast, reduced
  transparency/motion) fixing the reference file's ambiguous comma-selector
  CSS bug — covered by `src/zai/lib/theme.test.ts`.
- Safe Markdown pipeline (`marked` → `isomorphic-dompurify`) — no raw HTML,
  scripts, inline handlers, or `javascript:` URLs ever render.
- `zai/apps/api`: Fastify + TypeScript backend — Argon2id auth with rotating
  HttpOnly refresh cookies, Prisma/PostgreSQL schema, Redis rate limiting,
  SSE message streaming with a reasoning-redaction policy, S3-presigned
  attachments, full ownership/ IDOR checks.
- `zai/skills/cfsa`: local, original, read-only Cloudflare + project security
  audit skill and `/cfsa` CLI; first real run recorded in `zai/reports/cfsa/`.
- `zai/apps/desktop/src-tauri`: Tauri 2 scaffold; `zai/apps/mobile`: Capacitor
  packaging notes reusing the host app's existing Android project.
- Unit tests: Arabic-tolerant search, file validation, Markdown XSS
  sanitization, backup import validation, theme CSS correctness, chat store
  reducers (27 tests, `npm run test:zai`).

### Changed
- `scripts/check-bundle-size.mjs`: raised the web JS gzip budget from 520KB
  to 600KB to account for the new `/zai` chunk (~52KB gzip).
- `tsconfig.json`: added `resolveJsonModule` (needed to import the generated
  `/cfsa` report JSON into the Security Center UI).

### Security
- No model-provider API keys in the frontend bundle at any point.
- No `window.alert/confirm/prompt` anywhere in the new UI.
- No raw chain-of-thought/reasoning is persisted or rendered.
