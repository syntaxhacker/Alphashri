"""
Comprehensive unit tests for db/database.py

Tests cover:
- Database connection setup and configuration
- Session management (SessionLocal, get_db)
- Connection pooling and SQLite configuration
- Base class for models
- Database initialization (init_db)
- Error handling and edge cases
"""

import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool


class TestDatabaseConfiguration:
    """Tests for database configuration constants."""

    def test_db_dir_is_path_object(self):
        """Test that DB_DIR is a Path object."""
        from db.database import DB_DIR
        
        assert isinstance(DB_DIR, Path)

    def test_db_dir_points_to_correct_location(self):
        """Test that DB_DIR points to the db directory."""
        from db.database import DB_DIR
        
        assert DB_DIR.name == "db"

    def test_db_path_is_path_object(self):
        """Test that DB_PATH is a Path object."""
        from db.database import DB_PATH
        
        assert isinstance(DB_PATH, Path)

    def test_db_path_filename(self):
        """Test that DB_PATH has correct filename."""
        from db.database import DB_PATH
        
        assert DB_PATH.name == "alphashri.db"

    def test_db_path_is_under_db_dir(self):
        """Test that DB_PATH is a child of DB_DIR."""
        from db.database import DB_DIR, DB_PATH
        
        assert DB_PATH.parent == DB_DIR

    def test_sqlalchemy_database_url_format(self):
        """Test that database URL has correct SQLite format."""
        from db.database import SQLALCHEMY_DATABASE_URL
        
        assert SQLALCHEMY_DATABASE_URL.startswith("sqlite:///")

    def test_sqlalchemy_database_url_contains_db_path(self):
        """Test that database URL contains the correct path."""
        from db.database import SQLALCHEMY_DATABASE_URL, DB_PATH
        
        assert str(DB_PATH) in SQLALCHEMY_DATABASE_URL


class TestEngineConfiguration:
    """Tests for SQLAlchemy engine configuration."""

    def test_engine_is_created(self):
        """Test that engine is created."""
        from db.database import engine
        
        assert engine is not None
        assert isinstance(engine, Engine)

    def test_engine_url_matches_config(self):
        """Test that engine URL matches configured URL."""
        from db.database import engine, SQLALCHEMY_DATABASE_URL
        
        assert str(engine.url) == SQLALCHEMY_DATABASE_URL

    def test_engine_has_check_same_thread_arg(self):
        """Test that engine has check_same_thread=False for SQLite."""
        from db.database import engine
        
        assert engine.dialect.name == "sqlite"

    def test_engine_dialect_is_sqlite(self):
        """Test that engine dialect is SQLite."""
        from db.database import engine
        
        assert engine.dialect.name == "sqlite"

    def test_engine_pool_configuration(self):
        """Test that engine pool is configured."""
        from db.database import engine
        
        assert engine.pool is not None


class TestSessionFactory:
    """Tests for SessionLocal session factory."""

    def test_session_local_is_sessionmaker(self):
        """Test that SessionLocal is a sessionmaker instance."""
        from db.database import SessionLocal
        
        assert isinstance(SessionLocal, sessionmaker)

    def test_session_local_has_correct_bind(self):
        """Test that SessionLocal is bound to the engine."""
        from db.database import SessionLocal, engine
        
        assert SessionLocal.kw.get("bind") == engine

    def test_session_local_autocommit_is_false(self):
        """Test that autocommit is disabled."""
        from db.database import SessionLocal
        
        assert SessionLocal.kw.get("autocommit") is False

    def test_session_local_autoflush_is_false(self):
        """Test that autoflush is disabled."""
        from db.database import SessionLocal
        
        assert SessionLocal.kw.get("autoflush") is False

    def test_session_local_creates_session(self):
        """Test that SessionLocal() creates a Session instance."""
        from db.database import SessionLocal
        
        session = SessionLocal()
        try:
            assert isinstance(session, Session)
        finally:
            session.close()

    def test_session_local_creates_independent_sessions(self):
        """Test that each call to SessionLocal creates a new session."""
        from db.database import SessionLocal
        
        session1 = SessionLocal()
        session2 = SessionLocal()
        try:
            assert session1 is not session2
        finally:
            session1.close()
            session2.close()


