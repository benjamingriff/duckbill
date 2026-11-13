import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { dataDir, query, WarehouseUnavailable } from "./db.ts";
import { allowedHosts, parseAllowedHosts } from "./hosts.ts";
import type {
  ApiError,
  BalancePoint,
  CategoryMonth,
  MonthSummary,
  Overview,
  PayeeSpend,
  SyncStatus,
} from "./types.ts";

const app = new Hono();

// Only answer requests addressed to localhost (or DUCKBILL_ALLOWED_HOSTS, comma-separated).
app.use(allowedHosts(parseAllowedHosts(process.env.DUCKBILL_ALLOWED_HOSTS)));

const MONTH = /^\d{4}-\d{2}-01$/;

function monthsParam(value: string | undefined): number {
  const n = Number(value ?? 24);
  return Number.isInteger(n) && n > 0 && n <= 240 ? n : 24;
}

async function status(): Promise<SyncStatus> {
  const [row] = await query<Omit<SyncStatus, "dataDir">>(`
    select
      strftime(timezone('UTC', last_synced_at), '%Y-%m-%dT%H:%M:%SZ') as "lastSyncedAt",
      strftime(first_transaction_date, '%Y-%m-%d')   as "firstTransactionDate",
      strftime(last_transaction_date, '%Y-%m-%d')    as "lastTransactionDate",
      transaction_count::integer                      as "transactionCount",
      pending_count::integer                          as "pendingCount"
    from gold.gold_sync_status
  `);
  return {
    lastSyncedAt: row?.lastSyncedAt ?? null,
    firstTransactionDate: row?.firstTransactionDate ?? null,
    lastTransactionDate: row?.lastTransactionDate ?? null,
    transactionCount: row?.transactionCount ?? 0,
    pendingCount: row?.pendingCount ?? 0,
    dataDir,
  };
}

// The last N calendar months, including the current (partial) month.
const recentMonths = `
  select month from gold.gold_monthly_summary
  order by month desc limit $months
`;

app.get("/api/overview", async (c) => {
  const months = monthsParam(c.req.query("months"));
  const [syncStatus, summary, categories, balance] = await Promise.all([
    status(),
    query<MonthSummary>(
      `
      select
        strftime(month, '%Y-%m-%d')    as "month",
        spend_pence::integer           as "spendPence",
        income_pence::integer          as "incomePence",
        net_pence::integer             as "netPence",
        saved_to_pots_pence::integer   as "savedToPotsPence",
        spend_count::integer           as "spendCount"
      from gold.gold_monthly_summary
      where month in (${recentMonths})
      order by month
      `,
      { months },
    ),
    query<CategoryMonth>(
      `
      select
        strftime(month, '%Y-%m-%d')    as "month",
        category                       as "category",
        category_label                 as "label",
        spend_pence::integer           as "spendPence",
        transaction_count::integer     as "transactionCount"
      from gold.gold_monthly_category_spend
      where month in (${recentMonths})
      order by month, spend_pence desc
      `,
      { months },
    ),
    query<BalancePoint>(
      `
      select
        strftime(day, '%Y-%m-%d')      as "day",
        sum(balance_pence)::integer    as "balancePence",
        sum(pots_pence)::integer       as "potsPence"
      from gold.gold_daily_balance
      where day >= (select min(month) from (${recentMonths}))
      group by day
      order by day
      `,
      { months },
    ),
  ]);
  const body: Overview = { status: syncStatus, months: summary, categories, balance };
  return c.json(body);
});

app.get("/api/payees", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!from || !to || !MONTH.test(from) || !MONTH.test(to)) {
    return c.json<ApiError>({ error: "from and to must be YYYY-MM-01" }, 400);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? 10) || 10, 50);
  const rows = await query<PayeeSpend>(
    `
    select
      payee_key                        as "payeeKey",
      any_value(payee_name)            as "name",
      any_value(emoji)                 as "emoji",
      any_value(category_label)        as "categoryLabel",
      sum(spend_pence)::integer        as "spendPence",
      sum(transaction_count)::integer  as "transactionCount"
    from gold.gold_monthly_payee_spend
    where month between $from::date and $to::date
    group by payee_key
    having sum(spend_pence) > 0
    order by "spendPence" desc
    limit $limit
    `,
    { from, to, limit },
  );
  return c.json(rows);
});

app.onError((err, c) => {
  if (err instanceof WarehouseUnavailable) {
    return c.json<ApiError>(
      {
        error: err.message,
        hint: "Run `pnpm demo` for synthetic data, or `pnpm monzo:login` to import from Monzo.",
      },
      503,
    );
  }
  console.error(err);
  return c.json<ApiError>({ error: "Internal error" }, 500);
});

const port = Number(process.env.DUCKBILL_API_PORT ?? 8787);
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
  console.log(`duckbill api on http://127.0.0.1:${port} (data: ${dataDir})`);
});
