"""
Backtesting Module for Stock Screener UI

Provides strategy backtesting with:
- Multiple strategy support (ORB, VWAP, etc.)
- Realistic Indian trading costs
- Chart data generation for visualization
"""

from .engine import BacktestEngine
from .costs import calculate_trading_costs, get_cost_breakdown
from .api import register_backtest_routes

__all__ = [
    'BacktestEngine',
    'calculate_trading_costs',
    'get_cost_breakdown',
    'register_backtest_routes',
]
