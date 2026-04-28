import pytest
from datetime import datetime

from trading.shared_portfolio import SharedPosition, SharedPortfolioManager, OrderSide


class TestSharedPositionMetadata:

    @pytest.fixture
    def base_position(self):
        return SharedPosition(
            symbol="TEST", side=OrderSide.BUY, quantity=10,
            entry_price=100.0, stop_loss=95.0, take_profit=110.0,
            entry_time=datetime.now(), strategy_id=1, strategy_name="test",
        )

    def test_default_metadata_empty_dict(self, base_position):
        assert base_position.metadata == {}

    def test_metadata_stored_and_retrieved(self, base_position):
        base_position.metadata["key1"] = "value1"
        base_position.metadata["key2"] = 42
        base_position.metadata["nested"] = {"a": 1, "b": 2}
        assert base_position.metadata["key1"] == "value1"
        assert base_position.metadata["key2"] == 42
        assert base_position.metadata["nested"]["a"] == 1

    def test_metadata_with_52w_high(self):
        pos = SharedPosition(
            symbol="RELIANCE", side=OrderSide.BUY, quantity=50,
            entry_price=2450.0, stop_loss=2400.0, take_profit=2600.0,
            entry_time=datetime.now(), strategy_id=2, strategy_name="52W_CHASER",
        )
        pos.metadata["entry_52w_high"] = 2500.0
        pos.metadata["strategy_type"] = "52W_CHASER"
        pos.metadata["trailing_active"] = False
        pos.metadata["trailing_stop_pct"] = 3.0
        pos.metadata["highest_price_since_entry"] = 2520.0
        assert pos.metadata["entry_52w_high"] == 2500.0
        assert pos.metadata["strategy_type"] == "52W_CHASER"
        assert pos.metadata["trailing_active"] is False
        assert pos.metadata["trailing_stop_pct"] == 3.0
        assert pos.metadata["highest_price_since_entry"] == 2520.0
        assert len(pos.metadata) == 5

    def test_open_position_deducts_cash_and_updates_strategy(self):
        pm = SharedPortfolioManager(initial_capital=100000)
        pm.set_strategy_allocation(1, "ORB", 0.5, 5)
        cash_before = pm.cash
        alloc_before = pm.strategy_allocations[1].capital_used

        pos = pm.open_position(
            strategy_id=1, strategy_name="ORB", symbol="TEST",
            side=OrderSide.BUY, quantity=50, entry_price=200.0,
            stop_loss=195.0, take_profit=210.0,
        )
        assert pos is not None
        trade_value = 50 * 200.0
        assert pm.cash == cash_before - trade_value
        assert pm.strategy_allocations[1].capital_used == alloc_before + trade_value
        assert pm.strategy_allocations[1].positions_count == 1
        assert f"1_TEST" in pm.positions

    def test_close_position_computes_pnl_and_removes_position(self):
        pm = SharedPortfolioManager(initial_capital=100000)
        pm.set_strategy_allocation(1, "ORB", 0.5, 5)
        pm.open_position(
            strategy_id=1, strategy_name="ORB", symbol="TEST",
            side=OrderSide.BUY, quantity=10, entry_price=100.0,
            stop_loss=95.0, take_profit=110.0,
        )

        trade = pm.close_position(
            strategy_id=1, symbol="TEST", exit_price=110.0,
            exit_reason="TP", costs=5.0,
        )
        assert trade is not None
        assert trade.pnl == (110.0 - 100.0) * 10  # 100
        assert trade.pnl_pct == (110.0 - 100.0) / 100.0 * 100  # 10%
        assert trade.costs == 5.0
        assert trade.net_pnl == 100.0 - 5.0
        assert f"1_TEST" not in pm.positions
        assert pm.daily_trades == 1

    def test_restore_position_preserves_metadata(self):
        pm = SharedPortfolioManager(initial_capital=500000)
        pm.set_strategy_allocation(1, "52W_TARGET", 0.5, 5)
        pos_data = {
            "symbol": "TCS",
            "side": "BUY",
            "quantity": 25,
            "entry_price": 3500.0,
            "stop_loss": 3430.0,
            "take_profit": 35000.0,
            "entry_time": "2025-06-01T09:30:00",
            "strategy_id": 1,
            "strategy_name": "52W_TARGET",
            "current_price": 3550.0,
            "peak_price": 3580.0,
            "metadata": {
                "entry_52w_high": 3600.0,
                "trailing_active": True,
                "highest_price_since_entry": 3580.0,
            },
        }
        pm.restore_position(pos_data)
        key = "1_TCS"
        assert key in pm.positions
        pos = pm.positions[key]
        assert pos.metadata["entry_52w_high"] == 3600.0
        assert pos.metadata["trailing_active"] is True
        assert pos.metadata["highest_price_since_entry"] == 3580.0
        assert pos.symbol == "TCS"
        assert pos.entry_price == 3500.0
        assert pos.strategy_name == "52W_TARGET"
