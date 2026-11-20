"""duckbill command line.

duckbill login       browser OAuth, wait for in-app approval, catch up since the last
                     sync (or full backfill with --full or no sync yet), transform
duckbill sync        refresh token, re-read the trailing window, transform
duckbill transform   rebuild silver and gold from raw (dbt build)
duckbill demo        write synthetic raw data to ./data-demo and transform it
duckbill status      show token and sync state
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import replace
from datetime import UTC, datetime

from . import auth, sync
from .client import MonzoClient
from .config import load_settings
from .storage import open_store
from .transform import run_dbt


def _client(settings, tokens: auth.TokenStore) -> MonzoClient:
    return MonzoClient(lambda: auth.valid_token(settings, tokens).access_token)


def cmd_login(args: argparse.Namespace) -> int:
    settings = load_settings(args.data_dir)
    tokens = auth.open_token_store(settings)
    auth.browser_login(settings, tokens)
    client = _client(settings, tokens)
    try:
        accounts = sync.wait_for_approval(client)
        print("Approved. Fetching history while Monzo allows it (5 minute window)...")
        result = sync.run(
            open_store(settings.storage_uri),
            client,
            mode="backfill" if args.full else "catchup",
            accounts_payload=accounts,
        )
    finally:
        client.close()
    _report(result)
    return 0 if args.no_transform or run_dbt(settings) else 1


def cmd_sync(args: argparse.Namespace) -> int:
    settings = load_settings(args.data_dir)
    client = _client(settings, auth.open_token_store(settings))
    try:
        result = sync.run(
            open_store(settings.storage_uri),
            client,
            mode="incremental",
            lookback_days=args.lookback_days,
        )
    except auth.ReauthRequired as exc:
        print(f"Re-login needed: {exc}\nRun `duckbill login`.", file=sys.stderr)
        return 2
    finally:
        client.close()
    _report(result)
    return 0 if args.no_transform or run_dbt(settings) else 1


def cmd_transform(args: argparse.Namespace) -> int:
    settings = load_settings(args.data_dir)
    return 0 if run_dbt(settings, args.dbt_args or None) else 1


def cmd_demo(args: argparse.Namespace) -> int:
    from .demo import write_demo

    # Always local, even with DUCKBILL_STORAGE_URI set: synthetic rows must never
    # land in the real raw archive.
    settings = load_settings(args.data_dir or "./data-demo")
    settings = replace(settings, storage_uri=str(settings.data_dir))
    store = open_store(settings.storage_uri)
    if not args.force and any(k.endswith(".jsonl.gz") for k in store.keys("raw/")):
        print(f"{store.uri}/raw already has data; pass --force to add another demo run.")
        return 1
    summary = write_demo(store)
    print(f"Wrote {summary['transactions']} synthetic transactions to {store.uri}/raw")
    return 0 if run_dbt(settings) else 1


def cmd_status(args: argparse.Namespace) -> int:
    settings = load_settings(args.data_dir)
    tokens = auth.open_token_store(settings)
    token = tokens.load()
    print(f"data dir:  {settings.data_dir}")
    print(f"storage:   {settings.storage_uri}")
    print(f"token at:  {tokens.location}")
    if token is None:
        print("token:     none (run `duckbill login`)")
    else:
        expires = datetime.fromtimestamp(token.expires_at, UTC).isoformat(timespec="minutes")
        state = "expired" if token.expires_at < time.time() else "valid"
        print(f"token:     {state} until {expires}, refresh token: {bool(token.refresh_token)}")
    state = sync.load_state(open_store(settings.storage_uri))
    if state:
        print("sync:      " + json.dumps(state, indent=2))
    return 0


def _report(result: sync.SyncResult) -> None:
    print(
        f"Run {result.run_id}: {result.accounts} account(s), "
        f"{result.transactions} transaction rows fetched"
    )
    for warning in result.warnings:
        print(f"warning: {warning}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="duckbill")
    parser.add_argument("--data-dir", help="override DUCKBILL_DATA_DIR")
    sub = parser.add_subparsers(dest="command", required=True)

    login = sub.add_parser("login", help="authenticate and catch up on history")
    login.add_argument(
        "--full", action="store_true", help="refetch all history, not just since the last sync"
    )
    login.add_argument("--no-transform", action="store_true")
    login.set_defaults(func=cmd_login)

    sync_p = sub.add_parser("sync", help="incremental sync of recent transactions")
    sync_p.add_argument("--lookback-days", type=int, default=sync.DEFAULT_LOOKBACK_DAYS)
    sync_p.add_argument("--no-transform", action="store_true")
    sync_p.set_defaults(func=cmd_sync)

    transform = sub.add_parser("transform", help="run dbt (default: build)")
    transform.add_argument("dbt_args", nargs=argparse.REMAINDER)
    transform.set_defaults(func=cmd_transform)

    demo = sub.add_parser("demo", help="generate synthetic data into ./data-demo")
    demo.add_argument("--force", action="store_true")
    demo.set_defaults(func=cmd_demo)

    status = sub.add_parser("status", help="show token and sync state")
    status.set_defaults(func=cmd_status)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
