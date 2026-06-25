"""
News Charts API
===============

API endpoints for viewing charts from news symbols.
Provides chart data integration between news articles and Upstox historical data.
"""

import asyncio
import json
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List

import config
import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from api.auth import get_current_user
from db.models import User

router = APIRouter(prefix="/api/news", tags=["news-charts"])

UPSTOX_BASE_URL = "https://api.upstox.com/v3"


def get_persistence_service():
    from services.news_persistence import get_persistence_service as _get
    return _get()


def get_mapper():
    from services.news_instrument_mapper import get_mapper as _get
    return _get()


def _sync_fetch_chart(url, headers):
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    return response.json()


def _sync_read_config(config_path):
    with open(config_path, 'r') as f:
        return json.load(f)


def _sync_write_config(config_path, config):
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)


@router.get("/symbols/{symbol}/chart")
async def get_chart_for_symbol(
    symbol: str,
    days: int = Query(default=30, ge=1, le=365, description="Number of days of historical data")
):
    from cache.redis_client import cache_get, cache_set, make_cache_key

    _nc_key = make_cache_key("news", "chart", symbol, days=days)
    _cached = cache_get(_nc_key)
    if _cached is not None:
        return _cached

    mapper = get_mapper()
    mapping = mapper.map_symbol(symbol)
    
    if not mapping.is_mapped:
        raise HTTPException(
            status_code=404,
            detail=f"Symbol '{symbol}' could not be mapped to a valid instrument. "
                   f"Method tried: {mapping.method}"
        )
    
    instrument_key = mapping.instrument_key
    encoded_key = urllib.parse.quote(instrument_key, safe='')
    
    to_date = datetime.now(config.IST).strftime("%Y-%m-%d")
    from_date = (datetime.now(config.IST) - timedelta(days=days)).strftime("%Y-%m-%d")
    
    url = f"{UPSTOX_BASE_URL}/historical-candle/{encoded_key}/days/1/{to_date}/{from_date}"
    
    headers = {'Accept': 'application/json'}
    
    try:
        data = await asyncio.to_thread(_sync_fetch_chart, url, headers)

        if data.get('status') != 'success' or 'data' not in data:
            raise HTTPException(
                status_code=500,
                detail=f"Upstox API error: {data.get('message', 'Unknown error')}"
            )
        
        candles = data['data'].get('candles', [])
        
        persistence = get_persistence_service()
        articles = persistence.get_articles_for_instrument(instrument_key, limit=5)
        
        result = {
            "symbol": symbol,
            "trading_symbol": mapping.trading_symbol,
            "instrument_key": instrument_key,
            "company_name": mapping.company_name,
            "match_confidence": mapping.confidence,
            "match_method": mapping.method,
            "from_date": from_date,
            "to_date": to_date,
            "candles": candles,
            "candle_format": ["datetime", "open", "high", "low", "close", "volume", "oi"],
            "news_count": len(articles),
            "recent_news": articles[:3]
        }
        cache_set(_nc_key, result, ttl=300)
        return result
        
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch chart data: {str(e)}")


@router.get("/symbols/{symbol}/articles")
async def get_articles_for_symbol(
    symbol: str,
    limit: int = Query(default=10, ge=1, le=50),
    offset: int = Query(default=0, ge=0)
):
    from cache.redis_client import cache_get, cache_set, make_cache_key

    _na_key = make_cache_key("news", "articles", symbol, limit=limit, offset=offset)
    _cached = cache_get(_na_key)
    if _cached is not None:
        return _cached

    persistence = get_persistence_service()
    mapper = get_mapper()
    
    mapping = mapper.map_symbol(symbol)
    articles = persistence.get_articles_for_symbol(symbol, limit=limit, offset=offset)
    
    result = {
        "symbol": symbol,
        "trading_symbol": mapping.trading_symbol,
        "instrument_key": mapping.instrument_key,
        "is_mapped": mapping.is_mapped,
        "total": len(articles),
        "articles": articles
    }
    cache_set(_na_key, result, ttl=60)
    return result


@router.get("/instruments/{instrument_key:path}/articles")
async def get_articles_for_instrument(
    instrument_key: str,
    limit: int = Query(default=10, ge=1, le=50),
    offset: int = Query(default=0, ge=0)
):
    from cache.redis_client import cache_get, cache_set, make_cache_key

    _ni_key = make_cache_key("news", "inst_articles", instrument_key, limit=limit, offset=offset)
    _cached = cache_get(_ni_key)
    if _cached is not None:
        return _cached

    persistence = get_persistence_service()
    decoded_key = urllib.parse.unquote(instrument_key)
    
    articles = persistence.get_articles_for_instrument(
        decoded_key, 
        limit=limit, 
        offset=offset
    )
    
    result = {
        "instrument_key": decoded_key,
        "total": len(articles),
        "articles": articles
    }
    cache_set(_ni_key, result, ttl=60)
    return result


@router.get("/articles/{article_id}")
async def get_article_with_symbols(article_id: int):
    """
    Get a specific article with all its symbol mentions,
    including mapped instrument keys for chart viewing.
    """
    persistence = get_persistence_service()
    
    article = persistence.get_article_by_id(article_id)
    
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    
    symbols = persistence.get_symbols_for_article(article_id)
    mapped_symbols = [s for s in symbols if s.get('instrument_key')]
    
    return {
        **article,
        "symbols": symbols,
        "mapped_symbols": mapped_symbols,
        "chartable_count": len(mapped_symbols)
    }


