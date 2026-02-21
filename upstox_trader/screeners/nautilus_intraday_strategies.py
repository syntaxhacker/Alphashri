#!/usr/bin/env python3
"""
Intraday Trading Strategies for NautilusTrader

Contains multiple intraday strategies:
1. EMA Crossover Strategy - Fast/Slow EMA crossover for trend following
2. Previous Day Low/High (PDL/PDH) Breakout Strategy
3. Gap Up Strategy - Trade stocks gapping up at open
4. Opening Range Breakout - Trade breakouts of first 15/30 min range
5. VWAP Strategy - Trade based on VWAP support/resistance
"""

from decimal import Decimal
from typing import Optional, List
from dataclasses import dataclass, field

import pandas as pd
import numpy as np

from nautilus_trader.config import StrategyConfig
from nautilus_trader.core.data import Data
from nautilus_trader.indicators.base.indicator import Indicator
from nautilus_trader.model import Bar, BarType, InstrumentId, Quantity
from nautilus_trader.model.enums import OrderSide
from nautilus_trader.model.instruments import Instrument
from nautilus_trader.trading.strategy import Strategy


def get_ist_time_from_bar(bar: Bar) -> str:
    """Convert bar timestamp from UTC (Nautilus internal) to IST (HH:MM format).

    Nautilus stores timestamps as unix nanoseconds in UTC.
    Indian market hours (IST): 09:15 - 15:30
    In UTC this is: 03:45 - 10:00
    """
    if bar.ts_event is None:
        return "00:00"

    try:
        # ts_event is a unix nanosecond timestamp
        ts_ns = int(bar.ts_event)
        # Convert to seconds
        ts_sec = ts_ns / 1_000_000_000

        # Get UTC time
        from datetime import datetime, timezone
        dt_utc = datetime.fromtimestamp(ts_sec, tz=timezone.utc)

        # Convert to IST (UTC+5:30)
        from datetime import timedelta
        dt_ist = dt_utc + timedelta(hours=5, minutes=30)

        return dt_ist.strftime("%H:%M")
    except Exception:
        return "00:00"


# ============================================================================
# INDICATORS
# ============================================================================

class EMAIndicator(Indicator):
    """Exponential Moving Average indicator."""

    def __init__(self, period: int = 20):
        super().__init__(params=[period])
        self.period = period
        self._multiplier = 2.0 / (period + 1)
        self._ema: Optional[float] = None
        self._count = 0

    def handle_bar(self, bar: Bar) -> None:
        close = float(bar.close)
        if self._ema is None:
            self._ema = close
        else:
            self._ema = (close * self._multiplier) + (self._ema * (1 - self._multiplier))
        self._count += 1
        self._set_has_inputs(True)

    @property
    def value(self) -> Optional[float]:
        return self._ema

    def is_initialized(self) -> bool:
        return self._count >= self.period

    def reset(self) -> None:
        self._ema = None
        self._count = 0


class ATRIndicator(Indicator):
    """Average True Range indicator."""

    def __init__(self, period: int = 14):
        super().__init__(params=[period])
        self.period = period
        self._tr_values: List[float] = []
        self._atr: Optional[float] = None
        self._prev_close: Optional[float] = None
        self._count = 0

    def handle_bar(self, bar: Bar) -> None:
        high = float(bar.high)
        low = float(bar.low)
        close = float(bar.close)

        if self._prev_close is not None:
            tr = max(
                high - low,
                abs(high - self._prev_close),
                abs(low - self._prev_close)
            )
        else:
            tr = high - low

        self._tr_values.append(tr)
        if len(self._tr_values) > self.period:
            self._tr_values.pop(0)

        if len(self._tr_values) == self.period:
            self._atr = sum(self._tr_values) / self.period
        elif len(self._tr_values) > 0:
            self._atr = sum(self._tr_values) / len(self._tr_values)

        self._prev_close = close
        self._count += 1
        self._set_has_inputs(True)

    @property
    def value(self) -> Optional[float]:
        return self._atr

    def is_initialized(self) -> bool:
        return self._count >= self.period

    def reset(self) -> None:
        self._tr_values = []
        self._atr = None
        self._prev_close = None
        self._count = 0


class VWAPIndicator(Indicator):
    """Volume Weighted Average Price indicator (resets daily)."""

    def __init__(self):
        super().__init__(params=[])
        self._cum_tp_volume = 0.0
        self._cum_volume = 0.0
        self._vwap: Optional[float] = None
        self._last_date: Optional[str] = None
        self._count = 0

    def handle_bar(self, bar: Bar) -> None:
        # Reset on new day
        current_date = str(bar.ts_event)[:10] if bar.ts_event else None
        if self._last_date and current_date != self._last_date:
            self._cum_tp_volume = 0.0
            self._cum_volume = 0.0

        self._last_date = current_date

        # Typical price
        tp = (float(bar.high) + float(bar.low) + float(bar.close)) / 3
        volume = float(bar.volume)

        self._cum_tp_volume += tp * volume
        self._cum_volume += volume

        if self._cum_volume > 0:
            self._vwap = self._cum_tp_volume / self._cum_volume

        self._count += 1
        self._set_has_inputs(True)

    @property
    def value(self) -> Optional[float]:
        return self._vwap

    def is_initialized(self) -> bool:
        return self._count >= 5  # Need at least a few bars

    def reset(self) -> None:
        self._cum_tp_volume = 0.0
        self._cum_volume = 0.0
        self._vwap = None
        self._last_date = None
        self._count = 0


class PreviousDayLevelIndicator(Indicator):
    """Tracks previous day's high, low, and close levels."""

    def __init__(self):
        super().__init__(params=[])
        self._day_highs: List[float] = []
        self._day_lows: List[float] = []
        self._day_closes: List[float] = []
        self._current_day: Optional[str] = None
        self._current_high: Optional[float] = None
        self._current_low: Optional[float] = None
        self._prev_day_high: Optional[float] = None
        self._prev_day_low: Optional[float] = None
        self._prev_day_close: Optional[float] = None
        self._count = 0

    def handle_bar(self, bar: Bar) -> None:
        current_day = str(bar.ts_event)[:10] if bar.ts_event else None
        high = float(bar.high)
        low = float(bar.low)
        close = float(bar.close)

        # New day - save previous day's levels
        if self._current_day and current_day != self._current_day:
            if self._current_high is not None and self._current_low is not None:
                self._prev_day_high = self._current_high
                self._prev_day_low = self._current_low
                if close is not None:
                    self._prev_day_close = close

            # Reset for new day
            self._current_high = high
            self._current_low = low
        else:
            # Same day - update levels
            if self._current_high is None or high > self._current_high:
                self._current_high = high
            if self._current_low is None or low < self._current_low:
                self._current_low = low

        self._current_day = current_day
        self._count += 1
        self._set_has_inputs(True)

    @property
    def prev_high(self) -> Optional[float]:
        return self._prev_day_high

    @property
    def prev_low(self) -> Optional[float]:
        return self._prev_day_low

    @property
    def prev_close(self) -> Optional[float]:
        return self._prev_day_close

    def is_initialized(self) -> bool:
        return self._prev_day_high is not None and self._prev_day_low is not None

    def reset(self) -> None:
        self._day_highs = []
        self._day_lows = []
        self._day_closes = []
        self._current_day = None
        self._current_high = None
        self._current_low = None
        self._prev_day_high = None
        self._prev_day_low = None
        self._prev_day_close = None
        self._count = 0


