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

Integration tests use fixtures from conftest.py:
- client_with_db: TestClient with real database
- test_user: User fixture
- test_bot: BotConfig fixture
- test_strategy: StrategyConfig fixture
- sample_bot_data: Sample bot creation data
"""

import pytest
import sys
import json
import uuid as uuid_module
import tempfile
import shutil
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock
from typing import Dict, List

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from fastapi.testclient import TestClient
from fastapi import FastAPI

from api.bots import router as bots_router


# ============================================================================
# Unit Test Fixtures (for tests that use mocks)
# ============================================================================

@pytest.fixture
def mock_db_session():
    """Mock database session for unit tests."""
    session = MagicMock()

    class MockBotConfig:
        def __init__(self, id, name, is_active=True, max_total_positions=10, max_total_capital_pct=0.80):
            self.id = id
            self.uuid = str(uuid_module.uuid4())
            self.name = name
            self.is_active = is_active
            self.max_total_positions = max_total_positions
            self.max_total_capital_pct = max_total_capital_pct
            self.created_at = datetime.now()
            self.updated_at = datetime.now()

    class MockStrategyConfig:
        def __init__(self, id, name, strategy_type="ORB", is_template=False, is_default=False,
                     sl_pct=0.4, tp_pct=1.2, max_positions=5, is_active=True):
            self.id = id
            self.uuid = str(uuid_module.uuid4())
            self.name = name
            self.strategy_type = strategy_type
            self.is_template = is_template
            self.is_default = is_default
            self.sl_pct = sl_pct
            self.tp_pct = tp_pct
            self.max_positions = max_positions
            self.is_active = is_active

    strategies = [
        MockStrategyConfig(1, "ORB Conservative", "ORB", is_template=True, is_default=True),
        MockStrategyConfig(2, "ORB Aggressive", "ORB", is_template=False),
        MockStrategyConfig(3, "Momentum", "momentum", is_template=False),
    ]

    bots = [
        MockBotConfig(1, "Test Bot 1", is_active=True),
        MockBotConfig(2, "Test Bot 2", is_active=False),
    ]

    def mock_query(model):
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

    def mock_execute(statement):
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
    """Create test FastAPI app with mocked dependencies for unit tests."""
    app = FastAPI()
    app.include_router(bots_router)

    with patch('api.bots._db_available', True), \
         patch('api.bots._auth_available', True), \
         patch('api.bots.SessionLocal', return_value=mock_session_local), \
         patch('api.bots.get_bot_snapshot_path') as mock_snapshot_path, \
         patch('api.bots.load_bot_snapshot') as mock_load_snapshot, \
         patch('trading.journal.get_journal', return_value=mock_journal):

        def get_snapshot_path(bot_id, user_id=0):
            return Path(f"/tmp/multi-strategy-bot-{user_id}-{bot_id}.json")

        mock_snapshot_path.side_effect = get_snapshot_path

        def load_snapshot(bot_id, user_id=0):
            snapshot_path = get_snapshot_path(bot_id, user_id)
            if snapshot_path.exists():
                try:
                    return json.loads(snapshot_path.read_text())
                except Exception:
                    pass
            if bot_id == 1:
                with open(sample_bot_snapshot) as f:
                    return json.load(f)
            return None

        mock_load_snapshot.side_effect = load_snapshot

        yield app


@pytest.fixture
def client(app):
    """Create test client for unit tests."""
    return TestClient(app)


# ============================================================================
# 1. Available Strategies Tests
# ============================================================================

class TestAvailableStrategies:
    """Tests for /api/bots/available-strategies endpoint."""

    @pytest.mark.integration
    def test_get_available_strategies(self, client_with_db, test_strategy):
        """Test GET /api/bots/available-strategies."""
        response = client_with_db.get("/api/bots/available-strategies")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1

        strategy = data[0]
        assert "id" in strategy
        assert "name" in strategy
        assert "strategy_type" in strategy
        assert "is_template" in strategy
        assert "max_positions" in strategy

    @pytest.mark.unit
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

    @pytest.mark.integration
    def test_list_bots(self, client_with_db, test_bot):
        """Test GET /api/bots - list all bots."""
        response = client_with_db.get("/api/bots")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1

        bot = data[0]
        assert "id" in bot
        assert "uuid" in bot
        assert "name" in bot
        assert "is_active" in bot
        assert "max_total_positions" in bot
        assert "strategies" in bot
        assert "status" in bot

    @pytest.mark.integration
    def test_list_bots_empty(self, client_with_db):
        """Test GET /api/bots with no bots (still lists the test_bot from fixture)."""
        response = client_with_db.get("/api/bots")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    @pytest.mark.integration
    def test_create_bot_minimal(self, client_with_db, sample_bot_data):
        """Test POST /api/bots with minimal data."""
        response = client_with_db.post("/api/bots", json=sample_bot_data)

        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["name"] == sample_bot_data["name"]
        assert data["is_active"] == sample_bot_data["is_active"]

    @pytest.mark.integration
    def test_create_bot_duplicate_name(self, client_with_db, test_bot):
        """Test POST /api/bots with duplicate name."""
        bot_data = {
            "name": test_bot.name,
            "is_active": True,
        }

        response = client_with_db.post("/api/bots", json=bot_data)

        assert response.status_code == 400
        assert "already exists" in response.json()["detail"].lower()

    @pytest.mark.integration
    def test_create_bot_with_strategies(self, client_with_db, test_strategy):
        """Test POST /api/bots with strategies."""
        bot_data = {
            "name": f"Multi-Strategy Bot {uuid_module.uuid4()}",
            "is_active": True,
            "max_total_positions": 10,
            "strategies": [
                {
                    "strategy_id": test_strategy.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.40,
                },
            ],
        }

        response = client_with_db.post("/api/bots", json=bot_data)

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == bot_data["name"]
        assert len(data["strategies"]) == 1

    @pytest.mark.integration
    def test_create_bot_allocation_exceeds_100(self, client_with_db, test_strategy):
        """Test POST /api/bots with allocation > 100%."""
        bot_data = {
            "name": f"Overallocated Bot {uuid_module.uuid4()}",
            "is_active": True,
            "strategies": [
                {
                    "strategy_id": test_strategy.uuid,
                    "capital_allocation_pct": 0.60,
                },
                {
                    "strategy_id": test_strategy.uuid,
                    "capital_allocation_pct": 0.60,
                },
            ],
        }

        response = client_with_db.post("/api/bots", json=bot_data)

        assert response.status_code == 400
        assert "exceeds 100%" in response.json()["detail"].lower()

    @pytest.mark.integration
    def test_get_bot(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}."""
        response = client_with_db.get(f"/api/bots/{test_bot.uuid}")

        assert response.status_code == 200
        data = response.json()
        assert data["uuid"] == test_bot.uuid
        assert "name" in data
        assert "strategies" in data
        assert "status" in data

    @pytest.mark.integration
    def test_get_nonexistent_bot(self, client_with_db):
        """Test GET /api/bots/{bot_id} with non-existent bot."""
        fake_uuid = str(uuid_module.uuid4())
        response = client_with_db.get(f"/api/bots/{fake_uuid}")

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    @pytest.mark.integration
    def test_update_bot_name(self, client_with_db, test_bot):
        """Test PUT /api/bots/{bot_id} - update name."""
        update_data = {"name": f"Updated Bot Name {uuid_module.uuid4()}"}

        response = client_with_db.put(f"/api/bots/{test_bot.uuid}", json=update_data)

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == update_data["name"]

    @pytest.mark.integration
    def test_update_bot_duplicate_name(self, client_with_db, test_bot, test_db):
        """Test PUT /api/bots/{bot_id} with duplicate name."""
        from db.models import BotConfig
        
        other_bot = BotConfig(
            name=f"Other Bot {uuid_module.uuid4()}",
            user_id=test_bot.user_id,
            is_active=True,
        )
        test_db.add(other_bot)
        test_db.commit()
        test_db.refresh(other_bot)

        update_data = {"name": other_bot.name}

        response = client_with_db.put(f"/api/bots/{test_bot.uuid}", json=update_data)

        assert response.status_code == 400
        assert "already exists" in response.json()["detail"].lower()

    @pytest.mark.integration
    def test_update_bot_parameters(self, client_with_db, test_bot):
        """Test PUT /api/bots/{bot_id} - update parameters."""
        update_data = {
            "max_total_positions": 15,
            "max_total_capital_pct": 0.90,
        }

        response = client_with_db.put(f"/api/bots/{test_bot.uuid}", json=update_data)

        assert response.status_code == 200
        data = response.json()
        assert data["max_total_positions"] == 15
        assert data["max_total_capital_pct"] == 0.90

    @pytest.mark.integration
    def test_delete_bot(self, client_with_db, test_db, test_user):
        """Test DELETE /api/bots/{bot_id}."""
        from db.models import BotConfig
        
        bot = BotConfig(
            name=f"Bot to Delete {uuid_module.uuid4()}",
            user_id=test_user.id,
            is_active=True,
        )
        test_db.add(bot)
        test_db.commit()
        test_db.refresh(bot)

        with patch('api.bots.is_bot_running', return_value=(False, None)):
            response = client_with_db.delete(f"/api/bots/{bot.uuid}")

            assert response.status_code == 200
            data = response.json()
            assert "deleted successfully" in data["message"].lower()

    @pytest.mark.integration
    def test_delete_nonexistent_bot(self, client_with_db):
        """Test DELETE /api/bots/{bot_id} with non-existent bot."""
        fake_uuid = str(uuid_module.uuid4())
        response = client_with_db.delete(f"/api/bots/{fake_uuid}")

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    @pytest.mark.integration
    def test_delete_running_bot(self, client_with_db, test_db, test_user):
        """Test DELETE /api/bots/{bot_id} - should stop running bot first."""
        from db.models import BotConfig
        
        bot = BotConfig(
            name=f"Running Bot {uuid_module.uuid4()}",
            user_id=test_user.id,
            is_active=True,
        )
        test_db.add(bot)
        test_db.commit()
        test_db.refresh(bot)

        with patch('api.bots.is_bot_running', return_value=(True, 12345)), \
             patch('api.bots.stop_bot_process') as mock_stop:

            response = client_with_db.delete(f"/api/bots/{bot.uuid}")

            assert response.status_code == 200
            mock_stop.assert_called_once()


