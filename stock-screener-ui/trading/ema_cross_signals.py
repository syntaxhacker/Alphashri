"""
EMA Crossover Signal Generator - Generate live trading signals for EMA Cross strategy.

Generates entry and exit signals based on exponential moving average crossovers.
Long when fast EMA crosses above slow EMA, short when fast crosses below.
Uses intraday (5-min) candle data. Exits via SL/TP or EOD force exit.
"""

from datetime import datetime
from typing import Optional

import config

from trading.orb_signals import ORBSignal, SignalType
from trading.base_signals import BaseSignalGenerator


class EMACrossSignalGenerator(BaseSignalGenerator):

    strategy_type = "EMA_CROSS"

    def __init__(self, config: dict):
        self.ema_fast_period = int(config.get("ema_fast_period", 9))
        self.ema_slow_period = int(config.get("ema_slow_period", 21))
        self.sl_pct = float(config.get("sl_pct", 0.5))
        self.tp_pct = float(config.get("tp_pct", 1.5))
        eod_hour = int(config.get("eod_exit_hour", 14))
        eod_minute = int(config.get("eod_exit_minute", 45))
        super().__init__(sl_pct=self.sl_pct, tp_pct=self.tp_pct,
                         eod_exit_hour=eod_hour, eod_exit_minute=eod_minute)

    @staticmethod
    def calculate_ema(closes: list, period: int) -> list:
        if not closes:
            return []
        multiplier = 2.0 / (period + 1)
        ema = [closes[0]]
        for price in closes[1:]:
            ema.append(price * multiplier + ema[-1] * (1 - multiplier))
        return ema

    def check_entry(self, symbol: str, market_data: dict) -> Optional[ORBSignal]:
        current_price = market_data.get("current_price")
        ema_fast_current = market_data.get("ema_fast_current")
        ema_fast_prev = market_data.get("ema_fast_prev")
        ema_slow_current = market_data.get("ema_slow_current")
        ema_slow_prev = market_data.get("ema_slow_prev")

        if any(v is None for v in [current_price, ema_fast_current, ema_fast_prev, ema_slow_current, ema_slow_prev]):
            return None

        bullish_cross = ema_fast_prev <= ema_slow_prev and ema_fast_current > ema_slow_current
        bearish_cross = ema_fast_prev >= ema_slow_prev and ema_fast_current < ema_slow_current

        if bullish_cross:
            sl = current_price * (1 - self.sl_pct / 100)
            tp = current_price * (1 + self.tp_pct / 100)
            gap = ema_fast_current - ema_slow_current
            return self.create_signal(
                symbol=symbol,
                signal_type=SignalType.LONG_ENTRY,
                price=current_price,
                stop_loss=round(sl, 2),
                take_profit=round(tp, 2),
                notes=f"Bullish EMA{self.ema_fast_period}/{self.ema_slow_period} cross at ₹{current_price:.2f} | gap {gap:.2f} | SL {self.sl_pct}% TP {self.tp_pct}%",
                score=gap,
            )

        if bearish_cross:
            sl = current_price * (1 + self.sl_pct / 100)
            tp = current_price * (1 - self.tp_pct / 100)
            gap = ema_slow_current - ema_fast_current
            return self.create_signal(
                symbol=symbol,
                signal_type=SignalType.SHORT_ENTRY,
                price=current_price,
                stop_loss=round(sl, 2),
                take_profit=round(tp, 2),
                notes=f"Bearish EMA{self.ema_fast_period}/{self.ema_slow_period} cross at ₹{current_price:.2f} | gap {gap:.2f} | SL {self.sl_pct}% TP {self.tp_pct}%",
                score=gap,
            )

        return None

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
        now = kwargs.get("timestamp", datetime.now(config.IST))
        if isinstance(now, datetime):
            hour, minute = now.hour, now.minute
        else:
            hour, minute = datetime.now(config.IST).hour, datetime.now(config.IST).minute

        if self.is_eod_exit_time(hour, minute):
            exit_type = SignalType.LONG_EXIT if position_side == "BUY" else SignalType.SHORT_EXIT
            pnl_pct = ((current_price - entry_price) / entry_price) * 100 if entry_price else 0
            if position_side == "SELL":
                pnl_pct = -pnl_pct
            return self.create_signal(
                symbol=symbol,
                signal_type=exit_type,
                price=current_price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                notes=f"EOD force exit ({self.eod_exit_hour}:{self.eod_exit_minute:02d}) (PnL: {pnl_pct:+.2f}%)",
            )

        if position_side == "BUY":
            pnl_pct = ((current_price - entry_price) / entry_price) * 100 if entry_price else 0
            if current_price <= stop_loss:
                return self.create_signal(symbol=symbol, signal_type=SignalType.LONG_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=f"Stop loss hit ₹{stop_loss:.2f} (PnL: {pnl_pct:+.2f}%)")
            if current_price >= take_profit:
                return self.create_signal(symbol=symbol, signal_type=SignalType.LONG_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=f"Take profit hit ₹{take_profit:.2f} (PnL: {pnl_pct:+.2f}%)")

        if position_side == "SELL":
            pnl_pct = ((entry_price - current_price) / entry_price) * 100 if entry_price else 0
            if current_price >= stop_loss:
                return self.create_signal(symbol=symbol, signal_type=SignalType.SHORT_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=f"Stop loss hit ₹{stop_loss:.2f} (PnL: {pnl_pct:+.2f}%)")
            if current_price <= take_profit:
                return self.create_signal(symbol=symbol, signal_type=SignalType.SHORT_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=f"Take profit hit ₹{take_profit:.2f} (PnL: {pnl_pct:+.2f}%)")

        return None