@router.get("/articles/{article_id}/symbols")
async def get_article_symbols(article_id: int):
    """
    Get all symbols mentioned in an article with instrument mappings.
    """
    persistence = get_persistence_service()
    
    article = persistence.get_article_by_id(article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    
    symbols = persistence.get_symbols_for_article(article_id)
    
    return {
        "article_id": article_id,
        "headline": article.get("headline"),
        "symbols": symbols,
        "total": len(symbols),
        "mapped": len([s for s in symbols if s.get('instrument_key')])
    }


@router.get("/recent")
async def get_recent_articles(
    hours: int = Query(default=24, ge=1, le=168),
    source: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=100)
):
    """
    Get recent news articles from the database.
    """
    from cache.redis_client import cache_get, cache_set, is_cache_available
    from sqlalchemy import text
    from db.database import engine as _eng

    cache_key = f"news:recent:{hours}:{source or 'all'}:{limit}"
    cached = cache_get(cache_key) if is_cache_available() else None
    if cached is not None:
        return cached

    persistence = get_persistence_service()
    
    articles = persistence.get_recent_articles(
        hours=hours,
        source=source,
        limit=limit
    )
    
    # enrich with queue status
    with _eng.connect() as conn:
        queue_statuses = {
            r[0]: r[1]
            for r in conn.execute(text(
                "SELECT article_id, status FROM news_analysis_queue WHERE status IN ('pending', 'processing')"
            )).fetchall()
        }

    for a in articles:
        qs = queue_statuses.get(a["id"])
        if qs:
            a["analysis_status"] = qs
    
    result = {
        "hours": hours,
        "source": source,
        "total": len(articles),
        "articles": articles
    }

    if is_cache_available():
        cache_set(cache_key, result, ttl=60)

    return result


@router.get("/search")
async def search_articles(
    q: str = Query(..., min_length=2, description="Search query"),
    limit: int = Query(default=20, ge=1, le=50)
):
    """
    Search news articles by headline or content.
    """
    persistence = get_persistence_service()
    
    articles = persistence.search_articles(query=q, limit=limit)
    
    return {
        "query": q,
        "total": len(articles),
        "articles": articles
    }


@router.get("/stats")
async def get_news_stats():
    """
    Get statistics about stored news articles and symbol mappings.
    """
    persistence = get_persistence_service()
    
    return persistence.get_article_stats()


@router.get("/map/{symbol}")
async def map_symbol_to_instrument(symbol: str):
    """
    Test endpoint to see how a symbol maps to an instrument.
    Useful for debugging symbol matching.
    """
    mapper = get_mapper()
    mapping = mapper.map_symbol(symbol)
    
    return mapping.to_dict()


@router.get("/mappings")
async def get_manual_mappings():
    """
    Get all manual symbol mappings.
    """
    mapper = get_mapper()
    return {
        "mappings": mapper.manual_mappings,
        "blacklist": list(mapper.blacklist),
        "total": len(mapper.manual_mappings)
    }


@router.post("/mappings")
async def add_manual_mapping(
    code: str = Query(..., description="Source symbol code (e.g., TM03)"),
    trading_symbol: str = Query(..., description="NSE trading symbol (e.g., TATAMOTORS)"),
    user: User = Depends(get_current_user),
):
    """
    Add or update a manual symbol mapping.
    """
    mapper = get_mapper()
    
    config_path = Path(__file__).parent.parent / 'config' / 'symbol_mappings.json'
    
    try:
        config = await asyncio.to_thread(_sync_read_config, config_path)
        
        config['mappings'][code.upper()] = trading_symbol.upper()
        
        await asyncio.to_thread(_sync_write_config, config_path, config)
        
        mapper.manual_mappings[code.upper()] = trading_symbol.upper()
        
        return {
            "success": True,
            "code": code.upper(),
            "trading_symbol": trading_symbol.upper(),
            "message": f"Mapping added: {code} -> {trading_symbol}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save mapping: {e}")


@router.delete("/mappings/{code}")
async def remove_manual_mapping(code: str, user: User = Depends(get_current_user)):
    """
    Remove a manual symbol mapping.
    """
    mapper = get_mapper()
    code = code.upper()
    
    if code not in mapper.manual_mappings:
        raise HTTPException(status_code=404, detail=f"Mapping for '{code}' not found")
    
    config_path = Path(__file__).parent.parent / 'config' / 'symbol_mappings.json'
    
    try:
        config = await asyncio.to_thread(_sync_read_config, config_path)
        
        del config['mappings'][code]
        
        await asyncio.to_thread(_sync_write_config, config_path, config)
        
        del mapper.manual_mappings[code]
        
        return {
            "success": True,
            "code": code,
            "message": f"Mapping removed for {code}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to remove mapping: {e}")


@router.post("/mappings/blacklist/{code}")
async def add_to_blacklist(code: str, user: User = Depends(get_current_user)):
    """
    Add a symbol to the blacklist (will not be mapped).
    """
    mapper = get_mapper()
    code = code.upper()
    
    config_path = Path(__file__).parent.parent / 'config' / 'symbol_mappings.json'
    
    try:
        config = await asyncio.to_thread(_sync_read_config, config_path)
        
        if code not in config['blacklist']:
            config['blacklist'].append(code)
        
        await asyncio.to_thread(_sync_write_config, config_path, config)
        
        mapper.blacklist.add(code)
        
        return {
            "success": True,
            "code": code,
            "message": f"Added {code} to blacklist"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add to blacklist: {e}")
