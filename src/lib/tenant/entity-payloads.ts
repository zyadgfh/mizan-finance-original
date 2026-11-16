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

/**
 * Validate one outbox payload against its entity schema.
 *
 * Returns a readable `${entityType}.${field}: …` error rather than throwing, so
 * callers can report the record through the existing rejected-sync channel.
 */
export function validateEntityPayload(entityType: EntityType, payload: unknown): PayloadValidation {
  const schema = ENTITY_PAYLOAD_SCHEMAS[entityType];
  if (!schema) {
    return { ok: false, error: `unknown entity type "${String(entityType)}"` };
  }
  const result = schema.safeParse(payload);
  if (result.success) return { ok: true };

  const issue = result.error.issues[0];
  const field = issue?.path.length ? issue.path.join(".") : null;
  const message = issue?.message ?? "payload is invalid";
  return { ok: false, error: field ? `${entityType}.${field}: ${message}` : `${entityType}: ${message}` };
}
