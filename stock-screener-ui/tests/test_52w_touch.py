"""
Tests for Stock52WeekTouch model.

Tests cover:
- Model instantiation and constraints
- Unique constraint on (symbol, touched_date)
- Serialization
"""

import pytest
from datetime import datetime, timedelta
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from db.database import Base
from db.models import Stock52WeekTouch


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

    # Import all models to ensure they're registered
    from tests.helpers.db import import_all_models
    import_all_models()
    Base.metadata.create_all(bind=engine)

    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


class TestStock52WeekTouchModel:
    """Tests for Stock52WeekTouch model."""

    def test_instantiation_minimal(self, db_session):
        """Test creating record with minimal required fields."""
        from datetime import datetime as dt
        record = Stock52WeekTouch(
            symbol="RELIANCE",
            touched_date=dt.now(),
            touched_price=2500.0,
        )
        db_session.add(record)
        db_session.commit()

        assert record.id is not None
        assert record.symbol == "RELIANCE"
        assert record.touched_price == 2500.0
        assert record.is_high is True  # default
        assert record.is_current_52w_high is False  # default

    def test_symbol_required(self, db_session):
        """Test that symbol is required."""
        from datetime import datetime as dt
        record = Stock52WeekTouch(
            touched_date=dt.now(),
            touched_price=2500.0,
        )
        db_session.add(record)
        with pytest.raises(Exception):
            db_session.commit()

    def test_touched_date_required(self, db_session):
        """Test that touched_date is required."""
        from datetime import datetime as dt
        record = Stock52WeekTouch(
            symbol="TCS",
            touched_price=3800.0,
        )
        db_session.add(record)
        with pytest.raises(Exception):
            db_session.commit()

    def test_touched_price_required(self, db_session):
        """Test that touched_price is required."""
        from datetime import datetime as dt
        record = Stock52WeekTouch(
            symbol="HDFC",
            touched_date=dt.now(),
        )
        db_session.add(record)
        with pytest.raises(Exception):
            db_session.commit()

    def test_unique_constraint_symbol_touched_date(self, db_session):
        """Test unique constraint on (symbol, touched_date)."""
        from datetime import datetime as dt
        today = dt.now().replace(hour=0, minute=0, second=0, microsecond=0)

        record1 = Stock52WeekTouch(
            symbol="ADANIGREEN",
            touched_date=today,
            touched_price=1250.0,
        )
        record2 = Stock52WeekTouch(
            symbol="ADANIGREEN",
            touched_date=today,
            touched_price=1255.0,
        )
        db_session.add_all([record1, record2])

        with pytest.raises(Exception):
            db_session.commit()

    def test_same_symbol_different_dates_allowed(self, db_session):
        """Test same symbol can have records on different dates."""
        from datetime import datetime as dt
        today = dt.now()
        yesterday = today - timedelta(days=1)

        record1 = Stock52WeekTouch(
            symbol="ADANIGREEN",
            touched_date=today,
            touched_price=1250.0,
        )
        record2 = Stock52WeekTouch(
            symbol="ADANIGREEN",
            touched_date=yesterday,
            touched_price=1240.0,
        )
        db_session.add_all([record1, record2])
        db_session.commit()

        assert record1.id is not None
        assert record2.id is not None

    def test_to_dict_serialization(self, db_session):
        """Test to_dict method."""
        from datetime import datetime as dt
        touch_date = dt(2026, 4, 25, 10, 30, 0)
        record = Stock52WeekTouch(
            symbol="TESTSTOCK",
            touched_date=touch_date,
            touched_price=1000.0,
            is_high=True,
            is_current_52w_high=True,
        )
        db_session.add(record)
        db_session.commit()

        result = record.to_dict()

        assert result["symbol"] == "TESTSTOCK"
        assert result["touched_date"] == touch_date.isoformat()
        assert result["touched_price"] == 1000.0
        assert result["is_high"] is True
        assert result["is_current_52w_high"] is True
        assert "id" in result
        assert "created_at" in result

    def test_repr(self, db_session):
        """Test __repr__ method."""
        from datetime import datetime as dt
        record = Stock52WeekTouch(
            symbol="REP",
            touched_date=dt(2026, 4, 25),
            touched_price=500.0,
            is_high=True,
        )
        db_session.add(record)
        db_session.commit()

        repr_str = repr(record)
        assert "Stock52WeekTouch" in repr_str
        assert "REP" in repr_str
        assert "500.0" in repr_str
