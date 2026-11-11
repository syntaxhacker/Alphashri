"""
Symbols API — symbol search and instrument loading.
"""

import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Query

router = APIRouter(tags=["symbols"])

from db.database import SessionLocal
from db.models import Instrument
from api.tv import get_scanner_data, normalize_tv_symbol, to_tv_ticker

_instruments_cache: List[Dict] = []
_instruments_loaded = False

#: F&O underlyings are re-derived hourly: the fallback source is the 43 MB
#: Upstox instruments file and search runs on every keystroke.
_FNO_CACHE: Dict[str, Any] = {"source": None, "ts": 0.0, "symbols": frozenset()}
_FNO_TTL_SECONDS = 3600


def _load_instruments():
    global _instruments_cache, _instruments_loaded

    if _instruments_loaded:
        return _instruments_cache

    try:
        db = SessionLocal()
        instruments = db.query(Instrument).filter(
            Instrument.segment == 'NSE_EQ'
        ).all()
        _instruments_cache = [i.to_dict() for i in instruments]
        _instruments_loaded = True
        db.close()
        if _instruments_cache:
            print(f"✅ Loaded {len(_instruments_cache)} instruments from database")
        else:
            print("⚠️ Database has 0 NSE_EQ instruments — symbol search will be empty")
        return _instruments_cache
    except Exception as e:
        print(f"⚠️ Failed to load instruments from database: {e}")
        _instruments_loaded = True
        return _instruments_cache


def _instruments_json_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "upstox_trader"
        / "config_and_utils"
        / "nse_instruments.json"
    )


def _fno_symbols_from_records(records) -> set:
    """Equity underlyings that actually have NSE_FO contracts.

    Both CE and PE rows prove F&O membership; index derivatives are excluded
    because they carry ``asset_type == "INDEX"``.
    """
    symbols: set = set()
    for rec in records or []:
        if not isinstance(rec, dict):
            continue
        if rec.get("segment") != "NSE_FO":
            continue
        asset_type = rec.get("asset_type") or rec.get("underlying_type")
        if str(asset_type or "").upper() != "EQUITY":
            continue
        underlying = rec.get("underlying_symbol") or rec.get("asset_symbol")
        underlying = str(underlying or "").strip().upper()
        if underlying:
            symbols.add(underlying)
    return symbols


def _has_fo_records(records) -> bool:
    return any(
        isinstance(rec, dict) and rec.get("segment") == "NSE_FO"
        for rec in records or []
    )


def _load_fno_symbols_from_file() -> set:
    """Parse the shared instruments file (the option-chain endpoints' source)."""
    try:
        with open(_instruments_json_path(), encoding="utf-8") as fh:
            records = json.load(fh)
    except Exception as exc:
        print(f"⚠️ Failed to load F&O instruments: {exc}")
        return set()
    return _fno_symbols_from_records(records)


def _fno_underlyings(instruments) -> frozenset:
    """F&O equity underlyings known to the loaded instrument dataset.

    The NSE_EQ-only cache contains no derivative rows, so in that case the
    canonical instruments file is used. A dataset that *does* carry NSE_FO
    rows but no usable equity contracts yields an empty set — callers must
    return no results rather than fall back to non-F&O stocks.
    """
    now = time.monotonic()
    cached = _FNO_CACHE.get("symbols")
    if (
        _FNO_CACHE.get("source") is instruments
        and cached is not None
        and now - _FNO_CACHE.get("ts", 0.0) < _FNO_TTL_SECONDS
    ):
        return cached

    symbols = _fno_symbols_from_records(instruments)
    if not symbols and not _has_fo_records(instruments):
        symbols = _load_fno_symbols_from_file()

    result = frozenset(symbols)
    _FNO_CACHE.update({"source": instruments, "ts": now, "symbols": result})
    return result


def _current_instruments() -> List[Dict]:
    _main = sys.modules.get('api_server_fastapi')
    cache = _main._instruments_cache if _main and hasattr(_main, '_instruments_cache') else _instruments_cache
    return cache if _main and hasattr(_main, '_instruments_loaded') and _main._instruments_loaded else _load_instruments()


