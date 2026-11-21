import { round2, suggestCategoryFromNote, toLatinDigits } from "./logic.ts";
import type { Category, Currency, Data, Person, TxKind, Wallet } from "./types.ts";

export type ParsedSmartCapture = {
  kind: TxKind | "transfer";
  amount: number | null;
  currency: Currency;
  walletId: string;
  toWalletId?: string;
  categoryId: string;
  personId?: string;
  note: string;
  providerHint?: "instapay" | "vodafone" | "bank" | "card" | "cash";
  confidence: "high" | "medium" | "low";
};

export type NativeSharedPayload = {
  text: string;
  imageDataUrl: string | null;
  mimeType: string;
};

type MizanShareWindow = Window & {
  MizanNative?: {
    consumeSharedPayload?: () => string;
  };
};

export function consumeNativeSharedPayload(): NativeSharedPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const fn = (window as MizanShareWindow).MizanNative?.consumeSharedPayload;
    if (typeof fn !== "function") return null;
    const raw = fn();
    if (!raw || !raw.trim()) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    const imageDataUrl =
      typeof parsed.imageDataUrl === "string" && parsed.imageDataUrl.startsWith("data:image/")
        ? parsed.imageDataUrl
        : null;
    const mimeType = typeof parsed.mimeType === "string" ? parsed.mimeType : "";
    if (!text && !imageDataUrl) return null;
    return { text, imageDataUrl, mimeType };
  } catch {
    return null;
  }
}

const CURRENCY_PATTERNS: Array<{ currency: Currency; regex: RegExp }> = [
  { currency: "USD", regex: /(?:usd|\$|دولار)/i },
  { currency: "EUR", regex: /(?:eur|€|يورو)/i },
  { currency: "SAR", regex: /(?:sar|ر\.?\s*س|ريال)/i },
  { currency: "AED", regex: /(?:aed|د\.?\s*إ|درهم)/i },
  { currency: "EGP", regex: /(?:egp|le\b|ج\.?\s*م|جنيه|جنيهاً|جم\b)/i },
];

function detectCurrency(normalized: string, fallback: Currency): Currency {
  for (const item of CURRENCY_PATTERNS) {
    if (item.regex.test(normalized)) return item.currency;
  }
  return fallback;
}

function extractPrimaryAmount(normalized: string): number | null {
  // Scrub phone numbers (01xxxxxxxxx / +201xxxxxxxxx), dates (20/11/2026 or 2026-11-20),
  // times (14:35), and card suffix hints ("منتهية بـ 4821" / "ending 4821") before scanning amounts.
  const scrubbed = normalized
    .replace(/(?:\+?20|0)1[0125]\d{8}\b/g, " ")
    .replace(/\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/(?:منتهي[ةه]\s*بـ?\s*|ending\s*(?:in|with)?\s*|card\s*\*+)(\d{3,4})/gi, " ")
    .replace(/(?:مصاريف\s*الخدم[ةه]|رسوم\s*الخدم[ةه]|fee)\s*[:=]?\s*\d+(?:[.,]\d+)?/gi, " ");

  // Prefer explicit currency-adjacent or keyword-adjacent amounts first ("بمبلغ 1,250.50", "EGP 875.00")
  const explicitRegex =
    /(?:ب?مبلغ|قيمته|قدرها|amount(?:\s*of)?|egp|usd|eur|sar|aed)\s*[:=]?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:ج\.?\s*م|جنيه|egp|sar|ريال|aed|درهم|usd|\$|دولار|eur|€|يورو)/i;
  const explicitMatch = scrubbed.match(explicitRegex);
  const candidateStr = explicitMatch?.[1] ?? explicitMatch?.[2];
  if (candidateStr) {
    const val = round2(Number(candidateStr.replace(/,/g, "")));
    if (Number.isFinite(val) && val > 0) return val;
  }

  // Fallback: first standalone positive number
  const genericMatch = scrubbed.match(/(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
  if (!genericMatch?.[1]) return null;
  const fallbackVal = round2(Number(genericMatch[1].replace(/,/g, "")));
  return Number.isFinite(fallbackVal) && fallbackVal > 0 ? fallbackVal : null;
}

function detectProviderHint(text: string): ParsedSmartCapture["providerHint"] {
  if (/instapay|إنستاباي|انستاباي|إنستا\s*باي|انستا\s*باي|@instapay|\bipn\b/i.test(text)) {
    return "instapay";
  }
  if (/vodafone\s*cash|vf[\s-]*cash|فودافون\s*كاش|اتصالات\s*كاش|اورنج\s*كاش|we\s*pay|محفظ[ةه]\s*الكتروني/i.test(text)) {
    return "vodafone";
  }
  if (/بطاق[ةه]|كارت|فيزا|ماستركارد|credit\s*card|debit\s*card|pos\b|مشتريات/i.test(text)) {
    return "card";
  }
  if (/البنك|بنك\s*مصر|الأهلي|الاهلي|\bcib\b|\bqnb\b|\bnbe\b|حسابك\s*البنكي|تحويل\s*بنكي/i.test(text)) {
    return "bank";
  }
  if (/كاش|نقدي|نقداً|محفظة\s*الكاش|\bcash\b/i.test(text)) {
    return "cash";
  }
  return undefined;
}

function resolveWalletByMention(fragment: string, wallets: Wallet[]): Wallet | undefined {
  const lower = fragment.toLowerCase();
  const byLongestName = [...wallets].sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0));
  for (const w of byLongestName) {
    if (w.name && w.name.length >= 2 && lower.includes(w.name.toLowerCase())) return w;
  }
  const hint = detectProviderHint(fragment);
  if (hint) {
    return wallets.find((w) => w.kind === hint);
  }
  return undefined;
}

