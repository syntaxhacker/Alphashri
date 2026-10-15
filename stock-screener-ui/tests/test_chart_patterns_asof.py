"""As-of from/to date-time replay for chart patterns (backend).

Covers: candles ``from_date`` passthrough + cache namespacing, store
date-range filter, ``/results`` + ``/summary`` date params, the symbol-chart
as-of replay (truncated frame, live-only hits window-filtered, stored
overlays omitted, ``as_of`` payload), and the as-of scan (params threading
+ 200-symbol cap). The candle provider and engine are mocked; the DB is the
in-memory ``test_db_engine`` fixture — no ``*.db`` files.
"""
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

import api.chart_patterns as cp_api
from api.auth import get_current_user
from api.chart_patterns import router
from chart_patterns import candles as candles_mod
from chart_patterns import jobs, scan, store


IST = pytest.importorskip("trading.timezone").IST


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _daily_df(start: str = "2026-01-01", n: int = 100) -> pd.DataFrame:
    idx = pd.date_range(start, periods=n, freq="D", tz="UTC")
    base = np.linspace(100.0, 130.0, n)
    return pd.DataFrame(
        {"open": base, "high": base + 1.0, "low": base - 1.0,
         "close": base, "volume": 1000.0},
        index=idx,
    )


def _intraday_df() -> pd.DataFrame:
    # 20 hourly bars 03:00-22:00 UTC on 2026-09-30 (= 08:30-03:30+1 IST).
    idx = pd.date_range("2026-09-30 03:00", periods=20, freq="h", tz="UTC")
    base = np.arange(20, dtype=float) + 100.0
    return pd.DataFrame(
        {"open": base, "high": base + 0.5, "low": base - 0.5,
         "close": base, "volume": 100.0},
        index=idx,
    )


def _stored_hit(symbol: str, end_date: str, name: str = "Test Co") -> dict:
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
        "end_date": end_date,
        "start_price": 129.8,
        "end_price": 112.6,
        "breakout_level": 112.6,
        "target": 129.6,
        "stop": 102.5,
        "rr": 1.7,
        "bars_ago": 1,
        "volume_confirmed": True,
        "trendlines": [[{"t": "2026-04-26", "price": 129.8},
                        {"t": end_date, "price": 112.6}]],
        "notes": "synthetic",
    }


class _FakeUser:
    id = 1
    email = "qa@test.com"


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


@pytest.fixture
def cp_client(test_db_engine):
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)
    store.set_session_factory(factory)
    jobs.reset()

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()

    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        jobs.reset()
        store.reset_session_factory()


# ---------------------------------------------------------------------------
# candles.parse_asof_datetime / truncate_frame_to
# ---------------------------------------------------------------------------


def test_parse_asof_datetime_date_only_is_ist_midnight():
    dt = candles_mod.parse_asof_datetime("2026-09-30")
    assert (dt.year, dt.month, dt.day, dt.hour, dt.minute) == (2026, 9, 30, 0, 0)
    assert dt.tzinfo is not None


def test_parse_asof_datetime_with_time():
    dt = candles_mod.parse_asof_datetime("2026-09-30T10:15")
    assert (dt.hour, dt.minute) == (10, 15)
    dt2 = candles_mod.parse_asof_datetime("2026-09-30T10:15:30")
    assert (dt2.hour, dt2.minute, dt2.second) == (10, 15, 30)


def test_parse_asof_datetime_invalid_raises():
    with pytest.raises(ValueError):
        candles_mod.parse_asof_datetime("not-a-date")
    with pytest.raises(ValueError):
        candles_mod.parse_asof_datetime("")


def test_truncate_frame_to_compares_in_ist():
    df = _intraday_df()
    # 2026-09-30T12:00 IST == 06:30 UTC: keeps 03,04,05,06 UTC bars.
    to_dt = candles_mod.parse_asof_datetime("2026-09-30T12:00")
    out = candles_mod.truncate_frame_to(df, to_dt)
    assert len(out) == 4
    assert out.index[-1] == pd.Timestamp("2026-09-30 06:00", tz="UTC")


# ---------------------------------------------------------------------------
# candles.fetch_for_timeframe: from_date passthrough + cache namespacing
# ---------------------------------------------------------------------------


def _patch_tf(monkeypatch):
    monkeypatch.setattr(
        candles_mod, "_resolve_timeframe",
        lambda tf_id: {"minutes": 1440, "source_tf": None, "max_lookback_days": 730},
    )


