from typing import Optional

from trading.orb_signals import ORBSignal, SignalType
from trading.base_signals import BaseSignalGenerator


class Blind52WSignalGenerator(BaseSignalGenerator):

    strategy_type: str = "BLIND_52W"

    def __init__(self, config: dict):
        self.near_high_threshold_pct = float(config.get("near_high_threshold_pct", 3.0))
        self.min_days_since_52w_high = int(config.get("min_days_since_52w_high", 20))
        self.max_holding_days = int(config.get("max_holding_days", 30))
        self.sl_pct = float(config.get("sl_pct", 5.0))
        eod_hour = int(config.get("eod_exit_hour", 15))
        eod_minute = int(config.get("eod_exit_minute", 30))
        super().__init__(sl_pct=self.sl_pct, tp_pct=0, eod_exit_hour=eod_hour, eod_exit_minute=eod_minute)

    def check_entry(self, symbol: str, market_data: dict) -> Optional[ORBSignal]:
        current_price = market_data.get("current_price")
        high_52w = market_data.get("high_52w")
        days_since = market_data.get("days_since_52w_high")

        if not all([current_price, high_52w, days_since is not None]):
            return None

        # Already at or above 52W high — no entry
        if current_price >= high_52w:
            return None

        pct_from_high = (high_52w - current_price) / high_52w * 100

        if pct_from_high > self.near_high_threshold_pct:
            return None

        if days_since < self.min_days_since_52w_high:
            return None

        take_profit = round(high_52w, 2)
        stop_loss = round(current_price * (1 - self.sl_pct / 100), 2)
        return self.create_signal(
            symbol=symbol,
            signal_type=SignalType.LONG_ENTRY,
            price=round(current_price, 2),
            stop_loss=stop_loss,
            take_profit=take_profit,
            or_high=round(high_52w, 2),
            notes=f"Blind 52W: {pct_from_high:.1f}% below 52W high ₹{high_52w:.2f}, {days_since}d drought | threshold={self.near_high_threshold_pct}% min_days={self.min_days_since_52w_high}",
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

        hour, minute = self._get_current_time(**kwargs)
        if self.is_eod_exit_time(hour, minute):
            pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
            return self.create_signal(
                symbol=symbol,
                signal_type=SignalType.LONG_EXIT,
                price=round(current_price, 2),
                stop_loss=stop_loss,
                take_profit=take_profit,
                notes=f"EOD exit ({self.eod_exit_hour}:{self.eod_exit_minute:02d}) (PnL: {pnl_pct:+.2f}%)",
            )

        days_in_position: int = kwargs.get("days_in_position", 0)
        max_holding_days: int = kwargs.get("max_holding_days", self.max_holding_days)
        if days_in_position >= max_holding_days:
            pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
            return self.create_signal(
                symbol=symbol,
                signal_type=SignalType.LONG_EXIT,
                price=round(current_price, 2),
                stop_loss=stop_loss,
                take_profit=take_profit,
                notes=f"MAX_HOLDING ({max_holding_days}d) (PnL: {pnl_pct:+.2f}%)",
            )

        # Exit when target (52W high) is reached
        if take_profit > 0 and current_price >= take_profit:
            pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
            return self.create_signal(
                symbol=symbol,
                signal_type=SignalType.LONG_EXIT,
                price=round(current_price, 2),
                stop_loss=stop_loss,
                take_profit=take_profit,
                notes=f"52W high target reached ₹{take_profit:.2f} (PnL: {pnl_pct:+.2f}%)",
            )

        return None
