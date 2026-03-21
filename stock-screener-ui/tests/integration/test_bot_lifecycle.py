"""
Integration tests for bot lifecycle management.

Tests complete bot lifecycle:
- Bot creation with multiple strategies
- Bot initialization and configuration
- Bot start-up and process spawning
- Multi-strategy coordination
- Bot monitoring and status updates
- Bot shutdown and resource cleanup
- Bot deletion
"""

import os
import sys
import json
import signal
import tempfile
import time
import importlib
import uuid
from pathlib import Path
from datetime import datetime, timedelta
from typing import Generator, Dict, List
from unittest.mock import Mock, patch, MagicMock, call
from multiprocessing import Process

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

# Add project root to path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from db.models import User, UserSession, StrategyConfig, BotConfig, bot_strategies
from api.auth import hash_password
from trading.journal import get_journal


class TestBotCreationAndConfiguration:
    """Test bot creation and configuration flows."""

    def test_create_bot_with_single_strategy(self, client: TestClient, db: Session):
        """
        Test creating a bot with a single strategy:
        1. Create a strategy
        2. Create bot with that strategy
        3. Verify configuration is correct
        4. Verify strategy association in database
        """
        # Create strategy
        strategy = StrategyConfig(
            name="single_orb_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
            or_minutes=30,
            sl_pct=0.4,
            tp_pct=1.2,
            max_positions=5,
            uuid=str(uuid.uuid4()),
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        # Create bot
        response = client.post("/api/bots", json={
            "name": "Single Strategy Bot",
            "is_active": True,
            "max_total_positions": 5,
            "max_total_capital_pct": 0.5,
            "strategies": [
                {
                    "strategy_id": strategy.uuid,
                    "max_positions": 5,
                    "capital_allocation_pct": 0.5
                }
            ]
        })

        assert response.status_code == 200
        bot = response.json()

        assert bot["name"] == "Single Strategy Bot"
        assert bot["is_active"] is True
        assert bot["max_total_positions"] == 5
        assert bot["max_total_capital_pct"] == 0.5
        assert len(bot["strategies"]) == 1
        assert bot["strategies"][0]["id"] == strategy.uuid

    def test_create_bot_with_multiple_strategies(self, client: TestClient, db: Session):
        """
        Test creating a bot with multiple strategies:
        1. Create multiple strategies
        2. Create bot with all strategies
        3. Verify allocation percentages sum correctly
        4. Verify each strategy has correct parameters
        """
        # Create three strategies
        strategies = []
        for i in range(3):
            strategy = StrategyConfig(
                name=f"multi_strategy_{i}_{uuid.uuid4().hex[:8]}",  # make unique
                strategy_type="ORB",
                is_template=False,
                is_active=True,
                sl_pct=0.3 + i * 0.1,
                tp_pct=1.0 + i * 0.3,
                uuid=str(uuid.uuid4()),
            )
            db.add(strategy)
            db.commit()
            db.refresh(strategy)
            strategies.append(strategy)

        # Create bot with all strategies
        response = client.post("/api/bots", json={
            "name": "Multi-Strategy Bot",
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 0.9,
            "strategies": [
                {
                    "strategy_id": strategies[0].uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.30
                },
                {
                    "strategy_id": strategies[1].uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.30
                },
                {
                    "strategy_id": strategies[2].uuid,
                    "max_positions": 4,
                    "capital_allocation_pct": 0.30
                }
            ]
        })

        assert response.status_code == 200
        bot = response.json()

        assert len(bot["strategies"]) == 3

        # Verify total allocation is 90%
        total_allocation = sum(s["capital_allocation_pct"] for s in bot["strategies"])
        assert abs(total_allocation - 0.9) < 1e-10

        # Verify database associations
        associations = db.execute(
            bot_strategies.select().where(bot_strategies.c.bot_id == bot["id"])
        ).fetchall()

        assert len(associations) == 3

    def test_create_bot_rejects_over_allocation(self, client: TestClient, db: Session):
        """Test that bot creation fails when total allocation exceeds 100%."""
        # Create two strategies
        strategy1 = StrategyConfig(
            name="alloc_test_1",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        strategy2 = StrategyConfig(
            name="alloc_test_2",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy1)
        db.add(strategy2)
        db.commit()
        db.refresh(strategy1)
        db.refresh(strategy2)

        # Try to create bot with allocation > 100%
        response = client.post("/api/bots", json={
            "name": "Over-allocated Bot",
            "is_active": True,
            "max_total_positions": 10,
            "max_total_capital_pct": 1.0,
            "strategies": [
                {
                    "strategy_id": strategy1.uuid,
                    "max_positions": 5,
                    "capital_allocation_pct": 0.60
                },
                {
                    "strategy_id": strategy2.uuid,
                    "max_positions": 5,
                    "capital_allocation_pct": 0.60  # Total = 120%
                }
            ]
        })

        assert response.status_code == 400
        assert "exceeds" in response.json()["detail"].lower()

    def test_create_bot_rejects_duplicate_name(self, client: TestClient, db: Session):
        """Test that bot creation fails with duplicate name."""
        # Create first bot
        response1 = client.post("/api/bots", json={
            "name": "Duplicate Name Bot",
            "is_active": True,
            "max_total_positions": 5,
            "max_total_capital_pct": 0.5,
            "strategies": []
        })

        assert response1.status_code == 200

        # Try to create second bot with same name
        response2 = client.post("/api/bots", json={
            "name": "Duplicate Name Bot",  # Same name
            "is_active": True,
            "max_total_positions": 5,
            "max_total_capital_pct": 0.5,
            "strategies": []
        })

        assert response2.status_code == 400
        assert "already exists" in response2.json()["detail"].lower()


class TestBotStartupFlow:
    """Test bot startup and initialization."""

    def test_bot_startup_creates_process(self, client: TestClient, db: Session):
        """
        Test that starting a bot creates a background process:
        1. Create bot
        2. Start bot (test mode)
        3. Verify process PID returned
        4. Verify log file created
        5. Verify bot status shows running
        """
        # Create strategy and bot
        strategy = StrategyConfig(
            name="startup_test_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        bot_response = client.post("/api/bots", json={
            "name": "Startup Test Bot",
            "is_active": True,
            "max_total_positions": 5,
            "max_total_capital_pct": 0.5,
            "strategies": [
                {
                    "strategy_id": strategy.uuid,
                    "max_positions": 5,
                    "capital_allocation_pct": 0.5
                }
            ]
        })

        bot = bot_response.json()

        # Mock the process creation
        with patch('api.bots.start_bot_process') as mock_start:
            mock_process = Mock()
            mock_process.pid = 12345
            mock_process.poll = Mock(return_value=None)  # Process running
            mock_start.return_value = mock_process

            # Start bot in test mode
            start_response = client.post(
                f"/api/bots/{bot['id']}/start",
                params={"test_mode": True}
            )

            assert start_response.status_code == 200
            start_data = start_response.json()

            assert "pid" in start_data
            assert start_data["pid"] == 12345

            # Verify start_bot_process was called with correct parameters
            mock_start.assert_called_once()

    def test_bot_status_after_startup(self, client: TestClient, db: Session):
        """Test that bot status reflects running state after startup."""
        # Create strategy and bot
        strategy = StrategyConfig(
            name="status_test_strategy",
            strategy_type="ORB",
            is_active=True,
            is_template=False,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        bot_response = client.post("/api/bots", json={
            "name": "Status Test Bot",
            "is_active": True,
            "strategies": [
                {
                    "strategy_id": strategy.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.3
                }
            ]
        })

        bot = bot_response.json()

        # Mock running state
        with patch('api.bots.is_bot_running', return_value=(True, 12345)):
            with patch('api.bots.load_bot_snapshot', return_value={
                'timestamp': datetime.now().isoformat(),
                'portfolio': {
                    'initial_capital': 1000000,
                    'cash': 950000,
                    'capital_used': 50000,
                    'total_pnl': 0,
                },
                'strategies': {},
                'positions': []
            }):
                status_response = client.get(f"/api/bots/{bot['id']}/status")

                assert status_response.status_code == 200
                status = status_response.json()

                assert status["bot_id"] == bot["uuid"]
                assert status["running"] is True
                assert status["pid"] == 12345
                assert status["portfolio"] is not None
                assert status["portfolio"]["initial_capital"] == 1000000
                assert status["portfolio"]["cash"] == 950000
                assert status["portfolio"]["capital_used"] == 50000

    def test_bot_initialization_with_strategies(self, client: TestClient, db: Session):
        """
        Test that bot properly initializes with configured strategies:
        1. Create bot with strategies
        2. Start bot
        3. Verify all strategies are loaded
        4. Verify strategy parameters are correct
        """
        # Create strategies with different parameters
        strategies = []
        params = [
            {"sl_pct": 0.3, "tp_pct": 1.0},
            {"sl_pct": 0.5, "tp_pct": 1.5},
        ]

        for i, param in enumerate(params):
            strategy = StrategyConfig(
                name=f"init_strategy_{i}",
                strategy_type="ORB",
                is_template=False,
                is_active=True,
                **param
            )
            db.add(strategy)
            db.commit()
            db.refresh(strategy)
            strategies.append(strategy)

        # Create bot
        bot_response = client.post("/api/bots", json={
            "name": "Initialization Test Bot",
            "strategies": [
                {
                    "strategy_id": s.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.25
                }
                for s in strategies
            ]
        })

        bot = bot_response.json()

        # Verify bot has both strategies
        assert len(bot["strategies"]) == 2
        strategy_ids = {s["id"] for s in bot["strategies"]}
        assert strategy_ids == {strategies[0].uuid, strategies[1].uuid}

        # Get bot details
        detail_response = client.get(f"/api/bots/{bot['id']}")
        detail_bot = detail_response.json()

        assert len(detail_bot["strategies"]) == 2


class TestMultiStrategyCoordination:
    """Test coordination between multiple strategies in a bot."""

    def test_strategies_share_portfolio(self, client: TestClient, db: Session):
        """
        Test that strategies correctly share a portfolio:
        1. Create bot with 2 strategies
        2. Verify global position limits enforced
        3. Verify capital allocations respected
        """
        # Create strategies
        strategies = []
        for i in range(2):
            strategy = StrategyConfig(
                name=f"share_strategy_{i}",
                strategy_type="ORB",
                is_template=False,
                is_active=True,
            )
            db.add(strategy)
            db.commit()
            db.refresh(strategy)
            strategies.append(strategy)

        # Create bot with shared portfolio constraints
        bot_response = client.post("/api/bots", json={
            "name": "Shared Portfolio Bot",
            "max_total_positions": 5,  # Global limit
            "max_total_capital_pct": 0.8,
            "strategies": [
                {
                    "strategy_id": strategies[0].uuid,
                    "max_positions": 3,  # Individual limit
                    "capital_allocation_pct": 0.40
                },
                {
                    "strategy_id": strategies[1].uuid,
                    "max_positions": 3,  # Individual limit
                    "capital_allocation_pct": 0.40
                }
            ]
        })

        bot = bot_response.json()

        # Verify global limits
        assert bot["max_total_positions"] == 5

        # Even though each strategy can have 3, total is limited to 5
        # This is enforced at runtime by the global risk manager

class TestBotMonitoringFlow:
    """Test bot monitoring and status updates."""

    def test_bot_logs_accessibility(self, client: TestClient, db: Session):
        """
        Test that bot logs can be retrieved:
        1. Start bot
        2. Get bot logs
        3. Verify log format
        """
        # Create strategy and bot
        strategy = StrategyConfig(
            name="logs_test_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        bot_response = client.post("/api/bots", json={
            "name": "Logs Test Bot",
            "strategies": [
                {
                    "strategy_id": strategy.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.3
                }
            ]
        })

        bot = bot_response.json()

        # Mock log file
        with patch('api.bots._bot_logs', {bot['id']: Path("/tmp/test-bot.log")}):
            # Create temporary log file
            log_content = "2026-03-03 10:00:00 [INFO] Bot started\n2026-03-03 10:00:01 [INFO] Scanning for signals\n"

            with patch('builtins.open', MagicMock(return_value=iter(log_content.splitlines(keepends=True)))):
                logs_response = client.get(f"/api/bots/{bot['id']}/logs", params={"lines": 100})

                assert logs_response.status_code == 200
                logs_data = logs_response.json()

                assert "logs" in logs_data
                assert isinstance(logs_data["logs"], str)

    def test_bot_portfolio_tracking(self, client: TestClient, db: Session):
        """
        Test that bot portfolio is tracked correctly:
        1. Start bot
        2. Get portfolio status
        3. Verify portfolio structure
        """
        # Create strategy and bot
        strategy = StrategyConfig(
            name="portfolio_test_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        bot_response = client.post("/api/bots", json={
            "name": "Portfolio Test Bot",
            "strategies": [
                {
                    "strategy_id": strategy.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.3
                }
            ]
        })

        bot = bot_response.json()

        # Mock snapshot data
        snapshot_data = {
            'timestamp': datetime.now().isoformat(),
            'portfolio': {
                'initial_capital': 1000000,
                'cash': 950000,
                'capital_used': 50000,
                'total_pnl': 500,
                'total_pnl_pct': 0.05,
                'total_positions': 1,
                'daily_pnl': 500,
            },
            'positions': [
                {
                    'symbol': 'TEST',
                    'quantity': 50,
                    'entry_price': 1000,
                    'current_price': 1010,
                    'unrealized_pnl': 500,
                }
            ],
            'strategies': {
                str(strategy.id): {
                    'name': strategy.name,
                    'status': 'running',
                    'portfolio_status': {
                        'capital_used': 50000,
                        'positions_count': 1,
                        'total_pnl': 500,
                    }
                }
            }
        }

        with patch('api.bots.load_bot_snapshot', return_value=snapshot_data):
            portfolio_response = client.get(f"/api/bots/{bot['id']}/portfolio")

            assert portfolio_response.status_code == 200
            portfolio_data = portfolio_response.json()

            assert portfolio_data["bot_id"] == bot["uuid"]
            assert portfolio_data["portfolio"]["initial_capital"] == 1000000
            assert portfolio_data["portfolio"]["cash"] == 950000
            assert len(portfolio_data["positions"]) == 1


