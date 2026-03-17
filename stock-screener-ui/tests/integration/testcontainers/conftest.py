"""
Testcontainers fixtures for real PostgreSQL testing.

Provides session-scoped PostgreSQL container to avoid startup overhead for each test.
Catches differences between SQLite and PostgreSQL:
- Case sensitivity in strings
- JSON handling differences
- Constraint enforcement differences
- Transaction behavior differences
"""

import sys
import subprocess
from pathlib import Path
from typing import Generator
import time

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.exc import OperationalError

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

try:
    from testcontainers.postgres import PostgresContainer
    TESTCONTAINERS_AVAILABLE = True
except ImportError:
    TESTCONTAINERS_AVAILABLE = False
    PostgresContainer = None


def is_docker_available() -> bool:
    """Check if Docker daemon is running."""
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=5
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


DOCKER_AVAILABLE = is_docker_available()

from db.database import Base, get_db
from db.models import User, UserSession, StrategyConfig, BotConfig, bot_strategies, BacktestResult, BrokerConnection, NewsArticle, NewsSymbolMention, LLMRun, Instrument
from api.auth import hash_password
from tests.helpers.db import import_all_models


@pytest.fixture(scope="session")
def postgres_container():
    """
    Session-scoped PostgreSQL container.
    
    Starts once per test session and reuses the same container.
    Requires Docker to be running.
    """
    if not TESTCONTAINERS_AVAILABLE:
        pytest.skip("testcontainers not installed - install with: pip install testcontainers[postgres]")
    
    if not DOCKER_AVAILABLE:
        pytest.skip("Docker daemon not running - start Docker to run testcontainers tests")
    
    container = PostgresContainer(
        image="postgres:15-alpine",
        username="test",
        password="test",
        dbname="test_db",
    )
    
    container.start()
    
    yield container
    
    container.stop()


@pytest.fixture(scope="session")
def postgres_engine(postgres_container):
    """
    Session-scoped SQLAlchemy engine connected to PostgreSQL container.
    """
    connection_url = postgres_container.get_connection_url()
    
    engine = create_engine(
        connection_url,
        pool_pre_ping=True,
        pool_recycle=3600,
    )
    
    import_all_models()
    Base.metadata.create_all(bind=engine)
    
    yield engine
    
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture(scope="function")
def postgres_session(postgres_engine) -> Generator[Session, None, None]:
    """
    Function-scoped database session with automatic rollback.
    
    Each test gets a fresh session within a transaction that is rolled back
    after the test, ensuring test isolation.
    """
    connection = postgres_engine.connect()
    transaction = connection.begin()
    
    session = sessionmaker(bind=connection)(bind=connection)
    
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture(scope="function")
def clean_postgres_session(postgres_engine) -> Generator[Session, None, None]:
    """
    Function-scoped database session with clean tables.
    
    Tables are truncated after each test. Slower but useful for tests
    that need to verify cascade deletes or constraint enforcement.
    """
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=postgres_engine)
    session = SessionLocal()
    
    try:
        yield session
    finally:
        session.rollback()
        
        for table in reversed(Base.metadata.sorted_tables):
            session.execute(text(f"TRUNCATE TABLE {table.name} CASCADE"))
        
        session.commit()
        session.close()


@pytest.fixture
def pg_test_user(clean_postgres_session: Session) -> User:
    """Create a test user in PostgreSQL."""
    user = User(
        email="pgtest@example.com",
        hashed_password=hash_password("PostgresTest123!"),
        display_name="PostgreSQL Test User",
        is_active=True,
        initial_capital=1000000.0,
    )
    clean_postgres_session.add(user)
    clean_postgres_session.commit()
    clean_postgres_session.refresh(user)
    return user


@pytest.fixture
def pg_test_password() -> str:
    """Standard test password for PostgreSQL tests."""
    return "PostgresTest123!"


@pytest.fixture
def pg_template_strategy(clean_postgres_session: Session) -> StrategyConfig:
    """Create a template strategy in PostgreSQL."""
    strategy = StrategyConfig(
        name="pg_template_orb",
        strategy_type="ORB",
        is_template=True,
        is_active=True,
        or_minutes=30,
        sl_pct=0.4,
        tp_pct=1.2,
        max_positions=5,
    )
    clean_postgres_session.add(strategy)
    clean_postgres_session.commit()
    clean_postgres_session.refresh(strategy)
    return strategy


@pytest.fixture
def pg_user_strategy(clean_postgres_session: Session, pg_template_strategy: StrategyConfig) -> StrategyConfig:
    """Create a user strategy from template in PostgreSQL."""
    strategy = StrategyConfig(
        name="pg_user_orb",
        strategy_type="ORB",
        parent_id=pg_template_strategy.id,
        is_template=False,
        is_active=True,
        or_minutes=30,
        sl_pct=0.35,
        tp_pct=1.5,
        max_positions=5,
    )
    clean_postgres_session.add(strategy)
    clean_postgres_session.commit()
    clean_postgres_session.refresh(strategy)
    return strategy


@pytest.fixture
def pg_test_bot(clean_postgres_session: Session, pg_user_strategy: StrategyConfig) -> BotConfig:
    """Create a test bot with strategies in PostgreSQL."""
    bot = BotConfig(
        name="PG Test Bot",
        is_active=True,
        max_total_positions=10,
        max_total_capital_pct=0.8,
    )
    clean_postgres_session.add(bot)
    clean_postgres_session.commit()
    clean_postgres_session.refresh(bot)
    
    clean_postgres_session.execute(
        bot_strategies.insert().values(
            bot_id=bot.id,
            strategy_id=pg_user_strategy.id,
            max_positions=5,
            capital_allocation_pct=0.50,
        )
    )
    clean_postgres_session.commit()
    
    return bot


def pytest_configure(config):
    """Configure custom pytest markers for testcontainers tests."""
    config.addinivalue_line(
        "markers", "testcontainers: marks tests using testcontainers (require Docker)"
    )
    config.addinivalue_line(
        "markers", "postgres: marks tests specifically testing PostgreSQL behavior"
    )
    config.addinivalue_line(
        "markers", "slow_testcontainers: marks slow testcontainers tests"
    )
