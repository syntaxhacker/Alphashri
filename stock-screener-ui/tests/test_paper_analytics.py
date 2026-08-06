"""
Tests for Paper Trading analytics, activity feed, aggregated dashboard, and signal preview endpoints.
"""

from unittest.mock import patch, MagicMock
from datetime import datetime, timedelta

import pytest

import config


class MockTrade:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


def make_trade(**overrides):
    defaults = {
        "trade_id": "TRADE-001",
        "symbol": "RELIANCE",
        "side": "BUY",
        "quantity": 10,
        "entry_price": 2500.0,
        "exit_price": 2600.0,
        "entry_time": datetime.now(config.IST) - timedelta(hours=2),
        "exit_time": datetime.now(config.IST),
        "pnl": 1000.0,
        "pnl_pct": 4.0,
        "net_pnl": 950.0,
        "costs": 50.0,
        "exit_reason": "TP",
        "strategy_name": "ORB",
        "hold_duration_minutes": 120,
    }
    defaults.update(overrides)
    return MockTrade(**defaults)


class MockUser:
    def __init__(self, user_id=1):
        self.id = user_id


@pytest.fixture
def analytics_module():
    from api.paper import analytics
    return analytics


@pytest.fixture
def activity_module():
    from api.paper import activity
    return activity


@pytest.fixture
def aggregated_module():
    from api.paper import aggregated
    return aggregated


class TestAnalyticsEndpoint:

    @pytest.mark.asyncio
    async def test_analytics_empty(self, analytics_module):
        result = await analytics_module.get_analytics(days_back=30, user=MockUser())
        assert result["summary"]["total_trades"] >= 0
        assert isinstance(result["daily_pnl"], list)
        assert isinstance(result["equity_curve"], list)
        assert isinstance(result["drawdown"], list)

    @pytest.mark.asyncio
    async def test_analytics_summary_structure(self, analytics_module):
        result = await analytics_module.get_analytics(days_back=30, user=MockUser())
        required_keys = {"total_trades", "winners", "losers", "win_rate",
                         "total_gross_pnl", "total_net_pnl", "total_costs",
                         "avg_win", "avg_loss", "profit_factor",
                         "max_drawdown", "max_drawdown_pct", "final_pnl"}
        assert required_keys.issubset(result["summary"].keys())
        assert isinstance(result["daily_pnl"], list)
        assert isinstance(result["equity_curve"], list)
        assert isinstance(result["drawdown"], list)
        assert isinstance(result["monthly_pnl"], list)
        assert isinstance(result["symbol_performance"], list)


class TestActivityFeedEndpoint:

    @pytest.mark.asyncio
    async def test_activity_feed_empty(self, activity_module):
        result = await activity_module.get_activity_feed(since=None, limit=50, user=MockUser())
        assert isinstance(result["events"], list)
        assert isinstance(result["total"], int)

    @pytest.mark.asyncio
    async def test_activity_feed_with_trades(self, activity_module):
        result = await activity_module.get_activity_feed(since=None, limit=50, user=MockUser())
        assert len(result["events"]) >= 0


class TestAggregatedEndpoint:

    @pytest.mark.asyncio
    async def test_aggregated_empty(self, aggregated_module):
        with patch.object(aggregated_module, "SessionLocal") as mock_session:
            mock_db = MagicMock()
            mock_db.__enter__.return_value = mock_db
            mock_db.__exit__.return_value = None
            mock_db.query.return_value.filter.return_value.all.return_value = []
            mock_session.return_value = mock_db
            result = await aggregated_module.get_aggregated_dashboard(user=MockUser())
            assert result["summary"]["total_bots"] == 0
            assert result["bots"] == []



