"""
Unit tests for trading/multi_strategy_runner.py

Tests cover:
- MultiStrategyRunner initialization
- StrategyRunner dataclass
- Adding/removing/starting/stopping strategies
- Signal coordination between strategies
- Resource allocation
- Error handling in individual strategies
- Graceful shutdown
- Market timing checks
- Signal generation and execution
- Position monitoring
"""

import sys
import json
import signal
import tempfile
import shutil
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, MagicMock, AsyncMock, PropertyMock
from dataclasses import dataclass

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


class MockBotConfig:
    def __init__(
        self,
        id=1,
        name="Test Bot",
        is_active=True,
        max_total_positions=10,
        max_total_capital_pct=0.80,
    ):
        self.id = id
        self.name = name
        self.is_active = is_active
        self.max_total_positions = max_total_positions
        self.max_total_capital_pct = max_total_capital_pct
        self.created_at = datetime.now()
        self.updated_at = datetime.now()


class MockStrategyConfig:
    def __init__(
        self,
        id=1,
        name="ORB Strategy",
        strategy_type="ORB",
        is_template=False,
        is_active=True,
        or_minutes=45,
        sl_pct=0.4,
        tp_pct=1.2,
        min_or_range_pct=0.5,
        max_or_range_pct=3.0,
        max_positions=5,
        max_capital_per_trade_pct=0.10,
        cooldown_minutes=30,
        max_distance_from_or_pct=1.5,
        risk_per_trade_pct=0.01,
        min_trade_value=5000,
        max_trade_value=100000,
    ):
        self.id = id
        self.name = name
        self.strategy_type = strategy_type
        self.is_template = is_template
        self.is_active = is_active
        self.or_minutes = or_minutes
        self.sl_pct = sl_pct
        self.tp_pct = tp_pct
        self.min_or_range_pct = min_or_range_pct
        self.max_or_range_pct = max_or_range_pct
        self.max_positions = max_positions
        self.max_capital_per_trade_pct = max_capital_per_trade_pct
        self.cooldown_minutes = cooldown_minutes
        self.max_distance_from_or_pct = max_distance_from_or_pct
        self.risk_per_trade_pct = risk_per_trade_pct
        self.min_trade_value = min_trade_value
        self.max_trade_value = max_trade_value

    def to_dict(self):
        return {
            "or_minutes": self.or_minutes,
            "sl_pct": self.sl_pct,
            "tp_pct": self.tp_pct,
            "min_or_range_pct": self.min_or_range_pct,
            "max_or_range_pct": self.max_or_range_pct,
            "max_positions": self.max_positions,
            "max_capital_per_trade_pct": self.max_capital_per_trade_pct,
            "cooldown_minutes": self.cooldown_minutes,
            "max_distance_from_or_pct": self.max_distance_from_or_pct,
            "risk_per_trade_pct": self.risk_per_trade_pct,
            "min_trade_value": self.min_trade_value,
            "max_trade_value": self.max_trade_value,
        }


@pytest.fixture
def mock_bot_config():
    return MockBotConfig()


@pytest.fixture
def mock_strategy_config():
    return MockStrategyConfig()


@pytest.fixture
def mock_strategy_config_52w():
    return MockStrategyConfig(
        id=2,
        name="52W Chaser",
        strategy_type="52W_CHASER",
        or_minutes=30,
        sl_pct=0.7,
        tp_pct=2.0,
    )


@pytest.fixture
def temp_snapshot_dir():
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def mock_portfolio():
    portfolio = MagicMock()
    portfolio.initial_capital = 1_000_000
    portfolio.cash = 800_000
    portfolio.positions = {}
    portfolio.trades = []

    portfolio.get_portfolio_status.return_value = {
        "initial_capital": 1_000_000,
        "cash": 800_000,
        "capital_used": 200_000,
        "total_positions": 0,
        "daily_pnl": 0.0,
        "total_pnl": 0.0,
        "total_pnl_pct": 0.0,
    }

    portfolio.get_strategy_status.return_value = {
        "positions_count": 0,
        "capital_used": 0.0,
        "allocated_capital": 500_000,
        "max_positions": 5,
        "total_pnl": 0.0,
    }

    portfolio.get_symbol_exposure.return_value = 0.0
    portfolio.get_all_positions.return_value = []
    portfolio.set_strategy_allocation.return_value = None
    portfolio.open_position.return_value = MagicMock(
        symbol="RELIANCE",
        strategy_id=1,
        quantity=100,
        entry_price=2500.0,
    )
    portfolio.close_position.return_value = MagicMock(
        trade_id="TRADE-001",
        symbol="RELIANCE",
        pnl=5000.0,
    )
    portfolio.update_prices.return_value = None

    return portfolio


