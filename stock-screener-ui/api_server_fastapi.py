#!/usr/bin/env python3
"""
FastAPI server for Alphashri with auto-reload.
Serves screener data and backtest API as JSON.

Run with: uvicorn api_server_fastapi:app --reload --port 8765
"""
import sys
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

from fastapi import FastAPI, Query, Depends, HTTPException
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
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

_news_available = False
_llm_available = False
fetch_news = None
fetch_article_content = None
NEWS_SOURCES = []
article_analyzer = None

_news_available, _llm_available, article_analyzer, fetch_news, fetch_article_content, NEWS_SOURCES = _init_news_modules()


PREWARM_SCREENERS = ["trending", "buyer_interest", "high_momentum", "nifty_movers"]
PREWARM_INTERVAL = 60


async def screener_prewarm_task():
    while True:
        try:
            hour = datetime.now(config.IST).hour
            is_market_hours = 8 <= hour <= 16
            if is_market_hours:
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
        to_update = []
        now = datetime.now()
        for symbol, info in data.items():
            cur = existing.get(symbol)
            if cur:
                if (
                    cur.high_52w != info['high']
                    or cur.low_52w != info['low']
                    or cur.close != info['close']
                ):
                    cur.high_52w = info['high']
                    cur.low_52w = info['low']
                    cur.close = info['close']
                    cur.updated_at = now
                    to_update.append(cur)
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


async def compute_52w_ranges_task():
    """Hourly Upstox 52W batch (incremental) + screener cache invalidation when complete."""
    import os
    from trading.week52_job_status import get_job_status

    interval = int(os.environ.get("SCREENER_52W_INTERVAL_SEC", "3600"))
    poll_sec = 30
    max_wait = int(os.environ.get("SCREENER_52W_MAX_WAIT_SEC", "7200"))

    while True:
        try:
            await asyncio.sleep(interval)
            job = get_job_status() or {}
            if job.get("status") == "running":
                print("[52W Range] Scheduled run skipped — batch already running")
                continue

            from api.admin_routes import _run_52w_batch_subprocess

            print(f"[52W Range] Starting scheduled incremental batch (every {interval}s)")
            await asyncio.to_thread(_run_52w_batch_subprocess, True, True, 0)

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
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[52W Range] Scheduled task error: {e}")
            await asyncio.sleep(300)


def _compute_screener(provider, mode, screener, profile_filters):
    screener_id = screener.replace('builtin:', '') if screener.startswith('builtin:') else screener
    data = fetch_screener_data(provider, mode, screener, profile_filters)
    data['applied_profile_filters'] = profile_filters

    # 52w_high already enriches touch history inside fetch_52w_high_data
    if screener_id != '52w_high':
        _enrich_with_touch_history(data, screener)

    return _sanitize_for_json(data)


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f'🚀 Alphashri API starting...')
    prewarm = None
    _52w_task = None
    news_poller = None
    try:
        from db.database import init_db
        init_db()
        print("✅ Database initialized")
        _load_instruments()
        from cache.redis_client import get_redis_client, is_cache_available, _load_stats_from_redis
        get_redis_client()
        if is_cache_available():
            _load_stats_from_redis()
            print("✅ Redis cache connected")
        else:
            print("⚠️ Redis unavailable — caching disabled")
        import traceback
        try:
            news_poller = asyncio.create_task(news_poller_task())
            print("📰 News poller started")
        except Exception as e:
            print(f"⚠️ News poller failed: {e} {traceback.format_exc()}")
        try:
            asyncio.create_task(news_startup_prefetch())
            print("📰 News prefetch scheduled")
        except Exception as e:
            print(f"⚠️ News prefetch failed: {e}")
        try:
            prewarm = asyncio.create_task(screener_prewarm_task())
            print("🔄 Screener pre-warm started")
        except Exception as e:
            print(f"⚠️ Screener prewarm failed: {e}")

        try:
            _52w_task = asyncio.create_task(compute_52w_ranges_task())
            print("📊 52W Range background task started")
        except Exception as e:
            print(f"⚠️ 52W Range task failed: {e}")
            _52w_task = None
    except Exception as e:
        import traceback
        print(f"❌ Startup failed: {e}")
        print(traceback.format_exc())
        _52w_task = None
    yield
    if prewarm:
        prewarm.cancel()
    if _52w_task:
        _52w_task.cancel()
    if news_poller:
        news_poller.cancel()
    print("📰 News poller stopped")
    from cache.redis_client import close_redis
    from db.database import engine
    close_redis()
    engine.dispose()
    print("🔌 Redis closed, DB pool disposed")


app = FastAPI(title="Alphashri API", lifespan=lifespan)


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

_sector_dashboard_dir = _project_root / 'historical_sector_cycles'
if _sector_dashboard_dir.exists():
    app.mount("/sector", StaticFiles(directory=str(_sector_dashboard_dir), html=True), name="sector_dashboard")


