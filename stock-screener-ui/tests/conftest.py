"""
Centralized test fixtures for hybrid testing strategy.
Provides both integration test fixtures (real DB) and unit test fixtures (mocks).
"""
import pytest
import uuid
import json
from pathlib import Path
from datetime import datetime
from unittest.mock import MagicMock, Mock, patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from db.database import Base, get_db
from db.models import User, BotConfig, StrategyConfig
from fastapi import FastAPI


# ============================================================================
# Test Database Fixtures (Integration Tests)
# ============================================================================

@pytest.fixture(scope="function")
def test_db_engine():
    """Create isolated in-memory SQLite database for each test."""
    from sqlalchemy.pool import StaticPool
    
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    
    # Create all tables
    Base.metadata.create_all(bind=engine)
    
    yield engine
    
    # Cleanup
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture(scope="function")
def test_db(test_db_engine):
    """Create database session with auto-rollback for isolation."""
    TestSessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=test_db_engine
    )
    
    db = TestSessionLocal()
    
    try:
        yield db
    finally:
        # Rollback all changes
        db.rollback()
        db.close()


# ============================================================================
# User Fixtures
# ============================================================================

@pytest.fixture
def test_user(test_db):
    """Create a test user in test database."""
    user = User(
        email=f"test-{uuid.uuid4()}@example.com",
        hashed_password="hashed_password",
        display_name="Test User"
    )
    test_db.add(user)
    test_db.commit()
    test_db.refresh(user)
    return user


@pytest.fixture
def test_user_id(test_user):
    """Return test user ID."""
    return test_user.id


@pytest.fixture
def test_user_uuid(test_user):
    """Return test user UUID."""
    return test_user.uuid


# ============================================================================
# Strategy Fixtures
# ============================================================================

@pytest.fixture
def test_strategy(test_db):
    """Create a test strategy in test database."""
    strategy = StrategyConfig(
        name=f"Test Strategy {uuid.uuid4()}",
        strategy_type="ORB",
        is_template=True,
        is_active=True,
        sl_pct=0.4,
        tp_pct=1.2,
        max_positions=5
    )
    test_db.add(strategy)
    test_db.commit()
    test_db.refresh(strategy)
    return strategy


@pytest.fixture
def test_strategy_uuid(test_strategy):
    """Return test strategy UUID."""
    return test_strategy.uuid


# ============================================================================
# Bot Fixtures
# ============================================================================

@pytest.fixture
def test_bot(test_db, test_user):
    """Create a test bot in test database."""
    bot = BotConfig(
        name=f"Test Bot {uuid.uuid4()}",
        user_id=test_user.id,
        is_active=True,
        max_total_positions=10,
        max_total_capital_pct=0.80
    )
    test_db.add(bot)
    test_db.commit()
    test_db.refresh(bot)
    return bot


@pytest.fixture
def test_bot_uuid(test_bot):
    """Return test bot UUID."""
    return test_bot.uuid


# ============================================================================
# API Client Fixtures
# ============================================================================

@pytest.fixture
def client_with_db(test_db_engine, test_user):
    """Create test client with test database and auth override."""
    from api.bots import router as bots_router
    from db.models import bot_strategies
    
    app = FastAPI()
    app.include_router(bots_router)
    
    TestSessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=test_db_engine
    )
    
    Base.metadata.create_all(bind=test_db_engine)
    
    def override_get_db():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()
    
    app.dependency_overrides[get_db] = override_get_db
    
    try:
        from api.auth import get_current_user_optional
        app.dependency_overrides[get_current_user_optional] = lambda: test_user
    except ImportError:
        pass
    
    with TestClient(app) as client:
        yield client
    
    app.dependency_overrides.clear()


