"""
Single Upstox access-token resolver.

Replaces the four ad-hoc token lookups that previously lived in
api/options.py, api/brokers.py, api/paper/live_stream.py and
chart_patterns/watch.py. Resolution order is always DB-first
(see AGENTS.md "Upstox Token Storage (DB-first)"):

    1. DB    - broker_connections row via get_shared_broker_token("upstox")
               (OAuth token; source of truth after connect)
    2. File  - .upstox_token.json in the project root (legacy fallback)
    3. Env   - UPSTOX_ACCESS_TOKEN, only when use_env=True

A module-level cache keyed on ``use_env`` is honoured only when
``cache_ttl > 0`` (monotonic clock). ``clear_upstox_token_cache()`` drops it
so an OAuth connect/disconnect is visible immediately.

DB lookup failures are treated as a missing token and fall through to the
next source -- a transient SQLite error must never kill a price feed, and a
missing DB token must fall back to the file exactly as before.
"""

import json
import os
import time
from pathlib import Path
from typing import Optional

from fastapi import HTTPException

import config
import db.models

TOKEN_FILE: Path = config.BASE_DIR / ".upstox_token.json"

#: 401 detail used by require_upstox_token -- matches the message previously
#: hard-coded in api/options.get_upstox_token.
SETTINGS_401_DETAIL = (
    "Upstox access token not configured. Go to Settings to connect your Upstox account."
)

_cache: dict[tuple[bool], dict[str, object]] = {}


def clear_upstox_token_cache() -> None:
    """Drop every cached token (call after an OAuth connect/disconnect)."""
    _cache.clear()


def resolve_upstox_token(
    *,
    use_env: bool = False,
    cache_ttl: float = 0.0,
) -> Optional[str]:
    """Return the Upstox access token or ``None`` when not configured.

    Order: DB -> file -> env (env only when ``use_env`` is True). Never
    raises. When ``cache_ttl > 0`` the result is cached in-process for that
    many seconds per ``use_env`` setting (a ``None`` result is cached too,
    so a transiently missing token does not hammer SQLite on every call).
    """
    key = (use_env,)
    now = time.monotonic()
    entry = _cache.get(key)
    if (
        entry is not None
        and cache_ttl > 0.0
        and now - entry["ts"] < cache_ttl  # type: ignore[operator]
    ):
        return entry["token"]  # type: ignore[return-value]

    token: Optional[str] = None

    # 1. DB (OAuth token) -- failures fall through to the file fallback.
    try:
        data = db.models.get_shared_broker_token("upstox")
    except Exception:
        data = None
    if data and data.get("access_token"):
        token = data["access_token"]

    # 2. File (legacy fallback).
    if not token:
        try:
            if TOKEN_FILE.exists():
                with open(TOKEN_FILE, "r") as fh:
                    data = json.load(fh)
                if isinstance(data, dict):
                    token = data.get("access_token") or None
        except (ValueError, KeyError, OSError, TypeError):
            token = None

    # 3. Env (opt-in).
    if not token and use_env:
        token = os.getenv("UPSTOX_ACCESS_TOKEN") or None

    if cache_ttl > 0.0:
        _cache[key] = {"token": token, "ts": now}
    return token


def require_upstox_token(
    *,
    use_env: bool = False,
    cache_ttl: float = 0.0,
) -> str:
    """Return the token, or raise HTTPException(401) with the Settings message."""
    token = resolve_upstox_token(use_env=use_env, cache_ttl=cache_ttl)
    if not token:
        raise HTTPException(status_code=401, detail=SETTINGS_401_DETAIL)
    return token
