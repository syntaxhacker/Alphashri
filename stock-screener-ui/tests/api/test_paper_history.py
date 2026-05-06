"""
Paper Trading History API Tests.

Tests for PATCH /api/paper/trades/{trade_id} endpoint from api/paper/history.py.
Uses the `client` and `auth_headers` fixtures from tests/api/conftest.py.
"""

import pytest
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock
from contextlib import contextmanager
from sqlalchemy.orm import Session

IST = timezone(timedelta(hours=5, minutes=30))


@contextmanager
def _mock_session_context(trade_result=None):
    """Context manager that mimics SessionLocal() with proper query chain.

    The endpoint makes two separate db.query() calls:
    1. db.query(Trade).filter(Trade.uuid == ...).first()  — uuid lookup
    2. db.query(Trade).filter(Trade.id == ...).first()    — int id fallback
    """
    mock_db = MagicMock()
    mock_db.commit = MagicMock(return_value=None)

    # First query call (uuid lookup) -> returns None
    first_query = MagicMock()
    first_filter = MagicMock()
    first_filter.first.return_value = None
    first_query.filter.return_value = first_filter

    # Second query call (int id lookup) -> returns trade_result
    second_query = MagicMock()
    second_filter = MagicMock()
    second_filter.first.return_value = trade_result
    second_query.filter.return_value = second_filter

    mock_db.query.side_effect = [first_query, second_query]

    try:
        yield mock_db
    finally:
        pass


@pytest.fixture
def sample_trade():
    """Create a sample trade object (not persisted)."""
    from db.models import Trade
    trade = Trade(
        id=1,
        uuid="test-uuid-1234",
        user_id=1,
        strategy_name="ORB",
        symbol="RELIANCE",
        side="BUY",
        quantity=50,
        entry_price=2500.0,
        exit_price=2600.0,
        entry_time=datetime(2026, 3, 30, 10, 15, 0, tzinfo=IST),
        exit_time=datetime(2026, 3, 30, 11, 30, 0, tzinfo=IST),
        pnl=5000.0,
        pnl_pct=2.0,
        costs=50.0,
        net_pnl=4950.0,
        exit_reason="TP",
        notes="",
        reason="",
    )
    return trade


# ============================================================================
# Tests for resolve_bot_id (UUID/bot_id resolution)
# ============================================================================

@pytest.mark.unit
class TestResolveBotId:
    """Tests for resolve_bot_id() in api/bots_api/bots_router.py."""

    def test_resolve_bot_id_with_numeric_string(self, db: Session):
        """Numeric strings resolve directly to int."""
        from api.bots_api.bots_router import resolve_bot_id
        assert resolve_bot_id("42", db) == 42

    def test_resolve_bot_id_with_uuid(self, db: Session):
        """UUID strings resolve via BotConfig.uuid lookup."""
        from api.bots_api.bots_router import resolve_bot_id
        from db.models import BotConfig

        bot_uuid = str(uuid.uuid4())
        bot = BotConfig(
            name="UUID Test Bot",
            uuid=bot_uuid,
            user_id=1,
            is_active=True,
        )
        db.add(bot)
        db.commit()
        db.refresh(bot)

        result = resolve_bot_id(bot_uuid, db)
        assert result == bot.id

    def test_resolve_bot_id_with_nonexistent_uuid(self, db: Session):
        """Non-existent UUID returns None."""
        from api.bots_api.bots_router import resolve_bot_id
        result = resolve_bot_id(str(uuid.uuid4()), db)
        assert result is None

    def test_resolve_bot_id_with_invalid_string(self, db: Session):
        """Invalid string (not numeric, not UUID) returns None."""
        from api.bots_api.bots_router import resolve_bot_id
        result = resolve_bot_id("not-a-bot-id", db)
        assert result is None


# ============================================================================
# Tests for trades endpoint with UUID bot_id
# ============================================================================

