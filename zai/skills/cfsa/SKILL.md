# SKILL: Cloudflare & Project Security Audit (`/cfsa`)

## Status of this skill

No third-party "Cloudflare Security Audit" GitHub skill was installed. Per the
task's explicit fallback instruction ("إذا لم يتم العثور على مهارة موثوقة،
أنشئ مهارة محلية read-only مستوحاة من Cloudflare API الرسمي، ولا تدّعي أن
GitHub skill تم تثبيتها"):

- The sandbox network allowlist for this session is limited to `github.com`,
  `codeload.github.com`, `api.github.com`, `registry.npmjs.org`, `pypi.org`,
  `files.pythonhosted.org`. There is no live Cloudflare account/zone
  credential available in this environment to validate against, and vetting
  an unknown third-party "skill" repository (license, maintainer trust,
  commit history, supply-chain risk) is out of scope for an unattended
  install inside this task.
- This skill was therefore written **locally and from scratch**, modeled
  directly on the public Cloudflare API v4 documentation (zones, DNS records,
  SSL/TLS settings, firewall/WAF rules, rate limiting, Access/Zero Trust,
  Workers/Pages/R2/KV, audit logs) — no code was copied from any repository.
- `manifest.json` in this folder records that decision explicitly (`source:
  "local-original"`, no external commit/SHA256 to report).

## Purpose

`/cfsa` runs a **defensive, read-only** audit of (a) the Z-Ai project's own
security posture (headers, CSP, CORS, secrets, dependencies) and, when the
operator supplies Cloudflare credentials via environment variables, (b) the
authorized Cloudflare zone's configuration. It never mutates DNS, WAF, SSL, or
any other setting.

## Invocation

```
/cfsa
/cfsa --scope project
/cfsa --scope cloudflare
/cfsa --scope project,cloudflare
/cfsa --read-only                 (default, and the only mode without --fix-plan confirmation)
/cfsa --report markdown
/cfsa --report json
/cfsa --severity critical,high,medium,low
/cfsa --fix-plan                  (prints a plan; still makes NO changes)
```

Implementation: `scripts/cfsa.mjs` (Node, zero third-party runtime deps).

## Hard safety rules (enforced in code, not just documentation)

1. Default mode is `--read-only`; there is no code path in `scripts/cfsa.mjs`
   that issues a Cloudflare `PUT`/`POST`/`PATCH`/`DELETE` request. The script
   only ever calls `GET` endpoints.
2. The script **never prints** `CF_API_TOKEN` (or any other secret) to stdout,
   logs, or the generated report. It only reports whether the variable is
   *present* and, if present, the token's scoped permissions as returned by
   `GET /user/tokens/verify` — never the token value itself.
3. If `CF_API_TOKEN` / `CF_ZONE_ID` are not set, the `cloudflare` scope is
   skipped entirely and the report says so under "القيود والبيانات التي لم
   تتوفر" — it never fabricates Cloudflare findings.
4. The script refuses to run if scope is ambiguous or if `--zone` doesn't
   match the zone the token is scoped to (prevents auditing a domain the
   caller doesn't control).
5. No exploitation, credential harvesting, persistence, or evasion code paths
   exist anywhere in this skill.

## Project-scope checks (always available, no credentials needed)

- Security headers present in `vercel.json` / server responses (HSTS, CSP,
  X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP).
- CORS/CSP allowlist sanity (no `*` with credentials, no inline-script CSP).
- Secret scanning across the repo (`.env`, hardcoded `sk-`, AWS keys, JWT
  secrets, private keys) via regex heuristics — see `scripts/secret-scan.mjs`.
- `npm audit --json` dependency vulnerability summary.
- Presence/absence of rate limiting, CSRF protection, and ownership checks in
  the API source (heuristic grep over `zai/apps/api/src`).

## Cloudflare-scope checks (only with `CF_API_TOKEN` + `CF_ZONE_ID` env vars)

DNS exposure, SSL/TLS mode, HSTS/security headers at the edge, WAF managed +
custom rules, rate-limiting rules, bot protection, Access/Zero Trust policies,
Workers/Pages/R2/KV/Queues inventory, cache rules & cache-deception risk,
origin exposure, recent firewall events, API token scopes (names/permissions
only, never values).

## Output

Reports are written to `reports/cfsa/<timestamp>-report.md` and `.json` with:
scope/time/mode, tool+skill version, executive summary, findings table
(id/severity/asset/evidence/impact/remediation/confidence), passing controls,
critical/high findings, prioritized fix plan, re-verification steps, and
explicit confirmation the run was read-only.
