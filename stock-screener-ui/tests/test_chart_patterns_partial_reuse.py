"""Tests for the scan-pipeline fixes: partial-today 1D scans, reuse contract
fields + detector-signature gating, scope-signature params, /market-status.
"""
import threading
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

import api.chart_patterns as cp_api
from api.chart_patterns import router
from chart_patterns import jobs, scan, store


def _make_df(n: int = 80) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=n, freq="D", tz="UTC")
    base = np.linspace(100.0, 120.0, n)
    return pd.DataFrame(
        {
            "open": base,
            "high": base + 1.0,
            "low": base - 1.0,
            "close": base,
            "volume": np.full(n, 1000.0),
        },
        index=idx,
    )


@pytest.fixture
def cp_store(test_db_engine):
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    store.set_session_factory(factory)
    jobs.reset()
    try:
        yield factory
    finally:
        jobs.reset()
        store.reset_session_factory()


def _market_open(monkeypatch):
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: True)


# ---------------------------------------------------------------------------
# ISSUE 1: _process_symbol threads include_partial_today for daily scans.
# ---------------------------------------------------------------------------


def _run_process(monkeypatch, cp_store, timeframe="1D", **kwargs):
    seen = {}

    def fake_fetch(symbol, tf, **fetch_kwargs):
        seen.update(fetch_kwargs)
        return _make_df(80)

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    store.save_job({
        "job_id": "cpj_partial", "universe": "nifty50", "timeframe": timeframe,
        "status": "queued",
    })
    result = scan._process_symbol("AAA", timeframe, "cpj_partial", **kwargs)
    assert result["status"] == "ok"
    return seen


def test_process_symbol_daily_defaults_to_partial_today(cp_store, monkeypatch):
    seen = _run_process(monkeypatch, cp_store, timeframe="1D")
    assert seen.get("include_partial_today") is True


def test_process_symbol_intraday_omits_partial_today(cp_store, monkeypatch):
    seen = _run_process(monkeypatch, cp_store, timeframe="15m")
    assert "include_partial_today" not in seen


def test_process_symbol_explicit_false_forces_off(cp_store, monkeypatch):
    seen = _run_process(
        monkeypatch, cp_store, timeframe="1D", include_partial_today=False
    )
    assert "include_partial_today" not in seen


def test_process_symbol_replay_never_applies_partial(cp_store, monkeypatch):
    seen = _run_process(
        monkeypatch, cp_store, timeframe="1D",
        as_of_date="2026-03-15", include_partial_today=True,
    )
    assert "include_partial_today" not in seen
    assert seen.get("as_of_date") == "2026-03-15"


def test_run_job_threads_partial_flag_from_params(cp_store, monkeypatch):
    seen = {}

    def fake_fetch(symbol, tf, **fetch_kwargs):
        seen.update(fetch_kwargs)
        return _make_df(80)

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(
        scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: [])
    )
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"]))
    store.save_job({
        "job_id": "cpj_partial_job", "universe": "nifty50", "timeframe": "1D",
        "status": "queued", "params": {"force": True, "include_partial_today": False},
    })
    scan.run_job("cpj_partial_job")

    assert store.get_job("cpj_partial_job")["status"] == "completed"
    assert "include_partial_today" not in seen


# ---------------------------------------------------------------------------
# ISSUE 2: reuse records reused* fields; signature change forces recompute.
# ---------------------------------------------------------------------------


def _fresh_prev(job_id="cpj_reuse_prev", signature=None):
    store.save_job({
        "job_id": job_id, "universe": "nifty50", "timeframe": "1D",
        "status": "completed", "total": 2, "done": 2, "failed": 0, "skipped": 0,
        "data_through": "2026-09-30",
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "params": {"scan_signature": signature or scan._detector_signature()},
    })