def test_fetch_from_date_passthrough_and_cache_namespace(monkeypatch, tmp_path):
    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    _patch_tf(monkeypatch)
    seen = {}

    def fake_core(symbol, timeframe, **kwargs):
        seen.update(kwargs)
        return _daily_df(n=10)

    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe", fake_core
    )

    got = candles_mod.fetch_for_timeframe(
        "AAA", "1D", as_of_date="2020-06-01", from_date="2020-01-01"
    )
    assert got is not None and len(got) == 10
    assert seen["from_date"] == "2020-01-01"
    assert seen["to_date"] == "2020-06-01"
    namespaced = candles_mod._cache_path("1D", "AAA", "2020-06-01", variant="from2020-01-01")
    assert namespaced.exists()
    assert namespaced != candles_mod._cache_path("1D", "AAA")
    assert candles_mod._cache_path("1D", "AAA") != candles_mod._cache_path(
        "1D", "AAA", "2020-06-01"
    )


def test_fetch_default_window_unchanged_when_no_bounds(monkeypatch, tmp_path):
    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    _patch_tf(monkeypatch)
    seen = {}

    def fake_core(symbol, timeframe, **kwargs):
        seen.update(kwargs)
        return _daily_df(n=10)

    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe", fake_core
    )

    candles_mod.fetch_for_timeframe("AAA", "1D")
    # Default path has no variant suffix and the window is lookback-derived.
    assert candles_mod._cache_path("1D", "AAA").name == f"AAA.v{candles_mod.CACHE_VERSION}.pkl"
    assert seen["from_date"] != seen["to_date"]
    assert "from" not in candles_mod._cache_path("1D", "AAA").name


def test_fetch_intraday_asof_time_namespaces_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
    _patch_tf(monkeypatch)
    seen = {}

    def fake_core(symbol, timeframe, **kwargs):
        seen.update(kwargs)
        return _daily_df(n=10)

    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe", fake_core
    )

    candles_mod.fetch_for_timeframe("AAA", "1D", as_of_date="2020-06-01T10:00")
    # The date part drives the provider window; the time drives the cache key.
    assert seen["to_date"] == "2020-06-01"
    timed = candles_mod._cache_path("1D", "AAA", "2020-06-01", variant="toT1000")
    dated = candles_mod._cache_path("1D", "AAA", "2020-06-01")
    assert timed.exists() and timed != dated


# ---------------------------------------------------------------------------
# store date-range filter
# ---------------------------------------------------------------------------


def test_store_end_date_range_filter(cp_store):
    store.save_job({
        "job_id": "cpj_dt", "universe": "nifty500", "timeframe": "1D",
        "status": "completed",
    })
    store.save_hits("cpj_dt", [
        _stored_hit("OLD", "2026-09-24"),
        _stored_hit("MID", "2026-09-25"),
        _stored_hit("NEW", "2026-09-26"),
    ])

    _, total_from, _ = store.query_results({"job_id": "cpj_dt", "from_date": "2026-09-25"})
    assert total_from == 2
    _, total_to, _ = store.query_results({"job_id": "cpj_dt", "to_date": "2026-09-25"})
    assert total_to == 2
    items, total_both, summary = store.query_results({
        "job_id": "cpj_dt", "from_date": "2026-09-25", "to_date": "2026-09-25",
    })
    assert total_both == 1
    assert items[0]["symbol"] == "MID"
    assert summary["patterns"] == 1
    # Datetime input is normalized to its date part.
    _, total_dt, _ = store.query_results(
        {"job_id": "cpj_dt", "from_date": "2026-09-25T10:00:00"}
    )
    assert total_dt == 2
    # Absent bounds return everything.
    _, total_all, _ = store.query_results({"job_id": "cpj_dt"})
    assert total_all == 3


# ---------------------------------------------------------------------------
# /results + /summary date params
# ---------------------------------------------------------------------------


def test_results_and_summary_date_params(cp_client):
    store.save_job({
        "job_id": "cpj_api_dt", "universe": "nifty500", "timeframe": "1D",
        "status": "completed",
    })
    store.save_hits("cpj_api_dt", [
        _stored_hit("OLD", "2026-09-24"),
        _stored_hit("NEW", "2026-09-26"),
    ])

    resp = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_api_dt", "from_date": "2026-09-25"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["symbol"] == "NEW"

    resp = cp_client.get(
        "/api/chart-patterns/results",
        params={"job_id": "cpj_api_dt", "to_date": "2026-09-24"},
    )
    assert resp.json()["total"] == 1

    summary = cp_client.get(
        "/api/chart-patterns/summary",
        params={"job_id": "cpj_api_dt", "from_date": "2026-09-25",
                "to_date": "2026-09-26"},
    )
    assert summary.status_code == 200
    assert summary.json()["patterns"] == 1

    # No date params: both rows.
    plain = cp_client.get(
        "/api/chart-patterns/results", params={"job_id": "cpj_api_dt"}
    )
    assert plain.json()["total"] == 2


