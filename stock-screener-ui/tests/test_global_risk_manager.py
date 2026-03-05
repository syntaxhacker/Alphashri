"""
Unit tests for GlobalRiskManager.

Tests cover:
- Global risk manager initialization
- Cross-strategy risk limits
- Maximum drawdown checks
- Portfolio-wide position limits
- Risk breach detection and handling
- Daily loss limits
- Symbol exposure checks
- Trade validation and position sizing
- Strategy-specific risk validation
"""

import pytest
from datetime import datetime
from unittest.mock import patch

from trading.global_risk_manager import GlobalRiskManager, GlobalRiskConfig


class TestGlobalRiskConfig:
    """Tests for GlobalRiskConfig dataclass."""

    def test_default_values(self):
        """Test: Default configuration values."""
        config = GlobalRiskConfig()
        assert config.max_total_positions == 10
        assert config.max_total_capital_pct == 0.80
        assert config.max_symbol_exposure_pct == 0.20
        assert config.max_daily_loss_pct == 0.03

    def test_custom_values(self):
        """Test: Custom configuration values."""
        config = GlobalRiskConfig(
            max_total_positions=5,
            max_total_capital_pct=0.60,
            max_symbol_exposure_pct=0.15,
            max_daily_loss_pct=0.02,
        )
        assert config.max_total_positions == 5
        assert config.max_total_capital_pct == 0.60
        assert config.max_symbol_exposure_pct == 0.15
        assert config.max_daily_loss_pct == 0.02


class TestGlobalRiskManagerInit:
    """Tests for GlobalRiskManager initialization."""

    def test_default_initialization(self):
        """Test: Default initialization without parameters."""
        manager = GlobalRiskManager()
        assert manager.config.max_total_positions == 10
        assert manager.config.max_total_capital_pct == 0.80
        assert manager.config.max_symbol_exposure_pct == 0.20
        assert manager.daily_pnl == 0.0
        assert manager.daily_start_loss_limit_hit is False
        assert manager._symbol_exposure == {}

    def test_initialization_with_config(self):
        """Test: Initialization with GlobalRiskConfig."""
        config = GlobalRiskConfig(
            max_total_positions=5,
            max_total_capital_pct=0.60,
            max_symbol_exposure_pct=0.15,
            max_daily_loss_pct=0.02,
        )
        manager = GlobalRiskManager(config=config)
        assert manager.config.max_total_positions == 5
        assert manager.config.max_total_capital_pct == 0.60
        assert manager.config.max_symbol_exposure_pct == 0.15

    def test_initialization_with_params(self):
        """Test: Initialization with individual parameters."""
        manager = GlobalRiskManager(
            max_total_positions=8,
            max_total_capital_pct=0.70,
            max_symbol_exposure_pct=0.25,
        )
        assert manager.config.max_total_positions == 8
        assert manager.config.max_total_capital_pct == 0.70
        assert manager.config.max_symbol_exposure_pct == 0.25

    def test_config_overrides_params(self):
        """Test: Config object overrides individual parameters."""
        config = GlobalRiskConfig(max_total_positions=5)
        manager = GlobalRiskManager(
            config=config,
            max_total_positions=20,
        )
        assert manager.config.max_total_positions == 5


