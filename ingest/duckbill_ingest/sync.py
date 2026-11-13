"""Backfill and incremental sync from the Monzo API into the raw layer.

Monzo only serves full transaction history for 5 minutes after the user
approves access in the app; after that, only the last 90 days. So:

* `backfill` pages from the account's creation date and must run straight
  after login (the `login` command does this automatically).
* `sync` re-reads a trailing window (default 35 days) so pending transactions
  that later settle, or change amount, are captured again. Card payments can
  stay pending for up to 31 days. Silver keeps the most recent version of
  each transaction.

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
from .config import Settings
from .raw import RawWriter, iso, new_run_id

API_HISTORY_DAYS = 89  # Monzo allows 90; keep a day of slack
DEFAULT_LOOKBACK_DAYS = 35
WINDOW_DAYS = 180  # well inside Monzo's ~1 year per-request limit
EARLIEST = datetime(2015, 1, 1, tzinfo=UTC)


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
    settings: Settings,
    client: MonzoClient,
    *,
    mode: str,
    accounts_payload: dict[str, Any] | None = None,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
) -> SyncResult:
    if mode not in ("backfill", "incremental"):
        raise ValueError(mode)
    now = datetime.now(UTC)
    state = _load_state(settings)
    warnings: list[str] = []
    run_id = new_run_id(now)
    total = 0

    with RawWriter(settings.raw_dir, run_id) as writer:
        accounts_payload = accounts_payload or client.accounts()
        writer.write("accounts", {"account_type": "uk_retail"}, accounts_payload)
        accounts = open_accounts(accounts_payload)
        if not accounts:
            warnings.append("no open uk_retail accounts found")

        for account in accounts:
            account_id = account["id"]
            if mode == "backfill":
                created = account.get("created")
                since = datetime.fromisoformat(created) if created else EARLIEST
            else:
                since, warning = _incremental_since(state.get(account_id), now, lookback_days)
                if warning:
                    warnings.append(warning)
            print(f"  {account_id}: transactions since {iso(since)}")
            # A day past now so nothing created during the run is cut off.
            until = now + timedelta(days=1)
            total += fetch_transactions(client, writer, account_id, since, until)
            snapshot_account(client, writer, account_id)
            entry = state.setdefault(account_id, {})
            entry["last_sync_at"] = iso(now)
            if mode == "backfill":
                entry["last_backfill_at"] = iso(now)

    _save_state(settings, state)
    return SyncResult(run_id, len(accounts), total, warnings)


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
        warning = "no previous sync recorded; run `duckbill login` to backfill full history"
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


def _load_state(settings: Settings) -> dict[str, Any]:
    if settings.state_path.exists():
        return json.loads(settings.state_path.read_text())
    return {}


def _save_state(settings: Settings, state: dict[str, Any]) -> None:
    settings.state_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = settings.state_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(settings.state_path)
