import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AppleDesignStudioContent,
  AppleWalletCard,
  defaultCardDesignForKind,
  WALLET_CARD_DESIGNS,
} from "@/components/finance/apple-cards";
import { useMizan } from "@/components/finance/context";
import { PillButton, Section, Segment, Sheet } from "@/components/finance/ui";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/finance/i18n";
import { GOAL_CATEGORY_LABEL, goalSaved, remaining, round2, todayISO, walletBalance } from "@/lib/finance/logic";
import {
  disableLedgerEncryption,
  rewrapLedgerKeyForNewPin,
} from "@/lib/finance/ledger-crypto";
import { clearPinFailures, hashPin, pinLockoutRemainingMs, recordPinFailure, verifyPin } from "@/lib/finance/pin";
import { useFinance } from "@/lib/finance/store";
import type { GoalCategory, TxKind, WalletCardDesign, WalletKind } from "@/lib/finance/types";

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

const KINDS: { id: WalletKind; label: string; labelEn: string }[] = [
  { id: "cash", label: "كاش", labelEn: "Cash" },
  { id: "card", label: "بطاقة بنكية", labelEn: "Bank Card" },
  { id: "instapay", label: "إنستاباي", labelEn: "InstaPay" },
  { id: "vodafone", label: "فودافون كاش", labelEn: "Mobile Wallet" },
  { id: "bank", label: "حساب بنكي", labelEn: "Bank Account" },
  { id: "other", label: "أخرى", labelEn: "Other" },
];

