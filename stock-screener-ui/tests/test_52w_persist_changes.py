"""52W batch persistence: change-only writes, bounded chunk commits."""

import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db.models.stock_52w_touch import Stock52WeekRange
from scripts import compute_52w_ranges_upstox as batch
from trading.week52 import upsert as week52_upsert


@pytest.fixture
def batch_session(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'batch.db'}",
        connect_args={"check_same_thread": False},
    )
    Stock52WeekRange.__table__.create(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    monkeypatch.setattr(batch, "SessionLocal", Session)
    yield Session
    engine.dispose()


def _seed(Session, rows):
    session = Session()
    try:
        for row in rows:
            session.add(Stock52WeekRange(**row))
        session.commit()
    finally:
        session.close()


def _load(Session, symbol):
    session = Session()
    try:
        return session.get(Stock52WeekRange, symbol)
    finally:
        session.close()


class TestChangeOnlyWrites:
    def test_unchanged_rows_keep_their_timestamp(self, batch_session):
        old = datetime(2026, 1, 2, 9, 15)
        _seed(
            batch_session,
            [
                {
                    "symbol": "AAA",
                    "high_52w": 100.0,
                    "low_52w": 50.0,
                    "close": 75.0,
                    "days_ago": 3,
                    "updated_at": old,
                },
                {
                    "symbol": "BBB",
                    "high_52w": 200.0,
                    "low_52w": 100.0,
                    "close": 150.0,
                    "days_ago": 5,
                    "updated_at": old,
                },
            ],
        )

        added, updated = batch.persist_ranges(
            {
                "AAA": {"high": 100.0, "low": 50.0, "close": 75.0, "days_ago": 3},
                "BBB": {"high": 200.0, "low": 100.0, "close": 151.0, "days_ago": 5},
                "CCC": {"high": 10.0, "low": 5.0, "close": 7.0, "days_ago": 1},
            },
            redis=False,
        )

        assert (added, updated) == (1, 1)
        assert _load(batch_session, "AAA").updated_at == old
        bbb = _load(batch_session, "BBB")
        assert bbb.close == 151.0
        assert bbb.updated_at > old
        assert _load(batch_session, "CCC") is not None

    def test_days_ago_change_is_a_change(self, batch_session):
        old = datetime(2026, 1, 2, 9, 15)
        _seed(
            batch_session,
            [
                {
                    "symbol": "AAA",
                    "high_52w": 100.0,
                    "low_52w": 50.0,
                    "close": 75.0,
                    "days_ago": 3,
                    "updated_at": old,
                }
            ],
        )

        added, updated = batch.persist_ranges(
            {"AAA": {"high": 100.0, "low": 50.0, "close": 75.0, "days_ago": 4}},
            redis=False,
        )

        assert (added, updated) == (0, 1)
        assert _load(batch_session, "AAA").days_ago == 4

    def test_identical_recompute_writes_nothing(self, batch_session):
        old = datetime(2026, 1, 2, 9, 15)
        _seed(
            batch_session,
            [
                {
                    "symbol": "AAA",
                    "high_52w": 100.0,
                    "low_52w": 50.0,
                    "close": 75.0,
                    "days_ago": None,
                    "updated_at": old,
                }
            ],
        )

        assert batch.persist_ranges(
            {"AAA": {"high": 100.0, "low": 50.0, "close": 75.0}}, redis=False
        ) == (0, 0)
        assert _load(batch_session, "AAA").updated_at == old

    def test_empty_payload_does_not_open_a_session(self, monkeypatch):
        monkeypatch.setattr(batch, "SessionLocal", MagicMock(side_effect=AssertionError))
        assert batch.persist_ranges({}, redis=False) == (0, 0)

    def test_persist_ranges_delegates_to_shared_helper(self, batch_session, monkeypatch):
        data = {"AAA": {"high": 10.0, "low": 5.0, "close": 7.0}}
        calls = []

        def fake_upsert(factory, symbols, **kwargs):
            calls.append((factory, symbols, kwargs))
            return 2, 3

        monkeypatch.setattr(batch, "upsert_52w_ranges", fake_upsert)
        assert batch.persist_ranges(data, redis=True) == (2, 3)
        assert calls == [(batch_session, data, {})]


class TestSharedUpsertHelper:
    def test_empty_symbols_do_not_open_a_session(self):
        factory = MagicMock(side_effect=AssertionError)
        assert week52_upsert.upsert_52w_ranges(factory, {}) == (0, 0)
        factory.assert_not_called()

    def test_rollback_and_close_on_query_failure(self):
        session = MagicMock()
        session.query.side_effect = RuntimeError("boom")
        factory = MagicMock(return_value=session)

        with pytest.raises(RuntimeError, match="boom"):
            week52_upsert.upsert_52w_ranges(
                factory, {"AAA": {"high": 10.0, "low": 5.0, "close": 7.0}}
            )

        session.rollback.assert_called_once_with()
        session.close.assert_called_once_with()

    def test_change_only_write_and_chunked_commits(self, batch_session):
        old = datetime(2026, 1, 2, 9, 15)
        _seed(
            batch_session,
            [
                {
                    "symbol": "AAA",
                    "high_52w": 100.0,
                    "low_52w": 50.0,
                    "close": 75.0,
                    "days_ago": 3,
                    "updated_at": old,
                },
                {
                    "symbol": "BBB",
                    "high_52w": 20.0,
                    "low_52w": 10.0,
                    "close": 15.0,
                    "days_ago": 2,
                    "updated_at": old,
                },
            ],
        )
        data = {
            "AAA": {"high": 100.0, "low": 50.0, "close": 75.0, "days_ago": 3},
            "BBB": {"high": 20.0, "low": 10.0, "close": 16.0, "days_ago": 2},
            "CCC": {"high": 30.0, "low": 15.0, "close": 22.0, "days_ago": 1},
            "DDD": {"high": 40.0, "low": 20.0, "close": 30.0, "days_ago": None},
        }

        assert week52_upsert.upsert_52w_ranges(batch_session, data, chunk_size=2) == (2, 1)
        assert _load(batch_session, "AAA").updated_at == old
        assert _load(batch_session, "BBB").close == 16.0
        assert _load(batch_session, "CCC") is not None
        assert _load(batch_session, "DDD") is not None
        assert week52_upsert.upsert_52w_ranges(batch_session, data, chunk_size=2) == (0, 0)


class TestChunkedFlush:
    def test_flush_pending_is_a_noop_when_empty(self, monkeypatch):
        persist = MagicMock()
        monkeypatch.setattr(batch, "persist_ranges", persist)
        assert batch.flush_pending({}) == (0, 0)
        persist.assert_not_called()

    def test_queue_flushes_at_the_configured_boundary(self, monkeypatch):
        chunks = []

        def fake_persist(data, redis):
            chunks.append(len(data))
            return len(data), 0

        monkeypatch.setattr(batch, "persist_ranges", fake_persist)

        pending = {}
        added = 0
        for i in range(1200):
            a, _ = batch.queue_range(pending, f"S{i}", {"high": float(i)})
            added += a
        added += batch.flush_pending(pending)[0]

        assert chunks == [500, 500, 200]
        assert added == 1200
        assert pending == {}

    def test_remainder_is_not_flushed_twice(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            batch, "persist_ranges", lambda data, redis: (calls.append(len(data)) or 0, 0)
        )

        pending = {}
        for i in range(600):
            batch.queue_range(
                pending, f"S{i}", {"high": float(i)},
                flush_every=batch.DB_FLUSH_EVERY,
            )
        batch.flush_pending(pending)

        assert calls == [500, 100]
        assert batch.flush_pending(pending) == (0, 0)
        assert calls == [500, 100]

    def test_default_chunk_size_is_bounded(self):
        assert batch.DB_FLUSH_EVERY == 500
