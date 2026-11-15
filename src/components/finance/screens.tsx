import { Cloud, ChevronLeft, ChevronRight, Eye, EyeOff, Search, Shield } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { IconTile } from "@/components/finance/icons";
import { useMizan, type DebtTabFilter } from "@/components/finance/context";
import { AnimatedBar } from "@/components/finance/gsap-motion";
import {
  Amount,
  EmptyState,
  Group,
  PersonName,
  PillButton,
  Row,
  SearchField,
  Section,
  Segment,
} from "@/components/finance/ui";
import {
  budgetAlerts,
  cashPosition,
  currencySymbol,
  currentMonth,
  dayLabel,
  debtStatus,
  debtStatusLabel,
  debtTotals,
  defaultCountryCodeForCurrency,
  detectUnusualExpenses,
  dueTone,
  goalsSaved,
  installmentCount,
  installmentRows,
  money,
  monthLabel,
  monthWeeks,
  nextDueDate,
  normalizeSearch,
  paidOf,
  pendingRecurring,
  personNet,
  remaining,
  reminderText,
  shortDate,
  sortTx,
  suggestCategoryBudget,
  sumKind,
  todayISO,
  walletBalance,
  weeklySpendingSummary,
  whatsappHref,
} from "@/lib/finance/logic";
import { exportMonthlyReportPdf } from "@/lib/finance/report-export";
import { updateSecuritySettings, useSecuritySettings } from "@/lib/finance/security";
import { exportCsv, exportData, exportDataAsync, importDataAsync, pickFinanceData, useFinance } from "@/lib/finance/store";
import type { Currency, Debt, Tx } from "@/lib/finance/types";
import { CURRENCIES } from "@/lib/finance/types";

const CURRENCY_LABEL: Record<Currency, string> = {
  EGP: "جنيه مصري",
  SAR: "ريال سعودي",
  AED: "درهم إماراتي",
  USD: "دولار",
  EUR: "يورو",
};

function MonthSwitch() {
  const { month, shiftMonth } = useMizan();
  return (
    <div className="mt-3 inline-flex items-center rounded-pill bg-fill">
      <button
        type="button"
        className="flex min-h-11 min-w-11 items-center justify-center text-label"
        onClick={() => shiftMonth(-1)}
        aria-label="الشهر السابق"
      >
        <ChevronRight size={20} strokeWidth={2} />
      </button>
      <span className="min-w-36 text-center text-sub font-semibold">{monthLabel(month)}</span>
      <button
        type="button"
        className="flex min-h-11 min-w-11 items-center justify-center text-label"
        onClick={() => shiftMonth(1)}
        aria-label="الشهر التالي"
      >
        <ChevronLeft size={20} strokeWidth={2} />
      </button>
    </div>
  );
}

