import { FileSpreadsheet, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useMizan } from "@/components/finance/context";
import { PillButton, Section, Sheet } from "@/components/finance/ui";
import { previewCsvImport, type CsvColumnMap } from "@/lib/finance/csv-import";
import { useI18n } from "@/lib/finance/i18n";
import { currencySymbol, formatNumber } from "@/lib/finance/logic";
import { useFinance } from "@/lib/finance/store";
import { CURRENCIES, type Currency } from "@/lib/finance/types";

export function CsvImportSheet() {
  const { closeSheet, frame } = useMizan();
  const { lang, numeralStyle, t } = useI18n();
  const data = useFinance();
  const importTransactionsBulk = useFinance((s) => s.importTransactionsBulk);

  const [csvText, setCsvText] = useState("");
  const [defaultWalletId, setDefaultWalletId] = useState(data.wallets[0]?.id ?? "w-cash");
  const [defaultCurrency, setDefaultCurrency] = useState<Currency>(data.currency);
  const [colOverride, setColOverride] = useState<Partial<CsvColumnMap>>({});

  const preview = useMemo(
    () =>
      previewCsvImport(csvText, data, {
        columnMap: colOverride,
        defaultWalletId,
        defaultCurrency,
      }),
    [csvText, data, colOverride, defaultWalletId, defaultCurrency],
  );

  function handleImport() {
    if (!preview.validInputs.length) {
      toast.error(lang === "en" ? "No valid transactions found to import" : "لا توجد حركات صالحة للاستيراد");
      return;
    }
    const count = importTransactionsBulk(preview.validInputs);
    toast.success(
      lang === "en"
        ? `Imported ${count} transactions locally`
        : `تم استيراد ${formatNumber(count, numeralStyle, lang)} حركة بنجاح`,
    );
    closeSheet();
  }

  return (
    <Sheet
      title={t("importCsv")}
      description={t("importCsvSub")}
      container={frame}
      onClose={closeSheet}
      trailing={
        <PillButton onClick={handleImport} disabled={!preview.validInputs.length}>
          {lang === "en" ? `Import (${preview.validInputs.length})` : `استيراد (${formatNumber(preview.validInputs.length, numeralStyle, lang)})`}
        </PillButton>
      }
    >
      <div className="px-4 pt-2">
        <label className="surface-card relative flex cursor-pointer items-center justify-center gap-2 rounded-cell px-4 py-4 text-sub font-semibold text-tint active:opacity-80">
          <Upload size={18} />
          <span>{lang === "en" ? "Choose CSV File" : "اختر ملف CSV من جهازك"}</span>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void file.text().then((text) => {
                setColOverride({});
                setCsvText(text);
              });
            }}
          />
        </label>
      </div>

      <Section title={lang === "en" ? "Or Paste CSV Data" : "أو الصق بيانات CSV هنا"}>
        <div className="surface-card mx-4 rounded-cell p-3">
          <textarea
            dir="ltr"
            rows={5}
            aria-label={lang === "en" ? "Paste CSV text" : "لصق بيانات CSV"}
            value={csvText}
            onChange={(e) => {
              setColOverride({});
              setCsvText(e.target.value);
            }}
            placeholder={
              "date,type,amount,category,note,currency\n2026-11-14,expense,250,Food,Lunch,EGP\n2026-11-12,income,1200,Freelance,UI Design,USD"
            }
            className="w-full resize-y bg-transparent font-mono text-caption text-label outline-none"
          />
        </div>
      </Section>

      <Section title={lang === "en" ? "Import Defaults" : "إعدادات الاستيراد الافتراضية"}>
        <div className="surface-card mx-4 overflow-hidden rounded-cell">
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-24 shrink-0 text-body">{lang === "en" ? "Wallet" : "المحفظة"}</span>
            <select
              className="field"
              value={defaultWalletId}
              onChange={(e) => setDefaultWalletId(e.target.value)}
            >
              {data.wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="row-sep" />
          <label className="flex min-h-11 items-center gap-3 px-4">
            <span className="w-24 shrink-0 text-body">{lang === "en" ? "Currency" : "العملة"}</span>
            <select
              className="field"
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value as Currency)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c} ({currencySymbol(c, lang)})
                </option>
              ))}
            </select>
          </label>
        </div>
      </Section>

      {preview.headers.length > 0 ? (
        <Section title={lang === "en" ? "Column Mapping" : "ربط الأعمدة"}>
          <div className="surface-card mx-4 grid grid-cols-2 gap-2 rounded-cell p-3">
            {(
              [
                ["date", lang === "en" ? "Date" : "التاريخ"],
                ["amount", lang === "en" ? "Amount" : "المبلغ"],
                ["kind", lang === "en" ? "Type" : "النوع"],
                ["note", lang === "en" ? "Note / Title" : "البيان"],
                ["category", lang === "en" ? "Category" : "الفئة"],
                ["currency", lang === "en" ? "Currency" : "العملة"],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="block">
                <span className="text-caption text-label-2">{label}</span>
                <select
                  className="field mt-1 rounded-inner bg-fill px-2 text-caption"
                  value={preview.columnMap[field]}
                  onChange={(e) =>
                    setColOverride((prev) => ({
                      ...prev,
                      [field]: Number(e.target.value),
                    }))
                  }
                >
                  <option value={-1}>{lang === "en" ? "Auto / None" : "تلقائي / بدون"}</option>
                  {preview.headers.map((h, idx) => (
                    <option key={`${h}-${idx}`} value={idx}>
                      {h || `Col ${idx + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Section>
      ) : null}

      {csvText.trim() ? (
        <Section
          title={
            lang === "en"
              ? `Preview: ${preview.validInputs.length} valid, ${preview.skippedRows.length} skipped`
              : `معاينة: ${formatNumber(preview.validInputs.length, numeralStyle, lang)} صالحة · ${formatNumber(preview.skippedRows.length, numeralStyle, lang)} متخطاة`
          }
        >
          {preview.validInputs.length ? (
            <div className="surface-card mx-4 overflow-hidden rounded-cell">
              {preview.validInputs.slice(0, 6).map((item, idx) => {
                const cat = data.categories.find((c) => c.id === item.categoryId);
                return (
                  <div key={idx}>
                    {idx > 0 ? <div className="row-sep" /> : null}
                    <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-sub">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-label">{item.note}</p>
                        <p className="truncate text-caption text-label-2">
                          {item.date} · {cat?.name ?? item.categoryId}
                        </p>
                      </div>
                      <span
                        dir="ltr"
                        className={`num shrink-0 font-semibold ${
                          item.kind === "income" ? "text-income" : "text-expense"
                        }`}
                      >
                        {item.kind === "income" ? "+" : "−"}
                        {formatNumber(item.amount, numeralStyle, lang)}{" "}
                        {currencySymbol(item.currency ?? data.currency, lang)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="surface-card mx-4 flex items-center gap-2 rounded-cell p-4 text-sub text-label-2">
              <FileSpreadsheet size={18} />
              <span>
                {lang === "en"
                  ? "Adjust column mapping above if columns were not detected automatically."
                  : "عدّل ربط الأعمدة أعلاه إذا لم يتعرّف الاستيراد عليها تلقائياً."}
              </span>
            </div>
          )}
        </Section>
      ) : null}
    </Sheet>
  );
}
