import { z } from "zod";
import { CURRENCIES } from "../finance/types.ts";
import type { EntityType } from "./types.ts";

/**
 * Per-entity payload schemas for tenant sync.
 *
 * The sync outbox carries a free-form `payload` JSON object per entity. Until
 * now only the envelope (entityType / entityId / updatedAtMs) was checked, so a
 * malformed record could be uploaded and then merged into every workspace
 * member's local dataset. These schemas mirror `public.tenant_payload_error`
 * (supabase/migrations/20261116045649_tenant_payload_validation.sql and the
 * refined rules in 20261116050147): the same required fields, JSON types and
 * closed value sets.
 *
 * Scope is deliberate: this catches corruption, not business rules.
 *   - only *identifier* fields must be non-empty — they are join keys;
 *   - free text may be `""`, because the app stores empty notes, phones and
 *     due dates that way;
 *   - an optional closed-set field stored as `""` counts as "not set";
 *   - extra keys are tolerated and never written back.
 * Unknown keys are stripped from the parsed output, which callers ignore.
 */

const id = z.string().trim().min(1);
const num = z.number();
const text = z.string();

/** Optional closed-set field: `""` is treated as "not set". */
function optionalEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.union([z.enum(values), z.literal("")]).nullish();
}

const txKind = z.enum(["income", "expense"]);
const toneEnum = z.enum(["tint", "green", "red", "orange", "gray"]);

const txSchema = z.object({
  id,
  kind: txKind,
  amount: num,
  categoryId: id,
  date: text,
  note: z.string().nullish(),
  currency: optionalEnum(CURRENCIES),
  exchangeRate: num.nullish(),
  baseAmount: num.nullish(),
  personId: id.nullish(),
  walletId: id.nullish(),
  receiptId: id.nullish(),
  source: optionalEnum(["manual", "recurring", "debt", "split"]),
  reported: z.boolean().nullish(),
  createdAt: num.nullish(),
});

const personSchema = z.object({
  id,
  name: text,
  phone: text.nullish(),
  note: text.nullish(),
  createdAt: num.nullish(),
});

const debtSchema = z.object({
  id,
  personId: id,
  direction: z.enum(["receivable", "payable"]),
  title: text,
  principal: num,
  dueDate: text,
  installments: num.nullish(),
  cadence: optionalEnum(["monthly", "biweekly", "weekly"]),
  note: text.nullish(),
  createdAt: num.nullish(),
});

const paymentSchema = z.object({
  id,
  debtId: id,
  amount: num,
  date: text,
  note: text.nullish(),
  walletId: id.nullish(),
  txId: id.nullish(),
  createdAt: num.nullish(),
});

const walletSchema = z.object({
  id,
  name: text,
  kind: z.enum(["cash", "instapay", "vodafone", "bank", "card", "other"]),
  opening: num,
  cardDesign: text.nullish(),
  last4: text.nullish(),
  subtitle: text.nullish(),
  createdAt: num.nullish(),
});

const transferSchema = z.object({
  id,
  fromId: id,
  toId: id,
  amount: num,
  date: text,
  note: text.nullish(),
  createdAt: num.nullish(),
});

const budgetSchema = z.object({
  categoryId: id,
  limit: num,
});

const goalSchema = z.object({
  id,
  name: text,
  target: num,
  deadline: text,
  category: optionalEnum(["general", "travel", "debt_payoff", "device", "emergency"]),
  linkedDebtId: id.nullish(),
  createdAt: num.nullish(),
});

const goalMoveSchema = z.object({
  id,
  goalId: id,
  walletId: id,
  amount: num,
  date: text,
  note: text.nullish(),
  createdAt: num.nullish(),
});

const recurringSchema = z.object({
  id,
  kind: txKind,
  amount: num,
  categoryId: id,
  walletId: id,
  day: num,
  active: z.boolean(),
  lastMonth: text,
  note: text.nullish(),
  createdAt: num.nullish(),
});

const categorySchema = z.object({
  id,
  name: text,
  kind: txKind,
  icon: text,
  tone: toneEnum,
  custom: z.boolean().nullish(),
});

