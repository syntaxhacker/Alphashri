"""API tests for /api/chart-patterns (in-memory DB, mocked V3 fetch)."""
import asyncio
import gzip
import logging
import pickle
import threading
import time as _time

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from starlette.middleware.gzip import DEFAULT_EXCLUDED_CONTENT_TYPES, GZipMiddleware

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

    # Hermetic caches: the candles layer keeps a process-global negative
    # cache (90s TTL) for empty fetches — a real fetch earlier in the run
    # would otherwise short-circuit even monkeypatched inner fetches.
    clear_empty = getattr(cp_api.candles, "clear_empty_cache", None)
    if callable(clear_empty):
        clear_empty()
    cp_api._clear_chart_caches()

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
        cp_api._clear_read_caches()
        with TestClient(app) as client:
            yield client
    finally:
        cp_api._clear_read_caches()
        if callable(clear_empty):
            clear_empty()
        cp_api._clear_chart_caches()
        app.dependency_overrides.clear()
        jobs.reset()
        store.reset_session_factory()


def test_timeframes_endpoint(cp_client):
    resp = cp_client.get("/api/chart-patterns/timeframes")
    assert resp.status_code == 200
    data = resp.json()
    ids = [t["id"] for t in data["timeframes"]]
    assert "1D" in ids and "15m" in ids
    assert len(ids) == 11
    assert "3m" not in ids and "2h" not in ids


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


@pytest.fixture()
def no_stale_first(monkeypatch):
    """Disable the disk stale-first path for tests that exercise the network path."""
    monkeypatch.setattr(cp_api, "_stale_first_frame", lambda *a, **k: None)


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


def test_symbol_chart_without_lookback_bars_uses_default(cp_client, monkeypatch, no_stale_first):
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


def test_results_items_carry_tags(cp_client, monkeypatch):
    """Every /results item carries F&O / ETF tags computed from its symbol."""
    store.save_job({
        "job_id": "cpj_tags", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 3, "done": 3,
    })
    store.save_hits("cpj_tags", [_hit("NIFTYBEES"), _hit("RELIANCE"), _hit("AAA")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": None, "resistance": None},
    )
    resp = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_tags", "compute_trendlines": "false"},
    )
    assert resp.status_code == 200
    by_symbol = {item["symbol"]: item for item in resp.json()["items"]}
    assert set(by_symbol) == {"NIFTYBEES", "RELIANCE", "AAA"}
    assert by_symbol["NIFTYBEES"]["tags"] == ["ETF"]
    assert by_symbol["RELIANCE"]["tags"] == ["F&O"]
    assert by_symbol["AAA"]["tags"] == []


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


def test_symbol_chart_1d_forwards_partial_flag(cp_client, monkeypatch, no_stale_first):
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
    monkeypatch.setattr(cp_api.candles, "_today_is_session", lambda: True)
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
    # The synthetic-today bar is process-cached for 30s; drop any bar the
    # preceding test pinned for this symbol or the tape never gets consulted.
    cp_api.candles._PARTIAL_CACHE.clear()
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



# ---------------------------------------------------------------------------
# TV volume pre-filter params: /scan forwards min_rel_volume / min_volume_m.
# ---------------------------------------------------------------------------


def test_scan_forwards_volume_prefilter_params(cp_client, monkeypatch):
    captured = {}

    def fake_submit(universe, timeframe, requested_by=None, params=None):
        captured.update(params=params)
        return {
            "job_id": "cpj_tv", "universe": universe, "timeframe": timeframe,
            "status": "queued", "queue_position": 0,
        }

    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D",
              "min_rel_volume": 1.5, "min_volume_m": 2.0},
    )
    assert resp.status_code == 200
    assert captured["params"]["min_rel_volume"] == 1.5
    assert captured["params"]["min_volume_m"] == 2.0


def test_scan_without_volume_params_omits_them(cp_client, monkeypatch):
    captured = {}

    def fake_submit(universe, timeframe, requested_by=None, params=None):
        captured.update(params=params)
        return {
            "job_id": "cpj_tvnone", "universe": universe, "timeframe": timeframe,
            "status": "queued", "queue_position": 0,
        }

    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D"},
    )
    assert resp.status_code == 200
    assert "min_rel_volume" not in captured["params"]
    assert "min_volume_m" not in captured["params"]


# ---------------------------------------------------------------------------
# Live pattern detection: /symbol/{s}/chart?detect_patterns=1 adds `hits`.
# ---------------------------------------------------------------------------


def _live_hit(symbol: str = "IRCON"):
    from chart_patterns.detectors.common import PatternHit

    return PatternHit(
        pattern_id="double_bottom",
        pattern_name="Double Bottom",
        family="reversal",
        direction="bullish",
        status="confirmed",
        quality="strong",
        confidence=70.0,
        start_date="2026-01-01",
        end_date="2026-02-01",
        start_price=100.0,
        end_price=110.0,
        breakout_level=110.0,
        target=120.0,
        stop=95.0,
        rr=2.0,
        bars_ago=1,
        volume_confirmed=True,
        trendlines=[[{"t": "2026-01-01", "price": 100.0}, {"t": "2026-02-01", "price": 110.0}]],
        notes="live",
        pivots=[{"t": "2026-01-10", "price": 98.0, "kind": "low"}],
        symbol=symbol,
        timeframe="1D",
    )


def test_symbol_chart_detect_patterns_returns_hits(cp_client, monkeypatch, no_stale_first):
    from types import SimpleNamespace

    store.save_hits("cpj_live", [_hit("IRCON")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    seen = {}

    def fake_detect(df, timeframe, symbol):
        seen.update(timeframe=timeframe, symbol=symbol, bars=len(df))
        return [_live_hit(symbol)]

    monkeypatch.setattr(cp_api, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))

    chart = cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "1D", "detect_patterns": 1},
    )
    assert chart.status_code == 200
    body = chart.json()
    assert seen["symbol"] == "IRCON" and seen["timeframe"] == "1D"
    assert seen["bars"] == 80
    assert "hits" in body and len(body["hits"]) == 1
    live = body["hits"][0]
    for key in ("pattern_id", "trendlines", "pivots", "breakout_level", "target",
                "stop", "rr", "confidence", "status"):
        assert key in live, f"live hit missing {key}"
    assert live["pattern_id"] == "double_bottom"
    assert live["trendlines"][0][0]["price"] == 100.0
    assert live["pivots"] == [{"t": "2026-01-10", "price": 98.0, "kind": "low"}]
    # Overlays gain one entry built from the live hit (stored overlay + live).
    assert len(body["overlays"]) == 2
    assert body["overlays"][-1]["pattern_id"] == "double_bottom"
    assert body["overlays"][-1]["start_date"] == "2026-01-01"
    assert body["overlays"][-1]["end_date"] == "2026-02-01"
    # Candles and trend_lines are unchanged.
    assert len(body["candles"]) == 80
    assert isinstance(body["trend_lines"], list)


