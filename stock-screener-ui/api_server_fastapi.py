#!/usr/bin/env python3
"""
FastAPI server for Alphashri with auto-reload.
Serves screener data and backtest API as JSON.

Run with: uvicorn api_server_fastapi:app --reload --port 8765
"""
import sys
import os
from pathlib import Path as PathlibPath
from contextlib import asynccontextmanager
from datetime import datetime
import asyncio

_script_dir = PathlibPath(__file__).parent.absolute()
_project_root = _script_dir.parent
_scanners_dir = _project_root / 'scanners'
sys.path.insert(0, str(_project_root))
sys.path.insert(0, str(_scanners_dir))
sys.path.insert(0, str(_script_dir))

import config


def _ci_mode() -> bool:
    """True when running in CI/E2E: skip heavy optional startup (news, redis, background jobs)."""
    return os.getenv("CI_MODE", "").lower() in ("1", "true", "yes")


from fastapi import FastAPI, Query, Depends, HTTPException
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.middleware.gzip import DEFAULT_EXCLUDED_CONTENT_TYPES, GZipMiddleware
from starlette.requests import Request
from starlette.responses import Response
import uvicorn

import trending_upside

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

from api.screener import (
    fetch_screener_data, _sanitize_for_json, PROFILE_META,
    PROFILES_WITH_52W_BUCKETS, _profile_meta, _passes_profile_filters,
    _build_rationale, _to_float,
)
from api.screener_api.screener_scan import _enrich_with_touch_history
from db.database import SessionLocal
from db.models import Stock52WeekTouch, Screener
from db.models.user import User
from api.auth import get_current_user
from api.symbols import _load_instruments, _instruments_cache, _instruments_loaded
from api.news_routes import (
    news_poller_task, news_startup_prefetch,
    news_ws_manager, sector_ws_manager,
)
from api.news.news_poller import _init_news_modules
from api.bots_api.bot_operations import bot_auto_recovery_task
from api.orderflow_recorder import recorder_task

_news_available = False
_llm_available = False
fetch_news = None
fetch_article_content = None
NEWS_SOURCES = []
article_analyzer = None

if _ci_mode():
    print("⚙️ CI_MODE enabled — skipping news module init")
else:
    _news_available, _llm_available, article_analyzer, fetch_news, fetch_article_content, NEWS_SOURCES = _init_news_modules()


PREWARM_SCREENERS = ["trending", "buyer_interest", "high_momentum", "nifty_movers", "52w_high", "price_surge"]
PREWARM_INTERVAL = 60


async def screener_prewarm_task():
    while True:
        try:
            if _is_market_hours():
                from cache.redis_client import make_cache_key, cache_ttl, stale_while_revalidate
                for screener_id in PREWARM_SCREENERS:
                    cache_key = make_cache_key("screener", "upstox", "intraday", screener_id)
                    ttl = cache_ttl(cache_key)
                    if ttl is None or ttl < PREWARM_INTERVAL:
                        try:
                            await stale_while_revalidate(
                                cache_key,
                                lambda s=screener_id: _compute_screener("upstox", "intraday", s, {}),
                                fresh_ttl=300,
                            )
                        except Exception:
                            pass
            await asyncio.sleep(PREWARM_INTERVAL)
        except asyncio.CancelledError:
            break
        except Exception:
            await asyncio.sleep(PREWARM_INTERVAL)


def _is_market_hours() -> bool:
    """Returns True during Indian equity market hours (09:15-15:30 IST on trading days, excluding weekends/holidays).
    Delegates to the canonical trading.utils.is_market_open (respects MARKET_OPEN/MARKET_CLOSE + holiday calendar).
    Used to gate background 52W range batches, screener cache invalidations, and prewarms.
    """
    try:
        from trading.utils import is_market_open
        return is_market_open()
    except Exception:
        # Fallback (e.g. partial import env) — approximate window only
        hour = datetime.now(config.IST).hour
        return 8 <= hour <= 16


_52W_RANGE_CACHE_TTL = 600


def _sanitize_52w_range_entry(info) -> dict | None:
    """Return {high, low, close} floats or None if any value is missing/non-finite."""
    import math
    if not isinstance(info, dict):
        return None
    out = {}
    for key in ("high", "low", "close"):
        val = info.get(key)
        if val is None:
            return None
        try:
            fval = float(val)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(fval):
            return None
        out[key] = fval
    days = info.get("days_ago")
    if days is not None:
        try:
            out["days_ago"] = max(0, int(days))
        except (TypeError, ValueError):
            pass
    return out


def _sanitize_52w_ranges_bulk(data: dict) -> dict:
    if not isinstance(data, dict):
        return {}
    return {
        symbol: entry
        for symbol, info in data.items()
        if (entry := _sanitize_52w_range_entry(info)) is not None
    }


def _store_52w_ranges_in_redis(data: dict):
    """Store 52W ranges per-symbol and as bulk JSON in Redis."""
    from cache.redis_client import cache_set
    clean = _sanitize_52w_ranges_bulk(data)
    for symbol, info in clean.items():
        cache_set(f"52w_range:{symbol}", info, ttl=_52W_RANGE_CACHE_TTL)
    cache_set("52w_range:all", clean, ttl=_52W_RANGE_CACHE_TTL)

    # Also clear the paper trading 52W file cache
    import shutil
    from pathlib import Path
    paper_cache_dir = Path(__file__).parent / "experiments" / "data" / "52w_cache"
    if paper_cache_dir.exists():
        shutil.rmtree(paper_cache_dir)
        paper_cache_dir.mkdir(parents=True, exist_ok=True)


def _load_52w_ranges_from_redis() -> dict:
    """Load 52W ranges from Redis (bulk key) or return empty dict."""
    from cache.redis_client import cache_get
    data = cache_get("52w_range:all")
    return data if isinstance(data, dict) else {}


def _persist_52w_ranges_to_db(data: dict):
    """Upsert 52W ranges into DB. Bulk replace for simplicity (~4000 rows)."""
    from db.database import SessionLocal
    from db.models.stock_52w_touch import Stock52WeekRange

    db = SessionLocal()
    try:
        existing = {r.symbol: r for r in db.query(Stock52WeekRange).all()}
        to_add = []
        now = datetime.now(config.IST).replace(tzinfo=None)
        for symbol, info in data.items():
            cur = existing.get(symbol)
            if cur:
                # Always bump updated_at on refresh so max(updated_at) reflects last
                # successful range computation/verification time for the most recent symbol.
                cur.high_52w = info['high']
                cur.low_52w = info['low']
                cur.close = info['close']
                cur.updated_at = now
            else:
                to_add.append(Stock52WeekRange(
                    symbol=symbol, high_52w=info['high'],
                    low_52w=info['low'], close=info['close'],
                    updated_at=now,
                ))
        if to_add:
            db.add_all(to_add)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def is_52w_batch_stale(job: dict | None) -> bool:
    """True when the scheduler should treat a 'running' 52W job as stuck.

    Pure check over the job dict (no Redis) — delegates to
    trading.week52_job_status.is_job_stale with the SCREENER_52W_STALE_SEC threshold.
    """
    try:
        from trading.week52_job_status import is_job_stale

        return is_job_stale(job)
    except Exception:
        return False


