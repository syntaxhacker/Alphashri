"""
Comprehensive unit tests for db/models.py

Tests cover:
- Model instantiation
- Field validations
- Relationships between models
- Default values
- Constraints
- Serialization/deserialization
"""

import pytest
from datetime import datetime, timedelta
from sqlalchemy import create_engine, inspect, event
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.exc import IntegrityError

from db.database import Base
from db.models import User, UserSession, StrategyConfig, BotConfig, bot_strategies, BacktestResult, BrokerConnection, NewsArticle, NewsSymbolMention, LLMRun, Instrument
from tests.helpers.db import import_all_models


@pytest.fixture
def db_session():
    """Create an in-memory SQLite database for testing."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False}
    )
    
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
    
    TestSessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine
    )
    
    import_all_models()
    Base.metadata.create_all(bind=engine)
    
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


class TestUserModel:
    """Tests for User model."""

    def test_user_instantiation_minimal(self, db_session):
        """Test creating User with minimal required fields."""
        user = User(email="test@example.com", hashed_password="hashed123")
        db_session.add(user)
        db_session.commit()
        
        assert user.id is not None
        assert user.email == "test@example.com"
        assert user.hashed_password == "hashed123"

    def test_user_instantiation_all_fields(self, db_session):
        """Test creating User with all fields."""
        user = User(
            email="full@example.com",
            hashed_password="hashed",
            display_name="Full User",
            is_active=False,
            initial_capital=500000.0
        )
        db_session.add(user)
        db_session.commit()
        
        assert user.display_name == "Full User"
        assert user.is_active is False
        assert user.initial_capital == 500000.0

    def test_user_default_values(self, db_session):
        """Test User default values."""
        user = User(email="defaults@example.com", hashed_password="hashed")
        db_session.add(user)
        db_session.commit()
        
        assert user.is_active is True
        assert user.initial_capital == 1000000.0

    def test_user_email_unique_constraint(self, db_session):
        """Test that email must be unique."""
        user1 = User(email="unique@example.com", hashed_password="hashed1")
        user2 = User(email="unique@example.com", hashed_password="hashed2")
        db_session.add_all([user1, user2])
        
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_user_email_required(self, db_session):
        """Test that email is required."""
        user = User(hashed_password="hashed")
        db_session.add(user)
        
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_user_password_required(self, db_session):
        """Test that hashed_password is required."""
        user = User(email="nopass@example.com")
        db_session.add(user)
        
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_user_display_name_nullable(self, db_session):
        """Test that display_name can be null."""
        user = User(email="noname@example.com", hashed_password="hashed", display_name=None)
        db_session.add(user)
        db_session.commit()
        
        assert user.display_name is None

    def test_user_repr(self, db_session):
        """Test User __repr__ method."""
        user = User(id=1, email="repr@example.com", display_name="Repr User")
        
        repr_str = repr(user)
        
        assert "User" in repr_str
        assert "id=1" in repr_str
        assert "repr@example.com" in repr_str
        assert "Repr User" in repr_str

    def test_user_created_at_auto_set(self, db_session):
        """Test that created_at is auto-set on creation."""
        before = datetime.utcnow().replace(microsecond=0)
        user = User(email="created@example.com", hashed_password="hashed")
        db_session.add(user)
        db_session.commit()
        after = datetime.utcnow().replace(microsecond=0) + timedelta(seconds=1)
        
        assert user.created_at is not None
        created_ts = user.created_at.replace(tzinfo=None, microsecond=0)
        assert before <= created_ts <= after

    def test_user_updated_at_on_update(self, db_session):
        """Test that updated_at changes on update."""
        import time
        user = User(email="updated@example.com", hashed_password="hashed")
        db_session.add(user)
        db_session.commit()
        
        original_updated = user.updated_at
        
        time.sleep(1)
        
        user.display_name = "Updated Name"
        db_session.commit()
        
        assert user.updated_at > original_updated


class TestUserSessionModel:
    """Tests for UserSession model."""

    @pytest.fixture
    def test_user(self, db_session):
        """Create a test user."""
        user = User(email="session@example.com", hashed_password="hashed")
        db_session.add(user)
        db_session.commit()
        return user

    def test_session_instantiation(self, db_session, test_user):
        """Test creating UserSession with required fields."""
        session = UserSession(
            id="session-id-123",
            user_id=test_user.id,
            expires_at=datetime.utcnow() + timedelta(hours=1)
        )
        db_session.add(session)
        db_session.commit()
        
        assert session.id == "session-id-123"
        assert session.user_id == test_user.id
        assert session.revoked is False

    def test_session_default_revoked(self, db_session, test_user):
        """Test that revoked defaults to False."""
        session = UserSession(
            id="default-revoked",
            user_id=test_user.id,
            expires_at=datetime.utcnow() + timedelta(hours=1)
        )
        db_session.add(session)
        db_session.commit()
        
        assert session.revoked is False

    def test_session_expires_at_required(self, db_session, test_user):
        """Test that expires_at is required."""
        session = UserSession(id="no-expire", user_id=test_user.id)
        db_session.add(session)
        
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_session_user_id_required(self, db_session):
        """Test that user_id is required."""
        session = UserSession(
            id="no-user",
            expires_at=datetime.utcnow() + timedelta(hours=1)
        )
        db_session.add(session)
        
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_session_user_relationship(self, db_session, test_user):
        """Test UserSession to User relationship."""
        session = UserSession(
            id="rel-session",
            user_id=test_user.id,
            expires_at=datetime.utcnow() + timedelta(hours=1)
        )
        db_session.add(session)
        db_session.commit()
        
        assert session.user == test_user
        assert session in test_user.sessions

    def test_session_repr(self, db_session, test_user):
        """Test UserSession __repr__ method."""
        expires = datetime.utcnow() + timedelta(hours=1)
        session = UserSession(id="repr-session", user_id=test_user.id, expires_at=expires)
        
        repr_str = repr(session)
        
        assert "UserSession" in repr_str
        assert "repr-session" in repr_str
        assert str(test_user.id) in repr_str

    def test_session_cascade_delete(self, db_session, test_user):
        """Test that sessions are deleted when user is deleted."""
        session = UserSession(
            id="cascade-session",
            user_id=test_user.id,
            expires_at=datetime.utcnow() + timedelta(hours=1)
        )
        db_session.add(session)
        db_session.commit()
        
        db_session.delete(test_user)
        db_session.commit()
        
        remaining = db_session.query(UserSession).filter_by(id="cascade-session").first()
        assert remaining is None


class TestStrategyConfigModel:
    """Tests for StrategyConfig model."""

    def test_strategy_instantiation_minimal(self, db_session):
        """Test creating StrategyConfig with minimal required fields."""
        strategy = StrategyConfig(name="test_strategy", strategy_type="ORB")
        db_session.add(strategy)
        db_session.commit()
        
        assert strategy.id is not None
        assert strategy.name == "test_strategy"
        assert strategy.strategy_type == "ORB"

    def test_strategy_name_unique_constraint(self, db_session):
        """Test that name must be unique."""
        strategy1 = StrategyConfig(name="unique_strategy", strategy_type="ORB")
        strategy2 = StrategyConfig(name="unique_strategy", strategy_type="EMA_CROSS")
        db_session.add_all([strategy1, strategy2])
        
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_strategy_name_required(self, db_session):
        """Test that name is required."""
        strategy = StrategyConfig(strategy_type="ORB")
        db_session.add(strategy)
        
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_strategy_type_required(self, db_session):
        """Test that strategy_type is required."""
        strategy = StrategyConfig(name="no_type")
        db_session.add(strategy)
        
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_strategy_default_values(self, db_session):
        """Test StrategyConfig default values."""
        strategy = StrategyConfig(name="defaults", strategy_type="ORB")
        db_session.add(strategy)
        db_session.commit()
        
        assert strategy.or_minutes == 45
        assert strategy.sl_pct == 0.4
        assert strategy.tp_pct == 1.2
        assert strategy.min_or_range_pct == 0.5
        assert strategy.max_or_range_pct == 3.0
        assert strategy.max_positions == 5
        assert strategy.max_capital_per_trade_pct == 0.10
        assert strategy.max_daily_loss_pct == 0.02
        assert strategy.max_total_exposure_pct == 0.50
        assert strategy.risk_per_trade_pct == 0.01
        assert strategy.min_trade_value == 5000
        assert strategy.max_trade_value == 100000
        assert strategy.cooldown_minutes == 30
        assert strategy.max_distance_from_or_pct == 1.5
        assert strategy.brokerage_pct == 0.0003
        assert strategy.min_brokerage == 20
        assert strategy.stt_pct == 0.00025
        assert strategy.exchange_pct == 0.0000297
        assert strategy.sebi_pct == 0.000001
        assert strategy.stamp_pct == 0.00003
        assert strategy.gst_pct == 0.18
        assert strategy.is_active is True
        assert strategy.is_default is False
        assert strategy.is_template is False

    def test_strategy_parent_child_relationship(self, db_session):
        """Test StrategyConfig parent-child relationship."""
        parent = StrategyConfig(name="parent_strategy", strategy_type="ORB", is_template=True)
        db_session.add(parent)
        db_session.commit()
        
        child = StrategyConfig(
            name="child_strategy",
            strategy_type="ORB",
            parent_id=parent.id,
            is_template=False
        )
        db_session.add(child)
        db_session.commit()
        
        assert child.parent == parent
        assert child in parent.variations

    def test_strategy_self_referential_nullable(self, db_session):
        """Test that parent_id can be null for top-level strategies."""
        strategy = StrategyConfig(name="top_level", strategy_type="ORB", parent_id=None)
        db_session.add(strategy)
        db_session.commit()
        
        assert strategy.parent_id is None
        assert strategy.parent is None

    def test_strategy_repr(self, db_session):
        """Test StrategyConfig __repr__ method."""
        strategy = StrategyConfig(id=1, name="repr_strategy", strategy_type="ORB")
        
        repr_str = repr(strategy)
        
        assert "StrategyConfig" in repr_str
        assert "id=1" in repr_str
        assert "repr_strategy" in repr_str
        assert "ORB" in repr_str

    def test_strategy_to_dict(self, db_session):
        """Test StrategyConfig to_dict serialization."""
        strategy = StrategyConfig(
            name="dict_strategy",
            strategy_type="ORB",
            or_minutes=30,
            sl_pct=0.5,
            tp_pct=1.5,
            description="Test strategy"
        )
        db_session.add(strategy)
        db_session.commit()
        
        result = strategy.to_dict()
        
        assert result["name"] == "dict_strategy"
        assert result["strategy_type"] == "ORB"
        assert result["or_minutes"] == 30
        assert result["sl_pct"] == 0.5
        assert result["tp_pct"] == 1.5
        assert result["description"] == "Test strategy"
        assert "created_at" in result
        assert "updated_at" in result

    def test_strategy_to_dict_with_none_dates(self):
        """Test to_dict handles None dates gracefully."""
        strategy = StrategyConfig(name="no_dates", strategy_type="ORB")
        strategy.created_at = None
        strategy.updated_at = None
        
        result = strategy.to_dict()
        
        assert result["created_at"] is None
        assert result["updated_at"] is None

    def test_strategy_to_dict_all_fields(self, db_session):
        """Test to_dict includes all expected fields."""
        strategy = StrategyConfig(name="all_fields", strategy_type="ORB")
        db_session.add(strategy)
        db_session.commit()
        
        result = strategy.to_dict()
        
        expected_keys = [
            "id", "name", "strategy_type", "parent_id", "is_template",
            "is_active", "is_default", "description", "or_minutes",
            "sl_pct", "tp_pct", "min_or_range_pct", "max_or_range_pct",
            "max_positions", "max_capital_per_trade_pct", "max_daily_loss_pct",
            "max_total_exposure_pct", "risk_per_trade_pct", "min_trade_value",
            "max_trade_value", "cooldown_minutes", "max_distance_from_or_pct",
            "brokerage_pct", "min_brokerage", "stt_pct", "exchange_pct",
            "sebi_pct", "stamp_pct", "gst_pct", "created_at", "updated_at"
        ]
        
        for key in expected_keys:
            assert key in result


class TestBotConfigModel:
    """Tests for BotConfig model."""

    @pytest.fixture
    def test_user(self, db_session):
        """Create a test user for bot tests."""
        user = User(email="bot_test@example.com", hashed_password="hashed")
        db_session.add(user)
        db_session.commit()
        return user

    def test_bot_instantiation_minimal(self, db_session, test_user):
        """Test creating BotConfig with minimal required fields."""
        bot = BotConfig(name="test_bot", user_id=test_user.id)
        db_session.add(bot)
        db_session.commit()
        
        assert bot.id is not None
        assert bot.uuid is not None
        assert bot.name == "test_bot"
        assert bot.user_id == test_user.id

    def test_bot_name_unique_per_user(self, db_session, test_user):
        """Test that name must be unique per user."""
        bot1 = BotConfig(name="unique_bot", user_id=test_user.id)
        bot2 = BotConfig(name="unique_bot", user_id=test_user.id)
        db_session.add_all([bot1, bot2])
        
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_bot_name_can_be_same_for_different_users(self, db_session):
        """Test that different users can have bots with the same name."""
        user1 = User(email="user1@example.com", hashed_password="h1")
        user2 = User(email="user2@example.com", hashed_password="h2")
        db_session.add_all([user1, user2])
        db_session.commit()
        
        bot1 = BotConfig(name="same_name", user_id=user1.id)
        bot2 = BotConfig(name="same_name", user_id=user2.id)
        db_session.add_all([bot1, bot2])
        db_session.commit()
        
        assert bot1.id != bot2.id
        assert bot1.name == bot2.name

    def test_bot_name_required(self, db_session, test_user):
        """Test that name is required."""
        bot = BotConfig(user_id=test_user.id)
        db_session.add(bot)
        
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_bot_user_id_required(self, db_session):
        """Test that user_id is required."""
        bot = BotConfig(name="no_user_bot")
        db_session.add(bot)
        
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_bot_default_values(self, db_session, test_user):
        """Test BotConfig default values."""
        bot = BotConfig(name="defaults_bot", user_id=test_user.id)
        db_session.add(bot)
        db_session.commit()
        
        assert bot.is_active is True
        assert bot.max_total_positions == 10
        assert bot.max_total_capital_pct == 0.80
        assert bot.uuid is not None

    def test_bot_repr(self, db_session, test_user):
        """Test BotConfig __repr__ method."""
        bot = BotConfig(id=1, name="repr_bot", user_id=test_user.id)
        
        repr_str = repr(bot)
        
        assert "BotConfig" in repr_str
        assert "id=1" in repr_str
        assert "repr_bot" in repr_str
        assert f"user_id={test_user.id}" in repr_str

    def test_bot_to_dict(self, db_session, test_user):
        """Test BotConfig to_dict serialization."""
        bot = BotConfig(
            name="dict_bot",
            user_id=test_user.id,
            is_active=False,
            max_total_positions=15,
            max_total_capital_pct=0.90
        )
        db_session.add(bot)
        db_session.commit()
        
        result = bot.to_dict()
        
        assert result["name"] == "dict_bot"
        assert result["user_id"] == test_user.id
        assert result["is_active"] is False
        assert result["max_total_positions"] == 15
        assert result["max_total_capital_pct"] == 0.90
        assert "id" in result
        assert "internal_id" in result
        assert "created_at" in result
        assert "updated_at" in result
        assert result["strategies"] == []

    def test_bot_to_dict_with_strategies(self, db_session, test_user):
        """Test BotConfig to_dict with strategies."""
        bot = BotConfig(name="bot_with_strategies", user_id=test_user.id)
        strategy = StrategyConfig(name="strategy_for_bot", strategy_type="ORB")
        bot.strategies.append(strategy)
        db_session.add_all([bot, strategy])
        db_session.commit()
        
        result = bot.to_dict()
        
        assert len(result["strategies"]) == 1
        assert result["strategies"][0]["name"] == "strategy_for_bot"
        assert result["strategies"][0]["strategy_type"] == "ORB"

    def test_bot_to_dict_with_none_dates(self, test_user):
        """Test to_dict handles None dates gracefully."""
        bot = BotConfig(name="no_dates_bot", user_id=test_user.id)
        bot.created_at = None
        bot.updated_at = None
        
        result = bot.to_dict()
        
        assert result["created_at"] is None
        assert result["updated_at"] is None


class TestBotStrategyRelationship:
    """Tests for Bot-Strategy many-to-many relationship."""

    @pytest.fixture
    def test_user(self, db_session):
        """Create a test user for bot tests."""
        user = User(email="bot_rel@example.com", hashed_password="hashed")
        db_session.add(user)
        db_session.commit()
        return user

    def test_bot_strategy_association(self, db_session, test_user):
        """Test adding strategies to a bot."""
        bot = BotConfig(name="multi_bot", user_id=test_user.id)
        strategy1 = StrategyConfig(name="s1", strategy_type="ORB")
        strategy2 = StrategyConfig(name="s2", strategy_type="EMA_CROSS")
        
        bot.strategies.append(strategy1)
        bot.strategies.append(strategy2)
        
        db_session.add_all([bot, strategy1, strategy2])
        db_session.commit()
        
        assert len(bot.strategies) == 2
        assert strategy1 in bot.strategies
        assert strategy2 in bot.strategies

    def test_strategy_multiple_bots(self, db_session, test_user):
        """Test that a strategy can be used by multiple bots."""
        strategy = StrategyConfig(name="shared_strategy", strategy_type="ORB")
        bot1 = BotConfig(name="bot1", user_id=test_user.id)
        bot2 = BotConfig(name="bot2", user_id=test_user.id)
        
        bot1.strategies.append(strategy)
        bot2.strategies.append(strategy)
        
        db_session.add_all([strategy, bot1, bot2])
        db_session.commit()
        
        assert strategy in bot1.strategies
        assert strategy in bot2.strategies
        assert len(strategy.bots) == 2

    def test_remove_strategy_from_bot(self, db_session, test_user):
        """Test removing a strategy from a bot."""
        bot = BotConfig(name="removal_bot", user_id=test_user.id)
        strategy = StrategyConfig(name="removable", strategy_type="ORB")
        
        bot.strategies.append(strategy)
        db_session.add_all([bot, strategy])
        db_session.commit()
        
        bot.strategies.remove(strategy)
        db_session.commit()
        
        assert len(bot.strategies) == 0
        assert strategy not in bot.strategies

    def test_bot_strategies_table_columns(self, db_session):
        """Test bot_strategies association table has extra columns."""
        inspector = inspect(db_session.bind)
        columns = {col['name']: col['type'] for col in inspector.get_columns('bot_strategies')}
        
        assert 'bot_id' in columns
        assert 'strategy_id' in columns
        assert 'max_positions' in columns
        assert 'capital_allocation_pct' in columns


class TestModelConstraints:
    """Tests for database constraints."""

    def test_user_email_unique_case_insensitive(self, db_session):
        """Test email uniqueness (note: SQLite is case-sensitive by default).
        
        SQLite treats 'Case@Example.com' and 'case@example.com' as different
        strings, so both are inserted successfully. A production database
        with a case-insensitive collation or a unique index with LOWER()
        would reject the second insert.
        """
        user1 = User(email="Case@Example.com", hashed_password="h1")
        user2 = User(email="case@example.com", hashed_password="h2")
        db_session.add_all([user1, user2])
        
        db_session.commit()
        
        assert user1.id != user2.id
        assert user1.email == "Case@Example.com"
        assert user2.email == "case@example.com"

    def test_foreign_key_user_session_to_user(self, db_session):
        """Test foreign key constraint on user_session.user_id."""
        session = UserSession(
            id="invalid-fk",
            user_id=9999,
            expires_at=datetime.utcnow() + timedelta(hours=1)
        )
        db_session.add(session)
        
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_foreign_key_strategy_parent(self, db_session):
        """Test foreign key constraint on strategy.parent_id."""
        strategy = StrategyConfig(
            name="invalid-parent",
            strategy_type="ORB",
            parent_id=9999
        )
        db_session.add(strategy)
        
        with pytest.raises(IntegrityError):
            db_session.commit()


class TestModelTimestamps:
    """Tests for timestamp behavior across models."""

    def test_user_timestamps_auto_set(self, db_session):
        """Test that User timestamps are auto-set within expected range."""
        before = datetime.utcnow() - timedelta(seconds=5)
        user = User(email="ts@example.com", hashed_password="hashed")
        db_session.add(user)
        db_session.commit()
        after = datetime.utcnow() + timedelta(seconds=5)
        
        assert user.created_at is not None
        assert user.updated_at is not None
        assert before <= user.created_at <= after
        assert before <= user.updated_at <= after

    def test_strategy_timestamps_auto_set(self, db_session):
        """Test that StrategyConfig timestamps are auto-set within expected range."""
        before = datetime.utcnow() - timedelta(seconds=5)
        strategy = StrategyConfig(name="ts_strategy", strategy_type="ORB")
        db_session.add(strategy)
        db_session.commit()
        after = datetime.utcnow() + timedelta(seconds=5)
        
        assert strategy.created_at is not None
        assert strategy.updated_at is not None
        assert before <= strategy.created_at <= after
        assert before <= strategy.updated_at <= after

    def test_bot_timestamps_auto_set(self, db_session):
        """Test that BotConfig timestamps are auto-set within expected range."""
        before = datetime.utcnow() - timedelta(seconds=5)
        user = User(email="bot_ts@example.com", hashed_password="hashed")
        db_session.add(user)
        db_session.commit()
        
        bot = BotConfig(name="ts_bot", user_id=user.id)
        db_session.add(bot)
        db_session.commit()
        after = datetime.utcnow() + timedelta(seconds=5)
        
        assert bot.created_at is not None
        assert bot.updated_at is not None
        assert before <= bot.created_at <= after
        assert before <= bot.updated_at <= after


class TestModelSerialization:
    """Tests for model serialization methods."""

    def test_strategy_to_dict_datetime_format(self, db_session):
        """Test that to_dict serializes datetime to ISO format."""
        strategy = StrategyConfig(name="dt_strategy", strategy_type="ORB")
        db_session.add(strategy)
        db_session.commit()
        
        result = strategy.to_dict()
        
        assert isinstance(result["created_at"], str)
        assert isinstance(result["updated_at"], str)
        datetime.fromisoformat(result["created_at"])
        datetime.fromisoformat(result["updated_at"])

    def test_bot_to_dict_datetime_format(self, db_session):
        """Test that bot to_dict serializes datetime to ISO format."""
        user = User(email="bot_dt@example.com", hashed_password="hashed")
        db_session.add(user)
        db_session.commit()
        
        bot = BotConfig(name="dt_bot", user_id=user.id)
        db_session.add(bot)
        db_session.commit()
        
        result = bot.to_dict()
        
        assert isinstance(result["created_at"], str)
        assert isinstance(result["updated_at"], str)
        datetime.fromisoformat(result["created_at"])
        datetime.fromisoformat(result["updated_at"])


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_user_empty_display_name(self, db_session):
        """Test User with empty display_name."""
        user = User(email="empty@example.com", hashed_password="hashed", display_name="")
        db_session.add(user)
        db_session.commit()
        
        assert user.display_name == ""

    def test_strategy_zero_values(self, db_session):
        """Test StrategyConfig with zero numeric values."""
        strategy = StrategyConfig(
            name="zero_values",
            strategy_type="ORB",
            sl_pct=0.0,
            tp_pct=0.0,
            max_positions=0
        )
        db_session.add(strategy)
        db_session.commit()
        
        assert strategy.sl_pct == 0.0
        assert strategy.tp_pct == 0.0
        assert strategy.max_positions == 0

    def test_strategy_negative_values(self, db_session):
        """Test StrategyConfig with negative values (allowed by schema)."""
        strategy = StrategyConfig(
            name="negative",
            strategy_type="ORB",
            sl_pct=-0.5,
            max_positions=-1
        )
        db_session.add(strategy)
        db_session.commit()
        
        assert strategy.sl_pct == -0.5
        assert strategy.max_positions == -1

    def test_user_large_initial_capital(self, db_session):
        """Test User with very large initial_capital."""
        user = User(
            email="large@example.com",
            hashed_password="hashed",
            initial_capital=1e12
        )
        db_session.add(user)
        db_session.commit()
        
        assert user.initial_capital == 1e12

    def test_bot_many_strategies(self, db_session):
        """Test Bot with many strategies."""
        user = User(email="many_strats@example.com", hashed_password="hashed")
        db_session.add(user)
        db_session.commit()
        
        bot = BotConfig(name="many_strategies", user_id=user.id)
        strategies = [
            StrategyConfig(name=f"strategy_{i}", strategy_type="ORB")
            for i in range(10)
        ]
        bot.strategies.extend(strategies)
        db_session.add_all([bot] + strategies)
        db_session.commit()
        
        assert len(bot.strategies) == 10

    def test_strategy_deep_nesting(self, db_session):
        """Test StrategyConfig with deep parent-child nesting."""
        strategies = []
        for i in range(5):
            parent_id = strategies[-1].id if strategies else None
            strategy = StrategyConfig(
                name=f"nested_{i}",
                strategy_type="ORB",
                parent_id=parent_id
            )
            db_session.add(strategy)
            db_session.commit()
            strategies.append(strategy)
        
        for i, strategy in enumerate(strategies[1:], 1):
            assert strategy.parent == strategies[i - 1]


class TestModelQueries:
    """Tests for common query patterns."""

    def test_query_user_by_email(self, db_session):
        """Test querying user by email."""
        user = User(email="query@example.com", hashed_password="hashed")
        db_session.add(user)
        db_session.commit()
        
        result = db_session.query(User).filter_by(email="query@example.com").first()
        
        assert result == user

    def test_query_active_users(self, db_session):
        """Test querying active users."""
        active = User(email="active@example.com", hashed_password="h", is_active=True)
        inactive = User(email="inactive@example.com", hashed_password="h", is_active=False)
        db_session.add_all([active, inactive])
        db_session.commit()
        
        results = db_session.query(User).filter_by(is_active=True).all()
        
        assert len(results) == 1
        assert results[0].email == "active@example.com"

    def test_query_template_strategies(self, db_session):
        """Test querying template strategies."""
        template = StrategyConfig(name="template", strategy_type="ORB", is_template=True)
        variation = StrategyConfig(name="variation", strategy_type="ORB", is_template=False)
        db_session.add_all([template, variation])
        db_session.commit()
        
        results = db_session.query(StrategyConfig).filter_by(is_template=True).all()
        
        assert len(results) == 1
        assert results[0].name == "template"

    def test_query_active_bots(self, db_session):
        """Test querying active bots."""
        user = User(email="active_bots@example.com", hashed_password="h")
        db_session.add(user)
        db_session.commit()
        
        active = BotConfig(name="active_bot", user_id=user.id, is_active=True)
        inactive = BotConfig(name="inactive_bot", user_id=user.id, is_active=False)
        db_session.add_all([active, inactive])
        db_session.commit()
        
        results = db_session.query(BotConfig).filter_by(is_active=True).all()
        
        assert len(results) == 1
        assert results[0].name == "active_bot"

    def test_query_sessions_by_user(self, db_session):
        """Test querying sessions by user."""
        user = User(email="sessions@example.com", hashed_password="h")
        db_session.add(user)
        db_session.commit()
        
        session1 = UserSession(
            id="s1",
            user_id=user.id,
            expires_at=datetime.utcnow() + timedelta(hours=1)
        )
        session2 = UserSession(
            id="s2",
            user_id=user.id,
            expires_at=datetime.utcnow() + timedelta(hours=1)
        )
        db_session.add_all([session1, session2])
        db_session.commit()
        
        results = db_session.query(UserSession).filter_by(user_id=user.id).all()
        
        assert len(results) == 2

    def test_query_strategies_by_type(self, db_session):
        """Test querying strategies by type."""
        orb = StrategyConfig(name="orb1", strategy_type="ORB")
        ema = StrategyConfig(name="ema1", strategy_type="EMA_CROSS")
        db_session.add_all([orb, ema])
        db_session.commit()
        
        results = db_session.query(StrategyConfig).filter_by(strategy_type="ORB").all()
        
        assert len(results) == 1
        assert results[0].name == "orb1"


class TestTableStructure:
    """Tests for database table structure."""

    def test_users_table_exists(self, db_session):
        """Test that users table is created."""
        inspector = inspect(db_session.bind)
        tables = inspector.get_table_names()
        
        assert "users" in tables

    def test_sessions_table_exists(self, db_session):
        """Test that sessions table is created."""
        inspector = inspect(db_session.bind)
        tables = inspector.get_table_names()
        
        assert "sessions" in tables

    def test_strategy_configs_table_exists(self, db_session):
        """Test that strategy_configs table is created."""
        inspector = inspect(db_session.bind)
        tables = inspector.get_table_names()
        
        assert "strategy_configs" in tables

    def test_bot_configs_table_exists(self, db_session):
        """Test that bot_configs table is created."""
        inspector = inspect(db_session.bind)
        tables = inspector.get_table_names()
        
        assert "bot_configs" in tables

    def test_bot_strategies_table_exists(self, db_session):
        """Test that bot_strategies table is created."""
        inspector = inspect(db_session.bind)
        tables = inspector.get_table_names()
        
        assert "bot_strategies" in tables

    def test_users_table_columns(self, db_session):
        """Test users table has expected columns."""
        inspector = inspect(db_session.bind)
        columns = {col['name'] for col in inspector.get_columns('users')}
        
        expected = {'id', 'email', 'hashed_password', 'display_name', 
                   'created_at', 'updated_at', 'is_active', 'initial_capital'}
        
        assert expected.issubset(columns)

    def test_sessions_table_columns(self, db_session):
        """Test sessions table has expected columns."""
        inspector = inspect(db_session.bind)
        columns = {col['name'] for col in inspector.get_columns('sessions')}
        
        expected = {'id', 'user_id', 'created_at', 'expires_at', 'revoked'}
        
        assert expected.issubset(columns)

    def test_strategy_configs_table_columns(self, db_session):
        """Test strategy_configs table has expected columns."""
        inspector = inspect(db_session.bind)
        columns = {col['name'] for col in inspector.get_columns('strategy_configs')}
        
        expected = {
            'id', 'name', 'strategy_type', 'parent_id', 'is_template',
            'is_active', 'is_default', 'description', 'or_minutes',
            'sl_pct', 'tp_pct', 'min_or_range_pct', 'max_or_range_pct',
            'max_positions', 'max_capital_per_trade_pct', 'max_daily_loss_pct',
            'max_total_exposure_pct', 'risk_per_trade_pct', 'min_trade_value',
            'max_trade_value', 'cooldown_minutes', 'max_distance_from_or_pct',
            'brokerage_pct', 'min_brokerage', 'stt_pct', 'exchange_pct',
            'sebi_pct', 'stamp_pct', 'gst_pct', 'created_at', 'updated_at'
        }
        
        assert expected.issubset(columns)

    def test_bot_configs_table_columns(self, db_session):
        """Test bot_configs table has expected columns."""
        inspector = inspect(db_session.bind)
        columns = {col['name'] for col in inspector.get_columns('bot_configs')}
        
        expected = {'id', 'uuid', 'user_id', 'name', 'is_active', 'max_total_positions',
                   'max_total_capital_pct', 'created_at', 'updated_at'}
        
        assert expected.issubset(columns)
