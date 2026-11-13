import type { CategoryMonth } from "@duckbill/api/types";

// Fixed category -> colour mapping so a category keeps its colour whatever
// the date range. Order matches the validated palette's slot order (adjacent
// pairs pass the colour-blindness separation check on the dark surface).
// Anything not listed folds into "Other".
export const CATEGORY_SERIES = [
  { key: "bills", label: "Bills", color: "#3987e5" },
  { key: "eating_out", label: "Eating out", color: "#d95926" },
  { key: "groceries", label: "Groceries", color: "#199e70" },
  { key: "transport", label: "Transport", color: "#c98500" },
  { key: "shopping", label: "Shopping", color: "#d55181" },
  { key: "holidays", label: "Holidays", color: "#008300" },
  { key: "entertainment", label: "Entertainment", color: "#9085e9" },
  { key: "personal_care", label: "Personal care", color: "#e66767" },
  { key: "other", label: "Other", color: "#77716c" },
] as const;

export type SeriesKey = (typeof CATEGORY_SERIES)[number]["key"];

const KNOWN = new Set<string>(CATEGORY_SERIES.map((s) => s.key));

export const seriesKeyFor = (category: string): SeriesKey =>
  (KNOWN.has(category) ? category : "other") as SeriesKey;

export type CategoryRow = { month: string } & Record<SeriesKey, number>;

/** Pivot long category rows into one row per month for stacking. */
export function pivotCategories(months: string[], rows: CategoryMonth[]): CategoryRow[] {
  const byMonth = new Map<string, CategoryRow>();
  for (const month of months) {
    const row = { month } as CategoryRow;
    for (const s of CATEGORY_SERIES) row[s.key] = 0;
    byMonth.set(month, row);
  }
  for (const r of rows) {
    const row = byMonth.get(r.month);
    if (row) row[seriesKeyFor(r.category)] += r.spendPence;
  }
  return [...byMonth.values()];
}

/** Labels of the categories folded into "Other" within the given rows. */
export function otherLabels(rows: CategoryMonth[]): string[] {
  return [...new Set(rows.filter((r) => !KNOWN.has(r.category)).map((r) => r.label))].sort();
}