export function HomeScreen() {
  const {
    month,
    openSheet,
    openDebt,
    openReport,
    openGoals,
    openWallets,
    openDebtsFiltered,
    setTab,
  } = useMizan();
  const data = useFinance();
  const { hideAmounts } = useSecuritySettings();
  const confirmRecurring = useFinance((s) => s.confirmRecurring);
  const skipRecurring = useFinance((s) => s.skipRecurring);
  const income = sumKind(data.txns, "income", month);
  const expense = sumKind(data.txns, "expense", month);
  const net = income - expense;
  const cash = cashPosition(data);
  const saved = goalsSaved(data.goalMoves);
  const totals = debtTotals(data.debts, data.payments);
  const weeks = monthWeeks(month, data.txns);
  const hasChart = weeks.some((w) => w.income || w.expense);
  const today = todayISO();
  const isCurrentViewedMonth = month === currentMonth();
  const weekly = useMemo(
    () => weeklySpendingSummary(data.txns, data.categories, today),
    [data.txns, data.categories, today],
  );
  const activeAlerts = useMemo(
    () => budgetAlerts(data.budgets, data.categories, data.txns, month).filter((b) => b.level !== "ok"),
    [data.budgets, data.categories, data.txns, month],
  );
  const unusual = useMemo(
    () => (isCurrentViewedMonth ? detectUnusualExpenses(data.txns, data.categories, month) : { txAlerts: [], categoryAlerts: [] }),
    [data.txns, data.categories, month, isCurrentViewedMonth],
  );
  const overdueDebts = useMemo(
    () => data.debts.filter((d) => debtStatus(d, data.payments, today) === "overdue"),
    [data.debts, data.payments, today],
  );
  const dues = data.debts
    .map((d) => ({ debt: d, rem: remaining(d, data.payments), due: nextDueDate(d, data.payments) }))
    .filter((x) => x.rem > 0 && x.due && x.due <= addDays(today, 14))
    .sort((a, b) => a.due.localeCompare(b.due));
  const recent = data.txns.filter((t) => t.date.startsWith(month)).sort(sortTx).slice(0, 6);
  const waiting = isCurrentViewedMonth ? pendingRecurring(data.recurring, month) : [];
  const budgets = data.budgets
    .map((b) => {
      const cat = data.categories.find((c) => c.id === b.categoryId);
      if (!cat) return null;
      const spent = sumKind(
        data.txns.filter((t) => t.categoryId === b.categoryId),
        "expense",
        month,
      );
      return { ...b, cat, spent };
    })
    .filter((b) => b !== null);

  return (
    <div>
      <div data-stagger className="px-4">
        <div className="flex items-center justify-between">
          <h1 className="text-largetitle font-bold tracking-title">اليوم</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => openSheet({ kind: "search" })}
              aria-label="بحث شامل"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-pill bg-fill text-label"
            >
              <Search size={18} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => updateSecuritySettings({ hideAmounts: !hideAmounts })}
              aria-label={hideAmounts ? "إظهار المبالغ" : "إخفاء المبالغ"}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-pill bg-fill text-label"
            >
              {hideAmounts ? <Eye size={18} strokeWidth={2} /> : <EyeOff size={18} strokeWidth={2} />}
            </button>
          </div>
        </div>
        <MonthSwitch />
        <p className="mt-6 text-sub text-label-2">صافي الشهر</p>
        <p className="text-largetitle font-bold tracking-title">
          <Amount value={net} currency={data.currency} sign="auto" />
        </p>
      </div>

      {data.demo ? (
        <Section className="mt-4">
          <Group>
            <Row
              title="بيانات تجريبية"
              sub="امسحها عندما تبدأ دفترَك"
              trailing={
                <PillButton tone="gray" onClick={() => openSheet({ kind: "reset" })}>
                  مسح
                </PillButton>
              }
            />
          </Group>
        </Section>
      ) : null}

      <div data-stagger className="mt-5 flex gap-2.5 overflow-x-auto px-4 pb-1">
        {data.wallets.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={openWallets}
            className="surface-card min-w-32 shrink-0 rounded-cell px-3.5 py-2.5 text-start"
          >
            <span className="block text-caption text-label-2">{w.name}</span>
            <span className="mt-1 block text-sub font-semibold">
              <Amount value={walletBalance(w.id, data)} currency={data.currency} sign="auto" />
            </span>
          </button>
        ))}
      </div>

      <div data-stagger className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        <button
          type="button"
          onClick={() => openSheet({ kind: "txn", prefill: { kind: "expense" } })}
          className="shrink-0 rounded-pill bg-fill px-3.5 py-2 text-caption font-semibold text-expense active:opacity-80"
        >
          + مصروف سريع
        </button>
        <button
          type="button"
          onClick={() => openSheet({ kind: "txn", prefill: { kind: "income" } })}
          className="shrink-0 rounded-pill bg-fill px-3.5 py-2 text-caption font-semibold text-income active:opacity-80"
        >
          + إيراد سريع
        </button>
        <button
          type="button"
          onClick={() => openSheet({ kind: "debt" })}
          className="shrink-0 rounded-pill bg-fill px-3.5 py-2 text-caption font-semibold text-tint active:opacity-80"
        >
          + دين جديد
        </button>
        <button
          type="button"
          onClick={() => openSheet({ kind: "split" })}
          className="shrink-0 rounded-pill bg-fill px-3.5 py-2 text-caption font-semibold text-label active:opacity-80"
        >
          تقسيم فاتورة
        </button>
      </div>

      {activeAlerts.length || unusual.txAlerts.length || unusual.categoryAlerts.length || overdueDebts.length ? (
        <Section title="تنبيهات ذكية">
          <Group>
            {overdueDebts.length ? (
              <Row
                title={`${overdueDebts.length} ديون متأخرة`}
                sub="تجاوزت تاريخ الاستحقاق"
                onClick={() => openDebtsFiltered("overdue")}
                chevron
                trailing={<span className="text-caption font-semibold text-expense">مراجعة</span>}
              />
            ) : null}
            {activeAlerts.slice(0, 2).map((a) => (
              <Row
                key={a.category.id}
                title={a.level === "over" ? `تجاوزت ميزانية ${a.category.name}` : `اقتربت من حد ${a.category.name}`}
                sub={`الصرف ${Math.round(a.spent)} من ${Math.round(a.limit)} (${a.pct}%)`}
                onClick={openReport}
                chevron
                trailing={
                  <span className={a.level === "over" ? "text-caption font-semibold text-expense" : "text-caption font-semibold text-warn"}>
                    {a.pct}%
                  </span>
                }
              />
            ))}
            {unusual.txAlerts.slice(0, 1).map((u) => (
              <Row
                key={u.tx.id}
                title={`صرف أعلى من المعتاد في ${u.categoryName}`}
                sub={`${u.tx.note || u.categoryName} · ${u.ratio}x المتوسط`}
                onClick={() => openSheet({ kind: "txn", id: u.tx.id })}
                chevron
                trailing={<Amount value={u.tx.amount} currency={data.currency} sign="minus" />}
              />
            ))}
          </Group>
        </Section>
      ) : null}

      {waiting.length ? (
        <Section title="بانتظار التأكيد" footer="التأكيد يسجّل الحركة اليوم. التخطي يؤجلها لنهاية الشهر.">
          <Group>
            {waiting.map((r) => {
              const cat = data.categories.find((c) => c.id === r.categoryId);
              return (
                <Row
                  key={r.id}
                  title={r.note || cat?.name || "متكرر"}
                  sub={today.slice(8, 10) < String(r.day).padStart(2, "0") ? `موعدها يوم ${r.day}` : "حان موعدها"}
                  trailing={
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        className="min-h-11 px-2 text-sub font-semibold text-label-2"
                        onClick={() => {
                          skipRecurring(r.id);
                          toast("تم التخطي هذا الشهر");
                        }}
                      >
                        تخطي
                      </button>
                      <button
                        type="button"
                        className="min-h-11 px-2 text-sub font-semibold text-tint"
                        onClick={() => {
                          if (confirmRecurring(r.id)) toast("سُجّلت الحركة");
                        }}
                      >
                        تأكيد
                      </button>
                    </span>
                  }
                />
              );
            })}
          </Group>
        </Section>
      ) : null}

      <Section title="هذا الشهر">
        <Group>
          <Row title="الإيرادات" trailing={<Amount value={income} currency={data.currency} sign="plus" />} />
          <Row title="المصاريف" trailing={<Amount value={expense} currency={data.currency} sign="minus" />} />
          {isCurrentViewedMonth ? (
            <Row
              title="مصاريف آخر 7 أيام"
              sub={`الأسبوع السابق ${Math.round(weekly.prevWeekExpense)}`}
              trailing={<Amount value={weekly.currentWeekExpense} currency={data.currency} />}
            />
          ) : null}
        </Group>
      </Section>

      <Section title="الوضع" footer="الرصيد مجموع المحافظ. سداد الدين وتحصيله يحرّكان المحفظة دون أن يُحسبا إيراداً أو مصروفاً جديداً.">
        <Group>
          <Row title="الرصيد النقدي" trailing={<Amount value={cash} currency={data.currency} sign="auto" />} onClick={openWallets} chevron />
          <Row
            title="مدّخر للأهداف"
            trailing={<Amount value={saved} currency={data.currency} />}
            onClick={openGoals}
            chevron
          />
          <Row
            title="لي عند الناس"
            trailing={<Amount value={totals.receivable} currency={data.currency} sign="plus" />}
            onClick={() => setTab("debts")}
            chevron
          />
          <Row
            title="عليّ للناس"
            trailing={<Amount value={totals.payable} currency={data.currency} sign="minus" />}
            onClick={() => setTab("debts")}
            chevron
          />
          <Row title="تقرير الشهر" sub="مقارنة 6 أشهر وتصدير PDF / Excel" chevron onClick={openReport} />
        </Group>
      </Section>

      {dues.length ? (
        <Section title="استحقاقات قريبة">
          <Group sep="icon">
            {dues.map(({ debt, rem }) => (
              <DebtRow key={debt.id} debt={debt} rem={rem} currency={data.currency} people={data.people} onOpen={() => openDebt(debt.id)} />
            ))}
          </Group>
        </Section>
      ) : null}

      <Section title="أسابيع الشهر">
        <div className="surface-card mx-4 rounded-cell px-2 py-3">
          {hasChart ? <WeekChart weeks={weeks} /> : <p className="px-3 py-6 text-center text-sub text-label-2">لا حركة في هذا الشهر</p>}
          <p className="px-3 pt-1 text-caption text-label-2">الأخضر إيراد، والأحمر مصروف.</p>
        </div>
      </Section>

      {budgets.length ? (
        <Section title="الميزانيات">
          <Group>
            {budgets.map((b) => {
              const pct = b.limit > 0 ? Math.min(100, Math.round((b.spent / b.limit) * 100)) : 0;
              const over = b.spent > b.limit;
              const near = !over && pct >= 80;
              return (
                <div key={b.categoryId} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-body">{b.cat.name}</span>
                    <span className="num text-foot text-label-2" dir="ltr">
                      {over ? "تجاوز · " : near ? "قرب الحد · " : ""}
                      {Math.round(b.spent)} / {Math.round(b.limit)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <AnimatedBar pct={pct} colorClass={over ? "bg-expense" : near ? "bg-warn" : "bg-tint"} />
                  </div>
                </div>
              );
            })}
          </Group>
        </Section>
      ) : null}

      <Section title="آخر الحركات">
        {recent.length ? (
          <Group sep="icon">
            {recent.map((t) => (
              <TxRow key={t.id} tx={t} onOpen={() => openSheet({ kind: "txn", id: t.id })} />
            ))}
          </Group>
        ) : (
          <EmptyState title="لا حركات" body="أضف إيراداً أو مصروفاً لهذا الشهر." />
        )}
      </Section>
    </div>
  );
}

