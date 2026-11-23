"""
Centralized test fixtures for hybrid testing strategy.
Provides both integration test fixtures (real DB) and unit test fixtures (mocks).
"""
import pytest
import uuid
import json
import bcrypt
from pathlib import Path
from datetime import datetime
from typing import Generator
from unittest.mock import MagicMock, Mock, patch
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from db.database import Base, get_db
from db.models import User, BotConfig, StrategyConfig
from fastapi import FastAPI
from api.auth import hash_password, get_current_user
from tests.helpers.db import import_all_models


def _fixture_hash(password: str) -> str:
    """Fixture-only bcrypt hash at cost 4; production hashing is untouched."""
    return bcrypt.hashpw(
        password.encode("utf-8"), bcrypt.gensalt(rounds=4)
    ).decode("utf-8")


# CI selects unit/API tests with a marker *exclusion* filter, which also has to
# catch unmarked tests. A few integration/contract modules rely on their path
# instead of a marker, so tag them by path at collection time. Adding markers
# here never skips a test: it only makes -m filters see the real category.
_PATH_MARKERS = (
    ("tests/integration/", pytest.mark.integration),
    ("tests/contract/", pytest.mark.contract),
    ("tests/e2e/", pytest.mark.e2e),
    ("tests/testcontainers/", pytest.mark.testcontainers),
    # These are first-class API/unit suites for the paper/replay feature, but
    # predate the marker convention. They must run in the develop PR tier when
    # api/** or options_paper/** changes, not only on the nightly sweep.
    ("tests/test_options_paper", pytest.mark.unit),
    ("tests/api/test_options_paper", pytest.mark.unit),
    ("tests/test_replay_phase2.py", pytest.mark.unit),
)


def pytest_collection_modifyitems(items):
    for item in items:
        rel = item.path.relative_to(item.config.rootpath).as_posix()
        for prefix, marker in _PATH_MARKERS:
            if rel.startswith(prefix):
                item.add_marker(marker)
                break
        else:
            # Only the three root-level modules pytest.ini tries to ignore via
            # its (non-functional) `ignore =` key. test_news_integration.py in
            # tests/api/ is fully mocked and must stay in the unit shards.
            if rel.startswith("tests/") and "/" not in rel[6:] and rel.endswith("_integration.py"):
                item.add_marker(pytest.mark.integration)


