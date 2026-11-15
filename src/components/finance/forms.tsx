import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { IconTile } from "@/components/finance/icons";
import { PillButton, Section, Segment, Sheet } from "@/components/finance/ui";
import { useMizan, type TxPrefill } from "@/components/finance/context";
import { cn } from "@/lib/cn";
import { frequentTemplates, loadEntryPrefs, rememberEntryChoice } from "@/lib/finance/entry-prefs";
import { paidOf, planInstallments, round2, suggestCategoryFromNote, todayISO } from "@/lib/finance/logic";
import { compressReceipt, deleteReceipt, loadReceipt, saveReceipt } from "@/lib/finance/receipts";
import { useFinance } from "@/lib/finance/store";
import type { DebtCadence, DebtDirection, TxKind } from "@/lib/finance/types";
import { clearCachedGoogleToken } from "@/lib/sync/google-drive-gis";

function parseAmount(raw: string) {
  const n = Number(raw.replace(",", ".").trim());
  return Number.isFinite(n) ? round2(n) : NaN;
}

function AmountField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block px-4 pt-2 text-center">
      <span className="text-foot text-label-2">المبلغ</span>
      <input
        className="amount-input"
        inputMode="decimal"
        dir="ltr"
        placeholder="0"
        value={value}
        aria-label="المبلغ"
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, "");
          if ((v.match(/\./g) ?? []).length > 1) return;
          onChange(v);
        }}
      />
    </label>
  );
}