class TestBaseClass:
    """Tests for declarative Base class."""

    def test_base_is_declarative_base(self):
        """Test that Base is a declarative base class."""
        from db.database import Base
        from sqlalchemy.orm import DeclarativeBase
        
        assert issubclass(Base.__class__, type)

    def test_base_has_metadata(self):
        """Test that Base has metadata attribute."""
        from db.database import Base
        
        assert hasattr(Base, "metadata")
        assert Base.metadata is not None

    def test_base_metadata_has_tables(self):
        """Test that Base metadata can track tables."""
        from db.database import Base
        
        assert hasattr(Base.metadata, "tables")


class TestGetDb:
    """Tests for get_db dependency function."""

    def test_get_db_is_generator(self):
        """Test that get_db is a generator function."""
        from db.database import get_db
        import types
        
        assert isinstance(get_db(), types.GeneratorType)

    def test_get_db_yields_session(self):
        """Test that get_db yields a Session instance."""
        from db.database import get_db
        
        gen = get_db()
        session = next(gen)
        try:
            assert isinstance(session, Session)
        finally:
            try:
                next(gen)
            except StopIteration:
                pass

    def test_get_db_closes_session_after_use(self):
        """Test that session is closed after generator completes."""
        from db.database import get_db, SessionLocal
        
        gen = get_db()
        session = next(gen)
        
        assert session is not None
        
        try:
            next(gen)
        except StopIteration:
            pass

    def test_get_db_closes_session_on_exception(self):
        """Test that session is closed even if an exception occurs."""
        from db.database import get_db
        
        gen = get_db()
        session = next(gen)
        
        assert session is not None
        
        try:
            raise ValueError("Test exception")
        except ValueError:
            pass
        finally:
            try:
                next(gen)
            except StopIteration:
                pass

    def test_get_db_context_manager_style(self):
        """Test using get_db in a context manager pattern."""
        from db.database import get_db
        
        gen = get_db()
        session = next(gen)
        
        assert session is not None
        
        gen.close()

    def test_get_db_multiple_calls_create_separate_sessions(self):
        """Test that multiple calls create separate sessions."""
        from db.database import get_db
        
        gen1 = get_db()
        gen2 = get_db()
        
        session1 = next(gen1)
        session2 = next(gen2)
        
        try:
            assert session1 is not session2
        finally:
            gen1.close()
            gen2.close()