function matchBestWallet(
  normalizedText: string,
  wallets: Wallet[],
  providerHint?: ParsedSmartCapture["providerHint"],
): string {
  if (!wallets.length) return "w-cash";

  // 1. Card last-4 digits match (e.g. "منتهية بـ 4821")
  const last4Match = normalizedText.match(
    /(?:منتهي[ةه]\s*بـ?\s*|ending\s*(?:in|with)?\s*|card\s*\*+)(\d{4})/i,
  );
  if (last4Match?.[1]) {
    const byLast4 = wallets.find((w) => w.last4 === last4Match[1]);
    if (byLast4) return byLast4.id;
  }

  // 2. Direct wallet name mention — longest specific name wins ("فودافون كاش" before "كاش")
  const lower = normalizedText.toLowerCase();
  const byLongestName = [...wallets].sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0));
  for (const w of byLongestName) {
    if (!w.name || w.name.length < 2) continue;
    // Do not let a generic "كاش" wallet steal an explicit Vodafone/InstaPay SMS
    if (
      w.kind === "cash" &&
      (providerHint === "vodafone" || providerHint === "instapay") &&
      w.name.trim() === "كاش"
    ) {
      continue;
    }
    if (lower.includes(w.name.toLowerCase())) {
      return w.id;
    }
  }

  // 3. Provider kind match
  if (providerHint) {
    const byKind = wallets.find((w) => w.kind === providerHint);
    if (byKind) return byKind.id;
    if (providerHint === "card") {
      const bankFallback = wallets.find((w) => w.kind === "bank");
      if (bankFallback) return bankFallback.id;
    }
  }

  return wallets[0]?.id ?? "w-cash";
}

function matchPerson(normalizedText: string, people: Person[]): Person | undefined {
  const lower = normalizedText.toLowerCase();
  const digits = normalizedText.replace(/\D/g, "");
  for (const p of people) {
    if (p.name && p.name.trim().length >= 2 && lower.includes(p.name.trim().toLowerCase())) {
      return p;
    }
    const pDigits = (p.phone ?? "").replace(/\D/g, "");
    if (pDigits.length >= 9 && digits.includes(pDigits.slice(-10))) {
      return p;
    }
  }
  return undefined;
}

