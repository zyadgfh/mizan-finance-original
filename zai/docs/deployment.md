# Z-Ai — Deployment

## Frontend (`/zai` route)

Already part of the existing Mizan Finance Vercel deployment — no separate
deploy step. `npm run build` (repo root) builds it alongside the rest of the
app into `.vercel/output`. Confirm `npm run build` passes the bundle-size
check (`scripts/check-bundle-size.mjs`) before shipping; the Z-Ai route raised
the web JS budget from 520KB to 600KB gzip — see `docs/architecture.md`.

## Backend (`zai/apps/api`)

1. `cd zai/infra && docker compose up -d` — starts Postgres, Redis, and MinIO
   (S3-compatible) for local dev.
2. `cd zai/apps/api && cp ../../.env.example .env` and fill in real secrets
   (see `.env.example` below — nothing in this repo contains a real secret).
3. `npm install && npm run prisma:generate && npm run prisma:migrate`.
4. `npm run dev` (tsx watch) locally, or `npm run build && npm start` in
   production.
5. Put the API behind TLS (`zai/infra/nginx/zai.conf` is a worked example) —
   the SSE route needs `proxy_buffering off` and a long `proxy_read_timeout`.
6. Set `ALLOWED_ORIGINS` to the exact production frontend origin(s) —
   never `*`.
7. Point `DATABASE_URL`/`REDIS_URL` at managed Postgres/Redis in production
   (e.g. Supabase Postgres — already a connected app for this project — or
   RDS/Cloud SQL, plus Upstash/Elasticache for Redis).
8. Configure `S3_ENDPOINT`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`
   for attachments (any S3-compatible provider: AWS S3, R2, MinIO, Backblaze).

## Mobile (Capacitor)

See `zai/apps/mobile/README.md`. Summary: the existing repo's
`capacitor.config.ts`/`android/` project already builds the whole web app
(including `/zai`) into a native WebView shell — `npm run build:native &&
npx cap sync android`, then open in Android Studio.

## Desktop (Tauri)

See `zai/apps/desktop/README.md`. Summary: `cargo install tauri-cli --version
"^2"`, then `cd zai/apps/desktop/src-tauri && cargo tauri dev` /
`cargo tauri build` once `tauri.conf.json`'s `build.devUrl`/`frontendDist`
point at the deployed (or locally running) web build.

## `/cfsa` in CI

Add a scheduled job (e.g. weekly) that runs:

```
node zai/skills/cfsa/scripts/cfsa.mjs --scope project --report markdown --fix-plan
```

and uploads `zai/reports/cfsa/*.md` as a build artifact. Add `CF_API_TOKEN`/
`CF_ZONE_ID` as CI secrets (never checked into the repo) to additionally
enable `--scope cloudflare`.

## Rollback

- Frontend: standard Vercel instant rollback to the previous deployment.
- Backend: Prisma migrations are additive-first; `prisma migrate deploy` is
  idempotent. Keep `RefreshToken`/`AuditEvent` tables append-only so a
  frontend rollback never orphans sessions.
