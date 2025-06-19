from .base_strategy import BaseStrategy
from .trend_following import TrendFollowingStrategy
from .mean_reversion import MeanReversionStrategy
from .scalping import ScalpingStrategy
from .breakout_strategy import BreakoutStrategy

class StrategyFactory:
    @staticmethod
    def create_strategy(strategy_name: str, **kwargs) -> BaseStrategy:
        """Create a strategy instance based on the strategy name"""
        if strategy_name == 'trend_following':
            return TrendFollowingStrategy(**kwargs)
        elif strategy_name == 'mean_reversion':
            return MeanReversionStrategy(**kwargs)
        elif strategy_name == 'scalping':
            return ScalpingStrategy(**kwargs)
        elif strategy_name == 'breakoutstrategy':
            return BreakoutStrategy(**kwargs)
        else:
            raise ValueError(f"Unknown strategy: {strategy_name}") 