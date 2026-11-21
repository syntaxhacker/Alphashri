"""Tests for the option-chain snapshot store.

Uses the shared in-memory ``db`` fixture: registering the model in
``db.models.__init__`` makes ``Base.metadata.create_all`` build the table, so
these tests exercise the real mapped columns and indexes.
"""
from __future__ import annotations

import math
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text

import config
from api.options_snapshots import (
    mark_captured,
    purge_old_snapshots,
    record_chain_snapshot,
    should_capture,
)
from db.models.option_snapshot import OptionChainSnapshot

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_TS = datetime(2026, 11, 16, 9, 30, 0, tzinfo=config.IST)
EXPIRY = "2026-11-19"


def _leg(ltp=100.0, iv=18.0, with_greeks=True, oi=1_000, volume=50):
    leg = {
        "market_data": {"ltp": ltp, "oi": oi, "volume": volume},
    }
    if with_greeks:
        leg["option_greeks"] = {
            "delta": 0.5, "gamma": 0.01, "theta": -1.0, "vega": 0.2, "iv": iv,
        }
    return leg


def _payload(strikes, *, ts=None, quotes_live=False, expiry=EXPIRY, underlying="NIFTY"):
    chain = []
    for s in strikes:
        chain.append({
            "strike": s,
            "ce": _leg(ltp=100.0 + (s or 0) * 0),
            "pe": _leg(ltp=90.0),
            "pcr": None,
        })
    payload = {
        "status": "ok",
        "underlying": underlying,
        "expiry": expiry,
        "spot": 25_000.0,
        "timestamp": ts.isoformat() if isinstance(ts, datetime) else ts,
        "chain": chain,
        "quotes_live": quotes_live,
    }
    return payload


def _rows(db, *, underlying="NIFTY"):
    return db.query(OptionChainSnapshot).filter(
        OptionChainSnapshot.underlying == underlying
    ).all()


def _wall(value):
    """SQLite drops tzinfo on read; compare the stored wall clock, as in event.py."""
    return value.replace(tzinfo=None) if value.tzinfo else value


# ---------------------------------------------------------------------------
# Idempotency / time bucketing
# ---------------------------------------------------------------------------

def test_same_minute_rerecord_is_idempotent(db):
    payload = _payload([24_900, 25_000, 25_100], ts=FIXTURE_TS)

    assert record_chain_snapshot(payload, session=db) == 6
    assert record_chain_snapshot(payload, session=db) == 0

    rows = _rows(db)
    assert len(rows) == 6
    assert {(r.strike, r.side) for r in rows} == {
        (24_900.0, "CE"), (24_900.0, "PE"),
        (25_000.0, "CE"), (25_000.0, "PE"),
        (25_100.0, "CE"), (25_100.0, "PE"),
    }
    assert all(_wall(r.ts) == _wall(FIXTURE_TS) for r in rows)


def test_timestamp_is_truncated_to_the_minute(db):
    payload = _payload([25_000], ts=None)
    stamp = datetime(2026, 11, 16, 10, 15, 47, 812_345, tzinfo=config.IST)
    record_chain_snapshot(payload, ts=stamp, session=db)
    row = _rows(db)[0]
    assert _wall(row.ts) == _wall(stamp.replace(second=0, microsecond=0))
    assert row.ts.second == 0 and row.ts.microsecond == 0


def test_next_minute_creates_new_rows(db):
    payload = _payload([24_900, 25_000], ts=FIXTURE_TS)

    assert record_chain_snapshot(payload, session=db) == 4
    assert record_chain_snapshot(payload, ts=FIXTURE_TS + timedelta(minutes=1), session=db) == 4

    rows = _rows(db)
    assert len(rows) == 8
    from collections import Counter
    counts = Counter((r.strike, r.side) for r in rows)
    assert set(counts.values()) == {2}
    assert {_wall(r.ts) for r in rows} == {
        _wall(FIXTURE_TS), _wall(FIXTURE_TS + timedelta(minutes=1))
    }


def test_different_expiry_does_not_collide(db):
    first = _payload([25_000], ts=FIXTURE_TS, expiry="2026-11-19")
    second = _payload([25_000], ts=FIXTURE_TS, expiry="2026-11-26")
    assert record_chain_snapshot(first, session=db) == 2
    assert record_chain_snapshot(second, session=db) == 2
    assert len(_rows(db)) == 4


# ---------------------------------------------------------------------------
# Null / finite filtering
# ---------------------------------------------------------------------------

def test_null_iv_is_stored_as_null(db):
    payload = _payload([25_000], ts=FIXTURE_TS)
    payload["chain"][0]["ce"] = _leg(ltp=100.0, iv=None)
    payload["chain"][0]["pe"] = _leg(ltp=90.0, with_greeks=False)

    assert record_chain_snapshot(payload, session=db) == 2
    rows = {r.side: r for r in _rows(db)}
    assert rows["CE"].ltp == 100.0
    assert rows["CE"].iv is None
    assert rows["PE"].ltp == 90.0
    assert rows["PE"].iv is None
    assert rows["PE"].delta is None


