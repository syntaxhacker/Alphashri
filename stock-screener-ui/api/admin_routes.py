"""
Admin API — LLM stats, cache stats, and cache invalidation endpoints.
"""

from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Query, HTTPException, Depends

from api.screener import _sanitize_for_json
from api.auth import get_current_user

router = APIRouter(tags=["admin"])


@router.get("/api/admin/llm-stats")
async def get_llm_stats(
    limit: int = Query(default=100, ge=1, le=1000),
    current_user=Depends(get_current_user)
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    from api.news_routes import _llm_available, article_analyzer

    if not _llm_available or article_analyzer is None:
        raise HTTPException(status_code=503, detail="LLM Analyzer not available")

    try:
        from datetime import datetime
        recent_runs = article_analyzer.get_llm_stats(limit=limit)
        aggregate_stats = article_analyzer.get_llm_aggregate_stats()

        return {
            "recent_runs": recent_runs,
            "aggregate": aggregate_stats,
            "fetched_at": datetime.now().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/admin/cache-stats")
async def get_cache_stats_endpoint(
    current_user=Depends(get_current_user)
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    from cache.redis_client import get_cache_stats
    return get_cache_stats()


@router.post("/api/admin/cache-stats/reset")
async def reset_cache_stats_endpoint(
    current_user=Depends(get_current_user)
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    from cache.redis_client import reset_stats
    reset_stats()
    return {"status": "ok", "message": "Cache stats reset"}


@router.get("/api/admin/cache-keys")
async def get_cache_keys_endpoint(
    prefix: Optional[str] = Query(default=None, description="Filter by key prefix (e.g. backtest, news, screener, chart)"),
    top: int = Query(default=20, ge=1, le=100, description="Number of top keys by memory usage"),
    current_user=Depends(get_current_user)
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    from cache.redis_client import get_cache_keys
    return {"keys": get_cache_keys(prefix=prefix, top=top)}


@router.delete("/api/cache/backtest")
async def invalidate_all_backtest_cache(
    user_id: int = Query(default=1, description="User ID to invalidate cache for"),
    current_user=Depends(get_current_user)
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    from cache.redis_client import invalidate_backtest_cache
    deleted = invalidate_backtest_cache(user_id)
    return {"deleted": deleted, "message": f"Invalidated {deleted} backtest cache entries"}


@router.delete("/api/cache/backtest/{strategy_id}")
async def invalidate_strategy_backtest_cache(
    strategy_id: str,
    user_id: int = Query(default=1, description="User ID to invalidate cache for"),
    current_user=Depends(get_current_user)
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    from cache.redis_client import invalidate_backtest_cache
    deleted = invalidate_backtest_cache(user_id, strategy_id)
    return {"deleted": deleted, "message": f"Invalidated {deleted} backtest cache entries for strategy {strategy_id}"}


@router.delete("/api/cache/news")
async def invalidate_news_cache_endpoint(
    current_user=Depends(get_current_user)
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    from cache.redis_client import invalidate_news_cache
    deleted = invalidate_news_cache()
    return {"deleted": deleted, "message": f"Invalidated {deleted} news cache entries"}


@router.delete("/api/cache/screener")
async def invalidate_screener_cache_endpoint(
    current_user=Depends(get_current_user)
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    from cache.redis_client import invalidate_screener_cache
    deleted = invalidate_screener_cache()
    return {"deleted": deleted, "message": f"Invalidated {deleted} screener cache entries"}
