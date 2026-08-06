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


@router.post("/api/admin/llm-stats/reset")
async def reset_llm_stats_endpoint(
    current_user=Depends(get_current_user)
):
    """Clear LLM stats log data (recent runs table). Admin only. Does not clear analysis cache."""
    _require_admin(current_user)

    try:
        from api.news_routes import _llm_available, article_analyzer
        if not _llm_available or article_analyzer is None:
            raise HTTPException(status_code=503, detail="LLM Analyzer not available")

        deleted = article_analyzer.clear_llm_stats()
        return {
            "status": "ok",
            "deleted": deleted,
            "message": f"Cleared {deleted} LLM run log entries",
        }
    except HTTPException:
        raise
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


# ── News Analysis Queue ────────────────────────────────────────────────

_QUEUE_TABLE_CREATED = False


def _ensure_queue_table():
    global _QUEUE_TABLE_CREATED
    if _QUEUE_TABLE_CREATED:
        return
    from sqlalchemy import text
    from db.database import engine as _eng
    with _eng.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS news_analysis_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id INTEGER NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                attempt INTEGER DEFAULT 0,
                error TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (article_id) REFERENCES news_articles(id)
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_news_analysis_queue_status ON news_analysis_queue(status)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_news_analysis_queue_article_id ON news_analysis_queue(article_id)"))
        conn.commit()
    _QUEUE_TABLE_CREATED = True


def _news_queue_stats() -> dict:
    _ensure_queue_table()
    empty = {
        "queue": {"pending": 0, "processing": 0, "done": 0, "failed": 0, "total": 0},
        "needs_analysis": {"broken_summary": 0, "null_analysis": 0},
        "recent_failures": [],
    }
    try:
        from sqlalchemy import text
        from db.database import engine as _eng
        with _eng.connect() as conn:
            status_counts = conn.execute(text("""
                SELECT status, COUNT(*) as cnt FROM news_analysis_queue GROUP BY status
            """)).fetchall()
            recent_failed = []
            try:
                recent_failed = conn.execute(text("""
                    SELECT q.id, q.article_id, COALESCE(a.headline, ''), q.error, q.updated_at
                    FROM news_analysis_queue q
                    LEFT JOIN news_articles a ON a.id = q.article_id
                    WHERE q.status = 'failed'
                    ORDER BY q.updated_at DESC LIMIT 10
                """)).fetchall()
            except Exception:
                recent_failed = conn.execute(text("""
                    SELECT q.id, q.article_id, '', q.error, q.updated_at
                    FROM news_analysis_queue q
                    WHERE q.status = 'failed'
                    ORDER BY q.updated_at DESC LIMIT 10
                """)).fetchall()
            total_broken = 0
            null_with_content = 0
            # news_articles table may not exist yet
            try:
                total_broken = conn.execute(text("""
                    SELECT COUNT(*) FROM news_articles
                    WHERE analysis_json IS NOT NULL
                    AND (analysis_json LIKE '%Failed to analyze%' OR analysis_json LIKE '%Summary unavailable%' OR analysis_json LIKE '%summaries%')
                """)).scalar() or 0
                null_with_content = conn.execute(text("""
                    SELECT COUNT(*) FROM news_articles
                    WHERE analysis_json IS NULL AND content IS NOT NULL AND content != ''
                """)).scalar() or 0
            except Exception:
                pass

        counts = {r[0]: r[1] for r in status_counts}
        return {
            "queue": {
                "pending": counts.get("pending", 0),
                "processing": counts.get("processing", 0),
                "done": counts.get("done", 0),
                "failed": counts.get("failed", 0),
                "total": sum(counts.values()),
            },
            "needs_analysis": {
                "broken_summary": total_broken,
                "null_analysis": null_with_content,
            },
            "recent_failures": [
                {
                    "queue_id": r[0],
                    "article_id": r[1],
                    "headline": (r[2] or "") if len(r) > 2 else "",
                    "error": (r[3] or "") if len(r) > 3 else "",
                    "updated_at": (r[4].isoformat() if r[4] else None) if len(r) > 4 else None,
                }
                for r in recent_failed
            ],
        }
    except Exception:
        return empty


@router.get("/api/admin/news-queue/status")
async def get_news_queue_status(current_user=Depends(get_current_user)):
    _require_admin(current_user)
    try:
        return _news_queue_stats()
    except Exception as e:
        return {
            "queue": {"pending": 0, "processing": 0, "done": 0, "failed": 0, "total": 0},
            "needs_analysis": {"broken_summary": 0, "null_analysis": 0},
            "recent_failures": [],
            "error": str(e),
        }


class NewsQueueEnqueueRequest(BaseModel):
    limit: int = 0
    force: bool = False


