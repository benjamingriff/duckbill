// Response contracts shared with the web app. Money is integer pence; months
// are the first day of the month as YYYY-MM-DD; days are YYYY-MM-DD.
// Weekdays are ISO: 1 is Monday, 7 is Sunday.

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
  /** The part of spendPence paid by direct debits, standing orders and subscriptions. */
  committedSpendPence: number;
  incomePence: number;
  salaryIncomePence: number;
  otherIncomePence: number;
  netPence: number;
  savedToPotsPence: number;
  spendCount: number;
}

export interface CategoryMonth {
  month: string;
  category: string;
  spendPence: number;
  transactionCount: number;
}

export type CategoryGroup = "committed" | "flexible" | "saving" | "income" | "transfer";

/** A row of the category table: every page takes category display from these. */
export interface Category {
  category: string;
  label: string;
  colour: string;
  parent: string | null;
  group: CategoryGroup;
}

export interface Overview {
  status: SyncStatus;
  months: MonthSummary[];
  categories: CategoryMonth[];
}

export interface Pot {
  potId: string;
  name: string;
  balancePence: number;
  goalPence: number | null;
  /** A Monzo savings pot (Instant Access or fixed term), not a regular pot. */
  isSavings: boolean;
  isBillsPot: boolean;
}

/** Where money sits at the last sync: the current account(s) and each open pot. */
export interface Balances {
  accountPence: number;
  pots: Pot[];
  /** Monzo's own total of the account(s) plus pots, to check ours against; null before any sync. */
  monzoTotalPence: number | null;
  /** When Monzo reported these balances, as UTC ISO; null before any sync. */
  syncedAt: string | null;
}

export interface TransactionRow {
  id: string;
  /** Local wall-clock time, YYYY-MM-DDTHH:MM:SS. */
  createdAt: string;
  date: string;
  payeeKey: string;
  payeeName: string;
  emoji: string | null;
  description: string;
  notes: string | null;
  amountPence: number;
  /** Foreign currency amount in minor units, when paid abroad. */
  localAmountMinor: number;
  localCurrency: string;
  category: string;
  countsAsSpending: boolean;
  isPending: boolean;
  incomeKind: "salary" | "other" | null;
  recurringKind: "direct_debit" | "standing_order" | "subscription" | null;
  tripId: string | null;
  tripCity: string | null;
}

export interface SpendBucket {
  start: string;
  spendPence: number;
}

export interface TransactionSearch {
  /** Every matching transaction, not just this page of rows. */
  total: number;
  netPence: number;
  spendPence: number;
  /** Average spend per spending payment, or null with none. */
  averageSpendPence: number | null;
  busiestWeekday: number | null;
  /** Spend per week, or per month when the results span more than six months. */
  bucket: "week" | "month";
  buckets: SpendBucket[];
  rows: TransactionRow[];
}

export interface TransactionDetail {
  transaction: TransactionRow & { scheme: string; hasSplitBill: boolean };
  /** Your history with this payee: payments (visits), spend net of refunds, by quarter. */
  payee: {
    visits: number;
    totalPence: number;
    averagePence: number | null;
    firstDate: string | null;
    quarters: SpendBucket[];
  };
}

export type Cadence =
  "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly" | "irregular" | "unknown";

export interface RecurringPayment {
  key: string;
  kind: "direct_debit" | "standing_order" | "subscription";
  name: string;
  category: string;
  cadence: Cadence;
  typicalWeekday: number | null;
  typicalDayOfMonth: number | null;
  typicalPence: number;
  /** What it costs in an average month; null when the cadence isn't regular. */
  monthlyPence: number | null;
  lastPaidOn: string;
}

export interface CategoryTrend {
  category: string;
  /** One value per month in CategoryTrends.months. */
  spendPence: number[];
  visits: number[];
  /** Spend over the completed months (the current month is partial). */
  totalPence: number;
  /** The same completed months a year earlier, or null when history doesn't reach back. */
  lastYearTotalPence: number | null;
}

export interface CategoryTrends {
  months: string[];
  rows: CategoryTrend[];
}

export interface Trip {
  tripId: string;
  city: string | null;
  country: string | null;
  startDate: string;
  endDate: string;
  nights: number;
  spendPence: number;
  transactionCount: number;
  categories: { category: string; spendPence: number }[];
}

export interface FoodSplit {
  /** Average spend per calendar day, one row per weekday (1 to 7). */
  weekdays: {
    weekday: number;
    eatingInPence: number;
    eatingOutPence: number;
    takeawayPence: number;
  }[];
  /** Share of food spend that was eating out or takeaway, per season. */
  seasons: { season: Season; outShare: number }[];
}

export type Season = "winter" | "spring" | "summer" | "autumn";

export type Habit =
  | { habit: "top_payee"; label: string; valuePence: number; comparePence: number; count: number }
  | { habit: "payday_lift"; valuePence: number; comparePence: number; count: number }
  | {
      habit: "takeaway_average";
      valuePence: number;
      comparePence: number;
      fromYear: number;
      toYear: number;
    };

export interface ApiError {
  error: string;
  hint?: string;
}