function detectKindAndTransfer(
  normalizedText: string,
  wallets: Wallet[],
): { kind: TxKind | "transfer"; fromWallet?: Wallet; toWallet?: Wallet } {
  // Wallet-to-wallet transfer pattern: "حولت 1500 من البنك إلى فودافون كاش"
  const transferRouteMatch = normalizedText.match(
    /(?:حولت|تحويل|نقلت|اسحب|سحبت).*?(?:\s+|^)من\s+(.+?)\s+(?:إلى|الى|لـ|ل)\s+(.+)$/i,
  );
  if (transferRouteMatch?.[1] && transferRouteMatch[2]) {
    const fromW = resolveWalletByMention(transferRouteMatch[1], wallets);
    const toW = resolveWalletByMention(transferRouteMatch[2], wallets);
    if (fromW && toW && fromW.id !== toW.id) {
      return { kind: "transfer", fromWallet: fromW, toWallet: toW };
    }
  }

  const isIncome =
    /(?:تم\s*استلام|استلمت|إيداع|ايداع|تم\s*إضافة|تم\s*اضافة|قبضت|راتب|مرتب|دخل|إيراد|ايراد|received|credited|deposit|salary|from\s+[a-z0-9_.]+@instapay|واردة)/i.test(
      normalizedText,
    ) && !/(?:تم\s*خصم|تم\s*تحويل\s*مبلغ.*?\s*(?:إلى|الى|لـ)|صرفت|دفعت|debited)/i.test(normalizedText);

  if (isIncome) {
    return { kind: "income" };
  }
  return { kind: "expense" };
}

function buildCleanNote(rawText: string, providerHint?: ParsedSmartCapture["providerHint"]): string {
  const trimmed = rawText.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    if (providerHint === "instapay") return "معاملة إنستا باي";
    if (providerHint === "vodafone") return "معاملة فودافون كاش";
    return "";
  }

  // Extract merchant / counterparty from bank, card, or InstaPay SMS
  const merchantMatch =
    trimmed.match(
      /(?:لدى|at)\s+([A-Za-z0-9_.\u0600-\u06FF\s@-]{2,40}?)(?:\s+(?:بتاريخ|يوم|رصيدك|مصاريف|عبر|بنجاح|on\b|avail)|[.،\n]|$)/i,
    ) ??
    trimmed.match(
      /(?:إلى|الى|لـ|من(?!\s*(?:بطاق|حساب|محفظ))|to|from)\s+([A-Za-z0-9_.\u0600-\u06FF\s@-]{2,40}?)(?:\s+(?:بتاريخ|يوم|رصيدك|مصاريف|عبر|بنجاح|on\b|avail)|[.،\n]|$)/i,
    );
  if (trimmed.length > 60 && merchantMatch?.[1]) {
    const party = merchantMatch[1].trim();
    const prefix =
      providerHint === "instapay"
        ? "إنستا باي"
        : providerHint === "vodafone"
          ? "فودافون كاش"
          : providerHint === "card"
            ? "مشتريات"
            : "معاملة";
    return `${prefix} — ${party}`.slice(0, 90);
  }

  // Strip leading verb + amount from short colloquial phrases ("دفعت 250 كافيه من كاش" -> "كافيه")
  const shortClean = toLatinDigits(trimmed)
    .replace(/^(?:دفعت|صرفت|اشتريت|سددت|حولت|استلمت|قبضت|جالي|دخل)\s*/i, "")
    .replace(/^\d+(?:[.,]\d+)?\s*(?:ج\.?\s*م|جنيه|ريال|درهم|دولار|egp|sar|aed|usd|eur)?\s*/i, "")
    .replace(/\s+(?:من|على|بـ|عبر)\s+(?:محفظ[ةه]\s*)?(?:كاش|نقدي|انستاباي|إنستاباي|إنستا\s*باي|فودافون\s*كاش|البنك|بطاق[ةه].*)$/i, "")
    .trim();

  return (shortClean || trimmed).slice(0, 100);
}

