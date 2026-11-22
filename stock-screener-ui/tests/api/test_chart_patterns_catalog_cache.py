"""Call-count guards for the chart-patterns catalog read cache.

The registry endpoints used to rebuild their payload from module state on every
request; every extra window mount paid that cost again. These tests pin the
"one build per key per TTL" contract and its invalidation paths without changing
any response shape.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.chart_patterns as cp_api
from api.chart_patterns import router


@pytest.fixture(autouse=True)
def _clean_caches():
    cp_api._clear_read_caches()
    yield
    cp_api._clear_read_caches()


def _client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _counted(calls, value):
    def _build():
        calls.append(1)
        return value
    return _build


def test_timeframes_payload_built_once_per_key(monkeypatch):
    calls = []
    monkeypatch.setattr(cp_api, "_timeframes_fingerprint", lambda: ("cfg",))
    monkeypatch.setattr(cp_api, "_timeframes_payload", _counted(calls, [{"id": "1D", "label": "1D"}]))

    with _client() as client:
        first = client.get("/api/chart-patterns/timeframes").json()
        second = client.get("/api/chart-patterns/timeframes").json()

    assert calls == [1]
    assert first == second == {"timeframes": [{"id": "1D", "label": "1D"}]}


def test_timeframes_key_tracks_admin_config_fingerprint(monkeypatch):
    fingerprint = {"value": ("a",)}
    calls = []
    monkeypatch.setattr(cp_api, "_timeframes_fingerprint", lambda: fingerprint["value"])
    monkeypatch.setattr(cp_api, "_timeframes_payload", _counted(calls, [{"id": "1D"}]))

    with _client() as client:
        client.get("/api/chart-patterns/timeframes")
        fingerprint["value"] = ("b",)
        client.get("/api/chart-patterns/timeframes")
        client.get("/api/chart-patterns/timeframes")

    assert len(calls) == 2


def test_catalog_entry_expires_after_ttl(monkeypatch):
    calls = []
    monkeypatch.setattr(cp_api, "_patterns_payload", _counted(calls, []))

    with _client() as client:
        client.get("/api/chart-patterns/patterns")
        with cp_api._read_cache_lock:
            for key, (_expires, payload) in list(cp_api._catalog_cache.items()):
                cp_api._catalog_cache[key] = (0.0, payload)
        client.get("/api/chart-patterns/patterns")

    assert len(calls) == 2


def test_clear_read_caches_invalidates_catalog(monkeypatch):
    calls = []
    monkeypatch.setattr(cp_api, "_universes_payload", _counted(calls, []))

    with _client() as client:
        client.get("/api/chart-patterns/universes")
        cp_api._clear_read_caches()
        client.get("/api/chart-patterns/universes")

    assert len(calls) == 2


def test_watch_setups_built_once(monkeypatch):
    calls = []
    monkeypatch.setattr(cp_api.watch_mod, "public_setups", _counted(calls, []))

    with _client() as client:
        first = client.get("/api/chart-patterns/watch/setups").json()
        second = client.get("/api/chart-patterns/watch/setups").json()

    assert calls == [1]
    assert first == second == {"setups": []}


def test_catalog_keys_are_namespaced():
    assert cp_api._catalog_cache_key("timeframes", ("a",)) != cp_api._catalog_cache_key(
        "timeframes", ("b",)
    )
    assert cp_api._catalog_cache_key("timeframes", ("a",)) != cp_api._catalog_cache_key(
        "universes", ("a",)
    )