function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

function WeekChart({ weeks }: { weeks: { label: string; income: number; expense: number }[] }) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []);
  if (!on) return <div className="h-40" />;
  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={weeks} barGap={2} barCategoryGap="28%">
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--label-2)" }} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTip />} cursor={{ fill: "var(--fill)" }} />
          <Bar dataKey="income" name="إيراد" fill="var(--green)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="expense" name="مصروف" fill="var(--red)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number }>;
  label?: string;
}) {
  const currency = useFinance((s) => s.currency);
  if (!active || !payload?.length) return null;
  return (
    <div className="surface-card rounded-cell px-3 py-2 text-caption text-label">
      <p className="text-label-2">{label}</p>
      {payload.map((p) => (
        <p key={p.name}>
          {p.name}: <Amount value={Number(p.value ?? 0)} currency={currency} />
        </p>
      ))}
    </div>
  );
}

function TxRow({ tx, onOpen }: { tx: Tx; onOpen: () => void }) {
  const categories = useFinance((s) => s.categories);
  const wallets = useFinance((s) => s.wallets);
  const currency = useFinance((s) => s.currency);
  const cat = categories.find((c) => c.id === tx.categoryId);
  const wallet = wallets.find((w) => w.id === (tx.walletId || "w-cash"));
  const flags = [tx.reported === false ? "خارج الملخص" : "", tx.receiptId ? "إيصال" : ""].filter(Boolean).join(" · ");
  return (
    <Row
      onClick={onOpen}
      leading={cat ? <IconTile name={cat.icon} tone={cat.tone} /> : null}
      title={tx.note || cat?.name || "حركة"}
      sub={`${cat?.name ?? "بدون فئة"} · ${wallet?.name ?? "كاش"} · ${dayLabel(tx.date)}${flags ? ` · ${flags}` : ""}`}
      trailing={<Amount value={tx.amount} currency={currency} sign={tx.kind === "income" ? "plus" : "minus"} />}
    />
  );
}

function DebtRow({
  debt,
  rem,
  currency,
  people,
  onOpen,
}: {
  debt: Debt;
  rem: number;
  currency: Currency;
  people: { id: string; name: string }[];
  onOpen: () => void;
}) {
  const person = people.find((p) => p.id === debt.personId);
  const payments = useFinance((s) => s.payments);
  const due = nextDueDate(debt, payments);
  const status = debtStatus(debt, payments);
  const statusText = debtStatusLabel(status);
  const count = installmentCount(debt);
  const personDisplay = person?.name ?? "بدون شخص";
  return (
    <Row
      onClick={onOpen}
      chevron
      title={debt.title || personDisplay}
      sub={
        <>
          <PersonName name={personDisplay} /> · {rem <= 0 ? statusText : `${debt.direction === "receivable" ? "لي" : "عليّ"}${count > 1 ? ` · ${count} أقساط` : ""}${due ? ` · ${statusText} · ${shortDate(due)}` : ""}`}
        </>
      }
      trailing={
        <Amount
          value={rem}
          currency={currency}
          sign={rem <= 0 ? "none" : debt.direction === "receivable" ? "plus" : "minus"}
        />
      }
    />
  );
}

