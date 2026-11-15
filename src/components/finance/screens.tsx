import {
  Building2,
  Cloud,
  ChevronLeft,
  ChevronRight,
  Crown,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Globe,
  LogOut,
  Search,
  Shield,
  Sparkles,
  Terminal,
} from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
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
import { clearErrorLogs, loadErrorLogs } from "@/lib/finance/error-log";
import { useI18n } from "@/lib/finance/i18n";
import {
  budgetAlerts,
  cashPosition,
  computeMonthlyAnalytics,
  currencySymbol,
  currentMonth,
  dayLabel,
  debtStatus,
  debtStatusLabel,
  debtTotals,
  defaultCountryCodeForCurrency,
  detectUnusualExpenses,
  dueTone,
  effectiveExchangeRate,
  formatNumber,
  formatPercent,
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
  toLatinDigits,
  txBaseAmount,
  walletBalance,
  weeklySpendingSummary,
  whatsappHref,
} from "@/lib/finance/logic";
import { getLatestPerfSample } from "@/lib/finance/perf-metrics";
import { updateUiPrefs } from "@/lib/finance/prefs";
import { exportMonthlyReportPdf } from "@/lib/finance/report-export";
import { updateSecuritySettings, useSecuritySettings } from "@/lib/finance/security";
import { exportCsv, exportData, exportDataAsync, importDataAsync, pickFinanceData, useFinance } from "@/lib/finance/store";
import type { Currency, Debt, Tx } from "@/lib/finance/types";
import { CURRENCIES } from "@/lib/finance/types";
import { useOptionalTenant } from "@/lib/tenant/context";
import { formatRoleLabel, formatTenantKindLabel } from "@/lib/tenant/types";

