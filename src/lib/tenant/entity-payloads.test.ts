import assert from "node:assert/strict";
import test from "node:test";
import { seedData } from "../finance/seed.ts";
import { splitRemoteRecords, validateEntityPayload } from "./entity-payloads.ts";
import { snapshotToOutboxOps } from "./storage.ts";
import type { EntityType } from "./types.ts";

const VALID: Record<EntityType, Record<string, unknown>> = {
  tx: { id: "t-1", kind: "expense", amount: 120.5, categoryId: "food", note: "غداء", date: "2026-11-01", createdAt: 1 },
  person: { id: "p-1", name: "أحمد", phone: "01000000000", note: "", createdAt: 1 },
  debt: {
    id: "d-1",
    personId: "p-1",
    direction: "payable",
    title: "قرض",
    principal: 5000,
    dueDate: "2026-12-01",
    installments: 2,
    cadence: "monthly",
    note: "",
    createdAt: 1,
  },
  payment: { id: "pay-1", debtId: "d-1", amount: 2500, date: "2026-11-05", note: "", createdAt: 1 },
  wallet: { id: "w-1", name: "نقدي", kind: "cash", opening: 0, cardDesign: "apple-white", last4: "1234", createdAt: 1 },
  transfer: { id: "tr-1", fromId: "w-1", toId: "w-2", amount: 100, date: "2026-11-02", note: "", createdAt: 1 },
  budget: { categoryId: "food", limit: 2000 },
  goal: { id: "g-1", name: "سفر", target: 10000, deadline: "2027-01-01", category: "travel", createdAt: 1 },
  goalMove: { id: "gm-1", goalId: "g-1", walletId: "w-1", amount: -200, date: "2026-11-03", note: "", createdAt: 1 },
  recurring: {
    id: "r-1",
    kind: "expense",
    amount: 300,
    categoryId: "bills",
    walletId: "w-1",
    day: 5,
    active: true,
    lastMonth: "2026-10",
    note: "",
    createdAt: 1,
  },
  category: { id: "food", name: "طعام", kind: "expense", icon: "utensils", tone: "tint", custom: true },
  debtAudit: { id: "log-1", debtId: "d-1", action: "payment-added", at: 1, summary: "دفعة", afterAmount: 100 },
};

test("every entity type accepts a well-formed payload", () => {
  for (const [entityType, payload] of Object.entries(VALID)) {
    const result = validateEntityPayload(entityType as EntityType, payload);
    assert.equal(result.ok, true, `${entityType}: ${result.ok ? "" : result.error}`);
  }
});

test("real seed snapshots satisfy every entity schema", () => {
  const ops = snapshotToOutboxOps(seedData(), 1_700_000_000_000);
  assert.ok(ops.length > 0, "seed data should produce outbox ops");
  const failures = ops
    .map((op) => ({ op, validation: validateEntityPayload(op.entityType, op.payload) }))
    .filter(({ validation }) => !validation.ok)
    .map(({ op, validation }) => `${op.entityType}/${op.entityId}: ${validation.ok ? "" : validation.error}`);
  assert.deepEqual(failures, []);
});

test("extra keys are tolerated, they are not written back", () => {
  const result = validateEntityPayload("person", { ...VALID.person, legacyFlag: "x" });
  assert.equal(result.ok, true);
});

test("soft optional fields may be absent (legacy records still sync)", () => {
  const result = validateEntityPayload("tx", {
    id: "t-2",
    kind: "income",
    amount: 10,
    categoryId: "salary",
    date: "2026-11-01",
  });
  assert.equal(result.ok, true);
});

test("missing required fields are reported with their entity path", () => {
  const { amount: _amount, ...withoutAmount } = VALID.tx;
  const result = validateEntityPayload("tx", withoutAmount);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /^tx\.amount:/);
});

test("wrong JSON types are rejected", () => {
  const cases: Array<[EntityType, Record<string, unknown>, RegExp]> = [
    ["tx", { ...VALID.tx, amount: "120" }, /^tx\.amount:/],
    ["person", { ...VALID.person, name: 42 }, /^person\.name:/],
    ["recurring", { ...VALID.recurring, active: "true" }, /^recurring\.active:/],
    ["wallet", { ...VALID.wallet, opening: null }, /^wallet\.opening:/],
  ];
  for (const [entityType, payload, pattern] of cases) {
    const result = validateEntityPayload(entityType, payload);
    assert.equal(result.ok, false, `${entityType} should be rejected`);
    assert.match(result.ok === false ? result.error : "", pattern);
  }
});

