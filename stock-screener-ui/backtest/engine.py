"""
Backtest Engine

High-level wrapper for running backtests with NautilusTrader.
"""

from typing import Dict, List, Optional
from datetime import datetime


class BacktestEngine:
    """
    High-level backtest engine that manages strategy execution.
    """

    def __init__(self):
        self.last_results = None
        self.last_config = None
        self.last_run_time = None

    def list_strategies(self) -> List[Dict]:
        """Get list of available strategies."""
        from .strategies import list_strategies
        return list_strategies()

    def run(self, strategy_id: str, symbols: List[str], days: int,
            params: Dict = None, progress_callback=None) -> Dict:
        """
        Run a backtest.

        Args:
            strategy_id: Strategy identifier (e.g., 'orb')
            symbols: List of stock symbols
            days: Number of days of historical data
            params: Strategy-specific parameters
            progress_callback: Optional callback(current, total, message)

        Returns:
            Dict with results, chart_data, and metadata
        """
        if params is None:
            params = {}

        from .strategies import get_strategy
        strategy_class = get_strategy(strategy_id)
        if not strategy_class:
            raise ValueError(f"Unknown strategy: {strategy_id}")

        strategy = strategy_class()

        # Validate parameters
        errors = strategy.validate_params(params)
        if errors:
            raise ValueError(f"Invalid parameters: {errors}")

        # Run the backtest
        result = strategy.run(symbols, days, params, progress_callback)

        # Store results
        self.last_results = result
        self.last_config = {
            'strategy': strategy_id,
            'symbols': symbols,
            'days': days,
            'params': params,
        }
        self.last_run_time = datetime.now()

        return result

    def get_chart_data(self, symbol: str) -> Optional[Dict]:
        """
        Get chart data for a specific symbol from the last backtest.

        Args:
            symbol: Stock symbol

        Returns:
            Chart data dict or None if not available
        """
        from .chart_data import build_chart_data_for_symbol

        if not self.last_results:
            return None

        candles = self.last_results.get('candles', {}).get(symbol)
        chart_data = self.last_results.get('chart_data', {}).get(symbol)

        if not candles or not chart_data:
            return None

        or_minutes = self.last_config.get('params', {}).get('or_minutes', 45)
        return build_chart_data_for_symbol(symbol, candles, chart_data.get('trades', []), or_minutes)


# Global instance for convenience
_engine_instance = None


def get_engine() -> BacktestEngine:
    """Get the global backtest engine instance."""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = BacktestEngine()
    return _engine_instance
