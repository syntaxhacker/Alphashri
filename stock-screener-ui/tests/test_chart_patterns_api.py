"""API tests for /api/chart-patterns (in-memory DB, mocked V3 fetch)."""
import threading

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

import api.chart_patterns as cp_api
from api.auth import get_current_user
from api.chart_patterns import router
from chart_patterns import config, jobs, store
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
    assert data["default"] == "nifty50"
    assert isinstance(data["universes"], list) and data["universes"]
    assert all({"id", "label", "count"} <= set(u) for u in data["universes"])


def test_patterns_endpoint(cp_client):
    resp = cp_client.get("/api/chart-patterns/patterns")
    assert resp.status_code == 200
    data = resp.json()
    families = {f["id"] for f in data["families"]}
    assert {"reversal", "continuation", "curve_cup"} <= families
    patterns = {p["pattern_id"]: p for p in data["patterns"]}
    assert len(patterns) == 19
    assert patterns["falling_wedge"]["family"] == "reversal"
    assert patterns["falling_wedge"]["direction"] == "bullish"
    assert patterns["consolidation"]["family"] == "continuation"
    assert patterns["consolidation"]["direction"] == "neutral"


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


def test_summary_last_scan_at(cp_client):
    """`last_scan_at` reflects the latest *completed* job for the combo."""
    store.save_job({
        "job_id": "cpj_old", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 10, "finished_at": "2026-09-20T10:00:00",
    })
    store.save_hits("cpj_old", [_hit("AAA")])
    store.save_job({
        "job_id": "cpj_new", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 12, "finished_at": "2026-09-30T15:30:00",
    })
    store.save_hits("cpj_new", [_hit("BBB", name="B Co")])

    resp = cp_client.get(
        "/api/chart-patterns/summary",
        params={"universe": "nifty500", "timeframe": "1D"},
    )
    assert resp.status_code == 200
    assert resp.json()["last_scan_at"].startswith("2026-09-30T15:30:00")

    # A newer queued/running job must not count (no usable result set yet).
    store.save_job({
        "job_id": "cpj_running", "universe": "nifty500", "timeframe": "1D",
        "status": "running", "finished_at": "2026-10-01T09:15:00",
    })
    again = cp_client.get(
        "/api/chart-patterns/summary",
        params={"universe": "nifty500", "timeframe": "1D"},
    )
    assert again.json()["last_scan_at"].startswith("2026-09-30T15:30:00")

    # A different timeframe has no completed scan.
    other = cp_client.get(
        "/api/chart-patterns/summary",
        params={"universe": "nifty500", "timeframe": "15m"},
    )
    assert other.json()["last_scan_at"] is None

    # No universe/timeframe in the query → null.
    unscoped = cp_client.get("/api/chart-patterns/summary")
    assert unscoped.json()["last_scan_at"] is None


def test_summary_scanned_uses_latest_completed_job(cp_client):
    """`scanned` is the latest scan's symbol count, not the sum of all jobs."""
    store.save_job({
        "job_id": "cpj_s1", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 50, "finished_at": "2026-09-20T10:00:00",
    })
    store.save_hits("cpj_s1", [_hit("AAA")])
    store.save_job({
        "job_id": "cpj_s2", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 50, "finished_at": "2026-09-30T10:00:00",
    })
    store.save_hits("cpj_s2", [_hit("BBB")])

    resp = cp_client.get(
        "/api/chart-patterns/summary",
        params={"universe": "nifty500", "timeframe": "1D"},
    )
    assert resp.status_code == 200
    # Two 50-symbol scans → 50, not 100.
    assert resp.json()["scanned"] == 50

    # A newer running job must not change the reported count.
    store.save_job({
        "job_id": "cpj_s3", "universe": "nifty500", "timeframe": "1D",
        "status": "running", "total": 50, "finished_at": "2026-10-02T10:00:00",
    })
    again = cp_client.get(
        "/api/chart-patterns/summary",
        params={"universe": "nifty500", "timeframe": "1D"},
    )
    assert again.json()["scanned"] == 50


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


def test_results_sort_newest_and_default(cp_client):
    """`sort=newest` orders by freshness (bars_ago asc); default stays confidence."""
    store.save_job({
        "job_id": "cpj_sort", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    fresh_low = dict(_hit("FRESH"), bars_ago=1, confidence=10.0)
    old_high = dict(_hit("OLD"), bars_ago=50, confidence=99.0)
    mid = dict(_hit("MID"), bars_ago=5, confidence=50.0)
    store.save_hits("cpj_sort", [old_high, fresh_low, mid])

    # Default ordering is confidence desc.
    default = cp_client.get("/api/chart-patterns/results", params={"job_id": "cpj_sort"})
    assert default.status_code == 200
    assert [item["symbol"] for item in default.json()["items"]] == ["OLD", "MID", "FRESH"]

    # `sort=newest` surfaces the freshest formations first.
    newest = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_sort", "sort": "newest"},
    )
    assert newest.status_code == 200
    bars_ago = [item["bars_ago"] for item in newest.json()["items"]]
    assert bars_ago == sorted(bars_ago)
    assert [item["symbol"] for item in newest.json()["items"]] == ["FRESH", "MID", "OLD"]

    # `formed_within_bars` still filters regardless of sort.
    within = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_sort", "formed_within_bars": 1},
    )
    assert within.status_code == 200
    within_body = within.json()
    assert within_body["total"] == 1
    assert within_body["items"][0]["symbol"] == "FRESH"

    # /summary accepts (and ignores) the sort param.
    summary = cp_client.get(
        "/api/chart-patterns/summary",
        params={"job_id": "cpj_sort", "sort": "newest"},
    )
    assert summary.status_code == 200
    assert summary.json()["patterns"] == 3


