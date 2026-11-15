export const ERROR_LOG_STORAGE_KEY = "mizan.error-log.v1";

export type SafeErrorEntry = {
  id: string;
  at: number;
  name: string;
  message: string;
  stackHead?: string;
  boundary?: string;
  route?: string;
  tab?: string;
};

const MAX_ERROR_ENTRIES = 25;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips any financial data, numbers, personal names, notes, phone numbers,
 * quoted strings, and sensitive keys so error logs remain strictly privacy-safe.
 */
export function sanitizeSensitiveText(raw: string, knownPeople: string[] = []): string {
  if (!raw) return "";
  let s = String(raw);

  // Redact known people names if provided (e.g., from local ledger contacts)
  for (const personName of knownPeople) {
    const trimmed = personName?.trim();
    if (trimmed && trimmed.length >= 2) {
      s = s.replace(new RegExp(escapeRegex(trimmed), "gi"), "[NAME]");
    }
  }

  // Redact quoted or guillemet strings that may carry user notes or person names
  s = s.replace(/«[^»]{1,160}»/g, "«[REDACTED]»");
  s = s.replace(/"[^"\n]{1,160}"/g, '"[REDACTED]"');
  s = s.replace(/'[^'\n]{1,160}'/g, "'[REDACTED]'");

  // Redact sensitive key:value / key=value fields (including multi-word text fields until delimiter)
  s = s.replace(
    /\b(note|notes|title|person|personName|name|passphrase|password|pin|token|secret)\s*[:=]\s*[^,;\n]{1,120}/gi,
    "$1=[REDACTED]",
  );
  s = s.replace(
    /\b(amount|baseAmount|exchangeRate|principal|opening|openingBalance|limit|balance|phone|receipt|txns|debts|payments|people)\s*[:=]\s*\S+/gi,
    "$1=[REDACTED]",
  );

  // Redact JWTs, Bearer tokens, and workspace invite codes
  s = s.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[JWT]");
  s = s.replace(/\bMZN-[A-Z0-9]{4}-[A-Z0-9]{4}\b/gi, "[INVITE_CODE]");

  // Redact emails and phone numbers
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]");
  s = s.replace(/\+?\d[\d\s\-()]{5,}\d/g, "[NUM]");

  // Redact currency symbols and codes (including attached prefixes like $120.50)
  s = s.replace(/[$€£]/g, "[CUR]");
  s = s.replace(/(?:ج\.م|ر\.س|د\.إ|\bEGP\b|\bSAR\b|\bAED\b|\bUSD\b|\bEUR\b)/gi, "[CUR]");

  // Redact standalone numbers / decimals (amounts, IDs, balances)
  s = s.replace(/\d+(?:[.,]\d+)?/g, "[NUM]");
  // Redact Arabic-Indic numerals
  s = s.replace(/[٠-٩]+(?:[٫.,][٠-٩]+)?/g, "[NUM]");

  // Redact multi-word Arabic text runs that might originate from personal notes/names
  s = s.replace(/[\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,}){1,}/g, "[AR_TEXT]");

  return s.replace(/\s+/g, " ").trim().slice(0, 220);
}

export function sanitizeStackTrace(stack?: string, knownPeople: string[] = []): string | undefined {
  if (!stack) return undefined;
  const lines = stack
    .split("\n")
    .slice(0, 4)
    .map((line) => {
      let clean = line
        .replace(/\?[^\s)]+/g, "")
        .replace(/https?:\/\/[^/\s]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
      for (const personName of knownPeople) {
        const trimmed = personName?.trim();
        if (trimmed && trimmed.length >= 2) {
          clean = clean.replace(new RegExp(escapeRegex(trimmed), "gi"), "[NAME]");
        }
      }
      return clean;
    })
    .filter(Boolean);
  if (!lines.length) return undefined;
  return lines.join(" | ").slice(0, 260);
}

export function sanitizeErrorRecord(
  error: unknown,
  context?: { boundary?: string; route?: string; tab?: string; knownPeople?: string[] },
): SafeErrorEntry {
  const errObj = error instanceof Error ? error : null;
  const knownPeople = context?.knownPeople ?? [];
  const rawName = errObj?.name || (typeof error === "object" && error !== null ? "Error" : typeof error);
  const rawMessage = errObj?.message || (typeof error === "string" ? error : "Unexpected error");
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 8)
        : String(Date.now()).slice(-6),
    at: Date.now(),
    name: sanitizeSensitiveText(rawName, knownPeople) || "Error",
    message: sanitizeSensitiveText(rawMessage, knownPeople) || "Unexpected error",
    stackHead: sanitizeStackTrace(errObj?.stack, knownPeople),
    boundary: context?.boundary ? sanitizeSensitiveText(context.boundary, knownPeople) : undefined,
    route: context?.route ? context.route.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) : undefined,
    tab: context?.tab ? context.tab.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) : undefined,
  };
}

export function loadErrorLogs(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): SafeErrorEntry[] {
  try {
    const raw = storage?.getItem(ERROR_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SafeErrorEntry[]) : [];
  } catch {
    return [];
  }
}

export function logSafeError(
  error: unknown,
  context?: { boundary?: string; route?: string; tab?: string; knownPeople?: string[] },
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): SafeErrorEntry {
  const entry = sanitizeErrorRecord(error, context);
  try {
    const existing = loadErrorLogs(storage);
    const next = [entry, ...existing].slice(0, MAX_ERROR_ENTRIES);
    storage?.setItem(ERROR_LOG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore storage quota failures */
  }
  return entry;
}

export function clearErrorLogs(
  storage: Storage | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): void {
  try {
    storage?.removeItem(ERROR_LOG_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
