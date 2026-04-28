"""
Paper Helpers Tests

Tests for build_trade_log_entry from api/paper/helpers.py.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock

from api.paper.helpers import build_trade_log_entry
from trading.paper.paper_models import OrderSide, ExitReason

IST = timezone(timedelta(hours=5, minutes=30))


def _make_trade(**overrides):
    """Create a MagicMock PaperTrade with sensible defaults."""
    defaults = dict(
        trade_id="TRD-000001",
        symbol="RELIANCE",
        side=OrderSide.BUY,
        quantity=100,
        entry_price=2500.0,
        exit_price=2600.0,
        entry_time=datetime(2026, 4, 25, 9, 30, 0, tzinfo=IST),
        exit_time=datetime(2026, 4, 25, 14, 0, 0, tzinfo=IST),
        pnl=10000.0,
        pnl_pct=4.0,
        exit_reason=ExitReason.TAKE_PROFIT,
        costs=50.0,
        net_pnl=9950.0,
        peak_price=2620.0,
        low_price=2480.0,
        strategy_id=1,
        strategy_name="ORB Conservative",
        reason="TP hit",
    )
    defaults.update(overrides)
    trade = MagicMock()
    for k, v in defaults.items():
        setattr(trade, k, v)
    return trade


@pytest.mark.unit
class TestBuildTradeLogEntry:

    def test_maps_all_fields_correctly(self):
        """All PaperTrade fields are mapped to the expected dict keys."""
        trade = _make_trade()
        entry = build_trade_log_entry(trade)

        assert entry["trade_id"] == "TRD-000001"
        assert entry["symbol"] == "RELIANCE"
        assert entry["side"] == "BUY"
        assert entry["quantity"] == 100
        assert entry["entry_price"] == 2500.0
        assert entry["exit_price"] == 2600.0
        assert entry["pnl"] == 10000.0
        assert entry["pnl_pct"] == 4.0
        assert entry["exit_reason"] == "TP"
        assert entry["costs"] == 50.0
        assert entry["net_pnl"] == 9950.0
        assert entry["peak_price"] == 2620.0
        assert entry["low_price"] == 2480.0

    def test_returns_dict_with_all_expected_keys(self):
        """Returned dict contains exactly the expected keys."""
        trade = _make_trade()
        entry = build_trade_log_entry(trade)

        expected_keys = {
            "trade_id", "symbol", "side", "quantity",
            "entry_price", "exit_price",
            "entry_time", "exit_time",
            "pnl", "pnl_pct", "exit_reason",
            "costs", "net_pnl",
            "peak_price", "low_price",
        }
        assert set(entry.keys()) == expected_keys

    def test_formats_entry_and_exit_times_as_iso(self):
        """entry_time and exit_time are formatted as ISO strings."""
        trade = _make_trade(
            entry_time=datetime(2026, 4, 25, 9, 15, 0, tzinfo=IST),
            exit_time=datetime(2026, 4, 25, 15, 0, 0, tzinfo=IST),
        )
        entry = build_trade_log_entry(trade)

        assert isinstance(entry["entry_time"], str)
        assert isinstance(entry["exit_time"], str)
        assert "09:15" in entry["entry_time"]
        assert "15:00" in entry["exit_time"]

    def test_handles_buy_side(self):
        """BUY side maps correctly."""
        trade = _make_trade(side=OrderSide.BUY)
        entry = build_trade_log_entry(trade)
        assert entry["side"] == "BUY"

    def test_handles_sell_side(self):
        """SELL side maps correctly."""
        trade = _make_trade(side=OrderSide.SELL)
        entry = build_trade_log_entry(trade)
        assert entry["side"] == "SELL"

    def test_handles_missing_optional_fields(self):
        """Peak/low price and strategy_id default to zero/empty."""
        trade = _make_trade(peak_price=0.0, low_price=0.0, strategy_id=0)
        entry = build_trade_log_entry(trade)

        assert entry["peak_price"] == 0.0
        assert entry["low_price"] == 0.0

    def test_handles_all_exit_reasons(self):
        """Each ExitReason enum value maps to its string value."""
        for reason in ExitReason:
            trade = _make_trade(exit_reason=reason)
            entry = build_trade_log_entry(trade)
            assert entry["exit_reason"] == reason.value

    def test_handles_negative_pnl(self):
        """Negative P&L (losing trade) is mapped correctly."""
        trade = _make_trade(
            pnl=-2500.0,
            pnl_pct=-1.0,
            net_pnl=-2550.0,
            costs=50.0,
            exit_reason=ExitReason.STOP_LOSS,
        )
        entry = build_trade_log_entry(trade)

        assert entry["pnl"] == -2500.0
        assert entry["pnl_pct"] == -1.0
        assert entry["net_pnl"] == -2550.0
        assert entry["exit_reason"] == "SL"