class TestCheckStrategyLimits:
    """Tests for strategy-specific limit checks."""

    @pytest.fixture
    def manager(self):
        return GlobalRiskManager()

    def test_position_limit_allowed(self, manager):
        """Test: Trade allowed within strategy position limit."""
        allowed, reason = manager.check_strategy_limits(
            strategy_id=1,
            strategy_name="ORB",
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=4,
            current_strategy_capital_used=100_000,
            allocated_capital=400_000,
            trade_value=50_000,
        )
        assert allowed is True
        assert reason == "OK"

    def test_position_limit_reached(self, manager):
        """Test: Trade rejected when strategy position limit reached."""
        allowed, reason = manager.check_strategy_limits(
            strategy_id=1,
            strategy_name="ORB",
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=5,
            current_strategy_capital_used=100_000,
            allocated_capital=400_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "max positions" in reason
        assert "5" in reason

    def test_position_limit_exceeded(self, manager):
        """Test: Trade rejected when strategy already over limit."""
        allowed, reason = manager.check_strategy_limits(
            strategy_id=1,
            strategy_name="ORB",
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=6,
            current_strategy_capital_used=100_000,
            allocated_capital=400_000,
            trade_value=50_000,
        )
        assert allowed is False

    def test_capital_limit_allowed(self, manager):
        """Test: Trade allowed within strategy capital limit."""
        allowed, reason = manager.check_strategy_limits(
            strategy_id=1,
            strategy_name="ORB",
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=300_000,
            allocated_capital=400_000,
            trade_value=50_000,
        )
        assert allowed is True
        assert reason == "OK"

    def test_capital_limit_exceeded(self, manager):
        """Test: Trade rejected when strategy capital limit exceeded."""
        allowed, reason = manager.check_strategy_limits(
            strategy_id=1,
            strategy_name="ORB",
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=380_000,
            allocated_capital=400_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "capital limit" in reason

    def test_capital_limit_exactly_reached(self, manager):
        """Test: Trade allowed when using exactly remaining capital."""
        allowed, reason = manager.check_strategy_limits(
            strategy_id=1,
            strategy_name="ORB",
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=350_000,
            allocated_capital=400_000,
            trade_value=50_000,
        )
        assert allowed is True

    def test_available_capital_shown_in_reason(self, manager):
        """Test: Available capital shown in rejection reason."""
        allowed, reason = manager.check_strategy_limits(
            strategy_id=1,
            strategy_name="Test Strategy",
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=380_000,
            allocated_capital=400_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "₹" in reason
        assert "20,000" in reason


class TestCheckGlobalLimits:
    """Tests for global portfolio limit checks."""

    @pytest.fixture
    def manager(self):
        return GlobalRiskManager(
            max_total_positions=10,
            max_total_capital_pct=0.80,
        )

    def test_position_limit_allowed(self, manager):
        """Test: Trade allowed within global position limit."""
        allowed, reason = manager.check_global_limits(
            total_capital=1_000_000,
            current_total_positions=9,
            current_total_capital_used=600_000,
            trade_value=50_000,
        )
        assert allowed is True
        assert reason == "OK"

    def test_position_limit_reached(self, manager):
        """Test: Trade rejected when global position limit reached."""
        allowed, reason = manager.check_global_limits(
            total_capital=1_000_000,
            current_total_positions=10,
            current_total_capital_used=600_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "position limit" in reason
        assert "10" in reason

    def test_capital_limit_allowed(self, manager):
        """Test: Trade allowed within global capital limit."""
        allowed, reason = manager.check_global_limits(
            total_capital=1_000_000,
            current_total_positions=5,
            current_total_capital_used=700_000,
            trade_value=50_000,
        )
        assert allowed is True
        assert reason == "OK"

    def test_capital_limit_exceeded(self, manager):
        """Test: Trade rejected when global capital limit exceeded."""
        allowed, reason = manager.check_global_limits(
            total_capital=1_000_000,
            current_total_positions=5,
            current_total_capital_used=780_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "capital limit" in reason
        assert "80%" in reason

    def test_capital_limit_exactly_reached(self, manager):
        """Test: Trade allowed when using exactly remaining capital."""
        allowed, reason = manager.check_global_limits(
            total_capital=1_000_000,
            current_total_positions=5,
            current_total_capital_used=750_000,
            trade_value=50_000,
        )
        assert allowed is True

    def test_shows_current_usage_pct(self, manager):
        """Test: Shows current usage percentage in rejection reason."""
        allowed, reason = manager.check_global_limits(
            total_capital=1_000_000,
            current_total_positions=5,
            current_total_capital_used=780_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "83.0%" in reason


class TestCheckSymbolExposure:
    """Tests for per-symbol exposure limit checks."""

    @pytest.fixture
    def manager(self):
        return GlobalRiskManager(max_symbol_exposure_pct=0.20)

    def test_exposure_allowed(self, manager):
        """Test: Trade allowed within symbol exposure limit."""
        allowed, reason = manager.check_symbol_exposure(
            symbol="RELIANCE",
            total_capital=1_000_000,
            current_symbol_exposure=100_000,
            trade_value=50_000,
        )
        assert allowed is True
        assert reason == "OK"

    def test_exposure_limit_exceeded(self, manager):
        """Test: Trade rejected when symbol exposure limit exceeded."""
        allowed, reason = manager.check_symbol_exposure(
            symbol="RELIANCE",
            total_capital=1_000_000,
            current_symbol_exposure=180_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "exposure limit" in reason
        assert "20%" in reason

    def test_exposure_exactly_at_limit(self, manager):
        """Test: Trade allowed when exactly at symbol exposure limit."""
        allowed, reason = manager.check_symbol_exposure(
            symbol="RELIANCE",
            total_capital=1_000_000,
            current_symbol_exposure=150_000,
            trade_value=50_000,
        )
        assert allowed is True

    def test_shows_would_be_exposure_pct(self, manager):
        """Test: Shows 'would be' exposure percentage in rejection."""
        allowed, reason = manager.check_symbol_exposure(
            symbol="RELIANCE",
            total_capital=1_000_000,
            current_symbol_exposure=180_000,
            trade_value=50_000,
        )
        assert allowed is False
        assert "23.0%" in reason

    def test_no_current_exposure(self, manager):
        """Test: Trade allowed with no current exposure."""
        allowed, reason = manager.check_symbol_exposure(
            symbol="RELIANCE",
            total_capital=1_000_000,
            current_symbol_exposure=0,
            trade_value=100_000,
        )
        assert allowed is True


class TestCheckDailyLossLimit:
    """Tests for daily loss limit checks."""

    @pytest.fixture
    def manager(self):
        config = GlobalRiskConfig(max_daily_loss_pct=0.03)
        return GlobalRiskManager(config=config)

    def test_no_loss(self, manager):
        """Test: No loss, trading allowed."""
        allowed, reason = manager.check_daily_loss_limit(
            total_capital=1_000_000,
            daily_pnl=0.0,
        )
        assert allowed is True
        assert reason == "OK"

    def test_profit(self, manager):
        """Test: Profit, trading allowed."""
        allowed, reason = manager.check_daily_loss_limit(
            total_capital=1_000_000,
            daily_pnl=10_000,
        )
        assert allowed is True
        assert reason == "OK"

    def test_small_loss_allowed(self, manager):
        """Test: Small loss within limit, trading allowed."""
        allowed, reason = manager.check_daily_loss_limit(
            total_capital=1_000_000,
            daily_pnl=-20_000,
        )
        assert allowed is True
        assert reason == "OK"

    def test_loss_limit_exceeded(self, manager):
        """Test: Loss exceeds limit, trading halted."""
        allowed, reason = manager.check_daily_loss_limit(
            total_capital=1_000_000,
            daily_pnl=-35_000,
        )
        assert allowed is False
        assert "Daily loss limit" in reason
        assert "3%" in reason
        assert manager.daily_start_loss_limit_hit is True

    def test_loss_exactly_at_limit(self, manager):
        """Test: Loss exactly at limit, trading halted."""
        allowed, reason = manager.check_daily_loss_limit(
            total_capital=1_000_000,
            daily_pnl=-30_000,
        )
        assert allowed is False
        assert manager.daily_start_loss_limit_hit is True

    def test_sets_flag_on_limit_hit(self, manager):
        """Test: Flag set when daily loss limit hit."""
        assert manager.daily_start_loss_limit_hit is False
        manager.check_daily_loss_limit(
            total_capital=1_000_000,
            daily_pnl=-35_000,
        )
        assert manager.daily_start_loss_limit_hit is True


class TestCanTrade:
    """Tests for comprehensive trade validation."""

    @pytest.fixture
    def manager(self):
        return GlobalRiskManager(
            max_total_positions=10,
            max_total_capital_pct=0.80,
            max_symbol_exposure_pct=0.20,
        )

    def test_all_checks_pass(self, manager):
        """Test: Trade allowed when all checks pass."""
        allowed, reason = manager.can_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            trade_value=50_000,
            total_capital=1_000_000,
            cash_available=500_000,
            current_total_positions=5,
            current_total_capital_used=400_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=150_000,
            current_symbol_exposure=50_000,
            daily_pnl=0,
        )
        assert allowed is True
        assert reason == "OK"

    def test_insufficient_cash(self, manager):
        """Test: Trade rejected for insufficient cash."""
        allowed, reason = manager.can_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            trade_value=100_000,
            total_capital=1_000_000,
            cash_available=50_000,
            current_total_positions=5,
            current_total_capital_used=400_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=150_000,
            current_symbol_exposure=50_000,
            daily_pnl=0,
        )
        assert allowed is False
        assert "Insufficient cash" in reason

    def test_daily_loss_limit_halted(self, manager):
        """Test: Trade rejected when daily loss limit already hit."""
        manager.daily_start_loss_limit_hit = True
        allowed, reason = manager.can_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            trade_value=50_000,
            total_capital=1_000_000,
            cash_available=500_000,
            current_total_positions=5,
            current_total_capital_used=400_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=150_000,
            current_symbol_exposure=50_000,
            daily_pnl=0,
        )
        assert allowed is False
        assert "Daily loss limit reached" in reason

    def test_daily_loss_exceeded_in_check(self, manager):
        """Test: Trade rejected when daily loss exceeded during check."""
        allowed, reason = manager.can_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            trade_value=50_000,
            total_capital=1_000_000,
            cash_available=500_000,
            current_total_positions=5,
            current_total_capital_used=400_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=150_000,
            current_symbol_exposure=50_000,
            daily_pnl=-35_000,
        )
        assert allowed is False
        assert "Daily loss limit" in reason

    def test_strategy_position_limit_reached(self, manager):
        """Test: Trade rejected when strategy position limit reached."""
        allowed, reason = manager.can_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            trade_value=50_000,
            total_capital=1_000_000,
            cash_available=500_000,
            current_total_positions=5,
            current_total_capital_used=400_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=5,
            current_strategy_capital_used=150_000,
            current_symbol_exposure=50_000,
            daily_pnl=0,
        )
        assert allowed is False
        assert "max positions" in reason

    def test_strategy_capital_limit_exceeded(self, manager):
        """Test: Trade rejected when strategy capital limit exceeded."""
        allowed, reason = manager.can_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            trade_value=100_000,
            total_capital=1_000_000,
            cash_available=500_000,
            current_total_positions=5,
            current_total_capital_used=400_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=350_000,
            current_symbol_exposure=50_000,
            daily_pnl=0,
        )
        assert allowed is False
        assert "capital limit" in reason

    def test_global_position_limit_reached(self, manager):
        """Test: Trade rejected when global position limit reached."""
        allowed, reason = manager.can_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            trade_value=50_000,
            total_capital=1_000_000,
            cash_available=500_000,
            current_total_positions=10,
            current_total_capital_used=400_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=150_000,
            current_symbol_exposure=50_000,
            daily_pnl=0,
        )
        assert allowed is False
        assert "Global position limit" in reason

    def test_global_capital_limit_exceeded(self, manager):
        """Test: Trade rejected when global capital limit exceeded."""
        allowed, reason = manager.can_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            trade_value=100_000,
            total_capital=1_000_000,
            cash_available=500_000,
            current_total_positions=5,
            current_total_capital_used=750_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=150_000,
            current_symbol_exposure=50_000,
            daily_pnl=0,
        )
        assert allowed is False
        assert "Global capital limit" in reason

    def test_symbol_exposure_exceeded(self, manager):
        """Test: Trade rejected when symbol exposure exceeded."""
        allowed, reason = manager.can_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            trade_value=100_000,
            total_capital=1_000_000,
            cash_available=500_000,
            current_total_positions=5,
            current_total_capital_used=400_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=150_000,
            current_symbol_exposure=180_000,
            daily_pnl=0,
        )
        assert allowed is False
        assert "exposure limit" in reason


