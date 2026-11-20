/**
 * Database-level regression tests for the security hardening migration.
 *
 * The migrations are applied to an embedded PostgreSQL (PGlite) with the
 * minimum Supabase scaffolding (anon/authenticated/service_role roles,
 * auth.users, auth.uid(), storage.objects and Supabase's default grants), then
 * the audit invariants are asserted as the actual client roles.
 *
 * This is what proves findings 02/03/04/05/07/08/10/12 are fixed in SQL rather
 * than only in the TypeScript layer.
 */
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const OWNER = "11111111-1111-1111-1111-111111111111";
const MEMBER = "22222222-2222-2222-2222-222222222222";
const OUTSIDER = "33333333-3333-3333-3333-333333333333";

const bootstrapSql = `
  set check_function_bodies = off;

  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema if not exists auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create or replace function auth.role() returns text
    language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
  create or replace function auth.jwt() returns jsonb
    language sql stable as $$ select '{}'::jsonb $$;
  create table if not exists auth.users (
    id uuid primary key,
    email text,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb default '{}'::jsonb,
    banned_until timestamptz,
    created_at timestamptz default now()
  );

  create schema if not exists storage;
  create table if not exists storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text,
    owner uuid
  );
  alter table storage.objects enable row level security;

  -- Supabase grants every new object to the API roles by default; the hardening
  -- migration then revokes what clients must not have.
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

const { PGlite } = await import("@electric-sql/pglite");
const db = new PGlite();
await db.exec(bootstrapSql);

const migrationFiles = (await readdir("supabase/migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort();

for (const file of migrationFiles) {
  const sql = (await readFile(join("supabase/migrations", file), "utf8")).replace(
    /create\s+extension\s+if\s+not\s+exists\s+pgcrypto;/gi,
    ";",
  );
  await db.exec(sql);
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const exec = (sql, params) => db.query(sql, params);

async function actAs(uid) {
  await db.exec(
    `select set_config('test.uid', ${uid ? `'${uid}'` : "''"}, false), set_config('test.role', 'authenticated', false)`,
  );
  await db.exec("set role authenticated");
}

async function actAsSystem() {
  await db.exec("reset role");
  await db.exec("select set_config('test.uid', '', false)");
}

async function rejects(fn, pattern) {
  try {
    await fn();
  } catch (err) {
    assert.match(String(err.message ?? err), pattern);
    return;
  }
  assert.fail("expected the statement to be rejected");
}

await exec(
  `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
     ($1, 'owner@example.com', now(), '{"display_name":"Owner"}'::jsonb),
     ($2, 'member@example.com', now(), '{"display_name":"Member"}'::jsonb),
     ($3, 'outsider@example.com', now(), '{"display_name":"Outsider"}'::jsonb)`,
  [OWNER, MEMBER, OUTSIDER],
);
await exec(`update public.platform_settings set owner_email = 'owner@example.com' where id = 1`);

let tenant;

beforeEach(async () => {
  // Role hygiene: a failing assertion used to leave the session as
  // `authenticated` and turn the next test's real result into a confusing
  // "permission denied" cascade.
  await db.exec("reset role");
  await db.exec("select set_config('test.uid', '', false)");
});

test("migrations apply to a Supabase-shaped database", () => {
  assert.ok(migrationFiles.length >= 5);
  assert.ok(migrationFiles.includes("202611160001_security_hardening.sql"));
});

test("profiles.email can never diverge from the verified auth identity", async () => {
  await exec(`update public.profiles set email = 'attacker@evil.test' where id = $1`, [OWNER]);
  assert.equal((await one(`select email from profiles where id = $1`, [OWNER])).email, "owner@example.com");

  // Direct REST-style update of the identity column is denied outright.
  await actAs(OWNER);
  await rejects(
    () => exec(`update public.profiles set email = 'attacker@evil.test' where id = $1`, [OWNER]),
    /permission denied/,
  );
  await actAsSystem();
});

test("workspace creation is trial-aware, verified-email-only and quota-limited", async () => {
  await actAs(OWNER);
  try {
    // The trial length belongs to the plan row, never to a literal in the
    // function: hardening §6 pins every zero-trial plan to 14 days so the
    // status has to follow trial_days.
    const plan = await one(`select trial_days from subscription_plans where code = 'monthly'`);
    tenant = await one(`select * from create_tenant_workspace('Test WS', 'test-ws', 'personal', 'EGP', 'monthly')`);
    assert.equal(
      tenant.subscription_status,
      Number(plan.trial_days) > 0 ? "trialing" : "pending_approval",
      "the status must mirror the plan's trial_days",
    );
  } finally {
    await actAsSystem();
  }

  // Paid plans ship with trial_days = 0 so unapproved signups cannot self-provision trials.
  await exec(`update subscription_plans set trial_days = 0 where code = 'yearly'`);
  await actAs(OWNER);
  try {
    const noTrial = await one(
      `select * from create_tenant_workspace('No Trial WS', 'no-trial-ws', 'personal', 'EGP', 'yearly')`,
    );
    assert.equal(noTrial.subscription_status, "pending_approval", "trial_days = 0 must not grant a trial");
  } finally {
    await actAsSystem();
  }

  await exec(`update auth.users set email_confirmed_at = null where id = $1`, [MEMBER]);
  await actAs(MEMBER);
  try {
    await rejects(() => one(`select create_tenant_workspace('Unverified')`), /تأكيد البريد/);
  } finally {
    await actAsSystem();
  }
  await exec(`update auth.users set email_confirmed_at = now() where id = $1`, [MEMBER]);

  // Layer 1 - the function's own ceiling, measured after resetting the counter
  // so the p0_11 throttle cannot mask it.
  await exec(`delete from rate_limit_events`);
  await actAs(OWNER);
  try {
    const owned = (await one(`select count(*)::int c from tenants where owner_id = $1 and deleted_at is null`, [OWNER])).c;
    for (let i = owned; i < 5; i += 1) {
      await one(`select create_tenant_workspace($1)`, [`WS ${i}`]);
    }
    await rejects(() => one(`select create_tenant_workspace('Too many')`), /الحد الأقصى/);
  } finally {
    await actAsSystem();
  }

  // Layer 2 - the p0_11 trigger stops a tight loop before the ceiling is even
  // relevant. Exercised as OUTSIDER, who owns nothing, so the two layers stay
  // independent.
  await exec(`delete from rate_limit_events`);
  await actAs(OUTSIDER);
  try {
    for (let i = 0; i < 3; i += 1) {
      await one(`select create_tenant_workspace($1)`, [`Spam ${i}`]);
    }
    await rejects(() => one(`select create_tenant_workspace('Spam 4')`), /عدد المحاولات/);
  } finally {
    await actAsSystem();
  }
});

test("invites are bound to the verified auth email, not the profile copy", async () => {
  await exec(
    `insert into tenant_invites (tenant_id, invite_code, email, role, created_by, max_uses)
     values ($1, 'JOIN-OK', 'member@example.com', 'member', $2, 5),
            ($1, 'JOIN-OTHER', 'someone@else.test', 'member', $2, 5)`,
    [tenant.id, OWNER],
  );

  // Tampering with profiles.email must not unlock somebody else's invitation:
  // the binding is the verified auth identity, not the editable profile copy.
  await exec(`update public.profiles set email = 'someone@else.test' where id = $1`, [MEMBER]);
  await actAs(MEMBER);
  try {
    await rejects(() => one(`select redeem_tenant_invite('JOIN-OTHER')`), /بريد إلكتروني آخر/);
    const joined = await one(`select redeem_tenant_invite('JOIN-OK') as r`);
    assert.equal(joined.r.role, "member");
  } finally {
    await actAsSystem();
  }

  // Unverified identities cannot consume invitations at all.
  await exec(`update auth.users set email_confirmed_at = null where id = $1`, [OUTSIDER]);
  await actAs(OUTSIDER);
  try {
    await rejects(() => one(`select redeem_tenant_invite('JOIN-OK')`), /تأكيد البريد/);
  } finally {
    await actAsSystem();
  }
  await exec(`update auth.users set email_confirmed_at = now() where id = $1`, [OUTSIDER]);
});

test("rate limiting is a database-enforced fixed window that clients cannot call", async () => {
  await actAsSystem();
  assert.equal((await one(`select check_rate_limit('unit', 'b', 2, 60) as ok`)).ok, true);
  assert.equal((await one(`select check_rate_limit('unit', 'b', 2, 60) as ok`)).ok, true);
  assert.equal((await one(`select check_rate_limit('unit', 'b', 2, 60) as ok`)).ok, false);
  assert.equal((await one(`select check_rate_limit('unit', 'b', 0, 60) as ok`)).ok, false);

  // The window is a server-side primitive: the live grants expose it to
  // service_role only (verified with has_function_privilege on
  // kpgszjnjmmosvrlujvkj), so a browser cannot mint its own allowance.
  await actAs(OWNER);
  try {
    await rejects(() => one(`select check_rate_limit('client', 'x', 1, 60)`), /permission denied/);
  } finally {
    await actAsSystem();
  }
});

test("payment requests are server-priced and client-insert-proof", async () => {
  await actAs(OWNER);
  await rejects(
    () =>
      exec(
        `insert into payment_requests (tenant_id, tenant_name, submitted_by, submitter_email, plan_code, amount_egp, payment_method, reference_code, duration_days)
         values ($1, 'T', $2, 'owner@example.com', 'yearly', 1, 'instapay', 'REF-1', 365)`,
        [tenant.id, OWNER],
      ),
    /permission denied/,
  );
  await actAsSystem();

  const plan = await one(`select price_egp, duration_days from subscription_plans where code = 'yearly'`);
  const request = await one(
    `insert into payment_requests (tenant_id, tenant_name, submitted_by, submitter_email, plan_code, amount_egp, payment_method, reference_code, duration_days, status, reviewed_by)
     values ($1, 'Test WS', $2, 'owner@example.com', 'yearly', 1, 'instapay', 'REF-2', 1, 'pending', $2)
     returning *`,
    [tenant.id, OWNER],
  );
  assert.equal(Number(request.amount_egp), Number(plan.price_egp), "amount must come from the plan");
  assert.equal(request.duration_days, plan.duration_days, "duration must come from the plan");
});

test("sync order is revision-based and client clock cannot poison it", async () => {
  await exec(`update tenants set subscription_status = 'active', current_period_end = now() + interval '30 days' where id = $1`, [
    tenant.id,
  ]);

  await actAs(OWNER);
  const future = Date.now() + 1000 * 60 * 60 * 24 * 3650;
  const first = await one(`select sync_push_tenant_records($1, $2::jsonb) as r`, [
    tenant.id,
    JSON.stringify([{ entityType: "tx", entityId: "tx-1", payload: { id: "tx-1", amount: 10 }, updatedAtMs: future }]),
  ]);
  assert.equal(first.r.applied.length, 1);

  const stored = await one(`select updated_at_ms, revision from tenant_records where entity_id = 'tx-1'`);
  assert.ok(Number(stored.updated_at_ms) < Date.now() + 60_000, "far-future client timestamps are clamped");

  // A genuine later edit from another device still wins.
  const second = await one(`select sync_push_tenant_records($1, $2::jsonb) as r`, [
    tenant.id,
    JSON.stringify([{ entityType: "tx", entityId: "tx-1", payload: { id: "tx-1", amount: 20 }, updatedAtMs: Date.now() + 1000 }]),
  ]);
  assert.equal(second.r.applied.length, 1);
  const updated = await one(`select revision from tenant_records where entity_id = 'tx-1'`);
  assert.ok(Number(updated.revision) > Number(stored.revision), "every write gets a fresh monotonic revision");

  const invalid = await one(`select sync_push_tenant_records($1, $2::jsonb) as r`, [
    tenant.id,
    JSON.stringify([
      { entityType: "hacked", entityId: "x", payload: {}, updatedAtMs: 1 },
      { entityType: "tx", entityId: "tx-2", payload: [], updatedAtMs: 1 },
      { entityType: "tx", entityId: "tx-3", payload: { a: 1 }, updatedAtMs: "not-a-number" },
    ]),
  ]);
  assert.deepEqual(
    invalid.r.rejected.map((row) => row.code),
    ["ENTITY_TYPE_INVALID", "PAYLOAD_INVALID", "TIMESTAMP_INVALID"],
  );
  await rejects(
    () => one(`select sync_push_tenant_records($1, $2::jsonb)`, [tenant.id, JSON.stringify(new Array(201).fill({}))]),
    /الحد المسموح/,
  );
  await actAsSystem();

  // A non-member cannot write into the workspace.
  await actAs(OUTSIDER);
  await rejects(
    () =>
      one(`select sync_push_tenant_records($1, $2::jsonb)`, [
        tenant.id,
        JSON.stringify([{ entityType: "tx", entityId: "evil", payload: {}, updatedAtMs: Date.now() }]),
      ]),
    /صلاحية الكتابة/,
  );
  await actAsSystem();
});

test("deletes are tombstones only (no hard delete from clients)", async () => {
  await actAs(OWNER);
  await rejects(() => exec(`delete from tenant_records where entity_id = 'tx-1'`), /permission denied/);

  const result = await one(`select sync_push_tenant_records($1, $2::jsonb) as r`, [
    tenant.id,
    JSON.stringify([
      {
        entityType: "tx",
        entityId: "tx-1",
        payload: { id: "tx-1" },
        updatedAtMs: Date.now() + 2000,
        deletedAtMs: Date.now() + 2000,
      },
    ]),
  ]);
  assert.equal(result.r.applied.length, 1);
  assert.equal((await one(`select deleted_at_ms is not null as d from tenant_records where entity_id = 'tx-1'`)).d, true);

  assert.equal((await one(`select soft_delete_tenant_record($1, 'tx', 'tx-1') as ok`, [tenant.id])).ok, false);
  const audit = await one(`select count(*)::int c from tenant_audit_logs where action = 'record.deleted'`);
  assert.equal(audit.c, 0, "deleting an already-deleted record writes no new audit row");
  await actAsSystem();
});

test("audit logs are server-authored, allow-listed and immutable", async () => {
  await actAs(OWNER);
  await rejects(
    () =>
      exec(
        `insert into tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
         values ($1, $2, 'Super-Admin', 'billing.payment_approved', 'forged')`,
        [tenant.id, OWNER],
      ),
    /permission denied/,
  );
  await rejects(() => one(`select log_tenant_audit_event($1, 'evil.action', 'x')`, [tenant.id]), /غير مسموح/);
  await one(`select log_tenant_audit_event($1, 'record.created', 'إضافة حركة')`, [tenant.id]);

  const entry = await one(`select actor_id, actor_name from tenant_audit_logs where action = 'record.created'`);
  assert.equal(entry.actor_id, OWNER, "actor id comes from the session, not the payload");
  assert.equal(entry.actor_name, "Owner");

  await rejects(() => exec(`update tenant_audit_logs set summary = 'tampered'`), /permission denied/);
  await rejects(() => exec(`delete from tenant_audit_logs`), /permission denied/);
  await actAsSystem();
});

test("expiration sweep is a system job, not a client endpoint", async () => {
  await actAs(MEMBER);
  await rejects(() => exec(`select enforce_expired_subscriptions()`), /permission denied/);
  assert.equal((await one(`select bootstrap_first_super_admin() as ok`)).ok, false, "no implicit promotion");
  await actAsSystem();
});

test("platform owner bootstrap is atomic, single-use and secret-gated", async () => {
  assert.equal((await one(`select claim_platform_owner($1, 'attacker@evil.test') as ok`, [MEMBER])).ok, false);
  assert.equal((await one(`select claim_platform_owner($1, 'owner@example.com') as ok`, [OWNER])).ok, true);
  assert.equal(
    (await one(`select claim_platform_owner($1, 'owner@example.com') as ok`, [MEMBER])).ok,
    false,
    "a second claim must fail even with the right email",
  );
  assert.equal((await one(`select count(*)::int c from platform_admins`)).c, 1);

  // Clients cannot call the bootstrap helper directly.
  await actAs(OWNER);
  await rejects(() => exec(`select claim_platform_owner($1, 'owner@example.com')`, [OWNER]), /permission denied/);
  await actAsSystem();
});

test("anon may call the claim-free boolean helpers but no system job", async () => {
  // The pre-auth shell needs these predicates (plan catalogue, invite preview,
  // bootstrap check), so they are executable by anon - and they return false
  // without a JWT claim instead of leaking tenant data. Verified against the
  // live grants: has_function_privilege('anon', can_write_tenant) = true,
  // has_function_privilege('anon', enforce_expired_subscriptions) = false.
  await db.exec("set role anon");
  try {
    assert.equal((await one(`select can_write_tenant($1) as ok`, [tenant.id])).ok, false, "no claim, no write");
    assert.equal((await one(`select is_tenant_member($1) as ok`, [tenant.id])).ok, false);
    assert.equal((await one(`select tenant_role($1) as r`, [tenant.id])).r, null);
    await rejects(() => exec(`select enforce_expired_subscriptions()`), /permission denied/);
    await rejects(() => exec(`select check_rate_limit('anon', 'x', 1, 60)`), /permission denied/);
    assert.equal((await one(`select has_platform_owner() as ok`)).ok, true, "public bootstrap check stays available");
  } finally {
    await actAsSystem();
  }
});

test("cloudflare audit regressions: RPC-only tenant_records, owner-only soft-delete, self-only profiles, and invite preview", async () => {
  const DELEGATED_ADMIN = "44444444-4444-4444-4444-444444444444";
  const NON_SUPER_OWNER = "55555555-5555-5555-5555-555555555555";
  await exec(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
       ($1, 'admin-del@example.com', now(), '{"display_name":"Delegated Admin","phone":"+201011112222"}'::jsonb),
       ($2, 'biz-owner@example.com', now(), '{"display_name":"Biz Owner","phone":"+201033334444"}'::jsonb)`,
    [DELEGATED_ADMIN, NON_SUPER_OWNER],
  );

  // 1. Paid plans default to trial_days = 0 -> new subscriber workspace stays pending_approval and non-writable
  await actAs(NON_SUPER_OWNER);
  let bizWs;
  try {
    bizWs = await one(
      `select * from create_tenant_workspace('Biz Ledger', 'biz-ledger', 'business', 'EGP', 'yearly')`,
    );
    assert.equal(bizWs.subscription_status, "pending_approval");
    assert.equal((await one(`select can_write_tenant($1) as ok`, [bizWs.id])).ok, false);
  } finally {
    await actAsSystem();
  }

  // Activate workspace and add MEMBER ('member') + DELEGATED_ADMIN ('admin')
  await exec(
    `update tenants set subscription_status = 'active', current_period_end = now() + interval '30 days' where id = $1`,
    [bizWs.id],
  );
  await exec(
    `insert into tenant_members (tenant_id, user_id, role, display_name, email) values
       ($1, $2, 'member', 'Member', 'member@example.com'),
       ($1, $3, 'admin', 'Delegated Admin', 'admin-del@example.com')`,
    [bizWs.id, MEMBER, DELEGATED_ADMIN],
  );

  // 2. Direct PostgREST INSERT/UPDATE on tenant_records is denied; sync_push_tenant_records works
  await actAs(NON_SUPER_OWNER);
  try {
    const pushed = await one(`select sync_push_tenant_records($1, $2::jsonb) as r`, [
      bizWs.id,
      JSON.stringify([{ entityType: "debt", entityId: "d-1", payload: { id: "d-1", principal: 5000 }, updatedAtMs: Date.now() }]),
    ]);
    assert.equal(pushed.r.applied.length, 1);
  } finally {
    await actAsSystem();
  }

  await actAs(MEMBER);
  try {
    await rejects(
      () =>
        exec(
          `update tenant_records set updated_at_ms = 9007199254740991, created_by = $2 where tenant_id = $1 and entity_id = 'd-1'`,
          [bizWs.id, NON_SUPER_OWNER],
        ),
      /permission denied/,
    );
    await rejects(
      () =>
        exec(
          `insert into tenant_records (tenant_id, entity_type, entity_id, payload, updated_at_ms) values ($1, 'tx', 'forged', '{}'::jsonb, 1)`,
          [bizWs.id],
        ),
      /permission denied/,
    );
  } finally {
    await actAsSystem();
  }

  // 3. Delegated non-owner admin cannot soft-delete workspace via tenants.deleted_at
  await actAs(DELEGATED_ADMIN);
  try {
    await rejects(
      () => exec(`update tenants set deleted_at = now() where id = $1`, [bizWs.id]),
      /Only the workspace owner/,
    );
  } finally {
    await actAsSystem();
  }

  // 4. Co-members cannot scrape private phone/contact_display from public.profiles
  await actAs(DELEGATED_ADMIN);
  try {
    const others = await exec(`select id, phone from profiles where id = $1`, [NON_SUPER_OWNER]);
    assert.equal(others.rows.length, 0, "co-member must not read another user's profiles row");
    const selfRow = await one(`select id, phone from profiles where id = $1`, [DELEGATED_ADMIN]);
    assert.equal(selfRow.phone, "+201011112222");
  } finally {
    await actAsSystem();
  }

  // 5. preview_tenant_invite returns workspace metadata without adding caller to tenant_members
  await exec(
    `insert into tenant_invites (tenant_id, invite_code, email, role, created_by, max_uses)
     values ($1, 'MZN-PREV-2026', null, 'viewer', $2, 5)`,
    [bizWs.id, NON_SUPER_OWNER],
  );
  await actAs(OUTSIDER);
  try {
    const preview = await one(`select preview_tenant_invite('MZN-PREV-2026') as p`);
    assert.equal(preview.p.name, "Biz Ledger");
    assert.equal(preview.p.role, "viewer");
    assert.equal((await one(`select is_tenant_member($1) as m`, [bizWs.id])).m, false);
  } finally {
    await actAsSystem();
  }
});

test("cleanup", async () => {
  await db.close();
});
