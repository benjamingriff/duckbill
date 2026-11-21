"""Run the dbt project (raw -> silver -> gold) into the local warehouse."""

from __future__ import annotations

import os

from .config import TRANSFORM_DIR, Settings
from .raw import missing_endpoints
from .storage import open_store


def extension_dir() -> str:
    """Where DuckDB installs and loads extensions: DUCKBILL_DUCKDB_EXTENSION_DIR, or
    DuckDB's own default. The Lambda image sets it to a preinstalled, read-only dir."""
    return os.environ.get("DUCKBILL_DUCKDB_EXTENSION_DIR") or os.path.expanduser(
        "~/.duckdb/extensions"
    )


def _use_thread_locks_without_shm() -> None:
    """Make multiprocessing hand out thread locks where its own can't be created.

    Multiprocessing locks need /dev/shm. AWS Lambda has none, so dbt fails with
    FileNotFoundError: it takes its locks from a multiprocessing context, and
    the ThreadPool it runs models on makes one for an internal queue. dbt
    starts no processes, so thread locks are equivalent. Nothing changes where
    /dev/shm works; in Lambda, dbt runs in its own process (aws.dbt_handler).
    Must run before dbt is imported: its manifest module binds Lock at import.
    """
    import multiprocessing
    import threading
    from multiprocessing.context import BaseContext

    try:
        multiprocessing.get_context("spawn").Lock()
    except OSError:
        BaseContext.Lock = lambda self: threading.Lock()  # type: ignore[method-assign]
        BaseContext.RLock = lambda self: threading.RLock()  # type: ignore[method-assign]


def run_dbt(settings: Settings, args: list[str] | None = None) -> bool:
    _use_thread_locks_without_shm()
    from dbt.cli.main import dbtRunner  # imported lazily: dbt is slow to import

    store = open_store(settings.storage_uri)
    missing = missing_endpoints(store)
    if missing:
        raise SystemExit(
            f"No raw data for {', '.join(missing)} in {store.uri}/raw. "
            "Run `duckbill login` (or `duckbill demo`) first."
        )
    # Read by transform/profiles.yml and the raw_envelopes macro.
    os.environ["DUCKBILL_DATA_DIR"] = str(settings.data_dir)
    os.environ["DUCKBILL_RAW_URI"] = f"{store.uri}/raw"
    os.environ["DUCKBILL_DBT_TARGET"] = "s3" if store.uri.startswith("s3://") else "local"
    os.environ.setdefault("DUCKBILL_DUCKDB_EXTENSION_DIR", extension_dir())
    command = args or ["build"]
    result = dbtRunner().invoke(
        [
            *command,
            "--project-dir",
            str(TRANSFORM_DIR),
            "--profiles-dir",
            str(TRANSFORM_DIR),
        ]
    )
    return result.success
