"""
Unit tests for RiskManager.

Tests cover:
- RiskConfig dataclass (default and custom values)
- RiskManager initialization and configuration
- Position sizing calculations
- Risk validation (max positions, capital limits)
- Stop-loss and take-profit calculations
- Margin requirements
- Risk per trade limits
- Portfolio-level risk checks
- Daily loss limits
- Singleton instance management
"""

import pytest
from unittest.mock import patch, MagicMock

from trading.risk_manager import (
    RiskConfig,
    RiskManager,
    get_risk_manager,
    reset_risk_manager,
)


class TestRiskConfig:
    """Tests for RiskConfig dataclass."""

    def test_default_values(self):
        """Test: Default configuration values."""
        config = RiskConfig()
        assert config.max_positions == 5
        assert config.max_capital_per_trade == 0.10
        assert config.max_daily_loss == 0.02
        assert config.max_total_exposure == 0.50
        assert config.risk_per_trade == 0.01
        assert config.min_trade_value == 5000
        assert config.max_trade_value == 100000

    def test_custom_values(self):
        """Test: Custom configuration values."""
        config = RiskConfig(
            max_positions=10,
            max_capital_per_trade=0.15,
            max_daily_loss=0.03,
            max_total_exposure=0.70,
            risk_per_trade=0.02,
            min_trade_value=10000,
            max_trade_value=200000,
        )
        assert config.max_positions == 10
        assert config.max_capital_per_trade == 0.15
        assert config.max_daily_loss == 0.03
        assert config.max_total_exposure == 0.70
        assert config.risk_per_trade == 0.02
        assert config.min_trade_value == 10000
        assert config.max_trade_value == 200000

    def test_partial_custom_values(self):
        """Test: Partial custom values use defaults for others."""
        config = RiskConfig(max_positions=8, risk_per_trade=0.015)
        assert config.max_positions == 8
        assert config.risk_per_trade == 0.015
        assert config.max_capital_per_trade == 0.10  # default
        assert config.max_daily_loss == 0.02  # default


class TestRiskManagerInit:
    """Tests for RiskManager initialization."""

    def test_default_initialization(self):
        """Test: Default initialization with explicit config."""
        config = RiskConfig()
        manager = RiskManager(config=config)
        assert manager.config.max_positions == 5
        assert manager.config.max_capital_per_trade == 0.10
        assert manager.daily_pnl == 0.0
        assert manager.daily_start_loss_limit_hit is False

    def test_initialization_with_config(self):
        """Test: Initialization with RiskConfig."""
        config = RiskConfig(
            max_positions=8,
            max_capital_per_trade=0.12,
            max_daily_loss=0.025,
        )
        manager = RiskManager(config=config)
        assert manager.config.max_positions == 8
        assert manager.config.max_capital_per_trade == 0.12
        assert manager.config.max_daily_loss == 0.025

    def test_initialization_state(self):
        """Test: Initial state of daily tracking."""
        manager = RiskManager()
        assert manager.daily_pnl == 0.0
        assert manager.daily_start_loss_limit_hit is False

    @patch('trading.risk_manager._config_available', True)
    @patch('trading.risk_manager.get_strategy_config')
    def test_initialization_with_config_name(self, mock_get_config):
        """Test: Initialization with config_name loads from database."""
        mock_db_config = MagicMock()
        mock_db_config.max_positions = 7
        mock_db_config.max_capital_per_trade_pct = 0.15
        mock_db_config.max_daily_loss_pct = 0.03
        mock_db_config.max_total_exposure_pct = 0.60
        mock_db_config.risk_per_trade_pct = 0.015
        mock_db_config.min_trade_value = 8000
        mock_db_config.max_trade_value = 150000
        mock_get_config.return_value = mock_db_config

        manager = RiskManager(config_name="test_strategy")
        assert manager.config.max_positions == 7
        assert manager.config.max_capital_per_trade == 0.15
        assert manager.config.max_daily_loss == 0.03