export function TxnForm({ id, prefill }: { id?: string; prefill?: TxPrefill }) {
  const { closeSheet, frame } = useMizan();
  const txns = useFinance((s) => s.txns);
  const payments = useFinance((s) => s.payments);
  const debts = useFinance((s) => s.debts);
  const categories = useFinance((s) => s.categories);
  const people = useFinance((s) => s.people);
  const wallets = useFinance((s) => s.wallets);
  const recurring = useFinance((s) => s.recurring);
  const addTxn = useFinance((s) => s.addTxn);
  const updateTxn = useFinance((s) => s.updateTxn);
  const removeTxn = useFinance((s) => s.removeTxn);
  const restoreTxn = useFinance((s) => s.restoreTxn);
  const restorePayment = useFinance((s) => s.restorePayment);
  const existing = txns.find((t) => t.id === id);
  const linkedPayment = existing ? payments.find((p) => p.txId === existing.id) : undefined;
  const linkedDebt = linkedPayment ? debts.find((d) => d.id === linkedPayment.debtId) : undefined;
  const prefs = useMemo(() => loadEntryPrefs(), []);
  const initialKind: TxKind = existing?.kind ?? prefill?.kind ?? "expense";
  const initialCategory =
    existing?.categoryId ??
    prefill?.categoryId ??
    (prefs.lastCategoryByKind?.[initialKind] &&
    categories.some((c) => c.id === prefs.lastCategoryByKind?.[initialKind] && c.kind === initialKind)
      ? prefs.lastCategoryByKind[initialKind]!
      : categories.find((c) => c.kind === initialKind)?.id ?? "");
  const initialWallet =
    existing?.walletId ??
    prefill?.walletId ??
    (prefs.lastWalletId && wallets.some((w) => w.id === prefs.lastWalletId)
      ? prefs.lastWalletId
      : wallets[0]?.id ?? "w-cash");

  const [draftId] = useState(() => existing?.id ?? crypto.randomUUID());
  const [kind, setKind] = useState<TxKind>(initialKind);
  const [amount, setAmount] = useState(
    existing ? String(existing.amount) : prefill?.amount ? String(prefill.amount) : "",
  );
  const [categoryId, setCategoryId] = useState(initialCategory);
  const [manualCategoryPicked, setManualCategoryPicked] = useState(Boolean(existing || prefill?.categoryId));
  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [note, setNote] = useState(existing?.note ?? prefill?.note ?? "");
  const [personId, setPersonId] = useState(existing?.personId ?? prefill?.personId ?? "");
  const [walletId, setWalletId] = useState(initialWallet);
  const [receiptOn, setReceiptOn] = useState(Boolean(existing?.receiptId));
  const [preview, setPreview] = useState("");

  const cats = categories.filter((c) => c.kind === kind);
  const receiptKey = existing?.id ?? draftId;
  const templates = useMemo(
    () => (existing ? [] : frequentTemplates(txns, recurring, categories, 5)),
    [existing, txns, recurring, categories],
  );
  const suggestedCatId = useMemo(
    () => (existing ? null : suggestCategoryFromNote(note, kind, categories, txns)),
    [existing, note, kind, categories, txns],
  );
  const suggestedCat = suggestedCatId ? cats.find((c) => c.id === suggestedCatId) : undefined;

  useEffect(() => {
    if (!existing && !manualCategoryPicked && suggestedCatId && cats.some((c) => c.id === suggestedCatId)) {
      setCategoryId(suggestedCatId);
    }
  }, [existing, manualCategoryPicked, suggestedCatId, cats]);

  useEffect(() => {
    if (!receiptOn) {
      setPreview("");
      return;
    }
    let url = "";
    let cancelled = false;
    void loadReceipt(receiptKey).then((blob) => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setPreview(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [receiptOn, receiptKey]);

  function save() {
    const n = parseAmount(amount);
    const cat = cats.find((c) => c.id === categoryId) ?? cats[0];
    if (!cat || !Number.isFinite(n) || n <= 0) {
      toast("اكتب مبلغًا أكبر من صفر واختر فئة");
      return;
    }
    if (linkedDebt && linkedPayment) {
      const otherPaid = payments.reduce(
        (s, p) => (p.debtId === linkedDebt.id && p.id !== linkedPayment.id ? s + p.amount : s),
        0,
      );
      if (n > round2(linkedDebt.principal - otherPaid) + 0.009) {
        toast("المبلغ أكبر من المتبقي على الدين");
        return;
      }
    }
    const input = {
      kind,
      amount: n,
      categoryId: cat.id,
      note,
      date,
      personId: personId || undefined,
      walletId,
      receiptId: receiptOn ? receiptKey : undefined,
    };
    if (existing) {
      const ok = updateTxn(existing.id, input);
      if (!ok) {
        toast("تعذّر تحديث الحركة");
        return;
      }
    } else {
      addTxn({ ...input, id: draftId });
      rememberEntryChoice(kind, cat.id, walletId);
    }
    if (!receiptOn) void deleteReceipt(receiptKey);
    toast(existing ? "تم تعديل الحركة" : kind === "income" ? "تم تسجيل الإيراد" : "تم تسجيل المصروف");
    closeSheet();
  }

  function applyTemplate(tpl: (typeof templates)[number]) {
    setKind(tpl.kind);
    setAmount(String(tpl.amount));
    setCategoryId(tpl.categoryId);
    setManualCategoryPicked(true);
    setWalletId(tpl.walletId);
    setNote(tpl.note);
    toast(`طُبّق قالب «${tpl.title}»`);
  }

  function destroy() {
    if (!existing) return;
    const snapshot = removeTxn(existing.id);
    closeSheet();
    if (!snapshot) return;
    const receiptTimer = snapshot.tx.receiptId
      ? window.setTimeout(() => void deleteReceipt(snapshot.tx.id), 9000)
      : undefined;
    toast("تم حذف الحركة", {
      action: {
        label: "تراجع",
        onClick: () => {
          if (receiptTimer !== undefined) window.clearTimeout(receiptTimer);
          restoreTxn(snapshot.tx);
          if (snapshot.payment) restorePayment(snapshot.payment);
        },
      },
    });
  }

  return (
    <Sheet
      title={existing ? "تعديل حركة" : "حركة جديدة"}
      description="تسجيل إيراد أو مصروف"
      container={frame}
      onClose={closeSheet}
      trailing={
        <PillButton onClick={save} tone="tint">
          حفظ
        </PillButton>
      }
    >
      <AmountField value={amount} onChange={setAmount} />
      {templates.length ? (
        <div className="mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => applyTemplate(tpl)}
              className="shrink-0 rounded-pill bg-fill px-3 py-1.5 text-caption font-semibold text-label active:opacity-75"
            >
              {tpl.title} · {tpl.amount}
            </button>
          ))}
        </div>
      ) : null}
      {linkedPayment ? (
        <p className="px-6 pt-2 text-center text-foot text-label-2">
          هذه الحركة مرتبطة بسداد دين{linkedDebt ? ` (${linkedDebt.title})` : ""} — التعديل يحدّث الدفعة والمحفظة معاً.
        </p>
      ) : (
        <div className="px-4 pt-3">
          <Segment
            value={kind}
            onChange={(k) => {
              setKind(k);
              const remembered = prefs.lastCategoryByKind?.[k];
              const next =
                remembered && categories.some((c) => c.id === remembered && c.kind === k)
                  ? remembered
                  : categories.find((c) => c.kind === k)?.id ?? "";
              setCategoryId(next);
              setManualCategoryPicked(false);
            }}
            options={[
              { id: "expense", label: "مصروف" },
              { id: "income", label: "إيراد" },
            ]}
          />
        </div>
      )}
      {suggestedCat && suggestedCat.id !== categoryId ? (
        <div className="mt-2 flex justify-center px-4">
          <button
            type="button"
            onClick={() => {
              setCategoryId(suggestedCat.id);
              setManualCategoryPicked(true);
            }}
            className="rounded-pill bg-tint/15 px-3 py-1 text-caption font-semibold text-tint"
          >
            اقتراح التصنيف: {suggestedCat.name} ✓
          </button>
        </div>
      ) : null}
      <div className="grid grid-cols-4 gap-1 px-3 pt-4">
        {cats.map((c) => {
          const on = c.id === categoryId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setCategoryId(c.id);
                setManualCategoryPicked(true);
              }}
              className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-cell active:opacity-80"
            >
              <IconTile name={c.icon} tone={c.tone} />
              <span className={on ? "text-caption font-semibold text-tint" : "text-caption text-label-2"}>
                {c.name}
              </span>
            </button>
          );
        })}
      </div>
      <Section title="التفاصيل" className="mt-4">
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">ملاحظة</span>
            <input
              className="field"
              value={note}
              placeholder="مثال: غداء، أوبر، كهرباء… (يقترح التصنيف)"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">التاريخ</span>
            <input type="date" className="field" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {!linkedPayment ? (
            <>
              <div className="row-sep" />
              <label className="flex min-h-11 items-center gap-3 px-4">
                <span className="w-16 shrink-0 text-body">شخص</span>
                <select className="field" value={personId} onChange={(e) => setPersonId(e.target.value)}>
                  <option value="">بدون</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
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
          <div className="flex min-h-11 items-center justify-between gap-3 px-4">
            <span className="text-body">إيصال</span>
            <label className="text-sub font-semibold text-tint">
              {receiptOn ? "استبدال" : "إرفاق صورة"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void (async () => {
                    try {
                      const blob = await compressReceipt(file);
                      if (blob.size > 450_000) {
                        toast("الصورة كبيرة حتى بعد التصغير");
                        return;
                      }
                      await saveReceipt(receiptKey, blob);
                      setReceiptOn(true);
                      toast("أُرفق الإيصال");
                    } catch {
                      toast("تعذّر قراءة الصورة");
                    }
                  })();
                }}
              />
            </label>
          </div>
          {preview ? (
            <>
              <div className="row-sep" />
              <div className="px-4 py-3">
                <img src={preview} alt="إيصال" className="receipt-img h-36 w-full rounded-inner object-cover" />
                <button
                  type="button"
                  className="mt-2 min-h-11 text-sub text-expense"
                  onClick={() => {
                    setReceiptOn(false);
                    void deleteReceipt(receiptKey);
                  }}
                >
                  إزالة الإيصال
                </button>
              </div>
            </>
          ) : null}
        </div>
      </Section>
      {existing ? (
        <div className="mt-6 flex justify-center">
          <PillButton tone="danger" onClick={destroy}>
            حذف الحركة
          </PillButton>
        </div>
      ) : null}
    </Sheet>
  );
}

