"""Scheduler + disk-persistence tests for india_board/scripts/scan_data.py.

No network, no Fyers client: the scan itself is replaced by a fake that
returns a synthetic payload, so these tests only exercise the proactive
scheduler, the atomic persist/hydrate round trip, and the off-hours rules.
"""
from __future__ import annotations

import json
import threading
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from india_board.scripts import scan_data

IST = ZoneInfo("Asia/Kolkata")
DAY = date(2026, 9, 28)  # a Monday


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    """Isolate module state + redirect the persist path into ``tmp_path``."""
    monkeypatch.setattr(scan_data, "DATA_DIR", tmp_path)
    monkeypatch.setattr(scan_data, "_CACHE", {"payload": None, "ts": 0.0})
    monkeypatch.setattr(scan_data, "_STATE", {"progress": 0, "total": 0})
    monkeypatch.setattr(scan_data, "_WORKER", None)
    monkeypatch.setattr(scan_data, "_STARTED", False)
    monkeypatch.setattr(scan_data, "SCAN_OFFHOURS_ENABLED", True)
    monkeypatch.delenv("SCAN_INTERVAL_SEC", raising=False)
    yield


def _payload(rows: int = 3, generated_at: str | None = None) -> dict:
    gen = generated_at or datetime(2026, 9, 28, 10, 0, tzinfo=IST).isoformat()
    return {
        "generated_at": gen,
        "expiry": "2026-10-02",
        "sections": {
            "rows": [{"ticker": f"SYM{i}", "spot": 100.0 + i} for i in range(rows)],
            "top_call_buildup": [],
            "top_put_buildup": [],
            "pcr_extremes": {"lowest": [], "highest": []},
            "unusual": [],
        },
        "status": {
            "state": "ready", "progress": rows, "total": rows, "updated_at": gen,
        },
    }


def _today_payload(rows: int = 3) -> dict:
    now = datetime.now(IST)
    gen = datetime(now.year, now.month, now.day, 15, 20, tzinfo=IST).isoformat()
    return _payload(rows=rows, generated_at=gen)


# ---------------------------------------------------------------------------
# (a) persist -> hydrate round trip
# ---------------------------------------------------------------------------


def test_persist_hydrate_round_trip():
    payload = _payload(rows=5)
    assert scan_data._persist(payload) is True

    # Atomic write: the file exists and no .tmp is left behind.
    assert scan_data._latest_path().is_file()
    assert not (scan_data._latest_path().parent / "latest.json.tmp").exists()

    # Simulate a fresh process: wipe memory, then restore from disk.
    scan_data._CACHE["payload"] = None
    scan_data._CACHE["ts"] = 0.0
    restored = scan_data._hydrate()

    assert restored is not None
    assert restored["sections"]["rows"] == payload["sections"]["rows"]
    assert scan_data._CACHE["payload"] is restored
    expected_ts = datetime(2026, 9, 28, 10, 0, tzinfo=IST).timestamp()
    assert scan_data._CACHE["ts"] == pytest.approx(expected_ts)
    # status is re-derived and attached after restore.
    assert restored["status"]["state"] == "ready"
    assert restored["status"]["updated_at"] == payload["generated_at"]


# ---------------------------------------------------------------------------
# (b) stale cache -> exactly one scan; fresh cache -> none
# ---------------------------------------------------------------------------


def test_stale_triggers_one_scan_fresh_triggers_none(monkeypatch):
    calls: list[int] = []
    fresh = _payload(rows=2)

    def fake_scan(pairs=None):
        calls.append(1)
        return fresh

    monkeypatch.setattr(scan_data, "_run_scan_sync", fake_scan)
    monkeypatch.setattr(scan_data, "_is_market_open", lambda now=None: True)

    # Stale: cache ts well beyond the interval.
    scan_data._CACHE["payload"] = _payload(rows=1)
    scan_data._CACHE["ts"] = time.time() - 10_000
    assert scan_data._run_due_scan() is True
    assert len(calls) == 1
    # The scan refreshed the cache (and persisted it).
    assert scan_data._CACHE["payload"]["sections"]["rows"] == fresh["sections"]["rows"]
    assert scan_data._latest_path().is_file()

    # Fresh: a second tick must not scan again.
    assert scan_data._run_due_scan() is False
    assert len(calls) == 1


# ---------------------------------------------------------------------------
# (c) no overlapping scans
# ---------------------------------------------------------------------------


def test_no_overlapping_scans(monkeypatch):
    calls: list[int] = []
    started = threading.Event()
    release = threading.Event()

    def blocking_scan(pairs=None):
        calls.append(1)
        started.set()
        assert release.wait(timeout=5)
        return _payload(rows=2)

    monkeypatch.setattr(scan_data, "_run_scan_sync", blocking_scan)
    monkeypatch.setattr(scan_data, "_is_market_open", lambda now=None: True)
    scan_data._CACHE["payload"] = _payload(rows=1)
    scan_data._CACHE["ts"] = time.time() - 10_000

    first = threading.Thread(target=scan_data._run_due_scan, daemon=True)
    first.start()
    assert started.wait(timeout=5) is True

    # A second cycle while the first scan is still running -> no new scan.
    assert scan_data._run_due_scan() is False
    assert len(calls) == 1

    release.set()
    first.join(timeout=5)
    assert len(calls) == 1


