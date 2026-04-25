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

from .indicators import (
    EMAIndicator,
    ATRIndicator,
    VWAPIndicator,
    PreviousDayLevelIndicator,
    OpeningRangeIndicator,
)

from .nautilus_intraday import get_ist_time_from_bar


class IntradayStrategyConfig(StrategyConfig, kw_only=True):
    """Base configuration for intraday strategies."""

    instrument_id: InstrumentId
    bar_type: BarType

    stop_loss_pct: float = 1.0
    take_profit_pct: float = 2.0
    trailing_stop_pct: Optional[float] = None
    trailing_stop_activation_pct: float = 1.0

    trade_size: Decimal = Decimal("100")
    max_risk_per_trade_pct: float = 1.0
    max_risk_amount: float = 10000.0

    max_holding_bars: int = 75
    entry_start_time: str = "09:15"
    entry_end_time: str = "14:30"
    force_exit_time: str = "15:15"

    max_total_loss_pct: float = 3.0
    max_consecutive_losses: int = 5

    order_id_tag: str = "INTRADAY"


class EMACrossoverConfig(IntradayStrategyConfig, kw_only=True):
    """Configuration for EMA Crossover strategy."""

    fast_period: int = 9
    slow_period: int = 21
    min_cross_strength: float = 0.1
    order_id_tag: str = "EMA_CROSS"


class EMACrossoverStrategy(Strategy):
    """
    EMA Crossover Intraday Strategy

    Entry: Fast EMA crosses above slow EMA (bullish)
    Exit: Fast EMA crosses below slow EMA, stop loss, or take profit
    """

    def __init__(self, config: EMACrossoverConfig):
        super().__init__(config)

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

        self.ema_fast = EMAIndicator(period=config.fast_period)
        self.ema_slow = EMAIndicator(period=config.slow_period)
        self.atr = ATRIndicator(period=14)

        self.instrument: Optional[Instrument] = None
        self.in_position: bool = False
        self.entry_price: Optional[float] = None
        self.highest_price: Optional[float] = None
        self.trailing_stop_active: bool = False
        self.bars_in_trade: int = 0
        self.current_trade_size: int = 0
        self.entry_time = None

        self._prev_fast: Optional[float] = None
        self._prev_slow: Optional[float] = None
        self._bar_count: int = 0
        self._count: int = 0

        self.trades: List[dict] = []
        self.total_pnl: float = 0.0
        self.consecutive_losses: int = 0
        self.trading_stopped: bool = False
        self.stop_reason: str = ""

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

        current_day = str(bar.ts_event)[:10] if bar.ts_event else None
        if self._current_day and current_day != self._current_day:
            self._day_pnl = 0.0
        self._current_day = current_day

        ist_time = get_ist_time_from_bar(bar)
        in_entry_window = "09:30" <= ist_time <= "14:00"
        force_exit = ist_time >= "15:00"

        if self.in_position:
            self.bars_in_trade += 1
            if self.highest_price is None or current_price > self.highest_price:
                self.highest_price = current_price

            exit_reason = self._check_exit(current_price, fast, slow, force_exit)
            if exit_reason:
                self._exit_long(current_price, exit_reason, bar)
        else:
            if in_entry_window and self._check_entry(fast, slow):
                if self._check_risk_limits():
                    self._enter_long(current_price, bar)

        self._prev_fast = fast
        self._prev_slow = slow

    def _check_entry(self, fast: float, slow: float) -> bool:
        if self._prev_fast is None or self._prev_slow is None:
            return False

        cross_up = self._prev_fast <= self._prev_slow and fast > slow
        trending_up = fast > slow and self._prev_fast > self._prev_slow

        return cross_up or trending_up

    def _check_exit(self, price: float, fast: float, slow: float, force_exit: bool) -> Optional[str]:
        if self.entry_price is None:
            return None

        pnl_pct = ((price - self.entry_price) / self.entry_price) * 100

        if not self.trailing_stop_active and self.trailing_stop_pct:
            if pnl_pct >= self.trailing_stop_activation_pct:
                self.trailing_stop_active = True
                self.log.info(f"Trailing stop activated at {self.trailing_stop_pct}%")

        if force_exit:
            return "EOD_EXIT"

        if pnl_pct >= self.take_profit_pct:
            return "TAKE_PROFIT"

        if pnl_pct <= -self.stop_loss_pct:
            return "STOP_LOSS"

        if self.trailing_stop_active and self.highest_price and self.trailing_stop_pct:
            trailing_price = self.highest_price * (1 - self.trailing_stop_pct / 100)
            if price <= trailing_price:
                return "TRAILING_STOP"

        if self.bars_in_trade >= self.max_holding_bars:
            return "MAX_HOLDING"

        if self._prev_fast and self._prev_slow:
            if self._prev_fast >= self._prev_slow and fast < slow:
                return "EMA_CROSS_DOWN"

        return None

    def _check_risk_limits(self) -> bool:
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
        self.trailing_stop_active = False
        self.entry_time = bar.ts_event

        self.log.info(f"EMA CROSS ENTRY @ {price:.2f} | Shares: {shares} | Stop: {stop_price:.2f}")

    def _exit_long(self, price: float, reason: str, bar: Bar) -> None:
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

        self.in_position = False
        self.entry_price = None
        self.highest_price = None
        self.bars_in_trade = 0
        self.trailing_stop_active = False
        self.entry_time = None