def test_results_filter_single_pattern_id(cp_client):
    store.save_job({
        "job_id": "cpj_pat", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    channel = dict(_hit("AAA"), pattern_id="ascending_channel", pattern_name="Ascending Channel")
    consolidation = dict(_hit("BBB"), pattern_id="consolidation", pattern_name="Consolidation")
    store.save_hits("cpj_pat", [channel, consolidation])

    resp = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_pat", "pattern_id": "ascending_channel"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["pattern_id"] == "ascending_channel"
    assert body["items"][0]["symbol"] == "AAA"


def test_results_filter_multiple_pattern_ids(cp_client):
    store.save_job({
        "job_id": "cpj_pat2", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    channel = dict(_hit("AAA"), pattern_id="ascending_channel", pattern_name="Ascending Channel")
    consolidation = dict(_hit("BBB"), pattern_id="consolidation", pattern_name="Consolidation")
    wedge = dict(_hit("CCC"), pattern_id="falling_wedge", pattern_name="Falling Wedge")
    store.save_hits("cpj_pat2", [channel, consolidation, wedge])

    resp = cp_client.get(
        "/api/chart-patterns/results",
        params=[
            ("job_id", "cpj_pat2"),
            ("pattern_id", "ascending_channel"),
            ("pattern_id", "consolidation"),
        ],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    ids = {item["pattern_id"] for item in body["items"]}
    assert ids == {"ascending_channel", "consolidation"}

    summary = cp_client.get(
        "/api/chart-patterns/summary",
        params=[("job_id", "cpj_pat2"), ("pattern_id", "ascending_channel"), ("pattern_id", "consolidation")],
    )
    assert summary.status_code == 200
    assert summary.json()["patterns"] == 2


def test_summary_pattern_and_family_counts(cp_client):
    """Counts must cover the whole filtered set, not just one capped page."""
    store.save_job({
        "job_id": "cpj_counts", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    wedges = [dict(_hit(f"W{i:03d}"), pattern_id="falling_wedge", pattern_name="Falling Wedge")
              for i in range(250)]
    channels = [dict(_hit(f"C{i:03d}"), pattern_id="ascending_channel",
                     pattern_name="Ascending Channel", family="continuation")
                for i in range(40)]
    store.save_hits("cpj_counts", wedges + channels)

    # A single /results page is capped well below the total.
    page = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_counts", "limit": 200},
    )
    assert page.status_code == 200
    assert page.json()["total"] == 290
    assert len(page.json()["items"]) == 200

    summary = cp_client.get("/api/chart-patterns/summary", params={"job_id": "cpj_counts"})
    assert summary.status_code == 200
    s = summary.json()
    assert s["patterns"] == 290
    assert s["pattern_counts"] == {"falling_wedge": 250, "ascending_channel": 40}
    assert s["family_counts"] == {"reversal": 250, "continuation": 40}


def test_summary_counts_respect_filters(cp_client):
    """pattern_counts/family_counts use the same filters as the results query."""
    store.save_job({
        "job_id": "cpj_counts_f", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    store.save_hits("cpj_counts_f", [
        _hit("AAA"),
        _hit("BBB", name="B Co"),
        dict(_hit("CCC"), direction="bearish", status="forming", family="continuation"),
    ])

    bullish = cp_client.get(
        "/api/chart-patterns/summary",
        params={"job_id": "cpj_counts_f", "direction": "bullish"},
    )
    assert bullish.status_code == 200
    s = bullish.json()
    assert s["patterns"] == 2
    assert s["pattern_counts"] == {"falling_wedge": 2}
    assert s["family_counts"] == {"reversal": 2}


def test_results_filter_unknown_pattern_id(cp_client):
    store.save_job({
        "job_id": "cpj_pat3", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    store.save_hits("cpj_pat3", [_hit("AAA"), _hit("BBB", name="B Co")])

    resp = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_pat3", "pattern_id": "does_not_exist"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["items"] == []


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


def test_symbol_chart_overlays_include_pattern_dates(cp_client, monkeypatch):
    """Fullscreen overlays must carry start/end dates (dedupes the selection)."""
    store.save_hits("cpj_ovdates", [_hit("IRCON")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))

    chart = cp_client.get("/api/chart-patterns/symbol/IRCON/chart", params={"timeframe": "1D"})
    assert chart.status_code == 200
    overlays = chart.json()["overlays"]
    assert overlays, "expected at least one overlay"
    for ov in overlays:
        assert ov.get("start_date"), "overlay missing start_date"
        assert ov.get("end_date"), "overlay missing end_date"


def test_symbol_detail_dedupes_hits_across_universe_jobs(cp_client, monkeypatch):
    """A symbol in two scanned universes must not list each pattern twice."""
    store.save_job({
        "job_id": "cpj_u1", "universe": "nifty50", "timeframe": "1D",
        "status": "completed", "total": 50, "finished_at": "2026-09-30T10:00:00",
    })
    store.save_hits("cpj_u1", [_hit("IRCON")])
    store.save_job({
        "job_id": "cpj_u2", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 501, "finished_at": "2026-09-30T11:00:00",
    })
    store.save_hits("cpj_u2", [_hit("IRCON")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))

    detail = cp_client.get("/api/chart-patterns/symbol/IRCON", params={"timeframe": "1D"})
    assert detail.status_code == 200
    assert len(detail.json()["patterns"]) == 1, "pattern listed once across jobs"
    assert detail.json()["counts"]["confirmed"] == 1

    chart = cp_client.get("/api/chart-patterns/symbol/IRCON/chart", params={"timeframe": "1D"})
    assert chart.status_code == 200
    assert len(chart.json()["overlays"]) == 1, "overlay drawn once across jobs"


def test_results_filter_multiple_symbols(cp_client):
    store.save_job({
        "job_id": "cpj_syms", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    store.save_hits("cpj_syms", [
        _hit("AAA", name="Alpha Co"),
        _hit("BBB", name="Beta Co"),
        _hit("CCC", name="Gamma Co"),
    ])

    # Repeated ?symbol= returns only those (order-independent).
    repeated = cp_client.get(
        "/api/chart-patterns/results",
        params=[("job_id", "cpj_syms"), ("symbol", "AAA"), ("symbol", "CCC")],
    )
    assert repeated.status_code == 200
    body = repeated.json()
    assert body["total"] == 2
    assert {item["symbol"] for item in body["items"]} == {"AAA", "CCC"}

    # Single value still works (FastAPI coerces to a 1-element list).
    single = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_syms", "symbol": "BBB"},
    )
    assert single.status_code == 200
    single_body = single.json()
    assert single_body["total"] == 1
    assert single_body["items"][0]["symbol"] == "BBB"

    # Lowercase input is uppercased before matching.
    lower = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_syms", "symbol": "aaa"},
    )
    assert lower.status_code == 200
    assert lower.json()["total"] == 1

    # /summary honors the same multi-symbol filter.
    summary = cp_client.get(
        "/api/chart-patterns/summary",
        params=[("job_id", "cpj_syms"), ("symbol", "AAA"), ("symbol", "CCC")],
    )
    assert summary.status_code == 200
    assert summary.json()["patterns"] == 2


def test_results_filter_text_query(cp_client):
    store.save_job({
        "job_id": "cpj_q", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    store.save_hits("cpj_q", [
        _hit("IRCON", name="Ircon International"),
        _hit("TCS", name="Tata Consultancy Services"),
        _hit("WIPRO", name="Wipro Ltd"),
    ])

    # Match by symbol fragment, case-insensitive.
    by_symbol = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_q", "q": "ircon"},
    )
    assert by_symbol.status_code == 200
    body = by_symbol.json()
    assert body["total"] == 1
    assert body["items"][0]["symbol"] == "IRCON"

    # Match by name fragment, case-insensitive.
    by_name = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_q", "q": "CONSULTANCY"},
    )
    assert by_name.status_code == 200
    name_body = by_name.json()
    assert name_body["total"] == 1
    assert name_body["items"][0]["symbol"] == "TCS"

    # No match → empty.
    none = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_q", "q": "zzz-nope"},
    )
    assert none.status_code == 200
    none_body = none.json()
    assert none_body["total"] == 0
    assert none_body["items"] == []

    # /summary respects the text query.
    summary = cp_client.get(
        "/api/chart-patterns/summary",
        params={"job_id": "cpj_q", "q": "a"},
    )
    assert summary.status_code == 200
    # "Ircon International" (name has 'a') and "Tata Consultancy Services" both
    # contain 'a'; "Wipro Ltd" has none.
    assert summary.json()["patterns"] == 2


def test_scan_rejects_unknown_universe(cp_client, monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("submit must not be called for an invalid universe")

    monkeypatch.setattr(cp_api.jobs, "submit", _boom)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nope_universe", "timeframe": "1D"},
    )
    assert resp.status_code == 422
    assert "universe" in resp.json()["detail"].lower()


def test_scan_rejects_unknown_timeframe(cp_client, monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("submit must not be called for an invalid timeframe")

    monkeypatch.setattr(cp_api.jobs, "submit", _boom)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "9D"},
    )
    assert resp.status_code == 422
    assert "timeframe" in resp.json()["detail"].lower()


def test_scan_valid_combo_enqueues_with_normalized_ids(cp_client, monkeypatch):
    captured = {}

    def fake_submit(universe, timeframe, requested_by=None, params=None):
        captured.update(universe=universe, timeframe=timeframe)
        return {
            "job_id": "cpj_valid", "universe": universe, "timeframe": timeframe,
            "status": "queued", "queue_position": 0,
        }

    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D"},
    )
    assert resp.status_code == 200
    assert captured == {"universe": "nifty500", "timeframe": "1D"}


def test_scan_alias_all_maps_to_all_equity(cp_client, monkeypatch):
    captured = {}

    def fake_submit(universe, timeframe, requested_by=None, params=None):
        captured.update(universe=universe, timeframe=timeframe)
        return {
            "job_id": "cpj_alias", "universe": universe, "timeframe": timeframe,
            "status": "queued", "queue_position": 0,
        }

    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "all", "timeframe": "1D"},
    )
    assert resp.status_code == 200
    assert captured["universe"] == "all_equity"


def test_scan_with_symbols_enqueues_custom_scope(cp_client, monkeypatch):
    captured = {}

    def fake_submit(universe, timeframe, requested_by=None, params=None):
        captured.update(universe=universe, timeframe=timeframe, params=params)
        return {
            "job_id": "cpj_scope", "universe": universe, "timeframe": timeframe,
            "status": "queued", "queue_position": 0,
        }

    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "", "timeframe": "1D", "symbols": ["bse", " infy ", "BSE"]},
    )
    assert resp.status_code == 200
    assert captured["universe"] == "custom"
    assert captured["params"]["symbols"] == ["BSE", "INFY"]


def test_scan_with_symbols_ignores_unknown_universe(cp_client, monkeypatch):
    def fake_submit(universe, timeframe, requested_by=None, params=None):
        return {
            "job_id": "cpj_scope2", "universe": universe, "timeframe": timeframe,
            "status": "queued", "queue_position": 0,
        }

    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nope_universe", "timeframe": "1D", "symbols": ["BSE"]},
    )
    assert resp.status_code == 200


def test_scan_with_symbols_still_validates_timeframe(cp_client, monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("submit must not be called for an invalid timeframe")

    monkeypatch.setattr(cp_api.jobs, "submit", _boom)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "", "timeframe": "9D", "symbols": ["BSE"]},
    )
    assert resp.status_code == 422
    assert "timeframe" in resp.json()["detail"].lower()


def test_normalize_symbol_list_dedupes_uppercases_and_caps():
    assert cp_api._normalize_symbol_list([" a ", "A", "", None, "b"]) == ["A", "B"]
    assert cp_api._normalize_symbol_list(None) == []
    capped = cp_api._normalize_symbol_list([f"S{i}" for i in range(cp_api.MAX_CUSTOM_SYMBOLS + 50)])
    assert len(capped) == cp_api.MAX_CUSTOM_SYMBOLS


def test_fallback_universe_ids_match_registry():
    from chart_patterns import universes as u

    registry = {d["id"] for d in u.list_universes()}
    fallback = {x["id"] for x in cp_api._FALLBACK_UNIVERSES}
    assert "all" not in fallback
    assert fallback <= registry


def test_slice_keeps_pattern_head_when_window_exceeds_cap():
    # Pattern starts on the very first bar: under the old tail(max_bars)
    # truncation the window head — and with it the pattern start — was cut.
    df = _make_df(500)
    start = df.index[0].strftime("%Y-%m-%d")
    end = df.index[306].strftime("%Y-%m-%d")

    series = cp_api._slice_candles(df, start, end, max_bars=160)

    assert len(series) <= 160
    times = [bar["t"][:10] for bar in series]
    assert start in times
    assert end in times


def test_submit_coalesces_duplicate_same_combo(cp_client):
    release = threading.Event()

    def runner(job_id):
        release.wait(5)

    jobs.configure(max_queue=4, max_workers=1, runner=runner)
    try:
        first = jobs.submit("nifty50", "1D")
        assert jobs.get_job(first["job_id"])["status"] in ("queued", "running")

        second = jobs.submit("nifty50", "1D")
        assert second["job_id"] == first["job_id"]
        assert jobs.queue_size() == 1

        other_tf = jobs.submit("nifty50", "15m")
        assert other_tf["job_id"] != first["job_id"]
        other_uni = jobs.submit("nifty500", "1D")
        assert other_uni["job_id"] != first["job_id"]
        assert jobs.queue_size() == 3
    finally:
        release.set()


def test_submit_same_scope_coalesces_scope_change_supersedes(cp_client):
    """Same (universe, timeframe, scope) coalesces; a scope change cancels."""
    release = threading.Event()

    def runner(job_id):
        release.wait(5)

    jobs.configure(max_queue=4, max_workers=1, runner=runner)
    try:
        first = jobs.submit("nifty50", "1D", params={"lookback_bars": 250})
        same = jobs.submit("nifty50", "1D", params={"lookback_bars": 250})
        assert same["job_id"] == first["job_id"]

        changed = jobs.submit("nifty50", "1D", params={"lookback_bars": 500})
        assert changed["job_id"] != first["job_id"]
        assert jobs.get_job(first["job_id"])["status"] == "cancelled"

        scoped = jobs.submit("custom", "1D", params={"symbols": ["AAA"]})
        scoped_same = jobs.submit("custom", "1D", params={"symbols": ["AAA"]})
        assert scoped_same["job_id"] == scoped["job_id"]

        scoped_other = jobs.submit("custom", "1D", params={"symbols": ["BBB"]})
        assert scoped_other["job_id"] != scoped["job_id"]
        assert jobs.get_job(scoped["job_id"])["status"] == "cancelled"
    finally:
        jobs.configure(max_queue=8, max_workers=3)
        release.set()


# ---------------------------------------------------------------------------
# lookback_bars (opt-in): forwarded into job params; out-of-range → 422.
# ---------------------------------------------------------------------------


def test_scan_with_lookback_bars_enqueues_param(cp_client, monkeypatch):
    captured = {}

    def fake_submit(universe, timeframe, requested_by=None, params=None):
        captured.update(universe=universe, timeframe=timeframe, params=params)
        return {
            "job_id": "cpj_lb", "universe": universe, "timeframe": timeframe,
            "status": "queued", "queue_position": 0,
        }

    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D", "lookback_bars": 250},
    )
    assert resp.status_code == 200
    assert captured["params"]["lookback_bars"] == 250


