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
import uuid as uuid_module
from pathlib import Path
from typing import Generator, Optional, Dict, List
from datetime import datetime, timedelta
from dataclasses import dataclass
from unittest.mock import Mock, patch, MagicMock

import pytest
import jwt
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

# Add project root to path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

# ============================================================================
# Mock class definitions (module-level, no side effects)
# ============================================================================

class MockSignalType:
    LONG_ENTRY = "LONG_ENTRY"
    SHORT_ENTRY = "SHORT_ENTRY"
    LONG_EXIT = "LONG_EXIT"
    SHORT_EXIT = "SHORT_EXIT"

class MockORBSignal:
    def __init__(self, symbol, price, stop_loss=None, take_profit=None, **kwargs):
        self.symbol = symbol
        self.price = price
        self.stop_loss = stop_loss
        self.take_profit = take_profit
        # Accept either 'direction' or 'signal_type' for direction
        self.direction = kwargs.get('direction') or kwargs.get('signal_type')
        self.or_high = kwargs.get('or_high')
        self.or_low = kwargs.get('or_low')
        self.or_range = kwargs.get('or_range')
        self.or_range_pct = kwargs.get('or_range_pct')
        self.timestamp = kwargs.get('timestamp', datetime.now().isoformat())

class MockORBSignalGenerator:
    def __init__(self, *args, **kwargs):
        pass
    def generate_signals(self, *args, **kwargs):
        return []

def mock_create_entry_signal(*args, **kwargs):
    return MockORBSignal(*args, **kwargs)

orb_signals_mock = MagicMock()
orb_signals_mock.ORBSignal = MockORBSignal
orb_signals_mock.SignalType = MockSignalType
orb_signals_mock.create_entry_signal = mock_create_entry_signal
orb_signals_mock.ORBSignalGenerator = MockORBSignalGenerator


# ============================================================================
# Session-scoped fixture for sys.modules mocking with cleanup
# ============================================================================

@pytest.fixture(scope="session", autouse=True)
def mock_external_modules():
    """Mock external unavailable modules for integration tests only.
    
    This fixture ensures proper test isolation by:
    1. Saving original sys.modules state before mocking
    2. Applying mocks only for the duration of this test session
    3. Cleaning up by removing only the mocks we added
    """
    missing_mods = [
        'upstox_trader',
        'upstox_trader.config_and_utils',
        'upstox_trader.config_and_utils.free_indian_apis',
        'upstox_trader.screeners',
        'upstox_trader.screeners.tv_screen_usage',
        'trending_upside',
        'moneycontrol_scraper',
        'scanners',
        'nautilus_trader',
        'nautilus_trader.backtest',
        'nautilus_trader.backtest.config',
        'nautilus_trader.backtest.engine',
        'nautilus_trader.config',
        'nautilus_trader.model',
        'nautilus_trader.model.enums',
        'nautilus_trader.model.objects',
        'nautilus_trader.model.identifiers',
        'nautilus_trader.model.orders',
        'nautilus_trader.model.instruments',
        'nautilus_trader.model.core',
        'nautilus_trader.model.currencies',
        'nautilus_trader.model.data',
        'nautilus_trader.persistence',
        'nautilus_trader.persistence.wranglers',
        'nautilus_trader.trading',
        'nautilus_trader.trading.strategy',
        'nautilus_trader.test_kit',
        'nautilus_trader.test_kit.providers',
        'api.market_ticker',
    ]
    
    # Save original state
    original_modules = {}
    for mod in missing_mods:
        if mod not in sys.modules:
            original_modules[mod] = None
        else:
            original_modules[mod] = sys.modules[mod]
    
    # Save original for nautilus_trader.model.enums.SignalType
    original_signal_type = getattr(sys.modules.get('nautilus_trader.model.enums', MagicMock()), 'SignalType', None)
    
    # Save original for scanners.pivot_levels
    original_scanners = sys.modules.get('scanners', None)
    original_pivot_levels = sys.modules.get('scanners.pivot_levels', None)
    
    # Apply mocks
    for mod in missing_mods:
        if mod not in sys.modules:
            sys.modules[mod] = MagicMock()
    
    # Apply specific mocks (SignalType, etc)
    sys.modules['nautilus_trader.model.enums'].SignalType = MockSignalType
    
    # Mock scanners.pivot_levels
    scanners_mock = MagicMock()
    scanners_mock.pivot_levels.return_value = []
    sys.modules['scanners'] = scanners_mock
    sys.modules['scanners.pivot_levels'] = scanners_mock.pivot_levels
    
    yield
    
    # Cleanup - restore original state for missing_mods
    for mod, original in original_modules.items():
        if original is None:
            # We added this mock, remove it
            if mod in sys.modules:
                del sys.modules[mod]
        else:
            # Restore original
            sys.modules[mod] = original
    
    # Restore SignalType
    if 'nautilus_trader.model.enums' in sys.modules:
        if original_signal_type is not None:
            sys.modules['nautilus_trader.model.enums'].SignalType = original_signal_type
        elif hasattr(sys.modules['nautilus_trader.model.enums'], 'SignalType'):
            delattr(sys.modules['nautilus_trader.model.enums'], 'SignalType')
    
    # Restore scanners
    if original_scanners is None:
        if 'scanners' in sys.modules:
            del sys.modules['scanners']
    else:
        sys.modules['scanners'] = original_scanners
    
    if original_pivot_levels is None:
        if 'scanners.pivot_levels' in sys.modules:
            del sys.modules['scanners.pivot_levels']
    else:
        sys.modules['scanners.pivot_levels'] = original_pivot_levels