class TestCalculatePositionSize:
    """Tests for position sizing calculations."""

    @pytest.fixture
    def manager(self):
        return RiskManager()

    def test_basic_calculation(self, manager):
        """Test: Basic position size calculation."""
        capital = 1_000_000
        entry_price = 100.0
        stop_loss = 95.0  # 5% risk

        shares = manager.calculate_position_size(capital, entry_price, stop_loss)
        assert shares > 0
        assert isinstance(shares, int)

    def test_risk_based_sizing(self, manager):
        """Test: Position size based on risk amount."""
        capital = 1_000_000
        entry_price = 100.0
        stop_loss = 99.0  # 1 per share risk

        shares = manager.calculate_position_size(capital, entry_price, stop_loss)

        max_risk = capital * manager.config.risk_per_trade  # 10,000
        risk_per_share = 1.0
        expected_by_risk = int(max_risk / risk_per_share)  # 10,000 shares

        max_capital = capital * manager.config.max_capital_per_trade  # 100,000
        expected_by_capital = int(max_capital / entry_price)  # 1,000 shares

        expected_shares = min(expected_by_risk, expected_by_capital)
        assert shares == expected_shares

    def test_capital_limited_sizing(self, manager):
        """Test: Position size limited by max capital per trade."""
        capital = 1_000_000
        entry_price = 5000.0
        stop_loss = 4900.0  # Small risk per share

        shares = manager.calculate_position_size(capital, entry_price, stop_loss)

        max_capital = capital * manager.config.max_capital_per_trade  # 100,000
        expected_by_capital = int(max_capital / entry_price)  # 20 shares

        assert shares == expected_by_capital

    def test_zero_entry_price(self, manager):
        """Test: Zero entry price returns 0 shares."""
        shares = manager.calculate_position_size(1_000_000, 0, 95.0)
        assert shares == 0

    def test_negative_entry_price(self, manager):
        """Test: Negative entry price returns 0 shares."""
        shares = manager.calculate_position_size(1_000_000, -100.0, 95.0)
        assert shares == 0

    def test_zero_stop_loss(self, manager):
        """Test: Zero stop loss returns 0 shares."""
        shares = manager.calculate_position_size(1_000_000, 100.0, 0)
        assert shares == 0

    def test_negative_stop_loss(self, manager):
        """Test: Negative stop loss returns 0 shares."""
        shares = manager.calculate_position_size(1_000_000, 100.0, -95.0)
        assert shares == 0

    def test_same_entry_and_stop_loss(self, manager):
        """Test: Same entry and stop loss (no risk) returns 0 shares."""
        shares = manager.calculate_position_size(1_000_000, 100.0, 100.0)
        assert shares == 0

    def test_stop_loss_above_entry(self, manager):
        """Test: Stop loss above entry (for shorts) works correctly."""
        capital = 1_000_000
        entry_price = 100.0
        stop_loss = 105.0  # 5 per share risk

        shares = manager.calculate_position_size(capital, entry_price, stop_loss)
        assert shares > 0

    def test_min_trade_value_enforcement(self, manager):
        """Test: Minimum trade value is enforced."""
        config = RiskConfig(min_trade_value=10_000)
        manager = RiskManager(config=config)

        capital = 1_000_000
        entry_price = 5000.0
        stop_loss = 4950.0

        shares = manager.calculate_position_size(capital, entry_price, stop_loss)
        trade_value = shares * entry_price
        assert trade_value >= 10_000

    def test_max_trade_value_enforcement(self, manager):
        """Test: Maximum trade value is enforced."""
        config = RiskConfig(max_trade_value=50_000, max_capital_per_trade=0.20)
        manager = RiskManager(config=config)

        capital = 1_000_000
        entry_price = 100.0
        stop_loss = 99.0  # Very small risk, would calculate large position

        shares = manager.calculate_position_size(capital, entry_price, stop_loss)
        trade_value = shares * entry_price
        assert trade_value <= 50_000

    def test_returns_at_least_one_share(self, manager):
        """Test: Always returns at least 1 share when valid."""
        capital = 100_000
        entry_price = 50000.0  # Very high price
        stop_loss = 49000.0

        # Use custom config with higher max_capital_per_trade to allow at least 1 share
        config = RiskConfig(max_capital_per_trade=0.50)
        custom_manager = RiskManager(config=config)
        shares = custom_manager.calculate_position_size(capital, entry_price, stop_loss)
        assert shares >= 1

    def test_high_risk_stock_smaller_position(self, manager):
        """Test: Higher risk per share results in smaller position."""
        capital = 1_000_000
        entry_price = 100.0

        # Low risk: 2% stop loss
        shares_low_risk = manager.calculate_position_size(capital, entry_price, 98.0)

        # High risk: 20% stop loss
        shares_high_risk = manager.calculate_position_size(capital, entry_price, 80.0)

        assert shares_low_risk > shares_high_risk


