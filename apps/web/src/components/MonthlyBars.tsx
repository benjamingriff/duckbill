import type { CategoryMonth, MonthSummary, Season } from "@duckbill/api/types";
import { useCategory } from "../categories.ts";
import { formatMonth, formatMonthShort, kilo, money } from "../format.ts";
import { SEASONS, seasonOf, seasonShade } from "../seasons.ts";

interface Props {
  months: MonthSummary[];
  categories: CategoryMonth[];
  colourBy: "season" | "category";
  selectedMonth: string;
  /** The month in progress, drawn with a dashed outline and "so far". */
  currentMonth: string | undefined;
  onSelectMonth: (month: string) => void;
}

// Matches .bar-group .plot's height on desktop; the axis is hidden on phones.
const PLOT_HEIGHT = 290;

/** Spend per month as bars, grouped under the season each run of months falls in. */
export function MonthlyBars({
  months,
  categories,
  colourBy,
  selectedMonth,
  currentMonth,
  onSelectMonth,
}: Props) {
  const category = useCategory();
  const top = niceMax(Math.max(...months.map((m) => m.spendPence), 1));
  const dense = months.length > 12;
  const byMonth = new Map<string, CategoryMonth[]>();
  for (const c of categories) {
    if (c.spendPence > 0) byMonth.set(c.month, [...(byMonth.get(c.month) ?? []), c]);
  }

  // Consecutive months in the same season share a group and a label.
  const groups: { season: Season; months: MonthSummary[] }[] = [];
  for (const m of months) {
    const season = seasonOf(m.month);
    const last = groups.at(-1);
    if (last && last.season === season) last.months.push(m);
    else groups.push({ season, months: [m] });
  }

  const label = (iso: string) => {
    if (!dense) return formatMonthShort(iso);
    if (months.length > 24) return iso.slice(5, 7) === "01" ? `’${iso.slice(2, 4)}` : "";
    return formatMonthShort(iso).slice(0, 1);
  };

  return (
    <div className={`bars${dense ? " dense" : ""}`}>
      {[1, 2 / 3, 1 / 3, 0].map((f) => (
        <div key={f} style={{ position: "absolute", top: 20 + (1 - f) * (PLOT_HEIGHT - 20) }}>
          <div className="axis">{kilo(top * f, true)}</div>
        </div>
      ))}
      {[1, 2 / 3, 1 / 3].map((f) => (
        <div key={f} className="gridline" style={{ top: 20 + (1 - f) * (PLOT_HEIGHT - 20) }} />
      ))}
      {groups.map((g) => (
        <div className="bar-group" key={g.months[0]?.month} style={{ flex: g.months.length }}>
          <div className="plot">
            {g.months.map((m) => {
              const isCurrent = m.month === currentMonth;
              const selected = m.month === selectedMonth;
              const height = `calc((100% - 20px) * ${Math.max(m.spendPence, 0) / top})`;
              return (
                <button
                  type="button"
                  key={m.month}
                  className="bar-col"
                  onClick={() => onSelectMonth(m.month)}
                  title={`${formatMonth(m.month)}: ${money(m.spendPence)}`}
                  aria-label={`${formatMonth(m.month)}: ${money(m.spendPence)}`}
                  aria-pressed={selected}
                  style={{ opacity: selected ? 1 : 0.82 }}
                >
                  {!dense && (
                    <span className="value" style={isCurrent ? { color: "var(--fg)" } : undefined}>
                      {kilo(m.spendPence)}
                      {isCurrent ? " so far" : ""}
                    </span>
                  )}
                  <span
                    className={`bar${isCurrent ? " partial" : ""}`}
                    style={{
                      height,
                      background: colourBy === "season" ? seasonShade(m.month) : "transparent",
                    }}
                  >
                    {colourBy === "category" &&
                      (byMonth.get(m.month) ?? []).map((c) => (
                        <span
                          key={c.category}
                          style={{
                            flex: c.spendPence,
                            background: category(c.category).colour,
                            borderTop: "1px solid #000",
                          }}
                        />
                      ))}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="bar-labels">
            {g.months.map((m) => (
              <span key={m.month} className={m.month === selectedMonth ? "current" : undefined}>
                {label(m.month)}
              </span>
            ))}
          </div>
          <div className="season-label" style={{ color: SEASONS[g.season].colour }}>
            {months.length <= 24 && (!dense || g.months.length > 1) ? SEASONS[g.season].label : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

/** An axis maximum at or above `pence` whose thirds are round amounts (1k, 2k, 3k). */
function niceMax(pence: number): number {
  const third = pence / 100 / 3;
  const power = 10 ** Math.floor(Math.log10(third));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= third) ?? 10;
  return step * power * 3 * 100;
}
