import {
  currencySymbol,
  debtStatus,
  formatNumber,
  paidOf,
  remaining,
  round2,
  shortDate,
  todayISO,
} from "./logic.ts";
import { getUiPrefs, type AppLanguage, type NumeralStyle } from "./prefs.ts";
import type { Currency, Data, DebtDirection } from "./types.ts";

export type StatementDebtItem = {
  id: string;
  title: string;
  direction: DebtDirection;
  principal: number;
  paid: number;
  remaining: number;
  dueDate: string;
  status: "active" | "overdue" | "completed";
  note: string;
};

export type StatementPaymentItem = {
  id: string;
  debtId: string;
  debtTitle: string;
  direction: DebtDirection;
  date: string;
  amount: number;
  note: string;
};

export type PersonDebtStatement = {
  workspaceName: string;
  generatedDate: string;
  currency: Currency;
  person: {
    id: string;
    name: string;
    phone: string;
    note: string;
  };
  summary: {
    receivablePrincipal: number;
    receivablePaid: number;
    receivableRemaining: number;
    payablePrincipal: number;
    payablePaid: number;
    payableRemaining: number;
    /** Positive = person owes user; Negative = user owes person */
    netBalance: number;
  };
  debts: StatementDebtItem[];
  payments: StatementPaymentItem[];
};

