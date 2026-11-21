"""Pure-Python backtest engine, engine config, bars and the DataFrame wrangler."""

from __future__ import annotations

from typing import Any, Iterable, List, Optional

from .model import BarType, OrderSide, Price, Quantity

__all__ = [
    "Bar",
    "BarDataWrangler",
    "BacktestEngineConfig",
    "BacktestEngine",
]


class Bar:
    __slots__ = (
        "bar_type",
        "instrument_id",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "ts_event",
        "ts_init",
    )

    def __init__(
        self,
        bar_type: Any = None,
        open: Any = None,
        high: Any = None,
        low: Any = None,
        close: Any = None,
        volume: Any = None,
        ts_event: int = 0,
        ts_init: int = 0,
        instrument_id: Any = None,
    ) -> None:
        self.bar_type = bar_type
        self.instrument_id = instrument_id
        self.open = open if isinstance(open, Price) else Price(float(open or 0.0))
        self.high = high if isinstance(high, Price) else Price(float(high or 0.0))
        self.low = low if isinstance(low, Price) else Price(float(low or 0.0))
        self.close = close if isinstance(close, Price) else Price(float(close or 0.0))
        self.volume = volume if isinstance(volume, Quantity) else Quantity(float(volume or 0))
        self.ts_event = int(ts_event)
        self.ts_init = int(ts_init)

    def __repr__(self) -> str:
        return (
            f"Bar(bar_type={self.bar_type!s}, open={self.open!s}, high={self.high!s}, "
            f"low={self.low!s}, close={self.close!s}, ts_event={self.ts_event})"
        )


class BarDataWrangler:
    """Converts a timestamp-indexed OHLCV frame into :class:`Bar` objects.

    ``ts_event`` is taken straight from the index's integer nanosecond value.
    The repo localises naive Upstox timestamps as UTC on purpose, so no timezone
    conversion may happen here: ``get_ist_time(bar.ts_event)`` does that later.
    """

    def __init__(self, bar_type: Any = None, instrument: Any = None) -> None:
        self.bar_type = bar_type
        self.instrument = instrument

    def process(self, df: Any) -> List[Bar]:
        bars: List[Bar] = []
        columns = ["open", "high", "low", "close", "volume"]
        for i in range(len(df)):
            index_value = df.index[i]
            ts_event = int(index_value.value) if hasattr(index_value, "value") else int(index_value)
            row = df.iloc[i]
            bars.append(
                Bar(
                    bar_type=self.bar_type,
                    instrument_id=getattr(self.instrument, "instrument_id", None),
                    open=Price(float(row[columns[0]])),
                    high=Price(float(row[columns[1]])),
                    low=Price(float(row[columns[2]])),
                    close=Price(float(row[columns[3]])),
                    volume=Quantity.from_str(str(int(row[columns[4]]))),
                    ts_event=ts_event,
                    ts_init=ts_event,
                )
            )
        return bars


class BacktestEngineConfig:
    def __init__(self, trader_id: Any = None, **kwargs: Any) -> None:
        self.trader_id = trader_id
        for key, value in kwargs.items():
            setattr(self, key, value)

    def __repr__(self) -> str:
        return f"BacktestEngineConfig(trader_id={self.trader_id!r})"


class BacktestEngine:
    """Minimal event loop: start all strategies, then replay bars in frame order."""

    def __init__(self, config: Optional[BacktestEngineConfig] = None) -> None:
        self.config = config if config is not None else BacktestEngineConfig()
        self._venues: List[Any] = []
        self._instruments: List[Any] = []
        self._bars: List[Bar] = []
        self._strategies: List[Any] = []
        self._current_bar: Optional[Bar] = None
        self._ran = False

    def add_venue(self, **kwargs: Any) -> None:
        self._venues.append(kwargs)

    def add_instrument(self, instrument: Any) -> None:
        self._instruments.append(instrument)

    def add_data(self, data: Any) -> None:
        if data is None:
            return
        if isinstance(data, Bar):
            self._bars.append(data)
            return
        if isinstance(data, (str, bytes, dict)):
            self._bars.append(data)
            return
        if isinstance(data, Iterable):
            self._bars.extend(data)
            return
        self._bars.append(data)

    def add_strategy(self, strategy: Any) -> None:
        self._strategies.append(strategy)
        strategy._sim_engine = self

    def run(self) -> None:
        if self._ran:
            raise RuntimeError(
                "BacktestEngine.run() may only be called once; construct a new engine"
            )
        self._ran = True

        for strategy in self._strategies:
            strategy.on_start()

        for bar in self._bars:
            self._current_bar = bar
            for strategy in self._strategies:
                strategy._sim_bar = bar
                strategy.on_bar(bar)

        self._current_bar = None
        for strategy in self._strategies:
            strategy._sim_bar = None

        for strategy in self._strategies:
            strategy.on_stop()

    def dispose(self) -> None:
        return None

    def _fill_order(self, strategy: Any, order: Any) -> None:
        """Fill at the current bar's close and update the strategy's paper cache."""
        from .strategy import SimPosition

        bar = self._current_bar
        price = float(bar.close) if bar is not None else 0.0
        instrument_id = getattr(order, "instrument_id", None)
        quantity = getattr(order, "quantity", None)
        side = getattr(order, "order_side", None)
        cache = strategy.cache

        opposite = OrderSide.SELL if side == OrderSide.BUY else OrderSide.BUY
        existing = [
            position
            for position in cache.positions_open(instrument_id=instrument_id)
            if position.side == opposite
        ]
        if existing:
            position = existing[0]
            remaining = float(position.quantity) - float(quantity)
            cache._remove(position)
            if remaining < 0:
                cache._add(
                    SimPosition(
                        instrument_id=instrument_id,
                        quantity=Quantity.from_str(str(abs(remaining))),
                        side=opposite,
                        entry_price=position.entry_price,
                        trades=position.trades,
                    )
                )
            elif remaining > 0:
                cache._add(
                    SimPosition(
                        instrument_id=instrument_id,
                        quantity=Quantity.from_str(str(remaining)),
                        side=opposite,
                        entry_price=position.entry_price,
                        trades=position.trades,
                    )
                )
            return

        cache._add(
            SimPosition(
                instrument_id=instrument_id,
                quantity=quantity,
                side=side,
                entry_price=price,
            )
        )
