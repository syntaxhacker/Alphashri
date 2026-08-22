"""
Tests for PATCH /positions/{id} and DELETE/PATCH /trades/{id} with validation, 404, merge, isolation.
"""
import json
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

IST = timezone(timedelta(hours=5, minutes=30))


class _SessionWrapper:
    """Wrapper that makes a Session usable both as `db = SessionLocal()` and `with SessionLocal() as db:`."""
    def __init__(self, sess):
        self._sess = sess
    def __enter__(self):
        return self._sess
    def __exit__(self, *args):
        return False
    def __getattr__(self, name):
        return getattr(self._sess, name)


def _patch_session(db):
    """Return a factory that patches db.database.SessionLocal to return wrapper around db."""
    def factory(*args, **kwargs):
        return _SessionWrapper(db)
    return factory


def _register_and_login(client: TestClient, email: str, password: str = "Test123!Aa"):
    client.post("/api/auth/register", json={"email": email, "password": password, "display_name": "U"})
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return token, {"Authorization": f"Bearer {token}"}


@pytest.mark.unit
class TestPatchPositions:
    def test_patch_422_notes_too_long(self, client, db):
        token, headers = _register_and_login(client, f"p1_{uuid.uuid4()}@ex.com")
        # create bot and position via db
        from db.models import BotConfig, Position
        # find user id from token
        import jwt
        from api.auth import JWT_SECRET_KEY, JWT_ALGORITHM
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        bot = BotConfig(name=f"Bot {uuid.uuid4()}", user_id=user_id, is_active=True)
        db.add(bot)
        db.commit()
        db.refresh(bot)
        pos = Position(
            user_id=user_id,
            bot_id=bot.id,
            strategy_id=1,
            strategy_name="ORB",
            symbol="RELIANCE",
            side="BUY",
            quantity=10,
            entry_price=1000.0,
            entry_time=datetime.now(IST),
            current_price=1000.0,
            metadata_json=json.dumps({"notes": "old", "entry_reason": "orig"}),
        )
        db.add(pos)
        db.commit()
        db.refresh(pos)
        with patch("db.database.SessionLocal", side_effect=_patch_session(db)):
            long_notes = "x" * 501
            r = client.patch(f"/api/paper/positions/{pos.uuid}", json={"notes": long_notes}, headers=headers)
            assert r.status_code == 422, r.text

    def test_patch_404_bad_uuid(self, client, db):
        token, headers = _register_and_login(client, f"p2_{uuid.uuid4()}@ex.com")
        with patch("db.database.SessionLocal", side_effect=_patch_session(db)):
            r = client.patch(f"/api/paper/positions/{str(uuid.uuid4())}", json={"notes": "hi"}, headers=headers)
            assert r.status_code == 404, r.text
            # malformed uuid also 404
            r2 = client.patch("/api/paper/positions/not-a-uuid", json={"notes": "hi"}, headers=headers)
            assert r2.status_code == 404

    def test_patch_merge_preserves_other_field(self, client, db):
        token, headers = _register_and_login(client, f"p3_{uuid.uuid4()}@ex.com")
        from db.models import BotConfig, Position
        import jwt
        from api.auth import JWT_SECRET_KEY, JWT_ALGORITHM
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        bot = BotConfig(name=f"Bot {uuid.uuid4()}", user_id=user_id, is_active=True)
        db.add(bot)
        db.commit()
        db.refresh(bot)
        pos = Position(
            user_id=user_id,
            bot_id=bot.id,
            strategy_id=1,
            strategy_name="ORB",
            symbol="TCS",
            side="BUY",
            quantity=5,
            entry_price=3000.0,
            entry_time=datetime.now(IST),
            current_price=3000.0,
            metadata_json=json.dumps({"notes": "initial notes", "entry_reason": "initial reason"}),
        )
        db.add(pos)
        db.commit()
        db.refresh(pos)
        with patch("db.database.SessionLocal", side_effect=_patch_session(db)):
            # update only notes, reason should be preserved
            r = client.patch(f"/api/paper/positions/{pos.uuid}", json={"notes": "new notes"}, headers=headers)
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["notes"] == "new notes"
            assert data["entry_reason"] == "initial reason"
            # now update only reason, notes preserved
            r2 = client.patch(f"/api/paper/positions/{pos.uuid}", json={"reason": "new reason"}, headers=headers)
            assert r2.status_code == 200, r2.text
            data2 = r2.json()
            assert data2["notes"] == "new notes"
            assert data2["entry_reason"] == "new reason"

    def test_patch_isolation(self, client, db):
        # user A creates position
        token_a, headers_a = _register_and_login(client, f"pa_{uuid.uuid4()}@ex.com")
        token_b, headers_b = _register_and_login(client, f"pb_{uuid.uuid4()}@ex.com")
        from db.models import BotConfig, Position
        import jwt
        from api.auth import JWT_SECRET_KEY, JWT_ALGORITHM
        payload_a = jwt.decode(token_a, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_a = int(payload_a["sub"])
        bot = BotConfig(name=f"Bot {uuid.uuid4()}", user_id=user_a, is_active=True)
        db.add(bot)
        db.commit()
        db.refresh(bot)
        pos = Position(
            user_id=user_a,
            bot_id=bot.id,
            strategy_id=1,
            strategy_name="ORB",
            symbol="INFY",
            side="BUY",
            quantity=1,
            entry_price=1500.0,
            entry_time=datetime.now(IST),
            current_price=1500.0,
            metadata_json=json.dumps({}),
        )
        db.add(pos)
        db.commit()
        db.refresh(pos)
        with patch("db.database.SessionLocal", side_effect=_patch_session(db)):
            # user B tries to patch -> 404
            r = client.patch(f"/api/paper/positions/{pos.uuid}", json={"notes": "hacked"}, headers=headers_b)
            assert r.status_code == 404, r.text
            # user A can still patch
            r2 = client.patch(f"/api/paper/positions/{pos.uuid}", json={"notes": "ok"}, headers=headers_a)
            assert r2.status_code == 200


@pytest.mark.unit
class TestDeleteTrade:
    def test_delete_with_trade_prefix(self, client, db):
        token, headers = _register_and_login(client, f"d1_{uuid.uuid4()}@ex.com")
        from db.models import Trade
        import jwt
        from api.auth import JWT_SECRET_KEY, JWT_ALGORITHM
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        t = Trade(
            user_id=user_id,
            symbol="RELIANCE",
            side="BUY",
            quantity=10,
            entry_price=1000.0,
            exit_price=1100.0,
            entry_time=datetime.now(IST),
            exit_time=datetime.now(IST),
            pnl=1000.0,
            is_test=False,
            source="live",
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        trade_uuid = t.uuid
        with patch("db.database.SessionLocal", side_effect=_patch_session(db)):
            r = client.delete(f"/api/paper/trades/TRADE-{trade_uuid}", headers=headers)
            assert r.status_code == 200, r.text
            assert r.json()["success"] is True
            # deleting again -> 404
            r2 = client.delete(f"/api/paper/trades/TRADE-{trade_uuid}", headers=headers)
            assert r2.status_code == 404

    def test_delete_int_fallback(self, client, db):
        token, headers = _register_and_login(client, f"d2_{uuid.uuid4()}@ex.com")
        from db.models import Trade
        import jwt
        from api.auth import JWT_SECRET_KEY, JWT_ALGORITHM
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        t = Trade(
            user_id=user_id,
            symbol="TCS",
            side="BUY",
            quantity=5,
            entry_price=3000.0,
            exit_price=3100.0,
            entry_time=datetime.now(IST),
            exit_time=datetime.now(IST),
            pnl=500.0,
            is_test=False,
            source="live",
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        trade_id = t.id
        with patch("db.database.SessionLocal", side_effect=_patch_session(db)):
            # use int id without prefix, also with TRADE- prefix
            r = client.delete(f"/api/paper/trades/{trade_id}", headers=headers)
            assert r.status_code == 200, r.text
            # verify deleted
            assert db.query(Trade).filter(Trade.id == trade_id).first() is None

    def test_delete_404_and_isolation(self, client, db):
        token_a, headers_a = _register_and_login(client, f"da_{uuid.uuid4()}@ex.com")
        token_b, headers_b = _register_and_login(client, f"db_{uuid.uuid4()}@ex.com")
        from db.models import Trade
        import jwt
        from api.auth import JWT_SECRET_KEY, JWT_ALGORITHM
        payload_a = jwt.decode(token_a, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_a = int(payload_a["sub"])
        t = Trade(
            user_id=user_a,
            symbol="INFY",
            side="BUY",
            quantity=1,
            entry_price=1500.0,
            exit_price=1400.0,
            entry_time=datetime.now(IST),
            exit_time=datetime.now(IST),
            pnl=-100.0,
            is_test=False,
            source="live",
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        with patch("db.database.SessionLocal", side_effect=_patch_session(db)):
            # non-existent
            r = client.delete("/api/paper/trades/TRADE-999999", headers=headers_a)
            assert r.status_code == 404
            # isolation: user B cannot delete user A's trade
            r2 = client.delete(f"/api/paper/trades/{t.uuid}", headers=headers_b)
            assert r2.status_code == 404
            # user A can delete
            r3 = client.delete(f"/api/paper/trades/{t.uuid}", headers=headers_a)
            assert r3.status_code == 200

    def test_delete_invalid_format(self, client, db):
        token, headers = _register_and_login(client, f"d3_{uuid.uuid4()}@ex.com")
        with patch("db.database.SessionLocal", side_effect=_patch_session(db)):
            r = client.delete("/api/paper/trades/not-a-valid-id", headers=headers)
            assert r.status_code == 404
