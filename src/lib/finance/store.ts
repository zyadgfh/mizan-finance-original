import { create } from "zustand";
import { currentMonth, defaultWallets, isCurrency, round2, todayISO } from "./logic";
import { clearReceipts } from "./receipts";
import { seedData } from "./seed";
import type {
  Budget,
  Category,
  Currency,
  Data,
  Debt,
  DebtDirection,
  Goal,
  GoalMove,
  Payment,
  Person,
  Recurring,
  Transfer,
  Tx,
  TxKind,
  Wallet,
  WalletKind,
} from "./types";

const KEY = "mizan.v1";

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

type RemovedTxn = { tx: Tx; payment?: Payment };
type RemovedDebt = { debt: Debt; payments: Payment[]; txns: Tx[] };

type Actions = {
  addTxn: (input: TxInput) => string;
  updateTxn: (id: string, input: TxInput) => void;
  removeTxn: (id: string) => RemovedTxn | undefined;
  restoreTxn: (tx: Tx) => void;
  addPerson: (input: PersonInput) => string;
  updatePerson: (id: string, input: PersonInput) => void;
  removePerson: (id: string) => Person | undefined;
  restorePerson: (person: Person) => void;
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
  addGoal: (input: { name: string; target: number; deadline: string }) => string;
  updateGoal: (id: string, input: { name: string; target: number; deadline: string }) => void;
  removeGoal: (id: string) => void;
  addGoalMove: (input: { goalId: string; walletId: string; amount: number; date: string; note: string }) => string;
  removeGoalMove: (id: string) => GoalMove | undefined;
  restoreGoalMove: (move: GoalMove) => void;
  splitBill: (input: SplitInput) => void;
  setReceiptFlag: (txId: string, on: boolean) => void;
  replaceAll: (data: Data) => void;
  resetAll: () => void;
};

function uid() {
  return crypto.randomUUID();
}

const DEBT_CATS: Category[] = [
  { id: "c-debt-out", name: "سداد دين", kind: "expense", icon: "wallet", tone: "gray" },
  { id: "c-debt-in", name: "تحصيل دين", kind: "income", icon: "wallet", tone: "green" },
];

function pick(s: Data): Data {
  return {
    txns: s.txns,
    people: s.people,
    debts: s.debts,
    payments: s.payments,
    categories: s.categories,
    budgets: s.budgets,
    openingBalance: s.openingBalance,
    currency: s.currency,
    demo: s.demo,
    wallets: s.wallets,
    transfers: s.transfers,
    recurring: s.recurring,
    goals: s.goals,
    goalMoves: s.goalMoves,
  };
}

