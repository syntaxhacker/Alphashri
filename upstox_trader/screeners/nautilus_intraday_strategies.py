#!/usr/bin/env python3
"""
Intraday Trading Strategies for NautilusTrader

Contains multiple intraday strategies:
1. EMA Crossover Strategy - Fast/Slow EMA crossover for trend following
2. Previous Day Low/High (PDL/PDH) Breakout Strategy
3. Gap Up Strategy - Trade stocks gapping up at open
4. Opening Range Breakout - Trade breakouts of first 15/30 min range
5. VWAP Strategy - Trade based on VWAP support/resistance

This module has been split into modular parts in the 'nautilus' subpackage:
- nautilus.indicators: EMAIndicator, ATRIndicator, VWAPIndicator, etc.
- nautilus.strategies: All strategy classes
- nautilus.nautilus_intraday: Helper functions like get_ist_time_from_bar
- nautilus: Re-exports everything for convenience
"""

from upstox_trader.screeners.nautilus import (
    EMAIndicator,
    ATRIndicator,
    VWAPIndicator,
    PreviousDayLevelIndicator,
    OpeningRangeIndicator,
    IntradayStrategyConfig,
    EMACrossoverConfig,
    EMACrossoverStrategy,
    PDLPDHConfig,
    PDLPDHStrategy,
    GapUpConfig,
    GapUpStrategy,
    OpeningRangeConfig,
    OpeningRangeStrategy,
    VWAPConfig,
    VWAPStrategy,
    VWAPEnhancedConfig,
    VWAPEnhancedStrategy,
    get_ist_time_from_bar,
)


__all__ = [
    'EMAIndicator',
    'ATRIndicator',
    'VWAPIndicator',
    'PreviousDayLevelIndicator',
    'OpeningRangeIndicator',
    'IntradayStrategyConfig',
    'EMACrossoverConfig',
    'EMACrossoverStrategy',
    'PDLPDHConfig',
    'PDLPDHStrategy',
    'GapUpConfig',
    'GapUpStrategy',
    'OpeningRangeConfig',
    'OpeningRangeStrategy',
    'VWAPConfig',
    'VWAPStrategy',
    'VWAPEnhancedConfig',
    'VWAPEnhancedStrategy',
    'get_ist_time_from_bar',
]
