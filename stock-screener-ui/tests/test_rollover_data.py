"""Unit tests for ``india_board/scripts/rollover_data.py`` (W1c / F8).

Pure/offline: no Fyers client, no network. Synthetic option chains exercise the
rollover maths, the PCR term structure, JSONL persistence and the scheduler's
interval/env parsing. The two network wrappers (:func:`rollover_series`,
:func:`basis_snapshot`) are driven through monkeypatched ``fyers_data`` helpers.

``rollover_data`` lives in ``india_board/scripts`` (a package); importing it via
``india_board.scripts`` also puts that directory on ``sys.path`` so the lazy
``import fyers_data`` inside the module resolves.
"""
from __future__ import annotations

import json
import types
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from india_board.scripts import rollover_data
import fyers_data  # noqa: E402  (importable once rollover_data adds scripts/ to sys.path)

IST = ZoneInfo("Asia/Kolkata")
DAY = "2026-09-28"  # a Monday


def _iso(hour: int, minute: int, day: str = DAY) -> str:
    y, m, d = (int(x) for x in day.split("-"))
    return datetime(y, m, d, hour, minute, tzinfo=IST).isoformat()


def _chain(expiry: str, *, ce: float = 0.0, pe: float = 0.0,
           flag: str | None = None, spot: float = 100.0,
           as_of: str | None = "2026-09-28", extra_strikes=None) -> dict:
    """Minimal ``get_chain``-shaped payload (single strike unless ``extra``)."""
    strikes = [{"strike": 100.0, "ce_oi": ce, "pe_oi": pe}]
    strikes.extend(extra_strikes or [])
    return {
        "ticker": "X",
        "spot": spot,
        "strikes": strikes,
        "expiries": [expiry],
        "call_oi": ce,
        "put_oi": pe,
        "expiry": expiry,
        "expiry_flag": flag,
        "as_of": as_of,
    }


# ---------------------------------------------------------------------------
# (a) rollover_pct maths (total + per-strike) incl. zero denominator -> None
# ---------------------------------------------------------------------------

def test_rollover_pct_total_and_per_strike():
    near = _chain("30-09-2026", ce=100.0, pe=100.0, flag="W")
    next_ = _chain("28-10-2026", ce=300.0, pe=300.0, flag="M")

    out = rollover_data.rollover("nifty", near, next_)

    assert out["ticker"] == "NIFTY"
    assert out["near_oi"] == 200.0 and out["next_oi"] == 600.0
    assert out["rollover_pct"] == pytest.approx(0.75)
    assert out["oi_shift"] == 400.0
    assert out["classification"] == "rolling"
    assert out["near_expiry"] == "30-09-2026"
    assert out["next_expiry"] == "28-10-2026"
    assert out["near_expiry_flag"] == "W" and out["next_expiry_flag"] == "M"
    # DTE measured from as_of (2026-09-28).
    assert out["near_dte"] == 2 and out["next_dte"] == 30

    leg = out["strikes"][0]
    assert leg["strike"] == 100.0
    assert leg["near_oi"] == 200.0 and leg["next_oi"] == 600.0
    assert leg["rollover_pct"] == pytest.approx(0.75)
    assert leg["oi_shift"] == 400.0


def test_rollover_zero_denominator_is_none():
    empty_near = {"strikes": [], "expiry": "30-09-2026", "as_of": DAY}
    empty_next = {"strikes": [], "expiry": "28-10-2026", "as_of": DAY}

    out = rollover_data.rollover("NIFTY", empty_near, empty_next)

    assert out["rollover_pct"] is None
    assert out["rollover_pct_call"] is None
    assert out["rollover_pct_put"] is None
    assert out["oi_shift"] == 0.0
    # None is not > 0.5, so the classifier falls back to "holding".
    assert out["classification"] == "holding"


def test_rollover_strike_union_keeps_one_sided_strikes():
    near = _chain("30-09-2026", ce=100.0, pe=100.0)
    next_ = _chain(
        "28-10-2026", ce=0.0, pe=0.0,
        extra_strikes=[{"strike": 110.0, "ce_oi": 50.0, "pe_oi": 50.0}],
    )
    # Give the next chain a real total so the ratio is meaningful.
    next_["call_oi"] = 50.0
    next_["put_oi"] = 50.0

    out = rollover_data.rollover("NIFTY", near, next_)
    by_strike = {r["strike"]: r for r in out["strikes"]}

    assert set(by_strike) == {100.0, 110.0}
    assert by_strike[110.0]["near_oi"] == 0.0
    assert by_strike[110.0]["next_oi"] == 100.0
    assert by_strike[110.0]["rollover_pct"] == 1.0


