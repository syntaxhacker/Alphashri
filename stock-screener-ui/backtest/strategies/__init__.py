"""
Trading Strategies for Backtesting

Available strategies:
- ORB: Opening Range Breakout
- SR Breakout: Support & Resistance Breakout using Pivot Points
- 52W Chaser: 52-Week High Breakout (Swing Trading)
- 52W Target: Hold until 52W High reached
- EMA Cross: Exponential Moving Average Crossover
"""

from .base import BaseStrategy, StrategyParam
from .orb import ORBStrategy
from .sr_breakout import SRBreakoutStrategy
from .week52_chaser import Week52ChaserStrategy
from .week52_target import Week52TargetStrategy
from .ema_cross import EMACrossStrategy

# Strategy registry
STRATEGIES = {
    'orb': ORBStrategy,
    'sr_breakout': SRBreakoutStrategy,
    '52w_chaser': Week52ChaserStrategy,
    '52w_target': Week52TargetStrategy,
    'ema_cross': EMACrossStrategy,
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
    'Week52ChaserStrategy',
    'Week52TargetStrategy',
    'EMACrossStrategy',
    'STRATEGIES',
    'get_strategy',
    'list_strategies',
]
