"""
TradingView Screeners Package
============================

Modular TradingView screener implementation with:
- tv_base.py: Main screener class
- tv_utils.py: Utilities and helpers
- tv_alerts.py: Alert and telegram management
- tv_trading.py: Paper trading functionality
- tv_strategies.py: Different screening strategies
"""

try:
    from .tv_base import TVScreener
    __all__ = ['TVScreener']
except ImportError:
    # tv_base not available, skip import
    __all__ = []
