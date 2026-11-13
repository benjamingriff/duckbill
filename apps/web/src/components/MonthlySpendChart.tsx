import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { CategoryMonth, MonthSummary } from "@duckbill/api/types";
import { CATEGORY_SERIES, otherLabels, pivotCategories, type CategoryRow } from "../categories.ts";
import { formatMonth, formatMonthTick, money, moneyCompact } from "../format.ts";
import { ACCENT, AXIS_TICK, GRID_STROKE, Legend, SURFACE, Swatch } from "./chart.tsx";
import { Segmented } from "./Segmented.tsx";

type Mode = "total" | "category";
type View = "chart" | "table";

interface Props {
  months: MonthSummary[];
  categories: CategoryMonth[];
  selectedMonth: string | null;
  onSelectMonth: (month: string) => void;
}

export function MonthlySpendChart({ months, categories, selectedMonth, onSelectMonth }: Props) {
  const [mode, setMode] = useState<Mode>("total");
  const [view, setView] = useState<View>("chart");

  const rows = useMemo(
    () => pivotCategories(months.map((m) => m.month), categories),
    [months, categories],
  );
  const present = CATEGORY_SERIES.filter((s) => rows.some((r) => r[s.key] !== 0));
  const folded = otherLabels(categories);
  const totals = new Map(months.map((m) => [m.month, m]));

  const select = (data: unknown) => {
    const month = (data as { payload?: { month?: string } } | undefined)?.payload?.month;
    if (month) onSelectMonth(month);
  };
  const dim = (month: string) => (selectedMonth && month !== selectedMonth ? 0.6 : 1);

  return (
    <section className="card" aria-labelledby="monthly-spend-title">
      <div className="card-head">
        <div>
          <h2 id="monthly-spend-title">Spending per month</h2>
          <p>Excludes pot transfers, declines and income. Refunds net off. Click a month to drill in.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Segmented
            label="Breakdown"
            value={mode}
            onChange={setMode}
            options={[
              { value: "total", label: "Total" },
              { value: "category", label: "By category" },
            ]}
          />
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "chart", label: "Chart" },
              { value: "table", label: "Table" },
            ]}
          />
        </div>
      </div>

      {view === "table" ? (
        <MonthTable months={months} onSelectMonth={onSelectMonth} selectedMonth={selectedMonth} />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={(mode === "total" ? months : rows) as (MonthSummary | CategoryRow)[]}
              margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
              barCategoryGap="22%"
            >
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis
                dataKey="month"
                tickFormatter={formatMonthTick}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: GRID_STROKE }}
                interval="preserveStartEnd"
                minTickGap={12}
              />
              <YAxis
                tickFormatter={(v: number) => moneyCompact(v)}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip
                cursor={{ fill: "#141210" }}
                content={(props) => (
                  <SpendTooltip {...props} mode={mode} totals={totals} present={present} />
                )}
              />
              {mode === "total" ? (
                <Bar
                  dataKey="spendPence"
                  name="Spent"
                  fill={ACCENT}
                  radius={[4, 4, 0, 0]}
                  onClick={select}
                  cursor="pointer"
                  isAnimationActive={false}
                >
                  {months.map((m) => (
                    <Cell key={m.month} fillOpacity={dim(m.month)} />
                  ))}
                </Bar>
              ) : (
                present.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    stackId="spend"
                    fill={s.color}
                    stroke={SURFACE}
                    strokeWidth={1}
                    radius={i === present.length - 1 ? [4, 4, 0, 0] : 0}
                    onClick={select}
                    cursor="pointer"
                    isAnimationActive={false}
                  >
                    {rows.map((r) => (
                      <Cell key={r.month} fillOpacity={dim(r.month)} />
                    ))}
                  </Bar>
                ))
              )}
            </BarChart>
          </ResponsiveContainer>
          {mode === "category" && (
            <Legend
              items={present.map((s) => ({
                label: s.label,
                color: s.color,
                title: s.key === "other" && folded.length ? `Includes ${folded.join(", ")}` : undefined,
              }))}
            />
          )}
        </>
      )}
    </section>
  );
}

type SpendTooltipProps = TooltipContentProps<ValueType, NameType> & {
  mode: Mode;
  totals: Map<string, MonthSummary>;
  present: readonly (typeof CATEGORY_SERIES)[number][];
};

function SpendTooltip({ active, payload, label, mode, totals, present }: SpendTooltipProps) {
  if (!active || !payload?.length || typeof label !== "string") return null;
  const total = totals.get(label);
  const row = payload[0]?.payload as CategoryRow | undefined;
  return (
    <div className="tooltip num">
      <div className="title">{formatMonth(label)}</div>
      {mode === "category" && row
        ? [...present]
            .reverse()
            .filter((s) => row[s.key] !== 0)
            .map((s) => (
              <div className="row" key={s.key}>
                <Swatch color={s.color} />
                {s.label}
                <span className="v">{money(row[s.key])}</span>
              </div>
            ))
        : null}
      {total && (
        <div className={mode === "category" ? "row total" : "row"}>
          Spent
          <span className="v">{money(total.spendPence)}</span>
        </div>
      )}
      {total && (
        <div className="row">
          Payments
          <span className="v">{total.spendCount}</span>
        </div>
      )}
    </div>
  );
}

function MonthTable({
  months,
  selectedMonth,
  onSelectMonth,
}: Pick<Props, "months" | "selectedMonth" | "onSelectMonth">) {
  return (
    <div style={{ maxHeight: 340, overflow: "auto" }}>
      <table className="num">
        <thead>
          <tr>
            <th>Month</th>
            <th className="right">Spent</th>
            <th className="right">Income</th>
            <th className="right">Net</th>
            <th className="right">To pots</th>
          </tr>
        </thead>
        <tbody>
          {[...months].reverse().map((m) => (
            <tr
              key={m.month}
              onClick={() => onSelectMonth(m.month)}
              style={{ cursor: "pointer", background: m.month === selectedMonth ? "#141210" : undefined }}
            >
              <td className="primary">{formatMonth(m.month)}</td>
              <td className="right primary">{money(m.spendPence)}</td>
              <td className="right">{money(m.incomePence)}</td>
              <td className={`right ${m.netPence >= 0 ? "delta-down" : "delta-up"}`}>
                {money(m.netPence)}
              </td>
              <td className="right">{money(m.savedToPotsPence)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
