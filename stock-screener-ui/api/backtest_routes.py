"""
Backtest API — routes for running, viewing, and managing backtests.
"""

from typing import Optional, Dict, Any, List
import asyncio

from fastapi import APIRouter, Query, HTTPException, Path, Depends
from pydantic import BaseModel

from api.screener import _sanitize_for_json
from api.auth import get_current_user

router = APIRouter(prefix="/api/backtest", tags=["backtest"])

from backtest.api import (
    BacktestRequestHandler, handle_get_strategies, handle_get_costs, handle_run_backtest,
    list_backtest_history, get_backtest_history_details, delete_backtest_history,
    build_backtest_inmem_cache,
)

_backtest_handler = BacktestRequestHandler()


def _base_backtest_response(data: dict) -> dict:
    """Common dict builder for backtest run responses (and cache payloads).

    Eliminates the 9-line duplicated literal for strategy/variation/config/results/totals/etc
    between the cache-save path and the final response construction.
    """
    return {
        'strategy': data.get('strategy'),
        'variation_id': data.get('variation_id'),
        'config': data.get('config'),
        'results': data.get('results'),
        'totals': data.get('totals'),
        'skipped_stocks': data.get('skipped_stocks', []),
        'run_time': data.get('run_time'),
        'saved_uuid': data.get('saved_uuid'),
    }


class BacktestRunRequest(BaseModel):
    strategy: str = 'orb'
    variation_id: Optional[str] = None
    symbols: List[str]
    params: Dict[str, Any] = {}
    days: int = 90
    include_costs: bool = True
    save_to_history: bool = False


@router.get("/strategies")
async def get_strategies():
    return handle_get_strategies()


@router.get("/costs")
async def get_costs():
    return handle_get_costs()


@router.get("/progress")
async def get_progress():
    return _backtest_handler.progress_state


@router.post("/run")
async def run_backtest(
    request: BacktestRunRequest,
    include_chart_data: bool = Query(False, description="Include candle/chart data in response (default: False for smaller responses)"),
    current_user=Depends(get_current_user),
):
    import config as app_config

    api_key = getattr(app_config, 'UPSTOX_API_KEY', None)
    api_secret = getattr(app_config, 'UPSTOX_API_SECRET', None)

    if not api_key or not api_secret:
        raise HTTPException(
            status_code=503,
            detail="Upstox API credentials not configured. "
                   "Please set UPSTOX_API_KEY and UPSTOX_API_SECRET in your environment."
        )

    from cache.redis_client import cache_get, cache_set, is_cache_available
    from backtest.api import build_backtest_cache_key

    body = request.model_dump()
    user_id = body['user_id'] = current_user.id

    cache_key = build_backtest_cache_key(
        user_id=user_id,
        strategy_id=body.get('strategy', 'orb'),
        symbols=body.get('symbols', []),
        params=body.get('params', {}),
        days=body.get('days', 90),
        variation_id=body.get('variation_id'),
    )

    cached = cache_get(cache_key) if is_cache_available() else None
    if cached is not None:
        _backtest_handler.backtest_cache = build_backtest_inmem_cache(cached)
        _backtest_handler.set_progress_done()
        response = _base_backtest_response(cached)
        response['from_cache'] = True
        if include_chart_data:
            response['candles'] = cached.get('candles', {})
            response['chart_data'] = cached.get('chart_data', {})
        return _sanitize_for_json(response)

    _backtest_handler.reset_progress(len(body.get('symbols', [])))

    result = await asyncio.to_thread(handle_run_backtest, body, _backtest_handler.progress_state)

    _backtest_handler.apply_result_to_cache(result)

    if 'error' not in result:
        totals = result.get('totals', {})
        has_trades = totals.get('trades', 0) > 0

        if is_cache_available() and has_trades:
            cache_data = _base_backtest_response(result)
            cache_data['candles'] = result.get('candles', {})
            cache_data['chart_data'] = result.get('chart_data', {})
            cache_set(cache_key, cache_data, ttl=86400)

    _backtest_handler.set_progress_done()

    response = _base_backtest_response(result)

    if include_chart_data:
        from backtest.chart_data import build_chart_data_for_symbol
        candles = result.get('candles', {})
        chart_data_raw = result.get('chart_data', {})
        or_minutes = result.get('config', {}).get('params', {}).get('or_minutes', 45)
        strategy = result.get('strategy', '')
        include_52w_line = strategy == '52w_chaser'

        full_chart_data = {}
        for symbol, trades_data in chart_data_raw.items():
            if symbol in candles and trades_data.get('trades'):
                full_chart_data[symbol] = build_chart_data_for_symbol(
                    symbol, candles[symbol], trades_data['trades'], or_minutes,
                    include_52w_line=include_52w_line,
                    visuals=chart_data_raw[symbol].get('visuals')
                )

        response['candles'] = candles
        response['chart_data'] = full_chart_data

    return _sanitize_for_json(response)


