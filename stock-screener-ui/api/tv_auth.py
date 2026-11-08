"""Authenticated TradingView scanner access.

The public scanner returns ``update_mode=delayed_streaming_900`` (15-minute
delayed). Passing the user's TradingView cookies to ``get_scanner_data``
switches the same query to ``update_mode=streaming`` (real-time) — the
``tradingview_screener`` library forwards ``cookies`` to ``requests.post``.

Cookie sources, in order:
1. ``TRADINGVIEW_COOKIES`` / ``TV_COOKIES`` env (JSON object/array or a
   ``name=value; name=value`` header string) — the production-safe path.
2. The local browser via ``upstox_trader.screeners.tv_cookies`` — dev only.

The jar is cached (default 10 min). A failed extraction is cached briefly so
a missing browser is not retried on every request. Never raises and never
logs cookie values.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)

#: How long a successfully extracted jar is reused.
_TTL_SEC = max(60, int(os.getenv("TV_COOKIE_TTL_SEC", "600")))
#: How long a failed extraction is remembered before retrying.
_NEG_TTL_SEC = 60.0

_lock = threading.Lock()
_cache: dict[str, Any] = {
    "jar": None,
    "source": "none",
    "ts": 0.0,
    "attempt_ts": 0.0,
}


def _parse_env_cookies(raw: str) -> Optional[dict[str, str]]:
    """Parse the env cookie value (JSON object/array or ``a=b; c=d``)."""
    raw = raw.strip()
    if not raw:
        return None
    if raw[0] in "[{":
        data = json.loads(raw)
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items() if v is not None}
        if isinstance(data, list):
            return {
                str(item["name"]): str(item["value"])
                for item in data
                if isinstance(item, dict) and item.get("name") and item.get("value") is not None
            }
        return None
    out: dict[str, str] = {}
    for part in raw.split(";"):
        if "=" not in part:
            continue
        name, value = part.split("=", 1)
        name = name.strip()
        if name:
            out[name] = value.strip()
    return out or None


def _from_env() -> Optional[Any]:
    for key in ("TRADINGVIEW_COOKIES", "TV_COOKIES"):
        raw = os.getenv(key)
        if not raw:
            continue
        try:
            parsed = _parse_env_cookies(raw)
        except Exception as exc:
            log.warning("TradingView cookies: could not parse %s (%s)", key, type(exc).__name__)
            continue
        if parsed:
            return parsed
    return None


def _from_browser() -> Optional[Any]:
    """Read TradingView cookies from the local browser (dev machines only)."""
    try:
        root = Path(__file__).resolve().parents[2]
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from upstox_trader.screeners.tv_cookies import get_tradingview_cookies

        return get_tradingview_cookies() or None
    except Exception as exc:
        log.debug("TradingView cookies: browser extraction unavailable (%s)", type(exc).__name__)
        return None


def get_tv_cookies(*, force: bool = False):
    """Best available TradingView cookie jar/dict, or ``None``. Never raises."""
    now = time.monotonic()
    with _lock:
        fresh = now - float(_cache["ts"]) < _TTL_SEC
        if not force and _cache["jar"] is not None and fresh:
            return _cache["jar"]
        if (
            not force
            and _cache["jar"] is None
            and now - float(_cache["attempt_ts"]) < _NEG_TTL_SEC
        ):
            return None

        jar = _from_env()
        source = "env" if jar is not None else "none"
        # Tests/CI must not touch the developer's browser profile.
        if jar is None and not (os.getenv("CI") or os.getenv("PYTEST_CURRENT_TEST")):
            jar = _from_browser()
            source = "browser" if jar is not None else "none"

        _cache.update(
            jar=jar,
            source=source,
            ts=now if jar is not None else 0.0,
            attempt_ts=now,
        )
        log.info(
            "TradingView cookies: source=%s count=%s",
            source,
            len(jar) if jar is not None else 0,
        )
        return jar


def tv_scanner_data(query):
    """Run a ``tradingview_screener.Query`` with the best available auth."""
    cookies = get_tv_cookies()
    if cookies:
        return query.get_scanner_data(cookies=cookies)
    return query.get_scanner_data()


def refresh_tv_cookies():
    """Force a cache refresh (e.g. after the feed reports delayed/401)."""
    return get_tv_cookies(force=True)


def clear_tv_cookie_cache() -> None:
    """Drop the cached jar (tests / manual refresh)."""
    with _lock:
        _cache.update(jar=None, source="none", ts=0.0, attempt_ts=0.0)


def tv_auth_status() -> dict[str, Any]:
    """Non-secret status for diagnostics: source, cookie count, cache age."""
    with _lock:
        jar = _cache["jar"]
        return {
            "authenticated": jar is not None,
            "source": _cache["source"],
            "cookie_count": len(jar) if jar is not None else 0,
            "cache_age_sec": (
                round(time.monotonic() - float(_cache["ts"]), 1)
                if jar is not None
                else None
            ),
        }