async def compute_52w_ranges_task():
    """Hourly Upstox 52W batch (daily staleness refresh) + screener cache invalidation when complete.
    Symbols already refreshed today are skipped, so the first run each day updates the full
    universe (~5 min) and later hourly runs no-op in ~1s. The batch + invalidation only
    actually run during market hours (see _is_market_hours).
    On startup we do a prompt initial run (short delay) if in market hours so that
    "just ran start.sh and data is stale" results in an observable batch quickly
    instead of waiting the full interval.
    """
    import os
    from trading.week52_job_status import get_job_status, fail_job, job_age_sec

    interval = int(os.environ.get("SCREENER_52W_INTERVAL_SEC", "3600"))
    poll_sec = 30
    max_wait = int(os.environ.get("SCREENER_52W_MAX_WAIT_SEC", "7200"))

    first = True
    while True:
        try:
            if first:
                # Prompt startup run when market is open (addresses stale data on `start.sh`).
                # Subsequent cycles use the normal interval.
                await asyncio.sleep(5)
                first = False
            else:
                await asyncio.sleep(interval)

            if not _is_market_hours():
                # Only perform 52W batch + cache flush during market hours
                # (consistent with prewarm behavior for other screeners).
                continue

            job = get_job_status() or {}
            if job.get("status") == "running":
                if is_52w_batch_stale(job):
                    age = job_age_sec(job)
                    age_str = f"{age:.0f}s" if age is not None else "unknown age"
                    print(f"[52W Range] Stale running job detected (age={age_str}) — resetting and starting fresh batch")
                    try:
                        fail_job("stale — reset by scheduler")
                    except Exception as e:
                        print(f"[52W Range] Stale reset failed: {e}")
                else:
                    print("[52W Range] Scheduled run skipped — batch already running")
                    continue

            from api.admin_routes import _run_52w_batch_subprocess

            print(f"[52W Range] Starting scheduled daily-staleness batch (every {interval}s)")
            await asyncio.to_thread(_run_52w_batch_subprocess, False, True, 0, True)

            waited = 0
            while waited < max_wait:
                await asyncio.sleep(poll_sec)
                waited += poll_sec
                job = get_job_status() or {}
                st = job.get("status")
                if st in ("completed", "failed", None, "idle"):
                    break

            from cache.redis_client import invalidate_screener_cache

            n = invalidate_screener_cache()
            print(f"[52W Range] Scheduled batch done (status={job.get('status')}); screener cache keys cleared: {n}")

            # Also clear the paper trading 52W file cache
            import shutil
            from pathlib import Path
            paper_cache_dir = Path(__file__).parent / "experiments" / "data" / "52w_cache"
            if paper_cache_dir.exists():
                shutil.rmtree(paper_cache_dir)
                paper_cache_dir.mkdir(parents=True, exist_ok=True)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[52W Range] Scheduled task error: {e}")
            await asyncio.sleep(300)


async def chart_patterns_bootstrap_task():
    """Chart-patterns background bootstrap (CONTRACT.md §5).

    Rehydrates active jobs on startup; during market hours, when no job is
    active, submits a default ``nifty500`` / ``1D`` scan. Repeats every
    ``PATTERN_SCAN_INTERVAL_SEC`` (default 900).
    """
    import os

    interval = int(os.environ.get("PATTERN_SCAN_INTERVAL_SEC", "900"))

    # Rehydrate queued/running jobs left over from a previous process.
    try:
        from chart_patterns import jobs as _cp_jobs

        n = await asyncio.to_thread(_cp_jobs.rehydrate)
        if n:
            print(f"[Patterns] Rehydrated {n} active job(s)")
    except Exception as e:
        print(f"[Patterns] Rehydrate failed: {e}")

    first = True
    while True:
        try:
            if first:
                await asyncio.sleep(5)
                first = False
            else:
                await asyncio.sleep(interval)

            if not _is_market_hours():
                continue

            from chart_patterns import jobs as _cp_jobs

            if _cp_jobs.list_active():
                continue
            try:
                dto = _cp_jobs.submit(
                    "nifty500", "1D", requested_by=None, params={"bootstrap": True}
                )
                print(f"[Patterns] Bootstrap scan queued: {dto['job_id']}")
            except _cp_jobs.QueueFullError:
                pass
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[Patterns] Bootstrap task error: {e}")
            await asyncio.sleep(60)


async def run_watch_snapshot_once() -> int:
    """One breakout-watch snapshot refresh, off the event loop.

    Returns the number of combos built (0 on failure). Never raises — the
    background task and tests share this seam.
    """
    try:
        from chart_patterns import watch as _watch

        return await asyncio.to_thread(_watch.refresh_snapshot)
    except Exception as e:
        print(f"[Watch] Snapshot refresh failed: {e}")
        return 0


async def watch_snapshot_task():
    """Precompute breakout-watch snapshots so ``GET /watch`` stays instant.

    ``watch.live()`` fans out per symbol (LTP → tape, TV metrics, vol_adj),
    which takes ~50s for 20 rows under market-hours contention when run
    inside the request. This task rebuilds the in-memory (+ Redis-mirrored)
    snapshot shortly after startup, then every
    ``WATCH_SNAPSHOT_INTERVAL_SEC`` (default 60) — gated to market hours via
    :func:`_is_market_hours`, off the event loop, and never blocking startup.
    """
    import os

    interval = int(os.environ.get("WATCH_SNAPSHOT_INTERVAL_SEC", "60"))

    first = True
    while True:
        try:
            if first:
                await asyncio.sleep(5)
                first = False
            else:
                await asyncio.sleep(interval)

            if not _is_market_hours():
                continue

            n = await run_watch_snapshot_once()
            print(f"[Watch] Snapshot refreshed ({n} combos)")
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[Watch] Snapshot task error: {e}")
            await asyncio.sleep(60)


