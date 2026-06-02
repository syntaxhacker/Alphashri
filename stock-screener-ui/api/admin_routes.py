"""
Admin API — LLM stats, cache stats, 52W range batch status, and cache invalidation.
"""

import asyncio
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Query, HTTPException, Depends
from pydantic import BaseModel

from api.screener import _sanitize_for_json
from api.auth import get_current_user

router = APIRouter(tags=["admin"])

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_EXPECTED_NSE_EQ = 2466


def _require_admin(current_user):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")


def _52w_range_db_stats() -> dict:
    from db.database import SessionLocal
    from db.models.stock_52w_touch import Stock52WeekRange
    from sqlalchemy import func

    db = SessionLocal()
    try:
        row_count = db.query(Stock52WeekRange).count()
        latest = db.query(func.max(Stock52WeekRange.updated_at)).scalar()
        return {
            "db_row_count": row_count,
            "db_latest_updated_at": latest.isoformat() if latest else None,
            "expected_universe": _EXPECTED_NSE_EQ,
            "coverage_pct": round(100.0 * row_count / _EXPECTED_NSE_EQ, 1) if _EXPECTED_NSE_EQ else 0,
        }
    finally:
        db.close()


class Run52wRangeRequest(BaseModel):
    skip_existing: bool = True
    redis: bool = True
    limit: int = 0
    full_refresh: bool = False


def clear_52w_range_data(*, clear_db: bool) -> dict:
    """Clear Redis 52W cache; optionally wipe stock_52w_range table for full Upstox rerun."""
    from cache.redis_client import invalidate_52w_range_cache, invalidate_screener_cache
    from trading.week52_job_status import JOB_STATUS_KEY
    from cache.redis_client import cache_delete

    redis_deleted = invalidate_52w_range_cache()
    cache_delete(JOB_STATUS_KEY)

    db_deleted = 0
    if clear_db:
        from db.database import SessionLocal
        from db.models.stock_52w_touch import Stock52WeekRange

        db = SessionLocal()
        try:
            db_deleted = db.query(Stock52WeekRange).count()
            db.query(Stock52WeekRange).delete()
            db.commit()
        finally:
            db.close()

    screener_deleted = invalidate_screener_cache()
    return {
        "redis_keys_deleted": redis_deleted,
        "db_rows_deleted": db_deleted,
        "screener_cache_keys_deleted": screener_deleted,
        "clear_db": clear_db,
    }


@router.get("/api/admin/52w-range-status")
async def get_52w_range_status(current_user=Depends(get_current_user)):
    """52W Upstox batch job progress + DB coverage (admin only)."""
    _require_admin(current_user)
    from trading.week52_job_status import get_job_status

    import os

    job = get_job_status() or {"status": "idle", "message": "No batch job recorded yet"}
    interval = int(os.environ.get("SCREENER_52W_INTERVAL_SEC", "3600"))
    return {
        "job": job,
        "database": _52w_range_db_stats(),
        "fetched_at": datetime.now().isoformat(),
        "schedule": {
            "interval_sec": interval,
            "mode": "incremental",
            "description": (
                f"Auto-runs Upstox batch every {interval // 60} min when idle, "
                "then invalidates screener cache"
            ),
        },
        "run_hint": "python scripts/compute_52w_ranges_upstox.py --redis",
    }


@router.delete("/api/admin/52w-range/cache")
async def delete_52w_range_cache(
    clear_db: bool = Query(
        False,
        description="Also delete all stock_52w_range rows so the next batch processes full EQ universe",
    ),
    current_user=Depends(get_current_user),
):
    """Clear 52W Redis cache; optionally wipe DB for a full refresh."""
    _require_admin(current_user)
    from trading.week52_job_status import get_job_status

    job = get_job_status()
    if job and job.get("status") == "running":
        raise HTTPException(status_code=409, detail="Stop or wait for the running batch first")

    result = await asyncio.to_thread(clear_52w_range_data, clear_db=clear_db)
    return {
        "status": "ok",
        **result,
        "message": (
            "52W DB + Redis cleared; use Run batch with Full refresh for all ~2466 EQ."
            if clear_db
            else "52W Redis cache cleared; DB rows kept (skip-existing still applies)."
        ),
    }


