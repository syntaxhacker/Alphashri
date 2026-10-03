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

