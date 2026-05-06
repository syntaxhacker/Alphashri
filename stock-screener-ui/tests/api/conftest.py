"""
Shared fixtures for API tests.

Provides comprehensive fixtures for:
- Database setup and teardown
- Sample users (active, inactive, different attributes)
- Sample strategies (templates and variations with different parameters)
- Sample bot configurations
- Authentication tokens (valid, expired, invalid, refresh tokens)
- FastAPI TestClient configuration
- Database session management
- Cleanup functions
"""

import os
import sys
import tempfile
import json
import secrets
from pathlib import Path
from typing import Generator, Optional
from datetime import datetime, timedelta
from typing import Dict, List, Any
from unittest.mock import MagicMock

import pytest
import jwt
import pandas as pd
import numpy as np
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Mock init_db before importing app to prevent alembic migrations during tests
from unittest.mock import patch
import db.database
db.database.init_db = lambda: None
from api_server_fastapi import app

# Standard imports
from db.database import Base, get_db
from db.models import User, UserSession, StrategyConfig, BotConfig, bot_strategies
from api.auth import (
    hash_password,
    create_access_token,
    create_refresh_token,
    get_current_user,
    JWT_SECRET_KEY,
    JWT_ALGORITHM,
    ACCESS_TOKEN_EXPIRE_HOURS,
    REFRESH_TOKEN_EXPIRE_DAYS,
)


