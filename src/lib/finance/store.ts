import { create } from "zustand";
import { clearScheduledTasks } from "../notifications/tasks.ts";
import {
  decryptBackupPayload,
  encryptBackupPayload,
  isEncryptedBackupEnvelope,
  validateBackupJsonObject,
} from "../sync/crypto-backup.ts";
import { currentMonth, defaultWallets, isCurrency, round2, todayISO } from "./logic.ts";
import { writePinHash } from "./pin.ts";
import { clearReceipts, exportAllReceipts, importAllReceipts } from "./receipts.ts";
import { overwriteAndClearLocalKeys } from "./security.ts";
import { seedData } from "./seed.ts";
import type {
  Budget,
  Category,
  Currency,
  Data,
  Debt,
  DebtAuditEntry,
  DebtCadence,
  DebtDirection,
  Goal,
  GoalCategory,
  GoalMove,
  Payment,
  Person,
  Recurring,
  Transfer,
  Tx,
  TxKind,
  Wallet,
  WalletKind,
} from "./types.ts";

const KEY = "mizan.v1";
const UPDATED_AT_KEY = "mizan.updatedAt";
const PENDING_SYNC_KEY = "mizan.drive.pending";

export type TxInput = {
  id?: string;
  kind: TxKind;
  amount: number;
  categoryId: string;
  note: string;
  date: string;
  personId?: string;
  walletId?: string;
  source?: Tx["source"];
  reported?: boolean;
  receiptId?: string;
};

export type DebtInput = {
  personId: string;
  direction: DebtDirection;
  title: string;
  principal: number;
  dueDate: string;
  note: string;
  installments: number;
  cadence?: DebtCadence;
};

export type PersonInput = { name: string; phone: string; note: string };

export type PaymentInput = {
  debtId: string;
  amount: number;
  date: string;
  note: string;
  walletId?: string;
  linkCash: boolean;
};

export type SplitInput = {
  total: number;
  categoryId: string;
  note: string;
  date: string;
  walletId: string;
  personIds: string[];
  includeMe: boolean;
};

export type ResetOptions = {
  clearSecurityAndTasks?: boolean;
};

type RemovedTxn = { tx: Tx; payment?: Payment };
type RemovedDebt = { debt: Debt; payments: Payment[]; txns: Tx[] };
type RemovedPerson = { person: Person; linkedTxIds: string[] };

type Actions = {
  addTxn: (input: TxInput) => string;
  updateTxn: (id: string, input: TxInput) => boolean;
  removeTxn: (id: string) => RemovedTxn | undefined;
  restoreTxn: (tx: Tx) => void;
  addPerson: (input: PersonInput) => string;
  updatePerson: (id: string, input: PersonInput) => void;
  removePerson: (id: string) => RemovedPerson | undefined;
  restorePerson: (person: Person, linkedTxIds?: string[]) => void;
  addDebt: (input: DebtInput) => string;
  updateDebt: (id: string, input: DebtInput) => void;
  removeDebt: (id: string) => RemovedDebt | undefined;
  restoreDebt: (debt: Debt, payments: Payment[], txns?: Tx[]) => void;
  addPayment: (input: PaymentInput) => string;
  removePayment: (id: string) => { payment: Payment; tx?: Tx } | undefined;
  restorePayment: (payment: Payment) => void;
  addCategory: (name: string, kind: TxKind) => string | null;
  removeCategory: (id: string) => boolean;
  setBudget: (categoryId: string, limit: number) => void;
  setOpening: (n: number) => void;
  setCurrency: (c: Currency) => void;
  setPhoneCountryCode: (code: string) => void;
  addWallet: (input: { name: string; kind: WalletKind; opening: number }) => string;
  updateWallet: (id: string, input: { name: string; kind: WalletKind; opening: number }) => void;
  removeWallet: (id: string) => boolean;
  addTransfer: (input: { fromId: string; toId: string; amount: number; date: string; note: string }) => string | null;
  removeTransfer: (id: string) => Transfer | undefined;
  restoreTransfer: (transfer: Transfer) => void;
  addRecurring: (input: Omit<Recurring, "id" | "createdAt" | "lastMonth">) => string;
  updateRecurring: (id: string, input: Omit<Recurring, "id" | "createdAt" | "lastMonth">) => void;
  removeRecurring: (id: string) => void;
  confirmRecurring: (id: string) => string | null;
  skipRecurring: (id: string) => void;
  addGoal: (input: { name: string; target: number; deadline: string; category?: GoalCategory; linkedDebtId?: string }) => string;
  updateGoal: (id: string, input: { name: string; target: number; deadline: string; category?: GoalCategory; linkedDebtId?: string }) => void;
  removeGoal: (id: string) => void;
  addGoalMove: (input: { goalId: string; walletId: string; amount: number; date: string; note: string }) => string;
  removeGoalMove: (id: string) => GoalMove | undefined;
  restoreGoalMove: (move: GoalMove) => void;
  splitBill: (input: SplitInput) => void;
  setReceiptFlag: (txId: string, on: boolean) => void;
  replaceAll: (data: Data, remoteUpdatedAt?: number) => void;
  resetAll: (options?: ResetOptions) => void;
};

