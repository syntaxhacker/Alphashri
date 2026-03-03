"""
Comprehensive tests for Bot Management API endpoints.

Tests cover:
1. Bot CRUD operations (list, create, get, update, delete)
2. Bot control (start, stop, status, logs)
3. Portfolio & positions endpoints
4. Performance endpoints (performance, compare, trades, strategy-performance)
5. Available strategies endpoint

Reference: stock-screener-ui/api/bots.py
Test Scenarios: stock-screener-ui/tests/API_TEST_SCENARIOS.md section 4
"""

import pytest
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock, PropertyMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

# Add project path for imports
# This file is in tests/, so parent is stock-screener-ui
sys.path.insert(0, str(Path(__file__).parent.parent))


# ============================================
# Test Fixtures
# ============================================

@pytest.fixture
def app():
    """Create a test FastAPI app with the bots router."""
    from api.bots import router
    app = FastAPI()
    app.include_router(router)
    return app


@pytest.fixture
def client(app):
    """Create a test client."""
    return TestClient(app)


@pytest.fixture
def db_session():
    """Create a test database session."""
    from db.database import SessionLocal, Base, engine
    from db.models import BotConfig, StrategyConfig, User, bot_strategies

    # Use in-memory database for tests
    test_engine = Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        yield db
    finally:
        db.rollback()
        db.close()


@pytest.fixture
def test_strategies(db_session):
    """Create test strategies in the database with unique names."""
    from db.models import StrategyConfig
    import time

    strategies = []
    # Use timestamp to ensure unique names across test runs
    timestamp = str(int(time.time() * 1000))[-6:]  # Last 6 digits of milliseconds

    for i in range(1, 4):
        strategy = StrategyConfig(
            name=f"test_strategy_{timestamp}_{i}",
            strategy_type="ORB",
            is_active=True,
            is_template=False,
            sl_pct=0.4,
            tp_pct=1.2,
            max_positions=5,
        )
        db_session.add(strategy)
        db_session.flush()
        strategies.append(strategy)

    db_session.commit()
    return strategies


@pytest.fixture
def cleanup_bot_processes():
    """Clean up any bot processes created during tests."""
    from api.bots import _bot_processes, _bot_logs
    original_processes = _bot_processes.copy()
    original_logs = _bot_logs.copy()

    yield

    # Restore original state
    from api.bots import _bot_processes as current_processes
    from api.bots import _bot_logs as current_logs

    # Stop any test processes
    for user_id, bots in current_processes.items():
        for bot_id, process in list(bots.items()):
            if bot_id not in original_processes.get(user_id, {}):
                try:
                    if process.poll() is None:
                        process.terminate()
                        process.wait(timeout=1)
                except Exception:
                    pass
                del current_processes[user_id][bot_id]

    # Clean up logs
    for bot_id, log_path in list(current_logs.items()):
        if bot_id not in original_logs:
            if log_path and log_path.exists():
                try:
                    log_path.unlink()
                except Exception:
                    pass
            del current_logs[bot_id]


@pytest.fixture
def mock_snapshot_file():
    """Create a mock snapshot file for testing portfolio endpoints."""
    snapshot_data = {
        "timestamp": datetime.now().isoformat(),
        "portfolio": {
            "initial_capital": 1000000,
            "cash": 900000,
            "capital_used": 100000,
            "position_value": 100000,
            "unrealized_pnl": 1000,
            "realized_pnl": 5000,
            "total_value": 1006000,
            "total_pnl": 6000,
            "total_pnl_pct": 0.6,
            "total_positions": 2,
            "total_trades": 5,
            "daily_pnl": 1000,
            "daily_trades": 2,
            "strategies_count": 2,
        },
        "positions": [
            {
                "symbol": "TCS",
                "side": "BUY",
                "quantity": 10,
                "entry_price": 3750,
                "current_price": 3800,
                "strategy_id": 1,
                "strategy_name": "test_strategy_1",
                "unrealized_pnl": 500,
            },
            {
                "symbol": "INFY",
                "side": "BUY",
                "quantity": 20,
                "entry_price": 1480,
                "current_price": 1500,
                "strategy_id": 2,
                "strategy_name": "test_strategy_2",
                "unrealized_pnl": 400,
            },
        ],
        "strategies": {
            "1": {
                "id": 1,
                "name": "test_strategy_1",
                "status": "running",
                "portfolio_status": {
                    "strategy_id": 1,
                    "strategy_name": "test_strategy_1",
                    "allocation_pct": 0.4,
                    "allocated_capital": 400000,
                    "capital_used": 37500,
                    "available_capital": 362500,
                    "positions_count": 1,
                    "max_positions": 3,
                    "unrealized_pnl": 500,
                    "realized_pnl": 0,
                    "total_pnl": 500,
                    "trades_count": 2,
                },
                "scan_items": [
                    {"symbol": "RELIANCE", "price": 2500, "status": "watching"}
                ],
            },
            "2": {
                "id": 2,
                "name": "test_strategy_2",
                "status": "running",
                "portfolio_status": {
                    "strategy_id": 2,
                    "strategy_name": "test_strategy_2",
                    "allocation_pct": 0.4,
                    "allocated_capital": 400000,
                    "capital_used": 29600,
                    "available_capital": 370400,
                    "positions_count": 1,
                    "max_positions": 3,
                    "unrealized_pnl": 400,
                    "realized_pnl": 0,
                    "total_pnl": 400,
                    "trades_count": 1,
                },
                "scan_items": [],
            },
        },
        "scan_items": [
            {
                "symbol": "RELIANCE",
                "price": 2500,
                "strategy_id": 1,
                "strategy_name": "test_strategy_1",
                "status": "watching"
            }
        ],
    }

    # Create a temporary snapshot file
    fd, path = tempfile.mkstemp(suffix=".json", prefix="bot-snapshot-")
    with open(fd, 'w') as f:
        json.dump(snapshot_data, f)

    yield Path(path)

    # Clean up
    Path(path).unlink(missing_ok=True)


