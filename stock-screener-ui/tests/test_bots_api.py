"""
Comprehensive tests for Bot Management API endpoints.

Tests cover:
1. Bot CRUD operations (list, create, get, update, delete)
2. Bot control (start, stop, status, logs)
3. Portfolio & positions endpoints
4. Performance endpoints (performance, compare, trades, strategy-performance)
5. Available strategies endpoint

Reference: stock-screener-ui/api/bots.py
"""

import pytest
import json
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))
from tests.helpers.db import import_all_models


# ============================================
# Test Fixtures
# ============================================

@pytest.fixture
def app():
    """Create a test FastAPI app with the bots router."""
    from api.bots_api import router
    from api.auth import get_current_user
    from db.models import User

    app = FastAPI()
    app.include_router(router)

    mock_user = User(id=1, email="test@example.com")
    app.dependency_overrides[get_current_user] = lambda: mock_user

    return app


@pytest.fixture
def client(app):
    """Create a test client."""
    return TestClient(app)


@pytest.fixture(autouse=True)
def db_session(app):
    """Create a fresh in-memory database session for each test."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from db.database import Base
    import tempfile
    import os

    # Create a temporary file strictly for isolation
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)

    SQLALCHEMY_DATABASE_URL = f"sqlite:///{path}"
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Import all models to ensure tables are created
    import_all_models()
    Base.metadata.create_all(bind=engine)

    # Patch SessionLocal and engine in both modules
    with patch('db.database.SessionLocal', TestingSessionLocal), \
         patch('api.bots_api.bot_operations.SessionLocal', TestingSessionLocal), \
         patch('db.database.engine', engine):
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()
            try:
                os.unlink(path)
            except Exception:
                pass


@pytest.fixture
def test_strategies(db_session):
    """Create test strategies in the database with unique names."""
    from db.models import StrategyConfig
    import time

    strategies = []
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
    from api.bots_api.bots_router import _bot_processes, _bot_logs
    original_processes = _bot_processes.copy()
    original_logs = _bot_logs.copy()

    yield

    from api.bots_api.bots_router import _bot_processes as current_processes
    from api.bots_api.bots_router import _bot_logs as current_logs

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
                "scan_items": [{"symbol": "RELIANCE", "price": 2500, "status": "watching"}],
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
            {"symbol": "RELIANCE", "price": 2500, "strategy_id": 1, "strategy_name": "test_strategy_1", "status": "watching"}
        ],
    }

    fd, path = tempfile.mkstemp(suffix=".json", prefix="bot-snapshot-")
    with open(fd, 'w') as f:
        json.dump(snapshot_data, f)

    yield Path(path)
    Path(path).unlink(missing_ok=True)


@pytest.fixture
def mock_journal_with_trades():
    """Create a mock trade journal with test trades."""

    def _make_trade(**kw):
        return MagicMock(**kw)

    trades = [
        _make_trade(
            trade_id="TEST-001", symbol="TCS", side="BUY", quantity=10,
            entry_price=3750, exit_price=3850,
            entry_time="2026-03-01T10:00:00", exit_time="2026-03-01T12:00:00",
            pnl=1000, pnl_pct=2.67, exit_reason="TP", costs=100, net_pnl=900,
            strategy_id=1, strategy_name="test_strategy_1", is_test=False,
        ),
        _make_trade(
            trade_id="TEST-002", symbol="INFY", side="BUY", quantity=20,
            entry_price=1480, exit_price=1500,
            entry_time="2026-03-01T11:00:00", exit_time="2026-03-01T13:00:00",
            pnl=400, pnl_pct=1.35, exit_reason="TP", costs=80, net_pnl=320,
            strategy_id=2, strategy_name="test_strategy_2", is_test=False,
        ),
        _make_trade(
            trade_id="TEST-003", symbol="TCS", side="BUY", quantity=5,
            entry_price=3800, exit_price=3750,
            entry_time="2026-03-02T10:00:00", exit_time="2026-03-02T11:00:00",
            pnl=-250, pnl_pct=-1.32, exit_reason="SL", costs=50, net_pnl=-300,
            strategy_id=1, strategy_name="test_strategy_1", is_test=False,
        ),
        _make_trade(
            trade_id="TEST-004", symbol="HDFC", side="BUY", quantity=15,
            entry_price=1600, exit_price=1650,
            entry_time="2026-03-02T14:00:00", exit_time="2026-03-02T15:30:00",
            pnl=750, pnl_pct=3.13, exit_reason="TP", costs=120, net_pnl=630,
            strategy_id=2, strategy_name="test_strategy_2", is_test=True,
        ),
    ]

    mock_journal = MagicMock()
    mock_journal.trades = trades
    yield mock_journal


# ============================================
# 1. Bot CRUD Operations Tests
# ============================================

class TestBotCRUD:
    """Test bot CRUD operations."""

    def test_list_bots_empty(self, client):
        """Test listing bots when none exist."""
        response = client.get("/api/bots")
        assert response.status_code == 200
        assert response.json() == []

    def test_list_bots_with_data(self, client, db_session):
        """Test listing bots with existing data."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        response = client.get("/api/bots")
        assert response.status_code == 200
        bots = response.json()
        assert len(bots) == 1
        assert bots[0]['name'] == "Test Bot"
        assert bots[0]['is_active'] is True

    def test_create_bot_success(self, client, test_strategies):
        """Test creating a bot successfully."""
        bot_data = {
            "name": "New Bot",
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 0.80,
            "strategies": [
                {
                    "strategy_id": test_strategies[0].uuid,
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

    def test_create_bot_duplicate_name(self, client, db_session):
        """Test creating a bot with duplicate name fails."""
        from db.models import BotConfig

        existing_bot = BotConfig(
            name="Existing Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(existing_bot)
        db_session.commit()

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
        bot_data = {
            "name": "Over-allocated Bot",
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 0.80,
            "strategies": [
                {
                    "strategy_id": test_strategies[0].uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.80
                },
                {
                    "strategy_id": test_strategies[1].uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.40
                }
            ]
        }

        response = client.post("/api/bots", json=bot_data)
        assert response.status_code == 400
        assert "exceeds 100%" in response.json()['detail']

    def test_create_bot_nonexistent_strategy(self, client):
        """Test creating a bot with non-existent strategy fails."""
        nonexistent_uuid = str(uuid.uuid4())
        bot_data = {
            "name": "Bot with Bad Strategy",
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 0.80,
            "strategies": [
                {
                    "strategy_id": nonexistent_uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.20
                }
            ]
        }

        response = client.post("/api/bots", json=bot_data)
        assert response.status_code == 404
        assert "not found" in response.json()['detail']

    def test_get_bot_success(self, client, db_session):
        """Test getting a specific bot."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        response = client.get(f"/api/bots/{bot.id}")
        assert response.status_code == 200
        data = response.json()
        assert data['id'] == bot.id
        assert data['name'] == "Test Bot"

    def test_get_bot_not_found(self, client):
        """Test getting a non-existent bot returns 404."""
        nonexistent_uuid = str(uuid.uuid4())
        response = client.get(f"/api/bots/{nonexistent_uuid}")
        assert response.status_code == 404
        assert "not found" in response.json()['detail']

    def test_update_bot_name(self, client, db_session):
        """Test updating bot name."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Old Name",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        update_data = {"name": "New Name"}
        response = client.put(f"/api/bots/{bot.id}", json=update_data)
        assert response.status_code == 200
        data = response.json()
        assert data['name'] == "New Name"

    def test_update_bot_to_duplicate_name(self, client, db_session):
        """Test updating bot to a duplicate name fails."""
        from db.models import BotConfig

        bot1 = BotConfig(name="Bot 1", user_id=1, is_active=True, max_total_positions=10, max_total_capital_pct=0.80)
        bot2 = BotConfig(name="Existing Name", user_id=1, is_active=True, max_total_positions=10, max_total_capital_pct=0.80)
        db_session.add_all([bot1, bot2])
        db_session.commit()
        db_session.refresh(bot1)

        update_data = {"name": "Existing Name"}
        response = client.put(f"/api/bots/{bot1.id}", json=update_data)
        assert response.status_code == 400
        assert "already exists" in response.json()['detail']

    def test_update_bot_strategies_allocation_validation(self, client, test_strategies, db_session):
        """Test updating bot strategies validates total allocation."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        update_data = {
            "strategies": [
                {"strategy_id": test_strategies[0].uuid, "max_positions": 3, "capital_allocation_pct": 0.80},
                {"strategy_id": test_strategies[1].uuid, "max_positions": 3, "capital_allocation_pct": 0.40}
            ]
        }

        response = client.put(f"/api/bots/{bot.id}", json=update_data)
        assert response.status_code == 400
        assert "exceeds 100%" in response.json()['detail']

    def test_update_bot_not_found(self, client):
        """Test updating non-existent bot returns 404."""
        update_data = {"name": "New Name"}
        response = client.put("/api/bots/999", json=update_data)
        assert response.status_code == 404

    def test_delete_bot_success(self, client, db_session, cleanup_bot_processes):
        """Test deleting a bot successfully."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Bot to Delete",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        response = client.delete(f"/api/bots/{bot.id}")
        assert response.status_code == 200
        assert "deleted successfully" in response.json()['message']

    def test_delete_bot_not_found(self, client):
        """Test deleting non-existent bot returns 404."""
        response = client.delete("/api/bots/999")
        assert response.status_code == 404

    def test_delete_running_bot_stops_process(self, client, db_session, cleanup_bot_processes):
        """Test deleting a running bot stops the process first."""
        from api.bots_api.bots_router import _bot_processes
        from db.models import BotConfig

        bot = BotConfig(
            name="Running Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_process = MagicMock()
        mock_process.poll.return_value = None
        mock_process.pid = 12345

        if 1 not in _bot_processes:
            _bot_processes[1] = {}
        _bot_processes[1][bot.id] = mock_process

        try:
            response = client.delete(f"/api/bots/{bot.id}")
            assert response.status_code == 200
            mock_process.terminate.assert_called_once()
        finally:
            if bot.id in _bot_processes.get(1, {}):
                del _bot_processes[1][bot.id]


# ============================================
# 2. Bot Control Tests
# ============================================

class TestBotControl:
    """Test bot control endpoints."""

    @patch('api.bots_api.bot_operations.start_bot_process')
    def test_start_bot_success(self, mock_start_process, client, db_session):
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_process = MagicMock()
        mock_process.pid = 12345
        mock_start_process.return_value = mock_process

        with patch('api.bots_api.bot_operations._db_available', True), \
             patch('api.bots_api.bot_operations.is_bot_running', return_value=(False, None)):
            response = client.post(f"/api/bots/{bot.id}/start")
            assert response.status_code == 200
            data = response.json()
            assert data['pid'] == 12345
            assert "started" in data['message']

    def test_start_bot_not_found(self, client):
        """Test starting non-existent bot returns 404."""
        nonexistent_uuid = str(uuid.uuid4())
        response = client.post(f"/api/bots/{nonexistent_uuid}/start")
        assert response.status_code == 404

    def test_start_inactive_bot_fails(self, client, db_session):
        """Test starting an inactive bot fails."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Inactive Bot",
            user_id=1,
            is_active=False,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        response = client.post(f"/api/bots/{bot.id}/start")
        assert response.status_code == 400
        assert "not active" in response.json()['detail']

    @patch('api.bots_api.bot_operations.is_bot_running')
    def test_start_already_running_bot(self, mock_is_running, client, db_session):
        """Test starting an already running bot returns status."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Running Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_is_running.return_value = (True, 12345)

        with patch('api.bots_api.bot_operations._db_available', True):
            response = client.post(f"/api/bots/{bot.id}/start")
            assert response.status_code == 200
            assert "already running" in response.json()['message']

    @patch('api.bots_api.bot_operations.stop_bot_process')
    @patch('api.bots_api.bot_operations.is_bot_running')
    def test_stop_running_bot(self, mock_is_running, mock_stop, client, db_session):
        """Test stopping a running bot."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Bot to Stop",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_is_running.return_value = (True, 12345)

        with patch('api.bots_api.bot_operations._db_available', True):
            response = client.post(f"/api/bots/{bot.id}/stop")
            assert response.status_code == 200
            assert "stopped" in response.json()['message']
            mock_stop.assert_called_once()

    @patch('api.bots_api.bot_operations.is_bot_running')
    def test_stop_non_running_bot(self, mock_is_running, client, db_session):
        """Test stopping a bot that is not running."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Bot Not Running",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_is_running.return_value = (False, None)

        with patch('api.bots_api.bot_operations._db_available', True):
            response = client.post(f"/api/bots/{bot.id}/stop")
            assert response.status_code == 200
            assert "not running" in response.json()['message']

    @patch('api.bots_api.bot_status.is_bot_running')
    @patch('api.bots_api.bot_status.get_bot_state')
    def test_get_bot_status_running(self, mock_get_state, mock_is_running, client, db_session):
        """Test getting status of a running bot."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_is_running.return_value = (True, 12345)
        mock_get_state.return_value = {
            "portfolio": {"total_pnl": 1000},
            "positions": [],
            "strategies": {},
            "timestamp": "2026-03-03T10:00:00"
        }

        with patch('api.bots_api.bot_operations._db_available', True):
            response = client.get(f"/api/bots/{bot.id}/status")
            assert response.status_code == 200
            data = response.json()
            assert data['running'] is True
            assert data['pid'] == 12345
            assert data['portfolio'] is not None
            assert data['bot_id'] == bot.uuid
            assert data['bot_name'] == bot.name

    @patch('api.bots_api.bot_status.is_bot_running')
    @patch('api.bots_api.bot_status.get_bot_state')
    def test_get_bot_status_not_running(self, mock_get_state, mock_is_running, client, db_session):
        """Test getting status of a stopped bot."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_is_running.return_value = (False, None)
        mock_get_state.return_value = None

        with patch('api.bots_api.bot_operations._db_available', True):
            response = client.get(f"/api/bots/{bot.id}/status")
            assert response.status_code == 200
            data = response.json()
            assert data['running'] is False
            assert data['pid'] is None
            assert data['bot_id'] == bot.uuid
            assert data['bot_name'] == bot.name

    def test_get_bot_status_not_found(self, client):
        """Test getting status for non-existent bot."""
        nonexistent_uuid = str(uuid.uuid4())
        response = client.get(f"/api/bots/{nonexistent_uuid}/status")
        assert response.status_code == 404

    def test_get_bot_logs_no_logs(self, client, db_session):
        """Test getting logs when no logs available."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        with patch('api.bots_api.bot_operations._db_available', True):
            response = client.get(f"/api/bots/{bot.id}/logs")
            assert response.status_code == 200
            data = response.json()
            assert data['logs'] == ""
            assert "No logs available" in data['message']

    def test_get_bot_logs_with_custom_line_count(self, client, db_session):
        """Test getting logs with custom line count."""
        from db.models import BotConfig
        from api.bots_api.bots_router import _bot_logs

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        _bot_logs[bot.id] = Path(__file__)
        try:
            response = client.get(f"/api/bots/{bot.id}/logs?lines=50")
            assert response.status_code == 200
            data = response.json()
            assert 'total_lines' in data
        finally:
            _bot_logs.pop(bot.id, None)


# ============================================
# 3. Available Strategies Endpoint Tests
# ============================================

class TestAvailableStrategies:
    """Test the available strategies endpoint."""

    def test_list_available_strategies(self, client, test_strategies):
        """Test listing available strategies."""
        response = client.get("/api/bots/available-strategies")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == len(test_strategies)
        assert all('id' in s for s in data)
        assert all('name' in s for s in data)
        assert all('strategy_type' in s for s in data)

    def test_list_available_strategies_only_active(self, client, test_strategies, db_session):
        """Test only active strategies are returned."""
        test_strategies[0].is_active = False
        db_session.commit()
        active_count = sum(1 for s in test_strategies if s.is_active)

        response = client.get("/api/bots/available-strategies")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == active_count
        for s in data:
            assert 'id' in s
            assert 'name' in s
            assert 'strategy_type' in s


# ============================================
# 4. Portfolio & Positions Endpoint Tests
# ============================================

class TestBotPortfolioPositions:
    """Test bot portfolio and positions endpoints."""

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_get_bot_portfolio_success(self, mock_get_state, client, db_session, mock_snapshot_file):
        """Test getting portfolio for a running bot."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_get_state.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get(f"/api/bots/{bot.id}/portfolio")
        assert response.status_code == 200
        data = response.json()
        assert data['bot_id'] == bot.uuid
        assert 'portfolio' in data
        assert 'positions' in data
        assert 'strategies' in data
        assert data['portfolio']['initial_capital'] == 1000000

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_get_bot_portfolio_no_snapshot(self, mock_get_state, client, db_session):
        """Test getting portfolio when bot has no snapshot returns default."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_get_state.return_value = None

        response = client.get(f"/api/bots/{bot.id}/portfolio")
        assert response.status_code == 200
        data = response.json()
        assert data['bot_id'] == bot.uuid
        assert data['portfolio']['total_value'] == 1000000
        assert data['positions'] == []
        assert data['strategies'] == {}

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_get_bot_positions_all(self, mock_get_state, client, db_session, mock_snapshot_file):
        """Test getting all positions for a bot."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_get_state.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get(f"/api/bots/{bot.id}/positions")
        assert response.status_code == 200
        data = response.json()
        assert data['bot_id'] == bot.uuid
        assert len(data['positions']) == 2
        assert data['count'] == 2

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_get_bot_positions_filtered_by_strategy(self, mock_get_state, client, db_session, mock_snapshot_file):
        """Test filtering positions by strategy_id."""
        from db.models import BotConfig, StrategyConfig

        # Create a strategy to satisfy lookup by get_strategy_by_uuid
        strategy = StrategyConfig(
            name="Test Strategy",
            strategy_type="ORB",
            is_active=True,
            is_template=False,
            sl_pct=0.4,
            tp_pct=1.2,
            max_positions=5
        )
        db_session.add(strategy)
        db_session.commit()
        db_session.refresh(strategy)

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        snapshot_data = json.loads(mock_snapshot_file.read_text())
        mock_get_state.return_value = snapshot_data

        response = client.get(f"/api/bots/{bot.id}/positions?strategy_id=1")
        assert response.status_code == 200
        data = response.json()
        assert data['count'] == 1
        assert data['positions'][0]['strategy_id'] == 1
        assert data['bot_id'] == bot.uuid

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_get_bot_scan_items(self, mock_get_state, client, db_session, mock_snapshot_file):
        """Test getting scan items for a bot."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_get_state.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get(f"/api/bots/{bot.id}/scan")
        assert response.status_code == 200
        data = response.json()
        assert 'scan_items' in data
        assert len(data['scan_items']) > 0

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_get_bot_scan_filtered_by_strategy(self, mock_get_state, client, db_session, mock_snapshot_file):
        """Test filtering scan items by strategy_id."""
        from db.models import BotConfig, StrategyConfig

        # Create a strategy to satisfy lookup by get_strategy_by_uuid
        strategy = StrategyConfig(
            name="Test Strategy",
            strategy_type="ORB",
            is_active=True,
            is_template=False,
            sl_pct=0.4,
            tp_pct=1.2,
            max_positions=5
        )
        db_session.add(strategy)
        db_session.commit()
        db_session.refresh(strategy)

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        snapshot_data = json.loads(mock_snapshot_file.read_text())
        mock_get_state.return_value = snapshot_data

        response = client.get(f"/api/bots/{bot.id}/scan?strategy_id=1")
        assert response.status_code == 200
        data = response.json()
        for item in data['scan_items']:
            assert item.get('strategy_id') == 1


# ============================================
# 5. Performance Endpoint Tests
# ============================================

class TestBotPerformance:
    """Test bot performance endpoints."""

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_get_bot_performance(self, mock_get_state, client, db_session, mock_snapshot_file):
        """Test getting performance summary for a bot."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_get_state.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get(f"/api/bots/{bot.id}/performance")
        assert response.status_code == 200
        data = response.json()
        assert 'summary' in data
        assert 'by_strategy' in data
        assert data['summary']['total_pnl'] == 6000
        assert data['summary']['total_positions'] == 2

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_get_bot_performance_with_custom_days(self, mock_get_state, client, db_session, mock_snapshot_file):
        """Test getting performance with custom days parameter."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_get_state.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get(f"/api/bots/{bot.id}/performance?days=7")
        assert response.status_code == 200
        data = response.json()
        assert data['period_days'] == 7

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_compare_strategy_performance(self, mock_get_state, client, db_session, mock_snapshot_file):
        """Test comparing performance across strategies."""
        from db.models import BotConfig

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        mock_get_state.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get(f"/api/bots/{bot.id}/performance/compare")
        assert response.status_code == 200
        data = response.json()
        assert 'comparison' in data

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_get_bot_trades(self, mock_get_state, client, db_session, test_strategies, mock_snapshot_file, mock_journal_with_trades):
        """Test getting trade history for a bot."""
        from db.models import BotConfig, bot_strategies

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        # Associate bot with first two strategies
        for strat in test_strategies[:2]:
            stmt = bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strat.id,
                max_positions=3,
                capital_allocation_pct=0.2
            )
            db_session.execute(stmt)
        db_session.commit()

        mock_get_state.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get(f"/api/bots/{bot.id}/trades")
        assert response.status_code == 200
        data = response.json()
        assert 'trades' in data
        assert 'count' in data

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_get_bot_trades_filtered_by_strategy(self, mock_get_state, client, db_session, test_strategies, mock_snapshot_file, mock_journal_with_trades):
        """Test filtering trades by strategy_id."""
        from db.models import BotConfig, bot_strategies

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        # Associate bot with first two strategies
        for strat in test_strategies[:2]:
            stmt = bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strat.id,
                max_positions=3,
                capital_allocation_pct=0.2
            )
            db_session.execute(stmt)
        db_session.commit()

        mock_get_state.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get(f"/api/bots/{bot.id}/trades?strategy_id={test_strategies[0].id}")
        assert response.status_code == 200
        data = response.json()
        for trade in data['trades']:
            assert trade['strategy_id'] == test_strategies[0].id

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_get_bot_trades_exclude_test_data(self, mock_get_state, client, db_session, test_strategies, mock_snapshot_file, mock_journal_with_trades):
        """Test filtering out test trades."""
        from db.models import BotConfig, bot_strategies

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        for strat in test_strategies[:2]:
            stmt = bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strat.id,
                max_positions=3,
                capital_allocation_pct=0.2
            )
            db_session.execute(stmt)
        db_session.commit()

        mock_get_state.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get(f"/api/bots/{bot.id}/trades?include_test=false")
        assert response.status_code == 200
        data = response.json()
        for trade in data['trades']:
            assert trade.get('is_test', False) is False

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_get_strategy_performance(self, mock_get_state, client, db_session, test_strategies, mock_snapshot_file, mock_journal_with_trades):
        """Test getting strategy performance breakdown."""
        from db.models import BotConfig, bot_strategies

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        for strat in test_strategies[:2]:
            stmt = bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strat.id,
                max_positions=3,
                capital_allocation_pct=0.2
            )
            db_session.execute(stmt)
        db_session.commit()

        mock_get_state.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get(f"/api/bots/{bot.id}/strategy-performance")
        assert response.status_code == 200

    @patch('api.bots_api.bot_operations.get_bot_state')
    def test_get_strategy_performance_with_days(self, mock_get_state, client, db_session, test_strategies, mock_snapshot_file, mock_journal_with_trades):
        """Test getting strategy performance with days parameter."""
        from db.models import BotConfig, bot_strategies

        bot = BotConfig(
            name="Test Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        for strat in test_strategies[:2]:
            stmt = bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strat.id,
                max_positions=3,
                capital_allocation_pct=0.2
            )
            db_session.execute(stmt)
        db_session.commit()

        mock_get_state.return_value = json.loads(mock_snapshot_file.read_text())

        response = client.get(f"/api/bots/{bot.id}/strategy-performance?days=7")
        assert response.status_code == 200


# ============================================
# 6. Multi-Strategy Bot Tests
# ============================================

class TestMultiStrategyBot:
    """Test multi-strategy bot creation and allocation."""

    def test_create_multi_strategy_bot(self, client, test_strategies):
        """Test creating a bot with multiple strategies."""
        bot_data = {
            "name": "Multi-Strategy Bot",
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 0.90,
            "strategies": [
                {"strategy_id": test_strategies[0].uuid, "max_positions": 3, "capital_allocation_pct": 0.30},
                {"strategy_id": test_strategies[1].uuid, "max_positions": 3, "capital_allocation_pct": 0.30},
                {"strategy_id": test_strategies[2].uuid, "max_positions": 3, "capital_allocation_pct": 0.30}
            ]
        }

        response = client.post("/api/bots", json=bot_data)
        assert response.status_code == 200
        data = response.json()
        assert len(data['strategies']) == 3

    def test_multi_strategy_allocation_exactly_100_percent(self, client, test_strategies):
        """Test that allocation sum exactly 100% (after rounding) is allowed."""
        bot_data = {
            "name": "Exact Allocation Bot",
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 1.0,
            "strategies": [
                {"strategy_id": test_strategies[0].uuid, "max_positions": 3, "capital_allocation_pct": 0.3333},
                {"strategy_id": test_strategies[1].uuid, "max_positions": 3, "capital_allocation_pct": 0.3333},
                {"strategy_id": test_strategies[2].uuid, "max_positions": 3, "capital_allocation_pct": 0.3334}
            ]
        }

        response = client.post("/api/bots", json=bot_data)
        assert response.status_code == 200


# ============================================
# 7. Bot Lifecycle Tests
# ============================================

class TestBotLifecycle:
    """Test full bot lifecycle."""

    def test_full_bot_lifecycle(self, client, db_session, test_strategies):
        """Test complete bot lifecycle: create, start, status, stop, delete."""
        from db.models import BotConfig, bot_strategies

        # Create bot
        bot = BotConfig(
            name="Lifecycle Bot",
            user_id=1,
            is_active=True,
            max_total_positions=10,
            max_total_capital_pct=0.80
        )
        db_session.add(bot)
        db_session.commit()
        db_session.refresh(bot)

        # Associate strategies
        for strat in test_strategies:
            stmt = bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strat.id,
                max_positions=3,
                capital_allocation_pct=0.2
            )
            db_session.execute(stmt)
        db_session.commit()

        # Start bot
        with patch('api.bots_api.bot_operations.start_bot_process') as mock_start, \
             patch('api.bots_api.bot_operations.is_bot_running', return_value=(False, None)), \
             patch('api.bots_api.bot_operations._db_available', True):
            mock_process = MagicMock()
            mock_process.pid = 12345
            mock_start.return_value = mock_process
            start_resp = client.post(f"/api/bots/{bot.id}/start")
            assert start_resp.status_code == 200

        # Check status (running)
        with patch('api.bots_api.bot_status.is_bot_running', return_value=(True, 12345)), \
             patch('api.bots_api.bot_status.get_bot_state', return_value={"portfolio": {}, "positions": [], "strategies": {}, "timestamp": ""}), \
             patch('api.bots_api.bot_operations._db_available', True):
            status_resp = client.get(f"/api/bots/{bot.id}/status")
            assert status_resp.status_code == 200
            assert status_resp.json()['running'] is True

        # Stop bot
        with patch('api.bots_api.bot_operations.stop_bot_process') as mock_stop, \
             patch('api.bots_api.bot_operations.is_bot_running', return_value=(True, 12345)), \
             patch('api.bots_api.bot_operations._db_available', True):
            stop_resp = client.post(f"/api/bots/{bot.id}/stop")
            assert stop_resp.status_code == 200
            mock_stop.assert_called_once()

        # Delete bot
        with patch('api.bots_api.bots_router._bot_processes', {}), \
             patch('api.bots_api.bot_operations._db_available', True):
            del_resp = client.delete(f"/api/bots/{bot.id}")
            assert del_resp.status_code == 200


# ============================================
# 8. Bot Error Cases Tests
# ============================================

class TestBotErrorCases:
    """Test error handling in bot operations."""

    def test_database_not_available(self, client):
        """Test behavior when database is not available."""
        with patch('api.bots_api.bot_status._db_available', False):
            response = client.get("/api/bots")
            assert response.status_code == 500

    def test_create_bot_invalid_name_too_short(self, client, test_strategies):
        """Test creating bot with name too short fails."""
        bot_data = {
            "name": "",  # empty name should fail validation
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 0.8,
            "strategies": []
        }
        response = client.post("/api/bots", json=bot_data)
        assert response.status_code == 422

    def test_create_bot_invalid_max_positions(self, client, test_strategies):
        """Test creating bot with invalid max_positions fails."""
        bot_data = {
            "name": "Bot",
            "is_active": True,
            "max_total_positions": 0,
            "max_total_capital_pct": 0.80,
            "strategies": []
        }
        response = client.post("/api/bots", json=bot_data)
        assert response.status_code == 422

    def test_create_bot_invalid_capital_pct(self, client, test_strategies):
        """Test creating bot with invalid capital_pct fails."""
        bot_data = {
            "name": "Bot",
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 1.5,
            "strategies": []
        }
        response = client.post("/api/bots", json=bot_data)
        assert response.status_code == 422


# ============================================
# 9. Process Management Tests
# ============================================

class TestProcessManagement:
    """Test bot process management functions."""

    @patch('subprocess.Popen')
    def test_start_bot_process_mock(self, mock_popen):
        """Test starting a bot process."""
        from api.bots_api.bots_router import start_bot_process
        mock_process = MagicMock()
        mock_process.pid = 12345
        mock_popen.return_value = mock_process

        with patch('api.bots_api.bots_router._db_available', True):
            process = start_bot_process(user_id=1, bot_id=1)
            assert process == mock_process

    @patch('subprocess.Popen')
    def test_stop_bot_process_mock(self, mock_popen):
        """Test stopping a bot process."""
        from api.bots_api.bots_router import stop_bot_process
        mock_process = MagicMock()
        mock_process.poll.return_value = None
        with patch('api.bots_api.bots_router._bot_processes', {1: {1: mock_process}}):
            stop_bot_process(user_id=1, bot_id=1)
            mock_process.terminate.assert_called_once()