export function PersonForm({ id }: { id?: string }) {
  const { closeSheet, frame } = useMizan();
  const people = useFinance((s) => s.people);
  const addPerson = useFinance((s) => s.addPerson);
  const updatePerson = useFinance((s) => s.updatePerson);
  const existing = people.find((p) => p.id === id);
  const [name, setName] = useState(existing?.name ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [note, setNote] = useState(existing?.note ?? "");

  function save() {
    if (!name.trim()) {
      toast("اكتب اسم الشخص");
      return;
    }
    const input = { name, phone, note };
    if (existing) updatePerson(existing.id, input);
    else addPerson(input);
    toast(existing ? "تم تعديل الشخص" : "تمت إضافة الشخص");
    closeSheet();
  }

  return (
    <Sheet
      title={existing ? "تعديل شخص" : "شخص جديد"}
      description="مدين أو دائن"
      container={frame}
      onClose={closeSheet}
      trailing={<PillButton onClick={save}>حفظ</PillButton>}
    >
      <Section>
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">الاسم</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم" />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">الهاتف</span>
            <input
              className="field"
              dir="ltr"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="اختياري"
            />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">ملاحظة</span>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="اختياري" />
          </label>
        </div>
      </Section>
    </Sheet>
  );
}

export function DebtForm({ id }: { id?: string }) {
  const { closeSheet, frame } = useMizan();
  const debts = useFinance((s) => s.debts);
  const people = useFinance((s) => s.people);
  const payments = useFinance((s) => s.payments);
  const addDebt = useFinance((s) => s.addDebt);
  const updateDebt = useFinance((s) => s.updateDebt);
  const addPerson = useFinance((s) => s.addPerson);
  const existing = debts.find((d) => d.id === id);
  const [direction, setDirection] = useState<DebtDirection>(existing?.direction ?? "receivable");
  const [amount, setAmount] = useState(existing ? String(existing.principal) : "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [due, setDue] = useState(existing?.dueDate ?? "");
  const [count, setCount] = useState(String(existing?.installments || 1));
  const [cadence, setCadence] = useState<DebtCadence>(existing?.cadence ?? "monthly");
  const [note, setNote] = useState(existing?.note ?? "");
  const [personId, setPersonId] = useState(existing?.personId ?? (people[0]?.id ?? "__new"));
  const [newName, setNewName] = useState("");

  function save() {
    const n = parseAmount(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast("اكتب أصل الدين");
      return;
    }
    let pid = personId;
    if (personId === "__new") {
      if (!newName.trim()) {
        toast("اكتب اسم الشخص");
        return;
      }
      pid = addPerson({ name: newName, phone: "", note: "" });
    }
    if (!pid) {
      toast("اختر الشخص");
      return;
    }
    const installments = Math.min(36, Math.max(1, Math.round(Number(count) || 1)));
    if (installments > 1 && !due) {
      toast("حدد تاريخ أول قسط");
      return;
    }
    if (existing) {
      const paid = paidOf(existing.id, payments);
      if (n + 0.001 < paid) {
        toast("الأصل أقل من المبلغ المسدّد");
        return;
      }
      updateDebt(existing.id, { personId: pid, direction, title: title || "دين", principal: n, dueDate: due, note, installments, cadence });
      toast("تم تعديل الدين");
    } else {
      addDebt({ personId: pid, direction, title: title || "دين", principal: n, dueDate: due, note, installments, cadence });
      toast("تم تسجيل الدين");
    }
    closeSheet();
  }

  return (
    <Sheet
      title={existing ? "تعديل دين" : "دين جديد"}
      description="دين لك أو عليك"
      container={frame}
      onClose={closeSheet}
      trailing={<PillButton onClick={save}>حفظ</PillButton>}
    >
      <AmountField value={amount} onChange={setAmount} />
      <div className="px-4 pt-3">
        <Segment
          value={direction}
          onChange={setDirection}
          options={[
            { id: "receivable", label: "لي" },
            { id: "payable", label: "عليّ" },
          ]}
        />
      </div>
      <Section title="التفاصيل">
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">البيان</span>
            <input className="field" value={title} placeholder="سبب الدين" onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">الشخص</span>
            <select className="field" value={personId} onChange={(e) => setPersonId(e.target.value)}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="__new">شخص جديد…</option>
            </select>
          </label>
          {personId === "__new" ? (
            <>
              <div className="row-sep" />
              <label className="flex min-h-11 items-center gap-3 px-4">
                <span className="w-16 shrink-0 text-body">الاسم</span>
                <input className="field" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="اسم جديد" />
              </label>
            </>
          ) : null}
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">الاستحقاق</span>
            <input type="date" className="field" dir="ltr" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">الأقساط</span>
            <input
              className="field"
              dir="ltr"
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 2))}
            />
          </label>
          {Number(count) > 1 ? (
            <>
              <div className="row-sep" />
              <label className="flex min-h-11 items-center gap-3 px-4">
                <span className="w-16 shrink-0 text-body">التكرار</span>
                <select className="field" value={cadence} onChange={(e) => setCadence(e.target.value as DebtCadence)}>
                  <option value="monthly">شهري</option>
                  <option value="biweekly">كل أسبوعين</option>
                  <option value="weekly">أسبوعي</option>
                </select>
              </label>
            </>
          ) : null}
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">ملاحظة</span>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="اختياري" />
          </label>
        </div>
      </Section>
      <p className="px-8 pt-3 text-foot text-label-2">
        {direction === "receivable" ? "لي: المبلغ الذي ينتظر رجوعه إليك." : "عليّ: المبلغ الذي ستسدده أنت."}
        {Number(count) > 1 && Number.isFinite(parseAmount(amount))
          ? ` ${Number(count)} أقساط (${cadence === "weekly" ? "أسبوعياً" : cadence === "biweekly" ? "كل أسبوعين" : "شهرياً"})، كل قسط تقريباً ${planInstallments({ id: "", personId: "", direction, title: "", principal: parseAmount(amount), dueDate: due || todayISO(), note: "", installments: Number(count), cadence, createdAt: 0 })[0]?.amount ?? ""}.`
          : " قسط واحد يعني استحقاقاً واحداً."}
      </p>
    </Sheet>
  );
}

