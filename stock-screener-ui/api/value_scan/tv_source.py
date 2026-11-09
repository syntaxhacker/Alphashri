"""TradingView scanner data source for the Deep Value tab.

Fetches one fundamentals + technicals frame per market through the shared
:mod:`api.tv` client. Exactly one HTTP POST per ``fetch_frame`` call.

Markets:
  india  -> scanner ``india``
  usa    -> scanner ``america``, exchanges filtered to NASDAQ/NYSE/AMEX
  global -> scanner ``global`` with an explicit country list, then
            type/exchange hygiene + cross-listing dedupe in Python.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import pandas as pd

from api.tv import (
    CORE_FIELDS,
    EXCHANGE_PREFERENCE,
    FRAME_LIMIT,
    GLOBAL_COUNTRIES,
    MARKET_CURRENCY,  # noqa: F401  (re-exported for api.value_scan.router)
    MARKETS,
    MCAP_FLOOR,
    NON_GLOBAL_COUNTRIES,
    NUMERIC_COLUMNS,
    USA_EXCHANGES,
    VALUE_COLUMNS,
    scan_frame,
)

logger = logging.getLogger("value_scan.tv_source")


class TvSourceError(Exception):
    """Raised when the TradingView scanner request fails or is unusable."""


def _markets_for(market: str) -> list[str]:
    if market == "usa":
        return ["america"]
    if market == "india":
        return ["india"]
    return list(GLOBAL_COUNTRIES)


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


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
            if country and country.lower() in NON_GLOBAL_COUNTRIES:
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


def _rows_from_frame(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Convert a ``scan_frame`` DataFrame into column-keyed row dicts.

    Nulls become ``None`` rather than NaN: downstream scoring treats
    ``is not None`` as "present", and a NaN would silently pass that check.
    """
    rows: list[dict[str, Any]] = []
    for record in df.to_dict(orient="records"):
        row: dict[str, Any] = {}
        for col in VALUE_COLUMNS:
            raw = record.get(col)
            if _is_missing(raw):
                row[col] = None
            elif col in NUMERIC_COLUMNS:
                try:
                    row[col] = float(raw)
                except (TypeError, ValueError):
                    row[col] = None
            else:
                row[col] = raw
        rows.append(row)
    return rows


def fetch_frame(market: str) -> list[dict[str, Any]]:
    """Fetch one fundamentals frame for ``market``.

    Issues EXACTLY ONE HTTP POST through :func:`api.tv.scan_frame`. Raises
    :class:`TvSourceError` on HTTP failure or on an empty/unusable payload.
    """
    if market not in MARKETS:
        raise TvSourceError(f"value_source_unavailable: unknown market '{market}'")
    try:
        df = scan_frame(
            market,
            columns=VALUE_COLUMNS,
            filters=[
                {"left": "market_cap_basic", "operation": "greater",
                 "right": MCAP_FLOOR[market]},
                # Push the type filter to the server: the scanner universe is
                # mostly funds and depositary receipts, and without this the
                # 1-request frame would be ~50% dead rows (and far too small
                # to rank).
                {"left": "type", "operation": "equal", "right": "stock"},
            ],
            sort="market_cap_basic",
            limit=FRAME_LIMIT[market],
            markets=_markets_for(market),
        )
    except Exception as exc:
        raise TvSourceError(
            f"value_source_unavailable: scanner request failed ({exc})"
        ) from exc
    rows = _rows_from_frame(df)
    if not rows:
        raise TvSourceError("value_source_unavailable: empty scanner payload")
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