def test_symbol_chart_without_detect_patterns_keeps_old_shape(cp_client, monkeypatch, no_stale_first):
    from types import SimpleNamespace

    def _boom(df, timeframe, symbol):
        raise AssertionError("engine must not run when detect_patterns is absent")

    store.save_hits("cpj_livedef", [_hit("IRCON")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    monkeypatch.setattr(cp_api, "engine_mod", SimpleNamespace(detect_patterns=_boom))

    chart = cp_client.get("/api/chart-patterns/symbol/IRCON/chart", params={"timeframe": "1D"})
    assert chart.status_code == 200
    body = chart.json()
    assert "hits" not in body
    assert set(body) == {"symbol", "timeframe", "candles", "overlays", "trend_lines"}
    assert len(body["overlays"]) == 1


def test_symbol_chart_detect_patterns_engine_error_still_200(cp_client, monkeypatch, no_stale_first):
    from types import SimpleNamespace

    def _boom(df, timeframe, symbol):
        raise RuntimeError("detector exploded")

    store.save_hits("cpj_liveerr", [_hit("IRCON")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    monkeypatch.setattr(cp_api, "engine_mod", SimpleNamespace(detect_patterns=_boom))

    chart = cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "1D", "detect_patterns": "true"},
    )
    assert chart.status_code == 200
    body = chart.json()
    assert body["hits"] == []
    assert len(body["candles"]) == 80


# ---------------------------------------------------------------------------
# GET /hit/{hit_id}: fullscreen opens a single stored row (404 closes it).
# ---------------------------------------------------------------------------


def _seed_hit_row(job_id: str = "cpj_hit") -> int:
    store.save_job({
        "job_id": job_id, "universe": "nifty500", "timeframe": "1D", "status": "completed",
    })
    store.save_hits(job_id, [_hit("IRCON", name="Ircon International")])
    items, _, _ = store.query_results({"job_id": job_id})
    assert len(items) == 1
    return items[0]["id"]


def test_get_hit_returns_stored_row(cp_client, test_db_engine, monkeypatch):
    # ``get_hit`` imports SessionLocal directly instead of using ``get_db``, so
    # bind the module-level session factory to the in-memory test engine.
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    monkeypatch.setattr("db.database.SessionLocal", factory)
    hit_id = _seed_hit_row()

    resp = cp_client.get(f"/api/chart-patterns/hit/{hit_id}")
    assert resp.status_code == 200
    row = resp.json()

    assert row["id"] == hit_id
    assert row["job_id"] == "cpj_hit"
    assert row["symbol"] == "IRCON"
    assert row["name"] == "Ircon International"
    assert row["timeframe"] == "1D"
    assert row["pattern_id"] == "falling_wedge"
    assert row["pattern_name"] == "Falling Wedge"
    assert row["family"] == "reversal"
    assert row["direction"] == "bullish"
    assert row["status"] == "confirmed"
    assert row["quality"] == "strong"
    assert row["confidence"] == pytest.approx(78.4)
    assert row["start_date"] == "2026-04-26"
    assert row["end_date"] == "2026-09-26"
    assert row["start_price"] == pytest.approx(129.8)
    assert row["end_price"] == pytest.approx(112.6)
    assert row["breakout_level"] == pytest.approx(112.6)
    assert row["target"] == pytest.approx(129.6)
    assert row["stop"] == pytest.approx(102.5)
    assert row["rr"] == pytest.approx(1.7)
    assert row["bars_ago"] == 1
    assert row["volume_confirmed"] is True
    assert row["trendlines"] == _hit("IRCON")["trendlines"]
    assert row["notes"] == "synthetic"


def test_get_hit_unknown_id_404(cp_client, test_db_engine, monkeypatch):
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    monkeypatch.setattr("db.database.SessionLocal", factory)
    _seed_hit_row()

    resp = cp_client.get("/api/chart-patterns/hit/999999")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Pattern hit not found"


def test_get_hit_non_integer_id_422(cp_client):
    resp = cp_client.get("/api/chart-patterns/hit/not-an-id")
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert isinstance(detail, list) and detail
    assert any("hit_id" in err.get("loc", []) for err in detail)


# ---------------------------------------------------------------------------
# /results consolidation filters (base_days / range_pct) — store-level filters
# exist in test_chart_patterns_consolidation.py; this pins the endpoint contract.
# ---------------------------------------------------------------------------


def test_results_consolidation_filters(cp_client):
    store.save_job({
        "job_id": "cpj_cons_api", "universe": "nifty500", "timeframe": "1D",
        "status": "completed",
    })
    store.save_hits("cpj_cons_api", [
        dict(_hit("LONG_TIGHT"), base_days=180, range_pct=6.0),
        dict(_hit("SHORT_TIGHT"), base_days=30, range_pct=5.0),
        dict(_hit("LONG_WIDE"), base_days=150, range_pct=18.0),
    ])

    base_only = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_cons_api", "min_base_days": 90},
    )
    assert base_only.status_code == 200
    assert {item["symbol"] for item in base_only.json()["items"]} == {"LONG_TIGHT", "LONG_WIDE"}

    range_only = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_cons_api", "max_range_pct": 10.0},
    )
    assert range_only.status_code == 200
    assert {item["symbol"] for item in range_only.json()["items"]} == {"LONG_TIGHT", "SHORT_TIGHT"}

    both = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_cons_api", "min_base_days": 90, "max_range_pct": 10.0},
    )
    assert both.status_code == 200
    body = both.json()
    assert body["total"] == 1
    assert body["items"][0]["symbol"] == "LONG_TIGHT"

    summary = cp_client.get(
        "/api/chart-patterns/summary",
        params={"job_id": "cpj_cons_api", "min_base_days": 90, "max_range_pct": 10.0},
    )
    assert summary.status_code == 200
    assert summary.json()["patterns"] == 1


def test_sanitize_for_json_exotic_leaves(cp_client):
    """np.generic, uuid.UUID, decimal.Decimal, set/frozenset, pd.NaT sanitize so
    ``json.dumps(..., allow_nan=False)`` succeeds (no 500 under JSONResponse)."""
    import decimal
    import json
    import uuid

    from api.utils import _sanitize_for_json

    uid = uuid.uuid4()
    payload = {
        "np_float32_nan": np.float32("nan"),
        "np_float64": np.float64(2.5),
        "np_int32": np.int32(7),
        "uuid": uid,
        "decimal": decimal.Decimal("1.5"),
        "decimal_nan": decimal.Decimal("NaN"),
        "set": {1, 2, 3},
        "frozenset": frozenset(["a", "b"]),
        "nat": pd.NaT,
        "nested": {"np_inf": np.float32(float("inf")), "s": {5}},
    }

    result = _sanitize_for_json(payload)

    assert result["np_float32_nan"] is None
    assert result["np_float64"] == 2.5
    assert result["np_int32"] == 7
    assert result["uuid"] == str(uid)
    assert result["decimal"] == 1.5
    assert result["decimal_nan"] is None
    assert sorted(result["set"]) == [1, 2, 3]
    assert sorted(result["frozenset"]) == ["a", "b"]
    assert result["nat"] is None
    assert result["nested"]["np_inf"] is None
    assert sorted(result["nested"]["s"]) == [5]

    # Round-trips through strict JSON (allow_nan=False) without raising.
    json.dumps(result, allow_nan=False)


def test_sanitize_for_json_preserves_existing_behaviour(cp_client):
    """NaN/Inf floats -> None, datetime -> ISO, tuples/lists -> lists, keys stringified."""
    import json
    from datetime import datetime

    from api.utils import _sanitize_for_json

    payload = {
        "nan": float("nan"),
        "inf": float("inf"),
        "dt": datetime(2026, 1, 2, 3, 4, 5),
        "tup": (1, 2),
        1: "int-key",  # non-string key
        "nested": [{"a": float("-inf")}],
    }

    result = _sanitize_for_json(payload)

    assert result["nan"] is None
    assert result["inf"] is None
    assert result["dt"] == "2026-01-02T03:04:05"
    assert result["tup"] == [1, 2]
    assert result["1"] == "int-key"
    assert result["nested"] == [{"a": None}]

    json.dumps(result, allow_nan=False)


# ---------------------------------------------------------------------------
# GZip wire bytes (patterns read path)
# ---------------------------------------------------------------------------


@pytest.fixture
def gz_app(test_db_engine):
    """Router app with production gzip wiring, driven at ASGI level.

    TestClient transparently decodes gzip, so it cannot observe wire bytes;
    driving the ASGI app directly can (``http.response.body`` bytes).
    """
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    store.set_session_factory(factory)
    jobs.reset()

    app = FastAPI()
    app.include_router(router)
    app.add_middleware(
        GZipMiddleware,
        minimum_size=1024,
        compresslevel=5,
        exclude_content_types=DEFAULT_EXCLUDED_CONTENT_TYPES,
    )

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()

    try:
        cp_api._clear_read_caches()
        yield app
    finally:
        cp_api._clear_read_caches()
        app.dependency_overrides.clear()
        jobs.reset()
        store.reset_session_factory()


