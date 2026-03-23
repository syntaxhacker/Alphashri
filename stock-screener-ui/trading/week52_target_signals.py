"""
52-Week Target Signal Generator - Live signal generation for the 52W Target swing strategy.

Generates entry and exit signals based on proximity to 52-week rolling highs.
Long only, daily timeframe. Uses tight trailing stop once price exceeds
the 52W high snapshot captured at entry time. Stop loss is always active.
"""

from datetime import datetime
from typing import Dict, List, Optional

from trading.orb_signals import ORBSignal, SignalType
from trading.base_signals import BaseSignalGenerator


class Week52TargetSignalGenerator(BaseSignalGenerator):

    strategy_type: str = "52W_TARGET"

    def __init__(self, config: dict):
        self.sl_pct: float = float(config.get("sl_pct", 2.0))
        self.tp_pct: float = float(config.get("tp_pct", 0.0))
        self.entry_threshold_pct: float = float(config.get("entry_threshold_pct", 2.0))
        self.trailing_stop_pct: float = float(config.get("trailing_stop_pct", 0.5))
        self.max_holding_days: int = int(config.get("max_holding_days", 15))
        self.cooldown_days: int = int(config.get("cooldown_days", 7))
        super().__init__(sl_pct=self.sl_pct, tp_pct=self.tp_pct)

    def check_entry(
        self,
        symbol: str,
        market_data: dict,
    ) -> Optional[ORBSignal]:
        current_price = market_data.get("current_price")
        high_52w = market_data.get("high_52w")
        daily_highs: List[float] = market_data.get("daily_highs", [])

        if current_price is None or high_52w is None:
            return None

        calculated_high = high_52w
        if daily_highs:
            window = daily_highs[-252:]
            calculated_high = max(window)

        entry_threshold = calculated_high * (1 - self.entry_threshold_pct / 100)

        if current_price < entry_threshold:
            return None

        stop_loss = round(current_price * (1 - self.sl_pct / 100), 2)
        # TP intentionally unreachable; exits managed entirely by trailing stop.
        take_profit = round(current_price * 10, 2)

        return self.create_signal(
            symbol=symbol,
            signal_type=SignalType.LONG_ENTRY,
            price=round(current_price, 2),
            stop_loss=stop_loss,
            take_profit=take_profit,
            or_high=round(calculated_high, 2),
            notes=f"52W Target entry: price={current_price:.2f}, 52W high={calculated_high:.2f}, "
                  f"within {self.entry_threshold_pct}% threshold",
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

        highest_price_since_entry: float = kwargs.get("highest_price_since_entry", current_price)
        entry_52w_high: Optional[float] = kwargs.get("entry_52w_high")
        days_in_position: int = kwargs.get("days_in_position", 0)
        max_holding_days: int = kwargs.get("max_holding_days", self.max_holding_days)
        trailing_stop_pct: float = kwargs.get("trailing_stop_pct", self.trailing_stop_pct)
        sl_pct: float = kwargs.get("sl_pct", self.sl_pct)

        exit_reason = None

        sl_price = entry_price * (1 - sl_pct / 100)
        if current_price <= sl_price:
            exit_reason = "SL"

        if exit_reason is None and entry_52w_high is not None:
            if current_price > entry_52w_high:
                trailing_stop_price = highest_price_since_entry * (1 - trailing_stop_pct / 100)
                if current_price <= trailing_stop_price:
                    exit_reason = "TRAILING_STOP"

        if exit_reason is None and days_in_position >= max_holding_days:
            exit_reason = "MAX_HOLDING"

        if exit_reason is None:
            return None

        return self.create_signal(
            symbol=symbol,
            signal_type=SignalType.LONG_EXIT,
            price=round(current_price, 2),
            stop_loss=stop_loss,
            take_profit=take_profit,
            notes=f"52W Target exit: {exit_reason}",
        )