async def market_snapshot_prewarm_task():
    """Keep ``all_equity`` market snapshot warm.

    Prompt first run shortly after startup, then every
    ``MARKET_SCREEN_PREWARM_INTERVAL_SEC`` (default 60s), gated to market
    hours. The TV scan runs off the event loop and never blocks the lifespan
    or any request.
    """
    import os

    interval = int(os.environ.get("MARKET_SCREEN_PREWARM_INTERVAL_SEC", "60"))
    first = True
    while True:
        try:
            if first:
                await asyncio.sleep(2)
                first = False
            else:
                await asyncio.sleep(interval)
            if not _is_market_hours():
                continue
            from api.market_screen.snapshot import (
                MAX_LIMIT as _snapshot_max_limit,
                build_snapshot,
            )
            await asyncio.to_thread(build_snapshot, "all_equity", _snapshot_max_limit, False)
            print("[Market Snapshot] all_equity prewarm complete")
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[Market Snapshot] prewarm error: {e}")
            await asyncio.sleep(30)


async def touch_recorder_task():
    """Persist daily 52W touches once per day after market close.

    Corroborates bar-based approach_type with the touch log
    (scripts/record_52w_touches.py). Disable with TOUCH_RECORDER_ENABLED=0.
    """
    import os

    if _ci_mode() or os.getenv("TOUCH_RECORDER_ENABLED", "1").lower() in ("0", "false", "no"):
        return

    import config as _config
    from datetime import datetime as _datetime

    last_run = None
    while True:
        try:
            now = _datetime.now(_config.IST)
            if now.hour >= 16 and last_run != now.date():
                from scripts.record_52w_touches import record_touches_for_all_screeners
                await asyncio.to_thread(record_touches_for_all_screeners)
                last_run = now.date()
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"⚠️ Touch recorder failed: {e}")
        try:
            await asyncio.sleep(1800)
        except asyncio.CancelledError:
            break


async def db_backup_task():
    """Daily local SQLite backup with retention (see scripts/backup_db.py).

    Creates one timestamped backup per calendar day (skip_if_today), then
    re-checks periodically so a long-running process rolls over to the next
    day. Retention prunes old copies. Disable with DB_BACKUP_ENABLED=0.
    """
    import os

    if _ci_mode() or os.getenv("DB_BACKUP_ENABLED", "1").lower() in ("0", "false", "no"):
        return

    from scripts.backup_db import run_backup

    interval = int(os.getenv("DB_BACKUP_INTERVAL_SEC", str(6 * 3600)))
    while True:
        try:
            await asyncio.to_thread(run_backup, skip_if_today=True)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"⚠️ DB backup failed: {e}")
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            break


def _compute_screener(provider, mode, screener, profile_filters):
    screener_id = screener.replace('builtin:', '') if screener.startswith('builtin:') else screener
    data = fetch_screener_data(provider, mode, screener, profile_filters)
    data['applied_profile_filters'] = profile_filters

    # 52w_high already enriches touch history inside fetch_52w_high_data
    if screener_id != '52w_high':
        _enrich_with_touch_history(data, screener)

    return _sanitize_for_json(data)


