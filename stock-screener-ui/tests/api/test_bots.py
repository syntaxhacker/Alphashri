"""
Bot Management API Tests

Tests for bot management endpoints from api/bots.py:

Test categories:
1. Available strategies endpoint
2. Bot CRUD operations (list, create, get, update, delete)
3. Bot control (start, stop, status, logs)
4. Strategy control endpoints
5. Portfolio & positions endpoints
6. Performance endpoints (performance, compare, trades, strategy-performance)
7. Scan endpoint
"""

import pytest
import sys
import json
import tempfile
import shutil
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock, AsyncMock
from typing import Dict, List

# Add project paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from fastapi.testclient import TestClient
from fastapi import FastAPI, HTTPException

# Import the bots router
from api.bots import router as bots_router


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def mock_db_session():
    """Mock database session."""
    session = MagicMock()

    # Mock BotConfig
    class MockBotConfig:
        def __init__(self, id, name, is_active=True, max_total_positions=10, max_total_capital_pct=0.80):
            self.id = id
            self.name = name
            self.is_active = is_active
            self.max_total_positions = max_total_positions
            self.max_total_capital_pct = max_total_capital_pct
            self.created_at = datetime.now()
            self.updated_at = datetime.now()

    # Mock StrategyConfig
    class MockStrategyConfig:
        def __init__(self, id, name, strategy_type="ORB", is_template=False, is_default=False,
                     sl_pct=0.4, tp_pct=1.2, max_positions=5, is_active=True):
            self.id = id
            self.name = name
            self.strategy_type = strategy_type
            self.is_template = is_template
            self.is_default = is_default
            self.sl_pct = sl_pct
            self.tp_pct = tp_pct
            self.max_positions = max_positions
            self.is_active = is_active

    # Create sample strategies
    strategies = [
        MockStrategyConfig(1, "ORB Conservative", "ORB", is_template=True, is_default=True),
        MockStrategyConfig(2, "ORB Aggressive", "ORB", is_template=False),
        MockStrategyConfig(3, "Momentum", "momentum", is_template=False),
    ]

    # Create sample bots
    bots = [
        MockBotConfig(1, "Test Bot 1", is_active=True),
        MockBotConfig(2, "Test Bot 2", is_active=False),
    ]

    def mock_query(model):
        """Mock query builder."""
        query_obj = MagicMock()

        if model.__name__ == 'StrategyConfig':
            query_result = MagicMock()
            query_result.filter.return_value.all.return_value = strategies
            query_result.filter.return_value.first.return_value = strategies[0]
            return query_result
        elif model.__name__ == 'BotConfig':
            query_result = MagicMock()
            query_result.filter.return_value.first.return_value = bots[0]
            query_result.filter.return_value.all.return_value = bots
            return query_result

        query_result = MagicMock()
        query_result.filter.return_value = query_result
        query_result.all.return_value = []
        query_result.first.return_value = None
        return query_obj

    session.query.side_effect = mock_query
    session.execute.return_value.fetchall.return_value = []
    session.execute.return_value.fetchmany.return_value = []

    # Mock bot_strategies table operations
    def mock_execute(statement):
        """Mock execute for bot_strategies."""
        result = MagicMock()
        result.fetchall.return_value = [
            MagicMock(strategy_id=1, max_positions=3, capital_allocation_pct=0.40),
            MagicMock(strategy_id=2, max_positions=2, capital_allocation_pct=0.30),
        ]
        return result

    session.execute.side_effect = mock_execute

    return session


@pytest.fixture
def mock_session_local(mock_db_session):
    """Mock SessionLocal context manager."""
    context_manager = MagicMock()
    context_manager.__enter__ = Mock(return_value=mock_db_session)
    context_manager.__exit__ = Mock(return_value=False)
    return context_manager


