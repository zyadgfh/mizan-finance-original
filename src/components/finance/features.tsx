import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useMizan } from "@/components/finance/context";
import { Amount, EmptyState, Group, PillButton, Row, Section } from "@/components/finance/ui";
import { cn } from "@/lib/cn";
import {
  currencySymbol,
  goalSaved,
  goalsSaved,
  monthLabel,
  shiftMonthKey,
  shortDate,
  sumKind,
  walletBalance,
} from "@/lib/finance/logic";
import { hashPin } from "@/lib/finance/pin";
import { useFinance } from "@/lib/finance/store";

const DONUT = ["var(--tint)", "var(--orange)", "var(--red)", "var(--green)", "var(--gray)"];

export function ReportScreen() {
  const { month, shiftMonth } = useMizan();
  const txns = useFinance((s) => s.txns);
  const categories = useFinance((s) => s.categories);
  const currency = useFinance((s) => s.currency);
  const prev = shiftMonthKey(month, -1);
  const income = sumKind(txns, "income", month);
  const expense = sumKind(txns, "expense", month);
  const prevIncome = sumKind(txns, "income", prev);
  const prevExpense = sumKind(txns, "expense", prev);
  const net = income - expense;
  const prevNet = prevIncome - prevExpense;
  const parts = categories
    .filter((c) => c.kind === "expense")
    .map((c) => ({
      id: c.id,
      name: c.name,
      value: sumKind(
        txns.filter((t) => t.categoryId === c.id),
        "expense",
        month,
      ),
    }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = parts.reduce((s, p) => s + p.value, 0);
  let cursor = 0;
  const stops = parts.map((p, i) => {
    const start = (cursor / (total || 1)) * 100;
    cursor += p.value;
    const end = (cursor / (total || 1)) * 100;
    return `${DONUT[i % DONUT.length]} ${start}% ${end}%`;
  });

  return (
    <div>
      <div className="px-4">
        <h1 className="text-largetitle font-bold tracking-title">التقرير</h1>
        <div className="mt-3 inline-flex items-center rounded-pill bg-fill">
          <button type="button" className="flex min-h-11 min-w-11 items-center justify-center text-label" onClick={() => shiftMonth(-1)} aria-label="الشهر السابق">
            <ChevronRight size={20} strokeWidth={2} />
          </button>
          <span className="min-w-36 text-center text-sub font-semibold">{monthLabel(month)}</span>
          <button type="button" className="flex min-h-11 min-w-11 items-center justify-center text-label" onClick={() => shiftMonth(1)} aria-label="الشهر التالي">
            <ChevronLeft size={20} strokeWidth={2} />
          </button>
        </div>
      </div>
      <Section title="مقارنة">
        <Group>
          <Row title="صافي هذا الشهر" trailing={<Amount value={net} currency={currency} sign="auto" />} />
          <Row title="الشهر السابق" trailing={<Amount value={prevNet} currency={currency} sign="auto" />} />
          <Row title="الفرق" trailing={<Amount value={net - prevNet} currency={currency} sign="auto" />} />
          <Row title="إيرادات الشهر" trailing={<Amount value={income} currency={currency} sign="plus" />} />
          <Row title="مصروف الشهر" trailing={<Amount value={expense} currency={currency} sign="minus" />} />
        </Group>
      </Section>
      <Section title="مصروف الفئات" footer="سداد الديون والتحويلات لا تدخل في هذه الدائرة.">
        {parts.length === 0 ? (
          <EmptyState title="لا مصروف" body="سجّل مصروفاً في هذا الشهر ليظهر التوزيع." />
        ) : (
          <>
            <div className="flex justify-center px-4">
              <div className="relative h-40 w-40 rounded-pill" style={{ background: `conic-gradient(${stops.join(", ")})` }}>
                <div className="absolute inset-4 flex items-center justify-center rounded-pill bg-grouped text-center">
                  <span className="text-foot text-label-2">{Math.round(total)} {currencySymbol(currency)}</span>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <Group>
                {parts.map((p, i) => (
                  <Row
                    key={p.id}
                    title={p.name}
                    leading={<span className="mt-1 inline-block h-3 w-3 rounded-pill" style={{ background: DONUT[i % DONUT.length] }} />}
                    trailing={<Amount value={p.value} currency={currency} />}
                    sub={`${Math.round((p.value / total) * 100)}٪`}
                  />
                ))}
              </Group>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

export function GoalsScreen() {
  const { openGoal, openSheet } = useMizan();
  const goals = useFinance((s) => s.goals);
  const moves = useFinance((s) => s.goalMoves);
  const currency = useFinance((s) => s.currency);

  return (
    <div>
      <div className="flex items-end justify-between px-4">
        <div>
          <h1 className="text-largetitle font-bold tracking-title">الأهداف</h1>
          <p className="mt-1 text-sub text-label-2">المدّخر يخرج من المحفظة ويبقى لك.</p>
        </div>
      </div>
      <div className="mt-4 px-4">
        <PillButton onClick={() => openSheet({ kind: "goal" })}>هدف جديد</PillButton>
      </div>
      {goals.length === 0 ? (
        <EmptyState title="لا أهداف" body="حدّد مبلغاً وموعداً، ثم أضف إليه من أي محفظة." />
      ) : (
        <Section title={`المدّخر ${Math.round(goalsSaved(moves))}`}>
          <Group>
            {goals.map((g) => {
              const saved = goalSaved(g.id, moves);
              const pct = g.target > 0 ? Math.min(100, Math.round((saved / g.target) * 100)) : 0;
              return (
                <div key={g.id}>
                  <Row
                    title={g.name}
                    sub={g.deadline ? `حتى ${shortDate(g.deadline)}` : "بدون موعد"}
                    chevron
                    onClick={() => openGoal(g.id)}
                    trailing={<Amount value={saved} currency={currency} />}
                  />
                  <div className="px-4 pb-3">
                    <div className="h-1 overflow-hidden rounded-pill bg-fill">
                      <div className="h-full bg-tint" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-caption text-label-2" dir="ltr">
                      {Math.round(saved)} / {Math.round(g.target)} · {pct}%
                    </p>
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
  const { openSheet } = useMizan();
  const goal = useFinance((s) => s.goals.find((g) => g.id === id));
  const moves = useFinance((s) => s.goalMoves);
  const wallets = useFinance((s) => s.wallets);
  const currency = useFinance((s) => s.currency);
  const removeGoalMove = useFinance((s) => s.removeGoalMove);
  const restoreGoalMove = useFinance((s) => s.restoreGoalMove);
  if (!goal) return <EmptyState title="غير موجود" body="هذا الهدف لم يعد في الدفتر." />;
  const saved = goalSaved(goal.id, moves);
  const pct = goal.target > 0 ? Math.min(100, Math.round((saved / goal.target) * 100)) : 0;
  const left = Math.max(0, goal.target - saved);
  const rows = moves.filter((m) => m.goalId === goal.id).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      <div className="px-4">
        <h1 className="text-title1 font-bold tracking-title">{goal.name}</h1>
        <p className="mt-4 text-sub text-label-2">المدّخر</p>
        <p className="text-largetitle font-bold tracking-title">
          <Amount value={saved} currency={currency} />
        </p>
        <div className="mt-3 h-1 overflow-hidden rounded-pill bg-fill">
          <div className="h-full bg-tint" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-foot text-label-2">
          متبقٍ {Math.round(left)} {currencySymbol(currency)}
          {goal.deadline ? ` · حتى ${shortDate(goal.deadline)}` : ""}
        </p>
      </div>
      <div className="mt-4 flex gap-2 px-4">
        <PillButton onClick={() => openSheet({ kind: "goal-move", goalId: goal.id })}>أضف</PillButton>
        <PillButton tone="gray" onClick={() => openSheet({ kind: "goal-move", goalId: goal.id, withdraw: true })}>
          اسحب
        </PillButton>
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
  const data = useFinance();
  const removeTransfer = useFinance((s) => s.removeTransfer);
  const restoreTransfer = useFinance((s) => s.restoreTransfer);

  return (
    <div>
      <div className="px-4">
        <h1 className="text-largetitle font-bold tracking-title">المحافظ</h1>
        <p className="mt-1 text-sub text-label-2">
          المجموع <Amount value={data.wallets.reduce((s, w) => s + walletBalance(w.id, data), 0)} currency={data.currency} sign="auto" />
        </p>
      </div>
      <div className="mt-4 flex gap-2 px-4">
        <PillButton onClick={() => openSheet({ kind: "transfer" })}>تحويل</PillButton>
        <PillButton tone="gray" onClick={() => openSheet({ kind: "wallet" })}>
          محفظة
        </PillButton>
      </div>
      <Section title="الأرصدة">
        <Group>
          {data.wallets.map((w) => (
            <Row
              key={w.id}
              title={w.name}
              sub={w.kind === "cash" ? "كاش" : w.kind === "instapay" ? "إنستاباي" : w.kind === "vodafone" ? "فودافون كاش" : w.kind === "bank" ? "بنك" : "أخرى"}
              chevron
              onClick={() => openSheet({ kind: "wallet", id: w.id })}
              trailing={<Amount value={walletBalance(w.id, data)} currency={data.currency} sign="auto" />}
            />
          ))}
        </Group>
      </Section>
      <Section title="التحويلات">
        {data.transfers.length === 0 ? (
          <p className="px-8 text-sub text-label-2">لا تحويلات بعد.</p>
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
                    toast("حُذف التحويل", { action: { label: "تراجع", onClick: () => restoreTransfer(snapshot) } });
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
      <div className="px-4">
        <h1 className="text-largetitle font-bold tracking-title">المتكرر</h1>
        <p className="mt-1 text-sub text-label-2">يظهر كل شهر للتأكيد، ولا يُسجَّل وحده.</p>
      </div>
      <div className="mt-4 px-4">
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

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { pinHash } = useMizan();
  const [digits, setDigits] = useState("");
  const [error, setError] = useState(false);

  async function press(key: string) {
    if (!key) return;
    if (key === "del") {
      setError(false);
      setDigits((d) => d.slice(0, -1));
      return;
    }
    const next = `${digits}${key}`.slice(0, 4);
    setDigits(next);
    setError(false);
    if (next.length < 4 || !pinHash) return;
    const hashed = await hashPin(next);
    if (hashed === pinHash) onUnlock();
    else {
      setError(true);
      setDigits("");
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 pb-10">
      <h1 className="text-title2 font-semibold">أدخل الرمز</h1>
      <p className={cn("mt-2 text-sub", error ? "text-expense" : "text-label-2")}>{error ? "رمز غير صحيح" : "ميزان مقفل على هذا الجهاز"}</p>
      <div className="mt-6 flex gap-3" dir="ltr">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-3 w-3 rounded-pill", digits.length > i ? "bg-label" : "bg-fill")} />
        ))}
      </div>
      <div className="mt-10 grid w-full max-w-xs grid-cols-3 gap-3" dir="ltr">
        {PAD.map((key) =>
          key === "" ? (
            <span key="empty" />
          ) : (
            <button
              key={key}
              type="button"
              className="flex h-16 items-center justify-center rounded-pill bg-fill text-title2 font-medium text-label active:opacity-70"
              onClick={() => void press(key)}
              aria-label={key === "del" ? "حذف" : key}
            >
              {key === "del" ? "⌫" : key}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
