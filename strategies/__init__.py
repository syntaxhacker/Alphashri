"""
Trading Strategies Package
Unified interface for all trading strategies
"""

from .base_strategy import BaseStrategy
from .bar_updn_strategy import BarUpDnStrategy  
from .breakout_strategy import BreakoutStrategy

__all__ = ['BaseStrategy', 'BarUpDnStrategy', 'BreakoutStrategy'] 
