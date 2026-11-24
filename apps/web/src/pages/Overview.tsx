import { useState, type CSSProperties, type ReactNode } from "react";
import type {
  Balances,
  CategoryMonth,
  MonthSummary,
  Overview as OverviewData,
  Pot,
} from "@duckbill/api/types";
import { useJson } from "../api.ts";
import { useCategory } from "../categories.ts";
import { MonthlyBars } from "../components/MonthlyBars.tsx";
import { Dot, Loaded, SetupState, Tabs } from "../components/ui.tsx";
import {
  formatMonth,
  formatMonthName,
  formatSyncTime,
  money,
  moneyExact,
  plural,
} from "../format.ts";
import { navigate } from "../route.ts";

const RANGES = [
  { value: 6, label: "6M" },
  { value: 12, label: "12M" },
  { value: 24, label: "24M" },
  { value: 0, label: "All" },
];

interface Props {
  overview: OverviewData;
  month: MonthSummary;
  isCurrentMonth: boolean;
  onSelectMonth: (month: string) => void;
}

export function Overview({ overview, month, isCurrentMonth, onSelectMonth }: Props) {
  const [range, setRange] = useState(12);
  const [colourBy, setColourBy] = useState<"season" | "category">("season");
  const balances = useJson<Balances>("/api/balances");
  const shown = range ? overview.months.slice(-range) : overview.months;

  return (
    <>
      <Loaded data={balances}>{(b) => <Balance balances={b} />}</Loaded>

      <section className="hero">
        <Hero month={month} isCurrentMonth={isCurrentMonth} />
        <MoneyFlow month={month} isCurrentMonth={isCurrentMonth} />
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Spending per month</h2>
            <p>Everything out except pot transfers and payments to your own accounts.</p>
          </div>
          <div className="controls">
            <Tabs
              label="Colour by"
              showLabel
              value={colourBy}
              onChange={setColourBy}
              options={[
                { value: "season", label: "Season" },
                { value: "category", label: "Category" },
              ]}
            />
            <Tabs label="Date range" value={range} onChange={setRange} options={RANGES} />
          </div>
        </div>
        <MonthlyBars
          months={shown}
          categories={overview.categories}
          colourBy={colourBy}
          selectedMonth={month.month}
          currentMonth={isCurrentMonth ? month.month : overview.months.at(-1)?.month}
          onSelectMonth={onSelectMonth}
        />
        {colourBy === "category" && <CategoryLegend rows={overview.categories} months={shown} />}
        <p className="caption">A dashed plan line shows here once you set up a monthly plan.</p>
      </section>

      <section
        className="section columns"
        style={{ "--cols": "repeat(2, minmax(0, 1fr))" } as CSSProperties}
      >
        <Loaded data={balances}>{(b) => <Goals balances={b} />}</Loaded>
        <div className="list" style={{ gap: 16 }}>
          <div className="flow-head">
            <h2>Flexible spending vs plan</h2>
            <a
              className="link"
              href="/insights"
              onClick={(e) => {
                e.preventDefault();
                navigate("/insights");
              }}
            >
              Insights →
            </a>
          </div>
          <SetupState title="Needs a plan">
            Each flexible category against its monthly budget, with a tick for where you should be
            by today.
          </SetupState>
        </div>
      </section>
    </>
  );
}

function daysLeftIn(monthIso: string): number {
  const today = new Date();
  const [y, m] = monthIso.split("-").map(Number) as [number, number];
  const lastDay = new Date(y, m, 0).getDate();
  return lastDay - today.getDate();
}

function Hero({ month, isCurrentMonth }: { month: MonthSummary; isCurrentMonth: boolean }) {
  const name = formatMonthName(month.month);
  const daysSoFar = isCurrentMonth
    ? new Date().getDate()
    : new Date(Number(month.month.slice(0, 4)), Number(month.month.slice(5, 7)), 0).getDate();
  const perDay = month.spendPence / Math.max(daysSoFar, 1);
  return (
    <div className="hero-main">
      <div className="eyebrow">
        {isCurrentMonth
          ? `${name} · ${plural(daysLeftIn(month.month), "day")} left`
          : formatMonth(month.month)}
      </div>
      <div className="hero-figure">
        <span className="big">{money(month.spendPence)}</span>
        <span className="unit">{isCurrentMonth ? "spent so far" : "spent"}</span>
      </div>
      <div className="hero-sub">
        of {money(month.incomePence)} in · about <b>{money(perDay)} a day</b>
        {isCurrentMonth ? " so far" : ""}
        <div className="faint" style={{ fontSize: 13, marginTop: 4 }}>
          What's left to spend, and a daily allowance until payday, appear once you set up a plan.
        </div>
      </div>
    </div>
  );
}