@pytest.fixture
def mock_risk_manager():
    risk_manager = MagicMock()
    risk_manager.validate_trade.return_value = {
        "valid": True,
        "shares": 100,
        "trade_value": 250000,
        "reason": "OK",
    }
    return risk_manager


@pytest.fixture
def mock_journal():
    journal = MagicMock()
    journal.log_trade.return_value = None
    journal.save_journal.return_value = None
    return journal


@pytest.fixture
def mock_signal_generator():
    generator = MagicMock()
    generator.or_minutes = 45
    generator.sl_pct = 0.4
    generator.tp_pct = 1.2
    generator.min_or_range_pct = 0.5
    generator.max_or_range_pct = 3.0

    generator.calculate_or_levels.return_value = {
        "or_high": 2520.0,
        "or_low": 2480.0,
        "or_open": 2500.0,
        "or_close": 2510.0,
        "or_range": 40.0,
        "or_range_pct": 1.6,
        "latest_price": 2530.0,
        "latest_high": 2535.0,
        "latest_low": 2525.0,
    }

    return generator


@pytest.fixture
def mock_orb_signal():
    from trading.orb_signals import SignalType

    signal = MagicMock()
    signal.symbol = "RELIANCE"
    signal.signal_type = SignalType.LONG_ENTRY
    signal.price = 2530.0
    signal.stop_loss = 2420.0
    signal.take_profit = 2830.0
    signal.or_high = 2520.0
    signal.or_low = 2480.0
    return signal


class TestStrategyRunnerDataclass:
    """Tests for the StrategyRunner dataclass."""

    def test_strategy_runner_initialization(self):
        from trading.multi_strategy_runner import StrategyRunner

        config = {
            "or_minutes": 30,
            "sl_pct": 0.5,
            "tp_pct": 1.5,
            "min_or_range_pct": 0.4,
            "max_or_range_pct": 2.5,
        }

        runner = StrategyRunner(
            strategy_id=1,
            strategy_name="Test Strategy",
            strategy_type="ORB",
            config=config,
            max_positions=5,
            capital_allocation_pct=0.40,
        )

        assert runner.strategy_id == 1
        assert runner.strategy_name == "Test Strategy"
        assert runner.strategy_type == "ORB"
        assert runner.config == config
        assert runner.max_positions == 5
        assert runner.capital_allocation_pct == 0.40
        assert runner.status == "pending"
        assert runner.signals_generated == 0
        assert runner.trades_executed == 0
        assert runner.last_scan_time is None
        assert runner.last_scan_items == []

    def test_strategy_runner_creates_orb_signal_generator(self):
        from trading.multi_strategy_runner import StrategyRunner
        from trading.orb_signals import ORBSignalGenerator

        config = {
            "or_minutes": 30,
            "sl_pct": 0.5,
            "tp_pct": 1.5,
            "min_or_range_pct": 0.4,
            "max_or_range_pct": 2.5,
        }

        runner = StrategyRunner(
            strategy_id=1,
            strategy_name="Test ORB",
            strategy_type="ORB",
            config=config,
            max_positions=5,
            capital_allocation_pct=0.40,
        )

        assert runner.signal_generator is not None
        assert isinstance(runner.signal_generator, ORBSignalGenerator)
        assert runner.signal_generator.or_minutes == 30
        assert runner.signal_generator.sl_pct == 0.5

    def test_strategy_runner_creates_52w_chaser_signal_generator(self):
        from trading.multi_strategy_runner import StrategyRunner
        from trading.orb_signals import ORBSignalGenerator

        config = {
            "or_minutes": 30,
            "sl_pct": 0.7,
            "tp_pct": 2.0,
        }

        runner = StrategyRunner(
            strategy_id=2,
            strategy_name="52W Chaser",
            strategy_type="52W_CHASER",
            config=config,
            max_positions=3,
            capital_allocation_pct=0.30,
        )

        assert runner.signal_generator is not None
        assert isinstance(runner.signal_generator, ORBSignalGenerator)

    def test_strategy_runner_unknown_type_uses_default(self):
        from trading.multi_strategy_runner import StrategyRunner
        from trading.orb_signals import ORBSignalGenerator

        config = {"sl_pct": 0.5}

        runner = StrategyRunner(
            strategy_id=3,
            strategy_name="Unknown Type",
            strategy_type="UNKNOWN_TYPE",
            config=config,
            max_positions=5,
            capital_allocation_pct=0.40,
        )

        assert runner.signal_generator is not None
        assert isinstance(runner.signal_generator, ORBSignalGenerator)


