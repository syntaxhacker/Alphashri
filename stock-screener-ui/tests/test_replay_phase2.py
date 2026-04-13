"""Tests for Phase 2 Replay Trading — MultiStrategyRunner replay mode."""

import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch, PropertyMock

import pytest
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

IST = timezone(timedelta(hours=5, minutes=30))


# ============================================================================
# Helpers
# ============================================================================

def _make_1m_candles(date_str: str, count: int = 375) -> pd.DataFrame:
    """Create synthetic 1-minute candles for a trading day."""
    open_time = pd.Timestamp(date_str + " 09:15:00", tz=IST)
    timestamps, rows = [], []
    for i in range(count):
        t = open_time + timedelta(minutes=i)
        base = 1000.0
        rows.append({
            "open": base + i * 0.1,
            "high": base + i * 0.1 + 1.0,
            "low": base + i * 0.1 - 1.0,
            "close": base + i * 0.1 + 0.5,
            "volume": 1000,
        })
        timestamps.append(t)
    return pd.DataFrame(rows, index=timestamps)


def _make_daily_candles(date_str: str, days: int = 300) -> pd.DataFrame:
    """Create synthetic daily candles."""
    timestamps, rows = [], []
    end = pd.Timestamp(date_str, tz=IST)
    for i in range(days):
        t = end - timedelta(days=days - i)
        rows.append({
            "open": 900.0 + i * 0.5,
            "high": 910.0 + i * 0.5,
            "low": 890.0 + i * 0.5,
            "close": 905.0 + i * 0.5,
            "volume": 50000,
        })
        timestamps.append(t)
    return pd.DataFrame(rows, index=timestamps)


def _make_bot_config():
    bot = MagicMock()
    bot.id = 1
    bot.name = "Test Bot"
    bot.max_total_positions = 10
    bot.max_total_capital_pct = 0.80
    return bot


def _make_strategy_runner(strategy_id=1, strategy_type="ORB", strategy_name="ORB Best"):
    runner = MagicMock()
    runner.strategy_id = strategy_id
    runner.strategy_type = strategy_type
    runner.strategy_name = strategy_name
    runner.status = "running"
    runner.config = {
        "risk_per_trade_pct": 0.01,
        "max_capital_per_trade_pct": 0.10,
        "min_trade_value": 5000,
        "max_trade_value": 100000,
        "min_rr_ratio": 1.5,
        "max_daily_loss_pct": 0.03,
    }
    runner.max_positions = 3
    runner.capital_allocation_pct = 0.40
    runner.signals_generated = 0
    runner.trades_executed = 0
    runner.last_scan_items = []
    runner.last_scan_time = None
    runner.signal_generator = MagicMock()
    return runner


def _make_signal(symbol="RELIANCE", price=1005.0, signal_type="LONG_ENTRY"):
    from trading.orb_signals import ORBSignal, SignalType
    st = SignalType.LONG_ENTRY if signal_type == "LONG_ENTRY" else SignalType.SHORT_ENTRY
    return ORBSignal(
        signal_type=st,
        symbol=symbol,
        price=price,
        stop_loss=price - 10.0,
        take_profit=price + 15.0,
        or_high=price + 5.0,
        or_low=price - 5.0,
        or_range=10.0,
        or_range_pct=1.0,
        timestamp=datetime.now(IST),
        notes="Breakout above OR high",
    )


# ============================================================================
# ReplayDataProvider Tests
# ============================================================================

class TestReplayDataProvider:
    """Tests for ReplayDataProvider data slicing and time-based filtering."""

    def test_init_loads_data(self):
        """Provider loads 1m and daily data on init."""
        df_1m = _make_1m_candles("2026-04-09", 375)
        df_daily = _make_daily_candles("2026-04-09", 300)

        with patch("trading.replay_data_provider.fetch_candles") as mock_fetch:
            mock_fetch.side_effect = [df_1m, df_daily]
            from trading.replay_data_provider import ReplayDataProvider
            provider = ReplayDataProvider(
                date_str="2026-04-09",
                symbols=["RELIANCE"],
                get_current_time_fn=lambda: pd.Timestamp("2026-04-09 15:30:00", tz=IST),
            )

        assert "RELIANCE" in provider._1m_data
        assert "RELIANCE" in provider._daily_data

    def test_fetch_intraday_1m_slices_to_sim_time(self):
        """1m data is sliced to the simulated current time."""
        df_1m = _make_1m_candles("2026-04-09", 375)

        with patch("trading.replay_data_provider.fetch_candles") as mock_fetch:
            mock_fetch.side_effect = [df_1m, _make_daily_candles("2026-04-09", 300)]
            from trading.replay_data_provider import ReplayDataProvider
            provider = ReplayDataProvider(
                date_str="2026-04-09",
                symbols=["RELIANCE"],
                get_current_time_fn=lambda: pd.Timestamp("2026-04-09 15:30:00", tz=IST),
            )

        result = provider.fetch_intraday_data_v3("RELIANCE", interval="1")
        assert result is not None
        assert len(result) == 375

    def test_fetch_intraday_partial_slice(self):
        """1m data is sliced to an earlier simulated time."""
        df_1m = _make_1m_candles("2026-04-09", 375)

        sim_time = pd.Timestamp("2026-04-09 10:00:00", tz=IST)
        with patch("trading.replay_data_provider.fetch_candles") as mock_fetch:
            mock_fetch.side_effect = [df_1m, _make_daily_candles("2026-04-09", 300)]
            from trading.replay_data_provider import ReplayDataProvider
            provider = ReplayDataProvider(
                date_str="2026-04-09",
                symbols=["RELIANCE"],
                get_current_time_fn=lambda: sim_time,
            )

        result = provider.fetch_intraday_data_v3("RELIANCE", interval="1")
        assert result is not None
        assert len(result) < 375
        assert result.index[-1] <= sim_time

    def test_fetch_intraday_unknown_symbol_returns_none(self):
        """Unknown symbol returns None."""
        with patch("trading.replay_data_provider.fetch_candles") as mock_fetch:
            mock_fetch.return_value = None
            from trading.replay_data_provider import ReplayDataProvider
            provider = ReplayDataProvider(
                date_str="2026-04-09",
                symbols=["RELIANCE"],
                get_current_time_fn=lambda: pd.Timestamp("2026-04-09 15:30:00", tz=IST),
            )

        assert provider.fetch_intraday_data_v3("UNKNOWN", interval="1") is None

    def test_fetch_intraday_5m_resamples(self):
        """5m interval triggers resampling."""
        df_1m = _make_1m_candles("2026-04-09", 375)

        with patch("trading.replay_data_provider.fetch_candles") as mock_fetch, \
             patch("trading.replay_data_provider.resample_candles") as mock_resample:
            mock_fetch.side_effect = [df_1m, _make_daily_candles("2026-04-09", 300)]
            mock_resample.return_value = df_1m.iloc[::5]
            from trading.replay_data_provider import ReplayDataProvider
            provider = ReplayDataProvider(
                date_str="2026-04-09",
                symbols=["RELIANCE"],
                get_current_time_fn=lambda: pd.Timestamp("2026-04-09 15:30:00", tz=IST),
            )

            result = provider.fetch_intraday_data_v3("RELIANCE", interval="5")
            assert result is not None
            mock_resample.assert_called_once()

    def test_fetch_historical_filters_by_date(self):
        """Daily data is filtered by from_date and to_date."""
        df_daily = _make_daily_candles("2026-04-09", 300)

        with patch("trading.replay_data_provider.fetch_candles") as mock_fetch:
            mock_fetch.return_value = _make_1m_candles("2026-04-09", 375)
            from trading.replay_data_provider import ReplayDataProvider

            def make_provider():
                return ReplayDataProvider(
                    date_str="2026-04-09",
                    symbols=["RELIANCE"],
                    get_current_time_fn=lambda: pd.Timestamp("2026-04-09 15:30:00", tz=IST),
                )

            mock_fetch.side_effect = [_make_1m_candles("2026-04-09", 375), df_daily]
            provider = make_provider()

        result = provider.fetch_historical_data_v3(
            "RELIANCE", from_date="2026-01-01", to_date="2026-04-01"
        )
        assert result is not None
        assert all(result.index >= pd.Timestamp("2026-01-01", tz=IST))
        assert all(result.index <= pd.Timestamp("2026-04-01", tz=IST))