function uid() {
  return crypto.randomUUID();
}

const DEBT_CATS: Category[] = [
  { id: "c-debt-out", name: "سداد دين", kind: "expense", icon: "wallet", tone: "gray" },
  { id: "c-debt-in", name: "تحصيل دين", kind: "income", icon: "wallet", tone: "green" },
];

export function pickFinanceData(s: Data): Data {
  return {
    txns: s.txns,
    people: s.people,
    debts: s.debts,
    payments: s.payments,
    categories: s.categories,
    budgets: s.budgets,
    openingBalance: s.openingBalance,
    currency: s.currency,
    phoneCountryCode: s.phoneCountryCode,
    demo: s.demo,
    wallets: s.wallets,
    transfers: s.transfers,
    recurring: s.recurring,
    goals: s.goals,
    goalMoves: s.goalMoves,
    debtLogs: s.debtLogs ?? [],
  };
}

function appendAudit(logs: DebtAuditEntry[] | undefined, entry: Omit<DebtAuditEntry, "id" | "at">): DebtAuditEntry[] {
  const next: DebtAuditEntry = { ...entry, id: uid(), at: Date.now() };
  return [next, ...(logs ?? [])].slice(0, 300);
}

function cashOpeningOf(wallets: Wallet[], fallback: number) {
  return wallets.find((w) => w.id === "w-cash")?.opening ?? fallback;
}

let skipNextUpdatedAtBump = false;

export function getLocalUpdatedAt(): number {
  if (typeof localStorage === "undefined") return 0;
  const raw = Number(localStorage.getItem(UPDATED_AT_KEY) ?? "0");
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function setLocalUpdatedAt(ts: number): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(UPDATED_AT_KEY, String(Math.max(0, Math.round(ts))));
}

export function getPendingCloudSync(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(PENDING_SYNC_KEY) === "1";
}

export function setPendingCloudSync(pending: boolean): void {
  if (typeof localStorage === "undefined") return;
  if (pending) localStorage.setItem(PENDING_SYNC_KEY, "1");
  else localStorage.removeItem(PENDING_SYNC_KEY);
}

