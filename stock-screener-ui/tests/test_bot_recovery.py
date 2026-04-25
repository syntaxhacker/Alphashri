import pytest
import json
import os
from pathlib import Path
from datetime import datetime
from unittest.mock import MagicMock, patch

from trading.multi_strategy_runner import MultiStrategyRunner, StrategyRunner
from trading.shared_portfolio import OrderSide

@pytest.mark.unit
class TestBotRecovery:
    """Tests for bot state recovery (snapshot load/save)."""

    @pytest.fixture
    def mock_bot_config(self):
        config = MagicMock()
        config.id = 123
        config.name = "Test Bot"
        config.max_total_positions = 10
        config.max_total_capital_pct = 0.8
        return config

    @pytest.mark.skip(reason="save_snapshot/load_snapshot removed — state now persisted via persist_state() to DB + Redis")
    def test_save_and_load_snapshot(self, mock_bot_config, tmp_path):
        """Test that state is correctly saved to and loaded from a snapshot."""
        user_id = 999
        bot_id = 123
        snapshot_path = tmp_path / f"multi-strategy-bot-{user_id}-{bot_id}.json"
        
        # 1. Setup runner and create some state
        with patch('trading.multi_strategy_runner.SessionLocal'), \
             patch('trading.multi_strategy_runner.SharedPortfolioManager.restore_state'), \
             patch('trading.multi_strategy_runner.SharedPortfolioManager.restore_position'):
            
            runner = MultiStrategyRunner(bot_config=mock_bot_config, user_id=user_id)
            runner.snapshot_file = snapshot_path
            
            # Manually set some state
            runner.portfolio.cash = 500000
            runner.portfolio.daily_pnl = 1500
            runner.running = True
            
            # Add a mock strategy
            runner.strategies[1] = StrategyRunner(
                strategy_id=1, strategy_name="S1", strategy_type="ORB",
                config={}, max_positions=3, capital_allocation_pct=0.5
            )
            runner.strategies[1].status = "running"
            runner.strategies[1].signals_generated = 5
            
            # 2. Save snapshot
            runner.save_snapshot()
            assert snapshot_path.exists()
            
            # 3. Create a new runner and load snapshot
            # We need to mock the portfolio methods to verify they are called
            new_portfolio = MagicMock()
            with patch('trading.multi_strategy_runner.SharedPortfolioManager', return_value=new_portfolio), \
                 patch('trading.multi_strategy_runner.MultiStrategyRunner._load_strategies'), \
                 patch('trading.multi_strategy_runner.get_journal'):
                new_runner = MultiStrategyRunner(bot_config=mock_bot_config, user_id=user_id)
                new_runner.snapshot_file = snapshot_path
                
                # Manually add the strategy so it can be restored
                new_runner.strategies[1] = StrategyRunner(
                    strategy_id=1, strategy_name="S1", strategy_type="ORB",
                    config={}, max_positions=3, capital_allocation_pct=0.5
                )
                
                new_runner.load_snapshot()
                
                # Verify portfolio restoration was called
                new_portfolio.restore_state.assert_called_once()
                # Verify strategy restoration
                assert new_runner.strategies[1].status == "running"
                assert new_runner.strategies[1].signals_generated == 5

    def test_restore_position_logic(self, mock_bot_config):
        """Test the actual position restoration logic in SharedPortfolioManager."""
        from trading.shared_portfolio import SharedPortfolioManager
        
        portfolio = SharedPortfolioManager(initial_capital=1000000)
        portfolio.set_strategy_allocation(1, "S1", 0.5, 3)
        
        pos_data = {
            'symbol': 'RELIANCE',
            'side': 'BUY',
            'quantity': 10,
            'entry_price': 2500.0,
            'stop_loss': 2400.0,
            'take_profit': 2700.0,
            'entry_time': datetime.now().isoformat(),
            'strategy_id': 1,
            'strategy_name': 'S1',
        }
        
        portfolio.restore_position(pos_data)
        
        assert '1_RELIANCE' in portfolio.positions
        pos = portfolio.positions['1_RELIANCE']
        assert pos.symbol == 'RELIANCE'
        assert pos.quantity == 10
        assert portfolio.strategy_allocations[1].positions_count == 1
        assert portfolio.strategy_allocations[1].capital_used == 25000.0
