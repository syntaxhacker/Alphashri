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
    dt_ist = datetime(year, month, day, hour_ist, min_ist, tzinfo=timezone(timedelta(hours=5, minutes=30)))
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


def test_orb_conservative_config():
    config = ORBConfig(
        instrument_id=make_mock_instrument().id,
        bar_type=_create_mock_bar_type(),
        or_minutes=45,
        sl_pct=0.4,
        tp_pct=1.2,
        trade_size=100,
        enable_shorts=False,
    )

    assert config.or_minutes == 45
    assert config.sl_pct == 0.4
    assert config.tp_pct == 1.2
    assert config.enable_shorts is False


class TestORBNautilusStrategy(MockableStrategyMixin, ORBNautilusStrategy):
    pass


class TestORBConservativeTiming:

    def _create_strategy(self, **kwargs):
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

    def test_conservative_45_min_or_period(self):
        strategy = self._create_strategy()

        b1_ts = _get_ts_ns(2024, 1, 15, 9, 15)
        bar1 = _create_mock_bar(b1_ts, 100.0, 105.0, 99.0, 104.0)
        strategy.on_bar(bar1)

        assert strategy._or_defined is False
        assert strategy._or_high == 105.0
        assert strategy._or_low == 99.0
        assert strategy._or_bars == 1

        b2_ts = _get_ts_ns(2024, 1, 15, 9, 30)
        bar2 = _create_mock_bar(b2_ts, 104.0, 108.0, 103.0, 107.0)
        strategy.on_bar(bar2)

        assert strategy._or_defined is False
        assert strategy._or_high == 108.0
        assert strategy._or_low == 99.0
        assert strategy._or_bars == 2

        b3_ts = _get_ts_ns(2024, 1, 15, 9, 55)
        bar3 = _create_mock_bar(b3_ts, 107.0, 110.0, 106.0, 109.0)
        strategy.on_bar(bar3)

        assert strategy._or_defined is False
        assert strategy._or_high == 110.0
        assert strategy._or_low == 99.0
        assert strategy._or_bars == 3

        b4_ts = _get_ts_ns(2024, 1, 15, 10, 0)
        bar4 = _create_mock_bar(b4_ts, 109.0, 109.5, 108.0, 109.5)
        strategy.on_bar(bar4)

        assert strategy._or_defined is True
        assert strategy._or_high == 110.0
        assert strategy._or_low == 99.0
        assert strategy._entry_price is None


class TestORBConservativeRiskManagement:

    def _create_strategy(self):
        config = ORBConfig(
            instrument_id=make_mock_instrument().id,
            bar_type=_create_mock_bar_type(),
            or_minutes=45,
            sl_pct=0.4,
            tp_pct=1.2,
            trade_size=100,
            enable_shorts=False,
            cooldown_bars=0
        )
        strategy = TestORBNautilusStrategy(config=config)
        return strategy

    def test_conservative_long_entry_and_take_profit(self):
        strategy = self._create_strategy()

        mock_pos = MagicMock()
        mock_pos.quantity = "100"
        strategy._current_date = datetime(2024, 1, 15).date()
        strategy._or_high = 1000.0
        strategy._or_low = 990.0
        strategy._or_bars = 9
        strategy._or_defined = True

        b1_ts = _get_ts_ns(2024, 1, 15, 10, 5)
        bar1 = _create_mock_bar(b1_ts, 999.0, 1003.0, 999.0, 1002.0)

        strategy.on_bar(bar1)

        assert strategy._position_side == "LONG"
        assert strategy._entry_price == 1002.0
        assert hasattr(strategy, "_mock_submit_order")

        strategy.cache.positions_open.return_value = [mock_pos]

        b2_ts = _get_ts_ns(2024, 1, 15, 10, 10)
        bar2 = _create_mock_bar(b2_ts, 1002.0, 1015.0, 1002.0, 1014.5)

        strategy.on_bar(bar2)

        assert strategy._position_side is None
        assert strategy._entry_price is None
        assert hasattr(strategy, "_mock_close_all_positions")

        assert len(strategy.trades) == 1
        trade = strategy.trades[0]
        assert trade['exit_reason'] == "TP"
        assert trade['entry_price'] == 1002.0
        assert trade['exit_price'] == 1014.5
        assert trade['gross_pnl_pct'] > 1.2


    def test_conservative_long_entry_and_stop_loss(self):
        strategy = self._create_strategy()

        mock_pos = MagicMock()
        mock_pos.quantity = "100"

        strategy._current_date = datetime(2024, 1, 15).date()
        strategy._or_high = 1000.0
        strategy._or_low = 990.0
        strategy._or_bars = 9
        strategy._or_defined = True

        b1_ts = _get_ts_ns(2024, 1, 15, 10, 5)
        bar1 = _create_mock_bar(b1_ts, 999.0, 1003.0, 999.0, 1002.0)
        strategy.on_bar(bar1)

        strategy.cache.positions_open.return_value = [mock_pos]

        b2_ts = _get_ts_ns(2024, 1, 15, 10, 10)
        bar2 = _create_mock_bar(b2_ts, 1002.0, 1002.0, 995.0, 997.0)

        strategy.on_bar(bar2)

        assert len(strategy.trades) == 1
        trade = strategy.trades[0]
        assert trade['exit_reason'] == "SL"
        assert trade['entry_price'] == 1002.0
        assert trade['exit_price'] == 997.0
        assert trade['gross_pnl_pct'] <= -0.4
