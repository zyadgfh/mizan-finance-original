import { useState } from "react";
import { toast } from "sonner";
import { useMizan } from "@/components/finance/context";
import { PillButton, Section, Segment, Sheet } from "@/components/finance/ui";
import { cn } from "@/lib/cn";
import { goalSaved, round2, todayISO, walletBalance } from "@/lib/finance/logic";
import { hashPin } from "@/lib/finance/pin";
import { useFinance } from "@/lib/finance/store";
import type { TxKind, WalletKind } from "@/lib/finance/types";

function parseAmount(raw: string) {
  const n = Number(raw.replace(",", ".").trim());
  return Number.isFinite(n) ? round2(n) : NaN;
}

function AmountField({ value, onChange, label = "المبلغ" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="block px-4 pt-2 text-center">
      <span className="text-foot text-label-2">{label}</span>
      <input
        className="amount-input"
        inputMode="decimal"
        dir="ltr"
        placeholder="0"
        value={value}
        aria-label={label}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, "");
          if ((v.match(/\./g) ?? []).length > 1) return;
          onChange(v);
        }}
      />
    </label>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("h-7 w-12 shrink-0 rounded-pill p-0.5", on ? "bg-tint" : "bg-fill")}
    >
      <span className={cn("block h-6 w-6 rounded-pill bg-cell", on && "ms-auto")} />
    </button>
  );
}

const KINDS: { id: WalletKind; label: string }[] = [
  { id: "cash", label: "كاش" },
  { id: "instapay", label: "إنستاباي" },
  { id: "vodafone", label: "فودافون" },
  { id: "bank", label: "بنك" },
  { id: "other", label: "أخرى" },
];

export function TransferForm() {
  const { closeSheet, frame } = useMizan();
  const wallets = useFinance((s) => s.wallets);
  const data = useFinance();
  const addTransfer = useFinance((s) => s.addTransfer);
  const [fromId, setFromId] = useState(wallets[0]?.id ?? "w-cash");
  const [toId, setToId] = useState(wallets[1]?.id ?? wallets[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");

  function save() {
    const n = parseAmount(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast("اكتب مبلغ التحويل");
      return;
    }
    if (fromId === toId) {
      toast("اختر محفظتين مختلفتين");
      return;
    }
    if (n - walletBalance(fromId, data) > 0.009) {
      toast("رصيد المحفظة لا يكفي");
      return;
    }
    addTransfer({ fromId, toId, amount: n, date, note });
    toast("تم التحويل");
    closeSheet();
  }

  return (
    <Sheet title="تحويل" description="نقل مبلغ بين محفظتين" container={frame} onClose={closeSheet} trailing={<PillButton onClick={save}>تحويل</PillButton>}>
      <AmountField value={amount} onChange={setAmount} />
      <Section title="من وإلى">
        <div className="mx-4 overflow-hidden rounded-cell bg-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">من</span>
            <select className="field" value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">إلى</span>
            <select className="field" value={toId} onChange={(e) => setToId(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">التاريخ</span>
            <input type="date" dir="ltr" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">ملاحظة</span>
            <input className="field" value={note} placeholder="اختياري" onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      </Section>
    </Sheet>
  );
}

export function WalletForm({ id }: { id?: string }) {
  const { closeSheet, frame } = useMizan();
  const wallets = useFinance((s) => s.wallets);
  const existing = wallets.find((w) => w.id === id);
  const addWallet = useFinance((s) => s.addWallet);
  const updateWallet = useFinance((s) => s.updateWallet);
  const removeWallet = useFinance((s) => s.removeWallet);
  const [name, setName] = useState(existing?.name ?? "");
  const [kind, setKind] = useState<WalletKind>(existing?.kind ?? "other");
  const [opening, setOpening] = useState(existing ? String(existing.opening) : "0");

  function save() {
    const n = parseAmount(opening || "0");
    if (!name.trim()) {
      toast("اكتب اسم المحفظة");
      return;
    }
    if (!Number.isFinite(n) || n < 0) {
      toast("الافتتاحي لا يكون سالباً");
      return;
    }
    if (existing) updateWallet(existing.id, { name, kind, opening: n });
    else addWallet({ name, kind, opening: n });
    toast(existing ? "تم تعديل المحفظة" : "أُضيفت المحفظة");
    closeSheet();
  }

  return (
    <Sheet title={existing ? "تعديل محفظة" : "محفظة جديدة"} description="حساب نقدي" container={frame} onClose={closeSheet} trailing={<PillButton onClick={save}>حفظ</PillButton>}>
      <Section>
        <div className="mx-4 overflow-hidden rounded-cell bg-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">الاسم</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: كاش البيت" />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">افتتاحي</span>
            <input className="field" dir="ltr" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^\d.]/g, ""))} />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">النوع</span>
            <select className="field" value={kind} onChange={(e) => setKind(e.target.value as WalletKind)}>
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Section>
      {existing && existing.id !== "w-cash" ? (
        <div className="mt-6 flex justify-center">
          <PillButton
            tone="danger"
            onClick={() => {
              const ok = removeWallet(existing.id);
              if (!ok) {
                toast("المحفظة مستخدمة في حركات");
                return;
              }
              toast("حُذفت المحفظة");
              closeSheet();
            }}
          >
            حذف المحفظة
          </PillButton>
        </div>
      ) : null}
    </Sheet>
  );
}

