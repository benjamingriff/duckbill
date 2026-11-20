"""AWS Lambda entry points. Both run from one container image (deploy/lambda).

ingest_handler  Daily, from EventBridge. Syncs Monzo into raw in S3 using the
                token in SSM, then starts the dbt function asynchronously.
                It is the only thing in AWS that can read or refresh the token.
dbt_handler     Builds and tests the warehouse in /tmp from raw in S3, then
                publishes it to MotherDuck if the build passed. It has no
                access to Monzo.

Environment (set by the CDK stack in deploy/cdk):
  DUCKBILL_STORAGE_URI, DUCKBILL_TOKEN_PARAMETER   as for the CLI
  DUCKBILL_MONZO_CLIENT_PARAMETER    SSM SecureString {"client_id", "client_secret"}
  DUCKBILL_DBT_FUNCTION              dbt function to start after a sync (ingest)
  DUCKBILL_PUBLISH_TO                DuckDB database to publish into, e.g. md:duckbill (dbt)
  DUCKBILL_MOTHERDUCK_TOKEN_PARAMETER  SSM SecureString with the writer token (dbt)
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
from functools import cache
from pathlib import Path
from typing import Any

from . import auth, sync
from .client import MonzoClient
from .config import load_settings
from .publish import publish
from .storage import open_store
from .transform import extension_dir

log = logging.getLogger("duckbill")
log.setLevel(logging.INFO)

WORK_DIR = "/tmp/duckbill"  # the only writable path in Lambda
BAKED_EXTENSIONS = Path("/opt/duckdb-extensions")  # see deploy/lambda/Dockerfile


def _seed_extensions() -> None:
    """Copy the image's DuckDB extensions to the writable DUCKBILL_DUCKDB_EXTENSION_DIR."""
    if BAKED_EXTENSIONS.is_dir():
        shutil.copytree(BAKED_EXTENSIONS, extension_dir(), dirs_exist_ok=True)


@cache
def _ssm() -> Any:
    import boto3

    return boto3.client("ssm")


def _secret(env_name: str) -> str:
    """Decrypted value of the SSM SecureString named by an environment variable."""
    response = _ssm().get_parameter(Name=os.environ[env_name], WithDecryption=True)
    return response["Parameter"]["Value"]


def ingest_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    monzo = json.loads(_secret("DUCKBILL_MONZO_CLIENT_PARAMETER"))
    os.environ["MONZO_CLIENT_ID"] = monzo["client_id"]
    os.environ["MONZO_CLIENT_SECRET"] = monzo["client_secret"]
    settings = load_settings(WORK_DIR)
    tokens = auth.open_token_store(settings)
    client = MonzoClient(lambda: auth.valid_token(settings, tokens).access_token)
    try:
        result = sync.run(open_store(settings.storage_uri), client, mode="incremental")
    except auth.ReauthRequired:
        log.error("Monzo token can't be refreshed: run `duckbill login` with SSM configured")
        raise
    finally:
        client.close()
    for warning in result.warnings:
        log.warning(warning)

    import boto3

    boto3.client("lambda").invoke(
        FunctionName=os.environ["DUCKBILL_DBT_FUNCTION"],
        InvocationType="Event",
        Payload=json.dumps({"run_id": result.run_id}).encode(),
    )
    summary = {
        "run_id": result.run_id,
        "accounts": result.accounts,
        "transactions": result.transactions,
        "warnings": result.warnings,
    }
    log.info("sync done: %s", json.dumps(summary))
    return summary


def dbt_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    _seed_extensions()
    if os.environ.get("DUCKBILL_MOTHERDUCK_TOKEN_PARAMETER"):
        os.environ["motherduck_token"] = _secret("DUCKBILL_MOTHERDUCK_TOKEN_PARAMETER")
    settings = load_settings(WORK_DIR)
    Path(WORK_DIR).mkdir(parents=True, exist_ok=True)
    # A fresh warehouse per run: a warm container may still hold the last one.
    for leftover in ("warehouse.duckdb", "warehouse.duckdb.wal"):
        settings.data_dir.joinpath(leftover).unlink(missing_ok=True)
    # dbt runs in its own process: dbt-duckdb keeps its connection to the
    # warehouse open after a build, which would block publishing it and, in a
    # warm container, point the next build at this run's deleted file.
    build = subprocess.run(
        [sys.executable, "-m", "duckbill_ingest.cli", "--data-dir", WORK_DIR, "transform"],
        check=False,
    )
    if build.returncode != 0:
        raise RuntimeError(f"dbt build failed (exit {build.returncode}); nothing published")
    tables = publish(
        settings.data_dir / "warehouse.duckdb", os.environ["DUCKBILL_PUBLISH_TO"], extension_dir()
    )
    log.info("published %d tables to %s", len(tables), os.environ["DUCKBILL_PUBLISH_TO"])
    return {"published": tables, "trigger": event}
