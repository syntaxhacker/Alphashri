"""
SR Breakout Signal Generator - Generate live trading signals for S/R Breakout strategy.

This module produces real-time entry and exit signals based on pivot point levels
computed from the previous day's high, low, and close.  It supports classic,
Fibonacci, and Camarilla pivot types and uses a configurable breakout buffer to
filter false breakouts.  Exit logic covers stop-loss, take-profit, and an EOD
force exit at 15:15 IST.

Entry distance guards (independent checks, applied per side):

- ``breakout_buffer_pct`` — MINIMUM trigger distance.  Price must be at least
  this far past the level (above R1 / below S1) before an entry fires at all.
- ``max_distance_from_r1_pct`` / ``max_distance_from_s1_pct`` — MAXIMUM chase
  distance.  If price is already further than this past the level, the entry
  is skipped: a breakout/breakdown that fired long ago is a chase at the
  extreme of the move and tends to mean-revert straight into the stop.
  (2026-10-16 evidence: shorts entered 2.5-14.4% below S1 and a long 4.8%
  above R1 all stopped out — hence the symmetric guard, default 2.0%.)
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
        # Maximum chase distance past the level, per side.  Symmetric guards:
        # the long default was tightened 5.0 -> 2.0 (a 4.8%-above-R1 entry
        # stopped out on 2026-10-16); the short guard is new for the same
        # reason (shorts entered up to 14.4% below S1 and all stopped out).
        self.max_distance_from_r1_pct = float(config.get("max_distance_from_r1_pct", 2.0))
        self.max_distance_from_s1_pct = float(config.get("max_distance_from_s1_pct", 2.0))
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

        # Minimum trigger distance: price must clear the level by at least the
        # buffer to fire (different check from the max-distance guards below).
        # Maximum chase distance (long): skip if price is too far above R1
        # (already ran up too much — late entry at the extreme of the move).
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

        # Maximum chase distance (short): skip if price is too far below S1
        # (already broke down too much — symmetric to the R1 guard above).
        # Without this, "Breakdown below S1" fired no matter how far below S1
        # price already was (2026-10-16: CCL entered 6.8% below S1, CYIENTDLM
        # 14.4% below — all stopped out).
        min_price = s1 * (1 - self.max_distance_from_s1_pct / 100)
        if current_price < min_price:
            return None

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


