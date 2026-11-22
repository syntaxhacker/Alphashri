"""Response-cache behaviour for ``/api/agri/prices``."""

from __future__ import annotations

import os
from typing import Any

import pytest
from fastapi.testclient import TestClient

from api.agri import router as router_module
from api.agri import store


@pytest.fixture(autouse=True)
def clear_caches():
    router_module._PRICES_CACHE.clear()
    store._OPTIONS_CACHE.clear()
    store._GEOGRAPHY_CACHE.clear()
    yield
    router_module._PRICES_CACHE.clear()
    store._OPTIONS_CACHE.clear()
    store._GEOGRAPHY_CACHE.clear()


def _count_fetches(monkeypatch: pytest.MonkeyPatch) -> dict[str, int]:
    calls = {"fetch_rows": 0, "aggregate_daily": 0}
    real_fetch = router_module.store.fetch_rows
    real_daily = router_module.aggregate.aggregate_daily

    def fetch(*args: Any, **kwargs: Any):
        calls["fetch_rows"] += 1
        return real_fetch(*args, **kwargs)

    def daily(*args: Any, **kwargs: Any):
        calls["aggregate_daily"] += 1
        return real_daily(*args, **kwargs)

    monkeypatch.setattr(router_module.store, "fetch_rows", fetch)
    monkeypatch.setattr(router_module.aggregate, "aggregate_daily", daily)
    return calls


def test_prices_does_not_build_geography(agri_client: TestClient, monkeypatch):
    calls: list[Any] = []
    real = store.fetch_geography

    def counting(*args: Any, **kwargs: Any):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(router_module.store, "fetch_geography", counting)
    agri_client.get("/api/agri/prices?commodity=onion")
    assert calls == []
    agri_client.get("/api/agri/filters")
    assert len(calls) == 1


def test_identical_repeat_request_is_served_from_cache(agri_client: TestClient, monkeypatch):
    calls = _count_fetches(monkeypatch)
    first = agri_client.get("/api/agri/prices?commodity=onion&range=6m").json()
    assert calls["fetch_rows"] > 0
    assert calls["aggregate_daily"] > 0

    calls["fetch_rows"] = 0
    calls["aggregate_daily"] = 0
    second = agri_client.get("/api/agri/prices?commodity=onion&range=6m").json()
    assert second == first
    assert calls["fetch_rows"] == 0
    assert calls["aggregate_daily"] == 0


def test_cache_key_includes_query_params(agri_client: TestClient, monkeypatch):
    calls = _count_fetches(monkeypatch)
    onion = agri_client.get("/api/agri/prices?commodity=onion").json()
    assert calls["fetch_rows"] > 0

    calls["fetch_rows"] = 0
    potato = agri_client.get("/api/agri/prices?commodity=potato").json()
    assert calls["fetch_rows"] > 0
    assert potato["filters"]["commodity"] == "potato"

    calls["fetch_rows"] = 0
    assert agri_client.get("/api/agri/prices?commodity=onion").json() == onion
    assert calls["fetch_rows"] == 0
    assert agri_client.get("/api/agri/prices?commodity=ONION").json() == onion
    assert calls["fetch_rows"] == 0


def test_cache_invalidates_when_db_mtime_changes(agri_client: TestClient, monkeypatch):
    calls = _count_fetches(monkeypatch)
    path = router_module.DB_PATH
    stat = os.stat(path)
    agri_client.get("/api/agri/prices?commodity=onion")
    assert calls["fetch_rows"] > 0

    calls["fetch_rows"] = 0
    bumped = stat.st_mtime_ns + 1_000_000_000
    os.utime(path, ns=(bumped, bumped))
    agri_client.get("/api/agri/prices?commodity=onion")
    assert calls["fetch_rows"] > 0


def test_db_write_is_not_served_from_stale_cache(agri_client: TestClient):
    before = agri_client.get("/api/agri/prices?commodity=onion").json()
    assert before["as_of"] == "2026-05-31"

    conn = store.open_writer(router_module.DB_PATH)
    try:
        store.upsert_rows(conn, [{
            "date": "2026-06-01", "state": "Maharashtra", "district": "Pune",
            "market": "Pune APMC", "commodity": "Onion", "commodity_key": "onion",
            "variety": "No 1", "grade": "FAQ", "min_price": 3000.0,
            "max_price": 3200.0, "modal_price": 3100.0, "arrivals_qtl": 10.0,
            "price_unit": "Rs./Quintal", "source": "test",
        }])
    finally:
        conn.close()

    after = agri_client.get("/api/agri/prices?commodity=onion").json()
    assert after["as_of"] == "2026-06-01"
    assert after["kpis"]["modal"] != before["kpis"]["modal"]


def test_expired_entry_is_recomputed(agri_client: TestClient, monkeypatch):
    calls = _count_fetches(monkeypatch)
    agri_client.get("/api/agri/prices?commodity=onion")
    assert calls["fetch_rows"] > 0

    calls["fetch_rows"] = 0
    key = next(iter(router_module._PRICES_CACHE))
    _, response = router_module._PRICES_CACHE[key]
    router_module._PRICES_CACHE[key] = (0.0, response)
    agri_client.get("/api/agri/prices?commodity=onion")
    assert calls["fetch_rows"] > 0