class OpeningRangeIndicator(Indicator):
    """Tracks the opening range (high/low) for the first N minutes of trading."""

    def __init__(self, range_minutes: int = 15):
        super().__init__(params=[range_minutes])
        self.range_minutes = range_minutes
        self._range_high: Optional[float] = None
        self._range_low: Optional[float] = None
        self._range_set: bool = False
        self._current_day: Optional[str] = None
        self._bars_today: int = 0
        self._count = 0

    def handle_bar(self, bar: Bar) -> None:
        current_day = str(bar.ts_event)[:10] if bar.ts_event else None
        high = float(bar.high)
        low = float(bar.low)

        # New day - reset range
        if self._current_day and current_day != self._current_day:
            self._range_high = None
            self._range_low = None
            self._range_set = False
            self._bars_today = 0

        self._current_day = current_day

        # Build opening range
        if not self._range_set:
            if self._range_high is None or high > self._range_high:
                self._range_high = high
            if self._range_low is None or low < self._range_low:
                self._range_low = low
            self._bars_today += 1

            # Set range after N bars (assuming 1-min bars)
            if self._bars_today >= self.range_minutes:
                self._range_set = True

        self._count += 1
        self._set_has_inputs(True)

    @property
    def range_high(self) -> Optional[float]:
        return self._range_high

    @property
    def range_low(self) -> Optional[float]:
        return self._range_low

    @property
    def is_range_set(self) -> bool:
        return self._range_set

    def is_initialized(self) -> bool:
        return self._range_set

    def reset(self) -> None:
        self._range_high = None
        self._range_low = None
        self._range_set = False
        self._current_day = None
        self._bars_today = 0
        self._count = 0


# ============================================================================
# BASE INTRADAY STRATEGY CONFIG
# ============================================================================

class IntradayStrategyConfig(StrategyConfig, kw_only=True):
    """Base configuration for intraday strategies."""

    instrument_id: InstrumentId
    bar_type: BarType

    # Risk management
    stop_loss_pct: float = 1.0
    take_profit_pct: float = 2.0
    trailing_stop_pct: Optional[float] = None
    trailing_stop_activation_pct: float = 1.0

    # Position sizing
    trade_size: Decimal = Decimal("100")
    max_risk_per_trade_pct: float = 1.0
    max_risk_amount: float = 10000.0  # Max Rs per trade

    # Time controls
    max_holding_bars: int = 75  # ~75 min for 1-min bars
    entry_start_time: str = "09:15"  # Market open
    entry_end_time: str = "14:30"  # Stop entering before close
    force_exit_time: str = "15:15"  # Force exit before close

    # Risk limits
    max_total_loss_pct: float = 3.0
    max_consecutive_losses: int = 5

    order_id_tag: str = "INTRADAY"


# ============================================================================
# STRATEGY 1: EMA CROSSOVER
# ============================================================================

class EMACrossoverConfig(IntradayStrategyConfig, kw_only=True):
    """Configuration for EMA Crossover strategy."""

    fast_period: int = 9
    slow_period: int = 21
    min_cross_strength: float = 0.1  # Min % difference for signal
    order_id_tag: str = "EMA_CROSS"


class EMACrossoverStrategy(Strategy):
    """
    EMA Crossover Intraday Strategy

    Entry: Fast EMA crosses above slow EMA (bullish)
    Exit: Fast EMA crosses below slow EMA, stop loss, or take profit
    """

    def __init__(self, config: EMACrossoverConfig):
        super().__init__(config)

        # Config
        self.fast_period = config.fast_period
        self.slow_period = config.slow_period
        self.stop_loss_pct = config.stop_loss_pct
        self.take_profit_pct = config.take_profit_pct
        self.trailing_stop_pct = config.trailing_stop_pct
        self.trailing_stop_activation_pct = config.trailing_stop_activation_pct
        self.max_holding_bars = config.max_holding_bars
        self.max_risk_per_trade_pct = config.max_risk_per_trade_pct
        self.max_risk_amount = config.max_risk_amount
        self.max_total_loss_pct = config.max_total_loss_pct
        self.max_consecutive_losses = config.max_consecutive_losses

        # Indicators
        self.ema_fast = EMAIndicator(period=config.fast_period)
        self.ema_slow = EMAIndicator(period=config.slow_period)
        self.atr = ATRIndicator(period=14)

        # State
        self.instrument: Optional[Instrument] = None
        self.in_position: bool = False
        self.entry_price: Optional[float] = None
        self.highest_price: Optional[float] = None
        self.trailing_stop_active: bool = False
        self.bars_in_trade: int = 0
        self.current_trade_size: int = 0
        self.entry_time = None

        # Prev values for cross detection
        self._prev_fast: Optional[float] = None
        self._prev_slow: Optional[float] = None
        self._bar_count: int = 0
        self._count: int = 0

        # Trade tracking
        self.trades: List[dict] = []
        self.total_pnl: float = 0.0
        self.consecutive_losses: int = 0
        self.trading_stopped: bool = False
        self.stop_reason: str = ""

        # Day tracking
        self._current_day: Optional[str] = None
        self._day_pnl: float = 0.0

    def on_start(self) -> None:
        self.instrument = self.cache.instrument(self.config.instrument_id)
        if self.instrument is None:
            self.log.error(f"Could not find instrument for {self.config.instrument_id}")
            self.stop()
            return

        self.register_indicator_for_bars(self.config.bar_type, self.ema_fast)
        self.register_indicator_for_bars(self.config.bar_type, self.ema_slow)
        self.register_indicator_for_bars(self.config.bar_type, self.atr)

        self.request_bars(self.config.bar_type)
        self.subscribe_bars(self.config.bar_type)

        self.log.info(f"EMA Crossover started: Fast={self.fast_period}, Slow={self.slow_period}")

    def on_stop(self) -> None:
        self.log.info(f"EMA Crossover stopped. Total trades: {len(self.trades)}")

    def on_bar(self, bar: Bar) -> None:
        # Always update EMA values regardless of initialization
        current_price = float(bar.close)

        if not self.ema_fast.is_initialized() or not self.ema_slow.is_initialized():
            self._count += 1
            return

        if self.trading_stopped:
            return

        fast = self.ema_fast.value
        slow = self.ema_slow.value

        if fast is None or slow is None:
            return

        # Check for new day - reset daily tracking
        current_day = str(bar.ts_event)[:10] if bar.ts_event else None
        if self._current_day and current_day != self._current_day:
            self._day_pnl = 0.0
        self._current_day = current_day

        # Check time restrictions - convert UTC to IST
        ist_time = get_ist_time_from_bar(bar)
        in_entry_window = "09:30" <= ist_time <= "14:00"
        force_exit = ist_time >= "15:00"

        # Update position tracking
        if self.in_position:
            self.bars_in_trade += 1
            if self.highest_price is None or current_price > self.highest_price:
                self.highest_price = current_price

            # Check exit conditions
            exit_reason = self._check_exit(current_price, fast, slow, force_exit)
            if exit_reason:
                self._exit_long(current_price, exit_reason, bar)
        else:
            # Check entry conditions
            if in_entry_window and self._check_entry(fast, slow):
                if self._check_risk_limits():
                    self._enter_long(current_price, bar)

        # Store prev values for next cross detection
        self._prev_fast = fast
        self._prev_slow = slow

    def _check_entry(self, fast: float, slow: float) -> bool:
        """Check for bullish crossover."""
        if self._prev_fast is None or self._prev_slow is None:
            return False

        # Bullish cross: fast was below slow, now above
        cross_up = self._prev_fast <= self._prev_slow and fast > slow

        # Also allow entry if fast EMA is trending above slow EMA
        trending_up = fast > slow and self._prev_fast > self._prev_slow

        return cross_up or trending_up

    def _check_exit(self, price: float, fast: float, slow: float, force_exit: bool) -> Optional[str]:
        """Check exit conditions."""
        if self.entry_price is None:
            return None

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100

        # Check trailing stop activation
        if not self.trailing_stop_active and self.trailing_stop_pct:
            if pnl_pct >= self.trailing_stop_activation_pct:
                self.trailing_stop_active = True
                self.log.info(f"Trailing stop activated at {self.trailing_stop_pct}%")

        # 1. Force exit at end of day
        if force_exit:
            return "EOD_EXIT"

        # 2. Take profit
        if pnl_pct >= self.take_profit_pct:
            return "TAKE_PROFIT"

        # 3. Stop loss
        if pnl_pct <= -self.stop_loss_pct:
            return "STOP_LOSS"

        # 4. Trailing stop
        if self.trailing_stop_active and self.highest_price and self.trailing_stop_pct:
            trailing_price = self.highest_price * (1 - self.trailing_stop_pct / 100)
            if price <= trailing_price:
                return "TRAILING_STOP"

        # 5. Max holding time
        if self.bars_in_trade >= self.max_holding_bars:
            return "MAX_HOLDING"

        # 6. Bearish crossover
        if self._prev_fast and self._prev_slow:
            if self._prev_fast >= self._prev_slow and fast < slow:
                return "EMA_CROSS_DOWN"

        return None

    def _check_risk_limits(self) -> bool:
        """Check if trading should continue based on risk limits."""
        capital = 1_000_000.0

        if self.total_pnl < -(self.max_total_loss_pct / 100 * capital):
            self.trading_stopped = True
            self.stop_reason = f"Max loss reached: {self.total_pnl:,.0f}"
            return False

        if self.consecutive_losses >= self.max_consecutive_losses:
            self.trading_stopped = True
            self.stop_reason = f"Max consecutive losses: {self.consecutive_losses}"
            return False

        return True

    def _enter_long(self, price: float, bar: Bar) -> None:
        """Enter long position with risk-based sizing."""
        stop_price = price * (1 - self.stop_loss_pct / 100)
        risk_per_share = price - stop_price

        # Position sizing
        capital = 1_000_000.0
        max_risk = min(capital * self.max_risk_per_trade_pct / 100, self.max_risk_amount)
        shares = int(max_risk / risk_per_share) if risk_per_share > 0 else 1
        shares = min(shares, int(self.config.trade_size))
        shares = max(1, shares)

        order = self.order_factory.market(
            instrument_id=self.config.instrument_id,
            order_side=OrderSide.BUY,
            quantity=self.instrument.make_qty(Decimal(str(shares))),
        )
        self.submit_order(order)

        self.current_trade_size = shares
        self.entry_price = price
        self.highest_price = price
        self.bars_in_trade = 0
        self.in_position = True
        self.trailing_stop_active = False
        self.entry_time = bar.ts_event

        self.log.info(f"EMA CROSS ENTRY @ {price:.2f} | Shares: {shares} | Stop: {stop_price:.2f}")

    def _exit_long(self, price: float, reason: str, bar: Bar) -> None:
        """Exit long position."""
        self.close_all_positions(self.config.instrument_id)

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100 if self.entry_price else 0
        pnl_amount = (price - self.entry_price) * self.current_trade_size if self.entry_price else 0

        self.total_pnl += pnl_amount
        self._day_pnl += pnl_amount

        if pnl_amount < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0

        self.trades.append({
            'entry_date': self.entry_time,
            'exit_date': bar.ts_event,
            'entry_price': self.entry_price,
            'exit_price': price,
            'shares': self.current_trade_size,
            'pnl_pct': pnl_pct,
            'pnl_amount': pnl_amount,
            'bars_held': self.bars_in_trade,
            'reason': reason,
        })

        self.log.info(f"EMA CROSS EXIT @ {price:.2f} | PnL: {pnl_pct:+.2f}% | Reason: {reason}")

        # Reset position state
        self.in_position = False
        self.entry_price = None
        self.highest_price = None
        self.bars_in_trade = 0
        self.trailing_stop_active = False
        self.entry_time = None