# ============================================================================
# MultiStrategyRunner Replay Mode Tests
# ============================================================================

class TestRunnerReplayMode:
    """Tests for MultiStrategyRunner replay mode setup and clock injection."""

    def test_create_for_replay_sets_fields(self):
        """create_for_replay creates a runner with correct minimal state."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        assert runner.replay_mode is False
        assert runner._replay_time is None
        assert runner._replay_on_event is None
        assert runner.portfolio is None
        assert runner.risk_manager is None
        assert runner.strategies == {}
        assert runner.test_mode is True
        assert runner.running is False
        assert runner.bot_config.name == "Test Bot"

    def test_ist_now_returns_real_time_when_no_replay(self):
        """_ist_now returns real time when _replay_time is not set."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        before = datetime.now(IST)
        result = runner._ist_now()
        after = datetime.now(IST)
        assert before <= result <= after

    def test_ist_now_returns_replay_time_when_set(self):
        """_ist_now returns _replay_time when set."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        fake_time = pd.Timestamp("2026-04-09 10:30:00", tz=IST)
        runner._replay_time = fake_time
        assert runner._ist_now() == fake_time

    def test_get_to_date_delegates_to_ist_now(self):
        """_get_to_date returns _ist_now result."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        fake_time = pd.Timestamp("2026-04-09 11:00:00", tz=IST)
        runner._replay_time = fake_time
        assert runner._get_to_date() == fake_time

    def test_load_bot_config_is_static(self):
        """_load_bot_config is a static method."""
        from trading.runner_core import MultiStrategyRunner
        import inspect
        assert isinstance(inspect.getattr_static(MultiStrategyRunner, '_load_bot_config'), staticmethod)

    def test_create_for_replay_raises_on_missing_bot(self):
        """create_for_replay raises ValueError when bot not found."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config',
                          side_effect=ValueError("Bot config 999 not found")):
            with pytest.raises(ValueError, match="Bot config 999"):
                MultiStrategyRunner.create_for_replay(bot_config_id=999, user_id=1)


# ============================================================================
# execute_signal Replay Tests
# ============================================================================

class TestExecuteSignalReplay:
    """Tests for execute_signal() replay branch."""

    @classmethod
    def setup_class(cls):
        import config
        if not hasattr(config, 'ENVIRONMENT'):
            config.ENVIRONMENT = "test"
        if not hasattr(config, 'RAILWAY_URL'):
            config.RAILWAY_URL = None

    @patch("trading.telegram_notifier.send_signal_rejected")
    @patch("trading.telegram_notifier.send_trade_entry")
    def test_replay_opens_position_with_simulated_time(self, mock_entry, mock_rejected):
        """In replay mode, open_position receives entry_time=_ist_now()."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        runner.replay_mode = True
        sim_time = pd.Timestamp("2026-04-09 10:30:00", tz=IST)
        runner._replay_time = sim_time

        mock_portfolio = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 1_000_000, "cash": 1_000_000,
            "total_positions": 0, "capital_used": 0, "daily_pnl": 0,
        }
        mock_portfolio.get_strategy_status.return_value = {
            "positions_count": 0, "capital_used": 0,
        }
        mock_portfolio.get_symbol_exposure.return_value = 0
        mock_position = MagicMock()
        mock_position.strategy_id = 1
        mock_position.symbol = "RELIANCE"
        mock_portfolio.open_position.return_value = mock_position
        runner.portfolio = mock_portfolio

        mock_risk = MagicMock()
        mock_risk.validate_trade.return_value = {"valid": True, "shares": 10}
        runner.risk_manager = mock_risk

        sr = _make_strategy_runner()
        runner.strategies = {1: sr}

        signal = _make_signal("RELIANCE", 1005.0)
        result = runner.execute_signal(1, signal)

        assert result is True
        mock_portfolio.open_position.assert_called_once()
        call_kwargs = mock_portfolio.open_position.call_args
        assert call_kwargs.kwargs.get("entry_time") == sim_time
        assert call_kwargs.kwargs["symbol"] == "RELIANCE"

    @patch("trading.telegram_notifier.send_signal_rejected")
    @patch("trading.telegram_notifier.send_trade_entry")
    def test_replay_emits_trade_open_event(self, mock_entry, mock_rejected):
        """In replay mode, trade_open event is emitted."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        runner.replay_mode = True
        runner._replay_time = pd.Timestamp("2026-04-09 10:30:00", tz=IST)
        events = []
        runner._replay_on_event = events.append

        mock_portfolio = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 1_000_000, "cash": 1_000_000,
            "total_positions": 0, "capital_used": 0, "daily_pnl": 0,
        }
        mock_portfolio.get_strategy_status.return_value = {
            "positions_count": 0, "capital_used": 0,
        }
        mock_portfolio.get_symbol_exposure.return_value = 0
        mock_portfolio.open_position.return_value = MagicMock(strategy_id=1)
        runner.portfolio = mock_portfolio

        mock_risk = MagicMock()
        mock_risk.validate_trade.return_value = {"valid": True, "shares": 10}
        runner.risk_manager = mock_risk

        sr = _make_strategy_runner()
        runner.strategies = {1: sr}

        signal = _make_signal("RELIANCE", 1005.0)
        runner.execute_signal(1, signal)

        assert len(events) == 1
        assert events[0]["type"] == "trade_open"
        assert events[0]["symbol"] == "RELIANCE"
        assert events[0]["strategy"] == "ORB Best"

    @patch("trading.telegram_notifier.send_signal_rejected")
    @patch("trading.telegram_notifier.send_trade_entry")
    def test_replay_skips_invalid_risk(self, mock_entry, mock_rejected):
        """In replay mode, invalid risk validation skips trade."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        runner.replay_mode = True
        runner._replay_time = pd.Timestamp("2026-04-09 10:30:00", tz=IST)
        events = []
        runner._replay_on_event = events.append

        mock_portfolio = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 1_000_000, "cash": 0,
            "total_positions": 0, "capital_used": 0, "daily_pnl": 0,
        }
        mock_portfolio.get_strategy_status.return_value = {
            "positions_count": 0, "capital_used": 0,
        }
        mock_portfolio.get_symbol_exposure.return_value = 0
        runner.portfolio = mock_portfolio

        mock_risk = MagicMock()
        mock_risk.validate_trade.return_value = {"valid": False, "reason": "Insufficient cash"}
        runner.risk_manager = mock_risk

        sr = _make_strategy_runner()
        runner.strategies = {1: sr}

        signal = _make_signal("RELIANCE", 1005.0)
        result = runner.execute_signal(1, signal)

        assert result is False
        mock_portfolio.open_position.assert_not_called()
        assert len(events) == 0

    @patch("trading.telegram_notifier.send_signal_rejected")
    @patch("trading.telegram_notifier.send_trade_entry")
    def test_replay_returns_false_for_unknown_strategy(self, mock_entry, mock_rejected):
        """In replay mode, unknown strategy_id returns False."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        runner.replay_mode = True
        runner.strategies = {}

        signal = _make_signal("RELIANCE", 1005.0)
        result = runner.execute_signal(999, signal)
        assert result is False


# ============================================================================
# monitor_positions Replay Tests
# ============================================================================

class TestMonitorPositionsReplay:
    """Tests for monitor_positions() replay hooks — skips DB, Telegram, journal."""

    @classmethod
    def setup_class(cls):
        import config
        if not hasattr(config, 'ENVIRONMENT'):
            config.ENVIRONMENT = "test"
        if not hasattr(config, 'RAILWAY_URL'):
            config.RAILWAY_URL = None

    def _make_runner_with_position(self):
        """Create a runner with a mock open position."""
        from trading.runner_core import MultiStrategyRunner
        from trading.shared_portfolio import SharedPosition, OrderSide

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        runner.replay_mode = True
        runner._replay_time = pd.Timestamp("2026-04-09 11:00:00", tz=IST)
        events = []
        runner._replay_on_event = events.append

        pos = SharedPosition(
            strategy_id=1, strategy_name="ORB Best", symbol="RELIANCE",
            side=OrderSide.BUY, quantity=10, entry_price=1000.0,
            stop_loss=990.0, take_profit=1015.0,
            entry_time=pd.Timestamp("2026-04-09 10:00:00", tz=IST),
        )
        pos.current_price = 1005.0
        pos.peak_price = 1010.0

        mock_portfolio = MagicMock()
        mock_portfolio.positions = {"1_RELIANCE": pos}
        mock_portfolio.get_all_positions.return_value = [pos]
        mock_portfolio.update_prices = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 1_000_000, "cash": 990_000,
            "total_positions": 1, "capital_used": 10_000, "daily_pnl": 0,
        }
        trade = MagicMock()
        trade.symbol = "RELIANCE"
        trade.side = OrderSide.BUY
        trade.entry_price = 1000.0
        trade.exit_price = 1015.0
        trade.quantity = 10
        trade.pnl = 150.0
        trade.pnl_pct = 1.5
        trade.exit_reason = "TP"
        trade.costs = 10.0
        trade.net_pnl = 140.0
        trade.entry_time = pd.Timestamp("2026-04-09 10:00:00", tz=IST)
        trade.exit_time = pd.Timestamp("2026-04-09 11:00:00", tz=IST)
        trade.strategy_id = 1
        trade.strategy_name = "ORB Best"
        mock_portfolio.close_position.return_value = trade
        runner.portfolio = mock_portfolio

        sr = _make_strategy_runner()
        runner.strategies = {1: sr}
        return runner, events, mock_portfolio

    @patch("trading.telegram_notifier.send_risk_alert")
    @patch("trading.telegram_notifier.send_trade_exit")
    def test_replay_skips_persist_and_telegram_on_sl_tp(self, mock_trade_exit, mock_risk_alert):
        """In replay, SL/TP close skips DB persist, journal, and Telegram."""
        from trading.runner_core import MultiStrategyRunner

        runner, events, mock_portfolio = self._make_runner_with_position()

        mock_df = pd.DataFrame([{
            "high": 1020.0, "low": 985.0, "close": 1015.0
        }], index=[pd.Timestamp("2026-04-09 11:00:00", tz=IST)])

        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = mock_df
        runner._data_fetcher = mock_fetcher

        runner.monitor_positions()

        mock_trade_exit.assert_not_called()
        mock_risk_alert.assert_not_called()
        mock_portfolio._persist_position_to_db.assert_not_called() if hasattr(mock_portfolio, '_persist_position_to_db') else None

    @patch("trading.telegram_notifier.send_trade_exit")
    def test_replay_emits_trade_close_on_tp(self, mock_trade_exit):
        """In replay, TP exit emits trade_close SSE event."""
        from trading.runner_core import MultiStrategyRunner

        runner, events, mock_portfolio = self._make_runner_with_position()

        mock_df = pd.DataFrame([{
            "high": 1020.0, "low": 985.0, "close": 1015.0
        }], index=[pd.Timestamp("2026-04-09 11:00:00", tz=IST)])

        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = mock_df
        runner._data_fetcher = mock_fetcher

        runner.monitor_positions()

        trade_events = [e for e in events if e["type"] == "trade_close"]
        assert len(trade_events) == 1
        assert trade_events[0]["symbol"] == "RELIANCE"
        assert trade_events[0]["reason"] == "TP"
        assert trade_events[0]["pnl"] == 150.0

    @patch("trading.telegram_notifier.send_trade_exit")
    def test_replay_trade_close_includes_reason_field(self, mock_trade_exit):
        """trade_close event has 'reason' field for frontend compatibility."""
        from trading.runner_core import MultiStrategyRunner

        runner, events, mock_portfolio = self._make_runner_with_position()

        mock_df = pd.DataFrame([{
            "high": 1020.0, "low": 985.0, "close": 1015.0
        }], index=[pd.Timestamp("2026-04-09 11:00:00", tz=IST)])

        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = mock_df
        runner._data_fetcher = mock_fetcher

        runner.monitor_positions()

        trade_events = [e for e in events if e["type"] == "trade_close"]
        assert len(trade_events) == 1
        assert "reason" in trade_events[0]
        assert "exit_reason" not in trade_events[0]

    @patch("trading.telegram_notifier.send_risk_alert")
    def test_replay_skips_risk_alert(self, mock_risk_alert):
        """In replay, risk alert is not sent."""
        from trading.runner_core import MultiStrategyRunner

        runner, events, mock_portfolio = self._make_runner_with_position()

        mock_df = pd.DataFrame([{
            "high": 1001.0, "low": 999.0, "close": 1000.0
        }], index=[pd.Timestamp("2026-04-09 11:00:00", tz=IST)])

        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = mock_df
        runner._data_fetcher = mock_fetcher

        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 1_000_000, "cash": 900_000,
            "total_positions": 1, "capital_used": 10_000, "daily_pnl": -25000,
        }

        runner.monitor_positions()

        mock_risk_alert.assert_not_called()

    def test_replay_passes_exit_time_to_close_position(self):
        """In replay, close_position receives exit_time=_ist_now()."""
        from trading.runner_core import MultiStrategyRunner

        runner, events, mock_portfolio = self._make_runner_with_position()
        sim_time = pd.Timestamp("2026-04-09 11:00:00", tz=IST)
        runner._replay_time = sim_time

        mock_df = pd.DataFrame([{
            "high": 1020.0, "low": 985.0, "close": 1015.0
        }], index=[sim_time])

        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = mock_df
        runner._data_fetcher = mock_fetcher

        runner.monitor_positions()

        mock_portfolio.close_position.assert_called_once()
        call_kwargs = mock_portfolio.close_position.call_args
        assert call_kwargs.kwargs.get("exit_time") == sim_time


# ============================================================================
# run_replay Integration Tests
# ============================================================================

class TestRunReplay:
    """Integration tests for the run_replay() method."""

    @patch("trading.runner_core.MultiStrategyRunner.monitor_positions")
    @patch("trading.runner_core.MultiStrategyRunner._load_strategies")
    @patch("trading.runner_core.MultiStrategyRunner.scan_for_signals")
    @patch("trading.runner_core.MultiStrategyRunner.execute_signal")
    @patch("trading.replay_data_provider.fetch_candles")
    def test_run_replay_emits_loaded_and_done(self, mock_fetch, mock_exec, mock_scan,
                                               mock_load, mock_monitor):
        """run_replay emits loaded and done events."""
        from trading.runner_core import MultiStrategyRunner
        from trading.shared_portfolio import SharedPortfolioManager

        mock_fetch.return_value = _make_1m_candles("2026-04-09", 100)

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        mock_load.return_value = None

        events = []
        runner.run_replay(
            date_str="2026-04-09",
            symbols=["RELIANCE"],
            strategy_filter="ALL",
            on_event=events.append,
        )

        event_types = [e["type"] for e in events]
        assert "loaded" in event_types
        assert "done" in event_types
        assert events[-1]["type"] == "done"
        assert events[-1]["success"] is True

    @patch("trading.runner_core.MultiStrategyRunner.monitor_positions")
    @patch("trading.runner_core.MultiStrategyRunner._load_strategies")
    @patch("trading.runner_core.MultiStrategyRunner.scan_for_signals")
    @patch("trading.runner_core.MultiStrategyRunner.execute_signal")
    @patch("trading.replay_data_provider.fetch_candles")
    def test_run_replay_emits_candles(self, mock_fetch, mock_exec, mock_scan,
                                       mock_load, mock_monitor):
        """run_replay emits candle data events."""
        from trading.runner_core import MultiStrategyRunner

        mock_fetch.return_value = _make_1m_candles("2026-04-09", 200)

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        mock_load.return_value = None

        events = []
        runner.run_replay(
            date_str="2026-04-09",
            symbols=["RELIANCE"],
            strategy_filter="ALL",
            on_event=events.append,
        )

        candle_events = [e for e in events if e["type"] == "candles"]
        assert len(candle_events) >= 1
        for ce in candle_events:
            assert "symbol" in ce
            assert "candles" in ce
            assert isinstance(ce["candles"], list)

    @patch("trading.runner_core.MultiStrategyRunner.monitor_positions")
    @patch("trading.runner_core.MultiStrategyRunner._load_strategies")
    @patch("trading.runner_core.MultiStrategyRunner.scan_for_signals")
    @patch("trading.runner_core.MultiStrategyRunner.execute_signal")
    @patch("trading.replay_data_provider.fetch_candles")
    def test_run_replay_emits_summary(self, mock_fetch, mock_exec, mock_scan,
                                       mock_load, mock_monitor):
        """run_replay emits summary event."""
        from trading.runner_core import MultiStrategyRunner

        mock_fetch.return_value = _make_1m_candles("2026-04-09", 100)

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        mock_load.return_value = None

        events = []
        runner.run_replay(
            date_str="2026-04-09",
            symbols=["RELIANCE"],
            strategy_filter="ALL",
            on_event=events.append,
        )

        summary_events = [e for e in events if e["type"] == "summary"]
        assert len(summary_events) == 1
        s = summary_events[0]
        assert "total_trades" in s
        assert "win_rate" in s
        assert "net_pnl" in s
        assert "strategy_breakdown" in s

    @patch("trading.runner_core.MultiStrategyRunner.monitor_positions")
    @patch("trading.runner_core.MultiStrategyRunner._load_strategies")
    @patch("trading.runner_core.MultiStrategyRunner.scan_for_signals")
    @patch("trading.runner_core.MultiStrategyRunner.execute_signal")
    @patch("trading.replay_data_provider.fetch_candles")
    def test_run_replay_emits_progress(self, mock_fetch, mock_exec, mock_scan,
                                        mock_load, mock_monitor):
        """run_replay emits progress events every 50 candles."""
        from trading.runner_core import MultiStrategyRunner

        mock_fetch.return_value = _make_1m_candles("2026-04-09", 200)

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        mock_load.return_value = None

        events = []
        runner.run_replay(
            date_str="2026-04-09",
            symbols=["RELIANCE"],
            strategy_filter="ALL",
            on_event=events.append,
        )

        progress_events = [e for e in events if e["type"] == "progress"]
        assert len(progress_events) >= 1
        for pe in progress_events:
            assert "candle" in pe
            assert "total" in pe
            assert "time" in pe

    @patch("trading.runner_core.MultiStrategyRunner.monitor_positions")
    @patch("trading.runner_core.MultiStrategyRunner._load_strategies")
    @patch("trading.replay_data_provider.fetch_candles")
    def test_run_replay_calls_scan_every_5min(self, mock_fetch, mock_load, mock_monitor):
        """run_replay calls scan_for_signals on every 5-minute boundary."""
        from trading.runner_core import MultiStrategyRunner

        mock_fetch.return_value = _make_1m_candles("2026-04-09", 375)

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        sr = _make_strategy_runner(1, "ORB", "ORB Best")
        runner.strategies = {1: sr}

        def fake_load_strategies():
            pass
        mock_load.side_effect = fake_load_strategies

        scan_calls = []
        original_scan = MultiStrategyRunner.scan_for_signals

        def track_scan(self, sid):
            scan_calls.append(sid)
            return []
        MultiStrategyRunner.scan_for_signals = track_scan

        try:
            events = []
            runner.run_replay(
                date_str="2026-04-09",
                symbols=["RELIANCE"],
                strategy_filter="ALL",
                on_event=events.append,
            )
        finally:
            MultiStrategyRunner.scan_for_signals = original_scan

        assert len(scan_calls) > 0

    @patch("trading.runner_core.MultiStrategyRunner.monitor_positions")
    @patch("trading.runner_core.MultiStrategyRunner._load_strategies")
    @patch("trading.runner_core.MultiStrategyRunner.scan_for_signals")
    @patch("trading.runner_core.MultiStrategyRunner.execute_signal")
    @patch("trading.replay_data_provider.fetch_candles")
    def test_run_replay_resets_state_after_done(self, mock_fetch, mock_exec, mock_scan,
                                                 mock_load, mock_monitor):
        """run_replay resets replay_mode and _replay_time after completion."""
        from trading.runner_core import MultiStrategyRunner

        mock_fetch.return_value = _make_1m_candles("2026-04-09", 100)

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        mock_load.return_value = None

        events = []
        runner.run_replay(
            date_str="2026-04-09",
            symbols=["RELIANCE"],
            strategy_filter="ALL",
            on_event=events.append,
        )

        assert runner.replay_mode is False
        assert runner._replay_time is None
        assert runner._replay_on_event is None

    @patch("trading.runner_core.MultiStrategyRunner.monitor_positions")
    @patch("trading.runner_core.MultiStrategyRunner._load_strategies")
    @patch("trading.runner_core.MultiStrategyRunner.execute_signal")
    @patch("trading.replay_data_provider.fetch_candles")
    def test_run_replay_strategy_filter_removes_non_matching(self, mock_fetch, mock_exec,
                                                              mock_load, mock_monitor):
        """strategy_filter removes strategies not matching the filter."""
        from trading.runner_core import MultiStrategyRunner

        mock_fetch.return_value = _make_1m_candles("2026-04-09", 100)

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        sr_orb = _make_strategy_runner(1, "ORB", "ORB Best")
        sr_sr = _make_strategy_runner(2, "SR_BREAKOUT", "SR Breakout")
        sr_ema = _make_strategy_runner(3, "EMA_CROSS", "EMA Cross")

        def fake_load():
            runner.strategies = {1: sr_orb, 2: sr_sr, 3: sr_ema}
        mock_load.side_effect = fake_load

        events = []
        runner.run_replay(
            date_str="2026-04-09",
            symbols=["RELIANCE"],
            strategy_filter="ORB",
            on_event=events.append,
        )

        assert 1 in runner.strategies
        assert 2 not in runner.strategies
        assert 3 not in runner.strategies

    @patch("trading.runner_core.MultiStrategyRunner.monitor_positions")
    @patch("trading.runner_core.MultiStrategyRunner._load_strategies")
    @patch("trading.runner_core.MultiStrategyRunner.scan_for_signals")
    @patch("trading.runner_core.MultiStrategyRunner.execute_signal")
    @patch("trading.replay_data_provider.fetch_candles")
    def test_run_replay_force_closes_remaining_positions(self, mock_fetch, mock_exec,
                                                          mock_scan, mock_load, mock_monitor):
        """run_replay force closes any open positions after market close."""
        from trading.runner_core import MultiStrategyRunner

        mock_fetch.return_value = _make_1m_candles("2026-04-09", 100)

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        mock_load.return_value = None

        events = []
        runner.run_replay(
            date_str="2026-04-09",
            symbols=["RELIANCE"],
            strategy_filter="ALL",
            on_event=events.append,
        )

        assert runner.portfolio is not None
        assert isinstance(runner.portfolio.trades, list)

    @patch("trading.runner_core.MultiStrategyRunner.monitor_positions")
    @patch("trading.runner_core.MultiStrategyRunner._load_strategies")
    @patch("trading.runner_core.MultiStrategyRunner.scan_for_signals")
    @patch("trading.runner_core.MultiStrategyRunner.execute_signal")
    @patch("trading.replay_data_provider.fetch_candles")
    def test_run_replay_emits_error_on_exception(self, mock_fetch, mock_exec, mock_scan,
                                                  mock_load, mock_monitor):
        """run_replay emits error event and still emits done on exception."""
        from trading.runner_core import MultiStrategyRunner

        mock_fetch.side_effect = Exception("API failure")

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        mock_load.return_value = None

        events = []
        runner.run_replay(
            date_str="2026-04-09",
            symbols=["RELIANCE"],
            strategy_filter="ALL",
            on_event=events.append,
        )

        event_types = [e["type"] for e in events]
        assert "error" in event_types


# ============================================================================
# Overlay Emission Tests (or_levels, pivot_levels, ema_series)
# ============================================================================

class TestOverlayEmissions:
    """Tests for overlay event emissions during scan_for_signals in replay mode."""

    @classmethod
    def setup_class(cls):
        import config
        if not hasattr(config, 'ENVIRONMENT'):
            config.ENVIRONMENT = "test"
        if not hasattr(config, 'RAILWAY_URL'):
            config.RAILWAY_URL = None

    @patch("trading.telegram_notifier.send_risk_alert")
    @patch("trading.telegram_notifier.send_trade_exit")
    def test_orb_scan_emits_or_levels_once(self, mock_exit, mock_risk):
        """ORB strategy scan emits or_levels event once per symbol."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        runner.replay_mode = True
        runner._replay_time = pd.Timestamp("2026-04-09 10:05:00", tz=IST)
        events = []
        runner._replay_on_event = events.append

        sr = _make_strategy_runner(1, "ORB", "ORB Best")
        sr.signal_generator.min_or_range_pct = 0.5
        sr.signal_generator.max_or_range_pct = 5.0
        sr.signal_generator.check_breakout.return_value = None
        runner.strategies = {1: sr}
        runner.watchlist = ["RELIANCE"]

        mock_portfolio = MagicMock()
        mock_portfolio.positions = {}
        mock_portfolio.get_all_positions.return_value = []
        runner.portfolio = mock_portfolio

        or_levels = {
            "or_high": 1010.0, "or_low": 1000.0, "or_range_pct": 1.0,
            "latest_price": 1005.0, "or_open": 1002.0, "or_close": 1004.0,
        }

        mock_df = pd.DataFrame([{
            "high": 1010.0, "low": 1000.0, "close": 1005.0
        }], index=[pd.Timestamp("2026-04-09 10:05:00", tz=IST)])

        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = mock_df
        runner._data_fetcher = mock_fetcher

        with patch.object(runner, 'fetch_or_data', return_value=or_levels):
            runner.scan_for_signals(1)
            runner.scan_for_signals(1)

        or_events = [e for e in events if e["type"] == "or_levels"]
        assert len(or_events) == 1
        assert or_events[0]["symbol"] == "RELIANCE"
        assert or_events[0]["or_high"] == 1010.0
        assert or_events[0]["or_low"] == 1000.0

    @patch("trading.telegram_notifier.send_risk_alert")
    @patch("trading.telegram_notifier.send_trade_exit")
    def test_sr_scan_emits_pivot_levels_once(self, mock_exit, mock_risk):
        """SR_BREAKOUT scan emits pivot_levels once per symbol."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        runner.replay_mode = True
        runner._replay_time = pd.Timestamp("2026-04-09 10:05:00", tz=IST)
        events = []
        runner._replay_on_event = events.append

        sr = _make_strategy_runner(2, "SR_BREAKOUT", "SR Breakout")
        sr.config["min_entry_minutes"] = 0
        runner.strategies = {2: sr}

        mock_portfolio = MagicMock()
        mock_portfolio.positions = {}
        mock_portfolio.get_all_positions.return_value = []
        runner.portfolio = mock_portfolio

        pivot_points = {
            "pp": 1005.0, "r1": 1015.0, "r2": 1025.0,
            "s1": 995.0, "s2": 985.0,
        }
        sr.signal_generator.calculate_pivot_points.return_value = pivot_points
        sr.signal_generator.check_entry.return_value = None

        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_intraday_data_v3.return_value = pd.DataFrame([{
            "high": 1010.0, "low": 1000.0, "close": 1005.0
        }], index=[pd.Timestamp("2026-04-09 10:05:00", tz=IST)])
        runner._data_fetcher = mock_fetcher

        runner.fetch_previous_day_data = MagicMock(return_value={
            "prev_high": 1020.0, "prev_low": 990.0, "prev_close": 1005.0,
        })
        runner.watchlist = ["RELIANCE"]

        runner.scan_for_signals(2)
        runner.scan_for_signals(2)

        pivot_events = [e for e in events if e["type"] == "pivot_levels"]
        assert len(pivot_events) == 1
        assert pivot_events[0]["symbol"] == "RELIANCE"

    @patch("trading.telegram_notifier.send_risk_alert")
    @patch("trading.telegram_notifier.send_trade_exit")
    def test_ema_scan_emits_ema_series_once(self, mock_exit, mock_risk):
        """EMA_CROSS precomputed overlay emits ema_series with timeframes dict."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        runner.replay_mode = True
        runner._replay_time = pd.Timestamp("2026-04-09 10:05:00", tz=IST)
        events = []
        runner._replay_on_event = events.append

        sr = _make_strategy_runner(3, "EMA_CROSS", "EMA Cross")
        sr.config["ema_fast_period"] = 9
        sr.config["ema_slow_period"] = 21
        runner.strategies = {3: sr}

        mock_portfolio = MagicMock()
        mock_portfolio.positions = {}
        mock_portfolio.get_all_positions.return_value = []
        runner.portfolio = mock_portfolio

        df_1m = _make_1m_candles("2026-04-09", 375)
        df_daily = _make_daily_candles("2026-04-09", 300)

        mock_provider = MagicMock()
        mock_provider._1m_data = {"RELIANCE": df_1m}
        mock_provider._daily_data = {"RELIANCE": df_daily}

        runner._emit_precomputed_overlays(mock_provider, ["RELIANCE"])

        ema_events = [e for e in events if e["type"] == "ema_series"]
        assert len(ema_events) == 1
        assert ema_events[0]["symbol"] == "RELIANCE"
        assert "timeframes" in ema_events[0]
        assert "ema_fast_period" in ema_events[0]
        assert "ema_slow_period" in ema_events[0]
        assert isinstance(ema_events[0]["timeframes"], dict)