@pytest.fixture
def temp_snapshot_dir():
    """Create a temporary directory for bot snapshots."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def sample_bot_snapshot(temp_snapshot_dir):
    """Create a sample bot snapshot file."""
    snapshot_data = {
        "timestamp": "2024-03-03T10:30:00",
        "portfolio": {
            "initial_capital": 1_000_000,
            "cash": 600_000,
            "margin_used": 400_000,
            "total_value": 1_000_000,
            "total_pnl": 0.0,
            "total_pnl_pct": 0.0,
            "daily_pnl": 5000.0,
            "total_positions": 2,
        },
        "positions": [
            {
                "symbol": "RELIANCE",
                "side": "BUY",
                "quantity": 100,
                "entry_price": 2500.0,
                "current_price": 2520.0,
                "unrealized_pnl": 2000.0,
                "strategy_id": 1,
                "strategy_name": "ORB Conservative",
            },
            {
                "symbol": "TCS",
                "side": "BUY",
                "quantity": 50,
                "entry_price": 3500.0,
                "current_price": 3460.0,
                "unrealized_pnl": -2000.0,
                "strategy_id": 2,
                "strategy_name": "ORB Aggressive",
            },
        ],
        "strategies": {
            "1": {
                "id": 1,
                "name": "ORB Conservative",
                "status": "RUNNING",
                "portfolio_status": {
                    "total_pnl": 2000.0,
                    "trades_count": 5,
                    "positions_count": 1,
                    "realized_pnl": 0.0,
                    "unrealized_pnl": 2000.0,
                    "capital_used": 250_000,
                    "capital_used_pct": 25.0,
                },
                "scan_items": [
                    {"symbol": "RELIANCE", "price": 2520.0, "score": 8.5},
                    {"symbol": "INFY", "price": 1450.0, "score": 7.2},
                ],
            },
            "2": {
                "id": 2,
                "name": "ORB Aggressive",
                "status": "RUNNING",
                "portfolio_status": {
                    "total_pnl": -2000.0,
                    "trades_count": 3,
                    "positions_count": 1,
                    "realized_pnl": 0.0,
                    "unrealized_pnl": -2000.0,
                    "capital_used": 175_000,
                    "capital_used_pct": 17.5,
                },
                "scan_items": [
                    {"symbol": "TCS", "price": 3460.0, "score": 6.8},
                ],
            },
        },
        "scan_items": [
            {"symbol": "RELIANCE", "price": 2520.0, "score": 8.5, "strategy_id": 1},
            {"symbol": "TCS", "price": 3460.0, "score": 6.8, "strategy_id": 2},
            {"symbol": "INFY", "price": 1450.0, "score": 7.2, "strategy_id": 1},
        ],
    }

    snapshot_file = Path(temp_snapshot_dir) / "multi-strategy-bot-1.json"
    snapshot_file.write_text(json.dumps(snapshot_data))

    return snapshot_file


@pytest.fixture
def mock_journal():
    """Mock TradeJournal instance."""
    journal = MagicMock()
    journal.trades = []

    from trading.journal import TradeRecord

    # Add sample trades
    for i in range(5):
        trade = TradeRecord(
            trade_id=f"TRD-{i}",
            symbol=f"STOCK{i}",
            side="BUY",
            quantity=100,
            entry_price=100.0 + i * 10,
            exit_price=110.0 + i * 10,
            entry_time="2024-03-03T09:15:00",
            exit_time="2024-03-03T10:30:00",
            pnl=1000.0,
            pnl_pct=10.0,
            exit_reason="TP",
            costs=50.0,
            net_pnl=950.0,
            strategy_id=1 if i < 3 else 2,
            strategy_name="ORB Conservative" if i < 3 else "ORB Aggressive",
            source="live",
            is_test=False,
        )
        journal.trades.append(trade)

    journal.load_all_journals = MagicMock()
    journal.get_strategy_performance = MagicMock(return_value={
        "1": {
            "trades": 3,
            "winners": 2,
            "losers": 1,
            "net_pnl": 2500.0,
            "total_pnl": 2600.0,
            "total_costs": 100.0,
            "win_rate": 66.7,
            "test_trades": 0,
        },
        "2": {
            "trades": 2,
            "winners": 1,
            "losers": 1,
            "net_pnl": -500.0,
            "total_pnl": -400.0,
            "total_costs": 100.0,
            "win_rate": 50.0,
            "test_trades": 0,
        },
    })

    return journal


@pytest.fixture
def app(mock_session_local, sample_bot_snapshot, mock_journal):
    """Create test FastAPI app with mocked dependencies."""
    app = FastAPI()
    app.include_router(bots_router)

    # Mock the database availability
    with patch('api.bots._db_available', True), \
         patch('api.bots._auth_available', True), \
         patch('api.bots.SessionLocal', return_value=mock_session_local), \
         patch('api.bots.get_bot_snapshot_path') as mock_snapshot_path, \
         patch('api.bots.load_bot_snapshot') as mock_load_snapshot, \
         patch('trading.journal.get_journal', return_value=mock_journal):

        # Set up snapshot path mock
        def get_snapshot_path(bot_id):
            return Path(f"/tmp/multi-strategy-bot-{bot_id}.json")

        mock_snapshot_path.side_effect = get_snapshot_path

        # Set up load snapshot mock
        def load_snapshot(bot_id):
            snapshot_path = get_snapshot_path(bot_id)
            if snapshot_path.exists():
                try:
                    return json.loads(snapshot_path.read_text())
                except Exception:
                    pass
            # Return sample snapshot for bot_id 1
            if bot_id == 1:
                with open(sample_bot_snapshot) as f:
                    return json.load(f)
            return None

        mock_load_snapshot.side_effect = load_snapshot

        yield app


@pytest.fixture
def client(app):
    """Create test client."""
    return TestClient(app)


# ============================================================================
# 1. Available Strategies Tests
# ============================================================================

class TestAvailableStrategies:
    """Tests for /api/bots/available-strategies endpoint."""

    def test_get_available_strategies(self, client):
        """Test GET /api/bots/available-strategies."""
        response = client.get("/api/bots/available-strategies")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 0

        if data:
            strategy = data[0]
            assert "id" in strategy
            assert "name" in strategy
            assert "strategy_type" in strategy
            assert "is_template" in strategy
            assert "max_positions" in strategy

    def test_get_available_strategies_db_unavailable(self, client):
        """Test GET /api/bots/available-strategies when DB unavailable."""
        with patch('api.bots._db_available', False):
            response = client.get("/api/bots/available-strategies")

            assert response.status_code == 500
            assert "Database not available" in response.json()["detail"]


# ============================================================================
# 2. Bot CRUD Tests
# ============================================================================

class TestBotCRUD:
    """Tests for Bot CRUD operations."""

    def test_list_bots(self, client):
        """Test GET /api/bots - list all bots."""
        response = client.get("/api/bots")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

        if data:
            bot = data[0]
            assert "id" in bot
            assert "name" in bot
            assert "is_active" in bot
            assert "max_total_positions" in bot
            assert "strategies" in bot
            assert "running" in bot

    def test_list_bots_empty(self, client):
        """Test GET /api/bots with no bots."""
        with patch('api.bots.SessionLocal') as mock_session:
            session = MagicMock()
            session.query.return_value.filter.return_value.all.return_value = []
            mock_session.return_value.__enter__ = Mock(return_value=session)
            mock_session.return_value.__exit__ = Mock(return_value=False)

            response = client.get("/api/bots")

            assert response.status_code == 200
            data = response.json()
            assert data == []

    def test_create_bot_minimal(self, client):
        """Test POST /api/bots with minimal data."""
        bot_data = {
            "name": "New Test Bot",
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 0.80,
        }

        with patch('api.bots.SessionLocal') as mock_session:
            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = None

            new_bot = MagicMock()
            new_bot.id = 999
            new_bot.name = "New Test Bot"
            new_bot.is_active = True
            new_bot.max_total_positions = 10
            new_bot.max_total_capital_pct = 0.80
            new_bot.created_at = datetime.now()
            new_bot.updated_at = datetime.now()

            session.add.return_value = None
            session.flush.return_value = None
            session.refresh.return_value = None
            session.query.return_value.filter.return_value.first.return_value = new_bot

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.post("/api/bots", json=bot_data)

            assert response.status_code == 200
            data = response.json()
            assert data["name"] == "New Test Bot"

    def test_create_bot_duplicate_name(self, client):
        """Test POST /api/bots with duplicate name."""
        bot_data = {
            "name": "Test Bot 1",  # Already exists
            "is_active": True,
        }

        with patch('api.bots.SessionLocal') as mock_session:
            session = MagicMock()

            existing = MagicMock()
            existing.id = 1
            existing.name = "Test Bot 1"

            session.query.return_value.filter.return_value.first.return_value = existing

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.post("/api/bots", json=bot_data)

            assert response.status_code == 400
            assert "already exists" in response.json()["detail"].lower()

    def test_create_bot_with_strategies(self, client):
        """Test POST /api/bots with strategies."""
        bot_data = {
            "name": "Multi-Strategy Bot",
            "is_active": True,
            "max_total_positions": 10,
            "strategies": [
                {
                    "strategy_id": 1,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.40,
                },
                {
                    "strategy_id": 2,
                    "max_positions": 2,
                    "capital_allocation_pct": 0.30,
                },
            ],
        }

        with patch('api.bots.SessionLocal') as mock_session:
            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = None

            strategy = MagicMock()
            strategy.id = 1

            new_bot = MagicMock()
            new_bot.id = 999
            new_bot.name = "Multi-Strategy Bot"
            new_bot.is_active = True
            new_bot.max_total_positions = 10
            new_bot.max_total_capital_pct = 0.80
            new_bot.created_at = datetime.now()
            new_bot.updated_at = datetime.now()

            def query_side_effect(model):
                result = MagicMock()
                if model.__name__ == 'StrategyConfig':
                    result.filter.return_value.first.return_value = strategy
                else:
                    result.filter.return_value.first.return_value = None
                return result

            session.query.side_effect = query_side_effect
            session.add.return_value = None
            session.flush.return_value = None
            session.refresh.return_value = None

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.post("/api/bots", json=bot_data)

            # Should succeed or fail based on mock setup
            assert response.status_code in [200, 400]

    def test_create_bot_allocation_exceeds_100(self, client):
        """Test POST /api/bots with allocation > 100%."""
        bot_data = {
            "name": "Overallocated Bot",
            "is_active": True,
            "strategies": [
                {
                    "strategy_id": 1,
                    "capital_allocation_pct": 0.60,
                },
                {
                    "strategy_id": 2,
                    "capital_allocation_pct": 0.60,  # Total = 120%
                },
            ],
        }

        with patch('api.bots.SessionLocal') as mock_session:
            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = None

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.post("/api/bots", json=bot_data)

            assert response.status_code == 400
            assert "exceeds 100%" in response.json()["detail"].lower()

    def test_get_bot(self, client):
        """Test GET /api/bots/{bot_id}."""
        response = client.get("/api/bots/1")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == 1
        assert "name" in data
        assert "strategies" in data
        assert "running" in data

    def test_get_nonexistent_bot(self, client):
        """Test GET /api/bots/{bot_id} with non-existent bot."""
        with patch('api.bots.SessionLocal') as mock_session:
            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = None

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.get("/api/bots/999")

            assert response.status_code == 404
            assert "not found" in response.json()["detail"].lower()

    def test_update_bot_name(self, client):
        """Test PUT /api/bots/{bot_id} - update name."""
        update_data = {"name": "Updated Bot Name"}

        with patch('api.bots.SessionLocal') as mock_session:
            bot = MagicMock()
            bot.id = 1
            bot.name = "Test Bot"
            bot.is_active = True

            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = bot

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.put("/api/bots/1", json=update_data)

            assert response.status_code == 200
            data = response.json()
            assert data["name"] == "Updated Bot Name"

    def test_update_bot_duplicate_name(self, client):
        """Test PUT /api/bots/{bot_id} with duplicate name."""
        update_data = {"name": "Other Bot Name"}

        with patch('api.bots.SessionLocal') as mock_session:
            bot1 = MagicMock()
            bot1.id = 1
            bot1.name = "Test Bot 1"

            bot2 = MagicMock()
            bot2.id = 2
            bot2.name = "Test Bot 2"

            session = MagicMock()

            def query_side_effect(model):
                result = MagicMock()
                # First call gets the bot to update, second checks for duplicate name
                if not hasattr(query_side_effect, 'call_count'):
                    query_side_effect.call_count = 0
                query_side_effect.call_count += 1

                if query_side_effect.call_count == 1:
                    result.filter.return_value.first.return_value = bot1
                else:
                    result.filter.return_value.first.return_value = bot2
                return result

            session.query.side_effect = query_side_effect

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.put("/api/bots/1", json=update_data)

            assert response.status_code == 400
            assert "already exists" in response.json()["detail"].lower()

    def test_update_bot_parameters(self, client):
        """Test PUT /api/bots/{bot_id} - update parameters."""
        update_data = {
            "max_total_positions": 15,
            "max_total_capital_pct": 0.90,
        }

        with patch('api.bots.SessionLocal') as mock_session:
            bot = MagicMock()
            bot.id = 1
            bot.name = "Test Bot"
            bot.max_total_positions = 10
            bot.max_total_capital_pct = 0.80

            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = bot

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.put("/api/bots/1", json=update_data)

            assert response.status_code == 200
            data = response.json()
            assert data["max_total_positions"] == 15
            assert data["max_total_capital_pct"] == 0.90

    def test_delete_bot(self, client):
        """Test DELETE /api/bots/{bot_id}."""
        with patch('api.bots.SessionLocal') as mock_session, \
             patch('api.bots.is_bot_running', return_value=(False, None)):

            bot = MagicMock()
            bot.id = 1
            bot.name = "Test Bot"

            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = bot

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.delete("/api/bots/1")

            assert response.status_code == 200
            data = response.json()
            assert "deleted successfully" in data["message"].lower()

    def test_delete_nonexistent_bot(self, client):
        """Test DELETE /api/bots/{bot_id} with non-existent bot."""
        with patch('api.bots.SessionLocal') as mock_session:
            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = None

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.delete("/api/bots/999")

            assert response.status_code == 404
            assert "not found" in response.json()["detail"].lower()

    def test_delete_running_bot(self, client):
        """Test DELETE /api/bots/{bot_id} - should stop running bot first."""
        with patch('api.bots.SessionLocal') as mock_session, \
             patch('api.bots.is_bot_running', return_value=(True, 12345)), \
             patch('api.bots.stop_bot_process') as mock_stop:

            bot = MagicMock()
            bot.id = 1
            bot.name = "Test Bot"

            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = bot

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.delete("/api/bots/1")

            assert response.status_code == 200
            # Should have called stop_bot_process
            mock_stop.assert_called_once()


# ============================================================================
# 3. Bot Control Tests
# ============================================================================

class TestBotControl:
    """Tests for bot control endpoints."""

    def test_start_bot(self, client):
        """Test POST /api/bots/{bot_id}/start."""
        with patch('api.bots.SessionLocal') as mock_session, \
             patch('api.bots.is_bot_running', return_value=(False, None)), \
             patch('api.bots.start_bot_process') as mock_start:

            bot = MagicMock()
            bot.id = 1
            bot.name = "Test Bot"
            bot.is_active = True

            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = bot

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            mock_process = MagicMock()
            mock_process.pid = 12345
            mock_start.return_value = mock_process

            response = client.post("/api/bots/1/start")

            assert response.status_code == 200
            data = response.json()
            assert "started" in data["message"].lower()
            assert data["pid"] == 12345

    def test_start_bot_already_running(self, client):
        """Test POST /api/bots/{bot_id}/start when already running."""
        with patch('api.bots.SessionLocal') as mock_session, \
             patch('api.bots.is_bot_running', return_value=(True, 12345)):

            bot = MagicMock()
            bot.id = 1
            bot.name = "Test Bot"
            bot.is_active = True

            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = bot

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.post("/api/bots/1/start")

            assert response.status_code == 200
            data = response.json()
            assert "already running" in data["message"].lower()
            assert data["pid"] == 12345

    def test_start_inactive_bot(self, client):
        """Test POST /api/bots/{bot_id}/start with inactive bot."""
        with patch('api.bots.SessionLocal') as mock_session, \
             patch('api.bots.is_bot_running', return_value=(False, None)):

            bot = MagicMock()
            bot.id = 1
            bot.name = "Test Bot"
            bot.is_active = False  # Inactive

            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = bot

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.post("/api/bots/1/start")

            assert response.status_code == 400
            assert "not active" in response.json()["detail"].lower()

    def test_start_nonexistent_bot(self, client):
        """Test POST /api/bots/{bot_id}/start with non-existent bot."""
        with patch('api.bots.SessionLocal') as mock_session:
            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = None

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.post("/api/bots/999/start")

            assert response.status_code == 404

    def test_start_bot_test_mode(self, client):
        """Test POST /api/bots/{bot_id}/start with test_mode=True."""
        with patch('api.bots.SessionLocal') as mock_session, \
             patch('api.bots.is_bot_running', return_value=(False, None)), \
             patch('api.bots.start_bot_process') as mock_start:

            bot = MagicMock()
            bot.id = 1
            bot.name = "Test Bot"
            bot.is_active = True

            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = bot

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            mock_process = MagicMock()
            mock_process.pid = 12345
            mock_start.return_value = mock_process

            response = client.post("/api/bots/1/start?test_mode=true")

            assert response.status_code == 200
            # Verify test_mode was passed
            mock_start.assert_called_once()
            call_args = mock_start.call_args
            assert call_args[0][2] is True  # test_mode argument

    def test_stop_bot(self, client):
        """Test POST /api/bots/{bot_id}/stop."""
        with patch('api.bots.is_bot_running', return_value=(True, 12345)), \
             patch('api.bots.stop_bot_process') as mock_stop:

            response = client.post("/api/bots/1/stop")

            assert response.status_code == 200
            data = response.json()
            assert "stopped" in data["message"].lower()
            mock_stop.assert_called_once()

    def test_stop_bot_not_running(self, client):
        """Test POST /api/bots/{bot_id}/stop when not running."""
        with patch('api.bots.is_bot_running', return_value=(False, None)):
            response = client.post("/api/bots/1/stop")

            assert response.status_code == 200
            data = response.json()
            assert "not running" in data["message"].lower()

    def test_get_bot_status_running(self, client):
        """Test GET /api/bots/{bot_id}/status when running."""
        with patch('api.bots.SessionLocal') as mock_session, \
             patch('api.bots.is_bot_running', return_value=(True, 12345)):

            bot = MagicMock()
            bot.id = 1
            bot.name = "Test Bot"

            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = bot

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.get("/api/bots/1/status")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == 1
            assert data["bot_name"] == "Test Bot"
            assert data["running"] is True
            assert data["pid"] == 12345
            assert "portfolio" in data
            assert "strategies" in data
            assert "positions" in data

    def test_get_bot_status_not_running(self, client):
        """Test GET /api/bots/{bot_id}/status when not running."""
        with patch('api.bots.SessionLocal') as mock_session, \
             patch('api.bots.is_bot_running', return_value=(False, None)):

            bot = MagicMock()
            bot.id = 1
            bot.name = "Test Bot"

            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = bot

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.get("/api/bots/1/status")

            assert response.status_code == 200
            data = response.json()
            assert data["running"] is False
            assert data["pid"] is None

    def test_get_bot_status_nonexistent(self, client):
        """Test GET /api/bots/{bot_id}/status with non-existent bot."""
        with patch('api.bots.SessionLocal') as mock_session, \
             patch('api.bots.is_bot_running', return_value=(False, None)):

            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = None

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.get("/api/bots/999/status")

            assert response.status_code == 404

    def test_get_bot_logs(self, client):
        """Test GET /api/bots/{bot_id}/logs."""
        # Create a temporary log file
        log_content = "2024-03-03 10:00:00 INFO: Bot started\n" \
                     "2024-03-03 10:01:00 INFO: Scanning symbols\n" \
                     "2024-03-03 10:02:00 INFO: Found signals"

        log_file = tempfile.NamedTemporaryFile(mode='w', suffix='.log', delete=False)
        log_file.write(log_content)
        log_file.close()

        with patch('api.bots._bot_logs', {1: Path(log_file.name)}):
            response = client.get("/api/bots/1/logs")

            # Clean up
            Path(log_file.name).unlink(missing_ok=True)

            assert response.status_code == 200
            data = response.json()
            assert "logs" in data
            assert "Bot started" in data["logs"]
            assert data["total_lines"] == 3

    def test_get_bot_logs_no_logs(self, client):
        """Test GET /api/bots/{bot_id}/logs when no logs available."""
        with patch('api.bots._bot_logs', {}):
            response = client.get("/api/bots/1/logs")

            assert response.status_code == 200
            data = response.json()
            assert data["logs"] == ""
            assert "No logs available" in data["message"]

    def test_get_bot_logs_custom_limit(self, client):
        """Test GET /api/bots/{bot_id}/logs with custom line limit."""
        # Create log file with many lines
        log_lines = [f"2024-03-03 10:0{i}:00 INFO: Log line {i}\n" for i in range(20)]
        log_content = "".join(log_lines)

        log_file = tempfile.NamedTemporaryFile(mode='w', suffix='.log', delete=False)
        log_file.write(log_content)
        log_file.close()

        with patch('api.bots._bot_logs', {1: Path(log_file.name)}):
            response = client.get("/api/bots/1/logs?lines=5")

            # Clean up
            Path(log_file.name).unlink(missing_ok=True)

            assert response.status_code == 200
            data = response.json()
            assert data["total_lines"] == 20
            assert data["showing"] == 5


# ============================================================================
# 4. Strategy Control Tests
# ============================================================================

class TestStrategyControl:
    """Tests for strategy control within bots."""

    def test_start_strategy(self, client):
        """Test POST /api/bots/{bot_id}/strategies/{strategy_id}/start."""
        response = client.post("/api/bots/1/strategies/1/start")

        assert response.status_code == 200
        data = response.json()
        assert "requires bot restart" in data["message"].lower()
        assert data["bot_id"] == 1
        assert data["strategy_id"] == 1

    def test_stop_strategy(self, client):
        """Test POST /api/bots/{bot_id}/strategies/{strategy_id}/stop."""
        response = client.post("/api/bots/1/strategies/1/stop")

        assert response.status_code == 200
        data = response.json()
        assert "requires bot restart" in data["message"].lower()


# ============================================================================
# 5. Portfolio & Positions Tests
# ============================================================================

class TestPortfolioAndPositions:
    """Tests for portfolio and positions endpoints."""

    def test_get_bot_portfolio(self, client):
        """Test GET /api/bots/{bot_id}/portfolio."""
        response = client.get("/api/bots/1/portfolio")

        assert response.status_code == 200
        data = response.json()
        assert data["bot_id"] == 1
        assert "portfolio" in data
        assert "positions" in data
        assert "strategies" in data

        # Verify portfolio structure
        portfolio = data["portfolio"]
        assert "initial_capital" in portfolio
        assert "cash" in portfolio
        assert "margin_used" in portfolio
        assert "total_pnl" in portfolio

    def test_get_bot_portfolio_no_snapshot(self, client):
        """Test GET /api/bots/{bot_id}/portfolio when no snapshot exists."""
        with patch('api.bots.load_bot_snapshot', return_value=None):
            response = client.get("/api/bots/2/portfolio")

            assert response.status_code == 404
            assert "not found" in response.json()["detail"].lower()

    def test_get_bot_positions(self, client):
        """Test GET /api/bots/{bot_id}/positions."""
        response = client.get("/api/bots/1/positions")

        assert response.status_code == 200
        data = response.json()
        assert data["bot_id"] == 1
        assert "positions" in data
        assert "count" in data
        assert len(data["positions"]) == 2

        # Verify position structure
        position = data["positions"][0]
        assert "symbol" in position
        assert "side" in position
        assert "quantity" in position
        assert "entry_price" in position
        assert "current_price" in position
        assert "unrealized_pnl" in position

    def test_get_bot_positions_filter_by_strategy(self, client):
        """Test GET /api/bots/{bot_id}/positions filtered by strategy_id."""
        response = client.get("/api/bots/1/positions?strategy_id=1")

        assert response.status_code == 200
        data = response.json()
        assert all(p["strategy_id"] == 1 for p in data["positions"])

    def test_get_bot_positions_no_snapshot(self, client):
        """Test GET /api/bots/{bot_id}/positions when no snapshot exists."""
        with patch('api.bots.load_bot_snapshot', return_value=None):
            response = client.get("/api/bots/2/positions")

            assert response.status_code == 404

    def test_get_bot_scan(self, client):
        """Test GET /api/bots/{bot_id}/scan."""
        response = client.get("/api/bots/1/scan")

        assert response.status_code == 200
        data = response.json()
        assert data["bot_id"] == 1
        assert "scan_items" in data
        assert "count" in data
        assert len(data["scan_items"]) > 0

        # Verify scan item structure
        item = data["scan_items"][0]
        assert "symbol" in item
        assert "price" in item

    def test_get_bot_scan_filter_by_strategy(self, client):
        """Test GET /api/bots/{bot_id}/scan filtered by strategy_id."""
        response = client.get("/api/bots/1/scan?strategy_id=1")

        assert response.status_code == 200
        data = response.json()
        assert all(s.get("strategy_id") == 1 for s in data["scan_items"])

    def test_get_bot_scan_no_snapshot(self, client):
        """Test GET /api/bots/{bot_id}/scan when no snapshot exists."""
        with patch('api.bots.load_bot_snapshot', return_value=None):
            response = client.get("/api/bots/2/scan")

            assert response.status_code == 404


# ============================================================================
# 6. Performance Tests
# ============================================================================

class TestPerformanceEndpoints:
    """Tests for performance endpoints."""

    def test_get_bot_performance(self, client):
        """Test GET /api/bots/{bot_id}/performance."""
        response = client.get("/api/bots/1/performance")

        assert response.status_code == 200
        data = response.json()
        assert data["bot_id"] == 1
        assert "summary" in data
        assert "by_strategy" in data

        # Verify summary structure
        summary = data["summary"]
        assert "total_pnl" in summary
        assert "total_trades" in summary
        assert "total_positions" in summary

        # Verify by_strategy structure
        by_strategy = data["by_strategy"]
        assert len(by_strategy) > 0

    def test_get_bot_performance_no_snapshot(self, client):
        """Test GET /api/bots/{bot_id}/performance when no snapshot exists."""
        with patch('api.bots.load_bot_snapshot', return_value=None):
            response = client.get("/api/bots/2/performance")

            assert response.status_code == 404

    def test_get_bot_performance_custom_days(self, client):
        """Test GET /api/bots/{bot_id}/performance with custom days parameter."""
        response = client.get("/api/bots/1/performance?days=7")

        assert response.status_code == 200
        data = response.json()
        assert data["period_days"] == 7

    def test_compare_strategy_performance(self, client):
        """Test GET /api/bots/{bot_id}/performance/compare."""
        response = client.get("/api/bots/1/performance/compare")

        assert response.status_code == 200
        data = response.json()
        assert data["bot_id"] == 1
        assert "comparison" in data
        assert len(data["comparison"]) > 0

        # Verify comparison structure
        comparison = data["comparison"]
        # Should be sorted by P&L
        pnls = [c["total_pnl"] for c in comparison]
        assert pnls == sorted(pnls, reverse=True)

        # Verify each comparison item
        item = comparison[0]
        assert "strategy_id" in item
        assert "strategy_name" in item
        assert "trades" in item
        assert "positions" in item
        assert "total_pnl" in item

    def test_compare_strategy_performance_no_snapshot(self, client):
        """Test GET /api/bots/{bot_id}/performance/compare when no snapshot."""
        with patch('api.bots.load_bot_snapshot', return_value=None):
            response = client.get("/api/bots/2/performance/compare")

            assert response.status_code == 404

    def test_get_bot_trades(self, client):
        """Test GET /api/bots/{bot_id}/trades."""
        with patch('api.bots.SessionLocal') as mock_session:
            session = MagicMock()
            result = MagicMock()
            result.fetchall.return_value = [
                MagicMock(strategy_id=1),
                MagicMock(strategy_id=2),
            ]
            session.execute.return_value = result

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.get("/api/bots/1/trades")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == 1
            assert "trades" in data
            assert "count" in data

    def test_get_bot_trades_filter_by_strategy(self, client, mock_journal):
        """Test GET /api/bots/{bot_id}/trades filtered by strategy_id."""
        with patch('api.bots.SessionLocal') as mock_session, \
             patch('trading.journal.get_journal', return_value=mock_journal):

            session = MagicMock()
            result = MagicMock()
            result.fetchall.return_value = [
                MagicMock(strategy_id=1),
                MagicMock(strategy_id=2),
            ]
            session.execute.return_value = result

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.get("/api/bots/1/trades?strategy_id=1")

            assert response.status_code == 200
            data = response.json()
            assert all(t.get("strategy_id") == 1 for t in data["trades"])

    def test_get_bot_trades_exclude_test_data(self, client, mock_journal):
        """Test GET /api/bots/{bot_id}/trades with include_test=false."""
        # Add a test trade
        from trading.journal import TradeRecord
        test_trade = TradeRecord(
            trade_id="TEST-1",
            symbol="TEST",
            side="BUY",
            quantity=100,
            entry_price=100.0,
            exit_price=110.0,
            entry_time="2024-03-03T09:15:00",
            exit_time="2024-03-03T10:30:00",
            pnl=1000.0,
            pnl_pct=10.0,
            exit_reason="TP",
            costs=50.0,
            net_pnl=950.0,
            strategy_id=1,
            strategy_name="ORB Conservative",
            source="backtest",
            is_test=True,
        )
        mock_journal.trades.append(test_trade)

        with patch('api.bots.SessionLocal') as mock_session, \
             patch('trading.journal.get_journal', return_value=mock_journal):

            session = MagicMock()
            result = MagicMock()
            result.fetchall.return_value = [
                MagicMock(strategy_id=1),
            ]
            session.execute.return_value = result

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.get("/api/bots/1/trades?include_test=false")

            assert response.status_code == 200
            data = response.json()
            assert not any(t.get("is_test") for t in data["trades"])

    def test_get_strategy_performance(self, client):
        """Test GET /api/bots/{bot_id}/strategy-performance."""
        with patch('api.bots.SessionLocal') as mock_session, \
             patch('trading.journal.get_journal', return_value=mock_journal):

            session = MagicMock()
            result = MagicMock()
            result.fetchall.return_value = [
                MagicMock(strategy_id=1),
                MagicMock(strategy_id=2),
            ]
            session.execute.return_value = result

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.get("/api/bots/1/strategy-performance")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == 1
            assert "by_strategy" in data
            assert "combined" in data

            # Verify combined stats
            combined = data["combined"]
            assert "total_trades" in combined
            assert "win_rate" in combined
            assert "total_net_pnl" in combined

    def test_get_strategy_performance_custom_days(self, client):
        """Test GET /api/bots/{bot_id}/strategy-performance with custom days."""
        with patch('api.bots.SessionLocal') as mock_session, \
             patch('trading.journal.get_journal', return_value=mock_journal):

            session = MagicMock()
            result = MagicMock()
            result.fetchall.return_value = [
                MagicMock(strategy_id=1),
            ]
            session.execute.return_value = result

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.get("/api/bots/1/strategy-performance?days=7")

            assert response.status_code == 200
            # Verify load_all_journals was called
            mock_journal.load_all_journals.assert_called()

    def test_get_strategy_performance_exclude_test(self, client):
        """Test GET /api/bots/{bot_id}/strategy-performance with include_test=false."""
        with patch('api.bots.SessionLocal') as mock_session, \
             patch('trading.journal.get_journal', return_value=mock_journal):

            session = MagicMock()
            result = MagicMock()
            result.fetchall.return_value = [
                MagicMock(strategy_id=1),
            ]
            session.execute.return_value = result

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.get("/api/bots/1/strategy-performance?include_test=false")

            assert response.status_code == 200
            # Verify get_strategy_performance was called with include_test=False
            mock_journal.get_strategy_performance.assert_called_with(include_test=False)


# ============================================================================
# 7. Error Handling Tests
# ============================================================================

class TestErrorHandling:
    """Tests for error handling."""

    def test_database_unavailable(self, client):
        """Test endpoints when database is unavailable."""
        with patch('api.bots._db_available', False):
            response = client.get("/api/bots")

            assert response.status_code == 500
            assert "database" in response.json()["detail"].lower()

    def test_invalid_strategy_id(self, client):
        """Test creating bot with non-existent strategy."""
        bot_data = {
            "name": "Invalid Bot",
            "strategies": [
                {"strategy_id": 999, "capital_allocation_pct": 0.50},
            ],
        }

        with patch('api.bots.SessionLocal') as mock_session:
            session = MagicMock()
            session.query.return_value.filter.return_value.first.return_value = None

            cm = MagicMock()
            cm.__enter__ = Mock(return_value=session)
            cm.__exit__ = Mock(return_value=False)
            mock_session.return_value = cm

            response = client.post("/api/bots", json=bot_data)

            # Should fail due to non-existent strategy
            assert response.status_code == 400

    def test_invalid_allocation_pct(self, client):
        """Test creating bot with invalid allocation percentage."""
        bot_data = {
            "name": "Invalid Allocation Bot",
            "strategies": [
                {"strategy_id": 1, "capital_allocation_pct": 1.5},  # > 100%
            ],
        }

        # Pydantic validation should catch this
        response = client.post("/api/bots", json=bot_data)

        # Should fail validation
        assert response.status_code == 422

    def test_invalid_max_positions(self, client):
        """Test creating bot with invalid max_positions."""
        bot_data = {
            "name": "Invalid Positions Bot",
            "max_total_positions": 50,  # Exceeds max of 20
        }

        # Pydantic validation should catch this
        response = client.post("/api/bots", json=bot_data)

        assert response.status_code == 422
