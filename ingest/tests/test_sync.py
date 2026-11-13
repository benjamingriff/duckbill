import gzip
import json
import stat
from datetime import UTC, datetime, timedelta

from duckbill_ingest import sync
from duckbill_ingest.auth import Token, TokenStore
from duckbill_ingest.client import PAGE_LIMIT
from duckbill_ingest.raw import RawWriter, iso, missing_endpoints

NOW = datetime(2026, 10, 26, 12, 0, tzinfo=UTC)


def test_incremental_since_uses_lookback_from_last_sync():
    last = NOW - timedelta(days=3)
    since, warning = sync._incremental_since({"last_sync_at": iso(last)}, NOW, 14)
    assert since == last - timedelta(days=14)
    assert warning is None


def test_incremental_since_clamps_to_api_history_and_warns():
    last = NOW - timedelta(days=200)
    since, warning = sync._incremental_since({"last_sync_at": iso(last)}, NOW, 14)
    assert since == NOW - timedelta(days=sync.API_HISTORY_DAYS)
    assert "gap" in warning


def test_incremental_since_without_state_warns_about_backfill():
    since, warning = sync._incremental_since(None, NOW, 14)
    assert since == NOW - timedelta(days=14)
    assert "backfill" in warning


class FakeClient:
    """Serves transactions one hour apart, honouring since (time or id) and before."""

    def __init__(self, total, start):
        self.rows = [
            {"id": f"tx_{i:05d}", "created": iso(start + timedelta(hours=i))} for i in range(total)
        ]
        self.calls = []

    def transactions_page(self, account_id, since, before=None):
        self.calls.append((since, before))
        if since.startswith("tx_"):
            floor = next(r["created"] for r in self.rows if r["id"] == since)
        else:
            floor = since
        window = [r for r in self.rows if floor < r["created"] < before]
        page = window[:PAGE_LIMIT]
        params = [("account_id", account_id), ("since", since), ("before", before)]
        return params, {"transactions": page}


def test_fetch_transactions_pages_by_last_id_and_writes_every_page(tmp_path):
    start = datetime(2020, 1, 1, tzinfo=UTC)
    client = FakeClient(PAGE_LIMIT * 2 + 5, start + timedelta(minutes=1))
    with RawWriter(tmp_path, "run1") as writer:
        seen = sync.fetch_transactions(client, writer, "acc_1", start, start + timedelta(days=30))
    assert seen == PAGE_LIMIT * 2 + 5
    assert [since for since, _ in client.calls] == [
        iso(start),
        f"tx_{PAGE_LIMIT - 1:05d}",
        f"tx_{PAGE_LIMIT * 2 - 1:05d}",
    ]
    files = list((tmp_path / "monzo" / "transactions").rglob("*.jsonl.gz"))
    assert len(files) == 1
    with gzip.open(files[0], "rt") as fh:
        lines = fh.read().splitlines()
    assert len(lines) == 3
    envelope = json.loads(lines[0])
    assert envelope["run_id"] == "run1"
    assert len(envelope["payload"]["transactions"]) == PAGE_LIMIT


def test_missing_endpoints_lists_endpoints_without_files(tmp_path):
    with RawWriter(tmp_path, "run1") as writer:
        writer.write("accounts", {}, {"accounts": []})
    assert missing_endpoints(tmp_path) == ["balance", "pots", "transactions"]


def test_token_store_writes_private_file(tmp_path):
    store = TokenStore(tmp_path / "secrets" / "token.json")
    store.save(Token("access", "refresh", 123.0, "user_1"))
    assert stat.S_IMODE(store.path.stat().st_mode) == 0o600
    assert store.load() == Token("access", "refresh", 123.0, "user_1")


def test_fetch_transactions_never_requests_more_than_a_window(tmp_path):
    start = datetime(2016, 3, 1, tzinfo=UTC)
    until = datetime(2026, 10, 27, tzinfo=UTC)
    client = FakeClient(0, start)
    with RawWriter(tmp_path, "run1") as writer:
        sync.fetch_transactions(client, writer, "acc_1", start, until)
    spans = [
        datetime.fromisoformat(before) - datetime.fromisoformat(since)
        for since, before in client.calls
    ]
    assert max(spans) <= timedelta(days=sync.WINDOW_DAYS)
    assert datetime.fromisoformat(client.calls[0][0]) == start
    assert datetime.fromisoformat(client.calls[-1][1]) == until
    # consecutive windows overlap rather than leave a gap
    for (_, before), (since, _) in zip(client.calls, client.calls[1:], strict=False):
        assert datetime.fromisoformat(since) < datetime.fromisoformat(before)


def test_raw_files_are_only_published_on_close(tmp_path):
    writer = RawWriter(tmp_path, "run1")
    writer.write("balance", {}, {"balance": 1})
    folder = next((tmp_path / "monzo" / "balance").iterdir())
    assert [p.name for p in folder.iterdir()] == ["run1.jsonl.gz.partial"]
    assert missing_endpoints(tmp_path)[0] == "accounts"
    assert "balance" in missing_endpoints(tmp_path)
    writer.close()
    assert [p.name for p in folder.iterdir()] == ["run1.jsonl.gz"]
    assert "balance" not in missing_endpoints(tmp_path)
