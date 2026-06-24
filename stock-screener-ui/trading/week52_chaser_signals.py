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
from trading.week52_utils import Base52WSignalGenerator, calculate_52w_high


class Week52ChaserSignalGenerator(Base52WSignalGenerator):

    strategy_type = "52W_CHASER"

    def __init__(self, config: dict):
        self.sl_pct = float(config.get("sl_pct", 2.0))
        self.tp_pct = float(config.get("tp_pct", 3.0))
        self.entry_threshold_pct = float(config.get("entry_threshold_pct", 3.0))
        self.min_breakout_pct = float(config.get("min_breakout_pct") or 0.5)
        self.enable_trailing_stop = bool(config.get("enable_trailing_stop", False))
        self.trailing_stop_pct = float(config.get("trailing_stop_pct", 2.0))
        self.trailing_activation_pct = float(config.get("trailing_activation_pct", 3.0))
        self.max_holding_days = int(config.get("max_holding_days", 30))
        self.cooldown_days = int(config.get("cooldown_days", 30))
        self.enable_filters = bool(config.get("enable_filters", False))
        self.min_avg_volume = float(config.get("min_avg_volume", 50000))
        self.recent_touch_days = int(config.get("recent_touch_days", 3))
        super().__init__(sl_pct=self.sl_pct, tp_pct=self.tp_pct)

    def check_entry(self, symbol: str, market_data: dict) -> Optional[ORBSignal]:
        current_price = market_data.get("current_price")
        high_52w = market_data.get("high_52w")
        daily_highs: List[float] = market_data.get("daily_highs", [])

        if high_52w is None:
            high_52w = calculate_52w_high(daily_highs)

        if current_price is None or high_52w is None or current_price <= 0 or high_52w <= 0:
            return None

        if self._safe_float(market_data, "avg_volume_20d") < self.min_avg_volume:
            return None

        # Skip if 52W high was touched too recently (stale breakout)
        days_since = market_data.get("days_since_52w_high", 99)
        if days_since < self.recent_touch_days:
            return None

        # Chaser enters on confirmed breakout: price must be min_breakout_pct above the 52W high
        # (ensures SL at 52W high gives ~min_breakout_pct room) and not more than entry_threshold_pct above
        pct_above = ((current_price - high_52w) / high_52w) * 100
        if pct_above < self.min_breakout_pct or pct_above > self.entry_threshold_pct:
            return None

        if self.enable_filters and not self._check_filters(market_data, current_price):
            return None

        sl = high_52w  # SL at 52W high — breakout failed if price pulls back below
        _, tp = self._calc_sl_tp("BUY", current_price)

        vol = self._safe_float(market_data, "volume")
        avg_vol = self._safe_float(market_data, "avg_volume_20d")
        vol_ratio = round(vol / avg_vol, 2) if avg_vol > 0 else 0
        ma50 = self._safe_float(market_data, "ma50")
        ma200 = self._safe_float(market_data, "ma200")
        adx = self._safe_float(market_data, "adx")
        rsi = self._safe_float(market_data, "rsi")

        return self.create_signal(
            symbol=symbol,
            signal_type=SignalType.LONG_ENTRY,
            price=current_price,
            stop_loss=round(sl, 2),
            take_profit=round(tp, 2),
            or_high=round(high_52w, 2),
            or_low=0.0,
            or_range=round(current_price - high_52w, 2),
            or_range_pct=round(pct_above, 2),
            adx=adx,
            rsi=rsi,
            notes=f"Breakout above 52W high ₹{high_52w:.2f} (+{pct_above:.2f}%) | SL @ 52W high | TP {self.tp_pct}% | ADX {adx:.0f} RSI {rsi:.0f} | filters={'on' if self.enable_filters else 'off'} entry_range={self.min_breakout_pct}-{self.entry_threshold_pct}% vol_ratio={vol_ratio} ma50={ma50:.0f} ma200={ma200:.0f}",
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

        pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
        ek = self._extract_exit_kwargs(kwargs, current_price)
        days_in_position = ek["days_in_position"]
        max_holding_days = ek["max_holding_days"]
        highest_price = ek["highest_price_since_entry"]
        entry_52w_high = ek["entry_52w_high"]
        trailing_stop_pct = ek["trailing_stop_pct"]
        trailing_active = kwargs.get("trailing_active", False)
        current_52w_high = kwargs.get("current_52w_high")
        enable_trailing_stop = kwargs.get("enable_trailing_stop", self.enable_trailing_stop)
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
            notes=self._format_exit_note(f"Exit: {exit_reason}", pnl_pct),
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
