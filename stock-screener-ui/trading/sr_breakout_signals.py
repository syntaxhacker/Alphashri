"""
SR Breakout Signal Generator - Generate live trading signals for S/R Breakout strategy.

This module produces real-time entry and exit signals based on pivot point levels
computed from the previous day's high, low, and close.  It supports classic,
Fibonacci, and Camarilla pivot types and uses a configurable breakout buffer to
filter false breakouts.  Exit logic covers stop-loss, take-profit, and an EOD
force exit at 15:15 IST.
"""

from typing import Dict, Optional

from trading.orb_signals import ORBSignal, SignalType
from trading.base_signals import BaseSignalGenerator
from trading.pivot_utils import calculate_pivot_points as _calculate_pivot_points


class SRBreakoutSignalGenerator(BaseSignalGenerator):

    strategy_type = "SR_BREAKOUT"

    def __init__(self, config: dict):
        self.sl_pct = config.get("sl_pct", 1.5)
        self.tp_pct = config.get("tp_pct", 2.5)
        self.pivot_type = config.get("pivot_type", "classic")
        self.breakout_buffer_pct = config.get("breakout_buffer_pct", 1.0)
        self.max_distance_from_r1_pct = float(config.get("max_distance_from_r1_pct", 5.0))
        eod_hour = int(config.get("eod_exit_hour", 15))
        eod_minute = int(config.get("eod_exit_minute", 15))
        super().__init__(sl_pct=self.sl_pct, tp_pct=self.tp_pct,
                         eod_exit_hour=eod_hour, eod_exit_minute=eod_minute)

    def calculate_pivot_points(
        self, prev_high: float, prev_low: float, prev_close: float
    ) -> dict:
        """Calculate pivot points using shared utility from pivot_utils."""
        result = _calculate_pivot_points(prev_high, prev_low, prev_close, self.pivot_type)
        points: Dict[str, float] = {
            "PP": round(result.pp, 2),
            "R1": round(result.r1, 2),
            "R2": round(result.r2, 2),
            "R3": round(result.r3, 2),
            "S1": round(result.s1, 2),
            "S2": round(result.s2, 2),
            "S3": round(result.s3, 2),
        }
        if self.pivot_type == "camarilla":
            points["R4"] = round(result.r4, 2) if result.r4 else None
            points["S4"] = round(result.s4, 2) if result.s4 else None
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

        # Skip if price is too far above R1 (already ran up too much)
        max_price = r1 * (1 + self.max_distance_from_r1_pct / 100)
        if current_price > max_price:
            return None

        if current_price > r1 * (1 + buf):
            sl, default_tp = self._calc_sl_tp("BUY", current_price)
            r2 = pivot_points.get("R2")
            tp = r2 if r2 and r2 > current_price else default_tp
            return self.create_signal(
                symbol=symbol,
                signal_type=SignalType.LONG_ENTRY,
                price=current_price,
                stop_loss=sl,
                take_profit=tp,
                notes=f"Breakout above R1 ₹{r1:.2f} -> TP=R2 ₹{tp:.2f} | {self.pivot_type} pivots | SL {self.sl_pct}% buffer {self.breakout_buffer_pct}%" if r2 and r2 > current_price else f"Breakout above R1 ₹{r1:.2f} | {self.pivot_type} pivots | SL {self.sl_pct}% buffer {self.breakout_buffer_pct}%",
            )

        if current_price < s1 * (1 - buf):
            sl, default_tp = self._calc_sl_tp("SELL", current_price)
            s2 = pivot_points.get("S2")
            tp = s2 if s2 and s2 < current_price else default_tp
            return self.create_signal(
                symbol=symbol,
                signal_type=SignalType.SHORT_ENTRY,
                price=current_price,
                stop_loss=sl,
                take_profit=tp,
                notes=f"Breakdown below S1 ₹{s1:.2f} -> TP=S2 ₹{tp:.2f} | {self.pivot_type} pivots | SL {self.sl_pct}% buffer {self.breakout_buffer_pct}%" if s2 and s2 < current_price else f"Breakdown below S1 ₹{s1:.2f} | {self.pivot_type} pivots | SL {self.sl_pct}% buffer {self.breakout_buffer_pct}%",
            )

        return None