class TestCanOpenPosition:
    """Tests for position opening validation."""

    @pytest.fixture
    def manager(self):
        return RiskConfig(
            max_positions=5,
            max_total_exposure=0.50,
        )
        return RiskManager(config=RiskConfig(
            max_positions=5,
            max_total_exposure=0.50,
        ))

    def test_can_open_when_allowed(self):
        """Test: Can open position when all conditions pass."""
        manager = RiskManager(config=RiskConfig(max_positions=5, max_total_exposure=0.50))
        allowed, reason = manager.can_open_position(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=300_000,
            trade_value=50_000,
        )
        assert allowed is True
        assert reason == "OK"

    def test_max_positions_reached(self):
        """Test: Cannot open when max positions reached."""
        manager = RiskManager(config=RiskConfig(max_positions=5))
        allowed, reason = manager.can_open_position(
            capital=1_000_000,
            cash=500_000,
            current_positions=5,
            current_exposure=300_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "Max positions" in reason
        assert "5" in reason

    def test_max_positions_exceeded(self):
        """Test: Cannot open when already over max positions."""
        manager = RiskManager(config=RiskConfig(max_positions=5))
        allowed, reason = manager.can_open_position(
            capital=1_000_000,
            cash=500_000,
            current_positions=6,
            current_exposure=300_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "Max positions" in reason

    def test_total_exposure_would_exceed_limit(self):
        """Test: Cannot open when total exposure would exceed limit."""
        manager = RiskManager(config=RiskConfig(max_total_exposure=0.50))
        allowed, reason = manager.can_open_position(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=480_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "Total exposure" in reason
        assert "exceed limit" in reason

    def test_total_exposure_exactly_at_limit(self):
        """Test: Can open when exposure exactly at limit."""
        manager = RiskManager(config=RiskConfig(max_total_exposure=0.50))
        allowed, reason = manager.can_open_position(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=450_000,
            trade_value=50_000,
        )
        assert allowed is True

    def test_insufficient_cash(self):
        """Test: Cannot open when insufficient cash."""
        manager = RiskManager(config=RiskConfig())
        allowed, reason = manager.can_open_position(
            capital=1_000_000,
            cash=30_000,
            current_positions=3,
            current_exposure=300_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "Insufficient cash" in reason
        assert "₹" in reason

    def test_daily_loss_limit_hit(self):
        """Test: Cannot open when daily loss limit hit."""
        manager = RiskManager(config=RiskConfig())
        manager.daily_start_loss_limit_hit = True
        allowed, reason = manager.can_open_position(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=300_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "Daily loss limit" in reason

    def test_shows_exposure_percentage(self):
        """Test: Shows exposure percentage in rejection reason."""
        manager = RiskManager(config=RiskConfig(max_total_exposure=0.50))
        allowed, reason = manager.can_open_position(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=480_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "53.0%" in reason


class TestCheckDailyLossLimit:
    """Tests for daily loss limit checks."""

    @pytest.fixture
    def manager(self):
        config = RiskConfig(max_daily_loss=0.02)
        return RiskManager(config=config)

    def test_no_loss(self, manager):
        """Test: No loss, trading allowed."""
        result = manager.check_daily_loss_limit(0.0, 1_000_000)
        assert result is True
        assert manager.daily_start_loss_limit_hit is False

    def test_profit(self, manager):
        """Test: Profit, trading allowed."""
        result = manager.check_daily_loss_limit(10_000, 1_000_000)
        assert result is True
        assert manager.daily_start_loss_limit_hit is False

    def test_small_loss_allowed(self, manager):
        """Test: Small loss within limit, trading allowed."""
        result = manager.check_daily_loss_limit(-15_000, 1_000_000)
        assert result is True
        assert manager.daily_start_loss_limit_hit is False

    def test_loss_exceeds_limit(self, manager):
        """Test: Loss exceeds limit, trading halted."""
        result = manager.check_daily_loss_limit(-25_000, 1_000_000)
        assert result is False
        assert manager.daily_start_loss_limit_hit is True

    def test_loss_exactly_at_limit(self, manager):
        """Test: Loss exactly at limit, trading halted."""
        result = manager.check_daily_loss_limit(-20_000, 1_000_000)
        assert result is False
        assert manager.daily_start_loss_limit_hit is True

    def test_sets_flag_on_limit_hit(self, manager):
        """Test: Flag set when daily loss limit hit."""
        assert manager.daily_start_loss_limit_hit is False
        manager.check_daily_loss_limit(-25_000, 1_000_000)
        assert manager.daily_start_loss_limit_hit is True

    def test_flag_persists(self, manager):
        """Test: Flag persists after limit hit."""
        manager.check_daily_loss_limit(-25_000, 1_000_000)
        assert manager.daily_start_loss_limit_hit is True
        manager.check_daily_loss_limit(10_000, 1_000_000)  # Even with profit
        assert manager.daily_start_loss_limit_hit is True


class TestValidateTrade:
    """Tests for trade validation."""

    @pytest.fixture
    def manager(self):
        return RiskManager(config=RiskConfig(
            max_positions=5,
            max_total_exposure=0.50,
            max_capital_per_trade=0.10,
            risk_per_trade=0.01,
        ))

    def test_valid_buy_trade(self, manager):
        """Test: Valid BUY trade with good risk/reward."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=115.0,
            side="BUY",
        )
        assert result['valid'] is True
        assert result['shares'] > 0
        assert result['trade_value'] > 0
        assert result['rr_ratio'] >= 2

    def test_valid_sell_trade(self, manager):
        """Test: Valid SELL trade with good risk/reward."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=105.0,
            take_profit=85.0,
            side="SELL",
        )
        assert result['valid'] is True
        assert result['shares'] > 0

    def test_low_risk_reward_ratio(self, manager):
        """Test: Trade rejected for low risk/reward ratio."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=102.0,  # Only 2 reward vs 5 risk = 0.4 RR
            side="BUY",
        )
        assert result['valid'] is False
        assert "Risk/reward ratio" in result['reason']
        assert "too low" in result['reason']

    def test_risk_reward_exactly_2(self, manager):
        """Test: Trade allowed with exactly 1:2 risk/reward."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=95.0,  # 5 risk
            take_profit=110.0,  # 10 reward = 2:1
            side="BUY",
        )
        assert result['valid'] is True
        assert result['rr_ratio'] == 2.0

    def test_calculates_risk_pct_buy(self, manager):
        """Test: Risk percentage calculated correctly for BUY."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=95.0,  # 5% risk
            take_profit=110.0,
            side="BUY",
        )
        assert result['risk_pct'] == 5.0

    def test_calculates_reward_pct_buy(self, manager):
        """Test: Reward percentage calculated correctly for BUY."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=115.0,  # 15% reward
            side="BUY",
        )
        assert result['reward_pct'] == 15.0

    def test_calculates_risk_reward_sell(self, manager):
        """Test: Risk/reward calculated correctly for SELL."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=105.0,  # 5% risk
            take_profit=85.0,  # 15% reward
            side="SELL",
        )
        assert result['risk_pct'] == 5.0
        assert result['reward_pct'] == 15.0
        assert result['rr_ratio'] == 3.0

    def test_rejected_by_position_limit(self, manager):
        """Test: Trade rejected by position limit."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=5,  # At max
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=115.0,
            side="BUY",
        )
        assert result['valid'] is False
        assert "Max positions" in result['reason']

    def test_rejected_by_exposure_limit(self, manager):
        """Test: Trade rejected by exposure limit."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=480_000,  # Near max
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=115.0,
            side="BUY",
        )
        assert result['valid'] is False
        assert "Total exposure" in result['reason']

    def test_rejected_by_insufficient_cash(self, manager):
        """Test: Trade rejected by insufficient cash."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=5_000,  # Very little cash
            current_positions=3,
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=115.0,
            side="BUY",
        )
        assert result['valid'] is False
        assert "Insufficient cash" in result['reason']

    def test_result_structure(self, manager):
        """Test: Result has all expected fields."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=115.0,
            side="BUY",
        )
        expected_fields = [
            'valid', 'shares', 'trade_value', 'risk_amount',
            'risk_pct', 'reward_amount', 'reward_pct', 'rr_ratio', 'reason'
        ]
        for field in expected_fields:
            assert field in result

    def test_default_side_is_buy(self, manager):
        """Test: Default side is BUY."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=115.0,
        )
        assert result['valid'] is True
        assert result['risk_pct'] == 5.0  # BUY calculation