@router.get("/chart/{symbol}")
async def get_chart_data(
    symbol: str,
    tf: Optional[str] = Query(None, description="Timeframe: 1,5,15,30,60,240,1440,10080,43200 (minutes)"),
):
    import pandas as pd
    from datetime import datetime, timedelta
    import config as app_config
    from backtest.chart_data import build_chart_data_for_symbol

    if symbol not in _backtest_handler.backtest_cache.get('candles', {}):
        raise HTTPException(status_code=404, detail=f'No chart data for {symbol}')

    if symbol not in _backtest_handler.backtest_cache.get('chart_data', {}):
        raise HTTPException(status_code=404, detail=f'No trade data for {symbol}')

    try:
        native_candles_df = _backtest_handler.backtest_cache['candles'][symbol]
        trades = _backtest_handler.backtest_cache['chart_data'][symbol]['trades']
        cached_visuals = _backtest_handler.backtest_cache['chart_data'][symbol].get('visuals')
        bt_config = _backtest_handler.backtest_cache.get('config', {})
        or_minutes = bt_config.get('params', {}).get('or_minutes', 45)
        strategy = bt_config.get('strategy', '')

        include_52w_line = strategy == '52w_chaser'

        if tf is not None:
            tf_minutes = int(tf)

            if isinstance(native_candles_df, dict):
                dates = native_candles_df.get('index', [])
                if not dates:
                    candles_df = native_candles_df
                    date_range_start = None
                else:
                    parsed = pd.to_datetime(dates)
                    date_range_start = parsed.min()
                    date_range_end = parsed.max()
            else:
                if isinstance(native_candles_df.index, pd.DatetimeIndex):
                    date_range_start = native_candles_df.index.min()
                    date_range_end = native_candles_df.index.max()
                else:
                    date_range_start = pd.to_datetime(native_candles_df.index).min()
                    date_range_end = pd.to_datetime(native_candles_df.index).max()

            if date_range_start is not None:
                from_date = (date_range_start - timedelta(days=2)).strftime('%Y-%m-%d')
                to_date = (date_range_end + timedelta(days=2)).strftime('%Y-%m-%d')

                from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
                upstox_api = UpstoxAPI(
                    api_key=app_config.UPSTOX_API_KEY or "",
                    api_secret=app_config.UPSTOX_API_SECRET or "",
                    quiet=True,
                )

                sym = symbol.upper()
                tf_map = {1: ('minutes', 1), 5: ('minutes', 5), 15: ('minutes', 15), 30: ('minutes', 30), 60: ('hours', 1), 240: ('hours', 4), 1440: ('days', 1), 10080: ('weeks', 1), 43200: ('months', 1)}
                unit, interval = tf_map.get(tf_minutes, ('minutes', 1))

                if tf_minutes <= 60 and date_range_end.date() == datetime.now(app_config.IST).date():
                    df_tf = upstox_api.fetch_intraday_data_v3(sym, interval=str(interval))
                else:
                    df_tf = upstox_api.fetch_historical_data_v3(
                        sym, unit=unit, interval=interval,
                        to_date=to_date, from_date=from_date,
                    )

                if df_tf is not None and not df_tf.empty:
                    if df_tf.index.tz is not None:
                        df_tf.index = df_tf.index.tz_convert('Asia/Kolkata').tz_localize(None)
                    candles_df = df_tf
                else:
                    candles_df = native_candles_df
            else:
                candles_df = native_candles_df
        else:
            candles_df = native_candles_df

        chart_data = build_chart_data_for_symbol(
            symbol, candles_df, trades, or_minutes,
            include_52w_line=include_52w_line,
            visuals=cached_visuals
        )
        return _sanitize_for_json(chart_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/results")
async def get_results():
    return {
        'results': _backtest_handler.backtest_cache.get('results', []),
        'config': _backtest_handler.backtest_cache.get('config', {}),
    }


@router.get("/history")
async def list_history(current_user=Depends(get_current_user)):
    user_id = current_user.id
    from cache.redis_client import cache_get, cache_set
    _bh_key = f"backtest:{user_id}:history:list"
    _cached = cache_get(_bh_key)
    if _cached is not None:
        return _cached
    history = list_backtest_history(user_id)
    result = _sanitize_for_json({'history': history})
    cache_set(_bh_key, result, ttl=30)
    return result


@router.get("/history/{uuid}")
async def get_backtest_details(uuid: str):
    from cache.redis_client import cache_get, cache_set
    _bd_key = f"backtest:detail:{uuid}"
    _cached = cache_get(_bd_key)
    if _cached is not None:
        return _cached
    details = get_backtest_history_details(uuid)
    if not details:
        raise HTTPException(status_code=404, detail="Backtest not found")
    result = _sanitize_for_json(details)
    cache_set(_bd_key, result, ttl=300)
    return result


@router.delete("/history/{uuid}")
async def delete_backtest(uuid: str, current_user=Depends(get_current_user)):
    success = delete_backtest_history(uuid)
    if not success:
        raise HTTPException(status_code=404, detail="Backtest not found or could not be deleted")
    from cache.redis_client import cache_delete
    cache_delete(f"backtest:detail:{uuid}")
    cache_delete(f"backtest:{current_user.id}:history:list")
    return {'status': 'success'}
