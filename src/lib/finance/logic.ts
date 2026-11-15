import { format, isToday, isYesterday, parseISO } from "date-fns";
import { arEG } from "date-fns/locale";
import type { Currency, Data, Debt, GoalMove, Payment, Recurring, Tx, Wallet } from "./types.ts";
import { CURRENCIES } from "./types.ts";

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function isoFrom(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO() {
  return isoFrom(new Date());
}

export function currentMonth() {
  return todayISO().slice(0, 7);
}

export function shiftISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoFrom(d);
}

export function dateInMonth(monthDelta: number, day: number) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + monthDelta, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return isoFrom(d);
}

export function shiftMonthKey(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const SYMBOLS: Record<Currency, string> = {
  EGP: "ج.م",
  SAR: "ر.س",
  AED: "د.إ",
  USD: "$",
  EUR: "€",
};

const COUNTRY_CODES: Record<Currency, string> = {
  EGP: "20",
  SAR: "966",
  AED: "971",
  USD: "1",
  EUR: "49",
};

export function currencySymbol(c: Currency) {
  return SYMBOLS[c];
}

export function defaultCountryCodeForCurrency(c: Currency): string {
  return COUNTRY_CODES[c] ?? "20";
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat("ar-EG-u-nu-latn", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function money(n: number, c: Currency) {
  return `${formatNumber(Math.abs(n))} ${SYMBOLS[c]}`;
}

export function monthLabel(month: string) {
  return format(parseISO(`${month}-01`), "MMMM yyyy", { locale: arEG });
}

export function dayLabel(date: string) {
  const d = parseISO(date);
  if (isToday(d)) return "اليوم";
  if (isYesterday(d)) return "أمس";
  return format(d, "EEEE d MMMM", { locale: arEG });
}

export function shortDate(date: string) {
  if (!date) return "";
  const d = parseISO(date);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return format(d, sameYear ? "d MMMM" : "d MMMM yyyy", { locale: arEG });
}

export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

export function paidOf(debtId: string, payments: Payment[]) {
  return round2(payments.reduce((s, p) => (p.debtId === debtId ? s + p.amount : s), 0));
}

export function remaining(debt: Debt, payments: Payment[]) {
  return round2(Math.max(0, debt.principal - paidOf(debt.id, payments)));
}

export function isOpen(debt: Debt, payments: Payment[]) {
  return remaining(debt, payments) > 0.009;
}

export function countsInSummary(t: Tx) {
  return t.reported !== false;
}

export function sumKind(txns: Tx[], kind: Tx["kind"], month?: string) {
  return round2(
    txns.reduce((s, t) => {
      if (t.kind !== kind || !countsInSummary(t)) return s;
      if (month && !t.date.startsWith(month)) return s;
      return s + t.amount;
    }, 0),
  );
}

export function walletBalance(
  walletId: string,
  data: Pick<Data, "wallets" | "txns" | "transfers" | "goalMoves">,
) {
  const wallet = data.wallets.find((w) => w.id === walletId);
  let n = wallet?.opening ?? 0;
  for (const t of data.txns) {
    if ((t.walletId || "w-cash") !== walletId) continue;
    n += t.kind === "income" ? t.amount : -t.amount;
  }
  for (const tr of data.transfers) {
    if (tr.fromId === walletId) n -= tr.amount;
    if (tr.toId === walletId) n += tr.amount;
  }
  for (const g of data.goalMoves) {
    if (g.walletId !== walletId) continue;
    n -= g.amount;
  }
  return round2(n);
}

export function cashPosition(data: Pick<Data, "txns" | "openingBalance" | "wallets" | "transfers" | "goalMoves">) {
  if (!data.wallets.length) {
    const flow = data.txns.reduce((s, t) => s + (t.kind === "income" ? t.amount : -t.amount), 0);
    return round2(data.openingBalance + flow);
  }
  return round2(data.wallets.reduce((s, w) => s + walletBalance(w.id, data), 0));
}

export function debtTotals(debts: Debt[], payments: Payment[]) {
  let receivable = 0;
  let payable = 0;
  let overdue = 0;
  const today = todayISO();
  for (const d of debts) {
    const rem = remaining(d, payments);
    if (rem <= 0) continue;
    if (d.direction === "receivable") receivable += rem;
    else payable += rem;
    const due = nextDueDate(d, payments);
    if (due && due < today) overdue += 1;
  }
  return { receivable: round2(receivable), payable: round2(payable), overdue };
}

export function personNet(personId: string, debts: Debt[], payments: Payment[]) {
  let n = 0;
  for (const d of debts) {
    if (d.personId !== personId) continue;
    const rem = remaining(d, payments);
    n += d.direction === "receivable" ? rem : -rem;
  }
  return round2(n);
}

export function monthWeeks(month: string, txns: Tx[]) {
  const [ys, ms] = month.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const days = new Date(y, m, 0).getDate();
  const starts = [1, 8, 15, 22, 29].filter((d) => d <= days);
  return starts.map((start) => {
    const end = Math.min(start + 6, days);
    let income = 0;
    let expense = 0;
    for (const t of txns) {
      if (!countsInSummary(t)) continue;
      if (!t.date.startsWith(month)) continue;
      const day = Number(t.date.slice(8, 10));
      if (day < start || day > end) continue;
      if (t.kind === "income") income += t.amount;
      else expense += t.amount;
    }
    return {
      label: start === end ? String(start) : `${start}–${end}`,
      income: round2(income),
      expense: round2(expense),
    };
  });
}

export function sortTx(a: Tx, b: Tx) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return b.createdAt - a.createdAt;
}

export function isCurrency(x: unknown): x is Currency {
  return typeof x === "string" && (CURRENCIES as readonly string[]).includes(x);
}

export function dueTone(due: string, open: boolean): "overdue" | "soon" | "later" | "none" {
  if (!open || !due) return "none";
  const today = todayISO();
  if (due < today) return "overdue";
  const limit = shiftISO(7);
  if (due <= limit) return "soon";
  return "later";
}

export function addMonthsISO(iso: string, months: number) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1 + months, 1);
  const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  dt.setDate(Math.min(d || 1, last));
  return isoFrom(dt);
}