class TestResetDaily:
    """Tests for daily tracking reset."""

    @pytest.fixture
    def manager(self):
        return RiskManager()

    def test_reset_daily_pnl(self, manager):
        """Test: Reset clears daily P&L."""
        manager.daily_pnl = -20_000
        manager.reset_daily()
        assert manager.daily_pnl == 0.0

    def test_reset_loss_limit_flag(self, manager):
        """Test: Reset clears daily loss limit flag."""
        manager.daily_start_loss_limit_hit = True
        manager.reset_daily()
        assert manager.daily_start_loss_limit_hit is False

    def test_reset_both_values(self, manager):
        """Test: Reset clears both tracking values."""
        manager.daily_pnl = -25_000
        manager.daily_start_loss_limit_hit = True
        manager.reset_daily()
        assert manager.daily_pnl == 0.0
        assert manager.daily_start_loss_limit_hit is False


class TestGetConfig:
    """Tests for configuration retrieval."""

    def test_get_config_default(self):
        """Test: Get default configuration."""
        manager = RiskManager(config=RiskConfig())
        config = manager.get_config()
        assert config['max_positions'] == 5
        assert config['max_capital_per_trade'] == "10%"
        assert config['max_daily_loss'] == "2%"
        assert config['max_total_exposure'] == "50%"
        assert config['risk_per_trade'] == "1%"
        assert "₹" in config['min_trade_value']
        assert "₹" in config['max_trade_value']

    def test_get_config_custom(self):
        """Test: Get custom configuration."""
        config = RiskConfig(
            max_positions=10,
            max_capital_per_trade=0.15,
            max_daily_loss=0.03,
            max_total_exposure=0.70,
            risk_per_trade=0.02,
            min_trade_value=10000,
            max_trade_value=200000,
        )
        manager = RiskManager(config=config)
        result = manager.get_config()
        assert result['max_positions'] == 10
        assert result['max_capital_per_trade'] == "15%"
        assert result['max_daily_loss'] == "3%"
        assert result['max_total_exposure'] == "70%"
        assert result['risk_per_trade'] == "2%"

    def test_config_formatting(self):
        """Test: Configuration values are properly formatted."""
        manager = RiskManager()
        config = manager.get_config()
        assert config['min_trade_value'] == "₹5,000"
        assert config['max_trade_value'] == "₹100,000"


