// Response contracts shared with the web app. Money is integer pence; months
// are the first day of the month as YYYY-MM-DD; days are YYYY-MM-DD.

export interface SyncStatus {
  lastSyncedAt: string | null;
  firstTransactionDate: string | null;
  lastTransactionDate: string | null;
  transactionCount: number;
  pendingCount: number;
  dataDir: string;
}

export interface MonthSummary {
  month: string;
  spendPence: number;
  incomePence: number;
  netPence: number;
  savedToPotsPence: number;
  spendCount: number;
}

export interface CategoryMonth {
  month: string;
  category: string;
  label: string;
  spendPence: number;
  transactionCount: number;
}

export interface BalancePoint {
  day: string;
  balancePence: number;
  potsPence: number;
}

export interface PayeeSpend {
  payeeKey: string;
  name: string;
  emoji: string | null;
  categoryLabel: string | null;
  spendPence: number;
  transactionCount: number;
}

export interface Overview {
  status: SyncStatus;
  months: MonthSummary[];
  categories: CategoryMonth[];
  balance: BalancePoint[];
}

export interface ApiError {
  error: string;
  hint?: string;
}