const debtAuditSchema = z.object({
  id,
  debtId: id,
  action: z.enum(["created", "debt-edited", "payment-added", "payment-edited", "payment-deleted"]),
  at: num,
  summary: text,
  beforeAmount: num.nullish(),
  afterAmount: num.nullish(),
  beforeDate: text.nullish(),
  afterDate: text.nullish(),
});

export const ENTITY_PAYLOAD_SCHEMAS: Record<EntityType, z.ZodType> = {
  tx: txSchema,
  person: personSchema,
  debt: debtSchema,
  payment: paymentSchema,
  wallet: walletSchema,
  transfer: transferSchema,
  budget: budgetSchema,
  goal: goalSchema,
  goalMove: goalMoveSchema,
  recurring: recurringSchema,
  category: categorySchema,
  debtAudit: debtAuditSchema,
};

export type PayloadValidation = { ok: true } | { ok: false; error: string };

/** The field a tenant record is keyed by: budgets are keyed by category, not id. */
export function payloadIdentifier(entityType: EntityType, payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const value = record[entityType === "budget" ? "categoryId" : "id"];
  return typeof value === "string" ? value : null;
}

/**
 * Validate one record payload against its entity schema.
 *
 * Returns a readable `${entityType}.${field}: …` error rather than throwing, so
 * callers can report the record through the existing rejected-sync channel.
 *
 * `expectedId` is the key the record is stored under (`entityId` on push,
 * `entity_id` on pull). When given, the payload's own identifier must match it:
 * a record filed under a key that disagrees with its contents silently corrupts
 * the workspace on the next merge.
 */
export function validateEntityPayload(
  entityType: EntityType,
  payload: unknown,
  expectedId?: string | null,
): PayloadValidation {
  const schema = ENTITY_PAYLOAD_SCHEMAS[entityType];
  if (!schema) {
    return { ok: false, error: `unknown entity type "${String(entityType)}"` };
  }
  const result = schema.safeParse(payload);
  if (result.success === false) {
    const issue = result.error.issues[0];
    const field = issue?.path.length ? issue.path.join(".") : null;
    const message = issue?.message ?? "payload is invalid";
    return { ok: false, error: field ? `${entityType}.${field}: ${message}` : `${entityType}: ${message}` };
  }

  if (expectedId !== undefined && expectedId !== null) {
    const ownId = payloadIdentifier(entityType, payload);
    if (ownId !== expectedId) {
      return {
        ok: false,
        error: `${entityType}: stored under "${expectedId}" but the payload identifier is "${ownId ?? ""}"`,
      };
    }
  }

  return { ok: true };
}

/** Minimal shape of a row pulled from `tenant_records`. */
export type RemoteRecordLike = {
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown> | null;
  deleted_at_ms: number | null;
};

/**
 * Split pulled rows into the ones safe to merge and the ones to report.
 *
 * Server data is not trusted blindly: a row can predate validation, be written
 * by hand, or be filed under a key that disagrees with its payload. Merging such
 * a row into the local dataset is what we are avoiding. Tombstones only delete a
 * local record, so their payload is never inspected.
 */
export function splitRemoteRecords<T extends RemoteRecordLike>(
  rows: T[],
): { valid: T[]; invalid: Array<{ row: T; error: string }> } {
  const valid: T[] = [];
  const invalid: Array<{ row: T; error: string }> = [];

  for (const row of rows) {
    if (row.deleted_at_ms !== null && row.deleted_at_ms !== undefined) {
      valid.push(row);
      continue;
    }
    // Unknown entity types are ignored by the merge itself; not an error here.
    if (!(row.entity_type in ENTITY_PAYLOAD_SCHEMAS)) {
      valid.push(row);
      continue;
    }
    const validation = validateEntityPayload(
      row.entity_type as EntityType,
      row.payload ?? {},
      row.entity_id,
    );
    if (validation.ok) valid.push(row);
    else invalid.push({ row, error: validation.error });
  }

  return { valid, invalid };
}