class PDLPDHConfig(IntradayStrategyConfig, kw_only=True):
    """Configuration for Previous Day Low/High Breakout strategy."""

    breakout_buffer_pct: float = 0.1
    require_volume: bool = True
    volume_multiplier: float = 1.5
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

        self.pdl_pdh = PreviousDayLevelIndicator()
        self.atr = ATRIndicator(period=14)

        self.instrument: Optional[Instrument] = None
        self.in_position: bool = False
        self.entry_price: Optional[float] = None
        self.highest_price: Optional[float] = None
        self.bars_in_trade: int = 0
        self.current_trade_size: int = 0
        self.entry_time = None
        self.entry_signal: Optional[str] = None

        self._volume_history: List[float] = []
        self._avg_volume: Optional[float] = None

        self.trades: List[dict] = []
        self.total_pnl: float = 0.0
        self.consecutive_losses: int = 0
        self.trading_stopped: bool = False
        self.stop_reason: str = ""

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

        self._volume_history.append(volume)
        if len(self._volume_history) > 20:
            self._volume_history.pop(0)
        self._avg_volume = sum(self._volume_history) / len(self._volume_history) if self._volume_history else None

        current_day = str(bar.ts_event)[:10] if bar.ts_event else None
        if self._current_day and current_day != self._current_day:
            self._signals_today = 0
        self._current_day = current_day

        pdl = self.pdl_pdh.prev_low
        pdh = self.pdl_pdh.prev_high

        if pdl is None or pdh is None:
            return

        ist_time = get_ist_time_from_bar(bar)
        in_entry_window = "09:30" <= ist_time <= "14:00"
        force_exit = ist_time >= "15:00"

        if self.in_position:
            self.bars_in_trade += 1
            if self.highest_price is None or current_price > self.highest_price:
                self.highest_price = current_price

            exit_reason = self._check_exit(current_price, force_exit)
            if exit_reason:
                self._exit_long(current_price, exit_reason, bar)
        else:
            if in_entry_window and self._signals_today < 3:
                signal = self._check_entry(current_price, high, low, pdl, pdh, volume)
                if signal and self._check_risk_limits():
                    self._enter_long(current_price, signal, bar)
                    self._signals_today += 1

    def _check_entry(self, close: float, high: float, low: float,
                     pdl: float, pdh: float, volume: float) -> Optional[str]:
        volume_ok = True
        if self.require_volume and self._avg_volume:
            volume_ok = volume >= self._avg_volume * self.volume_multiplier

        pdl_breakout_level = pdl * (1 + self.breakout_buffer_pct / 100)
        if close > pdl_breakout_level and low <= pdl_breakout_level and volume_ok:
            return "PDL_BREAKOUT"

        return None

    def _check_exit(self, price: float, force_exit: bool) -> Optional[str]:
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


class GapUpConfig(IntradayStrategyConfig, kw_only=True):
    """Configuration for Gap Up strategy."""

    min_gap_pct: float = 1.0
    max_gap_pct: float = 5.0
    entry_after_minutes: int = 5
    pullback_pct: float = 0.3
    order_id_tag: str = "GAP_UP"