function cashOpeningOf(wallets: Wallet[], fallback: number) {
  return wallets.find((w) => w.id === "w-cash")?.opening ?? fallback;
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
    set({
      txns: get().txns.map((t) =>
        t.id === id
          ? {
              ...t,
              kind: input.kind,
              amount: round2(input.amount),
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
    set({
      people: get().people.filter((p) => p.id !== id),
      txns: get().txns.map((t) => (t.personId === id ? { ...t, personId: undefined } : t)),
    });
    return person;
  },
  restorePerson: (person) => set({ people: [person, ...get().people.filter((p) => p.id !== person.id)] }),
  addDebt: (input) => {
    const id = uid();
    const debt: Debt = {
      id,
      personId: input.personId,
      direction: input.direction,
      title: input.title.trim() || "دين",
      note: input.note.trim(),
      principal: round2(input.principal),
      dueDate: input.dueDate,
      installments: clampInstallments(input.installments),
      createdAt: Date.now(),
    };
    set({ debts: [debt, ...get().debts] });
    return id;
  },
  updateDebt: (id, input) => {
    set({
      debts: get().debts.map((d) =>
        d.id === id
          ? {
              ...d,
              personId: input.personId,
              direction: input.direction,
              title: input.title.trim() || "دين",
              note: input.note.trim(),
              principal: round2(input.principal),
              dueDate: input.dueDate,
              installments: clampInstallments(input.installments),
            }
          : d,
      ),
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
    let txId: string | undefined;
    if (input.linkCash) {
      txId = uid();
      const income = debt.direction === "receivable";
      const categoryId = ensureDebtCategory(get, set, income ? "income" : "expense");
      const tx: Tx = {
        id: txId,
        kind: income ? "income" : "expense",
        amount: round2(input.amount),
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
      amount: round2(input.amount),
      date: input.date,
      note: input.note.trim(),
      walletId: input.linkCash ? input.walletId || "w-cash" : undefined,
      txId,
      createdAt: Date.now(),
    };
    set({ payments: [payment, ...get().payments] });
    return id;
  },
  removePayment: (id) => {
    const payment = get().payments.find((p) => p.id === id);
    if (!payment) return undefined;
    const tx = payment.txId ? get().txns.find((t) => t.id === payment.txId) : undefined;
    set({
      payments: get().payments.filter((p) => p.id !== id),
      txns: tx ? get().txns.filter((t) => t.id !== tx.id) : get().txns,
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
      createdAt: Date.now(),
    };
    set({ goals: [goal, ...get().goals] });
    return id;
  },
  updateGoal: (id, input) => {
    set({
      goals: get().goals.map((g) =>
        g.id === id ? { ...g, name: input.name.trim() || g.name, target: round2(input.target), deadline: input.deadline } : g,
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
  replaceAll: (data) => set({ ...data }),
  resetAll: () => {
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
      demo: false,
      wallets,
      transfers: [],
      recurring: [],
      goals: [],
      goalMoves: [],
    });
    void clearReceipts();
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

function asData(raw: unknown): Data | null {
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
  return {
    txns: d.txns,
    people: d.people,
    debts: d.debts.map((debt) => ({ ...debt, installments: debt.installments || 1 })),
    payments: d.payments,
    categories,
    budgets: Array.isArray(d.budgets) ? d.budgets : [],
    openingBalance: cashOpeningOf(wallets, opening),
    currency: isCurrency(d.currency) ? d.currency : "EGP",
    demo: Boolean(d.demo),
    wallets,
    transfers: Array.isArray(d.transfers) ? d.transfers : [],
    recurring: Array.isArray(d.recurring) ? d.recurring : [],
    goals: Array.isArray(d.goals) ? d.goals : [],
    goalMoves: Array.isArray(d.goalMoves) ? d.goalMoves : [],
  };
}

function mergeCategories(categories: Category[]) {
  const ids = new Set(categories.map((c) => c.id));
  return [...categories, ...DEBT_CATS.filter((c) => !ids.has(c.id))];
}

let subscribed = false;
let persistTimer: number | undefined;
let pendingPersist: string | null = null;

function flushPersist() {
  if (typeof localStorage === "undefined" || pendingPersist === null) return;
  if (persistTimer !== undefined) window.clearTimeout(persistTimer);
  persistTimer = undefined;
  localStorage.setItem(KEY, pendingPersist);
  pendingPersist = null;
}

function schedulePersist(state: Data) {
  pendingPersist = JSON.stringify(pick(state));
  if (persistTimer !== undefined) return;
  persistTimer = window.setTimeout(flushPersist, 120);
}

export function hydrateFinance() {
  if (subscribed || typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = asData(JSON.parse(raw));
      if (parsed) useFinance.setState(parsed);
    }
  } catch {
    /* keep seed */
  }
  useFinance.subscribe((s) => schedulePersist(s));
  window.addEventListener("pagehide", flushPersist);
  subscribed = true;
  if (!localStorage.getItem(KEY)) {
    localStorage.setItem(KEY, JSON.stringify(pick(useFinance.getState())));
  }
}

function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

export function exportData() {
  download(
    new Blob([JSON.stringify(pick(useFinance.getState()), null, 2)], { type: "application/json" }),
    "mizan-backup.json",
  );
}

function csvCell(value: string | number) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
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
  download(new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }), "mizan.csv");
}

export function importData(text: string) {
  const parsed = asData(JSON.parse(text));
  if (!parsed) throw new Error("bad");
  useFinance.getState().replaceAll({ ...parsed, demo: false });
}