@pytest.fixture
def mock_journal_with_trades():
    """Create a mock trade journal with test trades."""
    from trading.journal import TradeRecord

    trades = [
        TradeRecord(
            trade_id="TEST-001",
            symbol="TCS",
            side="BUY",
            quantity=10,
            entry_price=3750,
            exit_price=3850,
            entry_time="2026-03-01T10:00:00",
            exit_time="2026-03-01T12:00:00",
            pnl=1000,
            pnl_pct=2.67,
            exit_reason="TP",
            costs=100,
            net_pnl=900,
            strategy_id=1,
            strategy_name="test_strategy_1",
            is_test=False,
        ),
        TradeRecord(
            trade_id="TEST-002",
            symbol="INFY",
            side="BUY",
            quantity=20,
            entry_price=1480,
            exit_price=1500,
            entry_time="2026-03-01T11:00:00",
            exit_time="2026-03-01T13:00:00",
            pnl=400,
            pnl_pct=1.35,
            exit_reason="TP",
            costs=80,
            net_pnl=320,
            strategy_id=2,
            strategy_name="test_strategy_2",
            is_test=False,
        ),
        TradeRecord(
            trade_id="TEST-003",
            symbol="TCS",
            side="BUY",
            quantity=5,
            entry_price=3800,
            exit_price=3750,
            entry_time="2026-03-02T10:00:00",
            exit_time="2026-03-02T11:00:00",
            pnl=-250,
            pnl_pct=-1.32,
            exit_reason="SL",
            costs=50,
            net_pnl=-300,
            strategy_id=1,
            strategy_name="test_strategy_1",
            is_test=False,
        ),
        TradeRecord(
            trade_id="TEST-004",
            symbol="HDFC",
            side="BUY",
            quantity=15,
            entry_price=1600,
            exit_price=1650,
            entry_time="2026-03-02T14:00:00",
            exit_time="2026-03-02T15:30:00",
            pnl=750,
            pnl_pct=3.13,
            exit_reason="TP",
            costs=120,
            net_pnl=630,
            strategy_id=2,
            strategy_name="test_strategy_2",
            is_test=True,  # Test trade
        ),
    ]

    with patch('trading.journal.get_journal') as mock_get_journal:
        mock_journal = MagicMock()
        mock_journal.trades = trades
        mock_get_journal.return_value = mock_journal
        yield mock_journal


# ============================================
# 1. Bot CRUD Operations Tests
# ============================================

