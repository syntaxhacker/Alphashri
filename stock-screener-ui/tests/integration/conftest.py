"""
Shared fixtures for integration tests.

Extends the API test fixtures with integration-specific fixtures:
- Extended database fixtures with sample data
- Bot lifecycle fixtures
- Trading simulation fixtures
- Journal fixtures
- Signal generation fixtures
"""

import os
import sys
import tempfile
import json
import secrets
from pathlib import Path
from typing import Generator, Optional, Dict, List
from datetime import datetime, timedelta
from dataclasses import dataclass
from unittest.mock import Mock, patch

import pytest
import pytest
import jwt
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

# Add project root to path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from db.database import Base, get_db
from db.models import User, UserSession, StrategyConfig, BotConfig, bot_strategies
from api.auth import (
    hash_password,
    create_access_token,
    create_refresh_token,
    JWT_SECRET_KEY,
    JWT_ALGORITHM,
)

# Import the FastAPI app
try:
    from api_server_fastapi import app
except ImportError:
    from fastapi import FastAPI
    from api.auth import router as auth_router
    app = FastAPI()
    app.include_router(auth_router)


# ============================================================================
# Database Fixtures
# ============================================================================

TEST_DB_DIR = tempfile.mkdtemp()
TEST_DB_PATH = os.path.join(TEST_DB_DIR, "test_integration_alphashri.db")

TEST_SQLALCHEMY_DATABASE_URL = f"sqlite:///{TEST_DB_PATH}"
test_engine = create_engine(
    TEST_SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}
)

TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    """Override get_db dependency for testing."""
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="function")
def db() -> Generator[Session, None, None]:
    """
    Create a fresh database for each integration test.

    Includes seeding of common test data (templates, default strategies).
    """
    # Create all tables
    Base.metadata.create_all(bind=test_engine)

    # Create session
    session = TestSessionLocal()

    # Seed common test data
    _seed_template_strategies(session)

    yield session

    # Cleanup: close session and drop all tables
    session.close()
    Base.metadata.drop_all(bind=test_engine)


def _seed_template_strategies(session: Session):
    """Seed template strategies for testing."""
    templates = [
        StrategyConfig(
            name="orb_conservative",
            strategy_type="ORB",
            is_template=True,
            is_active=True,
            is_default=True,
            or_minutes=30,
            sl_pct=0.3,
            tp_pct=1.0,
            min_or_range_pct=0.4,
            max_or_range_pct=2.0,
            max_positions=3,
            max_capital_per_trade_pct=0.10,
            max_daily_loss_pct=0.02,
            risk_per_trade_pct=0.01,
        ),
        StrategyConfig(
            name="orb_aggressive",
            strategy_type="ORB",
            is_template=True,
            is_active=True,
            is_default=False,
            or_minutes=15,
            sl_pct=0.5,
            tp_pct=1.5,
            min_or_range_pct=0.3,
            max_or_range_pct=3.0,
            max_positions=5,
            max_capital_per_trade_pct=0.15,
            max_daily_loss_pct=0.03,
            risk_per_trade_pct=0.015,
        ),
        StrategyConfig(
            name="orb_scalper",
            strategy_type="ORB",
            is_template=True,
            is_active=True,
            is_default=False,
            or_minutes=5,
            sl_pct=0.2,
            tp_pct=0.5,
            min_or_range_pct=0.2,
            max_or_range_pct=1.5,
            max_positions=8,
            max_capital_per_trade_pct=0.05,
            max_daily_loss_pct=0.01,
            risk_per_trade_pct=0.005,
        ),
    ]

    for template in templates:
        session.add(template)

    session.commit()


@pytest.fixture(scope="function")
def client(db: Session) -> TestClient:
    """
    Create a test client with database session.

    The client is configured to use the test database.
    """
    def override_get_db_for_client():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db_for_client

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


# ============================================================================
# User Fixtures
# ============================================================================