class GapUpStrategy(Strategy):
    """
    Gap Up Momentum Strategy

    Entry: Stock gaps up at open, then pulls back to entry zone
    Exit: Stop loss, take profit, or momentum fails
    """

    def __init__(self, config: GapUpConfig):
        super().__init__(config)

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

        self.pdl_pdh = PreviousDayLevelIndicator()

        self.instrument: Optional[Instrument] = None
        self.in_position: bool = False
        self.entry_price: Optional[float] = None
        self.highest_price: Optional[float] = None
        self.bars_in_trade: int = 0
        self.current_trade_size: int = 0
        self.entry_time = None

        self._current_day: Optional[str] = None
        self._day_open: Optional[float] = None
        self._prev_close: Optional[float] = None
        self._gap_pct: Optional[float] = None
        self._gap_detected: bool = False
        self._intraday_high: Optional[float] = None
        self._bars_today: int = 0

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

        current_day = str(bar.ts_event)[:10] if bar.ts_event else None

        if self._current_day and current_day != self._current_day:
            self._day_open = None
            self._gap_detected = False
            self._intraday_high = None
            self._bars_today = 0
            self._gap_pct = None

        self._current_day = current_day
        self._bars_today += 1

        if not self._gap_detected and self.pdl_pdh.is_initialized():
            self._prev_close = self.pdl_pdh.prev_close
            if self._prev_close and self._bars_today == 1:
                self._day_open = current_price
                self._gap_pct = ((self._day_open - self._prev_close) / self._prev_close) * 100
                self._intraday_high = high

                if self.min_gap_pct <= self._gap_pct <= self.max_gap_pct:
                    self._gap_detected = True
                    self.log.info(f"GAP UP detected: {self._gap_pct:.2f}% | Open: {self._day_open:.2f} | Prev Close: {self._prev_close:.2f}")

        if self._intraday_high is None or high > self._intraday_high:
            self._intraday_high = high

        ist_time = get_ist_time_from_bar(bar)
        force_exit = ist_time >= "15:00"

        if self.in_position:
            self.bars_in_trade += 1
            if self.highest_price is None or current_price > self.highest_price:
                self.highest_price = current_price

            exit_reason = self._check_exit(current_price, force_exit)
            if exit_reason:
                self._exit_long(current_price, exit_reason, bar)
        else:
            if self._gap_detected and self._bars_today >= self.entry_after_minutes:
                if self._check_entry(current_price, low) and self._check_risk_limits():
                    self._enter_long(current_price, bar)

    def _check_entry(self, close: float, low: float) -> bool:
        if not self._gap_detected or self._day_open is None or self._prev_close is None:
            return False

        gap_size = self._day_open - self._prev_close
        pullback_level = self._day_open - (gap_size * self.pullback_pct)

        touched_pullback = low <= pullback_level
        holding_above = close > pullback_level

        return touched_pullback and holding_above

    def _check_exit(self, price: float, force_exit: bool) -> Optional[str]:
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

        if self._prev_close and price < self._prev_close:
            return "GAP_FILL"

        return None

    def _check_risk_limits(self) -> bool:
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
        self._gap_detected = False


class OpeningRangeConfig(IntradayStrategyConfig, kw_only=True):
    """Configuration for Opening Range Breakout strategy."""

    range_minutes: int = 15
    breakout_buffer_pct: float = 0.1
    require_retest: bool = False
    order_id_tag: str = "ORB"