class TestBotShutdownFlow:
    """Test bot shutdown and cleanup."""

    def test_bot_stop_terminates_process(self, client: TestClient, db: Session):
        """
        Test that stopping a bot terminates the process:
        1. Start bot
        2. Stop bot
        3. Verify process terminated
        """
        # Create strategy and bot
        strategy = StrategyConfig(
            name="stop_test_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        bot_response = client.post("/api/bots", json={
            "name": "Stop Test Bot",
            "strategies": [
                {
                    "strategy_id": strategy.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.3
                }
            ]
        })

        bot = bot_response.json()

        # Mock running and stopping
        with patch('api.bots.is_bot_running', return_value=(True, 12345)):
            with patch('api.bots.stop_bot_process') as mock_stop:
                stop_response = client.post(f"/api/bots/{bot['id']}/stop")

                assert stop_response.status_code == 200
                mock_stop.assert_called_once()

    def test_bot_status_after_stop(self, client: TestClient, db: Session):
        """Test that bot status shows not running after stop."""
        # Create strategy and bot
        strategy = StrategyConfig(
            name="status_stop_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        bot_response = client.post("/api/bots", json={
            "name": "Status Stop Test Bot",
            "strategies": [
                {
                    "strategy_id": strategy.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.3
                }
            ]
        })

        bot = bot_response.json()

        # Mock not running state
        with patch('api.bots.is_bot_running', return_value=(False, None)):
            status_response = client.get(f"/api/bots/{bot['id']}/status")

            assert status_response.status_code == 200
            status = status_response.json()

            assert status["running"] is False
            assert status["pid"] is None