async def _raw_asgi_get(app, path, accept_encoding):
    """Drive the ASGI app; return (status, headers, raw wire body)."""
    sent = []
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path.split("?")[0],
        "raw_path": path.split("?")[0].encode(),
        "query_string": (path.split("?", 1)[1].encode() if "?" in path else b""),
        "root_path": "",
        "headers": [(b"accept-encoding", accept_encoding.encode()),
                    (b"host", b"testserver")],
        "state": {},
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }

    async def receive():
        return {"type": "http.request", "body": b""}

    async def send(message):
        sent.append(message)

    await app(scope, receive, send)
    start = next(m for m in sent if m["type"] == "http.response.start")
    body = b"".join(
        m.get("body", b"") for m in sent if m["type"] == "http.response.body"
    )
    return start["status"], dict(start["headers"]), body


@pytest.fixture
def gz_client(test_db_engine):
    """Router app with the production gzip wiring (minimum_size=1024).

    Mirrors ``api_server_fastapi``'s registration so the wire contracts
    (header on large JSON, identical parsed body, tiny stays uncompressed)
    are tested rather than assumed.
    """
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    store.set_session_factory(factory)
    jobs.reset()

    app = FastAPI()
    app.include_router(router)
    app.add_middleware(
        GZipMiddleware,
        minimum_size=1024,
        compresslevel=5,
        exclude_content_types=DEFAULT_EXCLUDED_CONTENT_TYPES,
    )

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()

    try:
        cp_api._clear_read_caches()
        with TestClient(app) as client:
            yield client
    finally:
        cp_api._clear_read_caches()
        app.dependency_overrides.clear()
        jobs.reset()
        store.reset_session_factory()


def test_gzip_middleware_registered_on_production_app():
    """The full app registers GZipMiddleware with minimum_size=1024."""
    from api_server_fastapi import app

    by_cls = {getattr(m, "cls", type(m)): m.kwargs for m in app.user_middleware}
    assert GZipMiddleware in by_cls
    assert by_cls[GZipMiddleware]["minimum_size"] == 1024
    assert by_cls[GZipMiddleware]["compresslevel"] == 5
    assert "text/event-stream" in by_cls[GZipMiddleware]["exclude_content_types"]


def test_large_results_response_is_gzipped_with_identical_body(gz_client, monkeypatch):
    """A multi-MB ``/results`` body is gzipped; the parsed body is unchanged."""
    store.save_job({
        "job_id": "cpj_gz", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 10,
    })
    store.save_hits("cpj_gz", [_hit(f"GZ{i:03d}") for i in range(10)])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(500))
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": None, "resistance": None},
    )

    plain = gz_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_gz"},
        headers={"Accept-Encoding": "identity"},
    )
    assert plain.status_code == 200
    assert "content-encoding" not in plain.headers
    assert len(plain.content) > 1024

    gz = gz_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_gz"},
        headers={"Accept-Encoding": "gzip"},
    )
    assert gz.status_code == 200
    assert gz.headers.get("content-encoding") == "gzip"
    assert gz.json() == plain.json()
    assert len(gz.json()["items"]) == 10


def test_small_summary_response_is_not_gzipped(gz_client):
    """Bodies under ``minimum_size`` stay uncompressed (no Content-Encoding)."""
    store.save_job({
        "job_id": "cpj_gz_small", "universe": "nifty500", "timeframe": "1D",
        "status": "completed",
    })
    store.save_hits("cpj_gz_small", [_hit("AAA")])

    resp = gz_client.get(
        "/api/chart-patterns/summary",
        params={"job_id": "cpj_gz_small"},
        headers={"Accept-Encoding": "gzip"},
    )
    assert resp.status_code == 200
    assert "content-encoding" not in resp.headers


def test_results_auto_returns_whole_fetched_window(cp_client, monkeypatch):
    """Auto (no ``lookback_bars``) still shows the whole window — range unchanged."""
    store.save_job({
        "job_id": "cpj_auto", "universe": "nifty500", "timeframe": "1D",
        "status": "completed",
    })
    store.save_hits("cpj_auto", [_hit("AAA")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": None, "resistance": None},
    )

    resp = cp_client.get("/api/chart-patterns/results", params={"job_id": "cpj_auto"})
    assert resp.status_code == 200
    assert len(resp.json()["items"][0]["candles"]) == 80


def test_gzip_wire_bytes_decompress_to_identical_payload(gz_app, monkeypatch):
    """Raw ASGI wire bytes: gzipped is smaller and inflates to the identity body."""
    store.save_job({
        "job_id": "cpj_gz_wire", "universe": "nifty500", "timeframe": "1D",
        "status": "completed", "total": 10,
    })
    store.save_hits("cpj_gz_wire", [_hit(f"GZ{i:03d}") for i in range(10)])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(500))
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": None, "resistance": None},
    )
    path = "/api/chart-patterns/results?job_id=cpj_gz_wire"

    _, plain_headers, plain_body = asyncio.run(_raw_asgi_get(gz_app, path, "identity"))
    _, gz_headers, gz_body = asyncio.run(_raw_asgi_get(gz_app, path, "gzip"))

    assert b"content-encoding" not in plain_headers
    assert gz_headers[b"content-encoding"] == b"gzip"
    assert gz_body[:2] == b"\x1f\x8b", "expected gzip magic bytes on the wire"
    assert gzip.decompress(gz_body) == plain_body
    assert len(gz_body) < 0.5 * len(plain_body)


# ---------------------------------------------------------------------------
# Extracted helper parity (DRY refactor) — these guard the shared implementations
# that replaced duplicated inline blocks in the batch and SSE paths.
# ---------------------------------------------------------------------------


def test_json_response_sanitizes_and_serializes_strictly():
    import json

    resp = cp_api._json_response({"nan": float("nan"), "inf": float("inf"), "ok": 1})

    assert resp.status_code == 200
    body = json.loads(resp.body)
    assert body == {"nan": None, "inf": None, "ok": 1}
    assert resp.media_type == "application/json"


def test_last_close_change_edge_cases():
    assert cp_api._last_close_change(None) == (None, None)
    assert cp_api._last_close_change(pd.DataFrame()) == (None, None)

    single = _make_df(1)
    assert cp_api._last_close_change(single) == (100.0, 0.0)

    two = pd.DataFrame({"close": [100.0, 110.0]})
    assert cp_api._last_close_change(two) == (110.0, 10.0)

    prev_zero = pd.DataFrame({"close": [0.0, 5.0]})
    assert cp_api._last_close_change(prev_zero) == (5.0, 0.0)


def test_clamped_candle_series_matches_reference_across_limits():
    from chart_patterns import candles

    df = _make_df(20)
    for lookback, limit in [(None, None), (5, 3), (5, None), (None, 4), (50, 50), (0, 2)]:
        expected = candles.candles_to_series(
            cp_api._clamp_to_lookback(df, lookback), limit
        )
        assert cp_api._clamped_candle_series(df, lookback, limit) == expected, (
            lookback,
            limit,
        )

    assert cp_api._clamped_candle_series(None, 10, 10) == []
    assert cp_api._clamped_candle_series(pd.DataFrame(), 10, 10) == []


