"""Run the dbt project (raw -> silver -> gold) against the configured data dir."""

from __future__ import annotations

import os

from .config import TRANSFORM_DIR, Settings
from .raw import missing_endpoints


def run_dbt(settings: Settings, args: list[str] | None = None) -> bool:
    from dbt.cli.main import dbtRunner  # imported lazily: dbt is slow to import

    missing = missing_endpoints(settings.raw_dir)
    if missing:
        raise SystemExit(
            f"No raw data for {', '.join(missing)} in {settings.raw_dir}. "
            "Run `duckbill login` (or `duckbill demo`) first."
        )
    os.environ["DUCKBILL_DATA_DIR"] = str(settings.data_dir)
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