# ---------------------------------------------------------------------------
# (b) call / put rollover split
# ---------------------------------------------------------------------------

def test_rollover_call_put_split():
    near = _chain("30-09-2026", ce=100.0, pe=300.0)
    next_ = _chain("28-10-2026", ce=300.0, pe=100.0)

    out = rollover_data.rollover("NIFTY", near, next_)

    assert out["near_call_oi"] == 100.0 and out["next_call_oi"] == 300.0
    assert out["near_put_oi"] == 300.0 and out["next_put_oi"] == 100.0
    assert out["rollover_pct_call"] == pytest.approx(0.75)
    assert out["rollover_pct_put"] == pytest.approx(0.25)
    assert out["rollover_pct"] == pytest.approx(0.5)
    assert out["oi_shift_call"] == 200.0 and out["oi_shift_put"] == -200.0


# ---------------------------------------------------------------------------
# (c) classification boundary at 0.5
# ---------------------------------------------------------------------------

def test_classification_boundary_at_half():
    # Exactly 0.5 -> holding (strictly greater than 0.5 is required).
    half = rollover_data.rollover(
        "N", _chain("30-09-2026", ce=50.0), _chain("28-10-2026", ce=50.0)
    )
    assert half["rollover_pct"] == 0.5
    assert half["classification"] == "holding"

    # Just over half -> rolling.
    over = rollover_data.rollover(
        "N", _chain("30-09-2026", ce=49.0), _chain("28-10-2026", ce=51.0)
    )
    assert over["rollover_pct"] == pytest.approx(0.51)
    assert over["classification"] == "rolling"

    # Just under half -> holding.
    under = rollover_data.rollover(
        "N", _chain("30-09-2026", ce=51.0), _chain("28-10-2026", ce=49.0)
    )
    assert under["classification"] == "holding"


# ---------------------------------------------------------------------------
# (d) PCR term structure
# ---------------------------------------------------------------------------

def test_pcr_by_expiry_term_structure():
    near = {"expiry": "30-09-2026", "call_oi": 100.0, "put_oi": 200.0,
            "expiry_flag": "W", "strikes": []}
    next_ = {"expiry": "28-10-2026", "call_oi": 400.0, "put_oi": 100.0,
             "expiry_flag": "M", "strikes": []}

    out = rollover_data.pcr_by_expiry({"30-09-2026": near, "28-10-2026": next_})

    assert out["30-09-2026"]["pcr"] == pytest.approx(2.0)
    assert out["28-10-2026"]["pcr"] == pytest.approx(0.25)
    assert out["30-09-2026"]["call_oi"] == 100.0
    assert out["30-09-2026"]["expiry_flag"] == "W"
    assert out["28-10-2026"]["expiry_flag"] == "M"


def test_pcr_falls_back_to_strike_sum_and_none_on_zero_calls():
    # No top-level totals -> sum the strikes.
    chain = {"expiry": "30-09-2026", "strikes": [
        {"strike": 100.0, "ce_oi": 30.0, "pe_oi": 90.0},
    ]}
    out = rollover_data.pcr_by_expiry([chain])
    assert out["30-09-2026"]["call_oi"] == 30.0
    assert out["30-09-2026"]["put_oi"] == 90.0
    assert out["30-09-2026"]["pcr"] == pytest.approx(3.0)

    zero_call = {"expiry": "28-10-2026", "call_oi": 0.0, "put_oi": 10.0,
                 "strikes": [{"strike": 1.0, "pe_oi": 10.0}]}
    out2 = rollover_data.pcr_by_expiry([zero_call])
    assert out2["28-10-2026"]["pcr"] is None


# ---------------------------------------------------------------------------
# (e) JSONL persist -> load round trip, malformed lines skipped
# ---------------------------------------------------------------------------

def _record(ticker: str, ts: str) -> dict:
    return {
        "ts": ts,
        "ticker": ticker,
        "spot": 25000.0,
        "lot_size": 25,
        "basis": None,
        "rollover": None,
    }


