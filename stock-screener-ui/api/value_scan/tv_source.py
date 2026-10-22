"""TradingView scanner data source for the Deep Value tab.

Fetches one fundamentals + technicals frame per market from the public
TradingView scanner (no auth). Exactly one HTTP POST per ``fetch_frame`` call.

Markets:
  india  -> scanner ``india``
  usa    -> scanner ``america``, exchanges filtered to NASDAQ/NYSE/AMEX
  global -> scanner ``global`` with an explicit country list, then
            type/exchange hygiene + cross-listing dedupe in Python.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

import pandas as pd
import requests

logger = logging.getLogger("value_scan.tv_source")

SCANNER_URL = "https://scanner.tradingview.com/{segment}/scan"
REQUEST_TIMEOUT = 40
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

#: market key -> scanner URL segment
MARKETS: dict[str, str] = {
    "india": "india",
    "usa": "america",
    "global": "global",
}

#: reporting currency per market ("mixed" = per-row listing currency)
MARKET_CURRENCY: dict[str, str] = {
    "india": "INR",
    "usa": "USD",
    "global": "mixed",
}

#: server-side market-cap pre-filter floors, in native units
MCAP_FLOOR: dict[str, float] = {
    "india": 1e9,
    "usa": 2e9,
    "global": 1e9,
}

#: how many names the single request may pull back (sorted by market cap desc).
#: The USA universe holds ~5.2k names above $2bn, so 4000 keeps the whole
#: large-cap value universe inside one request. GLOBAL needs a much bigger
#: window: every US mega-cap has 8-10 foreign lines (NVDA alone had 8), so a
#: 4k window is almost entirely US-company lines and leaves only ~400 genuine
#: international names.
FRAME_LIMIT: dict[str, int] = {
    "india": 4000,
    "usa": 4000,
    "global": 12000,
}

#: countries scanned for the global universe (no "global" STOCKS market exists)
GLOBAL_COUNTRIES = [
    "uk", "germany", "japan", "hongkong", "korea", "canada", "australia",
    "taiwan", "singapore", "france", "sweden", "spain", "italy",
    "netherlands", "switzerland", "brazil",
]

#: allowed listing exchanges for the usa universe
USA_EXCHANGES = {"NASDAQ", "NYSE", "AMEX"}

#: domiciles excluded from the GLOBAL universe (they belong to the USA tab)
_NON_GLOBAL_COUNTRIES = {"united states"}

#: preferred exchanges when deduping a multiply-listed global company
EXCHANGE_PREFERENCE = [
    "NASDAQ", "NYSE", "AMEX", "LSE", "XETRA", "TSE", "TSX", "HKEX",
    "ASX", "EPA", "AMS", "SWX", "BME", "BIT", "KRX", "TWSE", "SGX",
]

#: columns requested from the scanner (all verified present)
COLUMNS = [
    "name", "description", "type", "sector", "industry", "exchange", "country",
    "currency", "close", "change", "open", "high", "low", "volume",
    "relative_volume_10d_calc", "market_cap_basic", "total_revenue",
    "net_income", "total_debt", "free_cash_flow_ttm", "price_earnings_ttm",
    "price_sales_ratio", "price_book_fq", "return_on_equity_fq",
    "gross_margin_ttm", "operating_margin_ttm", "return_on_assets_fq",
    "debt_to_equity_fq", "current_ratio", "quick_ratio",
    "total_revenue_yoy_growth_ttm",
    "earnings_per_share_diluted_yoy_growth_ttm",
    "earnings_per_share_diluted_ttm", "revenue_per_share_ttm",
    "dividends_yield_current", "SMA20", "SMA50", "SMA100", "SMA200",
    "EMA20", "EMA50", "RSI", "Recommend.All", "Recommend.MA", "ADX",
    "ATR", "beta_1_year", "Volatility.D", "Perf.W", "Perf.1M", "Perf.3M",
    "Perf.Y", "price_52_week_high", "price_52_week_low",
]

#: numeric columns coerced with pd.to_numeric(errors="coerce")
NUMERIC_COLUMNS = [c for c in COLUMNS if c not in (
    "name", "description", "type", "sector", "industry", "exchange", "country",
    "currency",
)]

#: core fields used by frame_summary() to judge completeness
CORE_FIELDS = [
    "market_cap_basic", "price_earnings_ttm", "price_book_fq",
    "return_on_equity_fq", "free_cash_flow_ttm", "close",
]


class TvSourceError(Exception):
    """Raised when the TradingView scanner request fails or is unusable."""


def _markets_for(market: str) -> list[str]:
    if market == "usa":
        return ["america"]
    if market == "india":
        return ["india"]
    return list(GLOBAL_COUNTRIES)


def _request_body(market: str) -> dict[str, Any]:
    return {
        "markets": _markets_for(market),
        "symbols": {"tickers": [], "query": {"types": []}},
        "columns": list(COLUMNS),
        "filter": [
            {"left": "market_cap_basic", "operation": "greater",
             "right": MCAP_FLOOR[market]},
            # Push the type filter to the server: the scanner universe is mostly
            # funds and depositary receipts, and without this the 1-request
            # frame would be ~50% dead rows (and far too small to rank).
            {"left": "type", "operation": "equal", "right": "stock"},
        ],
        "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
        "range": [0, FRAME_LIMIT[market]],
        "ignore_unknown_fields": True,
    }


def _coerce(value: Any) -> Optional[float]:
    """Coerce a scanner value to float, returning None when missing."""
    if value is None:
        return None
    try:
        result = pd.to_numeric(value, errors="coerce")
    except Exception:
        return None
    try:
        if pd.isna(result):
            return None
    except Exception:
        return None
    return float(result)


def _parse_payload(payload: Any) -> list[dict[str, Any]]:
    """Parse a scanner response into column-keyed row dicts.

    Accepts the live TradingView shape ``{"data": [{"s": ..., "d": [...]}]}``
    (values in COLUMNS order) and the bare-list shape ``{"data": [[...]]}``.
    """
    if not isinstance(payload, dict):
        raise TvSourceError("value_source_unavailable: unexpected payload type")
    data = payload.get("data")
    if not data:
        raise TvSourceError("value_source_unavailable: empty scanner payload")
    rows: list[dict[str, Any]] = []
    for entry in data:
        if isinstance(entry, dict):
            values = entry.get("d", [])
        elif isinstance(entry, (list, tuple)):
            values = entry
        else:
            continue
        row: dict[str, Any] = {}
        for i, col in enumerate(COLUMNS):
            raw = values[i] if i < len(values) else None
            row[col] = _coerce(raw) if col in NUMERIC_COLUMNS else raw
        rows.append(row)
    if not rows:
        raise TvSourceError("value_source_unavailable: empty scanner payload")
    return rows


def _root_symbol(raw: Any, currency: Any) -> str:
    """Normalise a listing name to a dedupe key.

    Strips exchange prefixes (``NASDAQ:NVDA``), trailing ``.CURRENCY``
    suffixes (``NVDA.USD``), leading digits (``4NVDA``) and trailing
    listing-code digits (``NVDC34``). All-digit tickers (e.g. ``7203``)
    are kept verbatim.
    """
    s = str(raw or "").split(":")[-1].strip().upper()
    if not s:
        return ""
    if currency:
        suffix = "." + str(currency).upper()
        if s.endswith(suffix):
            s = s[: -len(suffix)]
    s = re.sub(r"\.[A-Z]{2,5}$", "", s)
    s = re.sub(r"^\d+", "", s)
    stem = re.sub(r"\d+$", "", s)
    if stem and any(ch.isalpha() for ch in stem):
        s = stem
    return s or str(raw or "").split(":")[-1].strip().upper()


def _completeness(row: dict[str, Any]) -> int:
    return sum(1 for c in NUMERIC_COLUMNS if row.get(c) is not None)


def _apply_hygiene(market: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Type/exchange filtering + cross-listing dedupe."""
    floor = MCAP_FLOOR[market]
    kept: list[dict[str, Any]] = []
    for row in rows:
        mcap = row.get("market_cap_basic")
        if mcap is not None and mcap < floor:
            continue
        if str(row.get("type") or "").lower() != "stock":
            continue
        if market == "usa":
            if str(row.get("exchange") or "").upper() not in USA_EXCHANGES:
                continue
        if market == "india":
            # The app is NSE-based (Upstox NSE instruments). BSE rows also carry
            # BSE-specific tickers (M_M, J_KBANK, ...) so they can never be
            # matched to the NSE line - keep NSE only.
            if str(row.get("exchange") or "").upper() != "NSE":
                continue
        if market == "global" and str(row.get("currency") or "").upper() == "USD":
            # USD-quoted lines are direct US duplicates of names the USA tab
            # already covers; drop them so GLOBAL stays international.
            continue
        if market == "global":
            # The company must be domiciled in one of the scanned countries:
            # a US company listed in Frankfurt/SIX/Milan shows country
            # "United States" and belongs to the USA tab, not to GLOBAL.
            country = str(row.get("country") or "").strip()
            if country and country.lower() in _NON_GLOBAL_COUNTRIES:
                continue
            root = _root_symbol(row.get("name"), row.get("currency"))
            if sum(1 for ch in root if ch.isalpha()) < 2:
                continue  # pure instrument codes (869020, 300, ...) are not companies
        kept.append(row)

    if market != "global":
        return kept

    pref = {ex: i for i, ex in enumerate(EXCHANGE_PREFERENCE)}
    best: dict[str, dict[str, Any]] = {}
    for row in kept:
        # Key on the COMPANY (description), not the ticker: one company has many
        # lines across venues (Ageas SA/NV trades in Amsterdam, Paris, Milan and
        # Brussels under four different tickers).
        key = str(row.get("description") or "").strip().upper()
        if not key:
            key = _root_symbol(row.get("name"), row.get("currency"))
        current = best.get(key)
        if current is None:
            best[key] = row
            continue
        cand_score = (
            _completeness(row),
            -pref.get(str(row.get("exchange") or "").upper(), len(pref)),
            (row.get("market_cap_basic") or 0.0),
        )
        cur_score = (
            _completeness(current),
            -pref.get(str(current.get("exchange") or "").upper(), len(pref)),
            (current.get("market_cap_basic") or 0.0),
        )
        if cand_score > cur_score:
            best[key] = row
    return list(best.values())


