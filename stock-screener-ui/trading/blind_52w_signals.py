from typing import Optional

from trading.orb_signals import ORBSignal, SignalType
from trading.week52_utils import Base52WSignalGenerator


class Blind52WSignalGenerator(Base52WSignalGenerator):

    strategy_type: str = "BLIND_52W"

    def __init__(self, config: dict):
        self.near_high_threshold_pct = float(config.get("near_high_threshold_pct", 3.0))
        self.min_days_since_52w_high = int(config.get("min_days_since_52w_high", 20))
        self.max_holding_days = int(config.get("max_holding_days", 30))
        self.sl_pct = float(config.get("sl_pct", 5.0))
        self.min_avg_volume = float(config.get("min_avg_volume", 50000))
        super().__init__(sl_pct=self.sl_pct, tp_pct=0)

    def check_entry(self, symbol: str, market_data: dict) -> Optional[ORBSignal]:
        current_price = market_data.get("current_price")
        high_52w = market_data.get("high_52w")
        days_since = market_data.get("days_since_52w_high")

        if not all([current_price, high_52w, days_since is not None]):
            return None

        if self._safe_float(market_data, "avg_volume_20d") < self.min_avg_volume:
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
        sl, _ = self._calc_sl_tp("BUY", current_price)
        stop_loss = sl
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

        ek = self._extract_exit_kwargs(kwargs, current_price)
        days_in_position = ek["days_in_position"]
        max_holding_days = ek["max_holding_days"]
        if days_in_position >= max_holding_days:
            pnl_pct = self._calc_pnl_pct(position_side, entry_price, current_price)
            return self.create_signal(
                symbol=symbol,
                signal_type=SignalType.LONG_EXIT,
                price=round(current_price, 2),
                stop_loss=stop_loss,
                take_profit=take_profit,
                notes=self._format_exit_note(f"MAX_HOLDING ({max_holding_days}d)", pnl_pct),
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
                notes=self._format_exit_note(f"52W high target reached ₹{take_profit:.2f}", pnl_pct),
            )

        return None