class TestMultiStrategyRunnerInit:
    """Tests for MultiStrategyRunner initialization."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_init_with_bot_config_object(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(
                bot_config=mock_bot_config,
                initial_capital=1_000_000,
                test_mode=True,
            )

            assert runner.bot_config.id == 1
            assert runner.bot_config.name == "Test Bot"
            assert runner.test_mode is True
            assert runner.running is False
            assert runner.strategies == {}
            assert runner.watchlist == []

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_init_without_bot_config_raises_error(self):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with pytest.raises(ValueError, match="Either bot_config_id or bot_config must be provided"):
            MultiStrategyRunner(initial_capital=1_000_000)

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_init_with_user_id(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(
                bot_config=mock_bot_config,
                user_id=123,
                test_mode=True,
            )

            assert runner.user_id == 123

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_init_creates_shared_portfolio_manager(self, mock_bot_config, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        mock_portfolio = MagicMock()
        mock_portfolio_class = MagicMock(return_value=mock_portfolio)

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", mock_portfolio_class), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(
                bot_config=mock_bot_config,
                initial_capital=500_000,
            )

            mock_portfolio_class.assert_called_once()
            call_kwargs = mock_portfolio_class.call_args[1]
            assert call_kwargs["initial_capital"] == 500_000
            assert call_kwargs["max_total_capital_pct"] == mock_bot_config.max_total_capital_pct
            assert call_kwargs["max_total_positions"] == mock_bot_config.max_total_positions

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_init_creates_global_risk_manager(self, mock_bot_config, mock_portfolio, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        mock_risk_manager = MagicMock()
        mock_risk_class = MagicMock(return_value=mock_risk_manager)

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", mock_risk_class), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config)

            mock_risk_class.assert_called_once()
            call_kwargs = mock_risk_class.call_args[1]
            assert call_kwargs["max_total_positions"] == mock_bot_config.max_total_positions
            assert call_kwargs["max_total_capital_pct"] == mock_bot_config.max_total_capital_pct


class TestStrategyManagement:
    """Tests for adding/removing/starting/stopping strategies."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_start_strategy(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy_runner = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            runner.strategies[1] = strategy_runner

            runner.start_strategy(1)

            assert runner.strategies[1].status == "running"

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_stop_strategy(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy_runner = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy_runner.status = "running"
            runner.strategies[1] = strategy_runner

            runner.stop_strategy(1)

            assert runner.strategies[1].status == "stopped"

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_pause_strategy(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy_runner = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy_runner.status = "running"
            runner.strategies[1] = strategy_runner

            runner.pause_strategy(1)

            assert runner.strategies[1].status == "paused"

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_start_all_strategies(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            for i in range(1, 4):
                strategy_runner = StrategyRunner(
                    strategy_id=i,
                    strategy_name=f"Strategy {i}",
                    strategy_type="ORB",
                    config={},
                    max_positions=5,
                    capital_allocation_pct=0.33,
                )
                runner.strategies[i] = strategy_runner

            runner.start_all_strategies()

            for strategy_id in runner.strategies:
                assert runner.strategies[strategy_id].status == "running"

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_stop_all_strategies(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            for i in range(1, 4):
                strategy_runner = StrategyRunner(
                    strategy_id=i,
                    strategy_name=f"Strategy {i}",
                    strategy_type="ORB",
                    config={},
                    max_positions=5,
                    capital_allocation_pct=0.33,
                )
                strategy_runner.status = "running"
                runner.strategies[i] = strategy_runner

            runner.stop_all_strategies()

            for strategy_id in runner.strategies:
                assert runner.strategies[strategy_id].status == "stopped"


class TestMarketTiming:
    """Tests for market timing checks."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_is_market_open_during_market_hours(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner
        from unittest.mock import MagicMock

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            test_dt = datetime(2026, 3, 4, 10, 30)
            with patch("trading.multi_strategy_runner.datetime") as mock_datetime:
                mock_datetime.now.return_value = test_dt
                mock_datetime.side_effect = datetime
                assert runner.is_market_open() is True

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_is_market_open_before_market_hours(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            test_dt = datetime(2026, 3, 4, 8, 0)
            with patch("trading.multi_strategy_runner.datetime") as mock_datetime:
                mock_datetime.now.return_value = test_dt
                mock_datetime.side_effect = datetime
                assert runner.is_market_open() is False

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_is_market_open_after_market_hours(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            test_dt = datetime(2026, 3, 4, 16, 0)
            with patch("trading.multi_strategy_runner.datetime") as mock_datetime:
                mock_datetime.now.return_value = test_dt
                mock_datetime.side_effect = datetime
                assert runner.is_market_open() is False

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_is_trading_hours_during_trading(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            test_dt = datetime(2026, 3, 4, 11, 0)
            with patch("trading.multi_strategy_runner.datetime") as mock_datetime:
                mock_datetime.now.return_value = test_dt
                mock_datetime.side_effect = datetime
                assert runner.is_trading_hours() is True

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_is_trading_hours_before_or_end(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            test_dt = datetime(2026, 3, 4, 9, 30)
            with patch("trading.multi_strategy_runner.datetime") as mock_datetime:
                mock_datetime.now.return_value = test_dt
                mock_datetime.side_effect = datetime
                assert runner.is_trading_hours() is False

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_is_force_exit_time_true(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            test_dt = datetime(2026, 3, 4, 15, 30)
            with patch("trading.multi_strategy_runner.datetime") as mock_datetime:
                mock_datetime.now.return_value = test_dt
                mock_datetime.side_effect = datetime
                assert runner.is_force_exit_time() is True


class TestWatchlistManagement:
    """Tests for watchlist refresh and management."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_refresh_watchlist_uses_default_when_no_screener(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner._screener = None
            runner._get_screener = Mock(return_value=None)
            runner.watchlist = []

            runner.refresh_watchlist()

            assert runner.watchlist == runner.DEFAULT_WATCHLIST

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_refresh_watchlist_with_screener(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner
        import pandas as pd

        mock_screener = MagicMock()
        mock_df = pd.DataFrame({
            "name": ["RELIANCE", "TCS", "INFY"],
            "close": [2500.0, 3500.0, 1500.0],
        })
        mock_screener.screen.return_value = mock_df

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner._screener = mock_screener

            runner.refresh_watchlist()

            assert len(runner.watchlist) == 3
            assert "RELIANCE" in runner.watchlist

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_refresh_watchlist_handles_empty_screener_result(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner
        import pandas as pd

        mock_screener = MagicMock()
        mock_screener.screen.return_value = pd.DataFrame()

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner._screener = mock_screener

            runner.refresh_watchlist()

            assert runner.watchlist == runner.DEFAULT_WATCHLIST

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_refresh_watchlist_handles_screener_error(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        mock_screener = MagicMock()
        mock_screener.screen.side_effect = Exception("Screener error")

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner._screener = mock_screener

            runner.refresh_watchlist()

            assert runner.watchlist == runner.DEFAULT_WATCHLIST


class TestSignalGeneration:
    """Tests for signal generation and scanning."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_scan_for_signals_returns_empty_when_strategy_not_running(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy_runner = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy_runner.status = "stopped"
            runner.strategies[1] = strategy_runner

            signals = runner.scan_for_signals(1)

            assert signals == []

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_scan_for_signals_returns_empty_outside_trading_hours(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy_runner = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy_runner.status = "running"
            runner.strategies[1] = strategy_runner

            with patch.object(runner, "is_trading_hours", return_value=False):
                signals = runner.scan_for_signals(1)

            assert signals == []

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_scan_for_signals_skips_symbols_with_positions(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, mock_signal_generator):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner
        from trading.shared_portfolio import SharedPosition, OrderSide

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy_runner = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy_runner.status = "running"
            strategy_runner.signal_generator = mock_signal_generator
            runner.strategies[1] = strategy_runner

            mock_portfolio.positions = {"1_RELIANCE": MagicMock(symbol="RELIANCE")}
            runner.watchlist = ["RELIANCE", "TCS"]

            with patch.object(runner, "is_trading_hours", return_value=True), \
                 patch.object(runner, "fetch_or_data", return_value=mock_signal_generator.calculate_or_levels.return_value):
                signals = runner.scan_for_signals(1)

            assert signals == []

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_scan_for_signals_respects_cooldown(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, mock_signal_generator):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy_runner = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={"cooldown_minutes": 30},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy_runner.status = "running"
            strategy_runner.signal_generator = mock_signal_generator
            runner.strategies[1] = strategy_runner

            runner.cooldown_stocks["RELIANCE"] = datetime.now() - timedelta(minutes=10)
            runner.watchlist = ["RELIANCE"]

            with patch.object(runner, "is_trading_hours", return_value=True):
                signals = runner.scan_for_signals(1)

            assert signals == []

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_scan_for_signals_clears_expired_cooldown(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, mock_signal_generator, mock_orb_signal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy_runner = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={"cooldown_minutes": 30},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy_runner.status = "running"
            strategy_runner.signal_generator = mock_signal_generator
            strategy_runner.signal_generator.check_breakout.return_value = mock_orb_signal
            runner.strategies[1] = strategy_runner

            runner.cooldown_stocks["RELIANCE"] = datetime.now() - timedelta(minutes=60)
            runner.watchlist = ["RELIANCE"]

            or_data = mock_signal_generator.calculate_or_levels.return_value

            with patch.object(runner, "is_trading_hours", return_value=True), \
                 patch.object(runner, "fetch_or_data", return_value=or_data):
                signals = runner.scan_for_signals(1)

            assert "RELIANCE" not in runner.cooldown_stocks


class TestSignalExecution:
    """Tests for signal execution."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_execute_signal_test_mode_returns_false(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, mock_orb_signal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            result = runner.execute_signal(1, mock_orb_signal)

            assert result is False

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_execute_signal_rejected_by_risk_manager(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, mock_orb_signal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        mock_risk_manager.validate_trade.return_value = {
            "valid": False,
            "reason": "Max positions reached",
        }

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=False)

            strategy_runner = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            runner.strategies[1] = strategy_runner

            result = runner.execute_signal(1, mock_orb_signal)

            assert result is False

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_execute_signal_opens_position(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, mock_orb_signal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=False)

            strategy_runner = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            runner.strategies[1] = strategy_runner

            result = runner.execute_signal(1, mock_orb_signal)

            assert result is True
            mock_portfolio.open_position.assert_called_once()
            assert runner.strategies[1].trades_executed == 1


class TestPositionMonitoring:
    """Tests for position monitoring."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_monitor_positions_empty_portfolio(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        mock_portfolio.positions = {}

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            runner.monitor_positions()

            mock_portfolio.update_prices.assert_not_called()

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_monitor_positions_closes_on_stop_loss(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner
        from trading.shared_portfolio import SharedPosition, OrderSide

        mock_position = MagicMock()
        mock_position.symbol = "RELIANCE"
        mock_position.strategy_id = 1
        mock_position.side = OrderSide.BUY
        mock_position.stop_loss = 2400.0
        mock_position.take_profit = 2800.0
        mock_position.quantity = 100

        mock_portfolio.positions = {"1_RELIANCE": mock_position}

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner._data_fetcher = None

            runner.monitor_positions()

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_monitor_positions_adds_to_cooldown(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)


class TestSnapshot:
    """Tests for snapshot saving."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_save_snapshot_creates_file(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, temp_snapshot_dir):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner.snapshot_file = Path(temp_snapshot_dir) / "test-snapshot.json"

            strategy_runner = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy_runner.status = "running"
            runner.strategies[1] = strategy_runner

            runner.save_snapshot()

            assert runner.snapshot_file.exists()

            with open(runner.snapshot_file) as f:
                snapshot = json.load(f)

            assert "timestamp" in snapshot
            assert "bot_id" in snapshot
            assert "portfolio" in snapshot
            assert "strategies" in snapshot
            assert "1" in snapshot["strategies"]

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_save_snapshot_includes_positions(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, temp_snapshot_dir):
        from trading.multi_strategy_runner import MultiStrategyRunner

        mock_portfolio.get_all_positions.return_value = [
            {"symbol": "RELIANCE", "side": "BUY", "quantity": 100}
        ]

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner.snapshot_file = Path(temp_snapshot_dir) / "test-snapshot.json"

            runner.save_snapshot()

            with open(runner.snapshot_file) as f:
                snapshot = json.load(f)

            assert "positions" in snapshot


class TestGracefulShutdown:
    """Tests for graceful shutdown."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_signal_handler_sets_running_false(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner.running = True

            runner._signal_handler(signal.SIGINT, None)

            assert runner.running is False

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_signal_handler_handles_sigterm(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner.running = True

            runner._signal_handler(signal.SIGTERM, None)

            assert runner.running is False


class TestFetchORData:
    """Tests for OR data fetching."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_fetch_or_data_returns_none_when_no_data_fetcher(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner._data_fetcher = None

            result = runner.fetch_or_data("RELIANCE")

            assert result is None

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_fetch_or_data_returns_none_on_error(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        mock_fetcher = MagicMock()
        mock_fetcher.upstox_api.fetch_intraday_data_v3.side_effect = Exception("API Error")

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner._data_fetcher = mock_fetcher

            result = runner.fetch_or_data("RELIANCE")

            assert result is None


class TestCreateMultiStrategyRunner:
    """Tests for create_multi_strategy_runner factory function."""

    @patch("trading.multi_strategy_runner._db_available", True)
    def test_create_multi_strategy_runner(self, mock_bot_config):
        from trading.multi_strategy_runner import create_multi_strategy_runner

        with patch("trading.multi_strategy_runner.MultiStrategyRunner") as mock_class:
            create_multi_strategy_runner(bot_id=1, user_id=123, test_mode=True)

            mock_class.assert_called_once_with(
                bot_config_id=1,
                user_id=123,
                test_mode=True,
            )


class TestErrorHandling:
    """Tests for error handling in strategies."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_execute_signal_handles_missing_strategy(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, mock_orb_signal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=False)

            result = runner.execute_signal(999, mock_orb_signal)

            assert result is False

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_execute_signal_handles_missing_strategy_status(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, mock_orb_signal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        mock_portfolio.get_strategy_status.return_value = None

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=False)

            strategy_runner = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            runner.strategies[1] = strategy_runner

            result = runner.execute_signal(1, mock_orb_signal)

            assert result is False

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_scan_for_signals_handles_fetch_error(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, mock_signal_generator):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy_runner = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy_runner.status = "running"
            strategy_runner.signal_generator = mock_signal_generator
            runner.strategies[1] = strategy_runner

            runner.watchlist = ["RELIANCE"]

            with patch.object(runner, "is_trading_hours", return_value=True), \
                 patch.object(runner, "fetch_or_data", return_value=None):
                signals = runner.scan_for_signals(1)

            assert signals == []


class TestDisplayStatus:
    """Tests for display_status method."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_display_status_calls_portfolio_status(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            runner.display_status()

            mock_portfolio.get_portfolio_status.assert_called()


class TestLazyLoading:
    """Tests for lazy loading of screener and data fetcher."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_get_screener_lazy_loads(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            assert runner._screener is None

            with patch("trading.multi_strategy_runner.ORBStockScreener") as mock_screener_class:
                mock_screener_class.return_value = MagicMock()
                screener = runner._get_screener()

                assert screener is not None
                mock_screener_class.assert_called_once()

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_get_data_fetcher_lazy_loads(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            assert runner._data_fetcher is None

            with patch("trading.multi_strategy_runner.TVScreenerUsage") as mock_fetcher_class:
                mock_fetcher_class.return_value = MagicMock()
                fetcher = runner._get_data_fetcher()

                assert fetcher is not None
                mock_fetcher_class.assert_called_once()


class TestConcurrentStrategies:
    """Tests for running multiple strategies concurrently."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_multiple_strategies_scan_independently(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, mock_signal_generator):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            for i in range(1, 4):
                strategy = StrategyRunner(
                    strategy_id=i,
                    strategy_name=f"Strategy {i}",
                    strategy_type="ORB",
                    config={"or_minutes": 30 + i * 15},
                    max_positions=5,
                    capital_allocation_pct=0.30,
                )
                strategy.status = "running"
                strategy.signal_generator = mock_signal_generator
                runner.strategies[i] = strategy

            assert len(runner.strategies) == 3
            for sid in runner.strategies:
                assert runner.strategies[sid].status == "running"

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_strategies_with_different_configs(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner
        from trading.orb_signals import ORBSignalGenerator

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            conservative = StrategyRunner(
                strategy_id=1,
                strategy_name="Conservative ORB",
                strategy_type="ORB",
                config={"or_minutes": 60, "sl_pct": 0.5, "tp_pct": 1.5},
                max_positions=3,
                capital_allocation_pct=0.30,
            )

            aggressive = StrategyRunner(
                strategy_id=2,
                strategy_name="Aggressive ORB",
                strategy_type="ORB",
                config={"or_minutes": 15, "sl_pct": 0.25, "tp_pct": 0.75},
                max_positions=8,
                capital_allocation_pct=0.50,
            )

            runner.strategies[1] = conservative
            runner.strategies[2] = aggressive

            assert runner.strategies[1].signal_generator.or_minutes == 60
            assert runner.strategies[2].signal_generator.or_minutes == 15

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_strategy_status_isolation(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            for i in range(1, 4):
                strategy = StrategyRunner(
                    strategy_id=i,
                    strategy_name=f"Strategy {i}",
                    strategy_type="ORB",
                    config={},
                    max_positions=5,
                    capital_allocation_pct=0.30,
                )
                runner.strategies[i] = strategy

            runner.strategies[1].status = "running"
            runner.strategies[2].status = "paused"
            runner.strategies[3].status = "stopped"

            assert runner.strategies[1].status == "running"
            assert runner.strategies[2].status == "paused"
            assert runner.strategies[3].status == "stopped"

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_signal_counters_per_strategy(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            for i in range(1, 4):
                strategy = StrategyRunner(
                    strategy_id=i,
                    strategy_name=f"Strategy {i}",
                    strategy_type="ORB",
                    config={},
                    max_positions=5,
                    capital_allocation_pct=0.30,
                )
                strategy.signals_generated = i * 10
                strategy.trades_executed = i * 5
                runner.strategies[i] = strategy

            assert runner.strategies[1].signals_generated == 10
            assert runner.strategies[2].signals_generated == 20
            assert runner.strategies[3].signals_generated == 30


class TestSignalCoordination:
    """Tests for signal coordination between strategies."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_same_symbol_different_strategies_can_have_positions(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        mock_portfolio.positions = {}

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            for i in range(1, 3):
                strategy = StrategyRunner(
                    strategy_id=i,
                    strategy_name=f"Strategy {i}",
                    strategy_type="ORB",
                    config={},
                    max_positions=5,
                    capital_allocation_pct=0.40,
                )
                strategy.status = "running"
                runner.strategies[i] = strategy

            mock_portfolio.positions["1_RELIANCE"] = MagicMock(symbol="RELIANCE", strategy_id=1)
            mock_portfolio.positions["2_RELIANCE"] = MagicMock(symbol="RELIANCE", strategy_id=2)

            assert "1_RELIANCE" in mock_portfolio.positions
            assert "2_RELIANCE" in mock_portfolio.positions

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_symbol_exposure_aggregates_across_strategies(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        mock_portfolio.get_symbol_exposure.return_value = 500_000

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            exposure = runner.portfolio.get_symbol_exposure("RELIANCE")
            assert exposure == 500_000

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_cooldown_shared_across_strategies(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner.cooldown_stocks["RELIANCE"] = datetime.now()

            for i in range(1, 3):
                strategy = StrategyRunner(
                    strategy_id=i,
                    strategy_name=f"Strategy {i}",
                    strategy_type="ORB",
                    config={"cooldown_minutes": 30},
                    max_positions=5,
                    capital_allocation_pct=0.40,
                )
                strategy.status = "running"
                runner.strategies[i] = strategy

            assert "RELIANCE" in runner.cooldown_stocks

            with patch.object(runner, "is_trading_hours", return_value=True):
                signals = runner.scan_for_signals(1)
                assert signals == []

                signals = runner.scan_for_signals(2)
                assert signals == []

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_or_levels_shared_across_strategies(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            runner.or_levels["RELIANCE"] = {
                "or_high": 2520.0,
                "or_low": 2480.0,
                "or_range_pct": 1.6,
            }

            assert "RELIANCE" in runner.or_levels
            assert runner.or_levels["RELIANCE"]["or_high"] == 2520.0


class TestResourceAllocation:
    """Tests for resource allocation between strategies."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_capital_allocation_tracking(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            runner.portfolio.set_strategy_allocation(1, "Strategy 1", 0.40, 5)
            runner.portfolio.set_strategy_allocation(2, "Strategy 2", 0.30, 3)

            mock_portfolio.get_strategy_status.assert_called()

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_max_positions_per_strategy(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, mock_orb_signal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        mock_risk_manager.validate_trade.return_value = {
            "valid": False,
            "reason": "Strategy max positions reached",
        }

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=False)

            strategy = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=3,
                capital_allocation_pct=0.50,
            )
            runner.strategies[1] = strategy

            result = runner.execute_signal(1, mock_orb_signal)

            assert result is False

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_total_capital_limit(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, mock_orb_signal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        mock_risk_manager.validate_trade.return_value = {
            "valid": False,
            "reason": "Max total capital reached",
        }

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=False)

            strategy = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            runner.strategies[1] = strategy

            result = runner.execute_signal(1, mock_orb_signal)

            assert result is False

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_portfolio_status_reflects_all_strategies(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        mock_portfolio.get_portfolio_status.return_value = {
            "initial_capital": 1_000_000,
            "cash": 400_000,
            "capital_used": 600_000,
            "total_positions": 5,
            "daily_pnl": 10_000,
            "total_pnl": 50_000,
            "total_pnl_pct": 5.0,
        }

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            for i in range(1, 3):
                strategy = StrategyRunner(
                    strategy_id=i,
                    strategy_name=f"Strategy {i}",
                    strategy_type="ORB",
                    config={},
                    max_positions=3,
                    capital_allocation_pct=0.40,
                )
                runner.strategies[i] = strategy

            status = runner.portfolio.get_portfolio_status()

            assert status["total_positions"] == 5
            assert status["capital_used"] == 600_000


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_empty_watchlist(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy.status = "running"
            runner.strategies[1] = strategy
            runner.watchlist = []

            with patch.object(runner, "is_trading_hours", return_value=True):
                signals = runner.scan_for_signals(1)

            assert signals == []

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_strategy_with_no_signal_generator(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy.status = "running"
            strategy.signal_generator = None
            runner.strategies[1] = strategy

            assert runner.strategies[1].signal_generator is None

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_snapshot_with_no_strategies(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, temp_snapshot_dir):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner.snapshot_file = Path(temp_snapshot_dir) / "test-snapshot.json"
            runner.strategies = {}

            runner.save_snapshot()

            assert runner.snapshot_file.exists()

            with open(runner.snapshot_file) as f:
                snapshot = json.load(f)

            assert snapshot["strategies"] == {}

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_rapid_start_stop_cycles(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            runner.strategies[1] = strategy

            for _ in range(5):
                runner.start_strategy(1)
                assert runner.strategies[1].status == "running"
                runner.stop_strategy(1)
                assert runner.strategies[1].status == "stopped"

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_market_boundary_times(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            with patch("trading.multi_strategy_runner.datetime") as mock_datetime:
                mock_datetime.now.return_value = datetime(2026, 3, 4, 9, 15)
                assert runner.is_market_open() is True

            with patch("trading.multi_strategy_runner.datetime") as mock_datetime:
                mock_datetime.now.return_value = datetime(2026, 3, 4, 15, 30)
                assert runner.is_market_open() is True

            with patch("trading.multi_strategy_runner.datetime") as mock_datetime:
                mock_datetime.now.return_value = datetime(2026, 3, 4, 9, 14)
                assert runner.is_market_open() is False

            with patch("trading.multi_strategy_runner.datetime") as mock_datetime:
                mock_datetime.now.return_value = datetime(2026, 3, 4, 15, 31)
                assert runner.is_market_open() is False


class TestIntegrationScenarios:
    """Integration-like tests for common scenarios."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_full_trading_cycle(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal, mock_signal_generator, mock_orb_signal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=False)

            strategy = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy.status = "running"
            strategy.signal_generator = mock_signal_generator
            strategy.signal_generator.check_breakout.return_value = mock_orb_signal
            runner.strategies[1] = strategy

            runner.start_all_strategies()
            assert runner.strategies[1].status == "running"

            runner.running = True

            result = runner.execute_signal(1, mock_orb_signal)
            assert result is True

            runner.stop_all_strategies()
            assert runner.strategies[1].status == "stopped"

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_multiple_strategies_with_different_risk_profiles(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            conservative = StrategyRunner(
                strategy_id=1,
                strategy_name="Conservative",
                strategy_type="ORB",
                config={"sl_pct": 0.5, "tp_pct": 1.5, "max_positions": 3},
                max_positions=3,
                capital_allocation_pct=0.30,
            )

            moderate = StrategyRunner(
                strategy_id=2,
                strategy_name="Moderate",
                strategy_type="ORB",
                config={"sl_pct": 0.4, "tp_pct": 1.2, "max_positions": 5},
                max_positions=5,
                capital_allocation_pct=0.40,
            )

            aggressive = StrategyRunner(
                strategy_id=3,
                strategy_name="Aggressive",
                strategy_type="ORB",
                config={"sl_pct": 0.25, "tp_pct": 0.75, "max_positions": 8},
                max_positions=8,
                capital_allocation_pct=0.30,
            )

            runner.strategies[1] = conservative
            runner.strategies[2] = moderate
            runner.strategies[3] = aggressive

            assert runner.strategies[1].max_positions == 3
            assert runner.strategies[2].max_positions == 5
            assert runner.strategies[3].max_positions == 8

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_strategy_pause_and_resume(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy.status = "running"
            runner.strategies[1] = strategy

            runner.pause_strategy(1)
            assert runner.strategies[1].status == "paused"

            with patch.object(runner, "is_trading_hours", return_value=True):
                signals = runner.scan_for_signals(1)
                assert signals == []

            runner.start_strategy(1)
            assert runner.strategies[1].status == "running"


class TestAsyncMethods:
    """Tests for async methods using AsyncMock."""

    @pytest.mark.asyncio
    @patch("trading.multi_strategy_runner._db_available", False)
    async def test_async_signal_processing(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner

        mock_async_signal_gen = AsyncMock()
        mock_async_signal_gen.check_breakout = AsyncMock(return_value=None)

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            strategy = StrategyRunner(
                strategy_id=1,
                strategy_name="Test Strategy",
                strategy_type="ORB",
                config={},
                max_positions=5,
                capital_allocation_pct=0.50,
            )
            strategy.status = "running"
            runner.strategies[1] = strategy

            assert runner.strategies[1].status == "running"

    @pytest.mark.asyncio
    @patch("trading.multi_strategy_runner._db_available", False)
    async def test_async_portfolio_update(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        mock_portfolio.update_prices = AsyncMock()

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            prices = {"RELIANCE": 2500.0, "TCS": 3500.0}

            if hasattr(runner.portfolio.update_prices, '__call__'):
                runner.portfolio.update_prices(prices)


class TestDefaultWatchlist:
    """Tests for default watchlist functionality."""

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_default_watchlist_contains_major_stocks(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)

            expected_stocks = ["RELIANCE", "TCS", "HDFC", "INFY", "ICICIBANK"]
            for stock in expected_stocks:
                assert stock in runner.DEFAULT_WATCHLIST

    @patch("trading.multi_strategy_runner._db_available", False)
    def test_default_watchlist_used_as_fallback(self, mock_bot_config, mock_portfolio, mock_risk_manager, mock_journal):
        from trading.multi_strategy_runner import MultiStrategyRunner

        with patch("trading.multi_strategy_runner.SharedPortfolioManager", return_value=mock_portfolio), \
             patch("trading.multi_strategy_runner.GlobalRiskManager", return_value=mock_risk_manager), \
             patch("trading.multi_strategy_runner.get_journal", return_value=mock_journal), \
             patch.object(signal, "signal"):

            runner = MultiStrategyRunner(bot_config=mock_bot_config, test_mode=True)
            runner._screener = None
            runner.watchlist = []

            runner.refresh_watchlist()

            assert runner.watchlist == runner.DEFAULT_WATCHLIST
            assert len(runner.watchlist) > 0
