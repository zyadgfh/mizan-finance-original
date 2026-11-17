import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileJson,
  FileSpreadsheet,
  Fingerprint,
  Image as ImageIcon,
  Palette,
  Pencil,
  Plus,
  Printer,
} from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppleWalletCard, walletKindLabelText } from "@/components/finance/apple-cards";
import { useMizan } from "@/components/finance/context";
import { AnimatedBar } from "@/components/finance/gsap-motion";
import { usePinShake } from "@/components/finance/motion-utils";
import { Amount, EmptyState, Group, PersonName, PillButton, Row, Section } from "@/components/finance/ui";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/finance/i18n";
import {
  currencySymbol,
  estimateGoalEta,
  formatNumber,
  formatPercent,
  GOAL_CATEGORY_LABEL,
  goalsSaved,
  monthLabel,
  reportMetrics,
  shortDate,
  walletBalance,
} from "@/lib/finance/logic";
import { pinLockoutRemainingMs, recordPinFailure, verifyPin, writePinHash } from "@/lib/finance/pin";
import {
  exportMonthlyReportCsv,
  exportMonthlyReportJson,
  exportMonthlyReportPdf,
  shareMonthlyReportImage,
} from "@/lib/finance/report-export";
import { useSecuritySettings, verifyBiometricCredential } from "@/lib/finance/security";
import { pickFinanceData, useFinance } from "@/lib/finance/store";

const DONUT = ["var(--tint)", "var(--orange)", "var(--red)", "var(--green)", "var(--gray)"];

