import { format, isToday, isYesterday, parseISO } from "date-fns";
import { arEG, enUS } from "date-fns/locale";
import { getUiPrefs, type AppLanguage, type NumeralStyle } from "./prefs.ts";
import type {
  Budget,
  Category,
  Currency,
  Data,
  Debt,
  DebtCadence,
  DebtStatus,
  Goal,
  GoalCategory,
  GoalMove,
  MonthlyAnalytics,
  Payment,
  Person,
  Recurring,
  Tx,
  TxKind,
  Wallet,
} from "./types.ts";
import { CURRENCIES } from "./types.ts";

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function round4(n: number) {
  return Math.round(n * 10000) / 10000;
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

const SYMBOLS_AR: Record<Currency, string> = {
  EGP: "ج.م",
  SAR: "ر.س",
  AED: "د.إ",
  USD: "$",
  EUR: "€",
};

const SYMBOLS_EN: Record<Currency, string> = {
  EGP: "EGP",
  SAR: "SAR",
  AED: "AED",
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

/** Approximate baseline rates per 1 USD used strictly as initial default suggestions. */
export const DEFAULT_USD_RATES: Record<Currency, number> = {
  USD: 1,
  EUR: 0.92,
  SAR: 3.75,
  AED: 3.67,
  EGP: 50,
};

export function defaultExchangeRate(from: Currency, to: Currency): number {
  if (from === to) return 1;
  const fromUsd = DEFAULT_USD_RATES[from] || 1;
  const toUsd = DEFAULT_USD_RATES[to] || 1;
  return round4(toUsd / fromUsd);
}

export function defaultExchangeRatesFor(base: Currency): Partial<Record<Currency, number>> {
  const out: Partial<Record<Currency, number>> = {};
  for (const c of CURRENCIES) {
    if (c !== base) out[c] = defaultExchangeRate(c, base);
  }
  return out;
}

export function effectiveExchangeRate(
  from: Currency,
  baseCurrency: Currency,
  customRates?: Partial<Record<Currency, number>>,
): number {
  if (from === baseCurrency) return 1;
  const custom = customRates?.[from];
  if (typeof custom === "number" && Number.isFinite(custom) && custom > 0) {
    return round4(custom);
  }
  return defaultExchangeRate(from, baseCurrency);
}

/**
 * Returns the transaction amount in account base currency.
 * Preserves the frozen `baseAmount` / `exchangeRate` stored when the transaction was recorded.
 */
export function txBaseAmount(
  t: Pick<Tx, "amount" | "currency" | "exchangeRate" | "baseAmount">,
  baseCurrency?: Currency,
  customRates?: Partial<Record<Currency, number>>,
): number {
  if (typeof t.baseAmount === "number" && Number.isFinite(t.baseAmount)) {
    return round2(t.baseAmount);
  }
  if (t.currency && (!baseCurrency || t.currency !== baseCurrency)) {
    if (typeof t.exchangeRate === "number" && Number.isFinite(t.exchangeRate) && t.exchangeRate > 0) {
      return round2(t.amount * t.exchangeRate);
    }
    if (baseCurrency) {
      return round2(t.amount * effectiveExchangeRate(t.currency, baseCurrency, customRates));
    }
  }
  return round2(t.amount);
}

const ARABIC_INDIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

export function toArabicIndicDigits(text: string): string {
  return text.replace(/\d/g, (d) => ARABIC_INDIC_DIGITS[Number(d)] ?? d);
}

export function toLatinDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

export function currencySymbol(c: Currency, lang: AppLanguage = getUiPrefs().language) {
  return (lang === "en" ? SYMBOLS_EN : SYMBOLS_AR)[c];
}

export function defaultCountryCodeForCurrency(c: Currency): string {
  return COUNTRY_CODES[c] ?? "20";
}

export function formatNumber(
  n: number,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
  lang: AppLanguage = getUiPrefs().language,
) {
  const formatted = new Intl.NumberFormat(lang === "en" ? "en-US" : "ar-EG-u-nu-latn", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
  if (numeralStyle === "arab") {
    return toArabicIndicDigits(formatted).replace(/\./g, "٫");
  }
  return formatted;
}

export function formatPercent(
  pct: number,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
  lang: AppLanguage = getUiPrefs().language,
): string {
  const num = formatNumber(Math.round(pct), numeralStyle, lang);
  return lang === "en" ? `${num}%` : `${num}٪`;
}

export function money(
  n: number,
  c: Currency,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
  lang: AppLanguage = getUiPrefs().language,
) {
  return `${formatNumber(Math.abs(n), numeralStyle, lang)} ${currencySymbol(c, lang)}`;
}

export function monthLabel(
  month: string,
  lang: AppLanguage = getUiPrefs().language,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
) {
  const out = format(parseISO(`${month}-01`), "MMMM yyyy", { locale: lang === "en" ? enUS : arEG });
  return numeralStyle === "arab" ? toArabicIndicDigits(out) : toLatinDigits(out);
}

export function dayLabel(
  date: string,
  lang: AppLanguage = getUiPrefs().language,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
) {
  const d = parseISO(date);
  if (isToday(d)) return lang === "en" ? "Today" : "اليوم";
  if (isYesterday(d)) return lang === "en" ? "Yesterday" : "أمس";
  const out = format(d, "EEEE d MMMM", { locale: lang === "en" ? enUS : arEG });
  return numeralStyle === "arab" ? toArabicIndicDigits(out) : toLatinDigits(out);
}

export function shortDate(
  date: string,
  lang: AppLanguage = getUiPrefs().language,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
) {
  if (!date) return "";
  const d = parseISO(date);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const out = format(d, sameYear ? "d MMMM" : "d MMMM yyyy", { locale: lang === "en" ? enUS : arEG });
  return numeralStyle === "arab" ? toArabicIndicDigits(out) : toLatinDigits(out);
}

export function normalizeSearch(text: string): string {
  return toLatinDigits(text)
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

export function sumKind(
  txns: Tx[],
  kind: Tx["kind"],
  month?: string,
  baseCurrency?: Currency,
  rates?: Partial<Record<Currency, number>>,
) {
  return round2(
    txns.reduce((s, t) => {
      if (t.kind !== kind || !countsInSummary(t)) return s;
      if (month && !t.date.startsWith(month)) return s;
      return s + txBaseAmount(t, baseCurrency, rates);
    }, 0),
  );
}

export function walletBalance(
  walletId: string,
  data: Pick<Data, "wallets" | "txns" | "transfers" | "goalMoves"> & Partial<Pick<Data, "currency" | "exchangeRates">>,
) {
  const wallet = data.wallets.find((w) => w.id === walletId);
  let n = wallet?.opening ?? 0;
  for (const t of data.txns) {
    if ((t.walletId || "w-cash") !== walletId) continue;
    const val = txBaseAmount(t, data.currency, data.exchangeRates);
    n += t.kind === "income" ? val : -val;
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

export function walletCurrencySummary(
  walletId: string,
  data: Pick<Data, "txns" | "currency">,
): { currency: Currency; net: number }[] {
  const byCurrency = new Map<Currency, number>();
  for (const t of data.txns) {
    if ((t.walletId || "w-cash") !== walletId) continue;
    const c = t.currency ?? data.currency;
    const delta = t.kind === "income" ? t.amount : -t.amount;
    byCurrency.set(c, round2((byCurrency.get(c) ?? 0) + delta));
  }
  return [...byCurrency.entries()]
    .filter(([c, net]) => c !== data.currency && Math.abs(net) > 0.009)
    .map(([currency, net]) => ({ currency, net }));
}

export function cashPosition(
  data: Pick<Data, "txns" | "openingBalance" | "wallets" | "transfers" | "goalMoves"> &
    Partial<Pick<Data, "currency" | "exchangeRates">>,
) {
  if (!data.wallets.length) {
    const flow = data.txns.reduce(
      (s, t) => s + (t.kind === "income" ? txBaseAmount(t, data.currency, data.exchangeRates) : -txBaseAmount(t, data.currency, data.exchangeRates)),
      0,
    );
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

export function monthWeeks(
  month: string,
  txns: Tx[],
  baseCurrency?: Currency,
  rates?: Partial<Record<Currency, number>>,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
) {
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
      const val = txBaseAmount(t, baseCurrency, rates);
      if (t.kind === "income") income += val;
      else expense += val;
    }
    const rawLabel = start === end ? String(start) : `${start}–${end}`;
    return {
      label: numeralStyle === "arab" ? toArabicIndicDigits(rawLabel) : rawLabel,
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

export function addDaysISO(iso: string, days: number) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return isoFrom(dt);
}

export function addMonthsISO(iso: string, months: number) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1 + months, 1);
  const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  dt.setDate(Math.min(d || 1, last));
  return isoFrom(dt);
}

export function nextInstallmentDate(startISO: string, index: number, cadence: DebtCadence = "monthly") {
  if (!startISO) return "";
  if (index === 0) return startISO;
  if (cadence === "weekly") return addDaysISO(startISO, index * 7);
  if (cadence === "biweekly") return addDaysISO(startISO, index * 14);
  return addMonthsISO(startISO, index);
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
  const cadence: DebtCadence = debt.cadence ?? "monthly";
  if (count === 1) return [{ due: debt.dueDate || "", amount: round2(debt.principal) }];
  const base = round2(debt.principal / count);
  const rows: { due: string; amount: number }[] = [];
  let allocated = 0;
  for (let i = 0; i < count; i++) {
    const amount = i === count - 1 ? round2(debt.principal - allocated) : base;
    allocated = round2(allocated + amount);
    rows.push({ due: debt.dueDate ? nextInstallmentDate(debt.dueDate, i, cadence) : "", amount });
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
  lang: AppLanguage = getUiPrefs().language,
) {
  if (lang === "en") {
    if (direction === "receivable") {
      return `Hi ${personName}, friendly reminder regarding "${title}". Remaining: ${amountLabel}. Let me know when works to settle.`;
    }
    return `Hi ${personName}, regarding "${title}", remaining I owe: ${amountLabel}. I will arrange the payment soon.`;
  }
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

export function debtStatus(debt: Debt, payments: Payment[], today = todayISO()): DebtStatus {
  const rem = remaining(debt, payments);
  if (rem <= 0.009) return "completed";
  const next = nextDueDate(debt, payments);
  if (next && next < today) return "overdue";
  return "active";
}

export function debtStatusLabel(status: DebtStatus, lang: AppLanguage = getUiPrefs().language): string {
  if (lang === "en") {
    if (status === "completed") return "Settled";
    if (status === "overdue") return "Overdue";
    return "Active";
  }
  if (status === "completed") return "مكتمل";
  if (status === "overdue") return "متأخر";
  return "نشط";
}

const KEYWORD_CATEGORY_RULES: { kind: TxKind; categoryId: string; keywords: string[] }[] = [
  {
    kind: "expense",
    categoryId: "c-food",
    keywords: [
      "طعام", "اكل", "مطعم", "غداء", "عشاء", "فطار", "قهوه", "كافيه", "سوبرماركت", "خضار", "سوق", "بقاله", "بيتزا", "شاي",
      "food", "restaurant", "lunch", "dinner", "breakfast", "coffee", "cafe", "grocery", "supermarket", "pizza",
    ],
  },
  {
    kind: "expense",
    categoryId: "c-transport",
    keywords: [
      "مواصلات", "اوبر", "كريم", "تاكسي", "بنزين", "مترو", "قطر", "سفر", "توصيل", "ركنه", "سياره", "عربيه",
      "uber", "careem", "taxi", "fuel", "gas", "metro", "train", "parking", "transport",
    ],
  },
  {
    kind: "expense",
    categoryId: "c-bills",
    keywords: [
      "كهرباء", "مياه", "غاز", "نت", "انترنت", "باقه", "تليفون", "موبايل", "شحن", "اشتراك", "فاتوره",
      "electric", "water", "internet", "wifi", "mobile", "phone", "subscription", "bill", "utility",
    ],
  },
  {
    kind: "expense",
    categoryId: "c-home",
    keywords: ["ايجار", "سكن", "صيانه", "سباكه", "تنظيف", "شقه", "بيت", "rent", "housing", "maintenance"],
  },
  {
    kind: "expense",
    categoryId: "c-shop",
    keywords: ["تسوق", "ملابس", "شراء", "مول", "امازون", "نون", "جهاز", "مستلزمات", "shopping", "amazon", "clothes", "mall"],
  },
  {
    kind: "expense",
    categoryId: "c-health",
    keywords: ["صحه", "صيدليه", "دواء", "علاج", "دكتور", "كشف", "مستشفي", "تحاليل", "اسنان", "pharmacy", "doctor", "clinic", "hospital"],
  },
  {
    kind: "expense",
    categoryId: "c-edu",
    keywords: ["تعليم", "كورس", "كتاب", "دراسه", "مدرسه", "جامعه", "دوره", "course", "book", "tuition", "school"],
  },
  {
    kind: "expense",
    categoryId: "c-fun",
    keywords: ["ترفيه", "سينما", "لعبه", "خروجه", "نادي", "مباراه", "رحله", "cinema", "movie", "game", "club"],
  },
  {
    kind: "income",
    categoryId: "c-salary",
    keywords: ["راتب", "مرتب", "قبض", "معاش", "salary", "payroll", "paycheck"],
  },
  {
    kind: "income",
    categoryId: "c-free",
    keywords: ["عمل حر", "فريلانس", "تصميم", "برمجه", "استشاره", "مشروع", "عموله", "freelance", "consulting", "design"],
  },
  {
    kind: "income",
    categoryId: "c-gift",
    keywords: ["هديه", "عيديه", "مكافاه", "بونص", "gift", "bonus", "reward"],
  },
  {
    kind: "income",
    categoryId: "c-invest",
    keywords: ["عائد", "فائده", "ارباح", "استثمار", "شهاده", "dividend", "interest", "return", "profit"],
  },
];

export function suggestCategoryFromNote(
  note: string,
  kind: TxKind,
  categories: Category[],
  txns: Tx[] = [],
): string | null {
  const norm = normalizeSearch(note);
  if (norm.length < 2) return null;
  const available = categories.filter((c) => c.kind === kind && c.id !== "c-debt-out" && c.id !== "c-debt-in");
  const availableIds = new Set(available.map((c) => c.id));

  const historyScores = new Map<string, number>();
  for (const t of txns) {
    if (t.kind !== kind || !availableIds.has(t.categoryId)) continue;
    const txNote = normalizeSearch(t.note);
    if (!txNote) continue;
    if (txNote === norm) {
      historyScores.set(t.categoryId, (historyScores.get(t.categoryId) ?? 0) + 5);
    } else if (txNote.includes(norm) || norm.includes(txNote)) {
      historyScores.set(t.categoryId, (historyScores.get(t.categoryId) ?? 0) + 2);
    }
  }
  let bestHistoryId: string | null = null;
  let bestHistoryScore = 0;
  for (const [cid, score] of historyScores) {
    if (score > bestHistoryScore) {
      bestHistoryScore = score;
      bestHistoryId = cid;
    }
  }
  if (bestHistoryId) return bestHistoryId;

  for (const cat of available) {
    const cname = normalizeSearch(cat.name);
    if (cname && norm.includes(cname)) return cat.id;
  }

  for (const rule of KEYWORD_CATEGORY_RULES) {
    if (rule.kind !== kind || !availableIds.has(rule.categoryId)) continue;
    if (rule.keywords.some((kw) => norm.includes(kw))) return rule.categoryId;
  }
  return null;
}

export type UnusualExpenseAlert = {
  txAlerts: { tx: Tx; categoryName: string; baseline: number; ratio: number }[];
  categoryAlerts: { category: Category; spent: number; baseline: number; ratio: number }[];
};

export function detectUnusualExpenses(
  txns: Tx[],
  categories: Category[],
  month: string,
  baseCurrency?: Currency,
  rates?: Partial<Record<Currency, number>>,
): UnusualExpenseAlert {
  const prevMonths = [shiftMonthKey(month, -1), shiftMonthKey(month, -2), shiftMonthKey(month, -3)];
  const prevSet = new Set(prevMonths);
  const currentExpenses = txns.filter((t) => t.kind === "expense" && countsInSummary(t) && t.date.startsWith(month));
  const baselineExpenses = txns.filter(
    (t) => t.kind === "expense" && countsInSummary(t) && prevSet.has(t.date.slice(0, 7)),
  );

  if (!currentExpenses.length || !baselineExpenses.length) {
    return { txAlerts: [], categoryAlerts: [] };
  }

  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "مصروف";
  const valOf = (t: Tx) => txBaseAmount(t, baseCurrency, rates);
  const overallAvg =
    baselineExpenses.reduce((s, t) => s + valOf(t), 0) / Math.max(1, baselineExpenses.length);

  const txAlerts: UnusualExpenseAlert["txAlerts"] = [];
  for (const t of currentExpenses) {
    const val = valOf(t);
    const sameCat = baselineExpenses.filter((b) => b.categoryId === t.categoryId);
    const baseline =
      sameCat.length >= 2
        ? sameCat.reduce((s, b) => s + valOf(b), 0) / sameCat.length
        : baselineExpenses.length >= 4
          ? overallAvg
          : 0;
    if (baseline <= 0) continue;
    const ratio = val / baseline;
    if (val >= Math.max(200, baseline * 2)) {
      txAlerts.push({ tx: t, categoryName: catName(t.categoryId), baseline: round2(baseline), ratio: round2(ratio) });
    }
  }
  txAlerts.sort((a, b) => valOf(b.tx) - valOf(a.tx));

  const categoryAlerts: UnusualExpenseAlert["categoryAlerts"] = [];
  for (const cat of categories.filter((c) => c.kind === "expense" && c.id !== "c-debt-out")) {
    const spent = currentExpenses.filter((t) => t.categoryId === cat.id).reduce((s, t) => s + valOf(t), 0);
    if (spent <= 0) continue;
    const monthSums = prevMonths
      .map((m) =>
        baselineExpenses.filter((t) => t.categoryId === cat.id && t.date.startsWith(m)).reduce((s, t) => s + valOf(t), 0),
      )
      .filter((v) => v > 0);
    if (!monthSums.length) continue;
    const baseline = monthSums.reduce((s, v) => s + v, 0) / monthSums.length;
    const ratio = spent / baseline;
    if (spent >= Math.max(300, baseline * 1.45)) {
      categoryAlerts.push({ category: cat, spent: round2(spent), baseline: round2(baseline), ratio: round2(ratio) });
    }
  }
  categoryAlerts.sort((a, b) => b.ratio - a.ratio);

  return { txAlerts: txAlerts.slice(0, 3), categoryAlerts: categoryAlerts.slice(0, 3) };
}

export function suggestCategoryBudget(
  categoryId: string,
  txns: Tx[],
  month: string,
  monthsBack = 3,
  baseCurrency?: Currency,
  rates?: Partial<Record<Currency, number>>,
): number {
  const totals: number[] = [];
  for (let i = 1; i <= monthsBack; i++) {
    const m = shiftMonthKey(month, -i);
    const sum = sumKind(
      txns.filter((t) => t.categoryId === categoryId),
      "expense",
      m,
      baseCurrency,
      rates,
    );
    if (sum > 0) totals.push(sum);
  }
  if (!totals.length) {
    const current = sumKind(
      txns.filter((t) => t.categoryId === categoryId),
      "expense",
      month,
      baseCurrency,
      rates,
    );
    if (current <= 0) return 0;
    return Math.ceil(current / 50) * 50;
  }
  const avg = totals.reduce((s, v) => s + v, 0) / totals.length;
  const step = avg >= 1000 ? 100 : avg >= 200 ? 50 : 25;
  return Math.max(step, Math.ceil((avg * 1.05) / step) * step);
}

export type BudgetStatusItem = {
  category: Category;
  limit: number;
  spent: number;
  pct: number;
  level: "ok" | "near" | "over";
};

export function budgetAlerts(
  budgets: Budget[],
  categories: Category[],
  txns: Tx[],
  month: string,
  baseCurrency?: Currency,
  rates?: Partial<Record<Currency, number>>,
): BudgetStatusItem[] {
  const rows: BudgetStatusItem[] = [];
  for (const b of budgets) {
    if (b.limit <= 0) continue;
    const category = categories.find((c) => c.id === b.categoryId);
    if (!category) continue;
    const spent = sumKind(
      txns.filter((t) => t.categoryId === b.categoryId),
      "expense",
      month,
      baseCurrency,
      rates,
    );
    const pct = Math.round((spent / b.limit) * 100);
    const level: BudgetStatusItem["level"] = spent > b.limit ? "over" : pct >= 80 ? "near" : "ok";
    rows.push({ category, limit: b.limit, spent, pct, level });
  }
  return rows.sort((a, b) => b.pct - a.pct);
}

export const GOAL_CATEGORY_LABEL: Record<GoalCategory, string> = {
  general: "هدف عام",
  travel: "الادخار للسفر",
  debt_payoff: "سداد دين",
  device: "شراء جهاز",
  emergency: "صندوق طوارئ",
};

export const GOAL_CATEGORY_LABEL_EN: Record<GoalCategory, string> = {
  general: "General Goal",
  travel: "Travel Savings",
  debt_payoff: "Debt Payoff",
  device: "New Device",
  emergency: "Emergency Fund",
};

export function goalCategoryLabel(cat: GoalCategory, lang: AppLanguage = getUiPrefs().language): string {
  return (lang === "en" ? GOAL_CATEGORY_LABEL_EN : GOAL_CATEGORY_LABEL)[cat];
}

export type GoalEtaEstimate = {
  saved: number;
  remaining: number;
  pct: number;
  monthlyPace: number;
  estimatedMonths: number | null;
  estimatedDateISO: string | null;
  status: "done" | "on-track" | "behind" | "no-pace";
};

export function estimateGoalEta(goal: Goal, moves: GoalMove[], txns: Tx[] = []): GoalEtaEstimate {
  const saved = goalSaved(goal.id, moves);
  const rem = round2(Math.max(0, goal.target - saved));
  const pct = goal.target > 0 ? Math.min(100, Math.round((saved / goal.target) * 100)) : 0;
  if (rem <= 0.009) {
    return {
      saved,
      remaining: 0,
      pct: 100,
      monthlyPace: 0,
      estimatedMonths: 0,
      estimatedDateISO: todayISO(),
      status: "done",
    };
  }

  const positiveMoves = moves.filter((m) => m.goalId === goal.id && m.amount > 0);
  let monthlyPace = 0;
  if (positiveMoves.length > 0) {
    const months = new Set(positiveMoves.map((m) => m.date.slice(0, 7)));
    const totalSaved = positiveMoves.reduce((s, m) => s + m.amount, 0);
    monthlyPace = round2(totalSaved / Math.max(1, months.size));
  } else {
    const cur = currentMonth();
    const prev = shiftMonthKey(cur, -1);
    const netCur = sumKind(txns, "income", cur) - sumKind(txns, "expense", cur);
    const netPrev = sumKind(txns, "income", prev) - sumKind(txns, "expense", prev);
    const avgSurplus = Math.max(0, (Math.max(0, netCur) + Math.max(0, netPrev)) / 2);
    monthlyPace = round2(avgSurplus * 0.25);
  }

  if (monthlyPace <= 0) {
    return {
      saved,
      remaining: rem,
      pct,
      monthlyPace: 0,
      estimatedMonths: null,
      estimatedDateISO: null,
      status: "no-pace",
    };
  }

  const estimatedMonths = Math.max(1, Math.ceil(rem / monthlyPace));
  const estimatedDateISO = addMonthsISO(todayISO(), estimatedMonths);
  const status = goal.deadline && estimatedDateISO > goal.deadline ? "behind" : "on-track";
  return {
    saved,
    remaining: rem,
    pct,
    monthlyPace,
    estimatedMonths,
    estimatedDateISO,
    status,
  };
}

export function multiMonthSummary(
  txns: Tx[],
  month: string,
  count = 6,
  lang: AppLanguage = getUiPrefs().language,
  baseCurrency?: Currency,
  rates?: Partial<Record<Currency, number>>,
) {
  const rows: { month: string; label: string; income: number; expense: number; net: number }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = shiftMonthKey(month, -i);
    const income = sumKind(txns, "income", m, baseCurrency, rates);
    const expense = sumKind(txns, "expense", m, baseCurrency, rates);
    rows.push({
      month: m,
      label: format(parseISO(`${m}-01`), "MMM", { locale: lang === "en" ? enUS : arEG }),
      income,
      expense,
      net: round2(income - expense),
    });
  }
  return rows;
}

export function topDebtPeople(people: Person[], debts: Debt[], payments: Payment[], limit = 5) {
  const map = new Map<string, { person: Person; receivable: number; payable: number; activeCount: number }>();
  for (const d of debts) {
    const rem = remaining(d, payments);
    if (rem <= 0) continue;
    const person = people.find((p) => p.id === d.personId);
    if (!person) continue;
    const cur = map.get(person.id) ?? { person, receivable: 0, payable: 0, activeCount: 0 };
    if (d.direction === "receivable") cur.receivable = round2(cur.receivable + rem);
    else cur.payable = round2(cur.payable + rem);
    cur.activeCount += 1;
    map.set(person.id, cur);
  }
  return [...map.values()]
    .map((row) => ({
      ...row,
      net: round2(row.receivable - row.payable),
      volume: round2(row.receivable + row.payable),
    }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, limit);
}

export type UnifiedSearchFilters = {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  categoryId?: string;
  personId?: string;
  walletId?: string;
  minAmount?: number;
  maxAmount?: number;
  onlyRecurring?: boolean;
  onlyUnsettled?: boolean;
};

export function unifiedSearch(data: Data, filters: UnifiedSearchFilters) {
  const q = normalizeSearch(filters.query ?? "");
  const openDebtPersonIds = new Set(
    data.debts.filter((d) => remaining(d, data.payments) > 0.009).map((d) => d.personId),
  );
  const openDebtTxIds = new Set(
    data.payments
      .filter((p) => {
        const d = data.debts.find((x) => x.id === p.debtId);
        return Boolean(d && remaining(d, data.payments) > 0.009);
      })
      .map((p) => p.txId)
      .filter((id): id is string => Boolean(id)),
  );

  const txns = data.txns
    .filter((t) => {
      const val = txBaseAmount(t, data.currency, data.exchangeRates);
      if (filters.dateFrom && t.date < filters.dateFrom) return false;
      if (filters.dateTo && t.date > filters.dateTo) return false;
      if (filters.categoryId && t.categoryId !== filters.categoryId) return false;
      if (filters.personId && t.personId !== filters.personId) return false;
      if (filters.walletId && (t.walletId || "w-cash") !== filters.walletId) return false;
      if (typeof filters.minAmount === "number" && Number.isFinite(filters.minAmount) && val < filters.minAmount) {
        return false;
      }
      if (typeof filters.maxAmount === "number" && Number.isFinite(filters.maxAmount) && val > filters.maxAmount) {
        return false;
      }
      if (filters.onlyRecurring && t.source !== "recurring") return false;
      if (filters.onlyUnsettled) {
        const unsettledSplit = t.source === "split" && t.reported === false && t.personId && openDebtPersonIds.has(t.personId);
        const unsettledDebtPay = openDebtTxIds.has(t.id);
        if (!unsettledSplit && !unsettledDebtPay) return false;
      }
      if (!q) return true;
      const cat = data.categories.find((c) => c.id === t.categoryId)?.name ?? "";
      const person = data.people.find((p) => p.id === t.personId)?.name ?? "";
      const wallet = data.wallets.find((w) => w.id === (t.walletId || "w-cash"))?.name ?? "";
      const cur = t.currency ?? data.currency;
      return normalizeSearch(`${t.note} ${cat} ${person} ${wallet} ${cur}`).includes(q);
    })
    .sort(sortTx);

  const debts = data.debts
    .map((debt) => ({ debt, rem: remaining(debt, data.payments), due: nextDueDate(debt, data.payments) }))
    .filter(({ debt, rem, due }) => {
      if (filters.personId && debt.personId !== filters.personId) return false;
      if (filters.categoryId || filters.walletId || filters.onlyRecurring) return false;
      if (filters.onlyUnsettled && rem <= 0.009) return false;
      if (filters.dateFrom && due && due < filters.dateFrom) return false;
      if (filters.dateTo && due && due > filters.dateTo) return false;
      if (typeof filters.minAmount === "number" && Number.isFinite(filters.minAmount) && debt.principal < filters.minAmount) {
        return false;
      }
      if (typeof filters.maxAmount === "number" && Number.isFinite(filters.maxAmount) && debt.principal > filters.maxAmount) {
        return false;
      }
      if (!q) return true;
      const person = data.people.find((p) => p.id === debt.personId)?.name ?? "";
      return normalizeSearch(`${debt.title} ${debt.note} ${person}`).includes(q);
    });

  const people = data.people
    .filter((person) => {
      if (filters.personId && person.id !== filters.personId) return false;
      if (filters.categoryId || filters.walletId || filters.onlyRecurring) return false;
      const net = personNet(person.id, data.debts, data.payments);
      if (filters.onlyUnsettled && Math.abs(net) <= 0.009) return false;
      if (!q) return true;
      return normalizeSearch(`${person.name} ${person.phone} ${person.note}`).includes(q);
    })
    .map((person) => ({ person, net: personNet(person.id, data.debts, data.payments) }));

  return { txns, debts, people };
}

export function weeklySpendingSummary(
  txns: Tx[],
  categories: Category[],
  today = todayISO(),
  baseCurrency?: Currency,
  rates?: Partial<Record<Currency, number>>,
) {
  const weekStart = addDaysISO(today, -6);
  const prevStart = addDaysISO(today, -13);
  const prevEnd = addDaysISO(today, -7);
  let currentWeekExpense = 0;
  let prevWeekExpense = 0;
  let count = 0;
  const byCat = new Map<string, number>();

  for (const t of txns) {
    if (t.kind !== "expense" || !countsInSummary(t)) continue;
    const val = txBaseAmount(t, baseCurrency, rates);
    if (t.date >= weekStart && t.date <= today) {
      currentWeekExpense = round2(currentWeekExpense + val);
      count += 1;
      byCat.set(t.categoryId, round2((byCat.get(t.categoryId) ?? 0) + val));
    } else if (t.date >= prevStart && t.date <= prevEnd) {
      prevWeekExpense = round2(prevWeekExpense + val);
    }
  }
  let topCatId = "";
  let topCatSpend = 0;
  for (const [cid, val] of byCat) {
    if (val > topCatSpend) {
      topCatSpend = val;
      topCatId = cid;
    }
  }
  const topCategoryName = categories.find((c) => c.id === topCatId)?.name ?? "";
  return { currentWeekExpense, prevWeekExpense, topCategoryName, count };
}

const FALLBACK_UNCATEGORIZED_IDS = new Set(["", "c-other-x", "c-other-in"]);

/**
 * Computes strictly on-device analytics for the active month without any external calls.
 */
export function computeMonthlyAnalytics(
  data: Pick<Data, "txns" | "categories" | "currency" | "exchangeRates">,
  month: string,
  today = todayISO(),
): MonthlyAnalytics {
  const [ys, ms] = month.split("-").map(Number);
  const daysInMonth = ys && ms ? new Date(ys, ms, 0).getDate() : 30;
  const curMonth = today.slice(0, 7);
  const elapsedDays =
    month < curMonth
      ? daysInMonth
      : month > curMonth
        ? 0
        : Math.max(1, Math.min(daysInMonth, Number(today.slice(8, 10)) || 1));

  const monthTxns = data.txns.filter((t) => countsInSummary(t) && t.date.startsWith(month));
  const totalIncome = sumKind(monthTxns, "income", month, data.currency, data.exchangeRates);
  const totalExpense = sumKind(monthTxns, "expense", month, data.currency, data.exchangeRates);

  const dailyAverageExpense = elapsedDays > 0 ? round2(totalExpense / elapsedDays) : 0;
  const projectedMonthEndExpense =
    month < curMonth
      ? totalExpense
      : elapsedDays > 0
        ? round2(dailyAverageExpense * daysInMonth)
        : totalExpense;
  const projectedNet = round2(totalIncome - projectedMonthEndExpense);

  // Highest-spending days
  const byDay = new Map<string, { amount: number; count: number }>();
  for (const t of monthTxns) {
    if (t.kind !== "expense") continue;
    const val = txBaseAmount(t, data.currency, data.exchangeRates);
    const prev = byDay.get(t.date) ?? { amount: 0, count: 0 };
    byDay.set(t.date, { amount: round2(prev.amount + val), count: prev.count + 1 });
  }
  const highestSpendingDays = [...byDay.entries()]
    .map(([date, info]) => ({ date, amount: info.amount, count: info.count }))
    .sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date))
    .slice(0, 3);

  // Categories with increased spending compared to the prior month
  const prevMonth = shiftMonthKey(month, -1);
  const increasedCategories: MonthlyAnalytics["increasedCategories"] = [];
  for (const cat of data.categories) {
    if (cat.kind !== "expense" || cat.id === "c-debt-out") continue;
    const current = sumKind(
      monthTxns.filter((t) => t.categoryId === cat.id),
      "expense",
      month,
      data.currency,
      data.exchangeRates,
    );
    if (current <= 0) continue;
    const previous = sumKind(
      data.txns.filter((t) => t.categoryId === cat.id),
      "expense",
      prevMonth,
      data.currency,
      data.exchangeRates,
    );
    const delta = round2(current - previous);
    if (delta > 0.009) {
      const pctIncrease = previous > 0 ? Math.round((delta / previous) * 100) : 100;
      increasedCategories.push({ category: cat, current, previous, delta, pctIncrease });
    }
  }
  increasedCategories.sort((a, b) => b.delta - a.delta);

  // Uncategorized transactions in the active month
  const validCatIds = new Set(data.categories.map((c) => c.id));
  const uncategorizedTxIds = monthTxns
    .filter((t) => FALLBACK_UNCATEGORIZED_IDS.has(t.categoryId) || !validCatIds.has(t.categoryId))
    .map((t) => t.id);

  return {
    month,
    totalExpense,
    totalIncome,
    elapsedDays,
    daysInMonth,
    dailyAverageExpense,
    projectedMonthEndExpense,
    projectedNet,
    highestSpendingDays,
    increasedCategories: increasedCategories.slice(0, 5),
    uncategorizedCount: uncategorizedTxIds.length,
    uncategorizedTxIds,
  };
}

export function reportMetrics(
  data: Data,
  month: string,
  lang: AppLanguage = getUiPrefs().language,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
) {
  const prev = shiftMonthKey(month, -1);
  const income = sumKind(data.txns, "income", month, data.currency, data.exchangeRates);
  const expense = sumKind(data.txns, "expense", month, data.currency, data.exchangeRates);
  const prevIncome = sumKind(data.txns, "income", prev, data.currency, data.exchangeRates);
  const prevExpense = sumKind(data.txns, "expense", prev, data.currency, data.exchangeRates);
  const net = round2(income - expense);
  const prevNet = round2(prevIncome - prevExpense);

  const categories = data.categories
    .filter((c) => c.kind === "expense")
    .map((c) => {
      const value = sumKind(
        data.txns.filter((t) => t.categoryId === c.id),
        "expense",
        month,
        data.currency,
        data.exchangeRates,
      );
      const prevValue = sumKind(
        data.txns.filter((t) => t.categoryId === c.id),
        "expense",
        prev,
        data.currency,
        data.exchangeRates,
      );
      return { id: c.id, name: c.name, value, prevValue };
    })
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);

  const today = todayISO();
  const horizon = addDaysISO(today, 30);
  const upcomingBills = [
    ...data.debts
      .map((d) => ({
        id: d.id,
        title: d.title,
        personName: data.people.find((p) => p.id === d.personId)?.name ?? "",
        due: nextDueDate(d, data.payments),
        amount: remaining(d, data.payments),
        direction: d.direction,
        kind: "debt" as const,
      }))
      .filter((x) => x.amount > 0 && x.due && x.due <= horizon),
    ...pendingRecurring(data.recurring, month).map((r) => ({
      id: r.id,
      title: r.note || data.categories.find((c) => c.id === r.categoryId)?.name || (lang === "en" ? "Recurring" : "متكرر"),
      personName: "",
      due: `${month}-${String(r.day).padStart(2, "0")}`,
      amount: r.amount,
      direction: r.kind === "income" ? ("receivable" as const) : ("payable" as const),
      kind: "recurring" as const,
    })),
  ].sort((a, b) => a.due.localeCompare(b.due));

  const totals = debtTotals(data.debts, data.payments);
  const debtPeople = topDebtPeople(data.people, data.debts, data.payments, 5);
  const monthlyTrend = multiMonthSummary(data.txns, month, 6, lang, data.currency, data.exchangeRates);
  const analytics = computeMonthlyAnalytics(data, month, today);

  return {
    month,
    monthLabel: monthLabel(month, lang, numeralStyle),
    income,
    expense,
    net,
    prevIncome,
    prevExpense,
    prevNet,
    cashBalance: cashPosition(data),
    categories,
    debtTotals: totals,
    debtPeople,
    upcomingBills,
    monthlyTrend,
    analytics,
  };
}
