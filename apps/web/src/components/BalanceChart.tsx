import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { BalancePoint } from "@duckbill/api/types";
import { formatDay, formatMonthTick, money, moneyCompact } from "../format.ts";
import { AXIS_TICK, GRID_STROKE, Legend, Swatch } from "./chart.tsx";

const SERIES = [
  { key: "balancePence", label: "Current account", color: "#3987e5" },
  { key: "potsPence", label: "Pots", color: "#d95926" },
] as const;

export function BalanceChart({ balance }: { balance: BalancePoint[] }) {
  // One tick per month: the first day of each month present in the data.
  const ticks = balance.filter((p) => p.day.endsWith("-01")).map((p) => p.day);

  return (
    <section className="card" aria-labelledby="balance-title">
      <div className="card-head">
        <div>
          <h2 id="balance-title">Balance over time</h2>
          <p>
            End of day, rebuilt from today's balance and your transactions. Pot interest isn't
            visible to the API, so older pot values read slightly low.
          </p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={balance} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis
            dataKey="day"
            ticks={ticks}
            tickFormatter={formatMonthTick}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tickFormatter={(v: number) => moneyCompact(v)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            cursor={{ stroke: "#36312d", strokeWidth: 1 }}
            content={(props) => <BalanceTooltip {...props} />}
          />
          {SERIES.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: "#0d0b0a", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <Legend items={SERIES.map((s) => ({ label: s.label, color: s.color }))} />
    </section>
  );
}

function BalanceTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length || typeof label !== "string") return null;
  const point = payload[0]?.payload as BalancePoint | undefined;
  if (!point) return null;
  return (
    <div className="tooltip num">
      <div className="title">{formatDay(label)}</div>
      {SERIES.map((s) => (
        <div className="row" key={s.key}>
          <Swatch color={s.color} />
          {s.label}
          <span className="v">{money(point[s.key])}</span>
        </div>
      ))}
      <div className="row total">
        Total
        <span className="v">{money(point.balancePence + point.potsPence)}</span>
      </div>
    </div>
  );
}
