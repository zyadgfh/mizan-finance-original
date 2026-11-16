import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Runs the real tenant-sync SQL from the Supabase migration inside PGlite
 * (Postgres compiled to WASM), so the payload schema gate and the push RPC
 * itself are exercised rather than assumed.
 *
 * `auth.uid()`, `public.profiles` and `public.tenant_records` are stubbed with
 * the minimum shape the functions touch; everything under test is the migration.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

/** Applied in order, exactly as they were applied to the live project. */
const migrationFiles = [
  "20261116045649_tenant_payload_validation.sql",
  "20261116045728_tenant_payload_error_grant.sql",
  "20261116050147_tenant_payload_rules_refined.sql",
];

const USER_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";

const stubs = `
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select '${USER_ID}'::uuid $$;

  create table if not exists public.profiles (
    id uuid primary key,
    display_name text
  );
  insert into public.profiles (id, display_name)
  values ('${USER_ID}'::uuid, 'مالك')
  on conflict (id) do nothing;

  create table if not exists public.tenant_records (
    tenant_id uuid not null,
    entity_type text not null,
    entity_id text not null,
    payload jsonb not null default '{}'::jsonb,
    updated_at_ms bigint not null,
    deleted_at_ms bigint,
    created_by uuid,
    created_by_name text,
    updated_by uuid,
    updated_by_name text,
    primary key (tenant_id, entity_type, entity_id)
  );
`;

const validPayloads = {
  tx: { id: "t-1", kind: "expense", amount: 12.5, categoryId: "food", date: "2026-11-01", note: "غداء" },
  person: { id: "p-1", name: "أحمد" },
  debt: {
    id: "d-1",
    personId: "p-1",
    direction: "receivable",
    title: "قرض",
    principal: 500,
    dueDate: "2026-12-01",
    cadence: "weekly",
  },
  payment: { id: "pay-1", debtId: "d-1", amount: 100, date: "2026-11-02", walletId: "w-1" },
  wallet: { id: "w-1", name: "نقدي", kind: "cash", opening: 0, cardDesign: "apple-white" },
  transfer: { id: "tr-1", fromId: "w-1", toId: "w-2", amount: 10, date: "2026-11-02" },
  budget: { categoryId: "food", limit: 1000 },
  goal: { id: "g-1", name: "سفر", target: 9000, deadline: "2027-01-01", category: "travel" },
  goalMove: { id: "gm-1", goalId: "g-1", walletId: "w-1", amount: -50, date: "2026-11-03" },
  recurring: {
    id: "r-1",
    kind: "expense",
    amount: 300,
    categoryId: "bills",
    walletId: "w-1",
    day: 5,
    active: true,
    lastMonth: "2026-10",
  },
  category: { id: "food", name: "طعام", kind: "expense", icon: "utensils", tone: "tint" },
  debtAudit: { id: "log-1", debtId: "d-1", action: "payment-added", at: 1700000000000, summary: "دفعة" },
};

let db;
let check;
let push;

test.before(async () => {
  db = new PGlite();
  await db.exec("create role authenticated;");
  await db.exec(stubs);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDir, file), "utf8"));
  }

  check = async (entityType, payload) => {
    const { rows } = await db.query("select public.tenant_payload_error($1, $2::jsonb) as error", [
      entityType,
      JSON.stringify(payload),
    ]);
    return rows[0].error;
  };

  push = async (ops) => {
    const { rows } = await db.query("select public.sync_push_tenant_records($1, $2::jsonb) as result", [
      TENANT_ID,
      JSON.stringify(ops),
    ]);
    return rows[0].result;
  };
});

test.after(async () => {
  await db?.close();
});

test("valid payloads return no error for every entity type", async () => {
  for (const [entityType, payload] of Object.entries(validPayloads)) {
    assert.equal(await check(entityType, payload), null, `${entityType} should pass`);
  }
});

test("missing required fields are named in the error", async () => {
  const { amount: _amount, ...withoutAmount } = validPayloads.tx;
  assert.equal(await check("tx", withoutAmount), "tx.amount is required");
  assert.equal(await check("budget", { limit: 10 }), "budget.categoryId is required");
});

test("wrong JSON types are rejected", async () => {
  assert.equal(await check("tx", { ...validPayloads.tx, amount: "12" }), "tx.amount must be a number");
  assert.equal(await check("person", { ...validPayloads.person, name: 42 }), "person.name must be a string");
  assert.equal(
    await check("recurring", { ...validPayloads.recurring, active: "yes" }),
    "recurring.active must be a boolean",
  );
});

test("identifier fields must be non-empty", async () => {
  assert.equal(await check("person", { ...validPayloads.person, id: "   " }), "person.id must be a non-empty string");
  assert.equal(await check("person", { ...validPayloads.person, id: null }), "person.id is required");
  assert.equal(await check("tx", { ...validPayloads.tx, categoryId: "" }), "tx.categoryId must be a non-empty string");
});