# ============================================================================
# STRATEGY 2: PREVIOUS DAY LOW/HIGH BREAKOUT
# ============================================================================

class PDLPDHConfig(IntradayStrategyConfig, kw_only=True):
    """Configuration for Previous Day Low/High Breakout strategy."""

    breakout_buffer_pct: float = 0.1  # Buffer above PDL / below PDH
    require_volume: bool = True
    volume_multiplier: float = 1.5  # Volume must be X times average
    order_id_tag: str = "PDL_PDH"


class PDLPDHStrategy(Strategy):
    """
    Previous Day Low/High Breakout Strategy

    Entry Long: Price breaks above Previous Day Low with volume
    Entry Short: Price breaks below Previous Day High (if enabled)
    Exit: Stop loss, take profit, or end of day
    """

    def __init__(self, config: PDLPDHConfig):
        super().__init__(config)

        # Config
        self.breakout_buffer_pct = config.breakout_buffer_pct
        self.require_volume = config.require_volume
        self.volume_multiplier = config.volume_multiplier
        self.stop_loss_pct = config.stop_loss_pct
        self.take_profit_pct = config.take_profit_pct
        self.max_holding_bars = config.max_holding_bars
        self.max_risk_per_trade_pct = config.max_risk_per_trade_pct
        self.max_risk_amount = config.max_risk_amount
        self.max_total_loss_pct = config.max_total_loss_pct
        self.max_consecutive_losses = config.max_consecutive_losses

        # Indicators
        self.pdl_pdh = PreviousDayLevelIndicator()
        self.atr = ATRIndicator(period=14)

        # State
        self.instrument: Optional[Instrument] = None
        self.in_position: bool = False
        self.entry_price: Optional[float] = None
        self.highest_price: Optional[float] = None
        self.bars_in_trade: int = 0
        self.current_trade_size: int = 0
        self.entry_time = None
        self.entry_signal: Optional[str] = None  # Track which signal triggered entry

        # Volume tracking
        self._volume_history: List[float] = []
        self._avg_volume: Optional[float] = None

        # Trade tracking
        self.trades: List[dict] = []
        self.total_pnl: float = 0.0
        self.consecutive_losses: int = 0
        self.trading_stopped: bool = False
        self.stop_reason: str = ""

        # Day tracking
        self._current_day: Optional[str] = None
        self._signals_today: int = 0

    def on_start(self) -> None:
        self.instrument = self.cache.instrument(self.config.instrument_id)
        if self.instrument is None:
            self.log.error(f"Could not find instrument")
            self.stop()
            return

        self.register_indicator_for_bars(self.config.bar_type, self.pdl_pdh)
        self.register_indicator_for_bars(self.config.bar_type, self.atr)

        self.request_bars(self.config.bar_type)
        self.subscribe_bars(self.config.bar_type)

        self.log.info(f"PDL/PDH Breakout started")

    def on_stop(self) -> None:
        self.log.info(f"PDL/PDH stopped. Total trades: {len(self.trades)}")

    def on_bar(self, bar: Bar) -> None:
        if not self.pdl_pdh.is_initialized():
            return

        if self.trading_stopped:
            return

        current_price = float(bar.close)
        high = float(bar.high)
        low = float(bar.low)
        volume = float(bar.volume)

        # Update volume tracking
        self._volume_history.append(volume)
        if len(self._volume_history) > 20:
            self._volume_history.pop(0)
        self._avg_volume = sum(self._volume_history) / len(self._volume_history) if self._volume_history else None

        # Day tracking
        current_day = str(bar.ts_event)[:10] if bar.ts_event else None
        if self._current_day and current_day != self._current_day:
            self._signals_today = 0
        self._current_day = current_day

        # Get PDL/PDH levels
        pdl = self.pdl_pdh.prev_low
        pdh = self.pdl_pdh.prev_high

        if pdl is None or pdh is None:
            return

        # Check time restrictions - convert UTC to IST
        ist_time = get_ist_time_from_bar(bar)
        in_entry_window = "09:30" <= ist_time <= "14:00"  # Avoid first 15 min
        force_exit = ist_time >= "15:00"

        # Update position
        if self.in_position:
            self.bars_in_trade += 1
            if self.highest_price is None or current_price > self.highest_price:
                self.highest_price = current_price

            exit_reason = self._check_exit(current_price, force_exit)
            if exit_reason:
                self._exit_long(current_price, exit_reason, bar)
        else:
            # Check entry
            if in_entry_window and self._signals_today < 3:  # Max 3 signals per day
                signal = self._check_entry(current_price, high, low, pdl, pdh, volume)
                if signal and self._check_risk_limits():
                    self._enter_long(current_price, signal, bar)
                    self._signals_today += 1

    def _check_entry(self, close: float, high: float, low: float,
                     pdl: float, pdh: float, volume: float) -> Optional[str]:
        """Check for breakout entry."""
        # Check volume requirement
        volume_ok = True
        if self.require_volume and self._avg_volume:
            volume_ok = volume >= self._avg_volume * self.volume_multiplier

        # PDL Breakout - price breaks above previous day low
        pdl_breakout_level = pdl * (1 + self.breakout_buffer_pct / 100)
        if close > pdl_breakout_level and low <= pdl_breakout_level and volume_ok:
            return "PDL_BREAKOUT"

        return None

    def _check_exit(self, price: float, force_exit: bool) -> Optional[str]:
        """Check exit conditions."""
        if self.entry_price is None:
            return None

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100

        if force_exit:
            return "EOD_EXIT"
        if pnl_pct >= self.take_profit_pct:
            return "TAKE_PROFIT"
        if pnl_pct <= -self.stop_loss_pct:
            return "STOP_LOSS"
        if self.bars_in_trade >= self.max_holding_bars:
            return "MAX_HOLDING"

        return None

    def _check_risk_limits(self) -> bool:
        """Check risk limits."""
        capital = 1_000_000.0

        if self.total_pnl < -(self.max_total_loss_pct / 100 * capital):
            self.trading_stopped = True
            self.stop_reason = f"Max loss reached"
            return False

        if self.consecutive_losses >= self.max_consecutive_losses:
            self.trading_stopped = True
            self.stop_reason = f"Max consecutive losses"
            return False

        return True

    def _enter_long(self, price: float, signal: str, bar: Bar) -> None:
        """Enter long position."""
        stop_price = price * (1 - self.stop_loss_pct / 100)
        risk_per_share = price - stop_price

        capital = 1_000_000.0
        max_risk = min(capital * self.max_risk_per_trade_pct / 100, self.max_risk_amount)
        shares = int(max_risk / risk_per_share) if risk_per_share > 0 else 1
        shares = min(shares, int(self.config.trade_size))
        shares = max(1, shares)

        order = self.order_factory.market(
            instrument_id=self.config.instrument_id,
            order_side=OrderSide.BUY,
            quantity=self.instrument.make_qty(Decimal(str(shares))),
        )
        self.submit_order(order)

        self.current_trade_size = shares
        self.entry_price = price
        self.highest_price = price
        self.bars_in_trade = 0
        self.in_position = True
        self.entry_time = bar.ts_event
        self.entry_signal = signal

        self.log.info(f"PDL BREAKOUT ENTRY @ {price:.2f} | Signal: {signal} | Shares: {shares}")

    def _exit_long(self, price: float, reason: str, bar: Bar) -> None:
        """Exit position."""
        self.close_all_positions(self.config.instrument_id)

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100 if self.entry_price else 0
        pnl_amount = (price - self.entry_price) * self.current_trade_size if self.entry_price else 0

        self.total_pnl += pnl_amount

        if pnl_amount < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0

        self.trades.append({
            'entry_date': self.entry_time,
            'exit_date': bar.ts_event,
            'entry_price': self.entry_price,
            'exit_price': price,
            'shares': self.current_trade_size,
            'pnl_pct': pnl_pct,
            'pnl_amount': pnl_amount,
            'bars_held': self.bars_in_trade,
            'reason': reason,
            'signal': self.entry_signal,
        })

        self.log.info(f"PDL EXIT @ {price:.2f} | PnL: {pnl_pct:+.2f}% | Reason: {reason}")

        self.in_position = False
        self.entry_price = None
        self.highest_price = None
        self.bars_in_trade = 0
        self.entry_time = None
        self.entry_signal = None


