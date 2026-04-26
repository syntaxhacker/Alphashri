#!/usr/bin/env python3
"""
Gap Analysis Module - Backward Compatibility Re-export
Split into modular parts:
- gap/gap_models.py: Data classes and models
- gap/gap_detector.py: Gap detection logic
- gap/gap_analyzer.py: Main GapAnalysis class
- gap/gap_trading.py: Trading signal generation
- gap/__init__.py: Re-exports all components
"""

from upstox_trader.screeners.core.gap import (
    GapFillResult,
    ReversalSignal,
    GapTradeSignal,
    GapAlert,
    TradeInfo,
    GapDetector,
    GapTrader,
    GapAnalysis,
)

__all__ = [
    'GapFillResult',
    'ReversalSignal',
    'GapTradeSignal',
    'GapAlert',
    'TradeInfo',
    'GapDetector',
    'GapTrader',
    'GapAnalysis',
]