export function PayForm({ debtId }: { debtId: string }) {
  const { closeSheet, frame } = useMizan();
  const debt = useFinance((s) => s.debts.find((d) => d.id === debtId));
  const payments = useFinance((s) => s.payments);
  const wallets = useFinance((s) => s.wallets);
  const addPayment = useFinance((s) => s.addPayment);
  const rem = debt ? round2(Math.max(0, debt.principal - paidOf(debt.id, payments))) : 0;
  const [amount, setAmount] = useState(rem ? String(rem) : "");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [linkCash, setLinkCash] = useState(true);
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "w-cash");

  function save() {
    const n = parseAmount(amount);
    if (!debt || !Number.isFinite(n) || n <= 0) {
      toast("اكتب مبلغ السداد");
      return;
    }
    if (n - rem > 0.009) {
      toast("المبلغ أكبر من المتبقي");
      return;
    }
    addPayment({ debtId: debt.id, amount: n, date, note, walletId, linkCash });
    toast(n + 0.009 >= rem ? "تم سداد الدين" : "تم تسجيل الدفعة");
    closeSheet();
  }

  return (
    <Sheet
      title="سداد"
      description="تسجيل دفعة على الدين"
      container={frame}
      onClose={closeSheet}
      trailing={<PillButton onClick={save}>تسجيل</PillButton>}
    >
      <AmountField value={amount} onChange={setAmount} />
      <p className="px-4 text-center text-foot text-label-2">
        {linkCash
          ? debt?.direction === "receivable"
            ? "التحصيل يزيد المحفظة ولا يُحسب إيراداً جديداً في ملخص الشهر."
            : "السداد ينقص المحفظة ولا يُحسب مصروفاً جديداً في ملخص الشهر."
          : "الدفعة تُسجَّل على الدين فقط، من غير لمس الرصيد."}
      </p>
      <Section>
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">التاريخ</span>
            <input type="date" dir="ltr" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">ملاحظة</span>
            <input className="field" value={note} placeholder="اختياري" onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="row-sep" />
          <div className="flex min-h-11 items-center justify-between gap-3 px-4">
            <span className="text-body">حرّك المحفظة</span>
            <button
              type="button"
              role="switch"
              aria-checked={linkCash}
              aria-label="ربط السداد برصيد المحفظة"
              onClick={() => setLinkCash((v) => !v)}
              className={linkCash ? "h-7 w-12 shrink-0 rounded-pill bg-tint p-0.5" : "h-7 w-12 shrink-0 rounded-pill bg-fill p-0.5"}
            >
              <span className={linkCash ? "ms-auto block h-6 w-6 rounded-pill bg-cell" : "block h-6 w-6 rounded-pill bg-cell"} />
            </button>
          </div>
          {linkCash ? (
            <>
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
            </>
          ) : null}
        </div>
      </Section>
    </Sheet>
  );
}