def test_persist_load_round_trip_and_malformed_skip(tmp_path):
    rec1 = _record("NIFTY", _iso(9, 20))
    rec2 = _record("BANKNIFTY", _iso(9, 30))
    # Written newest-first on purpose — load() must re-sort by ts.
    assert rollover_data.persist(rec2, root=tmp_path) is True
    assert rollover_data.persist(rec1, root=tmp_path) is True

    path = rollover_data._day_path(DAY, root=tmp_path)
    assert path.is_file()
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("{not json at all\n")
        fh.write(json.dumps(["a", "list"]) + "\n")
        fh.write(json.dumps({"ticker": "NIFTY"}) + "\n")  # dict but no ts
        fh.write("\n")

    loaded = rollover_data.load(root=tmp_path, date_str=DAY)
    assert loaded == [rec1, rec2]

    # history() filters by ticker and aggregates across days.
    assert rollover_data.history("NIFTY", root=tmp_path) == [rec1]
    assert rollover_data.history("nifty", root=tmp_path) == [rec1]
    assert rollover_data.history(root=tmp_path) == [rec1, rec2]
    assert rollover_data.history("RELIANCE", root=tmp_path) == []
    # A missing day is empty, never an error.
    assert rollover_data.load(root=tmp_path, date_str="2026-09-27") == []


def test_persist_failure_returns_false_not_raise(tmp_path):
    blocker = tmp_path / "blocker"
    blocker.write_text("i am a file, not a directory", encoding="utf-8")
    assert rollover_data.persist(_record("NIFTY", _iso(9, 20)), root=blocker) is False


# ---------------------------------------------------------------------------
# (f) rollover_series -> unavailable when the fetch raises
# ---------------------------------------------------------------------------