function MonthSwitch() {
  const { month, shiftMonth } = useMizan();
  const { lang, numeralStyle, isRtl } = useI18n();
  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;
  return (
    <div className="mt-3 inline-flex items-center rounded-pill bg-fill">
      <button
        type="button"
        className="flex min-h-11 min-w-11 items-center justify-center text-label"
        onClick={() => shiftMonth(-1)}
        aria-label={lang === "en" ? "Previous month" : "الشهر السابق"}
      >
        <PrevIcon size={20} strokeWidth={2} />
      </button>
      <span className="min-w-36 text-center text-sub font-semibold">{monthLabel(month, lang, numeralStyle)}</span>
      <button
        type="button"
        className="flex min-h-11 min-w-11 items-center justify-center text-label"
        onClick={() => shiftMonth(1)}
        aria-label={lang === "en" ? "Next month" : "الشهر التالي"}
      >
        <NextIcon size={20} strokeWidth={2} />
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
    openLedgerFiltered,
    setTab,
  } = useMizan();
  const data = useFinance();
  const { hideAmounts } = useSecuritySettings();
  const { lang, numeralStyle, analyticsEnabled, t, catName } = useI18n();
  const confirmRecurring = useFinance((s) => s.confirmRecurring);
  const skipRecurring = useFinance((s) => s.skipRecurring);
  const income = sumKind(data.txns, "income", month, data.currency, data.exchangeRates);
  const expense = sumKind(data.txns, "expense", month, data.currency, data.exchangeRates);
  const net = income - expense;
  const cash = cashPosition(data);
  const saved = goalsSaved(data.goalMoves);
  const totals = debtTotals(data.debts, data.payments);
  const weeks = monthWeeks(month, data.txns, data.currency, data.exchangeRates, numeralStyle);
  const hasChart = weeks.some((w) => w.income || w.expense);
  const today = todayISO();
  const isCurrentViewedMonth = month === currentMonth();
  const weekly = useMemo(
    () => weeklySpendingSummary(data.txns, data.categories, today, data.currency, data.exchangeRates),
    [data.txns, data.categories, today, data.currency, data.exchangeRates],
  );
  const activeAlerts = useMemo(
    () => budgetAlerts(data.budgets, data.categories, data.txns, month, data.currency, data.exchangeRates).filter((b) => b.level !== "ok"),
    [data.budgets, data.categories, data.txns, month, data.currency, data.exchangeRates],
  );
  const unusual = useMemo(
    () =>
      isCurrentViewedMonth
        ? detectUnusualExpenses(data.txns, data.categories, month, data.currency, data.exchangeRates)
        : { txAlerts: [], categoryAlerts: [] },
    [data.txns, data.categories, month, isCurrentViewedMonth, data.currency, data.exchangeRates],
  );
  const analytics = useMemo(
    () => (analyticsEnabled ? computeMonthlyAnalytics(data, month, today) : null),
    [analyticsEnabled, data, month, today],
  );
  const overdueDebts = useMemo(
    () => data.debts.filter((d) => debtStatus(d, data.payments, today) === "overdue"),
    [data.debts, data.payments, today],
  );
  const dues = data.debts
    .map((d) => ({ debt: d, rem: remaining(d, data.payments), due: nextDueDate(d, data.payments) }))
    .filter((x) => x.rem > 0 && x.due && x.due <= addDays(today, 14))
    .sort((a, b) => a.due.localeCompare(b.due));
  const recent = data.txns.filter((item) => item.date.startsWith(month)).sort(sortTx).slice(0, 6);
  const waiting = isCurrentViewedMonth ? pendingRecurring(data.recurring, month) : [];
  const budgets = data.budgets
    .map((b) => {
      const cat = data.categories.find((c) => c.id === b.categoryId);
      if (!cat) return null;
      const spent = sumKind(
        data.txns.filter((item) => item.categoryId === b.categoryId),
        "expense",
        month,
        data.currency,
        data.exchangeRates,
      );
      return { ...b, cat, spent };
    })
    .filter((b) => b !== null);

  return (
    <div>
      <div data-stagger className="px-4">
        <div className="flex items-center justify-between">
          <h1 className="text-largetitle font-bold tracking-title">{t("tabHome")}</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => openSheet({ kind: "search" })}
              aria-label={t("search")}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-pill bg-fill text-label"
            >
              <Search size={18} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => updateSecuritySettings({ hideAmounts: !hideAmounts })}
              aria-label={
                hideAmounts
                  ? lang === "en"
                    ? "Show amounts"
                    : "إظهار المبالغ"
                  : lang === "en"
                    ? "Hide amounts"
                    : "إخفاء المبالغ"
              }
              className="flex min-h-11 min-w-11 items-center justify-center rounded-pill bg-fill text-label"
            >
              {hideAmounts ? <Eye size={18} strokeWidth={2} /> : <EyeOff size={18} strokeWidth={2} />}
            </button>
          </div>
        </div>
        <MonthSwitch />
        <p className="mt-6 text-sub text-label-2">{t("netThisMonth")}</p>
        <p className="text-largetitle font-bold tracking-title">
          <Amount value={net} currency={data.currency} sign="auto" />
        </p>
      </div>

      {data.demo ? (
        <Section className="mt-4">
          <Group>
            <Row
              title={lang === "en" ? "Sample Data" : "بيانات تجريبية"}
              sub={lang === "en" ? "Clear it when you start your own ledger" : "امسحها عندما تبدأ دفترَك"}
              trailing={
                <PillButton tone="gray" onClick={() => openSheet({ kind: "reset" })}>
                  {lang === "en" ? "Clear" : "مسح"}
                </PillButton>
              }
            />
          </Group>
        </Section>
      ) : null}

      <div data-stagger className="mt-5 flex gap-2.5 overflow-x-auto px-4 pb-1 lg:grid lg:grid-cols-4 lg:overflow-visible">
        {data.wallets.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={openWallets}
            className="surface-card min-w-32 shrink-0 rounded-cell px-3.5 py-2.5 text-start lg:min-w-0"
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
          {t("quickExpense")}
        </button>
        <button
          type="button"
          onClick={() => openSheet({ kind: "txn", prefill: { kind: "income" } })}
          className="shrink-0 rounded-pill bg-fill px-3.5 py-2 text-caption font-semibold text-income active:opacity-80"
        >
          {t("quickIncome")}
        </button>
        <button
          type="button"
          onClick={() => openSheet({ kind: "debt" })}
          className="shrink-0 rounded-pill bg-fill px-3.5 py-2 text-caption font-semibold text-tint active:opacity-80"
        >
          {t("quickDebt")}
        </button>
        <button
          type="button"
          onClick={() => openSheet({ kind: "split" })}
          className="shrink-0 rounded-pill bg-fill px-3.5 py-2 text-caption font-semibold text-label active:opacity-80"
        >
          {t("quickSplit")}
        </button>
      </div>

      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-4">
        <div className="lg:col-span-5">
          {activeAlerts.length || unusual.txAlerts.length || unusual.categoryAlerts.length || overdueDebts.length ? (
            <Section title={lang === "en" ? "Smart Alerts" : "تنبيهات ذكية"}>
              <Group>
                {overdueDebts.length ? (
                  <Row
                    title={lang === "en" ? `${overdueDebts.length} overdue debts` : `${formatNumber(overdueDebts.length, numeralStyle, lang)} ديون متأخرة`}
                    sub={lang === "en" ? "Past due date" : "تجاوزت تاريخ الاستحقاق"}
                    onClick={() => openDebtsFiltered("overdue")}
                    chevron
                    trailing={<span className="text-caption font-semibold text-expense">{lang === "en" ? "Review" : "مراجعة"}</span>}
                  />
                ) : null}
                {activeAlerts.slice(0, 2).map((a) => (
                  <Row
                    key={a.category.id}
                    title={
                      a.level === "over"
                        ? lang === "en"
                          ? `Over ${catName(a.category)} budget`
                          : `تجاوزت ميزانية ${catName(a.category)}`
                        : lang === "en"
                          ? `Near ${catName(a.category)} budget`
                          : `اقتربت من حد ${catName(a.category)}`
                    }
                    sub={
                      lang === "en"
                        ? `Spent ${formatNumber(Math.round(a.spent), numeralStyle, lang)} of ${formatNumber(Math.round(a.limit), numeralStyle, lang)}`
                        : `الصرف ${formatNumber(Math.round(a.spent), numeralStyle, lang)} من ${formatNumber(Math.round(a.limit), numeralStyle, lang)} (${formatPercent(a.pct, numeralStyle, lang)})`
                    }
                    onClick={openReport}
                    chevron
                    trailing={
                      <span className={a.level === "over" ? "text-caption font-semibold text-expense" : "text-caption font-semibold text-warn"}>
                        {formatPercent(a.pct, numeralStyle, lang)}
                      </span>
                    }
                  />
                ))}
                {unusual.txAlerts.slice(0, 1).map((u) => (
                  <Row
                    key={u.tx.id}
                    title={lang === "en" ? `Higher than usual in ${u.categoryName}` : `صرف أعلى من المعتاد في ${u.categoryName}`}
                    sub={`${u.tx.note || u.categoryName} · ${formatNumber(u.ratio, numeralStyle, lang)}x`}
                    onClick={() => openSheet({ kind: "txn", id: u.tx.id })}
                    chevron
                    trailing={<Amount value={txBaseAmount(u.tx, data.currency, data.exchangeRates)} currency={data.currency} sign="minus" />}
                  />
                ))}
              </Group>
            </Section>
          ) : null}

          {waiting.length ? (
            <Section
              title={lang === "en" ? "Awaiting Confirmation" : "بانتظار التأكيد"}
              footer={lang === "en" ? "Confirming records today; skipping defers until next month." : "التأكيد يسجّل الحركة اليوم. التخطي يؤجلها لنهاية الشهر."}
            >
              <Group>
                {waiting.map((r) => {
                  const cat = data.categories.find((c) => c.id === r.categoryId);
                  return (
                    <Row
                      key={r.id}
                      title={r.note || catName(cat)}
                      sub={
                        today.slice(8, 10) < String(r.day).padStart(2, "0")
                          ? lang === "en"
                            ? `Due day ${formatNumber(r.day, numeralStyle, lang)}`
                            : `موعدها يوم ${formatNumber(r.day, numeralStyle, lang)}`
                          : lang === "en"
                            ? "Due now"
                            : "حان موعدها"
                      }
                      trailing={
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            className="min-h-11 px-2 text-sub font-semibold text-label-2"
                            onClick={() => {
                              skipRecurring(r.id);
                              toast(lang === "en" ? "Skipped for this month" : "تم التخطي هذا الشهر");
                            }}
                          >
                            {lang === "en" ? "Skip" : "تخطي"}
                          </button>
                          <button
                            type="button"
                            className="min-h-11 px-2 text-sub font-semibold text-tint"
                            onClick={() => {
                              if (confirmRecurring(r.id)) toast(lang === "en" ? "Transaction recorded" : "سُجّلت الحركة");
                            }}
                          >
                            {lang === "en" ? "Confirm" : "تأكيد"}
                          </button>
                        </span>
                      }
                    />
                  );
                })}
              </Group>
            </Section>
          ) : null}

          <Section title={t("thisMonth")}>
            <Group>
              <Row title={t("income")} trailing={<Amount value={income} currency={data.currency} sign="plus" />} />
              <Row title={t("expense")} trailing={<Amount value={expense} currency={data.currency} sign="minus" />} />
              {isCurrentViewedMonth ? (
                <Row
                  title={lang === "en" ? "Last 7 Days Spend" : "مصاريف آخر 7 أيام"}
                  sub={
                    lang === "en"
                      ? `Prior week ${formatNumber(Math.round(weekly.prevWeekExpense), numeralStyle, lang)}`
                      : `الأسبوع السابق ${formatNumber(Math.round(weekly.prevWeekExpense), numeralStyle, lang)}`
                  }
                  trailing={<Amount value={weekly.currentWeekExpense} currency={data.currency} />}
                />
              ) : null}
            </Group>
          </Section>

          <Section
            title={t("situation")}
            footer={
              lang === "en"
                ? "Cash is the sum of wallets. Debt payments move wallets without inflating monthly income/expense."
                : "الرصيد مجموع المحافظ. سداد الدين وتحصيله يحرّكان المحفظة دون أن يُحسبا إيراداً أو مصروفاً جديداً."
            }
          >
            <Group>
              <Row title={t("cashBalance")} trailing={<Amount value={cash} currency={data.currency} sign="auto" />} onClick={openWallets} chevron />
              <Row title={t("savedGoals")} trailing={<Amount value={saved} currency={data.currency} />} onClick={openGoals} chevron />
              <Row title={t("receivable")} trailing={<Amount value={totals.receivable} currency={data.currency} sign="plus" />} onClick={() => setTab("debts")} chevron />
              <Row title={t("payable")} trailing={<Amount value={totals.payable} currency={data.currency} sign="minus" />} onClick={() => setTab("debts")} chevron />
              <Row title={t("monthReport")} sub={lang === "en" ? "6-month comparison & PDF / Excel export" : "مقارنة 6 أشهر وتصدير PDF / Excel"} chevron onClick={openReport} />
            </Group>
          </Section>

          {budgets.length ? (
            <Section title={t("budgets")}>
              <Group>
                {budgets.map((b) => {
                  const pct = b.limit > 0 ? Math.min(100, Math.round((b.spent / b.limit) * 100)) : 0;
                  const over = b.spent > b.limit;
                  const near = !over && pct >= 80;
                  return (
                    <div key={b.categoryId} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-body">{catName(b.cat)}</span>
                        <span className="num text-foot text-label-2" dir="ltr">
                          {over ? (lang === "en" ? "Over · " : "تجاوز · ") : near ? (lang === "en" ? "Near · " : "قرب الحد · ") : ""}
                          {formatNumber(Math.round(b.spent), numeralStyle, lang)} / {formatNumber(Math.round(b.limit), numeralStyle, lang)}
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
        </div>

        <div className="lg:col-span-7">
          {analyticsEnabled && analytics ? (
            <Section title={t("analyticsTitle")} footer={t("analyticsFooter")}>
              <Group sep="icon">
                <Row
                  leading={
                    <span className="icon-tile" style={{ background: "var(--tint)" }}>
                      <Sparkles size={16} />
                    </span>
                  }
                  title={t("analyticsDailyAvg")}
                  sub={
                    lang === "en"
                      ? `Across ${formatNumber(analytics.elapsedDays, numeralStyle, lang)} days`
                      : `على مدار ${formatNumber(analytics.elapsedDays, numeralStyle, lang)} يوماً`
                  }
                  trailing={<Amount value={analytics.dailyAverageExpense} currency={data.currency} />}
                />
                <Row
                  leading={
                    <span className="icon-tile" style={{ background: "var(--orange)" }}>
                      <Sparkles size={16} />
                    </span>
                  }
                  title={t("analyticsProjected")}
                  sub={
                    lang === "en"
                      ? `Projected Net: ${money(analytics.projectedNet, data.currency, numeralStyle, lang)}`
                      : `صافي متوقع: ${analytics.projectedNet >= 0 ? "+" : "−"}${money(Math.abs(analytics.projectedNet), data.currency, numeralStyle, lang)}`
                  }
                  trailing={<Amount value={analytics.projectedMonthEndExpense} currency={data.currency} sign="minus" />}
                />
                {analytics.highestSpendingDays.length ? (
                  <div className="px-4 py-3">
                    <p className="text-body font-medium text-label">{t("analyticsTopDays")}</p>
                    <div className="mt-2 space-y-1.5">
                      {analytics.highestSpendingDays.map((d) => (
                        <div key={d.date} className="flex items-center justify-between text-foot">
                          <span className="text-label-2">{shortDate(d.date, lang, numeralStyle)}</span>
                          <Amount value={d.amount} currency={data.currency} sign="minus" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {analytics.increasedCategories.length ? (
                  <div className="px-4 py-3">
                    <p className="text-body font-medium text-label">{t("analyticsIncreasedCats")}</p>
                    <div className="mt-2 space-y-1.5">
                      {analytics.increasedCategories.slice(0, 3).map((c) => (
                        <div key={c.category.id} className="flex items-center justify-between text-foot">
                          <span className="text-label-2">
                            {catName(c.category)} (+{formatPercent(c.pctIncrease, numeralStyle, lang)})
                          </span>
                          <Amount value={c.delta} currency={data.currency} sign="minus" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <Row
                  title={t("analyticsUncategorized")}
                  sub={
                    analytics.uncategorizedCount > 0
                      ? lang === "en"
                        ? "Tap to review in Ledger"
                        : "اضغط لمراجعتها في السجل"
                      : lang === "en"
                        ? "All entries categorized"
                        : "كل الحركات مصنّفة"
                  }
                  chevron={analytics.uncategorizedCount > 0}
                  onClick={analytics.uncategorizedCount > 0 ? () => openLedgerFiltered("c-other-x") : undefined}
                  trailing={
                    <span className="num text-body font-semibold text-label">
                      {formatNumber(analytics.uncategorizedCount, numeralStyle, lang)}
                    </span>
                  }
                />
              </Group>
            </Section>
          ) : (
            <Section title={t("analyticsTitle")}>
              <Group>
                <Row
                  title={t("analyticsDisabled")}
                  trailing={
                    <PillButton
                      tone="gray"
                      onClick={() => updateUiPrefs({ analyticsEnabled: true })}
                    >
                      {t("analyticsEnable")}
                    </PillButton>
                  }
                />
              </Group>
            </Section>
          )}

          {dues.length ? (
            <Section title={lang === "en" ? "Upcoming Dues" : "استحقاقات قريبة"}>
              <Group sep="icon">
                {dues.map(({ debt, rem }) => (
                  <DebtRow key={debt.id} debt={debt} rem={rem} currency={data.currency} people={data.people} onOpen={() => openDebt(debt.id)} />
                ))}
              </Group>
            </Section>
          ) : null}

          <Section title={t("monthWeeks")}>
            <div className="surface-card mx-4 rounded-cell px-2 py-3">
              {hasChart ? (
                <WeekChart weeks={weeks} />
              ) : (
                <p className="px-3 py-6 text-center text-sub text-label-2">
                  {lang === "en" ? "No activity in this month" : "لا حركة في هذا الشهر"}
                </p>
              )}
              <p className="px-3 pt-1 text-caption text-label-2">
                {lang === "en" ? "Green = income, Red = expense." : "الأخضر إيراد، والأحمر مصروف."}
              </p>
            </div>
          </Section>

          <Section title={t("recentTxns")}>
            {recent.length ? (
              <Group sep="icon">
                {recent.map((item) => (
                  <TxRow key={item.id} tx={item} onOpen={() => openSheet({ kind: "txn", id: item.id })} />
                ))}
              </Group>
            ) : (
              <EmptyState
                title={lang === "en" ? "No Transactions" : "لا حركات"}
                body={lang === "en" ? "Add an income or expense for this month." : "أضف إيراداً أو مصروفاً لهذا الشهر."}
              />
            )}
          </Section>
        </div>
      </div>
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

const LazyWeekChart = lazy(() => import("@/components/finance/week-chart"));

function WeekChart({ weeks }: { weeks: { label: string; income: number; expense: number }[] }) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []);
  if (!on) return <div className="h-44" />;
  return (
    <Suspense fallback={<div className="h-44" />}>
      <LazyWeekChart weeks={weeks} />
    </Suspense>
  );
}

function TxRow({ tx, onOpen }: { tx: Tx; onOpen: () => void }) {
  const categories = useFinance((s) => s.categories);
  const wallets = useFinance((s) => s.wallets);
  const currency = useFinance((s) => s.currency);
  const exchangeRates = useFinance((s) => s.exchangeRates);
  const { lang, numeralStyle, catName } = useI18n();
  const cat = categories.find((c) => c.id === tx.categoryId);
  const wallet = wallets.find((w) => w.id === (tx.walletId || "w-cash"));
  const isForeign = Boolean(tx.currency && tx.currency !== currency);
  const baseVal = txBaseAmount(tx, currency, exchangeRates);
  const foreignTag = isForeign
    ? `${formatNumber(tx.amount, numeralStyle, lang)} ${currencySymbol(tx.currency!, lang)}${tx.exchangeRate ? ` @ ${formatNumber(tx.exchangeRate, numeralStyle, lang)}` : ""}`
    : "";
  const flags = [
    foreignTag,
    tx.createdByName ? tx.createdByName : "",
    tx.reported === false ? (lang === "en" ? "Excluded" : "خارج الملخص") : "",
    tx.receiptId ? (lang === "en" ? "Receipt" : "إيصال") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Row
      onClick={onOpen}
      leading={cat ? <IconTile name={cat.icon} tone={cat.tone} /> : null}
      title={tx.note || catName(cat)}
      sub={`${catName(cat)} · ${wallet?.name ?? (lang === "en" ? "Cash" : "كاش")} · ${dayLabel(tx.date, lang, numeralStyle)}${flags ? ` · ${flags}` : ""}`}
      trailing={<Amount value={baseVal} currency={currency} sign={tx.kind === "income" ? "plus" : "minus"} />}
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
  const exchangeRates = useFinance((s) => s.exchangeRates);
  const { lang, numeralStyle, t, catName } = useI18n();
  const [scope, setScope] = useState<"all" | "month">("month");
  const [kind, setKind] = useState<"all" | "income" | "expense">("all");
  const [walletFilter, setWalletFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const categoryFilter = ledgerCategoryFilter || "all";
  const q = normalizeSearch(query);

  const list = useMemo(() => {
    return txns
      .filter((item) => (scope === "month" ? item.date.startsWith(month) : true))
      .filter((item) => (kind === "all" ? true : item.kind === kind))
      .filter((item) => (walletFilter === "all" ? true : (item.walletId || "w-cash") === walletFilter))
      .filter((item) => (categoryFilter === "all" ? true : item.categoryId === categoryFilter))
      .filter((item) => {
        if (!q) return true;
        const cat = categories.find((c) => c.id === item.categoryId);
        return normalizeSearch(`${item.note} ${catName(cat)} ${item.currency ?? currency}`).includes(q);
      })
      .sort((a, b) =>
        sortBy === "amount"
          ? txBaseAmount(b, currency, exchangeRates) - txBaseAmount(a, currency, exchangeRates)
          : sortTx(a, b),
      );
  }, [txns, scope, month, kind, walletFilter, categoryFilter, sortBy, q, categories, currency, exchangeRates, catName]);

  const filteredNet = useMemo(
    () =>
      list.reduce((s, item) => {
        const val = txBaseAmount(item, currency, exchangeRates);
        return s + (item.kind === "income" ? val : -val);
      }, 0),
    [list, currency, exchangeRates],
  );

  const groups = new Map<string, Tx[]>();
  for (const item of list) {
    const key = sortBy === "amount" ? (lang === "en" ? "Sorted by amount" : "مرتّب حسب المبلغ") : item.date;
    const arr = groups.get(key) ?? [];
    arr.push(item);
    groups.set(key, arr);
  }

  return (
    <div>
      <div data-stagger className="flex items-center justify-between px-4">
        <h1 className="text-largetitle font-bold tracking-title">{t("tabLedger")}</h1>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => openSheet({ kind: "csv-import" })}
            className="rounded-pill bg-fill px-3 py-1.5 text-caption font-semibold text-label"
          >
            CSV
          </button>
          <button
            type="button"
            onClick={() => openSheet({ kind: "search" })}
            className="rounded-pill bg-fill px-3 py-1.5 text-caption font-semibold text-tint"
          >
            {t("search")}
          </button>
        </div>
      </div>
      <div data-stagger className="mt-3 space-y-3">
        <div className="px-4">
          <Segment
            value={kind}
            onChange={setKind}
            options={[
              { id: "all", label: t("all") },
              { id: "expense", label: t("expenseSingular") },
              { id: "income", label: t("incomeSingular") },
            ]}
          />
        </div>
        <div className="px-4">
          <Segment
            value={scope}
            onChange={setScope}
            options={[
              { id: "month", label: monthLabel(month, lang, numeralStyle) },
              { id: "all", label: lang === "en" ? "All Months" : "كل الأشهر" },
            ]}
          />
        </div>
        <div className="flex gap-2 px-4">
          <select
            className="surface-card min-h-10 flex-1 rounded-cell px-3 text-caption text-label"
            value={walletFilter}
            aria-label={lang === "en" ? "Filter by wallet" : "تصفية بالمحفظة"}
            onChange={(e) => setWalletFilter(e.target.value)}
          >
            <option value="all">{lang === "en" ? "All Wallets" : "كل المحافظ"}</option>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <select
            className="surface-card min-h-10 flex-1 rounded-cell px-3 text-caption text-label"
            value={categoryFilter}
            aria-label={lang === "en" ? "Filter by category" : "تصفية بالفئة"}
            onChange={(e) => setLedgerCategoryFilter(e.target.value === "all" ? "" : e.target.value)}
          >
            <option value="all">{lang === "en" ? "All Categories" : "كل الفئات"}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {catName(c)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSortBy((s) => (s === "date" ? "amount" : "date"))}
            className="surface-card min-h-10 shrink-0 rounded-cell px-3 text-caption font-semibold text-tint"
          >
            {sortBy === "date" ? (lang === "en" ? "Date" : "التاريخ") : lang === "en" ? "Largest" : "الأكبر"}
          </button>
        </div>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={lang === "en" ? "Search transactions" : "بحث في الحركات"}
        />
        {list.length ? (
          <p className="px-4 text-caption text-label-2">
            {formatNumber(list.length, numeralStyle, lang)}{" "}
            {lang === "en" ? "items · Net:" : "حركة · الصافي:"}{" "}
            <Amount value={filteredNet} currency={currency} sign="auto" />
          </p>
        ) : null}
      </div>
      {list.length === 0 ? (
        <EmptyState
          title={lang === "en" ? "No Results" : "لا نتائج"}
          body={lang === "en" ? "Change filters or add a new transaction." : "غيّر التصفية أو أضف حركة جديدة."}
          action={<PillButton onClick={() => openSheet({ kind: "txn" })}>{t("add")}</PillButton>}
        />
      ) : (
        [...groups.entries()].map(([date, items]) => (
          <Section
            key={date}
            title={
              date === "مرتّب حسب المبلغ" || date === "Sorted by amount"
                ? date
                : dayLabel(date, lang, numeralStyle)
            }
          >
            <Group sep="icon">
              {items.map((item) => (
                <TxRow key={item.id} tx={item} onOpen={() => openSheet({ kind: "txn", id: item.id })} />
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
  const { lang, numeralStyle, t } = useI18n();
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
        <h1 className="text-largetitle font-bold tracking-title">{t("tabDebts")}</h1>
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
            {lang === "en" ? "Overdue" : "متأخرة"} ({formatNumber(overdueCount, numeralStyle, lang)})
          </button>
        ) : null}
      </div>
      <div data-stagger className="mt-3 space-y-3">
        <div className="px-4">
          <Segment<Exclude<DebtTabFilter, "overdue">>
            value={debtFilter === "overdue" ? "open" : debtFilter}
            onChange={(val) => setDebtFilter(val)}
            options={[
              { id: "open", label: lang === "en" ? "Open" : "مفتوحة" },
              { id: "receivable", label: lang === "en" ? "Owed to Me" : "لي" },
              { id: "payable", label: lang === "en" ? "I Owe" : "عليّ" },
              { id: "closed", label: lang === "en" ? "Paid" : "مسددة" },
            ]}
          />
        </div>
        <SearchField value={query} onChange={setQuery} placeholder={lang === "en" ? "Search debts" : "بحث في الديون"} />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title={lang === "en" ? "No Debts Here" : "لا ديون هنا"}
          body={
            debtFilter === "overdue"
              ? lang === "en"
                ? "No overdue debts right now."
                : "لا توجد ديون متأخرة حالياً."
              : lang === "en"
                ? "Track what is owed to you or by you, then record payments."
                : "سجّل ما لك وما عليك، ثم سدّد على دفعات."
          }
          action={<PillButton onClick={() => openSheet({ kind: "debt" })}>{lang === "en" ? "New Debt" : "دين جديد"}</PillButton>}
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
  const { lang, t } = useI18n();
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
        <h1 className="text-largetitle font-bold tracking-title">{t("tabPeople")}</h1>
        <p className="mt-1 text-sub text-label-2">
          {lang === "en" ? "Positive means owed to you; negative means you owe." : "موجب يعني لك، وسالب يعني عليك."}
        </p>
      </div>
      <div data-stagger className="mt-3">
        <SearchField value={query} onChange={setQuery} placeholder={lang === "en" ? "Search people" : "بحث عن شخص"} />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title={lang === "en" ? "No People" : "لا أشخاص"}
          body={lang === "en" ? "Add contacts you share debts or expenses with." : "أضف من تتعامل معهم في الديون."}
          action={<PillButton onClick={() => openSheet({ kind: "person" })}>{lang === "en" ? "New Person" : "شخص جديد"}</PillButton>}
        />
      ) : (
        <Section>
          <Group>
            {rows.map(({ person, net }) => (
              <Row
                key={person.id}
                title={<PersonName name={person.name} />}
                sub={person.note || person.phone || (lang === "en" ? "No note" : "بدون ملاحظة")}
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
    openTenant,
    openAdmin,
    pinHash,
  } = useMizan();
  const tenant = useOptionalTenant();
  const data = useFinance();
  const { lang, numeralStyle, analyticsEnabled, t, catName, currencyName } = useI18n();
  const categories = data.categories;
  const budgets = data.budgets;
  const currency = data.currency;
  const exchangeRates = data.exchangeRates;
  const phoneCountryCode = data.phoneCountryCode;
  const opening = data.openingBalance;
  const setCurrency = useFinance((s) => s.setCurrency);
  const setExchangeRate = useFinance((s) => s.setExchangeRate);
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
  const [errorLogs, setErrorLogs] = useState(() => loadErrorLogs());
  const latestPerf = useMemo(() => getLatestPerfSample(), []);

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
        <h1 className="text-largetitle font-bold tracking-title">{t("moreTitle")}</h1>
        <p className="mt-1 text-sub text-label-2">
          {lang === "en" ? "Everything stays saved locally on this device first." : "كل شيء يُحفظ على هذا الجهاز أولاً."}
        </p>
      </div>

      {tenant?.activeTenant ? (
        <Section title={lang === "en" ? "Workspace & Multi-Tenant" : "المساحة والمستأجرون والاشتراك"}>
          <Group sep="icon">
            <Row
              leading={
                <span className="icon-tile" style={{ background: "var(--tint)" }}>
                  <Building2 size={16} />
                </span>
              }
              title={tenant.activeTenant.name}
              sub={`${formatTenantKindLabel(tenant.activeTenant.kind, lang)} · ${formatRoleLabel(tenant.activeTenant.role, lang)} · ${tenant.workspaces.length} ${lang === "en" ? "workspaces" : "مساحات"}`}
              chevron
              onClick={() => openSheet({ kind: "workspace-switcher" })}
            />
            <Row
              title={lang === "en" ? "Workspace Settings, Members & Plan" : "إعدادات المساحة والأعضاء والاشتراك"}
              sub={
                tenant.pendingOpsCount > 0
                  ? `${tenant.pendingOpsCount} ${lang === "en" ? "pending sync ops" : "عمليات بانتظار المزامنة"}`
                  : lang === "en"
                    ? "Invites, roles, monthly/yearly plan & audit log"
                    : "الدعوات، الصلاحيات، الخطة الشهرية/السنوية وسجل النشاط"
              }
              chevron
              onClick={openTenant}
            />
            {tenant.isSuperAdmin ? (
              <Row
                leading={
                  <span className="icon-tile" style={{ background: "var(--orange)" }}>
                    <Crown size={16} />
                  </span>
                }
                title={lang === "en" ? "Platform Super-Admin Console" : "لوحة تحكم المنصة (Super-Admin)"}
                sub={lang === "en" ? "Tenants, symbolic pricing & suspension" : "إدارة المستأجرين والخطط وحالة التفعيل"}
                chevron
                onClick={openAdmin}
              />
            ) : null}
            <Row
              leading={
                <span className="icon-tile" style={{ background: "var(--expense)" }}>
                  <LogOut size={16} />
                </span>
              }
              title={lang === "en" ? "Sign Out" : "تسجيل الخروج"}
              sub={tenant.user?.email ?? ""}
              destructive
              onClick={() => void tenant.signOut()}
            />
          </Group>
        </Section>
      ) : null}

      <Section title={t("languageSection")} footer={t("languageFooter")}>
        <Group sep="icon">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-2 pb-2">
              <span className="inline-flex items-center gap-2 text-body">
                <Globe size={16} className="text-tint" />
                <span>{t("languageLabel")}</span>
              </span>
            </div>
            <Segment<"ar" | "en">
              value={lang}
              onChange={(nextLang) => updateUiPrefs({ language: nextLang })}
              options={[
                { id: "ar", label: "العربية" },
                { id: "en", label: "English" },
              ]}
            />
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-2 pb-2">
              <span className="text-body">{t("numeralsLabel")}</span>
            </div>
            <Segment<"latn" | "arab">
              value={numeralStyle}
              onChange={(nextStyle) => updateUiPrefs({ numeralStyle: nextStyle })}
              options={[
                { id: "latn", label: t("numeralsWestern") },
                { id: "arab", label: t("numeralsArabicIndic") },
              ]}
            />
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-body">{t("analyticsToggleTitle")}</p>
              <p className="text-foot text-label-2">{t("analyticsToggleSub")}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={analyticsEnabled}
              aria-label={t("analyticsToggleTitle")}
              onClick={() => updateUiPrefs({ analyticsEnabled: !analyticsEnabled })}
              className={
                analyticsEnabled
                  ? "h-7 w-12 shrink-0 rounded-pill bg-tint p-0.5"
                  : "h-7 w-12 shrink-0 rounded-pill bg-fill p-0.5"
              }
            >
              <span
                className={
                  analyticsEnabled ? "ms-auto block h-6 w-6 rounded-pill bg-cell" : "block h-6 w-6 rounded-pill bg-cell"
                }
              />
            </button>
          </div>
        </Group>
      </Section>

      <Section title={t("toolsSection")}>
        <Group>
          <Row title={t("monthReport")} sub={lang === "en" ? "6-month trends & PDF / Excel / PNG" : "مقارنة 6 أشهر وتصدير PDF / Excel / PNG"} chevron onClick={openReport} />
          <Row title={lang === "en" ? "Wallets & Transfers" : "المحافظ والتحويل"} chevron onClick={openWallets} />
          <Row title={lang === "en" ? "Savings Goals" : "أهداف الادخار"} chevron onClick={openGoals} />
          <Row title={lang === "en" ? "Recurring Entries" : "حركات متكررة"} chevron onClick={openRecurring} />
          <Row title={lang === "en" ? "Notifications & Tasks" : "الإشعارات والمهام"} sub={lang === "en" ? "Debt & bill reminders" : "تذكيرات الديون والفواتير"} chevron onClick={openNotifications} />
          <Row
            title={t("importCsv")}
            sub={t("importCsvSub")}
            leading={
              <span className="icon-tile" style={{ background: "var(--orange)" }}>
                <FileSpreadsheet size={16} />
              </span>
            }
            chevron
            onClick={() => openSheet({ kind: "csv-import" })}
          />
          <Row
            title={lang === "en" ? "Google Drive Sync" : "مزامنة Google Drive"}
            sub={lang === "en" ? "Encrypted private copy in appDataFolder" : "نسخة خاصة مشفّرة في appDataFolder"}
            leading={
              <span className="icon-tile" style={{ background: "var(--tint)" }}>
                <Cloud size={16} />
              </span>
            }
            chevron
            onClick={openDrive}
          />
          <Row
            title={lang === "en" ? "Security & Privacy" : "الأمان والخصوصية"}
            sub={
              pinHash
                ? lang === "en"
                  ? "PIN Active · Biometrics · Masking"
                  : "القفل مفعّل · البصمة · إخفاء الأرقام"
                : lang === "en"
                  ? "PIN · Biometrics · Masking · Secure Wipe"
                  : "رمز PIN · البصمة · إخفاء الأرقام · المسح الآمن"
            }
            leading={
              <span className="icon-tile" style={{ background: "var(--green)" }}>
                <Shield size={16} />
              </span>
            }
            chevron
            onClick={openSecurity}
          />
          <Row
            title={t("quickSplit")}
            sub={lang === "en" ? "Your share as expense, theirs as receivable debt" : "حصتك مصروف وحصصهم دين لك"}
            chevron
            onClick={() => openSheet({ kind: "split" })}
          />
        </Group>
      </Section>

      <Section
        title={t("currencySection")}
        footer={
          lang === "en"
            ? "Existing transactions keep their frozen currency & rate. Country code formats local WhatsApp links."
            : "تغيير العملة لا يغيّر أسعار المعاملات المجمّدة مسبقاً. كود الدولة يُستخدم لتنسيق روابط واتساب المحلية."
        }
      >
        <Group>
          {CURRENCIES.map((c) => (
            <Row
              key={c}
              title={currencyName(c)}
              sub={currencySymbol(c, lang)}
              onClick={() => setCurrency(c)}
              trailing={c === currency ? <span className="text-tint">✓</span> : null}
            />
          ))}
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="flex-1 text-body">{lang === "en" ? "WhatsApp Country Code" : "كود دولة واتساب"}</span>
            <input
              className="field num w-24 text-end"
              dir="ltr"
              inputMode="numeric"
              value={ccText}
              placeholder={fallbackCountryCode}
              aria-label={lang === "en" ? "WhatsApp Country Code" : "كود دولة واتساب"}
              onChange={(e) => setCcText(toLatinDigits(e.target.value).replace(/\D/g, "").slice(0, 4))}
              onBlur={() => setPhoneCountryCode(ccText)}
            />
          </label>
        </Group>
      </Section>

      <Section title={t("exchangeRatesSection")} footer={t("exchangeRatesFooter")}>
        <Group>
          {CURRENCIES.filter((c) => c !== currency).map((c) => {
            const rate = effectiveExchangeRate(c, currency, exchangeRates);
            return (
              <label key={`${currency}-${c}`} className="flex min-h-11 items-center gap-3 px-4">
                <span className="flex-1 text-body">
                  1 {c} = ? {currency}
                </span>
                <input
                  className="field num w-28 text-end"
                  dir="ltr"
                  inputMode="decimal"
                  defaultValue={String(rate)}
                  aria-label={`${c} rate`}
                  onBlur={(e) => {
                    const n = Number(toLatinDigits(e.target.value));
                    if (Number.isFinite(n) && n > 0) {
                      setExchangeRate(c, n);
                    }
                  }}
                />
              </label>
            );
          })}
        </Group>
      </Section>

      <Section
        title={lang === "en" ? "Cash Opening Balance" : "افتتاحي الكاش"}
        footer={
          lang === "en"
            ? "Cash balance before your first transaction. Other wallets are edited in Wallets."
            : "رصيد الكاش قبل أول حركة. باقي المحافظ تُعدَّل من شاشة المحافظ."
        }
      >
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="text-body">{lang === "en" ? "Amount" : "المبلغ"}</span>
            <input
              className="field num text-end"
              dir="ltr"
              inputMode="decimal"
              value={openText}
              onChange={(e) => setOpenText(toLatinDigits(e.target.value).replace(/[^\d.]/g, ""))}
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

      <Section
        title={lang === "en" ? "Expense Budgets" : "ميزانيات المصروف"}
        footer={
          lang === "en"
            ? "Zero means no limit. Suggestions use your 3-month average."
            : "صفر يعني بدون حد لهذا الشهر. تظهر اقتراحات مبنية على متوسط آخر 3 أشهر."
        }
      >
        <Group>
          {expenseCats.map((c) => {
            const limit = budgets.find((b) => b.categoryId === c.id)?.limit ?? 0;
            const suggested = suggestCategoryBudget(c.id, data.txns, month, 3, currency, exchangeRates);
            return (
              <div key={`${c.id}-${limit}`} className="flex min-h-11 items-center gap-3 px-4 py-2">
                <IconTile name={c.icon} tone={c.tone} />
                <div className="min-w-0 flex-1">
                  <p className="text-body">{catName(c)}</p>
                  {suggested > 0 && limit === 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setBudget(c.id, suggested);
                        toast(
                          lang === "en"
                            ? `Budget for ${catName(c)} set to ${suggested}`
                            : `ضُبطت ميزانية ${catName(c)} على ${suggested}`,
                        );
                      }}
                      className="text-caption font-semibold text-tint"
                    >
                      {lang === "en" ? `Suggested: ${formatNumber(suggested, numeralStyle, lang)}` : `اقتراح: ${formatNumber(suggested, numeralStyle, lang)}`}
                    </button>
                  ) : null}
                </div>
                <input
                  className="field num w-24 text-end"
                  dir="ltr"
                  inputMode="decimal"
                  defaultValue={limit ? String(limit) : ""}
                  placeholder={suggested ? String(suggested) : "0"}
                  aria-label={`${lang === "en" ? "Budget" : "ميزانية"} ${catName(c)}`}
                  onBlur={(e) => {
                    const n = Number(toLatinDigits(e.target.value));
                    setBudget(c.id, Number.isFinite(n) ? Math.max(0, n) : 0);
                  }}
                />
              </div>
            );
          })}
        </Group>
      </Section>

      <Section title={lang === "en" ? "New Category" : "فئة جديدة"}>
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
          <div className="px-3 py-3">
            <Segment
              value={kind}
              onChange={setKind}
              options={[
                { id: "expense", label: t("expenseSingular") },
                { id: "income", label: t("incomeSingular") },
              ]}
            />
          </div>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <input
              className="field"
              value={name}
              placeholder={lang === "en" ? "Category name" : "اسم الفئة"}
              onChange={(e) => setName(e.target.value)}
            />
            <PillButton
              onClick={() => {
                const id = addCategory(name, kind);
                if (!id) toast(lang === "en" ? "Enter a name" : "اكتب اسماً");
                else {
                  setName("");
                  toast(lang === "en" ? "Category added" : "أضيفت الفئة");
                }
              }}
            >
              {lang === "en" ? "Add" : "أضف"}
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
                  sub={c.kind === "income" ? t("incomeSingular") : t("expenseSingular")}
                  onClick={() => {
                    if (!removeCategory(c.id)) {
                      toast(lang === "en" ? "Category is used in transactions or recurring items" : "الفئة مستخدمة في حركات أو تكرار");
                      return;
                    }
                    toast(lang === "en" ? "Category deleted" : "حُذفت الفئة");
                  }}
                  trailing={<span className="text-foot text-expense">{lang === "en" ? "Delete" : "حذف"}</span>}
                />
              ))}
          </Group>
        </div>
      </Section>

      <Section title={lang === "en" ? "Backup, Import & Export" : "نسخة احتياطية واستيراد وتصدير"}>
        <Group>
          <Row title={lang === "en" ? "Export JSON" : "تصدير JSON"} sub={lang === "en" ? "Lightweight ledger backup" : "نسخة خفيفة للبيانات"} chevron onClick={() => exportData()} />
          <Row
            title={lang === "en" ? "Export JSON with Receipts" : "تصدير JSON مع الإيصالات"}
            sub={lang === "en" ? "Includes saved receipt images" : "يشمل صور الإيصالات المحفوظة"}
            chevron
            onClick={() => {
              void exportDataAsync({ includeReceipts: true }).then(() =>
                toast(lang === "en" ? "Full backup exported" : "تم تصدير النسخة الكاملة"),
              );
            }}
          />
          <Row
            title={lang === "en" ? "Export AES-GCM Encrypted Backup" : "تصدير نسخة مشفّرة AES-GCM"}
            sub={lang === "en" ? "Protected with passphrase before saving" : "محمية بكلمة مرور قبل المشاركة أو الحفظ"}
            chevron
            onClick={() => setShowEncInput((v) => !v)}
          />
          {showEncInput ? (
            <div className="flex items-center gap-2 px-4 py-3">
              <input
                type="password"
                className="field flex-1"
                value={encPass}
                placeholder={lang === "en" ? "Encryption passphrase" : "كلمة مرور التشفير"}
                onChange={(e) => setEncPass(e.target.value)}
              />
              <PillButton
                onClick={() => {
                  if (encPass.trim().length < 4) {
                    toast(lang === "en" ? "Use at least 4 characters" : "اكتب كلمة مرور من 4 أحرف على الأقل");
                    return;
                  }
                  void exportDataAsync({ includeReceipts: true, passphrase: encPass.trim() }).then(() => {
                    setEncPass("");
                    setShowEncInput(false);
                    toast(lang === "en" ? "Encrypted backup exported" : "تم تصدير النسخة المشفّرة");
                  });
                }}
              >
                {lang === "en" ? "Encrypt & Export" : "تشفير وتصدير"}
              </PillButton>
            </div>
          ) : null}
          <Row title={lang === "en" ? "Export CSV (Excel)" : "تصدير Excel"} sub={lang === "en" ? "Spreadsheet with currency & rates" : "ملف CSV يفتح في Excel"} chevron onClick={() => exportCsv()} />
          <Row title={t("importCsv")} sub={t("importCsvSub")} chevron onClick={() => openSheet({ kind: "csv-import" })} />
          <Row
            title={lang === "en" ? "Print / PDF Report" : "طباعة / PDF للتقرير"}
            sub={monthLabel(month, lang, numeralStyle)}
            chevron
            onClick={() => {
              exportMonthlyReportPdf(pickFinanceData(data), month, lang, numeralStyle);
              toast(lang === "en" ? "Report ready for print / PDF" : "جُهّز التقرير للطباعة / PDF");
            }}
          />
          <Row
            title={lang === "en" ? "Import JSON Backup" : "استيراد ملف"}
            sub={lang === "en" ? "Supports plain and encrypted JSON" : "يدعم JSON العادي والمشفّر"}
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
              toast(lang === "en" ? "Import complete" : "تم الاستيراد");
            } catch (err) {
              const msg = err instanceof Error ? err.message : "";
              if (msg.includes("مشفّرة") || msg.includes("كلمة مرور")) {
                const pass = window.prompt(lang === "en" ? "Enter backup passphrase:" : "أدخل كلمة مرور النسخة المشفّرة:");
                if (!pass) return;
                try {
                  await importDataAsync(text, pass);
                  toast(lang === "en" ? "Decrypted and imported" : "تم فك التشفير والاستيراد");
                } catch {
                  toast(lang === "en" ? "Incorrect passphrase or corrupted file" : "كلمة المرور غير صحيحة أو الملف تالف");
                }
              } else {
                toast(msg || (lang === "en" ? "Invalid file format" : "الملف غير مفهوم"));
              }
            }
          }}
        />
      </Section>

      <Section title={t("perfAndErrors")}>
        <Group sep="icon">
          <Row
            leading={
              <span className="icon-tile" style={{ background: "var(--gray)" }}>
                <Terminal size={16} />
              </span>
            }
            title={t("perfLastBoot")}
            sub={
              latestPerf
                ? `${formatNumber(latestPerf.firstInteractiveMs, numeralStyle, lang)} ms`
                : lang === "en"
                  ? "Recorded locally on startup"
                  : "يُسجَّل محلياً عند التشغيل"
            }
          />
          <Row
            title={t("errorLogCount")}
            sub={errorLogs.length ? `#${errorLogs[0]!.id} · ${errorLogs[0]!.name}` : t("errorLogEmpty")}
            trailing={
              errorLogs.length ? (
                <PillButton
                  tone="plain"
                  onClick={() => {
                    clearErrorLogs();
                    setErrorLogs([]);
                    toast(lang === "en" ? "Error log cleared" : "تم مسح سجل الأخطاء");
                  }}
                >
                  {t("clearErrorLog")}
                </PillButton>
              ) : (
                <span className="num text-body text-label-2">{formatNumber(0, numeralStyle, lang)}</span>
              )
            }
          />
        </Group>
      </Section>

      <Section>
        <Group>
          <Row title={lang === "en" ? "Clear All Data" : "مسح كل البيانات"} destructive onClick={() => openSheet({ kind: "reset" })} />
        </Group>
        <p className="px-8 pt-6 text-center text-foot text-label-2">
          {lang === "en" ? "Mizan · © Zyad Gamal" : "ميزان · كل الحقوق محفوظة لـ Zyad Gamal"}
        </p>
      </Section>
    </div>
  );
}