def test_only_finite_strikes_and_ltps_are_stored(db):
    payload = _payload([25_000, math.nan, math.inf, None], ts=FIXTURE_TS)
    # Non-finite LTP on the CE of the valid strike; the PE leg must survive.
    payload["chain"][0]["ce"] = _leg(ltp=float("nan"))
    payload["chain"][0]["pe"] = _leg(ltp=90.0, iv=float("inf"))

    assert record_chain_snapshot(payload, session=db) == 1
    rows = _rows(db)
    assert len(rows) == 1
    assert (rows[0].strike, rows[0].side) == (25_000.0, "PE")
    assert rows[0].iv is None  # inf IV degrades to NULL, the row is kept


def test_nan_and_none_iv_degrade_to_null_not_zero(db):
    payload = _payload([25_000], ts=FIXTURE_TS)
    payload["chain"][0]["ce"] = _leg(ltp=100.0, iv="NaN")
    payload["chain"][0]["pe"] = _leg(ltp=90.0, iv=0.0)
    record_chain_snapshot(payload, session=db)

    rows = {r.side: r for r in _rows(db)}
    assert rows["CE"].iv is None
    assert rows["PE"].iv == 0.0  # a genuine zero must survive


# ---------------------------------------------------------------------------
# Provenance columns
# ---------------------------------------------------------------------------

def test_quotes_live_session_date_and_iv_source_persisted(db):
    payload = _payload([25_000], ts=FIXTURE_TS, quotes_live=False)
    assert record_chain_snapshot(payload, session=db) == 2
    for row in _rows(db):
        assert row.quotes_live is False
        assert row.session_date == "2026-11-16"
        assert row.iv_source == "upstox"
        assert row.spot == 25_000.0
        assert row.expiry == EXPIRY
        assert row.underlying == "NIFTY"

    live_payload = _payload([25_100], ts=FIXTURE_TS + timedelta(minutes=1), quotes_live=True)
    assert record_chain_snapshot(live_payload, session=db) == 2
    assert all(r.quotes_live is True for r in _rows(db) if r.strike == 25_100.0)


def test_empty_chain_writes_nothing(db):
    assert record_chain_snapshot(_payload([], ts=FIXTURE_TS), session=db) == 0
    assert _rows(db) == []


# ---------------------------------------------------------------------------
# Purge
# ---------------------------------------------------------------------------

def test_purge_removes_only_rows_older_than_n_days(db):
    now = datetime(2026, 11, 16, 15, 0, tzinfo=config.IST)
    old = _payload([25_000], ts=now - timedelta(days=100))
    recent = _payload([25_100], ts=now - timedelta(days=1))
    assert record_chain_snapshot(old, session=db) == 2
    assert record_chain_snapshot(recent, session=db) == 2

    assert purge_old_snapshots(days=90, ts=now, session=db) == 2
    rows = _rows(db)
    assert len(rows) == 2
    assert all(r.strike == 25_100.0 for r in rows)


def test_purge_zero_days_keeps_todays_rows(db):
    now = datetime(2026, 11, 16, 15, 0, tzinfo=config.IST)
    record_chain_snapshot(_payload([25_000], ts=now), session=db)
    assert purge_old_snapshots(days=0, ts=now, session=db) == 0
    assert len(_rows(db)) == 2


def test_purge_rejects_negative_days(db):
    with pytest.raises(ValueError):
        purge_old_snapshots(days=-1, session=db)


# ---------------------------------------------------------------------------
# Migration + index
# ---------------------------------------------------------------------------

def test_migration_chain_is_valid():
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "validate_migrations.py")],
        cwd=ROOT, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "validated successfully" in result.stdout


def test_query_by_underlying_and_ts_uses_the_index(db):
    # Enough rows that SQLite's planner prefers a seek over a full table scan.
    strikes = [24_000 + i * 10 for i in range(400)]  # 800 legs
    record_chain_snapshot(_payload(strikes, ts=FIXTURE_TS), session=db)
    db.execute(text("ANALYZE option_chain_snapshots"))

    sample = _rows(db)[0]
    ts_literal = sample.ts.strftime("%Y-%m-%d %H:%M:%S.%f")
    plan = db.connection().exec_driver_sql(
        "EXPLAIN QUERY PLAN SELECT id FROM option_chain_snapshots "
        "WHERE underlying = 'NIFTY' AND ts = '" + ts_literal + "'"
    ).fetchall()
    detail = " | ".join(row[3] for row in plan)
    assert "ix_ocs_underlying_ts" in detail, detail