def test_reuse_sets_reused_fields_and_skips_detection(cp_store, monkeypatch):
    _market_open(monkeypatch)
    _fresh_prev()

    def _boom(symbol, tf, **kwargs):
        raise AssertionError("reuse must not fetch")

    def _boom_detect(df, tf, s):
        raise AssertionError("reuse must not detect")

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", _boom)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=_boom_detect))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"]))
    store.save_job({"job_id": "cpj_reuse_new", "universe": "nifty50", "timeframe": "1D", "status": "queued"})

    scan.run_job("cpj_reuse_new")

    row = store.get_job("cpj_reuse_new")
    assert row["status"] == "completed"
    assert row["total"] == 2 and row["done"] == 2
    # Contract fields (top-level and params mirror for restart durability).
    assert row["params"]["reused"] is True
    assert row["params"]["reused_from"] == "cpj_reuse_prev"
    assert isinstance(row["params"]["reused_age_sec"], int)
    assert row["params"]["reused_finished_at"] is not None
    # jobs.get_job overlays the params mirror back onto the DTO.
    dto = jobs.get_job("cpj_reuse_new")
    assert dto["reused"] is True
    assert dto["reused_from"] == "cpj_reuse_prev"
    assert isinstance(dto["reused_age_sec"], int)
    assert dto["reused_finished_at"] is not None


def test_signature_change_forces_recompute(cp_store, monkeypatch):
    _market_open(monkeypatch)
    _fresh_prev(signature="v0|tl:ancient")

    fetched = []
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, tf, **kwargs: (fetched.append(symbol) or _make_df(80)),
    )
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: []))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"]))
    store.save_job({"job_id": "cpj_sig_new", "universe": "nifty50", "timeframe": "1D", "status": "queued"})

    scan.run_job("cpj_sig_new")

    assert fetched == ["AAA"]
    row = store.get_job("cpj_sig_new")
    assert row["status"] == "completed"
    assert row["params"].get("reused") is not True


def test_missing_signature_forces_recompute(cp_store, monkeypatch):
    """Jobs from before signatures existed recompute once, then carry one."""
    _market_open(monkeypatch)
    store.save_job({
        "job_id": "cpj_nosig_prev", "universe": "nifty50", "timeframe": "1D",
        "status": "completed", "total": 1, "done": 1,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    })

    fetched = []
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, tf, **kwargs: (fetched.append(symbol) or _make_df(80)),
    )
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: []))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"]))
    store.save_job({"job_id": "cpj_nosig_new", "universe": "nifty50", "timeframe": "1D", "status": "queued"})

    scan.run_job("cpj_nosig_new")

    assert fetched == ["AAA"]
    row = store.get_job("cpj_nosig_new")
    assert row["params"]["scan_signature"].startswith(scan._detector_signature())
    assert row["params"].get("reused") is not True


def test_reused_fields_survive_restart_read(cp_store, monkeypatch):
    """Simulate a restart: drop in-memory state, read the job back from the DB."""
    _market_open(monkeypatch)
    _fresh_prev()
    monkeypatch.setattr(
        scan.candles, "fetch_for_timeframe",
        lambda symbol, tf, **kwargs: (_ for _ in ()).throw(AssertionError("no fetch")),
    )
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=lambda df, tf, s: []))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"]))
    store.save_job({"job_id": "cpj_restart", "universe": "nifty50", "timeframe": "1D", "status": "queued"})
    scan.run_job("cpj_restart")

    jobs.reset()  # drop all in-memory + mirror state like a restart
    dto = jobs.get_job("cpj_restart")
    assert dto["reused"] is True
    assert dto["reused_from"] == "cpj_reuse_prev"
    assert isinstance(dto["reused_age_sec"], int)
    assert dto["reused_finished_at"] is not None


# ---------------------------------------------------------------------------
# ISSUE 3: _scope_signature covers result-changing params.
# ---------------------------------------------------------------------------