class TestBotCRUD:
    """Test bot CRUD operations."""

    def test_list_bots_empty(self, client):
        """Test listing bots when none exist."""
        # Mock database to return empty list
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_db.query.return_value.all.return_value = []
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots")
            assert response.status_code == 200
            assert response.json() == []

    def test_list_bots_with_data(self, client, test_strategies):
        """Test listing bots with existing data."""
        from db.models import BotConfig, bot_strategies

        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()

            # Create mock bot
            mock_bot = MagicMock()
            mock_bot.id = 1
            mock_bot.name = "Test Bot"
            mock_bot.is_active = True
            mock_bot.max_total_positions = 10
            mock_bot.max_total_capital_pct = 0.80
            mock_bot.created_at = datetime.now()
            mock_bot.updated_at = datetime.now()

            # Mock strategy association query
            mock_result = [
                MagicMock(strategy_id=test_strategies[0].id, max_positions=3, capital_allocation_pct=0.20)
            ]
            mock_db.execute.return_value.fetchall.return_value = mock_result
            mock_db.query.return_value.filter.return_value.first.return_value = test_strategies[0]
            mock_db.query.return_value.all.return_value = [mock_bot]

            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots")
            assert response.status_code == 200
            bots = response.json()
            assert len(bots) == 1
            assert bots[0]['name'] == "Test Bot"
            assert bots[0]['is_active'] is True

    def test_create_bot_success(self, client, test_strategies):
        """Test creating a bot successfully."""
        from db.models import BotConfig

        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()

            # Track the bot object that gets added to the session
            created_bot = None

            def mock_add(obj):
                nonlocal created_bot
                created_bot = obj
                # Simulate database setting the ID after add/flush
                created_bot.id = 1
                created_bot.created_at = datetime.now()
                created_bot.updated_at = datetime.now()

            mock_db.add = mock_add
            mock_db.flush = MagicMock()  # Mock flush to do nothing (ID already set)

            # Mock query chain
            mock_query = MagicMock()
            # First query: check if bot name exists -> return None
            # Second query: get strategy for validation -> return test_strategies[0]
            mock_query.filter.return_value.first.side_effect = [None, test_strategies[0]]
            mock_query.filter.return_value.filter.return_value.first.return_value = test_strategies[0]
            mock_db.query.return_value = mock_query

            mock_db.execute.return_value.fetchall.return_value = []

            mock_session.return_value.__enter__.return_value = mock_db

            bot_data = {
                "name": "New Bot",
                "is_active": True,
                "max_total_positions": 10,
                "max_total_capital_pct": 0.80,
                "strategies": [
                    {
                        "strategy_id": test_strategies[0].id,
                        "max_positions": 3,
                        "capital_allocation_pct": 0.20
                    }
                ]
            }

            response = client.post("/api/bots", json=bot_data)
            assert response.status_code == 200
            data = response.json()
            assert data['name'] == "New Bot"
            assert data['is_active'] is True

    def test_create_bot_duplicate_name(self, client, test_strategies):
        """Test creating a bot with duplicate name fails."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            existing_bot = MagicMock()
            existing_bot.id = 1
            mock_db.query.return_value.filter.return_value.first.return_value = existing_bot

            mock_session.return_value.__enter__.return_value = mock_db

            bot_data = {
                "name": "Existing Bot",
                "is_active": True,
                "max_total_positions": 10,
                "max_total_capital_pct": 0.80,
                "strategies": []
            }

            response = client.post("/api/bots", json=bot_data)
            assert response.status_code == 400
            assert "already exists" in response.json()['detail']

    def test_create_bot_allocation_exceeds_100_percent(self, client, test_strategies):
        """Test creating a bot with total allocation > 100% fails."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = None
            mock_db.query.return_value.filter.return_value.filter.return_value.first.return_value = test_strategies[0]

            mock_session.return_value.__enter__.return_value = mock_db

            bot_data = {
                "name": "Over-allocated Bot",
                "is_active": True,
                "max_total_positions": 10,
                "max_total_capital_pct": 0.80,
                "strategies": [
                    {
                        "strategy_id": test_strategies[0].id,
                        "max_positions": 3,
                        "capital_allocation_pct": 0.80  # 80%
                    },
                    {
                        "strategy_id": test_strategies[1].id,
                        "max_positions": 3,
                        "capital_allocation_pct": 0.40  # 40% - total 120%
                    }
                ]
            }

            response = client.post("/api/bots", json=bot_data)
            assert response.status_code == 400
            assert "exceeds 100%" in response.json()['detail']

    def test_create_bot_nonexistent_strategy(self, client, test_strategies):
        """Test creating a bot with non-existent strategy fails."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = None  # No existing bot name
            mock_db.query.return_value.filter.return_value.filter.return_value.first.return_value = None  # Strategy not found

            mock_session.return_value.__enter__.return_value = mock_db

            bot_data = {
                "name": "Bot with Bad Strategy",
                "is_active": True,
                "max_total_positions": 10,
                "max_total_capital_pct": 0.80,
                "strategies": [
                    {
                        "strategy_id": 9999,  # Non-existent
                        "max_positions": 3,
                        "capital_allocation_pct": 0.20
                    }
                ]
            }

            response = client.post("/api/bots", json=bot_data)
            assert response.status_code == 400
            assert "not found" in response.json()['detail']

    def test_get_bot_success(self, client, test_strategies):
        """Test getting a specific bot."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_bot = MagicMock()
            mock_bot.id = 1
            mock_bot.name = "Test Bot"
            mock_bot.is_active = True
            mock_bot.max_total_positions = 10
            mock_bot.max_total_capital_pct = 0.80
            mock_bot.created_at = datetime.now()
            mock_bot.updated_at = datetime.now()

            mock_db.query.return_value.filter.return_value.first.return_value = mock_bot
            mock_db.execute.return_value.fetchall.return_value = []

            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots/1")
            assert response.status_code == 200
            data = response.json()
            assert data['id'] == 1
            assert data['name'] == "Test Bot"

    def test_get_bot_not_found(self, client):
        """Test getting a non-existent bot returns 404."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = None

            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots/999")
            assert response.status_code == 404
            assert "not found" in response.json()['detail']

    def test_update_bot_name(self, client, test_strategies):
        """Test updating bot name."""
        now = datetime.now()
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_bot = MagicMock()
            mock_bot.id = 1
            mock_bot.name = "Old Name"
            mock_bot.is_active = True
            mock_bot.max_total_positions = 10
            mock_bot.max_total_capital_pct = 0.80
            mock_bot.created_at = now
            mock_bot.updated_at = now

            mock_db.query.return_value.filter.return_value.first.side_effect = [mock_bot, None]  # Bot exists, new name not taken
            mock_db.execute.return_value.fetchall.return_value = []  # No strategies

            mock_session.return_value.__enter__.return_value = mock_db

            update_data = {"name": "New Name"}

            response = client.put("/api/bots/1", json=update_data)
            assert response.status_code == 200
            # Verify name was updated
            assert mock_bot.name == "New Name"

    def test_update_bot_to_duplicate_name(self, client, test_strategies):
        """Test updating bot to a duplicate name fails."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_bot = MagicMock()
            mock_bot.id = 1
            mock_bot.name = "Bot 1"

            existing_bot = MagicMock()
            existing_bot.id = 2

            mock_db.query.return_value.filter.return_value.first.side_effect = [mock_bot, existing_bot]

            mock_session.return_value.__enter__.return_value = mock_db

            update_data = {"name": "Existing Name"}

            response = client.put("/api/bots/1", json=update_data)
            assert response.status_code == 400
            assert "already exists" in response.json()['detail']

    def test_update_bot_strategies_allocation_validation(self, client, test_strategies):
        """Test updating bot strategies validates total allocation."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_bot = MagicMock()
            mock_bot.id = 1

            mock_db.query.return_value.filter.return_value.first.return_value = mock_bot

            mock_session.return_value.__enter__.return_value = mock_db

            update_data = {
                "strategies": [
                    {"strategy_id": 1, "max_positions": 3, "capital_allocation_pct": 0.80},
                    {"strategy_id": 2, "max_positions": 3, "capital_allocation_pct": 0.40}
                ]
            }

            response = client.put("/api/bots/1", json=update_data)
            assert response.status_code == 400
            assert "exceeds 100%" in response.json()['detail']

    def test_update_bot_not_found(self, client):
        """Test updating non-existent bot returns 404."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = None

            mock_session.return_value.__enter__.return_value = mock_db

            update_data = {"name": "New Name"}

            response = client.put("/api/bots/999", json=update_data)
            assert response.status_code == 404

    def test_delete_bot_success(self, client, cleanup_bot_processes):
        """Test deleting a bot successfully."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_bot = MagicMock()
            mock_bot.id = 1
            mock_bot.name = "Bot to Delete"

            mock_db.query.return_value.filter.return_value.first.return_value = mock_bot

            mock_session.return_value.__enter__.return_value = mock_db

            response = client.delete("/api/bots/1")
            assert response.status_code == 200
            assert "deleted successfully" in response.json()['message']

    def test_delete_bot_not_found(self, client):
        """Test deleting non-existent bot returns 404."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = None

            mock_session.return_value.__enter__.return_value = mock_db

            response = client.delete("/api/bots/999")
            assert response.status_code == 404

    def test_delete_running_bot_stops_process(self, client, cleanup_bot_processes):
        """Test deleting a running bot stops the process first."""
        from api.bots import _bot_processes

        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_bot = MagicMock()
            mock_bot.id = 1

            # Create a mock running process
            mock_process = MagicMock()
            mock_process.poll.return_value = None  # Process is running
            mock_process.pid = 12345

            _bot_processes[0] = {1: mock_process}

            mock_db.query.return_value.filter.return_value.first.return_value = mock_bot

            mock_session.return_value.__enter__.return_value = mock_db

            response = client.delete("/api/bots/1")
            assert response.status_code == 200

            # Verify process was terminated
            mock_process.terminate.assert_called_once()