def test_scan_with_lookback_bars_too_small_422(cp_client, monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("submit must not be called for an invalid lookback_bars")

    monkeypatch.setattr(cp_api.jobs, "submit", _boom)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D", "lookback_bars": 10},
    )
    assert resp.status_code == 422
    assert "lookback_bars" in resp.json()["detail"]


def test_scan_with_lookback_bars_too_large_422(cp_client, monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("submit must not be called for an invalid lookback_bars")

    monkeypatch.setattr(cp_api.jobs, "submit", _boom)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D", "lookback_bars": 99999},
    )
    assert resp.status_code == 422
    assert "lookback_bars" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# trend_lines attachment (standalone trendline detector).
# ---------------------------------------------------------------------------


def _fake_trendline(kind: str) -> dict:
    return {
        "kind": kind,
        "start_date": "2026-01-01T00:00:00+00:00",
        "start_price": 100.0,
        "end_date": "2026-03-01T00:00:00+00:00",
        "end_price": 110.0,
        "slope": 0.2,
        "touches": 3,
        "span_bars": 40,
        "violations": 0,
    }


def test_results_items_include_trend_lines(cp_client, monkeypatch):
    store.save_job({
        "job_id": "cpj_tl", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 10, "done": 10,
    })
    store.save_hits("cpj_tl", [_hit("AAA")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": _fake_trendline("support"), "resistance": None},
    )

    resp = cp_client.get("/api/chart-patterns/results", params={"job_id": "cpj_tl"})
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert isinstance(items[0]["trend_lines"], list)
    assert len(items[0]["trend_lines"]) == 1
    assert items[0]["trend_lines"][0]["kind"] == "support"


def test_results_trend_lines_error_falls_back_to_empty(cp_client, monkeypatch):
    store.save_job({
        "job_id": "cpj_tl_err", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 10, "done": 10,
    })
    store.save_hits("cpj_tl_err", [_hit("AAA")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))

    def _boom(df, lookback_bars=None):
        raise RuntimeError("detector exploded")

    monkeypatch.setattr(cp_api.trendlines_mod, "detect_trendlines", _boom)

    resp = cp_client.get("/api/chart-patterns/results", params={"job_id": "cpj_tl_err"})
    assert resp.status_code == 200
    assert resp.json()["items"][0]["trend_lines"] == []


def test_symbol_chart_includes_trend_lines(cp_client, monkeypatch):
    store.save_hits("cpj_tlsym", [_hit("IRCON")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": _fake_trendline("support"), "resistance": _fake_trendline("resistance")},
    )

    chart = cp_client.get("/api/chart-patterns/symbol/IRCON/chart", params={"timeframe": "1D"})
    assert chart.status_code == 200
    body = chart.json()
    assert isinstance(body["trend_lines"], list)
    assert len(body["trend_lines"]) == 2
    assert {t["kind"] for t in body["trend_lines"]} == {"support", "resistance"}


def test_enrich_keeps_stored_trend_lines_without_detector(monkeypatch):
    """Fresh stored lines (matching signature) must not trigger the detector."""
    stored = [_fake_trendline("support"), _fake_trendline("resistance")]
    item = dict(_hit("AAA"), trend_lines=stored, trend_lines_sig=config.trendline_signature())
    seen = {}

    def _fetch(symbol, timeframe, **kwargs):
        seen.update(kwargs)
        return _make_df(80)

    def _boom(df):
        raise AssertionError("detect_trendlines must not run for stored lines")

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)
    monkeypatch.setattr(cp_api.trendlines_mod, "detect_trendlines", _boom)

    out = cp_api._enrich_with_candles([item], "1D")

    assert out[0]["trend_lines"] == stored
    assert out[0]["candles"], "candle window is still attached"
    assert seen.get("lookback_bars") == 500


def test_enrich_fetches_bounded_lookback_and_recomputes_when_blank(monkeypatch):
    """Blank stored lines fall back to the detector on a 500-bar fetch."""
    seen = {}

    def _fetch(symbol, timeframe, **kwargs):
        seen.update(kwargs)
        return _make_df(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": _fake_trendline("support"), "resistance": None},
    )

    out = cp_api._enrich_with_candles([_hit("AAA")], "1D")

    assert seen.get("lookback_bars") == 500
    assert out[0]["trend_lines"] == [_fake_trendline("support")]


def test_enrich_recomputes_when_signature_stale(monkeypatch):
    """Stale stored lines (signature mismatch) are recomputed, not kept."""
    stored = [_fake_trendline("support")]
    item = dict(_hit("AAA"), trend_lines=stored, trend_lines_sig="stale-sig")
    calls = []

    def _boom(df, lookback_bars=None):
        calls.append(1)
        raise RuntimeError("detector exploded")

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    monkeypatch.setattr(cp_api.trendlines_mod, "detect_trendlines", _boom)

    out = cp_api._enrich_with_candles([item], "1D")

    assert calls, "stale signature must trigger a detector recompute"
    assert out[0]["trend_lines"] == []
    assert out[0]["candles"], "candle window is still attached"


def test_enrich_keeps_fresh_signature_without_detector(monkeypatch):
    """A matching signature keeps stored lines (detector NOT called)."""
    stored = [_fake_trendline("support"), _fake_trendline("resistance")]
    item = dict(_hit("AAA"), trend_lines=stored, trend_lines_sig=config.trendline_signature())

    def _boom(df, lookback_bars=None):
        raise AssertionError("detect_trendlines must not run for a fresh signature")

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    monkeypatch.setattr(cp_api.trendlines_mod, "detect_trendlines", _boom)

    out = cp_api._enrich_with_candles([item], "1D")

    assert out[0]["trend_lines"] == stored
    assert out[0]["candles"], "candle window is still attached"


def test_results_lookback_bars_spans_full_window(cp_client, monkeypatch):
    """`/results?lookback_bars=250` fetches 250 bars and returns all of them."""
    store.save_job({
        "job_id": "cpj_lbl", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 10, "done": 10,
    })
    store.save_hits("cpj_lbl", [_hit("AAA")])
    seen = {}

    def _fetch(symbol, timeframe, **kwargs):
        seen.update(kwargs)
        return _make_df(250)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": _fake_trendline("support"), "resistance": None},
    )

    resp = cp_client.get("/api/chart-patterns/results", params={"job_id": "cpj_lbl", "lookback_bars": 250})
    assert resp.status_code == 200
    assert seen.get("lookback_bars") == 250
    candles = resp.json()["items"][0]["candles"]
    assert len(candles) == 250, "card window spans the full Lookback, not the ~160 pattern slice"


