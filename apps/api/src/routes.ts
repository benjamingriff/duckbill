import { Hono } from "hono";
import type { DuckDBValue } from "@duckdb/node-api";
import { parseFilters, whereClause } from "./search.ts";
import type {
  ApiError,
  Balances,
  Category,
  CategoryMonth,
  CategoryTrend,
  CategoryTrends,
  FoodSplit,
  Habit,
  MonthSummary,
  Overview,
  Pot,
  RecurringPayment,
  SpendBucket,
  SyncStatus,
  TransactionDetail,
  TransactionRow,
  TransactionSearch,
  Trip,
} from "./types.ts";

/** Runs a read-only query against the warehouse. */
export type Query = <T>(sql: string, params?: Record<string, DuckDBValue>) => Promise<T[]>;

function monthsParam(value: string | undefined, fallback = 24): number {
  const n = Number(value ?? fallback);
  return Number.isInteger(n) && n > 0 && n <= 240 ? n : fallback;
}

/** The first of the current month, YYYY-MM-DD, in the server's time zone. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

// The last N calendar months, including the current (partial) month.
const recentMonths = `
  select month from gold.gold_monthly_summary
  order by month desc limit $months
`;

// One TransactionRow from gold_effective_transactions aliased `t`, with
// gold_trips aliased `trip` left-joined on trip_id.
const transactionColumns = `
  t.transaction_id                                       as "id",
  strftime(t.created_at_local, '%Y-%m-%dT%H:%M:%S')      as "createdAt",
  strftime(t.transaction_date, '%Y-%m-%d')               as "date",
  t.payee_key                                            as "payeeKey",
  t.payee_name                                           as "payeeName",
  t.merchant_emoji                                       as "emoji",
  t.description                                          as "description",
  t.notes                                                as "notes",
  t.amount_pence::integer                                as "amountPence",
  t.local_amount_minor::integer                          as "localAmountMinor",
  t.local_currency                                       as "localCurrency",
  t.category                                             as "category",
  t.counts_as_spending                                   as "countsAsSpending",
  t.is_pending                                           as "isPending",
  t.income_kind                                          as "incomeKind",
  t.recurring_kind                                       as "recurringKind",
  t.trip_id                                              as "tripId",
  trip.city                                              as "tripCity"
`;

/**
 * The read-only API over the gold tables. `query` runs SQL against the
 * warehouse; the server passes one that caches per dbt build.
 */