export function RecurringForm({ id }: { id?: string }) {
  const { closeSheet, frame } = useMizan();
  const categories = useFinance((s) => s.categories);
  const wallets = useFinance((s) => s.wallets);
  const recurring = useFinance((s) => s.recurring);
  const existing = recurring.find((r) => r.id === id);
  const addRecurring = useFinance((s) => s.addRecurring);
  const updateRecurring = useFinance((s) => s.updateRecurring);
  const removeRecurring = useFinance((s) => s.removeRecurring);
  const [kind, setKind] = useState<TxKind>(existing?.kind ?? "expense");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [walletId, setWalletId] = useState(existing?.walletId ?? wallets[0]?.id ?? "w-cash");
  const [note, setNote] = useState(existing?.note ?? "");
  const [day, setDay] = useState(String(existing?.day ?? 1));
  const [active, setActive] = useState(existing?.active ?? true);
  const cats = categories.filter((c) => c.kind === kind);

  function save() {
    const n = parseAmount(amount);
    const cat = cats.find((c) => c.id === categoryId) ?? cats[0];
    const d = Number(day);
    if (!cat || !Number.isFinite(n) || n <= 0) {
      toast("اكتب المبلغ والفئة");
      return;
    }
    if (!Number.isFinite(d) || d < 1 || d > 28) {
      toast("يوم الشهر من 1 إلى 28");
      return;
    }
    const input = { kind, amount: n, categoryId: cat.id, walletId, note, day: d, active };
    if (existing) updateRecurring(existing.id, input);
    else addRecurring(input);
    toast(existing ? "تم تعديل التكرار" : "أُضيف التكرار");
    closeSheet();
  }

  return (
    <Sheet title={existing ? "تعديل متكرر" : "حركة متكررة"} description="راتب أو إيجار أو اشتراك" container={frame} onClose={closeSheet} trailing={<PillButton onClick={save}>حفظ</PillButton>}>
      <AmountField value={amount} onChange={setAmount} />
      <div className="px-4 pt-3">
        <Segment
          value={kind}
          onChange={(k) => {
            setKind(k);
            setCategoryId(categories.find((c) => c.kind === k)?.id ?? "");
          }}
          options={[
            { id: "expense", label: "مصروف" },
            { id: "income", label: "إيراد" },
          ]}
        />
      </div>
      <Section title="التفاصيل">
        <div className="mx-4 overflow-hidden rounded-cell bg-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">الفئة</span>
            <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">المحفظة</span>
            <select className="field" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">اليوم</span>
            <input className="field" dir="ltr" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">ملاحظة</span>
            <input className="field" value={note} placeholder="راتب، إيجار…" onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="row-sep" />
          <div className="flex min-h-11 items-center justify-between gap-3 px-4">
            <span className="text-body">مفعّلة</span>
            <Switch on={active} onChange={setActive} label="تفعيل التكرار" />
          </div>
        </div>
      </Section>
      <p className="px-8 pt-3 text-foot text-label-2">لا تُسجَّل وحدها. في أول الشهر تظهر للتأكيد بضغطة.</p>
      {existing ? (
        <div className="mt-6 flex justify-center">
          <PillButton
            tone="danger"
            onClick={() => {
              removeRecurring(existing.id);
              toast("حُذف التكرار");
              closeSheet();
            }}
          >
            حذف التكرار
          </PillButton>
        </div>
      ) : null}
    </Sheet>
  );
}