# ---------------------------------------------------------------------------
# symbol chart lookback_bars (fullscreen chart shows the entire window).
# ---------------------------------------------------------------------------


def test_symbol_chart_with_lookback_bars_forwards_and_returns_all(cp_client, monkeypatch):
    """`lookback_bars=250` is forwarded to the fetch and nothing is truncated."""
    store.save_hits("cpj_chartlb", [_hit("IRCON")])
    seen = {}

    def _fetch(symbol, timeframe, **kwargs):
        seen.update({"symbol": symbol, "timeframe": timeframe, **kwargs})
        return _make_df(250)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "1D", "lookback_bars": 250},
    )
    assert chart.status_code == 200
    assert seen.get("lookback_bars") == 250
    assert len(chart.json()["candles"]) == 250


def test_symbol_chart_without_lookback_bars_uses_default(cp_client, monkeypatch):
    """Omitting `lookback_bars` keeps the previous 500-bar default fetch."""
    store.save_hits("cpj_chartlb_def", [_hit("IRCON")])
    seen = {}

    def _fetch(symbol, timeframe, **kwargs):
        seen.update(kwargs)
        return _make_df(120)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)

    chart = cp_client.get("/api/chart-patterns/symbol/IRCON/chart", params={"timeframe": "1D"})
    assert chart.status_code == 200
    assert seen.get("lookback_bars") == 500
    # Default limit (2000) exceeds the fetched window: all bars are returned.
    assert len(chart.json()["candles"]) == 120


