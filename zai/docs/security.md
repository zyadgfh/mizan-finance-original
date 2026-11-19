# Z-Ai — Security

## Threat-model summary

| Area | Control | Where |
|---|---|---|
| Secrets in frontend | None — provider API keys live only in the API process env (`MODEL_PROVIDER_API_KEY`) | `zai/apps/api/.env*` (never committed), `zai/.env.example` |
| Auth | Argon2id password hashing, 15-minute JWT access tokens, rotating opaque refresh tokens in HttpOnly+Secure+SameSite=strict cookies, reuse-detection revokes the whole token family | `auth/auth.service.ts`, `common/jwt.ts` |
| Session revocation | `POST /auth/logout` (this device), `POST /auth/logout-all` (all devices, revokes every `RefreshToken` row for the user) | `auth/auth.controller.ts` |
| CSRF | `SameSite=strict` on the refresh cookie + the access token is sent as a `Bearer` header (not a cookie), which is immune to classic CSRF since cross-site requests can't set custom headers | `auth/auth.controller.ts`, `common/auth-guard.ts` |
| Ownership / IDOR | Every chat/message/attachment route loads the row scoped by `req.userId` (derived from the verified JWT) and 404s (not 403) if it belongs to someone else — client-supplied `userId` is never trusted | `chats/chats.controller.ts::requireOwnership`, reused in `messages.controller.ts`, `attachments.controller.ts` |
| Model allowlist | Server rejects any `modelId` not in `models.catalog.ts`'s `MODEL_ALLOWLIST`, regardless of what the client sends | `models/models.catalog.ts`, enforced in `chats.controller.ts` and `messages.controller.ts` |
| System prompt | Bounded to 2000 chars server-side (`MAX_SYSTEM_PROMPT_CHARS`) and shown with an explicit security warning in `SettingsSheet.tsx` before it's ever sent | `messages/messages.controller.ts`, `src/zai/components/SettingsSheet.tsx` |
| Rate limiting | Global per-user/per-IP limiter (`@fastify/rate-limit` + Redis) plus a stricter bucket on the send/stream route | `common/rate-limit.ts` |
| Headers / CSP / CORS | Helmet with a real CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`), CORS restricted to `ALLOWED_ORIGINS` (never `*`) | `common/security.ts` |
| Attachments | Client + server MIME/extension/size allowlist (blocks `.svg`, `.exe`, `.js`, `.html`, …), presigned direct-to-storage upload (file bytes never pass through the API process), `scanStatus` gate before anything is referenced in a message | `src/zai/lib/files.ts`, `zai/apps/api/src/attachments/mime-allowlist.ts`, `attachments.controller.ts` |
| SSRF | The API never fetches an arbitrary client-supplied URL; attachment upload is client→storage via presigned URL, not server-fetched | `attachments.controller.ts` (see inline note) |
| Markdown/XSS | `marked` → `isomorphic-dompurify` pipeline; `<script>`, inline event handlers, `javascript:` URLs, iframes, and raw `<svg>`/`<math>` are all stripped. Covered by `src/zai/lib/markdown.test.ts` | `src/zai/lib/markdown.ts` |
| Backup import | Strict `zod` schema (`lib/backup.ts`) rejects malformed roles/status, oversized attachments, or a non-`z-ai` `app` field before anything touches the store | `src/zai/lib/backup.ts` |
| Logging | Pino logger redacts `Authorization` and `Cookie` headers; message content is never logged; audit events store action+metadata, never secrets or full message bodies | `main.ts` (`redact`), `schema.prisma::AuditEvent` |
| Reasoning / chain-of-thought | Never persisted or forwarded — see `architecture.md` "Reasoning policy" | `messages.controller.ts::redactReasoning` |
| No `window.alert/confirm/prompt` | Every confirmation/destructive action uses `ConfirmDialog.tsx` (focus-trapped, Escape-closable, explicit Cancel) | `src/zai/components/ConfirmDialog.tsx`, used throughout |

## Password hashing parameters

Argon2id, `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1` — OWASP's
current minimum recommendation for Argon2id (`auth/auth.service.ts`).

## Refresh-token rotation & reuse detection

Each refresh token is single-use: `rotateRefreshToken()` immediately marks the
presented token `revoked: true` and issues a new one in the same `familyId`.
If an already-revoked token is ever presented again (a strong signal of theft
— an attacker replaying a stolen token after the legitimate client already
rotated it), the **entire family** is revoked and an `auth.refresh.reuse_detected`
audit event is recorded.

## `/cfsa` — see `skills/cfsa/SKILL.md` and `security.md`'s sibling report

The latest run is at `zai/reports/cfsa/` and is summarized live in the app's
Security Center sheet (`src/zai/components/SecurityCenterSheet.tsx`).

## Known gaps / what still needs real infrastructure

These are **honestly reported**, not silently assumed away:

1. **No live PostgreSQL/Redis/S3 in this sandbox.** `prisma generate` could
   not download its query-engine binary (the sandbox's network allowlist does
   not include `binaries.prisma.sh`). The schema, migrations folder structure,
   and all query code are written and type-check against the Prisma client's
   bundled fallback types, but end-to-end DB behavior has not been exercised
   here — only `npx tsc --noEmit` (clean) on the whole `zai/apps/api` package.
2. **No model-provider credentials.** `messages.controller.ts`'s streaming
   loop is a clearly-labeled placeholder generator; the real provider call
   (with a server-held key, never shipped to the browser) is described
   in-code exactly where it plugs in.
3. **No Cloudflare zone credentials.** `/cfsa --scope cloudflare` is
   implemented (read-only GET calls only) but skips itself and says so in the
   report when `CF_API_TOKEN`/`CF_ZONE_ID` are unset — it never fabricates
   findings.
4. **CSP gap found by `/cfsa` itself**: the existing (pre-Z-Ai) `vercel.json`
   has no `Content-Security-Policy` header. This is reported as a real
   `HDR-CSP` (high) finding rather than silently patched, because adding a
   strict CSP to the live Mizan Finance production app (Google OAuth popup,
   Supabase, Google Fonts, GSAP) needs testing against that app's actual
   integrations first — see the fix plan in the latest `/cfsa` report.