def test_rollover_series_unavailable_when_list_expiries_raises(monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("token expired")

    monkeypatch.setattr(fyers_data, "list_expiries", boom, raising=False)

    out = rollover_data.rollover_series("NIFTY")

    assert out["ticker"] == "NIFTY"
    assert out["unavailable"] is True
    assert "RuntimeError" in out["reason"]


def test_rollover_series_unavailable_when_get_chain_raises(monkeypatch):
    monkeypatch.setattr(
        fyers_data, "list_expiries",
        lambda _t: [
            {"date": "30-09-2026", "expiry": "100", "expiry_flag": "W"},
            {"date": "28-10-2026", "expiry": "200", "expiry_flag": "M"},
        ],
        raising=False,
    )

    def boom(*_a, **_k):
        raise RuntimeError("rate limited")

    monkeypatch.setattr(fyers_data, "get_chain", boom, raising=False)

    out = rollover_data.rollover_series("NIFTY")
    assert out["unavailable"] is True
    assert "rate limited" in out["reason"]


def test_rollover_series_success_injects_expiry_meta(monkeypatch):
    monkeypatch.setattr(
        fyers_data, "list_expiries",
        lambda _t: [
            {"date": "30-09-2026", "expiry": "100", "expiry_flag": "W"},
            {"date": "28-10-2026", "expiry": "200", "expiry_flag": "M"},
        ],
        raising=False,
    )
    chains = {
        "100": {"spot": 100.0, "call_oi": 100.0, "put_oi": 100.0, "as_of": DAY,
                "strikes": [{"strike": 100.0, "ce_oi": 100.0, "pe_oi": 100.0}]},
        "200": {"spot": 100.0, "call_oi": 300.0, "put_oi": 300.0, "as_of": DAY,
                "strikes": [{"strike": 100.0, "ce_oi": 300.0, "pe_oi": 300.0}]},
    }
    monkeypatch.setattr(
        fyers_data, "get_chain",
        lambda _t, expiry_epoch=None, **_k: chains[expiry_epoch],
        raising=False,
    )

    out = rollover_data.rollover_series("NIFTY")

    assert out["unavailable"] is False
    assert out["rollover_pct"] == pytest.approx(0.75)
    # expiry / flag backfilled from list_expiries.
    assert out["near_expiry"] == "30-09-2026"
    assert out["next_expiry_flag"] == "M"
    assert out["spot"] == 100.0
    assert set(out["pcr_by_expiry"]) == {"30-09-2026", "28-10-2026"}


# ---------------------------------------------------------------------------
# (g) basis_snapshot maps build_futures without recomputing basis
# ---------------------------------------------------------------------------

def test_basis_snapshot_maps_build_futures(monkeypatch):
    payload = {
        "ticker": "NIFTY",
        "spot": 25000.0,
        "as_of": DAY,
        "futures": [
            {"expiry": "30-09-2026", "price": 25000.0, "basis": 123.45,
             "annualized_basis": 9.9, "dte": 2, "oi": None},
            {"expiry": "28-10-2026", "price": 25200.0, "basis": 200.0,
             "annualized_basis": 12.0, "dte": 30, "oi": None},
        ],
    }
    monkeypatch.setattr(fyers_data, "build_futures", lambda _t: payload, raising=False)

    snap = rollover_data.basis_snapshot("NIFTY")

    assert snap["ticker"] == "NIFTY"
    assert snap["spot"] == 25000.0
    assert snap["near"] == {
        "expiry": "30-09-2026",
        "price": 25000.0,
        "basis": 123.45,
        "annualized_basis": 9.9,
        "dte": 2,
    }
    # Basis is passed through verbatim, not recomputed: price == spot would
    # give 0 here, so a non-zero value proves it came from build_futures.
    assert snap["near"]["basis"] != snap["near"]["price"] - snap["spot"]


def test_basis_snapshot_unavailable_on_error(monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("no futures")

    monkeypatch.setattr(fyers_data, "build_futures", boom, raising=False)

    snap = rollover_data.basis_snapshot("NIFTY")
    assert snap["ticker"] == "NIFTY"
    assert snap["near"] is None
    assert snap["unavailable"] is True


# ---------------------------------------------------------------------------
# (h) prune keeps recent days, removes old ones, never raises
# ---------------------------------------------------------------------------

def test_prune_removes_old_keeps_recent(tmp_path):
    from datetime import date, timedelta

    day_d = date(2026, 9, 28)
    old_day = (day_d - timedelta(days=181)).isoformat()
    recent_day = (day_d - timedelta(days=10)).isoformat()

    assert rollover_data.persist(_record("NIFTY", _iso(9, 0, day=old_day)), root=tmp_path)
    assert rollover_data.persist(_record("NIFTY", _iso(9, 0, day=recent_day)), root=tmp_path)
    assert rollover_data.persist(_record("NIFTY", _iso(9, 20)), root=tmp_path)

    removed = rollover_data.prune(root=tmp_path, keep_days=180, today=day_d)

    assert removed == 1
    assert not rollover_data._day_path(old_day, root=tmp_path).exists()
    assert rollover_data._day_path(recent_day, root=tmp_path).exists()
    assert rollover_data._day_path(DAY, root=tmp_path).exists()
    # Best-effort: a missing root never raises.
    assert rollover_data.prune(root=tmp_path / "nope", keep_days=180, today=day_d) == 0


# ---------------------------------------------------------------------------
# (i) ROLLOVER_INTERVAL_SEC override parsing
# ---------------------------------------------------------------------------

def test_interval_env_override(monkeypatch):
    monkeypatch.delenv("ROLLOVER_INTERVAL_SEC", raising=False)
    assert rollover_data._env_interval() == 1800.0

    monkeypatch.setenv("ROLLOVER_INTERVAL_SEC", "42")
    assert rollover_data._env_interval() == 42.0

    monkeypatch.setenv("ROLLOVER_INTERVAL_SEC", "12.5")
    assert rollover_data._env_interval() == 12.5

    monkeypatch.setenv("ROLLOVER_INTERVAL_SEC", "not-a-number")
    assert rollover_data._env_interval() == 1800.0

    # Sane defaults / budget guard.
    assert rollover_data.MAX_CHAIN_CALLS == 40
    assert rollover_data.KEEP_DAYS == 180


# ---------------------------------------------------------------------------
# Scheduler safety: idempotent, market-hours gated, no real thread/network.
# ---------------------------------------------------------------------------

def test_ensure_started_is_idempotent_without_real_thread(monkeypatch):
    started: list[str] = []

    class _FakeThread:
        def __init__(self, *_, target=None, name=None, daemon=None, **__):
            self.target = target

        def start(self):
            started.append("start")

    monkeypatch.setattr(rollover_data, "threading",
                        types.SimpleNamespace(Thread=_FakeThread))
    monkeypatch.setattr(rollover_data, "_STARTED", False)
    monkeypatch.setattr(rollover_data, "prune", lambda *a, **k: 0)

    rollover_data.ensure_started()
    rollover_data.ensure_started()  # idempotent
    assert started == ["start"]


def test_market_hours_and_post_1520_gating():
    def at(h, m, day=DAY):
        y, mo, d = (int(x) for x in day.split("-"))
        return datetime(y, mo, d, h, m, tzinfo=IST)

    assert rollover_data._is_market_open(at(9, 15)) is True
    assert rollover_data._is_market_open(at(15, 30)) is True
    assert rollover_data._is_market_open(at(9, 14)) is False
    assert rollover_data._is_market_open(at(15, 31)) is False
    # Saturday 2026-10-03.
    assert rollover_data._is_market_open(at(11, 0, day="2026-10-03")) is False

    assert rollover_data._is_post_1520(at(15, 20)) is True
    assert rollover_data._is_post_1520(at(15, 19)) is False


# ---------------------------------------------------------------------------
# Post-close archival capture (late start / restart after 15:30)
# ---------------------------------------------------------------------------


def test_due_capture_runs_after_close_once_per_day(monkeypatch, tmp_path):
    """A process starting after 15:30 must still archive the day, exactly once."""
    import rollover_data as rd
    from datetime import datetime as dt

    monkeypatch.setattr(rd, "DATA_DIR", tmp_path, raising=False)
    calls = []
    monkeypatch.setattr(rd, "scheduled_capture", lambda *a, **k: calls.append(1) or {"count": 3})
    monkeypatch.setattr(rd, "_LAST_CAPTURE_TS", 0.0)
    monkeypatch.setattr(rd, "_POST_1520_DATE", None)

    late = dt(2026, 9, 28, 15, 55, tzinfo=rd.IST)          # Monday, after close
    assert rd._run_due_capture(late) is True
    assert len(calls) == 1

    # Second tick the same day must not re-capture.
    assert rd._run_due_capture(late) is False
    assert len(calls) == 1


def test_due_capture_skips_weekend_after_close(monkeypatch):
    import rollover_data as rd
    from datetime import datetime as dt

    calls = []
    monkeypatch.setattr(rd, "scheduled_capture", lambda *a, **k: calls.append(1) or {"count": 0})
    monkeypatch.setattr(rd, "_LAST_CAPTURE_TS", 0.0)
    monkeypatch.setattr(rd, "_POST_1520_DATE", None)

    saturday = dt(2026, 9, 26, 16, 0, tzinfo=rd.IST)
    assert rd._run_due_capture(saturday) is False
    assert calls == []


def test_post_1520_capture_not_repeated_across_restart(monkeypatch, tmp_path):
    """A restart after 15:20 must not append a duplicate archival capture."""
    import rollover_data as rd
    from datetime import datetime as dt

    monkeypatch.setattr(rd, "DATA_DIR", tmp_path, raising=False)
    calls = []

    def fake_capture(*a, **k):
        # A real capture persists a record; the dedup reads that back.
        calls.append(1)
        rd.persist({"ts": dt(2026, 9, 28, 16, 5, tzinfo=rd.IST).isoformat(),
                    "ticker": "NIFTY", "spot": 1.0, "lot_size": 1,
                    "basis": None, "rollover": None})
        return {"count": 1}

    monkeypatch.setattr(rd, "scheduled_capture", fake_capture)
    monkeypatch.setattr(rd, "_LAST_CAPTURE_TS", 0.0)
    monkeypatch.setattr(rd, "_POST_1520_DATE", None)

    late = dt(2026, 9, 28, 16, 5, tzinfo=rd.IST)
    assert rd._run_due_capture(late) is True          # first process archives
    assert len(calls) == 1

    # Simulate a restart: fresh in-process state, same day, same time.
    monkeypatch.setattr(rd, "_LAST_CAPTURE_TS", 0.0)
    monkeypatch.setattr(rd, "_POST_1520_DATE", None)
    assert rd._run_due_capture(late) is False
    assert len(calls) == 1                            # no duplicate archive
