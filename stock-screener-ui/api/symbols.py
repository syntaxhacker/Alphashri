"""
Symbols API — symbol search and instrument loading.
"""

import asyncio
import sys
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Query

router = APIRouter(tags=["symbols"])

from db.database import SessionLocal
from db.models import Instrument
from api.tv import get_scanner_data, normalize_tv_symbol, to_tv_ticker

_instruments_cache: List[Dict] = []
_instruments_loaded = False


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
):
    # FastAPI supplies actual str for source via the Query default when using the router.
    # When calling this function directly from python (tests, scripts) the default value
    # is the Query(...) descriptor object itself — guard against it.
    if not isinstance(source, str):
        source = "local"
    src = (source or "local").lower().strip()
    if src not in ("local", "tv", "auto"):
        src = "local"

    if src == "tv":
        tv_results = await asyncio.to_thread(_search_tv, q, limit)
        qq = (q or "").strip()
        return {"results": tv_results, "query": qq, "total": len(tv_results), "source": "tv"}

    _main = sys.modules.get('api_server_fastapi')
    cache = _main._instruments_cache if _main and hasattr(_main, '_instruments_cache') else _instruments_cache
    instruments = cache if _main and hasattr(_main, '_instruments_loaded') and _main._instruments_loaded else _load_instruments()

    if src == "auto" and (not instruments or len(instruments) == 0):
        tv_results = await asyncio.to_thread(_search_tv, q, limit)
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

        symbol = inst.get('trading_symbol', '')
        name = inst.get('name', '')

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