export function LedgerScreen() {
  const { month, openSheet, ledgerCategoryFilter, setLedgerCategoryFilter, query, setQuery } = useMizan();
  const txns = useFinance((s) => s.txns);
  const categories = useFinance((s) => s.categories);
  const wallets = useFinance((s) => s.wallets);
  const currency = useFinance((s) => s.currency);
  const [scope, setScope] = useState<"all" | "month">("month");
  const [kind, setKind] = useState<"all" | "income" | "expense">("all");
  const [walletFilter, setWalletFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const categoryFilter = ledgerCategoryFilter || "all";
  const q = normalizeSearch(query);

  const list = useMemo(() => {
    return txns
      .filter((t) => (scope === "month" ? t.date.startsWith(month) : true))
      .filter((t) => (kind === "all" ? true : t.kind === kind))
      .filter((t) => (walletFilter === "all" ? true : (t.walletId || "w-cash") === walletFilter))
      .filter((t) => (categoryFilter === "all" ? true : t.categoryId === categoryFilter))
      .filter((t) => {
        if (!q) return true;
        const cat = categories.find((c) => c.id === t.categoryId)?.name ?? "";
        return normalizeSearch(`${t.note} ${cat}`).includes(q);
      })
      .sort((a, b) => (sortBy === "amount" ? b.amount - a.amount : sortTx(a, b)));
  }, [txns, scope, month, kind, walletFilter, categoryFilter, sortBy, q, categories]);

  const filteredNet = useMemo(
    () => list.reduce((s, t) => s + (t.kind === "income" ? t.amount : -t.amount), 0),
    [list],
  );

  const groups = new Map<string, Tx[]>();
  for (const t of list) {
    const key = sortBy === "amount" ? "مرتّب حسب المبلغ" : t.date;
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }

  return (
    <div>
      <div data-stagger className="flex items-center justify-between px-4">
        <h1 className="text-largetitle font-bold tracking-title">السجل</h1>
        <button
          type="button"
          onClick={() => openSheet({ kind: "search" })}
          className="rounded-pill bg-fill px-3 py-1.5 text-caption font-semibold text-tint"
        >
          بحث شامل
        </button>
      </div>
      <div data-stagger className="mt-3 space-y-3">
        <div className="px-4">
          <Segment
            value={kind}
            onChange={setKind}
            options={[
              { id: "all", label: "الكل" },
              { id: "expense", label: "مصروف" },
              { id: "income", label: "إيراد" },
            ]}
          />
        </div>
        <div className="px-4">
          <Segment
            value={scope}
            onChange={setScope}
            options={[
              { id: "month", label: monthLabel(month) },
              { id: "all", label: "كل الأشهر" },
            ]}
          />
        </div>
        <div className="flex gap-2 px-4">
          <select
            className="surface-card min-h-10 flex-1 rounded-cell px-3 text-caption text-label"
            value={walletFilter}
            aria-label="تصفية بالمحفظة"
            onChange={(e) => setWalletFilter(e.target.value)}
          >
            <option value="all">كل المحافظ</option>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <select
            className="surface-card min-h-10 flex-1 rounded-cell px-3 text-caption text-label"
            value={categoryFilter}
            aria-label="تصفية بالفئة"
            onChange={(e) => setLedgerCategoryFilter(e.target.value === "all" ? "" : e.target.value)}
          >
            <option value="all">كل الفئات</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSortBy((s) => (s === "date" ? "amount" : "date"))}
            className="surface-card min-h-10 shrink-0 rounded-cell px-3 text-caption font-semibold text-tint"
          >
            {sortBy === "date" ? "التاريخ" : "الأكبر"}
          </button>
        </div>
        <SearchField value={query} onChange={setQuery} placeholder="بحث في الحركات" />
        {list.length ? (
          <p className="px-4 text-caption text-label-2">
            {list.length} حركة · الصافي: <Amount value={filteredNet} currency={currency} sign="auto" />
          </p>
        ) : null}
      </div>
      {list.length === 0 ? (
        <EmptyState title="لا نتائج" body="غيّر التصفية أو أضف حركة جديدة." action={<PillButton onClick={() => openSheet({ kind: "txn" })}>إضافة</PillButton>} />
      ) : (
        [...groups.entries()].map(([date, items]) => (
          <Section key={date} title={date === "مرتّب حسب المبلغ" ? date : dayLabel(date)}>
            <Group sep="icon">
              {items.map((t) => (
                <TxRow key={t.id} tx={t} onOpen={() => openSheet({ kind: "txn", id: t.id })} />
              ))}
            </Group>
          </Section>
        ))
      )}
    </div>
  );
}