# ---------------------------------------------------------------------------
# symbol chart as-of replay
# ---------------------------------------------------------------------------


def _live_hit_dict(end_date: str, pattern_id: str = "double_bottom") -> dict:
    return {
        "pattern_id": pattern_id,
        "pattern_name": "Double Bottom",
        "family": "reversal",
        "direction": "bullish",
        "status": "confirmed",
        "quality": "strong",
        "confidence": 70.0,
        "start_date": "2026-09-01",
        "end_date": end_date,
        "start_price": 100.0,
        "end_price": 110.0,
        "breakout_level": 110.0,
        "target": 120.0,
        "stop": 95.0,
        "rr": 2.0,
        "bars_ago": 1,
        "volume_confirmed": True,
        "trendlines": [[{"t": "2026-09-01", "price": 100.0},
                        {"t": end_date, "price": 110.0}]],
        "notes": "live",
    }


def test_chart_asof_truncates_and_uses_live_hits_only(cp_client, monkeypatch):
    store.save_hits("cpj_chart_asof", [_stored_hit("IRCON", "2026-09-26")])
    seen_fetch = {}

    def fake_fetch(symbol, timeframe, **kwargs):
        seen_fetch.update(kwargs)
        assert kwargs.get("include_partial_today") is False
        return _intraday_df()

    monkeypatch.setattr(cp_api.candles, "fetch_for_timeframe", fake_fetch)
    seen_engine = {}

    def fake_detect(df, timeframe, symbol):
        seen_engine["bars"] = len(df)
        return [_live_hit_dict("2026-09-29"), _live_hit_dict("2026-09-30")]

    monkeypatch.setattr(
        cp_api, "engine_mod", SimpleNamespace(detect_patterns=fake_detect)
    )
    seen_tl = {}

    def fake_tl(df, lookback_bars=None):
        seen_tl["bars"] = len(df)
        return {"support": None, "resistance": None}

    monkeypatch.setattr(cp_api.trendlines_mod, "detect_trendlines", fake_tl)

    chart = cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "15m", "as_of_date": "2026-09-30T12:00",
                "from_date": "2026-09-30", "detect_patterns": 1},
    )
    assert chart.status_code == 200
    body = chart.json()
    # Fetch used the replay window; the engine saw only the truncated frame.
    assert seen_fetch["as_of_date"] == "2026-09-30"
    assert seen_fetch["from_date"] == "2026-09-30"
    assert seen_engine["bars"] == 4
    assert seen_tl["bars"] == 4
    # Series ends at the as-of cutoff.
    assert len(body["candles"]) == 4
    # Hits are window-filtered by from_date; overlays come only from live hits
    # (the stored falling_wedge overlay is omitted).
    assert len(body["hits"]) == 1
    assert body["hits"][0]["end_date"] == "2026-09-30"
    assert len(body["overlays"]) == 1
    assert body["overlays"][0]["pattern_id"] == "double_bottom"
    assert body["as_of"].startswith("2026-09-30T12:00:00")
    assert body["from_date"] == "2026-09-30"


def test_chart_asof_without_detect_has_empty_hits_and_overlays(cp_client, monkeypatch):
    store.save_hits("cpj_chart_asof2", [_stored_hit("IRCON", "2026-09-26")])
    monkeypatch.setattr(
        cp_api.candles, "fetch_for_timeframe", lambda *a, **k: _intraday_df()
    )

    def _boom(df, timeframe, symbol):
        raise AssertionError("engine must not run when detect_patterns=0")

    monkeypatch.setattr(cp_api, "engine_mod", SimpleNamespace(detect_patterns=_boom))

    chart = cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "15m", "as_of_date": "2026-10-01"},
    )
    assert chart.status_code == 200
    body = chart.json()
    assert body["hits"] == []
    assert body["overlays"] == []
    assert body["as_of"].startswith("2026-10-01T00:00:00")
    assert body["from_date"] is None
    # Midnight IST Oct 1 == 18:30 UTC Sep 30: keeps 03:00-18:00 UTC (16 bars).
    assert len(body["candles"]) == 16


