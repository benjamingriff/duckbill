import type { ReactNode } from "react";
import type { BalancePoint, MonthSummary } from "@duckbill/api/types";
import { formatMonth, money } from "../format.ts";

interface Props {
  months: MonthSummary[];
  balance: BalancePoint[];
}

export function KpiRow({ months, balance }: Props) {
  const current = months.at(-1);
  const previous = months.at(-2);
  // The current month is partial, so averages use complete months only.
  const complete = months.slice(0, -1);
  const average = complete.length
    ? complete.reduce((sum, m) => sum + m.spendPence, 0) / complete.length
    : null;
  const latest = balance.at(-1);

  return (
    <section className="grid kpis" aria-label="Key figures">
      <Tile
        label={current ? `Spent in ${formatMonth(current.month)}` : "Spent this month"}
        value={current ? money(current.spendPence) : "–"}
        sub={
          current && previous
            ? `${money(previous.spendPence)} in ${formatMonth(previous.month)}`
            : "Month to date"
        }
      />
      <Tile
        label="Average month"
        value={average === null ? "–" : money(average)}
        sub={`across ${complete.length} complete month${complete.length === 1 ? "" : "s"}`}
      />
      <Tile
        label="Income this month"
        value={current ? money(current.incomePence) : "–"}
        sub={
          current ? (
            <>
              Net{" "}
              <span className={current.netPence >= 0 ? "delta-down" : "delta-up"}>
                {current.netPence >= 0 ? "+" : "−"}
                {money(Math.abs(current.netPence))}
              </span>{" "}
              · {money(current.savedToPotsPence)} to pots
            </>
          ) : (
            ""
          )
        }
      />
      <Tile
        label="Balance"
        value={latest ? money(latest.balancePence + latest.potsPence) : "–"}
        sub={
          latest
            ? `${money(latest.balancePence)} account · ${money(latest.potsPence)} pots`
            : ""
        }
      />
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
      <div className="sub num">{sub}</div>
    </div>
  );
}
