# MIZAN — P0 CLIENT RELEASE PLAN

*ملخّص عربي: هذه خطة النصف الثاني من P0 — الجزء الذي يعيش داخل التطبيق نفسه (واجهة العميل)، ولا يمكن
لقاعدة البيانات إصلاحه: الـhandshake بين إصدار المخطط والعميل، وسياسة CSP، وتسجيل المصادقة الثنائية
(MFA)، وإخراج أسرار Google Drive من `localStorage`، وإصدار ثانٍ من مغلّف النسخ الاحتياطي، وإدارة
الجلسات والأجهزة. الخطة **لا تتضمن كتابة كود الآن**، وتحتاج موافقة منفصلة.*

Audit date 2026-11-16 · base commit `fe0b3c2…` · companion to `P0_REMEDIATION_PLAN.md` (server half).
**No code was written and no repository file was changed.** This document is a specification for work that
requires authorization.

---

## 1. Why a client release is needed at all

The server half of P0 (`p0_drafts/01–08`) repairs sync, tombstones, rate limiting, audit authorship and
grants **without touching the app**, because the deployed outbox contract already matches the hardened RPC
(`src/lib/tenant/storage.ts:245-305` ↔ repo RPC body). But four confirmed findings can only be closed in the
client, and one class of failure — *silent* client/server mismatch — can only be prevented in the client.

| Finding | Closed by |
|---|---|
| F-01/F-02 recurrence (a future schema change silently breaks sync again) | C1 handshake |
| F-15 no CSP | C2 |
| F-13 no MFA enrolment, weak session UX | C3, C6 |
| F-14 Drive passphrase + OAuth token in `localStorage` | C4 |
| F-16 backup envelope lacks version/checksum, destructive import, no undo | C5 |
| Code-health debt (unused scaffolds confuse review and widen attack surface) | C7 |

Sequencing rule: **server steps S1–S8 first, client release second.** The old client tolerates extra
columns; the new client must never meet a database that lacks them.

---

## 2. Work items

### C1 · Schema handshake (the single highest-value client change)
* **Problem.** The deployed client assumes `tenant_records.revision`; the database did not have it. Nothing
  detected the mismatch, so sync failed per-device with no user-visible diagnosis. This is the defect that
  produced the audit's worst finding.