const QUICK_WALLET_NAMES: { label: string; kind: WalletKind; design: WalletCardDesign }[] = [
  { label: "بطاقة البنك الأهلي", kind: "card", design: "emerald-cash" },
  { label: "بطاقة CIB", kind: "card", design: "ocean-blue" },
  { label: "فيزا المشتريات", kind: "card", design: "titanium-dark" },
  { label: "فودافون كاش الشخصي", kind: "vodafone", design: "crimson-vodafone" },
  { label: "إنستاباي الأساسي", kind: "instapay", design: "royal-purple" },
  { label: "كاش المحفظة", kind: "cash", design: "emerald-cash" },
  { label: "حساب التوفير", kind: "bank", design: "sunset-gold" },
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
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
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
  const { lang } = useI18n();
  const data = useFinance();
  const wallets = data.wallets;
  const existing = wallets.find((w) => w.id === id);
  const addWallet = useFinance((s) => s.addWallet);
  const updateWallet = useFinance((s) => s.updateWallet);
  const removeWallet = useFinance((s) => s.removeWallet);
  const [name, setName] = useState(existing?.name ?? "");
  const [kind, setKind] = useState<WalletKind>(existing?.kind ?? "card");
  const [opening, setOpening] = useState(existing ? String(existing.opening) : "0");
  const [cardDesign, setCardDesign] = useState<WalletCardDesign>(
    existing?.cardDesign ?? defaultCardDesignForKind(existing?.kind ?? "card"),
  );
  const [designTouched, setDesignTouched] = useState(Boolean(existing?.cardDesign));
  const [subtitle, setSubtitle] = useState(existing?.subtitle ?? "");
  const [last4, setLast4] = useState(existing?.last4 ?? "");

  const parsedOpening = parseAmount(opening || "0");
  const previewBalance = existing
    ? walletBalance(existing.id, data) - existing.opening + (Number.isFinite(parsedOpening) ? parsedOpening : 0)
    : Number.isFinite(parsedOpening)
      ? parsedOpening
      : 0;

  function handleKindChange(nextKind: WalletKind) {
    setKind(nextKind);
    if (!designTouched) {
      setCardDesign(defaultCardDesignForKind(nextKind));
    }
  }

  function save() {
    const n = parseAmount(opening || "0");
    if (!name.trim()) {
      toast(lang === "en" ? "Enter card or wallet name" : "اكتب اسم البطاقة أو المحفظة");
      return;
    }
    if (!Number.isFinite(n) || n < 0) {
      toast(lang === "en" ? "Opening balance cannot be negative" : "الافتتاحي لا يكون سالباً");
      return;
    }
    const payload = {
      name: name.trim(),
      kind,
      opening: n,
      cardDesign,
      subtitle,
      last4,
    };
    if (existing) updateWallet(existing.id, payload);
    else addWallet(payload);
    toast(
      existing
        ? lang === "en"
          ? "Card / wallet updated"
          : "تم تعديل اسم وتصميم البطاقة / المحفظة"
        : lang === "en"
          ? "Card / wallet added"
          : "أُضيفت البطاقة / المحفظة",
    );
    closeSheet();
  }

  return (
    <Sheet
      title={
        existing
          ? lang === "en"
            ? "Edit Card / Wallet"
            : "تعديل البطاقة / المحفظة"
          : lang === "en"
            ? "New Card / Wallet"
            : "بطاقة أو محفظة جديدة"
      }
      description={lang === "en" ? "Customize name, type & Apple Card style" : "تعديل الاسم والنوع وتصميم Apple Wallet"}
      container={frame}
      onClose={closeSheet}
      trailing={<PillButton onClick={save}>{lang === "en" ? "Save" : "حفظ"}</PillButton>}
    >
      {/* Live Apple Card Preview */}
      <div className="px-4 pt-2">
        <AppleWalletCard
          wallet={{
            id: existing?.id ?? "preview",
            name: name.trim() || (lang === "en" ? "Card / Wallet Name" : "اسم البطاقة أو المحفظة"),
            kind,
            opening: Number.isFinite(parsedOpening) ? parsedOpening : 0,
            cardDesign,
            subtitle: subtitle.trim() || undefined,
            last4: last4.trim() || undefined,
            createdAt: 1,
          }}
          balance={previewBalance}
          currency={data.currency}
        />
      </div>

      {/* Quick Preset Names */}
      <div className="mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 no-scrollbar">
        {QUICK_WALLET_NAMES.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              setName(preset.label);
              setKind(preset.kind);
              if (!designTouched) setCardDesign(preset.design);
            }}
            className="shrink-0 rounded-pill bg-fill px-3 py-1.5 text-[12px] font-semibold text-label active:opacity-80"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <Section title={lang === "en" ? "Name & Details" : "الاسم والبيانات"}>
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-24 shrink-0 text-body font-medium">
              {lang === "en" ? "Name" : "الاسم"}
            </span>
            <input
              className="field font-semibold"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={lang === "en" ? "e.g. CIB Visa / Cash" : "مثال: بطاقة البنك الأهلي / كاش"}
            />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-24 shrink-0 text-body">
              {lang === "en" ? "Type" : "النوع"}
            </span>
            <select
              className="field"
              value={kind}
              onChange={(e) => handleKindChange(e.target.value as WalletKind)}
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {lang === "en" ? k.labelEn : k.label}
                </option>
              ))}
            </select>
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-24 shrink-0 text-body">
              {lang === "en" ? "Opening" : "افتتاحي"}
            </span>
            <input
              className="field num"
              dir="ltr"
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-24 shrink-0 text-body">
              {lang === "en" ? "Label" : "وصف مختصر"}
            </span>
            <input
              className="field"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder={lang === "en" ? "Optional (e.g. Salary Card)" : "اختياري (مثال: بطاقة المرتب)"}
            />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-24 shrink-0 text-body">
              {lang === "en" ? "Last 4 Digits" : "آخر 4 أرقام"}
            </span>
            <input
              className="field num"
              dir="ltr"
              inputMode="numeric"
              maxLength={4}
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="1234"
            />
          </label>
        </div>
      </Section>

      <Section title={lang === "en" ? "Apple Card Finish" : "تصميم ولون البطاقة (Apple Wallet)"}>
        <div className="grid grid-cols-4 gap-2.5 px-4">
          {WALLET_CARD_DESIGNS.map((d) => {
            const active = cardDesign === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setCardDesign(d.id);
                  setDesignTouched(true);
                }}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-cell p-2 transition",
                  active ? "bg-[var(--tint-soft)] ring-2 ring-[var(--tint)]" : "bg-fill/60",
                )}
              >
                <span
                  className="relative flex h-9 w-full items-center justify-center rounded-lg shadow-sm"
                  style={{ background: d.background, color: d.textColor }}
                >
                  {active ? <Check size={15} strokeWidth={2.8} /> : null}
                </span>
                <span className="w-full truncate text-center text-[10px] font-semibold text-label">
                  {lang === "en" ? d.nameEn : d.nameAr}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {existing && existing.id !== "w-cash" ? (
        <div className="mt-6 flex justify-center">
          <PillButton
            tone="danger"
            onClick={() => {
              const ok = removeWallet(existing.id);
              if (!ok) {
                toast(lang === "en" ? "Wallet has linked transactions" : "البطاقة / المحفظة مستخدمة في حركات");
                return;
              }
              toast(lang === "en" ? "Card / wallet deleted" : "حُذفت البطاقة / المحفظة");
              closeSheet();
            }}
          >
            {lang === "en" ? "Delete Card / Wallet" : "حذف البطاقة / المحفظة"}
          </PillButton>
        </div>
      ) : null}
    </Sheet>
  );
}

