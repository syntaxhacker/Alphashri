"""
Base Signal Generator - Abstract base class for all signal generators.

Provides a common interface for generating entry and exit signals across
different strategies (ORB, SR_BREAKOUT, 52W_CHASER, TARGET, etc.).
Subclasses implement strategy-specific logic while sharing the signal
creation contract and reusing SignalType/ORBSignal from orb_signals.
"""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

import config

from trading.orb_signals import ORBSignal, SignalType


class BaseSignalGenerator(ABC):

    strategy_type: str

    def __init__(self, sl_pct: float = 0.4, tp_pct: float = 1.2):
        self.sl_pct = sl_pct
        self.tp_pct = tp_pct

    @abstractmethod
    def check_entry(self, symbol: str, market_data: dict) -> Optional[ORBSignal]:
        pass

    @abstractmethod
    def check_exit(
        self,
        symbol: str,
        position_side: str,
        entry_price: float,
        stop_loss: float,
        take_profit: float,
        current_price: float,
        **kwargs,
    ) -> Optional[ORBSignal]:
        pass

    def create_signal(
        self,
        symbol: str,
        signal_type: SignalType,
        price: float,
        stop_loss: float,
        take_profit: float,
        notes: str = "",
        **extra_fields,
    ) -> ORBSignal:
        return ORBSignal(
            symbol=symbol,
            signal_type=signal_type,
            price=price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            or_high=extra_fields.get("or_high", 0.0),
            or_low=extra_fields.get("or_low", 0.0),
            or_range=extra_fields.get("or_range", 0.0),
            or_range_pct=extra_fields.get("or_range_pct", 0.0),
            timestamp=datetime.now(config.IST),
            atr_pct=extra_fields.get("atr_pct", 0.0),
            adx=extra_fields.get("adx", 0.0),
            rsi=extra_fields.get("rsi", 0.0),
            score=extra_fields.get("score", 0.0),
            notes=notes,
        )