def test_chart_asof_invalid_date_422(cp_client):
    chart = cp_client.get(
        "/api/chart-patterns/symbol/IRCON/chart",
        params={"timeframe": "1D", "as_of_date": "nope"},
    )
    assert chart.status_code == 422


# ---------------------------------------------------------------------------
# as-of scan: params threading + cap
# ---------------------------------------------------------------------------


def test_scan_run_job_asof_window(cp_store, monkeypatch):
    monkeypatch.setattr(scan, "SYMBOL_WORKERS", 1)
    seen_fetch = {}
    seen_detect = {}

    def fake_fetch(symbol, timeframe, **kwargs):
        seen_fetch.update(kwargs)
        return _daily_df(n=100)

    def fake_detect(df, timeframe, symbol):
        seen_detect["bars"] = len(df)
        return [
            SimpleNamespace(
                pattern_id="double_bottom", pattern_name="Double Bottom",
                family="reversal", direction="bullish", status="confirmed",
                quality="strong", confidence=70.0, start_date="2026-01-01",
                end_date=end, start_price=100.0, end_price=110.0,
                breakout_level=110.0, target=120.0, stop=95.0, rr=2.0,
                bars_ago=1, volume_confirmed=True, trendlines=[],
                notes="replay", symbol=symbol, timeframe=timeframe,
            )
            for end in ("2026-02-01", "2026-03-10")
        ]

    monkeypatch.setattr(scan.candles, "fetch_for_timeframe", fake_fetch)
    monkeypatch.setattr(scan, "engine_mod", SimpleNamespace(detect_patterns=fake_detect))
    monkeypatch.setattr(scan, "universes_mod", SimpleNamespace(get_universe=lambda uid: ["AAA"]))

    store.save_job({
        "job_id": "cpj_replay", "universe": "nifty50", "timeframe": "1D",
        "status": "queued",
        "params": {"as_of_date": "2026-03-15T15:30", "from_date": "2026-03-01",
                   "force": True},
    })
    scan.run_job("cpj_replay")

    row = store.get_job("cpj_replay")
    assert row["status"] == "completed"
    # The fetch used the replay window (date parts).
    assert seen_fetch["as_of_date"] == "2026-03-15"
    assert seen_fetch["from_date"] == "2026-03-01"
    # Detection saw only bars <= to_dt: 2026-01-01..2026-03-15 = 74 bars.
    assert seen_detect["bars"] == 74
    # Hits ending before from_date were dropped.
    items, total, _ = store.query_results({"job_id": "cpj_replay"})
    assert total == 1
    assert items[0]["end_date"] == "2026-03-10"


def test_scan_asof_params_stored_and_capped(cp_client, monkeypatch):
    captured = {}

    def fake_submit(universe, timeframe, requested_by=None, params=None):
        captured.update(universe=universe, params=params)
        return {"job_id": "cpj_cap", "universe": universe, "timeframe": timeframe,
                "status": "queued", "queue_position": 0}

    monkeypatch.setattr(cp_api.jobs, "submit", fake_submit)

    # Small scope passes and carries the replay params.
    resp = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "", "timeframe": "1D", "symbols": ["AAA"],
              "as_of_date": "2026-09-30", "from_date": "2026-09-01"},
    )
    assert resp.status_code == 200
    assert captured["params"]["as_of_date"] == "2026-09-30"
    assert captured["params"]["from_date"] == "2026-09-01"

    # A 201-symbol scope exceeds the replay cap.
    big = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "", "timeframe": "1D",
              "symbols": [f"S{i}" for i in range(201)],
              "as_of_date": "2026-09-30"},
    )
    assert big.status_code == 400
    assert "capped" in big.json()["detail"]

    # At exactly the cap the scan is accepted.
    ok = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "", "timeframe": "1D",
              "symbols": [f"S{i}" for i in range(200)],
              "as_of_date": "2026-09-30"},
    )
    assert ok.status_code == 200

    # A full universe replay is over the cap.
    uni = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D",
              "as_of_date": "2026-09-30"},
    )
    assert uni.status_code == 400
    assert "capped" in uni.json()["detail"]

    # Invalid as-of is a 422, before any submit.
    bad = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D",
              "as_of_date": "yesterday-ish"},
    )
    assert bad.status_code == 422

    # Non-as-of scans never hit the cap path (submit still runs).
    plain = cp_client.post(
        "/api/chart-patterns/scan",
        json={"universe": "nifty500", "timeframe": "1D"},
    )
    assert plain.status_code == 200
    assert "as_of_date" not in captured["params"]