export function DebtsScreen() {
  const { openDebt, openSheet, debtFilter, setDebtFilter, query, setQuery } = useMizan();
  const debts = useFinance((s) => s.debts);
  const payments = useFinance((s) => s.payments);
  const people = useFinance((s) => s.people);
  const currency = useFinance((s) => s.currency);
  const today = todayISO();
  const q = normalizeSearch(query);

  const overdueCount = useMemo(
    () => debts.filter((d) => debtStatus(d, payments, today) === "overdue").length,
    [debts, payments, today],
  );

  const rows = debts
    .map((d) => ({ debt: d, rem: remaining(d, payments), status: debtStatus(d, payments, today) }))
    .filter(({ debt, rem, status }) => {
      if (debtFilter === "closed") return rem <= 0;
      if (rem <= 0) return false;
      if (debtFilter === "overdue") return status === "overdue";
      if (debtFilter === "receivable") return debt.direction === "receivable";
      if (debtFilter === "payable") return debt.direction === "payable";
      return true;
    })
    .filter(({ debt }) => {
      if (!q) return true;
      const name = people.find((p) => p.id === debt.personId)?.name ?? "";
      return normalizeSearch(`${debt.title} ${name} ${debt.note}`).includes(q);
    })
    .sort((a, b) => {
      if (debtFilter === "closed") return b.debt.createdAt - a.debt.createdAt;
      const ad = nextDueDate(a.debt, payments) || "9999";
      const bd = nextDueDate(b.debt, payments) || "9999";
      return ad.localeCompare(bd);
    });

  return (
    <div>
      <div data-stagger className="flex items-center justify-between px-4">
        <h1 className="text-largetitle font-bold tracking-title">الديون</h1>
        {overdueCount > 0 ? (
          <button
            type="button"
            onClick={() => setDebtFilter(debtFilter === "overdue" ? "open" : "overdue")}
            className={
              debtFilter === "overdue"
                ? "rounded-pill bg-expense px-3 py-1 text-caption font-semibold text-white"
                : "rounded-pill bg-expense/15 px-3 py-1 text-caption font-semibold text-expense"
            }
          >
            متأخرة ({overdueCount})
          </button>
        ) : null}
      </div>
      <div data-stagger className="mt-3 space-y-3">
        <div className="px-4">
          <Segment<Exclude<DebtTabFilter, "overdue">>
            value={debtFilter === "overdue" ? "open" : debtFilter}
            onChange={(val) => setDebtFilter(val)}
            options={[
              { id: "open", label: "مفتوحة" },
              { id: "receivable", label: "لي" },
              { id: "payable", label: "عليّ" },
              { id: "closed", label: "مسددة" },
            ]}
          />
        </div>
        <SearchField value={query} onChange={setQuery} placeholder="بحث في الديون" />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="لا ديون هنا"
          body={debtFilter === "overdue" ? "لا توجد ديون متأخرة حالياً." : "سجّل ما لك وما عليك، ثم سدّد على دفعات."}
          action={<PillButton onClick={() => openSheet({ kind: "debt" })}>دين جديد</PillButton>}
        />
      ) : (
        <Section>
          <Group sep="text">
            {rows.map(({ debt, rem }) => (
              <DebtRow key={debt.id} debt={debt} rem={rem} currency={currency} people={people} onOpen={() => openDebt(debt.id)} />
            ))}
          </Group>
        </Section>
      )}
    </div>
  );
}

export function PeopleScreen() {
  const { openPerson, openSheet, query, setQuery } = useMizan();
  const people = useFinance((s) => s.people);
  const debts = useFinance((s) => s.debts);
  const payments = useFinance((s) => s.payments);
  const currency = useFinance((s) => s.currency);
  const q = normalizeSearch(query);
  const rows = people
    .filter((p) => !q || normalizeSearch(`${p.name} ${p.phone} ${p.note}`).includes(q))
    .map((p) => ({ person: p, net: personNet(p.id, debts, payments) }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  return (
    <div>
      <div data-stagger className="px-4">
        <h1 className="text-largetitle font-bold tracking-title">الناس</h1>
        <p className="mt-1 text-sub text-label-2">موجب يعني لك، وسالب يعني عليك.</p>
      </div>
      <div data-stagger className="mt-3">
        <SearchField value={query} onChange={setQuery} placeholder="بحث عن شخص" />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="لا أشخاص" body="أضف من تتعامل معهم في الديون." action={<PillButton onClick={() => openSheet({ kind: "person" })}>شخص جديد</PillButton>} />
      ) : (
        <Section>
          <Group>
            {rows.map(({ person, net }) => (
              <Row
                key={person.id}
                title={<PersonName name={person.name} />}
                sub={person.note || person.phone || "بدون ملاحظة"}
                chevron
                onClick={() => openPerson(person.id)}
                trailing={<Amount value={net} currency={currency} sign="auto" />}
              />
            ))}
          </Group>
        </Section>
      )}
    </div>
  );
}

export function PersonScreen({ id }: { id: string }) {
  const { openSheet, openDebt, back } = useMizan();
  const person = useFinance((s) => s.people.find((p) => p.id === id));
  const debts = useFinance((s) => s.debts);
  const payments = useFinance((s) => s.payments);
  const txns = useFinance((s) => s.txns);
  const currency = useFinance((s) => s.currency);
  const phoneCountryCode = useFinance((s) => s.phoneCountryCode);
  const removePerson = useFinance((s) => s.removePerson);
  const restorePerson = useFinance((s) => s.restorePerson);
  if (!person) return <EmptyState title="غير موجود" body="هذا الشخص لم يعد في الدفتر." />;
  const net = personNet(person.id, debts, payments);
  const linked = debts.filter((d) => d.personId === person.id);
  const related = txns.filter((t) => t.personId === person.id).sort(sortTx);
  const cc = phoneCountryCode || defaultCountryCodeForCurrency(currency);

  return (
    <div>
      <div data-stagger className="px-4">
        <h1 className="text-largetitle font-bold tracking-title">
          <PersonName name={person.name} />
        </h1>
        <p className="mt-4 text-sub text-label-2">الصافي</p>
        <p className="text-title1 font-bold tracking-title">
          <Amount value={net} currency={currency} sign="auto" />
        </p>
      </div>
      <Section>
        <Group>
          {person.phone ? (
            <Row title="اتصال" sub={person.phone} onClick={() => window.open(`tel:${person.phone}`)} chevron />
          ) : null}
          {person.phone ? (
            <Row
              title="واتساب"
              sub="رسالة بالصافي"
              chevron
              onClick={() => {
                const href = whatsappHref(
                  person.phone,
                  reminderText(
                    person.name,
                    "الحساب بيننا",
                    money(Math.abs(net), currency),
                    net >= 0 ? "receivable" : "payable",
                  ),
                  cc,
                );
                if (href) window.open(href, "_blank", "noopener,noreferrer");
              }}
            />
          ) : null}
          {person.note ? <Row title="ملاحظة" sub={person.note} /> : null}
          <Row title="تعديل البيانات" onClick={() => openSheet({ kind: "person", id: person.id })} chevron />
        </Group>
      </Section>
      <Section title="الديون">
        {linked.length ? (
          <Group>
            {linked.map((d) => (
              <DebtRow
                key={d.id}
                debt={d}
                rem={remaining(d, payments)}
                currency={currency}
                people={[person]}
                onOpen={() => openDebt(d.id)}
              />
            ))}
          </Group>
        ) : (
          <EmptyState title="لا ديون" body="يمكن ربط دين جديد بهذا الشخص." />
        )}
      </Section>
      {related.length ? (
        <Section title="حركات مرتبطة">
          <Group sep="icon">
            {related.map((t) => (
              <TxRow key={t.id} tx={t} onOpen={() => openSheet({ kind: "txn", id: t.id })} />
            ))}
          </Group>
        </Section>
      ) : null}
      <div data-stagger className="mt-6 flex justify-center">
        <PillButton
          tone="danger"
          onClick={() => {
            if (linked.length) {
              toast("احذف ديونه أولاً");
              return;
            }
            const snapshot = removePerson(person.id);
            back();
            if (!snapshot) return;
            toast("تم حذف الشخص", {
              action: {
                label: "تراجع",
                onClick: () => restorePerson(snapshot.person, snapshot.linkedTxIds),
              },
            });
          }}
        >
          حذف الشخص
        </PillButton>
      </div>
    </div>
  );
}

