import type { PayeeSpend } from "@duckbill/api/types";
import type { Loadable } from "../api.ts";
import { formatMonth, money } from "../format.ts";

interface Props {
  month: string | null;
  payees: Loadable<PayeeSpend[]>;
}

export function TopPayees({ month, payees }: Props) {
  const rows = payees.data ?? [];
  const max = Math.max(1, ...rows.map((r) => r.spendPence));

  return (
    <section className="card" aria-labelledby="payees-title">
      <div className="card-head">
        <div>
          <h2 id="payees-title">Top merchants</h2>
          <p>{month ? formatMonth(month) : "Select a month"}</p>
        </div>
      </div>
      {payees.state === "error" ? (
        <div className="error">{payees.error.message}</div>
      ) : rows.length === 0 && payees.state === "ready" ? (
        <div className="empty">No spending this month.</div>
      ) : (
        <table className="num" style={{ opacity: payees.state === "loading" ? 0.6 : 1 }}>
          <thead>
            <tr>
              <th>Merchant</th>
              <th className="right">Payments</th>
              <th className="right">Spent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.payeeKey}>
                <td className="primary">
                  {r.emoji ? `${r.emoji} ` : ""}
                  {r.name}
                  {r.categoryLabel && (
                    <span style={{ color: "var(--fg-3)", marginLeft: 8 }}>{r.categoryLabel}</span>
                  )}
                  <div className="meter" aria-hidden>
                    <span style={{ width: `${(r.spendPence / max) * 100}%` }} />
                  </div>
                </td>
                <td className="right">{r.transactionCount}</td>
                <td className="right primary">{money(r.spendPence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
