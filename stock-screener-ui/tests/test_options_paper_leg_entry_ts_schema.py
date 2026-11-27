"""Per-leg entry timestamps for staggered multi-leg option paper structures.

A NULL leg ``entry_ts`` is the legacy "entered with the position" marker; a leg
added in a later session carries its own time and premium. These tests use the
in-memory SQLite schema fixture, never db/alphashri.db.
"""
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import joinedload, sessionmaker

from db.models import OptionPaperLeg, OptionPaperPosition, User

POSITION_TS = datetime(2026, 11, 17, 9, 47, tzinfo=timezone.utc)
LATER_TS = POSITION_TS + timedelta(days=1)


def _as_utc(value):
    # SQLite drops tzinfo on DateTime(timezone=True); normalise for comparisons.
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@pytest.fixture
def session(test_db_engine):
    with test_db_engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
    SessionLocal = sessionmaker(
        bind=test_db_engine, autoflush=False, autocommit=False
    )
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def user(session):
    user = User(
        email="leg-entry-ts@example.com",
        hashed_password="hashed",
        display_name="Leg Entry TS",
    )
    session.add(user)
    session.commit()
    return user


def _position(user, **overrides):
    fields = dict(
        user_id=user.id,
        source="live",
        status="open",
        underlying="IRFC",
        expiry="2026-11-23",
        name="IRFC staggered spread",
        entry_ts=POSITION_TS,
        entry_spot=82.5,
        lots=1,
        net_debit=2.4,
        costs_est=35.0,
        breakevens="[]",
    )
    fields.update(overrides)
    return OptionPaperPosition(**fields)


def _leg(position_id, action, strike, premium, **overrides):
    fields = dict(
        position_id=position_id,
        action=action,
        opt_type="CE",
        strike=strike,
        lots=1,
        qty=75,
        entry_premium=premium,
    )
    fields.update(overrides)
    return OptionPaperLeg(**fields)


def _staggered(session, user):
    position = _position(user)
    session.add(position)
    session.commit()
    position_id = position.id
    session.add_all([
        _leg(position_id, "BUY", 82.5, 4.1),
        _leg(
            position_id, "SELL", 85.0, 1.7,
            entry_ts=LATER_TS,
            instrument_key="NSE_FO|IRFC_85_CE",
        ),
    ])
    session.commit()
    return position_id


def test_staggered_legs_persist_distinct_entry_ts(session, user):
    position_id = _staggered(session, user)
    session.expunge_all()

    legs = (
        session.query(OptionPaperLeg)
        .filter_by(position_id=position_id)
        .order_by(OptionPaperLeg.strike)
        .all()
    )

    assert len(legs) == 2
    assert legs[0].entry_ts is None
    assert legs[0].entry_premium == 4.1
    assert _as_utc(legs[1].entry_ts) == LATER_TS
    assert legs[1].entry_premium == 1.7
    assert legs[0].effective_entry_ts != legs[1].effective_entry_ts


def test_effective_entry_ts_falls_back_to_parent_when_relationship_loaded(
    session, user
):
    position_id = _staggered(session, user)
    session.expunge_all()

    legs = (
        session.query(OptionPaperLeg)
        .options(joinedload(OptionPaperLeg.position))
        .filter_by(position_id=position_id)
        .order_by(OptionPaperLeg.strike)
        .all()
    )

    assert legs[0].entry_ts is None
    assert _as_utc(legs[0].position.entry_ts) == POSITION_TS
    assert _as_utc(legs[0].effective_entry_ts) == POSITION_TS
    assert _as_utc(legs[1].entry_ts) == LATER_TS
    assert _as_utc(legs[1].effective_entry_ts) == LATER_TS


def test_effective_entry_ts_is_none_when_relationship_not_loaded(session, user):
    position_id = _staggered(session, user)
    session.expunge_all()

    inherited = (
        session.query(OptionPaperLeg)
        .filter_by(position_id=position_id, strike=82.5)
        .one()
    )
    own = (
        session.query(OptionPaperLeg)
        .filter_by(position_id=position_id, strike=85.0)
        .one()
    )

    assert "position" in sa.inspect(inherited).unloaded
    assert inherited.effective_entry_ts is None
    assert _as_utc(own.effective_entry_ts) == LATER_TS


def test_leg_to_dict_carries_raw_entry_ts_only(session, user):
    position_id = _staggered(session, user)
    session.expunge_all()

    legs = {
        leg.strike: leg.to_dict()
        for leg in session.query(OptionPaperLeg).filter_by(position_id=position_id)
    }

    assert legs[82.5]["entryTs"] is None
    assert legs[85.0]["entryTs"].startswith("2026-11-18T09:47:00")
    assert "entry_ts" not in legs[85.0]
    assert legs[85.0]["entryPremium"] == 1.7
    assert legs[85.0]["markTs"] is None
    assert legs[85.0]["exitPremium"] is None
    assert legs[85.0]["positionId"] == position_id


def test_existing_two_legs_same_time_still_work(session, user):
    position = _position(user)
    session.add(position)
    session.commit()
    position_id = position.id
    session.add_all([
        _leg(position_id, "BUY", 82.5, 4.1),
        _leg(position_id, "SELL", 85.0, 1.7),
    ])
    session.commit()
    session.expunge_all()

    legs = (
        session.query(OptionPaperLeg)
        .options(joinedload(OptionPaperLeg.position))
        .filter_by(position_id=position_id)
        .all()
    )

    assert len(legs) == 2
    assert all(leg.entry_ts is None for leg in legs)
    assert all(_as_utc(leg.effective_entry_ts) == POSITION_TS for leg in legs)
    assert all(leg.to_dict()["entryTs"] is None for leg in legs)


def test_entry_ts_column_is_nullable(test_db_engine):
    columns = {
        col["name"]: col
        for col in sa.inspect(test_db_engine).get_columns("option_paper_legs")
    }

    assert "entry_ts" in columns
    assert columns["entry_ts"]["nullable"] is True