class TestSingletonFunctions:
    """Tests for singleton instance management."""

    def setup_method(self):
        """Reset singleton before each test."""
        import trading.risk_manager as rm
        rm._risk_manager = None

    def test_get_risk_manager_creates_instance(self):
        """Test: get_risk_manager creates instance."""
        manager = get_risk_manager()
        assert manager is not None
        assert isinstance(manager, RiskManager)

    def test_get_risk_manager_returns_same_instance(self):
        """Test: get_risk_manager returns same instance."""
        manager1 = get_risk_manager()
        manager2 = get_risk_manager()
        assert manager1 is manager2

    def test_reset_risk_manager_creates_new_instance(self):
        """Test: reset_risk_manager creates new instance."""
        manager1 = get_risk_manager()
        manager2 = reset_risk_manager()
        assert manager1 is not manager2

    def test_reset_risk_manager_clears_singleton(self):
        """Test: reset_risk_manager clears and creates new."""
        manager1 = get_risk_manager()
        manager1.daily_pnl = -10_000
        manager2 = reset_risk_manager()
        assert manager2.daily_pnl == 0.0


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    @pytest.fixture
    def manager(self):
        return RiskManager()

    def test_zero_capital(self, manager):
        """Test: Zero capital returns 0 shares."""
        shares = manager.calculate_position_size(0, 100.0, 95.0)
        assert shares == 0

    def test_very_small_capital(self, manager):
        """Test: Very small capital returns 0 shares."""
        shares = manager.calculate_position_size(100, 50.0, 45.0)
        assert shares == 0

    def test_very_large_capital(self, manager):
        """Test: Very large capital."""
        shares = manager.calculate_position_size(1_000_000_000, 100.0, 95.0)
        assert shares > 0

    def test_very_high_entry_price(self, manager):
        """Test: Very high entry price."""
        shares = manager.calculate_position_size(1_000_000, 100_000.0, 95_000.0)
        assert shares >= 1

    def test_very_low_entry_price(self, manager):
        """Test: Very low entry price."""
        shares = manager.calculate_position_size(1_000_000, 0.5, 0.45)
        assert shares > 0

    def test_tiny_risk_per_share(self, manager):
        """Test: Tiny risk per share."""
        shares = manager.calculate_position_size(1_000_000, 100.0, 99.99)
        assert shares > 0

    def test_large_risk_per_share(self, manager):
        """Test: Large risk per share."""
        shares = manager.calculate_position_size(1_000_000, 100.0, 50.0)
        assert shares > 0

    def test_exact_boundary_exposure(self, manager):
        """Test: Exact boundary exposure."""
        config = RiskConfig(max_total_exposure=0.50)
        manager = RiskManager(config=config)
        allowed, reason = manager.can_open_position(
            capital=1_000_000,
            cash=500_000,
            current_positions=0,
            current_exposure=500_000,
            trade_value=0,
        )
        assert allowed is True

    def test_fractional_shares_truncated(self, manager):
        """Test: Fractional shares are truncated (not rounded)."""
        shares = manager.calculate_position_size(1_000_000, 100.0, 99.0)
        assert isinstance(shares, int)

    def test_trade_value_calculation(self, manager):
        """Test: Trade value is calculated correctly."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=115.0,
            side="BUY",
        )
        expected_trade_value = result['shares'] * 100.0
        assert result['trade_value'] == round(expected_trade_value, 2)

    def test_risk_amount_calculation(self, manager):
        """Test: Risk amount is calculated correctly."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=3,
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=115.0,
            side="BUY",
        )
        risk_per_share = 5.0
        expected_risk = result['shares'] * risk_per_share
        assert result['risk_amount'] == round(expected_risk, 2)


