"""Bronze layer writer.

Every API response is appended verbatim to a gzipped JSON Lines file. Files are
never rewritten, so silver and gold can always be rebuilt from here. Layout,
relative to the storage root (see `storage.py`):

    raw/monzo/<endpoint>/date=YYYY-MM-DD/<run_id>.jsonl.gz

Each line is an envelope around the untouched response body:

    {"run_id", "fetched_at", "endpoint", "params", "payload"}

Each file is buffered in memory and written in one go when the run closes it,
so a killed run never leaves a truncated archive where dbt reads.
"""

from __future__ import annotations

import gzip
import io
import json
import secrets
from datetime import UTC, datetime
from typing import Any, Self

from .storage import Store

ENDPOINTS = ("accounts", "balance", "pots", "transactions")


def new_run_id(now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    return f"{now.strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(3)}"


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


class RawWriter:
    """Appends response envelopes for one ingest run, one file per endpoint."""

    def __init__(self, store: Store, run_id: str, source: str = "monzo") -> None:
        self.store = store
        self.base = f"raw/{source}"
        self.run_id = run_id
        self._files: dict[str, tuple[gzip.GzipFile, io.BytesIO, str]] = {}
        self.counts: dict[str, int] = {}

    def write(
        self,
        endpoint: str,
        params: dict[str, Any],
        payload: dict[str, Any],
        fetched_at: datetime | None = None,
    ) -> None:
        if endpoint not in ENDPOINTS:
            raise ValueError(f"unknown endpoint {endpoint!r}")
        fetched_at = fetched_at or datetime.now(UTC)
        if endpoint not in self._files:
            key = (
                f"{self.base}/{endpoint}/date={fetched_at.strftime('%Y-%m-%d')}"
                f"/{self.run_id}.jsonl.gz"
            )
            buffer = io.BytesIO()
            gz = gzip.GzipFile(fileobj=buffer, mode="wb")
            self._files[endpoint] = (gz, buffer, key)
        gz, _, _ = self._files[endpoint]
        envelope = {
            "run_id": self.run_id,
            "fetched_at": iso(fetched_at),
            "endpoint": endpoint,
            "params": params,
            "payload": payload,
        }
        gz.write((json.dumps(envelope, separators=(",", ":")) + "\n").encode())
        self.counts[endpoint] = self.counts.get(endpoint, 0) + 1

    def close(self) -> None:
        for gz, buffer, key in self._files.values():
            gz.close()
            self.store.put(key, buffer.getvalue())
        self._files.clear()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def missing_endpoints(store: Store) -> list[str]:
    """Endpoints with no raw files yet. dbt sources need at least one file each."""
    return [
        endpoint
        for endpoint in ENDPOINTS
        if not any(k.endswith(".jsonl.gz") for k in store.keys(f"raw/monzo/{endpoint}/"))
    ]