def fetch_frame(market: str) -> list[dict[str, Any]]:
    """Fetch one fundamentals frame for ``market``.

    Issues EXACTLY ONE HTTP POST. Raises :class:`TvSourceError` on HTTP
    failure or on an empty/unusable payload.
    """
    if market not in MARKETS:
        raise TvSourceError(f"value_source_unavailable: unknown market '{market}'")
    url = SCANNER_URL.format(segment=MARKETS[market])
    body = _request_body(market)
    headers = {"User-Agent": USER_AGENT, "Content-Type": "application/json"}
    try:
        response = requests.post(url, json=body, headers=headers,
                                 timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        payload = response.json()
    except TvSourceError:
        raise
    except Exception as exc:
        raise TvSourceError(
            f"value_source_unavailable: scanner request failed ({exc})"
        ) from exc
    rows = _parse_payload(payload)
    return _apply_hygiene(market, rows)


def frame_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Summarise a frame: row count and core-field completeness."""
    total = len(rows)
    missing: list[str] = []
    if total:
        for field in CORE_FIELDS:
            absent = sum(1 for r in rows if r.get(field) is None)
            if absent / total > 0.5:
                missing.append(field)
    return {
        "count": total,
        "fields_complete": not missing,
        "missing_fields": missing,
    }