def test_item_fetch_key_and_distinct_keys():
    items = [
        {"symbol": "AAA", "timeframe": "1D"},
        {"symbol": "AAA", "timeframe": "1D"},
        {"symbol": "AAA"},                       # falls back to default
        {"symbol": "BBB", "timeframe": "1h"},
        {"symbol": None},                        # no symbol -> None
        {"timeframe": "1D"},                     # no symbol -> None
        "not-a-dict",
    ]
    assert cp_api._item_fetch_key(items[0], "1h") == ("AAA", "1D")
    assert cp_api._item_fetch_key(items[2], "1h") == ("AAA", "1h")
    assert cp_api._item_fetch_key(items[4], "1D") is None
    assert cp_api._item_fetch_key(items[6], "1D") is None

    assert cp_api._distinct_fetch_keys(items, "1h") == [
        ("AAA", "1D"),
        ("AAA", "1h"),
        ("BBB", "1h"),
    ]
    # No default and no per-item timeframe -> nothing fetchable.
    assert cp_api._distinct_fetch_keys([{"symbol": "AAA"}], None) == []


def test_cache_setdefault_first_writer_wins_with_and_without_lock():
    cache = {}
    cp_api._cache_setdefault(cache, "k", 1)
    cp_api._cache_setdefault(cache, "k", 2)
    assert cache == {"k": 1}

    lock = threading.Lock()
    cache2 = {}
    cp_api._cache_setdefault(cache2, "k", "first", lock)
    cp_api._cache_setdefault(cache2, "k", "second", lock)
    assert cache2 == {"k": "first"}


def test_fetch_candles_retry_success_after_transient_failure(monkeypatch):
    from chart_patterns import candles

    calls = []

    def _flaky(symbol, timeframe, lookback_bars=None):
        calls.append((symbol, timeframe, lookback_bars))
        if len(calls) == 1:
            raise RuntimeError("429")
        return "df"

    monkeypatch.setattr(candles, "fetch_for_timeframe", _flaky)
    monkeypatch.setattr(cp_api._time, "sleep", lambda _s: None)

    assert cp_api._fetch_candles_retry("AAA", "1D", 100) == "df"
    assert calls == [("AAA", "1D", 100), ("AAA", "1D", 100)]


def test_fetch_candles_retry_returns_none_after_two_failures(monkeypatch, caplog):
    from chart_patterns import candles

    calls = []

    def _always_fail(symbol, timeframe, lookback_bars=None):
        calls.append(1)
        raise RuntimeError("down")

    monkeypatch.setattr(candles, "fetch_for_timeframe", _always_fail)
    monkeypatch.setattr(cp_api._time, "sleep", lambda _s: None)

    assert cp_api._fetch_candles_retry("AAA", "1D", 100) is None
    assert len(calls) == 2

    with caplog.at_level("WARNING"):
        assert cp_api._fetch_candles_retry("AAA", "1D", 100, log_failure=True) is None
    assert any("candle fetch failed" in rec.message for rec in caplog.records)


def test_iter_completed_results_yields_values():
    import queue
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=2) as pool:
        futs = [pool.submit(lambda v=v: v) for v in (1, 2, 3)]
        out = queue.Queue()
        got = list(cp_api._iter_completed_results(futs, threading.Event(), out))

    assert sorted(got) == [1, 2, 3]
    assert out.empty()


def test_iter_completed_results_enqueues_error_and_stops():
    import queue
    from concurrent.futures import ThreadPoolExecutor

    def _boom():
        raise ValueError("nope")

    with ThreadPoolExecutor(max_workers=2) as pool:
        futs = [pool.submit(_boom), pool.submit(lambda: 99)]
        out = queue.Queue()
        got = list(cp_api._iter_completed_results(futs, threading.Event(), out))

    assert got == []
    kind, msg = out.get_nowait()
    assert kind == "error"
    assert "nope" in msg


def test_iter_completed_results_honours_stop():
    import queue
    from concurrent.futures import ThreadPoolExecutor

    stop = threading.Event()
    stop.set()
    with ThreadPoolExecutor(max_workers=1) as pool:
        futs = [pool.submit(lambda: 1)]
        out = queue.Queue()
        got = list(cp_api._iter_completed_results(futs, stop, out))

    assert got == []
    assert out.empty()


def test_candle_fields_delegates_to_last_close_change(monkeypatch):
    df = pd.DataFrame({"close": [100.0, 110.0]})
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: df)

    fields = cp_api._candle_fields("AAA", "1D")

    assert fields == {"last_close": 110.0, "day_change_pct": 10.0, "history_bars": 2}


# ---------------------------------------------------------------------------
# Symbol chart fetch: hard timeout + negative cache for empty results.
# ---------------------------------------------------------------------------


def _hanging_fetch(symbol, timeframe, **kwargs):
    """Simulate a hung Upstox/TV feed that never returns."""
    import threading as _threading

    _threading.Event().wait(30)
    return None


def _seed_live_edge_disk_cache(symbol, timeframe, df, variant=None):
    """Write ``df`` to the default live-edge cache entry (CACHE_DIR must be pinned first)."""
    path = cp_api.candles._cache_path(timeframe, symbol, None, variant=variant)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(df, f)
    return path


def test_symbol_chart_fetch_timeout_returns_empty_200(cp_client, monkeypatch, tmp_path):
    """A hung upstream fetch is aborted at the timeout: HTTP 200 with
    ``{"candles":[]}`` plus a clear ``error``/``note``, never 500, and the
    wait is bounded well below the hung call's 30s."""
    store.save_hits("cpj_timeout", [_hit("POWERMECH")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _hanging_fetch)
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(cp_api, "_CHART_FETCH_TIMEOUT_SEC", 0.2)
    cp_api._chart_neg_cache.clear()

    started = _time.monotonic()
    chart = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart",
        params={"timeframe": "1D", "detect_patterns": 1},
    )
    elapsed = _time.monotonic() - started

    assert chart.status_code == 200
    body = chart.json()
    assert body["candles"] == []
    assert body["error"] == "fetch_timeout"
    assert "exceeded" in body["note"] and "0s" in body["note"]
    assert body["symbol"] == "POWERMECH" and body["timeframe"] == "1D"
    assert set(body) >= {"symbol", "timeframe", "candles", "overlays", "trend_lines", "error", "note"}
    # The timeout bound the wait: nowhere near the 30s hang.
    assert elapsed < 5, f"fetch was not bounded: {elapsed:.1f}s"


def test_symbol_chart_fetch_error_returns_empty_200(cp_client, monkeypatch, tmp_path):
    """A transient upstream failure (DNS, 429...) returns 200 + empty candles
    with error/note and is not negative-cached, so a recovered feed retries."""
    store.save_hits("cpj_err", [_hit("POWERMECH")])
    calls = []

    def _flaky(symbol, timeframe, **kwargs):
        calls.append(1)
        raise RuntimeError("Temporary failure in name resolution")

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _flaky)
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(cp_api, "_CHART_FETCH_TIMEOUT_SEC", 7.0)
    cp_api._chart_neg_cache.clear()

    first = cp_client.get("/api/chart-patterns/symbol/POWERMECH/chart", params={"timeframe": "1D"})
    assert first.status_code == 200
    assert first.json()["candles"] == []
    assert first.json()["error"] == "fetch_error"
    assert "name resolution" in first.json()["note"]
    # Transient errors are not cached: the next click retries the fetch.
    second = cp_client.get("/api/chart-patterns/symbol/POWERMECH/chart", params={"timeframe": "1D"})
    assert second.status_code == 200
    assert len(calls) == 2, "fetch must be retried for transient errors"


def test_symbol_chart_empty_result_negative_cache(cp_client, monkeypatch, tmp_path):
    """An empty fetch is cached per (symbol, timeframe, session): the repeat
    click is answered instantly without calling the upstream fetch again."""
    store.save_hits("cpj_neg", [_hit("POWERMECH")])
    calls = []

    def _empty(symbol, timeframe, **kwargs):
        calls.append((symbol, timeframe))
        return None

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _empty)
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    cp_api._chart_neg_cache.clear()

    first = cp_client.get("/api/chart-patterns/symbol/POWERMECH/chart", params={"timeframe": "1D"})
    assert first.status_code == 200
    assert first.json()["candles"] == []
    assert first.json()["error"] == "no_data"

    # Same symbol/timeframe/session → cache hit, upstream not re-called.
    second = cp_client.get("/api/chart-patterns/symbol/POWERMECH/chart", params={"timeframe": "1D"})
    assert second.status_code == 200
    assert second.json() == first.json()
    assert calls == [("POWERMECH", "1D")], "negative cache must skip the re-fetch"

    # A different symbol is not covered by this cache entry.
    third = cp_client.get("/api/chart-patterns/symbol/RELIANCE/chart", params={"timeframe": "1D"})
    assert third.status_code == 200
    assert calls == [("POWERMECH", "1D"), ("RELIANCE", "1D")]


