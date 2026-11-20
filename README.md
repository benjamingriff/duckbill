# duckbill

A local analytics dashboard for your Monzo account.

```
Monzo API ──► raw (bronze)  data/raw/monzo/<endpoint>/date=…/<run>.jsonl.gz   append-only, verbatim
                 │  dbt (SQL), rebuilt from raw on every run
                 ▼
              silver        typed, deduplicated: transactions, accounts, balances, pots
                 ▼
              enrich        categories (v0 = Monzo's own; rules/models later)
                 ▼
              gold          tables shaped for dashboard panels
                 ▼
     API (Hono + DuckDB) ──► dashboard (Vite + React + Recharts)
```

| Part | Where | Stack |
| --- | --- | --- |
| Ingestion | `ingest/` | Python, `uv`, httpx |
| Transforms | `transform/` | dbt-duckdb, SQL |
| API | `apps/api/` | Node 24 (native TypeScript), Hono, `@duckdb/node-api` |
| Dashboard | `apps/web/` | Vite, React 19, Recharts |

By default everything lives under `data/`: raw files, sync state, the Monzo token and the
DuckDB warehouse `data/warehouse.duckdb`. `data/` and `.env` are gitignored, so your
financial data never leaves your machine unless you [point storage at AWS](#storage).

## Prerequisites

- Node 24 (the API runs TypeScript natively) and pnpm
- [uv](https://docs.astral.sh/uv/), with Python 3.12 or 3.13
- For scheduled syncs: systemd. The unit in `deploy/systemd/` assumes the repo is
  cloned at `~/repos/duckbill`; edit `WorkingDirectory` if yours is elsewhere.

## Quick start with demo data

You don't need Monzo credentials to try it:

```sh
uv sync && pnpm install
pnpm demo          # writes ~2 years of synthetic Monzo-shaped raw data to ./data-demo and runs dbt
pnpm dev:demo      # API on :8787, dashboard on http://localhost:5173
```

## Using your real account

1. Sign in at <https://developers.monzo.com/> and create an OAuth client:
   - **Confidential: yes.** Only confidential clients get refresh tokens, which keep
     scheduled syncs working without logging in again.
   - Redirect URL: `http://localhost:8765/callback`
2. `cp .env.example .env` and fill in the client ID and secret.
3. Run the login and full backfill:

   ```sh
   pnpm monzo:login
   ```

   This opens Monzo's login in your browser. Open the email link on this machine (it redirects to localhost), then **approve
   access in the Monzo app**. Approval starts a 5-minute window in which Monzo serves
   your full transaction history; after that, only the last 90 days. `login` notices the
   approval and starts the backfill immediately, so keep the terminal open.
4. `pnpm dev`

### Keeping it up to date

```sh
pnpm monzo:sync          # refresh token, re-read the last 35 days, rebuild silver/gold
```

Each sync re-reads a trailing window, not just new transactions. Pending card payments
(TfL, hotels, car hire) change amount when they settle, sometimes up to 31 days later, and silver keeps the most recent
version. To run it every 4 hours with a systemd user timer:

```sh
cp deploy/systemd/duckbill-sync.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now duckbill-sync.timer
journalctl --user -u duckbill-sync   # logs
```

If the refresh chain ever breaks (for example, you log out of all apps in Monzo), `sync`
exits with code 2 and asks you to run `pnpm monzo:login` again. A fresh login also runs a full
backfill, which closes any gap.

## Commands

All CLI commands run as `uv run duckbill <command>`; `--data-dir` overrides
`DUCKBILL_DATA_DIR`.

| Command | What it does |
| --- | --- |
| `login` | OAuth in the browser, wait for in-app approval, full backfill, dbt build |
| `sync [--lookback-days N]` | Incremental sync and dbt build. Warns if the last sync was over 90 days ago. |
| `transform [dbt args…]` | Rebuild silver/gold from raw. Default `build`, e.g. `transform test`. |
| `demo [--force]` | Synthetic data into `./data-demo` |
| `status` | Token expiry and last sync per account |

## Storage

Two environment variables move state off the local disk. Both are unset by default.

| Variable | Holds | Value |
| --- | --- | --- |
| `DUCKBILL_STORAGE_URI` | Raw files and sync state | A directory, or `s3://bucket/prefix`. Defaults to `DUCKBILL_DATA_DIR`. |
| `DUCKBILL_TOKEN_PARAMETER` | The Monzo token | An SSM parameter name such as `/duckbill/monzo-token`, stored as a SecureString. Unset keeps it in `data/secrets/`. |

The layout under the storage root is the same either way (`raw/monzo/…`,
`state/sync_state.json`). With S3, dbt reads raw straight from the bucket through
DuckDB's `httpfs`, and the warehouse is still built locally in `DUCKBILL_DATA_DIR`. AWS
credentials and region come from the usual chain: environment variables, `~/.aws` or
an IAM role.

Only one place may hold the token. Monzo refresh tokens are single use, so two copies
refreshing independently break each other's chain. When you move the token to SSM,
delete the local file and stop any local sync timer.

## Data model

**Raw.** Every API response is written as-is, inside an envelope
`{run_id, fetched_at, endpoint, params, payload}`. Raw files are never modified, so
changing any SQL and running `duckbill transform` replays all history.

**Silver** (`transform/models/silver/`)
- `silver_transaction_versions`: every observation of every transaction.
- `silver_transactions`: the latest observation, typed and flagged. Spending follows
  Monzo's `include_in_spending` flag and never counts declines or pot transfers. Refunds
  count as negative spending. Times are bucketed into days and months in `Europe/London`.
- `silver_accounts`, `silver_balance_snapshots`, `silver_pots`.

**Enrich.** `enrich_transaction_categories` gives one category per transaction. v0 uses
Monzo's category. Custom rules ("Pret → coffee") or a model can be added here without
touching silver. Each row records which version produced it in
`category_source`/`rules_version`.

**Gold**
- `gold_monthly_summary`: spend, income, net and saved to pots per month.
- `gold_monthly_category_spend`, `gold_monthly_payee_spend`.
- `gold_daily_balance`: end-of-day balance, reconstructed backwards from the latest
  balance. The API has no balance history.
- `gold_sync_status`: freshness and coverage stats.

The test `assert_history_starts_from_zero` (warn-level) checks that the reconstructed
balance before your first transaction is £0. If it fails, history is incomplete,
usually because the backfill ran outside Monzo's 5-minute window.

## Security

- `data/secrets/monzo_token.json` holds a long-lived Monzo refresh token. duckbill saves
  it with 0600 permissions. Never commit it; `data/` and `secrets/` are gitignored. With
  `DUCKBILL_TOKEN_PARAMETER` set it lives in SSM instead, and never in S3.
- The API only accepts requests whose `Host` is `localhost`, `127.0.0.1` or `[::1]`
  (any port), which blocks DNS-rebinding attacks from other sites in your browser. To
  serve it under another name, set `DUCKBILL_ALLOWED_HOSTS` to a comma-separated list
  of hostnames; this replaces the defaults.

## Known limitations

- Personal account (`uk_retail`) only. Joint accounts would need another `account_type`.
- Pot interest is invisible to the API, so reconstructed pot history before today reads
  slightly low.
- If a pending payment is cancelled and drops out of the API, its last pending version
  stays in silver.
- Webhooks need a public URL, so local syncs poll on a timer instead.
