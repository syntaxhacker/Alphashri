"""Disk-persistence tests for india_board/scripts/oi_tracker.py.

No network, no Fyers client: only the pure-ish helpers (``_snapshot_file``,
``_append``, ``_load_day``, ``_hydrate``, ``_prune``) and the in-memory
``history()`` / ``latest()`` served by ``GET /api/oi-flow/history``.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from india_board.scripts import oi_tracker

IST = ZoneInfo("Asia/Kolkata")
DAY = "2026-09-28"  # a Monday
DAY_D = date(2026, 9, 28)


def _iso(hour: int, minute: int, day: str = DAY) -> str:
    y, m, d = (int(x) for x in day.split("-"))
    return datetime(y, m, d, hour, minute, tzinfo=IST).isoformat()


def _snap(ticker: str, ts: str) -> dict:
    return {
        "ts": ts,
        "ticker": ticker,
        "strikes": [
            {"strike": 25000.0, "ce_oi": 100.0, "pe_oi": 200.0, "ce_oich": 1.0, "pe_oich": 2.0}
        ],
    }


@pytest.fixture(autouse=True)
def _reset_snapshots():
    """Isolate the module-level ``_SNAPSHOTS`` list between tests."""
    original = oi_tracker._SNAPSHOTS
    oi_tracker._SNAPSHOTS = []
    yield
    oi_tracker._SNAPSHOTS = original


# ---------------------------------------------------------------------------
# (a) append + reload round-trip — 3 snapshots, 2 tickers, tmp_path root
# ---------------------------------------------------------------------------


def test_append_reload_round_trip(tmp_path):
    snaps = [
        _snap("NIFTY", _iso(9, 20)),
        _snap("BANKNIFTY", _iso(9, 25)),
        _snap("NIFTY", _iso(9, 30)),
    ]
    for s in snaps:
        assert oi_tracker._append(s["ticker"], s, root=tmp_path) is True

    # One JSONL file per ticker/day, date derived from ts.
    nifty_path = oi_tracker._snapshot_file("NIFTY", DAY, root=tmp_path)
    bank_path = oi_tracker._snapshot_file("BANKNIFTY", DAY, root=tmp_path)
    assert nifty_path.is_file() and bank_path.is_file()
    assert len(nifty_path.read_text(encoding="utf-8").splitlines()) == 2
    assert len(bank_path.read_text(encoding="utf-8").splitlines()) == 1
    assert all(
        json.loads(ln)["ticker"] == "NIFTY"
        for ln in nifty_path.read_text(encoding="utf-8").splitlines()
    )

    assert oi_tracker._load_day("NIFTY", DAY, root=tmp_path) == [snaps[0], snaps[2]]
    assert oi_tracker._load_day("BANKNIFTY", DAY, root=tmp_path) == [snaps[1]]
    # Missing day and missing ticker are empty, never raise.
    assert oi_tracker._load_day("NIFTY", "2026-09-27", root=tmp_path) == []
    assert oi_tracker._load_day("RELIANCE", DAY, root=tmp_path) == []


def test_append_failure_returns_false_not_raise(tmp_path):
    blocker = tmp_path / "blocker"
    blocker.write_text("i am a file, not a directory", encoding="utf-8")
    assert oi_tracker._append("NIFTY", _snap("NIFTY", _iso(9, 20)), root=blocker) is False


# ---------------------------------------------------------------------------
# (b) hydration: sorted by ts, capped at MAX_SNAPS, today only
# ---------------------------------------------------------------------------


def test_hydrate_sorts_by_ts_and_caps_at_max_snaps(tmp_path, monkeypatch):
    base = datetime(2026, 9, 28, 9, 15, tzinfo=IST)
    snaps = [_snap("NIFTY", (base + timedelta(minutes=5 * i)).isoformat()) for i in range(8)]
    # Written newest-first on purpose — hydration must re-sort by ts.
    for s in reversed(snaps):
        assert oi_tracker._append("NIFTY", s, root=tmp_path)
    # An older day on disk must NOT be hydrated into memory.
    stale = _snap("NIFTY", _iso(9, 0, day="2026-09-21"))
    assert oi_tracker._append("NIFTY", stale, root=tmp_path)

    monkeypatch.setattr(oi_tracker, "MAX_SNAPS", 5)
    mem = oi_tracker._hydrate(date_str=DAY, root=tmp_path)

    # Sorted ascending, oldest evicted, newest 5 kept.
    assert [s["ts"] for s in mem] == [s["ts"] for s in snaps[3:]]
    assert len(mem) == 5
    assert oi_tracker.history() == mem
    # Hydration only reads — everything (incl. the old day) stays on disk.
    assert len(oi_tracker._load_day("NIFTY", DAY, root=tmp_path)) == 8
    assert oi_tracker._load_day("NIFTY", "2026-09-21", root=tmp_path) == [stale]
    # Second hydration is idempotent (no duplicates).
    assert oi_tracker._hydrate(date_str=DAY, root=tmp_path) == mem


def test_hydrate_missing_root_is_noop(tmp_path):
    mem = oi_tracker._hydrate(date_str=DAY, root=tmp_path / "does-not-exist")
    assert mem == []
    assert oi_tracker.history() == []


# ---------------------------------------------------------------------------
# (c) malformed lines are skipped
# ---------------------------------------------------------------------------


def test_load_day_skips_malformed_lines(tmp_path):
    path = oi_tracker._snapshot_file("NIFTY", DAY, root=tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    good = _snap("NIFTY", _iso(9, 20))
    payload = "\n".join(
        [
            "{not json at all",
            json.dumps(good),
            json.dumps(["a", "list", "is", "not", "a", "snapshot"]),
            json.dumps({"ticker": "NIFTY"}),  # dict but no ts
            "",
        ]
    )
    path.write_text(payload + "\n", encoding="utf-8")

    snaps = oi_tracker._load_day("NIFTY", DAY, root=tmp_path)
    assert snaps == [good]


# ---------------------------------------------------------------------------
# (d) retention: files older than keep_days are pruned
# ---------------------------------------------------------------------------


def test_prune_removes_files_older_than_keep_days(tmp_path):
    old_day = (DAY_D - timedelta(days=31)).isoformat()
    edge_day = (DAY_D - timedelta(days=30)).isoformat()
    assert oi_tracker._append("NIFTY", _snap("NIFTY", _iso(9, 0, day=old_day)), root=tmp_path)
    assert oi_tracker._append("BANKNIFTY", _snap("BANKNIFTY", _iso(9, 0, day=edge_day)), root=tmp_path)
    assert oi_tracker._append("NIFTY", _snap("NIFTY", _iso(9, 20)), root=tmp_path)

    removed = oi_tracker._prune(root=tmp_path, keep_days=30, today=DAY_D)

    assert removed == 1
    assert not oi_tracker._snapshot_file("NIFTY", old_day, root=tmp_path).exists()
    # Exactly at the 30-day boundary and today are kept.
    assert oi_tracker._snapshot_file("BANKNIFTY", edge_day, root=tmp_path).exists()
    assert oi_tracker._snapshot_file("NIFTY", DAY, root=tmp_path).exists()
    # Best-effort: a missing root never raises.
    assert oi_tracker._prune(root=tmp_path / "nope", keep_days=30, today=DAY_D) == 0


# ---------------------------------------------------------------------------
# (5) API contract: hydrated data flows through history()/latest()
# ---------------------------------------------------------------------------


def test_history_filters_hydrated_snapshots_by_ticker(tmp_path):
    for s in (
        _snap("NIFTY", _iso(9, 20)),
        _snap("BANKNIFTY", _iso(9, 25)),
        _snap("NIFTY", _iso(9, 30)),
    ):
        assert oi_tracker._append(s["ticker"], s, root=tmp_path)
    oi_tracker._hydrate(date_str=DAY, root=tmp_path)

    # Same shape dashboard_server.py builds for /api/oi-flow/history.
    snaps = oi_tracker.history("NIFTY")
    body = {"ticker": "NIFTY", "count": len(snaps), "snapshots": snaps}
    assert set(body) == {"ticker", "count", "snapshots"}
    assert body["count"] == 2
    assert [s["ticker"] for s in body["snapshots"]] == ["NIFTY", "NIFTY"]
    assert [s["ts"] for s in body["snapshots"]] == [_iso(9, 20), _iso(9, 30)]

    assert oi_tracker.latest("NIFTY") == snaps[-1]
    assert oi_tracker.latest("NIFTY")["ts"] == _iso(9, 30)
    assert oi_tracker.history("RELIANCE") == []
    assert oi_tracker.latest("RELIANCE") is None


def test_poll_interval_is_two_minutes():
    assert oi_tracker.POLL_SEC == 120
    assert oi_tracker.KEEP_DAYS == 30