/** Where the month's income went: committed, saved, spent, and what's left. */
function MoneyFlow({ month, isCurrentMonth }: { month: MonthSummary; isCurrentMonth: boolean }) {
  const committed = Math.max(month.committedSpendPence, 0);
  const saved = Math.max(month.savedToPotsPence, 0);
  const flexible = Math.max(month.spendPence - month.committedSpendPence, 0);
  const out = committed + saved + flexible;
  const left = month.incomePence - out;
  const scale = Math.max(month.incomePence, out, 1);
  const width = (pence: number) => `${(pence / scale) * 100}%`;

  const parts = [
    {
      key: "Committed",
      colour: "var(--committed)",
      value: committed,
      note: "bills, subscriptions",
    },
    { key: "Saved", colour: "var(--saved)", value: saved, note: "into pots" },
    { key: "Spent", colour: "var(--spent)", value: flexible, note: "everything else" },
  ];

  return (
    <div className="flow">
      <div className="flow-head">
        <h2>Where {formatMonthName(month.month)}'s income is going</h2>
        <span className="mono" style={{ color: "var(--fg-2)", fontSize: 13 }}>
          {money(month.incomePence)} in · {money(out)} out{isCurrentMonth ? " so far" : ""}
        </span>
      </div>
      <div className="flow-bar" aria-hidden>
        {parts.map((p) =>
          p.value > 0 ? (
            <span key={p.key} style={{ width: width(p.value), background: p.colour }} />
          ) : null,
        )}
        {left > 0 && <span className="left" />}
      </div>
      <div className="flow-legend">
        {parts.map((p) => (
          <div key={p.key}>
            <span className="k" style={{ color: p.colour }}>
              {p.key}
            </span>
            <span className="v">{money(p.value)}</span>
            <span className="d">{p.note}</span>
          </div>
        ))}
        <div>
          <span className="k" style={{ color: "var(--fg-2)" }}>
            {left < 0 && month.incomePence > 0 ? "Over" : "Left"}
          </span>
          <span className="v">{month.incomePence > 0 ? money(Math.abs(left)) : "–"}</span>
          <span className="d">
            {month.incomePence > 0
              ? `${money(month.salaryIncomePence)} salary · ${money(month.otherIncomePence)} other`
              : "no income in yet"}
          </span>
        </div>
      </div>
    </div>
  );
}

function CategoryLegend({ rows, months }: { rows: CategoryMonth[]; months: MonthSummary[] }) {
  const category = useCategory();
  const inRange = new Set(months.map((m) => m.month));
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (inRange.has(r.month)) totals.set(r.category, (totals.get(r.category) ?? 0) + r.spendPence);
  }
  const top = [...totals.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  return (
    <div className="flow-legend" style={{ marginTop: 16, gap: 18 }}>
      {top.map(([key]) => (
        <span key={key} className="cat">
          <Dot colour={category(key).colour} />
          {category(key).label}
        </span>
      ))}
    </div>
  );
}

const sumPots = (pots: Pot[]) => pots.reduce((s, p) => s + p.balancePence, 0);

/**
 * What's in the account, its savings pots and its other pots as Monzo last
 * reported them, in exact pence so they can be checked against the app. The
 * total is checked against Monzo's own total, which counts every pot: a
 * difference means a pot is missing here. "Show pots" lists them one by one.
 */
function Balance({ balances }: { balances: Balances }) {
  const [open, setOpen] = useState(false);
  const savings = balances.pots.filter((p) => p.isSavings);
  const pots = balances.pots.filter((p) => !p.isSavings);
  const total = balances.accountPence + sumPots(balances.pots);
  const monzoTotal = balances.monzoTotalPence;
  const [pounds, pence] = moneyExact(balances.accountPence).split(".");

  return (
    <section className="balance" aria-label="Balance">
      <div className="balance-top">
        <div className="balance-main">
          <div className="eyebrow">
            Balance{balances.syncedAt ? ` · as of ${formatSyncTime(balances.syncedAt)}` : ""}
          </div>
          <div className="balance-figure">
            <span className="big">
              {pounds}
              <span className="pence">.{pence}</span>
            </span>
            <span className="unit">in your current account</span>
          </div>
        </div>
        <div className="balance-parts">
          <BalancePart
            name="Savings"
            pence={sumPots(savings)}
            note={savings.length ? plural(savings.length, "savings pot") : "no savings pots"}
          />
          <BalancePart
            name="Pots"
            pence={sumPots(pots)}
            note={pots.length ? plural(pots.length, "pot") : "no other pots"}
          />
          <BalancePart name="Total" pence={total}>
            {monzoTotal === null ? (
              <span className="d">not checked</span>
            ) : monzoTotal === total ? (
              <span className="d good">✓ matches Monzo</span>
            ) : (
              <span className="d bad" title="Monzo's total counts every pot">
                Monzo says {moneyExact(monzoTotal)}
              </span>
            )}
          </BalancePart>
        </div>
        {balances.pots.length > 0 && (
          <button
            type="button"
            className="chip"
            aria-expanded={open}
            aria-controls="balance-detail"
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide pots" : `Show ${plural(balances.pots.length, "pot")}`}
            <span aria-hidden>{open ? "▴" : "▾"}</span>
          </button>
        )}
      </div>
      {open && <BalanceDetail id="balance-detail" balances={balances} />}
    </section>
  );
}

