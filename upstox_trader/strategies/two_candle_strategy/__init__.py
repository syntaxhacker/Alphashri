"""
Two-Candle Trading Strategy Package

A simple yet effective intraday trading strategy based on comparing
the first two 15-minute candles of each trading day.

Classes:
    FixedTwoCandleStrategy: Main strategy implementation

Usage:
    from strategies.two_candle_strategy import FixedTwoCandleStrategy
    
    strategy = FixedTwoCandleStrategy()
    results = strategy.analyze_complete_strategy(data)
"""

from .strategy import FixedTwoCandleStrategy

__all__ = ['FixedTwoCandleStrategy']
__version__ = '1.0.0'