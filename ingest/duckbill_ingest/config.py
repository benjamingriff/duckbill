"""Settings loaded from the environment (and an optional .env at the repo root)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
TRANSFORM_DIR = REPO_ROOT / "transform"


@dataclass(frozen=True)
class Settings:
    # Local working directory: the DuckDB warehouse, and by default everything else.
    data_dir: Path
    # Raw files and sync state: a local path or s3://bucket[/prefix] (see storage.py).
    storage_uri: str
    # SSM parameter holding the Monzo token; None keeps it in a file under data_dir.
    token_parameter: str | None
    client_id: str | None
    client_secret: str | None
    redirect_uri: str

    @property
    def token_path(self) -> Path:
        return self.data_dir / "secrets" / "monzo_token.json"

    @property
    def warehouse_path(self) -> Path:
        return self.data_dir / "warehouse.duckdb"

    def require_client(self) -> tuple[str, str]:
        if not self.client_id or not self.client_secret:
            raise SystemExit(
                "MONZO_CLIENT_ID and MONZO_CLIENT_SECRET must be set (see .env.example)."
            )
        return self.client_id, self.client_secret


def _local_path(value: str) -> Path:
    path = Path(value)
    return (path if path.is_absolute() else REPO_ROOT / path).resolve()


def load_settings(data_dir: str | None = None) -> Settings:
    load_dotenv(REPO_ROOT / ".env")
    local = _local_path(data_dir or os.environ.get("DUCKBILL_DATA_DIR") or "./data")
    storage = os.environ.get("DUCKBILL_STORAGE_URI") or str(local)
    if not storage.startswith("s3://"):
        storage = str(_local_path(storage))
    return Settings(
        data_dir=local,
        storage_uri=storage,
        token_parameter=os.environ.get("DUCKBILL_TOKEN_PARAMETER") or None,
        client_id=os.environ.get("MONZO_CLIENT_ID"),
        client_secret=os.environ.get("MONZO_CLIENT_SECRET"),
        redirect_uri=os.environ.get("MONZO_REDIRECT_URI", "http://localhost:8765/callback"),
    )