class TestValidateTrade:
    """Tests for trade validation with position sizing."""

    @pytest.fixture
    def manager(self):
        return GlobalRiskManager(
            max_total_positions=10,
            max_total_capital_pct=0.80,
            max_symbol_exposure_pct=0.20,
        )

    def test_valid_buy_trade(self, manager):
        """Test: Valid BUY trade with good risk/reward."""
        result = manager.validate_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            entry_price=2500.0,
            stop_loss=2400.0,
            take_profit=2800.0,
            side="BUY",
            total_capital=1_000_000,
            cash_available=800_000,
            current_total_positions=3,
            current_total_capital_used=300_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=1,
            current_strategy_capital_used=100_000,
            current_symbol_exposure=0,
            daily_pnl=0,
        )
        assert result['valid'] is True
        assert result['shares'] > 0
        assert result['trade_value'] > 0
        assert result['rr_ratio'] >= 2

    def test_valid_sell_trade(self, manager):
        """Test: Valid SELL trade with good risk/reward."""
        result = manager.validate_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="TCS",
            entry_price=3500.0,
            stop_loss=3600.0,
            take_profit=3200.0,
            side="SELL",
            total_capital=1_000_000,
            cash_available=800_000,
            current_total_positions=3,
            current_total_capital_used=300_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=1,
            current_strategy_capital_used=100_000,
            current_symbol_exposure=0,
            daily_pnl=0,
        )
        assert result['valid'] is True
        assert result['shares'] > 0

    def test_low_risk_reward_ratio(self, manager):
        """Test: Trade rejected for low risk/reward ratio."""
        result = manager.validate_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            entry_price=2500.0,
            stop_loss=2400.0,
            take_profit=2550.0,
            side="BUY",
            total_capital=1_000_000,
            cash_available=800_000,
            current_total_positions=3,
            current_total_capital_used=300_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=1,
            current_strategy_capital_used=100_000,
            current_symbol_exposure=0,
            daily_pnl=0,
        )
        assert result['valid'] is False
        assert "Risk/reward ratio" in result['reason']
        assert "too low" in result['reason']

    def test_invalid_entry_price(self, manager):
        """Test: Trade rejected for invalid entry price."""
        result = manager.validate_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            entry_price=0,
            stop_loss=2400.0,
            take_profit=2800.0,
            side="BUY",
            total_capital=1_000_000,
            cash_available=800_000,
            current_total_positions=3,
            current_total_capital_used=300_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=1,
            current_strategy_capital_used=100_000,
            current_symbol_exposure=0,
            daily_pnl=0,
        )
        assert result['valid'] is False
        assert "Invalid entry price" in result['reason']

    def test_risk_calculation_buy(self, manager):
        """Test: Risk calculation for BUY trade."""
        result = manager.validate_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            entry_price=100.0,
            stop_loss=95.0,
            take_profit=110.0,
            side="BUY",
            total_capital=1_000_000,
            cash_available=800_000,
            current_total_positions=3,
            current_total_capital_used=300_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=1,
            current_strategy_capital_used=100_000,
            current_symbol_exposure=0,
            daily_pnl=0,
        )
        assert result['risk_pct'] == 5.0
        assert result['reward_pct'] == 10.0
        assert result['rr_ratio'] == 2.0

    def test_risk_calculation_sell(self, manager):
        """Test: Risk calculation for SELL trade."""
        result = manager.validate_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            entry_price=100.0,
            stop_loss=105.0,
            take_profit=90.0,
            side="SELL",
            total_capital=1_000_000,
            cash_available=800_000,
            current_total_positions=3,
            current_total_capital_used=300_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=1,
            current_strategy_capital_used=100_000,
            current_symbol_exposure=0,
            daily_pnl=0,
        )
        assert result['risk_pct'] == 5.0
        assert result['reward_pct'] == 10.0
        assert result['rr_ratio'] == 2.0

    def test_position_sizing_by_risk(self, manager):
        """Test: Position sizing based on risk amount."""
        result = manager.validate_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            entry_price=2500.0,
            stop_loss=2400.0,
            take_profit=2800.0,
            side="BUY",
            total_capital=1_000_000,
            cash_available=800_000,
            current_total_positions=3,
            current_total_capital_used=300_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=1,
            current_strategy_capital_used=100_000,
            current_symbol_exposure=0,
            daily_pnl=0,
            risk_per_trade_pct=0.01,
        )
        allocated_capital = 1_000_000 * 0.40
        max_risk = allocated_capital * 0.01
        risk_per_share = 100.0
        shares_by_risk = int(max_risk / risk_per_share)
        max_capital = allocated_capital * 0.10
        shares_by_capital = int(max_capital / 2500.0)
        expected_shares = min(shares_by_risk, shares_by_capital)
        assert result['shares'] == expected_shares

    def test_trade_rejected_by_risk_check(self, manager):
        """Test: Trade rejected by can_trade risk checks."""
        result = manager.validate_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            entry_price=2500.0,
            stop_loss=2400.0,
            take_profit=2800.0,
            side="BUY",
            total_capital=1_000_000,
            cash_available=30_000,
            current_total_positions=3,
            current_total_capital_used=300_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=1,
            current_strategy_capital_used=100_000,
            current_symbol_exposure=0,
            daily_pnl=0,
        )
        assert result['valid'] is False
        assert "Insufficient cash" in result['reason']

    def test_min_trade_value_enforcement(self, manager):
        """Test: Minimum trade value enforced."""
        result = manager.validate_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            entry_price=2500.0,
            stop_loss=2400.0,
            take_profit=2800.0,
            side="BUY",
            total_capital=1_000_000,
            cash_available=800_000,
            current_total_positions=3,
            current_total_capital_used=300_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=1,
            current_strategy_capital_used=100_000,
            current_symbol_exposure=0,
            daily_pnl=0,
            min_trade_value=10_000,
            risk_per_trade_pct=0.001,
        )
        assert result['trade_value'] >= 10_000

    def test_max_trade_value_enforcement(self, manager):
        """Test: Maximum trade value enforced."""
        result = manager.validate_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            entry_price=2500.0,
            stop_loss=2400.0,
            take_profit=2800.0,
            side="BUY",
            total_capital=1_000_000,
            cash_available=800_000,
            current_total_positions=3,
            current_total_capital_used=300_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=1,
            current_strategy_capital_used=100_000,
            current_symbol_exposure=0,
            daily_pnl=0,
            max_trade_value=50_000,
            risk_per_trade_pct=0.10,
        )
        assert result['trade_value'] <= 50_000