@pytest.fixture(scope="session")
def _schema_template():
    """Schema-only in-memory engine shared as the clone source for every test."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    import_all_models()
    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture(scope="function")
def test_db_engine(_schema_template):
    """Fresh in-memory SQLite database per test, cloned from the shared schema.

    A full SQLite backup of an empty schema is ~3 ms versus ~80-180 ms for
    ``create_all`` + ``drop_all``. Each test still gets its own connection and
    database, so direct ``sessionmaker(bind=test_db_engine)`` consumers that
    commit cannot leak rows into the next test.
    """
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    with _schema_template.raw_connection() as src_proxy:
        with engine.raw_connection() as dst_proxy:
            src_proxy.driver_connection.backup(dst_proxy.driver_connection)
    yield engine
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
        db.rollback()
        db.close()


# ============================================================================
# API-only fixtures (mirrored from tests/api/conftest.py)
# ----------------------------------------------------------------------------
# These live in the root conftest so they resolve even when pytest skips the
# api conftest during collection (e.g. reversed explicit-file args, where only
# the first argument's conftest chain is loaded). The api conftest still
# defines the same names, so tests under tests/api/ keep using the closer
# definition. Keep these in sync with tests/api/conftest.py.
# ============================================================================

@pytest.fixture(scope="function")
def test_engine(_schema_template):
    # `db` rolls back a connection transaction but a committed session still
    # writes to the engine, so each test needs its own database. Cloning the
    # shared schema keeps that isolation without a per-test create_all.
    from db.models import User, UserSession, StrategyConfig, BotConfig, BacktestResult, BrokerConnection, NewsArticle, NewsSymbolMention, LLMRun, Instrument, Trade, Position, MarketHoliday, Stock52WeekTouch, Screener

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    with _schema_template.raw_connection() as src:
        with engine.raw_connection() as dst:
            src.driver_connection.backup(dst.driver_connection)
    yield engine
    engine.dispose()


@pytest.fixture(scope="function")
def db(test_engine) -> Generator[Session, None, None]:
    TestSessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=test_engine
    )

    connection = test_engine.connect()
    transaction = connection.begin()

    session = TestSessionLocal(bind=connection)

    @event.listens_for(session, "after_transaction_end")
    def restart_savepoint(db_session, transaction):
        if transaction.nested and not transaction._parent.nested:
            db_session.expire_all()
            db_session.begin_nested()

    session.begin_nested()

    yield session

    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture(scope="function")
def auth_client(db: Session) -> TestClient:
    from api_server_fastapi import app

    def override_get_db_for_client():
        yield db

    test_user = User(
        email="test@example.com",
        hashed_password=_fixture_hash("TestPassword123!"),
        display_name="Test User",
        is_active=True,
        id=1,
    )
    db.add(test_user)
    db.commit()

    def override_get_current_user():
        return test_user

    app.dependency_overrides[get_db] = override_get_db_for_client
    app.dependency_overrides[get_current_user] = override_get_current_user

    # No `with`: entering the app lifespan per test starts network-backed
    # background tasks that wedge TestClient.__exit__ (see tests/api/conftest.py).
    test_client = TestClient(app)
    try:
        yield test_client
    finally:
        test_client.close()
        app.dependency_overrides.clear()



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



@pytest.fixture
def client_with_db(test_db_engine, test_user):
    """Create test client with test database and auth override."""
    from api.bots_api import router as bots_router
    from api.trading_agents import router as trading_agents_router
    from db.models import bot_strategies

    app = FastAPI()
    app.include_router(bots_router)
    app.include_router(trading_agents_router)
    
    TestSessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=test_db_engine
    )
    
    import_all_models()
    Base.metadata.create_all(bind=test_db_engine)
    
    def override_get_db():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()
    
    app.dependency_overrides[get_db] = override_get_db
    
    try:
        from api.auth import get_current_user
        app.dependency_overrides[get_current_user] = lambda: test_user
    except ImportError:
        pass
    
    with TestClient(app) as client:
        yield client
    
    app.dependency_overrides.clear()


@pytest.fixture
def client(test_db_engine):
    """Basic test client with test database (no auth override)."""
    from api.bots_api import router as bots_router
    from api.trading_agents import router as trading_agents_router

    app = FastAPI()
    app.include_router(bots_router)
    app.include_router(trading_agents_router)
    
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



@pytest.fixture(autouse=True, scope="function")
def reset_trading_module_state():
    """Reset trading module state before and after each test."""
    def _reset():
        try:
            import trading.orb_signals as orb_mod
            for attr in ("or_levels", "active_signals"):
                val = getattr(orb_mod.ORBSignalGenerator, attr, None) if hasattr(orb_mod, "ORBSignalGenerator") else None
            # instance caches are per-generator; clear any module-level dicts
            for name in ("_signal_state", "or_levels", "active_signals"):
                if hasattr(orb_mod, name):
                    v = getattr(orb_mod, name)
                    if isinstance(v, dict):
                        v.clear()
        except ImportError:
            pass
        try:
            from trading import multi_strategy_runner
            for name in ("_runner_state", "_active_runners"):
                if hasattr(multi_strategy_runner, name):
                    v = getattr(multi_strategy_runner, name)
                    if isinstance(v, dict):
                        v.clear()
        except ImportError:
            pass
        try:
            import api.paper_trading as paper_trading
            for name in ("_user_snapshot_files", "_user_pid_files"):
                if hasattr(paper_trading, name):
                    v = getattr(paper_trading, name)
                    if isinstance(v, dict):
                        v.clear()
        except (ImportError, AttributeError):
            pass

    _reset()
    yield
    _reset()
