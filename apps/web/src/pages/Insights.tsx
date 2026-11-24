import { useState, type CSSProperties } from "react";
import type { CategoryTrends, FoodSplit, Habit, Trip } from "@duckbill/api/types";
import { useJson } from "../api.ts";
import { useCategory } from "../categories.ts";
import { Dot, Loaded, SetupState, Tabs } from "../components/ui.tsx";
import {
  formatDay,
  formatMonthShort,
  money,
  moneyExact,
  percent,
  plural,
  poundsShort,
  weekdayName,
} from "../format.ts";
import { SEASONS, seasonOf } from "../seasons.ts";

export function Insights() {
  const trends = useJson<CategoryTrends>("/api/insights/categories?months=12");
  const trips = useJson<Trip[]>("/api/trips");
  const food = useJson<FoodSplit>("/api/insights/food?months=12");
  const habits = useJson<Habit[]>("/api/insights/habits");

  return (
    <>
      <section className="section" id="categories">
        <Loaded data={trends}>{(t) => <CategoryHeatmap trends={t} />}</Loaded>
      </section>
      <section className="section" id="trips">
        <div className="section-head">
          <div>
            <h2>Events &amp; trips</h2>
            <p>Trips Monzo spotted from where you paid, coloured by season.</p>
          </div>
        </div>
        <Loaded data={trips}>{(t) => <Trips trips={t} />}</Loaded>
      </section>
      <section
        className="section columns"
        id="food"
        style={{ "--cols": "1.5fr 1fr 1fr" } as CSSProperties}
      >
        <Loaded data={food}>{(f) => <EatingInOut food={f} />}</Loaded>
        <Loaded data={food}>{(f) => <SeasonShare food={f} />}</Loaded>
        <div id="habits">
          <Loaded data={habits}>{(h) => <Habits habits={h} />}</Loaded>
        </div>
      </section>
    </>
  );
}