# ---------------------------------------------------------------------------
# compute_trendlines flag: standalone trendline work can be skipped.
# ---------------------------------------------------------------------------


def test_results_compute_trendlines_false_skips_detector(cp_client, monkeypatch):
    store.save_job({
        "job_id": "cpj_tlskip", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 10, "done": 10,
    })
    store.save_hits("cpj_tlskip", [_hit("AAA")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))

    def _boom(df, lookback_bars=None):
        raise AssertionError("detect_trendlines must not run when compute_trendlines=false")

    monkeypatch.setattr(cp_api.trendlines_mod, "detect_trendlines", _boom)

    resp = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_tlskip", "compute_trendlines": "false"},
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["trend_lines"] == []
    # Candles + closes are still attached.
    assert items[0]["candles"], "candle window is still attached"
    assert items[0]["last_close"] is not None
    assert items[0]["day_change_pct"] is not None


def test_results_compute_trendlines_default_still_computes(cp_client, monkeypatch):
    store.save_job({
        "job_id": "cpj_tldef", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 10, "done": 10,
    })
    store.save_hits("cpj_tldef", [_hit("AAA")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": _fake_trendline("support"), "resistance": None},
    )

    resp = cp_client.get("/api/chart-patterns/results", params={"job_id": "cpj_tldef"})
    assert resp.status_code == 200
    assert resp.json()["items"][0]["trend_lines"] == [_fake_trendline("support")]


def test_symbol_chart_compute_trendlines_false_skips_detector(cp_client, monkeypatch):
    store.save_hits("cpj_tlskipchart", [_hit("IRCON")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))

    def _boom(df, lookback_bars=None):
        raise AssertionError("detect_trendlines must not run when compute_trendlines=false")

    monkeypatch.setattr(cp_api.trendlines_mod, "detect_trendlines", _boom)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "1D", "compute_trendlines": "false"},
    )
    assert chart.status_code == 200
    assert chart.json()["trend_lines"] == []