# ============================================================================
# 3. Bot Control Tests
# ============================================================================

class TestBotControl:
    """Tests for bot control endpoints."""

    @pytest.mark.integration
    def test_start_bot(self, client_with_db, test_bot):
        """Test POST /api/bots/{bot_id}/start."""
        with patch('api.bots.is_bot_running', return_value=(False, None)), \
             patch('api.bots.start_bot_process') as mock_start:

            mock_process = MagicMock()
            mock_process.pid = 12345
            mock_start.return_value = mock_process

            response = client_with_db.post(f"/api/bots/{test_bot.uuid}/start")

            assert response.status_code == 200
            data = response.json()
            assert "started" in data["message"].lower()
            assert data["pid"] == 12345

    @pytest.mark.integration
    def test_start_bot_already_running(self, client_with_db, test_bot):
        """Test POST /api/bots/{bot_id}/start when already running."""
        with patch('api.bots.is_bot_running', return_value=(True, 12345)):

            response = client_with_db.post(f"/api/bots/{test_bot.uuid}/start")

            assert response.status_code == 200
            data = response.json()
            assert "already running" in data["message"].lower()
            assert data["pid"] == 12345

    @pytest.mark.integration
    def test_start_inactive_bot(self, client_with_db, test_db, test_user):
        """Test POST /api/bots/{bot_id}/start with inactive bot."""
        from db.models import BotConfig
        
        bot = BotConfig(
            name=f"Inactive Bot {uuid_module.uuid4()}",
            user_id=test_user.id,
            is_active=False,
        )
        test_db.add(bot)
        test_db.commit()
        test_db.refresh(bot)

        with patch('api.bots.is_bot_running', return_value=(False, None)):

            response = client_with_db.post(f"/api/bots/{bot.uuid}/start")

            assert response.status_code == 400
            assert "not active" in response.json()["detail"].lower()

    @pytest.mark.integration
    def test_start_nonexistent_bot(self, client_with_db):
        """Test POST /api/bots/{bot_id}/start with non-existent bot."""
        fake_uuid = str(uuid_module.uuid4())
        response = client_with_db.post(f"/api/bots/{fake_uuid}/start")

        assert response.status_code == 404

    @pytest.mark.integration
    def test_start_bot_test_mode(self, client_with_db, test_bot):
        """Test POST /api/bots/{bot_id}/start with test_mode=True."""
        with patch('api.bots.is_bot_running', return_value=(False, None)), \
             patch('api.bots.start_bot_process') as mock_start:

            mock_process = MagicMock()
            mock_process.pid = 12345
            mock_start.return_value = mock_process

            response = client_with_db.post(f"/api/bots/{test_bot.uuid}/start?test_mode=true")

            assert response.status_code == 200
            mock_start.assert_called_once()
            call_args = mock_start.call_args
            assert call_args[0][2] is True

    @pytest.mark.integration
    def test_stop_bot(self, client_with_db, test_bot):
        """Test POST /api/bots/{bot_id}/stop."""
        with patch('api.bots.is_bot_running', return_value=(True, 12345)), \
             patch('api.bots.stop_bot_process') as mock_stop:

            response = client_with_db.post(f"/api/bots/{test_bot.uuid}/stop")

            assert response.status_code == 200
            data = response.json()
            assert "stopped" in data["message"].lower()
            mock_stop.assert_called_once()

    @pytest.mark.integration
    def test_stop_bot_not_running(self, client_with_db, test_bot):
        """Test POST /api/bots/{bot_id}/stop when not running."""
        with patch('api.bots.is_bot_running', return_value=(False, None)):
            response = client_with_db.post(f"/api/bots/{test_bot.uuid}/stop")

            assert response.status_code == 200
            data = response.json()
            assert "not running" in data["message"].lower()

    @pytest.mark.integration
    def test_get_bot_status_running(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/status when running."""
        with patch('api.bots.is_bot_running', return_value=(True, 12345)), \
             patch('api.bots.load_bot_snapshot', return_value=None):

            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/status")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == test_bot.uuid
            assert data["bot_name"] == test_bot.name
            assert data["running"] is True
            assert data["pid"] == 12345

    @pytest.mark.integration
    def test_get_bot_status_not_running(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/status when not running."""
        with patch('api.bots.is_bot_running', return_value=(False, None)), \
             patch('api.bots.load_bot_snapshot', return_value=None):

            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/status")

            assert response.status_code == 200
            data = response.json()
            assert data["running"] is False
            assert data["pid"] is None

    @pytest.mark.integration
    def test_get_bot_status_nonexistent(self, client_with_db):
        """Test GET /api/bots/{bot_id}/status with non-existent bot."""
        with patch('api.bots.is_bot_running', return_value=(False, None)):
            fake_uuid = str(uuid_module.uuid4())
            response = client_with_db.get(f"/api/bots/{fake_uuid}/status")

            assert response.status_code == 404

    @pytest.mark.integration
    def test_get_bot_logs(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/logs."""
        log_content = "2024-03-03 10:00:00 INFO: Bot started\n" \
                     "2024-03-03 10:01:00 INFO: Scanning symbols\n" \
                     "2024-03-03 10:02:00 INFO: Found signals"

        log_file = tempfile.NamedTemporaryFile(mode='w', suffix='.log', delete=False)
        log_file.write(log_content)
        log_file.close()

        with patch('api.bots._bot_logs', {test_bot.id: Path(log_file.name)}):
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/logs")

            Path(log_file.name).unlink(missing_ok=True)

            assert response.status_code == 200
            data = response.json()
            assert "logs" in data
            assert "Bot started" in data["logs"]
            assert data["total_lines"] == 3

    @pytest.mark.integration
    def test_get_bot_logs_no_logs(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/logs when no logs available."""
        with patch('api.bots._bot_logs', {}):
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/logs")

            assert response.status_code == 200
            data = response.json()
            assert data["logs"] == ""
            assert "No logs available" in data["message"]

    @pytest.mark.integration
    def test_get_bot_logs_custom_limit(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/logs with custom line limit."""
        log_lines = [f"2024-03-03 10:0{i}:00 INFO: Log line {i}\n" for i in range(20)]
        log_content = "".join(log_lines)

        log_file = tempfile.NamedTemporaryFile(mode='w', suffix='.log', delete=False)
        log_file.write(log_content)
        log_file.close()

        with patch('api.bots._bot_logs', {test_bot.id: Path(log_file.name)}):
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/logs?lines=5")

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

    @pytest.mark.integration
    def test_start_strategy(self, client_with_db, test_bot, test_strategy):
        """Test POST /api/bots/{bot_id}/strategies/{strategy_id}/start."""
        response = client_with_db.post(
            f"/api/bots/{test_bot.uuid}/strategies/{test_strategy.uuid}/start"
        )

        assert response.status_code == 200
        data = response.json()
        assert "requires bot restart" in data["message"].lower()
        assert data["bot_id"] == test_bot.uuid
        assert data["strategy_id"] == test_strategy.uuid

    @pytest.mark.integration
    def test_stop_strategy(self, client_with_db, test_bot, test_strategy):
        """Test POST /api/bots/{bot_id}/strategies/{strategy_id}/stop."""
        response = client_with_db.post(
            f"/api/bots/{test_bot.uuid}/strategies/{test_strategy.uuid}/stop"
        )

        assert response.status_code == 200
        data = response.json()
        assert "requires bot restart" in data["message"].lower()


# ============================================================================
# 5. Portfolio & Positions Tests
# ============================================================================

class TestPortfolioAndPositions:
    """Tests for portfolio and positions endpoints."""

    @pytest.mark.integration
    def test_get_bot_portfolio(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/portfolio."""
        snapshot = {
            "portfolio": {"initial_capital": 1000000},
            "positions": [],
            "strategies": {},
            "timestamp": datetime.now().isoformat(),
        }
        
        with patch('api.bots.load_bot_snapshot', return_value=snapshot):
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/portfolio")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == test_bot.uuid
            assert "portfolio" in data
            assert "positions" in data
            assert "strategies" in data

    @pytest.mark.integration
    def test_get_bot_portfolio_no_snapshot(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/portfolio when no snapshot exists."""
        with patch('api.bots.load_bot_snapshot', return_value=None):
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/portfolio")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == test_bot.uuid
            assert "portfolio" in data
            assert "positions" in data

    @pytest.mark.integration
    def test_get_bot_positions(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/positions."""
        snapshot = {
            "positions": [
                {
                    "symbol": "RELIANCE",
                    "side": "BUY",
                    "quantity": 100,
                    "entry_price": 2500.0,
                    "current_price": 2520.0,
                    "unrealized_pnl": 2000.0,
                    "strategy_id": 1,
                },
                {
                    "symbol": "TCS",
                    "side": "BUY",
                    "quantity": 50,
                    "entry_price": 3500.0,
                    "current_price": 3460.0,
                    "unrealized_pnl": -2000.0,
                    "strategy_id": 2,
                },
            ]
        }
        
        with patch('api.bots.load_bot_snapshot', return_value=snapshot):
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/positions")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == test_bot.uuid
            assert "positions" in data
            assert "count" in data
            assert len(data["positions"]) == 2

    @pytest.mark.integration
    def test_get_bot_positions_filter_by_strategy(self, client_with_db, test_bot, test_strategy):
        """Test GET /api/bots/{bot_id}/positions filtered by strategy_id."""
        snapshot = {
            "positions": [
                {
                    "symbol": "RELIANCE",
                    "strategy_id": test_strategy.id,
                },
                {
                    "symbol": "TCS",
                    "strategy_id": 999,
                },
            ]
        }
        
        with patch('api.bots.load_bot_snapshot', return_value=snapshot):
            response = client_with_db.get(
                f"/api/bots/{test_bot.uuid}/positions?strategy_id={test_strategy.uuid}"
            )

            assert response.status_code == 200
            data = response.json()
            assert all(p["strategy_id"] == test_strategy.id for p in data["positions"])

    @pytest.mark.integration
    def test_get_bot_positions_no_snapshot(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/positions when no snapshot exists."""
        with patch('api.bots.load_bot_snapshot', return_value=None):
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/positions")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == test_bot.uuid
            assert data["positions"] == []
            assert data["count"] == 0

    @pytest.mark.integration
    def test_get_bot_scan(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/scan."""
        snapshot = {
            "scan_items": [
                {"symbol": "RELIANCE", "price": 2520.0, "score": 8.5, "strategy_id": 1},
                {"symbol": "TCS", "price": 3460.0, "score": 6.8, "strategy_id": 2},
            ]
        }
        
        with patch('api.bots.load_bot_snapshot', return_value=snapshot):
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/scan")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == test_bot.uuid
            assert "scan_items" in data
            assert "count" in data
            assert len(data["scan_items"]) > 0

    @pytest.mark.integration
    def test_get_bot_scan_filter_by_strategy(self, client_with_db, test_bot, test_strategy):
        """Test GET /api/bots/{bot_id}/scan filtered by strategy_id."""
        snapshot = {
            "scan_items": [
                {"symbol": "RELIANCE", "price": 2520.0, "strategy_id": test_strategy.id},
                {"symbol": "TCS", "price": 3460.0, "strategy_id": 999},
            ]
        }
        
        with patch('api.bots.load_bot_snapshot', return_value=snapshot):
            response = client_with_db.get(
                f"/api/bots/{test_bot.uuid}/scan?strategy_id={test_strategy.uuid}"
            )

            assert response.status_code == 200
            data = response.json()
            assert all(s.get("strategy_id") == test_strategy.id for s in data["scan_items"])

    @pytest.mark.integration
    def test_get_bot_scan_no_snapshot(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/scan when no snapshot exists."""
        with patch('api.bots.load_bot_snapshot', return_value=None):
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/scan")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == test_bot.uuid
            assert data["scan_items"] == []
            assert data["count"] == 0


# ============================================================================
# 6. Performance Tests
# ============================================================================

class TestPerformanceEndpoints:
    """Tests for performance endpoints."""

    @pytest.mark.integration
    def test_get_bot_performance(self, client_with_db, test_bot, test_strategy):
        """Test GET /api/bots/{bot_id}/performance."""
        snapshot = {
            "portfolio": {
                "total_pnl": 5000.0,
                "total_positions": 2,
            },
            "strategies": {
                str(test_strategy.id): {
                    "name": test_strategy.name,
                    "portfolio_status": {
                        "total_pnl": 5000.0,
                        "trades_count": 5,
                        "positions_count": 2,
                    }
                }
            }
        }
        
        with patch('api.bots.load_bot_snapshot', return_value=snapshot), \
             patch('trading.journal.get_journal') as mock_get_journal:
            
            mock_journal = MagicMock()
            mock_journal.load_all_journals = MagicMock()
            mock_journal.trades = []
            mock_get_journal.return_value = mock_journal
            
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/performance")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == test_bot.uuid
            assert "summary" in data
            assert "by_strategy" in data

    @pytest.mark.integration
    def test_get_bot_performance_no_snapshot(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/performance when no snapshot exists."""
        with patch('api.bots.load_bot_snapshot', return_value=None):
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/performance")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == test_bot.uuid
            assert "summary" in data
            assert data["summary"]["total_pnl"] == 0

    @pytest.mark.integration
    def test_get_bot_performance_custom_days(self, client_with_db, test_bot, test_strategy):
        """Test GET /api/bots/{bot_id}/performance with custom days parameter."""
        snapshot = {
            "portfolio": {"total_pnl": 5000.0},
            "strategies": {}
        }
        
        with patch('api.bots.load_bot_snapshot', return_value=snapshot), \
             patch('trading.journal.get_journal') as mock_get_journal:
            
            mock_journal = MagicMock()
            mock_journal.load_all_journals = MagicMock()
            mock_journal.trades = []
            mock_get_journal.return_value = mock_journal
            
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/performance?days=7")

            assert response.status_code == 200
            data = response.json()
            assert data["period_days"] == 7

    @pytest.mark.integration
    def test_compare_strategy_performance(self, client_with_db, test_bot, test_strategy):
        """Test GET /api/bots/{bot_id}/performance/compare."""
        snapshot = {
            "strategies": {
                str(test_strategy.id): {
                    "name": test_strategy.name,
                    "portfolio_status": {
                        "total_pnl": 5000.0,
                        "trades_count": 5,
                        "positions_count": 2,
                    }
                }
            }
        }
        
        with patch('api.bots.load_bot_snapshot', return_value=snapshot), \
             patch('trading.journal.get_journal') as mock_get_journal:
            
            mock_journal = MagicMock()
            mock_journal.load_all_journals = MagicMock()
            mock_journal.trades = []
            mock_journal.get_strategy_performance = MagicMock(return_value={})
            mock_get_journal.return_value = mock_journal
            
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/performance/compare")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == test_bot.uuid
            assert "comparison" in data

    @pytest.mark.integration
    def test_compare_strategy_performance_no_snapshot(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/performance/compare when no snapshot."""
        with patch('api.bots.load_bot_snapshot', return_value=None):
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/performance/compare")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == test_bot.uuid
            assert "comparison" in data
            assert data["comparison"] == []

    @pytest.mark.integration
    def test_get_bot_trades(self, client_with_db, test_bot, test_strategy):
        """Test GET /api/bots/{bot_id}/trades."""
        with patch('trading.journal.get_journal') as mock_get_journal:
            mock_journal = MagicMock()
            mock_journal.load_all_journals = MagicMock()
            mock_journal.trades = []
            mock_get_journal.return_value = mock_journal
            
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/trades")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == test_bot.uuid
            assert "trades" in data
            assert "count" in data

    @pytest.mark.integration
    def test_get_bot_trades_filter_by_strategy(self, client_with_db, test_bot, test_strategy):
        """Test GET /api/bots/{bot_id}/trades filtered by strategy_id."""
        with patch('trading.journal.get_journal') as mock_get_journal:
            mock_journal = MagicMock()
            mock_journal.load_all_journals = MagicMock()
            mock_journal.trades = []
            mock_get_journal.return_value = mock_journal
            
            response = client_with_db.get(
                f"/api/bots/{test_bot.uuid}/trades?strategy_id={test_strategy.uuid}"
            )

            assert response.status_code == 200
            data = response.json()

    @pytest.mark.integration
    def test_get_bot_trades_exclude_test_data(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/trades with include_test=false."""
        with patch('trading.journal.get_journal') as mock_get_journal:
            mock_journal = MagicMock()
            mock_journal.load_all_journals = MagicMock()
            mock_journal.trades = []
            mock_get_journal.return_value = mock_journal
            
            response = client_with_db.get(
                f"/api/bots/{test_bot.uuid}/trades?include_test=false"
            )

            assert response.status_code == 200
            data = response.json()
            assert not any(t.get("is_test") for t in data["trades"])

    @pytest.mark.integration
    def test_get_strategy_performance(self, client_with_db, test_bot, test_strategy):
        """Test GET /api/bots/{bot_id}/strategy-performance."""
        with patch('trading.journal.get_journal') as mock_get_journal:
            mock_journal = MagicMock()
            mock_journal.load_all_journals = MagicMock()
            mock_journal.trades = []
            mock_journal.get_strategy_performance = MagicMock(return_value={
                str(test_strategy.id): {
                    "trades": 3,
                    "winners": 2,
                    "losers": 1,
                    "net_pnl": 2500.0,
                    "win_rate": 66.7,
                }
            })
            mock_get_journal.return_value = mock_journal
            
            response = client_with_db.get(f"/api/bots/{test_bot.uuid}/strategy-performance")

            assert response.status_code == 200
            data = response.json()
            assert data["bot_id"] == test_bot.uuid
            assert "by_strategy" in data
            assert "combined" in data

    @pytest.mark.integration
    def test_get_strategy_performance_custom_days(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/strategy-performance with custom days."""
        with patch('trading.journal.get_journal') as mock_get_journal:
            mock_journal = MagicMock()
            mock_journal.load_all_journals = MagicMock()
            mock_journal.trades = []
            mock_journal.get_strategy_performance = MagicMock(return_value={})
            mock_get_journal.return_value = mock_journal
            
            response = client_with_db.get(
                f"/api/bots/{test_bot.uuid}/strategy-performance?days=7"
            )

            assert response.status_code == 200
            mock_journal.load_all_journals.assert_called()

    @pytest.mark.integration
    def test_get_strategy_performance_exclude_test(self, client_with_db, test_bot):
        """Test GET /api/bots/{bot_id}/strategy-performance with include_test=false."""
        with patch('trading.journal.get_journal') as mock_get_journal:
            mock_journal = MagicMock()
            mock_journal.load_all_journals = MagicMock()
            mock_journal.trades = []
            mock_journal.get_strategy_performance = MagicMock(return_value={})
            mock_get_journal.return_value = mock_journal
            
            response = client_with_db.get(
                f"/api/bots/{test_bot.uuid}/strategy-performance?include_test=false"
            )

            assert response.status_code == 200
            mock_journal.get_strategy_performance.assert_called_with(include_test=False)


# ============================================================================
# 7. Error Handling Tests
# ============================================================================

class TestErrorHandling:
    """Tests for error handling."""

    @pytest.mark.unit
    def test_database_unavailable(self, client):
        """Test endpoints when database is unavailable."""
        with patch('api.bots._db_available', False):
            response = client.get("/api/bots")

            assert response.status_code == 500
            assert "database" in response.json()["detail"].lower()

    @pytest.mark.integration
    def test_invalid_strategy_id(self, client_with_db, test_strategy):
        """Test creating bot with non-existent strategy."""
        bot_data = {
            "name": f"Invalid Bot {uuid_module.uuid4()}",
            "strategies": [
                {"strategy_id": str(uuid_module.uuid4()), "capital_allocation_pct": 0.50},
            ],
        }

        response = client_with_db.post("/api/bots", json=bot_data)

        # API returns 404 for non-existent strategy (not 400)
        assert response.status_code == 404

    @pytest.mark.unit
    def test_invalid_allocation_pct(self, client):
        """Test creating bot with invalid allocation percentage."""
        bot_data = {
            "name": "Invalid Allocation Bot",
            "strategies": [
                {"strategy_id": str(uuid_module.uuid4()), "capital_allocation_pct": 1.5},
            ],
        }

        response = client.post("/api/bots", json=bot_data)

        assert response.status_code == 422

    @pytest.mark.unit
    def test_invalid_max_positions(self, client):
        """Test creating bot with invalid max_positions."""
        bot_data = {
            "name": "Invalid Positions Bot",
            "max_total_positions": 50,
        }

        response = client.post("/api/bots", json=bot_data)

        assert response.status_code == 422


class TestBotCRUDUnit:
    """Unit tests for Bot CRUD operations."""

    @pytest.mark.integration
    def test_create_bot_duplicate_name(self, client_with_db):
        """Test POST /api/bots with duplicate name."""
        bot_data = {
            "name": "Duplicate Bot",
            "is_active": True,
        }

        # Create first bot
        client_with_db.post("/api/bots", json=bot_data)

        # Try to create second bot with same name
        response = client_with_db.post("/api/bots", json=bot_data)

        assert response.status_code == 400
        assert "already exists" in response.json()["detail"].lower()

    @pytest.mark.unit
    @patch('api.bots.SessionLocal')
    @patch('api.bots._db_available', True)
    @patch('api.bots._auth_available', True)
    @patch('api.bots.get_user_id', return_value=1)
    def test_create_bot_allocation_exceeds_100(self, mock_get_user_id, mock_session, client):
        """Test POST /api/bots with allocation > 100%."""
        bot_data = {
            "name": "Overallocated Bot",
            "is_active": True,
            "strategies": [
                {
                    "strategy_id": "550e8400-e29b-41d4-a716-446655440001",
                    "capital_allocation_pct": 0.60,
                },
                {
                    "strategy_id": "550e8400-e29b-41d4-a716-446655440002",
                    "capital_allocation_pct": 0.60,
                },
            ],
        }

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session.return_value.__enter__ = Mock(return_value=mock_db)
        mock_session.return_value.__exit__ = Mock(return_value=False)

        response = client.post("/api/bots", json=bot_data)

        assert response.status_code == 400
        assert "exceeds 100%" in response.json()["detail"].lower()

    @pytest.mark.unit
    @patch('api.bots.SessionLocal')
    @patch('api.bots._db_available', True)
    @patch('api.bots._auth_available', True)
    @patch('api.bots.get_user_id', return_value=1)
    def test_get_nonexistent_bot(self, mock_get_user_id, mock_session, client):
        """Test GET /api/bots/{bot_id} with non-existent bot."""
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session.return_value.__enter__ = Mock(return_value=mock_db)
        mock_session.return_value.__exit__ = Mock(return_value=False)

        response = client.get("/api/bots/550e8400-e29b-41d4-a716-446655449999")

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    @pytest.mark.unit
    def test_update_bot_duplicate_name(self):
        """Test PUT /api/bots/{bot_id} with duplicate name - requires database."""
        from fastapi import FastAPI
        app = FastAPI()
        app.include_router(bots_router)

        update_data = {"name": "Other Bot Name"}

        bot1 = MagicMock()
        bot1.id = 1
        bot1.name = "Test Bot 1"
        bot1.uuid = "550e8400-e29b-41d4-a716-446655440001"
        bot1.is_active = True
        bot1.max_total_positions = 10
        bot1.max_total_capital_pct = 0.80
        bot1.created_at = datetime.now()
        bot1.updated_at = datetime.now()

        bot2 = MagicMock()
        bot2.id = 2
        bot2.name = "Other Bot Name"

        mock_db = MagicMock()
        call_count = [0]
        
        def mock_first():
            call_count[0] += 1
            if call_count[0] == 1:
                return bot1
            else:
                return bot2

        mock_filter_result = MagicMock()
        mock_filter_result.first.side_effect = mock_first
        
        mock_db.query.return_value.filter.return_value = mock_filter_result
        mock_db.execute.return_value.fetchall.return_value = []

        with patch('api.bots.SessionLocal', return_value=mock_db), \
             patch('api.bots.get_db', None), \
             patch('api.bots._db_available', True), \
             patch('api.bots._auth_available', True), \
             patch('api.bots.get_user_id', return_value=1), \
             TestClient(app) as test_client:

            response = test_client.put("/api/bots/550e8400-e29b-41d4-a716-446655440001", json=update_data)

            assert response.status_code in [400, 404]


class TestBotControlUnit:
    """Unit tests for Bot control operations."""

    @pytest.mark.unit
    @patch('api.bots.is_bot_running', return_value=(False, None))
    @patch('api.bots.SessionLocal')
    @patch('api.bots._db_available', True)
    @patch('api.bots._auth_available', True)
    @patch('api.bots.get_user_id', return_value=1)
    def test_get_bot_status_nonexistent(self, mock_get_user_id, mock_session, mock_is_running, client):
        """Test GET /api/bots/{bot_id}/status with non-existent bot."""
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session.return_value.__enter__ = Mock(return_value=mock_db)
        mock_session.return_value.__exit__ = Mock(return_value=False)

        response = client.get("/api/bots/550e8400-e29b-41d4-a716-446655449999/status")

        assert response.status_code == 404


class TestErrorHandlingUnit:
    """Unit tests for error handling."""

    @pytest.mark.unit
    @patch('api.bots.SessionLocal')
    @patch('api.bots._db_available', True)
    @patch('api.bots._auth_available', True)
    @patch('api.bots.get_user_id', return_value=1)
    def test_invalid_strategy_id(self, mock_get_user_id, mock_session, client):
        """Test creating bot with non-existent strategy."""
        bot_data = {
            "name": "Invalid Bot",
            "strategies": [
                {"strategy_id": "550e8400-e29b-41d4-a716-446655449999", "capital_allocation_pct": 0.50},
            ],
        }

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session.return_value.__enter__ = Mock(return_value=mock_db)
        mock_session.return_value.__exit__ = Mock(return_value=False)

        response = client.post("/api/bots", json=bot_data)

        assert response.status_code == 404
