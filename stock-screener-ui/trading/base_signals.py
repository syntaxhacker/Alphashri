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

    def __init__(self, sl_pct: float = 0.4, tp_pct: float = 1.2,
                 eod_exit_hour: int = 14, eod_exit_minute: int = 45):
        self.sl_pct = sl_pct
        self.tp_pct = tp_pct
        self.eod_exit_hour = eod_exit_hour
        self.eod_exit_minute = eod_exit_minute

    def is_eod_exit_time(self, hour: int, minute: int) -> bool:
        return hour > self.eod_exit_hour or (hour == self.eod_exit_hour and minute >= self.eod_exit_minute)

    @abstractmethod
    def check_entry(self, symbol: str, market_data: dict) -> Optional[ORBSignal]:
        pass

    def _get_current_time(self, **kwargs):
        now = kwargs.get("timestamp", datetime.now(config.IST))
        if isinstance(now, datetime):
            return now.hour, now.minute
        now = datetime.now(config.IST)
        return now.hour, now.minute

    def _calc_pnl_pct(self, position_side: str, entry_price: float, current_price: float) -> float:
        if not entry_price:
            return 0.0
        pnl_pct = ((current_price - entry_price) / entry_price) * 100
        if position_side == "SELL":
            pnl_pct = -pnl_pct
        return pnl_pct

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
        hour, minute = self._get_current_time(**kwargs)

        if self.is_eod_exit_time(hour, minute):
            exit_type = SignalType.LONG_EXIT if position_side == "BUY" else SignalType.SHORT_EXIT
            pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
            return self.create_signal(
                symbol=symbol,
                signal_type=exit_type,
                price=current_price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                notes=f"EOD force exit ({self.eod_exit_hour}:{self.eod_exit_minute:02d}) (PnL: {pnl_pct:+.2f}%)",
            )

        if position_side == "BUY":
            pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
            if current_price <= stop_loss:
                return self.create_signal(symbol=symbol, signal_type=SignalType.LONG_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=f"Stop loss hit ₹{stop_loss:.2f} (PnL: {pnl_pct:+.2f}%)")
            if current_price >= take_profit:
                return self.create_signal(symbol=symbol, signal_type=SignalType.LONG_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=f"Take profit hit ₹{take_profit:.2f} (PnL: {pnl_pct:+.2f}%)")

        if position_side == "SELL":
            pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
            if current_price >= stop_loss:
                return self.create_signal(symbol=symbol, signal_type=SignalType.SHORT_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=f"Stop loss hit ₹{stop_loss:.2f} (PnL: {pnl_pct:+.2f}%)")
            if current_price <= take_profit:
                return self.create_signal(symbol=symbol, signal_type=SignalType.SHORT_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=f"Take profit hit ₹{take_profit:.2f} (PnL: {pnl_pct:+.2f}%)")

        return None

    def create_signal(
        self,
        symbol: str,
        signal_type: SignalType,
        price: float,
        stop_loss: float,
        take_profit: float,
        notes: str = "",
        timestamp: Optional[datetime] = None,
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
            timestamp=timestamp or datetime.now(config.IST),
            atr_pct=extra_fields.get("atr_pct", 0.0),
            adx=extra_fields.get("adx", 0.0),
            rsi=extra_fields.get("rsi", 0.0),
            score=extra_fields.get("score", 0.0),
            notes=notes,
        )