export const useFinance = create<Data & Actions>((set, get) => ({
  ...seedData(),
  addTxn: (input) => {
    const id = input.id ?? uid();
    const tx: Tx = {
      id,
      kind: input.kind,
      amount: round2(input.amount),
      categoryId: input.categoryId,
      note: input.note.trim(),
      date: input.date,
      personId: input.personId || undefined,
      walletId: input.walletId || "w-cash",
      source: input.source ?? "manual",
      reported: input.reported !== false,
      receiptId: input.receiptId,
      createdAt: Date.now(),
    };
    set({ txns: [tx, ...get().txns.filter((t) => t.id !== id)] });
    return id;
  },
  updateTxn: (id, input) => {
    const existing = get().txns.find((t) => t.id === id);
    if (!existing) return false;
    const linkedPayment = get().payments.find((p) => p.txId === id);
    const amount = round2(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return false;

    if (linkedPayment) {
      const debt = get().debts.find((d) => d.id === linkedPayment.debtId);
      if (debt) {
        const otherPaid = get().payments.reduce(
          (s, p) => (p.debtId === debt.id && p.id !== linkedPayment.id ? s + p.amount : s),
          0,
        );
        if (amount > round2(debt.principal - otherPaid) + 0.009) {
          return false;
        }
      }
      const nextKind = debt ? (debt.direction === "receivable" ? "income" : "expense") : existing.kind;
      const amountChanged = linkedPayment.amount !== amount || linkedPayment.date !== input.date;
      set({
        txns: get().txns.map((t) =>
          t.id === id
            ? {
                ...t,
                kind: nextKind,
                amount,
                categoryId: input.categoryId,
                note: input.note.trim(),
                date: input.date,
                personId: debt ? debt.personId : input.personId || undefined,
                walletId: input.walletId || "w-cash",
                receiptId: input.receiptId,
              }
            : t,
        ),
        payments: get().payments.map((p) =>
          p.id === linkedPayment.id
            ? {
                ...p,
                amount,
                date: input.date,
                note: input.note.trim(),
                walletId: input.walletId || "w-cash",
              }
            : p,
        ),
        debtLogs:
          debt && amountChanged
            ? appendAudit(get().debtLogs, {
                debtId: debt.id,
                action: "payment-edited",
                summary: `تعديل دفعة سابقة من ${linkedPayment.amount} إلى ${amount}`,
                beforeAmount: linkedPayment.amount,
                afterAmount: amount,
                beforeDate: linkedPayment.date,
                afterDate: input.date,
              })
            : get().debtLogs,
      });
      return true;
    }

    set({
      txns: get().txns.map((t) =>
        t.id === id
          ? {
              ...t,
              kind: input.kind,
              amount,
              categoryId: input.categoryId,
              note: input.note.trim(),
              date: input.date,
              personId: input.personId || undefined,
              walletId: input.walletId || "w-cash",
              receiptId: input.receiptId,
            }
          : t,
      ),
    });
    return true;
  },
  removeTxn: (id) => {
    const tx = get().txns.find((t) => t.id === id);
    if (!tx) return undefined;
    const payment = get().payments.find((p) => p.txId === id);
    set({
      txns: get().txns.filter((t) => t.id !== id),
      payments: payment ? get().payments.filter((p) => p.id !== payment.id) : get().payments,
    });
    return { tx, payment };
  },
  restoreTxn: (tx) => set({ txns: [tx, ...get().txns.filter((t) => t.id !== tx.id)] }),
  addPerson: (input) => {
    const id = uid();
    const person: Person = {
      id,
      name: input.name.trim(),
      phone: input.phone.trim(),
      note: input.note.trim(),
      createdAt: Date.now(),
    };
    set({ people: [person, ...get().people] });
    return id;
  },
  updatePerson: (id, input) => {
    set({
      people: get().people.map((p) =>
        p.id === id
          ? { ...p, name: input.name.trim(), phone: input.phone.trim(), note: input.note.trim() }
          : p,
      ),
    });
  },
  removePerson: (id) => {
    const person = get().people.find((p) => p.id === id);
    if (!person) return undefined;
    const linkedTxIds = get()
      .txns.filter((t) => t.personId === id)
      .map((t) => t.id);
    set({
      people: get().people.filter((p) => p.id !== id),
      txns: get().txns.map((t) => (t.personId === id ? { ...t, personId: undefined } : t)),
    });
    return { person, linkedTxIds };
  },
  restorePerson: (person, linkedTxIds = []) => {
    const idSet = new Set(linkedTxIds);
    set({
      people: [person, ...get().people.filter((p) => p.id !== person.id)],
      txns: idSet.size
        ? get().txns.map((t) => (idSet.has(t.id) ? { ...t, personId: person.id } : t))
        : get().txns,
    });
  },
  addDebt: (input) => {
    const id = uid();
    const principal = round2(input.principal);
    const title = input.title.trim() || "دين";
    const debt: Debt = {
      id,
      personId: input.personId,
      direction: input.direction,
      title,
      note: input.note.trim(),
      principal,
      dueDate: input.dueDate,
      installments: clampInstallments(input.installments),
      cadence: input.cadence ?? "monthly",
      createdAt: Date.now(),
    };
    set({
      debts: [debt, ...get().debts],
      debtLogs: appendAudit(get().debtLogs, {
        debtId: id,
        action: "created",
        summary: `تسجيل دين «${title}» بمبلغ ${principal}`,
        afterAmount: principal,
        afterDate: input.dueDate || undefined,
      }),
    });
    return id;
  },
  updateDebt: (id, input) => {
    const prev = get().debts.find((d) => d.id === id);
    const nextPrincipal = round2(input.principal);
    const nextInstallments = clampInstallments(input.installments);
    const nextCadence = input.cadence ?? prev?.cadence ?? "monthly";
    const changes: string[] = [];
    if (prev) {
      if (prev.principal !== nextPrincipal) changes.push(`المبلغ: ${prev.principal} → ${nextPrincipal}`);
      if ((prev.dueDate || "") !== (input.dueDate || "")) changes.push(`الاستحقاق: ${prev.dueDate || "—"} → ${input.dueDate || "—"}`);
      if ((prev.installments || 1) !== nextInstallments) changes.push(`الأقساط: ${prev.installments || 1} → ${nextInstallments}`);
      if ((prev.cadence ?? "monthly") !== nextCadence) changes.push("تغيير التكرار");
    }
    set({
      debts: get().debts.map((d) =>
        d.id === id
          ? {
              ...d,
              personId: input.personId,
              direction: input.direction,
              title: input.title.trim() || "دين",
              note: input.note.trim(),
              principal: nextPrincipal,
              dueDate: input.dueDate,
              installments: nextInstallments,
              cadence: nextCadence,
            }
          : d,
      ),
      debtLogs:
        prev && changes.length
          ? appendAudit(get().debtLogs, {
              debtId: id,
              action: "debt-edited",
              summary: `تعديل الدين (${changes.join(" · ")})`,
              beforeAmount: prev.principal,
              afterAmount: nextPrincipal,
              beforeDate: prev.dueDate || undefined,
              afterDate: input.dueDate || undefined,
            })
          : get().debtLogs,
    });
  },
  removeDebt: (id) => {
    const debt = get().debts.find((d) => d.id === id);
    if (!debt) return undefined;
    const payments = get().payments.filter((p) => p.debtId === id);
    const txIds = new Set(payments.map((p) => p.txId).filter((x): x is string => Boolean(x)));
    const txns = get().txns.filter((t) => txIds.has(t.id));
    set({
      debts: get().debts.filter((d) => d.id !== id),
      payments: get().payments.filter((p) => p.debtId !== id),
      txns: get().txns.filter((t) => !txIds.has(t.id)),
      debtLogs: (get().debtLogs ?? []).filter((l) => l.debtId !== id),
    });
    return { debt, payments, txns };
  },
  restoreDebt: (debt, payments, txns = []) =>
    set({
      debts: [debt, ...get().debts.filter((d) => d.id !== debt.id)],
      payments: [...payments, ...get().payments.filter((p) => p.debtId !== debt.id)],
      txns: [...txns, ...get().txns.filter((t) => !txns.some((x) => x.id === t.id))],
    }),
  addPayment: (input) => {
    const debt = get().debts.find((d) => d.id === input.debtId);
    if (!debt) return "";
    const id = uid();
    const amount = round2(input.amount);
    const priorPaid = get().payments.reduce((s, p) => (p.debtId === debt.id ? s + p.amount : s), 0);
    const beforeRem = round2(Math.max(0, debt.principal - priorPaid));
    const afterRem = round2(Math.max(0, beforeRem - amount));
    let txId: string | undefined;
    if (input.linkCash) {
      txId = uid();
      const income = debt.direction === "receivable";
      const categoryId = ensureDebtCategory(get, set, income ? "income" : "expense");
      const tx: Tx = {
        id: txId,
        kind: income ? "income" : "expense",
        amount,
        categoryId,
        note: input.note.trim() || `${income ? "تحصيل" : "سداد"} · ${debt.title}`,
        date: input.date,
        personId: debt.personId,
        walletId: input.walletId || "w-cash",
        source: "debt",
        reported: false,
        createdAt: Date.now(),
      };
      set({ txns: [tx, ...get().txns] });
    }
    const payment: Payment = {
      id,
      debtId: input.debtId,
      amount,
      date: input.date,
      note: input.note.trim(),
      walletId: input.linkCash ? input.walletId || "w-cash" : undefined,
      txId,
      createdAt: Date.now(),
    };
    set({
      payments: [payment, ...get().payments],
      debtLogs: appendAudit(get().debtLogs, {
        debtId: debt.id,
        action: "payment-added",
        summary: `${debt.direction === "receivable" ? "تحصيل" : "سداد"} دفعة ${amount}`,
        beforeAmount: beforeRem,
        afterAmount: afterRem,
        afterDate: input.date,
      }),
    });
    return id;
  },
  removePayment: (id) => {
    const payment = get().payments.find((p) => p.id === id);
    if (!payment) return undefined;
    const debt = get().debts.find((d) => d.id === payment.debtId);
    const tx = payment.txId ? get().txns.find((t) => t.id === payment.txId) : undefined;
    set({
      payments: get().payments.filter((p) => p.id !== id),
      txns: tx ? get().txns.filter((t) => t.id !== tx.id) : get().txns,
      debtLogs: debt
        ? appendAudit(get().debtLogs, {
            debtId: debt.id,
            action: "payment-deleted",
            summary: `حذف دفعة بقيمة ${payment.amount} (${payment.date})`,
            beforeAmount: payment.amount,
            afterAmount: 0,
            beforeDate: payment.date,
          })
        : get().debtLogs,
    });
    return { payment, tx };
  },
  restorePayment: (payment) =>
    set({ payments: [payment, ...get().payments.filter((p) => p.id !== payment.id)] }),
  addCategory: (name, kind) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const id = uid();
    set({
      categories: [...get().categories, { id, name: trimmed, kind, icon: "tag", tone: "gray", custom: true }],
    });
    return id;
  },
  removeCategory: (id) => {
    const cat = get().categories.find((c) => c.id === id);
    if (!cat?.custom) return false;
    if (get().txns.some((t) => t.categoryId === id)) return false;
    if (get().recurring.some((r) => r.categoryId === id)) return false;
    set({
      categories: get().categories.filter((c) => c.id !== id),
      budgets: get().budgets.filter((b) => b.categoryId !== id),
    });
    return true;
  },
  setBudget: (categoryId, limit) => {
    const rest: Budget[] = get().budgets.filter((b) => b.categoryId !== categoryId);
    if (limit <= 0) set({ budgets: rest });
    else set({ budgets: [...rest, { categoryId, limit: round2(limit) }] });
  },
  setOpening: (n) => {
    const opening = round2(Math.max(0, n));
    const wallets = get().wallets.some((w) => w.id === "w-cash")
      ? get().wallets.map((w) => (w.id === "w-cash" ? { ...w, opening } : w))
      : [{ id: "w-cash", name: "كاش", kind: "cash" as const, opening, createdAt: Date.now() }, ...get().wallets];
    set({ openingBalance: opening, wallets });
  },
  setCurrency: (c) => set({ currency: c }),
  setPhoneCountryCode: (code) => {
    const sanitized = code.replace(/\D/g, "").slice(0, 4);
    set({ phoneCountryCode: sanitized || undefined });
  },
  addWallet: (input) => {
    const id = uid();
    const wallet: Wallet = {
      id,
      name: input.name.trim() || "محفظة",
      kind: input.kind,
      opening: round2(Math.max(0, input.opening)),
      createdAt: Date.now(),
    };
    set({ wallets: [...get().wallets, wallet] });
    return id;
  },
  updateWallet: (id, input) => {
    set({
      wallets: get().wallets.map((w) =>
        w.id === id
          ? { ...w, name: input.name.trim() || w.name, kind: input.kind, opening: round2(Math.max(0, input.opening)) }
          : w,
      ),
      openingBalance: id === "w-cash" ? round2(Math.max(0, input.opening)) : get().openingBalance,
    });
  },
  removeWallet: (id) => {
    if (id === "w-cash") return false;
    const used =
      get().txns.some((t) => (t.walletId || "w-cash") === id) ||
      get().transfers.some((t) => t.fromId === id || t.toId === id) ||
      get().goalMoves.some((m) => m.walletId === id) ||
      get().recurring.some((r) => r.walletId === id) ||
      get().payments.some((p) => p.walletId === id);
    if (used) return false;
    set({ wallets: get().wallets.filter((w) => w.id !== id) });
    return true;
  },
  addTransfer: (input) => {
    if (!input.fromId || input.fromId === input.toId) return null;
    const id = uid();
    const transfer: Transfer = {
      id,
      fromId: input.fromId,
      toId: input.toId,
      amount: round2(input.amount),
      date: input.date,
      note: input.note.trim(),
      createdAt: Date.now(),
    };
    set({ transfers: [transfer, ...get().transfers] });
    return id;
  },
  removeTransfer: (id) => {
    const transfer = get().transfers.find((t) => t.id === id);
    if (!transfer) return undefined;
    set({ transfers: get().transfers.filter((t) => t.id !== id) });
    return transfer;
  },
  restoreTransfer: (transfer) =>
    set({ transfers: [transfer, ...get().transfers.filter((t) => t.id !== transfer.id)] }),
  addRecurring: (input) => {
    const id = uid();
    const row: Recurring = {
      ...input,
      id,
      note: input.note.trim(),
      day: clampDay(input.day),
      amount: round2(input.amount),
      lastMonth: "",
      createdAt: Date.now(),
    };
    set({ recurring: [row, ...get().recurring] });
    return id;
  },
  updateRecurring: (id, input) => {
    set({
      recurring: get().recurring.map((r) =>
        r.id === id
          ? { ...r, ...input, note: input.note.trim(), day: clampDay(input.day), amount: round2(input.amount) }
          : r,
      ),
    });
  },
  removeRecurring: (id) => set({ recurring: get().recurring.filter((r) => r.id !== id) }),
  confirmRecurring: (id) => {
    const row = get().recurring.find((r) => r.id === id);
    const month = currentMonth();
    if (!row || !row.active || row.lastMonth === month) return null;
    const txId = uid();
    const tx: Tx = {
      id: txId,
      kind: row.kind,
      amount: row.amount,
      categoryId: row.categoryId,
      note: row.note,
      date: todayISO(),
      walletId: row.walletId,
      source: "recurring",
      reported: true,
      createdAt: Date.now(),
    };
    set({
      txns: [tx, ...get().txns],
      recurring: get().recurring.map((r) => (r.id === id ? { ...r, lastMonth: month } : r)),
    });
    return txId;
  },
  skipRecurring: (id) => {
    const month = currentMonth();
    set({
      recurring: get().recurring.map((r) => (r.id === id ? { ...r, lastMonth: month } : r)),
    });
  },
  addGoal: (input) => {
    const id = uid();
    const goal: Goal = {
      id,
      name: input.name.trim() || "هدف",
      target: round2(input.target),
      deadline: input.deadline,
      category: input.category ?? "general",
      linkedDebtId: input.linkedDebtId || undefined,
      createdAt: Date.now(),
    };
    set({ goals: [goal, ...get().goals] });
    return id;
  },
  updateGoal: (id, input) => {
    set({
      goals: get().goals.map((g) =>
        g.id === id
          ? {
              ...g,
              name: input.name.trim() || g.name,
              target: round2(input.target),
              deadline: input.deadline,
              category: input.category ?? g.category ?? "general",
              linkedDebtId: input.linkedDebtId !== undefined ? input.linkedDebtId || undefined : g.linkedDebtId,
            }
          : g,
      ),
    });
  },
  removeGoal: (id) =>
    set({
      goals: get().goals.filter((g) => g.id !== id),
      goalMoves: get().goalMoves.filter((m) => m.goalId !== id),
    }),
  addGoalMove: (input) => {
    const id = uid();
    const move: GoalMove = {
      id,
      goalId: input.goalId,
      walletId: input.walletId,
      amount: round2(input.amount),
      date: input.date,
      note: input.note.trim(),
      createdAt: Date.now(),
    };
    set({ goalMoves: [move, ...get().goalMoves] });
    return id;
  },
  removeGoalMove: (id) => {
    const move = get().goalMoves.find((m) => m.id === id);
    if (!move) return undefined;
    set({ goalMoves: get().goalMoves.filter((m) => m.id !== id) });
    return move;
  },
  restoreGoalMove: (move) => set({ goalMoves: [move, ...get().goalMoves.filter((m) => m.id !== move.id)] }),
  splitBill: (input) => {
    const ids = input.personIds.filter(Boolean);
    const parts = ids.length + (input.includeMe ? 1 : 0);
    if (parts < 2 || input.total <= 0) return;
    const base = round2(input.total / parts);
    let allocated = 0;
    const shares = ids.map((personId, index) => {
      const last = !input.includeMe && index === ids.length - 1;
      const amount = last ? round2(input.total - allocated) : base;
      allocated = round2(allocated + amount);
      return { personId, amount };
    });
    const mine = input.includeMe ? round2(input.total - allocated) : 0;
    const title = input.note.trim() || "فاتورة مقسّمة";
    const txns: Tx[] = [];
    const debts: Debt[] = [];
    if (mine > 0) {
      txns.push({
        id: uid(),
        kind: "expense",
        amount: mine,
        categoryId: input.categoryId,
        note: title,
        date: input.date,
        walletId: input.walletId,
        source: "split",
        reported: true,
        createdAt: Date.now(),
      });
    }
    for (const share of shares) {
      if (share.amount <= 0) continue;
      const person = get().people.find((p) => p.id === share.personId);
      txns.push({
        id: uid(),
        kind: "expense",
        amount: share.amount,
        categoryId: input.categoryId,
        note: `حصّة ${person?.name ?? ""} · ${title}`.trim(),
        date: input.date,
        personId: share.personId,
        walletId: input.walletId,
        source: "split",
        reported: false,
        createdAt: Date.now(),
      });
      debts.push({
        id: uid(),
        personId: share.personId,
        direction: "receivable",
        title,
        principal: share.amount,
        dueDate: "",
        installments: 1,
        note: "من فاتورة مقسّمة",
        createdAt: Date.now(),
      });
    }
    set({ txns: [...txns, ...get().txns], debts: [...debts, ...get().debts] });
  },
  setReceiptFlag: (txId, on) => {
    set({
      txns: get().txns.map((t) => (t.id === txId ? { ...t, receiptId: on ? txId : undefined } : t)),
    });
  },
  replaceAll: (data, remoteUpdatedAt) => {
    if (typeof remoteUpdatedAt === "number") {
      skipNextUpdatedAtBump = true;
      setLocalUpdatedAt(remoteUpdatedAt);
    }
    set({ ...data });
  },
  resetAll: (options) => {
    const fresh = seedData();
    const wallets = defaultWallets(0);
    set({
      ...fresh,
      txns: [],
      people: [],
      debts: [],
      payments: [],
      budgets: [],
      openingBalance: 0,
      phoneCountryCode: undefined,
      demo: false,
      wallets,
      transfers: [],
      recurring: [],
      goals: [],
      goalMoves: [],
      debtLogs: [],
    });
    void clearReceipts();
    if (options?.clearSecurityAndTasks && typeof localStorage !== "undefined") {
      try {
        writePinHash(null);
        clearScheduledTasks();
        overwriteAndClearLocalKeys(localStorage);
      } catch {
        /* ignore storage errors */
      }
      if (typeof window !== "undefined") {
        void import("../notifications/scheduler.ts")
          .then((m) => m.cancelAllTaskNotifications())
          .catch(() => undefined);
      }
    }
  },
}));

