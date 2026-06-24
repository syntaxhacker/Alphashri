"""
52-Week Target Signal Generator - Live signal generation for the 52W Target swing strategy.

Generates entry and exit signals based on proximity to 52-week rolling highs.
Long only, daily timeframe. Uses tight trailing stop once price exceeds
the 52W high snapshot captured at entry time. Stop loss is always active.
"""

from datetime import datetime
from typing import Dict, List, Optional

from trading.orb_signals import ORBSignal, SignalType
from trading.week52_utils import Base52WSignalGenerator, calculate_52w_high


class Week52TargetSignalGenerator(Base52WSignalGenerator):

    strategy_type: str = "52W_TARGET"

    def __init__(self, config: dict):
        self.sl_pct: float = float(config.get("sl_pct", 2.0))
        self.tp_pct: float = float(config.get("tp_pct", 0.0))
        self.entry_threshold_pct: float = float(config.get("entry_threshold_pct", 2.0))
        self.trailing_stop_pct: float = float(config.get("trailing_stop_pct", 2.0))
        self.near_high_activation_pct: float = float(config.get("near_high_activation_pct", 1.0))
        self.near_high_trail_pct: float = float(config.get("near_high_trail_pct", 0.5))
        self.max_holding_days: int = int(config.get("max_holding_days", 15))
        self.cooldown_days: int = int(config.get("cooldown_days", 7))
        self.recent_touch_days: int = int(config.get("recent_touch_days", 5))
        self.min_avg_volume: float = float(config.get("min_avg_volume", 50000))
        super().__init__(sl_pct=self.sl_pct, tp_pct=self.tp_pct)

    def check_entry(
        self,
        symbol: str,
        market_data: dict,
    ) -> Optional[ORBSignal]:
        current_price = market_data.get("current_price")
        high_52w = market_data.get("high_52w")
        daily_highs: List[float] = market_data.get("daily_highs", [])

        if current_price is None:
            return None

        if self._safe_float(market_data, "avg_volume_20d") < self.min_avg_volume:
            return None

        # Use provided high_52w from market_data first (includes latest completed bar),
        # fall back to calculation from daily_highs if not provided
        calculated_high = None
        if high_52w is not None:
            calculated_high = high_52w
        elif daily_highs:
            calculated_high = calculate_52w_high(daily_highs, exclude_current=False)

        if calculated_high is None or calculated_high <= 0:
            return None

        # Target buys BELOW the 52W high, sells at it
        if current_price > calculated_high:
            return None

        # Skip if 52W high was recently touched (target already achieved)
        days_since = market_data.get("days_since_52w_high", 99)
        if days_since < self.recent_touch_days:
            return None

        entry_threshold = calculated_high * (1 - self.entry_threshold_pct / 100)
        if current_price < entry_threshold:
            return None

        sl, _ = self._calc_sl_tp("BUY", current_price)
        stop_loss = sl
        # No TP — let the trailing stop manage exits once near/above the 52W high
        take_profit = 0.0

        vol = self._safe_float(market_data, "volume")
        avg_vol = self._safe_float(market_data, "avg_volume_20d")
        vol_ratio = round(vol / avg_vol, 2) if avg_vol > 0 else 0
        ma50 = self._safe_float(market_data, "ma50")
        ma200 = self._safe_float(market_data, "ma200")
        rsi = self._safe_float(market_data, "rsi")

        return self.create_signal(
            symbol=symbol,
            signal_type=SignalType.LONG_ENTRY,
            price=round(current_price, 2),
            stop_loss=stop_loss,
            take_profit=take_profit,
            or_high=round(calculated_high, 2),
            notes=f"52W Target: ₹{current_price:.2f} towards 52W high ₹{calculated_high:.2f} ({(calculated_high - current_price) / current_price * 100:.1f}% upside) | SL {self.sl_pct}% trail {self.near_high_trail_pct}%/{self.trailing_stop_pct}% | thresh={self.entry_threshold_pct}% vol_ratio={vol_ratio} rsi={rsi:.0f} ma50={ma50:.0f} ma200={ma200:.0f}",
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
        if position_side != "BUY":
            return None

        ek = self._extract_exit_kwargs(kwargs, current_price)
        days_in_position = ek["days_in_position"]
        max_holding_days = ek["max_holding_days"]
        highest_price_since_entry = ek["highest_price_since_entry"]
        entry_52w_high = ek["entry_52w_high"]
        trailing_stop_pct = ek["trailing_stop_pct"]
        near_high_activation_pct: float = kwargs.get("near_high_activation_pct", self.near_high_activation_pct)
        near_high_trail_pct: float = kwargs.get("near_high_trail_pct", self.near_high_trail_pct)
        sl_pct: float = kwargs.get("sl_pct", self.sl_pct)

        exit_reason = None

        sl_price = entry_price * (1 - sl_pct / 100)
        if current_price <= sl_price:
            exit_reason = "SL"

        # Two-tier trailing: tight trail near the 52W high, wider trail above it
        if exit_reason is None and entry_52w_high is not None and entry_52w_high > 0:
            near_high_threshold = entry_52w_high * (1 - near_high_activation_pct / 100)
            if current_price >= near_high_threshold:
                trail_pct = trailing_stop_pct if current_price > entry_52w_high else near_high_trail_pct
                trailing_stop_price = highest_price_since_entry * (1 - trail_pct / 100)
                if current_price <= trailing_stop_price:
                    exit_reason = "TRAILING_STOP"

        if exit_reason is None and days_in_position >= max_holding_days:
            exit_reason = "MAX_HOLDING"

        if exit_reason is None:
            return None

        pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
        return self.create_signal(
            symbol=symbol,
            signal_type=SignalType.LONG_EXIT,
            price=round(current_price, 2),
            stop_loss=stop_loss,
            take_profit=take_profit,
            notes=self._format_exit_note(f"52W Target exit: {exit_reason}", pnl_pct),
        )
