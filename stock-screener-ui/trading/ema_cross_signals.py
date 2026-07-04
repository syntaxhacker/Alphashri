"""
EMA Crossover Signal Generator - Generate live trading signals for EMA Cross strategy.

Generates entry and exit signals based on exponential moving average crossovers.
Long when fast EMA crosses above slow EMA, short when fast crosses below.
Uses intraday (5-min) candle data. Exits via SL/TP or EOD force exit.
"""

from typing import Optional

from trading.orb_signals import ORBSignal, SignalType
from trading.base_signals import BaseSignalGenerator
from trading.ema_utils import calculate_ema as _calculate_ema


class EMACrossSignalGenerator(BaseSignalGenerator):

    strategy_type = "EMA_CROSS"

    def __init__(self, config: dict):
        self.ema_fast_period = int(config.get("ema_fast_period", 9))
        self.ema_slow_period = int(config.get("ema_slow_period", 21))
        self.ema_interval_minutes = int(config.get("ema_interval_minutes", config.get("or_minutes", 5)))
        self.sl_pct = float(config.get("sl_pct", 1.0))
        self.tp_pct = float(config.get("tp_pct", 1.5))
        self.enable_shorts = bool(config.get("enable_shorts", False))
        cd_minutes = int(config.get("cooldown_minutes", config.get("cooldown_bars", 3)))
        self.cooldown_bars = max(1, cd_minutes // self.ema_interval_minutes)  # convert minutes to bars
        eod_hour = int(config.get("eod_exit_hour", 14))
        eod_minute = int(config.get("eod_exit_minute", 45))
        super().__init__(sl_pct=self.sl_pct, tp_pct=self.tp_pct,
                         eod_exit_hour=eod_hour, eod_exit_minute=eod_minute)
        self._last_exit_bar = None
        self._last_signal_bar = None
        self._bar_number = 0

    @staticmethod
    def calculate_ema(closes: list, period: int) -> list:
        """Wrapper for backward compatibility. Delegates to shared utility."""
        return _calculate_ema(closes, period, return_full=True)

    def check_entry(self, symbol: str, market_data: dict) -> Optional[ORBSignal]:
        current_price = market_data.get("current_price")
        ema_fast_current = market_data.get("ema_fast_current")
        ema_fast_prev = market_data.get("ema_fast_prev")
        ema_slow_current = market_data.get("ema_slow_current")
        ema_slow_prev = market_data.get("ema_slow_prev")

        if any(v is None for v in [current_price, ema_fast_current, ema_fast_prev, ema_slow_current, ema_slow_prev]):
            return None

        # Rate-limit: only one signal per EMA interval bar (prevents re-triggering
        # on every 5-min scan when using wider timeframes like 60-min)
        min_bars_between_signals = max(1, self.ema_interval_minutes // 5)
        if self._last_signal_bar is not None and (self._bar_number - self._last_signal_bar) < min_bars_between_signals:
            return None

        # Check cooldown after exit
        self._bar_number += 1
        if self._last_exit_bar is not None and self.cooldown_bars > 0:
            if (self._bar_number - self._last_exit_bar) < self.cooldown_bars:
                return None

        bullish_cross = ema_fast_prev <= ema_slow_prev and ema_fast_current > ema_slow_current
        bearish_cross = ema_fast_prev >= ema_slow_prev and ema_fast_current < ema_slow_current

        if bullish_cross:
            self._last_signal_bar = self._bar_number
            sl, tp = self._calc_sl_tp("BUY", current_price)
            gap = ema_fast_current - ema_slow_current
            return self.create_signal(
                symbol=symbol,
                signal_type=SignalType.LONG_ENTRY,
                price=current_price,
                stop_loss=sl,
                take_profit=tp,
                notes=f"Bullish EMA{self.ema_fast_period}/{self.ema_slow_period} cross at ₹{current_price:.2f} | gap {gap:.2f} | SL {self.sl_pct}% TP {self.tp_pct}%",
                score=gap,
            )

        if bearish_cross and self.enable_shorts:
            self._last_signal_bar = self._bar_number
            sl, tp = self._calc_sl_tp("SELL", current_price)
            gap = ema_slow_current - ema_fast_current
            return self.create_signal(
                symbol=symbol,
                signal_type=SignalType.SHORT_ENTRY,
                price=current_price,
                stop_loss=sl,
                take_profit=tp,
                notes=f"Bearish EMA{self.ema_fast_period}/{self.ema_slow_period} cross at ₹{current_price:.2f} | gap {gap:.2f} | SL {self.sl_pct}% TP {self.tp_pct}%",
                score=gap,
            )

        return None

    def record_exit(self) -> None:
        """Record exit event for cooldown tracking. Call after position is closed."""
        self._last_exit_bar = self._bar_number