class TestUpdateSymbolExposure:
    """Tests for symbol exposure tracking."""

    @pytest.fixture
    def manager(self):
        return GlobalRiskManager()

    def test_update_symbol_exposure(self, manager):
        """Test: Update exposure for a symbol."""
        manager.update_symbol_exposure("RELIANCE", 100_000)
        assert manager._symbol_exposure["RELIANCE"] == 100_000

    def test_update_multiple_symbols(self, manager):
        """Test: Update exposure for multiple symbols."""
        manager.update_symbol_exposure("RELIANCE", 100_000)
        manager.update_symbol_exposure("TCS", 150_000)
        manager.update_symbol_exposure("INFY", 80_000)
        assert len(manager._symbol_exposure) == 3
        assert manager._symbol_exposure["TCS"] == 150_000

    def test_update_existing_symbol(self, manager):
        """Test: Update existing symbol exposure."""
        manager.update_symbol_exposure("RELIANCE", 100_000)
        manager.update_symbol_exposure("RELIANCE", 200_000)
        assert manager._symbol_exposure["RELIANCE"] == 200_000


class TestResetDaily:
    """Tests for daily tracking reset."""

    @pytest.fixture
    def manager(self):
        return GlobalRiskManager()

    def test_reset_daily(self, manager):
        """Test: Reset daily tracking."""
        manager.daily_pnl = -20_000
        manager.daily_start_loss_limit_hit = True
        manager.reset_daily()
        assert manager.daily_pnl == 0.0
        assert manager.daily_start_loss_limit_hit is False

    def test_reset_clears_loss_flag(self, manager):
        """Test: Reset clears daily loss limit flag."""
        manager.daily_start_loss_limit_hit = True
        manager.reset_daily()
        assert manager.daily_start_loss_limit_hit is False


