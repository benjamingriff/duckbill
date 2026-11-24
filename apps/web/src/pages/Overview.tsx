import { useState } from "react";
import type {
  Balances,
  CategoryMonth,
  MonthSummary,
  Overview as OverviewData,
} from "@duckbill/api/types";
import { useJson } from "../api.ts";
import { useCategory } from "../categories.ts";
import { MonthlyBars } from "../components/MonthlyBars.tsx";
import { Dot, Loaded, SetupState, Tabs } from "../components/ui.tsx";
import { formatMonth, formatMonthName, money, plural } from "../format.ts";
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

      <section className="section columns">
        <Loaded data={balances}>{(b) => <MoneySits balances={b} />}</Loaded>
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

const POT_SHADES = ["#2e8b4a", "#3fa35c", "#5cc07a"];

function MoneySits({ balances }: { balances: Balances }) {
  const items = [
    { name: "Current account", pence: balances.accountPence, colour: "#c9ced6" },
    ...balances.pots.map((p, i) => ({
      name: p.name,
      pence: p.balancePence,
      colour: p.isBillsPot ? "#8b93a0" : (POT_SHADES[i % POT_SHADES.length] ?? "#3fa35c"),
    })),
  ];
  const total = items.reduce((s, i) => s + Math.max(i.pence, 0), 0);
  return (
    <div className="list" style={{ gap: 16 }}>
      <div className="flow-head">
        <h2>Where your money sits</h2>
        <span className="figure" style={{ fontSize: 15 }}>
          {money(total)}
        </span>
      </div>
      <div className="stack" aria-hidden>
        {items.map((i) =>
          i.pence > 0 ? (
            <span key={i.name} style={{ flex: i.pence, background: i.colour }} />
          ) : null,
        )}
      </div>
      <div className="list">
        {items.map((i) => (
          <div className="row" key={i.name}>
            <Dot colour={i.colour} />
            <span className="name">{i.name}</span>
            <span className="figure">{money(i.pence)}</span>
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
