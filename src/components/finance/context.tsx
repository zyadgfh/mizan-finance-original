import { createContext, useContext } from "react";
import type { TxKind } from "@/lib/finance/types";

export type Tab = "home" | "ledger" | "debts" | "people" | "more";
export type DebtTabFilter = "open" | "overdue" | "receivable" | "payable" | "closed";

export type Route =
  | { name: "main" }
  | { name: "person"; id: string }
  | { name: "debt"; id: string }
  | { name: "report" }
  | { name: "goals" }
  | { name: "goal"; id: string }
  | { name: "wallets" }
  | { name: "recurring" }
  | { name: "notifications" }
  | { name: "drive" }
  | { name: "security" };

export type TxPrefill = {
  kind?: TxKind;
  amount?: number;
  categoryId?: string;
  walletId?: string;
  note?: string;
  personId?: string;
};

export type SheetState =
  | null
  | { kind: "txn"; id?: string; prefill?: TxPrefill }
  | { kind: "debt"; id?: string }
  | { kind: "pay"; debtId: string }
  | { kind: "person"; id?: string }
  | { kind: "reset" }
  | { kind: "transfer" }
  | { kind: "recurring"; id?: string }
  | { kind: "split" }
  | { kind: "goal"; id?: string }
  | { kind: "goal-move"; goalId: string; withdraw?: boolean }
  | { kind: "pin" }
  | { kind: "wallet"; id?: string }
  | { kind: "search" }
  | { kind: "csv-import" };

export type MizanUI = {
  tab: Tab;
  setTab: (tab: Tab) => void;
  month: string;
  shiftMonth: (delta: number) => void;
  route: Route;
  openPerson: (id: string) => void;
  openDebt: (id: string) => void;
  openReport: () => void;
  openGoals: () => void;
  openGoal: (id: string) => void;
  openWallets: () => void;
  openRecurring: () => void;
  openNotifications: () => void;
  openDrive: () => void;
  openSecurity: () => void;
  openDebtsFiltered: (filter: DebtTabFilter) => void;
  openLedgerFiltered: (categoryId?: string) => void;
  debtFilter: DebtTabFilter;
  setDebtFilter: (f: DebtTabFilter) => void;
  ledgerCategoryFilter: string;
  setLedgerCategoryFilter: (catId: string) => void;
  back: () => void;
  sheet: SheetState;
  openSheet: (sheet: Exclude<SheetState, null>) => void;
  closeSheet: () => void;
  query: string;
  setQuery: (q: string) => void;
  frame: HTMLElement | null;
  pinHash: string | null;
  setPinHash: (hash: string | null) => void;
};

export const MizanContext = createContext<MizanUI | null>(null);

export function useMizan() {
  const ctx = useContext(MizanContext);
  if (!ctx) throw new Error("missing mizan ui");
  return ctx;
}