function BalancePart({
  name,
  pence,
  note,
  children,
}: {
  name: string;
  pence: number;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <span className="k">{name}</span>
      <span className="v">{moneyExact(pence)}</span>
      {note && <span className="d">{note}</span>}
      {children}
    </div>
  );
}

const ACCOUNT_COLOUR = "#c9ced6";
const SAVINGS_SHADES = ["#2e8b4a", "#3fa35c", "#5cc07a"];
const POT_SHADES = ["#5b8def", "#7aa2f2", "#9ab8f5"];
const BILLS_COLOUR = "#8b93a0";

/** The account and every pot, one row each, with a bar of how the total splits. */
function BalanceDetail({ id, balances }: { id: string; balances: Balances }) {
  const shade = (shades: string[], i: number) => shades[i % shades.length] ?? shades[0] ?? "";
  const savings = balances.pots.filter((p) => p.isSavings);
  const pots = balances.pots.filter((p) => !p.isSavings);
  const items = [
    {
      key: "account",
      name: "Current account",
      tag: "",
      pence: balances.accountPence,
      colour: ACCOUNT_COLOUR,
    },
    ...savings.map((p, i) => ({
      key: p.potId,
      name: p.name,
      tag: "Savings",
      pence: p.balancePence,
      colour: shade(SAVINGS_SHADES, i),
    })),
    ...pots.map((p, i) => ({
      key: p.potId,
      name: p.name,
      tag: p.isBillsPot ? "Bills" : "",
      pence: p.balancePence,
      colour: p.isBillsPot ? BILLS_COLOUR : shade(POT_SHADES, i),
    })),
  ];
  return (
    <div id={id} className="balance-detail">
      <div className="stack" aria-hidden>
        {items.map((i) =>
          i.pence > 0 ? <span key={i.key} style={{ flex: i.pence, background: i.colour }} /> : null,
        )}
      </div>
      <div className="list">
        {items.map((i) => (
          <div className="row" key={i.key}>
            <Dot colour={i.colour} />
            <span className="name">{i.name}</span>
            {i.tag && <span className="badge">{i.tag}</span>}
            <span className="figure">{moneyExact(i.pence)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Goals({ balances }: { balances: Balances }) {
  const goals = balances.pots.filter((p) => p.goalPence);
  return (
    <div className="list" style={{ gap: 16 }}>
      <div className="flow-head">
        <h2>Goals</h2>
        <a
          className="link"
          href="/plan"
          onClick={(e) => {
            e.preventDefault();
            navigate("/plan");
          }}
        >
          Open Plan →
        </a>
      </div>
      {goals.map((p) => (
        <PotGoal key={p.potId} name={p.name} balance={p.balancePence} goal={p.goalPence ?? 0} />
      ))}
      <SetupState title={goals.length ? "Goal dates" : "No goals yet"}>
        {goals.length
          ? "Target dates, monthly amounts and whether you're on track come with planning."
          : "Pots with a goal in Monzo show here. Goals with dates come with planning."}
      </SetupState>
    </div>
  );
}

export function PotGoal({ name, balance, goal }: { name: string; balance: number; goal: number }) {
  const share = goal > 0 ? Math.min(balance / goal, 1) : 0;
  return (
    <div className="goal">
      <div className="goal-head">
        <span>{name}</span>
        <span className="mono">
          {money(balance)} / {money(goal)}
        </span>
      </div>
      <div className="meter">
        <span style={{ width: `${share * 100}%`, background: "#3fa35c" }} />
      </div>
      <div style={{ color: "var(--good)", fontSize: 12 }}>
        {share >= 1 ? "Goal reached" : `${Math.round(share * 100)}% of the pot's goal`}
      </div>
    </div>
  );
}