function clampInstallments(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.min(36, Math.max(1, Math.round(n)));
}

function clampDay(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.min(28, Math.max(1, Math.round(n)));
}

function ensureDebtCategory(
  get: () => Data,
  set: (partial: Partial<Data>) => void,
  kind: TxKind,
) {
  const id = kind === "income" ? "c-debt-in" : "c-debt-out";
  if (!get().categories.some((c) => c.id === id)) {
    const cat = DEBT_CATS.find((c) => c.id === id);
    if (cat) set({ categories: [...get().categories, cat] });
  }
  return id;
}

export function asData(raw: unknown): Data | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<Data>;
  if (!Array.isArray(d.txns) || !Array.isArray(d.categories)) return null;
  if (!Array.isArray(d.people) || !Array.isArray(d.debts) || !Array.isArray(d.payments)) return null;
  const pristineDemo =
    Boolean(d.demo) &&
    !Array.isArray(d.wallets) &&
    d.txns.every((t) => t.id.startsWith("t-")) &&
    d.people.every((p) => p.id.startsWith("p-")) &&
    d.debts.every((debt) => debt.id.startsWith("d-")) &&
    d.payments.every((p) => p.id.startsWith("pay-"));
  if (pristineDemo) return seedData();
  const opening = typeof d.openingBalance === "number" ? d.openingBalance : 0;
  const wallets = Array.isArray(d.wallets) && d.wallets.length ? d.wallets : defaultWallets(opening);
  const categories = mergeCategories(d.categories.length ? d.categories : seedData().categories);
  const phoneCountryCode =
    typeof d.phoneCountryCode === "string" ? d.phoneCountryCode.replace(/\D/g, "").slice(0, 4) || undefined : undefined;
  return {
    txns: d.txns,
    people: d.people,
    debts: d.debts.map((debt) => ({ ...debt, installments: debt.installments || 1, cadence: debt.cadence ?? "monthly" })),
    payments: d.payments,
    categories,
    budgets: Array.isArray(d.budgets) ? d.budgets : [],
    openingBalance: cashOpeningOf(wallets, opening),
    currency: isCurrency(d.currency) ? d.currency : "EGP",
    phoneCountryCode,
    demo: Boolean(d.demo),
    wallets,
    transfers: Array.isArray(d.transfers) ? d.transfers : [],
    recurring: Array.isArray(d.recurring) ? d.recurring : [],
    goals: Array.isArray(d.goals) ? d.goals : [],
    goalMoves: Array.isArray(d.goalMoves) ? d.goalMoves : [],
    debtLogs: Array.isArray(d.debtLogs) ? d.debtLogs : [],
  };
}

