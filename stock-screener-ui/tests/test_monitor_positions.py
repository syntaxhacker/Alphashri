"""
Tests for monitor_positions EOD exit behavior.

Verifies that check_exit() is called for ALL strategy types (intraday + swing),
not just swing strategies. This was the core bug fix: the old code gated
check_exit() to SWING_STRATEGY_TYPES only, leaving intraday positions open
past their configured EOD time.
"""

import pytest
from datetime import datetime
from unittest.mock import Mock, MagicMock, patch
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

import config
IST = config.IST

from trading.strategy_runner import StrategyRunner
from trading.shared_portfolio import OrderSide


def _make_position(symbol, side, strategy_id, strategy_name, entry=100, sl=98, tp=102):
    from trading.portfolio.portfolio_models import SharedPosition
    return SharedPosition(
        symbol=symbol,
        side=side,
        quantity=10,
        entry_price=entry,
        stop_loss=sl,
        take_profit=tp,
        entry_time=datetime(2026, 4, 15, 10, 0, tzinfo=IST),
        strategy_id=strategy_id,
        strategy_name=strategy_name,
        current_price=entry,
    )


def _pos_to_dict(pos):
    """Convert SharedPosition to dict matching get_all_positions() output."""
    from trading.risk_utils import position_to_dict
    return position_to_dict(pos, extra_fields={
        'strategy_type': pos.strategy_type,
        'peak_price': pos.peak_price,
        'metadata': pos.metadata,
    })


def _make_signal_generator(returns_eod=False, returns_sl=False):
    from trading.orb_signals import ORBSignal, SignalType
    gen = Mock()
    if returns_eod:
        gen.check_exit.return_value = ORBSignal(
            symbol="TEST", signal_type=SignalType.LONG_EXIT, price=100,
            stop_loss=98, take_profit=102, or_high=0, or_low=0,
            or_range=0, or_range_pct=0, notes="EOD force exit (14:45)",
            timestamp=datetime(2026, 4, 15, 14, 50),
        )
    elif returns_sl:
        gen.check_exit.return_value = ORBSignal(
            symbol="TEST", signal_type=SignalType.LONG_EXIT, price=98,
            stop_loss=98, take_profit=102, or_high=0, or_low=0,
            or_range=0, or_range_pct=0, notes="Stop loss hit",
            timestamp=datetime(2026, 4, 15, 14, 50),
        )
    else:
        gen.check_exit.return_value = None
    return gen


def _make_runner(strategy_id, strategy_type, signal_gen):
    return StrategyRunner(
        strategy_id=strategy_id,
        strategy_name=f"Test {strategy_type}",
        strategy_type=strategy_type,
        config={},
        max_positions=5,
        capital_allocation_pct=20.0,
        signal_generator=signal_gen,
        status="running",
    )


def _build_mixin(portfolio, strategies, ist_now=None):
    from trading.runner_signals import RunnerSignalsMixin
    mixin = RunnerSignalsMixin.__new__(RunnerSignalsMixin)
    mixin.portfolio = portfolio
    mixin.strategies = strategies
    mixin.replay_mode = False
    mixin.cooldown_stocks = {}
    mixin.journal = Mock()
    mixin._get_data_fetcher = Mock()
    mixin._persist_position_to_db = Mock()
    mixin._persist_trade_to_db = Mock()
    mixin._ist_now = Mock(return_value=ist_now or datetime(2026, 4, 15, 14, 50, tzinfo=IST))
    mixin.bot_config = Mock(id=1, name="Test Bot")
    return mixin


def _run_monitor(mixin, prices_dict):
    """Run monitor_positions with prices injected via _get_data_fetcher mock."""
    fake_df = MagicMock()
    fake_df.empty = False
    fake_df.iloc.__getitem__ = Mock(return_value={"high": 101, "low": 99, "close": 100})

    fetcher = Mock()
    fetcher.upstox_api.fetch_intraday_data_v3.return_value = fake_df
    mixin._get_data_fetcher.return_value = fetcher

    with patch('trading.telegram_notifier.send_trade_exit'), \
         patch('trading.telegram_notifier.send_risk_alert'):
        mixin.monitor_positions()
    return mixin