def _spawn_task(label: str, factory, *, started: str = "🔄 {label} started", failed: str = "⚠️ {label} failed: {e}"):
    """Create a background task; return None on failure (matches existing fail-soft startup)."""
    try:
        task = asyncio.create_task(factory())
        print(started.format(label=label))
        return task
    except Exception as e:
        print(failed.format(label=label, e=e))
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f'🚀 Alphashri API starting...')
    prewarm = None
    _52w_task = None
    news_poller = None
    _prefetch_task = None
    _recovery_task = None
    _db_backup_task = None
    _orderflow_recorder_task = None
    _patterns_task = None
    _watch_task = None
    _dashboard_task = None
    _digest_task = None
    _touch_task = None
    _nifty_tape_task = None
    _nifty_snapshot_task = None
    _chain10s_task = None
    _us_tape_task = None
    _nifty_stream_task = None
    _nifty_oi_task = None
    _nifty_spot_task = None
    _nifty_md_task = None
    _market_snapshot_task = None
    ci = _ci_mode()
    redis_connected = False
    try:
        from db.database import init_db
        init_db()
        print("✅ Database initialized")

        try:
            from trading.holidays_seed import seed_missing_holidays

            _added_holidays = seed_missing_holidays()
            if _added_holidays:
                print(f"✅ Seeded {_added_holidays} missing market holiday(s)")
        except Exception as e:
            print(f"⚠️ Holiday seeding skipped: {e}")

        if ci:
            print("⚙️ CI_MODE enabled — skipping Redis and background tasks")
            try:
                import db.models  # noqa: F401 — register all models on Base.metadata
                from db.database import Base as _BaseAll, engine as _engine_all
                _BaseAll.metadata.create_all(bind=_engine_all)
                print("✅ CI mode: database schema created")
            except Exception as e:
                print(f"⚠️ CI mode: schema creation failed: {e}")
        else:
            from cache.redis_client import get_redis_client, is_cache_available, _load_stats_from_redis
            get_redis_client()
            if is_cache_available():
                _load_stats_from_redis()
                redis_connected = True
                print("✅ Redis cache connected")
            else:
                print("⚠️ Redis unavailable — caching disabled")
        _load_instruments()
        import traceback
        try:
            # Auto-create price_surge_events table (may not exist yet on fresh databases)
            from db.database import engine as _engine, Base as _Base
            from db.models.price_surge import PriceSurgeEvent
            _Base.metadata.create_all(bind=_engine, tables=[PriceSurgeEvent.__table__])
        except Exception:
            pass
        if not ci:
            try:
                news_poller = asyncio.create_task(news_poller_task())
                print("📰 News poller started")
            except Exception as e:
                print(f"⚠️ News poller failed: {e} {traceback.format_exc()}")
            _prefetch_task = _spawn_task("News prefetch", news_startup_prefetch, started="📰 News prefetch scheduled")
            prewarm = _spawn_task("Screener pre-warm", screener_prewarm_task, started="🔄 Screener pre-warm started", failed="⚠️ Screener prewarm failed: {e}")

            _52w_task = _spawn_task("52W Range", compute_52w_ranges_task, started="📊 52W Range background task started", failed="⚠️ 52W Range task failed: {e}")

            _recovery_task = _spawn_task("Bot auto-recovery", bot_auto_recovery_task, started="🔄 Bot auto-recovery task started", failed="⚠️ Bot auto-recovery task failed: {e}")

            _db_backup_task = _spawn_task("DB backup", db_backup_task, started="💾 DB backup task started", failed="⚠️ DB backup task failed: {e}")

            _orderflow_recorder_task = _spawn_task("Order-flow recorder", recorder_task, started="🎙️ Order-flow recorder task started", failed="⚠️ Order-flow recorder task failed: {e}")

            _patterns_task = _spawn_task("Chart-patterns", chart_patterns_bootstrap_task, started="📐 Chart-patterns background task started", failed="⚠️ Chart-patterns task failed: {e}")

            _watch_task = _spawn_task("Watch snapshot", watch_snapshot_task, started="👀 Watch snapshot background task started", failed="⚠️ Watch snapshot task failed: {e}")

            from api.screener_api.dashboard import dashboard_prewarm_task
            _dashboard_task = _spawn_task("Screener dashboard prewarm", dashboard_prewarm_task, started="📊 Screener dashboard prewarm task started", failed="⚠️ Screener dashboard prewarm failed: {e}")
            _market_snapshot_task = _spawn_task("Market snapshot prewarm", market_snapshot_prewarm_task, started="📸 Market snapshot prewarm started", failed="⚠️ Market snapshot prewarm failed: {e}")

            try:
                from api.reports_api.digest import report_digest_task
                _digest_task = asyncio.create_task(report_digest_task())
                print("📨 EOD report digest task started")
            except Exception as e:
                print(f"⚠️ EOD report digest task failed: {e}")
                _digest_task = None
                _touch_task = asyncio.create_task(touch_recorder_task())
                print("👆 52W touch recorder started")
            except Exception as e:
                print(f"⚠️ Touch recorder failed: {e}")
                _touch_task = None

            from api.reports_api.nifty import start_nifty_tape_task
            _nifty_tape_task = _spawn_task("Nifty OI tape", start_nifty_tape_task, started="📼 Nifty OI tape task started", failed="⚠️ Nifty tape task failed: {e}")

            from api.reports_api.nifty import nifty_snapshot_task, SNAPSHOT_REFRESH_SEC
            _nifty_snapshot_task = _spawn_task("Nifty snapshot refresh", nifty_snapshot_task, started=f"📸 Nifty snapshot refresh task started ({SNAPSHOT_REFRESH_SEC:.0f}s)", failed="⚠️ Nifty snapshot refresh failed: {e}")

            from api.reports_api.options_recorder import start_options_recorder_task
            _options_recorder_task = _spawn_task("Options recorder (SENSEX/RELIANCE)", start_options_recorder_task, started="📼 Options recorder (SENSEX/RELIANCE) started", failed="⚠️ Options recorder failed: {e}")

            try:
                from api.reports_api.chain10s import start_chain10s_task
                _chain10s_task = start_chain10s_task()
                print("⏱️ 10s chain snapshots task started" if _chain10s_task else "⏱️ 10s chain snapshots disabled")
            except Exception as e:
                print(f"⚠️ 10s chain task failed: {e}")

            try:
                from api.reports_api.ticks import start_tick_tape_task
                _tick_tape_task = start_tick_tape_task()
                print("⏱️ 1s spot tick tape task started" if _tick_tape_task else "⏱️ 1s spot tick tape disabled")
            except Exception as e:
                print(f"⚠️ 1s tick tape task failed: {e}")
            try:
                from api.reports_api.us_tape import start_us_tape_task
                _us_tape_task = start_us_tape_task()
                print("📼 US futures tape task started (NQ)")
            except Exception as e:
                print(f"⚠️ US tape task failed: {e}")
                _us_tape_task = None
            from api.reports_api.nifty_stream import nifty_burst_watch_task
            _nifty_stream_task = _spawn_task("Nifty burst stream watcher", nifty_burst_watch_task, started="📡 Nifty burst stream watcher started", failed="⚠️ Nifty burst stream watcher failed: {e}")
            try:
                from api.reports_api.nifty_ws import start_nifty_spot_tick_task
                _nifty_spot_task = start_nifty_spot_tick_task()
                print("📍 Nifty spot tick task started")
            except Exception as e:
                print(f"⚠️ Nifty spot tick task failed: {e}")
                _nifty_spot_task = None
            try:
                # Upstox Market-Data WS. OFF by default: from most networks the
                # WS upgrade is Cloudflare-1010 blocked, and the official 302
                # upgrade-redirect can't be followed by websockets /
                # websocket-client / curl_cffi (they 403 on the WAF or refuse
                # the 302). REST (httpx) is unaffected, so the report falls back
                # to it. Enable with NIFTY_MD_WS=1 on a network where the feed
                # is reachable.
                import os as _os
                if _os.getenv("NIFTY_MD_WS", "").lower() in ("1", "true", "yes"):
                    from api.reports_api.nifty_md import start_nifty_md_task
                    _maybe_task = start_nifty_md_task()
                    if asyncio.iscoroutine(_maybe_task):
                        _maybe_task = asyncio.create_task(_maybe_task)
                    _nifty_md_task = _maybe_task
                    print("🔌 Nifty MD WS task started")
                else:
                    _nifty_md_task = None
                    print("🔌 Nifty MD WS disabled (NIFTY_MD_WS=1 to enable; Cloudflare-blocked on most networks)")
            except Exception as e:
                print(f"⚠️ Nifty MD task failed: {e}")
                _nifty_md_task = None
            try:
                # P1: live OI over the WebSocket. OFF unless NIFTY_OI_STREAM=1,
                # and shadow-logged by default — an unvalidated live feed must
                # not enable itself on a trading morning.
                from api.reports_api.nifty_oi_stream import ENABLED as _oi_enabled
                from api.reports_api.nifty_oi_stream import nifty_oi_stream_task

                if _oi_enabled:
                    _nifty_oi_task = asyncio.create_task(nifty_oi_stream_task())
                    print("🔌 Nifty OI websocket stream started")
                else:
                    _nifty_oi_task = None
                    print("🔌 Nifty OI websocket stream disabled (NIFTY_OI_STREAM=1 to enable)")
            except Exception as e:
                print(f"⚠️ Nifty OI stream failed: {e}")
                _nifty_oi_task = None

            # --- Event Radar ---
            from api.event_radar.poller import event_radar_poller
            _event_radar_task = _spawn_task("Event radar poller", event_radar_poller, started="📅 Event radar poller started (calendar + tripwire)")
    except Exception as e:
        import traceback
        print(f"❌ Startup failed: {e}")
        print(traceback.format_exc())
        _52w_task = None
    # Scrub credential-adjacent values from broker/transport error logs. Called
    # here (not at import) because uvicorn configures its handlers first.
    try:
        from api.orderflow_logging import install_error_redaction

        install_error_redaction()
    except Exception as e:
        print(f"⚠️ Log redaction not installed: {e}")
    yield
    if prewarm:
        prewarm.cancel()
    if _52w_task:
        _52w_task.cancel()
    if news_poller:
        news_poller.cancel()
    if _prefetch_task:
        _prefetch_task.cancel()
    if _recovery_task:
        _recovery_task.cancel()
    if _db_backup_task:
        _db_backup_task.cancel()
    if _orderflow_recorder_task:
        _orderflow_recorder_task.cancel()
    if _patterns_task:
        _patterns_task.cancel()
    if _watch_task:
        _watch_task.cancel()
    if _dashboard_task:
        _dashboard_task.cancel()
    if _market_snapshot_task:
        _market_snapshot_task.cancel()
    if _digest_task:
        _digest_task.cancel()
    try:
        from api import orderflow_journal
        orderflow_journal.close_all()
    except Exception:
        pass
    if _touch_task:
        _touch_task.cancel()
    if _nifty_tape_task:
        _nifty_tape_task.cancel()
    if _nifty_snapshot_task:
        _nifty_snapshot_task.cancel()
    if _chain10s_task:
        _chain10s_task.cancel()
    if _us_tape_task:
        _us_tape_task.cancel()
    try:
        from api.reports_api.us_tape import stop_us_tasks
        stop_us_tasks()
    except Exception:
        pass
    if _nifty_stream_task:
        _nifty_stream_task.cancel()
    if _nifty_spot_task:
        _nifty_spot_task.cancel()
    if _nifty_md_task is not None:
        try:
            _nifty_md_task.cancel()
        except Exception:
            pass
        _nifty_md_task = None
    try:
        from api.reports_api.nifty_md import stop_nifty_md_task
        stop_nifty_md_task()
    except Exception:
        pass
    if _nifty_oi_task:
        _nifty_oi_task.cancel()

    try:
        from api.bots_api.bots_router import stop_bot_process, _bot_processes
        for user_id in list(_bot_processes.keys()):
            for bot_id in list(_bot_processes.get(user_id, {}).keys()):
                try:
                    stop_bot_process(user_id, bot_id)
                except Exception:
                    pass
        print("🤖 Running bots stopped")
    except Exception:
        pass

    print("📰 News poller stopped")
    if redis_connected:
        from cache.redis_client import close_redis
        close_redis()
    from db.database import engine
    engine.dispose()
    print("🔌 Redis closed, DB pool disposed")


