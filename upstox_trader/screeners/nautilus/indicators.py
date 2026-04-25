from decimal import Decimal
from typing import Optional, List
from dataclasses import dataclass

import pandas as pd
import numpy as np

from nautilus_trader.config import StrategyConfig
from nautilus_trader.core.data import Data
from nautilus_trader.indicators.base.indicator import Indicator
from nautilus_trader.model import Bar, BarType, InstrumentId, Quantity
from nautilus_trader.model.enums import OrderSide
from nautilus_trader.model.instruments import Instrument
from nautilus_trader.trading.strategy import Strategy


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
        current_date = str(bar.ts_event)[:10] if bar.ts_event else None
        if self._last_date and current_date != self._last_date:
            self._cum_tp_volume = 0.0
            self._cum_volume = 0.0

        self._last_date = current_date

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
        return self._count >= 5

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

        if self._current_day and current_day != self._current_day:
            if self._current_high is not None and self._current_low is not None:
                self._prev_day_high = self._current_high
                self._prev_day_low = self._current_low
                if close is not None:
                    self._prev_day_close = close

            self._current_high = high
            self._current_low = low
        else:
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

        if self._current_day and current_day != self._current_day:
            self._range_high = None
            self._range_low = None
            self._range_set = False
            self._bars_today = 0

        self._current_day = current_day

        if not self._range_set:
            if self._range_high is None or high > self._range_high:
                self._range_high = high
            if self._range_low is None or low < self._range_low:
                self._range_low = low
            self._bars_today += 1

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


__all__ = [
    'EMAIndicator',
    'ATRIndicator',
    'VWAPIndicator',
    'PreviousDayLevelIndicator',
    'OpeningRangeIndicator',
]