def test_symbol_chart_negative_cache_keyed_by_session(cp_client, monkeypatch, tmp_path):
    """Negative-cache entries never outlive the IST session: a new session
    date re-fetches even within the TTL."""
    store.save_hits("cpj_neg_sess", [_hit("POWERMECH")])
    calls = []
    sessions = iter(["2026-01-01", "2026-01-01", "2026-01-02"])

    def _empty(symbol, timeframe, **kwargs):
        calls.append((symbol, timeframe))
        return None

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _empty)
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(cp_api, "_ist_session_date", lambda: next(sessions))
    cp_api._chart_neg_cache.clear()

    cp_client.get("/api/chart-patterns/symbol/POWERMECH/chart", params={"timeframe": "1D"})
    cp_client.get("/api/chart-patterns/symbol/POWERMECH/chart", params={"timeframe": "1D"})
    assert calls == [("POWERMECH", "1D")]
    cp_client.get("/api/chart-patterns/symbol/POWERMECH/chart", params={"timeframe": "1D"})
    assert calls == [("POWERMECH", "1D"), ("POWERMECH", "1D")], "new session re-fetches"


def test_symbol_chart_normal_path_unchanged(cp_client, monkeypatch, no_stale_first):
    """A symbol with data returns the usual payload with no error/note fields,
    and the upstream fetch is called exactly as before (no caching of hits)."""
    store.save_hits("cpj_normal", [_hit("RELIANCE")])
    calls = []

    def _df(symbol, timeframe, **kwargs):
        calls.append((symbol, timeframe))
        return _make_df(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _df)
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df, lookback_bars=None: {"support": None, "resistance": None},
    )
    cp_api._chart_neg_cache.clear()

    chart = cp_client.get("/api/chart-patterns/symbol/RELIANCE/chart", params={"timeframe": "1D", "limit": 50})
    assert chart.status_code == 200
    body = chart.json()
    assert body["symbol"] == "RELIANCE"
    assert len(body["candles"]) == 50
    assert body["candles"][0]["t"] and "o" in body["candles"][0]
    assert "error" not in body and "note" not in body
    assert set(body) == {"symbol", "timeframe", "candles", "overlays", "trend_lines"}
    # Every click re-fetches (successful results are not negative-cached).
    again = cp_client.get("/api/chart-patterns/symbol/RELIANCE/chart", params={"timeframe": "1D", "limit": 50})
    assert again.status_code == 200
    assert calls == [("RELIANCE", "1D"), ("RELIANCE", "1D")]


# ---------------------------------------------------------------------------
# Symbol chart fetch: stale disk-cache fallback on upstream failure.
#
# When the upstream fetch times out / errors / returns nothing, the endpoint
# serves the default live-edge disk cache entry (a completed-session frame)
# marked cached/stale with as_of pinned to the frame's last session — never
# as current data, and only for the live-edge file the fetch itself uses.
# ---------------------------------------------------------------------------


def _disk_cache_variant() -> str:
    return f"lb{config.READ_LOOKBACK_BARS}"


def test_symbol_chart_fetch_timeout_stale_fallback_returns_cached_frame(
    cp_client, monkeypatch, tmp_path, caplog,
):
    """Timeout + a live-edge disk frame → 200 with the cached candles marked
    stale/cached and as_of = the frame's last session; never passed off as
    current, and the wait stays bounded by the timeout."""
    store.save_hits("cpj_stale_to", [_hit("POWERMECH")])
    df = _make_df(80)
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    _seed_live_edge_disk_cache("POWERMECH", "1D", df, variant=_disk_cache_variant())
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _hanging_fetch)
    monkeypatch.setattr(cp_api, "_CHART_FETCH_TIMEOUT_SEC", 0.2)
    cp_api._chart_neg_cache.clear()
    expected_as_of = cp_api.candles.frame_last_date(df)

    with caplog.at_level(logging.INFO, logger="api.chart_patterns"):
        started = _time.monotonic()
        chart = cp_client.get(
            "/api/chart-patterns/symbol/POWERMECH/chart",
            params={"timeframe": "1D", "detect_patterns": 1},
        )
        elapsed = _time.monotonic() - started

    assert chart.status_code == 200
    body = chart.json()
    assert body["symbol"] == "POWERMECH" and body["timeframe"] == "1D"
    assert body["cached"] is True and body["stale"] is True
    assert body["as_of"] == expected_as_of
    assert "served last cached frame" in body["note"]
    assert "timed out" in body["note"]
    assert "error" not in body
    assert len(body["candles"]) == 80
    assert body["candles"][-1]["c"] == pytest.approx(float(df["close"].iloc[-1]))
    assert body["overlays"] == [] and body["trend_lines"] == []
    assert elapsed < 5, f"fetch was not bounded: {elapsed:.1f}s"
    joined = [rec.getMessage() for rec in caplog.records]
    assert any("chart_fetch" in m and "stale_fallback=true" in m for m in joined), joined
    # A stale serve is a data serve, not an empty result: must not neg-cache.
    assert cp_api._chart_neg_cache == {}


def test_symbol_chart_fetch_timeout_no_cache_stays_empty(cp_client, monkeypatch, tmp_path, caplog):
    """Timeout + no disk frame → the current ``error:"fetch_timeout"`` empty
    response, logged with stale_fallback=false."""
    store.save_hits("cpj_stale_miss", [_hit("POWERMECH")])
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)  # empty: no cache
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _hanging_fetch)
    monkeypatch.setattr(cp_api, "_CHART_FETCH_TIMEOUT_SEC", 0.2)
    cp_api._chart_neg_cache.clear()

    with caplog.at_level(logging.INFO, logger="api.chart_patterns"):
        chart = cp_client.get(
            "/api/chart-patterns/symbol/POWERMECH/chart",
            params={"timeframe": "1D"},
        )

    assert chart.status_code == 200
    body = chart.json()
    assert body["candles"] == []
    assert body["error"] == "fetch_timeout"
    assert "stale" not in body and "cached" not in body
    joined = [rec.getMessage() for rec in caplog.records]
    assert any("chart_fetch" in m and "stale_fallback=false" in m for m in joined), joined


