"""Backfill and incremental sync from the Monzo API into the raw layer.

Monzo only serves full transaction history for 5 minutes after the user
approves access in the app; after that, only the last 90 days. So:

* `incremental` (the scheduled sync) re-reads a trailing window (default 35
  days) so pending transactions that later settle, or change amount, are
  captured again. Card payments can stay pending for up to 31 days. Silver
  keeps the most recent version of each transaction.
* `catchup` (run by `login`, inside the 5 minute window) reads from the last
  recorded sync minus the lookback, however long ago that was, so it closes
  any gap without refetching history already in raw. With no recorded sync it
  is a full backfill.
* `backfill` (`login --full`) pages from the account's creation date.

Monzo rejects (HTTP 400) list requests spanning more than ~1 year, so history
is walked in bounded `since`/`before` windows, paging by transaction id within
each window.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from .client import PAGE_LIMIT, InsufficientPermissions, MonzoClient
from .raw import RawWriter, iso, new_run_id
from .storage import Store

API_HISTORY_DAYS = 89  # Monzo allows 90; keep a day of slack
DEFAULT_LOOKBACK_DAYS = 35
WINDOW_DAYS = 180  # well inside Monzo's ~1 year per-request limit
EARLIEST = datetime(2015, 1, 1, tzinfo=UTC)
STATE_KEY = "state/sync_state.json"
MODES = ("incremental", "catchup", "backfill")


@dataclass
class SyncResult:
    run_id: str
    accounts: int
    transactions: int
    warnings: list[str]


def wait_for_approval(client: MonzoClient, timeout_s: int = 300) -> dict[str, Any]:
    """Poll until the user approves access in the Monzo app."""
    deadline = time.monotonic() + timeout_s
    print("Approve access in the Monzo app (push notification) to continue...")
    while True:
        try:
            return client.accounts()
        except InsufficientPermissions:
            if time.monotonic() > deadline:
                raise SystemExit("Timed out waiting for approval in the Monzo app.") from None
            time.sleep(3)


def open_accounts(accounts_payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [a for a in accounts_payload.get("accounts", []) if not a.get("closed")]


def fetch_transactions(
    client: MonzoClient,
    writer: RawWriter,
    account_id: str,
    since: datetime,
    until: datetime,
) -> int:
    """Walk [since, until) in bounded windows, writing each page verbatim.

    Windows overlap by a second so a transaction stamped exactly on a boundary
    can't fall between them; silver deduplicates the overlap. Returns rows seen.
    """
    seen = 0
    window_start = since
    while window_start < until:
        window_end = min(window_start + timedelta(days=WINDOW_DAYS), until)
        cursor = iso(window_start)
        while True:
            params, body = client.transactions_page(
                account_id, since=cursor, before=iso(window_end)
            )
            writer.write("transactions", _params(params, account_id), body)
            page = body.get("transactions", [])
            seen += len(page)
            if len(page) < PAGE_LIMIT:
                break
            cursor = page[-1]["id"]
        if window_end >= until:
            break
        window_start = window_end - timedelta(seconds=1)
    return seen


def snapshot_account(client: MonzoClient, writer: RawWriter, account_id: str) -> None:
    writer.write("balance", {"account_id": account_id}, client.balance(account_id))
    writer.write("pots", {"current_account_id": account_id}, client.pots(account_id))


def run(
    store: Store,
    client: MonzoClient,
    *,
    mode: str,
    accounts_payload: dict[str, Any] | None = None,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
) -> SyncResult:
    if mode not in MODES:
        raise ValueError(mode)
    now = datetime.now(UTC)
    state = load_state(store)
    warnings: list[str] = []
    run_id = new_run_id(now)
    total = 0

    with RawWriter(store, run_id) as writer:
        accounts_payload = accounts_payload or client.accounts()
        writer.write("accounts", {"account_type": "uk_retail"}, accounts_payload)
        accounts = open_accounts(accounts_payload)
        if not accounts:
            warnings.append("no open uk_retail accounts found")

        for account in accounts:
            account_id = account["id"]
            since, full, warning = transactions_since(
                mode, account, state.get(account_id), now, lookback_days
            )
            if warning:
                warnings.append(warning)
            print(f"  {account_id}: transactions since {iso(since)}")
            # A day past now so nothing created during the run is cut off.
            until = now + timedelta(days=1)
            total += fetch_transactions(client, writer, account_id, since, until)
            snapshot_account(client, writer, account_id)
            entry = state.setdefault(account_id, {})
            entry["last_sync_at"] = iso(now)
            if full:
                entry["last_backfill_at"] = iso(now)

    store.put(STATE_KEY, json.dumps(state, indent=2).encode())
    return SyncResult(run_id, len(accounts), total, warnings)


def transactions_since(
    mode: str,
    account: dict[str, Any],
    entry: dict[str, Any] | None,
    now: datetime,
    lookback_days: int,
) -> tuple[datetime, bool, str | None]:
    """Where an account's transaction read starts: (since, is_full_backfill, warning)."""
    last = entry.get("last_sync_at") if entry else None
    if mode == "backfill" or (mode == "catchup" and not last):
        created = account.get("created")
        return (datetime.fromisoformat(created) if created else EARLIEST), True, None
    if mode == "catchup":
        return datetime.fromisoformat(last) - timedelta(days=lookback_days), False, None
    since, warning = _incremental_since(entry, now, lookback_days)
    return since, False, warning


def _incremental_since(
    entry: dict[str, Any] | None, now: datetime, lookback_days: int
) -> tuple[datetime, str | None]:
    floor = now - timedelta(days=API_HISTORY_DAYS)
    since = now - timedelta(days=lookback_days)
    warning = None
    if entry and entry.get("last_sync_at"):
        last = datetime.fromisoformat(entry["last_sync_at"])
        since = min(since, last - timedelta(days=lookback_days))
    else:
        warning = "no previous sync recorded; run `duckbill login --full` to backfill full history"
    if since < floor:
        warning = (
            "last sync was more than 90 days ago, so there may be a gap; "
            "run `duckbill login` to backfill"
        )
        since = floor
    return since, warning


def _params(params: list[tuple[str, str]], account_id: str) -> dict[str, Any]:
    out: dict[str, Any] = {"account_id": account_id}
    for key, value in params:
        if key != "account_id":
            out[key] = value
    return out


def load_state(store: Store) -> dict[str, Any]:
    """Per-account `last_sync_at` / `last_backfill_at`, keyed by account id."""
    data = store.get(STATE_KEY)
    return json.loads(data) if data else {}