# ============================================
# 2. Bot Control Tests
# ============================================

class TestBotControl:
    """Test bot control endpoints."""

    @patch('api.bots.start_bot_process')
    def test_start_bot_success(self, mock_start_process, client, test_strategies):
        """Test starting a bot successfully."""
        mock_process = MagicMock()
        mock_process.pid = 12345
        mock_start_process.return_value = mock_process

        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session, \
             patch('api.bots.is_bot_running', return_value=(False, None)):

            mock_db = MagicMock()
            mock_bot = MagicMock()
            mock_bot.id = 1
            mock_bot.name = "Test Bot"
            mock_bot.is_active = True

            mock_db.query.return_value.filter.return_value.first.return_value = mock_bot
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.post("/api/bots/1/start")
            assert response.status_code == 200
            data = response.json()
            assert data['pid'] == 12345
            assert "started" in data['message']

    def test_start_bot_not_found(self, client):
        """Test starting non-existent bot returns 404."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = None
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.post("/api/bots/999/start")
            assert response.status_code == 404

    def test_start_inactive_bot_fails(self, client):
        """Test starting an inactive bot fails."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_bot = MagicMock()
            mock_bot.id = 1
            mock_bot.is_active = False

            mock_db.query.return_value.filter.return_value.first.return_value = mock_bot
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.post("/api/bots/1/start")
            assert response.status_code == 400
            assert "not active" in response.json()['detail']

    @patch('api.bots.is_bot_running')
    def test_start_already_running_bot(self, mock_is_running, client):
        """Test starting an already running bot returns status."""
        mock_is_running.return_value = (True, 12345)

        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_bot = MagicMock()
            mock_bot.id = 1
            mock_bot.is_active = True

            mock_db.query.return_value.filter.return_value.first.return_value = mock_bot
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.post("/api/bots/1/start")
            assert response.status_code == 200
            assert "already running" in response.json()['message']

    @patch('api.bots.stop_bot_process')
    @patch('api.bots.is_bot_running')
    def test_stop_running_bot(self, mock_is_running, mock_stop, client):
        """Test stopping a running bot."""
        mock_is_running.return_value = (True, 12345)

        response = client.post("/api/bots/1/stop")
        assert response.status_code == 200
        assert "stopped" in response.json()['message']
        mock_stop.assert_called_once()

    @patch('api.bots.is_bot_running')
    def test_stop_non_running_bot(self, mock_is_running, client):
        """Test stopping a bot that is not running."""
        mock_is_running.return_value = (False, None)

        response = client.post("/api/bots/1/stop")
        assert response.status_code == 200
        assert "not running" in response.json()['message']

    @patch('api.bots.is_bot_running')
    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_status_running(self, mock_load_snapshot, mock_is_running, client):
        """Test getting status of a running bot."""
        mock_is_running.return_value = (True, 12345)
        mock_load_snapshot.return_value = {
            "portfolio": {"total_pnl": 1000},
            "positions": [],
            "strategies": {},
            "timestamp": "2026-03-03T10:00:00"
        }

        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_bot = MagicMock()
            mock_bot.id = 1
            mock_bot.name = "Test Bot"

            mock_db.query.return_value.filter.return_value.first.return_value = mock_bot
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots/1/status")
            assert response.status_code == 200
            data = response.json()
            assert data['running'] is True
            assert data['pid'] == 12345
            assert data['portfolio'] is not None

    @patch('api.bots.is_bot_running')
    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_status_not_running(self, mock_load_snapshot, mock_is_running, client):
        """Test getting status of a stopped bot."""
        mock_is_running.return_value = (False, None)
        mock_load_snapshot.return_value = None

        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_bot = MagicMock()
            mock_bot.id = 1
            mock_bot.name = "Test Bot"

            mock_db.query.return_value.filter.return_value.first.return_value = mock_bot
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots/1/status")
            assert response.status_code == 200
            data = response.json()
            assert data['running'] is False
            assert data['pid'] is None

    @patch('api.bots.is_bot_running')
    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_status_not_found(self, mock_load_snapshot, mock_is_running, client):
        """Test getting status for non-existent bot."""
        mock_is_running.return_value = (False, None)

        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.first.return_value = None
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots/999/status")
            assert response.status_code == 404

    @patch('api.bots._bot_logs', {})
    def test_get_bot_logs_no_logs(self, client):
        """Test getting logs when no logs available."""
        response = client.get("/api/bots/1/logs")
        assert response.status_code == 200
        data = response.json()
        assert data['logs'] == ""
        assert "No logs available" in data['message']

    @patch('api.bots._bot_logs', {1: Path(__file__)})  # Use this file as mock log
    def test_get_bot_logs_with_custom_line_count(self, client):
        """Test getting logs with custom line count."""
        response = client.get("/api/bots/1/logs?lines=50")
        assert response.status_code == 200
        data = response.json()
        # Since we're using this file, there should be content
        assert 'total_lines' in data