# ---------------------------------------------------------------------------
# Missing coverage: scan param passthrough, lookback boundaries, 422s.
# ---------------------------------------------------------------------------


def test_scan_forwards_compute_trendlines_false(cp_client, monkeypatch):
    captured = {}

    def fake_submit(universe, timeframe, requested_by=None, params=None):
        captured.update(params=params)
        return {
            "job_id": "cpj_tlflag", "universe": universe, "timeframe": timeframe,
            "status": "queued", "queue_position": 0,
        }

    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D", "compute_trendlines": False},
    )
    assert resp.status_code == 200
    assert captured["params"]["compute_trendlines"] is False


def test_scan_lookback_boundaries_accepted(cp_client, monkeypatch):
    captured = []

    def fake_submit(universe, timeframe, requested_by=None, params=None):
        captured.append(params.get("lookback_bars"))
        return {
            "job_id": "cpj_lb_edge", "universe": universe, "timeframe": timeframe,
            "status": "queued", "queue_position": 0,
        }

    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    for edge in (config.LOOKBACK_MIN, config.LOOKBACK_MAX):
        resp = cp_client.post(
            "/api/chart-patterns/scan",
            json={"universe": "nifty500", "timeframe": "1D", "lookback_bars": edge},
        )
        assert resp.status_code == 200
    assert captured == [config.LOOKBACK_MIN, config.LOOKBACK_MAX]


def test_scan_missing_timeframe_422(cp_client, monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("submit must not be called without a timeframe")

    monkeypatch.setattr(cp_api.jobs, "submit", _boom)
    resp = cp_client.post("/api/chart-patterns/scan", json={"universe": "nifty500"})
    assert resp.status_code == 422


def test_results_limit_over_max_422(cp_client):
    resp = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_any", "limit": config.RESULTS_MAX_LIMIT + 1},
    )
    assert resp.status_code == 422


def test_chart_limit_over_max_422(cp_client):
    resp = cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "1D", "limit": config.CHART_MAX_BARS + 1},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# refresh flag: clear candle cache before enqueueing a forced scan.
# ---------------------------------------------------------------------------


def test_scan_refresh_universe_scope_clears_timeframe_cache(cp_client, monkeypatch):
    clear_calls = []
    captured = {}

    def fake_clear_cache(*args, **kwargs):
        clear_calls.append((args, kwargs))
        return 3

    def fake_submit(universe, timeframe, requested_by=None, params=None):
        captured.update(universe=universe, params=params)
        return {
            "job_id": "cpj_refresh", "universe": universe, "timeframe": timeframe,
            "status": "queued", "queue_position": 0,
        }

    monkeypatch.setattr(cp_api.candles, "clear_cache", fake_clear_cache)
    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D", "refresh": True},
    )
    assert resp.status_code == 200
    assert len(clear_calls) == 1
    _, kwargs = clear_calls[0]
    assert kwargs == {"timeframe": "1D"}
    assert captured["params"]["force"] is True
    assert captured["params"]["refresh"] is True