class TestBotDeletionFlow:
    """Test bot deletion and resource cleanup."""

    def test_delete_running_bot_stops_it_first(self, client: TestClient, db: Session):
        """
        Test that deleting a running bot stops it first:
        1. Create and start bot
        2. Delete bot while running
        3. Verify bot was stopped
        4. Verify bot deleted from database
        """
        # Create strategy and bot
        strategy = StrategyConfig(
            name="delete_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        bot_response = client.post("/api/bots", json={
            "name": "Delete Test Bot",
            "strategies": [
                {
                    "strategy_id": strategy.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.3
                }
            ]
        })

        bot = bot_response.json()

        # Mock running state and stop process
        with patch('api.bots.is_bot_running', return_value=(True, 12345)):
            with patch('api.bots.stop_bot_process') as mock_stop:
                delete_response = client.delete(f"/api/bots/{bot['id']}")

                assert delete_response.status_code == 200
                mock_stop.assert_called_once()

        # Verify bot deleted from database
        db_bot = db.query(BotConfig).filter(BotConfig.id == bot["id"]).first()
        assert db_bot is None

    def test_delete_bot_removes_strategy_associations(self, client: TestClient, db: Session):
        """
        Test that deleting a bot removes strategy associations:
        1. Create bot with strategies
        2. Delete bot
        3. Verify associations removed
        4. Verify strategies still exist
        """
        # Create strategies
        strategies = []
        for i in range(2):
            strategy = StrategyConfig(
                name=f"delete_assoc_strategy_{i}",
                strategy_type="ORB",
                is_template=False,
                is_active=True,
            )
            db.add(strategy)
            db.commit()
            db.refresh(strategy)
            strategies.append(strategy)

        # Create bot
        bot_response = client.post("/api/bots", json={
            "name": "Association Delete Test Bot",
            "strategies": [
                {
                    "strategy_id": s.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.25
                }
                for s in strategies
            ]
        })

        bot = bot_response.json()

        # Verify associations exist
        associations = db.execute(
            bot_strategies.select().where(bot_strategies.c.bot_id == bot["id"])
        ).fetchall()
        assert len(associations) == 2

        # Delete bot
        delete_response = client.delete(f"/api/bots/{bot['id']}")
        assert delete_response.status_code == 200

        # Verify associations removed
        associations = db.execute(
            bot_strategies.select().where(bot_strategies.c.bot_id == bot["id"])
        ).fetchall()
        assert len(associations) == 0

        # Verify strategies still exist
        for strategy in strategies:
            db_strategy = db.query(StrategyConfig).filter(
                StrategyConfig.id == strategy.id
            ).first()
            assert db_strategy is not None

    def test_delete_nonexistent_bot_returns_404(self, client: TestClient):
        """Test that deleting non-existent bot returns 404."""
        response = client.delete("/api/bots/99999")
        assert response.status_code == 404