def test_all_declared_indexes_exist(db):
    names = {
        row[1] for row in
        db.connection().exec_driver_sql("PRAGMA index_list('option_chain_snapshots')").fetchall()
    }
    assert {
        "ix_ocs_underlying_ts",
        "ix_ocs_underlying_expiry_ts",
        "ix_ocs_underlying_session_date",
    } <= names


# ---------------------------------------------------------------------------
# Bulk insert timing
# ---------------------------------------------------------------------------

def test_300_row_insert_timing(db):
    strikes = [24_000 + i * 10 for i in range(150)]  # 150 strikes x CE/PE = 300
    payload = _payload(strikes, ts=FIXTURE_TS)

    started = time.perf_counter()
    inserted = record_chain_snapshot(payload, session=db)
    elapsed = time.perf_counter() - started

    assert inserted == 300
    assert len(_rows(db)) == 300
    assert elapsed < 5.0, f"300-row insert took {elapsed:.3f}s"
    print(f"SNAPSHOT_BULK_INSERT 300 rows in {elapsed * 1000:.2f} ms")


# ---------------------------------------------------------------------------
# Capture throttle (pure helpers used by the chain route)
# ---------------------------------------------------------------------------

class TestCaptureThrottle:
    @staticmethod
    def _live(ts="2026-11-16T10:30:00+05:30", **overrides):
        payload = {
            "status": "ok",
            "underlying": "NIFTY",
            "expiry": EXPIRY,
            "timestamp": ts,
            "market_state": "open",
            "quotes_live": True,
            "session_date": "2026-11-16",
            "chain": [{"strike": 25_000, "ce": _leg(), "pe": _leg()}],
        }
        payload.update(overrides)
        return payload

    @staticmethod
    def _closed(session_date="2026-11-16", ts="2026-11-16T18:00:00+05:30", **overrides):
        payload = TestCaptureThrottle._live(
            ts=ts, market_state="closed", quotes_live=False, session_date=session_date
        )
        payload.update(overrides)
        return payload

    def test_same_minute_is_throttled_and_next_minute_captures(self):
        last = {}
        first = self._live()
        assert should_capture(first, last) is True
        mark_captured(first, last)

        # A cache hit hands back the same payload; a refetch in the same minute
        # has a different timestamp but must still collapse to one capture.
        assert should_capture(first, last) is False
        same_minute = self._live(ts="2026-11-16T10:30:47+05:30")
        assert should_capture(same_minute, last) is False

        next_minute = self._live(ts="2026-11-16T10:31:02+05:30")
        assert should_capture(next_minute, last) is True
        mark_captured(next_minute, last)
        assert should_capture(next_minute, last) is False

    def test_minute_key_is_ist_not_utc(self):
        """The same instant written as UTC and IST must share one bucket."""
        last = {}
        ist = self._live(ts="2026-11-16T10:30:00+05:30")
        utc = self._live(ts="2026-11-16T05:00:00+00:00")
        assert should_capture(ist, last) is True
        mark_captured(ist, last)
        assert should_capture(utc, last) is False

    def test_closed_market_captures_once_per_session(self):
        last = {}
        first = self._closed(session_date="2026-11-16")
        assert should_capture(first, last) is True
        mark_captured(first, last)

        # Later wall-clock minute, same prints/session -> no new observation.
        later_same_session = self._closed(
            session_date="2026-11-16", ts="2026-11-16T23:59:00+05:30"
        )
        assert should_capture(later_same_session, last) is False

        next_session = self._closed(session_date="2026-11-17", ts="2026-11-17T18:00:00+05:30")
        assert should_capture(next_session, last) is True

    def test_session_key_is_per_underlying_and_expiry(self):
        last = {}
        mark_captured(self._closed(), last)
        assert should_capture(self._closed(underlying="BANKNIFTY"), last) is True
        assert should_capture(self._closed(expiry="2026-11-26"), last) is True
        assert should_capture(self._closed(), last) is False

    @pytest.mark.parametrize(
        "bad",
        [
            {"chain": []},
            {"chain": None},
            {"status": "error"},
            {"underlying": ""},
            {"expiry": ""},
            {"replay": True},
            {"as_of": "2026-11-16"},
            {"mode": "replay"},
        ],
    )
    def test_empty_error_and_replay_frames_are_not_captured(self, bad):
        last = {}
        assert should_capture(self._live(**bad), last) is False
        assert mark_captured(self._live(**bad), last) is False
        assert last == {}

    def test_data_as_of_freshness_label_does_not_suppress_capture(self):
        """Live chains carry ``data_as_of``; only real replay markers must skip."""
        payload = self._live(data_as_of="2026-11-16 — last completed session")
        assert should_capture(payload, {}) is True

    def test_capture_map_is_bounded(self):
        last = {}
        base = datetime(2026, 11, 16, 9, 0, tzinfo=config.IST)
        for i in range(5_000):
            mark_captured(self._live(ts=(base + timedelta(minutes=i)).isoformat()), last)
        assert 0 < len(last) <= 4_096
