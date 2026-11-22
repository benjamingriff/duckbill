"""Monzo OAuth: browser login, token persistence and refresh.

Monzo refresh tokens are single use: refreshing invalidates the previous pair.
The new pair is saved (to a mode 0600 file, or an SSM SecureString parameter)
before it is used, so a crash mid-sync cannot strand us with a token we never
saved. That also means exactly one place may hold and refresh the token: two
copies refreshing independently break each other's chain.
"""

from __future__ import annotations

import json
import os
import secrets
import time
import webbrowser
from dataclasses import asdict, dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from .config import Settings

AUTH_URL = "https://auth.monzo.com/"
TOKEN_URL = "https://api.monzo.com/oauth2/token"
REFRESH_MARGIN_SECONDS = 300


class ReauthRequired(RuntimeError):
    """The stored credentials can no longer be refreshed; run `duckbill login`."""


@dataclass
class Token:
    access_token: str
    refresh_token: str | None
    expires_at: float
    user_id: str | None = None

    @classmethod
    def from_response(cls, body: dict) -> Token:
        return cls(
            access_token=body["access_token"],
            refresh_token=body.get("refresh_token"),
            expires_at=time.time() + int(body.get("expires_in", 0)),
            user_id=body.get("user_id"),
        )

    @property
    def expiring(self) -> bool:
        return time.time() >= self.expires_at - REFRESH_MARGIN_SECONDS


class TokenStore(Protocol):
    # Where the token lives, for messages; never the token itself.
    location: str

    def load(self) -> Token | None: ...

    def save(self, token: Token) -> None: ...


class FileTokenStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.location = str(path)

    def load(self) -> Token | None:
        if not self.path.exists():
            return None
        return Token(**json.loads(self.path.read_text()))

    def save(self, token: Token) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            json.dump(asdict(token), fh)
        os.replace(tmp, self.path)


class SsmTokenStore:
    """The token as a SecureString SSM parameter, encrypted with the account's
    default aws/ssm key. The parameter is created on first save."""

    # `client` is a boto3 SSM client; one is created from the environment if omitted.
    def __init__(self, name: str, client: Any = None) -> None:
        if client is None:
            import boto3  # imported lazily: only SSM users need it loaded

            client = boto3.client("ssm")
        self.client = client
        self.name = name
        self.location = f"ssm:{name}"

    def load(self) -> Token | None:
        try:
            response = self.client.get_parameter(Name=self.name, WithDecryption=True)
        except self.client.exceptions.ParameterNotFound:
            return None
        return Token(**json.loads(response["Parameter"]["Value"]))

    def save(self, token: Token) -> None:
        self.client.put_parameter(
            Name=self.name,
            Value=json.dumps(asdict(token)),
            Type="SecureString",
            Overwrite=True,
        )


def open_token_store(settings: Settings) -> TokenStore:
    """SSM when DUCKBILL_TOKEN_PARAMETER is set, otherwise a file in the data dir."""
    if settings.token_parameter:
        return SsmTokenStore(settings.token_parameter)
    return FileTokenStore(settings.token_path)


def _exchange(settings: Settings, data: dict[str, str]) -> Token:
    client_id, client_secret = settings.require_client()
    response = httpx.post(
        TOKEN_URL,
        data={"client_id": client_id, "client_secret": client_secret, **data},
        timeout=30,
    )
    if response.status_code in (400, 401):
        raise ReauthRequired(f"token exchange rejected: {response.text}")
    response.raise_for_status()
    return Token.from_response(response.json())


def refresh(settings: Settings, store: TokenStore, token: Token) -> Token:
    if not token.refresh_token:
        raise ReauthRequired("no refresh token stored (is the OAuth client confidential?)")
    fresh = _exchange(
        settings, {"grant_type": "refresh_token", "refresh_token": token.refresh_token}
    )
    store.save(fresh)
    return fresh


def valid_token(settings: Settings, store: TokenStore) -> Token:
    token = store.load()
    if token is None:
        raise ReauthRequired("not logged in")
    if token.expiring:
        token = refresh(settings, store, token)
    return token


def browser_login(settings: Settings, store: TokenStore) -> Token:
    """Run the authorization-code flow via a one-shot local callback server."""
    client_id, _ = settings.require_client()
    redirect = urlparse(settings.redirect_uri)
    if redirect.hostname not in ("localhost", "127.0.0.1") or redirect.port is None:
        raise SystemExit("MONZO_REDIRECT_URI must be http://localhost:<port>/<path>")

    state = secrets.token_urlsafe(24)
    result: dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            url = urlparse(self.path)
            if url.path != redirect.path:
                self.send_error(404)
                return
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            result.update(query)
            ok = query.get("state") == state and "code" in query
            self.send_response(200 if ok else 400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            message = (
                "Signed in. Now approve access in the Monzo app, then return to the terminal."
                if ok
                else "Login failed: state mismatch or missing code."
            )
            self.wfile.write(f"<p style='font-family:sans-serif'>{message}</p>".encode())

        def log_message(self, format: str, *args: Any) -> None:
            pass

    url = (
        AUTH_URL
        + "?"
        + urlencode(
            {
                "client_id": client_id,
                "redirect_uri": settings.redirect_uri,
                "response_type": "code",
                "state": state,
            }
        )
    )
    print(f"Opening Monzo login in your browser:\n  {url}\n")
    webbrowser.open(url)

    server = HTTPServer((redirect.hostname, redirect.port), Handler)
    server.timeout = 5
    deadline = time.monotonic() + 600
    while "code" not in result and "error" not in result and time.monotonic() < deadline:
        server.handle_request()
    server.server_close()

    if result.get("state") != state or "code" not in result:
        # Only the error field: the full query can carry the authorization code.
        error = result.get("error", "state mismatch, missing code or timed out")
        raise SystemExit(f"Login failed: {error}")

    token = _exchange(
        settings,
        {
            "grant_type": "authorization_code",
            "redirect_uri": settings.redirect_uri,
            "code": result["code"],
        },
    )
    store.save(token)
    return token
