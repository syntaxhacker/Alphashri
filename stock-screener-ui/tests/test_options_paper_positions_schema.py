"""Schema + serialization contract for the UI-driven options paper book.

These tables are the source of truth for multi-leg paper positions placed from
the dock; the headless ``options_paper`` runner keeps its own JSONL ledger and
is deliberately untouched.
"""
import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from db.models import OptionPaperLeg, OptionPaperPosition, User


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
        email="options-paper@example.com",
        hashed_password="hashed",
        display_name="Options Paper",
    )
    session.add(user)
    session.commit()
    return user


def _position(user, **overrides):
    fields = dict(
        user_id=user.id,
        source="replay",
        status="open",
        underlying="IRFC",
        expiry="2026-11-23",
        name="IRFC bull call spread",
        entry_ts=datetime(2026, 11, 17, 9, 47, tzinfo=timezone.utc),
        entry_spot=82.5,
        lots=1,
        net_debit=2.4,
        costs_est=35.0,
        max_profit=7.6,
        max_loss=2.4,
        breakevens=json.dumps([85.4]),
        realized_pnl=0.0,
        notes="backdated from snapshot",
    )
    fields.update(overrides)
    return OptionPaperPosition(**fields)


def _spread(session, user):
    position = _position(user)
    session.add(position)
    session.commit()

    session.add_all([
        OptionPaperLeg(
            position_id=position.id,
            action="BUY",
            opt_type="CE",
            strike=82.5,
            lots=1,
            qty=75,
            instrument_key="NSE_FO|IRFC_82.5_CE",
            entry_premium=4.1,
            mark_premium=3.9,
        ),
        OptionPaperLeg(
            position_id=position.id,
            action="SELL",
            opt_type="CE",
            strike=85.0,
            lots=1,
            qty=75,
            instrument_key="NSE_FO|IRFC_85_CE",
            entry_premium=1.7,
            mark_premium=1.5,
        ),
    ])
    session.commit()
    return position


def test_position_with_two_legs_persists(session, user):
    position = _spread(session, user)

    assert position.id is not None
    assert position.uuid
    assert position.created_at is not None
    assert position.updated_at is not None

    legs = session.query(OptionPaperLeg).filter_by(position_id=position.id).all()
    assert len(legs) == 2
    assert {(leg.action, leg.opt_type, leg.strike) for leg in legs} == {
        ("BUY", "CE", 82.5),
        ("SELL", "CE", 85.0),
    }


def test_legs_cascade_on_position_delete(session, user):
    position = _spread(session, user)
    position_id = position.id

    # Raw SQL so the ORM relationship cannot be responsible for the cleanup.
    session.execute(
        text("DELETE FROM option_paper_positions WHERE id = :id"),
        {"id": position_id},
    )
    session.commit()

    assert session.query(OptionPaperLeg).filter_by(position_id=position_id).count() == 0


def test_duplicate_leg_is_rejected(session, user):
    position = _spread(session, user)

    duplicate = OptionPaperLeg(
        position_id=position.id,
        action="BUY",
        opt_type="CE",
        strike=82.5,
        lots=1,
        qty=75,
        entry_premium=4.1,
    )
    session.add(duplicate)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_breakevens_json_round_trip(session, user):
    position = _position(user, breakevens=json.dumps([84.1, 85.9]))
    session.add(position)
    session.commit()
    position_id = position.id

    session.expunge_all()
    reloaded = session.query(OptionPaperPosition).get(position_id)

    assert reloaded.to_dict()["breakevens"] == [84.1, 85.9]


def test_to_dict_shapes(session, user):
    position = _spread(session, user)
    position_id = position.id
    session.expunge_all()

    stored = session.query(OptionPaperPosition).get(position_id)
    payload = stored.to_dict()

    assert payload["uuid"] == stored.uuid
    assert payload["source"] == "replay"
    assert payload["status"] == "open"
    assert payload["entryTs"].startswith("2026-11-17T09:47:00")
    assert payload["netDebit"] == 2.4
    assert payload["maxProfit"] == 7.6
    assert payload["maxLoss"] == 2.4
    assert payload["breakevens"] == [85.4]
    assert payload["realizedPnl"] == 0.0
    assert payload["closeReason"] == ""
    assert payload["closedAt"] is None
    assert "net_debit" not in payload

    leg = session.query(OptionPaperLeg).filter_by(
        position_id=stored.id, action="BUY"
    ).first()
    leg_payload = leg.to_dict()

    assert leg_payload["positionId"] == stored.id
    assert leg_payload["optType"] == "CE"
    assert leg_payload["instrumentKey"] == "NSE_FO|IRFC_82.5_CE"
    assert leg_payload["entryPremium"] == 4.1
    assert leg_payload["markPremium"] == 3.9
    assert leg_payload["markTs"] is None
    assert leg_payload["exitPremium"] is None
    assert "opt_type" not in leg_payload