OPENAPI_TAGS = [
    {"name": "health", "description": "Liveness / readiness probes."},
    {"name": "auth", "description": "Registration, login, refresh, logout and current-user."},
    {"name": "screeners", "description": "Saved screener CRUD (user-defined screens)."},
    {"name": "screener", "description": "Screener scans, saved profiles and 52-week range data."},
    {"name": "chart", "description": "OHLCV chart preview and per-symbol price series."},
    {"name": "chart-patterns", "description": "Candlestick pattern detection, scans and timeframes."},
    {"name": "Paper Trading", "description": "Paper portfolio, positions, trades and order simulation."},
    {"name": "Paper Trading Live", "description": "Server-sent live price stream for open paper positions."},
    {"name": "Bots", "description": "Multi-strategy bot lifecycle, status, logs and performance."},
    {"name": "strategies", "description": "Strategy configuration CRUD and templates."},
    {"name": "strategy-performance", "description": "Aggregated strategy performance metrics."},
    {"name": "strategy-runner", "description": "Strategy runner control plane."},
    {"name": "backtest", "description": "Backtest runs, progress, results and cost model."},
    {"name": "reports", "description": "Generated market reports and delivery."},
    {"name": "reports-nifty", "description": "Nifty report, bursts, structure, positioning and verdicts."},
    {"name": "reports-nifty-intel", "description": "Nifty intelligence aggregates."},
    {"name": "reports-us", "description": "US market reports and tape."},
    {"name": "options", "description": "Options chain, analytics and sentiment."},
    {"name": "options-report", "description": "Options report generation."},
    {"name": "options-walls", "description": "Options wall / gamma exposure levels."},
    {"name": "options-recorder", "description": "Options tick recorder control."},
    {"name": "options-history", "description": "Historical options data."},
    {"name": "report-sim", "description": "Strategy simulator over recorded option tape (replay + live as-of)."},
    {"name": "market-ticker", "description": "Live index and commodity ticker data."},
    {"name": "symbols", "description": "Symbol search and instrument lookup."},
    {"name": "news", "description": "News feed, articles and sources."},
    {"name": "news-charts", "description": "News-linked chart annotations."},
    {"name": "value", "description": "Deep Value screener (India / USA / Global)."},
    {"name": "market", "description": "NSE market snapshot powering the one-page screener."},
    {"name": "events", "description": "Event Radar: scheduled corporate catalysts and intraday tripwires."},
    {"name": "sector", "description": "Sector rotation and sector-level analytics."},
    {"name": "rotation", "description": "Market rotation analytics."},
    {"name": "correlation", "description": "Cross-asset correlation matrices."},
    {"name": "heatmap", "description": "Market heatmap data."},
    {"name": "holidays", "description": "Exchange holiday calendar."},
    {"name": "agri", "description": "Agri commodity endpoints."},
    {"name": "brokers", "description": "Broker connections and OAuth."},
    {"name": "replay", "description": "Historical replay engine."},
    {"name": "experiments", "description": "Research experiment tracking."},
    {"name": "poc", "description": "POC / NQ strategy tooling."},
    {"name": "Order Flow", "description": "Order flow, depth and tape (incl. /ws WebSocket bridge)."},
    {"name": "Notifications", "description": "User notifications."},
    {"name": "Trading Agents", "description": "Multi-agent LLM chat, analysis and streaming."},
    {"name": "admin", "description": "Admin-only maintenance endpoints."},
    {"name": "debug", "description": "Diagnostics — not for production use."},
]

_API_DESCRIPTION = """\
Market data, screener, paper-trading and bot APIs for Indian (NSE) and US markets.

## Authentication
1. `POST /api/auth/login` with `{"email": "...", "password": "..."}`.
2. Copy `access_token` from the response.
3. Click **Authorize** (top right), paste the token into the `bearerAuth` field.
4. Send requests; the UI adds `Authorization: Bearer <token>`.

## Notes
- Base URL in local development: `http://localhost:8765`.
- WebSocket routes (`/ws/orderflow`, `/ws/nifty/*`) are not represented in this schema.
- Endpoints marked with a padlock require a bearer token.
"""

app = FastAPI(
    title="Alphashri API",
    description=_API_DESCRIPTION,
    version=os.getenv("APP_VERSION", "0.1.0"),
    contact={"name": "Alphashri Support"},
    license_info={"name": "Proprietary"},
    servers=[
        {"url": "http://localhost:8765", "description": "Local development"},
    ],
    openapi_tags=OPENAPI_TAGS,
    lifespan=lifespan,
)


