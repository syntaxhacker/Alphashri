"""
Unit tests for the 52-Week High Chaser Strategy variant.

According to seed configuration (seed_qa_data.py), the '52W Chaser Swing' uses:
- entry_threshold_pct: 2.0
- sl_pct: 3.0
- tp_pct: 10.0
- enable_trailing_stop: True
- trailing_stop_pct: 3.0
- trailing_activation_pct: 5.0
- max_holding_days: 45
- cooldown_days: 30
- enable_filters: False

Tests cover:
1. Config validation (SL must be < TP)
2. Entry when price within threshold of 52W high
3. Take Profit exit
4. Stop Loss exit
5. Trailing Stop activation and exit
6. Max Holding Days exit
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock
import pandas as pd

from backtest.strategies.week52_chaser import (
    Week52ChaserConfig,
    Week52ChaserNautilusStrategy,
    Week52ChaserStrategy,
    Week52HighIndicator,
)
from nautilus_trader.model.identifiers import InstrumentId, Symbol
from nautilus_trader.model.instruments import Equity
from nautilus_trader.model.objects import Price, Quantity
from nautilus_trader.model.currencies import INR
from nautilus_trader.model.data import BarType, Bar


def _make_bar(close, high, low, ts_sec, bar_type_str="TEST.SIMULATED-1-DAY-LAST-EXTERNAL"):
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


@pytest.fixture
def mock_instrument():
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
def chaser_config(mock_instrument):
    return Week52ChaserConfig(
        instrument_id=mock_instrument.id,
        bar_type=BarType.from_str(f"{mock_instrument.id}-1-DAY-LAST-EXTERNAL"),
        entry_threshold_pct=2.0,
        stop_loss_pct=3.0,
        take_profit_pct=10.0,
        enable_trailing_stop=True,
        trailing_stop_pct=3.0,
        trailing_activation_pct=2.0,
        max_holding_days=45,
        cooldown_days=1,        # Use 1 so tests don't have to pump many cooldown bars
        trade_size=100,
        enable_filters=False,
        historical_df=None,
    )


class TestWeek52ChaserNautilusStrategy(Week52ChaserNautilusStrategy):
    """Wrapper to allow easy mocking of Cython attributes."""

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


@pytest.fixture
def chaser_strategy(chaser_config):
    return TestWeek52ChaserNautilusStrategy(config=chaser_config)


# ─── Tests ─────────────────────────────────────────────────────────────────────

class TestWeek52ChaserConfig:
    def test_config_validation_sl_less_than_tp(self):
        """validate_params must reject SL >= TP."""
        wrapper = Week52ChaserStrategy()

        valid = {"stop_loss_pct": 3.0, "take_profit_pct": 10.0, "entry_threshold_pct": 2.0}
        assert wrapper.validate_params(valid) == []

        invalid = {"stop_loss_pct": 10.0, "take_profit_pct": 5.0, "entry_threshold_pct": 2.0}
        errors = wrapper.validate_params(invalid)
        assert any("Stop Loss" in e for e in errors)

    def test_config_validation_negative_threshold(self):
        """validate_params must reject non-positive entry threshold."""
        wrapper = Week52ChaserStrategy()
        errors = wrapper.validate_params({
            "stop_loss_pct": 3.0, "take_profit_pct": 10.0,
            "entry_threshold_pct": -1.0,
        })
        assert any("Entry Threshold" in e for e in errors)


class TestWeek52HighIndicator:
    def test_indicator_requires_min_periods(self):
        """Indicator should not report is_initialized() until min_periods bars have been seen."""
        ind = Week52HighIndicator(period=252, min_periods=5)
        for i in range(4):
            ind.update(float(100 + i))
            assert not ind.is_initialized(), f"Should not be initialized after {i+1} bars"

        # 5th bar makes is_initialized() True
        ind.update(104.0)
        assert ind.is_initialized()

    def test_indicator_excludes_current_bar(self):
        """52W high should exclude the current bar (no look-ahead bias)."""
        ind = Week52HighIndicator(period=252, min_periods=3)
        ind.update(100.0)
        ind.update(105.0)
        ind.update(90.0)   # 52W high = max of first two = 105
        val = ind.update(50.0)  # 52W high = max of [100, 105, 90] = 105
        assert val == 105.0


class TestWeek52ChaserLogic:
    def _seed_indicator(self, strategy, high_value=100.0, bars=25):
        """Pump enough bars into the indicator so is_initialized() passes."""
        ts_base = 1700000000
        for i in range(bars):
            bar = _make_bar(high_value - 2, high_value, high_value - 5, ts_base + i * 86400)
            strategy.on_bar(bar)
        assert strategy._high_52w.value is not None

    def _seed_active_position(self, strategy, entry_price=100.0, entry_52w_high=102.0):
        """Directly set position state AND ensure indicator is warmed up."""
        # Warm up indicator first so on_bar doesn't quit early
        self._seed_indicator(strategy, high_value=entry_52w_high, bars=25)
        # Manually enter position
        strategy._in_position = True
        strategy._entry_price = entry_price
        strategy._entry_52w_high = entry_52w_high
        strategy._highest_price_since_entry = entry_price
        strategy._bars_in_trade = 0
        strategy._bars_since_exit = 0
        strategy._trailing_stop_active = False
        strategy._current_entry_time = datetime(2024, 1, 15, tzinfo=timezone.utc)

    def test_enter_on_proximity_to_52w_high(self, chaser_strategy):
        """Entry fires when price is within entry_threshold_pct of 52W high."""
        self._seed_indicator(chaser_strategy, high_value=100.0, bars=25)

        # close = 98.5 → distance = (100 - 98.5) / 98.5 * 100 ≈ 1.52% which is < 2.0% threshold
        ts = 1700000000 + 26 * 86400
        entry_bar = _make_bar(close=98.5, high=99.0, low=97.0, ts_sec=ts)
        chaser_strategy.on_bar(entry_bar)

        assert chaser_strategy._in_position is True
        assert chaser_strategy._entry_price == 98.5
        chaser_strategy._mock_submit_order.assert_called_once()

    def test_take_profit_exit(self, chaser_strategy):
        """Strategy exits on reaching take_profit_pct (10%)."""
        self._seed_active_position(chaser_strategy, entry_price=100.0, entry_52w_high=115.0)
        # Override bars_in_trade to 0 after seeding
        chaser_strategy._bars_in_trade = 0

        # Bar closes at 110.0 → PnL% = 10% → TP hit
        ts = int(datetime(2024, 2, 1, tzinfo=timezone.utc).timestamp())
        tp_bar = _make_bar(close=110.0, high=111.0, low=109.0, ts_sec=ts)
        chaser_strategy.on_bar(tp_bar)

        assert chaser_strategy._in_position is False
        assert len(chaser_strategy.trades) == 1
        assert chaser_strategy.trades[0]["exit_reason"] == "TP"

    def test_stop_loss_exit(self, chaser_strategy):
        """Strategy exits on hitting stop_loss_pct (3%)."""
        self._seed_active_position(chaser_strategy, entry_price=100.0, entry_52w_high=115.0)
        chaser_strategy._bars_in_trade = 0

        # Bar closes at 96.0 → PnL% = -4% → below SL of -3%
        ts = int(datetime(2024, 2, 1, tzinfo=timezone.utc).timestamp())
        sl_bar = _make_bar(close=96.0, high=97.0, low=95.5, ts_sec=ts)
        chaser_strategy.on_bar(sl_bar)

        assert chaser_strategy._in_position is False
        assert chaser_strategy.trades[0]["exit_reason"] == "SL"

    def test_trailing_stop_activation_and_exit(self, chaser_strategy):
        """Trailing stop should activate once price exceeds 52W high, then exit on drawdown."""
        self._seed_active_position(chaser_strategy, entry_price=98.0, entry_52w_high=100.0)
        chaser_strategy._bars_in_trade = 0

        ts = int(datetime(2024, 2, 1, tzinfo=timezone.utc).timestamp())

        # Bar closes above 52W high → trailing activates, peak = 103
        activate_bar = _make_bar(close=103.0, high=103.0, low=100.0, ts_sec=ts)
        chaser_strategy.on_bar(activate_bar)
        assert chaser_strategy._trailing_stop_active is True
        assert chaser_strategy._in_position is True   # not exited yet

        # Next bar: close = 99.0, trailing = 103 * (1 - 0.03) = 99.91 → exit
        exit_bar = _make_bar(close=99.0, high=100.0, low=98.5, ts_sec=ts + 86400)
        chaser_strategy.on_bar(exit_bar)
        assert chaser_strategy._in_position is False
        assert chaser_strategy.trades[-1]["exit_reason"] == "TRAILING_STOP"

    def test_max_holding_exit(self, chaser_strategy):
        """Strategy exits after max_holding_days bars in position."""
        self._seed_active_position(chaser_strategy, entry_price=100.0, entry_52w_high=115.0)
        chaser_strategy._bars_in_trade = 44   # one bar away from max_holding_days=45
        chaser_strategy._current_entry_time = datetime(2024, 1, 1, tzinfo=timezone.utc)

        # Neutral bar (PnL flat): the 45th bar should trigger MAX_HOLDING
        ts = int(datetime(2024, 1, 2, tzinfo=timezone.utc).timestamp())
        neutral_bar = _make_bar(close=100.5, high=101.0, low=99.5, ts_sec=ts)
        chaser_strategy.on_bar(neutral_bar)

        assert chaser_strategy._in_position is False
        assert chaser_strategy.trades[0]["exit_reason"] == "MAX_HOLDING"