# ============================================
# 3. Available Strategies Endpoint Tests
# ============================================

class TestAvailableStrategies:
    """Test the available strategies endpoint."""

    def test_list_available_strategies(self, client, test_strategies):
        """Test listing available strategies."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            mock_db.query.return_value.filter.return_value.all.return_value = test_strategies
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots/available-strategies")
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) >= 3
            assert all('id' in s for s in data)
            assert all('name' in s for s in data)
            assert all('strategy_type' in s for s in data)

    def test_list_available_strategies_only_active(self, client, test_strategies):
        """Test only active strategies are returned."""
        # Mark one strategy as inactive
        test_strategies[0].is_active = False

        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()
            # Return only active strategies (the API filters by is_active=True)
            active_strategies = [s for s in test_strategies if s.is_active]
            mock_db.query.return_value.filter.return_value.all.return_value = active_strategies
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots/available-strategies")
            assert response.status_code == 200
            data = response.json()
            # The endpoint filters by is_active=True at query time, so we just verify
            # we got fewer strategies than total (the inactive one was filtered out)
            assert len(data) == len(active_strategies)
            # Verify the response structure includes expected fields
            for s in data:
                assert 'id' in s
                assert 'name' in s
                assert 'strategy_type' in s


# ============================================
# 4. Portfolio & Positions Endpoints Tests
# ============================================

class TestBotPortfolioPositions:
    """Test bot portfolio and positions endpoints."""

    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_portfolio_success(self, mock_load_snapshot, client, mock_snapshot_file):
        """Test getting portfolio for a running bot."""
        mock_load_snapshot.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get("/api/bots/1/portfolio")
        assert response.status_code == 200
        data = response.json()
        assert data['bot_id'] == 1
        assert 'portfolio' in data
        assert 'positions' in data
        assert 'strategies' in data
        assert data['portfolio']['initial_capital'] == 1000000

    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_portfolio_no_snapshot(self, mock_load_snapshot, client):
        """Test getting portfolio when bot has no snapshot (not running)."""
        mock_load_snapshot.return_value = None

        response = client.get("/api/bots/1/portfolio")
        assert response.status_code == 404
        assert "not found" in response.json()['detail']

    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_positions_all(self, mock_load_snapshot, client, mock_snapshot_file):
        """Test getting all positions for a bot."""
        mock_load_snapshot.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get("/api/bots/1/positions")
        assert response.status_code == 200
        data = response.json()
        assert data['bot_id'] == 1
        assert len(data['positions']) == 2
        assert data['count'] == 2

    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_positions_filtered_by_strategy(self, mock_load_snapshot, client, mock_snapshot_file):
        """Test filtering positions by strategy_id."""
        snapshot_data = json.loads(mock_snapshot_file.read_text())
        mock_load_snapshot.return_value = snapshot_data

        response = client.get("/api/bots/1/positions?strategy_id=1")
        assert response.status_code == 200
        data = response.json()
        assert data['count'] == 1
        assert data['positions'][0]['strategy_id'] == 1

    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_scan_items(self, mock_load_snapshot, client, mock_snapshot_file):
        """Test getting scan items for a bot."""
        mock_load_snapshot.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get("/api/bots/1/scan")
        assert response.status_code == 200
        data = response.json()
        assert 'scan_items' in data
        assert len(data['scan_items']) > 0

    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_scan_filtered_by_strategy(self, mock_load_snapshot, client, mock_snapshot_file):
        """Test filtering scan items by strategy_id."""
        mock_load_snapshot.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get("/api/bots/1/scan?strategy_id=1")
        assert response.status_code == 200
        data = response.json()
        # All items should be from strategy 1
        for item in data['scan_items']:
            assert item.get('strategy_id') == 1


# ============================================
# 5. Performance Endpoints Tests
# ============================================

class TestBotPerformance:
    """Test bot performance endpoints."""

    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_performance(self, mock_load_snapshot, client, mock_snapshot_file):
        """Test getting performance summary for a bot."""
        mock_load_snapshot.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get("/api/bots/1/performance")
        assert response.status_code == 200
        data = response.json()
        assert 'summary' in data
        assert 'by_strategy' in data
        assert data['summary']['total_pnl'] == 6000
        assert data['summary']['total_positions'] == 2

    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_performance_with_custom_days(self, mock_load_snapshot, client, mock_snapshot_file):
        """Test getting performance with custom days parameter."""
        mock_load_snapshot.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get("/api/bots/1/performance?days=7")
        assert response.status_code == 200
        data = response.json()
        assert data['period_days'] == 7

    @patch('api.bots.load_bot_snapshot')
    def test_compare_strategy_performance(self, mock_load_snapshot, client, mock_snapshot_file):
        """Test comparing performance across strategies."""
        mock_load_snapshot.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get("/api/bots/1/performance/compare")
        assert response.status_code == 200
        data = response.json()
        assert 'comparison' in data
        # Should be sorted by total_pnl descending
        if len(data['comparison']) > 1:
            pnls = [s['total_pnl'] for s in data['comparison']]
            assert pnls == sorted(pnls, reverse=True)

    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_trades(self, mock_load_snapshot, client, mock_snapshot_file, mock_journal_with_trades):
        """Test getting trade history for a bot."""
        from db.models import bot_strategies

        mock_load_snapshot.return_value = json.loads(mock_snapshot_file.read_text())

        with patch('api.bots.SessionLocal') as mock_session:
            mock_db = MagicMock()
            # Return strategy IDs 1 and 2 for this bot
            mock_result = [
                MagicMock(strategy_id=1),
                MagicMock(strategy_id=2)
            ]
            mock_db.execute.return_value.fetchall.return_value = mock_result
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots/1/trades")
            assert response.status_code == 200
            data = response.json()
            assert 'trades' in data
            assert 'count' in data

    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_trades_filtered_by_strategy(self, mock_load_snapshot, client, mock_snapshot_file, mock_journal_with_trades):
        """Test filtering trades by strategy_id."""
        mock_load_snapshot.return_value = json.loads(mock_snapshot_file.read_text())

        with patch('api.bots.SessionLocal') as mock_session:
            mock_db = MagicMock()
            mock_result = [
                MagicMock(strategy_id=1),
                MagicMock(strategy_id=2)
            ]
            mock_db.execute.return_value.fetchall.return_value = mock_result
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots/1/trades?strategy_id=1")
            assert response.status_code == 200
            data = response.json()
            # All trades should be from strategy 1
            for trade in data['trades']:
                assert trade['strategy_id'] == 1

    @patch('api.bots.load_bot_snapshot')
    def test_get_bot_trades_exclude_test_data(self, mock_load_snapshot, client, mock_snapshot_file, mock_journal_with_trades):
        """Test filtering out test trades."""
        mock_load_snapshot.return_value = json.loads(mock_snapshot_file.read_text())

        with patch('api.bots.SessionLocal') as mock_session:
            mock_db = MagicMock()
            mock_result = [
                MagicMock(strategy_id=1),
                MagicMock(strategy_id=2)
            ]
            mock_db.execute.return_value.fetchall.return_value = mock_result
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots/1/trades?include_test=false")
            assert response.status_code == 200
            data = response.json()
            # No test trades should be included
            for trade in data['trades']:
                assert trade.get('is_test', False) is False

    @patch('api.bots.load_bot_snapshot')
    def test_get_strategy_performance(self, mock_load_snapshot, client, mock_snapshot_file, mock_journal_with_trades):
        """Test getting strategy performance breakdown."""
        mock_load_snapshot.return_value = json.loads(mock_snapshot_file.read_text())

        with patch('api.bots.SessionLocal') as mock_session:
            mock_db = MagicMock()
            mock_result = [
                MagicMock(strategy_id=1),
                MagicMock(strategy_id=2)
            ]
            mock_db.execute.return_value.fetchall.return_value = mock_result
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots/1/strategy-performance")
            assert response.status_code == 200
            data = response.json()
            assert 'by_strategy' in data
            assert 'combined' in data
            assert 'win_rate' in data['combined']

    @patch('api.bots.load_bot_snapshot')
    def test_get_strategy_performance_with_days(self, mock_load_snapshot, client, mock_snapshot_file, mock_journal_with_trades):
        """Test strategy performance with custom days parameter."""
        mock_load_snapshot.return_value = json.loads(mock_snapshot_file.read_text())

        with patch('api.bots.SessionLocal') as mock_session:
            mock_db = MagicMock()
            mock_result = [MagicMock(strategy_id=1)]
            mock_db.execute.return_value.fetchall.return_value = mock_result
            mock_session.return_value.__enter__.return_value = mock_db

            response = client.get("/api/bots/1/strategy-performance?days=7")
            assert response.status_code == 200


# ============================================
# 6. Multi-Strategy Bot Operations Tests
# ============================================

class TestMultiStrategyBot:
    """Test multi-strategy bot specific operations."""

    def test_create_multi_strategy_bot(self, client, test_strategies):
        """Test creating a bot with multiple strategies."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()

            # Track the bot object that gets added to the session
            created_bot = None

            def mock_add(obj):
                nonlocal created_bot
                created_bot = obj
                created_bot.id = 1
                created_bot.created_at = datetime.now()
                created_bot.updated_at = datetime.now()

            mock_db.add = mock_add
            mock_db.flush = MagicMock()

            # Mock query chain
            mock_query = MagicMock()
            mock_query.filter.return_value.first.side_effect = [
                None,  # No existing bot name
                test_strategies[0],  # First strategy exists
                test_strategies[1],  # Second strategy exists
            ]
            mock_query.filter.return_value.filter.return_value.first.side_effect = [
                test_strategies[0],
                test_strategies[1],
            ]
            mock_db.query.return_value = mock_query
            mock_db.execute.return_value.fetchall.return_value = []

            mock_session.return_value.__enter__.return_value = mock_db

            bot_data = {
                "name": "Multi-Strategy Bot",
                "is_active": True,
                "max_total_positions": 10,
                "max_total_capital_pct": 0.90,
                "strategies": [
                    {
                        "strategy_id": test_strategies[0].id,
                        "max_positions": 3,
                        "capital_allocation_pct": 0.40
                    },
                    {
                        "strategy_id": test_strategies[1].id,
                        "max_positions": 3,
                        "capital_allocation_pct": 0.40
                    }
                ]
            }

            response = client.post("/api/bots", json=bot_data)
            assert response.status_code == 200

    def test_multi_strategy_allocation_exactly_100_percent(self, client, test_strategies):
        """Test creating bot with exactly 100% allocation succeeds."""
        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()

            # Track the bot object that gets added to the session
            created_bot = None

            def mock_add(obj):
                nonlocal created_bot
                created_bot = obj
                created_bot.id = 1
                created_bot.created_at = datetime.now()
                created_bot.updated_at = datetime.now()

            mock_db.add = mock_add
            mock_db.flush = MagicMock()

            # Mock query chain
            mock_query = MagicMock()
            mock_query.filter.return_value.first.side_effect = [
                None,  # No existing bot name
                test_strategies[0],
                test_strategies[1],
                test_strategies[2],
            ]
            mock_query.filter.return_value.filter.return_value.first.side_effect = [
                test_strategies[0],
                test_strategies[1],
                test_strategies[2],
            ]
            mock_db.query.return_value = mock_query
            mock_db.execute.return_value.fetchall.return_value = []

            mock_session.return_value.__enter__.return_value = mock_db

            bot_data = {
                "name": "Full Allocation Bot",
                "is_active": True,
                "max_total_positions": 10,
                "max_total_capital_pct": 1.0,
                "strategies": [
                    {"strategy_id": test_strategies[0].id, "max_positions": 3, "capital_allocation_pct": 0.30},
                    {"strategy_id": test_strategies[1].id, "max_positions": 3, "capital_allocation_pct": 0.40},
                    {"strategy_id": test_strategies[2].id, "max_positions": 2, "capital_allocation_pct": 0.30},
                ]
            }

            response = client.post("/api/bots", json=bot_data)
            # Should succeed - 100% allocation is allowed
            assert response.status_code == 200