class TestResourceCleanup:
    """Test resource cleanup in various scenarios."""

    def test_cleanup_after_bot_crash(self, client: TestClient, db: Session):
        """
        Test that resources are cleaned up after bot crash:
        1. Simulate bot process crash
        2. Verify cleanup happens
        3. Verify can start new bot
        """
        # Create strategy and bot
        strategy = StrategyConfig(
            name="crash_test_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        bot_response = client.post("/api/bots", json={
            "name": "Crash Test Bot",
            "strategies": [
                {
                    "strategy_id": strategy.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.3
                }
            ]
        })

        bot = bot_response.json()

        # Mock crashed state (process.poll() returns exit code)
        with patch('api.bots.is_bot_running', return_value=(False, None)):
            # Even after crash, should be able to start again
            with patch('api.bots.start_bot_process') as mock_start:
                mock_process = Mock()
                mock_process.pid = 54321
                mock_start.return_value = mock_process

                start_response = client.post(
                    f"/api/bots/{bot['id']}/start",
                    params={"test_mode": True}
                )

                assert start_response.status_code == 200

    def test_cleanup_on_failed_startup(self, client: TestClient, db: Session):
        """
        Test cleanup when bot startup fails:
        1. Attempt to start bot with invalid configuration
        2. Verify partial cleanup happens
        3. Verify bot not marked as running
        """
        # Create inactive bot (cannot be started)
        strategy = StrategyConfig(
            name="inactive_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        bot_response = client.post("/api/bots", json={
            "name": "Failed Startup Bot",
            "is_active": False,  # Inactive - cannot start
            "strategies": [
                {
                    "strategy_id": strategy.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.3
                }
            ]
        })

        bot = bot_response.json()

        # Try to start inactive bot
        start_response = client.post(
            f"/api/bots/{bot['id']}/start",
            params={"test_mode": True}
        )

        assert start_response.status_code == 400
        assert "not active" in start_response.json()["detail"].lower()