class TestGetConfig:
    """Tests for configuration retrieval."""

    @pytest.fixture
    def manager(self):
        return GlobalRiskManager(
            max_total_positions=10,
            max_total_capital_pct=0.80,
            max_symbol_exposure_pct=0.20,
        )

    def test_get_config(self, manager):
        """Test: Get current configuration."""
        config = manager.get_config()
        assert config['max_total_positions'] == 10
        assert config['max_total_capital'] == "80%"
        assert config['max_symbol_exposure'] == "20%"
        assert config['max_daily_loss'] == "3%"

    def test_get_config_with_custom_values(self):
        """Test: Get config with custom values."""
        manager = GlobalRiskManager(
            max_total_positions=5,
            max_total_capital_pct=0.60,
            max_symbol_exposure_pct=0.15,
        )
        config = manager.get_config()
        assert config['max_total_positions'] == 5
        assert config['max_total_capital'] == "60%"
        assert config['max_symbol_exposure'] == "15%"


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    @pytest.fixture
    def manager(self):
        return GlobalRiskManager()

    def test_zero_trade_value(self, manager):
        """Test: Zero trade value."""
        allowed, reason = manager.check_global_limits(
            total_capital=1_000_000,
            current_total_positions=5,
            current_total_capital_used=600_000,
            trade_value=0,
        )
        assert allowed is True

    def test_very_large_trade_value(self, manager):
        """Test: Very large trade value."""
        allowed, reason = manager.check_global_limits(
            total_capital=1_000_000,
            current_total_positions=5,
            current_total_capital_used=0,
            trade_value=1_000_000_000,
        )
        assert allowed is False

    def test_exact_boundary_values(self, manager):
        """Test: Exact boundary values."""
        allowed, reason = manager.check_global_limits(
            total_capital=1_000_000,
            current_total_positions=9,
            current_total_capital_used=750_000,
            trade_value=50_000,
        )
        assert allowed is True

    def test_multiple_strategies_same_symbol(self, manager):
        """Test: Multiple strategies trading same symbol."""
        allowed1, _ = manager.check_symbol_exposure(
            symbol="RELIANCE",
            total_capital=1_000_000,
            current_symbol_exposure=50_000,
            trade_value=50_000,
        )
        allowed2, _ = manager.check_symbol_exposure(
            symbol="RELIANCE",
            total_capital=1_000_000,
            current_symbol_exposure=100_000,
            trade_value=50_000,
        )
        assert allowed1 is True
        assert allowed2 is True

    def test_negative_capital_used(self, manager):
        """Test: Negative capital used (shouldn't happen in practice)."""
        allowed, _ = manager.check_strategy_limits(
            strategy_id=1,
            strategy_name="Test",
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=0,
            current_strategy_capital_used=-100_000,
            allocated_capital=400_000,
            trade_value=50_000,
        )
        assert allowed is True

    def test_very_small_loss(self, manager):
        """Test: Very small loss well within limit."""
        allowed, reason = manager.check_daily_loss_limit(
            total_capital=1_000_000,
            daily_pnl=-100,
        )
        assert allowed is True

    def test_large_capital_scenario(self, manager):
        """Test: Large capital scenario."""
        allowed, reason = manager.can_trade(
            strategy_id=1,
            strategy_name="Institutional",
            symbol="RELIANCE",
            trade_value=10_000_000,
            total_capital=100_000_000,
            cash_available=80_000_000,
            current_total_positions=5,
            current_total_capital_used=50_000_000,
            strategy_max_positions=10,
            strategy_allocation_pct=0.50,
            current_strategy_positions=3,
            current_strategy_capital_used=30_000_000,
            current_symbol_exposure=0,
            daily_pnl=0,
        )
        assert allowed is True


