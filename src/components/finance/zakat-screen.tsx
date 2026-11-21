import { useMemo, useState } from "react";
import { Scale, CheckCircle2, Info, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Amount, Group, PillButton, Row, Section } from "@/components/finance/ui";
import { useMizan } from "@/components/finance/context";
import { useI18n } from "@/lib/finance/i18n";
import { currencySymbol, formatNumber, toLatinDigits } from "@/lib/finance/logic";
import { useFinance } from "@/lib/finance/store";
import {
  DEFAULT_GOLD_24K_GRAM_PRICE,
  NISAB_GOLD_24K_GRAMS,
  computeNetWorthZakat,
  loadSavedGold24kPrice,
  saveGold24kPrice,
} from "@/lib/finance/zakat";

export function ZakatScreen() {
  const { openSheet } = useMizan();
  const { lang, numeralStyle } = useI18n();
  const en = lang === "en";
  const data = useFinance();

  const initialGold = useMemo(() => loadSavedGold24kPrice(data.currency), [data.currency]);
  const [goldInput, setGoldInput] = useState(() => String(initialGold.pricePerGram));
  const [isCustom, setIsCustom] = useState(initialGold.isCustomSaved);

  const parsedGoldPrice = useMemo(() => {
    const n = Number(toLatinDigits(goldInput).replace(/,/g, "").trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [goldInput]);

  const breakdown = useMemo(
    () => computeNetWorthZakat(data, parsedGoldPrice),
    [data, parsedGoldPrice],
  );

  const sym = currencySymbol(data.currency, lang);

  function handleGoldPriceChange(raw: string) {
    const cleaned = toLatinDigits(raw).replace(/[^\d.]/g, "");
    if ((cleaned.match(/\./g) ?? []).length > 1) return;
    setGoldInput(cleaned);
    const val = Number(cleaned);
    if (Number.isFinite(val) && val > 0) {
      saveGold24kPrice(data.currency, val);
      setIsCustom(true);
    }
  }

  function handleResetExample() {
    const def = DEFAULT_GOLD_24K_GRAM_PRICE[data.currency] ?? 4250;
    setGoldInput(String(def));
    saveGold24kPrice(data.currency, def);
    setIsCustom(false);
    toast(en ? "Reset to illustrative gold price" : "تمت استعادة السعر الاسترشادي للذهب");
  }

  function handleRecordZakatExpense() {
    if (breakdown.zakatDue <= 0) return;
    openSheet({
      kind: "txn",
      prefill: {
        kind: "expense",
        amount: breakdown.zakatDue,
        note: en ? "Annual Zakat al-Mal (2.5%)" : "زكاة المال الشرعية (٢.٥٪)",
      },
    });
  }

  return (
    <div className="pb-12">
      <div data-stagger className="px-4">
        <h1 className="text-largetitle font-bold tracking-title">
          {en ? "Zakat Calculator" : "حاسبة زكاة المال"}
        </h1>
        {/* Hero Zakat Summary Card */}
        <div className="mt-3 rounded-3xl border border-separator bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-[var(--tint-soft)] px-3 py-1 text-caption font-semibold text-tint">
              <Scale size={14} />
              <span>
                {en
                  ? `Nisab: ${NISAB_GOLD_24K_GRAMS}g of 24K Gold • 2.5%`
                  : `نصاب ٨٥ جرام ذهب عيار ٢٤ • ربع العشر ٢.٥٪`}
              </span>
            </span>
            {breakdown.reachesNisab ? (
              <span className="inline-flex items-center gap-1 rounded-pill bg-[color-mix(in_srgb,var(--green)_15%,transparent)] px-2.5 py-1 text-[12px] font-semibold text-green">
                <CheckCircle2 size={13} />
                {en ? "Nisab Reached" : "بلغ النصاب"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-pill bg-fill-3 px-2.5 py-1 text-[12px] font-medium text-label-2">
                {en ? "Below Nisab" : "دون النصاب"}
              </span>
            )}
          </div>

          <p className="mt-4 text-caption text-label-2">
            {en ? "Zakat Due (2.5% of Net Zakatable Wealth)" : "مقدار الزكاة الواجبة (٢.٥٪ من صافي الثروة)"}
          </p>
          <p className="mt-1 text-largetitle font-bold tracking-title text-tint">
            <Amount value={breakdown.zakatDue} currency={data.currency} />
          </p>

          {!breakdown.reachesNisab && breakdown.nisabAmount > 0 ? (
            <p className="mt-2 text-caption text-label-2">
              {en
                ? `Remaining to reach Nisab (${formatNumber(breakdown.nisabAmount, numeralStyle, lang)} ${sym}): ${formatNumber(breakdown.shortfallToNisab, numeralStyle, lang)} ${sym}`
                : `متبقي لبلوغ النصاب (${formatNumber(breakdown.nisabAmount, numeralStyle, lang)} ${sym}): ${formatNumber(breakdown.shortfallToNisab, numeralStyle, lang)} ${sym}`}
            </p>
          ) : (
            <p className="mt-2 text-caption text-label-2">
              {en
                ? `Calculated when one lunar year (Hawl) passes above Nisab (${formatNumber(breakdown.nisabAmount, numeralStyle, lang)} ${sym}).`
                : `تجب الزكاة إذا حال الحول القمري على بلوغ النصاب (${formatNumber(breakdown.nisabAmount, numeralStyle, lang)} ${sym}).`}
            </p>
          )}

          {breakdown.zakatDue > 0 ? (
            <div className="mt-4">
              <PillButton onClick={handleRecordZakatExpense}>
                {en ? "Record Zakat Payment as Expense" : "تسجيل إخراج الزكاة كحركة مصروف"}
              </PillButton>
            </div>
          ) : null}
        </div>
      </div>

      {/* Editable 24K Gold Gram Price */}
      <Section title={en ? "24K Gold Gram Price (Nisab Benchmark)" : "سعر جرام الذهب عيار ٢٤ لحساب النصاب"}>
        <div className="rounded-2xl border border-separator bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="zakat-gold-price" className="text-sub font-semibold text-label">
              {en ? `1g of 24K Gold (${sym})` : `سعر جرام الذهب عيار ٢٤ (${sym})`}
            </label>
            <button
              type="button"
              onClick={handleResetExample}
              className="inline-flex items-center gap-1 text-caption font-medium text-tint active:opacity-75"
            >
              <RotateCcw size={13} />
              <span>{en ? "Example Price" : "سعر استرشادي"}</span>
            </button>
          </div>

          <input
            id="zakat-gold-price"
            type="text"
            inputMode="decimal"
            dir="ltr"
            value={goldInput}
            onChange={(e) => handleGoldPriceChange(e.target.value)}
            className="w-full rounded-xl border border-separator bg-bg-grouped px-3.5 py-2.5 text-headline font-bold text-label outline-none focus:border-tint"
          />

          <div className="flex items-start gap-2 rounded-xl bg-fill-4 p-2.5 text-[12px] text-label-2">
            <Info size={15} className="mt-0.5 shrink-0 text-tint" />
            <span>
              {isCustom
                ? en
                  ? `Saved custom price • Nisab (85g) = ${formatNumber(breakdown.nisabAmount, numeralStyle, lang)} ${sym}`
                  : `تم حفظ السعر المدخل • قيمة النصاب (٨٥ جرام) = ${formatNumber(breakdown.nisabAmount, numeralStyle, lang)} ${sym}`
                : en
                  ? `Illustrative example price — update it to today's local 24K gold price for exact Nisab (${formatNumber(breakdown.nisabAmount, numeralStyle, lang)} ${sym}).`
                  : `هذا الرقم مثال استرشادي تقريبي — يمكنك تعديله بسعر جرام الذهب عيار ٢٤ اليوم في بلدك لحساب النصاب بدقة (${formatNumber(breakdown.nisabAmount, numeralStyle, lang)} ${sym}).`}
            </span>
          </div>
        </div>
      </Section>

      {/* Comprehensive Net Worth Formula */}
      <Section title={en ? "Comprehensive Net-Worth Breakdown" : "تفصيل وعاء الزكاة وصافي الثروة"}>
        <Group>
          <Row
            title={en ? "Liquid Wallets & Accounts" : "إجمالي أرصدة المحافظ والحسابات"}
            sub={en ? "Cash, bank, InstaPay, and e-wallets" : "الكاش والحسابات البنكية والمحافظ الإلكترونية"}
            trailing={<Amount value={breakdown.walletsLiquidTotal} currency={data.currency} />}
          />
          <Row
            title={en ? "Savings Goals Balance" : "المدخرات في الأهداف المالية"}
            sub={en ? "Owned funds reserved inside goals" : "أموالك المملوكة المحجوزة داخل أهداف الادخار"}
            trailing={<Amount value={breakdown.goalsSavedTotal} currency={data.currency} />}
          />
          <Row
            title={en ? "Receivable Debts (Owed to You)" : "الديون المستحقة لك عند الغير"}
            sub={en ? "Remaining collectible receivables" : "إجمالي المتبقي لك من الديون النشطة"}
            trailing={<Amount value={breakdown.receivableDebtsTotal} currency={data.currency} />}
          />
          <Row
            title={en ? "Less: Full Payable Debts (You Owe)" : "يُخصم: كامل الديون المتبقية عليك"}
            sub={en ? "Deducted in full from zakatable assets" : "خصم كامل الرصيد المتبقي للالتزامات والديون التي عليك"}
            trailing={<Amount value={-breakdown.payableDebtsTotal} currency={data.currency} sign="auto" />}
          />
          <Row
            title={en ? "Net Zakatable Wealth" : "صافي الوعاء الزكوي"}
            sub={en ? "Assets + Receivables − Payables" : "المحافظ + المدخرات + ديون لك − ديون عليك"}
            trailing={
              <span className="font-bold text-tint">
                <Amount value={breakdown.netZakatableWealth} currency={data.currency} sign="auto" />
              </span>
            }
          />
        </Group>
      </Section>
    </div>
  );
}
