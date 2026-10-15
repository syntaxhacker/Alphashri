"""Auth circuit breaker: a dead Fyers token must stop sweeps early.

Background: the stored token expired and every Fyers call 401'd, yet the
5-minute universe scan ground through all 213 underlyings (0 ok) and the home
page re-attempted ~22 chains on every page load. This suite locks in the latch
and the early-abort behaviour.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "india_board" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import fyers_data  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_latch():
    fyers_data.note_auth_success()
    yield
    fyers_data.note_auth_success()


# ---------------------------------------------------------------------------
# latch
# ---------------------------------------------------------------------------

def test_latch_set_and_clear():
    assert fyers_data.auth_failed() is False
    fyers_data.note_auth_failure()
    assert fyers_data.auth_failed() is True
    assert fyers_data.auth_failure_count() >= 1
    fyers_data.note_auth_success()
    assert fyers_data.auth_failed() is False
    assert fyers_data.auth_failure_count() == 0


def test_latch_expires_after_ttl(monkeypatch):
    import time as _time

    fyers_data.note_auth_failure()
    base = _time.time()
    monkeypatch.setattr(fyers_data.time, "time", lambda: base + 10_000)
    assert fyers_data.auth_failed(ttl=900) is False


@pytest.mark.parametrize(
    "value,expected",
    [
        ("Fyers auth failed (HTTP 401)", True),
        ("{'code': 401, 'message': 'unauthorized'}", True),
        ("Token invalid or expired", True),
        ("429 rate limited", False),
        ("optionchain failed: -99 Bad request", False),
        (None, False),
    ],
)
def test_looks_like_auth_error(value, expected):
    assert fyers_data._looks_like_auth_error(value) is expected


# ---------------------------------------------------------------------------
# home snapshot: no doomed rebuilds while the latch is set
# ---------------------------------------------------------------------------

def test_snapshot_skips_rebuild_when_auth_failed(monkeypatch):
    calls = []
    monkeypatch.setattr(fyers_data, "_rebuild_snapshot", lambda: calls.append(1) or {})
    fyers_data._CACHE.pop("snapshot", None)
    fyers_data.note_auth_failure()

    out = fyers_data.build_snapshot()
    assert calls == [], "a latched auth failure must not attempt 20+ doomed calls"
    assert out["data_status"] == "feed_auth_failed"
    assert "re-authenticate" in (out.get("reason") or "")
    assert out["sections"] == {"indices": [], "leaders": []}


def test_snapshot_serves_last_good_flagged_when_auth_failed(monkeypatch):
    payload = {"generated_at": "2026-09-28T10:00:00+05:30",
               "sections": {"indices": [{"ticker": "NIFTY"}], "leaders": [{"ticker": "X"}]}}
    fyers_data._CACHE["snapshot"] = (0.0, payload)  # extremely stale on purpose
    fyers_data.note_auth_failure()
    out = fyers_data.build_snapshot()
    assert out["data_status"] == "feed_auth_failed"
    assert out["stale"] is True
    assert out["sections"]["leaders"], "last-good board is still served"


# ---------------------------------------------------------------------------
# sweeps abort early
# ---------------------------------------------------------------------------

def test_scan_aborts_early_when_token_dead(monkeypatch):
    import scan_data

    attempts = []

    def _fail_one(label, symbol):
        attempts.append(label)
        fyers_data.note_auth_failure()          # every call 401s
        return None

    monkeypatch.setattr(scan_data, "_fetch_one", _fail_one)
    monkeypatch.setattr(scan_data, "time", scan_data.time)
    pairs = [(f"T{i}", f"NSE:T{i}-EQ") for i in range(40)]
    scan_data._run_scan_sync(pairs)
    assert len(attempts) < 10, f"sweep should abort early, attempted {len(attempts)}"
    assert len(attempts) >= 2, "must try a couple before concluding the token is dead"


def test_oi_tracker_sweep_aborts_when_token_dead(monkeypatch):
    import oi_tracker

    attempts = []
    monkeypatch.setattr(
        oi_tracker, "take_snapshot",
        lambda t: (attempts.append(t), fyers_data.note_auth_failure(), None)[-1],
    )
    monkeypatch.setattr(oi_tracker, "_GAP_SEC", 0)
    oi_tracker._sweep()
    assert len(attempts) < 10, f"oi sweep should abort early, attempted {len(attempts)}"


# ---------------------------------------------------------------------------
# hard rate-limit / Cloudflare 1015 ban handling
# ---------------------------------------------------------------------------

def test_rate_limit_latch_fails_fast_without_sleeping(monkeypatch):
    """A 1015-style ban must raise immediately, not sleep for minutes."""
    import fyers_pacer as P

    P.reset_state()
    P.note_rate_limit(2953)                       # ~49 min, as Cloudflare sent
    assert P.rate_limited() is True
    assert P.rate_limit_remaining() > 2900
    slept = []
    monkeypatch.setattr(P.time, "sleep", lambda s: slept.append(s))
    with pytest.raises(P.FyersRateLimited) as exc:
        P.acquire()
    assert slept == [], "must not sleep through a ban window"
    assert exc.value.retry_after > 2900
    P.reset_state()
    assert P.rate_limited() is False


def test_short_retry_after_is_not_latched():
    import fyers_pacer as P

    P.reset_state()
    P.note_rate_limit(5)
    assert P.rate_limited() is True
    P.note_rate_limit(0)                          # never shortens an active window
    assert P.rate_limit_remaining() > 0
    P.reset_state()


def test_fyers_paused_covers_rate_limit(monkeypatch):
    import fyers_pacer as P

    P.reset_state()
    fyers_data.note_auth_success()
    assert fyers_data.fyers_paused() is False
    P.note_rate_limit(600)
    assert fyers_data.fyers_paused() is True
    assert "rate-limited" in (fyers_data.pause_reason() or "")
    P.reset_state()
    assert fyers_data.fyers_paused() is False


def test_snapshot_reports_rate_limited_status(monkeypatch):
    import fyers_pacer as P

    fyers_data._CACHE.pop("snapshot", None)
    fyers_data.note_auth_success()
    monkeypatch.setattr(fyers_data, "_rebuild_snapshot", lambda: pytest.fail("no rebuild while banned"))
    P.note_rate_limit(600)
    try:
        out = fyers_data.build_snapshot()
        assert out["data_status"] == "feed_rate_limited"
        assert "rate-limited" in (out.get("reason") or "").lower()
    finally:
        P.reset_state()