def _run_52w_batch_subprocess(skip_existing: bool, redis: bool, limit: int) -> None:
    script = _PROJECT_ROOT / "scripts" / "compute_52w_ranges_upstox.py"
    cmd = [sys.executable, str(script)]
    if skip_existing:
        cmd.append("--skip-existing")
    if redis:
        cmd.append("--redis")
    if limit > 0:
        cmd.extend(["--limit", str(limit)])
    subprocess.Popen(
        cmd,
        cwd=str(_PROJECT_ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


@router.post("/api/admin/52w-range/run")
async def run_52w_range_batch(
    body: Run52wRangeRequest = Run52wRangeRequest(),
    current_user=Depends(get_current_user),
):
    """Start Upstox 52W range batch in background (admin only)."""
    _require_admin(current_user)
    from trading.week52_job_status import get_job_status

    job = get_job_status()
    if job and job.get("status") == "running":
        raise HTTPException(status_code=409, detail="52W batch job is already running")

    skip_existing = body.skip_existing and not body.full_refresh
    await asyncio.to_thread(
        _run_52w_batch_subprocess,
        skip_existing,
        body.redis,
        body.limit,
    )
    return {
        "status": "started",
        "message": "Batch started in background. Poll GET /api/admin/52w-range-status for progress.",
        "options": body.model_dump(),
    }


@router.get("/api/admin/llm-stats")
async def get_llm_stats(
    limit: int = Query(default=100, ge=1, le=1000),
    current_user=Depends(get_current_user)
):
    _require_admin(current_user)

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
    _require_admin(current_user)

    try:
        from cache.redis_client import get_cache_stats
        return get_cache_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/admin/cache-stats/reset")
async def reset_cache_stats_endpoint(
    current_user=Depends(get_current_user)
):
    _require_admin(current_user)

    try:
        from cache.redis_client import reset_stats
        reset_stats()
        return {"status": "ok", "message": "Cache stats reset"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/admin/cache-keys")
async def get_cache_keys_endpoint(
    prefix: Optional[str] = Query(default=None, description="Filter by key prefix (e.g. backtest, news, screener, chart)"),
    top: int = Query(default=20, ge=1, le=100, description="Number of top keys by memory usage"),
    current_user=Depends(get_current_user)
):
    _require_admin(current_user)

    try:
        from cache.redis_client import get_cache_keys
        return {"keys": get_cache_keys(prefix=prefix, top=top)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/cache/backtest")
async def invalidate_all_backtest_cache(
    user_id: int = Query(default=1, description="User ID to invalidate cache for"),
    current_user=Depends(get_current_user)
):
    _require_admin(current_user)

    try:
        from cache.redis_client import invalidate_backtest_cache
        deleted = invalidate_backtest_cache(user_id)
        return {"deleted": deleted, "message": f"Invalidated {deleted} backtest cache entries"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/cache/backtest/{strategy_id}")
async def invalidate_strategy_backtest_cache(
    strategy_id: str,
    user_id: int = Query(default=1, description="User ID to invalidate cache for"),
    current_user=Depends(get_current_user)
):
    _require_admin(current_user)

    try:
        from cache.redis_client import invalidate_backtest_cache
        deleted = invalidate_backtest_cache(user_id, strategy_id)
        return {"deleted": deleted, "message": f"Invalidated {deleted} backtest cache entries for strategy {strategy_id}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/cache/news")
async def invalidate_news_cache_endpoint(
    current_user=Depends(get_current_user)
):
    _require_admin(current_user)

    try:
        from cache.redis_client import invalidate_news_cache
        deleted = invalidate_news_cache()
        return {"deleted": deleted, "message": f"Invalidated {deleted} news cache entries"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/cache/screener")
async def invalidate_screener_cache_endpoint(
    refresh_52w: bool = Query(
        False,
        description="If true, also start incremental 52W Upstox batch when idle",
    ),
    current_user=Depends(get_current_user),
):
    _require_admin(current_user)

    try:
        from cache.redis_client import invalidate_screener_cache
        deleted = invalidate_screener_cache()
        batch_started = False
        if refresh_52w:
            from trading.week52_job_status import get_job_status

            job = get_job_status()
            if not job or job.get("status") != "running":
                await asyncio.to_thread(_run_52w_batch_subprocess, True, True, 0)
                batch_started = True
        msg = f"Invalidated {deleted} screener cache entries"
        if batch_started:
            msg += "; 52W Upstox batch started"
        return {"deleted": deleted, "batch_started": batch_started, "message": msg}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
