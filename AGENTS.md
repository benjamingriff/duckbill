# Working on duckbill

duckbill holds the owner's real financial data, and this repository is public. Two kinds of state cannot be rebuilt:

- **The raw archive** (`raw/` in the S3 bucket). It is the only copy of transaction history older than Monzo's 90 days.
- **The Monzo token chain** (SSM `/duckbill/monzo-token`). Refresh tokens are single use, so a stray refresh breaks the cloud sync until the owner logs in again.

Everything else (silver, gold, MotherDuck) is rebuilt from raw on every run.

## Verify with demo data

`pnpm check` is the gate. It runs what CI runs, including a dbt build and test of synthetic data in `data-ci/`. Run it before handing back. For the dashboard, use `pnpm demo` and `pnpm dev:demo`. When a behaviour isn't in the demo data, extend `ingest/duckbill_ingest/demo.py` rather than reaching for real data.

## Live systems need the owner's say-so

Live means anything that reaches real data or a deployed service:

- `duckbill login`, `sync` or `status` with the real `.env`
- `aws` commands against the account, `cdk deploy`, `aws lambda invoke`
- `railway` commands, the MotherDuck UI or tokens
- running the "Deploy AWS" workflow, and the wizards in `deploy/`

Use one only when the owner asks for it in the current request, and name the command before running it. The owner runs the wizards themselves. Merging never deploys AWS: AWS keeps running the last "Deploy AWS" run, while Railway deploys main once CI passes.

## Keep the data invariants

- Raw is append-only: new files under new run ids, never an edit or delete.
- Every dbt model is a `table` or `view`, rebuilt from raw. `ingest/tests/test_transform.py` fails on anything else.
- `silver_transactions` never loses rows between builds, and `publish()` refuses a build that would. `allow_shrink` exists for a deliberate model change that drops rows. Use it only when the owner agrees to that change.
- Changes to `auth.py` (token refresh), `sync.py` (windows and the sync checkpoint), `raw.py` or `storage.py` reach unrebuildable state. Say so in the PR, with a test for the changed behaviour.

## What a PR reports

- **Data diff.** CI's "Compare the published data with main's" step summary says which published tables change on demo data. Quote it. For a refactor, it should say unchanged.
- **AWS change.** Whether the PR has the `aws change` label, which means the next "Deploy AWS" run ships it.
- **Cost.** If it changes a value pinned in `deploy/cdk/lib/stack.test.ts` (schedule, memory, timeouts, retries, budget), say why. Those tests exist so cost changes are deliberate.

Everything in a PR, commit or CI log is public. Describe data in aggregate, with demo numbers, and leave real amounts, account IDs and tokens out.
