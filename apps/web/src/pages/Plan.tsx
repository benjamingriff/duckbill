import type { CSSProperties } from "react";
import type { Balances, RecurringPayment } from "@duckbill/api/types";
import { useJson } from "../api.ts";
import { useCategory } from "../categories.ts";
import { Dot, Loaded, SetupState } from "../components/ui.tsx";
import { money, ordinal, weekdayName } from "../format.ts";
import { PotGoal } from "./Overview.tsx";

/** The plan itself comes later; for now, what's already committed each month. */
export function Plan() {
  const recurring = useJson<RecurringPayment[]>("/api/recurring");
  const balances = useJson<Balances>("/api/balances");

  return (
    <>
      <section className="plan-hero" style={{ paddingTop: 40 }}>
        <div className="eyebrow">Every month</div>
        <h1>Give every pound a job</h1>
        <SetupState title="Your monthly plan">
          Split take-home pay into committed, saving and flexible, with a budget per category. Left
          to spend, the plan line and flexible spending vs plan on Overview all come from it, and
          the planning agent will suggest changes for you to accept.
        </SetupState>
      </section>

      <section
        className="section columns"
        style={{ "--cols": "1.4fr 1fr", marginTop: 36 } as CSSProperties}
      >
        <div className="list" style={{ gap: 20 }}>
          <div>
            <h2>Savings goals</h2>
            <p className="caption">Pots with a goal in Monzo.</p>
          </div>
          <Loaded data={balances}>
            {(b) => (
              <div className="list" style={{ gap: 16 }}>
                {b.pots
                  .filter((p) => p.goalPence)
                  .map((p) => (
                    <PotGoal
                      key={p.potId}
                      name={p.name}
                      balance={p.balancePence}
                      goal={p.goalPence ?? 0}
                    />
                  ))}
              </div>
            )}
          </Loaded>
          <SetupState title="Goal dates">
            A start and target date for each goal, so the bar can show where you should be today and
            how much a month gets you there.
          </SetupState>
          <div style={{ marginTop: 16 }}>
            <h2>Debts, and what paying them off frees up</h2>
          </div>
          <SetupState title="Debts">
            Car finance, a student loan or Flex: the balance, monthly payment and end date, and the
            money each one frees up when it ends. Monzo doesn't share these, so you'll add them.
          </SetupState>
        </div>

        <Loaded data={recurring}>{(r) => <Committed payments={r} />}</Loaded>
      </section>
    </>
  );
}

const KINDS = [
  { kind: "standing_order", label: "Standing orders" },
  { kind: "direct_debit", label: "Direct debits" },
  { kind: "subscription", label: "Subscriptions" },
] as const;

function when(p: RecurringPayment): string {
  switch (p.cadence) {
    case "weekly":
      return p.typicalWeekday ? `${weekdayName(p.typicalWeekday)}s` : "weekly";
    case "fortnightly":
      return p.typicalWeekday ? `every other ${weekdayName(p.typicalWeekday)}` : "fortnightly";
    case "monthly":
      return p.typicalDayOfMonth ? ordinal(p.typicalDayOfMonth) : "monthly";
    case "quarterly":
      return `quarterly${p.typicalDayOfMonth ? `, ${ordinal(p.typicalDayOfMonth)}` : ""}`;
    case "yearly":
      return "yearly";
    default:
      return "irregular";
  }
}

/** Active direct debits, standing orders and subscriptions, with a monthly total. */
function Committed({ payments }: { payments: RecurringPayment[] }) {
  const category = useCategory();
  const total = payments.reduce((s, p) => s + (p.monthlyPence ?? 0), 0);
  return (
    <div>
      <div className="flow-head">
        <div>
          <h2>Committed spend</h2>
          <p className="caption">Leaves before you spend anything else.</p>
        </div>
        <span className="figure" style={{ fontSize: 15 }}>
          {money(total)}/mo
        </span>
      </div>
      {payments.length === 0 && <p className="caption">No regular payments found yet.</p>}
      {KINDS.map(({ kind, label }) => {
        const rows = payments.filter((p) => p.kind === kind);
        if (!rows.length) return null;
        return (
          <div key={kind} style={{ marginTop: 20 }}>
            <div className="eyebrow">{label}</div>
            {rows.map((p) => (
              <div className="committed-row" key={p.key}>
                <span className="cat" style={{ fontSize: 14 }}>
                  <Dot colour={category(p.category).colour} />
                  {p.name}
                </span>
                <span className="when">{when(p)}</span>
                <span className="figure">
                  {money(p.monthlyPence ?? p.typicalPence)}
                  {p.cadence !== "monthly" && p.monthlyPence !== null && (
                    <span className="faint">/mo</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
