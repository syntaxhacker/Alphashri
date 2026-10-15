"""
52-Week High Chaser - Live Signal Generator.

Generates entry and exit signals for the 52-week high chaser swing strategy.
Long only. Uses daily data. Entry when price is within a threshold of the
rolling 52-week high. Exits via stop-loss, take-profit, trailing stop,
max holding period, or momentum-fade detection.
"""

from datetime import datetime
import logging
import math
from typing import Dict, List, Optional

from trading.orb_signals import ORBSignal, SignalType
from trading.week52_utils import Base52WSignalGenerator, calculate_52w_high

logger = logging.getLogger(__name__)


# Canonical 52W Chaser filter defaults — single source of truth.
#
# The backtest Nautilus strategy (backtest/strategies/week52_chaser.py) imports
# these constants so the live-signal path and the backtest path screen the same
# thing. The backtest page / UI only exposes `enable_filters` (default False,
# matching both `Week52ChaserStrategy.get_params()` and the generator default
# below); the thresholds below are deliberately NOT user-tunable — they are the
# ablation winners:
#   - ADX >= 25 kept (optimal operating point; do NOT loosen).
#   - RSI upper veto loosened 70 -> 75: the RSI>70 veto killed ~1.73pp profit per
#     noise trade avoided and is conceptually backwards for a momentum-chaser.
#   - Volume >= 1.8x 20d average: the only positive single-setting gate.
#   - MA200 / MA50 / RSI lower-bound gates REMOVED: ablation showed they pass
#     ~100% of chaser candidates (zero discrimination) — dead code kept as
#     filters would only add maintenance surface and false confidence.
#   - enable_filters default False everywhere (UI backtestDefaults.ts,
#     Week52ChaserStrategy.get_params(), Week52ChaserConfig, generator).
CHASER_ADX_MIN = 25.0
CHASER_RSI_HI = 75.0
CHASER_VOLUME_MULT = 1.8
CHASER_ENABLE_FILTERS_DEFAULT = False


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
        self.enable_filters = bool(config.get("enable_filters", CHASER_ENABLE_FILTERS_DEFAULT))
        self.adx_min = float(config.get("adx_min", CHASER_ADX_MIN))
        self.rsi_hi = float(config.get("rsi_hi", CHASER_RSI_HI))
        self.volume_mult = float(config.get("volume_mult", CHASER_VOLUME_MULT))
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
        """Trend/momentum gates. Fail CLOSED: missing or NaN inputs veto the trade.

        Active gates (ablation winners): ADX >= adx_min, RSI <= rsi_hi,
        volume >= volume_mult * 20d average. MA50/MA200/RSI-low gates were
        removed (passed ~100% — zero discrimination).
        """
        adx = market_data.get("adx")
        rsi = market_data.get("rsi")
        volume = market_data.get("volume")
        avg_volume_20d = market_data.get("avg_volume_20d")

        if adx is None or (isinstance(adx, float) and math.isnan(adx)):
            logger.debug("chaser filter veto: adx missing/NaN")
            return False
        if adx < self.adx_min:
            logger.debug("chaser filter veto: adx %.2f < %.2f", adx, self.adx_min)
            return False

        if rsi is None or (isinstance(rsi, float) and math.isnan(rsi)):
            logger.debug("chaser filter veto: rsi missing/NaN")
            return False
        if rsi > self.rsi_hi:
            logger.debug("chaser filter veto: rsi %.2f > %.2f", rsi, self.rsi_hi)
            return False

        if (
            volume is None
            or avg_volume_20d is None
            or (isinstance(volume, float) and math.isnan(volume))
            or (isinstance(avg_volume_20d, float) and math.isnan(avg_volume_20d))
            or avg_volume_20d <= 0
        ):
            logger.debug("chaser filter veto: volume baseline missing/NaN/non-positive")
            return False
        if volume < avg_volume_20d * self.volume_mult:
            logger.debug(
                "chaser filter veto: volume %.0f < %.2f * avg %.0f",
                volume, self.volume_mult, avg_volume_20d,
            )
            return False

        return True
