export const CURRENCIES = ["EGP", "SAR", "AED", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export type Tone = "tint" | "green" | "red" | "orange" | "gray";

export type IconName =
  | "utensils"
  | "car"
  | "zap"
  | "house"
  | "bag"
  | "health"
  | "edu"
  | "fun"
  | "more"
  | "briefcase"
  | "wallet"
  | "gift"
  | "trend"
  | "tag";

export type TxKind = "income" | "expense";
export type DebtDirection = "receivable" | "payable";
export type TxSource = "manual" | "recurring" | "debt" | "split";
export type WalletKind = "cash" | "instapay" | "vodafone" | "bank" | "other";

export type Category = {
  id: string;
  name: string;
  kind: TxKind;
  icon: IconName;
  tone: Tone;
  custom?: boolean;
};

export type Tx = {
  id: string;
  kind: TxKind;
  amount: number;
  categoryId: string;
  note: string;
  date: string;
  personId?: string;
  walletId?: string;
  source?: TxSource;
  /** false = moves a wallet but stays out of income/expense summaries */
  reported?: boolean;
  receiptId?: string;
  createdAt: number;
};

export type Person = {
  id: string;
  name: string;
  phone: string;
  note: string;
  createdAt: number;
};

export type Debt = {
  id: string;
  personId: string;
  direction: DebtDirection;
  title: string;
  principal: number;
  dueDate: string;
  /** 1 = lump sum. Above 1, equal monthly parts starting at dueDate. */
  installments?: number;
  note: string;
  createdAt: number;
};

export type Payment = {
  id: string;
  debtId: string;
  amount: number;
  date: string;
  note: string;
  walletId?: string;
  txId?: string;
  createdAt: number;
};

export type Budget = {
  categoryId: string;
  limit: number;
};

export type Wallet = {
  id: string;
  name: string;
  kind: WalletKind;
  opening: number;
  createdAt: number;
};

export type Transfer = {
  id: string;
  fromId: string;
  toId: string;
  amount: number;
  date: string;
  note: string;
  createdAt: number;
};

export type Recurring = {
  id: string;
  kind: TxKind;
  amount: number;
  categoryId: string;
  walletId: string;
  note: string;
  day: number;
  active: boolean;
  lastMonth: string;
  createdAt: number;
};

export type Goal = {
  id: string;
  name: string;
  target: number;
  deadline: string;
  createdAt: number;
};

export type GoalMove = {
  id: string;
  goalId: string;
  walletId: string;
  /** Positive saves into the goal. Negative returns money to the wallet. */
  amount: number;
  date: string;
  note: string;
  createdAt: number;
};

export type Data = {
  txns: Tx[];
  people: Person[];
  debts: Debt[];
  payments: Payment[];
  categories: Category[];
  budgets: Budget[];
  openingBalance: number;
  currency: Currency;
  demo: boolean;
  wallets: Wallet[];
  transfers: Transfer[];
  recurring: Recurring[];
  goals: Goal[];
  goalMoves: GoalMove[];
};