export function createApi(query: Query, dataDir: string): Hono {
  const api = new Hono();

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

  api.get("/api/overview", async (c) => {
    const months = monthsParam(c.req.query("months"));
    const [syncStatus, summary, categories] = await Promise.all([
      status(),
      query<MonthSummary>(
        `
        select
          strftime(month, '%Y-%m-%d')        as "month",
          spend_pence::integer               as "spendPence",
          committed_spend_pence::integer     as "committedSpendPence",
          income_pence::integer              as "incomePence",
          salary_income_pence::integer       as "salaryIncomePence",
          other_income_pence::integer        as "otherIncomePence",
          net_pence::integer                 as "netPence",
          saved_to_pots_pence::integer       as "savedToPotsPence",
          spend_count::integer               as "spendCount"
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
          spend_pence::integer           as "spendPence",
          transaction_count::integer     as "transactionCount"
        from gold.gold_monthly_category_spend
        where month in (${recentMonths}) and (spend_pence != 0 or transaction_count > 0)
        order by month, spend_pence desc
        `,
        { months },
      ),
    ]);
    const body: Overview = { status: syncStatus, months: summary, categories };
    return c.json(body);
  });

  api.get("/api/categories", async (c) => {
    const rows = await query<Category>(`
      select category, label, colour, parent, category_group as "group"
      from enrich.enrich_categories
      order by category
    `);
    return c.json(rows);
  });

  api.get("/api/balances", async (c) => {
    const [[account], pots] = await Promise.all([
      query<{ accountPence: number }>(`
        select coalesce(sum(balance_pence), 0)::integer as "accountPence"
        from gold.gold_daily_balance
        where day = (select max(day) from gold.gold_daily_balance)
      `),
      query<Pot>(`
        select
          pot_id                    as "potId",
          pot_name                  as "name",
          balance_pence::integer    as "balancePence",
          goal_pence::integer       as "goalPence",
          is_bills_pot              as "isBillsPot"
        from gold.gold_pots
        order by balance_pence desc
      `),
    ]);
    const body: Balances = { accountPence: account?.accountPence ?? 0, pots };
    return c.json(body);
  });

  api.get("/api/transactions", async (c) => {
    const filters = parseFilters(c.req.query());
    const { sql: where, params } = whereClause(filters);
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100) || 100, 1), 500);
    const matching = `select * from gold.gold_effective_transactions where ${where}`;

    const [[totals], weekdays, rows] = await Promise.all([
      query<{
        total: number;
        netPence: number;
        spendPence: number;
        averageSpendPence: number | null;
        firstDate: string | null;
        lastDate: string | null;
      }>(
        `
        select
          count(*)::integer                                           as "total",
          coalesce(sum(amount_pence), 0)::integer                     as "netPence",
          coalesce(sum(spend_pence), 0)::integer                      as "spendPence",
          round(avg(spend_pence) filter (where counts_as_spending and amount_pence < 0))::integer
                                                                      as "averageSpendPence",
          strftime(min(transaction_date), '%Y-%m-%d')                 as "firstDate",
          strftime(max(transaction_date), '%Y-%m-%d')                 as "lastDate"
        from (${matching})
        `,
        params,
      ),
      query<{ weekday: number; spendPence: number }>(
        `
        select weekday::integer as "weekday", sum(spend_pence)::integer as "spendPence"
        from (${matching})
        group by weekday
        order by sum(spend_pence) desc
        `,
        params,
      ),
      query<TransactionRow>(
        `
        select ${transactionColumns}
        from (${matching}) as t
        left join gold.gold_trips as trip using (trip_id)
        order by t.created_at_local desc, t.transaction_id
        limit $limit
        `,
        { ...params, limit },
      ),
    ]);

    // Weekly bars, or monthly ones when the results span more than six months.
    const spanDays =
      totals?.firstDate && totals.lastDate
        ? (Date.parse(totals.lastDate) - Date.parse(totals.firstDate)) / 86_400_000
        : 0;
    const bucket = spanDays > 183 ? "month" : "week";
    const buckets = await query<SpendBucket>(
      `
      with b as (
        select date_trunc('${bucket}', transaction_date) as start, sum(spend_pence) as spend
        from (${matching})
        group by 1
      ),
      spine as (
        select unnest(generate_series(min(start), max(start), interval 1 ${bucket})) as start
        from b
      )
      select strftime(s.start, '%Y-%m-%d') as "start", coalesce(b.spend, 0)::integer as "spendPence"
      from spine as s left join b using (start)
      order by s.start
      `,
      params,
    );

    const busiest = weekdays[0];
    const body: TransactionSearch = {
      total: totals?.total ?? 0,
      netPence: totals?.netPence ?? 0,
      spendPence: totals?.spendPence ?? 0,
      averageSpendPence: totals?.averageSpendPence ?? null,
      busiestWeekday: busiest && busiest.spendPence > 0 ? busiest.weekday : null,
      bucket,
      buckets,
      rows,
    };
    return c.json(body);
  });

  api.get("/api/transactions/:id", async (c) => {
    const id = c.req.param("id");
    const [transaction] = await query<TransactionDetail["transaction"]>(
      `
      select
        ${transactionColumns},
        t.scheme                         as "scheme",
        t.bill_splitting_id is not null  as "hasSplitBill"
      from gold.gold_effective_transactions as t
      left join gold.gold_trips as trip using (trip_id)
      where t.transaction_id = $id
      `,
      { id },
    );
    if (!transaction) return c.json<ApiError>({ error: "No such transaction" }, 404);

    const payeeKey = transaction.payeeKey;
    const [[summary], quarters] = await Promise.all([
      query<Omit<TransactionDetail["payee"], "quarters">>(
        `
        select
          count(*) filter (where amount_pence < 0)::integer  as "visits",
          coalesce(sum(spend_pence), 0)::integer             as "totalPence",
          round(avg(spend_pence) filter (where amount_pence < 0))::integer
                                                             as "averagePence",
          strftime(min(transaction_date) filter (where amount_pence < 0), '%Y-%m-%d')
                                                             as "firstDate"
        from gold.gold_effective_transactions
        where payee_key = $payeeKey and counts_as_spending
        `,
        { payeeKey },
      ),
      query<SpendBucket>(
        `
        with q as (
          select date_trunc('quarter', transaction_date) as start, sum(spend_pence) as spend
          from gold.gold_effective_transactions
          where payee_key = $payeeKey and counts_as_spending
          group by 1
        ),
        spine as (
          select unnest(generate_series(min(start), max(start), interval 3 month)) as start
          from q
        )
        select strftime(s.start, '%Y-%m-%d') as "start", coalesce(q.spend, 0)::integer as "spendPence"
        from spine as s left join q using (start)
        order by s.start
        `,
        { payeeKey },
      ),
    ]);
    const body: TransactionDetail = {
      transaction,
      payee: {
        visits: summary?.visits ?? 0,
        totalPence: summary?.totalPence ?? 0,
        averagePence: summary?.averagePence ?? null,
        firstDate: summary?.firstDate ?? null,
        quarters,
      },
    };
    return c.json(body);
  });

  api.get("/api/recurring", async (c) => {
    const rows = await query<RecurringPayment>(`
      select
        recurring_key                      as "key",
        recurring_kind                     as "kind",
        name                               as "name",
        category                           as "category",
        cadence                            as "cadence",
        typical_weekday::integer           as "typicalWeekday",
        typical_day_of_month::integer      as "typicalDayOfMonth",
        typical_pence::integer             as "typicalPence",
        monthly_pence::integer             as "monthlyPence",
        strftime(last_paid_on, '%Y-%m-%d') as "lastPaidOn"
      from gold.gold_recurring_payments
      where is_active
      order by monthly_pence desc nulls last, typical_pence desc
    `);
    return c.json(rows);
  });

  api.get("/api/insights/categories", async (c) => {
    const months = monthsParam(c.req.query("months"), 12);
    const rows = await query<CategoryTrend>(
      `
      select
        category                                                 as "category",
        list(spend_pence::integer order by month)                as "spendPence",
        list(transaction_count::integer order by month)          as "visits",
        -- The year-on-year change compares completed months only, and only
        -- when the year before is inside the history we hold.
        coalesce(sum(spend_pence) filter (where month < $thisMonth), 0)::integer
                                                                 as "totalPence",
        case
          when min(month) - interval 1 year >= (select min(month) from gold.gold_monthly_summary)
          then coalesce(sum(last_year_spend_pence) filter (where month < $thisMonth), 0)::integer
        end                                                      as "lastYearTotalPence"
      from gold.gold_monthly_category_spend
      where month in (${recentMonths})
      group by category
      having sum(spend_pence) > 0
      order by sum(spend_pence) desc
      `,
      { months, thisMonth: thisMonth() },
    );
    const monthList = await query<{ month: string }>(
      `select strftime(month, '%Y-%m-%d') as "month" from (${recentMonths}) order by month`,
      { months },
    );
    const body: CategoryTrends = { months: monthList.map((m) => m.month), rows };
    return c.json(body);
  });

  api.get("/api/trips", async (c) => {
    const rows = await query<Trip>(`
      select
        t.trip_id                                  as "tripId",
        t.city                                     as "city",
        t.country                                  as "country",
        strftime(t.start_date, '%Y-%m-%d')         as "startDate",
        strftime(t.end_date, '%Y-%m-%d')           as "endDate",
        t.nights::integer                          as "nights",
        t.spend_pence::integer                     as "spendPence",
        t.transaction_count::integer               as "transactionCount",
        coalesce(
          (select list({'category': c.category, 'spendPence': c.spend_pence::integer}
                       order by c.spend_pence desc)
           from gold.gold_trip_categories as c where c.trip_id = t.trip_id),
          []
        )                                          as "categories"
      from gold.gold_trips as t
      order by t.start_date desc
    `);
    return c.json(rows);
  });

  api.get("/api/insights/food", async (c) => {
    const months = monthsParam(c.req.query("months"), 12);
    const window = "day > current_date - to_months($months)";
    const [weekdays, seasons] = await Promise.all([
      query<FoodSplit["weekdays"][number]>(
        `
        select
          weekday::integer                        as "weekday",
          round(avg(eating_in_pence))::integer    as "eatingInPence",
          round(avg(eating_out_pence))::integer   as "eatingOutPence",
          round(avg(takeaway_pence))::integer     as "takeawayPence"
        from gold.gold_daily_food_spend
        where ${window}
        group by weekday
        order by weekday
      `,
        { months },
      ),
      query<FoodSplit["seasons"][number]>(
        `
        select
          season as "season",
          coalesce(
            sum(eating_out_pence + takeaway_pence)
              / nullif(sum(eating_in_pence + eating_out_pence + takeaway_pence), 0),
            0
          )::double as "outShare"
        from gold.gold_daily_food_spend
        where ${window}
        group by season
        order by list_position(['winter', 'spring', 'summer', 'autumn'], season)
      `,
        { months },
      ),
    ]);
    const body: FoodSplit = { weekdays, seasons };
    return c.json(body);
  });

  api.get("/api/insights/habits", async (c) => {
    const rows = await query<Habit>(`
      select
        habit                      as "habit",
        label                      as "label",
        value_pence::integer       as "valuePence",
        compare_pence::integer     as "comparePence",
        count::integer             as "count",
        from_year::integer         as "fromYear",
        to_year::integer           as "toYear"
      from gold.gold_habits
    `);
    return c.json(rows);
  });

  return api;
}