class OpeningRangeStrategy(Strategy):
    """
    Opening Range Breakout Strategy

    Entry: Price breaks above the opening range high
    Exit: Stop loss, take profit, or range breakdown
    """

    def __init__(self, config: OpeningRangeConfig):
        super().__init__(config)

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

        self.orb = OpeningRangeIndicator(range_minutes=config.range_minutes)

        self.instrument: Optional[Instrument] = None
        self.in_position: bool = False
        self.entry_price: Optional[float] = None
        self.highest_price: Optional[float] = None
        self.bars_in_trade: int = 0
        self.current_trade_size: int = 0
        self.entry_time = None

        self._current_day: Optional[str] = None
        self._breakout_level: Optional[float] = None
        self._breakout_detected: bool = False
        self._waiting_retest: bool = False

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

        ist_time = get_ist_time_from_bar(bar)
        force_exit = ist_time >= "15:00"

        if self.in_position:
            self.bars_in_trade += 1
            if self.highest_price is None or current_price > self.highest_price:
                self.highest_price = current_price

            exit_reason = self._check_exit(current_price, low, range_low, force_exit)
            if exit_reason:
                self._exit_long(current_price, exit_reason, bar)
        else:
            signal = self._check_entry(current_price, high, low, range_high)
            if signal and self._check_risk_limits():
                self._enter_long(current_price, bar)

    def _check_entry(self, close: float, high: float, low: float, range_high: float) -> Optional[str]:
        breakout_level = range_high * (1 + self.breakout_buffer_pct / 100)

        if not self._breakout_detected:
            if close > breakout_level:
                self._breakout_detected = True
                self._breakout_level = breakout_level

                if self.require_retest:
                    self._waiting_retest = True
                    return None
                return "ORB_BREAKOUT"

        if self._waiting_retest and self._breakout_level:
            touched_level = low <= self._breakout_level * 1.002
            holding_above = close > self._breakout_level

            if touched_level and holding_above:
                self._waiting_retest = False
                return "ORB_RETEST"

        return None

    def _check_exit(self, price: float, low: float, range_low: float, force_exit: bool) -> Optional[str]:
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

        if low < range_low:
            return "RANGE_BREAKDOWN"

        return None

    def _check_risk_limits(self) -> bool:
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


class VWAPConfig(IntradayStrategyConfig, kw_only=True):
    """Configuration for VWAP strategy."""

    vwap_buffer_pct: float = 0.2
    min_deviation_pct: float = 0.5
    order_id_tag: str = "VWAP"


class VWAPStrategy(Strategy):
    """
    VWAP Mean Reversion / Trend Strategy

    Entry: Price bounces off VWAP with momentum
    Exit: Stop loss, take profit, or VWAP reclamation
    """

    def __init__(self, config: VWAPConfig):
        super().__init__(config)

        self.vwap_buffer_pct = config.vwap_buffer_pct
        self.min_deviation_pct = config.min_deviation_pct
        self.stop_loss_pct = config.stop_loss_pct
        self.take_profit_pct = config.take_profit_pct
        self.max_holding_bars = config.max_holding_bars
        self.max_risk_per_trade_pct = config.max_risk_per_trade_pct
        self.max_risk_amount = config.max_risk_amount
        self.max_total_loss_pct = config.max_total_loss_pct
        self.max_consecutive_losses = config.max_consecutive_losses

        self.vwap = VWAPIndicator()
        self.ema_fast = EMAIndicator(period=9)

        self.instrument: Optional[Instrument] = None
        self.in_position: bool = False
        self.entry_price: Optional[float] = None
        self.highest_price: Optional[float] = None
        self.bars_in_trade: int = 0
        self.current_trade_size: int = 0
        self.entry_time = None

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

        ist_time = get_ist_time_from_bar(bar)
        in_entry_window = "09:30" <= ist_time <= "14:00"
        force_exit = ist_time >= "15:00"

        if self.in_position:
            self.bars_in_trade += 1
            if self.highest_price is None or current_price > self.highest_price:
                self.highest_price = current_price

            exit_reason = self._check_exit(current_price, vwap_value, force_exit)
            if exit_reason:
                self._exit_long(current_price, exit_reason, bar)
        else:
            if in_entry_window:
                signal = self._check_entry(current_price, low, vwap_value, ema_value)
                if signal and self._check_risk_limits():
                    self._enter_long(current_price, bar)

    def _check_entry(self, close: float, low: float, vwap: float, ema: float) -> Optional[str]:
        deviation_pct = ((close - vwap) / vwap) * 100 if vwap > 0 else 0

        vwap_support = vwap * (1 + self.vwap_buffer_pct / 100)

        above_vwap = close > vwap
        near_vwap = low <= vwap_support
        ema_trending = close > ema

        if above_vwap and near_vwap and ema_trending:
            return "VWAP_BOUNCE"

        return None

    def _check_exit(self, price: float, vwap: float, force_exit: bool) -> Optional[str]:
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

        if price < vwap:
            return "VWAP_BREAKDOWN"

        return None

    def _check_risk_limits(self) -> bool:
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