export function computePersonDebtStatement(
  data: Pick<Data, "people" | "debts" | "payments" | "currency">,
  personId: string,
  workspaceName = "ميزان لإدارة الأموال",
  today = todayISO(),
): PersonDebtStatement | null {
  const person = data.people.find((p) => p.id === personId);
  if (!person) return null;

  const linkedDebts = data.debts
    .filter((d) => d.personId === person.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const debtMap = new Map(linkedDebts.map((d) => [d.id, d]));

  let receivablePrincipal = 0;
  let receivablePaid = 0;
  let receivableRemaining = 0;
  let payablePrincipal = 0;
  let payablePaid = 0;
  let payableRemaining = 0;

  const statementDebts: StatementDebtItem[] = linkedDebts.map((d) => {
    const paid = round2(paidOf(d.id, data.payments));
    const rem = round2(remaining(d, data.payments));
    const status = debtStatus(d, data.payments, today);

    if (d.direction === "receivable") {
      receivablePrincipal = round2(receivablePrincipal + d.principal);
      receivablePaid = round2(receivablePaid + paid);
      receivableRemaining = round2(receivableRemaining + rem);
    } else {
      payablePrincipal = round2(payablePrincipal + d.principal);
      payablePaid = round2(payablePaid + paid);
      payableRemaining = round2(payableRemaining + rem);
    }

    return {
      id: d.id,
      title: d.title,
      direction: d.direction,
      principal: d.principal,
      paid,
      remaining: rem,
      dueDate: d.dueDate,
      status,
      note: d.note,
    };
  });

  const statementPayments: StatementPaymentItem[] = data.payments
    .filter((p) => debtMap.has(p.debtId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .map((p) => {
      const debt = debtMap.get(p.debtId)!;
      return {
        id: p.id,
        debtId: debt.id,
        debtTitle: debt.title,
        direction: debt.direction,
        date: p.date,
        amount: round2(p.amount),
        note: p.note,
      };
    });

  return {
    workspaceName,
    generatedDate: today,
    currency: data.currency,
    person: {
      id: person.id,
      name: person.name,
      phone: person.phone,
      note: person.note,
    },
    summary: {
      receivablePrincipal,
      receivablePaid,
      receivableRemaining,
      payablePrincipal,
      payablePaid,
      payableRemaining,
      netBalance: round2(receivableRemaining - payableRemaining),
    },
    debts: statementDebts,
    payments: statementPayments,
  };
}

export type JpegPageBuffer = {
  widthPx: number;
  heightPx: number;
  jpegBytes: Uint8Array;
};

/**
 * Wraps one or more rasterized A4 JPEG pages into a genuine, standards-compliant
 * multi-page ISO PDF-1.4 binary (`%PDF-1.4 ... %%EOF`) with exact byte-offset xref table.
 * Preserves 100% of connected Arabic RTL typography without external font/PDF libraries.
 */
export function encodeJpegPagesIntoPdf(pages: JpegPageBuffer[]): Uint8Array {
  if (!pages.length) {
    throw new Error("At least one page is required to generate a PDF document");
  }

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    byteLength += bytes.byteLength;
  };
  const pushAscii = (text: string) => {
    pushBytes(encoder.encode(text));
  };

  // Standard A4 size in PDF points (72 pt/inch): 595.28 x 841.89
  const pagePtW = 595.28;
  const pagePtH = 841.89;

  // Object numbering layout:
  // 1: Catalog
  // 2: Pages root
  // For each page i (0..N-1):
  //   pageObjId    = 3 + i * 3
  //   contentObjId = 4 + i * 3
  //   imageObjId   = 5 + i * 3
  const totalObjects = 2 + pages.length * 3;
  const offsets = new Array<number>(totalObjects + 1).fill(0);

  pushAscii("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");

  // 1: Catalog
  offsets[1] = byteLength;
  pushAscii("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // 2: Pages
  const kidsRefs = pages.map((_, idx) => `${3 + idx * 3} 0 R`).join(" ");
  offsets[2] = byteLength;
  pushAscii(`2 0 obj\n<< /Type /Pages /Count ${pages.length} /Kids [ ${kidsRefs} ] >>\nendobj\n`);

  pages.forEach((page, idx) => {
    const pageObjId = 3 + idx * 3;
    const contentObjId = 4 + idx * 3;
    const imageObjId = 5 + idx * 3;
    const imgName = `/Im${idx + 1}`;

    const contentStream = `q\n${pagePtW.toFixed(2)} 0 0 ${pagePtH.toFixed(2)} 0 0 cm\n${imgName} Do\nQ\n`;
    const contentBytes = encoder.encode(contentStream);

    // Page object
    offsets[pageObjId] = byteLength;
    pushAscii(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${pagePtW.toFixed(2)} ${pagePtH.toFixed(2)} ] /Resources << /XObject << ${imgName} ${imageObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`,
    );

    // Content stream object
    offsets[contentObjId] = byteLength;
    pushAscii(`${contentObjId} 0 obj\n<< /Length ${contentBytes.byteLength} >>\nstream\n`);
    pushBytes(contentBytes);
    pushAscii("endstream\nendobj\n");

    // Image XObject (DCTDecode raw JPEG bytes)
    offsets[imageObjId] = byteLength;
    pushAscii(
      `${imageObjId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${Math.round(page.widthPx)} /Height ${Math.round(page.heightPx)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpegBytes.byteLength} >>\nstream\n`,
    );
    pushBytes(page.jpegBytes);
    pushAscii("\nendstream\nendobj\n");
  });

  const xrefOffset = byteLength;
  pushAscii(`xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= totalObjects; id += 1) {
    const padded = String(offsets[id] ?? 0).padStart(10, "0");
    pushAscii(`${padded} 00000 n \n`);
  }

  pushAscii(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  const merged = new Uint8Array(byteLength);
  let cursor = 0;
  for (const chunk of chunks) {
    merged.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return merged;
}

function drawRoundedBox(
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

async function canvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
  );
  if (blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const b64 = dataUrl.split(",")[1] ?? "";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

type RenderRow =
  | { kind: "section"; title: string }
  | { kind: "debt-header" }
  | { kind: "debt"; item: StatementDebtItem }
  | { kind: "payment-header" }
  | { kind: "payment"; item: StatementPaymentItem };

export async function renderStatementPdfBytes(
  statement: PersonDebtStatement,
  lang: AppLanguage = getUiPrefs().language,
  numeralStyle: NumeralStyle = getUiPrefs().numeralStyle,
): Promise<Uint8Array> {
  const W = 1240;
  const H = 1754;
  const en = lang === "en";
  const sym = currencySymbol(statement.currency, lang);
  const fmtMoney = (v: number) => `${formatNumber(round2(Math.abs(v)), numeralStyle, lang)} ${sym}`;

  const rows: RenderRow[] = [];
  rows.push({ kind: "section", title: en ? "Debts & Installments" : "تفاصيل الديون المسجلة" });
  rows.push({ kind: "debt-header" });
  for (const d of statement.debts) {
    rows.push({ kind: "debt", item: d });
  }
  if (statement.payments.length > 0) {
    rows.push({
      kind: "section",
      title: en ? "Chronological Payment Ledger" : "سجل الدفعات والسداد الزمني",
    });
    rows.push({ kind: "payment-header" });
    for (const p of statement.payments) {
      rows.push({ kind: "payment", item: p });
    }
  }

  // Paginate cleanly across A4 pages
  const firstPageMaxRows = 13;
  const nextPageMaxRows = 20;
  const pagedRows: RenderRow[][] = [];
  if (rows.length <= firstPageMaxRows) {
    pagedRows.push(rows);
  } else {
    pagedRows.push(rows.slice(0, firstPageMaxRows));
    let idx = firstPageMaxRows;
    while (idx < rows.length) {
      pagedRows.push(rows.slice(idx, idx + nextPageMaxRows));
      idx += nextPageMaxRows;
    }
  }

  const jpegPages: JpegPageBuffer[] = [];

  for (let pageIndex = 0; pageIndex < pagedRows.length; pageIndex += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D Canvas unavailable");

    ctx.direction = en ? "ltr" : "rtl";
    // Crisp white A4 sheet
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, W, H);

    // Official Navy/Blue Header Band
    const grad = ctx.createLinearGradient(0, 0, W, 200);
    grad.addColorStop(0, "#0A2540");
    grad.addColorStop(1, "#0066CC");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, 196);

    const startX = en ? 72 : W - 72;
    const endX = en ? W - 72 : 72;

    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = en ? "left" : "right";
    ctx.font = 'bold 40px "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(
      en ? "Official Account Statement" : "كشف حساب ديون وتسويات رسمي",
      startX,
      86,
    );

    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = '500 24px "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(
      `${statement.workspaceName}  •  ${en ? "Issued:" : "تاريخ الإصدار:"} ${shortDate(statement.generatedDate, lang, numeralStyle)}`,
      startX,
      138,
    );

    let y = 240;

    if (pageIndex === 0) {
      // Counterparty + Net Summary Card
      ctx.fillStyle = "#F8FAFC";
      ctx.strokeStyle = "#CBD5E1";
      ctx.lineWidth = 2;
      drawRoundedBox(ctx, 72, y, W - 144, 210, 22);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#0F172A";
      ctx.textAlign = en ? "left" : "right";
      ctx.font = 'bold 32px "IBM Plex Sans Arabic", sans-serif';
      ctx.fillText(
        `${en ? "Counterparty:" : "الطرف المعني:"} ${statement.person.name}`,
        en ? 104 : W - 104,
        y + 56,
      );

      if (statement.person.phone) {
        ctx.fillStyle = "#475569";
        ctx.font = '500 22px "IBM Plex Sans Arabic", sans-serif';
        ctx.fillText(
          `${en ? "Phone:" : "رقم الهاتف:"} ${statement.person.phone}`,
          en ? 104 : W - 104,
          y + 98,
        );
      }

      // Three summary columns: Owed to Me | I Owe | Net Standing
      const net = statement.summary.netBalance;
      const netLabel =
        net > 0
          ? en
            ? "Net Owed to Workspace"
            : "صافي مستحق لك"
          : net < 0
            ? en
              ? "Net Owed by Workspace"
              : "صافي مستحق عليك"
            : en
              ? "Fully Settled"
              : "خالص ومسوّى بالكامل";
      const netColor = net > 0 ? "#15803D" : net < 0 ? "#DC2626" : "#334155";

      const metrics = [
        {
          label: en ? "Remaining Receivable" : "متبقي لك",
          val: fmtMoney(statement.summary.receivableRemaining),
          color: "#15803D",
        },
        {
          label: en ? "Remaining Payable" : "متبقي عليك",
          val: fmtMoney(statement.summary.payableRemaining),
          color: "#DC2626",
        },
        {
          label: netLabel,
          val: fmtMoney(net),
          color: netColor,
        },
      ];

      metrics.forEach((m, i) => {
        const colW = (W - 208) / 3;
        const ordered = en ? i : 2 - i;
        const boxX = 104 + ordered * colW;
        ctx.textAlign = en ? "left" : "right";
        const tx = en ? boxX : boxX + colW - 12;
        ctx.fillStyle = "#64748B";
        ctx.font = '500 20px "IBM Plex Sans Arabic", sans-serif';
        ctx.fillText(m.label, tx, y + 146);
        ctx.fillStyle = m.color;
        ctx.font = 'bold 26px "IBM Plex Sans Arabic", sans-serif';
        ctx.fillText(m.val, tx, y + 184);
      });

      y += 250;
    }

    // Render table rows for this page
    for (const row of pagedRows[pageIndex]!) {
      if (row.kind === "section") {
        y += 20;
        ctx.fillStyle = "#0F172A";
        ctx.textAlign = en ? "left" : "right";
        ctx.font = 'bold 26px "IBM Plex Sans Arabic", sans-serif';
        ctx.fillText(row.title, startX, y + 26);
        y += 46;
        continue;
      }

      if (row.kind === "debt-header" || row.kind === "payment-header") {
        ctx.fillStyle = "#E2E8F0";
        drawRoundedBox(ctx, 72, y, W - 144, 52, 10);
        ctx.fill();
        ctx.fillStyle = "#1E293B";
        ctx.font = 'bold 20px "IBM Plex Sans Arabic", sans-serif';
        if (row.kind === "debt-header") {
          ctx.textAlign = en ? "left" : "right";
          ctx.fillText(en ? "Title & Type" : "البند والنوع", en ? 96 : W - 96, y + 33);
          ctx.fillText(en ? "Principal" : "الأصل", en ? 520 : W - 520, y + 33);
          ctx.fillText(en ? "Paid" : "المسدد", en ? 740 : W - 740, y + 33);
          ctx.textAlign = en ? "right" : "left";
          ctx.fillText(en ? "Remaining" : "المتبقي", endX - (en ? 24 : -24), y + 33);
        } else {
          ctx.textAlign = en ? "left" : "right";
          ctx.fillText(en ? "Date" : "التاريخ", en ? 96 : W - 96, y + 33);
          ctx.fillText(en ? "Debt & Note" : "الدين والملاحظة", en ? 310 : W - 310, y + 33);
          ctx.textAlign = en ? "right" : "left";
          ctx.fillText(en ? "Amount Paid" : "الدفعة المسددة", endX - (en ? 24 : -24), y + 33);
        }
        y += 60;
        continue;
      }

      if (row.kind === "debt") {
        const d = row.item;
        ctx.fillStyle = "#FFFFFF";
        ctx.strokeStyle = "#E2E8F0";
        ctx.lineWidth = 1.5;
        drawRoundedBox(ctx, 72, y, W - 144, 62, 10);
        ctx.fill();
        ctx.stroke();

        const dirTag =
          d.direction === "receivable"
            ? en
              ? "(Owed to you)"
              : "(لك)"
            : en
              ? "(You owe)"
              : "(عليك)";
        ctx.fillStyle = "#0F172A";
        ctx.font = 'bold 21px "IBM Plex Sans Arabic", sans-serif';
        ctx.textAlign = en ? "left" : "right";
        ctx.fillText(`${d.title.slice(0, 28)} ${dirTag}`, en ? 96 : W - 96, y + 39);

        ctx.fillStyle = "#334155";
        ctx.font = '500 20px "IBM Plex Sans Arabic", sans-serif';
        ctx.fillText(fmtMoney(d.principal), en ? 520 : W - 520, y + 39);
        ctx.fillStyle = "#15803D";
        ctx.fillText(fmtMoney(d.paid), en ? 740 : W - 740, y + 39);

        ctx.textAlign = en ? "right" : "left";
        ctx.fillStyle = d.remaining > 0 ? "#DC2626" : "#64748B";
        ctx.font = 'bold 21px "IBM Plex Sans Arabic", sans-serif';
        ctx.fillText(fmtMoney(d.remaining), endX - (en ? 24 : -24), y + 39);

        y += 70;
        continue;
      }

      if (row.kind === "payment") {
        const p = row.item;
        ctx.fillStyle = "#F8FAFC";
        ctx.strokeStyle = "#E2E8F0";
        ctx.lineWidth = 1;
        drawRoundedBox(ctx, 72, y, W - 144, 56, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#334155";
        ctx.font = '500 19px "IBM Plex Sans Arabic", sans-serif';
        ctx.textAlign = en ? "left" : "right";
        ctx.fillText(shortDate(p.date, lang, numeralStyle), en ? 96 : W - 96, y + 35);

        const desc = p.note ? `${p.debtTitle} — ${p.note}` : p.debtTitle;
        ctx.fillStyle = "#0F172A";
        ctx.fillText(desc.slice(0, 44), en ? 310 : W - 310, y + 35);

        ctx.textAlign = en ? "right" : "left";
        ctx.fillStyle = "#15803D";
        ctx.font = 'bold 20px "IBM Plex Sans Arabic", sans-serif';
        ctx.fillText(fmtMoney(p.amount), endX - (en ? 24 : -24), y + 35);

        y += 64;
      }
    }

    // Footer with page number
    ctx.strokeStyle = "#CBD5E1";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(72, H - 96);
    ctx.lineTo(W - 72, H - 96);
    ctx.stroke();

    ctx.fillStyle = "#64748B";
    ctx.font = '500 19px "IBM Plex Sans Arabic", sans-serif';
    ctx.textAlign = en ? "left" : "right";
    ctx.fillText(
      en
        ? "Official statement generated by Mizan Finance"
        : "وثيقة رسمية صادرة من تطبيق ميزان لإدارة الأموال",
      startX,
      H - 52,
    );
    ctx.textAlign = en ? "right" : "left";
    ctx.fillText(
      `${en ? "Page" : "صفحة"} ${formatNumber(pageIndex + 1, numeralStyle, lang)} / ${formatNumber(pagedRows.length, numeralStyle, lang)}`,
      endX,
      H - 52,
    );

    const jpegBytes = await canvasToJpegBytes(canvas);
    jpegPages.push({ widthPx: W, heightPx: H, jpegBytes });
  }

  return encodeJpegPagesIntoPdf(jpegPages);
}

export async function exportPersonStatementPdf(
  data: Pick<Data, "people" | "debts" | "payments" | "currency">,
  personId: string,
  options?: {
    workspaceName?: string;
    lang?: AppLanguage;
    numeralStyle?: NumeralStyle;
  },
): Promise<boolean> {
  const lang = options?.lang ?? getUiPrefs().language;
  const numeralStyle = options?.numeralStyle ?? getUiPrefs().numeralStyle;
  const statement = computePersonDebtStatement(
    data,
    personId,
    options?.workspaceName || (lang === "en" ? "Mizan Finance" : "ميزان لإدارة الأموال"),
  );
  if (!statement) return false;

  const pdfBytes = await renderStatementPdfBytes(statement, lang, numeralStyle);
  const safePersonSlug =
    statement.person.name
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, "")
      .slice(0, 32) || "account";
  const filename = `mizan-statement-${safePersonSlug}-${statement.generatedDate}.pdf`;

  const nativeBridge = (
    window as Window & {
      MizanNative?: { shareBinaryFile?: (name: string, mimeType: string, base64: string) => boolean };
    }
  ).MizanNative;

  if (nativeBridge?.shareBinaryFile) {
    try {
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < pdfBytes.length; i += chunkSize) {
        binary += String.fromCharCode(...pdfBytes.subarray(i, i + chunkSize));
      }
      if (nativeBridge.shareBinaryFile(filename, "application/pdf", btoa(binary))) {
        return true;
      }
    } catch {
      /* fall back below */
    }
  }

  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  ) {
    try {
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: lang === "en" ? `Statement - ${statement.person.name}` : `كشف حساب - ${statement.person.name}`,
        });
        return true;
      }
    } catch {
      /* user cancelled or unsupported — fall back to direct download */
    }
  }

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}
