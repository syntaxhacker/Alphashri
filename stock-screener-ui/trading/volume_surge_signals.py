"""
Volume Surge Breakout — Live Signal Generator (Swing).

Entry: Daily volume > min_volume_ratio × avg_volume_20d AND close in upper
range AND stock above MA50. Captures institutional accumulation days.
Exit: SL, TP, or max holding.
"""
from typing import Optional, List
from trading.orb_signals import ORBSignal, SignalType
from trading.base_signals import BaseSignalGenerator


class VolumeSurgeSignalGenerator(BaseSignalGenerator):

    strategy_type = "VOLUME_SURGE"

    def __init__(self, config: dict):
        self.sl_pct = float(config.get("sl_pct", 5.0))
        self.tp_pct = float(config.get("tp_pct", 8.0))
        self.min_volume_ratio = float(config.get("min_volume_ratio", 2.0))
        self.min_wick_close_pct = float(config.get("min_wick_close_pct", 50.0))
        self.min_adx = float(config.get("min_adx", 20.0))
        self.max_holding_days = int(config.get("max_holding_days", 15))
        self.cooldown_days = int(config.get("cooldown_days", 10))
        self.enable_shorts = bool(config.get("enable_shorts", False))
        self.require_ma50 = bool(config.get("require_ma50", True))
        super().__init__(sl_pct=self.sl_pct, tp_pct=self.tp_pct)

    def check_entry(self, symbol: str, market_data: dict) -> Optional[ORBSignal]:
        cp = market_data.get("current_price")
        vol = market_data.get("volume", 0)
        avg_vol = market_data.get("avg_volume_20d", 0)
        daily_highs: List[float] = market_data.get("daily_highs", [])
        daily_closes: List[float] = market_data.get("daily_closes", [])
        daily_lows: List[float] = market_data.get("daily_lows", [])
        ma50 = market_data.get("ma50", 0)
        adx = market_data.get("adx", 0)

        if not all([cp, vol, avg_vol, daily_highs, daily_closes]):
            return None

        # Volume surge check
        vol_ratio = vol / avg_vol if avg_vol > 0 else 0
        if vol_ratio < self.min_volume_ratio:
            return None

        # Green candle check
        prev_close = daily_closes[-2] if len(daily_closes) >= 2 else cp
        day_open = daily_closes[-2] if len(daily_closes) >= 2 else cp
        # Approximate open from previous close (daily data)
        if cp <= prev_close:
            return None

        # Close in upper range
        day_high = daily_highs[-1] if daily_highs else cp
        day_low = daily_lows[-1] if daily_lows else cp * 0.95
        day_range = day_high - day_low
        if day_range > 0:
            wick_close = ((cp - day_low) / day_range) * 100
            if wick_close < self.min_wick_close_pct:
                return None
        else:
            wick_close = 50.0

        # MA50 filter
        if self.require_ma50 and ma50 > 0 and cp < ma50:
            return None

        # ADX filter (optional — if adx is available)
        if adx is not None and adx > 0 and adx < self.min_adx:
            return None

        sl, tp = self._calc_sl_tp("BUY", cp)

        notes = (
            f"Volume surge {vol_ratio:.1f}x avg | "
            f"Close ₹{cp:.2f} (upper {wick_close:.0f}% of range) | "
            f"ADX {adx:.0f} | SL {self.sl_pct}% TP {self.tp_pct}%"
        )

        return self.create_signal(
            symbol=symbol, signal_type=SignalType.LONG_ENTRY,
            price=cp, stop_loss=sl, take_profit=tp,
            adx=adx, score=round(vol_ratio * 10 + wick_close * 0.3, 2),
            notes=notes,
        )

    def check_exit(self, symbol, position_side, entry_price, stop_loss, take_profit, current_price, **kwargs):
        if entry_price <= 0 or current_price <= 0:
            return None
        pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
        days_in_position = kwargs.get("days_in_position", 0)
        max_holding = kwargs.get("max_holding_days", self.max_holding_days)

        if pnl_pct >= self.tp_pct:
            exit_type = SignalType.LONG_EXIT if position_side == "BUY" else SignalType.SHORT_EXIT
            return self.create_signal(symbol=symbol, signal_type=exit_type, price=current_price,
                stop_loss=stop_loss, take_profit=take_profit,
                notes=self._format_exit_note("TP", pnl_pct))
        if pnl_pct <= -self.sl_pct:
            exit_type = SignalType.LONG_EXIT if position_side == "BUY" else SignalType.SHORT_EXIT
            return self.create_signal(symbol=symbol, signal_type=exit_type, price=current_price,
                stop_loss=stop_loss, take_profit=take_profit,
                notes=self._format_exit_note("SL", pnl_pct))
        if days_in_position >= max_holding:
            exit_type = SignalType.LONG_EXIT if position_side == "BUY" else SignalType.SHORT_EXIT
            return self.create_signal(symbol=symbol, signal_type=exit_type, price=current_price,
                stop_loss=stop_loss, take_profit=take_profit,
                notes=self._format_exit_note("MAX_HOLDING", pnl_pct))

        return None