export function DebtScreen({ id }: { id: string }) {
  const { openSheet, back, openPerson } = useMizan();
  const debt = useFinance((s) => s.debts.find((d) => d.id === id));
  const payments = useFinance((s) => s.payments);
  const people = useFinance((s) => s.people);
  const debtLogs = useFinance((s) => s.debtLogs ?? []);
  const currency = useFinance((s) => s.currency);
  const phoneCountryCode = useFinance((s) => s.phoneCountryCode);
  const removeDebt = useFinance((s) => s.removeDebt);
  const restoreDebt = useFinance((s) => s.restoreDebt);
  const removePayment = useFinance((s) => s.removePayment);
  const restorePayment = useFinance((s) => s.restorePayment);
  const restoreTxn = useFinance((s) => s.restoreTxn);
  if (!debt) return <EmptyState title="غير موجود" body="هذا الدين لم يعد في الدفتر." />;
  const person = people.find((p) => p.id === debt.personId);
  const rem = remaining(debt, payments);
  const paid = paidOf(debt.id, payments);
  const pct = debt.principal > 0 ? Math.min(100, Math.round((paid / debt.principal) * 100)) : 0;
  const pays = payments.filter((p) => p.debtId === debt.id).sort((a, b) => b.date.localeCompare(a.date));
  const logs = debtLogs.filter((l) => l.debtId === debt.id).slice(0, 8);
  const plan = installmentRows(debt, payments);
  const count = installmentCount(debt);
  const next = nextDueDate(debt, payments);
  const status = debtStatus(debt, payments);
  const tone = dueTone(next, rem > 0);
  const cc = phoneCountryCode || defaultCountryCodeForCurrency(currency);
  const wa =
    person?.phone && rem > 0
      ? whatsappHref(person.phone, reminderText(person.name, debt.title, money(rem, currency), debt.direction), cc)
      : "";
  const statusLabel = { paid: "مسدّد", overdue: "متأخر", soon: "قريب", later: "لاحق", open: "مفتوح" } as const;

  return (
    <div>
      <div data-stagger className="px-4">
        <p className="text-sub text-label-2">
          {debt.direction === "receivable" ? "لي" : "عليّ"} · {debtStatusLabel(status)}
        </p>
        <h1 className="text-title1 font-bold tracking-title">{debt.title}</h1>
        <p className="mt-4 text-sub text-label-2">المتبقي</p>
        <p className="text-largetitle font-bold tracking-title">
          <Amount value={rem} currency={currency} sign={rem <= 0 ? "none" : debt.direction === "receivable" ? "plus" : "minus"} />
        </p>
        <div className="mt-3">
          <AnimatedBar pct={pct} colorClass={status === "overdue" ? "bg-expense" : "bg-tint"} />
        </div>
        <p className="mt-2 text-foot text-label-2" dir="ltr">
          {paid} / {debt.principal} {currencySymbol(currency)}
        </p>
      </div>
      <Section>
        <Group>
          {person ? <Row title={<PersonName name={person.name} />} sub="صاحب الدين" chevron onClick={() => openPerson(person.id)} /> : null}
          {next ? (
            <Row
              title={count > 1 ? "القسط القادم" : tone === "overdue" ? "متأخر" : rem <= 0 ? "كان مستحقاً" : "الاستحقاق"}
              trailing={<span className="text-body text-label-2">{shortDate(next)}</span>}
            />
          ) : null}
          {count > 1 ? (
            <Row
              title="الأقساط"
              trailing={
                <span className="text-body text-label-2">
                  {count} ({debt.cadence === "weekly" ? "أسبوعي" : debt.cadence === "biweekly" ? "كل أسبوعين" : "شهري"})
                </span>
              }
            />
          ) : null}
          {debt.note ? <Row title="ملاحظة" sub={debt.note} /> : null}
          <Row title="تعديل الدين" chevron onClick={() => openSheet({ kind: "debt", id: debt.id })} />
        </Group>
      </Section>
      {rem > 0 ? (
        <div data-stagger className="mt-4 flex gap-2 px-4">
          <PillButton onClick={() => openSheet({ kind: "pay", debtId: debt.id })}>سداد</PillButton>
          {wa ? (
            <PillButton tone="gray" onClick={() => window.open(wa, "_blank", "noopener,noreferrer")}>
              تذكير واتساب
            </PillButton>
          ) : null}
        </div>
      ) : null}
      {count > 1 ? (
        <Section title="جدول الأقساط">
          <Group>
            {plan.map((row) => (
              <Row
                key={row.index}
                title={row.due ? shortDate(row.due) : `قسط ${row.index + 1}`}
                sub={statusLabel[row.status]}
                trailing={<Amount value={row.remaining > 0 ? row.remaining : row.amount} currency={currency} />}
              />
            ))}
          </Group>
        </Section>
      ) : null}
      <Section title="الدفعات">
        {pays.length ? (
          <Group>
            {pays.map((p) => (
              <Row
                key={p.id}
                title={shortDate(p.date)}
                sub={p.note || (p.txId ? "دفعة مرتبطة بالمحفظة" : "دفعة")}
                trailing={<Amount value={p.amount} currency={currency} />}
                onClick={() => {
                  const snapshot = removePayment(p.id);
                  if (!snapshot) return;
                  toast("تم حذف الدفعة", {
                    action: {
                      label: "تراجع",
                      onClick: () => {
                        restorePayment(snapshot.payment);
                        if (snapshot.tx) restoreTxn(snapshot.tx);
                      },
                    },
                  });
                }}
              />
            ))}
          </Group>
        ) : (
          <p className="px-8 text-sub text-label-2">لا دفعات بعد.</p>
        )}
        <p className="px-8 pt-2 text-foot text-label-2">اضغط دفعة لحذفها، ويمكن التراجع فوراً.</p>
      </Section>
      {logs.length ? (
        <Section title="سجل التغييرات">
          <Group>
            {logs.map((l) => (
              <Row
                key={l.id}
                title={l.summary}
                sub={shortDate(new Date(l.at).toISOString().slice(0, 10))}
                trailing={l.afterAmount !== undefined ? <Amount value={l.afterAmount} currency={currency} /> : null}
              />
            ))}
          </Group>
        </Section>
      ) : null}
      <div data-stagger className="mt-6 flex justify-center">
        <PillButton
          tone="danger"
          onClick={() => {
            const snapshot = removeDebt(debt.id);
            back();
            if (!snapshot) return;
            toast("تم حذف الدين", {
              action: {
                label: "تراجع",
                onClick: () => restoreDebt(snapshot.debt, snapshot.payments, snapshot.txns),
              },
            });
          }}
        >
          حذف الدين
        </PillButton>
      </div>
    </div>
  );
}