test("unsupported closed values are rejected", () => {
  const cases: Array<[EntityType, Record<string, unknown>]> = [
    ["tx", { ...VALID.tx, kind: "transfer" }],
    ["tx", { ...VALID.tx, currency: "GBP" }],
    ["debt", { ...VALID.debt, direction: "lent" }],
    ["category", { ...VALID.category, tone: "purple" }],
    ["debtAudit", { ...VALID.debtAudit, action: "deleted" }],
  ];
  for (const [entityType, payload] of cases) {
    const result = validateEntityPayload(entityType, payload);
    assert.equal(result.ok, false, `${entityType} ${JSON.stringify(payload)} should be rejected`);
  }
});

test("non-objects and blank identifiers are rejected", () => {
  assert.equal(validateEntityPayload("tx", null).ok, false);
  assert.equal(validateEntityPayload("tx", []).ok, false);
});

test("identifier fields must be non-empty", () => {
  const cases: Array<[EntityType, Record<string, unknown>]> = [
    ["person", { ...VALID.person, id: "  " }],
    ["tx", { ...VALID.tx, categoryId: " " }],
    ["payment", { ...VALID.payment, debtId: "" }],
    ["transfer", { ...VALID.transfer, toId: "" }],
  ];
  for (const [entityType, payload] of cases) {
    const result = validateEntityPayload(entityType, payload);
    assert.equal(result.ok, false, `${entityType} should reject a blank identifier`);
    assert.match(result.ok === false ? result.error : "", /must be a non-empty string|Too small/);
  }
});

test("empty free text is accepted, as the app stores it", () => {
  const liveShapes: Array<[EntityType, Record<string, unknown>]> = [
    // These three shapes were read from production `tenant_records`.
    ["tx", { ...VALID.tx, note: "" }],
    ["person", { ...VALID.person, phone: "", note: "" }],
    ["debt", { ...VALID.debt, dueDate: "", note: "" }],
    // An optional closed-set field stored as "" means "not set".
    ["tx", { ...VALID.tx, currency: "", source: "" }],
    ["debt", { ...VALID.debt, cadence: "" }],
    ["goal", { ...VALID.goal, category: "" }],
  ];
  for (const [entityType, payload] of liveShapes) {
    const result = validateEntityPayload(entityType, payload);
    assert.equal(result.ok, true, `${entityType}: ${result.ok ? "" : result.error}`);
  }
});

test("a record stored under a key that disagrees with its payload is rejected", () => {
  const mismatch = validateEntityPayload("tx", { ...VALID.tx, id: "t-9" }, "t-8");
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.ok === false ? mismatch.error : "", /stored under "t-8" but the payload identifier is "t-9"/);

  assert.equal(validateEntityPayload("tx", VALID.tx, "t-1").ok, true);
  // Budgets are keyed by categoryId and carry no id.
  assert.equal(validateEntityPayload("budget", VALID.budget, "food").ok, true);
  assert.equal(validateEntityPayload("budget", VALID.budget, "bills").ok, false);
});

test("pulled rows are split into mergeable and reported records", () => {
  const base = { server_updated_at: "2026-11-16T00:00:00Z" };
  const rows = [
    { ...base, entity_type: "person", entity_id: "p-1", payload: { ...VALID.person, id: "p-1" }, deleted_at_ms: null },
    { ...base, entity_type: "tx", entity_id: "t-2", payload: { ...VALID.tx, id: "t-2" }, deleted_at_ms: null },
    { ...base, entity_type: "tx", entity_id: "t-3", payload: { ...VALID.tx, id: "t-3", amount: "12" }, deleted_at_ms: null },
    { ...base, entity_type: "debt", entity_id: "d-1", payload: { ...VALID.debt, id: "d-2" }, deleted_at_ms: null },
    // A tombstone only deletes a local record; its payload is never merged.
    { ...base, entity_type: "wallet", entity_id: "w-1", payload: {}, deleted_at_ms: 1_700_000_000_000 },
    // Unknown types are ignored by the merge itself, so they are not errors.
    { ...base, entity_type: "futureThing", entity_id: "x-1", payload: {}, deleted_at_ms: null },
  ];

  const { valid, invalid } = splitRemoteRecords(rows);
  assert.deepEqual(valid.map((row) => row.entity_id), ["p-1", "t-2", "w-1", "x-1"]);
  assert.deepEqual(invalid.map((entry) => entry.row.entity_id), ["t-3", "d-1"]);
  assert.match(invalid[0].error, /^tx\.amount:/);
  assert.match(invalid[1].error, /payload identifier is "d-2"/);
  assert.equal(valid.length + invalid.length, rows.length);
});

test("an unknown entity type is rejected instead of passed through", () => {
  const result = validateEntityPayload("unknownEntity" as EntityType, { id: "x" });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /unknown entity type/);
});
