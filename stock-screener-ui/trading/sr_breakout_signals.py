"""
SR Breakout Signal Generator - Generate live trading signals for S/R Breakout strategy.

This module produces real-time entry and exit signals based on pivot point levels
computed from the previous day's high, low, and close.  It supports classic,
Fibonacci, and Camarilla pivot types and uses a configurable breakout buffer to
filter false breakouts.  Exit logic covers stop-loss, take-profit, and an EOD
force exit at 15:15 IST.
"""

from datetime import datetime
from typing import Dict, Optional

import config

from trading.orb_signals import ORBSignal, SignalType
from trading.base_signals import BaseSignalGenerator


class SRBreakoutSignalGenerator(BaseSignalGenerator):

    strategy_type = "SR_BREAKOUT"
    FORCE_EXIT = (15, 15)

    def __init__(self, config: dict):
        self.sl_pct = config.get("sl_pct", 0.5)
        self.tp_pct = config.get("tp_pct", 1.5)
        self.pivot_type = config.get("pivot_type", "classic")
        self.breakout_buffer_pct = config.get("breakout_buffer_pct", 0.1)
        super().__init__(sl_pct=self.sl_pct, tp_pct=self.tp_pct)

    def calculate_pivot_points(
        self, prev_high: float, prev_low: float, prev_close: float
    ) -> dict:
        if self.pivot_type == "classic":
            pp = (prev_high + prev_low + prev_close) / 3
            r1 = 2 * pp - prev_low
            s1 = 2 * pp - prev_high
            r2 = pp + (prev_high - prev_low)
            s2 = pp - (prev_high - prev_low)
            r3 = prev_high + 2 * (pp - prev_low)
            s3 = prev_low - 2 * (prev_high - pp)
        elif self.pivot_type == "fibonacci":
            pp = (prev_high + prev_low + prev_close) / 3
            hl = prev_high - prev_low
            r1 = pp + 0.382 * hl
            s1 = pp - 0.382 * hl
            r2 = pp + 0.618 * hl
            s2 = pp - 0.618 * hl
            r3 = pp + hl
            s3 = pp - hl
        elif self.pivot_type == "camarilla":
            pp = (prev_high + prev_low + prev_close) / 3
            hl = prev_high - prev_low
            r1 = prev_high + 0.0917 * hl
            r2 = prev_high + 0.183 * hl
            r3 = prev_high + 0.275 * hl
            r4 = prev_high + 0.55 * hl
            s1 = prev_low - 0.0917 * hl
            s2 = prev_low - 0.183 * hl
            s3 = prev_low - 0.275 * hl
            s4 = prev_low - 0.55 * hl
        else:
            pp = (prev_high + prev_low + prev_close) / 3
            r1 = 2 * pp - prev_low
            s1 = 2 * pp - prev_high
            r2 = pp + (prev_high - prev_low)
            s2 = pp - (prev_high - prev_low)
            r3 = prev_high + 2 * (pp - prev_low)
            s3 = prev_low - 2 * (prev_high - pp)

        points: Dict[str, float] = {
            "PP": round(pp, 2),
            "R1": round(r1, 2),
            "R2": round(r2, 2),
            "R3": round(r3, 2),
            "S1": round(s1, 2),
            "S2": round(s2, 2),
            "S3": round(s3, 2),
        }
        if self.pivot_type == "camarilla":
            points["R4"] = round(r4, 2)
            points["S4"] = round(s4, 2)
        return points

    def check_entry(
        self, symbol: str, market_data: dict
    ) -> Optional[ORBSignal]:
        current_price = market_data.get("current_price")
        pivot_points = market_data.get("pivot_points")
        if current_price is None or pivot_points is None:
            return None

        r1 = pivot_points.get("R1")
        s1 = pivot_points.get("S1")
        if r1 is None or s1 is None:
            return None

        buf = self.breakout_buffer_pct / 100

        if current_price > r1 * (1 + buf):
            sl = current_price * (1 - self.sl_pct / 100)
            tp = current_price * (1 + self.tp_pct / 100)
            return self.create_signal(
                symbol=symbol,
                signal_type=SignalType.LONG_ENTRY,
                price=current_price,
                stop_loss=round(sl, 2),
                take_profit=round(tp, 2),
                notes=f"Breakout above R1 ({r1:.2f}) with {self.breakout_buffer_pct}% buffer",
            )

        if current_price < s1 * (1 - buf):
            sl = current_price * (1 + self.sl_pct / 100)
            tp = current_price * (1 - self.tp_pct / 100)
            return self.create_signal(
                symbol=symbol,
                signal_type=SignalType.SHORT_ENTRY,
                price=current_price,
                stop_loss=round(sl, 2),
                take_profit=round(tp, 2),
                notes=f"Breakdown below S1 ({s1:.2f}) with {self.breakout_buffer_pct}% buffer",
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

        if hour > self.FORCE_EXIT[0] or (hour == self.FORCE_EXIT[0] and minute >= self.FORCE_EXIT[1]):
            exit_type = SignalType.LONG_EXIT if position_side == "BUY" else SignalType.SHORT_EXIT
            return self.create_signal(
                symbol=symbol,
                signal_type=exit_type,
                price=current_price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                notes="EOD force exit (15:15)",
            )

        if position_side == "BUY":
            if current_price <= stop_loss:
                return self.create_signal(
                    symbol=symbol,
                    signal_type=SignalType.LONG_EXIT,
                    price=current_price,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    notes="Stop loss hit",
                )
            if current_price >= take_profit:
                return self.create_signal(
                    symbol=symbol,
                    signal_type=SignalType.LONG_EXIT,
                    price=current_price,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    notes="Take profit hit",
                )

        if position_side == "SELL":
            if current_price >= stop_loss:
                return self.create_signal(
                    symbol=symbol,
                    signal_type=SignalType.SHORT_EXIT,
                    price=current_price,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    notes="Stop loss hit",
                )
            if current_price <= take_profit:
                return self.create_signal(
                    symbol=symbol,
                    signal_type=SignalType.SHORT_EXIT,
                    price=current_price,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    notes="Take profit hit",
                )

        return None
