import pytest
from trading.risk_manager import RiskManager, RiskConfig
from trading.global_risk_manager import GlobalRiskManager, GlobalRiskConfig

@pytest.mark.unit
class TestRiskManagerEdgeCases:
    """Edge case tests for RiskManager."""

    def test_zero_capital(self):
        """Test risk manager with zero capital."""
        rm = RiskManager()
        # Should return 0 shares if capital is 0
        shares = rm.calculate_position_size(capital=0, entry_price=100, stop_loss=95)
        assert shares == 0
        
        validation = rm.validate_trade(
            capital=0, cash=0, current_positions=0, current_exposure=0,
            entry_price=100, stop_loss=95, take_profit=110
        )
        assert not validation['valid']
        assert "Insufficient capital" in validation['reason']

    def test_extremely_low_capital(self):
        """Test risk manager with capital below min trade value."""
        rm = RiskManager(config=RiskConfig(min_trade_value=5000))
        # Capital 1000 is below min_trade_value
        validation = rm.validate_trade(
            capital=1000, cash=1000, current_positions=0, current_exposure=0,
            entry_price=100, stop_loss=95, take_profit=110
        )
        assert not validation['valid']
        assert "Insufficient capital" in validation['reason']

    def test_negative_pnl_limit(self):
        """Test daily loss limit with negative capital (edge case)."""
        rm = RiskManager(config=RiskConfig(max_daily_loss=0.02))
        # If capital is 100,000, loss limit is 2,000.
        # If daily_pnl is -3,000, it should reject.
        assert not rm.check_daily_loss_limit(daily_pnl=-3000, capital=100000)
        # After reset, it should allow
        rm.reset_daily()
        assert rm.check_daily_loss_limit(daily_pnl=0, capital=100000)

@pytest.mark.unit
class TestGlobalRiskManagerEdgeCases:
    """Edge case tests for GlobalRiskManager."""

    def test_strategy_allocation_sum_exceeds_100(self):
        """Test if global risk manager handles strategies totaling > 100% allocation."""
        # GlobalRiskManager doesn't actually check if sum of all strategies is <= 100%
        # because it validates each trade against its ALLOWED allocation.
        # But let's see how it behaves.
        rm = GlobalRiskManager()
        
        # Strategy A: 60%
        # Strategy B: 60%
        # Total: 120%
        
        # Trade for Strategy A (allowed as it's < Strategy A's 60%)
        res_a = rm.validate_trade(
            strategy_id=1, strategy_name="A", symbol="S1", entry_price=100,
            stop_loss=95, take_profit=110, side="BUY", total_capital=100000, 
            cash_available=100000,
            current_total_positions=0, current_total_capital_used=0,
            strategy_max_positions=5, strategy_allocation_pct=0.6,
            current_strategy_positions=0, current_strategy_capital_used=0
        )
        assert res_a['valid']

    def test_max_symbol_exposure_exactly_reached(self):
        """Test symbol exposure limit boundary."""
        rm = GlobalRiskManager(max_symbol_exposure_pct=0.1) # 10% max
        
        # Capital 100,000 -> Max exposure 10,000
        # Current exposure 9,000. Trade value 1,000. Total 10,000 (Exactly Limit)
        allowed, reason = rm.check_symbol_exposure(
            symbol="TEST", total_capital=100000, current_symbol_exposure=9000, trade_value=1000
        )
        assert allowed
        
        # Current exposure 9,000. Trade value 1,001. Total 10,001 (Exceeds Limit)
        allowed, reason = rm.check_symbol_exposure(
            symbol="TEST", total_capital=100000, current_symbol_exposure=9000, trade_value=1001
        )
        assert not allowed
        assert "exposure limit" in reason.lower()

    def test_daily_loss_limit_exactly_reached(self):
        """Test daily loss limit boundary."""
        rm = GlobalRiskManager(config=GlobalRiskConfig(max_daily_loss_pct=0.02)) # 2%
        
        # Capital 100,000 -> Max loss 2,000
        # Loss -2,000 (Exactly Limit) -> Should be REJECTED (conservative)
        within, reason = rm.check_daily_loss_limit(total_capital=100000, daily_pnl=-2000)
        assert not within
        
        # Loss -1,999 (Below Limit) -> Should be ALLOWED
        within, reason = rm.check_daily_loss_limit(total_capital=100000, daily_pnl=-1999)
        assert within
        assert reason == "OK"