def _include_api(module_path: str, router_attr: str, label: str, msg: str | None = None) -> bool:
    """Import and mount a router; fail soft and print like the existing blocks."""
    try:
        import importlib

        module = importlib.import_module(module_path)
        app.include_router(getattr(module, router_attr))
        print(msg or f"✅ {label} API loaded")
        return True
    except Exception as e:
        print(f"⚠️ Could not load {label} API: {e}")
        return False


class DynamicCORSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        origin = request.headers.get("origin")
        if origin and config.is_origin_allowed(origin):
            if request.method == "OPTIONS":
                response = Response(status_code=204)
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Access-Control-Allow-Credentials"] = "true"
                response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, PATCH, OPTIONS"
                response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
                response.headers["Access-Control-Max-Age"] = "86400"
                return response
            response = await call_next(request)
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            return response
        return await call_next(request)


app.add_middleware(DynamicCORSMiddleware)

# GZip cuts the patterns read path (`/results` ~6.9 MB raw at 500-bar cards)
# to ~1.8 MB on the wire; browsers accept it by default. The excluded-types
# list is pinned (not left to the library default) because it guarantees the
# SSE streams (`text/event-stream`) never buffer behind a gzip layer — events
# must interleave immediately, and `Cache-Control: no-cache` alone does not
# prevent compression. `compresslevel=5` is benchmarked on a 6.81 MiB
# `/results` body (185 items x 500 bars): level 5 → 1.83 MB (ratio 0.257) in
# ~208 ms vs level 9 → 1.75 MB (0.246) in ~1078 ms — 4.4% larger wire but
# ~5x less CPU; level 6 buys only 28 KB more for ~57% more CPU than level 5.
app.add_middleware(
    GZipMiddleware,
    minimum_size=1024,
    compresslevel=5,
    exclude_content_types=DEFAULT_EXCLUDED_CONTENT_TYPES,
)


@app.get("/health", tags=["health"], summary="Liveness probe")
@app.get("/api/health", tags=["health"], summary="Liveness probe")
@app.head("/health", tags=["health"])
@app.head("/api/health", tags=["health"])
async def health():
    return {'status': 'ok', 'timestamp': datetime.now(config.IST).isoformat()}




class ScreenerCreate(BaseModel):
    name: str
    description: str | None = None
    indicators: list[str] | None = None
    columns: list[str] | None = None
    filters: dict | None = None
    default_sort: dict | None = None


class ScreenerUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    indicators: list[str] | None = None
    columns: list[str] | None = None
    filters: dict | None = None
    default_sort: dict | None = None


def _seed_user_screeners(session, user_id: int):
    """Seed user's screeners from Python SCREENER_PROFILES if none exist."""
    # Disabled auto-seeding - user creates screeners manually via UI
    pass


@app.get("/api/screeners", tags=["screeners"], summary="List saved screeners")
async def get_screeners(user: User = Depends(get_current_user)):
    session = SessionLocal()
    try:
        _seed_user_screeners(session, user.id)

        user_screeners = session.query(Screener).filter(
            Screener.user_id == user.id,
            Screener.is_active == True
        ).all()

        builtin_profiles = trending_upside.get_screener_profiles()
        merged_profiles = []

        for profile in builtin_profiles:
            profile_id = profile['id']
            meta = PROFILE_META.get(profile_id, {})
            filter_list = meta.get('filters', [])
            entry = {
                **profile,
                'id': profile['id'],
                'source': 'builtin',
                'filters': {f['key']: f.get('default') for f in filter_list},
                'section_labels': meta.get('section_labels', {}),
                'section_descriptions': meta.get('section_descriptions', {}),
                'score_formula': meta.get('score_formula', ''),
            }
            if profile_id == '52w_high':
                entry['status'] = 'current'
            elif profile_id in ('near_52w_breakout', 'touched_52w_high'):
                entry['status'] = 'legacy'
                entry['superseded_by'] = '52w_high'
            merged_profiles.append(entry)

        for s in user_screeners:
            s_dict = s.to_dict()
            s_dict['source'] = 'user'
            s_dict['label'] = s_dict.get('name', '')  # frontend expects 'label'
            filters = s_dict.get('filters')
            if not filters or filters == {} or filters == []:
                meta = PROFILE_META.get(s_dict['name'], {})
                filter_list = meta.get('filters', [])
                s_dict['filters'] = {f['key']: f.get('default') for f in filter_list}
            merged_profiles.append(s_dict)

        return {
            'default': 'trending',
            'screeners': merged_profiles,
            'legacy_52w_sections': True,
        }
    finally:
        session.close()


@app.post("/api/screeners", tags=["screeners"], summary="Create a saved screener")
async def create_screener(
    screener: ScreenerCreate,
    user: User = Depends(get_current_user)
):
    session = SessionLocal()
    try:
        new_screener = Screener(
            user_id=user.id,
            name=screener.name,
            description=screener.description,
            indicators=screener.indicators,
            columns=screener.columns,
            filters=screener.filters,
            default_sort=screener.default_sort,
            is_active=True,
        )
        session.add(new_screener)
        session.commit()
        session.refresh(new_screener)
        result = new_screener.to_dict()
        result['source'] = 'user'
        result['label'] = result.get('name', '')  # frontend expects 'label'
        return result
    finally:
        session.close()


@app.put("/api/screeners/{screener_id}", tags=["screeners"], summary="Update a saved screener")
async def update_screener(
    screener_id: int,
    screener: ScreenerUpdate,
    user: User = Depends(get_current_user)
):
    session = SessionLocal()
    try:
        db_screener = session.query(Screener).filter(
            Screener.id == screener_id,
            Screener.user_id == user.id
        ).first()
        if not db_screener:
            raise HTTPException(status_code=404, detail="Screener not found")

        if screener.name is not None:
            db_screener.name = screener.name
        if screener.description is not None:
            db_screener.description = screener.description
        if screener.indicators is not None:
            db_screener.indicators = screener.indicators
        if screener.columns is not None:
            db_screener.columns = screener.columns
        if screener.filters is not None:
            db_screener.filters = screener.filters
        if screener.default_sort is not None:
            db_screener.default_sort = screener.default_sort

        session.commit()
        session.refresh(db_screener)
        result = db_screener.to_dict()
        result['source'] = 'user'
        return result
    finally:
        session.close()