@pytest.fixture
def client(test_db_engine):
    """Basic test client with test database (no auth override)."""
    from api.bots import router as bots_router
    
    app = FastAPI()
    app.include_router(bots_router)
    
    TestSessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=test_db_engine
    )
    
    def override_get_db():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()
    
    app.dependency_overrides[get_db] = override_get_db
    
    with TestClient(app) as test_client:
        yield test_client
    
    app.dependency_overrides.clear()


# ============================================================================
# Mock Fixtures (Unit Tests)
# ============================================================================

@pytest.fixture
def mock_db():
    """Create mock database session for unit tests."""
    mock_session = MagicMock()
    
    # Mock common database operations
    mock_session.add = MagicMock()
    mock_session.commit = MagicMock()
    mock_session.rollback = MagicMock()
    mock_session.refresh = MagicMock()
    mock_session.flush = MagicMock()
    mock_session.close = MagicMock()
    
    # Mock query chains
    mock_session.query.return_value.filter.return_value.first.return_value = None
    mock_session.query.return_value.filter.return_value.all.return_value = []
    mock_session.query.return_value.filter.return_value.filter.return_value.first.return_value = None
    
    return mock_session


@pytest.fixture
def mock_user():
    """Create mock user object."""
    user = MagicMock()
    user.id = 1
    user.uuid = str(uuid.uuid4())
    user.email = "mock@example.com"
    user.display_name = "Mock User"
    return user


@pytest.fixture
def mock_bot():
    """Create mock bot object."""
    bot = MagicMock()
    bot.id = 1
    bot.uuid = str(uuid.uuid4())
    bot.name = "Mock Bot"
    bot.user_id = 1
    bot.is_active = True
    bot.max_total_positions = 10
    bot.max_total_capital_pct = 0.80
    bot.created_at = datetime.now()
    bot.updated_at = datetime.now()
    bot.strategies = []
    return bot


@pytest.fixture
def mock_strategy():
    """Create mock strategy object."""
    strategy = MagicMock()
    strategy.id = 1
    strategy.uuid = str(uuid.uuid4())
    strategy.name = "Mock Strategy"
    strategy.strategy_type = "ORB"
    strategy.is_template = True
    strategy.is_active = True
    return strategy


# ============================================================================
# Test Data Fixtures
# ============================================================================

@pytest.fixture
def sample_bot_data():
    """Sample bot creation data."""
    return {
        "name": f"Test Bot {uuid.uuid4()}",
        "is_active": True,
        "max_total_positions": 10,
        "max_total_capital_pct": 0.80
    }


@pytest.fixture
def sample_strategy_data(test_strategy_uuid):
    """Sample strategy allocation data."""
    return {
        "strategy_id": test_strategy_uuid,
        "max_positions": 3,
        "capital_allocation_pct": 0.40
    }


# ============================================================================
# Snapshot Fixtures
# ============================================================================

@pytest.fixture
def temp_snapshot_dir(tmp_path):
    """Create temporary directory for bot snapshots."""
    snapshot_dir = tmp_path / "snapshots"
    snapshot_dir.mkdir()
    return snapshot_dir


@pytest.fixture
def sample_bot_snapshot(temp_snapshot_dir):
    """Create sample bot snapshot file."""
    snapshot = {
        "timestamp": datetime.now().isoformat(),
        "portfolio": {
            "initial_capital": 1000000,
            "cash": 600000,
            "margin_used": 400000,
            "total_value": 1000000,
            "total_pnl": 0.0,
            "total_pnl_pct": 0.0,
            "daily_pnl": 0.0,
            "total_positions": 0
        },
        "positions": [],
        "strategies": {}
    }
    
    snapshot_file = temp_snapshot_dir / "bot-snapshot.json"
    snapshot_file.write_text(json.dumps(snapshot))
    return snapshot_file


# ============================================================================
# Utility Fixtures
# ============================================================================

@pytest.fixture
def validate_uuid():
    """UUID validation helper."""
    def _validate(uuid_str):
        try:
            uuid.UUID(uuid_str)
            return True
        except (ValueError, AttributeError):
            return False
    return _validate