export function SplitForm() {
  const { closeSheet, frame } = useMizan();
  const categories = useFinance((s) => s.categories);
  const wallets = useFinance((s) => s.wallets);
  const people = useFinance((s) => s.people);
  const splitBill = useFinance((s) => s.splitBill);
  const addPerson = useFinance((s) => s.addPerson);
  const expense = categories.filter((c) => c.kind === "expense");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState(expense[0]?.id ?? "");
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "w-cash");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [includeMe, setIncludeMe] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [newName, setNewName] = useState("");

  const total = parseAmount(amount);
  const parts = picked.length + (includeMe ? 1 : 0);
  const each = Number.isFinite(total) && parts > 0 ? round2(total / parts) : 0;

  function toggle(id: string) {
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }

  function save() {
    if (!Number.isFinite(total) || total <= 0) {
      toast("اكتب مبلغ الفاتورة");
      return;
    }
    let ids = picked;
    if (newName.trim()) {
      const id = addPerson({ name: newName, phone: "", note: "" });
      ids = [...ids, id];
    }
    const count = ids.length + (includeMe ? 1 : 0);
    if (count < 2 || ids.length < 1) {
      toast("اختر شخصاً واحداً على الأقل");
      return;
    }
    const cat = expense.find((c) => c.id === categoryId) ?? expense[0];
    if (!cat) {
      toast("أضف فئة مصروف أولاً");
      return;
    }
    splitBill({ total, categoryId: cat.id, note, date, walletId, personIds: ids, includeMe });
    toast("قُسّمت الفاتورة وصارت حصص الآخرين ديوناً لك");
    closeSheet();
  }

  return (
    <Sheet title="تقسيم فاتورة" description="حصتك مصروف وحصصهم دين لك" container={frame} onClose={closeSheet} trailing={<PillButton onClick={save}>تقسيم</PillButton>}>
      <AmountField value={amount} onChange={setAmount} label="إجمالي الفاتورة" />
      <p className="px-4 text-center text-foot text-label-2">
        {parts >= 2 && each > 0 ? `تقريباً ${each} لكل طرف. حصص الآخرين تخرج من المحفظة وتُسجَّل ديناً لك.` : "أنت دفعت المبلغ كاملاً."}
      </p>
      <Section title="من يدفع معك">
        <div className="mx-4 overflow-hidden rounded-cell bg-cell">
          <div className="flex min-h-11 items-center justify-between gap-3 px-4">
            <span className="text-body">أنا داخل القسمة</span>
            <Switch on={includeMe} onChange={setIncludeMe} label="إدخال حصتي" />
          </div>
          {people.map((p) => {
            const on = picked.includes(p.id);
            return (
              <div key={p.id}>
                <div className="row-sep" />
                <button type="button" className="flex min-h-11 w-full items-center justify-between px-4" onClick={() => toggle(p.id)}>
                  <span className="text-body">{p.name}</span>
                  <span className={on ? "text-tint" : "text-label-3"}>{on ? "✓" : "إضافة"}</span>
                </button>
              </div>
            );
          })}
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">جديد</span>
            <input className="field" value={newName} placeholder="اسم غير موجود" onChange={(e) => setNewName(e.target.value)} />
          </label>
        </div>
      </Section>
      <Section title="الدفع">
        <div className="mx-4 overflow-hidden rounded-cell bg-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">الفئة</span>
            <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {expense.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">المحفظة</span>
            <select className="field" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">التاريخ</span>
            <input type="date" dir="ltr" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">البيان</span>
            <input className="field" value={note} placeholder="عشاء، رحلة…" onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      </Section>
    </Sheet>
  );
}

export function GoalForm({ id }: { id?: string }) {
  const { closeSheet, frame } = useMizan();
  const goals = useFinance((s) => s.goals);
  const existing = goals.find((g) => g.id === id);
  const addGoal = useFinance((s) => s.addGoal);
  const updateGoal = useFinance((s) => s.updateGoal);
  const removeGoal = useFinance((s) => s.removeGoal);
  const [name, setName] = useState(existing?.name ?? "");
  const [target, setTarget] = useState(existing ? String(existing.target) : "");
  const [deadline, setDeadline] = useState(existing?.deadline ?? "");

  function save() {
    const n = parseAmount(target);
    if (!name.trim() || !Number.isFinite(n) || n <= 0) {
      toast("اكتب الاسم والمبلغ المستهدف");
      return;
    }
    const input = { name, target: n, deadline };
    if (existing) updateGoal(existing.id, input);
    else addGoal(input);
    toast(existing ? "تم تعديل الهدف" : "أُضيف الهدف");
    closeSheet();
  }

  return (
    <Sheet title={existing ? "تعديل هدف" : "هدف ادخار"} description="مبلغ وموعد" container={frame} onClose={closeSheet} trailing={<PillButton onClick={save}>حفظ</PillButton>}>
      <AmountField value={target} onChange={setTarget} label="المستهدف" />
      <Section>
        <div className="mx-4 overflow-hidden rounded-cell bg-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">الاسم</span>
            <input className="field" value={name} placeholder="سفر، جهاز…" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">الموعد</span>
            <input type="date" dir="ltr" className="field" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
        </div>
      </Section>
      {existing ? (
        <div className="mt-6 flex justify-center">
          <PillButton
            tone="danger"
            onClick={() => {
              removeGoal(existing.id);
              toast("حُذف الهدف وعاد المدّخر إلى محافظه");
              closeSheet();
            }}
          >
            حذف الهدف
          </PillButton>
        </div>
      ) : null}
    </Sheet>
  );
}

