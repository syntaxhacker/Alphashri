"""
Base Signal Generator - Abstract base class for all signal generators.

Provides a common interface for generating entry and exit signals across
different strategies (ORB, SR_BREAKOUT, 52W_CHASER, TARGET, etc.).
Subclasses implement strategy-specific logic while sharing the signal
creation contract and reusing SignalType/ORBSignal from orb_signals.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import TYPE_CHECKING, Optional

import config

if TYPE_CHECKING:
    from trading.orb_signals import ORBSignal, SignalType


class BaseSignalGenerator(ABC):

    strategy_type: str

    def __init__(self, sl_pct: float = 1.0, tp_pct: float = 1.5,
                 eod_exit_hour: int = 14, eod_exit_minute: int = 45,
                 eod_entry_cutoff_minutes: int = 15):
        self.sl_pct = sl_pct
        self.tp_pct = tp_pct
        self.eod_exit_hour = eod_exit_hour
        self.eod_exit_minute = eod_exit_minute
        self.eod_entry_cutoff_minutes = eod_entry_cutoff_minutes

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

    def _calc_sl_tp(self, side: str, entry_price: float, sl_pct: float = None, tp_pct: float = None) -> tuple[float, float]:
        sl_pct = sl_pct if sl_pct is not None else self.sl_pct
        tp_pct = tp_pct if tp_pct is not None else self.tp_pct
        if side.upper() in ("BUY", "LONG"):
            sl = round(entry_price * (1 - sl_pct / 100), 2)
            tp = round(entry_price * (1 + tp_pct / 100), 2) if tp_pct > 0 else 0
        else:
            sl = round(entry_price * (1 + sl_pct / 100), 2)
            tp = round(entry_price * (1 - tp_pct / 100), 2) if tp_pct > 0 else 0
        return sl, tp

    @staticmethod
    def _safe_float(market_data: dict, key: str, default: float = 0.0) -> float:
        val = market_data.get(key, default)
        return float(val) if val is not None else default

    @staticmethod
    def _format_exit_note(reason: str, pnl_pct: float) -> str:
        return f"{reason} (PnL: {pnl_pct:+.2f}%)"

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
        from trading.orb_signals import SignalType

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
                notes=self._format_exit_note(f"EOD force exit ({self.eod_exit_hour}:{self.eod_exit_minute:02d})", pnl_pct),
            )

        if position_side == "BUY":
            pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
            if current_price <= stop_loss:
                return self.create_signal(symbol=symbol, signal_type=SignalType.LONG_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=self._format_exit_note(f"Stop loss hit ₹{stop_loss:.2f}", pnl_pct))
            if current_price >= take_profit:
                return self.create_signal(symbol=symbol, signal_type=SignalType.LONG_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=self._format_exit_note(f"Take profit hit ₹{take_profit:.2f}", pnl_pct))

        if position_side == "SELL":
            pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
            if current_price >= stop_loss:
                return self.create_signal(symbol=symbol, signal_type=SignalType.SHORT_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=self._format_exit_note(f"Stop loss hit ₹{stop_loss:.2f}", pnl_pct))
            if current_price <= take_profit:
                return self.create_signal(symbol=symbol, signal_type=SignalType.SHORT_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=self._format_exit_note(f"Take profit hit ₹{take_profit:.2f}", pnl_pct))

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
        from trading.orb_signals import ORBSignal
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
