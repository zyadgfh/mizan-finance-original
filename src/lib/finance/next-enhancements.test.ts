import assert from "node:assert/strict";
import test from "node:test";
import {
  clearErrorLogs,
  loadErrorLogs,
  logSafeError,
  sanitizeErrorRecord,
  sanitizeSensitiveText,
} from "./error-log.ts";
import { detectCsvColumnMap, detectCsvDelimiter, normalizeCsvDate, parseCsvRows, previewCsvImport } from "./csv-import.ts";
import {
  computeMonthlyAnalytics,
  currentMonth,
  dayLabel,
  defaultExchangeRatesFor,
  effectiveExchangeRate,
  formatNumber,
  formatPercent,
  money,
  monthLabel,
  shortDate,
  sumKind,
  toArabicIndicDigits,
  toLatinDigits,
  todayISO,
  txBaseAmount,
  walletBalance,
} from "./logic.ts";
import { clearPerfMetrics, getLatestPerfSample, loadPerfMetrics, markBootStart, recordBootMetrics } from "./perf-metrics.ts";
import { DEFAULT_UI_PREFS, getUiPrefs, updateUiPrefs } from "./prefs.ts";
import { buildMonthlyReportCsv, buildMonthlyReportHtml, buildMonthlyReportJson } from "./report-export.ts";
import { MIZAN_LOCAL_STORAGE_KEYS, overwriteAndClearLocalKeys } from "./security.ts";
import { seedData } from "./seed.ts";
import { exportCsv, useFinance } from "./store.ts";

