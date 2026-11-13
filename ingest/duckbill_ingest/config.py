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
    data_dir: Path
    client_id: str | None
    client_secret: str | None
    redirect_uri: str

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def token_path(self) -> Path:
        return self.data_dir / "secrets" / "monzo_token.json"

    @property
    def state_path(self) -> Path:
        return self.data_dir / "state" / "sync_state.json"

    @property
    def warehouse_path(self) -> Path:
        return self.data_dir / "warehouse.duckdb"

    def require_client(self) -> tuple[str, str]:
        if not self.client_id or not self.client_secret:
            raise SystemExit(
                "MONZO_CLIENT_ID and MONZO_CLIENT_SECRET must be set (see .env.example)."
            )
        return self.client_id, self.client_secret


def load_settings(data_dir: str | None = None) -> Settings:
    load_dotenv(REPO_ROOT / ".env")
    raw_dir = data_dir or os.environ.get("DUCKBILL_DATA_DIR") or "./data"
    path = Path(raw_dir)
    if not path.is_absolute():
        path = REPO_ROOT / path
    return Settings(
        data_dir=path.resolve(),
        client_id=os.environ.get("MONZO_CLIENT_ID"),
        client_secret=os.environ.get("MONZO_CLIENT_SECRET"),
        redirect_uri=os.environ.get("MONZO_REDIRECT_URI", "http://localhost:8765/callback"),
    )