export function ReportScreen() {
  const { month, shiftMonth, openPerson, openDebt } = useMizan();
  const data = useFinance();
  const { lang, numeralStyle, analyticsEnabled, isRtl, dir, t, catName } = useI18n();
  const [sharingImg, setSharingImg] = useState(false);
  const [redactSharedDetails, setRedactSharedDetails] = useState(true);
  const reportPrivacy = { redactSensitiveDetails: redactSharedDetails };
  const report = reportMetrics(data, month, lang, numeralStyle);
  const parts = report.categories;
  const total = parts.reduce((s, p) => s + p.value, 0);
  let cursor = 0;
  const stops = parts.map((p, i) => {
    const start = (cursor / (total || 1)) * 100;
    cursor += p.value;
    const end = (cursor / (total || 1)) * 100;
    return `${DONUT[i % DONUT.length]} ${start}% ${end}%`;
  });
  const hasTrend = report.monthlyTrend.some((m) => m.income > 0 || m.expense > 0);
  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;
  const snapshot = pickFinanceData(data);

  return (
    <div>
      <div data-stagger className="px-4">
        <h1 className="text-largetitle font-bold tracking-title">{t("monthReport")}</h1>
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
      </div>

      <Section title={lang === "en" ? "Export & Share" : "التصدير والمشاركة"}>
        <label className="mx-4 mb-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-cell bg-fill px-4 text-sub">
          <input
            type="checkbox"
            checked={redactSharedDetails}
            onChange={(event) => setRedactSharedDetails(event.target.checked)}
            className="h-4 w-4 accent-[var(--tint)]"
          />
          <span>
            {lang === "en"
              ? "Redact people names, phone numbers, and descriptions in exports"
              : "إخفاء أسماء الأشخاص وأرقامهم وأوصاف الديون في الملفات المشاركة"}
          </span>
        </label>
        <div className="grid grid-cols-2 gap-2 px-4">
          <PillButton
            tone="tint"
            disabled={sharingImg}
            onClick={() => {
              setSharingImg(true);
              void shareMonthlyReportImage(snapshot, month, lang, numeralStyle, reportPrivacy)
                .then(() =>
                  toast.success(
                    lang === "en" ? "Ready to share or save as PNG" : "جاهز للمشاركة أو الحفظ كصورة PNG",
                  ),
                )
                .catch(() =>
                  toast.error(lang === "en" ? "Failed to generate report image" : "تعذّر إنشاء صورة التقرير"),
                )
                .finally(() => setSharingImg(false));
            }}
          >
            <ImageIcon size={15} />
            <span>
              {sharingImg
                ? lang === "en"
                  ? "Preparing…"
                  : "جارٍ التجهيز…"
                : lang === "en"
                  ? "Share PNG"
                  : "مشاركة كصورة"}
            </span>
          </PillButton>
          <PillButton
            tone="gray"
            onClick={() => {
              const mode = exportMonthlyReportPdf(snapshot, month, lang, numeralStyle, reportPrivacy);
              toast(
                mode === "printed"
                  ? lang === "en"
                    ? "Opened Print / PDF dialog"
                    : "فُتحت نافذة الطباعة / PDF"
                  : lang === "en"
                    ? "Printable HTML report exported"
                    : "تم تصدير التقرير القابل للطباعة",
              );
            }}
          >
            <Printer size={15} />
            <span>{lang === "en" ? "PDF / Print" : "PDF / طباعة"}</span>
          </PillButton>
          <PillButton
            tone="gray"
            onClick={() => {
              exportMonthlyReportCsv(snapshot, month, lang, numeralStyle, reportPrivacy);
              toast.success(lang === "en" ? "Excel (CSV) report exported" : "تم تصدير تقرير Excel (CSV)");
            }}
          >
            <FileSpreadsheet size={15} />
            <span>Excel (CSV)</span>
          </PillButton>
          <PillButton
            tone="gray"
            onClick={() => {
              exportMonthlyReportJson(snapshot, month, lang, numeralStyle, reportPrivacy);
              toast.success(lang === "en" ? "JSON report exported" : "تم تصدير التقرير بصيغة JSON");
            }}
          >
            <FileJson size={15} />
            <span>{lang === "en" ? "JSON File" : "ملف JSON"}</span>
          </PillButton>
        </div>
      </Section>

      <Section title={lang === "en" ? "Summary & Net Change" : "الملخص وصافي التغير"}>
        <Group>
          <Row title={t("income")} trailing={<Amount value={report.income} currency={data.currency} sign="plus" />} />
          <Row title={t("expense")} trailing={<Amount value={report.expense} currency={data.currency} sign="minus" />} />
          <Row title={t("netThisMonth")} trailing={<Amount value={report.net} currency={data.currency} sign="auto" />} />
          <Row title={lang === "en" ? "Prior Month" : "الشهر السابق"} trailing={<Amount value={report.prevNet} currency={data.currency} sign="auto" />} />
          <Row title={lang === "en" ? "Change vs Prior" : "الفرق عن السابق"} trailing={<Amount value={report.net - report.prevNet} currency={data.currency} sign="auto" />} />
          <Row title={t("cashBalance")} trailing={<Amount value={report.cashBalance} currency={data.currency} sign="auto" />} />
          {analyticsEnabled ? (
            <>
              <Row title={t("analyticsDailyAvg")} trailing={<Amount value={report.analytics.dailyAverageExpense} currency={data.currency} />} />
              <Row title={t("analyticsProjected")} trailing={<Amount value={report.analytics.projectedMonthEndExpense} currency={data.currency} sign="minus" />} />
            </>
          ) : null}
        </Group>
      </Section>

      <Section title={lang === "en" ? "Last 6 Months Comparison" : "مقارنة آخر 6 أشهر"}>
        <div className="surface-card mx-4 rounded-cell px-3 py-3">
          {hasTrend ? (
            <div className="h-44" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.monthlyTrend} barGap={2} barCategoryGap="24%">
                  <XAxis
                    dataKey="label"
                    reversed={isRtl}
                    tick={{ fontSize: 11, fill: "var(--label-2)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    orientation={isRtl ? "right" : "left"}
                    width={44}
                    tick={{ fontSize: 10, fill: "var(--label-3)" }}
                    tickFormatter={(v) => formatNumber(Number(v), numeralStyle, lang)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div dir={dir} className="surface-card rounded-cell px-3 py-2 text-caption">
                          <p className="text-label-2">{label}</p>
                          {payload.map((p) => (
                            <p key={p.name}>
                              {p.name}: <Amount value={Number(p.value ?? 0)} currency={data.currency} />
                            </p>
                          ))}
                        </div>
                      ) : null
                    }
                    cursor={{ fill: "var(--fill)" }}
                  />
                  <Bar dataKey="income" name={t("income")} fill="var(--green)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="expense" name={t("expense")} fill="var(--red)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-6 text-center text-sub text-label-2">
              {lang === "en" ? "Record transactions to see monthly trends" : "سجّل حركات لتظهر المقارنة بين الأشهر"}
            </p>
          )}
        </div>
      </Section>

      <Section
        title={lang === "en" ? "Top Spending Categories" : "أعلى التصنيفات إنفاقاً"}
        footer={lang === "en" ? "Debt repayments and transfers are excluded from spending breakdown." : "سداد الديون والتحويلات لا تدخل في هذه الدائرة."}
      >
        {parts.length === 0 ? (
          <EmptyState
            title={lang === "en" ? "No Expenses" : "لا مصروف"}
            body={lang === "en" ? "Record an expense in this month to view category distribution." : "سجّل مصروفاً في هذا الشهر ليظهر التوزيع."}
          />
        ) : (
          <>
            <div className="flex justify-center px-4">
              <div className="surface-card relative h-40 w-40 rounded-pill" style={{ background: `conic-gradient(${stops.join(", ")})` }}>
                <div className="absolute inset-4 flex items-center justify-center rounded-pill bg-grouped text-center">
                  <span className="num text-foot font-medium text-label-2">
                    {formatNumber(Math.round(total), numeralStyle, lang)} {currencySymbol(data.currency, lang)}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <Group>
                {parts.map((p, i) => {
                  const diff = p.value - p.prevValue;
                  const catObj = data.categories.find((c) => c.id === p.id);
                  return (
                    <Row
                      key={p.id}
                      title={catObj ? catName(catObj) : p.name}
                      leading={<span className="mt-1 inline-block h-3 w-3 rounded-pill" style={{ background: DONUT[i % DONUT.length] }} />}
                      trailing={<Amount value={p.value} currency={data.currency} />}
                      sub={`${formatPercent(Math.round((p.value / total) * 100), numeralStyle, lang)}${
                        p.prevValue > 0
                          ? ` · ${diff >= 0 ? "+" : "−"}${formatNumber(Math.round(Math.abs(diff)), numeralStyle, lang)} ${lang === "en" ? "vs prior" : "عن السابق"}`
                          : ""
                      }`}
                    />
                  );
                })}
              </Group>
            </div>
          </>
        )}
      </Section>

      <Section title={lang === "en" ? "Top People by Debt Exposure" : "أكثر الأشخاص ارتباطاً بالديون"}>
        {report.debtPeople.length === 0 ? (
          <p className="px-8 text-sub text-label-2">{lang === "en" ? "No active debts." : "لا ديون نشطة حالياً."}</p>
        ) : (
          <Group>
            {report.debtPeople.map((row) => (
              <Row
                key={row.person.id}
                title={<PersonName name={row.person.name} />}
                sub={`${formatNumber(row.activeCount, numeralStyle, lang)} ${lang === "en" ? "active" : "دين نشط"} · ${t("receivable")} ${formatNumber(Math.round(row.receivable), numeralStyle, lang)} · ${t("payable")} ${formatNumber(Math.round(row.payable), numeralStyle, lang)}`}
                trailing={<Amount value={row.net} currency={data.currency} sign="auto" />}
                chevron
                onClick={() => openPerson(row.person.id)}
              />
            ))}
          </Group>
        )}
      </Section>

      <Section title={lang === "en" ? "Upcoming Bills & Installments" : "الفواتير والاستحقاقات القادمة"}>
        {report.upcomingBills.length === 0 ? (
          <p className="px-8 text-sub text-label-2">
            {lang === "en" ? "No upcoming bills or installments in the next 30 days." : "لا توجد فواتير أو أقساط قادمة خلال 30 يوماً."}
          </p>
        ) : (
          <Group>
            {report.upcomingBills.map((b) => (
              <Row
                key={`${b.kind}-${b.id}`}
                title={b.title}
                sub={
                  <>
                    {b.kind === "recurring"
                      ? lang === "en"
                        ? "Recurring Bill"
                        : "فاتورة متكررة"
                      : b.personName
                        ? <PersonName name={b.personName} />
                        : lang === "en"
                          ? "Debt"
                          : "دين"}{" "}
                    · {shortDate(b.due, lang, numeralStyle)}
                  </>
                }
                trailing={<Amount value={b.amount} currency={data.currency} sign={b.direction === "receivable" ? "plus" : "minus"} />}
                chevron={b.kind === "debt"}
                onClick={b.kind === "debt" ? () => openDebt(b.id) : undefined}
              />
            ))}
          </Group>
        )}
      </Section>
      <div className="mt-4 flex justify-center px-4">
        <span className="inline-flex items-center gap-1.5 text-caption text-label-2">
          <Download size={13} />
          <span>{lang === "en" ? "All reports are generated locally without uploading any data" : "جميع التقارير تُنشأ محلياً دون رفع أي بيانات"}</span>
        </span>
      </div>
    </div>
  );
}

