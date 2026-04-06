#!/usr/bin/env python3
"""
Gap Analysis Data Models
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any


@dataclass
class GapFillResult:
    probability: float = 50.0
    historical_data: str = 'unavailable'
    total_similar_gaps: int = 0
    filled_gaps: int = 0
    avg_fill_percentage: float = 0.0
    lookback_days: int = 90


@dataclass
class ReversalSignal:
    reversal_strength: int = 0
    signals: List[str] = field(default_factory=list)
    recommendation: str = 'SKIP'
    latest_candle: Optional[Dict[str, float]] = None
    analysis_time: str = ''


@dataclass
class GapTradeSignal:
    action: str = 'SKIP'
    confidence: float = 0.0
    reason: str = ''
    gap_fill_prob: float = 50.0
    sr_probability: float = 0.0
    reversal_strength: int = 0


@dataclass
class GapAlert:
    ticker: str = ''
    name: str = ''
    price: float = 0.0
    change: float = 0.0
    type: str = 'GAP_FILL_TRADE'
    confidence: float = 0.0
    gap_direction: str = 'UP'
    reversal_strength: int = 0
    reason: str = ''


@dataclass
class TradeInfo:
    timestamp: Any = None
    symbol: str = ''
    side: str = ''
    price: float = 0.0
    quantity: int = 0
    amount: float = 0.0
    alert_type: str = 'GAP_FILL'
    confidence: float = 0.0
    gap_size: float = 0.0
    reason: str = ''