def test_symbol_chart_fetch_error_stale_fallback_returns_cached_frame(
    cp_client, monkeypatch, tmp_path,
):
    """A transient upstream exception also falls back to the cached frame, and
    — like the empty response — is not negative-cached, so the next click
    retries upstream (and serves stale again while it fails)."""
    store.save_hits("cpj_stale_err", [_hit("POWERMECH")])
    df = _make_df(60)
    calls = []

    def _boom(symbol, timeframe, **kwargs):
        calls.append(1)
        raise RuntimeError("Temporary failure in name resolution")

    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    _seed_live_edge_disk_cache("POWERMECH", "1D", df, variant=_disk_cache_variant())
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _boom)
    cp_api._chart_neg_cache.clear()

    for _ in range(2):
        resp = cp_client.get("/api/chart-patterns/symbol/POWERMECH/chart", params={"timeframe": "1D"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["stale"] is True and body["cached"] is True
        assert body["as_of"] == cp_api.candles.frame_last_date(df)
        assert "served last cached frame" in body["note"]
        assert len(body["candles"]) == 60
    assert len(calls) == 2, "stale fallback must not suppress the retry"


def test_symbol_chart_empty_result_stale_fallback_returns_cached_frame(
    cp_client, monkeypatch, tmp_path,
):
    """An empty upstream frame falls back to the cached frame and is not
    negative-cached (the neg cache is for genuinely empty answers)."""
    store.save_hits("cpj_stale_nd", [_hit("POWERMECH")])
    df = _make_df(50)
    calls = []

    def _empty(symbol, timeframe, **kwargs):
        calls.append((symbol, timeframe))
        return None

    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    _seed_live_edge_disk_cache("POWERMECH", "1D", df, variant=_disk_cache_variant())
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _empty)
    cp_api._chart_neg_cache.clear()

    for _ in range(2):
        resp = cp_client.get("/api/chart-patterns/symbol/POWERMECH/chart", params={"timeframe": "1D"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["stale"] is True
        assert len(body["candles"]) == 50
    assert calls == [("POWERMECH", "1D"), ("POWERMECH", "1D")]
    assert cp_api._chart_neg_cache == {}


def test_symbol_chart_stale_fallback_ignores_historical_namespace(
    cp_client, monkeypatch, tmp_path,
):
    """A frame cached only under an as-of/historical namespace is a different
    session window — it must never be served for the live-edge request, even
    on upstream timeout (no cross-session fallback)."""
    store.save_hits("cpj_stale_xs", [_hit("POWERMECH")])
    df = _make_df(70)
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    historical = cp_api.candles._cache_path(
        "1D", "POWERMECH", "2026-01-14", variant=_disk_cache_variant(),
    )
    historical.parent.mkdir(parents=True, exist_ok=True)
    with open(historical, "wb") as f:
        pickle.dump(df, f)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _hanging_fetch)
    monkeypatch.setattr(cp_api, "_CHART_FETCH_TIMEOUT_SEC", 0.2)
    cp_api._chart_neg_cache.clear()

    chart = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart",
        params={"timeframe": "1D"},
    )

    assert chart.status_code == 200
    body = chart.json()
    assert body["candles"] == []
    assert body["error"] == "fetch_timeout"
    assert "stale" not in body and "cached" not in body


# ---------------------------------------------------------------------------
# Symbol chart fetch: stale-first serving + pattern-hit cache.
#
# Live requests check the default live-edge disk cache before the network and
# serve a session-current frame marked cached/stale (with as_of) while a
# background refresh rewrites the cache. Pattern detections/trend lines are
# cached per (symbol, timeframe, IST session) for ~5 minutes.
# ---------------------------------------------------------------------------


def _make_df_session_current(n: int = 80, end: str = "2026-11-09") -> pd.DataFrame:
    idx = pd.date_range(end=pd.Timestamp(end, tz="UTC"), periods=n, freq="D")
    base = np.linspace(100.0, 130.0, n)
    return pd.DataFrame(
        {"open": base, "high": base + 1.0, "low": base - 1.0, "close": base, "volume": 1000.0},
        index=idx,
    )


def _kick_spy(monkeypatch) -> list:
    calls: list = []
    monkeypatch.setattr(
        cp_api, "_kick_stale_first_refresh",
        lambda symbol, timeframe, lb: calls.append((symbol, timeframe, lb)) or True,
    )
    return calls


def _pin_last_completed_session(monkeypatch, day: str = "2026-11-09"):
    from datetime import date as _date

    year, month, dom = (int(p) for p in day.split("-"))
    monkeypatch.setattr(
        cp_api.candles, "_last_completed_session", lambda now=None: _date(year, month, dom)
    )


def test_symbol_chart_stale_first_serves_cached_frame_immediately(
    cp_client, monkeypatch, tmp_path,
):
    """Session-current disk frame → instant 200, no network call, cached/stale
    flags with as_of, a background refresh is kicked, and the pattern engine is
    consulted only once (hits cached for the rest of the session TTL)."""
    from types import SimpleNamespace

    store.save_hits("cpj_sf_hit", [_hit("POWERMECH")])
    df = _make_df_session_current(80)
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    _seed_live_edge_disk_cache("POWERMECH", "1D", df, variant=_disk_cache_variant())
    _pin_last_completed_session(monkeypatch, "2026-11-09")
    fetch_calls: list = []

    def _recorder(symbol, timeframe, **kwargs):
        fetch_calls.append((symbol, timeframe))
        return _make_df_session_current(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _recorder)
    kicks = _kick_spy(monkeypatch)
    engine_calls: list = []

    def fake_detect(df_, timeframe, symbol):
        engine_calls.append(1)
        return [_live_hit(symbol)]

    monkeypatch.setattr(cp_api, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))

    started = _time.monotonic()
    chart = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart",
        params={"timeframe": "1D", "detect_patterns": 1},
    )
    elapsed = _time.monotonic() - started

    assert chart.status_code == 200
    body = chart.json()
    assert body["cached"] is True and body["stale"] is True
    assert body["as_of"] == "2026-11-09"
    assert "served cached frame" in body["note"] and "background" in body["note"]
    assert "error" not in body
    assert len(body["candles"]) == 80
    assert fetch_calls == [], "stale-first must not touch the network"
    assert kicks == [("POWERMECH", "1D", config.READ_LOOKBACK_BARS)]
    assert body["hits"] and body["hits"][0]["pattern_id"] == "double_bottom"
    assert len(engine_calls) == 1
    assert elapsed < 2.0, f"stale-first was not instant: {elapsed:.1f}s"

    again = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart",
        params={"timeframe": "1D", "detect_patterns": 1},
    )
    assert again.status_code == 200
    assert again.json()["hits"] == body["hits"]
    assert len(engine_calls) == 1, "second call must be served from the pattern-hit cache"
    assert fetch_calls == []
    assert len(kicks) == 2


def test_symbol_chart_stale_first_miss_uses_network_path(cp_client, monkeypatch, tmp_path):
    """No disk frame (or a frame from an older session) → the normal network
    path runs unchanged: no cached/stale fields, fetch called, no refresh kick."""
    store.save_hits("cpj_sf_miss", [_hit("POWERMECH")])
    df = _make_df(80)  # 2026-01 window: not session-current
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    _seed_live_edge_disk_cache("POWERMECH", "1D", df, variant=_disk_cache_variant())
    _pin_last_completed_session(monkeypatch, "2026-11-09")
    fetch_calls: list = []

    def _recorder(symbol, timeframe, **kwargs):
        fetch_calls.append((symbol, timeframe))
        return _make_df_session_current(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _recorder)
    kicks = _kick_spy(monkeypatch)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart",
        params={"timeframe": "1D"},
    )
    assert chart.status_code == 200
    body = chart.json()
    assert "cached" not in body and "stale" not in body
    assert "as_of" not in body
    assert fetch_calls == [("POWERMECH", "1D")]
    assert kicks == []


def test_symbol_chart_replay_as_of_skips_stale_first(cp_client, monkeypatch, tmp_path):
    """Replay/as-of requests never take the stale-first path, even when a
    session-current disk frame exists."""
    store.save_hits("cpj_sf_replay", [_hit("POWERMECH")])
    df = _make_df_session_current(80)
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    _seed_live_edge_disk_cache("POWERMECH", "1D", df, variant=_disk_cache_variant())
    _pin_last_completed_session(monkeypatch, "2026-11-09")
    fetch_calls: list = []

    def _recorder(symbol, timeframe, **kwargs):
        fetch_calls.append(kwargs)
        return _make_df_session_current(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _recorder)
    kicks = _kick_spy(monkeypatch)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart",
        params={"timeframe": "1D", "as_of_date": "2026-11-05"},
    )
    assert chart.status_code == 200
    body = chart.json()
    assert "cached" not in body and "stale" not in body
    assert kicks == [], "replay must not kick a background refresh"
    assert fetch_calls and fetch_calls[0].get("as_of_date") == "2026-11-05"