class TestRiskBreachScenarios:
    """Tests for various risk breach scenarios."""

    @pytest.fixture
    def manager(self):
        config = GlobalRiskConfig(
            max_total_positions=10,
            max_total_capital_pct=0.80,
            max_symbol_exposure_pct=0.20,
            max_daily_loss_pct=0.03,
        )
        return GlobalRiskManager(config=config)

    def test_cascading_breach_daily_loss_first(self, manager):
        """Test: Daily loss breach prevents further checks."""
        allowed, reason = manager.can_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            trade_value=50_000,
            total_capital=1_000_000,
            cash_available=500_000,
            current_total_positions=5,
            current_total_capital_used=400_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=150_000,
            current_symbol_exposure=50_000,
            daily_pnl=-35_000,
        )
        assert allowed is False
        assert "Daily loss limit" in reason

    def test_cascading_breach_cash_first(self, manager):
        """Test: Cash shortage prevents further checks."""
        allowed, reason = manager.can_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            trade_value=1_000_000,
            total_capital=1_000_000,
            cash_available=10_000,
            current_total_positions=5,
            current_total_capital_used=400_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=2,
            current_strategy_capital_used=150_000,
            current_symbol_exposure=50_000,
            daily_pnl=0,
        )
        assert allowed is False
        assert "Insufficient cash" in reason

    def test_multiple_limit_approach(self, manager):
        """Test: Approaching multiple limits simultaneously."""
        allowed, reason = manager.can_trade(
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            trade_value=10_000,
            total_capital=1_000_000,
            cash_available=70_000,
            current_total_positions=9,
            current_total_capital_used=740_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.40,
            current_strategy_positions=4,
            current_strategy_capital_used=190_000,
            current_symbol_exposure=190_000,
            daily_pnl=-25_000,
        )
        assert allowed is True
        assert reason == "OK"

    def test_symbol_exposure_breach_with_multiple_strategies(self, manager):
        """Test: Symbol exposure breach with multiple strategies."""
        allowed, reason = manager.can_trade(
            strategy_id=2,
            strategy_name="Momentum",
            symbol="RELIANCE",
            trade_value=50_000,
            total_capital=1_000_000,
            cash_available=500_000,
            current_total_positions=5,
            current_total_capital_used=400_000,
            strategy_max_positions=5,
            strategy_allocation_pct=0.30,
            current_strategy_positions=2,
            current_strategy_capital_used=150_000,
            current_symbol_exposure=180_000,
            daily_pnl=0,
        )
        assert allowed is False
        assert "exposure limit" in reason
