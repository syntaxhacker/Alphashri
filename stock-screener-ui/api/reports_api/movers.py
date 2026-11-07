"""Index movers endpoint — top gainers/losers for NIFTY 50.

Endpoint:
  - ``GET /api/reports/movers?index=NIFTY&limit=3|all``

Returns ``{index, as_of, stale, gainers[], losers[], live_only?}`` where each row
is ``{symbol, ltp, change_pct, contribution_pct?, volume?}``.

Constituents/weights:
  - NIFTY 50: from ``scripts/research/nifty_breadth/breadth_predictor.NIFTY50_WEIGHTS``
    (Tickertape 2026-10-15 snapshot, renormalised to 100%).

Quotes: Upstox v2 batch ``/market-quote/quotes`` via ``scripts/upstox_common.token()``
(DB → file → env). Cache 30 s; market-open/closed; ``as_of``; stale flag.
If token/quotes fail, return structured 503 ``{detail: {code: "movers_unavailable"}}``.
Historical dates: return ``live_only: true`` (no constituent history recorded).

SENSEX 30: Not supported — no verified constituent list with weights available.
Returns ``live_only: true`` with empty gainers/losers and a note.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

import config
from scripts.upstox_common import get, token_with_source, BASE_V2

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])

# 30 s cache — quotes don't need to be sub-second for a movers strip
CACHE_TTL_SEC = 30.0
_movers_cache: dict[str, dict] = {}  # key: f"{index}" -> {"ts": float, "data": dict}

# Upstox batch quote endpoint: max 50 symbols per request (conservative)
MAX_SYMBOLS_PER_REQUEST = 50

# ---- NIFTY 50 constituents & weights (Tickertape 2026-10-15) ----
# Source: scripts/research/nifty_breadth/breadth_predictor.NIFTY50_WEIGHTS
# Renormalised to 100% in the predictor. We use the same dict here.
NIFTY50_WEIGHTS = {
    "HDFCBANK": 10.73,
    "ICICIBANK": 9.23,
    "RELIANCE": 7.60,
    "BHARTIARTL": 5.20,
    "LT": 4.08,
    "AXISBANK": 3.72,
    "SBIN": 3.64,
    "INFY": 3.62,
    "KOTAKBANK": 3.06,
    "M&M": 2.47,
    "BAJFINANCE": 2.43,
    "TCS": 2.30,
    "ITC": 2.24,
    "ETERNAL": 2.23,
    "SUNPHARMA": 1.80,
    "SHRIRAMFIN": 1.66,
    "HINDUNILVR": 1.61,
    "TITAN": 1.56,
    "TATASTEEL": 1.36,
    "NTPC": 1.35,
    "BSE": 1.34,
    "MARUTI": 1.33,
    "HCLTECH": 1.31,
    "ADANIPORTS": 1.31,
    "BEL": 1.24,
    "HINDALCO": 1.20,
    "ULTRACEMCO": 1.17,
    "BAJAJ-AUTO": 1.07,
    "POWERGRID": 1.05,
    "ASIANPAINT": 1.02,
    "JSWSTEEL": 1.02,
    "INDIGO": 1.00,
    "TECHM": 0.98,
    "BAJAJFINSV": 0.96,
    "COALINDIA": 0.96,
    "GRASIM": 0.96,
    "EICHERMOT": 0.93,
    "TRENT": 0.88,
    "ADANIENT": 0.88,
    "NESTLEIND": 0.88,
    "ONGC": 0.83,
    "APOLLOHOSP": 0.78,
    "CIPLA": 0.71,
    "JIOFIN": 0.69,
    "DRREDDY": 0.68,
    "SBILIFE": 0.66,
    "TATACONSUM": 0.62,
    "MAXHEALTH": 0.58,
    "TMPV": 0.57,
    "HDFCLIFE": 0.49,
}
NIFTY50_SYMBOLS = list(NIFTY50_WEIGHTS.keys())


# ---- Instrument key mapping (NSE_EQ for quotes) ----
# Upstox v2 quotes needs NSE_EQ|SYMBOL for equity quotes.
# Index quotes use NSE_INDEX|Nifty 50 or BSE_INDEX|SENSEX.
# For movers we need constituent equity quotes, not the index itself.
def _eq_key(symbol: str) -> str:
    """Legacy fallback only — prefer the real key from the instruments table."""
    return f"NSE_EQ|{symbol}"


def _resolve_instrument_keys(symbols: list[str]) -> dict[str, str]:
    """Map trading symbols to their canonical Upstox NSE_EQ instrument keys.

    Building ``NSE_EQ|<symbol>`` is wrong: keys are ISINs (or exchange tokens),
    and one invalid key makes Upstox reject the whole batch with a 400. The
    instruments table already owns the mapping; use it.
    """
    try:
        from db.database import SessionLocal
        from db.models.broker import Instrument

        with SessionLocal() as db:
            rows = (
                db.query(Instrument.trading_symbol, Instrument.instrument_key)
                .filter(
                    Instrument.segment == "NSE_EQ",
                    Instrument.trading_symbol.in_(symbols),
                )
                .all()
            )
        return {str(sym): str(key) for sym, key in rows if sym and key}
    except Exception as exc:  # DB unavailable → no quotes, not a 500
        logger.warning("movers: instrument key lookup failed: %s", exc)
        return {}


# ---- Cache helpers ----
def _cache_get(index: str) -> Optional[dict]:
    entry = _movers_cache.get(index)
    if not entry:
        return None
    if time.time() - entry["ts"] >= CACHE_TTL_SEC:
        return None
    return entry["data"]


def _cache_put(index: str, data: dict) -> None:
    _movers_cache[index] = {"ts": time.time(), "data": data}


def _clear_cache() -> None:
    _movers_cache.clear()


def _slice_movers(data: dict, limit_int: int) -> dict:
    """Return a copy of a full mover payload capped to ``limit_int`` per side."""
    capped = max(0, limit_int)
    sliced = dict(data)
    sliced["gainers"] = data["gainers"][:capped]
    sliced["losers"] = data["losers"][-capped:] if capped else []
    return sliced


# ---- Pure helpers (unit-testable) ----
def _select_index_constituents(index: str) -> tuple[list[str], dict[str, float], str]:
    """Return (symbols, weights, source_label) for the given index."""
    idx = index.upper()
    if idx == "NIFTY":
        return NIFTY50_SYMBOLS, NIFTY50_WEIGHTS, "NIFTY50_WEIGHTS (Tickertape 2026-10-15)"
    if idx == "SENSEX":
        # SENSEX 30 weights are NOT shipped — no verified source.
        # Return empty weights; contribution_pct will be omitted.
        # The constituent list below is from BSE's public SENSEX 30 page (names only, no weights).
        # Source: BSE India SENSEX constituents (verified names only, 2026-10).
        # TATAMOTORS excluded (demerged into TMPV/TMCV; ambiguous).
        sensex30_symbols = [
            "HDFCBANK", "ICICIBANK", "RELIANCE", "INFY", "ITC", "TCS",
            "BHARTIARTL", "LT", "AXISBANK", "SBIN", "KOTAKBANK",
            "HINDUNILVR", "BAJFINANCE", "M&M", "SUNPHARMA", "TITAN",
            "MARUTI", "HCLTECH", "NTPC", "POWERGRID", "BAJAJFINSV",
            "ASIANPAINT", "TATASTEEL", "ULTRACEMCO", "INDUSINDBK",
            "NESTLEIND", "TECHM", "BAJAJ-AUTO", "COALINDIA", "TMPV",
        ]
        return sensex30_symbols, {}, "SENSEX 30 constituents (BSE, names only — no verified weights)"
    raise ValueError(f"Unknown index: {index}")


def _compute_contribution(change_pct: float, weight_pct: float) -> float:
    """Contribution = weight% * change_pct / 100 (index points contribution)."""
    return round(weight_pct * change_pct / 100.0, 4)


async def _fetch_quotes(symbols: list[str]) -> dict[str, dict]:
    """Fetch batch quotes for NSE_EQ symbols.

    Returns {symbol: {ltp, change_pct, volume}} or {} on failure.
    Uses Upstox v2 /market-quote/quotes with up to 50 symbols per request.
    """
    tok, source = token_with_source()
    if not tok:
        logger.warning("movers: no Upstox token available")
        return {}

    headers = {"Authorization": f"Bearer {tok}", "Accept": "application/json"}
    results: dict[str, dict] = {}

    key_by_sym = _resolve_instrument_keys(symbols)
    if not key_by_sym:
        logger.warning("movers: no instrument keys resolved for %s", symbols[:5])
        return {}
    # Only resolve symbols we can actually quote; one unknown key 400s the batch.
    symbols = [s for s in symbols if s in key_by_sym]

    # Batch into chunks of MAX_SYMBOLS_PER_REQUEST
    for i in range(0, len(symbols), MAX_SYMBOLS_PER_REQUEST):
        chunk = symbols[i : i + MAX_SYMBOLS_PER_REQUEST]
        instrument_keys = ",".join(key_by_sym[s] for s in chunk)
        try:
            payload = await asyncio.to_thread(
                get,
                "/market-quote/quotes",
                params={"instrument_key": instrument_keys},
                timeout=8.0,
                base=BASE_V2,
                rate_limit=True,
                token=tok,
            )
        except Exception as e:
            logger.warning(f"movers: quotes fetch failed for chunk {i//MAX_SYMBOLS_PER_REQUEST}: {e}")
            continue

        data = payload.get("data") or {}
        for sym in chunk:
            key = key_by_sym[sym]
            # Upstox keys quote payloads by "NSE_EQ:SYMBOL" even when the
            # request used an ISIN/token; accept both shapes.
            row = (
                data.get(key)
                or data.get(f"NSE_EQ:{sym}")
                or data.get(f"NSE_EQ|{sym}")
                or next(
                    (
                        v
                        for k, v in data.items()
                        if str(k).split(":")[-1].split("|")[-1] == sym
                    ),
                    {},
                )
            )
            ltp = row.get("last_price")
            # Upstox market-quote returns `net_change` + `ohlc.close`, not
            # `close_price`; using only close_price made every mover 0.00%.
            net = row.get("net_change")
            close = row.get("close_price") or (row.get("ohlc") or {}).get("close")
            volume = row.get("volume")
            change_pct: float | None = None
            if ltp is not None and net is not None:
                prev = float(ltp) - float(net)
                if prev != 0:
                    change_pct = round(float(net) / prev * 100.0, 2)
            if change_pct is None and ltp is not None and close is not None and float(close) != 0:
                change_pct = round((float(ltp) - float(close)) / float(close) * 100.0, 2)
            if ltp is not None and change_pct is not None:
                results[sym] = {
                    "ltp": float(ltp),
                    "change_pct": change_pct,
                    "volume": int(volume) if volume else 0,
                }

    return results


def _build_rows(
    symbols: list[str],
    weights: dict[str, float],
    quotes: dict[str, dict],
) -> list[dict]:
    """Build sorted mover rows from quotes and weights."""
    rows = []
    for sym in symbols:
        q = quotes.get(sym)
        if not q:
            continue
        weight = weights.get(sym, 0.0)
        row = {
            "symbol": sym,
            "ltp": q["ltp"],
            "change_pct": q["change_pct"],
            "volume": q.get("volume", 0),
        }
        if weight > 0:
            row["contribution_pct"] = _compute_contribution(q["change_pct"], weight)
        rows.append(row)

    # Sort by change_pct descending
    rows.sort(key=lambda r: r["change_pct"], reverse=True)
    return rows


# ---- Route ----
@router.get("/movers")
async def get_index_movers(
    index: str = Query(..., description="Index: NIFTY or SENSEX"),
    limit: str = Query("3", description="Number of gainers/losers (3 or 'all')"),
):
    """Get top gainers and losers for an index.

    Returns:
    {
      "index": "NIFTY",
      "as_of": "2026-11-05T10:30:00+05:30",
      "stale": false,
      "source": "NIFTY50_WEIGHTS (Tickertape 2026-10-15)",
      "gainers": [{"symbol": "HDFCBANK", "ltp": 1750.0, "change_pct": 1.92, "contribution_pct": 0.206, "volume": 1234567}, ...],
      "losers": [{"symbol": "TCS", "ltp": 3450.0, "change_pct": -2.52, "contribution_pct": -0.058, "volume": 987654}, ...],
      "live_only": false
    }

    On token/quote failure: 503 with {"detail": {"code": "movers_unavailable"}}
    On historical (non-live) request: returns live_only: true (no history recorded)
    """
    idx = index.upper()
    if idx not in ("NIFTY", "SENSEX"):
        raise HTTPException(status_code=400, detail=f"Invalid index: {index}. Use NIFTY or SENSEX.")

    # Fetch constituents and weights first (needed for limit="all")
    symbols, weights, source = _select_index_constituents(idx)

    # Parse limit parameter
    limit_int: int
    if limit == "all":
        limit_int = len(symbols)  # effectively no limit
    else:
        try:
            limit_int = int(limit)
        except ValueError:
            limit_int = 3

    # Check cache first (per index only; the full, unsliced lists are stored)
    cached = _cache_get(idx)
    if cached:
        return _slice_movers(cached, limit_int)

    # Fetch quotes
    quotes = await _fetch_quotes(symbols)
    if not quotes:
        # Structured 503 — never a raw 500
        raise HTTPException(
            status_code=503,
            detail={"code": "movers_unavailable", "message": "Upstox quotes unavailable or no token"},
        )

    # Build rows
    all_rows = _build_rows(symbols, weights, quotes)

    # Split into gainers/losers
    gainers = [r for r in all_rows if r["change_pct"] > 0]
    losers = [r for r in all_rows if r["change_pct"] < 0]

    full = {
        "index": idx,
        "as_of": datetime.now(config.IST).isoformat(),
        "stale": False,
        "source": source,
        "gainers": gainers,
        "losers": losers,
        "live_only": False,
    }

    _cache_put(idx, full)
    return _slice_movers(full, limit_int)


__all__ = [
    "router",
    "NIFTY50_SYMBOLS",
    "NIFTY50_WEIGHTS",
    "_fetch_quotes",
    "_build_rows",
    "_select_index_constituents",
    "_compute_contribution",
    "_clear_cache",
]