# ============================================================================
# STRATEGY 3: GAP UP STRATEGY
# ============================================================================

class GapUpConfig(IntradayStrategyConfig, kw_only=True):
    """Configuration for Gap Up strategy."""

    min_gap_pct: float = 1.0  # Minimum gap up percentage
    max_gap_pct: float = 5.0  # Maximum gap up (avoid excessive gaps)
    entry_after_minutes: int = 5  # Wait X minutes after open
    pullback_pct: float = 0.3  # Enter on pullback to X% of gap
    order_id_tag: str = "GAP_UP"


class GapUpStrategy(Strategy):
    """
    Gap Up Momentum Strategy

    Entry: Stock gaps up at open, then pulls back to entry zone
    Exit: Stop loss, take profit, or momentum fails
    """

    def __init__(self, config: GapUpConfig):
        super().__init__(config)

        # Config
        self.min_gap_pct = config.min_gap_pct
        self.max_gap_pct = config.max_gap_pct
        self.entry_after_minutes = config.entry_after_minutes
        self.pullback_pct = config.pullback_pct
        self.stop_loss_pct = config.stop_loss_pct
        self.take_profit_pct = config.take_profit_pct
        self.max_holding_bars = config.max_holding_bars
        self.max_risk_per_trade_pct = config.max_risk_per_trade_pct
        self.max_risk_amount = config.max_risk_amount
        self.max_total_loss_pct = config.max_total_loss_pct
        self.max_consecutive_losses = config.max_consecutive_losses

        # Indicators
        self.pdl_pdh = PreviousDayLevelIndicator()

        # State
        self.instrument: Optional[Instrument] = None
        self.in_position: bool = False
        self.entry_price: Optional[float] = None
        self.highest_price: Optional[float] = None
        self.bars_in_trade: int = 0
        self.current_trade_size: int = 0
        self.entry_time = None

        # Gap tracking
        self._current_day: Optional[str] = None
        self._day_open: Optional[float] = None
        self._prev_close: Optional[float] = None
        self._gap_pct: Optional[float] = None
        self._gap_detected: bool = False
        self._intraday_high: Optional[float] = None
        self._bars_today: int = 0

        # Trade tracking
        self.trades: List[dict] = []
        self.total_pnl: float = 0.0
        self.consecutive_losses: int = 0
        self.trading_stopped: bool = False
        self.stop_reason: str = ""

    def on_start(self) -> None:
        self.instrument = self.cache.instrument(self.config.instrument_id)
        if self.instrument is None:
            self.log.error(f"Could not find instrument")
            self.stop()
            return

        self.register_indicator_for_bars(self.config.bar_type, self.pdl_pdh)
        self.request_bars(self.config.bar_type)
        self.subscribe_bars(self.config.bar_type)

        self.log.info(f"Gap Up strategy started (min: {self.min_gap_pct}%, max: {self.max_gap_pct}%)")

    def on_stop(self) -> None:
        self.log.info(f"Gap Up stopped. Total trades: {len(self.trades)}")

    def on_bar(self, bar: Bar) -> None:
        if self.trading_stopped:
            return

        current_price = float(bar.close)
        high = float(bar.high)
        low = float(bar.low)

        # Day tracking
        current_day = str(bar.ts_event)[:10] if bar.ts_event else None

        if self._current_day and current_day != self._current_day:
            # New day - reset
            self._day_open = None
            self._gap_detected = False
            self._intraday_high = None
            self._bars_today = 0
            self._gap_pct = None

        self._current_day = current_day
        self._bars_today += 1

        # Detect gap at open
        if not self._gap_detected and self.pdl_pdh.is_initialized():
            self._prev_close = self.pdl_pdh.prev_close
            if self._prev_close and self._bars_today == 1:
                self._day_open = current_price
                self._gap_pct = ((self._day_open - self._prev_close) / self._prev_close) * 100
                self._intraday_high = high

                if self.min_gap_pct <= self._gap_pct <= self.max_gap_pct:
                    self._gap_detected = True
                    self.log.info(f"GAP UP detected: {self._gap_pct:.2f}% | Open: {self._day_open:.2f} | Prev Close: {self._prev_close:.2f}")

        # Update intraday high
        if self._intraday_high is None or high > self._intraday_high:
            self._intraday_high = high

        # Check time restrictions - convert UTC to IST
        ist_time = get_ist_time_from_bar(bar)
        force_exit = ist_time >= "15:00"

        # Position management
        if self.in_position:
            self.bars_in_trade += 1
            if self.highest_price is None or current_price > self.highest_price:
                self.highest_price = current_price

            exit_reason = self._check_exit(current_price, force_exit)
            if exit_reason:
                self._exit_long(current_price, exit_reason, bar)
        else:
            # Check entry
            if self._gap_detected and self._bars_today >= self.entry_after_minutes:
                if self._check_entry(current_price, low) and self._check_risk_limits():
                    self._enter_long(current_price, bar)

    def _check_entry(self, close: float, low: float) -> bool:
        """Check for pullback entry after gap up."""
        if not self._gap_detected or self._day_open is None or self._prev_close is None:
            return False

        # Calculate pullback zone (30-50% of gap)
        gap_size = self._day_open - self._prev_close
        pullback_level = self._day_open - (gap_size * self.pullback_pct)

        # Enter if price pulls back to zone and holds
        # Condition: Low touched pullback zone but close is above it
        touched_pullback = low <= pullback_level
        holding_above = close > pullback_level

        return touched_pullback and holding_above

    def _check_exit(self, price: float, force_exit: bool) -> Optional[str]:
        """Check exit conditions."""
        if self.entry_price is None:
            return None

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100

        if force_exit:
            return "EOD_EXIT"
        if pnl_pct >= self.take_profit_pct:
            return "TAKE_PROFIT"
        if pnl_pct <= -self.stop_loss_pct:
            return "STOP_LOSS"
        if self.bars_in_trade >= self.max_holding_bars:
            return "MAX_HOLDING"

        # Gap fill - price dropped below previous close
        if self._prev_close and price < self._prev_close:
            return "GAP_FILL"

        return None

    def _check_risk_limits(self) -> bool:
        """Check risk limits."""
        capital = 1_000_000.0

        if self.total_pnl < -(self.max_total_loss_pct / 100 * capital):
            self.trading_stopped = True
            self.stop_reason = f"Max loss reached"
            return False

        if self.consecutive_losses >= self.max_consecutive_losses:
            self.trading_stopped = True
            self.stop_reason = f"Max consecutive losses"
            return False

        return True

    def _enter_long(self, price: float, bar: Bar) -> None:
        """Enter long position."""
        stop_price = price * (1 - self.stop_loss_pct / 100)
        risk_per_share = price - stop_price

        capital = 1_000_000.0
        max_risk = min(capital * self.max_risk_per_trade_pct / 100, self.max_risk_amount)
        shares = int(max_risk / risk_per_share) if risk_per_share > 0 else 1
        shares = min(shares, int(self.config.trade_size))
        shares = max(1, shares)

        order = self.order_factory.market(
            instrument_id=self.config.instrument_id,
            order_side=OrderSide.BUY,
            quantity=self.instrument.make_qty(Decimal(str(shares))),
        )
        self.submit_order(order)

        self.current_trade_size = shares
        self.entry_price = price
        self.highest_price = price
        self.bars_in_trade = 0
        self.in_position = True
        self.entry_time = bar.ts_event

        self.log.info(f"GAP UP ENTRY @ {price:.2f} | Gap: {self._gap_pct:.2f}% | Shares: {shares}")

    def _exit_long(self, price: float, reason: str, bar: Bar) -> None:
        """Exit position."""
        self.close_all_positions(self.config.instrument_id)

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100 if self.entry_price else 0
        pnl_amount = (price - self.entry_price) * self.current_trade_size if self.entry_price else 0

        self.total_pnl += pnl_amount

        if pnl_amount < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0

        self.trades.append({
            'entry_date': self.entry_time,
            'exit_date': bar.ts_event,
            'entry_price': self.entry_price,
            'exit_price': price,
            'shares': self.current_trade_size,
            'pnl_pct': pnl_pct,
            'pnl_amount': pnl_amount,
            'bars_held': self.bars_in_trade,
            'reason': reason,
            'gap_pct': self._gap_pct,
        })

        self.log.info(f"GAP UP EXIT @ {price:.2f} | PnL: {pnl_pct:+.2f}% | Reason: {reason}")

        self.in_position = False
        self.entry_price = None
        self.highest_price = None
        self.bars_in_trade = 0
        self.entry_time = None
        self._gap_detected = False  # Only one trade per gap


