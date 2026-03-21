"""
Backtest API — routes for running, viewing, and managing backtests.
"""

from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Query, HTTPException, Path, Depends
from pydantic import BaseModel

from api.screener import _sanitize_for_json
from api.auth import get_current_user_optional

router = APIRouter(prefix="/api/backtest", tags=["backtest"])

from backtest.api import (
    BacktestRequestHandler, handle_get_strategies, handle_get_costs, handle_run_backtest,
    list_backtest_history, get_backtest_history_details, delete_backtest_history
)

_backtest_handler = BacktestRequestHandler()


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
    include_chart_data: bool = Query(False, description="Include candle/chart data in response (default: False for smaller responses)")
):
    from cache.redis_client import cache_get, cache_set, is_cache_available
    from backtest.api import build_backtest_cache_key

    body = request.model_dump()
    user_id = body['user_id'] = 1

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
        _backtest_handler.backtest_cache = {
            'candles': cached.get('candles', {}),
            'chart_data': cached.get('chart_data', {}),
            'config': cached.get('config', {}),
            'results': cached.get('results', []),
        }
        _backtest_handler.progress_state['running'] = False
        response = {
            'strategy': cached.get('strategy'),
            'variation_id': cached.get('variation_id'),
            'config': cached.get('config'),
            'results': cached.get('results'),
            'totals': cached.get('totals'),
            'skipped_stocks': cached.get('skipped_stocks', []),
            'run_time': cached.get('run_time'),
            'saved_uuid': cached.get('saved_uuid'),
            'from_cache': True,
        }
        if include_chart_data:
            response['candles'] = cached.get('candles', {})
            response['chart_data'] = cached.get('chart_data', {})
        return _sanitize_for_json(response)

    _backtest_handler.progress_state['running'] = True
    _backtest_handler.progress_state['current'] = 0
    _backtest_handler.progress_state['total'] = len(body.get('symbols', []))
    _backtest_handler.progress_state['message'] = 'Starting...'

    result = handle_run_backtest(body, _backtest_handler.progress_state)

    if 'error' not in result:
        _backtest_handler.backtest_cache = {
            'candles': result.get('candles', {}),
            'chart_data': result.get('chart_data', {}),
            'config': result.get('config', {}),
            'results': result.get('results', []),
        }

        if is_cache_available():
            cache_data = {
                'strategy': result.get('strategy'),
                'variation_id': result.get('variation_id'),
                'config': result.get('config'),
                'results': result.get('results'),
                'totals': result.get('totals'),
                'skipped_stocks': result.get('skipped_stocks', []),
                'run_time': result.get('run_time'),
                'saved_uuid': result.get('saved_uuid'),
                'candles': result.get('candles', {}),
                'chart_data': result.get('chart_data', {}),
            }
            cache_set(cache_key, cache_data, ttl=86400)

    _backtest_handler.progress_state['running'] = False

    response = {
        'strategy': result.get('strategy'),
        'variation_id': result.get('variation_id'),
        'config': result.get('config'),
        'results': result.get('results'),
        'totals': result.get('totals'),
        'skipped_stocks': result.get('skipped_stocks', []),
        'run_time': result.get('run_time'),
        'saved_uuid': result.get('saved_uuid'),
    }

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
                    include_52w_line=include_52w_line
                )

        response['candles'] = candles
        response['chart_data'] = full_chart_data

    return _sanitize_for_json(response)


@router.get("/chart/{symbol}")
async def get_chart_data(symbol: str):
    from backtest.chart_data import build_chart_data_for_symbol

    if symbol not in _backtest_handler.backtest_cache.get('candles', {}):
        raise HTTPException(status_code=404, detail=f'No chart data for {symbol}')

    if symbol not in _backtest_handler.backtest_cache.get('chart_data', {}):
        raise HTTPException(status_code=404, detail=f'No trade data for {symbol}')

    try:
        candles_df = _backtest_handler.backtest_cache['candles'][symbol]
        trades = _backtest_handler.backtest_cache['chart_data'][symbol]['trades']
        config = _backtest_handler.backtest_cache.get('config', {})
        or_minutes = config.get('params', {}).get('or_minutes', 45)
        strategy = config.get('strategy', '')

        include_52w_line = strategy == '52w_chaser'

        chart_data = build_chart_data_for_symbol(
            symbol, candles_df, trades, or_minutes,
            include_52w_line=include_52w_line
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
async def list_history():
    user_id = 1
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
async def delete_backtest(uuid: str, user=Depends(get_current_user_optional)):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    success = delete_backtest_history(uuid)
    if not success:
        raise HTTPException(status_code=404, detail="Backtest not found or could not be deleted")
    from cache.redis_client import cache_delete
    cache_delete(f"backtest:detail:{uuid}")
    cache_delete("backtest:1:history:list")
    return {'status': 'success'}
