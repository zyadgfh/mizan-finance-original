import { cashPosition, debtTotals, goalsSaved, round2, walletBalance } from "./logic.ts";
import type { Currency, Data } from "./types.ts";

export const NISAB_GOLD_24K_GRAMS = 85;
export const ZAKAT_RATE = 0.025;

/**
 * Illustrative default 24K gold gram prices per currency.
 * Stored locally and immediately editable by the user at any time.
 */
export const DEFAULT_GOLD_24K_GRAM_PRICE: Record<Currency, number> = {
  EGP: 4250,
  SAR: 335,
  AED: 328,
  USD: 89,
  EUR: 83,
};

function goldPriceStorageKey(currency: Currency): string {
  return `mizan.zakat.gold24kPrice.${currency}.v1`;
}

export function loadSavedGold24kPrice(currency: Currency, storage?: Storage): {
  pricePerGram: number;
  isCustomSaved: boolean;
} {
  try {
    const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    const raw = store?.getItem(goldPriceStorageKey(currency));
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        return { pricePerGram: round2(parsed), isCustomSaved: true };
      }
    }
  } catch {
    /* ignore */
  }
  return {
    pricePerGram: DEFAULT_GOLD_24K_GRAM_PRICE[currency] ?? 4250,
    isCustomSaved: false,
  };
}

export function saveGold24kPrice(currency: Currency, pricePerGram: number, storage?: Storage): void {
  if (!Number.isFinite(pricePerGram) || pricePerGram <= 0) return;
  try {
    const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    store?.setItem(goldPriceStorageKey(currency), String(round2(pricePerGram)));
  } catch {
    /* ignore */
  }
}

export type ZakatNetWorthBreakdown = {
  currency: Currency;
  gold24kGramPrice: number;
  nisabGrams: number;
  nisabAmount: number;
  walletsLiquidTotal: number;
  goalsSavedTotal: number;
  receivableDebtsTotal: number;
  grossAssets: number;
  payableDebtsTotal: number;
  netZakatableWealth: number;
  reachesNisab: boolean;
  shortfallToNisab: number;
  zakatDue: number;
  walletBreakdown: Array<{ id: string; name: string; balance: number }>;
};

export function computeNetWorthZakat(
  data: Pick<
    Data,
    "wallets" | "txns" | "transfers" | "goalMoves" | "debts" | "payments" | "openingBalance" | "currency" | "exchangeRates"
  >,
  gold24kGramPrice: number,
): ZakatNetWorthBreakdown {
  const safeGoldPrice = Number.isFinite(gold24kGramPrice) && gold24kGramPrice > 0 ? round2(gold24kGramPrice) : 0;
  const nisabAmount = round2(NISAB_GOLD_24K_GRAMS * safeGoldPrice);

  const walletsLiquidTotal = cashPosition(data);
  const goalsSavedTotal = Math.max(0, round2(goalsSaved(data.goalMoves)));
  const totals = debtTotals(data.debts, data.payments);
  const receivableDebtsTotal = round2(totals.receivable);
  const payableDebtsTotal = round2(totals.payable);

  const grossAssets = round2(walletsLiquidTotal + goalsSavedTotal + receivableDebtsTotal);
  const netZakatableWealth = round2(grossAssets - payableDebtsTotal);

  const reachesNisab = safeGoldPrice > 0 && netZakatableWealth >= nisabAmount;
  const shortfallToNisab =
    safeGoldPrice > 0 && netZakatableWealth < nisabAmount
      ? round2(nisabAmount - Math.max(0, netZakatableWealth))
      : 0;
  const zakatDue = reachesNisab ? round2(netZakatableWealth * ZAKAT_RATE) : 0;

  const walletBreakdown = data.wallets.map((w) => ({
    id: w.id,
    name: w.name,
    balance: walletBalance(w.id, data),
  }));

  return {
    currency: data.currency,
    gold24kGramPrice: safeGoldPrice,
    nisabGrams: NISAB_GOLD_24K_GRAMS,
    nisabAmount,
    walletsLiquidTotal,
    goalsSavedTotal,
    receivableDebtsTotal,
    grossAssets,
    payableDebtsTotal,
    netZakatableWealth,
    reachesNisab,
    shortfallToNisab,
    zakatDue,
    walletBreakdown,
  };
}