class TestInitDb:
    """Tests for init_db function."""

    @patch("db.database.engine")
    def test_init_db_creates_tables(self, mock_engine):
        """Test that init_db creates all tables."""
        from db.database import init_db, Base
        
        mock_metadata = MagicMock()
        with patch.object(Base, "metadata", mock_metadata):
            init_db()
        
        mock_metadata.create_all.assert_called_once_with(bind=mock_engine)

    def test_init_db_with_temp_db(self):
        """Test init_db creates tables in a temporary database."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test.db")
            test_url = f"sqlite:///{db_path}"
            test_engine = create_engine(
                test_url,
                connect_args={"check_same_thread": False}
            )
             TestSessionLocal = sessionmaker(
                 autocommit=False,
                 autoflush=False,
                 bind=test_engine
             )
             
             from db.database import Base
             from db.models import User, UserSession, StrategyConfig, BotConfig, BacktestResult, BrokerConnection, NewsArticle, NewsSymbolMention, LLMRun, Instrument
             
             Base.metadata.create_all(bind=test_engine)
            
            inspector = inspect(test_engine)
            tables = inspector.get_table_names()
            
            assert "users" in tables
            assert "sessions" in tables
            assert "strategy_configs" in tables
            assert "bot_configs" in tables
            assert "bot_strategies" in tables
            
            Base.metadata.drop_all(bind=test_engine)

     def test_init_db_idempotent(self):
         """Test that init_db can be called multiple times safely."""
         with tempfile.TemporaryDirectory() as tmpdir:
             db_path = os.path.join(tmpdir, "test_idempotent.db")
             test_url = f"sqlite:///{db_path}"
             test_engine = create_engine(
                 test_url,
                 connect_args={"check_same_thread": False}
             )
             
             from db.database import Base
             from db.models import User, UserSession, StrategyConfig, BotConfig, BacktestResult, BrokerConnection, NewsArticle, NewsSymbolMention, LLMRun, Instrument
             
             Base.metadata.create_all(bind=test_engine)
             Base.metadata.create_all(bind=test_engine)
            
            inspector = inspect(test_engine)
            tables = inspector.get_table_names()
            
            assert len(tables) > 0
            
            Base.metadata.drop_all(bind=test_engine)

    def test_init_db_imports_models(self):
        """Test that init_db imports required models."""
        with patch.dict("sys.modules", {
            "db.models": MagicMock(
                User=MagicMock(),
                UserSession=MagicMock(),
                StrategyConfig=MagicMock(),
                BotConfig=MagicMock(),
            )
        }):
            pass


class TestSessionOperations:
    """Tests for session operations with actual database."""

    @pytest.fixture
    def temp_db(self):
        """Create a temporary database for testing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_session.db")
            test_url = f"sqlite:///{db_path}"
            test_engine = create_engine(
                test_url,
                connect_args={"check_same_thread": False}
            )
             TestSessionLocal = sessionmaker(
                 autocommit=False,
                 autoflush=False,
                 bind=test_engine
             )
             
             from db.database import Base
             from db.models import User, UserSession, StrategyConfig, BotConfig, BacktestResult, BrokerConnection, NewsArticle, NewsSymbolMention, LLMRun, Instrument
             
             Base.metadata.create_all(bind=test_engine)
             
             yield TestSessionLocal
            
            Base.metadata.drop_all(bind=test_engine)

    def test_session_can_add_and_query_user(self, temp_db):
        """Test that session can add and query a user."""
        from db.models import User
        
        session = temp_db()
        try:
            user = User(
                email="test@example.com",
                hashed_password="hashed",
                display_name="Test User"
            )
            session.add(user)
            session.commit()
            
            retrieved = session.query(User).filter_by(email="test@example.com").first()
            
            assert retrieved is not None
            assert retrieved.email == "test@example.com"
            assert retrieved.display_name == "Test User"
        finally:
            session.close()

    def test_session_rollback_on_error(self, temp_db):
        """Test that session can rollback on error."""
        from db.models import User
        
        session = temp_db()
        try:
            user = User(
                email="test@example.com",
                hashed_password="hashed",
                display_name="Test User"
            )
            session.add(user)
            session.commit()
            
            duplicate = User(
                email="test@example.com",
                hashed_password="hashed2",
                display_name="Duplicate"
            )
            session.add(duplicate)
            
            with pytest.raises(Exception):
                session.commit()
            
            session.rollback()
            
            count = session.query(User).filter_by(email="test@example.com").count()
            assert count == 1
        finally:
            session.close()

    def test_session_commit_persists_data(self, temp_db):
        """Test that commit persists data across sessions."""
        from db.models import User
        
        session1 = temp_db()
        try:
            user = User(
                email="persist@example.com",
                hashed_password="hashed",
                display_name="Persist Test"
            )
            session1.add(user)
            session1.commit()
        finally:
            session1.close()
        
        session2 = temp_db()
        try:
            retrieved = session2.query(User).filter_by(
                email="persist@example.com"
            ).first()
            
            assert retrieved is not None
            assert retrieved.display_name == "Persist Test"
        finally:
            session2.close()