@pytest.fixture(scope="function")
def test_engine():
    from db.models import User, UserSession, StrategyConfig, BotConfig, BacktestResult, BrokerConnection, NewsArticle, NewsSymbolMention, LLMRun, Instrument, Trade, Position, MarketHoliday, Stock52WeekTouch, Screener
    
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
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
def client(db: Session) -> TestClient:
    def override_get_db_for_client():
        yield db

    app.dependency_overrides[get_db] = override_get_db_for_client

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def auth_client(db: Session) -> TestClient:
    def override_get_db_for_client():
        yield db

    test_user = User(
        email="test@example.com",
        hashed_password=hash_password("TestPassword123!"),
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

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def test_password() -> str:
    """Standard test password."""
    return "TestPassword123!"


@pytest.fixture
def test_user_data(test_password: str) -> dict:
    """
    Standard test user data.

    Returns a dict with email, password, and display_name.
    """
    return {
        "email": "test@example.com",
        "password": test_password,
        "display_name": "Test User"
    }


@pytest.fixture
def test_user(db: Session, test_user_data: dict) -> User:
    """
    Create a test user in the database.

    The user is created with hashed password and is active.
    """
    user = User(
        email=test_user_data["email"],
        hashed_password=hash_password(test_user_data["password"]),
        display_name=test_user_data["display_name"],
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def inactive_user(db: Session, test_password: str) -> User:
    """
    Create an inactive test user.

    Useful for testing authentication with disabled accounts.
    """
    user = User(
        email="inactive@example.com",
        hashed_password=hash_password(test_password),
        display_name="Inactive User",
        is_active=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def auth_headers(client: TestClient, db: Session, test_password: str) -> dict:
    """
    Login and return authorization headers.

    Returns headers with Bearer token that can be used
    to access protected endpoints.
    """
    # Create a unique test user for this fixture
    import random
    unique_id = random.randint(10000, 99999)
    user_data = {
        "email": f"authtest{unique_id}@example.com",
        "password": test_password,
        "display_name": f"Auth Test User {unique_id}"
    }

    # Register the user
    client.post("/api/auth/register", json=user_data)

    # Then login
    response = client.post("/api/auth/login", json={
        "email": user_data["email"],
        "password": user_data["password"]
    })
    data = response.json()
    token = data["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers_for_user(client: TestClient, user: User, password: str) -> dict:
    """
    Login with specific user credentials and return authorization headers.
    """
    response = client.post("/api/auth/login", json={
        "email": user.email,
        "password": password
    })
    data = response.json()
    token = data["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def valid_access_token(test_user: User) -> str:
    """
    Create a valid access token for the test user.

    Returns a JWT token that can be used for authentication.
    """
    token, _ = create_access_token(test_user.id)
    return token


@pytest.fixture
def valid_refresh_token(db: Session, test_user: User) -> str:
    """
    Create a valid refresh token for the test user.

    Returns a JWT refresh token with an active session in the database.
    """
    token = create_refresh_token(test_user.id, db)
    return token


@pytest.fixture
def expired_access_token() -> str:
    """
    Create an expired access token.

    Useful for testing token expiration handling.
    """
    import jwt
    from datetime import datetime, timedelta

    expire = datetime.utcnow() - timedelta(hours=1)
    payload = {
        "sub": "1",
        "jti": "expired-jti",
        "type": "access",
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


@pytest.fixture
def expired_refresh_token() -> str:
    """
    Create an expired refresh token.

    Useful for testing refresh token expiration handling.
    """
    import jwt
    from datetime import datetime, timedelta

    expire = datetime.utcnow() - timedelta(days=1)
    payload = {
        "sub": "1",
        "jti": "expired-refresh-jti",
        "type": "refresh",
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


@pytest.fixture
def invalid_token() -> str:
    """
    Return an invalid/malformed token.

    Useful for testing invalid token handling.
    """
    return "invalid.token.string"


@pytest.fixture
def revoked_refresh_token(db: Session, test_user: User) -> str:
    """
    Create a refresh token that has been revoked.

    The session is marked as revoked in the database.
    Useful for testing revoked session handling.
    """
    token = create_refresh_token(test_user.id, db)

    # Get the session and revoke it
    import jwt
    payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    jti = payload["jti"]

    session = db.query(UserSession).filter(UserSession.id == jti).first()
    if session:
        session.revoked = True
        db.commit()

    return token


@pytest.fixture
def access_token_type_refresh(db: Session, test_user: User) -> str:
    """
    Create a token with refresh type.

    This simulates using a refresh token as an access token,
    which should be rejected by protected endpoints.
    """
    return create_refresh_token(test_user.id, db)


@pytest.fixture
def access_token_for_nonexistent_user() -> str:
    """
    Create a valid token for a non-existent user.

    The user_id (999) doesn't exist in the database.
    Useful for testing user lookup handling.
    """
    token, _ = create_access_token(999)
    return token


@pytest.fixture
def multiple_users(db: Session, test_password: str) -> list[User]:
    """
    Create multiple test users.

    Useful for testing uniqueness constraints and filtering.
    """
    users = [
        User(
            email=f"user{i}@example.com",
            hashed_password=hash_password(test_password),
            display_name=f"User {i}",
            is_active=True,
        )
        for i in range(1, 4)
    ]
    for user in users:
        db.add(user)
    db.commit()
    for user in users:
        db.refresh(user)
    return users


@pytest.fixture
def user_session(db: Session, test_user: User) -> UserSession:
    """
    Create an active user session.

    Returns a UserSession object that can be used for testing
    session-related functionality.
    """
    from datetime import datetime, timedelta

    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    session = UserSession(
        id="test-session-jti",
        user_id=test_user.id,
        expires_at=expire,
        revoked=False,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@pytest.fixture
def register_response_data(client: TestClient, test_user_data: dict) -> dict:
    """
    Register a user and return the response data.

    Includes the access_token, refresh_token, and other fields.
    """
    response = client.post("/api/auth/register", json=test_user_data)
    return response.json()


@pytest.fixture
def login_response_data(client: TestClient, test_user: User, test_password: str) -> dict:
    """
    Login a user and return the response data.

    Includes the access_token, refresh_token, and other fields.
    """
    response = client.post("/api/auth/login", json={
        "email": test_user.email,
        "password": test_password
    })
    return response.json()


# ============================================================================
# Utility API Fixtures (Chart, Symbols, News, Health)
# ============================================================================

@pytest.fixture
def sample_candles_data():
    """
    Sample OHLCV candle data for testing chart preview.

    Returns a pandas DataFrame with 100 1-minute candles.
    """
    dates = pd.date_range(
        start=datetime(2026, 3, 3, 9, 15),
        periods=100,
        freq='1min'
    )

    # Generate realistic price movement
    np.random.seed(42)
    base_price = 100.0
    prices = []
    for i in range(100):
        change = np.random.normal(0, 0.5)
        base_price += change
        high = base_price + abs(np.random.normal(0, 0.2))
        low = base_price - abs(np.random.normal(0, 0.2))
        volume = np.random.randint(1000, 10000)
        prices.append({
            'date': dates[i],
            'open': base_price - 0.1,
            'high': high,
            'low': low,
            'close': base_price,
            'volume': volume
        })

    df = pd.DataFrame(prices)
    df.set_index('date', inplace=True)
    return df


@pytest.fixture
def sample_instruments():
    """
    Sample instrument data for symbol search tests.

    Includes NSE_EQ equity instruments and other segments for filtering tests.
    """
    return [
        {
            'trading_symbol': 'RELIANCE',
            'name': 'Reliance Industries Ltd',
            'isin': 'INE002A01018',
            'segment': 'NSE_EQ',
            'instrument_type': 'EQ',
            'exchange': 'NSE'
        },
        {
            'trading_symbol': 'TCS',
            'name': 'Tata Consultancy Services',
            'isin': 'INE467B01029',
            'segment': 'NSE_EQ',
            'instrument_type': 'EQ',
            'exchange': 'NSE'
        },
        {
            'trading_symbol': 'INFY',
            'name': 'Infosys Ltd',
            'isin': 'INE009A01021',
            'segment': 'NSE_EQ',
            'instrument_type': 'EQ',
            'exchange': 'NSE'
        },
        {
            'trading_symbol': 'HDFCBANK',
            'name': 'HDFC Bank Ltd',
            'isin': 'INE040A01034',
            'segment': 'NSE_EQ',
            'instrument_type': 'EQ',
            'exchange': 'NSE'
        },
        {
            'trading_symbol': 'TATAMOTORS',
            'name': 'Tata Motors Ltd',
            'isin': 'INE155A01022',
            'segment': 'NSE_EQ',
            'instrument_type': 'EQ',
            'exchange': 'NSE'
        },
        {
            'trading_symbol': 'SBIN',
            'name': 'State Bank of India',
            'isin': 'INE062A01020',
            'segment': 'NSE_EQ',
            'instrument_type': 'EQ',
            'exchange': 'NSE'
        },
        {
            'trading_symbol': 'NIFTY50',
            'name': 'Nifty 50 Index',
            'isin': '',
            'segment': 'NSE_INDEX',
            'instrument_type': 'INDEX',
            'exchange': 'NSE'
        },
        {
            'trading_symbol': 'RELIANCEFUT',
            'name': 'Reliance Futures',
            'isin': '',
            'segment': 'NSE_FO',
            'instrument_type': 'FUTSTK',
            'exchange': 'NSE'
        },
    ]


@pytest.fixture
def sample_news_items():
    """
    Sample news items for testing news endpoints.

    Returns a list of news dictionaries with various categories.
    """
    return [
        {
            'title': 'Markets hit all-time high amid positive global cues',
            'description': 'Indian stock markets reached new heights today as Sensex climbed 500 points.',
            'url': 'https://example.com/news/markets-high-12345',
            'source': 'moneycontrol',
            'timestamp': datetime(2026, 3, 3, 10, 30).isoformat(),
            'category': 'Markets'
        },
        {
            'title': 'Tech stocks lead the rally with strong gains',
            'description': 'Technology sector outperformed with TCS and Infosys gaining over 2% each.',
            'url': 'https://example.com/news/tech-rally-12346',
            'source': 'moneycontrol',
            'timestamp': datetime(2026, 3, 3, 11, 15).isoformat(),
            'category': 'Technology'
        },
        {
            'title': 'Banking sector shows signs of recovery',
            'description': 'Bank Nifty gained 1.5% as HDFC Bank and ICICI Bank showed strength.',
            'url': 'https://example.com/news/banking-12347',
            'source': 'moneycontrol',
            'timestamp': datetime(2026, 3, 3, 12, 0).isoformat(),
            'category': 'Banking'
        },
        {
            'title': 'Crude oil prices surge amid Middle East tensions',
            'description': 'Oil prices jumped 3% following developments in the Middle East region.',
            'url': 'https://example.com/news/crude-oil-12348',
            'source': 'moneycontrol',
            'timestamp': datetime(2026, 3, 3, 14, 30).isoformat(),
            'category': 'Commodities'
        },
        {
            'title': 'RBI keeps repo rate unchanged',
            'description': 'The central bank maintained status quo on interest rates in its policy review.',
            'url': 'https://example.com/news/rbi-rate-12349',
            'source': 'moneycontrol',
            'timestamp': datetime(2026, 3, 3, 10, 0).isoformat(),
            'category': 'Economy'
        },
    ]


@pytest.fixture
def sample_news_sources():
    """
    Sample news sources for testing the news sources endpoint.

    Returns a list of available news sources.
    """
    return [
        'moneycontrol',
        'economicstimes',
        'livemint',
    ]


@pytest.fixture
def sample_article_content():
    """
    Sample full article content for testing the article fetch endpoint.

    Returns a complete article with title and content.
    """
    return {
        'title': 'Markets hit all-time high amid positive global cues',
        'content': '''
        Indian stock markets reached new heights today as Sensex climbed 500 points.
        The rally was broad-based with all sectoral indices ending in the green.

        Reliance Industries contributed the most to the gains, rising 3.5%.
        Banking stocks also participated in the rally with HDFC Bank and ICICI Bank
        gaining over 2% each.

        Analysts attribute the rally to positive global cues and strong foreign
        institutional investor (FII) inflows.
        ''',
        'url': 'https://example.com/news/markets-high-12345',
        'timestamp': datetime(2026, 3, 3, 10, 30).isoformat(),
        'author': 'Market Desk'
    }


# ============================================================================
# Mock API Fixtures for External Services
# ============================================================================

@pytest.fixture
def mock_trading_api(sample_candles_data):
    """
    Mock TradingAPI for yfinance/upstox calls.

    Returns a Mock object with fetch_historical_data_v3 method.
    """
    from unittest.mock import Mock
    mock_api = Mock()
    mock_api.fetch_historical_data_v3 = Mock(return_value=sample_candles_data)
    return mock_api


# ============================================================================
# Helper Functions for Utility API Tests
# ============================================================================

def create_chart_response(symbol: str = "TEST", candles_count: int = 10) -> dict:
    """
    Helper to create a mock chart preview response.

    Args:
        symbol: Stock symbol
        candles_count: Number of candles to generate

    Returns:
        Dictionary with chart data structure matching the API response
    """
    candles = []
    base_time = datetime(2026, 3, 3, 9, 15)
    for i in range(candles_count):
        candles.append({
            'time': int((base_time.timestamp() + i * 900) * 1000),  # 15-min timeframe in ms
            'open': 100.0 + i,
            'high': 102.0 + i,
            'low': 99.0 + i,
            'close': 101.0 + i,
            'volume': 5000
        })

    return {
        'symbol': symbol,
        'candles': candles,
        'orb_zones': [
            {
                'start': base_time.isoformat(),
                'end': int((base_time.timestamp() + 2700) * 1000),
                'high': 105.0,
                'low': 98.0
            }
        ],
        'pivot_levels': [
            {'level': 'R1', 'price': 103.0},
            {'level': 'S1', 'price': 97.0}
        ],
        'timeframe': 15,
        'or_minutes': 45,
        'total_candles': candles_count
    }


def assert_chart_response_structure(response: dict):
    """
    Helper to assert chart response has correct structure.

    Validates that all required fields are present and candles have
    the correct OHLCV format for frontend charting libraries.
    """
    assert 'symbol' in response
    assert 'candles' in response
    assert 'orb_zones' in response
    assert 'pivot_levels' in response
    assert 'timeframe' in response

    # Validate candle structure
    for candle in response.get('candles', []):
        assert 'time' in candle
        assert 'open' in candle
        assert 'high' in candle
        assert 'low' in candle
        assert 'close' in candle
        assert 'volume' in candle


def assert_news_response_structure(response: dict):
    """
    Helper to assert news response has correct structure.

    Validates the news feed response format.
    """
    assert 'items' in response
    assert isinstance(response['items'], list)
    assert 'source' in response
    assert 'total' in response
    assert 'fetchedAt' in response

    # Validate news item structure
    for item in response.get('items', []):
        assert 'title' in item
        assert 'url' in item
        assert 'timestamp' in item


def assert_symbol_search_response_structure(response: dict):
    """
    Helper to assert symbol search response has correct structure.

    Validates the symbol search response format.
    """
    assert 'results' in response
    assert isinstance(response['results'], list)
    assert 'query' in response
    assert 'total' in response

    # Validate result structure
    for result in response.get('results', []):
        assert 'symbol' in result
        assert 'name' in result
        assert 'isin' in result


# ============================================================================
# Strategy Management Fixtures
# ============================================================================

@pytest.fixture
def sample_template_strategy(db: Session) -> StrategyConfig:
    """
    Create a sample template strategy for testing.

    This is the parent strategy that variations can be created from.
    Note: is_default=False to avoid conflicts with default_strategy fixture.
    """
    strategy = StrategyConfig(
        name="ORB Template",
        strategy_type="ORB",
        is_template=True,
        is_active=True,
        is_default=False,
        description="Default ORB strategy template",
        or_minutes=45,
        sl_pct=0.4,
        tp_pct=1.2,
        min_or_range_pct=0.5,
        max_or_range_pct=3.0,
        max_positions=5,
        max_capital_per_trade_pct=0.10,
        max_daily_loss_pct=0.02,
        max_total_exposure_pct=0.50,
        risk_per_trade_pct=0.01,
        min_trade_value=5000,
        max_trade_value=100000,
        cooldown_minutes=30,
        max_distance_from_or_pct=1.5,
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


@pytest.fixture
def sample_template_strategies(db: Session) -> List[StrategyConfig]:
    """
    Create multiple sample template strategies for testing.

    Includes different strategy types and some inactive templates.
    """
    templates = [
        StrategyConfig(
            name="ORB Conservative",
            strategy_type="ORB",
            is_template=True,
            is_active=True,
            description="Conservative ORB with wider stops",
            or_minutes=45,
            sl_pct=0.5,
            tp_pct=1.5,
            max_positions=3,
            max_capital_per_trade_pct=0.08,
        ),
        StrategyConfig(
            name="ORB Aggressive",
            strategy_type="ORB",
            is_template=True,
            is_active=True,
            description="Aggressive ORB with tight stops",
            or_minutes=30,
            sl_pct=0.3,
            tp_pct=1.0,
            max_positions=5,
            max_capital_per_trade_pct=0.12,
        ),
        StrategyConfig(
            name="52W Chaser",
            strategy_type="52W_CHASER",
            is_template=True,
            is_active=True,
            description="52-week high breakout strategy",
            or_minutes=None,
            sl_pct=0.7,
            tp_pct=2.0,
            max_positions=4,
            max_capital_per_trade_pct=0.10,
        ),
        StrategyConfig(
            name="Inactive Template",
            strategy_type="ORB",
            is_template=True,
            is_active=False,
            description="This template should not appear in active listings",
        ),
    ]
    for template in templates:
        db.add(template)
    db.commit()
    for template in templates:
        db.refresh(template)
    return templates


@pytest.fixture
def sample_strategy(db: Session, sample_template_strategy: StrategyConfig) -> StrategyConfig:
    """
    Create a sample non-template strategy for testing.

    This is a variation of the template with custom parameters.
    """
    strategy = StrategyConfig(
        name="My ORB Variation",
        strategy_type="ORB",
        parent_id=sample_template_strategy.id,
        is_template=False,
        is_active=True,
        description="My custom ORB settings",
        # ORB Parameters (modified from template)
        or_minutes=30,
        sl_pct=0.35,
        tp_pct=1.0,
        # Risk Parameters (inherited defaults)
        max_positions=5,
        max_capital_per_trade_pct=0.10,
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


@pytest.fixture
def sample_strategies(db: Session, sample_template_strategy: StrategyConfig) -> List[StrategyConfig]:
    """
    Create multiple sample strategies for testing.

    Includes variations of the template and some with different types.
    """
    strategies = [
        StrategyConfig(
            name="Conservative ORB",
            strategy_type="ORB",
            parent_id=sample_template_strategy.id,
            is_template=False,
            is_active=True,
            description="Conservative settings",
            or_minutes=60,
            sl_pct=0.5,
            tp_pct=1.5,
            max_positions=3,
        ),
        StrategyConfig(
            name="Aggressive ORB",
            strategy_type="ORB",
            parent_id=sample_template_strategy.id,
            is_template=False,
            is_active=True,
            description="Aggressive settings",
            or_minutes=15,
            sl_pct=0.25,
            tp_pct=0.75,
            max_positions=8,
        ),
        StrategyConfig(
            name="Inactive Strategy",
            strategy_type="ORB",
            parent_id=sample_template_strategy.id,
            is_template=False,
            is_active=False,
            description="This should not appear in active listings",
        ),
        StrategyConfig(
            name="52W Chaser Variant",
            strategy_type="52W_CHASER",
            is_template=False,
            is_active=True,
            description="Custom 52W settings",
            sl_pct=0.8,
            tp_pct=2.5,
            max_positions=3,
        ),
    ]
    for strategy in strategies:
        db.add(strategy)
    db.commit()
    for strategy in strategies:
        db.refresh(strategy)
    return strategies


@pytest.fixture
def default_strategy(db: Session) -> StrategyConfig:
    """
    Create a strategy marked as default.

    Useful for testing default strategy behavior.
    """
    strategy = StrategyConfig(
        name="Default ORB",
        strategy_type="ORB",
        is_template=False,
        is_active=True,
        is_default=True,
        description="The default strategy",
        or_minutes=45,
        sl_pct=0.4,
        tp_pct=1.2,
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


@pytest.fixture
def sample_journal_data() -> List[Dict[str, Any]]:
    """
    Create sample journal trade data for testing.

    Returns a list of trade dictionaries that would be loaded
    from journal files.
    """
    return [
        {
            "symbol": "RELIANCE",
            "entry_time": (datetime.now() - timedelta(hours=5)).isoformat(),
            "exit_time": (datetime.now() - timedelta(hours=3)).isoformat(),
            "side": "BUY",
            "quantity": 50,
            "entry_price": 2000.0,
            "exit_price": 2100.0,
            "stop_loss": 1900.0,
            "take_profit": 2200.0,
            "pnl": 5000.0,
            "net_pnl": 4900.0,
            "costs": 100.0,
            "exit_reason": "TP",
            "strategy_id": 1,
            "strategy_name": "ORB Template",
            "is_test": True,
        },
        {
            "symbol": "INFY",
            "entry_time": (datetime.now() - timedelta(hours=4)).isoformat(),
            "exit_time": (datetime.now() - timedelta(hours=2)).isoformat(),
            "side": "BUY",
            "quantity": 100,
            "entry_price": 1500.0,
            "exit_price": 1450.0,
            "stop_loss": 1425.0,
            "take_profit": 1650.0,
            "pnl": -5000.0,
            "net_pnl": -5100.0,
            "costs": 100.0,
            "exit_reason": "SL",
            "strategy_id": 1,
            "strategy_name": "ORB Template",
            "is_test": False,
        },
        {
            "symbol": "TCS",
            "entry_time": (datetime.now() - timedelta(hours=3)).isoformat(),
            "exit_time": (datetime.now() - timedelta(hours=1)).isoformat(),
            "side": "BUY",
            "quantity": 25,
            "entry_price": 3500.0,
            "exit_price": 3700.0,
            "stop_loss": 3360.0,
            "take_profit": 3850.0,
            "pnl": 5000.0,
            "net_pnl": 4900.0,
            "costs": 100.0,
            "exit_reason": "TP",
            "strategy_id": 2,
            "strategy_name": "My ORB Variation",
            "is_test": False,
        },
    ]


@pytest.fixture
def mock_load_all_trades(sample_journal_data: List[Dict[str, Any]], monkeypatch: pytest.MonkeyPatch):
    """
    Mock the _load_all_trades function to return sample trade data.

    This fixture patches the journal loading in api.strategies module.
    The monkeypatch automatically cleans up after the test.
    """
    def mock_load(user_id: int) -> List[Dict[str, Any]]:
        return sample_journal_data

    monkeypatch.setattr("api.strat_api.strat_query._load_all_trades", mock_load)
    yield


# ============================================================================
# Bot Configuration Fixtures
# ============================================================================

@pytest.fixture
def single_strategy_bot(db: Session, sample_template_strategy: StrategyConfig) -> BotConfig:
    """
    Create a bot with a single strategy.

    Returns:
        BotConfig: A bot configuration with one strategy.
    """
    bot = BotConfig(
        name="Single Strategy Bot",
        is_active=True,
        max_total_positions=5,
        max_total_capital_pct=0.50,
    )
    db.add(bot)
    db.flush()

    # Add strategy association
    db.execute(
        bot_strategies.insert().values(
            bot_id=bot.id,
            strategy_id=sample_template_strategy.id,
            max_positions=5,
            capital_allocation_pct=0.50,
        )
    )
    db.commit()
    db.refresh(bot)
    return bot


@pytest.fixture
def multi_strategy_bot(
    db: Session,
    sample_template_strategy: StrategyConfig,
) -> BotConfig:
    """
    Create a bot with multiple strategies.

    Returns:
        BotConfig: A bot configuration with multiple strategies.
    """
    # Create a second template for multi-strategy bot
    second_tpl = StrategyConfig(
        name="Momentum Template",
        strategy_type="MOMENTUM",
        is_template=True,
        is_active=True,
        max_positions=8,
    )
    db.add(second_tpl)
    db.flush()
    
    bot = BotConfig(
        name="Multi Strategy Bot",
        is_active=True,
        max_total_positions=10,
        max_total_capital_pct=0.80,
    )
    db.add(bot)
    db.flush()

    # Add strategy associations
    db.execute(
        bot_strategies.insert().values(
            bot_id=bot.id,
            strategy_id=sample_template_strategy.id,
            max_positions=5,
            capital_allocation_pct=0.40,
        )
    )
    db.execute(
        bot_strategies.insert().values(
            bot_id=bot.id,
            strategy_id=second_tpl.id,
            max_positions=5,
            capital_allocation_pct=0.40,
        )
    )
    db.commit()
    db.refresh(bot)
    return bot


@pytest.fixture
def inactive_bot(db: Session, sample_template_strategy: StrategyConfig) -> BotConfig:
    """
    Create an inactive bot.

    Returns:
        BotConfig: A bot configuration with is_active=False.
    """
    bot = BotConfig(
        name="Inactive Bot",
        is_active=False,
        max_total_positions=5,
        max_total_capital_pct=0.50,
    )
    db.add(bot)
    db.flush()

    db.execute(
        bot_strategies.insert().values(
            bot_id=bot.id,
            strategy_id=sample_template_strategy.id,
            max_positions=5,
            capital_allocation_pct=0.50,
        )
    )
    db.commit()
    db.refresh(bot)
    return bot


@pytest.fixture
def multiple_bots(db: Session, sample_template_strategy: StrategyConfig) -> List[BotConfig]:
    """
    Create multiple bot configurations for testing.

    Returns:
        list[BotConfig]: A list of bot configurations.
    """
    bots = [
        BotConfig(
            name=f"Test Bot {i}",
            is_active=i % 2 == 0,
            max_total_positions=5 + i,
            max_total_capital_pct=0.5 + (i * 0.1),
        )
        for i in range(1, 4)
    ]

    for bot in bots:
        db.add(bot)
    db.flush()

    # Add strategies to bots
    for i, bot in enumerate(bots):
        db.execute(
            bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=sample_template_strategy.id,
                max_positions=5,
                capital_allocation_pct=0.50,
            )
        )

    db.commit()
    for bot in bots:
        db.refresh(bot)

    return bots



