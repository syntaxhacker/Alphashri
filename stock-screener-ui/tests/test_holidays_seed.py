"""Tests for trading.holidays_seed.seed_missing_holidays.

Uses an isolated in-memory SQLite engine only — never the real DB file.
``db.database.SessionLocal`` is monkeypatched to the in-memory session
factory, which both ``seed_missing_holidays`` and ``trading.utils``
(late ``from db.database import SessionLocal`` imports) resolve through.
"""

from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db.database import Base
from tests.helpers.db import import_all_models


@pytest.fixture()
def mem_session_factory(monkeypatch):
    import_all_models()
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    import db.database as db_database

    monkeypatch.setattr(db_database, "SessionLocal", Factory)

    # Reset the trading.utils holiday cache so is_trading_holiday() reads
    # the in-memory test DB instead of stale production state.
    import trading.utils as trading_utils

    monkeypatch.setattr(trading_utils, "_cache", None)
    monkeypatch.setattr(trading_utils, "_cache_timestamp", 0)

    yield Factory

    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_seed_inserts_expected_count_and_is_idempotent(mem_session_factory):
    from db.models.holiday import MarketHoliday
    from trading.holidays_seed import (
        CLEARING_HOLIDAYS_2026,
        TRADING_HOLIDAYS_2026,
        seed_missing_holidays,
    )

    expected = len(
        {d for d, _ in TRADING_HOLIDAYS_2026} | {d for d, _ in CLEARING_HOLIDAYS_2026}
    )
    assert expected == 21

    assert seed_missing_holidays(2026) == expected

    db = mem_session_factory()
    try:
        assert db.query(MarketHoliday).count() == expected
    finally:
        db.close()

    # Second call adds nothing.
    assert seed_missing_holidays(2026) == 0

    db = mem_session_factory()
    try:
        assert db.query(MarketHoliday).count() == expected
    finally:
        db.close()


def test_date_in_both_lists_stored_once_as_trading(mem_session_factory):
    from db.models.holiday import HolidayType, MarketHoliday
    from trading.holidays_seed import seed_missing_holidays

    seed_missing_holidays(2026)

    db = mem_session_factory()
    try:
        # 2026-01-15 appears in both TRADING_HOLIDAYS_2026 and CLEARING_HOLIDAYS_2026.
        rows = (
            db.query(MarketHoliday)
            .filter(MarketHoliday.date == date(2026, 1, 15))
            .all()
        )
        assert len(rows) == 1
        assert rows[0].type == HolidayType.TRADING
    finally:
        db.close()


def test_gandhi_jayanti_is_trading_holiday_after_seeding(mem_session_factory):
    from trading.holidays_seed import seed_missing_holidays
    from trading.utils import is_trading_holiday

    seed_missing_holidays(2026)

    assert is_trading_holiday(date(2026, 10, 2)) is True


def test_preexisting_rows_are_skipped_without_error(mem_session_factory):
    from db.models.holiday import HolidayType, MarketHoliday
    from trading.holidays_seed import seed_missing_holidays

    db = mem_session_factory()
    try:
        db.add(
            MarketHoliday(
                date=date(2026, 10, 2),
                description="pre-existing",
                type=HolidayType.TRADING,
            )
        )
        db.commit()
    finally:
        db.close()

    # 21 unique dates, 1 already present -> 20 added, no unique-constraint raise.
    assert seed_missing_holidays(2026) == 20
    assert seed_missing_holidays(2026) == 0


def test_unknown_year_adds_nothing(mem_session_factory):
    from trading.holidays_seed import seed_missing_holidays

    assert seed_missing_holidays(2027) == 0
