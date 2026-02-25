"""
Trading Strategies for Backtesting

Available strategies:
- ORB: Opening Range Breakout
- SR Breakout: Support & Resistance Breakout using Pivot Points
- VWAP: Volume Weighted Average Price (future)
- Momentum: Momentum-based entries (future)
"""

from .base import BaseStrategy, StrategyParam
from .orb import ORBStrategy
from .sr_breakout import SRBreakoutStrategy

# Strategy registry
STRATEGIES = {
    'orb': ORBStrategy,
    'sr_breakout': SRBreakoutStrategy,
}


def get_strategy(strategy_id: str):
    """Get strategy class by ID."""
    return STRATEGIES.get(strategy_id)


def list_strategies():
    """List all available strategies with their metadata."""
    return [
        {
            'id': strategy_id,
            'name': strategy_class.get_name(),
            'description': strategy_class.get_description(),
            'params': [p.__dict__ for p in strategy_class.get_params()]
        }
        for strategy_id, strategy_class in STRATEGIES.items()
    ]


__all__ = [
    'BaseStrategy',
    'StrategyParam',
    'ORBStrategy',
    'SRBreakoutStrategy',
    'STRATEGIES',
    'get_strategy',
    'list_strategies',
]
