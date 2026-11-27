"""Low-level TradingView scanner transport (raw requests + library queries).

The ``tradingview_screener`` library is still used where its query builder is
convenient; :func:`get_scanner_data` authenticates it. Raw callers use
:func:`scan_frame` / :func:`scan_raw`, which share the same URL, headers and
cookie provider.

Never add a second scanner URL/header set elsewhere.
"""

from __future__ import annotations

import logging
import random
import threading
import time
from typing import Any, Iterable, Optional, Sequence

import pandas as pd
import requests

from .auth import get_tv_cookies, refresh_tv_cookies
from .columns import PRICE_COLUMNS, TEXT_COLUMNS
from .status import note_update_mode

log = logging.getLogger(__name__)

SCANNER_URL = "https://scanner.tradingview.com/{market}/scan"
REQUEST_TIMEOUT = 40
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Content-Type": "application/json",
    "Origin": "https://www.tradingview.com",
    "Referer": "https://www.tradingview.com/",
    "Accept": "application/json",
}

#: Public market key -> scanner URL segment.
MARKETS: dict[str, str] = {
    "india": "india",
    "usa": "america",
    "america": "america",
    "global": "global",
    "futures": "futures",
}

#: Auth failures get exactly one forced cookie refresh + one retry.
AUTH_STATUSES = frozenset({401, 403})
#: Bounded retry budget for 429 / 5xx, excluding the initial attempt.
MAX_TRANSPORT_RETRIES = 2
_BACKOFF_BASE_SEC = 0.5
_BACKOFF_CAP_SEC = 8.0

#: requests.Session is not thread-safe: each thread owns its own pooled session.
_tls = threading.local()
#: Test seams -- monkeypatchable without sleeping or depending on wall-clock jitter.
_sleep = time.sleep
_jitter = random.uniform
_REQUESTS_POST = requests.post


def resolve_market(market: str) -> str:
    """Map a caller's market key to the scanner URL segment."""
    key = str(market or "").strip().lower()
    segment = MARKETS.get(key)
    if not segment:
        raise ValueError(f"unknown TradingView market {market!r}")
    return segment


def _get_session() -> requests.Session:
    """Return this thread's session, creating it on first use."""
    session = getattr(_tls, "session", None)
    if session is None:
        session = requests.Session()
        _tls.session = session
    return session


def _post(url: str, **kwargs):
    """POST through the pooled session, honouring an injected ``requests.post``.

    Existing patch points replace ``requests.post`` wholesale (no network in
    tests). Production uses one session per thread for connection reuse; a
    session must never be shared across threads.
    """
    if requests.post is not _REQUESTS_POST:
        return requests.post(url, **kwargs)
    return _get_session().post(url, **kwargs)


def _backoff_delay(attempt: int) -> float:
    """Full-jitter exponential delay for retry ``attempt`` (1-based)."""
    ceiling = min(_BACKOFF_BASE_SEC * 2 ** (attempt - 1), _BACKOFF_CAP_SEC)
    return float(_jitter(0.0, ceiling))


def _drop_session_cookies() -> None:
    """Clear this thread's session jar so a refreshed cookie set takes effect."""
    jar = getattr(getattr(_tls, "session", None), "cookies", None)
    if jar is not None and hasattr(jar, "clear"):
        jar.clear()


def _post_with_retries(url: str, kwargs: dict[str, Any]):
    """POST with bounded auth/transport retries. Never logs request cookies."""
    auth_retried = False
    transport_retries = 0
    while True:
        resp = _post(url, **kwargs)
        status = getattr(resp, "status_code", None)
        if not isinstance(status, int) or status < 400:
            return resp
        if status in AUTH_STATUSES:
            if auth_retried:
                resp.raise_for_status()
            auth_retried = True
            refresh_tv_cookies()
            _drop_session_cookies()
            cookies = get_tv_cookies()
            if cookies:
                kwargs["cookies"] = cookies
            else:
                kwargs.pop("cookies", None)
            continue
        if status == 429 or 500 <= status <= 599:
            if transport_retries >= MAX_TRANSPORT_RETRIES:
                resp.raise_for_status()
            transport_retries += 1
            _sleep(_backoff_delay(transport_retries))
            continue
        # Validation and other 4xx responses are deterministic: surface them.
        resp.raise_for_status()


def scan_raw(
    market: str,
    body: dict[str, Any],
    *,
    timeout: int = REQUEST_TIMEOUT,
    headers: Optional[dict[str, str]] = None,
):
    """POST a raw scanner body with auth cookies when available."""
    url = SCANNER_URL.format(market=resolve_market(market))
    kwargs: dict[str, Any] = {
        "json": body,
        "headers": headers or HEADERS,
        "timeout": timeout,
    }
    cookies = get_tv_cookies()
    if cookies:
        kwargs["cookies"] = cookies
    return _post_with_retries(url, kwargs)


def coerce_numeric(df: pd.DataFrame) -> pd.DataFrame:
    """Coerce every non-text scanner column to numeric (nulls stay NaN)."""
    for col in df.columns:
        if col not in TEXT_COLUMNS:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def add_symbol(df: pd.DataFrame) -> pd.DataFrame:
    """Attach a ``sym`` column (ticker without exchange prefix)."""
    if "name" in df.columns:
        df = df.assign(sym=df["name"].astype(str).str.split(":").str[-1])
    return df


def scan_frame(
    market: str,
    *,
    columns: Optional[Sequence[str]] = None,
    filters: Optional[Sequence[dict]] = None,
    sort: Optional[str] = None,
    order: str = "desc",
    limit: int = 500,
    tickers: Optional[Iterable[str]] = None,
    markets: Optional[Sequence[str]] = None,
    body_extra: Optional[dict[str, Any]] = None,
    timeout: int = REQUEST_TIMEOUT,
) -> pd.DataFrame:
    """Run one scanner query and return a tidy numeric DataFrame.

    ``markets`` overrides the body's market list (e.g. the GLOBAL country
    list); the URL still uses ``market``.
    """
    body: dict[str, Any] = {
        "markets": list(markets) if markets else [resolve_market(market)],
        "symbols": {"tickers": list(tickers or []), "query": {"types": []}},
        "columns": list(columns or PRICE_COLUMNS),
        "range": [0, int(limit)],
        "ignore_unknown_fields": True,
    }
    if filters:
        body["filter"] = list(filters)
    if sort:
        body["sort"] = {"sortBy": sort, "sortOrder": order}
    if body_extra:
        body.update(body_extra)

    resp = scan_raw(market, body, timeout=timeout)
    resp.raise_for_status()
    payload = resp.json()
    rows = [dict(zip(body["columns"], row.get("d") or [])) for row in payload.get("data", [])]
    df = pd.DataFrame(rows, columns=list(body["columns"]))
    df = coerce_numeric(df)
    note_update_mode(df)
    return df


def get_scanner_data(query):
    """Run a ``tradingview_screener.Query`` with auth cookies when available.

    The library owns its own HTTP transport; raw transport policy (session
    reuse, bounded retries) applies to :func:`scan_frame` / :func:`scan_raw`.
    """
    cookies = get_tv_cookies()
    if cookies:
        result = query.get_scanner_data(cookies=cookies)
    else:
        result = query.get_scanner_data()
    frame = result[1] if isinstance(result, tuple) and len(result) > 1 else result
    note_update_mode(frame)
    return result
