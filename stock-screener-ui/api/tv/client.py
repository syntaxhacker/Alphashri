"""Low-level TradingView scanner transport (raw requests + library queries).

The ``tradingview_screener`` library is still used where its query builder is
convenient; :func:`get_scanner_data` authenticates it. Raw callers use
:func:`scan_frame` / :func:`scan_raw`, which share the same URL, headers and
cookie provider.

Never add a second scanner URL/header set elsewhere.
"""

from __future__ import annotations

import logging
from typing import Any, Iterable, Optional, Sequence

import pandas as pd
import requests

from .auth import get_tv_cookies
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


def resolve_market(market: str) -> str:
    """Map a caller's market key to the scanner URL segment."""
    key = str(market or "").strip().lower()
    segment = MARKETS.get(key)
    if not segment:
        raise ValueError(f"unknown TradingView market {market!r}")
    return segment


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
    return requests.post(url, **kwargs)


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
    """Run a ``tradingview_screener.Query`` with auth cookies when available."""
    cookies = get_tv_cookies()
    if cookies:
        result = query.get_scanner_data(cookies=cookies)
    else:
        result = query.get_scanner_data()
    frame = result[1] if isinstance(result, tuple) and len(result) > 1 else result
    note_update_mode(frame)
    return result
