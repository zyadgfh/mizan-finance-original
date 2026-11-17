import {
  effectiveExchangeRate,
  isCurrency,
  normalizeSearch,
  round2,
  suggestCategoryFromNote,
  todayISO,
  toLatinDigits,
} from "./logic.ts";
import type { TxInput } from "./store.ts";
import type { Currency, Data, TxKind } from "./types.ts";

export type CsvColumnMap = {
  date: number;
  amount: number;
  kind: number;
  note: number;
  category: number;
  wallet: number;
  currency: number;
  rate: number;
};

export type CsvSkippedRow = {
  lineNumber: number;
  reason: string;
  raw: string[];
};

export type CsvImportPreview = {
  headers: string[];
  hasHeaderRow: boolean;
  rows: string[][];
  columnMap: CsvColumnMap;
  validInputs: TxInput[];
  skippedRows: CsvSkippedRow[];
  detectedDelimiter: string;
};

export function detectCsvDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? "";
  const counts = [
    { d: ",", c: (firstLine.match(/,/g) ?? []).length },
    { d: ";", c: (firstLine.match(/;/g) ?? []).length },
    { d: "\t", c: (firstLine.match(/\t/g) ?? []).length },
  ];
  counts.sort((a, b) => b.c - a.c);
  return counts[0] && counts[0].c > 0 ? counts[0].d : ",";
}

export function parseCsvRows(rawText: string): { rows: string[][]; delimiter: string } {
  const text = rawText.replace(/^\uFEFF/, "").trim();
  if (!text) return { rows: [], delimiter: "," };
  const delimiter = detectCsvDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) rows.push(row);

  return { rows, delimiter };
}

function findHeaderIdx(headers: string[], candidates: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeSearch(headers[i] ?? "");
    if (!h) continue;
    if (candidates.some((c) => h === c || h.includes(c))) return i;
  }
  return -1;
}

export function detectCsvColumnMap(headers: string[]): CsvColumnMap {
  return {
    date: findHeaderIdx(headers, ["تاريخ", "التاريخ", "date", "time", "day"]),
    amount: findHeaderIdx(headers, ["مبلغ", "المبلغ", "قيمه", "القيمه", "amount", "value", "total", "sum"]),
    kind: findHeaderIdx(headers, ["نوع", "النوع", "اتجاه", "الاتجاه", "type", "kind", "direction", "flow"]),
    note: findHeaderIdx(headers, ["بيان", "البيان", "ملاحظ", "وصف", "الوصف", "note", "description", "memo", "title", "merchant"]),
    category: findHeaderIdx(headers, ["فئه", "الفئه", "تصنيف", "التصنيف", "تفاصيل", "التفاصيل", "category", "tag"]),
    wallet: findHeaderIdx(headers, ["محفظه", "المحفظه", "حساب", "الحساب", "wallet", "account", "method"]),
    currency: findHeaderIdx(headers, ["عمله", "العمله", "currency", "curr", "ccy"]),
    rate: findHeaderIdx(headers, ["سعر الصرف", "الصرف", "rate", "exchange"]),
  };
}

export function looksLikeHeaderRow(row: string[]): boolean {
  const joined = normalizeSearch(row.join(" "));
  return /(تاريخ|مبلغ|بيان|نوع|فئه|تصنيف|date|amount|note|description|type|category|wallet|currency)/.test(joined);
}

