import { currencySymbol, formatNumber, reportMetrics, shortDate } from "./logic.ts";
import { downloadExportBlob } from "./store.ts";
import type { Currency, Data } from "./types.ts";

function csvCell(value: string | number) {
  let s = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function buildMonthlyReportJson(data: Data, month: string): string {
  const report = reportMetrics(data, month);
  return JSON.stringify(
    {
      app: "Mizan Finance",
      generatedAt: new Date().toISOString(),
      currency: data.currency,
      ...report,
    },
    null,
    2,
  );
}

export function exportMonthlyReportJson(data: Data, month: string): void {
  const json = buildMonthlyReportJson(data, month);
  downloadExportBlob(new Blob([json], { type: "application/json;charset=utf-8" }), `mizan-report-${month}.json`);
}

export function buildMonthlyReportCsv(data: Data, month: string): string {
  const report = reportMetrics(data, month);
  const lines: string[] = [
    ["تقرير ميزان الشهري", report.monthLabel, data.currency].map(csvCell).join(","),
    "",
    ["البند", "القيمة"].map(csvCell).join(","),
    ["إجمالي الإيرادات", report.income].map(csvCell).join(","),
    ["إجمالي المصروفات", report.expense].map(csvCell).join(","),
    ["صافي التغير في الرصيد", report.net].map(csvCell).join(","),
    ["السيولة المتاحة الحالية", report.cashBalance].map(csvCell).join(","),
    ["صافي الشهر السابق", report.prevNet].map(csvCell).join(","),
    ["إجمالي لي عند الناس", report.debtTotals.receivable].map(csvCell).join(","),
    ["إجمالي عليّ للناس", report.debtTotals.payable].map(csvCell).join(","),
    "",
    ["أعلى التصنيفات إنفاقاً", "المبلغ", "الشهر السابق"].map(csvCell).join(","),
    ...report.categories.map((c) => [c.name, c.value, c.prevValue].map(csvCell).join(",")),
    "",
    ["الأشخاص المرتبطون بالديون", "لي", "عليّ", "الصافي"].map(csvCell).join(","),
    ...report.debtPeople.map((p) => [p.person.name, p.receivable, p.payable, p.net].map(csvCell).join(",")),
    "",
    ["الفواتير والاستحقاقات القادمة", "الاستحقاق", "المبلغ", "النوع"].map(csvCell).join(","),
    ...report.upcomingBills.map((b) =>
      [b.title, b.due, b.amount, b.kind === "recurring" ? "متكرر" : "دين"].map(csvCell).join(","),
    ),
    "",
    ["مقارنة الأشهر السابقة", "الإيرادات", "المصروفات", "الصافي"].map(csvCell).join(","),
    ...report.monthlyTrend.map((m) => [m.month, m.income, m.expense, m.net].map(csvCell).join(",")),
  ];
  return `\uFEFF${lines.join("\n")}`;
}

export function exportMonthlyReportCsv(data: Data, month: string): void {
  const csv = buildMonthlyReportCsv(data, month);
  downloadExportBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `mizan-report-${month}.csv`);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildMonthlyReportHtml(data: Data, month: string): string {
  const report = reportMetrics(data, month);
  const sym = currencySymbol(data.currency);
  const fmt = (n: number) => `${formatNumber(n)} ${sym}`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>تقرير ميزان - ${escapeHtml(report.monthLabel)}</title>
<style>
  body { font-family: "IBM Plex Sans Arabic", -apple-system, BlinkMacSystemFont, sans-serif; color: #111; margin: 28px; line-height: 1.6; }
  h1 { margin: 0 0 4px; font-size: 24px; }
  .sub { color: #555; margin: 0 0 20px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; background: #fafafa; }
  .card span { display: block; font-size: 12px; color: #666; }
  .card strong { font-size: 18px; }
  h2 { margin: 22px 0 8px; font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 6px; border-bottom: 1px solid #eee; text-align: right; }
  th { color: #555; font-weight: 600; }
  @media print { body { margin: 12px; } }
</style>
</head>
<body>
  <h1>تقرير ميزان المالي — ${escapeHtml(report.monthLabel)}</h1>
  <p class="sub">تقرير محلي قابل للطباعة والحفظ كـ PDF</p>
  <div class="grid">
    <div class="card"><span>إجمالي الإيرادات</span><strong dir="ltr">${escapeHtml(fmt(report.income))}</strong></div>
    <div class="card"><span>إجمالي المصروفات</span><strong dir="ltr">${escapeHtml(fmt(report.expense))}</strong></div>
    <div class="card"><span>صافي التغير</span><strong dir="ltr">${escapeHtml(fmt(report.net))}</strong></div>
  </div>
  <h2>أعلى التصنيفات إنفاقاً</h2>
  <table>
    <thead><tr><th>التصنيف</th><th>هذا الشهر</th><th>الشهر السابق</th></tr></thead>
    <tbody>
      ${
        report.categories.length
          ? report.categories
              .map(
                (c) =>
                  `<tr><td>${escapeHtml(c.name)}</td><td dir="ltr">${escapeHtml(fmt(c.value))}</td><td dir="ltr">${escapeHtml(fmt(c.prevValue))}</td></tr>`,
              )
              .join("")
          : '<tr><td colspan="3">لا توجد مصروفات مسجلة في هذا الشهر</td></tr>'
      }
    </tbody>
  </table>
  <h2>أكثر الأشخاص ارتباطاً بالديون</h2>
  <table>
    <thead><tr><th>الشخص</th><th>لي</th><th>عليّ</th><th>الصافي</th></tr></thead>
    <tbody>
      ${
        report.debtPeople.length
          ? report.debtPeople
              .map(
                (p) =>
                  `<tr><td>${escapeHtml(p.person.name)}</td><td dir="ltr">${escapeHtml(fmt(p.receivable))}</td><td dir="ltr">${escapeHtml(fmt(p.payable))}</td><td dir="ltr">${escapeHtml(fmt(p.net))}</td></tr>`,
              )
              .join("")
          : '<tr><td colspan="4">لا ديون نشطة حالياً</td></tr>'
      }
    </tbody>
  </table>
  <h2>مقارنة الأشهر السابقة</h2>
  <table>
    <thead><tr><th>الشهر</th><th>الإيرادات</th><th>المصروفات</th><th>الصافي</th></tr></thead>
    <tbody>
      ${report.monthlyTrend
        .map(
          (m) =>
            `<tr><td>${escapeHtml(m.month)}</td><td dir="ltr">${escapeHtml(fmt(m.income))}</td><td dir="ltr">${escapeHtml(fmt(m.expense))}</td><td dir="ltr">${escapeHtml(fmt(m.net))}</td></tr>`,
        )
        .join("")}
    </tbody>
  </table>
</body>
</html>`;
}

export function exportMonthlyReportPdf(data: Data, month: string): "printed" | "downloaded" {
  const html = buildMonthlyReportHtml(data, month);
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

function moneyTxt(n: number, currency: Currency) {
  return `${formatNumber(n)} ${currencySymbol(currency)}`;
}

export async function renderMonthlyReportPng(data: Data, month: string): Promise<Blob> {
  const report = reportMetrics(data, month);
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1360;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");

  // Background
  ctx.fillStyle = "#F2F2F7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Header card
  ctx.fillStyle = "#0088FF";
  drawRoundedRect(ctx, 56, 56, 968, 220, 32);
  ctx.fill();

  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = 'bold 44px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText("ميزان · التقرير الشهري", 968, 132);
  ctx.font = '500 28px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fillText(report.monthLabel, 968, 184);
  ctx.font = 'bold 34px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(`صافي الشهر: ${report.net >= 0 ? "+" : "−"}${moneyTxt(Math.abs(report.net), data.currency)}`, 968, 240);

  // Summary row (Income / Expense / Cash)
  const cards = [
    { label: "الإيرادات", val: moneyTxt(report.income, data.currency), color: "#34C759" },
    { label: "المصروفات", val: moneyTxt(report.expense, data.currency), color: "#FF383C" },
    { label: "السيولة المتاحة", val: moneyTxt(report.cashBalance, data.currency), color: "#0088FF" },
  ];
  cards.forEach((c, idx) => {
    const x = 56 + idx * (308 + 22);
    ctx.fillStyle = "#FFFFFF";
    drawRoundedRect(ctx, x, 304, 308, 148, 24);
    ctx.fill();
    ctx.fillStyle = "#6B7280";
    ctx.font = '500 24px "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(c.label, x + 280, 356);
    ctx.fillStyle = c.color;
    ctx.font = 'bold 30px "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(c.val, x + 280, 412);
  });

  // Top Categories card
  ctx.fillStyle = "#FFFFFF";
  drawRoundedRect(ctx, 56, 480, 968, 450, 28);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.font = 'bold 30px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText("أعلى التصنيفات إنفاقاً", 980, 536);

  const maxCat = Math.max(1, ...report.categories.slice(0, 5).map((c) => c.value));
  const palette = ["#0088FF", "#FF8D28", "#FF383C", "#34C759", "#8E8E93"];
  report.categories.slice(0, 5).forEach((c, idx) => {
    const rowY = 588 + idx * 66;
    ctx.fillStyle = "#111827";
    ctx.font = '500 24px "IBM Plex Sans Arabic", sans-serif';
    ctx.textAlign = "right";
    ctx.fillText(c.name, 980, rowY);
    ctx.textAlign = "left";
    ctx.fillStyle = "#4B5563";
    ctx.fillText(moneyTxt(c.value, data.currency), 92, rowY);
    ctx.textAlign = "right";
    ctx.fillStyle = "#E5E7EB";
    drawRoundedRect(ctx, 92, rowY + 14, 888, 12, 6);
    ctx.fill();
    ctx.fillStyle = palette[idx % palette.length];
    drawRoundedRect(ctx, 92 + 888 * (1 - c.value / maxCat), rowY + 14, Math.max(16, 888 * (c.value / maxCat)), 12, 6);
    ctx.fill();
  });

  // Debts & Upcoming footer card
  ctx.fillStyle = "#FFFFFF";
  drawRoundedRect(ctx, 56, 956, 968, 320, 28);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.font = 'bold 28px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText("ملخص الديون والفواتير القادمة", 980, 1012);
  ctx.font = '500 24px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillStyle = "#34C759";
  ctx.fillText(`لي عند الناس: ${moneyTxt(report.debtTotals.receivable, data.currency)}`, 980, 1070);
  ctx.fillStyle = "#FF383C";
  ctx.fillText(`عليّ للناس: ${moneyTxt(report.debtTotals.payable, data.currency)}`, 980, 1116);
  ctx.fillStyle = "#4B5563";
  const nextBill = report.upcomingBills[0];
  ctx.fillText(
    nextBill
      ? `أقرب استحقاق: ${nextBill.title} (${shortDate(nextBill.due)}) — ${moneyTxt(nextBill.amount, data.currency)}`
      : "لا توجد استحقاقات قادمة خلال 30 يوماً",
    980,
    1174,
  );
  ctx.fillStyle = "#9CA3AF";
  ctx.font = '500 20px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText("تم إنشاء التقرير محلياً عبر تطبيق ميزان", 980, 1244);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG generation failed"));
    }, "image/png");
  });
}

export async function shareMonthlyReportImage(data: Data, month: string): Promise<void> {
  const blob = await renderMonthlyReportPng(data, month);
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
      await navigator.share({ files: [file], title: `تقرير ميزان ${month}` });
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