* **Design.**
  1. Server exposes `public.schema_health()` → `{ schema_version int, revision_cursor boolean, deployed_at }`
     (tiny `SECURITY DEFINER` function, execute to `anon`+`authenticated`; drafted as part of S2 follow-up).
  2. Client holds `const REQUIRED_SCHEMA_VERSION = N` next to the sync code.
  3. On first sync per session: call `schema_health()`; if `schema_version < REQUIRED` → **do not sync**;
     keep the outbox intact; show a blocking-but-graceful banner ("التطبيق يحتاج تحديثاً — بياناتك محفوظة
     على هذا الجهاز"); emit a `sync.blocked_schema` telemetry event.
  4. If the *server* is older than the client expects, same path (this is the case that would have caught
     F-01 on day one).
* **Files.** `src/lib/tenant/api.ts` (new `assertSchemaCompatible()` called at the top of
  `syncTenantWithSupabase`), `src/components/finance/screens.tsx` or `app.tsx` (banner + retry),
  `src/lib/tenant/types.ts` (`SchemaHealth`), new test `src/lib/tenant/schema-handshake.test.ts`.
* **Tests.** Unit: matrix of (clientVersion, serverVersion) → {proceed, block}; E2E: stub a `schema_health`
  response one version behind → sync blocked, outbox unchanged, no data loss, banner visible.
* **Acceptance.** With a deliberately drifted staging database, the app refuses to sync, reports it, and
  preserves every queued operation. **Effort:** 3–5 days.

### C2 · Content-Security-Policy and security headers
* **Problem.** `vercel.json` sets `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS,
  COOP — **no `Content-Security-Policy`**; `index.html` has no meta CSP; the Android WebView has none. With
  the Drive passphrase in `localStorage` (C4), an XSS escalates from "annoying" to "all backups exfiltrated".
* **Design.** Ship report-only for one release with a report sink, then enforce:
  `default-src 'self'; script-src 'self' https://accounts.google.com; connect-src 'self'
  https://kpgszjnjmmosvrlujvkj.supabase.co wss://kpgszjnjmmosvrlujvkj.supabase.co
  https://www.googleapis.com https://accounts.google.com; img-src 'self' data: blob:;
  style-src 'self' 'unsafe-inline'; frame-src https://accounts.google.com; font-src 'self' data:;
  object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`.
  Mirror it as a `<meta http-equiv>` for the Capacitor build (WebView serves local assets, so `'self'`
  covers them) and add the same header via Vercel.
* **Files.** `vercel.json` (deployment config — modifying it needs explicit approval), `index.html`,
  a small `scripts/check-csp.mjs` guard.
* **Tests.** Playwright: zero CSP violations (console listener) across sign-in, ledger edit, CSV import,
  report print, Drive connect; injected `<img onerror>` payload blocked.
* **Acceptance.** Enforced policy, zero violations on the 6 critical flows, print window still works.
  **Effort:** 2–3 days + 1 release of observation.

### C3 · MFA enrolment and enforcement
* **Problem.** TOTP is enabled at the project level, but no screen enrols or challenges it; a 6-character
  password is the only barrier, and a platform admin has no second factor.
* **Design.** `auth.mfa.enroll()` → QR + secret + 6-digit challenge → `auth.mfa.challengeAndVerify()`; store
  the factor list per user; add "المصادقة الثنائية" to `security-screen.tsx`; prompt unenrolled
  `owner`/`admin` roles once per session; require it for `platform_admins`; recovery codes generated locally
  and downloadable.
* **Files.** `src/components/finance/security-screen.tsx`, `src/lib/auth/mfa.ts` (new wrapper over
  `supabase.auth.mfa`), `src/components/finance/auth-screen.tsx` (challenge step after password).
* **Tests.** Unit: enrolment state machine incl. failure/expiry; E2E: enrol → sign out → sign in requires
  code → wrong code rejected → recovery code works.
* **Acceptance.** An admin account cannot complete sign-in without a second factor once enrolled; recovery
  codes verified. **Effort:** 5–7 days.

### C4 · Move Drive secrets out of `localStorage`
* **Problem.** `getDriveEncryptionPassphrase`/`setDriveEncryptionPassphrase` and the GIS token cache
  (`src/lib/sync/google-drive-gis.ts:133-190`) persist long-lived secrets in script-readable storage.
* **Design.** Passphrase → in-memory for the session, re-prompted for each scheduled backup (with "remember
  for this session" as the maximum). Access token → memory only; refresh via GIS on demand. Never write
  either to `localStorage`; migrate by clearing existing keys on first run with a one-time explanation.
* **Files.** `google-drive-gis.ts`, `drive-sync.ts`, `drive-sync-screen.tsx` (prompt UX).
* **Tests.** Unit: storage never receives the passphrase/token (spy on `localStorage`); E2E: connect Drive,
  reload, confirm re-prompt and no secrets in storage.
* **Acceptance.** `localStorage` and `sessionStorage` contain no passphrase and no token after any flow.
  **Effort:** 2–3 days.

### C5 · Backup envelope v2, non-destructive import, pre-import snapshot
* **Problem.** Exports carry no version, timestamp, tenant id or checksum; import overwrites local state with
  no preview and no undo; encryption is opt-in and unprompted.
* **Design.**
  1. Envelope: `{ formatVersion: 2, schemaVersion, tenantId, exportedAt, counts, checksum: sha256(canonical
     payload), cipher: {alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations} | null, payload }`.
  2. Export defaults to **encrypted**, with an explicit "بدون كلمة مرور" opt-out that states the risk.
  3. Import: parse → verify checksum → show a diff summary (counts, date range, conflicts) → apply as a
     **merge with per-entity choice** → automatic pre-import snapshot kept locally for 7 days → one-click
     undo.
* **Files.** `src/lib/sync/crypto-backup.ts`, `src/lib/finance/store.ts` (`exportDataAsync`, `importData`),
  `src/components/finance/features.tsx` (import preview sheet).
* **Tests.** Round-trip equality (row-by-row); tampered payload rejected on checksum; v1 file imported with a
  clear upgrade path; undo restores byte-identical state.
* **Acceptance.** Restore drill on a synthetic tenant passes end-to-end within the documented RTO.
  **Effort:** 4–6 days.

### C6 · Session and device management (server dependency)
* **Problem.** No user can see or revoke active sessions; a stolen refresh token is invisible.
* **Design.** New edge function `account-security` (service role, JWT-verified caller) exposing
  `list_sessions` / `revoke_session` via GoTrue admin API; UI list in `security-screen.tsx` with
  device/user-agent, last-active, revoke. **Requires a new deployed function**, i.e. it is partially a
  server item.
* **Acceptance.** Revoking a session invalidates that device within one refresh cycle; audit row written.
  **Effort:** 3–4 days (server + UI).

### C7 · Remove unused scaffolding (needs your decision — it deletes files)
* `src/lib/multiplayer/p2p.ts` (imported nowhere, no `/api/rtc` route), `multiMonthSummary` (dead helper),
  `pushTenantAuditLog` (never called; superseded by the server-authored logger), the Better Auth/Kysely/PGlite
  scaffold (`src/lib/auth/*` except the Supabase paths, `src/lib/db.ts`, `src/lib/env.server.ts`), and the
  unrelated `.grok/skills/building-games/**` tree.
* Rationale: every unused path is either dead code an auditor must re-verify or, worse, an alternative auth
  implementation that could be wired by mistake. **Risk:** if any of it is a deliberate future platform bet,
  keep it and document the decision in an ADR instead. **Effort:** 1–2 days.

### C8 · Test additions that gate this release
Hand-shake matrix (C1) · CSP violation listener (C2) · MFA journey (C3) · secret-storage assertion (C4) ·
restore drill (C5) · session revoke (C6). All must run in CI before the release is promoted.

---

## 3. Rollout

1. Server steps S1–S8 applied and verified (`09_verification.sql` green).
2. Client release candidate on a preview deployment against staging **and** a production clone.
3. Production rollout: 100 % for web (Vercel instant rollback ready); Android APK published to the existing
   release channel with a version bump and a note that old APKs keep working offline.
4. Observe for one week: sync-blocked events (should be zero), CSP violations (zero), MFA enrolment rate,
   backup-restore errors.
5. Only then start Phase 1 (integer money, typed financial core).

**Rollback:** Vercel instant rollback to the previous deployment; the database keeps the extra columns
(additive), so the old client continues to work. Never roll the database *back* past S2 once new revisions
have been written.

---

## 4. Explicit non-goals

No new product features. No redesign. No change to the ledger's data model. No AI. No accounting. No
touching `vercel.json`/workflows until you approve config changes (C2 modifies deployment config). No
deletion of the scaffolds before C7 is approved.

## 5. Effort summary

| Item | Effort |
|---|---|
| C1 handshake | 3–5 d |
| C2 CSP | 2–3 d (+1 release observation) |
| C3 MFA | 5–7 d |
| C4 Drive secrets | 2–3 d |
| C5 backup envelope v2 | 4–6 d |
| C6 sessions/devices | 3–4 d |
| C7 scaffolding removal | 1–2 d |
| C8 test gating | included per item |
| **Total** | **~3–4 engineering weeks** (one senior dev), excluding review and store/rollout overhead |

This is the second half of P0: together with the server plan it closes every finding rated Critical or High
that can be closed without changing the product's behaviour for users.
