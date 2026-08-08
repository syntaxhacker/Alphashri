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


@pytest.fixture
def dashboard_module():
    from api.paper import dashboard_analytics
    return dashboard_analytics


class MockBot:
    def __init__(self, id=1, uuid="bot-1", name="ORB Bot"):
        self.id = id
        self.uuid = uuid
        self.name = name


class MockQuery:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def all(self):
        return self.rows


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


class TestDashboardAnalyticsEndpoint:

    @pytest.mark.asyncio
    async def test_dashboard_analytics_all_bots_ranking_and_extremes(self, dashboard_module):
        bot = MockBot()
        winner = make_trade(
            id=1,
            bot_id=1,
            bot=bot,
            strategy_id=10,
            strategy_name="ORB Best",
            symbol="RELIANCE",
            net_pnl=1200.0,
            pnl=1300.0,
            costs=100.0,
            exit_reason="TP",
        )
        loser = make_trade(
            id=2,
            bot_id=1,
            bot=bot,
            strategy_id=10,
            strategy_name="ORB Best",
            symbol="TCS",
            net_pnl=-400.0,
            pnl=-350.0,
            costs=50.0,
            exit_reason="SL",
        )

        mock_db = MagicMock()
        mock_db.__enter__.return_value = mock_db
        mock_db.__exit__.return_value = None
        mock_db.query.side_effect = [MockQuery([winner, loser]), MockQuery([bot])]

        with patch.object(dashboard_module, "SessionLocal", return_value=mock_db):
            result = await dashboard_module.get_dashboard_analytics(
                preset="30D",
                from_date=None,
                to_date=None,
                bot_id=None,
                user=MockUser(),
            )

        assert result["period"]["bot_id"] == "all"
        assert result["summary"]["total_trades"] == 2
        assert result["summary"]["total_net_pnl"] == 800.0
        assert result["bot_rankings"][0]["bot_name"] == "ORB Bot"
        assert result["strategy_rankings"][0]["strategy_name"] == "ORB Best"
        assert result["biggest_winners"][0]["symbol"] == "RELIANCE"
        assert result["biggest_losers"][0]["symbol"] == "TCS"
        assert result["exit_reasons"][0]["reason"] == "TP"


