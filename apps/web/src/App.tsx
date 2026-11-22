import { useState } from "react";
import type { Overview, PayeeSpend } from "@duckbill/api/types";
import { useJson } from "./api.ts";
import { AccountMenu } from "./auth.tsx";
import { BalanceChart } from "./components/BalanceChart.tsx";
import { KpiRow } from "./components/KpiRow.tsx";
import { MonthlySpendChart } from "./components/MonthlySpendChart.tsx";
import { Segmented } from "./components/Segmented.tsx";
import { TopPayees } from "./components/TopPayees.tsx";
import { formatDay, relativeTime } from "./format.ts";

const RANGES = [
  { value: 6, label: "6M" },
  { value: 12, label: "12M" },
  { value: 24, label: "24M" },
  { value: 240, label: "All" },
];

export function App() {
  const [range, setRange] = useState(12);
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  const overviewUrl = `/api/overview?months=${range}`;
  const overview = useJson<Overview>(overviewUrl);
  const shownRange = RANGES.find((r) => overview.dataUrl === `/api/overview?months=${r.value}`);
  const stale = overview.data !== undefined && overview.dataUrl !== overviewUrl;

  const months = overview.data?.months ?? [];
  // Default the drill-down to the latest month; keep the user's pick while it's in range.
  const selectedMonth =
    pickedMonth && months.some((m) => m.month === pickedMonth)
      ? pickedMonth
      : (months.at(-1)?.month ?? null);
  const payees = useJson<PayeeSpend[]>(
    selectedMonth ? `/api/payees?from=${selectedMonth}&to=${selectedMonth}&limit=12` : null,
  );

  const status = overview.data?.status;
  const isDemo = status?.dataDir.endsWith("data-demo");

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          duckbill <small>Monzo analytics</small>
        </div>
        <div className="spacer" />
        {status && (
          <div className="meta num">
            {isDemo && <span className="badge">demo data</span>}
            {status.pendingCount > 0 && <span>{status.pendingCount} pending</span>}
            <span>{status.transactionCount.toLocaleString("en-GB")} transactions</span>
            {status.lastSyncedAt && (
              <span title={status.lastSyncedAt}>synced {relativeTime(status.lastSyncedAt)}</span>
            )}
          </div>
        )}
        <AccountMenu />
      </header>

      <div className="page-head">
        <div>
          <h1>Spending</h1>
          {status?.firstTransactionDate && (
            <p>
              History from {formatDay(status.firstTransactionDate)} · current month is month to date
            </p>
          )}
        </div>
        <Segmented label="Date range" options={RANGES} value={range} onChange={setRange} />
      </div>

      {overview.state === "error" && overview.data && (
        <div className="error" role="alert" style={{ marginBottom: 16, padding: 16 }}>
          Couldn't refresh: {overview.error.message}
          {stale && shownRange && ` · still showing the ${shownRange.label} range`}
          {overview.error.hint && <p>{overview.error.hint}</p>}
        </div>
      )}

      {overview.state === "error" && !overview.data ? (
        <div className="error">
          <p>{overview.error.message}</p>
          {overview.error.hint && <p>{overview.error.hint}</p>}
        </div>
      ) : !overview.data ? (
        <div className="empty">Loading…</div>
      ) : (
        <div style={{ opacity: stale ? 0.55 : 1, transition: "opacity 120ms" }}>
          <KpiRow months={overview.data.months} balance={overview.data.balance} />
          <MonthlySpendChart
            months={overview.data.months}
            categories={overview.data.categories}
            selectedMonth={selectedMonth}
            onSelectMonth={setPickedMonth}
          />
          <div className="grid two-col">
            <BalanceChart balance={overview.data.balance} />
            <TopPayees month={selectedMonth} payees={payees} />
          </div>
        </div>
      )}
    </div>
  );
}