def test_symbol_chart_stale_first_intraday_requires_today(cp_client, monkeypatch, tmp_path):
    """An intraday frame whose last bar is not today (IST) is not served
    stale-first; a frame ending today is."""
    store.save_hits("cpj_sf_5m", [_hit("POWERMECH")])
    monkeypatch.setattr(cp_api, "_ist_session_date", lambda: "2026-11-09")
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    yesterday = _make_df_session_current(80, end="2026-11-08")
    _seed_live_edge_disk_cache("POWERMECH", "5m", yesterday, variant=_disk_cache_variant())
    fetch_calls: list = []

    def _recorder(symbol, timeframe, **kwargs):
        fetch_calls.append((symbol, timeframe))
        return _make_df_session_current(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _recorder)
    kicks = _kick_spy(monkeypatch)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart",
        params={"timeframe": "5m"},
    )
    assert chart.status_code == 200
    body = chart.json()
    assert "cached" not in body and "stale" not in body
    assert fetch_calls == [("POWERMECH", "5m")]
    assert kicks == []


def test_symbol_chart_stale_first_intraday_today_frame_served(cp_client, monkeypatch, tmp_path):
    store.save_hits("cpj_sf_5m_hit", [_hit("POWERMECH")])
    monkeypatch.setattr(cp_api, "_ist_session_date", lambda: "2026-11-09")
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    today = _make_df_session_current(80, end="2026-11-09")
    _seed_live_edge_disk_cache("POWERMECH", "5m", today, variant=_disk_cache_variant())
    fetch_calls: list = []

    def _recorder(symbol, timeframe, **kwargs):
        fetch_calls.append((symbol, timeframe))
        return _make_df_session_current(80, end="2026-11-09")

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _recorder)
    kicks = _kick_spy(monkeypatch)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart",
        params={"timeframe": "5m"},
    )
    assert chart.status_code == 200
    body = chart.json()
    assert body["cached"] is True and body["stale"] is True
    assert body["as_of"] == "2026-11-09"
    assert fetch_calls == []
    assert kicks == [("POWERMECH", "5m", config.READ_LOOKBACK_BARS)]


def test_symbol_chart_stale_first_uses_lookback_variant(cp_client, monkeypatch, tmp_path):
    """A frame cached under a lb250 variant serves only lookback_bars=250
    requests; the default lookback variant is a separate entry."""
    store.save_hits("cpj_sf_lb", [_hit("POWERMECH")])
    df = _make_df_session_current(80)
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    _seed_live_edge_disk_cache("POWERMECH", "1D", df, variant="lb250")
    _pin_last_completed_session(monkeypatch, "2026-11-09")
    fetch_calls: list = []

    def _recorder(symbol, timeframe, **kwargs):
        fetch_calls.append((symbol, timeframe))
        return _make_df_session_current(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _recorder)
    kicks = _kick_spy(monkeypatch)

    hit = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart",
        params={"timeframe": "1D", "lookback_bars": 250},
    )
    assert hit.status_code == 200
    assert hit.json()["cached"] is True and hit.json()["stale"] is True
    assert fetch_calls == []
    miss = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart",
        params={"timeframe": "1D"},
    )
    assert miss.status_code == 200
    assert "cached" not in miss.json()
    assert fetch_calls == [("POWERMECH", "1D")]
    assert len(kicks) == 1


def test_symbol_chart_stale_first_oversized_frame_falls_back_to_network(
    cp_client, monkeypatch, tmp_path,
):
    """An on-disk frame bigger than the byte cap is never read by the
    stale-first path."""
    store.save_hits("cpj_sf_big", [_hit("POWERMECH")])
    df = _make_df_session_current(80)
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    _seed_live_edge_disk_cache("POWERMECH", "1D", df, variant=_disk_cache_variant())
    _pin_last_completed_session(monkeypatch, "2026-11-09")
    monkeypatch.setattr(cp_api, "_STALE_FIRST_MAX_BYTES", 10)
    fetch_calls: list = []

    def _recorder(symbol, timeframe, **kwargs):
        fetch_calls.append((symbol, timeframe))
        return _make_df_session_current(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _recorder)
    kicks = _kick_spy(monkeypatch)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart",
        params={"timeframe": "1D"},
    )
    assert chart.status_code == 200
    body = chart.json()
    assert "cached" not in body and "stale" not in body
    assert fetch_calls == [("POWERMECH", "1D")]
    assert kicks == []


def test_symbol_chart_stale_first_takes_precedence_over_neg_cache(
    cp_client, monkeypatch, tmp_path,
):
    """A session-current frame is served even if an empty result was negative
    cached earlier — real (stale) data beats an empty answer."""
    store.save_hits("cpj_sf_neg", [_hit("POWERMECH")])
    df = _make_df_session_current(80)
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    _seed_live_edge_disk_cache("POWERMECH", "1D", df, variant=_disk_cache_variant())
    _pin_last_completed_session(monkeypatch, "2026-11-09")
    cp_api._chart_neg_cache_put(
        "POWERMECH", "1D", cp_api._ist_session_date(),
        {"symbol": "POWERMECH", "timeframe": "1D", "candles": [],
         "overlays": [], "trend_lines": [], "error": "no_data", "note": "cached empty"},
    )
    fetch_calls: list = []

    def _recorder(symbol, timeframe, **kwargs):
        fetch_calls.append((symbol, timeframe))
        return _make_df_session_current(80)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _recorder)
    _kick_spy(monkeypatch)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart",
        params={"timeframe": "1D"},
    )
    assert chart.status_code == 200
    body = chart.json()
    assert body["cached"] is True and body["stale"] is True
    assert len(body["candles"]) == 80
    assert fetch_calls == []


def _daily_df_business_days(start: str, end: str, base: float = 100.0) -> pd.DataFrame:
    idx = pd.date_range(start, end, freq="B", tz="UTC")
    close = np.arange(len(idx), dtype=float) + base
    return pd.DataFrame(
        {"open": close, "high": close + 1.0, "low": close - 1.0, "close": close, "volume": 1000.0},
        index=idx,
    )


def test_symbol_chart_1w_stale_first_resamples_daily_cache(cp_client, monkeypatch, tmp_path):
    """No exact 1W cache: the default 1D cache is resampled locally (W-FRI),
    served cached/stale with as_of, no network fetch, background refresh kicked."""
    store.save_hits("cpj_1w_res", [_hit("POWERMECH")])
    df = _daily_df_business_days("2026-10-01", "2026-10-09")
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    _seed_live_edge_disk_cache("POWERMECH", "1D", df)  # default 1D entry, no 1W cache
    _pin_last_completed_session(monkeypatch, "2026-10-09")
    monkeypatch.setattr(cp_api, "_ist_session_date", lambda: "2026-10-09")
    fetch_calls: list = []

    def _recorder(symbol, timeframe, **kwargs):
        fetch_calls.append((symbol, timeframe))
        raise AssertionError("stale-first resample must not call fetch_for_timeframe")

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _recorder)
    kicks = _kick_spy(monkeypatch)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart", params={"timeframe": "1W"}
    )
    assert chart.status_code == 200
    body = chart.json()
    assert body["cached"] is True and body["stale"] is True
    assert body["as_of"] == "2026-10-09"
    assert fetch_calls == [], "resample serve must not touch the network"
    assert kicks == [("POWERMECH", "1W", config.READ_LOOKBACK_BARS)]
    candles = body["candles"]
    assert len(candles) == 2  # weeks ending Fri Oct 2 and Fri Oct 9
    assert candles[0]["o"] == 100.0 and candles[0]["h"] == 102.0
    assert candles[0]["l"] == 99.0 and candles[0]["c"] == 101.0 and candles[0]["v"] == 2000.0
    assert candles[1]["o"] == 102.0 and candles[1]["c"] == 106.0
    assert candles[1]["h"] == 107.0 and candles[1]["l"] == 101.0 and candles[1]["v"] == 5000.0


