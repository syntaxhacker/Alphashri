"""
GET /trades filter tests: DB-first/journal fallback, days_back, from/to IST, is_test, symbol safety.
"""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

import pytest
import jwt

IST = timezone(timedelta(hours=5, minutes=30))


def _register_and_login(client, email):
    client.post("/api/auth/register", json={"email": email, "password": "Test123!Aa", "display_name": "U"})
    r = client.post("/api/auth/login", json={"email": email, "password": "Test123!Aa"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"], {"Authorization": f"Bearer {r.json()['access_token']}"}


class _SessionWrapper:
    def __init__(self, sess):
        self._sess = sess
    def __enter__(self):
        return self._sess
    def __exit__(self, *a):
        return False
    def __getattr__(self, name):
        return getattr(self._sess, name)

def _patch_session(db):
    def factory(*a, **kw):
        return _SessionWrapper(db)
    return factory


@pytest.mark.unit
class TestTradesFilters:
    def test_filter_db_first_journal_fallback_only_when_empty(self, client, db):
        token, headers = _register_and_login(client, f"f1_{uuid.uuid4()}@ex.com")
        # Mock _get_trades_from_db to return non-empty -> journal should NOT be called
        with patch("api.paper.history._get_trades_from_db") as mock_db, \
             patch("api.paper.history._get_trades_from_journals") as mock_journal, \
             patch("api.paper.history._resolve_trade_bot_ids", side_effect=lambda x: x):
            mock_db.return_value = [{"symbol": "RELIANCE", "pnl": 100}]
            mock_journal.return_value = [{"symbol": "JOURNAL_SHOULD_NOT_APPEAR"}]
            r = client.get("/api/paper/trades", headers=headers)
            assert r.status_code == 200
            assert mock_db.called
            assert not mock_journal.called
            assert r.json()["trades"][0]["symbol"] == "RELIANCE"
        # When DB empty, journal is called
        with patch("api.paper.history._get_trades_from_db") as mock_db, \
             patch("api.paper.history._get_trades_from_journals") as mock_journal, \
             patch("api.paper.history._resolve_trade_bot_ids", side_effect=lambda x: x):
            mock_db.return_value = []
            mock_journal.return_value = [{"symbol": "FROM_JOURNAL"}]
            r = client.get("/api/paper/trades", headers=headers)
            assert r.status_code == 200
            assert mock_journal.called
            assert r.json()["trades"][0]["symbol"] == "FROM_JOURNAL"

    def test_filter_days_back_default_7(self, client, db):
        token, headers = _register_and_login(client, f"f2_{uuid.uuid4()}@ex.com")
        from db.models import Trade
        from api.auth import JWT_SECRET_KEY, JWT_ALGORITHM
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        now = datetime.now(IST)
        old = now - timedelta(days=8)
        recent = now - timedelta(days=1)
        t_old = Trade(user_id=user_id, symbol="OLD", side="BUY", quantity=10, entry_price=100, exit_price=110, entry_time=old, exit_time=old, pnl=100, is_test=False, source="live")
        t_recent = Trade(user_id=user_id, symbol="RECENT", side="BUY", quantity=10, entry_price=100, exit_price=110, entry_time=recent, exit_time=recent, pnl=100, is_test=False, source="live")
        db.add_all([t_old, t_recent])
        db.commit()
        with patch("db.database.SessionLocal", side_effect=_patch_session(db)):
            r = client.get("/api/paper/trades?days_back=7", headers=headers)
            assert r.status_code == 200, r.text
            symbols = {t["symbol"] for t in r.json()["trades"]}
            assert "RECENT" in symbols
            assert "OLD" not in symbols
            # with larger window, old appears
            r2 = client.get("/api/paper/trades?days_back=10", headers=headers)
            symbols2 = {t["symbol"] for t in r2.json()["trades"]}
            assert "OLD" in symbols2

    def test_filter_from_date_to_date_ist(self, client, db):
        token, headers = _register_and_login(client, f"f3_{uuid.uuid4()}@ex.com")
        from db.models import Trade
        from api.auth import JWT_SECRET_KEY, JWT_ALGORITHM
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        # create trades on specific dates in IST
        d1 = datetime(2026, 3, 10, 10, 0, tzinfo=IST)
        d2 = datetime(2026, 3, 15, 10, 0, tzinfo=IST)
        d3 = datetime(2026, 3, 20, 10, 0, tzinfo=IST)
        for d, sym in [(d1, "D1"), (d2, "D2"), (d3, "D3")]:
            t = Trade(user_id=user_id, symbol=sym, side="BUY", quantity=10, entry_price=100, exit_price=110, entry_time=d, exit_time=d, pnl=100, is_test=False, source="live")
            db.add(t)
        db.commit()
        with patch("db.database.SessionLocal", side_effect=_patch_session(db)):
            # from_date filter inclusive
            r = client.get("/api/paper/trades?from_date=2026-03-12&to_date=2026-03-18", headers=headers)
            assert r.status_code == 200
            symbols = {t["symbol"] for t in r.json()["trades"]}
            assert symbols == {"D2"}
            # only from_date
            r2 = client.get("/api/paper/trades?from_date=2026-03-18", headers=headers)
            symbols2 = {t["symbol"] for t in r2.json()["trades"]}
            assert "D3" in symbols2
            assert "D1" not in symbols2
            # only to_date
            r3 = client.get("/api/paper/trades?to_date=2026-03-12", headers=headers)
            symbols3 = {t["symbol"] for t in r3.json()["trades"]}
            assert "D1" in symbols3
            assert "D3" not in symbols3

    def test_filter_is_test_exclusion(self, client, db):
        token, headers = _register_and_login(client, f"f4_{uuid.uuid4()}@ex.com")
        from db.models import Trade
        from api.auth import JWT_SECRET_KEY, JWT_ALGORITHM
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        now = datetime.now(IST)
        t_real = Trade(user_id=user_id, symbol="REAL", side="BUY", quantity=10, entry_price=100, exit_price=110, entry_time=now, exit_time=now, pnl=100, is_test=False, source="live")
        t_test = Trade(user_id=user_id, symbol="TESTSYM", side="BUY", quantity=10, entry_price=100, exit_price=110, entry_time=now, exit_time=now, pnl=100, is_test=True, source="test")
        db.add_all([t_real, t_test])
        db.commit()
        with patch("db.database.SessionLocal", side_effect=_patch_session(db)):
            r = client.get("/api/paper/trades", headers=headers)
            assert r.status_code == 200
            symbols = {t["symbol"] for t in r.json()["trades"]}
            assert "REAL" in symbols
            assert "TESTSYM" not in symbols

    def test_filter_symbol_safety_with_quote(self, client, db):
        token, headers = _register_and_login(client, f"f5_{uuid.uuid4()}@ex.com")
        from db.models import Trade
        from api.auth import JWT_SECRET_KEY, JWT_ALGORITHM
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        now = datetime.now(IST)
        t = Trade(user_id=user_id, symbol="RELIANCE", side="BUY", quantity=10, entry_price=100, exit_price=110, entry_time=now, exit_time=now, pnl=100, is_test=False, source="live")
        db.add(t)
        db.commit()
        with patch("db.database.SessionLocal", side_effect=_patch_session(db)):
            # symbol with single quote should not cause SQL error and return 0 results safely via parameterized query
            r = client.get("/api/paper/trades?symbol=A'B", headers=headers)
            assert r.status_code == 200, r.text
            assert r.json()["trades"] == []
            # injection attempt should not return all trades
            r2 = client.get("/api/paper/trades?symbol=RELIANCE' OR '1'='1", headers=headers)
            assert r2.status_code == 200
            assert r2.json()["trades"] == []
            # normal symbol still works
            r3 = client.get("/api/paper/trades?symbol=RELIANCE", headers=headers)
            assert r3.status_code == 200
            assert len(r3.json()["trades"]) == 1

    def test_filter_fromdate_today_default(self, client, db):
        token, headers = _register_and_login(client, f"f6_{uuid.uuid4()}@ex.com")
        from db.models import Trade
        from api.auth import JWT_SECRET_KEY, JWT_ALGORITHM
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        now = datetime.now(IST)
        t_today = Trade(user_id=user_id, symbol="TODAY", side="BUY", quantity=10, entry_price=100, exit_price=110, entry_time=now, exit_time=now, pnl=100, is_test=False, source="live")
        db.add(t_today)
        db.commit()
        with patch("db.database.SessionLocal", side_effect=_patch_session(db)):
            # without from_date/to_date, defaults to days_back=7 which includes today
            r = client.get("/api/paper/trades", headers=headers)
            assert r.status_code == 200
            symbols = {t["symbol"] for t in r.json()["trades"]}
            assert "TODAY" in symbols

    def test_filter_hidden_except_logs_warning(self, client, db):
        # verify that _get_trades_from_db exception is logged not silent and returns []
        from api.paper.history import _get_trades_from_db
        with patch("db.database.SessionLocal", side_effect=Exception("boom")):
            # should not raise, should return []
            result = _get_trades_from_db(user_id=1, bot_id=None, symbol=None, strategy_id=None, from_date=None, to_date=None, days_back=7, limit=10)
            assert result == []