export function normalizeCsvDate(raw: string): string | null {
  const cleaned = toLatinDigits(raw).trim();
  if (!cleaned) return null;
  // YYYY-MM-DD or YYYY/MM/DD (with optional ISO time tail)
  const isoMatch = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (y >= 1970 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  // DD/MM/YYYY or DD-MM-YYYY or MM/DD/YYYY
  const dmyMatch = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const a = Number(dmyMatch[1]);
    const b = Number(dmyMatch[2]);
    const y = Number(dmyMatch[3]);
    let day = a;
    let month = b;
    if (b > 12 && a <= 12) {
      month = a;
      day = b;
    }
    if (y >= 1970 && y <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(y)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

function parseAmountValue(raw: string): number {
  const latin = toLatinDigits(raw).replace(/['"\s٬]/g, "");
  // Handle European/Arabic decimal comma only if there's no dot
  const normalized =
    latin.includes(",") && !latin.includes(".")
      ? latin.replace(/,/g, ".")
      : latin.replace(/,/g, "");
  const cleaned = normalized.replace(/[^0-9.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : NaN;
}

function inferTxKind(rawKind: string, rawAmount: number): TxKind | "skip" {
  const norm = normalizeSearch(rawKind);
  if (norm === "تحويل" || norm === "transfer" || norm === "دين" || norm === "debt") {
    return "skip";
  }
  if (/(ايراد|داخل|دخل|ايداع|راتب|income|credit|deposit|inflow|\+)/.test(norm)) {
    return "income";
  }
  if (/(مصروف|خارج|سحب|شراء|expense|debit|withdraw|outflow|-)/.test(norm)) {
    return "expense";
  }
  return rawAmount < 0 ? "expense" : "expense";
}

function transactionFingerprint(tx: {
  kind: TxKind;
  date: string;
  amount: number;
  currency?: Currency;
  categoryId: string;
  walletId?: string;
  note: string;
}, defaultCurrency: Currency): string {
  return [
    tx.kind,
    tx.date,
    round2(tx.amount),
    tx.currency ?? defaultCurrency,
    tx.categoryId,
    tx.walletId || "w-cash",
    normalizeSearch(tx.note),
  ].join("|");
}

export function previewCsvImport(
  rawText: string,
  data: Pick<Data, "categories" | "wallets" | "txns" | "currency" | "exchangeRates">,
  options: {
    columnMap?: Partial<CsvColumnMap>;
    defaultWalletId?: string;
    defaultCurrency?: Currency;
    skipDuplicates?: boolean;
  } = {},
): CsvImportPreview {
  const { rows, delimiter } = parseCsvRows(rawText);
  if (!rows.length) {
    return {
      headers: [],
      hasHeaderRow: false,
      rows: [],
      columnMap: { date: 0, amount: 1, kind: -1, note: 2, category: -1, wallet: -1, currency: -1, rate: -1 },
      validInputs: [],
      skippedRows: [],
      detectedDelimiter: delimiter,
    };
  }

  const hasHeaderRow = looksLikeHeaderRow(rows[0]!);
  const headers = hasHeaderRow
    ? rows[0]!
    : rows[0]!.map((_, i) => `Col ${i + 1}`);
  const bodyRows = hasHeaderRow ? rows.slice(1) : rows;
  const detected = hasHeaderRow
    ? detectCsvColumnMap(headers)
    : { date: 0, amount: 1, kind: -1, note: 2, category: -1, wallet: -1, currency: -1, rate: -1 };

  const columnMap: CsvColumnMap = { ...detected, ...options.columnMap };
  const defaultWalletId = options.defaultWalletId || data.wallets[0]?.id || "w-cash";
  const defaultCurrency = options.defaultCurrency ?? data.currency;

  const validInputs: TxInput[] = [];
  const skippedRows: CsvSkippedRow[] = [];
  const seenTransactions = new Set(data.txns.map((tx) => transactionFingerprint(tx, data.currency)));

  bodyRows.forEach((cols, idx) => {
    const lineNumber = (hasHeaderRow ? 2 : 1) + idx;
    const rawDate = columnMap.date >= 0 ? cols[columnMap.date] ?? "" : "";
    const rawAmountStr = columnMap.amount >= 0 ? cols[columnMap.amount] ?? "" : "";
    const rawKind = columnMap.kind >= 0 ? cols[columnMap.kind] ?? "" : "";
    const rawNote = columnMap.note >= 0 ? cols[columnMap.note] ?? "" : "";
    const rawCat = columnMap.category >= 0 ? cols[columnMap.category] ?? "" : "";
    const rawWallet = columnMap.wallet >= 0 ? cols[columnMap.wallet] ?? "" : "";
    const rawCurrency = columnMap.currency >= 0 ? cols[columnMap.currency] ?? "" : "";
    const rawRateStr = columnMap.rate >= 0 ? cols[columnMap.rate] ?? "" : "";

    const parsedNum = parseAmountValue(rawAmountStr);
    if (!Number.isFinite(parsedNum) || Math.abs(parsedNum) <= 0) {
      skippedRows.push({ lineNumber, reason: "invalid-amount", raw: cols });
      return;
    }

    const kindOrSkip = inferTxKind(rawKind, parsedNum);
    if (kindOrSkip === "skip") {
      skippedRows.push({ lineNumber, reason: "non-txn-row", raw: cols });
      return;
    }
    const kind: TxKind = kindOrSkip;
    const amount = round2(Math.abs(parsedNum));

    const normalizedDate = normalizeCsvDate(rawDate) ?? (rawDate.trim() ? null : todayISO());
    if (!normalizedDate) {
      skippedRows.push({ lineNumber, reason: "invalid-date", raw: cols });
      return;
    }

    // Match category by exact name (Arabic or English), else suggest from note, else fallback to Other
    const normCat = normalizeSearch(rawCat);
    const matchedCat =
      data.categories.find(
        (c) => c.kind === kind && (normalizeSearch(c.name) === normCat || normalizeSearch(c.id) === normCat),
      ) ??
      data.categories.find((c) => c.id === suggestCategoryFromNote(rawNote || rawCat, kind, data.categories, data.txns)) ??
      data.categories.find((c) => c.kind === kind && (c.id === "c-other-x" || c.id === "c-other-in")) ??
      data.categories.find((c) => c.kind === kind);

    if (!matchedCat) {
      skippedRows.push({ lineNumber, reason: "missing-category", raw: cols });
      return;
    }

    const normWallet = normalizeSearch(rawWallet);
    const matchedWallet = normWallet
      ? data.wallets.find((w) => normalizeSearch(w.name) === normWallet || w.id === rawWallet.trim())
      : undefined;

    const upperCur = rawCurrency.trim().toUpperCase();
    const rowCurrency: Currency = isCurrency(upperCur) ? upperCur : defaultCurrency;
    const parsedRate = rawRateStr ? parseAmountValue(rawRateStr) : NaN;
    const exchangeRate =
      rowCurrency === data.currency
        ? 1
        : Number.isFinite(parsedRate) && parsedRate > 0
          ? parsedRate
          : effectiveExchangeRate(rowCurrency, data.currency, data.exchangeRates);
    const note = rawNote || rawCat || matchedCat.name;
    const walletId = matchedWallet?.id ?? defaultWalletId;
    const fingerprint = transactionFingerprint(
      { kind, amount, currency: rowCurrency, categoryId: matchedCat.id, note, date: normalizedDate, walletId },
      data.currency,
    );

    if (options.skipDuplicates !== false && seenTransactions.has(fingerprint)) {
      skippedRows.push({ lineNumber, reason: "duplicate", raw: cols });
      return;
    }
    seenTransactions.add(fingerprint);

    validInputs.push({
      kind,
      amount,
      currency: rowCurrency,
      exchangeRate: rowCurrency === data.currency ? undefined : exchangeRate,
      baseAmount: rowCurrency === data.currency ? undefined : round2(amount * exchangeRate),
      categoryId: matchedCat.id,
      note,
      date: normalizedDate,
      walletId,
      source: "manual",
      reported: true,
    });
  });

  return {
    headers,
    hasHeaderRow,
    rows: bodyRows,
    columnMap,
    validInputs,
    skippedRows,
    detectedDelimiter: delimiter,
  };
}
