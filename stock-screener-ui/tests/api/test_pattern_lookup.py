"""API tests for POST /api/chart-patterns/patterns/lookup.

The endpoint must answer from STORED hits only — the Market table polls it while
rendering rows, so one candle fetch or one detector run per row would make the
table unusable. Tests seed ``PatternHit`` rows exactly like a completed scan
does (``store.save_job`` + ``store.save_hits``) and never mock the store, so the
real query path (symbol filter, timeframe filter, dedupe) is exercised.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

import api.chart_patterns as cp_api
from api.auth import get_current_user
from api.chart_patterns import router
from chart_patterns import candles, store
from chart_patterns import engine as engine_mod
from db.database import get_db

PATH = "/api/chart-patterns/patterns/lookup"

_ERROR = "lookup must never touch this path"


class _FakeUser:
    id = 1
    email = "qa@test.com"


@pytest.fixture
def lookup_client(test_db_engine):
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)

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
        store.set_session_factory(factory)
        cp_api._clear_read_caches()
        with TestClient(app) as client:
            yield client
    finally:
        cp_api._clear_read_caches()
        app.dependency_overrides.clear()
        store.reset_session_factory()


@pytest.fixture
def anon_client(test_db_engine):
    """Same app, no auth override — the real bearer dependency runs."""
    factory = sessionmaker(autocommit=False, autoflush=False, bind=test_db_engine)

    app = FastAPI()
    app.include_router(router)

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db

    try:
        store.set_session_factory(factory)
        cp_api._clear_read_caches()
        with TestClient(app) as client:
            yield client
    finally:
        cp_api._clear_read_caches()
        app.dependency_overrides.clear()
        store.reset_session_factory()


def _hit(symbol, hit_id, *, timeframe="1D", pattern_id="bull_flag",
         pattern_name="Bull Flag", direction="bullish", status="confirmed",
         quality="strong", confidence=70.0, bars_ago=2, end_date="2026-11-14"):
    return {
        "id": hit_id,
        "symbol": symbol,
        "name": f"{symbol} Ltd",
        "timeframe": timeframe,
        "pattern_id": pattern_id,
        "pattern_name": pattern_name,
        "family": "continuation",
        "direction": direction,
        "status": status,
        "quality": quality,
        "confidence": confidence,
        "start_date": "2026-10-01",
        "end_date": end_date,
        "start_price": 100.0,
        "end_price": 112.0,
        "bars_ago": bars_ago,
        "volume_confirmed": True,
        "range_pos": 61.0,
    }


def _seed(hits, *, universe="all_equity", timeframe="1D", job_id="cpj_lookup",
          finished_at="2026-11-16T10:00:00"):
    """Persist hits the way a completed scan does."""
    store.save_job({
        "job_id": job_id,
        "universe": universe,
        "timeframe": timeframe,
        "status": "completed",
        "total": len(hits),
        "done": len(hits),
        "data_through": "2026-11-14",
        "finished_at": finished_at,
    })
    store.save_hits(job_id, hits)


def _post(client, symbols, timeframe="1D"):
    return client.post(PATH, json={"symbols": symbols, "timeframe": timeframe})


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def test_lookup_requires_auth(anon_client):
    resp = _post(anon_client, ["RELIANCE"])

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Not authenticated"


# ---------------------------------------------------------------------------
# Stored hits → item shape
# ---------------------------------------------------------------------------

def test_lookup_returns_stored_patterns(lookup_client):
    _seed([
        _hit("RELIANCE", 1, confidence=80.0),
        _hit(
            "RELIANCE", 2, pattern_id="cup_handle", pattern_name="Cup & Handle",
            direction="bullish", status="forming", quality="moderate", confidence=55.0,
        ),
    ])

    resp = _post(lookup_client, ["RELIANCE"])

    assert resp.status_code == 200
    body = resp.json()
    assert body["timeframe"] == "1D"
    assert body["source"] == "stored"
    assert body["session"] == cp_api._ist_session_date()
    assert body["data_through"] == "2026-11-14"

    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["symbol"] == "RELIANCE"
    assert item["count"] == 2
    # Confidence order comes from the store query.
    assert [p["name"] for p in item["patterns"]] == ["Bull Flag", "Cup & Handle"]
    first = item["patterns"][0]
    assert first["direction"] == "bullish"
    assert first["status"] == "confirmed"
    assert first["quality"] == "strong"
    assert first["confidence"] == 80.0
    assert first["pattern_id"] == "bull_flag"


def test_lookup_omits_symbols_without_stored_hits(lookup_client):
    _seed([_hit("RELIANCE", 1)])

    resp = _post(lookup_client, ["RELIANCE", "NOSUCHNAME"])

    assert resp.status_code == 200
    body = resp.json()
    assert [item["symbol"] for item in body["items"]] == ["RELIANCE"]


def test_lookup_cold_store_returns_empty_items(lookup_client):
    """No scan has ever run: 200 with no items, never a fabricated entry."""
    resp = _post(lookup_client, ["RELIANCE", "TCS"])

    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["data_through"] is None
    assert body["source"] == "stored"


# ---------------------------------------------------------------------------
# Scope
# ---------------------------------------------------------------------------

def test_lookup_only_returns_requested_symbols(lookup_client):
    _seed([
        _hit("RELIANCE", 1),
        _hit("TCS", 2),
        _hit("INFY", 3),
    ])

    resp = _post(lookup_client, ["TCS", "RELIANCE"])

    assert resp.status_code == 200
    assert [item["symbol"] for item in resp.json()["items"]] == ["RELIANCE", "TCS"]


def test_lookup_ignores_other_timeframes(lookup_client):
    _seed([_hit("RELIANCE", 1)], timeframe="1D")
    store.save_job({
        "job_id": "cpj_lookup_5m",
        "universe": "all_equity",
        "timeframe": "5m",
        "status": "completed",
        "total": 1,
        "done": 1,
        "finished_at": "2026-11-16T10:05:00",
    })
    store.save_hits("cpj_lookup_5m", [
        _hit("RELIANCE", 9, timeframe="5m", pattern_id="rectangle",
             pattern_name="Rectangle", direction="neutral", status="forming"),
    ])

    resp = _post(lookup_client, ["RELIANCE"], timeframe="1D")

    assert resp.status_code == 200
    patterns = resp.json()["items"][0]["patterns"]
    assert [p["pattern_id"] for p in patterns] == ["bull_flag"]


def test_lookup_dedupes_and_folds_case(lookup_client):
    _seed([_hit("RELIANCE", 1)])

    resp = _post(lookup_client, ["  reliance ", "RELIANCE", "Reliance", ""])

    assert resp.status_code == 200
    items = resp.json()["items"]
    assert [item["symbol"] for item in items] == ["RELIANCE"]
    assert items[0]["count"] == 1


def test_lookup_emits_items_in_sorted_order(lookup_client):
    """Order is canonical, not request order: one cache entry serves any order."""
    _seed([
        _hit("TCS", 1, confidence=90.0),
        _hit("RELIANCE", 2, confidence=10.0),
    ])

    forward = _post(lookup_client, ["RELIANCE", "TCS"])
    reversed_ = _post(lookup_client, ["TCS", "RELIANCE"])

    assert [item["symbol"] for item in forward.json()["items"]] == ["RELIANCE", "TCS"]
    assert forward.json() == reversed_.json()


def test_lookup_universe_scope_matches_matrix(lookup_client):
    _seed([_hit("RELIANCE", 1)], universe="all_equity", job_id="cpj_wide")
    store.save_job({
        "job_id": "cpj_custom",
        "universe": "custom",
        "timeframe": "1D",
        "status": "completed",
        "total": 1,
        "done": 1,
        "finished_at": "2026-11-16T10:05:00",
    })
    store.save_hits("cpj_custom", [
        _hit("TCS", 5, pattern_id="rectangle", pattern_name="Rectangle", direction="neutral"),
    ])

    scoped = lookup_client.post(
        PATH, json={"symbols": ["RELIANCE", "TCS"], "timeframe": "1D", "universe": "all_equity"}
    )
    unscoped = _post(lookup_client, ["RELIANCE", "TCS"])

    assert scoped.status_code == 200
    assert [item["symbol"] for item in scoped.json()["items"]] == ["RELIANCE"]
    assert [item["symbol"] for item in unscoped.json()["items"]] == ["RELIANCE", "TCS"]


def test_lookup_rejects_unknown_universe(lookup_client):
    resp = lookup_client.post(
        PATH, json={"symbols": ["RELIANCE"], "universe": "nope"}
    )

    assert resp.status_code == 422
    assert "unknown universe" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_lookup_rejects_more_than_500_symbols(lookup_client):
    symbols = [f"SYM{i}" for i in range(501)]

    resp = _post(lookup_client, symbols)

    assert resp.status_code == 422


def test_lookup_accepts_exactly_500_symbols(lookup_client):
    symbols = [f"SYM{i}" for i in range(500)]

    resp = _post(lookup_client, symbols)

    assert resp.status_code == 200
    assert resp.json()["items"] == []


def test_lookup_rejects_unknown_timeframe(lookup_client):
    """422 like /detect and /scan — a bad timeframe is a request error, not a
    missing resource, so the client sees the same status as every sibling."""
    resp = _post(lookup_client, ["RELIANCE"], timeframe="7m")

    assert resp.status_code == 422
    assert "unknown timeframe" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Never runs detection / never fetches candles
# ---------------------------------------------------------------------------

def test_lookup_never_fetches_candles_or_runs_detection(lookup_client, monkeypatch):
    _seed([_hit("RELIANCE", 1)])
    calls = []

    def _boom(*args, **kwargs):
        calls.append(args)
        raise AssertionError(_ERROR)

    # Both layers of the candle path: the chart-patterns wrapper and the
    # unified market-data core it delegates to.
    monkeypatch.setattr(candles, "fetch_for_timeframe", _boom)
    monkeypatch.setattr(
        "market_data.market_data.fetch_candles_for_timeframe", _boom
    )
    monkeypatch.setattr(engine_mod, "detect_patterns", _boom)
    monkeypatch.setattr(cp_api.scan_mod, "_detect", _boom)
    monkeypatch.setattr(cp_api, "_enrich_with_candles", _boom)

    resp = _post(lookup_client, ["RELIANCE", "TCS"])

    assert calls == []
    assert resp.status_code == 200
    assert resp.json()["items"][0]["symbol"] == "RELIANCE"


# ---------------------------------------------------------------------------
# Caching
# ---------------------------------------------------------------------------

def test_lookup_second_identical_request_is_cached(lookup_client, monkeypatch):
    _seed([_hit("RELIANCE", 1)])
    queries = []
    real = store.query_results

    def counting(filters, limit=100, offset=0):
        queries.append(dict(filters))
        return real(filters, limit=limit, offset=offset)

    monkeypatch.setattr(store, "query_results", counting)

    first = _post(lookup_client, ["RELIANCE", "TCS"])
    second = _post(lookup_client, ["RELIANCE", "TCS"])

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(queries) == 1


def test_lookup_cache_is_reused_across_request_order(lookup_client, monkeypatch):
    _seed([_hit("RELIANCE", 1), _hit("TCS", 2)])
    queries = []
    real = store.query_results

    def counting(filters, limit=100, offset=0):
        queries.append(dict(filters))
        return real(filters, limit=limit, offset=offset)

    monkeypatch.setattr(store, "query_results", counting)

    first = _post(lookup_client, ["RELIANCE", "TCS"])
    second = _post(lookup_client, ["TCS", "RELIANCE"])

    assert first.json() == second.json()
    assert len(queries) == 1


def test_lookup_single_store_query_for_many_symbols(lookup_client, monkeypatch):
    _seed([_hit("RELIANCE", 1), _hit("TCS", 2), _hit("INFY", 3)])
    queries = []
    real = store.query_results

    def counting(filters, limit=100, offset=0):
        queries.append(dict(filters))
        return real(filters, limit=limit, offset=offset)

    monkeypatch.setattr(store, "query_results", counting)

    resp = _post(lookup_client, ["RELIANCE", "TCS", "INFY"])

    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 3
    assert len(queries) == 1
    assert queries[0]["symbol"] == ["RELIANCE", "TCS", "INFY"]
    assert queries[0]["timeframe"] == "1D"