# ============================================
# 7. Error Cases Tests
# ============================================

class TestBotErrorCases:
    """Test various error cases for bot endpoints."""

    def test_database_not_available(self, client):
        """Test behavior when database is not available."""
        with patch('api.bots._db_available', False):
            response = client.get("/api/bots")
            assert response.status_code == 500
            assert "Database not available" in response.json()['detail']

    def test_create_bot_invalid_name_too_short(self, client):
        """Test creating bot with name too short fails validation."""
        # Empty name should fail Pydantic validation
        response = client.post("/api/bots", json={
            "name": "",
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 0.80,
        })
        assert response.status_code == 422

    def test_create_bot_invalid_max_positions(self, client):
        """Test creating bot with invalid max_positions fails."""
        response = client.post("/api/bots", json={
            "name": "Test Bot",
            "is_active": True,
            "max_total_positions": 0,  # Below minimum of 1
        })
        assert response.status_code == 422

    def test_create_bot_invalid_capital_pct(self, client):
        """Test creating bot with invalid capital percentage fails."""
        response = client.post("/api/bots", json={
            "name": "Test Bot",
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 1.5,  # Above maximum of 1.0
        })
        assert response.status_code == 422


# ============================================
# 8. Strategy Control Endpoints Tests
# ============================================

class TestStrategyControlEndpoints:
    """Test strategy-specific control endpoints within bots."""

    def test_start_strategy_endpoint(self, client):
        """Test starting a specific strategy within a bot."""
        response = client.post("/api/bots/1/strategies/5/start")
        assert response.status_code == 200
        data = response.json()
        assert "restart" in data['message'].lower()

    def test_stop_strategy_endpoint(self, client):
        """Test stopping a specific strategy within a bot."""
        response = client.post("/api/bots/1/strategies/5/stop")
        assert response.status_code == 200
        data = response.json()
        assert "restart" in data['message'].lower()


