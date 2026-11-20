"""Where raw files and sync state live: a local directory or an S3 prefix.

Chosen by `DUCKBILL_STORAGE_URI` (default: the data dir). Keys are relative
paths such as `raw/monzo/balance/date=2026-11-20/<run_id>.jsonl.gz` or
`state/sync_state.json`, laid out the same on both backends. Objects are
written whole, so readers (dbt included) never see a half-written file.

The Monzo token never goes here; see `auth.open_token_store`.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Protocol


class Store(Protocol):
    # Root that `<uri>/<key>` resolves against; dbt reads raw from `<uri>/raw`.
    uri: str

    def put(self, key: str, data: bytes) -> None: ...

    # None if the key doesn't exist.
    def get(self, key: str) -> bytes | None: ...

    # Every key under `prefix`, in no particular order.
    def keys(self, prefix: str) -> Iterator[str]: ...


class LocalStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.uri = str(root)

    def put(self, key: str, data: bytes) -> None:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_name(path.name + ".partial")
        partial.write_bytes(data)
        os.replace(partial, path)

    def get(self, key: str) -> bytes | None:
        path = self.root / key
        return path.read_bytes() if path.exists() else None

    def keys(self, prefix: str) -> Iterator[str]:
        base = self.root / prefix
        if base.is_dir():
            for path in base.rglob("*"):
                if path.is_file() and not path.name.endswith(".partial"):
                    yield path.relative_to(self.root).as_posix()


class S3Store:
    # `client` is a boto3 S3 client; one is created from the environment if omitted.
    def __init__(self, bucket: str, prefix: str = "", client: Any = None) -> None:
        if client is None:
            import boto3  # imported lazily: only S3 users need it loaded

            client = boto3.client("s3")
        self.client = client
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.uri = f"s3://{bucket}/{self.prefix}" if self.prefix else f"s3://{bucket}"

    def _key(self, key: str) -> str:
        return f"{self.prefix}/{key}" if self.prefix else key

    def put(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=self._key(key), Body=data)

    def get(self, key: str) -> bytes | None:
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=self._key(key))
        except self.client.exceptions.NoSuchKey:
            return None
        return response["Body"].read()

    def keys(self, prefix: str) -> Iterator[str]:
        strip = len(self.prefix) + 1 if self.prefix else 0
        pages = self.client.get_paginator("list_objects_v2").paginate(
            Bucket=self.bucket, Prefix=self._key(prefix)
        )
        for page in pages:
            for item in page.get("Contents", []):
                yield item["Key"][strip:]


def open_store(uri: str) -> Store:
    """A store for a local directory path or an `s3://bucket[/prefix]` URI."""
    if uri.startswith("s3://"):
        bucket, _, prefix = uri.removeprefix("s3://").partition("/")
        if not bucket:
            raise SystemExit(f"DUCKBILL_STORAGE_URI has no bucket: {uri!r}")
        return S3Store(bucket, prefix)
    return LocalStore(Path(uri))
