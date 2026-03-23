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