function installMemoryStorage() {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(i: number) {
      return [...map.keys()][i] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, val: string) {
      map.set(key, String(val));
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  return map;
}

test("multi-currency transactions freeze exchange rate at recording time", () => {
  installMemoryStorage();
  const base = seedData();
  useFinance.getState().replaceAll({ ...base, currency: "EGP", exchangeRates: defaultExchangeRatesFor("EGP") });

  const id = useFinance.getState().addTxn({
    kind: "expense",
    amount: 100,
    currency: "USD",
    exchangeRate: 50,
    categoryId: "c-food",
    note: "Software subscription",
    date: `${currentMonth()}-10`,
    walletId: "w-cash",
  });

  const tx1 = useFinance.getState().txns.find((t) => t.id === id)!;
  assert.equal(tx1.currency, "USD");
  assert.equal(tx1.exchangeRate, 50);
  assert.equal(tx1.baseAmount, 5000);
  assert.equal(txBaseAmount(tx1, "EGP", useFinance.getState().exchangeRates), 5000);

  const balanceBeforeRateChange = walletBalance("w-cash", useFinance.getState());

  // Updating global USD rate later must NOT alter already recorded transaction's frozen rate/baseAmount
  useFinance.getState().setExchangeRate("USD", 62);
  const tx1After = useFinance.getState().txns.find((t) => t.id === id)!;
  assert.equal(tx1After.exchangeRate, 50);
  assert.equal(tx1After.baseAmount, 5000);
  assert.equal(txBaseAmount(tx1After, "EGP", useFinance.getState().exchangeRates), 5000);
  assert.equal(walletBalance("w-cash", useFinance.getState()), balanceBeforeRateChange);

  // Subsequent USD transaction picks up the new rate 62 unless overridden
  const id2 = useFinance.getState().addTxn({
    kind: "expense",
    amount: 10,
    currency: "USD",
    categoryId: "c-food",
    note: "Cloud backup",
    date: `${currentMonth()}-11`,
    walletId: "w-cash",
  });
  const tx2 = useFinance.getState().txns.find((t) => t.id === id2)!;
  assert.equal(tx2.exchangeRate, 62);
  assert.equal(tx2.baseAmount, 620);

  assert.equal(effectiveExchangeRate("EGP", "EGP", {}), 1);
});

test("Arabic-Indic and Western numerals formatting + bilingual labels", () => {
  assert.equal(toArabicIndicDigits("2026-11-14 50.25%"), "٢٠٢٦-١١-١٤ ٥٠.٢٥%");
  assert.equal(toLatinDigits("٢٠٢٦-١١-١٤ ٥٠٫٢٥"), "2026-11-14 50.25");

  assert.equal(formatNumber(1250.5, "arab", "ar").includes("١"), true);
  assert.equal(formatNumber(1250.5, "latn", "en"), "1,250.50");
  assert.equal(money(450, "EGP", "arab", "ar"), "٤٥٠ ج.م");
  assert.equal(money(450, "EGP", "latn", "en"), "450 EGP");
  assert.equal(formatPercent(85, "arab", "ar"), "٨٥٪");
  assert.equal(formatPercent(85, "latn", "en"), "85%");
  assert.equal(monthLabel("2026-11", "ar", "arab").includes("٢٠٢٦"), true);
  assert.equal(monthLabel("2026-11", "en", "latn").includes("2026"), true);
  assert.equal(shortDate("2026-11-14", "ar", "arab").includes("١٤"), true);
  assert.equal(dayLabel(todayISO(), "en", "latn"), "Today");
  assert.equal(dayLabel("2026-11-10", "en", "latn").includes("10"), true);
});

test("on-device monthly analytics computes daily avg, top days, increased categories, projection, and uncategorized count", () => {
  const base = seedData();
  const month = "2026-11";
  const prevMonth = "2026-10";
  const data = {
    ...base,
    txns: [
      {
        id: "t-prev-1",
        kind: "expense" as const,
        amount: 200,
        categoryId: "c-food",
        note: "Groceries",
        date: `${prevMonth}-10`,
        walletId: "w-cash",
        createdAt: 1,
      },
      {
        id: "t-cur-1",
        kind: "expense" as const,
        amount: 600,
        categoryId: "c-food",
        note: "Supermarket",
        date: `${month}-05`,
        walletId: "w-cash",
        createdAt: 2,
      },
      {
        id: "t-cur-2",
        kind: "expense" as const,
        amount: 150,
        categoryId: "c-other-x",
        note: "Misc item",
        date: `${month}-10`,
        walletId: "w-cash",
        createdAt: 3,
      },
      {
        id: "t-cur-3",
        kind: "income" as const,
        amount: 3000,
        categoryId: "c-salary",
        note: "Salary",
        date: `${month}-01`,
        walletId: "w-bank",
        createdAt: 4,
      },
    ],
  };

  const analytics = computeMonthlyAnalytics(data, month, "2026-11-15");
  assert.equal(analytics.elapsedDays, 15);
  assert.equal(analytics.daysInMonth, 30);
  assert.equal(analytics.dailyAverageExpense, 50); // 750 / 15
  assert.equal(analytics.projectedMonthEndExpense, 1500); // 50 * 30
  assert.equal(analytics.projectedNet, 1500); // 3000 - 1500
  assert.equal(analytics.uncategorizedCount, 1);
  assert.equal(analytics.highestSpendingDays[0]?.date, "2026-11-05");
  assert.equal(analytics.highestSpendingDays[0]?.amount, 600);
  assert.equal(analytics.increasedCategories.length, 2);
  assert.equal(analytics.increasedCategories[0]?.category.id, "c-food");
  assert.equal(analytics.increasedCategories[0]?.delta, 400);
  assert.equal(analytics.increasedCategories[0]?.pctIncrease, 200);
});

test("analytics opt-out excludes analytics payload from exported report JSON while preserving primary Arabic default", () => {
  installMemoryStorage();
  assert.equal(DEFAULT_UI_PREFS.language, "ar");
  assert.equal(getUiPrefs().language, "ar");

  const data = seedData();
  const month = currentMonth();

  updateUiPrefs({ analyticsEnabled: false, language: "en", numeralStyle: "latn" });
  const jsonOff = JSON.parse(buildMonthlyReportJson(data, month, "en", "latn"));
  assert.equal("analytics" in jsonOff && jsonOff.analytics !== undefined, false);

  const htmlEn = buildMonthlyReportHtml(data, month, "en", "latn");
  assert.equal(htmlEn.includes('lang="en" dir="ltr"'), true);

  updateUiPrefs({ analyticsEnabled: true, language: "ar", numeralStyle: "arab" });
  const jsonOn = JSON.parse(buildMonthlyReportJson(data, month, "ar", "arab"));
  assert.ok(jsonOn.analytics);
  const htmlAr = buildMonthlyReportHtml(data, month, "ar", "arab");
  assert.equal(htmlAr.includes('lang="ar" dir="rtl"'), true);
});

test("CSV parser, auto column mapping, multi-currency preview, and bulk import", () => {
  installMemoryStorage();
  useFinance.getState().replaceAll({ ...seedData(), txns: [] });

  const csvText = [
    "Date,Type,Amount,Currency,Rate,Category,Note",
    "2026-11-12,expense,45.5,USD,50,طعام,Lunch cafe",
    "14/11/2026,income,12000,EGP,1,راتب,Monthly payroll",
    "2026-11-15,expense,0,EGP,1,أخرى,Invalid zero row",
  ].join("\n");

  assert.equal(detectCsvDelimiter(csvText), ",");
  const parsed = parseCsvRows(csvText);
  assert.equal(parsed.rows[0]!.length, 7);
  const map = detectCsvColumnMap(parsed.rows[0]!);
  assert.equal(map.date, 0);
  assert.equal(map.amount, 2);
  assert.equal(map.currency, 3);
  assert.equal(normalizeCsvDate("14/11/2026"), "2026-11-14");

  const preview = previewCsvImport(csvText, useFinance.getState(), {
    defaultWalletId: "w-cash",
    defaultCurrency: "EGP",
  });
  assert.equal(preview.validInputs.length, 2);
  assert.equal(preview.skippedRows.length, 1);
  assert.equal(preview.validInputs[0]?.currency, "USD");
  assert.equal(preview.validInputs[0]?.exchangeRate, 50);

  const added = useFinance.getState().importTransactionsBulk(preview.validInputs);
  assert.equal(added, 2);
  assert.equal(useFinance.getState().txns.length, 2);
  const usdTx = useFinance.getState().txns.find((t) => t.currency === "USD")!;
  assert.equal(usdTx.baseAmount, 2275);
  assert.equal(sumKind(useFinance.getState().txns, "expense", "2026-11", "EGP", useFinance.getState().exchangeRates), 2275);

  const exportedCsv = buildMonthlyReportCsv(useFinance.getState(), "2026-11", "en", "latn");
  assert.equal(exportedCsv.includes("Mizan Monthly Report"), true);
  assert.equal(typeof exportCsv, "function");
});

test("privacy-safe error log strips amounts, notes, phones, emails, and people names", () => {
  installMemoryStorage();
  clearErrorLogs();

  const knownPeople = ["أحمد علي", "سارة محمود", "Omar Hassan"];
  const msg = sanitizeSensitiveText(
    "Failed saving note for سارة محمود amount 4500 EGP $120.50 phone +201012345678 email user@example.com note: rent payment",
    knownPeople,
  );
  assert.equal(msg.includes("سارة محمود"), false);
  assert.equal(msg.includes("4500"), false);
  assert.equal(msg.includes("120.50"), false);
  assert.equal(msg.includes("+201012345678"), false);
  assert.equal(msg.includes("user@example.com"), false);
  assert.equal(msg.includes("rent payment"), false);

  const rec = sanitizeErrorRecord(
    new Error("Crash processing 9900 SAR for أحمد علي"),
    { boundary: "sheet:txn", route: "txn", tab: "home", knownPeople },
  );
  assert.equal(rec.message.includes("9900"), false);
  assert.equal(rec.message.includes("أحمد علي"), false);

  logSafeError(new TypeError("Bad value 1250 EGP for Omar Hassan"), {
    boundary: "screen:home",
    route: "main",
    tab: "home",
    knownPeople,
  });
  const stored = loadErrorLogs();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.message.includes("1250"), false);
  assert.equal(stored[0]!.message.includes("Omar Hassan"), false);
});

test("local boot performance metrics and wipe-all storage keys", () => {
  installMemoryStorage();
  clearPerfMetrics();
  markBootStart();
  const sample = recordBootMetrics(250);
  assert.ok(sample.firstInteractiveMs >= 0);
  assert.equal(loadPerfMetrics().length, 1);
  assert.equal(getLatestPerfSample()?.splashMs, 250);

  assert.equal(MIZAN_LOCAL_STORAGE_KEYS.includes("mizan.ui-prefs.v1"), true);
  assert.equal(MIZAN_LOCAL_STORAGE_KEYS.includes("mizan.error-log.v1"), true);
  assert.equal(MIZAN_LOCAL_STORAGE_KEYS.includes("mizan.perf.v1"), true);

  overwriteAndClearLocalKeys();
  assert.equal(loadPerfMetrics().length, 0);
  assert.equal(loadErrorLogs().length, 0);
});
