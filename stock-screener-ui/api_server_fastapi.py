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

from fastapi import FastAPI, Query
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
from db.database import SessionLocal
from db.models import Stock52WeekTouch
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

def _enrich_with_touch_history(data, screener):
    """Enrich screener results with historical 52w touch information.

    Queries the database for the most recent 52w high touch for each symbol
    and updates the stock data with last_touched info. Also adjusts
    touched_52w and moves stocks from approaching to touched if they
    touched within the recent window (7 calendar days ~= 5 trading days).
    """
    from datetime import timedelta

    # Collect all symbols
    approaching = data.get('approaching', [])
    touched = data.get('touched', [])
    all_stocks = approaching + touched
    if not all_stocks:
        return

    symbols = [s['symbol'] for s in all_stocks if s.get('symbol')]
    if not symbols:
        return

    # Look back 7 calendar days to cover ~5 trading days
    cutoff_date = datetime.now() - timedelta(days=7)

    touch_map = {}
    try:
        db = SessionLocal()
        try:
            # Get the most recent touch per symbol within the lookback window
            recent_touches = (
                db.query(Stock52WeekTouch)
                .filter(
                    Stock52WeekTouch.symbol.in_(symbols),
                    Stock52WeekTouch.touched_date >= cutoff_date,
                    Stock52WeekTouch.is_high == True,
                )
                .order_by(Stock52WeekTouch.symbol, Stock52WeekTouch.touched_date.desc())
                .all()
            )
            # Keep only the most recent per symbol
            for touch in recent_touches:
                if touch.symbol not in touch_map:
                    touch_map[touch.symbol] = touch
        finally:
            db.close()
    except Exception:
        # DB not available or query failed — skip enrichment
        pass

    # Build a map of symbol -> last_touched info for ALL symbols
    # (including those without recent touches)
    last_touched_info = {}
    try:
        db = SessionLocal()
        try:
            # Get the single most recent touch EVER for each symbol
            from sqlalchemy import func
            subq = (
                db.query(
                    Stock52WeekTouch.symbol,
                    func.max(Stock52WeekTouch.touched_date).label('max_date')
                )
                .filter(Stock52WeekTouch.symbol.in_(symbols))
                .group_by(Stock52WeekTouch.symbol)
                .subquery()
            )
            latest_touches = (
                db.query(Stock52WeekTouch)
                .join(subq,
                      (Stock52WeekTouch.symbol == subq.c.symbol) &
                      (Stock52WeekTouch.touched_date == subq.c.max_date))
                .all()
            )
            for touch in latest_touches:
                last_touched_info[touch.symbol] = {
                    'date': touch.touched_date,
                    'price': touch.touched_price,
                }
        finally:
            db.close()
    except Exception:
        pass

    # Process: build new approaching/touched lists based on enriched data
    new_approaching = []
    new_touched = []
    moved_count = 0

    for stock in all_stocks:
        symbol = stock.get('symbol')
        touch = touch_map.get(symbol)
        last_info = last_touched_info.get(symbol)

        # Add last_touched fields to the stock dict
        if last_info:
            stock['last_touched'] = last_info['date'].isoformat()
            stock['last_touched_price'] = last_info['price']
        else:
            stock['last_touched'] = None
            stock['last_touched_price'] = None

        # Determine if stock should be in touched bucket
        # Criteria: either touched today (original logic) OR touched recently (historical)
        was_touched_today = stock.get('touched_52w', False)
        touched_recently = touch is not None

        if was_touched_today or touched_recently:
            # Should be in touched bucket
            stock['touched_52w'] = True
            if not was_touched_today:
                moved_count += 1
            new_touched.append(stock)
        else:
            # Remains in approaching
            new_touched.append(stock) if False else None  # keep in approaching
            new_approaching.append(stock)

    # Replace the lists
    data['approaching'] = new_approaching
    data['touched'] = new_touched

    # Update summary if any stocks were moved
    if moved_count > 0:
        data['_debug_moved_by_history'] = moved_count


def _compute_screener(provider, mode, screener, profile_filters):
    data = fetch_screener_data(provider, mode, screener, profile_filters)
    data['applied_profile_filters'] = profile_filters

    # Enrich with historical 52w touch data
    _enrich_with_touch_history(data, screener)

    return _sanitize_for_json(data)


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f'🚀 Alphashri API starting...')
    prewarm = None
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
    except Exception as e:
        import traceback
        print(f"❌ Startup failed: {e}")
        print(traceback.format_exc())
    yield
    if prewarm:
        prewarm.cancel()
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


@app.get("/api/screeners")
async def get_screeners():
    return {
        'default': 'trending',
        'screeners': trending_upside.get_screener_profiles(),
        'meta_by_id': PROFILE_META
    }


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
    from api.correlation import router as correlation_router
    app.include_router(correlation_router)
    print("✅ Correlation API loaded at /api/correlation")
except Exception as e:
    print(f"⚠️ Could not load correlation API: {e}")


if __name__ == '__main__':
    port = config.PORT
    print(f'🚀 Alphashri FastAPI running on http://localhost:{port}')
    print(f'   API docs: http://localhost:{port}/docs')
    print(f'   Screener API: http://localhost:{port}/api/screener')
    print(f'   Backtest API: http://localhost:{port}/api/backtest/strategies')
    print(f'   Paper Trading API: http://localhost:{port}/api/paper/portfolio')
    uvicorn.run(app, host="0.0.0.0", port=port)