def _search_tv(q: str, limit: int = 10) -> list[dict]:
    """
    Symbol search powered by the tradingview_screener library (Query + col + .like()).

    Uses TV's scanner 'match' operation on the company name field (works well for
    partial searches like "id" -> Vodafone Idea / IDEA, "tata", etc).
    Falls back gracefully on error (returns []).
    For very short queries (len<=2) only returns strong symbol prefix matches
    so that results stay small and relevant ("few results").
    """
    try:
        from tradingview_screener import Query, col
    except Exception:
        return []

    query = (q or "").strip()
    if not query:
        return []
    ql = query.lower()

    try:
        tvq = (
            Query()
            .set_markets("india")
            .select("ticker", "name", "close", "market_cap_basic")
            .where(col("name").like(ql))
            .order_by("market_cap_basic", ascending=False)
            .limit(200)
        )
        _, df = get_scanner_data(tvq)
        if df is None or df.empty:
            return []

        # The tradingview_screener DF is known to sometimes emit the ticker/symbol
        # as the first column (and occasionally with a duplicate 'ticker' label).
        # Use positional iloc for the first two columns for robustness — we don't
        # care about the exact pandas column names/labels.
        if df.empty:
            tickers = []
            names = []
        else:
            tickers = df.iloc[:, 0].astype(str).str.strip().tolist()
            # name is usually labeled 'name' (even when ticker is duplicated).
            # Fall back to iloc[2] (observed layout: ticker_val, ticker_null, name, ...)
            name_col = None
            for c in df.columns:
                if str(c).lower() == "name":
                    name_col = c
                    break
            if name_col is not None:
                names = df[name_col].astype(str).str.strip().tolist()
            else:
                names = (df.iloc[:, 2].astype(str).str.strip().tolist()
                         if df.shape[1] > 2 else tickers)

        out: list[dict] = []
        seen: set[str] = set()
        for full, nm in zip(tickers, names):
            if not full:
                continue
            nm = (nm or "").strip() or full

            # Normalize to bare symbol (NSE:IDEA -> IDEA). Prefer NSE over BSE dups.
            up = full.upper()
            if up.startswith("NSE:"):
                sym = up[4:]
            elif up.startswith("BSE:"):
                sym = up[4:]
            else:
                sym = up

            # Normalize using our shared TV <-> local instrument rule so that
            # 'BAJAJ_AUTO' from TV becomes 'BAJAJ-AUTO' (matching local Instrument),
            # 'NSE:IDEA' becomes 'IDEA', etc. This is the "normalized manner".
            sym = normalize_tv_symbol(sym or full)

            if not sym or sym in seen:
                continue

            sl = sym.lower()
            nl = nm.lower()

            if sl == ql:
                sc = 100
            elif sl.startswith(ql):
                sc = 95
            elif ql in sl:
                sc = 80
            elif nl.startswith(ql):
                sc = 70
            elif ql in nl:
                sc = 50
            else:
                sc = 30

            # For short queries ("id", "ta", etc) keep only the best symbol prefix matches
            # so we return *few* relevant results (e.g. IDEA for Vodafone Idea) instead of
            # every name containing the letters.
            if len(ql) <= 2 and sc < 80:
                continue

            out.append({
                "symbol": sym,
                "name": nm,
                "isin": "",
                "score": sc,
            })
            seen.add(sym)

        out.sort(key=lambda x: (-x.get("score", 0), len(x.get("symbol", ""))))
        out = out[:limit]
        for r in out:
            r.pop("score", None)
        return out
    except Exception as exc:
        print(f"⚠️ _search_tv (tradingview_screener) failed for q={q!r}: {exc}")
        return []


