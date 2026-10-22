#!/usr/bin/env python3
"""Shared Upstox access for the desk/tooling layer.

One home for token resolution and the REST shapes the desk calls.

Token precedence is canonical — DB (``broker_connections``) ->
``.upstox_token.json`` -> ``UPSTOX_ACCESS_TOKEN`` — matching
``api/brokers.py`` and ``db.models.broker.get_shared_broker_token``. Eleven
near-copies of this lookup with eleven different precedence rules is how a
live desk ends up 401-ing mid-session: a loader that skipped the DB row used
the stale file token instead of the freshly-refreshed one.

Every reader is tolerant: a missing DB, a corrupt legacy file or an absent
env var yields "" rather than an exception, so each caller decides whether
"no token" is fatal for it.
"""

from __future__ import annotations

import json
import os
import pathlib

BASE_V2 = "https://api.upstox.com/v2"
BASE_V3 = "https://api.upstox.com/v3"
NIFTY_KEY = "NSE_INDEX|Nifty 50"


def _token_from_db() -> str:
    """The shared ``broker_connections`` row, or "" when absent/unreadable."""
    try:
        from db.models.broker import get_shared_broker_token

        row = get_shared_broker_token("upstox") or {}
        return str(row.get("access_token") or "").strip()
    except Exception:
        return ""


def _token_file_paths() -> list[pathlib.Path]:
    """Candidate ``.upstox_token.json`` locations, canonical first."""
    try:
        import config

        base = pathlib.Path(config.BASE_DIR)
    except Exception:
        base = pathlib.Path(__file__).resolve().parents[1]
    return [base / ".upstox_token.json", base.parent / ".upstox_token.json"]


def _token_from_file() -> tuple[str, str]:
    """``(token, path)`` from the legacy file, or ``("", "")``."""
    for path in _token_file_paths():
        try:
            if not path.exists():
                continue
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            tok = str(data.get("access_token") or "").strip()
            if tok:
                return tok, str(path)
        except (OSError, ValueError, AttributeError):
            continue
    return "", ""


def _token_from_env() -> str:
    """``UPSTOX_ACCESS_TOKEN`` from the process env, or ""."""
    tok = os.getenv("UPSTOX_ACCESS_TOKEN", "").strip()
    if tok:
        return tok
    try:
        import config

        return str(getattr(config, "UPSTOX_ACCESS_TOKEN", "") or "").strip()
    except Exception:
        return ""


def token_with_source() -> tuple[str, str]:
    """``(token, source label)`` — the label names where the token came from.

    ``source`` is "" when no token is configured.
    """
    tok = _token_from_db()
    if tok:
        return tok, "DB (broker_connections)"
    tok, path = _token_from_file()
    if tok:
        return tok, path
    tok = _token_from_env()
    if tok:
        return tok, "UPSTOX_ACCESS_TOKEN env var"
    return "", ""


def token() -> str:
    """The current Upstox access token, or "" when none is configured."""
    return token_with_source()[0]


def _resolve(tok: str) -> str:
    """The caller's token when it has one, else the current one."""
    return tok or token_with_source()[0]


# ---------------------------------------------------------------------------
# pure helpers
# ---------------------------------------------------------------------------
def as_float(value):
    """Finite float or None — never raises, never returns NaN/inf."""
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out != out or out in (float("inf"), float("-inf")):
        return None
    return out


def data(payload):
    """Unwrap Upstox's ``{"status": ..., "data": ...}`` envelope."""
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


# ---------------------------------------------------------------------------
# REST
# ---------------------------------------------------------------------------
def get(path: str, params: dict | None = None, timeout: float = 10.0,
        base: str = BASE_V2, rate_limit: bool = True, token: str = "") -> dict:
    """GET ``base + path`` and return the parsed JSON body.

    Raises ``RuntimeError`` when there is no token; HTTP errors propagate.
    """
    import requests

    from scripts.upstox_rate import get_limiter

    tok = _resolve(token)
    if not tok:
        raise RuntimeError("no Upstox token")
    headers = {"Authorization": f"Bearer {tok}", "Accept": "application/json"}
    if rate_limit:
        get_limiter().acquire()  # shared 50/s + 500/min + 2000/30min budget
    resp = requests.get(f"{base}{path}", params=params, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def rest_spot(instrument_key: str = NIFTY_KEY, token: str = "", timeout: float = 8.0,
               base: str = BASE_V2, rate_limit: bool = True) -> float | None:
    """Last traded price for one instrument key. None when unavailable.

    Never raises: a missing token or a failed call is "no live price".
    """
    import requests

    from scripts.upstox_rate import get_limiter

    tok = _resolve(token)
    if not tok:
        return None
    try:
        if rate_limit:
            get_limiter().acquire()
        resp = requests.get(
            f"{base}/market-quote/ltp",
            params={"instrument_key": instrument_key},
            headers={"Authorization": f"Bearer {tok}", "Accept": "application/json"},
            timeout=timeout,
        )
        resp.raise_for_status()
        for row in (resp.json().get("data") or {}).values():
            px = row.get("last_price")
            if px:
                return float(px)
    except Exception:
        return None
    return None


def chain(token: str = "", expiry: str = "", underlying: str = NIFTY_KEY,
          timeout: float = 10.0, rate_limit: bool = False) -> dict:
    """``GET /option/chain`` -> ``{"spot": float, "rows": [...]}``.

    ``rate_limit`` defaults to False: the desk manager polls this every 10 s
    from its own process, well inside the budget, and must never block.
    """
    tok = _resolve(token)
    if not tok:
        raise RuntimeError("no Upstox token")
    payload = get(
        "/option/chain",
        {"instrument_key": underlying, "expiry_date": expiry},
        timeout,
        rate_limit=rate_limit,
        token=tok,
    )
    rows = payload["data"]
    return {"spot": rows[0]["underlying_spot_price"], "rows": rows}
