"""API tests for /api/chart-patterns (in-memory DB, mocked V3 fetch)."""
import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

import api.chart_patterns as cp_api
from api.auth import get_current_user
from api.chart_patterns import router
from chart_patterns import jobs, store
from db.database import get_db


class _FakeUser:
    id = 1
    email = "qa@test.com"


def _make_df(n: int = 80) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=n, freq="D", tz="UTC")
    base = np.linspace(100.0, 130.0, n)
    return pd.DataFrame(
        {"open": base, "high": base + 1.0, "low": base - 1.0, "close": base, "volume": 1000.0},
        index=idx,
    )


def _hit(symbol: str, name: str = "Test Co") -> dict:
    return {
        "symbol": symbol,
        "name": name,
        "timeframe": "1D",
        "pattern_id": "falling_wedge",
        "pattern_name": "Falling Wedge",
        "family": "reversal",
        "direction": "bullish",
        "status": "confirmed",
        "quality": "strong",
        "confidence": 78.4,
        "start_date": "2026-04-26",
        "end_date": "2026-09-26",
        "start_price": 129.8,
        "end_price": 112.6,
        "breakout_level": 112.6,
        "target": 129.6,
        "stop": 102.5,
        "rr": 1.7,
        "bars_ago": 1,
        "volume_confirmed": True,
        "trendlines": [[{"t": "2026-04-26", "price": 129.8}, {"t": "2026-09-26", "price": 112.6}]],
        "notes": "synthetic",
    }


@pytest.fixture
def cp_client(test_db_engine):
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    store.set_session_factory(factory)
    jobs.reset()

    app = FastAPI()
    app.include_router(router)

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()

    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        jobs.reset()
        store.reset_session_factory()


def test_timeframes_endpoint(cp_client):
    resp = cp_client.get("/api/chart-patterns/timeframes")
    assert resp.status_code == 200
    data = resp.json()
    ids = [t["id"] for t in data["timeframes"]]
    assert "1D" in ids and "15m" in ids
    assert len(ids) == 13


def test_universes_endpoint(cp_client):
    resp = cp_client.get("/api/chart-patterns/universes")
    assert resp.status_code == 200
    data = resp.json()
    assert data["default"] == "nifty500"
    assert isinstance(data["universes"], list) and data["universes"]
    assert all({"id", "label", "count"} <= set(u) for u in data["universes"])


def test_patterns_endpoint(cp_client):
    resp = cp_client.get("/api/chart-patterns/patterns")
    assert resp.status_code == 200
    data = resp.json()
    families = {f["id"] for f in data["families"]}
    assert {"reversal", "continuation", "curve_cup"} <= families
    patterns = {p["pattern_id"]: p for p in data["patterns"]}
    assert len(patterns) == 18
    assert patterns["falling_wedge"]["family"] == "reversal"
    assert patterns["falling_wedge"]["direction"] == "bullish"


def test_scan_endpoint_enqueues(cp_client, monkeypatch):
    def fake_submit(universe, timeframe, requested_by=None, params=None):
        return {
            "job_id": "cpj_testsubmit", "universe": universe, "timeframe": timeframe,
            "status": "queued", "queue_position": 0,
        }

    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["job_id"] == "cpj_testsubmit"
    assert body["status"] == "queued"
    assert "queue_size" in body


def test_scan_endpoint_queue_full_429(cp_client, monkeypatch):
    def fake_submit(*args, **kwargs):
        raise jobs.QueueFullError("full")

    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    monkeypatch.setattr(cp_api.jobs, "PATTERN_SCAN_MAX_QUEUE", 1)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D"},
    )
    assert resp.status_code == 429
    body = resp.json()
    assert body["detail"]
    assert body["max_queue"] == 1
    assert "queue_size" in body


def test_jobs_endpoints(cp_client):
    store.save_job({
        "job_id": "cpj_api1", "universe": "nifty500", "timeframe": "1D",
        "status": "queued", "total": 10,
    })
    active = cp_client.get("/api/chart-patterns/jobs", params={"active": 1})
    assert active.status_code == 200
    ids = [j["job_id"] for j in active.json()["jobs"]]
    assert "cpj_api1" in ids

    single = cp_client.get("/api/chart-patterns/jobs/cpj_api1")
    assert single.status_code == 200
    assert single.json()["universe"] == "nifty500"

    missing = cp_client.get("/api/chart-patterns/jobs/cpj_missing")
    assert missing.status_code == 404


def test_results_and_summary(cp_client):
    store.save_job({
        "job_id": "cpj_res", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 500, "done": 500,
    })
    store.save_hits("cpj_res", [_hit("IRCON"), _hit("TCS", name="Tata Consultancy")])

    resp = cp_client.get("/api/chart-patterns/results", params={"job_id": "cpj_res"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert data["data_through"] == "2026-09-26"
    assert all(item["symbol"] in ("IRCON", "TCS") for item in data["items"])
    assert data["summary"]["confirmed"] == 2

    summary = cp_client.get("/api/chart-patterns/summary", params={"job_id": "cpj_res"})
    assert summary.status_code == 200
    s = summary.json()
    assert s["scanned"] == 500
    assert s["patterns"] == 2
    assert s["confirmed"] == 2
    assert s["bullish"] == 2


def test_results_filters(cp_client):
    store.save_job({
        "job_id": "cpj_flt", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    bullish = _hit("AAA")
    bearish = dict(_hit("BBB"), direction="bearish", status="forming", bars_ago=50, rr=0.4)
    store.save_hits("cpj_flt", [bullish, bearish])

    resp = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_flt", "direction": "bearish", "formed_within_bars": 60, "min_rr": 0.0},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["symbol"] == "BBB"


def test_symbol_detail_and_chart(cp_client, monkeypatch):
    store.save_hits("cpj_sym", [_hit("IRCON")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))

    detail = cp_client.get("/api/chart-patterns/symbol/IRCON", params={"timeframe": "1D"})
    assert detail.status_code == 200
    d = detail.json()
    assert d["symbol"] == "IRCON"
    assert d["history_bars"] == 80
    assert d["last_close"] is not None
    assert d["counts"]["confirmed"] == 1
    assert len(d["patterns"]) == 1

    chart = cp_client.get("/api/chart-patterns/symbol/IRCON/chart", params={"timeframe": "1D", "limit": 50})
    assert chart.status_code == 200
    c = chart.json()
    assert c["symbol"] == "IRCON"
    assert len(c["candles"]) == 50
    assert c["candles"][0]["t"] and "o" in c["candles"][0]
    assert c["overlays"] and c["overlays"][0]["pattern_id"] == "falling_wedge"
