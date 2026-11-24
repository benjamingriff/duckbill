import type { DuckDBValue } from "@duckdb/node-api";

/** Filters for the transactions search, as the web app sends them. */
export interface SearchFilters {
  /** Free text. Words must each match the payee, description or note;
   *  `>5` and `<20` set amount bounds in pounds. */
  q?: string;
  from?: string;
  to?: string;
  categories?: string[];
  /** Bounds on the amount's size, in pence, whichever direction it went. */
  minPence?: number;
  maxPence?: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date as YYYY-MM-DD (so not 2026-02-30). */
function isDay(value: string | undefined): value is string {
  if (!value || !DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
const AMOUNT = /^([<>])£?(\d+(?:\.\d{1,2})?)$/;

/** Read filters from query parameters, ignoring anything malformed. */
export function parseFilters(params: Record<string, string | undefined>): SearchFilters {
  const pence = (value: string | undefined) => {
    const n = Number(value);
    return value && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  };
  return {
    q: params.q?.trim() || undefined,
    from: isDay(params.from) ? params.from : undefined,
    to: isDay(params.to) ? params.to : undefined,
    categories: params.category?.split(",").filter(Boolean),
    minPence: pence(params.min),
    maxPence: pence(params.max),
  };
}

/** A SQL condition over gold_effective_transactions, and its parameters. */
export function whereClause(filters: SearchFilters): {
  sql: string;
  params: Record<string, DuckDBValue>;
} {
  const conditions = ["true"];
  const params: Record<string, DuckDBValue> = {};
  let { minPence, maxPence } = filters;

  const words = (filters.q ?? "").split(/\s+/).filter(Boolean);
  let n = 0;
  for (const word of words) {
    const amount = AMOUNT.exec(word);
    if (amount) {
      const value = Math.round(Number(amount[2]) * 100);
      if (amount[1] === ">") minPence = Math.max(minPence ?? 0, value + 1);
      else maxPence = Math.min(maxPence ?? Infinity, value - 1);
      continue;
    }
    const name = `w${n++}`;
    params[name] = word.toLowerCase();
    conditions.push(
      `(contains(lower(payee_name), $${name}) or contains(lower(description), $${name})` +
        ` or contains(lower(coalesce(notes, '')), $${name}))`,
    );
  }
  if (filters.from) {
    conditions.push("transaction_date >= $from::date");
    params.from = filters.from;
  }
  if (filters.to) {
    conditions.push("transaction_date <= $to::date");
    params.to = filters.to;
  }
  if (filters.categories?.length) {
    conditions.push("list_contains(string_split($categories, ','), category)");
    params.categories = filters.categories.join(",");
  }
  if (minPence !== undefined) {
    conditions.push("abs(amount_pence) >= $minPence");
    params.minPence = minPence;
  }
  if (maxPence !== undefined && Number.isFinite(maxPence)) {
    conditions.push("abs(amount_pence) <= $maxPence");
    params.maxPence = maxPence;
  }
  return { sql: conditions.join(" and "), params };
}