export function MoreScreen() {
  const {
    month,
    openSheet,
    openReport,
    openGoals,
    openWallets,
    openRecurring,
    openNotifications,
    openDrive,
    openSecurity,
    pinHash,
  } = useMizan();
  const data = useFinance();
  const categories = data.categories;
  const budgets = data.budgets;
  const currency = data.currency;
  const phoneCountryCode = data.phoneCountryCode;
  const opening = data.openingBalance;
  const setCurrency = useFinance((s) => s.setCurrency);
  const setPhoneCountryCode = useFinance((s) => s.setPhoneCountryCode);
  const setOpening = useFinance((s) => s.setOpening);
  const setBudget = useFinance((s) => s.setBudget);
  const addCategory = useFinance((s) => s.addCategory);
  const removeCategory = useFinance((s) => s.removeCategory);
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [name, setName] = useState("");
  const [openText, setOpenText] = useState(String(opening));
  const [ccText, setCcText] = useState(phoneCountryCode ?? "");
  const [encPass, setEncPass] = useState("");
  const [showEncInput, setShowEncInput] = useState(false);

  useEffect(() => {
    setOpenText(String(opening));
  }, [opening]);

  useEffect(() => {
    setCcText(phoneCountryCode ?? "");
  }, [phoneCountryCode]);

  const expenseCats = categories.filter((c) => c.kind === "expense" && c.id !== "c-debt-out");
  const fallbackCountryCode = defaultCountryCodeForCurrency(currency);

  return (
    <div>
      <div data-stagger className="px-4">
        <h1 className="text-largetitle font-bold tracking-title">المزيد</h1>
        <p className="mt-1 text-sub text-label-2">كل شيء يُحفظ على هذا الجهاز أولاً.</p>
      </div>

      <Section title="أدوات">
        <Group>
          <Row title="تقرير الشهر" sub="مقارنة 6 أشهر وتصدير PDF / Excel / PNG" chevron onClick={openReport} />
          <Row title="المحافظ والتحويل" chevron onClick={openWallets} />
          <Row title="أهداف الادخار" chevron onClick={openGoals} />
          <Row title="حركات متكررة" chevron onClick={openRecurring} />
          <Row title="الإشعارات والمهام" sub="تذكيرات الديون والفواتير" chevron onClick={openNotifications} />
          <Row
            title="مزامنة Google Drive"
            sub="نسخة خاصة مشفّرة في appDataFolder"
            leading={
              <span className="icon-tile" style={{ background: "var(--tint)" }}>
                <Cloud size={16} />
              </span>
            }
            chevron
            onClick={openDrive}
          />
          <Row
            title="الأمان والخصوصية"
            sub={pinHash ? "القفل مفعّل · البصمة · إخفاء الأرقام" : "رمز PIN · البصمة · إخفاء الأرقام · المسح الآمن"}
            leading={
              <span className="icon-tile" style={{ background: "var(--green)" }}>
                <Shield size={16} />
              </span>
            }
            chevron
            onClick={openSecurity}
          />
          <Row title="تقسيم فاتورة" sub="حصتك مصروف وحصصهم دين لك" chevron onClick={() => openSheet({ kind: "split" })} />
        </Group>
      </Section>

      <Section title="العملة وكود الدولة" footer="تغيير العملة لا يحوّل المبالغ المسجّلة. كود الدولة يُستخدم لتنسيق روابط واتساب المحلية.">
        <Group>
          {CURRENCIES.map((c) => (
            <Row
              key={c}
              title={CURRENCY_LABEL[c]}
              sub={currencySymbol(c)}
              onClick={() => setCurrency(c)}
              trailing={c === currency ? <span className="text-tint">✓</span> : null}
            />
          ))}
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="flex-1 text-body">كود دولة واتساب</span>
            <input
              className="field num w-24 text-end"
              dir="ltr"
              inputMode="numeric"
              value={ccText}
              placeholder={fallbackCountryCode}
              aria-label="كود دولة واتساب"
              onChange={(e) => setCcText(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onBlur={() => setPhoneCountryCode(ccText)}
            />
          </label>
        </Group>
      </Section>

      <Section title="افتتاحي الكاش" footer="رصيد الكاش قبل أول حركة. باقي المحافظ تُعدَّل من شاشة المحافظ.">
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="text-body">المبلغ</span>
            <input
              className="field num text-end"
              dir="ltr"
              inputMode="decimal"
              value={openText}
              onChange={(e) => setOpenText(e.target.value.replace(/[^\d.]/g, ""))}
              onBlur={() => {
                const n = Number(openText);
                if (!Number.isFinite(n) || n < 0) {
                  setOpenText(String(opening));
                  return;
                }
                setOpening(n);
              }}
            />
          </label>
        </div>
      </Section>

      <Section title="ميزانيات المصروف" footer="صفر يعني بدون حد لهذا الشهر. تظهر اقتراحات مبنية على متوسط آخر 3 أشهر.">
        <Group>
          {expenseCats.map((c) => {
            const limit = budgets.find((b) => b.categoryId === c.id)?.limit ?? 0;
            const suggested = suggestCategoryBudget(c.id, data.txns, month);
            return (
              <div key={`${c.id}-${limit}`} className="flex min-h-11 items-center gap-3 px-4 py-2">
                <IconTile name={c.icon} tone={c.tone} />
                <div className="min-w-0 flex-1">
                  <p className="text-body">{c.name}</p>
                  {suggested > 0 && limit === 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setBudget(c.id, suggested);
                        toast(`ضُبطت ميزانية ${c.name} على ${suggested}`);
                      }}
                      className="text-caption font-semibold text-tint"
                    >
                      اقتراح: {suggested}
                    </button>
                  ) : null}
                </div>
                <input
                  className="field num w-24 text-end"
                  dir="ltr"
                  inputMode="decimal"
                  defaultValue={limit ? String(limit) : ""}
                  placeholder={suggested ? String(suggested) : "0"}
                  aria-label={`ميزانية ${c.name}`}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    setBudget(c.id, Number.isFinite(n) ? Math.max(0, n) : 0);
                  }}
                />
              </div>
            );
          })}
        </Group>
      </Section>

      <Section title="فئة جديدة">
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
          <div className="px-3 py-3">
            <Segment
              value={kind}
              onChange={setKind}
              options={[
                { id: "expense", label: "مصروف" },
                { id: "income", label: "إيراد" },
              ]}
            />
          </div>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <input
              className="field"
              value={name}
              placeholder="اسم الفئة"
              onChange={(e) => setName(e.target.value)}
            />
            <PillButton
              onClick={() => {
                const id = addCategory(name, kind);
                if (!id) toast("اكتب اسماً");
                else {
                  setName("");
                  toast("أضيفت الفئة");
                }
              }}
            >
              أضف
            </PillButton>
          </label>
        </div>
        <div className="mt-3">
          <Group sep="icon">
            {categories
              .filter((c) => c.custom)
              .map((c) => (
                <Row
                  key={c.id}
                  leading={<IconTile name={c.icon} tone={c.tone} />}
                  title={c.name}
                  sub={c.kind === "income" ? "إيراد" : "مصروف"}
                  onClick={() => {
                    if (!removeCategory(c.id)) {
                      toast("الفئة مستخدمة في حركات أو تكرار");
                      return;
                    }
                    toast("حُذفت الفئة");
                  }}
                  trailing={<span className="text-foot text-expense">حذف</span>}
                />
              ))}
          </Group>
        </div>
      </Section>

      <Section title="نسخة احتياطية وتصدير">
        <Group>
          <Row title="تصدير JSON" sub="نسخة خفيفة للبيانات" chevron onClick={() => exportData()} />
          <Row
            title="تصدير JSON مع الإيصالات"
            sub="يشمل صور الإيصالات المحفوظة"
            chevron
            onClick={() => {
              void exportDataAsync({ includeReceipts: true }).then(() => toast("تم تصدير النسخة الكاملة"));
            }}
          />
          <Row
            title="تصدير نسخة مشفّرة AES-GCM"
            sub="محمية بكلمة مرور قبل المشاركة أو الحفظ"
            chevron
            onClick={() => setShowEncInput((v) => !v)}
          />
          {showEncInput ? (
            <div className="flex items-center gap-2 px-4 py-3">
              <input
                type="password"
                className="field flex-1"
                value={encPass}
                placeholder="كلمة مرور التشفير"
                onChange={(e) => setEncPass(e.target.value)}
              />
              <PillButton
                onClick={() => {
                  if (encPass.trim().length < 4) {
                    toast("اكتب كلمة مرور من 4 أحرف على الأقل");
                    return;
                  }
                  void exportDataAsync({ includeReceipts: true, passphrase: encPass.trim() }).then(() => {
                    setEncPass("");
                    setShowEncInput(false);
                    toast("تم تصدير النسخة المشفّرة");
                  });
                }}
              >
                تشفير وتصدير
              </PillButton>
            </div>
          ) : null}
          <Row title="تصدير Excel" sub="ملف CSV يفتح في Excel" chevron onClick={() => exportCsv()} />
          <Row
            title="طباعة / PDF للتقرير"
            sub={`تقرير شهر ${monthLabel(month)}`}
            chevron
            onClick={() => {
              exportMonthlyReportPdf(pickFinanceData(data), month);
              toast("جُهّز التقرير للطباعة / PDF");
            }}
          />
          <Row
            title="استيراد ملف"
            sub="يدعم JSON العادي والمشفّر"
            chevron
            onClick={() => document.getElementById("mizan-import")?.click()}
          />
        </Group>
        <input
          id="mizan-import"
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const text = await file.text();
            try {
              await importDataAsync(text);
              toast("تم الاستيراد");
            } catch (err) {
              const msg = err instanceof Error ? err.message : "";
              if (msg.includes("مشفّرة") || msg.includes("كلمة مرور")) {
                const pass = window.prompt("أدخل كلمة مرور النسخة المشفّرة:");
                if (!pass) return;
                try {
                  await importDataAsync(text, pass);
                  toast("تم فك التشفير والاستيراد");
                } catch {
                  toast("كلمة المرور غير صحيحة أو الملف تالف");
                }
              } else {
                toast(msg || "الملف غير مفهوم");
              }
            }
          }}
        />
      </Section>

      <Section>
        <Group>
          <Row title="مسح كل البيانات" destructive onClick={() => openSheet({ kind: "reset" })} />
        </Group>
        <p className="px-8 pt-6 text-center text-foot text-label-2">ميزان · كل الحقوق محفوظة لـ Zyad Gamal</p>
      </Section>
    </div>
  );
}
