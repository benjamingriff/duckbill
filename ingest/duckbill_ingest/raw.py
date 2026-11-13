"""Bronze layer writer.

Every API response is appended verbatim to a gzipped JSON Lines file. Files are
never rewritten, so silver and gold can always be rebuilt from here. Layout:

    raw/monzo/<endpoint>/date=YYYY-MM-DD/<run_id>.jsonl.gz

Each line is an envelope around the untouched response body:

    {"run_id", "fetched_at", "endpoint", "params", "payload"}

Files are written as `<name>.partial` and renamed into place when the run
closes them, so a killed run never leaves a truncated archive where dbt reads.
"""

from __future__ import annotations

import gzip
import json
import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Self

ENDPOINTS = ("accounts", "balance", "pots", "transactions")


def new_run_id(now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    return f"{now.strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(3)}"


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


class RawWriter:
    """Appends response envelopes for one ingest run, one file per endpoint."""

    def __init__(self, raw_dir: Path, run_id: str, source: str = "monzo") -> None:
        self.base = raw_dir / source
        self.run_id = run_id
        self._handles: dict[str, tuple[gzip.GzipFile, Path]] = {}
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
        if endpoint not in self._handles:
            folder = self.base / endpoint / f"date={fetched_at.strftime('%Y-%m-%d')}"
            folder.mkdir(parents=True, exist_ok=True)
            final = folder / f"{self.run_id}.jsonl.gz"
            partial = final.with_name(final.name + ".partial")
            handle = gzip.open(partial, "wt", encoding="utf-8")  # noqa: SIM115 (closed in close())
            self._handles[endpoint] = (handle, final)
        handle, _ = self._handles[endpoint]
        envelope = {
            "run_id": self.run_id,
            "fetched_at": iso(fetched_at),
            "endpoint": endpoint,
            "params": params,
            "payload": payload,
        }
        handle.write(json.dumps(envelope, separators=(",", ":")) + "\n")
        self.counts[endpoint] = self.counts.get(endpoint, 0) + 1

    def close(self) -> None:
        for handle, final in self._handles.values():
            handle.close()
            final.with_name(final.name + ".partial").replace(final)
        self._handles.clear()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def missing_endpoints(raw_dir: Path) -> list[str]:
    """Endpoints with no raw files yet. dbt sources need at least one file each."""
    return [
        endpoint
        for endpoint in ENDPOINTS
        if not any((raw_dir / "monzo" / endpoint).rglob("*.jsonl.gz"))
    ]