@router.get("/api/symbols/search")
async def search_symbols(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(10, ge=1, le=50, description="Max results"),
    source: str = Query("local", description="Search source: 'local' (DB instruments, default), 'tv' (tradingview_screener lib via Query+col.like), 'auto' (prefer local, fallback to tv)"),
    fno: bool = Query(False, description="Only return underlyings that have NSE_FO equity contracts"),
):
    # FastAPI supplies actual str for source via the Query default when using the router.
    # When calling this function directly from python (tests, scripts) the default value
    # is the Query(...) descriptor object itself — guard against it.
    if not isinstance(source, str):
        source = "local"
    if not isinstance(fno, bool):
        fno = False
    src = (source or "local").lower().strip()
    if src not in ("local", "tv", "auto"):
        src = "local"

    instruments = [] if src == "tv" and not fno else _current_instruments()
    # The file fallback parses ~45 MB; keep it off the event loop on first hit.
    fno_symbols = (
        await asyncio.to_thread(_fno_underlyings, instruments)
        if fno
        else frozenset()
    )

    if src == "tv":
        tv_results = await asyncio.to_thread(_search_tv, q, limit)
        if fno:
            tv_results = [r for r in tv_results if str(r.get("symbol") or "").upper() in fno_symbols]
        qq = (q or "").strip()
        return {"results": tv_results, "query": qq, "total": len(tv_results), "source": "tv"}

    if src == "auto" and (not instruments or len(instruments) == 0):
        tv_results = await asyncio.to_thread(_search_tv, q, limit)
        if fno:
            tv_results = [r for r in tv_results if str(r.get("symbol") or "").upper() in fno_symbols]
        qq = (q or "").strip()
        return {"results": tv_results, "query": qq, "total": len(tv_results), "source": "tv"}

    if not instruments:
        qq = (q or "").strip()
        return {"results": [], "query": qq, "total": 0, "source": "local"}

    qq = (q or "").strip()
    query_lower = qq.lower()

    results = []
    for inst in instruments:
        if inst.get('segment') != 'NSE_EQ':
            continue

        symbol = inst.get('trading_symbol', '') or ''
        name = inst.get('name', '') or ''

        if fno and symbol.upper() not in fno_symbols:
            continue

        symbol_match = query_lower in symbol.lower()
        name_match = query_lower in name.lower()

        if symbol_match or name_match:
            symbol_lower = symbol.lower()
            name_lower = name.lower()
            is_symbol_prefix = symbol_lower.startswith(query_lower)
            if is_symbol_prefix:
                score = 100
            elif symbol_lower == query_lower:
                score = 95
            elif symbol_match:
                score = 80
            elif name_lower.startswith(query_lower):
                score = 75
            else:
                score = 40 if name_match else 30

            # For short queries like "id", "ta", "re" etc. only keep strong *symbol prefix*
            # matches (not arbitrary contains-in-symbol). This makes results "few" and
            # relevant (IDEA first for "id" -> Vodafone Idea etc; drops UNIDT/FIDEL noise).
            if len(query_lower) <= 2 and not is_symbol_prefix:
                continue

            results.append({
                'symbol': symbol,
                'name': name,
                'isin': inst.get('isin', ''),
                'score': score,
            })

    results.sort(key=lambda x: (-x['score'], len(x['symbol'])))
    results = results[:limit]

    for r in results:
        del r['score']

    return {"results": results, "query": qq, "total": len(results), "source": "local"}


@router.get("/api/instruments/debug")
async def debug_instruments():
    from db.database import SessionLocal
    from db.models import Instrument

    def _query():
        db = SessionLocal()
        try:
            total = db.query(Instrument).count()
            nse_eq = db.query(Instrument).filter(Instrument.segment == 'NSE_EQ').count()
            sample = db.query(Instrument).filter(Instrument.segment == 'NSE_EQ').limit(3).all()
            return {
                "total_instruments": total,
                "nse_eq_count": nse_eq,
                "cache_loaded": _instruments_loaded,
                "cache_size": len(_instruments_cache),
                "sample": [s.to_dict() for s in sample]
            }
        finally:
            db.close()

    return await asyncio.to_thread(_query)