export function DesignStudioSheet() {
  const { closeSheet, openSheet, frame } = useMizan();
  const { lang } = useI18n();
  const wallets = useFinance((s) => s.wallets);

  return (
    <Sheet
      title={lang === "en" ? "Apple Designs & Cards" : "تصميمات Apple والبطاقات"}
      description={lang === "en" ? "Choose theme and edit card/wallet names" : "اختيار المظهر وتعديل أسماء البطاقات والمحافظ"}
      container={frame}
      onClose={closeSheet}
      trailing={
        <PillButton onClick={closeSheet}>
          {lang === "en" ? "Done" : "تم"}
        </PillButton>
      }
    >
      <AppleDesignStudioContent
        wallets={wallets}
        onEditWallet={(walletId) => openSheet({ kind: "wallet", id: walletId })}
        onAddWallet={() => openSheet({ kind: "wallet" })}
      />
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
  const [categoryId, setCategoryId] = useState(
    existing?.categoryId ?? categories.find((c) => c.kind === (existing?.kind ?? "expense"))?.id ?? "",
  );
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
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
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
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
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
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
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

const GOAL_CATEGORIES: GoalCategory[] = ["travel", "debt_payoff", "device", "emergency", "general"];

export function GoalForm({ id }: { id?: string }) {
  const { closeSheet, frame, route, back } = useMizan();
  const goals = useFinance((s) => s.goals);
  const debts = useFinance((s) => s.debts);
  const payments = useFinance((s) => s.payments);
  const existing = goals.find((g) => g.id === id);
  const addGoal = useFinance((s) => s.addGoal);
  const updateGoal = useFinance((s) => s.updateGoal);
  const removeGoal = useFinance((s) => s.removeGoal);
  const [name, setName] = useState(existing?.name ?? "");
  const [target, setTarget] = useState(existing ? String(existing.target) : "");
  const [deadline, setDeadline] = useState(existing?.deadline ?? "");
  const [category, setCategory] = useState<GoalCategory>(existing?.category ?? "general");
  const [linkedDebtId, setLinkedDebtId] = useState(existing?.linkedDebtId ?? "");
  const openPayables = debts.filter((d) => d.direction === "payable" && remaining(d, payments) > 0);

  function pickCategory(cat: GoalCategory) {
    setCategory(cat);
    if (!existing && !name.trim() && cat !== "general") {
      setName(GOAL_CATEGORY_LABEL[cat]);
    }
  }

  function save() {
    const n = parseAmount(target);
    if (!name.trim() || !Number.isFinite(n) || n <= 0) {
      toast("اكتب الاسم والمبلغ المستهدف");
      return;
    }
    const input = {
      name,
      target: n,
      deadline,
      category,
      linkedDebtId: category === "debt_payoff" ? linkedDebtId || undefined : undefined,
    };
    if (existing) updateGoal(existing.id, input);
    else addGoal(input);
    toast(existing ? "تم تعديل الهدف" : "أُضيف الهدف");
    closeSheet();
  }

  return (
    <Sheet title={existing ? "تعديل هدف" : "هدف ادخار"} description="مبلغ وموعد ونوع" container={frame} onClose={closeSheet} trailing={<PillButton onClick={save}>حفظ</PillButton>}>
      <AmountField value={target} onChange={setTarget} label="المستهدف" />
      <div className="mt-2 flex flex-wrap justify-center gap-1.5 px-4">
        {GOAL_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => pickCategory(c)}
            className={cn(
              "min-h-9 rounded-pill px-3 text-caption font-semibold",
              category === c ? "bg-tint text-on-tint" : "bg-fill text-label-2",
            )}
          >
            {GOAL_CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <Section>
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">الاسم</span>
            <input className="field" value={name} placeholder="سفر، جهاز، صندوق طوارئ…" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-16 shrink-0 text-body">الموعد</span>
            <input type="date" dir="ltr" className="field" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
          {category === "debt_payoff" && openPayables.length ? (
            <>
              <div className="row-sep" />
              <label className="flex min-h-11 items-center gap-3 px-4">
                <span className="w-16 shrink-0 text-body">الدين</span>
                <select
                  className="field"
                  value={linkedDebtId}
                  onChange={(e) => {
                    const idVal = e.target.value;
                    setLinkedDebtId(idVal);
                    const picked = openPayables.find((d) => d.id === idVal);
                    if (picked && !target) {
                      setTarget(String(remaining(picked, payments)));
                      if (!name.trim() || name === GOAL_CATEGORY_LABEL.debt_payoff) {
                        setName(`سداد: ${picked.title}`);
                      }
                    }
                  }}
                >
                  <option value="">اختياري — ربط بدين</option>
                  {openPayables.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} ({remaining(d, payments)})
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </div>
      </Section>
      {existing ? (
        <div className="mt-6 flex justify-center">
          <PillButton
            tone="danger"
            onClick={() => {
              removeGoal(existing.id);
              if (route.name === "goal" && route.id === existing.id) back();
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
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
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

  function registerFailedPinAttempt() {
    const delayMs = recordPinFailure();
    if (delayMs > 0) toast(`محاولات كثيرة — انتظر ${Math.ceil(delayMs / 1000)} ثانية`);
  }

  async function rejectIfLocked() {
    const remaining = pinLockoutRemainingMs();
    if (remaining <= 0) return false;
    toast(`محاولات كثيرة — انتظر ${Math.ceil(remaining / 1000)} ثانية`);
    return true;
  }

  async function save() {
    if (!/^\d{4}$/.test(next) || next !== again) {
      toast("اكتب رمزاً من 4 أرقام مرتين بنفس الشكل");
      return;
    }
    if (await rejectIfLocked()) return;
    if (pinHash) {
      const check = await verifyPin(current, pinHash);
      if (!check.ok) {
        registerFailedPinAttempt();
        toast("الرمز الحالي غير صحيح");
        return;
      }
    }
    clearPinFailures();
    const hashed = await hashPin(next);
    setPinHash(hashed);
    await rewrapLedgerKeyForNewPin(next).catch(() => undefined);
    toast("تم حفظ الرمز");
    closeSheet();
  }

  async function clear() {
    if (!pinHash) return;
    if (await rejectIfLocked()) return;
    const check = await verifyPin(current, pinHash);
    if (!check.ok) {
      registerFailedPinAttempt();
      toast("الرمز الحالي غير صحيح");
      return;
    }
    clearPinFailures();
    await disableLedgerEncryption(current).catch(() => undefined);
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
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
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