def test_scope_signature_distinguishes_volume_and_replay():
    base = {"lookback_bars": 250}
    assert jobs._scope_signature({**base, "min_rel_volume": 1.5}) != jobs._scope_signature(base)
    assert jobs._scope_signature({**base, "min_volume_m": 2.0}) != jobs._scope_signature(base)
    assert jobs._scope_signature({**base, "as_of_date": "2026-09-01"}) != jobs._scope_signature(base)
    assert jobs._scope_signature({**base, "from_date": "2026-08-01"}) != jobs._scope_signature(base)
    assert jobs._scope_signature({**base, "compute_trendlines": False}) != jobs._scope_signature(base)
    assert jobs._scope_signature({**base, "force": True}) != jobs._scope_signature(base)
    assert jobs._scope_signature(base) == jobs._scope_signature(dict(base))


def test_min_rel_volume_change_does_not_coalesce(cp_store):
    release = threading.Event()

    def runner(job_id):
        release.wait(5)

    jobs.configure(max_queue=4, max_workers=1, runner=runner)
    try:
        first = jobs.submit("nifty50", "1D", params={"min_rel_volume": 1.5})
        second = jobs.submit("nifty50", "1D", params={"min_rel_volume": 2.5})
        assert second["job_id"] != first["job_id"], (
            "scans differing only in min_rel_volume must not coalesce"
        )
        assert jobs.get_job(first["job_id"])["status"] == "cancelled"
        # Identical params still coalesce.
        assert jobs.submit("nifty50", "1D", params={"min_rel_volume": 2.5})["job_id"] == second["job_id"]
    finally:
        jobs.configure(max_queue=8, max_workers=3)
        release.set()


def test_asof_date_change_does_not_coalesce(cp_store):
    release = threading.Event()

    def runner(job_id):
        release.wait(5)

    jobs.configure(max_queue=4, max_workers=1, runner=runner)
    try:
        first = jobs.submit("nifty50", "1D", params={"as_of_date": "2026-09-01", "force": True})
        second = jobs.submit("nifty50", "1D", params={"as_of_date": "2026-09-02", "force": True})
        assert second["job_id"] != first["job_id"]
    finally:
        jobs.configure(max_queue=8, max_workers=3)
        release.set()


# ---------------------------------------------------------------------------
# ALSO: GET /api/chart-patterns/market-status contract.
# ---------------------------------------------------------------------------


def test_market_status_shape():
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        resp = client.get("/api/chart-patterns/market-status")
    assert resp.status_code == 200
    data = resp.json()
    assert set(data) == {"open", "holiday", "now_ist", "reason"}
    assert isinstance(data["open"], bool)
    assert isinstance(data["holiday"], bool)
    assert isinstance(data["now_ist"], str) and data["now_ist"]
    assert data["reason"] in (
        "market open", "trading holiday", "weekend", "outside trading hours",
        "clock unavailable",
    )
    # now_ist parses as ISO.
    assert datetime.fromisoformat(data["now_ist"]) is not None


def test_market_status_closed_on_weekend(monkeypatch):
    from trading.timezone import IST

    saturday = datetime(2026, 10, 3, 12, 0, tzinfo=IST)  # a Saturday
    import api.chart_patterns as capi_mod

    real_dt = capi_mod.datetime

    class _FrozenDateTime(real_dt):
        @classmethod
        def now(cls, tz=None):
            return saturday

    monkeypatch.setattr(capi_mod, "datetime", _FrozenDateTime)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        resp = client.get("/api/chart-patterns/market-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["open"] is False
    assert data["reason"] in ("weekend", "trading holiday")


def test_scan_request_accepts_partial_flag(cp_store, monkeypatch):
    """POST /scan threads include_partial_today into the submitted params."""
    captured = {}

    def fake_submit(universe, timeframe, requested_by=None, params=None):
        captured.update(params=params)
        return {"job_id": "cpj_pf", "universe": universe, "timeframe": timeframe,
                "status": "queued", "queue_position": 0}

    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    from api.auth import get_current_user

    class _FakeUser:
        id = 1

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    try:
        with TestClient(app) as client:
            resp = client.post(
                "/api/chart-patterns/scan",
                json={"universe": "nifty50", "timeframe": "1D", "include_partial_today": False},
            )
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 200
    assert captured["params"]["include_partial_today"] is False


def _wait_for(pred, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.02)
    return pred()