@pytest.fixture
def test_password() -> str:
    """Standard test password."""
    return "IntegrationTest123!"


@pytest.fixture
def test_user(db: Session, test_password: str) -> User:
    """Create a test user in the database."""
    user = User(
        email="integration@example.com",
        hashed_password=hash_password(test_password),
        display_name="Integration Test User",
        is_active=True,
        initial_capital=1000000.0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def auth_tokens(client: TestClient, test_user: User, test_password: str) -> Dict[str, str]:
    """Get auth tokens for the test user."""
    response = client.post("/api/auth/login", json={
        "email": test_user.email,
        "password": test_password
    })

    data = response.json()
    return {
        "access_token": data["access_token"],
        "refresh_token": data["refresh_token"]
    }


@pytest.fixture
def auth_headers(auth_tokens: Dict[str, str]) -> Dict[str, str]:
    """Get auth headers for API requests."""
    return {"Authorization": f"Bearer {auth_tokens['access_token']}"}


# ============================================================================
# Strategy Fixtures
# ============================================================================

@pytest.fixture
def template_strategy(db: Session) -> StrategyConfig:
    """Create a template strategy."""
    strategy = StrategyConfig(
        name="test_template_orb",
        strategy_type="ORB",
        is_template=True,
        is_active=True,
        or_minutes=30,
        sl_pct=0.4,
        tp_pct=1.2,
        max_positions=5,
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


@pytest.fixture
def user_strategy(db: Session, template_strategy: StrategyConfig) -> StrategyConfig:
    """Create a user strategy from template."""
    strategy = StrategyConfig(
        name="my_custom_orb",
        strategy_type="ORB",
        parent_id=template_strategy.id,
        is_template=False,
        is_active=True,
        or_minutes=30,
        sl_pct=0.35,  # Custom value
        tp_pct=1.5,    # Custom value
        max_positions=5,
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


@pytest.fixture
def multiple_strategies(db: Session) -> List[StrategyConfig]:
    """Create multiple strategies for testing."""
    strategies = []
    for i in range(3):
        strategy = StrategyConfig(
            name=f"test_strategy_{i}",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
            sl_pct=0.3 + i * 0.1,
            tp_pct=1.0 + i * 0.3,
            max_positions=3 + i,
        )
        db.add(strategy)
        db.commit()
        db.refresh(strategy)
        strategies.append(strategy)

    return strategies


# ============================================================================
# Bot Fixtures
# ============================================================================

@pytest.fixture
def test_bot(db: Session, multiple_strategies: List[StrategyConfig]) -> BotConfig:
    """Create a test bot with strategies."""
    bot = BotConfig(
        name="Test Bot",
        is_active=True,
        max_total_positions=10,
        max_total_capital_pct=0.8,
    )
    db.add(bot)
    db.commit()
    db.refresh(bot)

    # Add strategies
    for i, strategy in enumerate(multiple_strategies):
        db.execute(
            bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strategy.id,
                max_positions=3 + i,
                capital_allocation_pct=0.25,
            )
        )

    db.commit()
    return bot


@pytest.fixture
def running_bot(db: Session, test_bot: BotConfig) -> Dict:
    """Create a mock running bot with status data."""
    return {
        "id": test_bot.id,
        "name": test_bot.name,
        "running": True,
        "pid": 12345,
        "status": {
            "bot_id": test_bot.id,
            "bot_name": test_bot.name,
            "running": True,
            "pid": 12345,
            "portfolio": {
                "initial_capital": 1000000,
                "cash": 950000,
                "capital_used": 50000,
                "total_pnl": 500,
                "total_pnl_pct": 0.05,
            },
            "strategies": {},
            "positions": [],
        }
    }


# ============================================================================
# Journal Fixtures
# ============================================================================

@pytest.fixture
def trade_journal(tmp_path) -> Path:
    """Create a temporary journal directory."""
    journal_dir = tmp_path / "journals" / "1"
    journal_dir.mkdir(parents=True)

    from trading.journal import TradeJournal
    journal = TradeJournal(journal_dir=str(journal_dir), user_id=1)

    return journal


@pytest.fixture
def sample_trades() -> List[Dict]:
    """Sample trade data for testing."""
    return [
        {
            'trade_id': 'SAMPLE-001',
            'symbol': 'RELIANCE',
            'side': 'BUY',
            'quantity': 100,
            'entry_price': 2500.0,
            'exit_price': 2530.0,
            'entry_time': '2026-03-03T10:15:00',
            'exit_time': '2026-03-03T12:30:00',
            'pnl': 3000.0,
            'pnl_pct': 1.2,
            'exit_reason': 'TP',
            'costs': 150.0,
            'net_pnl': 2850.0,
            'sl_price': 2490.0,
            'tp_price': 2530.0,
            'strategy_id': 1,
            'strategy_name': 'ORB Conservative',
        },
        {
            'trade_id': 'SAMPLE-002',
            'symbol': 'TCS',
            'side': 'BUY',
            'quantity': 50,
            'entry_price': 3800.0,
            'exit_price': 3780.0,
            'entry_time': '2026-03-03T11:00:00',
            'exit_time': '2026-03-03T14:00:00',
            'pnl': -1000.0,
            'pnl_pct': -0.53,
            'exit_reason': 'SL',
            'costs': 95.0,
            'net_pnl': -1095.0,
            'sl_price': 3785.0,
            'tp_price': 3845.0,
            'strategy_id': 1,
            'strategy_name': 'ORB Conservative',
        },
        {
            'trade_id': 'SAMPLE-003',
            'symbol': 'INFY',
            'side': 'BUY',
            'quantity': 200,
            'entry_price': 1500.0,
            'exit_price': 1525.0,
            'entry_time': '2026-03-03T09:30:00',
            'exit_time': '2026-03-03T11:15:00',
            'pnl': 5000.0,
            'pnl_pct': 1.67,
            'exit_reason': 'TP',
            'costs': 75.0,
            'net_pnl': 4925.0,
            'sl_price': 1495.0,
            'tp_price': 1525.0,
            'strategy_id': 2,
            'strategy_name': 'ORB Aggressive',
        },
    ]


# ============================================================================
# Signal Fixtures
# ============================================================================

@pytest.fixture
def mock_signal_data():
    """Mock signal data for testing."""
    return [
        {
            "symbol": "RELIANCE",
            "signal_type": "LONG_ENTRY",
            "price": 2500.0,
            "stop_loss": 2490.0,
            "take_profit": 2530.0,
            "or_high": 2495.0,
            "or_low": 2480.0,
            "or_range_pct": 0.6,
            "timestamp": datetime.now().isoformat(),
        },
        {
            "symbol": "TCS",
            "signal_type": "LONG_ENTRY",
            "price": 3800.0,
            "stop_loss": 3785.0,
            "take_profit": 3845.0,
            "or_high": 3790.0,
            "or_low": 3770.0,
            "or_range_pct": 0.53,
            "timestamp": datetime.now().isoformat(),
        },
    ]


@dataclass
class MockPosition:
    """Mock position for testing."""
    symbol: str
    quantity: int
    entry_price: float
    current_price: float
    side: str = "BUY"
    unrealized_pnl: float = 0.0
    unrealized_pnl_pct: float = 0.0


@pytest.fixture
def mock_positions() -> List[MockPosition]:
    """Create mock positions for testing."""
    return [
        MockPosition(
            symbol="RELIANCE",
            quantity=100,
            entry_price=2500.0,
            current_price=2525.0,
            unrealized_pnl=2500.0,
            unrealized_pnl_pct=1.0,
        ),
        MockPosition(
            symbol="TCS",
            quantity=50,
            entry_price=3800.0,
            current_price=3785.0,
            unrealized_pnl=-750.0,
            unrealized_pnl_pct=-0.39,
        ),
    ]


# ============================================================================
# Portfolio Fixtures
# ============================================================================

@pytest.fixture
def mock_portfolio_state():
    """Mock portfolio state for testing."""
    return {
        "initial_capital": 1000000.0,
        "cash": 942500.0,
        "capital_used": 57500.0,
        "position_value": 57500.0,
        "total_value": 1000000.0,
        "total_pnl": 1750.0,
        "total_pnl_pct": 0.175,
        "realized_pnl": 0.0,
        "unrealized_pnl": 1750.0,
        "total_positions": 2,
        "daily_pnl": 1750.0,
        "daily_pnl_pct": 0.175,
        "daily_trades": 2,
        "trades": 2,
    }


# ============================================================================
# Snapshot Fixtures
# ============================================================================

@pytest.fixture
def mock_bot_snapshot(test_bot: BotConfig):
    """Create a mock bot snapshot for testing."""
    return {
        'timestamp': datetime.now().isoformat(),
        'bot_id': test_bot.id,
        'bot_name': test_bot.name,
        'running': True,
        'portfolio': {
            'initial_capital': 1000000,
            'cash': 950000,
            'capital_used': 50000,
            'position_value': 50000,
            'total_value': 1000000,
            'total_pnl': 500,
            'total_pnl_pct': 0.05,
            'realized_pnl': 0,
            'unrealized_pnl': 500,
            'total_positions': 1,
            'daily_pnl': 500,
        },
        'strategies': {
            '1': {
                'id': 1,
                'name': 'ORB Conservative',
                'status': 'running',
                'signals_generated': 5,
                'trades_executed': 1,
                'portfolio_status': {
                    'strategy_id': 1,
                    'strategy_name': 'ORB Conservative',
                    'capital_used': 50000,
                    'positions_count': 1,
                    'total_pnl': 500,
                },
                'scan_items': [],
            }
        },
        'positions': [
            {
                'symbol': 'TEST',
                'quantity': 50,
                'entry_price': 1000,
                'current_price': 1010,
                'unrealized_pnl': 500,
                'strategy_id': 1,
                'strategy_name': 'ORB Conservative',
            }
        ],
        'scan_items': [
            {
                'symbol': 'RELIANCE',
                'price': 2500,
                'status': 'watching',
                'strategy_name': 'ORB Conservative',
            }
        ],
    }


# ============================================================================
# Process Mocking Fixtures
# ============================================================================

@pytest.fixture
def mock_running_process():
    """Create a mock running subprocess."""
    process = Mock()
    process.pid = 12345
    process.poll = Mock(return_value=None)  # Process is running
    process.terminate = Mock()
    process.kill = Mock()
    process.wait = Mock()
    return process


@pytest.fixture
def mock_stopped_process():
    """Create a mock stopped subprocess."""
    process = Mock()
    process.pid = 12345
    process.poll = Mock(return_value=0)  # Process has exited
    return process


# ============================================================================
# Cleanup Helpers
# ============================================================================

@pytest.fixture
def cleanup_bot_processes():
    """Ensure bot processes are cleaned up after test."""
    # Import the global process tracking dict
    from api.bots import _bot_processes, _bot_logs

    # Store original state
    original_processes = _bot_processes.copy()
    original_logs = _bot_logs.copy()

    yield

    # Cleanup after test
    for user_id, bots in _bot_processes.items():
        for bot_id, process in bots.items():
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=1)
                except:
                    process.kill()

    # Clear the dicts
    _bot_processes.clear()
    _bot_logs.clear()


# ============================================================================
# Test Markers
# ============================================================================

def pytest_configure(config):
    """Configure custom pytest markers."""
    config.addinivalue_line(
        "markers", "integration: marks integration tests (deselect with '-m \"not integration\"')"
    )
    config.addinivalue_line(
        "markers", "slow: marks slow-running integration tests"
    )
    config.addinivalue_line(
        "markers", "database: marks tests requiring real database"
    )
