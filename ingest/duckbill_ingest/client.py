"""Thin Monzo API client. Returns response bodies untouched for the raw layer."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import httpx

from .auth import ReauthRequired

API_URL = "https://api.monzo.com"
PAGE_LIMIT = 100  # Monzo's maximum page size


class InsufficientPermissions(RuntimeError):
    """The token exists but the user has not approved access in the Monzo app yet."""


class MonzoClient:
    def __init__(self, token_provider: Callable[[], str], timeout: float = 30) -> None:
        self._token = token_provider
        self._http = httpx.Client(base_url=API_URL, timeout=timeout)

    def close(self) -> None:
        self._http.close()

    def get(self, path: str, params: list[tuple[str, str]] | None = None) -> dict[str, Any]:
        for attempt in range(6):
            response = self._http.get(
                path,
                params=params,  # pyright: ignore[reportArgumentType]  (httpx types the list invariantly)
                headers={"Authorization": f"Bearer {self._token()}"},
            )
            if response.status_code == 429 or response.status_code >= 500:
                time.sleep(min(2**attempt, 30))
                continue
            if response.status_code == 401:
                raise ReauthRequired(response.text)
            if response.status_code == 403:
                body = _json(response)
                if body.get("code", "").startswith("forbidden.insufficient_permissions"):
                    raise InsufficientPermissions(response.text)
                if body.get("code", "").startswith("forbidden.verification_required"):
                    raise ReauthRequired(
                        "Monzo needs a fresh login to read transactions this old: " + response.text
                    )
            response.raise_for_status()
            return response.json()
        response.raise_for_status()  # pyright: ignore[reportPossiblyUnboundVariable]  (the loop always runs)
        raise RuntimeError(f"giving up on {path} after repeated rate limiting")

    def whoami(self) -> dict[str, Any]:
        return self.get("/ping/whoami")

    def accounts(self, account_type: str = "uk_retail") -> dict[str, Any]:
        return self.get("/accounts", [("account_type", account_type)])

    def balance(self, account_id: str) -> dict[str, Any]:
        return self.get("/balance", [("account_id", account_id)])

    def pots(self, account_id: str) -> dict[str, Any]:
        return self.get("/pots", [("current_account_id", account_id)])

    def transactions_page(
        self, account_id: str, since: str, before: str | None = None
    ) -> tuple[list[tuple[str, str]], dict[str, Any]]:
        params = [
            ("account_id", account_id),
            ("expand[]", "merchant"),
            ("limit", str(PAGE_LIMIT)),
            ("since", since),
        ]
        if before:
            params.append(("before", before))
        return params, self.get("/transactions", params)


def _json(response: httpx.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}