def test_symbol_chart_1w_exact_cache_takes_precedence_over_resample(
    cp_client, monkeypatch, tmp_path,
):
    """A fresh exact 1W cache is served as-is; the 1D resample fallback only
    runs when no exact 1W/1M cache exists."""
    store.save_hits("cpj_1w_exact", [_hit("POWERMECH")])
    df = _daily_df_business_days("2026-10-01", "2026-10-09")
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    _seed_live_edge_disk_cache("POWERMECH", "1D", df)
    _seed_live_edge_disk_cache("POWERMECH", "1W", df)  # exact 1W entry, session-current
    _pin_last_completed_session(monkeypatch, "2026-10-09")
    monkeypatch.setattr(cp_api, "_ist_session_date", lambda: "2026-10-09")
    fetch_calls: list = []

    def _recorder(symbol, timeframe, **kwargs):
        fetch_calls.append((symbol, timeframe))
        raise AssertionError("no fetch when an exact cache is served")

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _recorder)
    kicks = _kick_spy(monkeypatch)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart", params={"timeframe": "1W"}
    )
    assert chart.status_code == 200
    body = chart.json()
    assert body["cached"] is True and body["stale"] is True
    assert body["as_of"] == "2026-10-09"
    assert len(body["candles"]) == len(df)  # exact cache served un-resampled
    assert fetch_calls == []


def test_symbol_chart_1w_no_daily_cache_uses_network(cp_client, monkeypatch, tmp_path):
    """No 1D cache at all: the resample fallback has nothing to read, so the
    normal (bounded) network path runs for 1W."""
    store.save_hits("cpj_1w_net", [_hit("POWERMECH")])
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    _pin_last_completed_session(monkeypatch, "2026-10-09")
    monkeypatch.setattr(cp_api, "_ist_session_date", lambda: "2026-10-09")
    cp_api._chart_neg_cache.clear()
    fetch_calls: list = []

    def _recorder(symbol, timeframe, **kwargs):
        fetch_calls.append((symbol, timeframe))
        return _daily_df_business_days("2026-10-01", "2026-10-09")

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _recorder)
    kicks = _kick_spy(monkeypatch)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart", params={"timeframe": "1W"}
    )
    assert chart.status_code == 200
    body = chart.json()
    assert "cached" not in body and "stale" not in body and "as_of" not in body
    assert fetch_calls == [("POWERMECH", "1W")], "no 1D cache -> network fetch for 1W"
    assert kicks == []
    assert len(body["candles"]) == 7


def test_pattern_hit_cache_hit_skips_engine_and_detector(cp_client, monkeypatch):
    """detect_patterns=1 caches hits/trend lines for the session: repeat
    calls neither re-run the engine nor the trendline detector."""
    from types import SimpleNamespace

    store.save_hits("cpj_patcache", [_hit("IRCON")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    engine_calls: list = []
    detect_calls: list = []

    def fake_detect(df_, timeframe, symbol):
        engine_calls.append(1)
        return [_live_hit(symbol)]

    def fake_tl(df_, lookback_bars=None):
        detect_calls.append(1)
        return {"support": _fake_trendline("support"), "resistance": None}

    monkeypatch.setattr(cp_api, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(cp_api.trendlines_mod, "detect_trendlines", fake_tl)

    first = cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "1D", "detect_patterns": 1},
    )
    second = cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "1D", "detect_patterns": 1},
    )
    assert first.status_code == second.status_code == 200
    assert first.json()["hits"] == second.json()["hits"]
    assert first.json()["trend_lines"] == second.json()["trend_lines"]
    assert first.json()["trend_lines"] == [_fake_trendline("support")]
    assert len(engine_calls) == 1
    assert len(detect_calls) == 1


def test_pattern_hit_cache_keyed_by_session(cp_client, monkeypatch):
    """Pattern entries never apply across IST sessions."""
    from types import SimpleNamespace

    store.save_hits("cpj_patsess", [_hit("IRCON")])
    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _make_df(80))
    sessions = {"cur": "2026-11-09"}
    monkeypatch.setattr(cp_api, "_ist_session_date", lambda: sessions["cur"])
    engine_calls: list = []

    def fake_detect(df_, timeframe, symbol):
        engine_calls.append(1)
        return [_live_hit(symbol)]

    monkeypatch.setattr(cp_api, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(
        cp_api.trendlines_mod, "detect_trendlines",
        lambda df_, lookback_bars=None: {"support": None, "resistance": None},
    )

    cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "1D", "detect_patterns": 1},
    )
    assert len(engine_calls) == 1
    sessions["cur"] = "2026-11-10"
    cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "1D", "detect_patterns": 1},
    )
    assert len(engine_calls) == 2, "a new session must recompute"
    # The original session's entry is still valid within its TTL.
    sessions["cur"] = "2026-11-09"
    cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "1D", "detect_patterns": 1},
    )
    assert len(engine_calls) == 2


def test_symbol_chart_stale_first_serves_one_session_behind(
    cp_client, monkeypatch, tmp_path,
):
    """A frame one session behind (weekend/Monday before the fresh scan) is
    still served instantly with stale=true; the refresh happens in background."""
    df = _make_df_session_current(80, end="2026-11-08")
    monkeypatch.setattr(cp_api.candles, "CACHE_DIR", tmp_path)
    _seed_live_edge_disk_cache("POWERMECH", "1D", df, variant=_disk_cache_variant())
    _pin_last_completed_session(monkeypatch, "2026-11-09")
    fetch_calls: list = []

    def _recorder(symbol, timeframe, **kwargs):
        fetch_calls.append((symbol, timeframe))
        return df

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _recorder)
    _kick_spy(monkeypatch)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/POWERMECH/chart",
        params={"timeframe": "1D", "detect_patterns": 0},
    )

    assert chart.status_code == 200
    body = chart.json()
    assert body["cached"] is True and body["stale"] is True
    assert body["as_of"] == "2026-11-08"
    assert fetch_calls == []


def test_kick_stale_first_refresh_refetches_with_force_refresh(cp_client, monkeypatch):
    """The background refresh re-fetches with force_refresh=True and never
    requests the synthetic partial bar (which must not reach the disk cache)."""
    calls: list = []

    def _recorder(symbol, timeframe, **kwargs):
        calls.append({"symbol": symbol, "timeframe": timeframe, **kwargs})
        return _make_df(10)

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _recorder)

    class _SyncThread:
        def __init__(self, target, name=None, daemon=None):
            self._target = target

        def start(self):
            self._target()

    import types as _types

    monkeypatch.setattr(cp_api, "threading", _types.SimpleNamespace(Thread=_SyncThread))
    ok = cp_api._kick_stale_first_refresh("powermech", "1D", 500)
    assert ok is True
    assert calls == [{
        "symbol": "POWERMECH", "timeframe": "1D",
        "lookback_bars": 500, "include_partial_today": False, "force_refresh": True,
    }]
    assert cp_api._refresh_inflight == set()


def test_kick_stale_first_refresh_dedupes_inflight(cp_client):
    cp_api._refresh_inflight.add(("POWERMECH", "1D"))
    try:
        assert cp_api._kick_stale_first_refresh("POWERMECH", "1D", 500) is False
    finally:
        cp_api._clear_chart_caches()


def test_kick_stale_first_refresh_swallows_fetch_errors(cp_client, monkeypatch):
    def _boom(symbol, timeframe, **kwargs):
        raise RuntimeError("feed down")

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", _boom)

    import types as _types

    class _SyncThread:
        def __init__(self, target, name=None, daemon=None):
            self._target = target

        def start(self):
            self._target()

    monkeypatch.setattr(cp_api, "threading", _types.SimpleNamespace(Thread=_SyncThread))
    ok = cp_api._kick_stale_first_refresh("POWERMECH", "5m", None)
    assert ok is True
    assert cp_api._refresh_inflight == set()