function mergeCategories(categories: Category[]) {
  const ids = new Set(categories.map((c) => c.id));
  return [...categories, ...DEBT_CATS.filter((c) => !ids.has(c.id))];
}

let subscribed = false;

export function hydrateFinance() {
  if (subscribed || typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = asData(JSON.parse(raw));
      if (parsed) {
        skipNextUpdatedAtBump = true;
        useFinance.setState(parsed);
        if (!localStorage.getItem(UPDATED_AT_KEY)) {
          setLocalUpdatedAt(parsed.demo ? 0 : Date.now());
        }
      }
    }
  } catch {
    /* keep seed */
  }
  useFinance.subscribe((s) => {
    localStorage.setItem(KEY, JSON.stringify(pickFinanceData(s)));
    if (skipNextUpdatedAtBump) {
      skipNextUpdatedAtBump = false;
      return;
    }
    setLocalUpdatedAt(Date.now());
    setPendingCloudSync(true);
  });
  subscribed = true;
  if (!localStorage.getItem(KEY)) {
    localStorage.setItem(KEY, JSON.stringify(pickFinanceData(useFinance.getState())));
    setLocalUpdatedAt(0);
  }
}

export function downloadExportBlob(blob: Blob, filename: string) {
  const nativeBridge = (
    window as Window & {
      MizanNative?: { shareFile?: (name: string, mimeType: string, content: string) => boolean };
    }
  ).MizanNative;

  if (nativeBridge?.shareFile && !blob.type.startsWith("image/")) {
    void blob.text().then((content) => {
      const ok = nativeBridge.shareFile?.(filename, blob.type || "application/octet-stream", content);
      if (ok) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    });
    return;
  }

  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (nav && typeof nav.share === "function" && typeof nav.canShare === "function" && /Android/i.test(nav.userAgent)) {
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    if (nav.canShare({ files: [file] })) {
      void nav.share({ files: [file], title: filename }).catch(() => undefined);
      return;
    }
  }

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

export function exportData() {
  downloadExportBlob(
    new Blob([JSON.stringify(pickFinanceData(useFinance.getState()), null, 2)], { type: "application/json" }),
    "mizan-backup.json",
  );
}

export async function exportDataAsync(options: { includeReceipts?: boolean; passphrase?: string } = {}) {
  const base = pickFinanceData(useFinance.getState());
  const receipts = options.includeReceipts ? await exportAllReceipts() : {};
  const payload = Object.keys(receipts).length ? { ...base, receipts } : base;
  const jsonText = JSON.stringify(payload, null, 2);
  if (options.passphrase?.trim()) {
    const encrypted = await encryptBackupPayload(jsonText, options.passphrase.trim());
    downloadExportBlob(
      new Blob([JSON.stringify(encrypted, null, 2)], { type: "application/json" }),
      "mizan-backup-encrypted.json",
    );
    return;
  }
  downloadExportBlob(new Blob([jsonText], { type: "application/json" }), "mizan-backup.json");
}

function csvCell(value: string | number) {
  let s = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function exportCsv() {
  const s = useFinance.getState();
  const walletName = (id?: string) => s.wallets.find((w) => w.id === (id || "w-cash"))?.name ?? "";
  const personName = (id?: string) => s.people.find((p) => p.id === id)?.name ?? "";
  const lines = ["النوع,التاريخ,البيان,التفاصيل,الشخص,المحفظة,الاتجاه,المبلغ"];
  for (const t of [...s.txns].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    const cat = s.categories.find((c) => c.id === t.categoryId)?.name ?? "";
    lines.push(
      [t.kind === "income" ? "إيراد" : "مصروف", t.date, t.note || cat, cat, personName(t.personId), walletName(t.walletId), t.kind === "income" ? "داخل" : "خارج", t.amount]
        .map(csvCell)
        .join(","),
    );
  }
  for (const tr of s.transfers) {
    lines.push(
      ["تحويل", tr.date, tr.note || "تحويل", `${walletName(tr.fromId)} ← ${walletName(tr.toId)}`, "", walletName(tr.fromId), "خارج", tr.amount]
        .map(csvCell)
        .join(","),
    );
  }
  for (const d of s.debts) {
    lines.push(
      ["دين", d.dueDate, d.title, d.direction === "receivable" ? "لي" : "عليّ", personName(d.personId), "", d.direction === "receivable" ? "لي" : "عليّ", d.principal]
        .map(csvCell)
        .join(","),
    );
  }
  downloadExportBlob(new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }), "mizan.csv");
}