test("empty free text is accepted, as the app stores it", async () => {
  const liveShapes = [
    ["tx", { ...validPayloads.tx, note: "" }],
    ["person", { ...validPayloads.person, phone: "", note: "" }],
    ["debt", { ...validPayloads.debt, dueDate: "", note: "" }],
  ];
  for (const [entityType, payload] of liveShapes) {
    assert.equal(await check(entityType, payload), null, `${entityType} should keep syncing`);
  }
});

test("an optional closed-set field stored as empty string means not set", async () => {
  assert.equal(await check("tx", { ...validPayloads.tx, currency: "", source: "" }), null);
  assert.equal(await check("debt", { ...validPayloads.debt, cadence: "" }), null);
  assert.equal(await check("goal", { ...validPayloads.goal, category: "" }), null);
  // A required closed-set field may never be blank.
  assert.equal(await check("tx", { ...validPayloads.tx, kind: "" }), "tx.kind has an unsupported value");
});

test("closed value sets are enforced", async () => {
  assert.equal(
    await check("tx", { ...validPayloads.tx, kind: "transfer" }),
    "tx.kind has an unsupported value",
  );
  assert.equal(
    await check("wallet", { ...validPayloads.wallet, kind: "bitcoin" }),
    "wallet.kind has an unsupported value",
  );
  assert.equal(
    await check("debtAudit", { ...validPayloads.debtAudit, action: "erased" }),
    "debtAudit.action has an unsupported value",
  );
});

test("optional fields may be null (treated as absent)", async () => {
  assert.equal(await check("tx", { ...validPayloads.tx, note: null, currency: null }), null);
  assert.equal(await check("goal", { ...validPayloads.goal, category: null }), null);
});

test("non-object payloads and unknown entity types are rejected", async () => {
  assert.equal(await check("tx", [1, 2, 3]), "payload must be a JSON object");
  assert.equal(await check("tx", null), "payload must be a JSON object");
  assert.equal(await check("mystery", { id: "x" }), 'unknown entity type "mystery"');
});

test("the push RPC applies a valid record", async () => {
  const result = await push([
    {
      entityType: "wallet",
      entityId: "w-push",
      payload: { ...validPayloads.wallet, id: "w-push" },
      updatedAtMs: 1_700_000_000_000,
      deletedAtMs: null,
    },
  ]);
  assert.deepEqual(result.applied, [{ entityType: "wallet", entityId: "w-push" }]);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.stale, []);

  const { rows } = await db.query(
    "select entity_id, payload->>'kind' as kind, created_by_name from public.tenant_records where entity_id = $1",
    ["w-push"],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "cash");
  assert.equal(rows[0].created_by_name, "مالك");
});

test("the push RPC rejects an invalid payload with INVALID_PAYLOAD and stores nothing", async () => {
  const result = await push([
    {
      entityType: "tx",
      entityId: "t-bad",
      payload: { id: "t-bad", amount: "lots", categoryId: "food", date: "2026-11-01" },
      updatedAtMs: 1_700_000_000_001,
      deletedAtMs: null,
    },
  ]);
  assert.deepEqual(result.applied, []);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].code, "INVALID_PAYLOAD");
  assert.match(result.rejected[0].error, /^tx\.kind is required$/);

  const { rows } = await db.query("select 1 from public.tenant_records where entity_id = $1", ["t-bad"]);
  assert.equal(rows.length, 0);
});

test("one bad record does not stop the rest of the batch", async () => {
  const result = await push([
    {
      entityType: "person",
      entityId: "p-good",
      payload: { id: "p-good", name: "سارة" },
      updatedAtMs: 1_700_000_000_002,
      deletedAtMs: null,
    },
    {
      entityType: "person",
      entityId: "p-bad",
      payload: { id: "p-bad" },
      updatedAtMs: 1_700_000_000_003,
      deletedAtMs: null,
    },
  ]);
  assert.deepEqual(result.applied, [{ entityType: "person", entityId: "p-good" }]);
  assert.deepEqual(
    result.rejected.map((r) => [r.entityId, r.code]),
    [["p-bad", "INVALID_PAYLOAD"]],
  );
});

test("tombstones skip payload validation and remove the record", async () => {
  const result = await push([
    {
      entityType: "wallet",
      entityId: "w-push",
      payload: {},
      updatedAtMs: 1_700_000_000_010,
      deletedAtMs: 1_700_000_000_010,
    },
  ]);
  assert.deepEqual(result.applied, [{ entityType: "wallet", entityId: "w-push" }]);

  const { rows } = await db.query(
    "select deleted_at_ms from public.tenant_records where entity_id = $1",
    ["w-push"],
  );
  assert.equal(rows[0].deleted_at_ms, 1_700_000_000_010);
});

test("an older write is reported stale instead of overwriting", async () => {
  const result = await push([
    {
      entityType: "person",
      entityId: "p-good",
      payload: { id: "p-good", name: "اسم قديم" },
      updatedAtMs: 1_600_000_000_000,
      deletedAtMs: null,
    },
  ]);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.stale, [
    { entityType: "person", entityId: "p-good", serverUpdatedAtMs: 1_700_000_000_002 },
  ]);

  const { rows } = await db.query("select payload->>'name' as name from public.tenant_records where entity_id = $1", [
    "p-good",
  ]);
  assert.equal(rows[0].name, "سارة");
});