# ============================================================================
# Database configuration
# ============================================================================
from db.database import Base, get_db

TEST_DB_DIR = tempfile.mkdtemp()
TEST_DB_PATH = os.path.join(TEST_DB_DIR, "test_integration.db")
TEST_SQLALCHEMY_DATABASE_URL = f"sqlite:///{TEST_DB_PATH}"
test_engine = create_engine(
    TEST_SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

def override_get_db():
    """Yield a test database session."""
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()

# ============================================================================
# Minimal FastAPI app with only the required routers
# ============================================================================
from db.models import User, StrategyConfig, BotConfig, bot_strategies, BacktestResult, BrokerConnection, NewsArticle, NewsSymbolMention, LLMRun, Instrument
from api.auth import hash_password, create_access_token, create_refresh_token, JWT_SECRET_KEY, JWT_ALGORITHM, get_current_user

app = FastAPI()

# Auth router
try:
    from api.auth import router as auth_router
    app.include_router(auth_router)
except Exception as e:
    print(f"⚠️ Auth router not loaded: {e}")

# Bots router
try:
    from api.bots import router as bots_router
    app.include_router(bots_router)
except Exception as e:
    print(f"⚠️ Bots router not loaded: {e}")

# Strategies router
try:
    from api.strategies import router as strategies_router
    app.include_router(strategies_router)
except Exception as e:
    print(f"⚠️ Strategies router not loaded: {e}")

# Paper trading router (optional)
try:
    from api.paper_trading import router as paper_trading_router
    app.include_router(paper_trading_router)
except Exception as e:
    print(f"⚠️ Paper trading router not loaded: {e}")

# Override get_db globally (per-test override will replace this)
app.dependency_overrides[get_db] = override_get_db

# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture(scope="function")
def db() -> Generator[Session, None, None]:
    """Fresh database per test with seeded template strategies."""
    Base.metadata.create_all(bind=test_engine)
    session = TestSessionLocal()
    _seed_template_strategies(session)
    yield session
    session.close()
    Base.metadata.drop_all(bind=test_engine)

def _seed_template_strategies(session: Session):
    """Create template strategies for tests."""
    templates = [
        StrategyConfig(
            uuid=str(uuid_module.uuid4()),
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
            uuid=str(uuid_module.uuid4()),
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
            uuid=str(uuid_module.uuid4()),
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
    for t in templates:
        session.add(t)
    session.commit()

@pytest.fixture(scope="function")
def client(db: Session, test_user: User) -> TestClient:
    """Test client using the current test database session with auth."""
    def get_test_db():
        yield db
    def mock_get_current_user():
        return test_user
    app.dependency_overrides[get_db] = get_test_db
    app.dependency_overrides[get_current_user] = mock_get_current_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()

# ============================================================================
# User fixtures
# ============================================================================

@pytest.fixture
def test_password() -> str:
    return "IntegrationTest123!"

@pytest.fixture
def test_user(db: Session, test_password: str) -> User:
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
def user(test_user: User) -> User:
    """Alias for test_user for tests that use 'user' parameter."""
    return test_user

@pytest.fixture
def auth_tokens(client: TestClient, test_user: User, test_password: str) -> Dict[str, str]:
    resp = client.post("/api/auth/login", json={"email": test_user.email, "password": test_password})
    data = resp.json()
    return {"access_token": data["access_token"], "refresh_token": data["refresh_token"]}

@pytest.fixture
def auth_headers(auth_tokens: Dict[str, str]) -> Dict[str, str]:
    return {"Authorization": f"Bearer {auth_tokens['access_token']}"}

# ============================================================================
# Strategy fixtures
# ============================================================================

@pytest.fixture
def template_strategy(db: Session) -> StrategyConfig:
    s = StrategyConfig(
        name="test_template_orb",
        strategy_type="ORB",
        is_template=True,
        is_active=True,
        or_minutes=30,
        sl_pct=0.4,
        tp_pct=1.2,
        max_positions=5,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s

@pytest.fixture
def user_strategy(db: Session, template_strategy: StrategyConfig) -> StrategyConfig:
    s = StrategyConfig(
        name="my_custom_orb",
        strategy_type="ORB",
        parent_id=template_strategy.id,
        is_template=False,
        is_active=True,
        or_minutes=30,
        sl_pct=0.35,
        tp_pct=1.5,
        max_positions=5,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s

@pytest.fixture
def multiple_strategies(db: Session) -> List[StrategyConfig]:
    strategies = []
    for i in range(3):
        s = StrategyConfig(
            name=f"test_strategy_{i}",
            strategy_type="ORB",
            is_template=False,
            is_active=True,
            sl_pct=0.3 + i * 0.1,
            tp_pct=1.0 + i * 0.3,
            max_positions=3 + i,
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        strategies.append(s)
    return strategies

# ============================================================================
# Bot fixtures
# ============================================================================

@pytest.fixture
def test_bot(db: Session, multiple_strategies: List[StrategyConfig]) -> BotConfig:
    bot = BotConfig(
        name="Test Bot",
        is_active=True,
        max_total_positions=10,
        max_total_capital_pct=0.8,
    )
    db.add(bot)
    db.commit()
    db.refresh(bot)
    for i, strat in enumerate(multiple_strategies):
        db.execute(
            bot_strategies.insert().values(
                bot_id=bot.id,
                strategy_id=strat.id,
                max_positions=3 + i,
                capital_allocation_pct=0.25,
            )
        )
    db.commit()
    return bot

@pytest.fixture
def running_bot(db: Session, test_bot: BotConfig) -> Dict:
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
# Journal fixtures
# ============================================================================

@pytest.fixture
def trade_journal(tmp_path) -> Path:
    journal_dir = tmp_path / "journals" / "1"
    journal_dir.mkdir(parents=True)
    from trading.journal import TradeJournal
    journal = TradeJournal(journal_dir=str(journal_dir), user_id=1)
    return journal

@pytest.fixture
def sample_trades() -> List[Dict]:
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
            'strategy_id': 2,
            'strategy_name': 'ORB Aggressive',
        },
    ]

# ============================================================================
# Signal fixtures
# ============================================================================

@pytest.fixture
def mock_signal_data():
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
    symbol: str
    quantity: int
    entry_price: float
    current_price: float
    side: str = "BUY"
    unrealized_pnl: float = 0.0
    unrealized_pnl_pct: float = 0.0

@pytest.fixture
def mock_positions() -> List[MockPosition]:
    return [
        MockPosition(symbol="RELIANCE", quantity=100, entry_price=2500.0, current_price=2525.0, unrealized_pnl=2500.0, unrealized_pnl_pct=1.0),
        MockPosition(symbol="TCS", quantity=50, entry_price=3800.0, current_price=3785.0, unrealized_pnl=-750.0, unrealized_pnl_pct=-0.39),
    ]

# ============================================================================
# Portfolio & snapshot fixtures
# ============================================================================

@pytest.fixture
def mock_portfolio_state():
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

@pytest.fixture
def mock_bot_snapshot(test_bot: BotConfig):
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
        'scan_items': [],
    }