def _run_monitor_with_prices(mixin, price_by_symbol):
    """Run monitor_positions with explicit price data per symbol."""
    fetcher = Mock()

    def fake_fetch(symbol, **kw):
        p = price_by_symbol[symbol]
        df = MagicMock()
        df.empty = False
        df.iloc.__getitem__ = Mock(return_value=p)
        return df

    fetcher.upstox_api.fetch_intraday_data_v3.side_effect = fake_fetch
    mixin._get_data_fetcher.return_value = fetcher

    with patch('trading.telegram_notifier.send_trade_exit'), \
         patch('trading.telegram_notifier.send_risk_alert'):
        mixin.monitor_positions()
    return mixin


class TestMonitorPositionsEODExit:
    """Tests that monitor_positions calls check_exit for all strategy types."""

    def test_intraday_orb_check_exit_called(self):
        gen = _make_signal_generator(returns_eod=True)
        pos = _make_position("TEST", OrderSide.BUY, 1, "ORB Test")
        portfolio = Mock()
        portfolio.positions = {"1_TEST": pos}
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.update_prices = Mock()
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.get_portfolio_status.return_value = {"initial_capital": 1_000_000, "daily_pnl": 0}

        mixin = _build_mixin(portfolio, {1: _make_runner(1, "ORB", gen)})
        _run_monitor(mixin, {})

        gen.check_exit.assert_called_once()
        assert gen.check_exit.call_args[1]["symbol"] == "TEST"
        assert gen.check_exit.call_args[1]["position_side"] == "BUY"

    def test_intraday_sr_breakout_check_exit_called(self):
        gen = _make_signal_generator(returns_eod=True)
        pos = _make_position("TEST", OrderSide.BUY, 2, "SR Breakout")
        portfolio = Mock()
        portfolio.positions = {"2_TEST": pos}
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.update_prices = Mock()
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.get_portfolio_status.return_value = {"initial_capital": 1_000_000, "daily_pnl": 0}

        mixin = _build_mixin(portfolio, {2: _make_runner(2, "SR_BREAKOUT", gen)})
        _run_monitor(mixin, {})

        gen.check_exit.assert_called_once()

    def test_intraday_ema_cross_check_exit_called(self):
        gen = _make_signal_generator(returns_eod=True)
        pos = _make_position("TEST", OrderSide.SELL, 3, "EMA Cross", sl=102, tp=98)
        portfolio = Mock()
        portfolio.positions = {"3_TEST": pos}
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.update_prices = Mock()
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.get_portfolio_status.return_value = {"initial_capital": 1_000_000, "daily_pnl": 0}

        mixin = _build_mixin(portfolio, {3: _make_runner(3, "EMA_CROSS", gen)})
        _run_monitor(mixin, {})

        gen.check_exit.assert_called_once()
        assert gen.check_exit.call_args[1]["position_side"] == "SELL"

    def test_swing_52w_chaser_check_exit_called(self):
        gen = _make_signal_generator(returns_eod=False)
        pos = _make_position("TEST", OrderSide.BUY, 4, "52W Chaser")
        portfolio = Mock()
        portfolio.positions = {"4_TEST": pos}
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.update_prices = Mock()
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.get_portfolio_status.return_value = {"initial_capital": 1_000_000, "daily_pnl": 0}

        mixin = _build_mixin(portfolio, {4: _make_runner(4, "52W_CHASER", gen)})
        _run_monitor(mixin, {})

        gen.check_exit.assert_called_once()

    def test_swing_52w_target_check_exit_called(self):
        gen = _make_signal_generator(returns_eod=False)
        pos = _make_position("TEST", OrderSide.BUY, 5, "52W Target")
        portfolio = Mock()
        portfolio.positions = {"5_TEST": pos}
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.update_prices = Mock()
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.get_portfolio_status.return_value = {"initial_capital": 1_000_000, "daily_pnl": 0}

        mixin = _build_mixin(portfolio, {5: _make_runner(5, "52W_TARGET", gen)})
        _run_monitor(mixin, {})

        gen.check_exit.assert_called_once()

    def test_sl_hit_skips_check_exit(self):
        gen = _make_signal_generator(returns_eod=True)
        pos = _make_position("TEST", OrderSide.BUY, 1, "ORB Test")
        portfolio = Mock()
        portfolio.positions = {"1_TEST": pos}
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.update_prices = Mock()
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.get_portfolio_status.return_value = {"initial_capital": 1_000_000, "daily_pnl": 0}
        portfolio.close_position = Mock(return_value=Mock(trade_id="t1"))

        mixin = _build_mixin(portfolio, {1: _make_runner(1, "ORB", gen)})
        _run_monitor_with_prices(mixin, {"TEST": {"high": 101, "low": 97.5, "close": 100}})

        gen.check_exit.assert_not_called()
        portfolio.close_position.assert_called()

    def test_no_signal_generator_skips_check_exit(self):
        pos = _make_position("TEST", OrderSide.BUY, 1, "ORB Test")
        portfolio = Mock()
        portfolio.positions = {"1_TEST": pos}
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.update_prices = Mock()
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.get_portfolio_status.return_value = {"initial_capital": 1_000_000, "daily_pnl": 0}

        runner = StrategyRunner(
            strategy_id=1, strategy_name="No Gen", strategy_type="ORB",
            config={}, max_positions=5, capital_allocation_pct=20.0,
            signal_generator=None, status="running",
        )
        mixin = _build_mixin(portfolio, {1: runner})
        _run_monitor(mixin, {})

    def test_eod_exit_closes_position(self):
        gen = _make_signal_generator(returns_eod=True)
        pos = _make_position("TEST", OrderSide.BUY, 1, "ORB Test")
        portfolio = Mock()
        portfolio.positions = {"1_TEST": pos}
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.update_prices = Mock()
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos)]
        portfolio.get_portfolio_status.return_value = {"initial_capital": 1_000_000, "daily_pnl": 0}
        portfolio.close_position = Mock(return_value=Mock(trade_id="t1"))

        mixin = _build_mixin(portfolio, {1: _make_runner(1, "ORB", gen)})
        _run_monitor(mixin, {})

        portfolio.close_position.assert_called_once()
        kwargs = portfolio.close_position.call_args[1]
        assert kwargs["symbol"] == "TEST"
        assert kwargs["strategy_id"] == 1
        assert kwargs["exit_price"] == 100
        assert "EOD" in kwargs["exit_reason"]

    def test_multiple_strategies_each_gets_check_exit(self):
        orb_gen = _make_signal_generator(returns_eod=True)
        sr_gen = _make_signal_generator(returns_eod=True)
        pos1 = _make_position("TCS", OrderSide.BUY, 1, "ORB")
        pos2 = _make_position("RELIANCE", OrderSide.SELL, 2, "SR Breakout", sl=102, tp=98)
        portfolio = Mock()
        portfolio.positions = {"1_TCS": pos1, "2_RELIANCE": pos2}
        portfolio.get_all_positions.return_value = [_pos_to_dict(pos1), _pos_to_dict(pos2)]
        portfolio.update_prices = Mock()
        portfolio.get_portfolio_status.return_value = {"initial_capital": 1_000_000, "daily_pnl": 0}
        portfolio.close_position = Mock(return_value=Mock(trade_id="t1"))

        mixin = _build_mixin(portfolio, {
            1: _make_runner(1, "ORB", orb_gen),
            2: _make_runner(2, "SR_BREAKOUT", sr_gen),
        })
        _run_monitor(mixin, {})

        orb_gen.check_exit.assert_called_once()
        sr_gen.check_exit.assert_called_once()
        assert portfolio.close_position.call_count == 2
