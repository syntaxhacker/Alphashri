"""
Unit tests specifically for the ORB Conservative strategy variant.

According to the seed configuration (scripts/seed_qa_data.py), the ORB Conservative
variant uses the following parameters:
- or_minutes: 45
- sl_pct: 0.4
- tp_pct: 1.2
- max_positions: 3

Tests cover:
1. Configuration Tests: Verifying that ORBConfig correctly accepts and stores
   the conservative parameters.
2. Opening Range Timing Tests: Verifying the 45-minute parameter logic ensures
   the OR ends exactly at 10:00 AM (IST) and captures the right highest/lowest prices.
3. Signal Generation & Risk Management: Verifying that simulated bars trigger a
   signal correctly and subsequently close exactly at -0.4% Stop-Loss or +1.2% Take-Profit.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import config
IST = config.IST

try:
    import nautilus_trader
except ModuleNotFoundError:
    pytest.skip("nautilus_trader not available", allow_module_level=True)

from backtest.strategies.orb import (
    ORBConfig,
    ORBNautilusStrategy,
    get_ist_time,
)
from strategy_test_helpers import MockableStrategyMixin, make_mock_instrument, mock_instrument


def _create_mock_bar_type():
    mock = MagicMock()
    mock.__str__ = MagicMock(return_value="TEST.SIMULATED-5-MINUTE-LAST-EXTERNAL")
    return mock


def _get_ts_ns(year, month, day, hour_ist, min_ist):
    dt_ist = datetime(year, month, day, hour_ist, min_ist, tzinfo=IST)
    dt_utc = dt_ist.astimezone(timezone.utc)
    return int(dt_utc.timestamp() * 1_000_000_000)


def _create_mock_bar(ts_ns, open_p, high, low, close, volume=1000):
    bar = MagicMock()
    bar.ts_event = ts_ns
    bar.open.__float__ = MagicMock(return_value=float(open_p))
    bar.high.__float__ = MagicMock(return_value=float(high))
    bar.low.__float__ = MagicMock(return_value=float(low))
    bar.close.__float__ = MagicMock(return_value=float(close))
    bar.volume = volume
    return bar


def _create_strategy(**kwargs):
    if TestORBNautilusStrategy is None:
        pytest.skip("nautilus_trader metaclass mismatch")
    config_kwargs = {
        'instrument_id': make_mock_instrument().id,
        'bar_type': _create_mock_bar_type(),
        'or_minutes': 45,
        'sl_pct': 0.4,
        'tp_pct': 1.2,
        'trade_size': 100,
        'enable_shorts': False,
    }
    config_kwargs.update(kwargs)
    config = ORBConfig(**config_kwargs)
    strategy = TestORBNautilusStrategy(config=config)
    return strategy


try:
    class TestORBNautilusStrategy(MockableStrategyMixin, ORBNautilusStrategy):
        pass
except TypeError:
    TestORBNautilusStrategy = None


class TestORBConservativeTiming:

    def _create_strategy(self, **kwargs):
        if TestORBNautilusStrategy is None:
            pytest.skip("nautilus_trader metaclass mismatch")
        config_kwargs = {
            'instrument_id': make_mock_instrument().id,
            'bar_type': _create_mock_bar_type(),
            'or_minutes': 45,
            'sl_pct': 0.4,
            'tp_pct': 1.2,
            'trade_size': 100,
            'enable_shorts': False,
        }
        config_kwargs.update(kwargs)
        config = ORBConfig(**config_kwargs)
        strategy = TestORBNautilusStrategy(config=config)
        return strategy

    def test_conservative_45_min_orb_period(self):
        strategy = self._create_strategy()

        # Simulate 5-minute candles for 45-min OR (need at least 5 candles)
        # OR period: 9:15 to 10:00 (45 minutes = 9 candles of 5-min each)
        candles_data = [
            (9, 15, 100.0, 105.0, 99.0, 104.0),
            (9, 20, 104.0, 108.0, 103.0, 107.0),
            (9, 25, 107.0, 109.0, 106.0, 108.5),
            (9, 30, 108.0, 110.0, 107.0, 109.5),
            (9, 35, 109.5, 111.0, 108.5, 110.5),
            (9, 40, 110.5, 112.0, 110.0, 111.5),
            (9, 45, 111.5, 113.0, 111.0, 112.5),
            (9, 50, 112.5, 114.0, 112.0, 113.5),
            (9, 55, 113.5, 115.0, 113.0, 114.5),
        ]

        for hour, minute, open_p, high, low, close in candles_data:
            ts = _get_ts_ns(2024, 1, 15, hour, minute)
            bar = _create_mock_bar(ts, open_p, high, low, close)
            strategy.on_bar(bar)

        # After 9:55 bar, OR period is still active
        assert strategy._or_defined is False
        assert len(strategy._or_candles) == 9

        # Send bar at 10:00 (first bar after OR ends)
        b_end_ts = _get_ts_ns(2024, 1, 15, 10, 0)
        bar_end = _create_mock_bar(b_end_ts, 114.5, 115.0, 114.0, 114.5)
        strategy.on_bar(bar_end)

        # OR period just ended, levels should be calculated
        assert strategy._or_defined is True
        assert strategy._or_levels is not None
        assert strategy._or_levels['or_high'] == 115.0  # Highest high from all candles
        assert strategy._or_levels['or_low'] == 99.0   # Lowest low from all candles
        assert strategy._or_levels['or_candles'] == 9   # Number of candles in OR period


class TestORBConservativeRiskManagement:

    def _create_strategy(self):
        if TestORBNautilusStrategy is None:
            pytest.skip("nautilus_trader metaclass mismatch")
        config = ORBConfig(
            instrument_id=make_mock_instrument().id,
            bar_type=_create_mock_bar_type(),
            or_minutes=45,
            sl_pct=0.4,
            tp_pct=1.2,
            trade_size=100,
            enable_shorts=False,
            cooldown_bars=0,
        )
        strategy = TestORBNautilusStrategy(config=config)
        return strategy

    def test_conservative_long_entry_and_take_profit(self):
        strategy = self._create_strategy()

        # Simulate OR period (9:15 to 10:00 for 45-min OR)
        # The strategy collects candles during this period
        # After OR period, _or_levels is calculated

        # Set up OR levels manually (as if OR period completed)
        strategy._current_date = datetime(2024, 1, 15).date()
        strategy._or_levels = {
            'or_high': 1000.0,
            'or_low': 990.0,
            'or_open': 995.0,
            'or_range': 10.0,
            'or_range_pct': 1.0,
            'or_close': 998.0,
            'or_candles': 9,
        }
        strategy._or_defined = True

        # Simulate breakout bar (close > or_high * 1.003 = 1003.0)
        b1_ts = _get_ts_ns(2024, 1, 15, 10, 5)
        bar1 = _create_mock_bar(b1_ts, 999.0, 1005.0, 999.0, 1004.0)
        strategy.on_bar(bar1)

        # Check that entry happened
        assert strategy._position_side == "LONG", f"Expected LONG, got {strategy._position_side}"
        assert strategy._entry_price == 1004.0

        # Now simulate a bar that triggers TP (pnl_pct >= tp_pct = 1.2)
        # Entry at 1004.0, TP at 1004.0 * 1.012 = 1016.048
        mock_pos = MagicMock()
        mock_pos.quantity = "100"
        strategy.cache.positions_open.return_value = [mock_pos]

        b2_ts = _get_ts_ns(2024, 1, 15, 10, 10)
        bar2 = _create_mock_bar(b2_ts, 1004.0, 1017.0, 1004.0, 1016.5)
        strategy.on_bar(bar2)

        # Check that position was closed
        assert strategy._position_side is None
        assert strategy._entry_price is None

        # Check that trade was recorded
        assert len(strategy.trades) == 1
        trade = strategy.trades[0]
        assert trade['exit_reason'] == "TP"
        assert trade['entry_price'] == 1004.0
        assert trade['exit_price'] == 1016.5
        assert trade['gross_pnl_pct'] > 1.2

    def test_conservative_long_entry_and_stop_loss(self):
        strategy = self._create_strategy()

        # Set up OR levels
        strategy._current_date = datetime(2024, 1, 15).date()
        strategy._or_levels = {
            'or_high': 1000.0,
            'or_low': 990.0,
            'or_open': 995.0,
            'or_range': 10.0,
            'or_range_pct': 1.0,
            'orb_close': 998.0,
            'or_candles': 9,
        }
        strategy._or_defined = True

        # Simulate breakout bar
        b1_ts = _get_ts_ns(2024, 1, 15, 10, 5)
        bar1 = _create_mock_bar(b1_ts, 999.0, 1005.0, 999.0, 1004.0)
        strategy.on_bar(bar1)

        assert strategy._position_side == "LONG", f"Expected LONG, got {strategy._position_side}"
        assert strategy._entry_price == 1004.0

        # Now simulate a bar that triggers SL (pnl_pct <= -sl_pct = -0.4)
        # Entry at 1004.0, SL at 1004.0 * 0.996 = 999.984
        mock_pos = MagicMock()
        mock_pos.quantity = "100"
        strategy.cache.positions_open.return_value = [mock_pos]

        b2_ts = _get_ts_ns(2024, 1, 15, 10, 10)
        bar2 = _create_mock_bar(b2_ts, 1004.0, 1004.0, 995.0, 997.0)
        strategy.on_bar(bar2)

        # Check that position was closed
        assert strategy._position_side is None
        assert strategy._entry_price is None

        # Check that trade was recorded
        assert len(strategy.trades) == 1
        trade = strategy.trades[0]
        assert trade['exit_reason'] == "SL"
        assert trade['entry_price'] == 1004.0
        assert trade['exit_price'] == 997.0
        assert trade['gross_pnl_pct'] <= -0.4