export function ResetForm() {
  const { closeSheet, frame, back, setPinHash } = useMizan();
  const resetAll = useFinance((s) => s.resetAll);
  const [clearSecurityAndTasks, setClearSecurityAndTasks] = useState(false);

  return (
    <Sheet title="مسح البيانات" description="حذف الدفتر من هذا الجهاز" container={frame} onClose={closeSheet}>
      <div className="px-4 pt-2">
        <p className="text-body text-label">
          تُحذف الحركات والديون والأشخاص والمحافظ الإضافية والأهداف من هذا الجهاز. الفئات الأساسية تبقى. لا يمكن التراجع.
        </p>
        <div className="surface-card mt-4 overflow-hidden rounded-cell">
          <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-body">مسح رمز القفل والمهام المجدولة</p>
              <p className="text-foot text-label-2">يلغي القفل ويحذف التذكيرات المجدولة أيضاً</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={clearSecurityAndTasks}
              aria-label="مسح رمز القفل والمهام المجدولة"
              onClick={() => setClearSecurityAndTasks((v) => !v)}
              className={cn("h-7 w-12 shrink-0 rounded-pill p-0.5", clearSecurityAndTasks ? "bg-tint" : "bg-fill")}
            >
              <span className={cn("block h-6 w-6 rounded-pill bg-cell", clearSecurityAndTasks && "ms-auto")} />
            </button>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-2">
          <PillButton
            tone="danger"
            onClick={() => {
              if (clearSecurityAndTasks) {
                clearCachedGoogleToken();
                setPinHash(null);
              }
              resetAll({ clearSecurityAndTasks });
              back();
              closeSheet();
              toast(clearSecurityAndTasks ? "تم المسح الآمن الكامل للبيانات المحلية" : "تم مسح الدفتر");
            }}
          >
            مسح الكل
          </PillButton>
          <PillButton tone="gray" onClick={closeSheet}>
            إلغاء
          </PillButton>
        </div>
      </div>
    </Sheet>
  );
}