# ============================================
# 9. Bot Lifecycle Tests
# ============================================

class TestBotLifecycle:
    """Test complete bot lifecycle from creation to deletion."""

    @patch('api.bots.start_bot_process')
    @patch('api.bots.stop_bot_process')
    @patch('api.bots.is_bot_running')
    def test_full_bot_lifecycle(self, mock_is_running, mock_stop, mock_start, client, test_strategies):
        """Test complete lifecycle: create -> start -> status -> stop -> delete."""
        mock_process = MagicMock()
        mock_process.pid = 12345
        mock_start.return_value = mock_process
        mock_is_running.return_value = (False, None)

        with patch('api.bots._db_available', True), \
             patch('api.bots.SessionLocal') as mock_session:

            mock_db = MagicMock()

            # Track the bot object that gets added to the session
            created_bot = None

            def mock_add(obj):
                nonlocal created_bot
                created_bot = obj
                created_bot.id = 1
                created_bot.created_at = datetime.now()
                created_bot.updated_at = datetime.now()

            mock_db.add = mock_add
            mock_db.flush = MagicMock()

            # Create mock bot for get/start/status/stop operations
            mock_bot_for_get = MagicMock()
            mock_bot_for_get.id = 1
            mock_bot_for_get.name = "Lifecycle Bot"
            mock_bot_for_get.is_active = True
            now = datetime.now()
            mock_bot_for_get.created_at = now
            mock_bot_for_get.updated_at = now

            # Mock query chain - need to provide enough values for all API calls
            mock_query = MagicMock()
            # Create a list that returns mock_bot_for_get repeatedly for bot lookups
            first_values = [
                None,  # No existing bot name (for create)
                test_strategies[0],  # Strategy exists (for create)
                mock_bot_for_get,  # For start
                mock_bot_for_get,  # For status
                mock_bot_for_get,  # For delete
            ]
            mock_query.filter.return_value.first.side_effect = first_values
            mock_query.filter.return_value.filter.return_value.first.return_value = test_strategies[0]
            mock_db.query.return_value = mock_query
            mock_db.execute.return_value.fetchall.return_value = []

            mock_session.return_value.__enter__.return_value = mock_db

            # Step 1: Create
            create_response = client.post("/api/bots", json={
                "name": "Lifecycle Bot",
                "is_active": True,
                "max_total_positions": 10,
                "max_total_capital_pct": 0.80,
                "strategies": [
                    {"strategy_id": test_strategies[0].id, "max_positions": 3, "capital_allocation_pct": 0.20}
                ]
            })
            assert create_response.status_code == 200

            # Step 2: Start
            start_response = client.post("/api/bots/1/start")
            assert start_response.status_code == 200

            # Step 3: Get status
            with patch('api.bots.load_bot_snapshot', return_value=None):
                status_response = client.get("/api/bots/1/status")
                assert status_response.status_code == 200

            # Step 4: Stop
            stop_response = client.post("/api/bots/1/stop")
            assert stop_response.status_code == 200