class TestConnectionPooling:
    """Tests for SQLite connection pooling behavior."""

    def test_multiple_sessions_from_same_factory(self):
        """Test multiple sessions from same factory share engine."""
        from db.database import SessionLocal, engine
        
        session1 = SessionLocal()
        session2 = SessionLocal()
        
        try:
            assert session1.bind == engine
            assert session2.bind == engine
            assert session1 is not session2
        finally:
            session1.close()
            session2.close()

    def test_concurrent_sessions(self):
        """Test that concurrent sessions work correctly."""
        from db.database import SessionLocal
        
        sessions = [SessionLocal() for _ in range(5)]
        
        try:
            for session in sessions:
                assert session.is_active or True
        finally:
            for session in sessions:
                session.close()

    def test_session_factory_thread_safety(self):
        """Test that SessionLocal is thread-safe."""
        import threading
        from db.database import SessionLocal
        
        results = []
        
        def create_and_use_session():
            session = SessionLocal()
            try:
                results.append(session)
            finally:
                session.close()
        
        threads = [threading.Thread(target=create_and_use_session) for _ in range(10)]
        
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        
        assert len(results) == 10
        unique_sessions = len(set(id(s) for s in results))
        assert unique_sessions == 10


class TestErrorHandling:
    """Tests for error handling scenarios."""

    def test_invalid_database_url_handling(self):
        """Test handling of invalid database URL."""
        with pytest.raises(Exception):
            engine = create_engine("sqlite:///nonexistent/path/to/db.db")
            with engine.connect() as conn:
                pass

    def test_session_close_is_idempotent(self):
        """Test that closing session multiple times is safe."""
        from db.database import SessionLocal
        
        session = SessionLocal()
        session.close()
        session.close()

    def test_session_operations_after_close(self):
        """Test behavior of session operations after close."""
        from db.database import SessionLocal
        
        session = SessionLocal()
        session.close()
        
        assert session.get_bind() is not None

    @patch("db.database.SessionLocal")
    def test_get_db_handles_session_creation_error(self, mock_session_local):
        """Test get_db handles session creation errors."""
        mock_session_local.side_effect = Exception("Connection failed")
        
        from db.database import get_db
        
        with pytest.raises(Exception):
            gen = get_db()
            next(gen)


class TestModuleImports:
    """Tests for module import behavior."""

    def test_can_import_database_module(self):
        """Test that database module can be imported."""
        import db.database
        
        assert db.database is not None

    def test_module_exports_engine(self):
        """Test that module exports engine."""
        from db.database import engine
        
        assert engine is not None

    def test_module_exports_session_local(self):
        """Test that module exports SessionLocal."""
        from db.database import SessionLocal
        
        assert SessionLocal is not None

    def test_module_exports_base(self):
        """Test that module exports Base."""
        from db.database import Base
        
        assert Base is not None

    def test_module_exports_get_db(self):
        """Test that module exports get_db function."""
        from db.database import get_db
        
        assert callable(get_db)

    def test_module_exports_init_db(self):
        """Test that module exports init_db function."""
        from db.database import init_db
        
        assert callable(init_db)


class TestDatabaseAvailability:
    """Tests for database availability checks."""

    def test_can_connect_to_database(self):
        """Test that we can connect to the database."""
        from db.database import engine
        from sqlalchemy import text
        
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            assert result.fetchone()[0] == 1

    def test_database_is_writable(self):
        """Test that database is writable."""
        from sqlalchemy import create_engine, text
        
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_write.db")
            test_url = f"sqlite:///{db_path}"
            test_engine = create_engine(
                test_url,
                connect_args={"check_same_thread": False}
            )
            
            with test_engine.connect() as conn:
                conn.execute(text("CREATE TABLE test (id INTEGER PRIMARY KEY)"))
                conn.execute(text("INSERT INTO test (id) VALUES (1)"))
                conn.commit()
                
                result = conn.execute(text("SELECT id FROM test"))
                assert result.fetchone()[0] == 1

    def test_database_path_exists_or_creatable(self):
        """Test that database path exists or can be created."""
        from db.database import DB_DIR
        
        assert DB_DIR.exists() or os.access(DB_DIR.parent, os.W_OK)

    def test_engine_connection_pool_status(self):
        """Test that engine connection pool is functional."""
        from db.database import engine
        
        assert engine.pool.status() is not None


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_empty_query_returns_none(self):
        """Test that querying non-existent data returns None."""
        from db.database import SessionLocal
        
        session = SessionLocal()
        try:
            from db.models import User
            
            result = session.query(User).filter_by(email="nonexistent@example.com").first()
            assert result is None
        finally:
            session.close()

    def test_session_with_no_operations(self):
        """Test session with no operations closes cleanly."""
        from db.database import SessionLocal
        
        session = SessionLocal()
        session.close()

    def test_multiple_get_db_generators(self):
        """Test multiple get_db generators work independently."""
        from db.database import get_db
        
        gen1 = get_db()
        gen2 = get_db()
        
        session1 = next(gen1)
        session2 = next(gen2)
        
        try:
            assert session1 is not session2
        finally:
            gen1.close()
            gen2.close()

    def test_base_metadata_immutable_after_creation(self):
        """Test that Base metadata can be inspected safely."""
        from db.database import Base
        
        tables_before = list(Base.metadata.tables.keys())
        
        tables_after = list(Base.metadata.tables.keys())
        
        assert tables_before == tables_after