export function installmentCount(debt: Debt) {
  const n = Math.round(debt.installments || 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(36, Math.max(1, n));
}

export type InstallmentStatus = "paid" | "overdue" | "soon" | "later" | "open";

export type InstallmentRow = {
  index: number;
  due: string;
  amount: number;
  paid: number;
  remaining: number;
  status: InstallmentStatus;
};

export function planInstallments(debt: Debt) {
  const count = installmentCount(debt);
  if (count === 1) return [{ due: debt.dueDate || "", amount: round2(debt.principal) }];
  const base = round2(debt.principal / count);
  const rows: { due: string; amount: number }[] = [];
  let allocated = 0;
  for (let i = 0; i < count; i++) {
    const amount = i === count - 1 ? round2(debt.principal - allocated) : base;
    allocated = round2(allocated + amount);
    rows.push({ due: debt.dueDate ? addMonthsISO(debt.dueDate, i) : "", amount });
  }
  return rows;
}

export function installmentRows(debt: Debt, payments: Payment[]): InstallmentRow[] {
  let pool = paidOf(debt.id, payments);
  const today = todayISO();
  const soon = shiftISO(7);
  return planInstallments(debt).map((row, index) => {
    const paid = round2(Math.min(Math.max(0, pool), row.amount));
    pool = round2(Math.max(0, pool - paid));
    const rem = round2(Math.max(0, row.amount - paid));
    let status: InstallmentStatus = "open";
    if (rem <= 0.009) status = "paid";
    else if (!row.due) status = "open";
    else if (row.due < today) status = "overdue";
    else if (row.due <= soon) status = "soon";
    else status = "later";
    return { index, due: row.due, amount: row.amount, paid, remaining: rem, status };
  });
}

export function nextDueDate(debt: Debt, payments: Payment[]) {
  const row = installmentRows(debt, payments).find((r) => r.remaining > 0.009);
  return row?.due ?? "";
}

export function goalSaved(goalId: string, moves: GoalMove[]) {
  return round2(moves.reduce((s, m) => (m.goalId === goalId ? s + m.amount : s), 0));
}

export function goalsSaved(moves: GoalMove[]) {
  return round2(moves.reduce((s, m) => s + m.amount, 0));
}

export function pendingRecurring(list: Recurring[], month: string) {
  return list.filter((r) => r.active && r.lastMonth !== month);
}

export function whatsappHref(phone: string, text: string, defaultCountryCode = "20") {
  const trimmed = phone.trim();
  const cc = defaultCountryCode.replace(/\D/g, "") || "20";
  let d = trimmed.replace(/\D/g, "");
  if (!d) return "";
  if (trimmed.startsWith("+")) {
    return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
  }
  if (d.startsWith("00")) {
    d = d.slice(2);
    return d ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : "";
  }
  if (d.startsWith("0")) {
    d = `${cc}${d.slice(1)}`;
  } else if (!d.startsWith(cc) && d.length <= 10) {
    d = `${cc}${d}`;
  }
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

export function reminderText(
  personName: string,
  title: string,
  amountLabel: string,
  direction: Debt["direction"],
) {
  if (direction === "receivable") {
    return `السلام عليكم ${personName}، تذكير ودي بخصوص «${title}». المتبقي ${amountLabel}. لو يناسبك السداد أبلغني.`;
  }
  return `السلام عليكم ${personName}، بخصوص «${title}» المتبقي عليّ ${amountLabel}. سأرتّب السداد.`;
}

export function defaultWallets(cashOpening = 0): Wallet[] {
  return [
    { id: "w-cash", name: "كاش", kind: "cash", opening: round2(cashOpening), createdAt: 1 },
    { id: "w-instapay", name: "إنستاباي", kind: "instapay", opening: 0, createdAt: 2 },
    { id: "w-vf", name: "فودافون كاش", kind: "vodafone", opening: 0, createdAt: 3 },
    { id: "w-bank", name: "حساب بنكي", kind: "bank", opening: 0, createdAt: 4 },
  ];
}