@app.get("/health")
@app.get("/api/health")
async def health():
    return {'status': 'ok', 'timestamp': datetime.now().isoformat()}




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


@app.get("/api/screeners")
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


@app.post("/api/screeners")
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


@app.put("/api/screeners/{screener_id}")
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


@app.delete("/api/screeners/{screener_id}")
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


@app.get("/api/screener")
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


@app.get("/api/52w-range")
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


@app.get("/api/52w-range/bulk")
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

try:
    from api.auth import router as auth_router
    app.include_router(auth_router)
    print("✅ Auth API loaded at /api/auth")
except Exception as e:
    print(f"⚠️ Could not load auth API: {e}")

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

try:
    from api.market_ticker import router as market_ticker_router
    app.include_router(market_ticker_router)
    print("✅ Market Ticker API loaded at /api/market-ticker")
except Exception as e:
    print(f"⚠️ Could not load market ticker API: {e}")

try:
    from api.bots_api import router as bots_router
    app.include_router(bots_router)
    print("✅ Bots API loaded at /api/bots")
except Exception as e:
    print(f"⚠️ Could not load bots API: {e}")

try:
    from api.brokers import router as brokers_router
    app.include_router(brokers_router)
    print("✅ Brokers API loaded at /api/brokers")
except Exception as e:
    print(f"⚠️ Could not load brokers API: {e}")

try:
    from api.sector import router as sector_router
    app.include_router(sector_router)
    print("✅ Sector API loaded at /api/sector")
except Exception as e:
    print(f"⚠️ Could not load sector API: {e}")

try:
    from api.options import router as options_router
    app.include_router(options_router)
    print("✅ Options API loaded at /api/options")
except Exception as e:
    print(f"⚠️ Could not load options API: {e}")

try:
    from api.news_charts import router as news_charts_router
    app.include_router(news_charts_router)
    print("✅ News Charts API loaded at /api/news")
except Exception as e:
    print(f"⚠️ Could not load news charts API: {e}")

try:
    from api.holidays import router as holidays_router
    app.include_router(holidays_router)
    print("✅ Holidays API loaded at /api/holidays")
except Exception as e:
    print(f"⚠️ Could not load holidays API: {e}")

# ======
# Router includes — new modules
# ======

try:
    from api.backtest_routes import router as backtest_router
    app.include_router(backtest_router)
    print("✅ Backtest API loaded at /api/backtest")
except Exception as e:
    print(f"⚠️ Could not load backtest API: {e}")

try:
    from api.chart import router as chart_router
    app.include_router(chart_router)
    print("✅ Chart API loaded at /api/chart")
except Exception as e:
    print(f"⚠️ Could not load chart API: {e}")

try:
    from api.heatmap import router as heatmap_router
    app.include_router(heatmap_router)
    print("✅ Heatmap API loaded at /api/heatmap")
except Exception as e:
    print(f"⚠️ Could not load heatmap API: {e}")

try:
    from api.symbols import router as symbols_router
    app.include_router(symbols_router)
    print("✅ Symbols API loaded at /api/symbols")
except Exception as e:
    print(f"⚠️ Could not load symbols API: {e}")

try:
    from api.news_routes import router as news_router
    app.include_router(news_router)
    print("✅ News API loaded")
except Exception as e:
    print(f"⚠️ Could not load news API: {e}")

try:
    from api.admin_routes import router as admin_router
    app.include_router(admin_router)
    print("✅ Admin API loaded at /api/admin")
except Exception as e:
    print(f"⚠️ Could not load admin API: {e}")

try:
    from api.replay_api import router as replay_router
    app.include_router(replay_router)
    print("✅ Replay API loaded at /api/replay")
except Exception as e:
    print(f"⚠️ Could not load replay API: {e}")

try:
    from api.debug_api import router as debug_router
    app.include_router(debug_router)
    print("✅ Debug API loaded at /api/debug")
except Exception as e:
    print(f"⚠️ Could not load debug API: {e}")

try:
    from api.correlation import router as correlation_router
    app.include_router(correlation_router)
    print("✅ Correlation API loaded at /api/correlation")
except Exception as e:
    print(f"⚠️ Could not load correlation API: {e}")

try:
    from api.trading_agents import router as trading_agents_router
    app.include_router(trading_agents_router)
    print("✅ TradingAgents API loaded at /api/trading-agents")
except Exception as e:
    print(f"⚠️ Could not load TradingAgents API: {e}")

if __name__ == '__main__':
    port = config.PORT
    print(f'🚀 Alphashri FastAPI running on http://localhost:{port}')
    print(f'   API docs: http://localhost:{port}/docs')
    print(f'   Screener API: http://localhost:{port}/api/screener')
    print(f'   Backtest API: http://localhost:{port}/api/backtest/strategies')
    print(f'   Paper Trading API: http://localhost:{port}/api/paper/portfolio')
    uvicorn.run(app, host="0.0.0.0", port=port)