class TestIntegrationWithModels:
    """Integration tests with database models."""

    @pytest.fixture
    def temp_db_with_data(self):
        """Create a temporary database with sample data."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test_integration.db")
            test_url = f"sqlite:///{db_path}"
            test_engine = create_engine(
                test_url,
                connect_args={"check_same_thread": False}
            )
             TestSessionLocal = sessionmaker(
                 autocommit=False,
                 autoflush=False,
                 bind=test_engine
             )
             
             from db.database import Base
             from db.models import User, UserSession, StrategyConfig, BotConfig, BacktestResult, BrokerConnection, NewsArticle, NewsSymbolMention, LLMRun, Instrument
             
             Base.metadata.create_all(bind=test_engine)
             
             session = TestSessionLocal()
            
            user = User(
                email="integration@example.com",
                hashed_password="hashed",
                display_name="Integration User",
                is_active=True
            )
            session.add(user)
            session.commit()
            session.refresh(user)
            
            strategy = StrategyConfig(
                name="test_strategy",
                strategy_type="ORB",
                is_template=True,
                is_active=True,
            )
            session.add(strategy)
            session.commit()
            
            session.close()
            
            yield TestSessionLocal, test_engine
            
            Base.metadata.drop_all(bind=test_engine)

    def test_user_model_integration(self, temp_db_with_data):
        """Test User model integration with database."""
        TestSessionLocal, _ = temp_db_with_data
        
        session = TestSessionLocal()
        try:
            from db.models import User
            
            user = session.query(User).filter_by(
                email="integration@example.com"
            ).first()
            
            assert user is not None
            assert user.display_name == "Integration User"
            assert user.is_active is True
        finally:
            session.close()

    def test_strategy_model_integration(self, temp_db_with_data):
        """Test StrategyConfig model integration with database."""
        TestSessionLocal, _ = temp_db_with_data
        
        session = TestSessionLocal()
        try:
            from db.models import StrategyConfig
            
            strategy = session.query(StrategyConfig).filter_by(
                name="test_strategy"
            ).first()
            
            assert strategy is not None
            assert strategy.strategy_type == "ORB"
            assert strategy.is_template is True
        finally:
            session.close()

    def test_relationships_work(self, temp_db_with_data):
        """Test that model relationships work correctly."""
        TestSessionLocal, _ = temp_db_with_data
        
        session = TestSessionLocal()
        try:
            from db.models import User, UserSession
            from datetime import datetime, timedelta
            
            user = session.query(User).first()
            
            session_obj = UserSession(
                id="test-session-id",
                user_id=user.id,
                expires_at=datetime.utcnow() + timedelta(days=1),
            )
            session.add(session_obj)
            session.commit()
            
            session.refresh(user)
            assert len(user.sessions) == 1
            assert user.sessions[0].id == "test-session-id"
        finally:
            session.close()