@app.delete("/api/screeners/{screener_id}", tags=["screeners"], summary="Delete a saved screener")
async def delete_screener(
    screener_id: int,
    user: User = Depends(get_current_user)
):
    session = SessionLocal()
    try:
        db_screener = session.query(Screener).filter(
            Screener.id == screener_id,
            Screener.user_id == user.id
        ).first()
        if not db_screener:
            raise HTTPException(status_code=404, detail="Screener not found")

        db_screener.is_active = False
        session.commit()
        return {"deleted": True, "id": screener_id}
    finally:
        session.close()


@app.get("/api/screener", tags=["screener"], summary="Run the screener scan")
async def get_screener_data(
    provider: str = Query(default='upstox'),
    mode: str = Query(default='intraday'),
    screener: str = Query(default='trending'),
    trend: str = Query(default=None),
    direction: str = Query(default=None),
    min_atr_pct: float = Query(default=None),
    min_rsi: float = Query(default=None),
    min_score: float = Query(default=None),
    min_vol_surge: float = Query(default=None),
    max_52w_gap: float = Query(default=None),
    max_rsi: float = Query(default=None),
    min_stoch_k: float = Query(default=None),
    min_gap_pct: float = Query(default=None),
    min_volume_m: float = Query(default=None),
    min_turnover_cr: float = Query(default=None),
    min_wick_pct: float = Query(default=None),
    min_interest_score: float = Query(default=None),
    min_impact: float = Query(default=None),
    min_cap_b: float = Query(default=None),
):
    profile_filters = {}
    if trend is not None:
        profile_filters['trend'] = trend
    if direction is not None:
        profile_filters['direction'] = direction
    if min_atr_pct is not None:
        profile_filters['min_atr_pct'] = min_atr_pct
    if min_rsi is not None:
        profile_filters['min_rsi'] = min_rsi
    if min_score is not None:
        profile_filters['min_score'] = min_score
    if min_vol_surge is not None:
        profile_filters['min_vol_surge'] = min_vol_surge
    if max_52w_gap is not None:
        profile_filters['max_52w_gap'] = max_52w_gap
    if max_rsi is not None:
        profile_filters['max_rsi'] = max_rsi
    if min_stoch_k is not None:
        profile_filters['min_stoch_k'] = min_stoch_k
    if min_gap_pct is not None:
        profile_filters['min_gap_pct'] = min_gap_pct
    if min_volume_m is not None:
        profile_filters['min_volume_m'] = min_volume_m
    if min_turnover_cr is not None:
        profile_filters['min_turnover_cr'] = min_turnover_cr
    if min_wick_pct is not None:
        profile_filters['min_wick_pct'] = min_wick_pct
    if min_interest_score is not None:
        profile_filters['min_interest_score'] = min_interest_score
    if min_impact is not None:
        profile_filters['min_impact'] = min_impact
    if min_cap_b is not None:
        profile_filters['min_cap_b'] = min_cap_b

    from cache.redis_client import make_cache_key, stale_while_revalidate
    cache_key = make_cache_key("screener", provider, mode, screener, **profile_filters)

    data, status = await stale_while_revalidate(
        cache_key,
        lambda: _compute_screener(provider, mode, screener, profile_filters),
        fresh_ttl=300,
    )

    data['cache_status'] = status
    data['served_from_cache'] = status != 'miss'
    data['refreshing'] = status == 'stale'

    response = JSONResponse(content=data)
    response.headers["X-Cache"] = status
    return response


@app.get("/api/52w-range", tags=["screener"], summary="52-week range for one symbol")
async def get_52w_range(symbol: str = Query(...)):
    """Get 52-week high/low for a single symbol. Checks Redis first, falls back to DB."""
    from cache.redis_client import cache_get
    import asyncio

    cached = await asyncio.to_thread(lambda: cache_get(f"52w_range:{symbol}"))
    if cached and isinstance(cached, dict):
        entry = _sanitize_52w_range_entry(cached)
        if entry:
            return entry

    from db.database import SessionLocal
    from db.models.stock_52w_touch import Stock52WeekRange

    db = SessionLocal()
    try:
        row = db.query(Stock52WeekRange).filter(Stock52WeekRange.symbol == symbol).first()
        if row:
            return {"high": row.high_52w, "low": row.low_52w, "close": row.close}
        return {"error": "not_found", "symbol": symbol}
    finally:
        db.close()


@app.get("/api/52w-range/bulk", tags=["screener"], summary="52-week ranges for many symbols")
async def get_52w_range_bulk():
    """Get 52W ranges for all symbols. Returns dict of {symbol: {high, low, close}}."""
    from cache.redis_client import cache_get
    import asyncio

    cached = await asyncio.to_thread(_load_52w_ranges_from_redis)
    if cached:
        return _sanitize_52w_ranges_bulk(cached)

    from db.database import SessionLocal
    from db.models.stock_52w_touch import Stock52WeekRange

    db = SessionLocal()
    try:
        rows = db.query(Stock52WeekRange).all()
        return {r.symbol: {"high": r.high_52w, "low": r.low_52w, "close": r.close} for r in rows}
    finally:
        db.close()


_include_api("api.strategy_performance", "router", "strategy performance", msg="✅ Strategy Performance API loaded at /api/strategy-performance")

# ======
# Router includes — existing modules
# ======

try:
    from api.paper_trading import router as paper_trading_router
    app.include_router(paper_trading_router)

    from api.paper.live_stream import router as live_stream_router
    app.include_router(live_stream_router)
    print("✅ Paper trading live stream loaded at /api/paper/live/stream")

    print("✅ Paper trading API loaded at /api/paper")
except Exception as e:
    print(f"⚠️ Could not load paper trading API: {e}")

_include_api("api.auth", "router", "auth", msg="✅ Auth API loaded at /api/auth")

try:
    from api.strategies import router as strategies_router
    app.include_router(strategies_router)
    print("✅ Strategies API loaded at /api/strategies")
except ImportError as e:
    if "nautilus" in str(e).lower():
        print(f"⚠️ Strategies API skipped (Nautilus Trader not installed): {e}")
    else:
        print(f"⚠️ Could not load strategies API: {e}")
except Exception as e:
    print(f"⚠️ Could not load strategies API: {e}")

_include_api("api.market_ticker", "router", "market ticker", msg="✅ Market Ticker API loaded at /api/market-ticker")

_include_api("api.bots_api", "router", "bots", msg="✅ Bots API loaded at /api/bots")

_include_api("api.brokers", "router", "brokers", msg="✅ Brokers API loaded at /api/brokers")

_include_api("api.sector", "router", "sector", msg="✅ Sector API loaded at /api/sector")

