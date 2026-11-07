"""API tests for GET /api/chart-patterns/matrix (mocked store)."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

import api.chart_patterns as cp_api
from api.auth import get_current_user
from api.chart_patterns import router
from db.database import get_db

_ALLOWED = {
    "id", "symbol", "name", "timeframe", "pattern_id", "pattern_name",
    "family", "direction", "status", "quality", "confidence", "start_date",
    "end_date", "start_price", "end_price", "bars_ago", "volume_confirmed",
    "range_pos", "to_52w_high",
}


class _FakeUser:
    id = 1
    email = "qa@test.com"


@pytest.fixture
def matrix_client(test_db_engine):
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
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def _hit(
    symbol,
    timeframe,
    hit_id,
    score,
    confidence,
    bars_ago=1,
    pattern_id="falling_wedge",
    pattern_name="Falling Wedge",
    **overrides,
):
    hit = {
        "id": hit_id,
        "symbol": symbol,
        "name": f"{symbol} Co",
        "timeframe": timeframe,
        "pattern_id": pattern_id,
        "pattern_name": pattern_name,
        "family": "reversal",
        "direction": "bullish",
        "status": "confirmed",
        "quality": "strong",
        "confidence": confidence,
        "start_date": "2026-04-26",
        "end_date": "2026-09-26",
        "start_price": 100.0,
        "end_price": 110.0 + hit_id,
        "breakout_level": 110.0,
        "target": 120.0,
        "stop": 95.0,
        "rr": 1.7,
        "bars_ago": bars_ago,
        "volume_confirmed": True,
        "range_pos": 60.0,
        "breakout_score": score,
    }
    hit.update(overrides)
    return hit


def _fake_store(monkeypatch, data, through=None):
    calls = []
    through = through or {}

    def fake_query(filters, limit=100, offset=0):
        calls.append({"filters": dict(filters), "limit": limit, "offset": offset})
        items = list(data.get(filters.get("timeframe"), []))
        summary = {
            "data_through": through.get(filters.get("timeframe")),
            "patterns": len(items),
        }
        return items, len(items), summary

    monkeypatch.setattr(cp_api.store, "query_results", fake_query)
    return calls


def _get(client, timeframes=None, universe="nifty50", limit=400):
    params = {"universe": universe, "limit": limit}
    if timeframes is not None:
        params["timeframes"] = timeframes
    return client.get("/api/chart-patterns/matrix", params=params)


def test_matrix_groups_symbol_across_timeframes(matrix_client, monkeypatch):
    data = {
        "1D": [
            _hit("AAA", "1D", 1, 50.0, 60.0, bars_ago=3),
            _hit(
                "AAA", "1D", 2, 90.0, 70.0, bars_ago=1,
                pattern_id="cup_handle", pattern_name="Cup & Handle",
            ),
            _hit("BBB", "1D", 3, 20.0, 30.0, bars_ago=5),
        ],
        "5m": [
            _hit(
                "AAA", "5m", 4, 70.0, 80.0, bars_ago=2,
                pattern_id="rectangle", pattern_name="Rectangle",
                last_close=155.5, day_change_pct=1.25,
            ),
        ],
    }
    _fake_store(monkeypatch, data)

    resp = _get(matrix_client, ["1D", "5m"])

    assert resp.status_code == 200
    body = resp.json()
    assert body["universe"] == "nifty50"
    assert body["timeframes"] == ["1D", "5m"]
    assert [row["symbol"] for row in body["rows"]] == ["AAA", "BBB"]

    aaa = body["rows"][0]
    assert aaa["hit_count"] == 3
    assert set(aaa["timeframes"]) == {"1D", "5m"}
    cell = aaa["timeframes"]["1D"]
    assert cell["count"] == 2
    assert cell["best_id"] == 2
    assert cell["confidence"] == 70.0
    assert cell["direction"] == "bullish"
    assert cell["status"] == "confirmed"
    assert cell["patterns"] == ["Cup & Handle"]
    assert aaa["timeframes"]["5m"]["count"] == 1
    assert len(aaa["hits"]) == 2
    assert aaa["best"]["id"] == 4
    assert aaa["ltp"] == 155.5
    assert aaa["day_change_pct"] == 1.25

    bbb = body["rows"][1]
    assert bbb["hit_count"] == 1
    assert bbb["best"]["id"] == 3
    assert bbb["ltp"] == 113.0
    assert bbb["day_change_pct"] is None


def test_matrix_orders_rows_by_confidence(matrix_client, monkeypatch):
    data = {
        "1D": [
            _hit("AAA", "1D", 1, 90.0, 70.0),
            _hit("ZZZ", "1D", 2, 90.0, 80.0),
            _hit("ABC", "1D", 3, 90.0, 80.0),
            _hit("MMM", "1D", 4, 95.0, 50.0),
        ]
    }
    _fake_store(monkeypatch, data)

    resp = _get(matrix_client, ["1D"])

    assert resp.status_code == 200
    symbols = [row["symbol"] for row in resp.json()["rows"]]
    assert symbols == ["ABC", "ZZZ", "AAA", "MMM"]


def test_matrix_timeframe_filter_order_and_validation(matrix_client, monkeypatch):
    calls = _fake_store(monkeypatch, {"5m": [], "1D": []})

    resp = _get(matrix_client, ["5m", "bogus", "1D"])

    assert resp.status_code == 200
    assert resp.json()["timeframes"] == ["5m", "1D"]
    assert [call["filters"]["timeframe"] for call in calls] == ["5m", "1D"]


def test_matrix_hits_and_best_are_slim(matrix_client, monkeypatch):
    noisy = _hit(
        "AAA", "1D", 1, 80.0, 70.0,
        candles=[{"t": "2026-09-26", "o": 1, "h": 2, "l": 1, "c": 2, "v": 10}],
        trendlines=[[{"t": "2026-04-26", "price": 100.0}]],
        pivots=[{"t": "2026-04-26", "price": 100.0}],
        trend_lines=[{"kind": "support"}],
        notes="synthetic",
        payload_json='{"notes": "synthetic"}',
    )
    _fake_store(monkeypatch, {"1D": [noisy]})

    resp = _get(matrix_client, ["1D"])

    assert resp.status_code == 200
    row = resp.json()["rows"][0]
    assert set(row["hits"][0]) == _ALLOWED
    assert set(row["best"]) == _ALLOWED
    for banned in ("candles", "trendlines", "pivots", "trend_lines", "notes", "payload_json"):
        assert banned not in row["hits"][0]
        assert banned not in row["best"]


def test_matrix_empty_store(matrix_client, monkeypatch):
    _fake_store(monkeypatch, {})

    resp = _get(matrix_client, ["1D", "5m"])

    assert resp.status_code == 200
    body = resp.json()
    assert body["rows"] == []
    assert body["timeframes"] == ["1D", "5m"]
    assert body["data_through"] is None


def test_matrix_one_query_per_timeframe(matrix_client, monkeypatch):
    calls = _fake_store(
        monkeypatch,
        {"1D": [_hit("AAA", "1D", 1, 80.0, 70.0)], "5m": []},
        through={"1D": "2026-09-26", "5m": "2026-09-25"},
    )

    resp = _get(matrix_client, ["1D", "5m"], limit=123)

    assert resp.status_code == 200
    assert len(calls) == 2
    assert calls[0]["filters"] == {
        "universe": "nifty50", "timeframe": "1D", "sort": "confidence",
    }
    assert calls[1]["filters"] == {
        "universe": "nifty50", "timeframe": "5m", "sort": "confidence",
    }
    assert all(call["limit"] == 123 and call["offset"] == 0 for call in calls)
    assert resp.json()["data_through"] == "2026-09-26"


def test_matrix_defaults_to_registry_timeframes(matrix_client, monkeypatch):
    calls = _fake_store(monkeypatch, {})
    expected = [spec["id"] for spec in cp_api._timeframes_payload()]

    resp = _get(matrix_client)

    assert resp.status_code == 200
    assert resp.json()["timeframes"] == expected
    assert [call["filters"]["timeframe"] for call in calls] == expected
