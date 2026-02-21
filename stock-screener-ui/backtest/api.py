"""
Backtest API Handlers

HTTP handlers for backtest endpoints.
"""

import json
from datetime import datetime
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from typing import Dict, Any, Optional

from .strategies import list_strategies, get_strategy
from .costs import get_cost_breakdown
from .chart_data import build_chart_data_for_symbol


def _sanitize_for_json(obj):
    """Recursively sanitize objects for JSON serialization."""
    import math

    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if hasattr(obj, 'isoformat'):
        return obj.isoformat()
    return obj


def handle_get_strategies() -> Dict:
    """Handle GET /api/backtest/strategies"""
    return {
        'strategies': list_strategies(),
        'default': 'orb',
    }


def handle_get_costs() -> Dict:
    """Handle GET /api/backtest/costs"""
    return {
        'costs': get_cost_breakdown(),
        'updated': datetime.now().isoformat(),
    }


def handle_run_backtest(body: Dict, progress_state: Dict = None) -> Dict:
    """
    Handle POST /api/backtest/run

    Args:
        body: Request body with strategy, symbols, params, days
        progress_state: Optional dict to store progress (for async polling)

    Returns:
        Backtest results
    """
    strategy_id = body.get('strategy', 'orb')
    symbols = body.get('symbols', [])
    params = body.get('params', {})
    days = body.get('days', 90)
    include_costs = body.get('include_costs', True)

    params['include_costs'] = include_costs

    # Validate
    if not symbols:
        return {'error': 'No symbols provided'}

    # Get strategy
    strategy_class = get_strategy(strategy_id)
    if not strategy_class:
        return {'error': f'Unknown strategy: {strategy_id}'}

    # Validate params
    strategy = strategy_class()
    errors = strategy.validate_params(params)
    if errors:
        return {'error': 'Invalid parameters', 'details': errors}

    # Progress callback
    def progress_callback(current, total, message):
        if progress_state is not None:
            progress_state['current'] = current
            progress_state['total'] = total
            progress_state['message'] = message
            progress_state['updated'] = datetime.now().isoformat()

    # Run backtest
    try:
        result = strategy.run(symbols, days, params, progress_callback)
        return _sanitize_for_json(result)
    except Exception as e:
        return {'error': str(e)}


def handle_get_chart_data(symbol: str, backtest_cache: Dict) -> Dict:
    """
    Handle GET /api/backtest/chart/{symbol}

    Args:
        symbol: Stock symbol
        backtest_cache: Cache containing candles and trades from last run

    Returns:
        Chart data for the symbol
    """
    if symbol not in backtest_cache.get('candles', {}):
        return {'error': f'No chart data for {symbol}. Run backtest first.'}

    if symbol not in backtest_cache.get('chart_data', {}):
        return {'error': f'No trade data for {symbol}'}

    try:
        candles_df = backtest_cache['candles'][symbol]
        trades = backtest_cache['chart_data'][symbol]['trades']
        or_minutes = backtest_cache.get('config', {}).get('params', {}).get('or_minutes', 45)

        chart_data = build_chart_data_for_symbol(symbol, candles_df, trades, or_minutes)
        return _sanitize_for_json(chart_data)
    except Exception as e:
        return {'error': str(e)}


def register_backtest_routes(handler_class, backtest_cache: Dict, progress_state: Dict):
    """
    Register backtest routes with the HTTP handler.

    Usage:
        class MyHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                if parsed.path.startswith('/api/backtest'):
                    handle_backtest_request(self, 'GET', ...)
    """
    # Routes are handled in api_server.py
    pass


class BacktestRequestHandler:
    """Helper class to handle backtest requests."""

    def __init__(self):
        self.backtest_cache = {}  # Stores candles, chart_data, config
        self.progress_state = {
            'current': 0,
            'total': 0,
            'message': '',
            'updated': None,
            'running': False,
        }

    def handle_request(self, method: str, path: str, query_params: Dict, body: Optional[Dict] = None) -> Dict:
        """
        Handle a backtest API request.

        Args:
            method: HTTP method (GET, POST)
            path: Request path
            query_params: Query parameters
            body: Request body (for POST)

        Returns:
            Response dict
        """
        parsed_path = path.rstrip('/')

        # GET /api/backtest/strategies
        if method == 'GET' and parsed_path == '/api/backtest/strategies':
            return handle_get_strategies()

        # GET /api/backtest/costs
        if method == 'GET' and parsed_path == '/api/backtest/costs':
            return handle_get_costs()

        # GET /api/backtest/progress
        if method == 'GET' and parsed_path == '/api/backtest/progress':
            return self.progress_state

        # POST /api/backtest/run
        if method == 'POST' and parsed_path == '/api/backtest/run':
            self.progress_state['running'] = True
            self.progress_state['current'] = 0
            self.progress_state['total'] = len(body.get('symbols', []))
            self.progress_state['message'] = 'Starting...'

            result = handle_run_backtest(body, self.progress_state)

            # Cache the result for chart data requests
            if 'error' not in result:
                self.backtest_cache = {
                    'candles': result.get('candles', {}),
                    'chart_data': result.get('chart_data', {}),
                    'config': result.get('config', {}),
                    'results': result.get('results', []),
                }

            self.progress_state['running'] = False
            return result

        # GET /api/backtest/chart/{symbol}
        if method == 'GET' and parsed_path.startswith('/api/backtest/chart/'):
            symbol = parsed_path.split('/')[-1]
            return handle_get_chart_data(symbol, self.backtest_cache)

        # GET /api/backtest/results
        if method == 'GET' and parsed_path == '/api/backtest/results':
            return {
                'results': self.backtest_cache.get('results', []),
                'config': self.backtest_cache.get('config', {}),
            }

        return {'error': 'Not found', 'path': path}