# ============================================================================
# STRATEGY 4: OPENING RANGE BREAKOUT
# ============================================================================

class OpeningRangeConfig(IntradayStrategyConfig, kw_only=True):
    """Configuration for Opening Range Breakout strategy."""

    range_minutes: int = 15
    breakout_buffer_pct: float = 0.1
    require_retest: bool = False  # Wait for pullback to breakout level
    order_id_tag: str = "ORB"


class OpeningRangeStrategy(Strategy):
    """
    Opening Range Breakout Strategy

    Entry: Price breaks above the opening range high
    Exit: Stop loss, take profit, or range breakdown
    """

    def __init__(self, config: OpeningRangeConfig):
        super().__init__(config)

        # Config
        self.range_minutes = config.range_minutes
        self.breakout_buffer_pct = config.breakout_buffer_pct
        self.require_retest = config.require_retest
        self.stop_loss_pct = config.stop_loss_pct
        self.take_profit_pct = config.take_profit_pct
        self.max_holding_bars = config.max_holding_bars
        self.max_risk_per_trade_pct = config.max_risk_per_trade_pct
        self.max_risk_amount = config.max_risk_amount
        self.max_total_loss_pct = config.max_total_loss_pct
        self.max_consecutive_losses = config.max_consecutive_losses

        # Indicators
        self.orb = OpeningRangeIndicator(range_minutes=config.range_minutes)

        # State
        self.instrument: Optional[Instrument] = None
        self.in_position: bool = False
        self.entry_price: Optional[float] = None
        self.highest_price: Optional[float] = None
        self.bars_in_trade: int = 0
        self.current_trade_size: int = 0
        self.entry_time = None

        # Range tracking
        self._current_day: Optional[str] = None
        self._breakout_level: Optional[float] = None
        self._breakout_detected: bool = False
        self._waiting_retest: bool = False

        # Trade tracking
        self.trades: List[dict] = []
        self.total_pnl: float = 0.0
        self.consecutive_losses: int = 0
        self.trading_stopped: bool = False
        self.stop_reason: str = ""

    def on_start(self) -> None:
        self.instrument = self.cache.instrument(self.config.instrument_id)
        if self.instrument is None:
            self.log.error(f"Could not find instrument")
            self.stop()
            return

        self.register_indicator_for_bars(self.config.bar_type, self.orb)
        self.request_bars(self.config.bar_type)
        self.subscribe_bars(self.config.bar_type)

        self.log.info(f"Opening Range Breakout started ({self.range_minutes} min range)")

    def on_stop(self) -> None:
        self.log.info(f"ORB stopped. Total trades: {len(self.trades)}")

    def on_bar(self, bar: Bar) -> None:
        if self.trading_stopped:
            return

        current_price = float(bar.close)
        high = float(bar.high)
        low = float(bar.low)

        # Day tracking
        current_day = str(bar.ts_event)[:10] if bar.ts_event else None

        if self._current_day and current_day != self._current_day:
            self._breakout_level = None
            self._breakout_detected = False
            self._waiting_retest = False

        self._current_day = current_day

        if not self.orb.is_initialized():
            return

        range_high = self.orb.range_high
        range_low = self.orb.range_low

        if range_high is None or range_low is None:
            return

        # Check time restrictions - convert UTC to IST
        ist_time = get_ist_time_from_bar(bar)
        force_exit = ist_time >= "15:00"

        # Position management
        if self.in_position:
            self.bars_in_trade += 1
            if self.highest_price is None or current_price > self.highest_price:
                self.highest_price = current_price

            exit_reason = self._check_exit(current_price, low, range_low, force_exit)
            if exit_reason:
                self._exit_long(current_price, exit_reason, bar)
        else:
            # Check entry
            signal = self._check_entry(current_price, high, low, range_high)
            if signal and self._check_risk_limits():
                self._enter_long(current_price, bar)

    def _check_entry(self, close: float, high: float, low: float, range_high: float) -> Optional[str]:
        """Check for breakout entry."""
        breakout_level = range_high * (1 + self.breakout_buffer_pct / 100)

        # Fresh breakout
        if not self._breakout_detected:
            if close > breakout_level:
                self._breakout_detected = True
                self._breakout_level = breakout_level

                if self.require_retest:
                    self._waiting_retest = True
                    return None
                return "ORB_BREAKOUT"

        # Waiting for retest
        if self._waiting_retest and self._breakout_level:
            # Price pulled back to breakout level and holding
            touched_level = low <= self._breakout_level * 1.002  # Small buffer
            holding_above = close > self._breakout_level

            if touched_level and holding_above:
                self._waiting_retest = False
                return "ORB_RETEST"

        return None

    def _check_exit(self, price: float, low: float, range_low: float, force_exit: bool) -> Optional[str]:
        """Check exit conditions."""
        if self.entry_price is None:
            return None

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100

        if force_exit:
            return "EOD_EXIT"
        if pnl_pct >= self.take_profit_pct:
            return "TAKE_PROFIT"
        if pnl_pct <= -self.stop_loss_pct:
            return "STOP_LOSS"
        if self.bars_in_trade >= self.max_holding_bars:
            return "MAX_HOLDING"

        # Range breakdown - price fell below opening range low
        if low < range_low:
            return "RANGE_BREAKDOWN"

        return None

    def _check_risk_limits(self) -> bool:
        """Check risk limits."""
        capital = 1_000_000.0

        if self.total_pnl < -(self.max_total_loss_pct / 100 * capital):
            self.trading_stopped = True
            self.stop_reason = f"Max loss reached"
            return False

        if self.consecutive_losses >= self.max_consecutive_losses:
            self.trading_stopped = True
            self.stop_reason = f"Max consecutive losses"
            return False

        return True

    def _enter_long(self, price: float, bar: Bar) -> None:
        """Enter long position."""
        stop_price = price * (1 - self.stop_loss_pct / 100)
        risk_per_share = price - stop_price

        capital = 1_000_000.0
        max_risk = min(capital * self.max_risk_per_trade_pct / 100, self.max_risk_amount)
        shares = int(max_risk / risk_per_share) if risk_per_share > 0 else 1
        shares = min(shares, int(self.config.trade_size))
        shares = max(1, shares)

        order = self.order_factory.market(
            instrument_id=self.config.instrument_id,
            order_side=OrderSide.BUY,
            quantity=self.instrument.make_qty(Decimal(str(shares))),
        )
        self.submit_order(order)

        self.current_trade_size = shares
        self.entry_price = price
        self.highest_price = price
        self.bars_in_trade = 0
        self.in_position = True
        self.entry_time = bar.ts_event

        self.log.info(f"ORB ENTRY @ {price:.2f} | Shares: {shares}")

    def _exit_long(self, price: float, reason: str, bar: Bar) -> None:
        """Exit position."""
        self.close_all_positions(self.config.instrument_id)

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100 if self.entry_price else 0
        pnl_amount = (price - self.entry_price) * self.current_trade_size if self.entry_price else 0

        self.total_pnl += pnl_amount

        if pnl_amount < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0

        self.trades.append({
            'entry_date': self.entry_time,
            'exit_date': bar.ts_event,
            'entry_price': self.entry_price,
            'exit_price': price,
            'shares': self.current_trade_size,
            'pnl_pct': pnl_pct,
            'pnl_amount': pnl_amount,
            'bars_held': self.bars_in_trade,
            'reason': reason,
        })

        self.log.info(f"ORB EXIT @ {price:.2f} | PnL: {pnl_pct:+.2f}% | Reason: {reason}")

        self.in_position = False
        self.entry_price = None
        self.highest_price = None
        self.bars_in_trade = 0
        self.entry_time = None


