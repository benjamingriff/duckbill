import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { before, describe, test } from "node:test";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { Hono } from "hono";
import { clerkAuthenticator, clerkIssuer, clerkOAuthVerifier } from "./auth.ts";
import { daysBefore, METADATA_PATH, mountMcp, today, type McpOAuth } from "./mcp.ts";
import { createApi, type Query } from "./routes.ts";

let connection: DuckDBConnection;
const query: Query = async (sql, params = {}) =>
  (await connection.runAndReadAll(sql, params)).getRowObjectsJS() as never[];

const day = (ago: number) => daysBefore(today(), ago);

before(async () => {
  connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(`
    create schema gold;
    create table gold.gold_trips (trip_id varchar, city varchar);
    create table gold.gold_effective_transactions (
      transaction_id varchar, created_at_local timestamp, transaction_date date,
      weekday bigint, payee_key varchar, payee_name varchar, merchant_emoji varchar,
      description varchar, notes varchar, amount_pence bigint, local_amount_minor bigint,
      local_currency varchar, category varchar, counts_as_spending boolean, spend_pence bigint,
      is_pending boolean, income_kind varchar, recurring_kind varchar, trip_id varchar
    );
    create table gold.gold_account_balances (
      account_id varchar, balance_pence bigint, monzo_total_pence bigint, synced_at timestamptz
    );
    create table gold.gold_pots (
      pot_id varchar, account_id varchar, pot_name varchar, balance_pence bigint,
      goal_pence bigint, is_savings boolean, is_bills_pot boolean
    );
    insert into gold.gold_account_balances values ('acc_1', 12000, 62000, '2026-11-24 09:00:00+00');
    insert into gold.gold_pots values
      ('pot_1', 'acc_1', 'Holiday', 30000, 100000, true, false),
      ('pot_2', 'acc_1', 'Bills', 20000, null, false, true);
  `);
  // Two payments in the last 90 days, one older; one paid abroad.
  const rows: [string, number, number, string | null, string][] = [
    ["t1", 5, -1250, "Dinner with Sam", "GBP"],
    ["t2", 30, -4000, null, "EUR"],
    ["t3", 120, -999, null, "GBP"],
  ];
  for (const [id, ago, amount, notes, currency] of rows) {
    await connection.run(
      `insert into gold.gold_effective_transactions values (
        $id, $day::timestamp + interval 12 hour, $day::date, isodow($day::date), 'pret', 'Pret',
        null, 'PRET A MANGER', $notes, $amount, -4600, $currency, 'eating_out', true, -$amount,
        false, null, null, null
      )`,
      { id, day: day(ago), amount, notes, currency },
    );
  }
});

function server(oauth?: McpOAuth): Hono {
  const app = new Hono();
  mountMcp(app, { api: createApi(query, "test"), query, oauth });
  return app;
}