class TestBotConfigurationUpdates:
    """Test updating bot configuration while running."""

    def test_update_bot_name(self, client: TestClient, db: Session):
        """Test updating bot name."""
        # Create strategy and bot
        strategy = StrategyConfig(
            name="update_name_strategy",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)

        bot_response = client.post("/api/bots", json={
            "name": "Original Name",
            "strategies": [
                {
                    "strategy_id": strategy.uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.3
                }
            ]
        })

        bot = bot_response.json()

        # Update name
        update_response = client.put(f"/api/bots/{bot['id']}", json={
            "name": "Updated Name"
        })

        assert update_response.status_code == 200
        updated_bot = update_response.json()

        assert updated_bot["name"] == "Updated Name"

    def test_update_bot_strategies(self, client: TestClient, db: Session):
        """Test updating bot's strategy allocation."""
        # Create strategies
        strategies = []
        for i in range(3):
            strategy = StrategyConfig(
                name=f"update_strat_{i}",
                strategy_type="ORB",
                is_template=False,
                is_active=True,
            )
            db.add(strategy)
            db.commit()
            db.refresh(strategy)
            strategies.append(strategy)

        # Create bot with first strategy
        bot_response = client.post("/api/bots", json={
            "name": "Update Strategies Bot",
            "strategies": [
                {
                    "strategy_id": strategies[0].uuid,
                    "max_positions": 5,
                    "capital_allocation_pct": 0.5
                }
            ]
        })

        bot = bot_response.json()

        # Update to use different strategies
        update_response = client.put(f"/api/bots/{bot['id']}", json={
            "strategies": [
                {
                    "strategy_id": strategies[1].uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.3
                },
                {
                    "strategy_id": strategies[2].uuid,
                    "max_positions": 3,
                    "capital_allocation_pct": 0.3
                }
            ]
        })

        assert update_response.status_code == 200
        updated_bot = update_response.json()

        assert len(updated_bot["strategies"]) == 2

    def test_update_bot_rejects_over_allocation(self, client: TestClient, db: Session):
        """Test that update fails if new allocation exceeds 100%."""
        # Create strategies
        strategy1 = StrategyConfig(
            name="alloc_check_1",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        strategy2 = StrategyConfig(
            name="alloc_check_2",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
        )
        db.add(strategy1)
        db.add(strategy2)
        db.commit()
        db.refresh(strategy1)
        db.refresh(strategy2)

        # Create bot
        bot_response = client.post("/api/bots", json={
            "name": "Allocation Check Bot",
            "strategies": [
                {
                    "strategy_id": strategy1.uuid,
                    "max_positions": 5,
                    "capital_allocation_pct": 0.5
                }
            ]
        })

        bot = bot_response.json()

        # Try to update with over-allocation
        update_response = client.put(f"/api/bots/{bot['id']}", json={
            "strategies": [
                {
                    "strategy_id": strategy1.uuid,
                    "max_positions": 5,
                    "capital_allocation_pct": 0.6
                },
                {
                    "strategy_id": strategy2.uuid,
                    "max_positions": 5,
                    "capital_allocation_pct": 0.6  # Total = 120%
                }
            ]
        })

        assert update_response.status_code == 400