@pytest.mark.unit
class TestTradesBotIdFilter:
    """Tests that /api/paper/trades accepts UUID bot_id filter."""

    def test_trades_with_integer_bot_id_returns_200(self, client, auth_headers):
        """Integer bot_id param does not cause errors."""
        with patch("api.paper.history._get_trades_from_db") as mock_get, \
             patch("api.paper.history._resolve_trade_bot_ids", return_value=[]):
            mock_get.return_value = []
            response = client.get(
                "/api/paper/trades?bot_id=3&limit=5",
                headers=auth_headers,
            )
        assert response.status_code == 200

    def test_trades_with_uuid_bot_id_returns_200(self, client, auth_headers):
        """UUID bot_id param does not cause errors."""
        with patch("api.paper.history._get_trades_from_db") as mock_get, \
             patch("api.paper.history._resolve_trade_bot_ids", return_value=[]):
            mock_get.return_value = []
            test_uuid = str(uuid.uuid4())
            response = client.get(
                f"/api/paper/trades?bot_id={test_uuid}&limit=5",
                headers=auth_headers,
            )
        assert response.status_code == 200

    def test_trades_with_default_bot_id_returns_200(self, client, auth_headers):
        """'default' bot_id param is handled without error."""
        with patch("api.paper.history._get_trades_from_db") as mock_get, \
             patch("api.paper.history._resolve_trade_bot_ids", return_value=[]):
            mock_get.return_value = []
            response = client.get(
                "/api/paper/trades?bot_id=default&limit=5",
                headers=auth_headers,
            )
        assert response.status_code == 200

    def test_trades_bot_id_uuid_and_int_return_same(self, client, auth_headers):
        """UUID and integer bot_id produce identical results (via mocked DB)."""
        from api.bots_api.bots_router import resolve_bot_id
        test_uuid = str(uuid.uuid4())

        with patch("api.paper.history._get_trades_from_db") as mock_get, \
             patch("api.paper.history._resolve_trade_bot_ids") as mock_resolve:
            mock_get.return_value = [
                {"symbol": "TEST", "pnl": 100.0, "bot_id": 3}
            ]
            mock_resolve.return_value = [
                {"symbol": "TEST", "pnl": 100.0, "bot_id": "uuid-3"}
            ]
            resp_uuid = client.get(
                f"/api/paper/trades?bot_id={test_uuid}&limit=5",
                headers=auth_headers,
            )
            resp_int = client.get(
                "/api/paper/trades?bot_id=3&limit=5",
                headers=auth_headers,
            )

        assert resp_uuid.status_code == 200
        assert resp_int.status_code == 200
        data_uuid = resp_uuid.json()
        data_int = resp_int.json()
        assert data_uuid.get("total_trades") == data_int.get("total_trades")


@pytest.mark.unit
class TestPatchTradeNotes:

    def test_patch_updates_notes_and_reason(self, client, auth_headers, sample_trade):
        with patch("api.paper.history.SessionLocal", lambda: _mock_session_context(sample_trade)):
            response = client.patch(
                "/api/paper/trades/TRADE-000001",
                json={"notes": "good breakout", "reason": "ORB Conservative"},
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["notes"] == "good breakout"
        assert data["reason"] == "ORB Conservative"

    def test_patch_with_invalid_trade_id_format(self, client, auth_headers):
        with patch("api.paper.history.SessionLocal", lambda: _mock_session_context(None)):
            response = client.patch(
                "/api/paper/trades/TRADE-abc",
                json={"notes": "test"},
                headers=auth_headers,
            )
        assert response.status_code == 404

    def test_patch_with_nonexistent_trade_id(self, client, auth_headers):
        with patch("api.paper.history.SessionLocal", lambda: _mock_session_context(None)):
            response = client.patch(
                "/api/paper/trades/TRADE-999999",
                json={"notes": "test"},
                headers=auth_headers,
            )
        assert response.status_code == 404

    def test_patch_with_only_notes(self, client, auth_headers, sample_trade):
        with patch("api.paper.history.SessionLocal", lambda: _mock_session_context(sample_trade)):
            response = client.patch(
                "/api/paper/trades/TRADE-000001",
                json={"notes": "updated notes"},
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["notes"] == "updated notes"
        assert data["reason"] == ""

    def test_patch_with_empty_body(self, client, auth_headers, sample_trade):
        with patch("api.paper.history.SessionLocal", lambda: _mock_session_context(sample_trade)):
            response = client.patch(
                "/api/paper/trades/TRADE-000001",
                json={},
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["notes"] == ""
        assert data["reason"] == ""

    def test_patch_with_notes_exceeding_500_chars(self, client, auth_headers):
        long_notes = "x" * 501
        response = client.patch(
            "/api/paper/trades/TRADE-000001",
            json={"notes": long_notes},
            headers=auth_headers,
        )
        assert response.status_code == 422