class VWAPEnhancedConfig(IntradayStrategyConfig, kw_only=True):
    """Configuration for Enhanced VWAP strategy with trend filter."""

    vwap_buffer_pct: float = 0.1
    min_deviation_pct: float = 0.1
    trend_filter_period: int = 50
    volume_avg_period: int = 20
    volume_multiplier: float = 1.2
    entry_start_time: str = "09:45"
    entry_end_time: str = "13:30"
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

        self.vwap = VWAPIndicator()
        self.ema_trend = EMAIndicator(period=config.trend_filter_period)
        self.ema_fast = EMAIndicator(period=9)
        self.atr = ATRIndicator(period=14)

        self._volume_history: List[float] = []
        self._avg_volume: Optional[float] = None

        self.instrument: Optional[Instrument] = None
        self.in_position: bool = False
        self.entry_price: Optional[float] = None
        self.highest_price: Optional[float] = None
        self.bars_in_trade: int = 0
        self.current_trade_size: int = 0
        self.entry_time = None
        self._prev_vwap: Optional[float] = None

        self._current_day: Optional[str] = None
        self._trades_today: int = 0

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

        self._volume_history.append(volume)
        if len(self._volume_history) > self.volume_avg_period:
            self._volume_history.pop(0)
        self._avg_volume = sum(self._volume_history) / len(self._volume_history) if self._volume_history else None

        current_day = str(bar.ts_event)[:10] if bar.ts_event else None
        if self._current_day and current_day != self._current_day:
            self._trades_today = 0
        self._current_day = current_day

        ist_time = get_ist_time_from_bar(bar)
        in_entry_window = "09:45" <= ist_time <= "13:30"
        force_exit = ist_time >= "15:00"

        if self.in_position:
            self.bars_in_trade += 1
            if self.highest_price is None or current_price > self.highest_price:
                self.highest_price = current_price

            exit_reason = self._check_exit(current_price, vwap_value, ema_trend_value, force_exit)
            if exit_reason:
                self._exit_long(current_price, exit_reason, bar)
        else:
            if in_entry_window and self._trades_today < 3:
                signal = self._check_entry(current_price, low, high, vwap_value, ema_trend_value, ema_fast_value, volume)
                if signal and self._check_risk_limits():
                    self._enter_long(current_price, bar)
                    self._trades_today += 1

        self._prev_vwap = vwap_value

    def _check_entry(self, close: float, low: float, high: float, vwap: float,
                     ema_trend: float, ema_fast: float, volume: float) -> Optional[str]:
        if close <= ema_trend:
            return None

        volume_ok = True
        if self._avg_volume and self._avg_volume > 0:
            volume_ok = volume >= self._avg_volume * self.volume_multiplier

        vwap_upper = vwap * (1 + self.vwap_buffer_pct / 100)
        near_vwap = low <= vwap_upper and close > vwap

        above_vwap = close > vwap

        momentum_up = close > ema_fast

        vwap_rising = self._prev_vwap is None or vwap >= self._prev_vwap

        if above_vwap and near_vwap and momentum_up and volume_ok and vwap_rising:
            return "VWAP_V2_BOUNCE"

        return None

    def _check_exit(self, price: float, vwap: float, ema_trend: float, force_exit: bool) -> Optional[str]:
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

        if price < ema_trend:
            return "TREND_REVERSAL"

        if price < vwap:
            return "VWAP_BREAKDOWN"

        return None

    def _check_risk_limits(self) -> bool:
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


__all__ = [
    'IntradayStrategyConfig',
    'EMACrossoverConfig', 'EMACrossoverStrategy',
    'PDLPDHConfig', 'PDLPDHStrategy',
    'GapUpConfig', 'GapUpStrategy',
    'OpeningRangeConfig', 'OpeningRangeStrategy',
    'VWAPConfig', 'VWAPStrategy',
    'VWAPEnhancedConfig', 'VWAPEnhancedStrategy',
]