def test_scan_refresh_custom_scope_clears_symbol_cache(cp_client, monkeypatch):
    clear_calls = []
    captured = {}

    def fake_clear_cache(*args, **kwargs):
        clear_calls.append((args, kwargs))
        return 2

    def fake_submit(universe, timeframe, requested_by=None, params=None):
        captured.update(universe=universe, params=params)
        return {
            "job_id": "cpj_refresh_custom", "universe": universe, "timeframe": timeframe,
            "status": "queued", "queue_position": 0,
        }

    monkeypatch.setattr(cp_api.candles, "clear_cache", fake_clear_cache)
    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "", "timeframe": "1D", "symbols": ["infy", "bse"], "refresh": True},
    )
    assert resp.status_code == 200
    assert len(clear_calls) == 1
    _, kwargs = clear_calls[0]
    assert kwargs == {"symbols": ["INFY", "BSE"], "timeframe": "1D"}
    assert captured["universe"] == "custom"
    assert captured["params"]["force"] is True
    assert captured["params"]["refresh"] is True


def test_scan_without_refresh_does_not_clear_cache(cp_client, monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("clear_cache must not be called when refresh is false")

    captured = {}

    def fake_submit(universe, timeframe, requested_by=None, params=None):
        captured.update(params=params)
        return {
            "job_id": "cpj_no_refresh", "universe": universe, "timeframe": timeframe,
            "status": "queued", "queue_position": 0,
        }

    monkeypatch.setattr(cp_api.candles, "clear_cache", _boom)
    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D"},
    )
    assert resp.status_code == 200
    assert captured["params"]["force"] is False
    assert "refresh" not in captured["params"]


# ---------------------------------------------------------------------------
# max_52w_gap filter: 52-week-high proximity backed by stock_52w_range.
# ---------------------------------------------------------------------------


def _seed_52w_ranges(engine, rows):
    """Seed ``stock_52w_range`` rows: ``[(symbol, high_52w, close), ...]``."""
    from sqlalchemy.orm import sessionmaker

    from db.models.stock_52w_touch import Stock52WeekRange

    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = factory()
    try:
        for symbol, high, close in rows:
            session.merge(Stock52WeekRange(
                symbol=symbol, high_52w=high, low_52w=close, close=close,
            ))
        session.commit()
    finally:
        session.close()