# ---------------------------------------------------------------------------
# (d) corrupt / missing latest.json is ignored, never raises
# ---------------------------------------------------------------------------


def test_corrupt_or_missing_latest_json_is_ignored():
    # Missing file.
    assert scan_data._hydrate() is None
    assert scan_data._CACHE["payload"] is None

    # Corrupt JSON.
    scan_data._latest_path().write_text("{not json at all", encoding="utf-8")
    assert scan_data._hydrate() is None
    assert scan_data._CACHE["payload"] is None

    # Valid JSON but no rows -> ignored.
    scan_data._latest_path().write_text(
        json.dumps({"generated_at": "2026-09-28T10:00:00+05:30",
                    "sections": {"rows": []}}),
        encoding="utf-8",
    )
    assert scan_data._hydrate() is None
    assert scan_data._CACHE["payload"] is None


# ---------------------------------------------------------------------------
# (e) SCAN_INTERVAL_SEC env override
# ---------------------------------------------------------------------------


def test_scan_interval_env_override(monkeypatch):
    assert scan_data._env_interval() == 300
    assert scan_data.SCAN_INTERVAL_SEC == scan_data._SCAN_TTL

    monkeypatch.setenv("SCAN_INTERVAL_SEC", "60")
    assert scan_data._env_interval() == 60

    # Malformed value falls back to the default instead of raising.
    monkeypatch.setenv("SCAN_INTERVAL_SEC", "abc")
    assert scan_data._env_interval() == 300


# ---------------------------------------------------------------------------
# (f) off-hours behaviour
# ---------------------------------------------------------------------------


def test_offhours_no_scan_when_payload_from_today(monkeypatch):
    calls: list[int] = []
    monkeypatch.setattr(
        scan_data, "_run_scan_sync", lambda pairs=None: calls.append(1) or _payload()
    )
    monkeypatch.setattr(scan_data, "_is_market_open", lambda now=None: False)

    scan_data._CACHE["payload"] = _today_payload(rows=3)
    scan_data._CACHE["ts"] = time.time()

    assert scan_data._run_due_scan() is False
    assert calls == []


def test_offhours_scans_once_for_previous_session(monkeypatch):
    calls: list[int] = []
    monkeypatch.setattr(
        scan_data, "_run_scan_sync", lambda pairs=None: calls.append(1) or _payload()
    )
    monkeypatch.setattr(scan_data, "_is_market_open", lambda now=None: False)

    # Cache generated on a previous day -> capture the closed session once.
    scan_data._CACHE["payload"] = _payload(
        generated_at=datetime(2026, 9, 21, 15, 20, tzinfo=IST).isoformat()
    )
    scan_data._CACHE["ts"] = time.time() - 10_000

    assert scan_data._run_due_scan() is True
    assert len(calls) == 1


def test_offhours_disabled_never_scans(monkeypatch):
    calls: list[int] = []
    monkeypatch.setattr(
        scan_data, "_run_scan_sync", lambda pairs=None: calls.append(1) or _payload()
    )
    monkeypatch.setattr(scan_data, "_is_market_open", lambda now=None: False)
    monkeypatch.setattr(scan_data, "SCAN_OFFHOURS_ENABLED", False)

    scan_data._CACHE["payload"] = None
    assert scan_data._run_due_scan() is False
    assert calls == []


# ---------------------------------------------------------------------------
# ensure_started / build_scan wiring (no real thread work / no network)
# ---------------------------------------------------------------------------


def test_ensure_started_hydrates_and_is_idempotent(monkeypatch):
    payload = _payload(rows=4)
    assert scan_data._persist(payload) is True

    # Replace the loop so no network scan is ever attempted.
    monkeypatch.setattr(scan_data, "_loop", lambda: None)
    scan_data.ensure_started()

    assert scan_data._STARTED is True
    restored = scan_data._CACHE["payload"]
    assert restored is not None
    assert restored["sections"]["rows"] == payload["sections"]["rows"]

    # Second call is a no-op (does not replace the hydrated payload).
    scan_data.ensure_started()
    assert scan_data._CACHE["payload"] is restored


def test_build_scan_hydrates_on_cold_start(monkeypatch):
    payload = _payload(rows=3)
    assert scan_data._persist(payload) is True
    # Block a background refresh so the assertion is about hydration only.
    monkeypatch.setattr(scan_data, "_start_background", lambda: None)

    out = scan_data.build_scan()
    assert out["sections"]["rows"] == payload["sections"]["rows"]