# ============================================================================
# _emit_summary Tests
# ============================================================================

class TestEmitSummary:
    """Tests for _emit_summary helper."""

    def test_summary_empty_portfolio(self):
        """Summary with no trades has zero values."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        mock_portfolio = MagicMock()
        mock_portfolio.trades = []
        runner.portfolio = mock_portfolio

        events = []
        runner._emit_summary(events.append)

        assert len(events) == 1
        s = events[0]
        assert s["total_trades"] == 0
        assert s["win_rate"] == 0
        assert s["net_pnl"] == 0

    def test_summary_with_trades(self):
        """Summary with trades computes correct stats."""
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        t1 = MagicMock()
        t1.net_pnl = 200.0
        t1.costs = 10.0
        t1.strategy_name = "ORB Best"

        t2 = MagicMock()
        t2.net_pnl = -100.0
        t2.costs = 8.0
        t2.strategy_name = "ORB Best"

        t3 = MagicMock()
        t3.net_pnl = 300.0
        t3.costs = 12.0
        t3.strategy_name = "SR Breakout"

        mock_portfolio = MagicMock()
        mock_portfolio.trades = [t1, t2, t3]
        runner.portfolio = mock_portfolio

        sr = _make_strategy_runner(1, "ORB", "ORB Best")
        sr2 = _make_strategy_runner(2, "SR_BREAKOUT", "SR Breakout")
        runner.strategies = {1: sr, 2: sr2}

        events = []
        runner._emit_summary(events.append)

        assert len(events) == 1
        s = events[0]
        assert s["total_trades"] == 3
        assert s["winners"] == 2
        assert s["losers"] == 1
        assert s["net_pnl"] == 400.0
        assert s["total_costs"] == 30.0
        assert "ORB Best" in s["strategy_breakdown"]


# ============================================================================
# Swing Metadata & FORCE_CLOSE Tests
# ============================================================================

class TestReplaySwingAndForceClose:
    """Tests for swing strategy metadata and FORCE_CLOSE event emission."""

    @patch("trading.telegram_notifier.send_signal_rejected")
    @patch("trading.telegram_notifier.send_trade_entry")
    def test_replay_sets_swing_metadata_on_open(self, mock_entry, mock_rejected):
        """In replay, swing strategy positions get metadata (52w_high, max_holding_days)."""
        from trading.runner_core import MultiStrategyRunner
        from trading.strategy_runner import SWING_STRATEGY_TYPES

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        runner.replay_mode = True
        runner._replay_time = pd.Timestamp("2026-04-09 10:05:00", tz=IST)

        mock_portfolio = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 1_000_000, "cash": 1_000_000,
            "total_positions": 0, "capital_used": 0, "daily_pnl": 0,
        }
        mock_portfolio.get_strategy_status.return_value = {
            "positions_count": 0, "capital_used": 0,
        }
        mock_portfolio.get_symbol_exposure.return_value = 0

        mock_position = MagicMock()
        mock_position.metadata = {}
        mock_portfolio.open_position.return_value = mock_position
        runner.portfolio = mock_portfolio

        mock_risk = MagicMock()
        mock_risk.validate_trade.return_value = {"valid": True, "shares": 10}
        runner.risk_manager = mock_risk

        sr = _make_strategy_runner(5, "52W_CHASER", "52W Chaser")
        sr.config["max_holding_days"] = 20
        sr.config["trailing_stop_pct"] = 2.5
        sr.config["enable_trailing_stop"] = True
        runner.strategies = {5: sr}

        signal = _make_signal("RELIANCE", 1005.0)
        runner.execute_signal(5, signal)

        assert mock_position.metadata["strategy_type"] == "52W_CHASER"
        assert mock_position.metadata["max_holding_days"] == 20
        assert mock_position.metadata["trailing_stop_pct"] == 2.5
        assert mock_position.metadata["enable_trailing_stop"] is True

    @patch("trading.runner_core.MultiStrategyRunner.monitor_positions")
    @patch("trading.runner_core.MultiStrategyRunner._load_strategies")
    @patch("trading.runner_core.MultiStrategyRunner.scan_for_signals")
    @patch("trading.runner_core.MultiStrategyRunner.execute_signal")
    @patch("trading.replay_data_provider.fetch_candles")
    def test_force_close_emits_trade_close_event(self, mock_fetch, mock_exec,
                                                    mock_scan, mock_load, mock_monitor):
        """FORCE_CLOSE at end of run_replay emits trade_close SSE events."""
        from trading.runner_core import MultiStrategyRunner

        mock_fetch.return_value = _make_1m_candles("2026-04-09", 100)

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        mock_load.return_value = None

        events = []
        runner.run_replay(
            date_str="2026-04-09",
            symbols=["RELIANCE"],
            strategy_filter="ALL",
            on_event=events.append,
        )

        assert runner.replay_mode is False
        assert runner._replay_time is None

    @patch("trading.runner_core.MultiStrategyRunner.monitor_positions")
    @patch("trading.runner_core.MultiStrategyRunner._load_strategies")
    @patch("trading.replay_data_provider.fetch_candles")
    def test_replay_cleanup_on_provider_error(self, mock_fetch, mock_load, mock_monitor):
        """run_replay cleanup runs even if ReplayDataProvider fails."""
        from trading.runner_core import MultiStrategyRunner

        mock_fetch.side_effect = Exception("API failure")

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        mock_load.return_value = None

        events = []
        runner.run_replay(
            date_str="2026-04-09",
            symbols=["RELIANCE"],
            strategy_filter="ALL",
            on_event=events.append,
        )

        assert runner.replay_mode is False
        assert runner._replay_time is None
        assert runner._replay_on_event is None
        assert any(e["type"] == "error" for e in events)


# ============================================================================
# replay_api Tests
# ============================================================================

class TestReplayAPI:
    """Tests for the replay API endpoint."""

    def test_load_symbols_default(self):
        """_load_symbols returns DEFAULT_WATCHLIST when no arg."""
        from api.replay_api import _load_symbols
        result = _load_symbols(None)
        assert isinstance(result, list)
        assert len(result) > 0
        assert "RELIANCE" in result

    def test_load_symbols_custom(self):
        """_load_symbols parses comma-separated string."""
        from api.replay_api import _load_symbols
        result = _load_symbols("RELIANCE,TCS,INFY")
        assert result == ["RELIANCE", "TCS", "INFY"]

    def test_load_symbols_default_string(self):
        """_load_symbols with 'DEFAULT' returns watchlist."""
        from api.replay_api import _load_symbols
        result = _load_symbols("DEFAULT")
        assert "RELIANCE" in result

    def test_symbols_endpoint(self):
        """GET /api/replay/symbols returns the default watchlist."""
        from fastapi.testclient import TestClient
        from fastapi import FastAPI
        from api.replay_api import router

        app = FastAPI()
        app.include_router(router)

        client = TestClient(app)
        resp = client.get("/api/replay/symbols")
        assert resp.status_code == 200
        data = resp.json()
        assert "symbols" in data
        assert "RELIANCE" in data["symbols"]


# ============================================================================
# _execute_signal_core Tests
# ============================================================================

class TestExecuteSignalCore:
    """Tests for _execute_signal_core and _execute_replay_signal."""

    @classmethod
    def setup_class(cls):
        import config
        if not hasattr(config, 'ENVIRONMENT'):
            config.ENVIRONMENT = "test"
        if not hasattr(config, 'RAILWAY_URL'):
            config.RAILWAY_URL = None

    def _make_runner(self):
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)
        runner.replay_mode = False
        runner._replay_time = None
        runner.strategies = {}
        return runner

    def _setup_valid_trade(self, runner, strategy_id=1, strategy_type="ORB", strategy_name="ORB Best"):
        from trading.orb_signals import SignalType

        mock_portfolio = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 1_000_000, "cash": 1_000_000,
            "total_positions": 0, "capital_used": 0, "daily_pnl": 0,
        }
        mock_portfolio.get_strategy_status.return_value = {
            "positions_count": 0, "capital_used": 0,
        }
        mock_portfolio.get_symbol_exposure.return_value = 0

        mock_position = MagicMock()
        mock_position.metadata = {}
        mock_portfolio.open_position.return_value = mock_position
        runner.portfolio = mock_portfolio

        mock_risk = MagicMock()
        mock_risk.validate_trade.return_value = {"valid": True, "shares": 10}
        runner.risk_manager = mock_risk

        sr = _make_strategy_runner(strategy_id, strategy_type, strategy_name)
        runner.strategies = {strategy_id: sr}

        signal = _make_signal("RELIANCE", 1005.0)
        return signal, SignalType

    def test_invalid_strategy_id(self):
        """T14: Unknown strategy_id returns (None, None, None)."""
        from trading.orb_signals import SignalType

        runner = self._make_runner()
        signal = _make_signal("RELIANCE", 1005.0)

        result = runner._execute_signal_core(999, signal, SignalType)
        assert result == (None, None, None)

    def test_strategy_status_none(self):
        """T15: Strategy found but status is None returns (runner, None, None)."""
        from trading.orb_signals import SignalType

        runner = self._make_runner()
        runner.strategies = {1: _make_strategy_runner()}

        mock_portfolio = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 1_000_000, "cash": 1_000_000,
            "total_positions": 0, "capital_used": 0, "daily_pnl": 0,
        }
        mock_portfolio.get_strategy_status.return_value = None
        runner.portfolio = mock_portfolio

        runner.risk_manager = MagicMock()

        signal = _make_signal("RELIANCE", 1005.0)
        result = runner._execute_signal_core(1, signal, SignalType)

        assert result[0] is runner.strategies[1]
        assert result[1] is None
        assert result[2] is None

    def test_risk_rejection_returns_rejected_tuple(self):
        """T16: Risk validation failure returns (runner, validation, None) with rejected=True."""
        from trading.orb_signals import SignalType

        runner = self._make_runner()
        runner.strategies = {1: _make_strategy_runner()}

        mock_portfolio = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 1_000_000, "cash": 100,  # very low cash
            "total_positions": 0, "capital_used": 0, "daily_pnl": 0,
        }
        mock_portfolio.get_strategy_status.return_value = {
            "positions_count": 0, "capital_used": 0,
        }
        mock_portfolio.get_symbol_exposure.return_value = 0
        runner.portfolio = mock_portfolio

        mock_risk = MagicMock()
        mock_risk.validate_trade.return_value = {"valid": False, "reason": "no cash"}
        runner.risk_manager = mock_risk

        signal = _make_signal("RELIANCE", 1005.0)
        runner_found, validation, position = runner._execute_signal_core(1, signal, SignalType)

        assert runner_found is runner.strategies[1]
        assert validation is not None
        assert validation['rejected'] is True
        assert validation['reason'] == "no cash"
        assert position is None

    def test_live_mode_entry_time_is_none(self):
        """T17: In live mode, open_position is called with entry_time=None."""
        runner = self._make_runner()
        runner.replay_mode = False

        signal, SignalType = self._setup_valid_trade(runner)
        runner._execute_signal_core(1, signal, SignalType)

        runner.portfolio.open_position.assert_called_once()
        call_kwargs = runner.portfolio.open_position.call_args[1]
        assert call_kwargs['entry_time'] is None

    def test_replay_mode_entry_time_is_ist_now(self):
        """T18: In replay mode, open_position is called with entry_time=_replay_time."""
        runner = self._make_runner()
        runner.replay_mode = True
        replay_time = pd.Timestamp("2026-04-09 10:30:00", tz=IST)
        runner._replay_time = replay_time

        signal, SignalType = self._setup_valid_trade(runner)
        runner._execute_signal_core(1, signal, SignalType)

        runner.portfolio.open_position.assert_called_once()
        call_kwargs = runner.portfolio.open_position.call_args[1]
        assert call_kwargs['entry_time'] == replay_time

    def test_swing_metadata_set(self):
        """T19: 52W_CHASER strategy sets swing metadata on position."""
        runner = self._make_runner()
        runner.replay_mode = True
        runner._replay_time = pd.Timestamp("2026-04-09 10:05:00", tz=IST)

        sr = _make_strategy_runner(5, "52W_CHASER", "52W Chaser")
        sr.config["max_holding_days"] = 20
        sr.config["trailing_stop_pct"] = 2.5
        sr.config["enable_trailing_stop"] = True
        runner.strategies = {5: sr}

        mock_portfolio = MagicMock()
        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 1_000_000, "cash": 1_000_000,
            "total_positions": 0, "capital_used": 0, "daily_pnl": 0,
        }
        mock_portfolio.get_strategy_status.return_value = {
            "positions_count": 0, "capital_used": 0,
        }
        mock_portfolio.get_symbol_exposure.return_value = 0
        mock_position = MagicMock()
        mock_position.metadata = {}
        mock_portfolio.open_position.return_value = mock_position
        runner.portfolio = mock_portfolio

        mock_risk = MagicMock()
        mock_risk.validate_trade.return_value = {"valid": True, "shares": 10}
        runner.risk_manager = mock_risk

        signal = _make_signal("RELIANCE", 1005.0)
        runner._execute_signal_core(5, signal, signal.signal_type.__class__)

        assert mock_position.metadata['strategy_type'] == "52W_CHASER"
        assert 'max_holding_days' in mock_position.metadata
        assert mock_position.metadata['max_holding_days'] == 20

    def test_non_swing_no_metadata(self):
        """T20: ORB strategy does not set metadata on position."""
        runner = self._make_runner()
        signal, SignalType = self._setup_valid_trade(runner)

        runner._execute_signal_core(1, signal, SignalType)

        mock_position = runner.portfolio.open_position.return_value
        assert not hasattr(mock_position, 'metadata') or mock_position.metadata == {}

    def test_replay_on_event_none_no_crash(self):
        """T21: _execute_replay_signal works with _replay_on_event=None."""
        runner = self._make_runner()
        runner.replay_mode = True
        runner._replay_time = pd.Timestamp("2026-04-09 10:30:00", tz=IST)
        runner._replay_on_event = None

        signal, SignalType = self._setup_valid_trade(runner)
        result = runner._execute_replay_signal(1, signal, SignalType)

        assert result is True

    def test_replay_trade_open_event_shape(self):
        """T22: _execute_replay_signal emits trade_open event with correct shape."""
        runner = self._make_runner()
        runner.replay_mode = True
        runner._replay_time = pd.Timestamp("2026-04-09 10:30:00", tz=IST)

        events = []
        runner._replay_on_event = events.append

        signal, SignalType = self._setup_valid_trade(runner)
        result = runner._execute_replay_signal(1, signal, SignalType)

        assert result is True
        assert len(events) == 1
        event = events[0]
        assert event["type"] == "trade_open"
        assert event["strategy"] == "ORB Best"
        assert event["symbol"] == "RELIANCE"
        assert event["side"] == "BUY"
        assert event["price"] == 1005.0
        assert event["sl"] == 995.0
        assert event["tp"] == 1020.0
        assert "time" in event
        assert event["quantity"] == 10


# ============================================================================
# TestReplayUtils
# ============================================================================

class TestReplayUtils:
    """Tests for trading/replay_utils.py utilities."""

    def test_timezone_ist_is_valid(self):
        from trading.timezone import IST
        assert IST is not None
        assert IST.utcoffset(None) == timedelta(hours=5, minutes=30)

    def test_build_trade_close_event_all_fields(self):
        from trading.replay_utils import build_trade_close_event

        trade = types.SimpleNamespace(
            symbol="RELIANCE",
            side=types.SimpleNamespace(value="BUY"),
            entry_price=1000.0,
            exit_price=1050.0,
            quantity=10,
            pnl=500.0,
            pnl_pct=5.0,
            exit_reason="TP",
            costs=50.0,
            net_pnl=450.0,
            entry_time=datetime(2026, 1, 1, 10, 0, tzinfo=timezone(timedelta(hours=5, minutes=30))),
            exit_time=datetime(2026, 1, 1, 11, 0, tzinfo=timezone(timedelta(hours=5, minutes=30))),
        )
        runner = types.SimpleNamespace(strategy_name="ORB Test")

        event = build_trade_close_event(trade, runner)

        expected_keys = {
            "type", "symbol", "side", "entry_price", "exit_price", "quantity",
            "pnl", "pnl_pct", "reason", "costs", "net_pnl", "strategy",
            "entry_time", "exit_time",
        }
        assert set(event.keys()) == expected_keys
        assert event["type"] == "trade_close"
        assert event["strategy"] == "ORB Test"
        assert isinstance(event["entry_time"], str)
        assert isinstance(event["exit_time"], str)
        assert event["side"] == "BUY"

    def test_build_trade_close_event_runner_none(self):
        from trading.replay_utils import build_trade_close_event

        trade = types.SimpleNamespace(
            symbol="RELIANCE",
            side=types.SimpleNamespace(value="BUY"),
            entry_price=1000.0,
            exit_price=1050.0,
            quantity=10,
            pnl=500.0,
            pnl_pct=5.0,
            exit_reason="TP",
            costs=50.0,
            net_pnl=450.0,
            entry_time=datetime(2026, 1, 1, 10, 0, tzinfo=timezone(timedelta(hours=5, minutes=30))),
            exit_time=datetime(2026, 1, 1, 11, 0, tzinfo=timezone(timedelta(hours=5, minutes=30))),
        )

        event = build_trade_close_event(trade, runner=None)
        assert event["strategy"] == ''

    def test_build_trade_close_event_side_enum_value(self):
        from trading.replay_utils import build_trade_close_event

        trade = types.SimpleNamespace(
            symbol="RELIANCE",
            side=types.SimpleNamespace(value="SELL"),
            entry_price=1000.0,
            exit_price=950.0,
            quantity=10,
            pnl=-500.0,
            pnl_pct=-5.0,
            exit_reason="SL",
            costs=50.0,
            net_pnl=-550.0,
            entry_time=datetime(2026, 1, 1, 10, 0, tzinfo=timezone(timedelta(hours=5, minutes=30))),
            exit_time=datetime(2026, 1, 1, 11, 0, tzinfo=timezone(timedelta(hours=5, minutes=30))),
        )
        runner = types.SimpleNamespace(strategy_name="ORB Test")

        event = build_trade_close_event(trade, runner)
        assert event["side"] == "SELL"

    def test_strategy_filter_map_unknown_key(self):
        from trading.replay_utils import STRATEGY_FILTER_MAP
        assert STRATEGY_FILTER_MAP.get("NONEXISTENT", ()) == ()

    def test_strategy_filter_map_completeness(self):
        from trading.replay_utils import STRATEGY_FILTER_MAP
        assert set(STRATEGY_FILTER_MAP.keys()) == {"ORB", "SR", "EMA", "52W"}
        assert STRATEGY_FILTER_MAP["ORB"] == ("ORB",)
        assert STRATEGY_FILTER_MAP["SR"] == ("SR_BREAKOUT",)
        assert STRATEGY_FILTER_MAP["EMA"] == ("EMA_CROSS",)
        assert STRATEGY_FILTER_MAP["52W"] == ("52W_CHASER", "52W_TARGET")

    def test_default_watchlist_is_valid(self):
        from trading.replay_utils import DEFAULT_WATCHLIST
        assert isinstance(DEFAULT_WATCHLIST, list)
        assert len(DEFAULT_WATCHLIST) == 20
        assert all(isinstance(s, str) for s in DEFAULT_WATCHLIST)
        assert "RELIANCE" in DEFAULT_WATCHLIST


# ============================================================================
# TestEmitOncePerSymbol
# ============================================================================

class TestEmitOncePerSymbol:
    """Tests for RunnerSignalsMixin._emit_once_per_symbol."""

    @classmethod
    def setup_class(cls):
        import config
        if not hasattr(config, 'ENVIRONMENT'):
            config.ENVIRONMENT = "test"
        if not hasattr(config, 'RAILWAY_URL'):
            config.RAILWAY_URL = None

    def _make_runner(self):
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)
        runner.replay_mode = True
        return runner

    def test_non_replay_returns_false(self):
        runner = self._make_runner()
        runner.replay_mode = False
        events = []
        result = runner._emit_once_per_symbol("_test_emitted", "RELIANCE", {"type": "test"})
        assert result is False
        assert len(events) == 0

    def test_replay_on_event_none_returns_false(self):
        runner = self._make_runner()
        runner._replay_on_event = None
        result = runner._emit_once_per_symbol("_test_emitted", "RELIANCE", {"type": "test"})
        assert result is False

    def test_first_call_emits(self):
        runner = self._make_runner()
        events = []
        runner._replay_on_event = events.append
        result = runner._emit_once_per_symbol("_test_emitted", "RELIANCE", {"type": "test"})
        assert result is True
        assert len(events) == 1
        assert events[0]["type"] == "test"

    def test_second_call_skips(self):
        runner = self._make_runner()
        events = []
        runner._replay_on_event = events.append
        runner._emit_once_per_symbol("_test_emitted", "RELIANCE", {"type": "test"})
        result = runner._emit_once_per_symbol("_test_emitted", "RELIANCE", {"type": "test2"})
        assert result is False
        assert len(events) == 1

    def test_different_symbols_both_emit(self):
        runner = self._make_runner()
        events = []
        runner._replay_on_event = events.append
        r1 = runner._emit_once_per_symbol("_test_emitted", "RELIANCE", {"type": "reliance"})
        r2 = runner._emit_once_per_symbol("_test_emitted", "TCS", {"type": "tcs"})
        assert r1 is True
        assert r2 is True
        assert len(events) == 2

    def test_creates_attr_if_missing(self):
        runner = self._make_runner()
        events = []
        runner._replay_on_event = events.append
        assert not hasattr(runner, "_test_emitted")
        runner._emit_once_per_symbol("_test_emitted", "RELIANCE", {"type": "test"})
        assert hasattr(runner, "_test_emitted")
        assert isinstance(runner._test_emitted, set)
        assert "RELIANCE" in runner._test_emitted


# ============================================================================
# TestInitCommonFields
# ============================================================================

class TestInitCommonFields:
    """Tests for MultiStrategyRunner._init_common_fields."""

    @classmethod
    def setup_class(cls):
        import config
        if not hasattr(config, 'ENVIRONMENT'):
            config.ENVIRONMENT = "test"
        if not hasattr(config, 'RAILWAY_URL'):
            config.RAILWAY_URL = None

    def test_default_values(self):
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        runner._init_common_fields()
        assert runner.snapshot_file == Path("/dev/null")
        assert runner.watchlist == []
        assert runner.cooldown_stocks == {}
        assert runner.replay_mode is False
        assert runner._replay_time is None
        assert runner._replay_on_event is None
        assert runner._screener is None
        assert runner._data_fetcher is None
        assert runner._daily_summary_sent is False

    def test_custom_snapshot_file(self):
        from trading.runner_core import MultiStrategyRunner

        with patch.object(MultiStrategyRunner, '_load_bot_config', return_value=_make_bot_config()):
            runner = MultiStrategyRunner.create_for_replay(bot_config_id=1, user_id=1)

        runner._init_common_fields(snapshot_file=Path("/tmp/test.json"))
        assert runner.snapshot_file == Path("/tmp/test.json")
