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

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock
import pandas as pd

from backtest.strategies.week52_chaser import (
    Week52ChaserConfig,
    Week52ChaserNautilusStrategy,
    Week52ChaserStrategy,
)
from nautilus_trader.model.data import BarType

from strategy_test_helpers import MockableStrategyMixin, make_mock_instrument, make_bar, mock_instrument


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
        cooldown_days=1,
        trade_size=100,
        enable_filters=False,
        historical_df=None,
    )


class TestWeek52ChaserNautilusStrategy(MockableStrategyMixin, Week52ChaserNautilusStrategy):
    pass


@pytest.fixture
def chaser_strategy(chaser_config):
    return TestWeek52ChaserNautilusStrategy(config=chaser_config)


class TestWeek52ChaserConfig:
    def test_config_validation_sl_less_than_tp(self):
        wrapper = Week52ChaserStrategy()

        valid = {"stop_loss_pct": 3.0, "take_profit_pct": 10.0, "entry_threshold_pct": 2.0}
        assert wrapper.validate_params(valid) == []

        invalid = {"stop_loss_pct": 10.0, "take_profit_pct": 5.0, "entry_threshold_pct": 2.0}
        errors = wrapper.validate_params(invalid)
        assert any("Stop Loss" in e for e in errors)

    def test_config_validation_negative_threshold(self):
        wrapper = Week52ChaserStrategy()
        errors = wrapper.validate_params({
            "stop_loss_pct": 3.0, "take_profit_pct": 10.0,
            "entry_threshold_pct": -1.0,
        })
        assert any("Entry Threshold" in e for e in errors)


class TestWeek52ChaserLogic:
    def _seed_data(self, strategy, high_value=100.0, bars=25):
        """Seed the strategy with historical data."""
        from backtest.strategies.week52_chaser import get_date_from_ns
        ts_base = 1700000000
        for i in range(bars):
            bar = make_bar(high_value - 2, high_value, high_value - 5, ts_base + i * 86400)
            strategy.on_bar(bar)
        assert strategy._current_52w_high is not None

    def _seed_active_position(self, strategy, entry_price=100.0, entry_52w_high=102.0):
        self._seed_data(strategy, high_value=entry_52w_high, bars=25)
        strategy._in_position = True
        strategy._entry_price = entry_price
        strategy._entry_52w_high = entry_52w_high
        strategy._highest_price_since_entry = entry_price
        strategy._bars_in_trade = 0
        strategy._bars_since_exit = 0
        strategy._trailing_stop_active = False
        strategy._current_entry_time = datetime(2024, 1, 15, tzinfo=timezone.utc)

    def test_enter_on_proximity_to_52w_high(self, chaser_strategy):
        self._seed_data(chaser_strategy, high_value=100.0, bars=25)

        ts = 1700000000 + 26 * 86400
        entry_bar = make_bar(close=98.5, high=99.0, low=97.0, ts_sec=ts)
        chaser_strategy.on_bar(entry_bar)

        assert chaser_strategy._in_position is True
        assert chaser_strategy._entry_price == 98.5
        chaser_strategy._mock_submit_order.assert_called_once()

    def test_take_profit_exit(self, chaser_strategy):
        self._seed_active_position(chaser_strategy, entry_price=100.0, entry_52w_high=115.0)
        chaser_strategy._bars_in_trade = 0

        ts = int(datetime(2024, 2, 1, tzinfo=timezone.utc).timestamp())
        tp_bar = make_bar(close=110.0, high=111.0, low=109.0, ts_sec=ts)
        chaser_strategy.on_bar(tp_bar)

        assert chaser_strategy._in_position is False
        assert len(chaser_strategy.trades) == 1
        assert chaser_strategy.trades[0]["exit_reason"] == "TP"

    def test_stop_loss_exit(self, chaser_strategy):
        self._seed_active_position(chaser_strategy, entry_price=100.0, entry_52w_high=115.0)
        chaser_strategy._bars_in_trade = 0

        ts = int(datetime(2024, 2, 1, tzinfo=timezone.utc).timestamp())
        sl_bar = make_bar(close=96.0, high=97.0, low=95.5, ts_sec=ts)
        chaser_strategy.on_bar(sl_bar)

        assert chaser_strategy._in_position is False
        assert chaser_strategy.trades[0]["exit_reason"] == "SL"

    def test_trailing_stop_activation_and_exit(self, chaser_strategy):
        self._seed_active_position(chaser_strategy, entry_price=98.0, entry_52w_high=100.0)
        chaser_strategy._bars_in_trade = 0

        ts = int(datetime(2024, 2, 1, tzinfo=timezone.utc).timestamp())

        activate_bar = make_bar(close=103.0, high=103.0, low=100.0, ts_sec=ts)
        chaser_strategy.on_bar(activate_bar)
        assert chaser_strategy._trailing_stop_active is True
        assert chaser_strategy._in_position is True

        exit_bar = make_bar(close=99.0, high=100.0, low=98.5, ts_sec=ts + 86400)
        chaser_strategy.on_bar(exit_bar)
        assert chaser_strategy._in_position is False
        assert chaser_strategy.trades[-1]["exit_reason"] == "TRAILING_STOP"

    def test_max_holding_exit(self, chaser_strategy):
        self._seed_active_position(chaser_strategy, entry_price=100.0, entry_52w_high=115.0)
        chaser_strategy._bars_in_trade = 44
        chaser_strategy._current_entry_time = datetime(2024, 1, 1, tzinfo=timezone.utc)

        ts = int(datetime(2024, 1, 2, tzinfo=timezone.utc).timestamp())
        neutral_bar = make_bar(close=100.5, high=101.0, low=99.5, ts_sec=ts)
        chaser_strategy.on_bar(neutral_bar)

        assert chaser_strategy._in_position is False
        assert chaser_strategy.trades[0]["exit_reason"] == "MAX_HOLDING"