function CategoryHeatmap({ trends }: { trends: CategoryTrends }) {
  const category = useCategory();
  const [measure, setMeasure] = useState<"spend" | "visits" | "plan">("spend");
  const rows = trends.rows.slice(0, 10);
  const columns = `minmax(110px, 150px) repeat(${trends.months.length}, minmax(0, 1fr)) 80px`;

  return (
    <>
      <div className="section-head">
        <div>
          <h2>Categories, month on month</h2>
          <p>
            Each row is shaded against its own busiest month, so you can see the seasons in each
            habit. Right: completed months against the same months a year before.
          </p>
        </div>
        <Tabs
          label="Measure"
          value={measure}
          onChange={setMeasure}
          options={[
            { value: "spend", label: "£ spent" },
            { value: "visits", label: "Visits" },
            { value: "plan", label: "vs plan", disabled: true, title: "Needs a plan" },
          ]}
        />
      </div>
      <div className="heatmap" style={{ gridTemplateColumns: columns }}>
        <span />
        {trends.months.map((m) => (
          <span key={m} className="month" style={{ color: SEASONS[seasonOf(m)].colour }}>
            {formatMonthShort(m)}
          </span>
        ))}
        <span className="month">vs last yr</span>
        {rows.map((r) => {
          const values = measure === "spend" ? r.spendPence : r.visits;
          const max = Math.max(...values, 1);
          const cat = category(r.category);
          const lastYear = r.lastYearTotalPence;
          const change = lastYear !== null && lastYear > 0 ? r.totalPence / lastYear - 1 : null;
          const isNew = lastYear === 0 && r.totalPence > 0;
          return (
            <div key={r.category} style={{ display: "contents" }}>
              <span className="rowname">
                <Dot colour={cat.colour} />
                {cat.label}
              </span>
              {values.map((v, i) => (
                <span
                  key={trends.months[i]}
                  className="cell"
                  title={`${cat.label}, ${formatMonthShort(trends.months[i] ?? "")}: ${
                    measure === "spend" ? money(v) : plural(v, "visit")
                  }`}
                  style={{
                    background:
                      v > 0
                        ? `color-mix(in srgb, ${cat.colour} ${20 + (v / max) * 80}%, #0d0d0f)`
                        : "#0b0b0c",
                    color: v > 0 ? undefined : "var(--fg-5)",
                  }}
                >
                  {v > 0 ? (measure === "spend" ? poundsShort(v) : v) : "–"}
                </span>
              ))}
              <span className={`change${change !== null && change > 0.05 ? " up" : ""}`}>
                {change !== null
                  ? `${change > 0 ? "+" : ""}${Math.round(change * 100)}%`
                  : isNew
                    ? "new"
                    : "–"}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Trips({ trips }: { trips: Trip[] }) {
  const category = useCategory();
  const [featured, ...others] = trips;
  if (!featured) {
    return (
      <SetupState title="No trips yet">
        Monzo marks payments abroad as a trip. Your own events, like a birthday or a weekend away,
        come with editing.
      </SetupState>
    );
  }
  const season = SEASONS[seasonOf(featured.startDate)];
  return (
    <div className="columns" style={{ "--cols": "2fr 1fr" } as CSSProperties}>
      <div className="trip-feature">
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <h3 style={{ color: season.colour }}>{featured.city ?? "Trip"}</h3>
          <span className="when">
            {formatDay(featured.startDate)} – {formatDay(featured.endDate)} ·{" "}
            {plural(featured.nights, "night")} · {plural(featured.transactionCount, "payment")}
          </span>
          <span className="figure" style={{ marginLeft: "auto", fontSize: 24 }}>
            {money(featured.spendPence)}
          </span>
        </div>
        <div className="trip-bar" aria-hidden>
          {featured.categories
            .filter((c) => c.spendPence > 0)
            .map((c) => (
              <span
                key={c.category}
                style={{ flex: c.spendPence, background: category(c.category).colour }}
              />
            ))}
        </div>
        <div className="flow-legend">
          {featured.categories
            .filter((c) => c.spendPence > 0)
            .map((c) => (
              <div key={c.category}>
                <span className="k" style={{ color: category(c.category).colour }}>
                  {category(c.category).label}
                </span>
                <span className="v" style={{ fontSize: 13 }}>
                  {money(c.spendPence)}
                </span>
              </div>
            ))}
        </div>
        <div style={{ marginTop: 20 }}>
          <SetupState title="Before, getting there, stay">
            Splitting a trip into its parts, and counting what you spent getting ready, comes with
            events.
          </SetupState>
        </div>
      </div>
      <div className="list">
        {others.slice(0, 6).map((t) => (
          <div className="row" key={t.tripId} style={{ padding: "12px 0" }}>
            <Dot colour={SEASONS[seasonOf(t.startDate)].colour} />
            <span className="name">
              {t.city ?? "Trip"}
              <div className="faint" style={{ fontSize: 12 }}>
                {formatDay(t.startDate)} · {plural(t.nights, "night")}
              </div>
            </span>
            <span className="figure">{money(t.spendPence)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const IN = "#199e70";
const OUT = "#d95926";

function EatingInOut({ food }: { food: FoodSplit }) {
  const out = (d: FoodSplit["weekdays"][number]) => d.eatingOutPence + d.takeawayPence;
  const max = Math.max(...food.weekdays.map((d) => Math.max(d.eatingInPence, out(d))), 1);
  const totalOut = food.weekdays.reduce((s, d) => s + out(d), 0);
  // The two days with the most eating out, and their share of it.
  const [first, second] = [...food.weekdays].sort((a, b) => out(b) - out(a));
  const topShare = first && second ? (out(first) + out(second)) / Math.max(totalOut, 1) : 0;
  const bigShop = [...food.weekdays].sort((a, b) => b.eatingInPence - a.eatingInPence)[0];
  return (
    <div>
      <h2>Eating in vs out, by day</h2>
      <p className="caption">
        Average £ per day over the last 12 months. <Dot colour={IN} /> groceries{" "}
        <Dot colour={OUT} /> eating out &amp; takeaway
      </p>
      <div className="food-bars">
        {food.weekdays.map((d) => (
          <div className="food-day" key={d.weekday}>
            <div className="pair">
              <span style={{ height: `${(d.eatingInPence / max) * 100}%`, background: IN }} />
              <span style={{ height: `${(out(d) / max) * 100}%`, background: OUT }} />
            </div>
            <span className="label">{weekdayName(d.weekday).slice(0, 3)}</span>
          </div>
        ))}
      </div>
      {totalOut > 0 && first && second && (
        <p className="caption" style={{ color: "var(--fg-2)", marginTop: 16 }}>
          {weekdayName(first.weekday)} and {weekdayName(second.weekday)} are{" "}
          <b style={{ color: "var(--fg)" }}>
            {percent(topShare)} of everything you spend eating out
          </b>
          .{bigShop && ` ${weekdayName(bigShop.weekday)} is the big shop.`}
        </p>
      )}
    </div>
  );
}

function SeasonShare({ food }: { food: FoodSplit }) {
  return (
    <div>
      <h2>Share eaten out, by season</h2>
      <p className="caption">Of all food spending, restaurants and takeaway included.</p>
      <div className="season-share" style={{ marginTop: 24 }}>
        {food.seasons.map((s) => (
          <div key={s.season} style={{ display: "contents" }}>
            <span style={{ color: SEASONS[s.season].colour, fontWeight: 600 }}>
              {SEASONS[s.season].label}
            </span>
            <span className="meter">
              <span style={{ width: percent(s.outShare), background: SEASONS[s.season].colour }} />
            </span>
            <span className="figure" style={{ textAlign: "right" }}>
              {percent(s.outShare)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Habits({ habits }: { habits: Habit[] }) {
  return (
    <div>
      <h2>Habits worth knowing</h2>
      {habits.length === 0 && <p className="caption">Not enough history yet.</p>}
      {habits.map((h) => (
        <div className="habit" key={h.habit}>
          <HabitText habit={h} />
        </div>
      ))}
    </div>
  );
}

function HabitText({ habit }: { habit: Habit }) {
  switch (habit.habit) {
    case "top_payee":
      return (
        <>
          <div className="v">{money(habit.valuePence)} a year</div>
          <div className="d">
            at {habit.label} · {Math.round(habit.count / 12)} a month at {money(habit.comparePence)}
          </div>
        </>
      );
    case "payday_lift": {
      const lift = habit.comparePence > 0 ? habit.valuePence / habit.comparePence - 1 : 0;
      return (
        <>
          <div className="v" style={{ color: lift > 0 ? "var(--bad)" : "var(--good)" }}>
            {lift > 0 ? "+" : ""}
            {Math.round(lift * 100)}%
          </div>
          <div className="d">daily spend in the 5 days from payday</div>
        </>
      );
    }
    case "takeaway_average":
      return (
        <>
          <div className="v">
            {moneyExact(habit.comparePence)} → {moneyExact(habit.valuePence)}
          </div>
          <div className="d">
            average takeaway, {habit.fromYear} → {habit.toYear}
          </div>
        </>
      );
  }
}
