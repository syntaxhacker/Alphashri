"""
Short 52W Failed Breakout — Live Signal Generator.

Entry: Price breaks above the 52W high (new high made), then closes back below it.
The breakout failed — momentum couldn't sustain, enter short.
Exit: SL above the failed breakout level, TP at 5% below 52W high, or max holding.
"""
from typing import Optional, List
from trading.orb_signals import ORBSignal, SignalType
from trading.week52_utils import Base52WSignalGenerator, calculate_52w_high


class Short52WFailedSignalGenerator(Base52WSignalGenerator):

    strategy_type = "SHORT_52W_FAILED"

    def __init__(self, config: dict):
        self.sl_pct = float(config.get("sl_pct", 3.0))
        self.tp_pct = float(config.get("tp_pct", 5.0))
        self.max_holding_days = int(config.get("max_holding_days", 15))
        self.cooldown_days = int(config.get("cooldown_days", 15))
        self.lookback_days = int(config.get("lookback_days", 5))  # how far back to check for new high
        super().__init__(sl_pct=self.sl_pct, tp_pct=self.tp_pct)

    def check_entry(self, symbol: str, market_data: dict) -> Optional[ORBSignal]:
        current_price = market_data.get("current_price")
        high_52w = market_data.get("high_52w")
        daily_highs: List[float] = market_data.get("daily_highs", [])

        if current_price is None or high_52w is None or current_price <= 0 or high_52w <= 0:
            return None
        if len(daily_highs) < 260:
            return None

        # Check if a NEW 52W high was made recently (within lookback_days)
        # Look at the last `lookback_days` highs (excluding current bar)
        recent_highs = daily_highs[-(self.lookback_days + 1):-1]  # exclude current
        if not recent_highs:
            return None

        # Find the highest bar among recent highs
        recent_peak = max(recent_highs)

        # Get the 52W high BEFORE that peak (to confirm it's a new record)
        peak_idx = daily_highs.index(recent_peak) if recent_highs else -1
        if peak_idx < 252:
            return None
        prior_52w = calculate_52w_high(daily_highs[:peak_idx], period=252, exclude_current=True)
        if prior_52w is None or prior_52w <= 0:
            return None

        # FAILED BREAKOUT: recent high was a NEW 52W high, and price has now fallen back below it
        is_new_record = recent_peak > prior_52w * 1.001  # 0.1% above prior high
        has_failed = current_price < recent_peak * 0.99  # 1% below the peak

        if not is_new_record or not has_failed:
            return None

        # SL above the failed breakout level (1.5x sl_pct above recent peak)
        sl = round(recent_peak * (1 + self.sl_pct / 100), 2)
        _, tp = self._calc_sl_tp("SELL", current_price)

        return self.create_signal(
            symbol=symbol,
            signal_type=SignalType.SHORT_ENTRY,
            price=current_price,
            stop_loss=sl,
            take_profit=tp,
            or_high=round(recent_peak, 2),
            or_low=round(high_52w, 2),
            or_range=round(recent_peak - current_price, 2),
            or_range_pct=round((recent_peak - current_price) / recent_peak * 100, 2),
            notes=f"52W failed breakout: new high ₹{recent_peak:.2f} failed → short at ₹{current_price:.2f} | SL {self.sl_pct}% TP {self.tp_pct}%",
        )

    def check_exit(self, symbol, position_side, entry_price, stop_loss, take_profit, current_price, **kwargs):
        if position_side != "SELL" or entry_price <= 0 or current_price <= 0:
            return None

        pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
        days_in_position = kwargs.get("days_in_position", 0)
        max_holding = kwargs.get("max_holding_days", self.max_holding_days)

        if pnl_pct >= self.tp_pct:
            return self.create_signal(symbol=symbol, signal_type=SignalType.SHORT_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=self._format_exit_note("TP", pnl_pct))
        if pnl_pct <= -self.sl_pct:
            return self.create_signal(symbol=symbol, signal_type=SignalType.SHORT_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=self._format_exit_note("SL", pnl_pct))
        if days_in_position >= max_holding:
            return self.create_signal(symbol=symbol, signal_type=SignalType.SHORT_EXIT, price=current_price, stop_loss=stop_loss, take_profit=take_profit, notes=self._format_exit_note("MAX_HOLDING", pnl_pct))

        return None