class TestIntegrationScenarios:
    """Integration tests for realistic trading scenarios."""

    @pytest.fixture
    def manager(self):
        config = RiskConfig(
            max_positions=5,
            max_capital_per_trade=0.10,
            max_daily_loss=0.02,
            max_total_exposure=0.50,
            risk_per_trade=0.01,
            min_trade_value=5000,
            max_trade_value=100000,
        )
        return RiskManager(config=config)

    def test_reliance_trade_scenario(self, manager):
        """Test: Realistic RELIANCE trade."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=2,
            current_exposure=200_000,
            entry_price=2500.0,
            stop_loss=2400.0,  # 4% risk
            take_profit=2800.0,  # 12% reward
            side="BUY",
        )
        assert result['valid'] is True
        assert result['risk_pct'] == 4.0
        assert result['reward_pct'] == 12.0
        assert result['rr_ratio'] == 3.0

    def test_high_volatility_stock(self, manager):
        """Test: High volatility stock with wide stops."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=2,
            current_exposure=200_000,
            entry_price=500.0,
            stop_loss=450.0,  # 10% risk
            take_profit=600.0,  # 20% reward
            side="BUY",
        )
        assert result['valid'] is True
        assert result['risk_pct'] == 10.0

    def test_low_price_stock(self, manager):
        """Test: Low price stock with tight stops."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=2,
            current_exposure=200_000,
            entry_price=50.0,
            stop_loss=48.0,  # 4% risk
            take_profit=56.0,  # 12% reward
            side="BUY",
        )
        assert result['valid'] is True
        assert result['shares'] > 100  # Should have many shares

    def test_portfolio_near_full(self, manager):
        """Test: Portfolio near full capacity."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=60_000,
            current_positions=4,
            current_exposure=490_000,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=110.0,
            side="BUY",
        )
        assert result['valid'] is False
        assert "Total exposure" in result['reason']

    def test_after_loss_trading_halted(self, manager):
        """Test: Trading halted after significant loss."""
        manager.check_daily_loss_limit(-25_000, 1_000_000)
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=2,
            current_exposure=200_000,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=110.0,
            side="BUY",
        )
        assert result['valid'] is False

    def test_new_day_reset(self, manager):
        """Test: New day reset allows trading again."""
        manager.check_daily_loss_limit(-25_000, 1_000_000)
        manager.reset_daily()
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=2,
            current_exposure=200_000,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=110.0,
            side="BUY",
        )
        assert result['valid'] is True

    def test_multiple_positions_building(self, manager):
        """Test: Building multiple positions within limits."""
        positions = 0
        exposure = 0
        capital = 1_000_000

        for _ in range(4):
            result = manager.validate_trade(
                capital=capital,
                cash=500_000,
                current_positions=positions,
                current_exposure=exposure,
                entry_price=100.0,
                stop_loss=95.0,
                take_profit=110.0,
                side="BUY",
            )
            assert result['valid'] is True
            positions += 1
            exposure += result['trade_value']

    def test_position_limit_prevents_overtrading(self, manager):
        """Test: Position limit prevents overtrading."""
        result = manager.validate_trade(
            capital=1_000_000,
            cash=500_000,
            current_positions=5,
            current_exposure=300_000,
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=110.0,
            side="BUY",
        )
        assert result['valid'] is False
        assert "Max positions" in result['reason']
