# Z-Ai

Arabic RTL AI chat — a production rebuild of the reference single-file app
`avetaar-ai-chat.html`, with a secure backend, PWA, mobile and desktop
packaging, accessible UI (14 required sheets/popovers), Markdown XSS
protection, and a defensive `/cfsa` security-audit skill.

**This folder (`zai/`) holds the backend, infra, docs, and the `/cfsa` skill.
The actual frontend lives in the host repo at `src/zai/` and is mounted at
the `/zai` route of the existing Mizan Finance Vite app — see
`docs/architecture.md` for exactly why, and `../src/zai/README.md` for the
frontend-specific guide.**

## Quick start

```bash
# Frontend (from the repo root, NOT this folder)
cd /home/user/mizan-finance-original
npm install
npm run dev              # http://localhost:8080/zai

# Backend (separate terminal)
cd zai/infra && docker compose up -d
cd ../apps/api && cp ../../.env.example .env   # fill in real values
npm install
npm run prisma:generate && npm run prisma:migrate
npm run dev               # http://localhost:4000
```

## Project map

| Path | What |
|---|---|
| `../src/zai/` | React frontend (mounted at `/zai` in the host app) |
| `apps/api/` | Fastify + TypeScript + Prisma/PostgreSQL + Redis backend |
| `apps/mobile/` | Capacitor Android/iOS packaging notes (reuses the host app's existing Capacitor project) |
| `apps/desktop/src-tauri/` | Tauri 2 desktop shell scaffold |
| `packages/types/` | Shared TS contracts (mirrors `src/zai/types.ts`) |
| `packages/markdown/` | Shared safe-Markdown pipeline (mirrors `src/zai/lib/markdown.ts`) |
| `packages/ui/` | Shared accessible dialog/sheet primitive (mirrors `src/zai/components/Sheet.tsx`) |
| `infra/` | `docker-compose.yml` (Postgres/Redis/MinIO), example nginx SSE config |
| `skills/cfsa/` | The `/cfsa` defensive security-audit skill |
| `reports/cfsa/` | Generated audit reports (markdown + JSON) |
| `docs/` | architecture, security, apple-design-review, deployment, api, migration-map |

## Tests, lint, build

Run from the **repo root**:

```bash
npm run typecheck   # whole repo, incl. src/zai
npm run lint         # whole repo, incl. src/zai
npm run test:zai     # unit tests for src/zai/lib/*
npm test             # full repo suite (includes test:zai)
npm run build        # production build incl. the /zai route + bundle-size check
```

Run from `zai/apps/api/`:

```bash
npm run typecheck    # tsc --noEmit (passes without a live DB)
```

## `/cfsa`

```bash
node skills/cfsa/scripts/cfsa.mjs --scope project --report markdown --fix-plan
```

See `skills/cfsa/SKILL.md` for the full command surface and safety rules.
