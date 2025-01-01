from .base_strategy import BaseStrategy
from .trend_following import TrendFollowingStrategy
from .mean_reversion import MeanReversionStrategy
from .scalping import ScalpingStrategy

class StrategyFactory:
    @staticmethod
    def create_strategy(strategy_name: str) -> BaseStrategy:
        """Create a strategy instance based on the strategy name"""
        if strategy_name == 'trend_following':
            return TrendFollowingStrategy()
        elif strategy_name == 'mean_reversion':
            return MeanReversionStrategy()
        elif strategy_name == 'scalping':
            return ScalpingStrategy()
        else:
            raise ValueError(f"Unknown strategy: {strategy_name}") 