@router.post("/api/admin/news-queue/enqueue")
async def enqueue_news_analysis(body: NewsQueueEnqueueRequest, current_user=Depends(get_current_user)):
    _require_admin(current_user)
    _ensure_queue_table()

    from sqlalchemy import text
    from db.database import SessionLocal, engine as _eng
    from db.models.news import NewsArticle
    import json

    with _eng.connect() as conn:
        conn.execute(text("DELETE FROM news_analysis_queue WHERE status = 'pending'"))
        conn.commit()

    db = SessionLocal()
    try:
        query = db.query(NewsArticle).filter(
            NewsArticle.content.isnot(None), NewsArticle.content != ""
        )
        if body.force:
            query = query.filter(
                (NewsArticle.analysis_json.is_(None))
                | (NewsArticle.sentiment.is_(None))
                | (NewsArticle.impact_score.is_(None))
                | (NewsArticle.analysis_json.like('%Failed to analyze%'))
                | (NewsArticle.analysis_json.like('%Summary unavailable%'))
                | (NewsArticle.analysis_json.like('%summaries%'))
            )
        else:
            query = query.filter(
                NewsArticle.analysis_json.is_(None)
                | (NewsArticle.analysis_json.like('%Failed to analyze%'))
                | (NewsArticle.analysis_json.like('%Summary unavailable%'))
                | (NewsArticle.analysis_json.like('%summaries%'))
            )

        query = query.order_by(NewsArticle.fetched_at.asc())
        if body.limit > 0:
            query = query.limit(body.limit)

        articles = query.all()

        with _eng.connect() as conn:
            for a in articles:
                conn.execute(
                    text("INSERT OR IGNORE INTO news_analysis_queue (article_id, status) VALUES (:aid, 'pending')"),
                    {"aid": a.id},
                )
            conn.commit()

        return {"enqueued": len(articles), "limit": body.limit}
    finally:
        db.close()


class NewsQueueProcessRequest(BaseModel):
    max: int = 0


@router.post("/api/admin/news-queue/process")
async def process_news_queue(body: NewsQueueProcessRequest, current_user=Depends(get_current_user)):
    _require_admin(current_user)
    _ensure_queue_table()

    from sqlalchemy import text
    from db.database import engine as _eng
    from llm_analyzer import article_analyzer
    import json

    max_items = body.max if body.max > 0 else 1

    result_data = {"status": "ok", "processed": 0, "failed": 0, "error": None}

    # pick 1 pending item
    with _eng.connect() as conn:
        row = conn.execute(
            text("""
                SELECT q.id, q.article_id, a.headline, a.url, a.content
                FROM news_analysis_queue q
                JOIN news_articles a ON a.id = q.article_id
                WHERE q.status = 'pending'
                ORDER BY q.id ASC
                LIMIT 1
            """),
        ).fetchone()

    if not row:
        return {**result_data, "queue": _news_queue_stats()["queue"], "message": "Queue empty"}

    qid, aid, headline, url, content = row

    try:
        with _eng.connect() as conn:
            conn.execute(
                text("UPDATE news_analysis_queue SET status='processing', updated_at=CURRENT_TIMESTAMP WHERE id=:qid"),
                {"qid": qid},
            )
            conn.commit()

        result = await asyncio.to_thread(article_analyzer.analyze_article, url or "", headline or "", content or "")
        summary = result.get("summary", "")

        if not summary or "Summary unavailable" in summary or "Failed to analyze" in summary:
            raise Exception(summary[:200])

        with _eng.connect() as conn:
            conn.execute(
                text("""
                    UPDATE news_articles
                    SET analysis_json=:aj, sentiment=:s, impact_score=:imp
                    WHERE id=:aid
                """),
                {"aj": json.dumps(result), "s": result.get("sentiment", "NEUTRAL").upper(), "imp": int(result.get("impact_score", 0)), "aid": aid},
            )
            conn.execute(
                text("UPDATE news_analysis_queue SET status='done', attempt=attempt+1, updated_at=CURRENT_TIMESTAMP WHERE id=:qid"),
                {"qid": qid},
            )
            conn.commit()
        from cache.redis_client import invalidate_news_cache
        invalidate_news_cache()
        result_data["processed"] = 1
        result_data["article_id"] = aid
        result_data["headline"] = (headline or "")[:80]
        result_data["summary"] = summary[:120]
        result_data["sentiment"] = result.get("sentiment", "NEUTRAL").upper()
        result_data["impact_score"] = int(result.get("impact_score", 0))
    except Exception as e:
        with _eng.connect() as conn:
            conn.execute(
                text("UPDATE news_analysis_queue SET status='failed', error=:err, attempt=attempt+1, updated_at=CURRENT_TIMESTAMP WHERE id=:qid"),
                {"qid": qid, "err": str(e)[:500]},
            )
            conn.commit()
        result_data["failed"] = 1
        result_data["error"] = str(e)[:200]
        result_data["article_id"] = aid
        result_data["headline"] = (headline or "")[:80]

    result_data["queue"] = _news_queue_stats()["queue"]
    return result_data
