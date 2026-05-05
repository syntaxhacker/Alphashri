"""
52-Week High Chaser - Live Signal Generator.

Generates entry and exit signals for the 52-week high chaser swing strategy.
Long only. Uses daily data. Entry when price is within a threshold of the
rolling 52-week high. Exits via stop-loss, take-profit, trailing stop,
max holding period, or momentum-fade detection.
"""

from datetime import datetime
from typing import Dict, List, Optional

from trading.orb_signals import ORBSignal, SignalType
from trading.base_signals import BaseSignalGenerator
from trading.week52_utils import calculate_52w_high


class Week52ChaserSignalGenerator(BaseSignalGenerator):

    strategy_type = "52W_CHASER"

    def __init__(self, config: dict):
        self.sl_pct = float(config.get("sl_pct", 2.0))
        self.tp_pct = float(config.get("tp_pct", 3.0))
        self.entry_threshold_pct = float(config.get("entry_threshold_pct", 3.0))
        self.enable_trailing_stop = bool(config.get("enable_trailing_stop", False))
        self.trailing_stop_pct = float(config.get("trailing_stop_pct", 2.0))
        self.trailing_activation_pct = float(config.get("trailing_activation_pct", 3.0))
        self.max_holding_days = int(config.get("max_holding_days", 30))
        self.cooldown_days = int(config.get("cooldown_days", 30))
        self.enable_filters = bool(config.get("enable_filters", False))
        super().__init__(sl_pct=self.sl_pct, tp_pct=self.tp_pct)

    def check_entry(self, symbol: str, market_data: dict) -> Optional[ORBSignal]:
        current_price = market_data.get("current_price")
        high_52w = market_data.get("high_52w")
        daily_highs: List[float] = market_data.get("daily_highs", [])

        # Use provided high_52w or calculate from daily_highs using shared utility
        if high_52w is None:
            high_52w = calculate_52w_high(daily_highs)

        if current_price is None or high_52w is None or current_price <= 0:
            return None

        distance_pct = ((high_52w - current_price) / current_price) * 100

        if distance_pct < 0 or distance_pct > self.entry_threshold_pct:
            return None

        if self.enable_filters and not self._check_filters(market_data, current_price):
            return None

        sl = current_price * (1 - self.sl_pct / 100)
        tp = current_price * (1 + self.tp_pct / 100)

        return self.create_signal(
            symbol=symbol,
            signal_type=SignalType.LONG_ENTRY,
            price=current_price,
            stop_loss=round(sl, 2),
            take_profit=round(tp, 2),
            or_high=round(high_52w, 2),
            or_low=0.0,
            or_range=round(high_52w - current_price, 2),
            or_range_pct=round(distance_pct, 2),
            adx=float(market_data.get("adx", 0.0) or 0.0),
            rsi=float(market_data.get("rsi", 0.0) or 0.0),
            notes=f"Within {distance_pct:.2f}% of 52W high ₹{high_52w:.2f} | SL {self.sl_pct}% TP {self.tp_pct}% | ADX {float(market_data.get('adx', 0.0) or 0.0):.0f} RSI {float(market_data.get('rsi', 0.0) or 0.0):.0f}",
        )

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
        if position_side != "BUY" or entry_price <= 0 or current_price <= 0:
            return None

        pnl_pct = ((current_price - entry_price) / entry_price) * 100
        highest_price = kwargs.get("highest_price_since_entry", current_price)
        trailing_active = kwargs.get("trailing_active", False)
        entry_52w_high = kwargs.get("entry_52w_high")
        current_52w_high = kwargs.get("current_52w_high")
        days_in_position = kwargs.get("days_in_position", 0)
        max_holding_days = kwargs.get("max_holding_days", self.max_holding_days)
        enable_trailing_stop = kwargs.get("enable_trailing_stop", self.enable_trailing_stop)
        trailing_stop_pct = kwargs.get("trailing_stop_pct", self.trailing_stop_pct)
        exit_reason = None

        if enable_trailing_stop and not trailing_active and entry_52w_high is not None:
            if current_price >= entry_52w_high:
                trailing_active = True

        if not trailing_active and pnl_pct >= self.tp_pct:
            exit_reason = "TP"
        elif enable_trailing_stop and trailing_active and highest_price is not None:
            trailing_stop_price = highest_price * (1 - trailing_stop_pct / 100)
            if current_price <= trailing_stop_price:
                exit_reason = "TRAILING_STOP"
        elif not trailing_active and pnl_pct <= -self.sl_pct:
            exit_reason = "SL"
        elif days_in_position >= max_holding_days:
            exit_reason = "MAX_HOLDING"
        elif entry_52w_high is not None and current_52w_high is not None:
            if current_52w_high > entry_52w_high * 1.10:
                exit_reason = "NEW_52W_HIGH"

        if exit_reason is None:
            return None

        return self.create_signal(
            symbol=symbol,
            signal_type=SignalType.LONG_EXIT,
            price=current_price,
            stop_loss=stop_loss,
            take_profit=take_profit,
            notes=f"Exit: {exit_reason} (PnL: {pnl_pct:+.2f}%)",
        )

    def _check_filters(self, market_data: dict, current_price: float) -> bool:
        adx = market_data.get("adx")
        rsi = market_data.get("rsi")
        volume = market_data.get("volume")
        avg_volume_20d = market_data.get("avg_volume_20d")
        ma50 = market_data.get("ma50")
        ma200 = market_data.get("ma200")

        if adx is not None and adx < 25:
            return False

        if rsi is not None and (rsi < 50 or rsi > 70):
            return False

        if avg_volume_20d is not None and avg_volume_20d > 0 and volume is not None:
            if volume < avg_volume_20d * 1.5:
                return False

        if ma50 is not None and current_price < ma50:
            return False

        if ma200 is not None and current_price < ma200:
            return False

        return True
