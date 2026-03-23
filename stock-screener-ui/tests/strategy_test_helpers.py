from unittest.mock import MagicMock

import pytest

from nautilus_trader.model.identifiers import InstrumentId, Symbol
from nautilus_trader.model.instruments import Equity
from nautilus_trader.model.objects import Price, Quantity
from nautilus_trader.model.currencies import INR
from nautilus_trader.model.data import BarType, Bar


class MockableStrategyMixin:

    @property
    def cache(self):
        if not hasattr(self, "_mock_cache"):
            self._mock_cache = MagicMock()
            self._mock_cache.positions_open.return_value = []
        return self._mock_cache

    def submit_order(self, order):
        if not hasattr(self, "_mock_submit_order"):
            self._mock_submit_order = MagicMock()
        return self._mock_submit_order(order)

    @property
    def order_factory(self):
        if not hasattr(self, "_mock_order_factory"):
            self._mock_order_factory = MagicMock()
        return self._mock_order_factory

    def close_all_positions(self, instrument_id):
        if not hasattr(self, "_mock_close_all_positions"):
            self._mock_close_all_positions = MagicMock()
        return self._mock_close_all_positions(instrument_id)


def make_mock_instrument():
    return Equity(
        instrument_id=InstrumentId.from_str("TEST.SIMULATED"),
        raw_symbol=Symbol("TEST"),
        currency=INR,
        price_precision=2,
        price_increment=Price.from_str("0.01"),
        lot_size=Quantity.from_str("1"),
        ts_event=0,
        ts_init=0,
        isin=None,
    )


@pytest.fixture
def mock_instrument():
    return make_mock_instrument()


def make_bar(close, high, low, ts_sec, bar_type_str="TEST.SIMULATED-1-DAY-LAST-EXTERNAL", open_=None):
    if open_ is None:
        open_ = min(close, high) - 0.5
        open_ = max(open_, low)
    return Bar(
        bar_type=BarType.from_str(bar_type_str),
        open=Price.from_str(str(round(open_, 2))),
        high=Price.from_str(str(round(high, 2))),
        low=Price.from_str(str(round(low, 2))),
        close=Price.from_str(str(round(close, 2))),
        volume=Quantity.from_str("1000"),
        ts_event=ts_sec * 1_000_000_000,
        ts_init=ts_sec * 1_000_000_000,
    )
