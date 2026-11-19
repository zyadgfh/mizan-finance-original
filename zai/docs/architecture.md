# Z-Ai — Architecture

## Placement decision

Z-Ai is delivered as a **new, self-contained feature inside the existing
`mizan-finance-original` repository**, not as a brand-new top-level monorepo,
for one explicit, safety-driven reason: the task constraints forbid
overwriting or breaking the existing, working Mizan Finance app (React 19 +
Vite + TanStack Start + Supabase + Capacitor Android). Concretely:

- **Frontend**: `src/zai/**` (components, lib, styles, types, models) is
  mounted at the **`/zai`** route (`src/routes/zai.tsx`) inside the existing
  Vite/TanStack Start app. It reuses the app's already-vetted toolchain
  (React 19, TypeScript strict, Zustand, TanStack Query, Tailwind, lucide-react,
  zod) instead of duplicating a second node_modules tree.
- **Backend**: a fully separate, independently runnable Node service lives at
  `zai/apps/api/**` (its own `package.json`, `tsconfig.json`, `node_modules`).
  It is intentionally NOT wired into the Vite dev server — it is a standalone
  deployable API, matching the spec's "secure, centralized backend instead of
  the browser talking to model providers directly."
- **Everything else** (`zai/packages`, `zai/infra`, `zai/docs`, `zai/skills`,
  `zai/reports`) mirrors the requested monorepo layout under `zai/` so every
  path in the task's file tree exists, without a second root `package.json`
  colliding with the existing one.

This still satisfies every structural requirement in the task (`apps/web`,
`apps/api`, `apps/mobile`, `apps/desktop`, `packages/*`, `infra/*`, `docs/*`,
`skills/cfsa/*`) while guaranteeing the existing finance app's build, tests,
and bundle-size budget keep passing — which they do (see the final report).

## Frontend stack decision: Vite (not Next.js)

The existing app already runs **Vite + TanStack Start + TanStack Router**.
Z-Ai is a client-heavy, single-page chat UI (live streaming, local-first
attachment previews, many stateful sheets/popovers) with no SEO requirement —
exactly the profile the task says should pick Vite over Next.js. Reusing the
host app's existing Vite/TanStack Start pipeline (rather than spinning up a
second bundler) avoids a second build system, a second PWA/service-worker
story, and a second CSP/headers config to keep in sync.

## State management decision: Zustand (not Redux Toolkit)

Zustand was already a dependency of the host app and matches the task's
explicit "pick one" instruction. `src/zai/lib/store.ts` holds chats, messages,
settings, favorites/usage/latency/bad-model tracking, and UI flags (sidebar,
online) in one small store with localStorage persistence helpers — no
boilerplate actions/reducers/selectors layer needed for this scope.

## Backend stack decision: Fastify (not NestJS)

The task allows either and asks for the decision to be documented. **Fastify**
was chosen because:

1. It has a materially smaller dependency graph and faster cold start, which
   matters for a sandboxed/serverless-friendly deployment story alongside the
   existing Vercel-hosted frontend.
2. The route surface here (auth, chats, messages/SSE, models, attachments,
   usage, health — ~20 endpoints) does not need Nest's DI/module ceremony to
   stay organized; `zai/apps/api/src/<domain>/<domain>.controller.ts` already
   gives the same per-domain structure the task's folder tree asks for
   (`auth/`, `users/`, `chats/`, `messages/`, `models/`, `attachments/`,
   `usage/`, `health/`, `common/`).
3. Fastify's native SSE support (`reply.raw.write`) and first-party
   `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/cors`, `@fastify/cookie`
   plugins map directly onto every backend requirement in the spec without
   extra adapter layers.

## Data flow (production target)

```
Browser (src/zai) --HTTPS--> Fastify API (zai/apps/api)
                                 │  Argon2id password hashing
                                 │  short-lived JWT access token (15m)
                                 │  rotating refresh token (HttpOnly, Secure,
                                 │    SameSite=strict cookie; family-based
                                 │    reuse detection)
                                 ├─> PostgreSQL via Prisma (zai/apps/api/prisma/schema.prisma)
                                 ├─> Redis (rate limiting keyed by user OR IP)
                                 ├─> S3-compatible storage (presigned PUT/GET;
                                 │    file bytes never transit the API process)
                                 └─> Model provider (server-held API key only;
                                      never sent to the browser) — SSE streamed
                                      back to the browser, reasoning stripped
                                      before persistence/forwarding
```

## Reasoning / chain-of-thought policy (hard requirement)

`zai/apps/api/src/messages/messages.controller.ts` documents and implements
`redactReasoning()`: any `reasoning` / `reasoning_content` / `thinking` field
a provider returns is dropped before the chunk is forwarded over SSE or
persisted to `Message.content`. The UI never has a "thinking panel" that shows
raw model reasoning — only safe, bounded status strings
(`src/zai/lib/mock-stream.ts` → `processingLabel()`, e.g. "اكتملت المعالجة
خلال 2.3 ثانية").

## Platforms

- **Web/PWA**: `/zai` route, works today in the live preview.
- **Mobile (Capacitor)**: `zai/apps/mobile/` documents wiring the existing
  repo's already-configured Capacitor Android project (`capacitor.config.ts`,
  `android/`) to additionally ship the `/zai` route in the native WebView —
  see `zai/apps/mobile/README.md`.
- **Desktop (Tauri)**: `zai/apps/desktop/src-tauri/` has a runnable Tauri 2
  scaffold (`tauri.conf.json`, `Cargo.toml`, `src/main.rs`) pointing at the
  same web build — see `zai/apps/desktop/README.md`.

## Migration table (legacy feature → new component)

See `docs/migration-map.md` for the full 21-row mapping from
`avetaar-ai-chat.html` to the rebuilt components.