# ============================================================================
# STRATEGY 5: VWAP STRATEGY
# ============================================================================

class VWAPConfig(IntradayStrategyConfig, kw_only=True):
    """Configuration for VWAP strategy."""

    vwap_buffer_pct: float = 0.2  # Entry buffer around VWAP
    min_deviation_pct: float = 0.5  # Min deviation from VWAP for mean reversion
    order_id_tag: str = "VWAP"


class VWAPStrategy(Strategy):
    """
    VWAP Mean Reversion / Trend Strategy

    Entry: Price bounces off VWAP with momentum
    Exit: Stop loss, take profit, or VWAP reclamation
    """

    def __init__(self, config: VWAPConfig):
        super().__init__(config)

        # Config
        self.vwap_buffer_pct = config.vwap_buffer_pct
        self.min_deviation_pct = config.min_deviation_pct
        self.stop_loss_pct = config.stop_loss_pct
        self.take_profit_pct = config.take_profit_pct
        self.max_holding_bars = config.max_holding_bars
        self.max_risk_per_trade_pct = config.max_risk_per_trade_pct
        self.max_risk_amount = config.max_risk_amount
        self.max_total_loss_pct = config.max_total_loss_pct
        self.max_consecutive_losses = config.max_consecutive_losses

        # Indicators
        self.vwap = VWAPIndicator()
        self.ema_fast = EMAIndicator(period=9)

        # State
        self.instrument: Optional[Instrument] = None
        self.in_position: bool = False
        self.entry_price: Optional[float] = None
        self.highest_price: Optional[float] = None
        self.bars_in_trade: int = 0
        self.current_trade_size: int = 0
        self.entry_time = None

        # Trade tracking
        self.trades: List[dict] = []
        self.total_pnl: float = 0.0
        self.consecutive_losses: int = 0
        self.trading_stopped: bool = False
        self.stop_reason: str = ""

    def on_start(self) -> None:
        self.instrument = self.cache.instrument(self.config.instrument_id)
        if self.instrument is None:
            self.log.error(f"Could not find instrument")
            self.stop()
            return

        self.register_indicator_for_bars(self.config.bar_type, self.vwap)
        self.register_indicator_for_bars(self.config.bar_type, self.ema_fast)

        self.request_bars(self.config.bar_type)
        self.subscribe_bars(self.config.bar_type)

        self.log.info(f"VWAP strategy started")

    def on_stop(self) -> None:
        self.log.info(f"VWAP stopped. Total trades: {len(self.trades)}")

    def on_bar(self, bar: Bar) -> None:
        if not self.vwap.is_initialized() or not self.ema_fast.is_initialized():
            return

        if self.trading_stopped:
            return

        current_price = float(bar.close)
        low = float(bar.low)
        vwap_value = self.vwap.value
        ema_value = self.ema_fast.value

        if vwap_value is None or ema_value is None:
            return

        # Check time restrictions - convert UTC to IST
        ist_time = get_ist_time_from_bar(bar)
        in_entry_window = "09:30" <= ist_time <= "14:00"
        force_exit = ist_time >= "15:00"

        # Position management
        if self.in_position:
            self.bars_in_trade += 1
            if self.highest_price is None or current_price > self.highest_price:
                self.highest_price = current_price

            exit_reason = self._check_exit(current_price, vwap_value, force_exit)
            if exit_reason:
                self._exit_long(current_price, exit_reason, bar)
        else:
            # Check entry
            if in_entry_window:
                signal = self._check_entry(current_price, low, vwap_value, ema_value)
                if signal and self._check_risk_limits():
                    self._enter_long(current_price, bar)

    def _check_entry(self, close: float, low: float, vwap: float, ema: float) -> Optional[str]:
        """Check for VWAP bounce entry."""
        # Calculate deviation from VWAP
        deviation_pct = ((close - vwap) / vwap) * 100 if vwap > 0 else 0

        # VWAP Support entry: price pulled back to VWAP from above, now bouncing
        vwap_support = vwap * (1 + self.vwap_buffer_pct / 100)

        # Condition: Price above VWAP but close to it, and EMA is trending up
        above_vwap = close > vwap
        near_vwap = low <= vwap_support
        ema_trending = close > ema  # Price above short-term EMA

        if above_vwap and near_vwap and ema_trending:
            return "VWAP_BOUNCE"

        return None

    def _check_exit(self, price: float, vwap: float, force_exit: bool) -> Optional[str]:
        """Check exit conditions."""
        if self.entry_price is None:
            return None

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100

        if force_exit:
            return "EOD_EXIT"
        if pnl_pct >= self.take_profit_pct:
            return "TAKE_PROFIT"
        if pnl_pct <= -self.stop_loss_pct:
            return "STOP_LOSS"
        if self.bars_in_trade >= self.max_holding_bars:
            return "MAX_HOLDING"

        # VWAP breakdown - price fell below VWAP
        if price < vwap:
            return "VWAP_BREAKDOWN"

        return None

    def _check_risk_limits(self) -> bool:
        """Check risk limits."""
        capital = 1_000_000.0

        if self.total_pnl < -(self.max_total_loss_pct / 100 * capital):
            self.trading_stopped = True
            self.stop_reason = f"Max loss reached"
            return False

        if self.consecutive_losses >= self.max_consecutive_losses:
            self.trading_stopped = True
            self.stop_reason = f"Max consecutive losses"
            return False

        return True

    def _enter_long(self, price: float, bar: Bar) -> None:
        """Enter long position."""
        stop_price = price * (1 - self.stop_loss_pct / 100)
        risk_per_share = price - stop_price

        capital = 1_000_000.0
        max_risk = min(capital * self.max_risk_per_trade_pct / 100, self.max_risk_amount)
        shares = int(max_risk / risk_per_share) if risk_per_share > 0 else 1
        shares = min(shares, int(self.config.trade_size))
        shares = max(1, shares)

        order = self.order_factory.market(
            instrument_id=self.config.instrument_id,
            order_side=OrderSide.BUY,
            quantity=self.instrument.make_qty(Decimal(str(shares))),
        )
        self.submit_order(order)

        self.current_trade_size = shares
        self.entry_price = price
        self.highest_price = price
        self.bars_in_trade = 0
        self.in_position = True
        self.entry_time = bar.ts_event

        self.log.info(f"VWAP ENTRY @ {price:.2f} | Shares: {shares}")

    def _exit_long(self, price: float, reason: str, bar: Bar) -> None:
        """Exit position."""
        self.close_all_positions(self.config.instrument_id)

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100 if self.entry_price else 0
        pnl_amount = (price - self.entry_price) * self.current_trade_size if self.entry_price else 0

        self.total_pnl += pnl_amount

        if pnl_amount < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0

        self.trades.append({
            'entry_date': self.entry_time,
            'exit_date': bar.ts_event,
            'entry_price': self.entry_price,
            'exit_price': price,
            'shares': self.current_trade_size,
            'pnl_pct': pnl_pct,
            'pnl_amount': pnl_amount,
            'bars_held': self.bars_in_trade,
            'reason': reason,
        })

        self.log.info(f"VWAP EXIT @ {price:.2f} | PnL: {pnl_pct:+.2f}% | Reason: {reason}")

        self.in_position = False
        self.entry_price = None
        self.highest_price = None
        self.bars_in_trade = 0
        self.entry_time = None


