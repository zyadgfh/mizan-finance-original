import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, ImagePlus, Sparkles, CheckCircle2, ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { PillButton, Section, Sheet } from "@/components/finance/ui";
import { useMizan } from "@/components/finance/context";
import { rememberEntryChoice } from "@/lib/finance/entry-prefs";
import { useI18n } from "@/lib/finance/i18n";
import {
  currencySymbol,
  effectiveExchangeRate,
  formatNumber,
  round2,
  todayISO,
} from "@/lib/finance/logic";
import { compressReceipt, saveReceipt } from "@/lib/finance/receipts";
import { parseSmartFinancialInput } from "@/lib/finance/smart-capture";
import { useFinance } from "@/lib/finance/store";
import { safeRandomUUID } from "@/lib/mobile-safe";

async function dataUrlToFile(dataUrl: string, filename = "shared-receipt.jpg"): Promise<File | null> {
  try {
    const [meta, b64] = dataUrl.split(",");
    if (!meta || !b64) return null;
    const mimeMatch = meta.match(/data:([^;]+);base64/i);
    const mime = mimeMatch?.[1] || "image/jpeg";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], filename, { type: mime });
  } catch {
    return null;
  }
}

export function SmartCaptureSheet({
  initialText = "",
  initialImageDataUrl = null,
}: {
  initialText?: string;
  initialImageDataUrl?: string | null;
}) {
  const { closeSheet, openSheet, frame } = useMizan();
  const { lang, numeralStyle, catName } = useI18n();
  const en = lang === "en";

  const wallets = useFinance((s) => s.wallets);
  const categories = useFinance((s) => s.categories);
  const people = useFinance((s) => s.people);
  const txns = useFinance((s) => s.txns);
  const accountCurrency = useFinance((s) => s.currency);
  const exchangeRates = useFinance((s) => s.exchangeRates);
  const addTxn = useFinance((s) => s.addTxn);
  const addTransfer = useFinance((s) => s.addTransfer);

  const [draftId] = useState(() => safeRandomUUID());
  const [text, setText] = useState(initialText);
  const [receiptPreview, setReceiptPreview] = useState<string>(initialImageDataUrl || "");
  const [receiptSaved, setReceiptSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Automatically compress & store any shared receipt image from Android ACTION_SEND
  useEffect(() => {
    if (!initialImageDataUrl) return;
    let cancelled = false;
    void (async () => {
      const file = await dataUrlToFile(initialImageDataUrl);
      if (!file || cancelled) return;
      try {
        const compressed = await compressReceipt(file);
        if (cancelled) return;
        await saveReceipt(draftId, compressed);
        if (!cancelled) setReceiptSaved(true);
      } catch {
        // Fallback: save raw file blob if canvas compression is unavailable
        await saveReceipt(draftId, file);
        if (!cancelled) setReceiptSaved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialImageDataUrl, draftId]);

  const parsed = useMemo(
    () =>
      parseSmartFinancialInput(text, {
        wallets,
        categories,
        people,
        txns,
        currency: accountCurrency,
      }),
    [text, wallets, categories, people, txns, accountCurrency],
  );

  const matchedWallet = wallets.find((w) => w.id === parsed.walletId);
  const matchedToWallet = parsed.toWalletId ? wallets.find((w) => w.id === parsed.toWalletId) : undefined;
  const matchedCategory = categories.find((c) => c.id === parsed.categoryId);
  const matchedPerson = parsed.personId ? people.find((p) => p.id === parsed.personId) : undefined;

  async function handlePasteClipboard() {
    try {
      if (navigator.clipboard?.readText) {
        const clip = await navigator.clipboard.readText();
        if (clip && clip.trim()) {
          setText(clip.trim());
          toast(en ? "Pasted from clipboard" : "تم اللصق من الحافظة");
          return;
        }
      }
      toast(en ? "Clipboard is empty — long-press inside the box to paste" : "الحافظة فارغة أو محمية — اضغط مطولاً داخل المربع للصق");
    } catch {
      toast(en ? "Long-press inside the text box to paste" : "اضغط مطولاً داخل مربع النص للصق الرسالة");
    }
  }

  async function handlePickImage(file: File | null) {
    if (!file) return;
    try {
      const compressed = await compressReceipt(file);
      await saveReceipt(draftId, compressed);
      setReceiptPreview(URL.createObjectURL(compressed));
      setReceiptSaved(true);
      toast(en ? "Receipt attached locally" : "تم إرفاق صورة الإيصال محلياً");
    } catch {
      toast(en ? "Could not attach image" : "تعذّر إرفاق الصورة");
    }
  }

  function handleQuickRecord() {
    if (!parsed.amount || parsed.amount <= 0) {
      if (receiptSaved) {
        // Shared receipt image without SMS text -> jump straight into pre-attached TxnForm!
        openSheet({
          kind: "txn",
          prefill: {
            draftId,
            receiptAttached: true,
            kind: "expense",
            walletId: parsed.walletId,
            note: parsed.note || (en ? "Attached receipt" : "إيصال مرفق"),
          },
        });
        return;
      }
      toast(en ? "Write or paste a message containing an amount first" : "الصق الرسالة أو اكتب جملة تحتوي على المبلغ أولاً");
      return;
    }

    setSaving(true);
    try {
      if (parsed.kind === "transfer" && parsed.toWalletId && parsed.walletId !== parsed.toWalletId) {
        addTransfer({
          fromId: parsed.walletId,
          toId: parsed.toWalletId,
          amount: parsed.amount,
          date: todayISO(),
          note: parsed.note || (en ? "Smart transfer" : "تحويل ذكي"),
        });
        toast(en ? "Transfer recorded instantly" : "تم تسجيل التحويل بين المحافظ فوراً");
        closeSheet();
        return;
      }

      const txKind = parsed.kind === "income" ? "income" : "expense";
      const rate =
        parsed.currency === accountCurrency
          ? 1
          : effectiveExchangeRate(parsed.currency, accountCurrency, exchangeRates);

      addTxn({
        id: draftId,
        kind: txKind,
        amount: parsed.amount,
        currency: parsed.currency,
        exchangeRate: parsed.currency === accountCurrency ? undefined : rate,
        baseAmount: parsed.currency === accountCurrency ? undefined : round2(parsed.amount * rate),
        categoryId: parsed.categoryId,
        note: parsed.note,
        date: todayISO(),
        personId: parsed.personId,
        walletId: parsed.walletId,
        receiptId: receiptSaved ? draftId : undefined,
      });
      rememberEntryChoice(txKind, parsed.categoryId, parsed.walletId);
      toast(en ? "Transaction captured offline" : "تم التقاط وتسجيل الحركة بنجاح (١٠٠٪ أوفلاين)");
      closeSheet();
    } finally {
      setSaving(false);
    }
  }

  function handleOpenFullForm() {
    openSheet({
      kind: "txn",
      prefill: {
        draftId,
        receiptAttached: receiptSaved,
        kind: parsed.kind === "income" ? "income" : "expense",
        amount: parsed.amount ?? undefined,
        categoryId: parsed.categoryId || undefined,
        walletId: parsed.walletId || undefined,
        personId: parsed.personId,
        note: parsed.note,
      },
    });
  }

  return (
    <Sheet
      title={en ? "Offline Smart Capture" : "الالتقاط الذكي السريع"}
      description={
        en
          ? "Parse SMS or quick notes 100% offline and attach receipts"
          : "تحليل رسائل إنستا باي والبنوك محلياً ١٠٠٪ أوفلاين"
      }
      container={frame}
      onClose={closeSheet}
      trailing={
        <button
          type="button"
          onClick={handleQuickRecord}
          disabled={saving}
          className="min-h-10 px-2 text-body font-semibold text-tint disabled:opacity-50"
        >
          {en ? "Save" : "تسجيل"}
        </button>
      }
    >
      <div className="space-y-4 px-4 pb-6 pt-2">
        <div className="rounded-2xl bg-[var(--tint-soft)] p-3 text-caption text-tint">
          <div className="flex items-center gap-1.5 font-semibold">
            <Sparkles size={15} />
            <span>
              {en
                ? "100% Offline Privacy — Zero cloud OCR"
                : "تحليل فوري ١٠٠٪ أوفلاين بخصوصية كاملة على جهازك"}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-label-2">
            {en
              ? "Paste an InstaPay, Vodafone Cash, or bank SMS — or write naturally e.g. 'Paid 250 cafe from cash'."
              : "الصق رسالة إنستا باي أو فودافون كاش أو البنك — أو اكتب جملة عفوية مثل: «دفعت ٢٥٠ كافيه من كاش» أو «حولت ١٥٠٠ من البنك إلى فودافون كاش»."}
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="smart-capture-input" className="text-foot font-semibold text-label-2">
              {en ? "SMS / Notification / Quick Phrase" : "نص الرسالة أو الجملة السريعة"}
            </label>
            <button
              type="button"
              onClick={() => void handlePasteClipboard()}
              className="inline-flex items-center gap-1 rounded-pill bg-fill-3 px-2.5 py-1 text-[12px] font-medium text-tint active:opacity-75"
            >
              <ClipboardPaste size={13} />
              <span>{en ? "Paste" : "لصق"}</span>
            </button>
          </div>
          <textarea
            id="smart-capture-input"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              en
                ? "e.g. Transferred EGP 650 via InstaPay to Ahmed..."
                : "مثال: تم تحويل مبلغ 650 ج.م بنجاح عبر إنستاباي..."
            }
            className="w-full rounded-2xl border border-separator bg-surface p-3 text-body text-label outline-none focus:border-tint"
          />
        </div>

        {/* Live Parsed Preview */}
        <Section title={en ? "Detected Details" : "نتيجة التحليل الفوري"}>
          <div className="rounded-2xl border border-separator bg-surface p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-caption text-label-2">{en ? "Type" : "نوع الحركة"}</span>
              <span
                className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-caption font-semibold ${
                  parsed.kind === "income"
                    ? "bg-[color-mix(in_srgb,var(--green)_15%,transparent)] text-green"
                    : parsed.kind === "transfer"
                      ? "bg-[var(--tint-soft)] text-tint"
                      : "bg-[color-mix(in_srgb,var(--red)_14%,transparent)] text-red"
                }`}
              >
                {parsed.kind === "transfer" ? <ArrowLeftRight size={13} /> : <CheckCircle2 size={13} />}
                {parsed.kind === "income"
                  ? en
                    ? "Income"
                    : "إيراد وارد"
                  : parsed.kind === "transfer"
                    ? en
                      ? "Wallet Transfer"
                      : "تحويل بين المحافظ"
                    : en
                      ? "Expense"
                      : "مصروف صادر"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-caption text-label-2">{en ? "Amount" : "المبلغ المكتشف"}</span>
              <span className="text-headline font-bold text-label">
                {parsed.amount
                  ? `${formatNumber(parsed.amount, numeralStyle, lang)} ${currencySymbol(parsed.currency, lang)}`
                  : en
                    ? "—"
                    : "لم يُحدد بعد"}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-caption text-label-2">{en ? "Wallet" : "المحفظة"}</span>
              <span className="text-sub font-medium text-label">
                {parsed.kind === "transfer" && matchedToWallet
                  ? `${matchedWallet?.name ?? ""} ← ${matchedToWallet.name}`
                  : matchedWallet?.name ?? "—"}
              </span>
            </div>

            {parsed.kind !== "transfer" && matchedCategory ? (
              <div className="flex items-center justify-between">
                <span className="text-caption text-label-2">{en ? "Category" : "التصنيف المقترح"}</span>
                <span className="text-sub font-medium text-label">{catName(matchedCategory)}</span>
              </div>
            ) : null}

            {matchedPerson ? (
              <div className="flex items-center justify-between">
                <span className="text-caption text-label-2">{en ? "Person" : "الشخص المطابق"}</span>
                <span className="text-sub font-medium text-tint">{matchedPerson.name}</span>
              </div>
            ) : null}

            {parsed.note ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-caption text-label-2 shrink-0">{en ? "Note" : "البيان"}</span>
                <span className="truncate text-caption text-label">{parsed.note}</span>
              </div>
            ) : null}
          </div>
        </Section>

        {/* Shared / Attached Receipt Image */}
        <div className="rounded-2xl border border-separator bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sub font-medium text-label">
                {en ? "Receipt Screenshot" : "صورة الإيصال المرفقة"}
              </p>
              <p className="text-[12px] text-label-2">
                {receiptSaved
                  ? en
                    ? "Ready to attach automatically to this transaction"
                    : "مرفقة وجاهزة للربط التلقائي بالحركة"
                  : en
                    ? "Optional: attach an InstaPay or receipt screenshot"
                    : "اختياري: أرفق لقطة شاشة الإيصال لحفظها مع الحركة"}
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill bg-fill-3 px-3 py-1.5 text-caption font-semibold text-tint active:opacity-75">
              <ImagePlus size={15} />
              <span>{receiptSaved ? (en ? "Replace" : "تغيير") : en ? "Attach" : "إرفاق"}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void handlePickImage(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          {receiptPreview ? (
            <img
              src={receiptPreview}
              alt="Receipt preview"
              className="mt-3 max-h-44 w-full rounded-xl object-contain bg-bg-grouped"
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <PillButton onClick={handleQuickRecord} disabled={saving}>
            {parsed.amount
              ? en
                ? "Record Instantly"
                : "تسجيل الحركة فوراً بضغطة واحدة"
              : receiptSaved
                ? en
                  ? "Continue to Form with Receipt"
                  : "متابعة للنموذج مع الإيصال المرفق"
                : en
                  ? "Record Transaction"
                  : "تسجيل الحركة"}
          </PillButton>
          <button
            type="button"
            onClick={handleOpenFullForm}
            className="min-h-10 rounded-pill text-caption font-semibold text-tint active:opacity-75"
          >
            {en ? "Review & edit in full transaction form" : "مراجعة وتعديل التفاصيل في النموذج الكامل"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
