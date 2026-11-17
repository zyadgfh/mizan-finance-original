import { categoryLabel } from "./i18n.ts";
import { currencySymbol, formatNumber, reportMetrics, shortDate } from "./logic.ts";
import { getUiPrefs, type AppLanguage, type NumeralStyle } from "./prefs.ts";
import { downloadExportBlob } from "./store.ts";
import type { Currency, Data } from "./types.ts";

export type ReportPrivacyOptions = { redactSensitiveDetails?: boolean };

function reportDataView(data: Data, privacy: ReportPrivacyOptions = {}, lang: AppLanguage = "ar"): Data {
  if (!privacy.redactSensitiveDetails) return data;
  const personLabel = lang === "en" ? "Person" : "شخص";
  const debtLabel = lang === "en" ? "Debt" : "دين";
  return {
    ...data,
    people: data.people.map((person, index) => ({
      ...person,
      name: `${personLabel} ${index + 1}`,
      phone: "",
      note: "",
    })),
    debts: data.debts.map((debt, index) => ({ ...debt, title: `${debtLabel} ${index + 1}`, note: "" })),
    recurring: data.recurring.map((item) => ({ ...item, note: "" })),
  };
}

function csvCell(value: string | number) {
  let s = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function buildMonthlyReportJson(
  data: Data,
  month: string,
  lang: AppLanguage = getUiPrefs().language,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
  privacy: ReportPrivacyOptions = {},
): string {
  const safeData = reportDataView(data, privacy, lang);
  const report = reportMetrics(safeData, month, lang, numeralStyle);
  const { analyticsEnabled } = getUiPrefs();
  return JSON.stringify(
    {
      app: "Mizan Finance",
      generatedAt: new Date().toISOString(),
      language: lang,
      numeralStyle,
      currency: data.currency,
      ...report,
      analytics: analyticsEnabled ? report.analytics : undefined,
    },
    null,
    2,
  );
}

export function exportMonthlyReportJson(
  data: Data,
  month: string,
  lang: AppLanguage = getUiPrefs().language,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
  privacy: ReportPrivacyOptions = {},
): void {
  const json = buildMonthlyReportJson(data, month, lang, numeralStyle, privacy);
  downloadExportBlob(new Blob([json], { type: "application/json;charset=utf-8" }), `mizan-report-${month}.json`);
}

export function buildMonthlyReportCsv(
  data: Data,
  month: string,
  lang: AppLanguage = getUiPrefs().language,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
  privacy: ReportPrivacyOptions = {},
): string {
  const safeData = reportDataView(data, privacy, lang);
  const report = reportMetrics(safeData, month, lang, numeralStyle);
  const en = lang === "en";
  const lines: string[] = [
    [en ? "Mizan Monthly Report" : "تقرير ميزان الشهري", report.monthLabel, data.currency].map(csvCell).join(","),
    "",
    [en ? "Item" : "البند", en ? "Value" : "القيمة"].map(csvCell).join(","),
    [en ? "Total Income" : "إجمالي الإيرادات", report.income].map(csvCell).join(","),
    [en ? "Total Expenses" : "إجمالي المصروفات", report.expense].map(csvCell).join(","),
    [en ? "Net Change" : "صافي التغير في الرصيد", report.net].map(csvCell).join(","),
    [en ? "Available Cash" : "السيولة المتاحة الحالية", report.cashBalance].map(csvCell).join(","),
    [en ? "Prior Month Net" : "صافي الشهر السابق", report.prevNet].map(csvCell).join(","),
    [en ? "Owed to Me" : "إجمالي لي عند الناس", report.debtTotals.receivable].map(csvCell).join(","),
    [en ? "I Owe" : "إجمالي عليّ للناس", report.debtTotals.payable].map(csvCell).join(","),
    "",
    [en ? "Top Spending Categories" : "أعلى التصنيفات إنفاقاً", en ? "Amount" : "المبلغ", en ? "Prior Month" : "الشهر السابق"]
      .map(csvCell)
      .join(","),
    ...report.categories.map((c) => {
      const cat = data.categories.find((x) => x.id === c.id);
      return [categoryLabel(cat, lang) || c.name, c.value, c.prevValue].map(csvCell).join(",");
    }),
    "",
    [en ? "People Linked to Debts" : "الأشخاص المرتبطون بالديون", en ? "Owed to Me" : "لي", en ? "I Owe" : "عليّ", en ? "Net" : "الصافي"]
      .map(csvCell)
      .join(","),
    ...report.debtPeople.map((p) => [p.person.name, p.receivable, p.payable, p.net].map(csvCell).join(",")),
    "",
    [en ? "Upcoming Bills" : "الفواتير والاستحقاقات القادمة", en ? "Due" : "الاستحقاق", en ? "Amount" : "المبلغ", en ? "Type" : "النوع"]
      .map(csvCell)
      .join(","),
    ...report.upcomingBills.map((b) =>
      [b.title, b.due, b.amount, b.kind === "recurring" ? (en ? "Recurring" : "متكرر") : en ? "Debt" : "دين"]
        .map(csvCell)
        .join(","),
    ),
    "",
    [en ? "Prior Months Comparison" : "مقارنة الأشهر السابقة", en ? "Income" : "الإيرادات", en ? "Expenses" : "المصروفات", en ? "Net" : "الصافي"]
      .map(csvCell)
      .join(","),
    ...report.monthlyTrend.map((m) => [m.month, m.income, m.expense, m.net].map(csvCell).join(",")),
  ];
  return `\uFEFF${lines.join("\n")}`;
}

export function exportMonthlyReportCsv(
  data: Data,
  month: string,
  lang: AppLanguage = getUiPrefs().language,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
  privacy: ReportPrivacyOptions = {},
): void {
  const csv = buildMonthlyReportCsv(data, month, lang, numeralStyle, privacy);
  downloadExportBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `mizan-report-${month}.csv`);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildMonthlyReportHtml(
  data: Data,
  month: string,
  lang: AppLanguage = getUiPrefs().language,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
  privacy: ReportPrivacyOptions = {},
): string {
  const safeData = reportDataView(data, privacy, lang);
  const report = reportMetrics(safeData, month, lang, numeralStyle);
  const en = lang === "en";
  const dir = en ? "ltr" : "rtl";
  const sym = currencySymbol(data.currency, lang);
  const fmt = (n: number) => `${formatNumber(n, numeralStyle, lang)} ${sym}`;
  const { analyticsEnabled } = getUiPrefs();

  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8" />
<title>${en ? "Mizan Report" : "تقرير ميزان"} - ${escapeHtml(report.monthLabel)}</title>
<style>
  body { font-family: "IBM Plex Sans Arabic", -apple-system, BlinkMacSystemFont, sans-serif; color: #111; margin: 28px; line-height: 1.6; direction: ${dir}; }
  h1 { margin: 0 0 4px; font-size: 24px; }
  .sub { color: #555; margin: 0 0 20px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; background: #fafafa; }
  .card span { display: block; font-size: 12px; color: #666; }
  .card strong { font-size: 18px; }
  h2 { margin: 22px 0 8px; font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 6px; border-bottom: 1px solid #eee; text-align: ${en ? "left" : "right"}; }
  th { color: #555; font-weight: 600; }
  .numcol { direction: ltr; text-align: ${en ? "right" : "left"}; font-variant-numeric: tabular-nums; }
  @media print { body { margin: 12px; } }
</style>
</head>
<body>
  <h1>${en ? "Mizan Financial Report" : "تقرير ميزان المالي"} — ${escapeHtml(report.monthLabel)}</h1>
  <p class="sub">${en ? "Local private report ready for printing or saving as PDF" : "تقرير محلي قابل للطباعة والحفظ كـ PDF"}</p>
  <div class="grid">
    <div class="card"><span>${en ? "Total Income" : "إجمالي الإيرادات"}</span><strong dir="ltr">${escapeHtml(fmt(report.income))}</strong></div>
    <div class="card"><span>${en ? "Total Expenses" : "إجمالي المصروفات"}</span><strong dir="ltr">${escapeHtml(fmt(report.expense))}</strong></div>
    <div class="card"><span>${en ? "Net Change" : "صافي التغير"}</span><strong dir="ltr">${escapeHtml(fmt(report.net))}</strong></div>
  </div>
  ${
    analyticsEnabled
      ? `<div class="grid">
    <div class="card"><span>${en ? "Daily Average Spend" : "متوسط الإنفاق اليومي"}</span><strong dir="ltr">${escapeHtml(fmt(report.analytics.dailyAverageExpense))}</strong></div>
    <div class="card"><span>${en ? "Projected Month-End" : "المصروف المتوقع لنهاية الشهر"}</span><strong dir="ltr">${escapeHtml(fmt(report.analytics.projectedMonthEndExpense))}</strong></div>
    <div class="card"><span>${en ? "Uncategorized Items" : "حركات غير مصنّفة"}</span><strong>${escapeHtml(formatNumber(report.analytics.uncategorizedCount, numeralStyle, lang))}</strong></div>
  </div>`
      : ""
  }
  <h2>${en ? "Top Spending Categories" : "أعلى التصنيفات إنفاقاً"}</h2>
  <table>
    <thead><tr><th>${en ? "Category" : "التصنيف"}</th><th class="numcol">${en ? "This Month" : "هذا الشهر"}</th><th class="numcol">${en ? "Prior Month" : "الشهر السابق"}</th></tr></thead>
    <tbody>
      ${
        report.categories.length
          ? report.categories
              .map((c) => {
                const cat = data.categories.find((x) => x.id === c.id);
                const label = categoryLabel(cat, lang) || c.name;
                return `<tr><td>${escapeHtml(label)}</td><td class="numcol">${escapeHtml(fmt(c.value))}</td><td class="numcol">${escapeHtml(fmt(c.prevValue))}</td></tr>`;
              })
              .join("")
          : `<tr><td colspan="3">${en ? "No expenses recorded this month" : "لا توجد مصروفات مسجلة في هذا الشهر"}</td></tr>`
      }
    </tbody>
  </table>
  <h2>${en ? "People Linked to Debts" : "أكثر الأشخاص ارتباطاً بالديون"}</h2>
  <table>
    <thead><tr><th>${en ? "Person" : "الشخص"}</th><th class="numcol">${en ? "Owed to Me" : "لي"}</th><th class="numcol">${en ? "I Owe" : "عليّ"}</th><th class="numcol">${en ? "Net" : "الصافي"}</th></tr></thead>
    <tbody>
      ${
        report.debtPeople.length
          ? report.debtPeople
              .map(
                (p) =>
                  `<tr><td>${escapeHtml(p.person.name)}</td><td class="numcol">${escapeHtml(fmt(p.receivable))}</td><td class="numcol">${escapeHtml(fmt(p.payable))}</td><td class="numcol">${escapeHtml(fmt(p.net))}</td></tr>`,
              )
              .join("")
          : `<tr><td colspan="4">${en ? "No active debts currently" : "لا ديون نشطة حالياً"}</td></tr>`
      }
    </tbody>
  </table>
  <h2>${en ? "6-Month Comparison" : "مقارنة الأشهر السابقة"}</h2>
  <table>
    <thead><tr><th>${en ? "Month" : "الشهر"}</th><th class="numcol">${en ? "Income" : "الإيرادات"}</th><th class="numcol">${en ? "Expenses" : "المصروفات"}</th><th class="numcol">${en ? "Net" : "الصافي"}</th></tr></thead>
    <tbody>
      ${report.monthlyTrend
        .map(
          (m) =>
            `<tr><td>${escapeHtml(numeralStyle === "arab" ? formatNumber(Number(m.month.slice(5, 7)), "arab", lang) + "/" + formatNumber(Number(m.month.slice(0, 4)), "arab", lang) : m.month)}</td><td class="numcol">${escapeHtml(fmt(m.income))}</td><td class="numcol">${escapeHtml(fmt(m.expense))}</td><td class="numcol">${escapeHtml(fmt(m.net))}</td></tr>`,
        )
        .join("")}
    </tbody>
  </table>
</body>
</html>`;
}

export function exportMonthlyReportPdf(
  data: Data,
  month: string,
  lang: AppLanguage = getUiPrefs().language,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
  privacy: ReportPrivacyOptions = {},
): "printed" | "downloaded" {
  const html = buildMonthlyReportHtml(data, month, lang, numeralStyle, privacy);
  const nativeBridge = (
    window as Window & {
      MizanNative?: { shareFile?: (name: string, mimeType: string, content: string) => boolean };
    }
  ).MizanNative;
  if (nativeBridge?.shareFile) {
    downloadExportBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `mizan-report-${month}.html`);
    return "downloaded";
  }
  const win = typeof window !== "undefined" ? window.open("", "_blank", "noopener,noreferrer") : null;
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    window.setTimeout(() => {
      try {
        win.print();
      } catch {
        /* ignore blocked print dialog */
      }
    }, 250);
    return "printed";
  }
  downloadExportBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `mizan-report-${month}.html`);
  return "downloaded";
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function moneyTxt(n: number, currency: Currency, numeralStyle: NumeralStyle, lang: AppLanguage) {
  return `${formatNumber(n, numeralStyle, lang)} ${currencySymbol(currency, lang)}`;
}

export async function renderMonthlyReportPng(
  data: Data,
  month: string,
  lang: AppLanguage = getUiPrefs().language,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
  privacy: ReportPrivacyOptions = {},
): Promise<Blob> {
  const safeData = reportDataView(data, privacy, lang);
  const report = reportMetrics(safeData, month, lang, numeralStyle);
  const en = lang === "en";
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1360;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");

  const startEdgeX = en ? 100 : 980;
  const endEdgeX = en ? 980 : 100;
  const headerStartX = en ? 112 : 968;

  ctx.fillStyle = "#F2F2F7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Header card
  ctx.fillStyle = "#0088FF";
  drawRoundedRect(ctx, 56, 56, 968, 220, 32);
  ctx.fill();

  ctx.direction = en ? "ltr" : "rtl";
  ctx.textAlign = en ? "left" : "right";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = 'bold 44px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(en ? "Mizan · Monthly Report" : "ميزان · التقرير الشهري", headerStartX, 132);
  ctx.font = '500 28px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fillText(report.monthLabel, headerStartX, 184);
  ctx.font = 'bold 34px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillStyle = "#FFFFFF";
  const netSign = report.net >= 0 ? "+" : "−";
  ctx.fillText(
    `${en ? "Monthly Net:" : "صافي الشهر:"} ${netSign}${moneyTxt(Math.abs(report.net), data.currency, numeralStyle, lang)}`,
    headerStartX,
    240,
  );

  // Summary cards
  const cards = [
    { label: en ? "Income" : "الإيرادات", val: moneyTxt(report.income, data.currency, numeralStyle, lang), color: "#34C759" },
    { label: en ? "Expenses" : "المصروفات", val: moneyTxt(report.expense, data.currency, numeralStyle, lang), color: "#FF383C" },
    { label: en ? "Cash Balance" : "السيولة المتاحة", val: moneyTxt(report.cashBalance, data.currency, numeralStyle, lang), color: "#0088FF" },
  ];
  cards.forEach((c, idx) => {
    const orderedIdx = en ? idx : 2 - idx;
    const x = 56 + orderedIdx * (308 + 22);
    ctx.fillStyle = "#FFFFFF";
    drawRoundedRect(ctx, x, 304, 308, 148, 24);
    ctx.fill();
    const cardTextX = en ? x + 28 : x + 280;
    ctx.textAlign = en ? "left" : "right";
    ctx.fillStyle = "#6B7280";
    ctx.font = '500 24px "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(c.label, cardTextX, 356);
    ctx.fillStyle = c.color;
    ctx.font = 'bold 30px "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(c.val, cardTextX, 412);
  });

  // Top Categories card
  ctx.fillStyle = "#FFFFFF";
  drawRoundedRect(ctx, 56, 480, 968, 450, 28);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.textAlign = en ? "left" : "right";
  ctx.font = 'bold 30px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(en ? "Top Spending Categories" : "أعلى التصنيفات إنفاقاً", startEdgeX, 536);

  const maxCat = Math.max(1, ...report.categories.slice(0, 5).map((c) => c.value));
  const palette = ["#0088FF", "#FF8D28", "#FF383C", "#34C759", "#8E8E93"];
  report.categories.slice(0, 5).forEach((c, idx) => {
    const rowY = 588 + idx * 66;
    const cat = data.categories.find((x) => x.id === c.id);
    const label = categoryLabel(cat, lang) || c.name;
    ctx.fillStyle = "#111827";
    ctx.font = '500 24px "IBM Plex Sans Arabic", sans-serif';
    ctx.textAlign = en ? "left" : "right";
    ctx.fillText(label, startEdgeX, rowY);
    ctx.textAlign = en ? "right" : "left";
    ctx.fillStyle = "#4B5563";
    ctx.fillText(moneyTxt(c.value, data.currency, numeralStyle, lang), endEdgeX, rowY);
    ctx.textAlign = en ? "left" : "right";
    ctx.fillStyle = "#E5E7EB";
    drawRoundedRect(ctx, 92, rowY + 14, 888, 12, 6);
    ctx.fill();
    const fillW = Math.max(16, 888 * (c.value / maxCat));
    ctx.fillStyle = palette[idx % palette.length];
    drawRoundedRect(ctx, en ? 92 : 92 + (888 - fillW), rowY + 14, fillW, 12, 6);
    ctx.fill();
  });

  // Debts & Upcoming footer card
  ctx.fillStyle = "#FFFFFF";
  drawRoundedRect(ctx, 56, 956, 968, 320, 28);
  ctx.fill();
  ctx.textAlign = en ? "left" : "right";
  ctx.fillStyle = "#111827";
  ctx.font = 'bold 28px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(en ? "Debts & Upcoming Bills" : "ملخص الديون والفواتير القادمة", startEdgeX, 1012);
  ctx.font = '500 24px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillStyle = "#34C759";
  ctx.fillText(
    `${en ? "Owed to Me:" : "لي عند الناس:"} ${moneyTxt(report.debtTotals.receivable, data.currency, numeralStyle, lang)}`,
    startEdgeX,
    1070,
  );
  ctx.fillStyle = "#FF383C";
  ctx.fillText(
    `${en ? "I Owe:" : "عليّ للناس:"} ${moneyTxt(report.debtTotals.payable, data.currency, numeralStyle, lang)}`,
    startEdgeX,
    1116,
  );
  ctx.fillStyle = "#4B5563";
  const nextBill = report.upcomingBills[0];
  ctx.fillText(
    nextBill
      ? `${en ? "Next Due:" : "أقرب استحقاق:"} ${nextBill.title} (${shortDate(nextBill.due, lang, numeralStyle)}) — ${moneyTxt(nextBill.amount, data.currency, numeralStyle, lang)}`
      : en
        ? "No bills due within the next 30 days"
        : "لا توجد استحقاقات قادمة خلال 30 يوماً",
    startEdgeX,
    1174,
  );
  ctx.fillStyle = "#9CA3AF";
  ctx.font = '500 20px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(en ? "Generated locally by Mizan Finance" : "تم إنشاء التقرير محلياً عبر تطبيق ميزان", startEdgeX, 1244);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG generation failed"));
    }, "image/png");
  });
}

export async function shareMonthlyReportImage(
  data: Data,
  month: string,
  lang: AppLanguage = getUiPrefs().language,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
  privacy: ReportPrivacyOptions = {},
): Promise<void> {
  const blob = await renderMonthlyReportPng(data, month, lang, numeralStyle, privacy);
  const filename = `mizan-report-${month}.png`;
  const nativeBridge = (
    window as Window & {
      MizanNative?: { shareBinaryFile?: (name: string, mimeType: string, base64: string) => boolean };
    }
  ).MizanNative;

  if (nativeBridge?.shareBinaryFile) {
    const buffer = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (const b of bytes) binary += String.fromCharCode(b);
    if (nativeBridge.shareBinaryFile(filename, "image/png", btoa(binary))) return;
  }

  if (typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
    const file = new File([blob], filename, { type: "image/png" });
    if (navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: `Mizan Report ${month}` });
      return;
    }
  }

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
