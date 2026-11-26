import assert from "node:assert/strict";
import { before, test } from "node:test";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { createApi, type Query } from "./routes.ts";
import type { Balances, TransactionDetail, TransactionSearch } from "./types.ts";

// A tiny gold schema with just the rows each test needs.
let connection: DuckDBConnection;
const query: Query = async (sql, params = {}) =>
  (await connection.runAndReadAll(sql, params)).getRowObjectsJS() as never[];

interface Tx {
  id: string;
  date: string;
  payee: string;
  amount: number;
  notes?: string;
  spends?: boolean;
  category?: string;
}

const TRANSACTIONS: Tx[] = [
  // Wednesday and Saturday dinners, a week apart, and a coffee.
  { id: "t1", date: "2026-11-04", payee: "Dishoom", amount: -4000, notes: "Dinner with Sam" },
  { id: "t2", date: "2026-11-14", payee: "Dishoom", amount: -6000 },
  { id: "t3", date: "2026-11-14", payee: "Pret", amount: -350, notes: "dinner on the go" },
  // A refund and a salary don't count as visits.
  { id: "t4", date: "2026-11-15", payee: "Dishoom", amount: 1000 },
  {
    id: "t5",
    date: "2026-11-25",
    payee: "ACME",
    amount: 300000,
    spends: false,
    category: "income",
  },
  // An older visit, two quarters back.
  { id: "t6", date: "2026-04-02", payee: "Dishoom", amount: -5000 },
];

before(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(`
    create schema gold;
    create table gold.gold_trips (trip_id varchar, city varchar);
    create table gold.gold_effective_transactions (
      transaction_id varchar, created_at_local timestamp, transaction_date date,
      weekday bigint, payee_key varchar, payee_name varchar, merchant_emoji varchar,
      description varchar, notes varchar, scheme varchar, amount_pence bigint,
      local_amount_minor bigint, local_currency varchar, category varchar,
      counts_as_spending boolean, spend_pence bigint, is_pending boolean,
      income_kind varchar, recurring_kind varchar, trip_id varchar, bill_splitting_id varchar
    );
    create table gold.gold_account_balances (
      account_id varchar, balance_pence bigint, monzo_total_pence bigint, synced_at timestamptz
    );
    create table gold.gold_pots (
      pot_id varchar, account_id varchar, pot_name varchar, balance_pence bigint, goal_pence bigint,
      is_savings boolean, is_bills_pot boolean
    );
  `);
  for (const t of TRANSACTIONS) {
    const spends = t.spends ?? true;
    await connection.run(
      `insert into gold.gold_effective_transactions values (
        $id, $date::timestamp + interval 19 hour, $date::date, isodow($date::date), $payee, $payee,
        null, upper($payee), $notes, 'mastercard', $amount, $amount, 'GBP', $category,
        $spends, case when $spends then -$amount else 0 end, false,
        case when $amount > 0 and not $spends then 'salary' end, null, null, null
      )`,
      {
        id: t.id,
        date: t.date,
        payee: t.payee,
        amount: t.amount,
        notes: t.notes ?? null,
        spends,
        category: t.category ?? "eating_out",
      },
    );
  }
});

async function get<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await createApi(query, "test").request(path);
  return { status: res.status, body: (await res.json()) as T };
}

test("search matches every word against payee, description or note, ignoring case", async () => {
  const { body } = await get<TransactionSearch>("/api/transactions?q=DINNER%20sam");
  assert.deepEqual(
    body.rows.map((r) => r.id),
    ["t1"],
  );
});

test("search totals cover every match, not just the page", async () => {
  const { body } = await get<TransactionSearch>(
    "/api/transactions?from=2026-11-01&to=2026-11-30&category=eating_out&limit=1",
  );
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0]?.id, "t4", "newest first");
  assert.equal(body.total, 4);
  assert.equal(body.spendPence, 4000 + 6000 + 350 - 1000);
  assert.equal(body.averageSpendPence, Math.round((4000 + 6000 + 350) / 3));
  assert.equal(body.busiestWeekday, 6, "Saturday");
  // Weekly bars from the first match's week to the last's, quiet weeks included.
  assert.deepEqual(
    body.buckets.map((b) => [b.start, b.spendPence]),
    [
      ["2026-11-02", 4000],
      ["2026-11-09", 6350 - 1000],
    ],
  );
});

test("`>40` and `<60` in the search text bound the amount in pounds", async () => {
  const { body } = await get<TransactionSearch>("/api/transactions?q=dishoom%20%3E40%20%3C60");
  assert.deepEqual(
    body.rows.map((r) => r.id),
    ["t6"],
  );
});

test("an impossible date is ignored rather than failing the search", async () => {
  const { status, body } = await get<TransactionSearch>("/api/transactions?from=2026-02-30");
  assert.equal(status, 200);
  assert.equal(body.total, TRANSACTIONS.length);
});

test("detail includes your history with the payee: visits, net spend, quarters", async () => {
  const { body } = await get<TransactionDetail>("/api/transactions/t2");
  assert.equal(body.transaction.payeeName, "Dishoom");
  assert.equal(body.payee.visits, 3);
  assert.equal(body.payee.totalPence, 4000 + 6000 + 5000 - 1000);
  assert.equal(body.payee.firstDate, "2026-04-02");
  assert.deepEqual(
    body.payee.quarters.map((q) => [q.start, q.spendPence]),
    [
      ["2026-04-01", 5000],
      ["2026-07-01", 0],
      ["2026-10-01", 9000],
    ],
  );
  assert.equal((await get("/api/transactions/nope")).status, 404);
});

test("balances report every account's balance, its pots and Monzo's total as of the latest sync", async () => {
  const empty = await get<Balances>("/api/balances");
  assert.deepEqual(empty.body, {
    accountPence: 0,
    pots: [],
    monzoTotalPence: null,
    syncedAt: null,
  });

  await connection.run(`
    insert into gold.gold_account_balances values
      ('acc_1', 12345, 112345, '2026-11-24 09:00:00+00'),
      ('acc_2', 500, 500, '2026-11-24 09:01:30+00');
    insert into gold.gold_pots values
      ('pot_1', 'acc_1', 'Rainy day', 100000, null, true, false),
      ('pot_old', 'acc_closed', 'Left behind', 700, null, false, false);
  `);
  const { body } = await get<Balances>("/api/balances");
  assert.equal(body.accountPence, 12845);
  assert.equal(body.monzoTotalPence, 112845);
  assert.equal(body.syncedAt, "2026-11-24T09:01:30Z");
  assert.deepEqual(body.pots, [
    {
      potId: "pot_1",
      name: "Rainy day",
      balancePence: 100000,
      goalPence: null,
      isSavings: true,
      isBillsPot: false,
    },
  ]);
});