def test_results_max_52w_gap_filter(cp_client, test_db_engine):
    # NEAR gap = 2.0, FAR gap = 50.0.
    _seed_52w_ranges(test_db_engine, [("NEAR", 100.0, 98.0), ("FAR", 100.0, 50.0)])
    store.save_job({
        "job_id": "cpj_52w", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    store.save_hits("cpj_52w", [_hit("NEAR"), _hit("FAR")])

    resp = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_52w", "max_52w_gap": 3},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["symbol"] == "NEAR"
    assert body["items"][0]["to_52w_high"] == 2.0

    unfiltered = cp_client.get("/api/chart-patterns/results", params={"job_id": "cpj_52w"})
    assert unfiltered.status_code == 200
    assert unfiltered.json()["total"] == 2


def test_summary_max_52w_gap_filter(cp_client, test_db_engine):
    _seed_52w_ranges(test_db_engine, [("NEAR", 100.0, 98.0), ("FAR", 100.0, 50.0)])
    store.save_job({
        "job_id": "cpj_52ws", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    store.save_hits("cpj_52ws", [_hit("NEAR"), _hit("FAR")])

    summary = cp_client.get(
        "/api/chart-patterns/summary",
        params={"job_id": "cpj_52ws", "max_52w_gap": 3},
    )
    assert summary.status_code == 200
    assert summary.json()["patterns"] == 1

    unfiltered = cp_client.get("/api/chart-patterns/summary", params={"job_id": "cpj_52ws"})
    assert unfiltered.status_code == 200
    assert unfiltered.json()["patterns"] == 2


# ---------------------------------------------------------------------------
# min_range_pos filter + range_pos sort (consolidation base position).
# ---------------------------------------------------------------------------


def _hit_with_range_pos(symbol: str, range_pos) -> dict:
    return dict(_hit(symbol), range_pos=range_pos)


def test_results_min_range_pos_filter(cp_client):
    store.save_job({
        "job_id": "cpj_rp", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    store.save_hits("cpj_rp", [
        _hit_with_range_pos("HIGH", 90.0),
        _hit_with_range_pos("LOW", 40.0),
        _hit("NULLRP"),
    ])

    resp = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_rp", "min_range_pos": 80},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["symbol"] == "HIGH"

    unfiltered = cp_client.get("/api/chart-patterns/results", params={"job_id": "cpj_rp"})
    assert unfiltered.status_code == 200
    assert unfiltered.json()["total"] == 3


def test_summary_min_range_pos_filter(cp_client):
    store.save_job({
        "job_id": "cpj_rps", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    store.save_hits("cpj_rps", [
        _hit_with_range_pos("HIGH", 90.0),
        _hit_with_range_pos("LOW", 40.0),
        _hit("NULLRP"),
    ])

    summary = cp_client.get(
        "/api/chart-patterns/summary",
        params={"job_id": "cpj_rps", "min_range_pos": 80},
    )
    assert summary.status_code == 200
    assert summary.json()["patterns"] == 1

    unfiltered = cp_client.get("/api/chart-patterns/summary", params={"job_id": "cpj_rps"})
    assert unfiltered.status_code == 200
    assert unfiltered.json()["patterns"] == 3


def test_results_sort_range_pos(cp_client):
    """`sort=range_pos` orders by range_pos desc, NULLs last."""
    store.save_job({
        "job_id": "cpj_rpsort", "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    low = dict(_hit_with_range_pos("LOW", 40.0), confidence=99.0)
    high = dict(_hit_with_range_pos("HIGH", 90.0), confidence=10.0)
    null = dict(_hit("NULLRP"), confidence=95.0)
    store.save_hits("cpj_rpsort", [low, high, null])

    resp = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_rpsort", "sort": "range_pos"},
    )
    assert resp.status_code == 200
    assert [item["symbol"] for item in resp.json()["items"]] == ["HIGH", "LOW", "NULLRP"]


# ---------------------------------------------------------------------------
# lookback_bars clamping: chart + cards span exactly N bars when the frame
# fetched for detection headroom is longer.
# ---------------------------------------------------------------------------


def test_symbol_chart_lookback_bars_clamps_to_exactly_n(cp_client, monkeypatch):
    """Fetch returns 300 bars but `lookback_bars=200` shows exactly 200."""
    store.save_hits("cpj_chartclamp", [_hit("IRCON")])
    seen = {}

    def _fetch(symbol, timeframe, **kwargs):
        seen.update(kwargs)
        return _make_df(300)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "1D", "lookback_bars": 200},
    )
    assert chart.status_code == 200
    assert seen.get("lookback_bars") == 200
    assert len(chart.json()["candles"]) == 200


def test_results_cards_lookback_bars_clamps_to_exactly_n(cp_client, monkeypatch):
    """Card windows are clamped to exactly N bars when the frame is longer."""
    store.save_job({
        "job_id": "cpj_cardclamp", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 10, "done": 10,
    })
    store.save_hits("cpj_cardclamp", [_hit("AAA")])
    seen = {}

    def _fetch(symbol, timeframe, **kwargs):
        seen.update(kwargs)
        return _make_df(300)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": _fake_trendline("support"), "resistance": None},
    )

    resp = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_cardclamp", "lookback_bars": 200},
    )
    assert resp.status_code == 200
    assert seen.get("lookback_bars") == 200
    assert len(resp.json()["items"][0]["candles"]) == 200


# ---------------------------------------------------------------------------
# 1D chart partial-today bar: today's in-progress session bar is appended and
# the trailing series item is marked `is_partial` for distinct UI rendering.
# ---------------------------------------------------------------------------


def _partial_daily_base():
    idx = pd.DatetimeIndex([
        pd.Timestamp("2020-01-01", tz="UTC"),
        pd.Timestamp("2020-01-02", tz="UTC"),
        pd.Timestamp("2020-01-03", tz="UTC"),
    ])
    base = np.arange(len(idx), dtype=float) + 100.0
    return pd.DataFrame(
        {"open": base, "high": base + 1.0, "low": base - 1.0,
         "close": base, "volume": np.full(len(idx), 1000.0)},
        index=idx,
    )


def _partial_tape(day: str = "2020-06-01", n: int = 5):
    from types import SimpleNamespace

    idx = pd.date_range(f"{day} 09:15", periods=n, freq="min",
                        tz="Asia/Kolkata").tz_convert("UTC")
    base = np.arange(n, dtype=float) + 200.0
    tape = pd.DataFrame(
        {"open": base, "high": base + 0.5, "low": base - 0.5,
         "close": base, "volume": np.full(n, 500.0)},
        index=idx,
    )
    return SimpleNamespace(fetch_intraday_data_v3=lambda **kwargs: tape)


def test_symbol_chart_1d_forwards_partial_flag(cp_client, monkeypatch):
    """The chart passes `include_partial_today=True` for 1D only."""
    store.save_hits("cpj_pflag", [_hit("IRCON")])
    seen = {}

    def _fetch(symbol, timeframe, **kwargs):
        seen.update(symbol=symbol, timeframe=timeframe, **kwargs)
        return _make_df(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _fetch)

    chart = cp_client.get("/api/chart-patterns/symbol/IRCON/chart", params={"timeframe": "1D"})
    assert chart.status_code == 200
    assert seen.get("include_partial_today") is True

    chart15 = cp_client.get("/api/chart-patterns/symbol/IRCON/chart", params={"timeframe": "15m"})
    assert chart15.status_code == 200
    assert seen.get("include_partial_today") is False


def test_symbol_chart_1d_marks_synthetic_last_bar(cp_client, monkeypatch, tmp_path):
    """With a mocked 1-min tape the chart gains one `is_partial` bar."""
    store.save_hits("cpj_pmark", [_hit("IRCON")])
    base = _partial_daily_base()
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe",
        lambda symbol, timeframe, **kwargs: base,
    )
    monkeypatch.setattr(
        "market_data.market_data.get_api_client", lambda: _partial_tape()
    )
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": None, "resistance": None},
    )

    chart = cp_client.get("/api/chart-patterns/symbol/IRCON/chart", params={"timeframe": "1D"})
    assert chart.status_code == 200
    series = chart.json()["candles"]
    assert len(series) == len(base) + 1
    assert series[-1].get("is_partial") is True
    assert all("is_partial" not in bar for bar in series[:-1])


def test_symbol_chart_1d_empty_tape_has_no_partial_mark(cp_client, monkeypatch, tmp_path):
    """An empty tape (pre-market/holiday) leaves the chart frame unchanged."""
    from types import SimpleNamespace

    store.save_hits("cpj_pempty", [_hit("IRCON")])
    base = _partial_daily_base()
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe",
        lambda symbol, timeframe, **kwargs: base,
    )
    empty = _partial_tape().fetch_intraday_data_v3().iloc[0:0]
    monkeypatch.setattr(
        "market_data.market_data.get_api_client",
        lambda: SimpleNamespace(fetch_intraday_data_v3=lambda **kwargs: empty),
    )
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": None, "resistance": None},
    )

    chart = cp_client.get("/api/chart-patterns/symbol/IRCON/chart", params={"timeframe": "1D"})
    assert chart.status_code == 200
    series = chart.json()["candles"]
    assert len(series) == len(base)
    assert all("is_partial" not in bar for bar in series)