# ============================================================================
# STRATEGY 6: ENHANCED VWAP STRATEGY V2 (with trend filter, volume, time filter)
# ============================================================================

class VWAPEnhancedConfig(IntradayStrategyConfig, kw_only=True):
    """Configuration for Enhanced VWAP strategy with trend filter."""

    vwap_buffer_pct: float = 0.1  # Entry buffer around VWAP (tighter)
    min_deviation_pct: float = 0.1  # Min deviation from VWAP for entry
    trend_filter_period: int = 50  # EMA period for trend filter
    volume_avg_period: int = 20  # Period for volume average
    volume_multiplier: float = 1.2  # Volume must be X times average
    entry_start_time: str = "09:45"  # Avoid first 30 min
    entry_end_time: str = "13:30"  # Stop entering early afternoon
    order_id_tag: str = "VWAP_V2"


class VWAPEnhancedStrategy(Strategy):
    """
    Enhanced VWAP Strategy with Trend Filter and Volume Confirmation

    Improvements over basic VWAP:
    - 50 EMA trend filter (only trade when price > 50 EMA)
    - Volume confirmation (volume > 1.2x average)
    - Time filter (avoid first 30 min, stop at 1:30 PM)
    - Tighter entry buffer
    """

    def __init__(self, config: VWAPEnhancedConfig):
        super().__init__(config)

        # Config
        self.vwap_buffer_pct = config.vwap_buffer_pct
        self.min_deviation_pct = config.min_deviation_pct
        self.trend_filter_period = config.trend_filter_period
        self.volume_avg_period = config.volume_avg_period
        self.volume_multiplier = config.volume_multiplier
        self.stop_loss_pct = config.stop_loss_pct
        self.take_profit_pct = config.take_profit_pct
        self.max_holding_bars = config.max_holding_bars
        self.max_risk_per_trade_pct = config.max_risk_per_trade_pct
        self.max_risk_amount = config.max_risk_amount
        self.max_total_loss_pct = config.max_total_loss_pct
        self.max_consecutive_losses = config.max_consecutive_losses

        # Indicators
        self.vwap = VWAPIndicator()
        self.ema_trend = EMAIndicator(period=config.trend_filter_period)
        self.ema_fast = EMAIndicator(period=9)
        self.atr = ATRIndicator(period=14)

        # Volume tracking
        self._volume_history: List[float] = []
        self._avg_volume: Optional[float] = None

        # State
        self.instrument: Optional[Instrument] = None
        self.in_position: bool = False
        self.entry_price: Optional[float] = None
        self.highest_price: Optional[float] = None
        self.bars_in_trade: int = 0
        self.current_trade_size: int = 0
        self.entry_time = None
        self._prev_vwap: Optional[float] = None

        # Day tracking
        self._current_day: Optional[str] = None
        self._trades_today: int = 0

        # Trade tracking
        self.trades: List[dict] = []
        self.total_pnl: float = 0.0
        self.consecutive_losses: int = 0
        self.trading_stopped: bool = False
        self.stop_reason: str = ""

    def on_start(self) -> None:
        self.instrument = self.cache.instrument(self.config.instrument_id)
        if self.instrument is None:
            self.log.error(f"Could not find instrument")
            self.stop()
            return

        self.register_indicator_for_bars(self.config.bar_type, self.vwap)
        self.register_indicator_for_bars(self.config.bar_type, self.ema_trend)
        self.register_indicator_for_bars(self.config.bar_type, self.ema_fast)
        self.register_indicator_for_bars(self.config.bar_type, self.atr)

        self.request_bars(self.config.bar_type)
        self.subscribe_bars(self.config.bar_type)

        self.log.info(f"Enhanced VWAP V2 started (trend filter: {self.trend_filter_period} EMA)")

    def on_stop(self) -> None:
        self.log.info(f"Enhanced VWAP V2 stopped. Total trades: {len(self.trades)}")

    def on_bar(self, bar: Bar) -> None:
        if not self.vwap.is_initialized() or not self.ema_trend.is_initialized():
            return

        if self.trading_stopped:
            return

        current_price = float(bar.close)
        low = float(bar.low)
        high = float(bar.high)
        volume = float(bar.volume)
        vwap_value = self.vwap.value
        ema_trend_value = self.ema_trend.value
        ema_fast_value = self.ema_fast.value

        if vwap_value is None or ema_trend_value is None or ema_fast_value is None:
            return

        # Update volume tracking
        self._volume_history.append(volume)
        if len(self._volume_history) > self.volume_avg_period:
            self._volume_history.pop(0)
        self._avg_volume = sum(self._volume_history) / len(self._volume_history) if self._volume_history else None

        # Day tracking
        current_day = str(bar.ts_event)[:10] if bar.ts_event else None
        if self._current_day and current_day != self._current_day:
            self._trades_today = 0
        self._current_day = current_day

        # Check time restrictions - convert UTC to IST
        ist_time = get_ist_time_from_bar(bar)
        in_entry_window = "09:45" <= ist_time <= "13:30"  # Avoid first 30 min
        force_exit = ist_time >= "15:00"

        # Position management
        if self.in_position:
            self.bars_in_trade += 1
            if self.highest_price is None or current_price > self.highest_price:
                self.highest_price = current_price

            exit_reason = self._check_exit(current_price, vwap_value, ema_trend_value, force_exit)
            if exit_reason:
                self._exit_long(current_price, exit_reason, bar)
        else:
            # Check entry
            if in_entry_window and self._trades_today < 3:  # Max 3 trades per day
                signal = self._check_entry(current_price, low, high, vwap_value, ema_trend_value, ema_fast_value, volume)
                if signal and self._check_risk_limits():
                    self._enter_long(current_price, bar)
                    self._trades_today += 1

        self._prev_vwap = vwap_value

    def _check_entry(self, close: float, low: float, high: float, vwap: float,
                     ema_trend: float, ema_fast: float, volume: float) -> Optional[str]:
        """Check for enhanced VWAP bounce entry with trend and volume filter."""

        # 1. Trend filter: Price must be above 50 EMA (uptrend)
        if close <= ema_trend:
            return None

        # 2. Volume filter: Volume should be above average
        volume_ok = True
        if self._avg_volume and self._avg_volume > 0:
            volume_ok = volume >= self._avg_volume * self.volume_multiplier

        # 3. VWAP proximity: Price should be near VWAP (within buffer)
        vwap_upper = vwap * (1 + self.vwap_buffer_pct / 100)
        near_vwap = low <= vwap_upper and close > vwap

        # 4. Price above VWAP (support confirmation)
        above_vwap = close > vwap

        # 5. Short-term momentum: Price above fast EMA
        momentum_up = close > ema_fast

        # 6. VWAP slope positive (VWAP rising)
        vwap_rising = self._prev_vwap is None or vwap >= self._prev_vwap

        if above_vwap and near_vwap and momentum_up and volume_ok and vwap_rising:
            return "VWAP_V2_BOUNCE"

        return None

    def _check_exit(self, price: float, vwap: float, ema_trend: float, force_exit: bool) -> Optional[str]:
        """Check exit conditions."""
        if self.entry_price is None:
            return None

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100

        if force_exit:
            return "EOD_EXIT"
        if pnl_pct >= self.take_profit_pct:
            return "TAKE_PROFIT"
        if pnl_pct <= -self.stop_loss_pct:
            return "STOP_LOSS"
        if self.bars_in_trade >= self.max_holding_bars:
            return "MAX_HOLDING"

        # Trend reversal - price fell below 50 EMA
        if price < ema_trend:
            return "TREND_REVERSAL"

        # VWAP breakdown - price fell below VWAP
        if price < vwap:
            return "VWAP_BREAKDOWN"

        return None

    def _check_risk_limits(self) -> bool:
        """Check risk limits."""
        capital = 1_000_000.0

        if self.total_pnl < -(self.max_total_loss_pct / 100 * capital):
            self.trading_stopped = True
            self.stop_reason = f"Max loss reached"
            return False

        if self.consecutive_losses >= self.max_consecutive_losses:
            self.trading_stopped = True
            self.stop_reason = f"Max consecutive losses"
            return False

        return True

    def _enter_long(self, price: float, bar: Bar) -> None:
        """Enter long position."""
        stop_price = price * (1 - self.stop_loss_pct / 100)
        risk_per_share = price - stop_price

        capital = 1_000_000.0
        max_risk = min(capital * self.max_risk_per_trade_pct / 100, self.max_risk_amount)
        shares = int(max_risk / risk_per_share) if risk_per_share > 0 else 1
        shares = min(shares, int(self.config.trade_size))
        shares = max(1, shares)

        order = self.order_factory.market(
            instrument_id=self.config.instrument_id,
            order_side=OrderSide.BUY,
            quantity=self.instrument.make_qty(Decimal(str(shares))),
        )
        self.submit_order(order)

        self.current_trade_size = shares
        self.entry_price = price
        self.highest_price = price
        self.bars_in_trade = 0
        self.in_position = True
        self.entry_time = bar.ts_event

        vol_str = f"{self._avg_volume:.0f}" if self._avg_volume else "0"
        self.log.info(f"VWAP V2 ENTRY @ {price:.2f} | Shares: {shares} | Vol: {vol_str}")

    def _exit_long(self, price: float, reason: str, bar: Bar) -> None:
        """Exit position."""
        self.close_all_positions(self.config.instrument_id)

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100 if self.entry_price else 0
        pnl_amount = (price - self.entry_price) * self.current_trade_size if self.entry_price else 0

        self.total_pnl += pnl_amount

        if pnl_amount < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0

        self.trades.append({
            'entry_date': self.entry_time,
            'exit_date': bar.ts_event,
            'entry_price': self.entry_price,
            'exit_price': price,
            'shares': self.current_trade_size,
            'pnl_pct': pnl_pct,
            'pnl_amount': pnl_amount,
            'bars_held': self.bars_in_trade,
            'reason': reason,
        })

        self.log.info(f"VWAP V2 EXIT @ {price:.2f} | PnL: {pnl_pct:+.2f}% | Reason: {reason}")

        self.in_position = False
        self.entry_price = None
        self.highest_price = None
        self.bars_in_trade = 0
        self.entry_time = None


# Export all strategies
__all__ = [
    'EMACrossoverConfig', 'EMACrossoverStrategy',
    'PDLPDHConfig', 'PDLPDHStrategy',
    'GapUpConfig', 'GapUpStrategy',
    'OpeningRangeConfig', 'OpeningRangeStrategy',
    'VWAPConfig', 'VWAPStrategy',
    'VWAPEnhancedConfig', 'VWAPEnhancedStrategy',
]