export function importData(text: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("ملف JSON غير صالح");
  }
  if (isEncryptedBackupEnvelope(raw)) {
    throw new Error("النسخة مشفّرة — أدخل كلمة مرور فك التشفير للاستيراد");
  }
  const validation = validateBackupJsonObject(raw);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const parsed = asData(raw);
  if (!parsed) throw new Error("تعذّر قراءة بنية الدفتر");
  useFinance.getState().replaceAll({ ...parsed, demo: false }, Date.now());
  return raw as Record<string, unknown>;
}

export async function importDataAsync(text: string, passphrase?: string) {
  let rawObj: unknown;
  try {
    rawObj = JSON.parse(text);
  } catch {
    throw new Error("ملف JSON غير صالح");
  }
  let plainText = text;
  if (isEncryptedBackupEnvelope(rawObj)) {
    if (!passphrase?.trim()) {
      throw new Error("هذه النسخة مشفّرة — يلزم إدخال كلمة مرور فك التشفير");
    }
    plainText = await decryptBackupPayload(rawObj, passphrase.trim());
  }
  const raw = importData(plainText);
  const receipts = raw?.receipts;
  if (receipts && typeof receipts === "object" && !Array.isArray(receipts)) {
    await importAllReceipts(receipts as Record<string, string>);
  }
  return raw;
}