export function GoalMoveForm({ goalId, withdraw }: { goalId: string; withdraw?: boolean }) {
  const { closeSheet, frame } = useMizan();
  const goal = useFinance((s) => s.goals.find((g) => g.id === goalId));
  const moves = useFinance((s) => s.goalMoves);
  const wallets = useFinance((s) => s.wallets);
  const data = useFinance();
  const addGoalMove = useFinance((s) => s.addGoalMove);
  const saved = goalSaved(goalId, moves);
  const [amount, setAmount] = useState("");
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "w-cash");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");

  function save() {
    const n = parseAmount(amount);
    if (!goal || !Number.isFinite(n) || n <= 0) {
      toast("اكتب المبلغ");
      return;
    }
    if (withdraw) {
      if (n - saved > 0.009) {
        toast("لا يوجد هذا المبلغ في الهدف");
        return;
      }
      addGoalMove({ goalId, walletId, amount: -n, date, note });
      toast("رجع المبلغ إلى المحفظة");
    } else {
      if (n - walletBalance(walletId, data) > 0.009) {
        toast("رصيد المحفظة لا يكفي");
        return;
      }
      addGoalMove({ goalId, walletId, amount: n, date, note });
      toast("تم الادخار");
    }
    closeSheet();
  }

  return (
    <Sheet
      title={withdraw ? "سحب من الهدف" : "إضافة للهدف"}
      description="نقل بين المحفظة والهدف"
      container={frame}
      onClose={closeSheet}
      trailing={<PillButton onClick={save}>تسجيل</PillButton>}
    >
      <AmountField value={amount} onChange={setAmount} />
      <Section>
        <div className="mx-4 overflow-hidden rounded-cell bg-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">المحفظة</span>
            <select className="field" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">التاريخ</span>
            <input type="date" dir="ltr" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">ملاحظة</span>
            <input className="field" value={note} placeholder="اختياري" onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      </Section>
    </Sheet>
  );
}

export function PinForm() {
  const { closeSheet, frame, pinHash, setPinHash } = useMizan();
  const [mode, setMode] = useState<"set" | "change" | "clear">(pinHash ? "change" : "set");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");

  async function save() {
    if (!/^\d{4}$/.test(next) || next !== again) {
      toast("اكتب رمزاً من 4 أرقام مرتين بنفس الشكل");
      return;
    }
    if (pinHash) {
      if ((await hashPin(current)) !== pinHash) {
        toast("الرمز الحالي غير صحيح");
        return;
      }
    }
    const hashed = await hashPin(next);
    setPinHash(hashed);
    toast("تم حفظ الرمز");
    closeSheet();
  }

  async function clear() {
    if (!pinHash) return;
    if ((await hashPin(current)) !== pinHash) {
      toast("الرمز الحالي غير صحيح");
      return;
    }
    setPinHash(null);
    toast("أُلغي القفل");
    closeSheet();
  }

  return (
    <Sheet title="قفل برمز" description="رمز من أربع خانات على هذا الجهاز" container={frame} onClose={closeSheet} trailing={<PillButton onClick={mode === "clear" ? () => void clear() : () => void save()}>{mode === "clear" ? "إلغاء القفل" : "حفظ"}</PillButton>}>
      {pinHash ? (
        <div className="px-4 pt-2">
          <Segment
            value={mode}
            onChange={(v) => setMode(v)}
            options={[
              { id: "change", label: "تغيير" },
              { id: "clear", label: "إلغاء" },
            ]}
          />
        </div>
      ) : null}
      <Section>
        <div className="mx-4 overflow-hidden rounded-cell bg-cell">
          {pinHash ? (
            <>
              <label className="flex min-h-11 items-center gap-3 px-4">
                <span className="w-20 shrink-0 text-body">الحالي</span>
                <input className="field" dir="ltr" inputMode="numeric" maxLength={4} value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              </label>
              <div className="row-sep" />
            </>
          ) : null}
          {mode !== "clear" ? (
            <>
              <label className="flex min-h-11 items-center gap-3 px-4">
                <span className="w-20 shrink-0 text-body">الجديد</span>
                <input className="field" dir="ltr" inputMode="numeric" maxLength={4} value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              </label>
              <div className="row-sep" />
              <label className="flex min-h-11 items-center gap-3 px-4">
                <span className="w-20 shrink-0 text-body">تأكيد</span>
                <input className="field" dir="ltr" inputMode="numeric" maxLength={4} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              </label>
            </>
          ) : (
            <p className="px-4 py-3 text-sub text-label-2">سيُفتح الدفتر بلا رمز بعد التأكيد.</p>
          )}
        </div>
      </Section>
      <p className="px-8 pt-3 text-foot text-label-2">الرمز يبقى على هذا الجهاز. نسيانه يعني مسح بيانات الموقع من المتصفح.</p>
    </Sheet>
  );
}