async function rpc(
  app: Hono,
  method: string,
  params: object = {},
  headers: Record<string, string> = {},
  url = "http://localhost/mcp",
) {
  return app.request(url, {
    method: "POST",
    headers: {
      Host: new URL(url).host,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function call<T>(name: string, args: object = {}): Promise<T> {
  const res = await rpc(server(), "tools/call", { name, arguments: args });
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  assert.notEqual(body.result.isError, true, body.result.content[0]?.text);
  return JSON.parse(body.result.content[0]!.text) as T;
}

interface Search {
  window: { from: string | null; to: string | null };
  total: number;
  spendPence: number;
  nextOffset: number | null;
  transactions: Record<string, unknown>[];
}

test("every tool is marked read-only", async () => {
  const res = await rpc(server(), "tools/list");
  const body = (await res.json()) as {
    result: { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] };
  };
  assert.ok(body.result.tools.length >= 10);
  for (const tool of body.result.tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
  }
});

test("search covers the last 90 days unless given dates, with totals over every match", async () => {
  const recent = await call<Search>("search_transactions");
  assert.deepEqual(recent.window, { from: day(89), to: null });
  assert.equal(recent.total, 2);
  assert.equal(recent.spendPence, 1250 + 4000);

  const all = await call<Search>("search_transactions", { from: day(365) });
  assert.equal(all.total, 3);
});

test("search pages with nextOffset until the matches run out", async () => {
  const first = await call<Search>("search_transactions", { limit: 1 });
  assert.equal(first.transactions.length, 1);
  assert.equal(first.nextOffset, 1);
  const second = await call<Search>("search_transactions", { limit: 1, offset: 1 });
  assert.equal(second.transactions[0]?.amountPence, -4000, "newest first");
  assert.equal(second.nextOffset, null);
});

test("search doesn't match words in notes, which it doesn't show", async () => {
  // t1's note says "Dinner with Sam"; the dashboard's search would find it.
  const { total } = await call<Search>("search_transactions", { query: "sam" });
  assert.equal(total, 0);
});

test("transactions leave out notes and ids, and show foreign amounts only for foreign payments", async () => {
  const { transactions } = await call<Search>("search_transactions");
  const [gbp, eur] = transactions;
  assert.deepEqual(Object.keys(gbp!).sort(), [
    "amountPence",
    "category",
    "countsAsSpending",
    "date",
    "description",
    "incomeKind",
    "isPending",
    "payeeName",
    "recurringKind",
    "time",
    "tripCity",
  ]);
  assert.equal(eur?.localCurrency, "EUR");
  assert.equal(eur?.localAmountMinor, -4600);
});

test("balances add up the pots and leave out their ids", async () => {
  const balances = await call<{ accountPence: number; potsTotalPence: number; pots: object[] }>(
    "get_balances",
  );
  assert.equal(balances.accountPence, 12000);
  assert.equal(balances.potsTotalPence, 50000);
  assert.deepEqual(balances.pots[0], {
    name: "Holiday",
    balancePence: 30000,
    goalPence: 100000,
    isSavings: true,
    isBillsPot: false,
  });
});

test("only POST is served: no event streams or sessions", async () => {
  const res = await server().request("/mcp");
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "POST");
});

test("without OAuth, pages from other origins are refused and get no CORS access", async () => {
  const app = server();
  const foreign = await rpc(app, "tools/list", {}, { Origin: "https://evil.example" });
  assert.equal(foreign.status, 403);
  assert.equal((await rpc(app, "tools/list", {}, { Origin: "" })).status, 403);
  assert.equal((await rpc(app, "tools/list", {}, { Origin: "http://localhost" })).status, 200);

  const preflight = await app.request("/mcp", {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(preflight.headers.get("access-control-allow-origin"), null);
});

describe("with Clerk OAuth", () => {
  const clerkHost = "duckbill-test.clerk.accounts.dev";
  const keys = {
    secretKey: "sk_test_duckbill",
    publishableKey: `pk_test_${Buffer.from(`${clerkHost}$`).toString("base64")}`,
  };
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwtKey = publicKey.export({ type: "spki", format: "pem" }).toString();
  const resource = "https://duckbill.example.com/mcp";
  const app = server({
    issuer: clerkIssuer(keys.publishableKey),
    verify: clerkOAuthVerifier({ ...keys, jwtKey }),
    ownerUserId: "user_owner",
  });

  const now = Math.floor(Date.now() / 1000);
  function jwt(header: object, claims: object): string {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const body = `${part({ alg: "RS256", kid: "ins_test", ...header })}.${part({
      iss: `https://${clerkHost}`,
      iat: now - 5,
      nbf: now - 5,
      exp: now + 300,
      ...claims,
    })}`;
    return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
  }
  // An access token as Clerk issues them to an OAuth client.
  const oauthToken = (sub: string, aud: string) =>
    jwt({ typ: "at+jwt" }, { sub, aud, client_id: "client_test", scope: "profile", jti: "oat_1" });
  // A dashboard session token (Clerk marks those with this JWT category).
  const sessionToken = (sub: string) =>
    jwt(
      { typ: "JWT", cat: "cl_B7d4PD111AAA" },
      { sub, sid: "sess_1", azp: "https://duckbill.example.com" },
    );

  const listTools = (token?: string) =>
    rpc(app, "tools/list", {}, token ? { Authorization: `Bearer ${token}` } : {}, resource);

  test("a request without a token is told where to sign in", async () => {
    const res = await listTools();
    assert.equal(res.status, 401);
    assert.equal(
      res.headers.get("www-authenticate"),
      `Bearer resource_metadata="https://duckbill.example.com${METADATA_PATH}"`,
    );
  });

  test("the metadata names this endpoint and Clerk as its authorization server", async () => {
    const res = await app.request(`https://duckbill.example.com${METADATA_PATH}`, {
      headers: { Host: "duckbill.example.com" },
    });
    const body = (await res.json()) as { resource: string; authorization_servers: string[] };
    assert.equal(body.resource, resource);
    assert.deepEqual(body.authorization_servers, [`https://${clerkHost}`]);
  });

  test("the owner's token works, and only for this endpoint's URL", async () => {
    assert.equal((await listTools(oauthToken("user_owner", resource))).status, 200);

    const elsewhere = await listTools(oauthToken("user_owner", "https://feedr.example.com/mcp"));
    assert.equal(elsewhere.status, 401);
    assert.match(elsewhere.headers.get("www-authenticate") ?? "", /^Bearer error="invalid_token"/);
  });

  test("the audience comes from the checked Host header, not the request target", async () => {
    // An absolute-form target can put another authority in the URL.
    const viaOtherTarget = (aud: string) =>
      rpc(
        app,
        "tools/list",
        {},
        { Host: "duckbill.example.com", Authorization: `Bearer ${oauthToken("user_owner", aud)}` },
        "https://evil.example/mcp",
      );
    assert.equal((await viaOtherTarget(resource)).status, 200);
    assert.equal((await viaOtherTarget("https://evil.example/mcp")).status, 401);
  });

  test("the audience is the canonical https URL, however the Host is spelled", async () => {
    const res = await rpc(
      app,
      "tools/list",
      {},
      {
        Host: "DUCKBILL.example.com:443",
        Authorization: `Bearer ${oauthToken("user_owner", resource)}`,
      },
      resource,
    );
    assert.equal(res.status, 200);
  });

  test("anyone else who signs in is refused", async () => {
    const res = await listTools(oauthToken("user_other", resource));
    assert.equal(res.status, 403);
  });

  test("an OAuth token doesn't open the dashboard API, and a session token doesn't open /mcp", async () => {
    const authenticate = clerkAuthenticator({
      ...keys,
      jwtKey,
      authorizedParties: ["https://duckbill.example.com"],
    });
    const dashboard = (token: string) =>
      authenticate(
        new Request("https://duckbill.example.com/api/overview", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
    assert.equal(await dashboard(sessionToken("user_owner")), "user_owner");
    assert.equal(await dashboard(oauthToken("user_owner", resource)), null);
    assert.equal((await listTools(sessionToken("user_owner"))).status, 401);
  });

  test("browser clients may read the challenge", async () => {
    const res = await app.request(resource, {
      method: "OPTIONS",
      headers: {
        Host: "duckbill.example.com",
        Origin: "https://claude.ai",
        "Access-Control-Request-Method": "POST",
      },
    });
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });
});
