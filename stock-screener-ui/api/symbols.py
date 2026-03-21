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

_instruments_cache: List[Dict] = []
_instruments_loaded = False


def _load_instruments():
    global _instruments_cache, _instruments_loaded

    if _instruments_loaded:
        return _instruments_cache

    try:
        from db.database import SessionLocal
        from db.models import Instrument

        db = SessionLocal()
        instruments = db.query(Instrument).filter(
            Instrument.segment == 'NSE_EQ'
        ).all()
        _instruments_cache = [i.to_dict() for i in instruments]
        _instruments_loaded = True
        print(f"✅ Loaded {len(_instruments_cache)} instruments from database")
        db.close()
        return _instruments_cache
    except Exception as e:
        print(f"⚠️ Failed to load instruments from database: {e}")
        _instruments_cache = []
        _instruments_loaded = True
        return _instruments_cache


@router.get("/api/symbols/search")
async def search_symbols(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(10, ge=1, le=50, description="Max results")
):
    _main = sys.modules.get('api_server_fastapi')
    cache = _main._instruments_cache if _main and hasattr(_main, '_instruments_cache') else _instruments_cache
    instruments = cache if _main and hasattr(_main, '_instruments_loaded') and _main._instruments_loaded else _load_instruments()

    if not instruments:
        return {"results": [], "query": q, "total": 0}

    q = q.strip()
    query_lower = q.lower()

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
            if symbol_lower.startswith(query_lower):
                score = 100
            elif symbol_lower == query_lower:
                score = 95
            elif symbol_match:
                score = 80
            else:
                score = 50

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

    return {"results": results, "query": q, "total": len(results)}


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