_include_api("api.rotation", "router", "rotation", msg="✅ Rotation API loaded at /api/rotation")

# import from the SUBMODULE, not the package: `from api.value_scan import router`
# can resolve to the module (or a stale attribute) after other imports have
# touched the package, which silently registers an APIRouter with no routes.
_include_api("api.value_scan.router", "router", "value scan", msg="✅ Value scan API loaded at /api/value")
_include_api("api.market_screen.router", "router", "market screen", msg="✅ Market Screen API loaded at /api/market")

_include_api("api.options", "router", "options", msg="✅ Options API loaded at /api/options")

_include_api("api.fyers_bridge", "router", "fyers bridge", msg="✅ Fyers bridge API loaded at /api/fyers-bridge")

_include_api("api.premium_tracker", "router", "premium tracker", msg="✅ Premium Tracker API loaded at /api/options/premium-tracker")

_include_api("api.news_charts", "router", "news charts", msg="✅ News Charts API loaded at /api/news")

_include_api("api.holidays", "router", "holidays", msg="✅ Holidays API loaded at /api/holidays")

_include_api("api.agri.router", "router", "agri", msg="✅ Agri API loaded at /api/agri")

# ======
# Router includes — new modules
# ======

_include_api("api.backtest_routes", "router", "backtest", msg="✅ Backtest API loaded at /api/backtest")

_include_api("api.experiment_routes", "router", "experiments", msg="✅ Experiments API loaded at /api/experiments")

_include_api("api.chart", "router", "chart", msg="✅ Chart API loaded at /api/chart")

_include_api("api.chart_patterns", "router", "chart patterns", msg="✅ Chart Patterns API loaded at /api/chart-patterns")

_include_api("api.pattern_images", "router", "pattern images", msg="✅ Pattern Images API loaded at /api/chart-patterns/images")

_include_api("api.heatmap", "router", "heatmap", msg="✅ Heatmap API loaded at /api/heatmap")

_include_api("api.symbols", "router", "symbols", msg="✅ Symbols API loaded at /api/symbols")

_include_api("api.news_routes", "router", "news", msg="✅ News API loaded")

try:
    from api.admin_routes import router as admin_router
    app.include_router(admin_router)

    from api.notifications_api import router as notifications_router
    app.include_router(notifications_router)
    print("✅ Admin API loaded at /api/admin")
except Exception as e:
    print(f"⚠️ Could not load admin API: {e}")

_include_api("api.replay_api", "router", "replay", msg="✅ Replay API loaded at /api/replay")

_include_api("api.strategy_runner_api", "router", "strategy runner", msg="✅ Strategy Runner API loaded at /api/strategy-runner")

_include_api("api.reports_api.breadth", "router", "breadth", msg="✅ Breadth API loaded at /api/reports/breadth")

_include_api("api.reports_api.movers", "router", "index movers", msg="✅ Index Movers API loaded at /api/reports/movers")

_include_api("api.reports_api.chain10s", "router", "10s chain", msg="✅ 10s chain API loaded at /api/reports/nifty/chain10s")

_include_api("api.reports_api.ticks", "router", "tick tape", msg="✅ Tick tape API loaded at /api/reports/nifty/ticks")

_include_api("api.reports_api.options_report", "router", "options report", msg="✅ Options report API loaded at /api/reports/options")

_include_api("api.reports_api.options_recorder", "router", "options recorder status", msg="✅ Options recorder status API loaded at /api/reports/options/recorder/status")

_include_api("api.reports_api.options_history", "router", "options history", msg="✅ Options history API loaded at /api/reports/options/...")

_include_api("api.reports_api.sim", "router", "report sim", msg="✅ Report sim API loaded at /api/reports/sim")

_include_api("api.reports_api.options_walls", "router", "options walls", msg="✅ Options walls API loaded at /api/reports/options/{symbol}/walls")

_include_api("api.debug_api", "router", "debug", msg="✅ Debug API loaded at /api/debug")

_include_api("api.correlation", "router", "correlation", msg="✅ Correlation API loaded at /api/correlation")

_include_api("api.trading_agents", "router", "TradingAgents", msg="✅ TradingAgents API loaded at /api/trading-agents")

_include_api("api.poc_nq", "router", "POC NQ", msg="✅ POC NQ API loaded at /api/poc/nq")

try:
    from api.orderflow_stream import router as orderflow_router
    app.include_router(orderflow_router)
    print("✅ Order Flow bridge loaded at /ws/orderflow")
except Exception as e:
    print(f"⚠️ Could not load Order Flow bridge: {e}")

_include_api("api.screener_api.dashboard", "router", "screener dashboard", msg="✅ Screener Dashboard API loaded at /api/screener/dashboard")

_include_api("api.reports_api.delivery", "router", "reports delivery", msg="✅ Reports delivery/events API loaded at /api/reports")

_include_api("api.reports_api.events_feed", "router", "reports events feed", msg="✅ Reports events feed API loaded at /api/reports/events/upcoming|recent")

_include_api("api.reports_api.breakouts", "router", "reports", msg="✅ Reports API loaded at /api/reports")

_include_api("api.reports_api.followthrough", "router", "reports follow-through", msg="✅ Reports follow-through API loaded at /api/reports/follow-through")

_include_api("api.reports_api.profitability", "router", "reports profitability", msg="✅ Reports profitability API loaded at /api/reports/profitability")

_include_api("api.reports_api.market", "router", "reports", msg="✅ Reports API loaded at /api/reports")

_include_api("api.reports_api.digest", "router", "reports digest", msg="✅ Reports digest API loaded at /api/reports/digest/send")

_include_api("api.reports_api.nifty", "router", "Nifty Report", msg="✅ Nifty Report API loaded at /api/reports/nifty")

_include_api("api.reports_api.us", "router", "US Report", msg="✅ US Report API loaded at /api/reports/us")

_include_api("api.reports_api.nifty_ws", "router", "Nifty WS", msg="✅ Nifty WS API loaded at /ws/nifty/report + /ws/nifty/bursts")

# --- Event Radar ---
_include_api("api.event_radar.router", "router", "event radar", msg="✅ Event radar API loaded at /api/events")

if __name__ == '__main__':
    port = config.PORT
    print(f'🚀 Alphashri FastAPI running on http://localhost:{port}')
    print(f'   API docs: http://localhost:{port}/docs')
    print(f'   Screener API: http://localhost:{port}/api/screener')
    print(f'   Backtest API: http://localhost:{port}/api/backtest/strategies')
    print(f'   Paper Trading API: http://localhost:{port}/api/paper/portfolio')
    uvicorn.run(app, host="0.0.0.0", port=port)