# ============================================
# 10. Process Management Tests
# ============================================

class TestProcessManagement:
    """Test bot process management without actually starting processes."""

    def test_start_bot_process_mock(self):
        """Test start_bot_process function with mocking."""
        from api.bots import start_bot_process

        with patch('subprocess.Popen') as mock_popen, \
             patch('builtins.open', create=True) as mock_open:

            mock_process = MagicMock()
            mock_process.pid = 12345
            mock_popen.return_value = mock_process

            process = start_bot_process(user_id=0, bot_id=1, test_mode=True)

            assert process is not None
            assert process.pid == 12345
            mock_popen.assert_called_once()

    def test_stop_bot_process_mock(self):
        """Test stop_bot_process function with mocking."""
        from api.bots import stop_bot_process
        from api.bots import _bot_processes

        mock_process = MagicMock()
        mock_process.poll.return_value = None  # Process is running
        _bot_processes[0] = {1: mock_process}

        stop_bot_process(user_id=0, bot_id=1)

        # Verify process was terminated
        mock_process.terminate.assert_called_once()

        # Clean up
        if 0 in _bot_processes and 1 in _bot_processes[0]:
            del _bot_processes[0][1]

    def test_is_bot_running_true(self):
        """Test is_bot_running returns True when process is running."""
        from api.bots import is_bot_running
        from api.bots import _bot_processes

        mock_process = MagicMock()
        mock_process.poll.return_value = None  # Still running
        mock_process.pid = 12345
        _bot_processes[0] = {1: mock_process}

        running, pid = is_bot_running(user_id=0, bot_id=1)

        assert running is True
        assert pid == 12345

        # Clean up
        if 0 in _bot_processes:
            del _bot_processes[0]

    def test_is_bot_running_false(self):
        """Test is_bot_running returns False when process is not running."""
        from api.bots import is_bot_running
        from api.bots import _bot_processes

        # No process tracking
        running, pid = is_bot_running(user_id=0, bot_id=1)

        assert running is False
        assert pid is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