export function GoalsScreen() {
  const { openGoal, openSheet } = useMizan();
  const goals = useFinance((s) => s.goals);
  const moves = useFinance((s) => s.goalMoves);
  const txns = useFinance((s) => s.txns);
  const currency = useFinance((s) => s.currency);

  return (
    <div>
      <div data-stagger className="flex items-end justify-between px-4">
        <div>
          <h1 className="text-largetitle font-bold tracking-title">الأهداف</h1>
          <p className="mt-1 text-sub text-label-2">المدّخر يخرج من المحفظة ويبقى لك.</p>
        </div>
      </div>
      <div data-stagger className="mt-4 px-4">
        <PillButton onClick={() => openSheet({ kind: "goal" })}>هدف جديد</PillButton>
      </div>
      {goals.length === 0 ? (
        <EmptyState title="لا أهداف" body="أنشئ هدفاً للسفر أو سداد دين أو شراء جهاز أو صندوق طوارئ." />
      ) : (
        <Section title={`المدّخر ${Math.round(goalsSaved(moves))}`}>
          <Group>
            {goals.map((g) => {
              const eta = estimateGoalEta(g, moves, txns);
              const catLabel = GOAL_CATEGORY_LABEL[g.category ?? "general"];
              const etaTxt =
                eta.status === "done"
                  ? "اكتمل الهدف ✓"
                  : eta.estimatedMonths !== null
                    ? `متوقع خلال ~${eta.estimatedMonths} ${eta.estimatedMonths === 1 ? "شهر" : "أشهر"}`
                    : "أضف أول ادخار لحساب المدة المتوقعة";
              return (
                <div key={g.id}>
                  <Row
                    title={g.name}
                    sub={`${catLabel}${g.deadline ? ` · حتى ${shortDate(g.deadline)}` : ""}`}
                    chevron
                    onClick={() => openGoal(g.id)}
                    trailing={<Amount value={eta.saved} currency={currency} />}
                  />
                  <div className="px-4 pb-3">
                    <AnimatedBar pct={eta.pct} colorClass={eta.status === "done" ? "bg-income" : "bg-tint"} />
                    <div className="mt-1 flex items-center justify-between text-caption text-label-2">
                      <span className="num" dir="ltr">
                        {Math.round(eta.saved)} / {Math.round(g.target)} · {eta.pct}%
                      </span>
                      <span className={eta.status === "behind" ? "text-warn" : undefined}>{etaTxt}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </Group>
        </Section>
      )}
    </div>
  );
}

export function GoalScreen({ id }: { id: string }) {
  const { openSheet, openDebt } = useMizan();
  const goal = useFinance((s) => s.goals.find((g) => g.id === id));
  const debts = useFinance((s) => s.debts);
  const moves = useFinance((s) => s.goalMoves);
  const txns = useFinance((s) => s.txns);
  const wallets = useFinance((s) => s.wallets);
  const currency = useFinance((s) => s.currency);
  const removeGoalMove = useFinance((s) => s.removeGoalMove);
  const restoreGoalMove = useFinance((s) => s.restoreGoalMove);
  if (!goal) return <EmptyState title="غير موجود" body="هذا الهدف لم يعد في الدفتر." />;
  const eta = estimateGoalEta(goal, moves, txns);
  const linkedDebt = goal.linkedDebtId ? debts.find((d) => d.id === goal.linkedDebtId) : undefined;
  const rows = moves.filter((m) => m.goalId === goal.id).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      <div data-stagger className="px-4">
        <p className="text-foot font-semibold text-tint">{GOAL_CATEGORY_LABEL[goal.category ?? "general"]}</p>
        <h1 className="text-title1 font-bold tracking-title">{goal.name}</h1>
        <p className="mt-4 text-sub text-label-2">المدّخر</p>
        <p className="text-largetitle font-bold tracking-title">
          <Amount value={eta.saved} currency={currency} />
        </p>
        <div className="mt-3">
          <AnimatedBar pct={eta.pct} colorClass={eta.status === "done" ? "bg-income" : "bg-tint"} />
        </div>
        <p className="mt-2 text-foot text-label-2">
          متبقٍ {Math.round(eta.remaining)} {currencySymbol(currency)}
          {goal.deadline ? ` · حتى ${shortDate(goal.deadline)}` : ""}
        </p>
        <div className="surface-card mt-3 rounded-cell px-3.5 py-2.5 text-foot">
          {eta.status === "done" ? (
            <span className="font-semibold text-income">تم الوصول إلى مبلغ الهدف بالكامل!</span>
          ) : eta.estimatedMonths !== null && eta.estimatedDateISO ? (
            <span className={eta.status === "behind" ? "text-warn" : "text-label-2"}>
              بمعدّل ادخار ~{Math.round(eta.monthlyPace)} {currencySymbol(currency)}/شهر، يُتوقع الوصول خلال{" "}
              <strong className="text-label">{eta.estimatedMonths} شهر</strong> ({shortDate(eta.estimatedDateISO)}).
              {eta.status === "behind" ? " المعدّل الحالي أبطأ من الموعد المحدد." : ""}
            </span>
          ) : (
            <span className="text-label-2">أضف دفعة ادخار واحدة لحساب المدة المتوقعة للوصول.</span>
          )}
        </div>
      </div>
      <div data-stagger className="mt-4 flex flex-wrap gap-2 px-4">
        <PillButton onClick={() => openSheet({ kind: "goal-move", goalId: goal.id })}>أضف</PillButton>
        <PillButton tone="gray" onClick={() => openSheet({ kind: "goal-move", goalId: goal.id, withdraw: true })}>
          اسحب
        </PillButton>
        {linkedDebt ? (
          <PillButton tone="gray" onClick={() => openDebt(linkedDebt.id)}>
            عرض الدين المرتبط
          </PillButton>
        ) : null}
      </div>
      <Section title="الحركات" footer="حذف الحركة يعيد المبلغ إلى محفظته.">
        {rows.length === 0 ? (
          <p className="px-8 text-sub text-label-2">لم يُضف شيء بعد.</p>
        ) : (
          <Group>
            {rows.map((m) => {
              const wallet = wallets.find((w) => w.id === m.walletId);
              return (
                <Row
                  key={m.id}
                  title={m.amount >= 0 ? "ادخار" : "سحب"}
                  sub={`${wallet?.name ?? "محفظة"} · ${shortDate(m.date)}${m.note ? ` · ${m.note}` : ""}`}
                  trailing={<Amount value={m.amount} currency={currency} sign="auto" />}
                  onClick={() => {
                    const snapshot = removeGoalMove(m.id);
                    if (!snapshot) return;
                    toast("حُذفت الحركة", { action: { label: "تراجع", onClick: () => restoreGoalMove(snapshot) } });
                  }}
                />
              );
            })}
          </Group>
        )}
      </Section>
    </div>
  );
}

export function WalletsScreen() {
  const { openSheet } = useMizan();
  const { lang } = useI18n();
  const data = useFinance();
  const removeTransfer = useFinance((s) => s.removeTransfer);
  const restoreTransfer = useFinance((s) => s.restoreTransfer);

  return (
    <div>
      <div data-stagger className="px-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-largetitle font-bold tracking-title">
            {lang === "en" ? "Cards & Wallets" : "البطاقات والمحافظ"}
          </h1>
          <button
            type="button"
            onClick={() => openSheet({ kind: "design" })}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-pill bg-[var(--tint-soft)] px-3.5 text-caption font-semibold text-tint active:opacity-80"
          >
            <Palette size={15} />
            <span>{lang === "en" ? "Apple Themes" : "تصميمات Apple"}</span>
          </button>
        </div>
        <p className="mt-1 text-sub text-label-2">
          {lang === "en" ? "Total " : "المجموع "}
          <Amount
            value={data.wallets.reduce((s, w) => s + walletBalance(w.id, data), 0)}
            currency={data.currency}
            sign="auto"
          />
        </p>
      </div>

      <div data-stagger className="mt-4 flex flex-wrap gap-2 px-4">
        <PillButton onClick={() => openSheet({ kind: "transfer" })}>
          {lang === "en" ? "Transfer" : "تحويل بين المحافظ"}
        </PillButton>
        <PillButton tone="gray" onClick={() => openSheet({ kind: "wallet" })}>
          <Plus size={16} />
          <span>{lang === "en" ? "Add Card / Wallet" : "بطاقة / محفظة جديدة"}</span>
        </PillButton>
      </div>

      {/* Apple Wallet Visual Card Stack */}
      <Section
        title={
          lang === "en"
            ? "Apple Wallet View — Tap 'Edit Name' on any card"
            : "بطاقات Apple Wallet — اضغط «تعديل الاسم» على أي بطاقة"
        }
      >
        <div className="grid gap-3 px-4 sm:grid-cols-2">
          {data.wallets.map((w) => (
            <AppleWalletCard
              key={w.id}
              wallet={w}
              balance={walletBalance(w.id, data)}
              currency={data.currency}
              onEdit={() => openSheet({ kind: "wallet", id: w.id })}
            />
          ))}
        </div>
      </Section>

      <Section title={lang === "en" ? "Quick Rename & Balances" : "الأرصدة وتعديل الأسماء السريع"}>
        <Group>
          {data.wallets.map((w) => (
            <Row
              key={w.id}
              title={w.name}
              sub={`${walletKindLabelText(w.kind, lang)}${w.subtitle ? ` · ${w.subtitle}` : ""}${w.last4 ? ` · •••• ${w.last4}` : ""}`}
              onClick={() => openSheet({ kind: "wallet", id: w.id })}
              trailing={
                <span className="flex items-center gap-2">
                  <Amount value={walletBalance(w.id, data)} currency={data.currency} sign="auto" />
                  <span className="inline-flex items-center gap-1 rounded-pill bg-[var(--tint-soft)] px-2.5 py-1 text-[11px] font-semibold text-tint">
                    <Pencil size={11} />
                    <span>{lang === "en" ? "Rename" : "تعديل"}</span>
                  </span>
                </span>
              }
            />
          ))}
        </Group>
      </Section>

      <Section title={lang === "en" ? "Transfers" : "التحويلات"}>
        {data.transfers.length === 0 ? (
          <p className="px-8 text-sub text-label-2">
            {lang === "en" ? "No transfers yet." : "لا تحويلات بعد."}
          </p>
        ) : (
          <Group>
            {data.transfers.map((tr) => {
              const from = data.wallets.find((w) => w.id === tr.fromId)?.name ?? "—";
              const to = data.wallets.find((w) => w.id === tr.toId)?.name ?? "—";
              return (
                <Row
                  key={tr.id}
                  title={`${from} ← ${to}`}
                  sub={`${shortDate(tr.date)}${tr.note ? ` · ${tr.note}` : ""}`}
                  trailing={<Amount value={tr.amount} currency={data.currency} />}
                  onClick={() => {
                    const snapshot = removeTransfer(tr.id);
                    if (!snapshot) return;
                    toast(lang === "en" ? "Transfer deleted" : "حُذف التحويل", {
                      action: {
                        label: lang === "en" ? "Undo" : "تراجع",
                        onClick: () => restoreTransfer(snapshot),
                      },
                    });
                  }}
                />
              );
            })}
          </Group>
        )}
      </Section>
    </div>
  );
}

export function RecurringScreen() {
  const { openSheet } = useMizan();
  const recurring = useFinance((s) => s.recurring);
  const categories = useFinance((s) => s.categories);
  const currency = useFinance((s) => s.currency);

  return (
    <div>
      <div data-stagger className="px-4">
        <h1 className="text-largetitle font-bold tracking-title">المتكرر</h1>
        <p className="mt-1 text-sub text-label-2">يظهر كل شهر للتأكيد، ولا يُسجَّل وحده.</p>
      </div>
      <div data-stagger className="mt-4 px-4">
        <PillButton onClick={() => openSheet({ kind: "recurring" })}>إضافة</PillButton>
      </div>
      {recurring.length === 0 ? (
        <EmptyState title="لا تكرار" body="أضف الراتب أو الإيجار أو اشتراكاً شهرياً." />
      ) : (
        <Section>
          <Group>
            {recurring.map((r) => {
              const cat = categories.find((c) => c.id === r.categoryId);
              return (
                <Row
                  key={r.id}
                  title={r.note || cat?.name || "متكرر"}
                  sub={`${cat?.name ?? ""} · يوم ${r.day}${r.active ? "" : " · متوقف"}`}
                  chevron
                  onClick={() => openSheet({ kind: "recurring", id: r.id })}
                  trailing={<Amount value={r.amount} currency={currency} sign={r.kind === "income" ? "plus" : "minus"} />}
                />
              );
            })}
          </Group>
        </Section>
      )}
    </div>
  );
}

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "bio", "0", "del"] as const;

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { pinHash } = useMizan();
  const security = useSecuritySettings();
  const [digits, setDigits] = useState("");
  const [error, setError] = useState(false);
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const [bioBusy, setBioBusy] = useState(false);
  const { ref: dotsRef, triggerShake } = usePinShake();
  const credentialId = security.biometricCredentialId;
  const canBio = Boolean(security.biometricEnabled && credentialId);

  async function tryBiometric() {
    if (!credentialId || bioBusy) return;
    setBioBusy(true);
    try {
      const ok = await verifyBiometricCredential(credentialId);
      if (ok) onUnlock();
    } finally {
      setBioBusy(false);
    }
  }

  // Offer the sensor as soon as the app locks, the way banking apps do. The
  // callback is held in a ref because the parent recreates it on every render;
  // depending on it directly would re-open the prompt on each parent update.
  const unlockRef = useRef(onUnlock);
  unlockRef.current = onUnlock;
  const autoPromptedRef = useRef(false);
  useEffect(() => {
    if (!canBio || !credentialId || autoPromptedRef.current) return;
    autoPromptedRef.current = true;
    const timer = setTimeout(() => {
      void verifyBiometricCredential(credentialId).then((ok) => {
        if (ok) unlockRef.current();
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [canBio, credentialId]);

  async function press(key: string) {
    if (!key) return;
    if (key === "bio") {
      await tryBiometric();
      return;
    }
    if (key === "del") {
      setError(false);
      setDigits((d) => d.slice(0, -1));
      return;
    }
    const next = `${digits}${key}`.slice(0, 4);
    setDigits(next);
    setError(false);
    if (next.length < 4 || !pinHash) return;

    const remainingMs = pinLockoutRemainingMs();
    if (remainingMs > 0) {
      setError(true);
      setDigits("");
      triggerShake();
      setLockMessage(`محاولات كثيرة — انتظر ${Math.ceil(remainingMs / 1000)} ثانية`);
      return;
    }

    const result = await verifyPin(next, pinHash);
    if (result.ok) {
      // Transparently upgrade legacy SHA-256 records to the salted KDF.
      if (result.upgraded) writePinHash(result.upgraded);
      setLockMessage(null);
      onUnlock();
    } else {
      const delayMs = recordPinFailure();
      setError(true);
      setDigits("");
      triggerShake();
      setLockMessage(delayMs > 0 ? `محاولات كثيرة — انتظر ${Math.ceil(delayMs / 1000)} ثانية` : null);
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 pb-10">
      <h1 className="text-title2 font-semibold">أدخل الرمز</h1>
      <p className={cn("mt-2 text-sub", error ? "text-expense" : "text-label-2")}>{lockMessage ?? (error ? "رمز غير صحيح" : "ميزان مقفل على هذا الجهاز")}</p>
      <div ref={dotsRef} className="mt-6 flex gap-3.5" dir="ltr">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-3.5 w-3.5 rounded-pill transition-transform duration-150",
              digits.length > i ? "scale-110 bg-label" : error ? "bg-expense/35" : "bg-fill",
            )}
          />
        ))}
      </div>
      <div className="mt-10 grid w-full max-w-xs grid-cols-3 gap-3" dir="ltr">
        {PAD.map((key) =>
          key === "bio" && !canBio ? (
            <span key="empty" />
          ) : (
            <button
              key={key}
              type="button"
              disabled={key === "bio" && bioBusy}
              className={cn(
                "flex h-16 items-center justify-center rounded-pill text-title2 font-medium active:scale-95 active:opacity-75",
                key === "bio" ? "bg-tint/15 text-tint" : "bg-fill text-label",
              )}
              onClick={() => void press(key)}
              aria-label={key === "del" ? "حذف" : key === "bio" ? "فتح بالبصمة" : key}
            >
              {key === "del" ? "⌫" : key === "bio" ? <Fingerprint size={24} /> : key}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