const KEYWORD_CATEGORY_RULES: Array<{ kind: TxKind; regex: RegExp; catIds: string[] }> = [
  {
    kind: "expense",
    regex: /كافيه|قهو[ةه]|مطعم|أكل|اكل|غداء|عشاء|فطار|سوبر\s*ماركت|ماركت|كارفور|طلبات|carrefour|talabat|food|cafe|coffee/i,
    catIds: ["c-food"],
  },
  {
    kind: "expense",
    regex: /أوبر|اوبر|كريم|مواصلات|بنزين|تاكسي|مترو|uber|careem|fuel|gas/i,
    catIds: ["c-transport"],
  },
  {
    kind: "expense",
    regex: /كهرباء|مياه|غاز|إنترنت|انترنت|فاتور[ةه]|شحن\s*رصيد|باقة|we\b|vodafone\s*bill|orange/i,
    catIds: ["c-bills"],
  },
  {
    kind: "expense",
    regex: /إيجار|ايجار|صيان[ةه]|سكن|عمارة|منزل|rent/i,
    catIds: ["c-home"],
  },
  {
    kind: "expense",
    regex: /صيدلي[ةه]|دواء|طبيب|عياد[ةه]|مستشفى|تحاليل|كشف|pharmacy|doctor|health/i,
    catIds: ["c-health"],
  },
  {
    kind: "income",
    regex: /مرتب|راتب|قبض|salary|payroll/i,
    catIds: ["c-salary"],
  },
  {
    kind: "income",
    regex: /شغل\s*حر|فري\s*لانس|عميل|مشروع|freelance/i,
    catIds: ["c-freelance"],
  },
];

function resolveBestCategory(
  kind: TxKind,
  fullText: string,
  cleanNote: string,
  categories: Category[],
  data: Pick<Data, "txns">,
): string {
  const available = categories.filter((c) => c.kind === kind);
  if (!available.length) return "";

  const historical = suggestCategoryFromNote(cleanNote || fullText, kind, categories, data.txns);
  if (historical && available.some((c) => c.id === historical)) {
    return historical;
  }

  for (const rule of KEYWORD_CATEGORY_RULES) {
    if (rule.kind !== kind) continue;
    if (rule.regex.test(fullText) || rule.regex.test(cleanNote)) {
      const hit = available.find((c) => rule.catIds.includes(c.id));
      if (hit) return hit.id;
    }
  }

  for (const c of available) {
    if (c.name && fullText.toLowerCase().includes(c.name.toLowerCase())) {
      return c.id;
    }
  }

  return available[0]!.id;
}

export function parseSmartFinancialInput(
  rawInput: string,
  data: Pick<Data, "wallets" | "categories" | "people" | "txns" | "currency">,
): ParsedSmartCapture {
  const normalized = toLatinDigits(String(rawInput ?? "")).trim();
  const providerHint = detectProviderHint(normalized);
  const currency = detectCurrency(normalized, data.currency);
  const amount = extractPrimaryAmount(normalized);
  const routeInfo = detectKindAndTransfer(normalized, data.wallets);
  const matchedPerson = matchPerson(normalized, data.people);
  const note = buildCleanNote(rawInput, providerHint);

  if (routeInfo.kind === "transfer" && routeInfo.fromWallet && routeInfo.toWallet) {
    return {
      kind: "transfer",
      amount,
      currency,
      walletId: routeInfo.fromWallet.id,
      toWalletId: routeInfo.toWallet.id,
      categoryId: data.categories.find((c) => c.kind === "expense")?.id ?? "",
      personId: matchedPerson?.id,
      note: note || "تحويل بين المحافظ",
      providerHint,
      confidence: amount ? "high" : "low",
    };
  }

  const txKind: TxKind = routeInfo.kind === "income" ? "income" : "expense";
  const walletId = matchBestWallet(normalized, data.wallets, providerHint);
  const categoryId = resolveBestCategory(txKind, normalized, note, data.categories, data);

  return {
    kind: txKind,
    amount,
    currency,
    walletId,
    categoryId,
    personId: matchedPerson?.id,
    note,
    providerHint,
    confidence: amount && providerHint ? "high" : amount ? "medium" : "low",
  };
}
