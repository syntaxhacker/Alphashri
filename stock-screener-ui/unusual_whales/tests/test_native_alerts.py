"""Unit tests for the native (account) alerts integration (no network).

Covers the defensive normalisers and the graceful empty-degradation path of
`build_native_alerts`, plus that `build_alerts` exposes the native key without
changing its existing behaviour.

Run:
    cd stock-screener-ui/unusual_whales
    ../.venv/bin/python -m pytest tests/ -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import alerts_data as A  # noqa: E402


# ------------------------------------------------------------------ fakes
class _Resp:
    def __init__(self, data):
        self.status_code = 200
        self._data = data

    def json(self):
        return self._data


class _EmptyClient:
    """Every endpoint returns an empty `{data: []}` (or `{}` for filters)."""

    def __init__(self, *args, **kwargs):
        pass

    def get(self, path, **params):
        if path.endswith("/api/alerts/filters"):
            return _Resp({})
        return _Resp({"data": []})


class _BoomClient:
    """Every call explodes — proves we degrade instead of raising."""

    def __init__(self, *args, **kwargs):
        pass

    def get(self, path, **params):
        raise RuntimeError("network down")


@pytest.fixture(autouse=True)
def _reset_caches():
    A._NATIVE_CACHE.update(ts=0.0, payload=None)
    A._CACHE.update(ts=0.0, payload=None)
    yield
    A._NATIVE_CACHE.update(ts=0.0, payload=None)
    A._CACHE.update(ts=0.0, payload=None)


# ------------------------------------------------------------------ _norm_native_alert
def test_norm_native_alert_canonical_keys():
    out = A._norm_native_alert(
        {
            "id": "abc123",
            "created_at": "2026-09-28T11:48:48Z",
            "ticker_symbol": "nvda",
            "noti_type": "flow_alerts",
            "title": "Big call sweep",
            "message": "NVDA 225C swept",
            "config": {"name": "My flow alerts"},
        }
    )
    assert out["id"] == "abc123"
    assert out["created_at"] == "2026-09-28T11:48:48Z"
    assert out["ticker"] == "NVDA"  # upper-cased
    assert out["noti_type"] == "flow_alerts"
    assert out["title"] == "Big call sweep"
    assert out["message"] == "NVDA 225C swept"
    assert out["config_name"] == "My flow alerts"


@pytest.mark.parametrize(
    "row",
    [
        None,
        {},
        "a string",
        123,
        [],
        {"tickers": ["spy", "qqq"]},
        {"message": None},
        {"config": "plain-name"},
    ],
)
def test_norm_native_alert_never_raises(row):
    out = A._norm_native_alert(row)
    assert set(out) == {"id", "created_at", "ticker", "noti_type", "title", "message", "config_name"}
    assert all(isinstance(v, str) for v in out.values())


def test_norm_native_alert_tickers_list_picks_first():
    out = A._norm_native_alert({"tickers": ["spy", "qqq"], "description": "tide"})
    assert out["ticker"] == "SPY"
    assert out["message"] == "tide"


# ------------------------------------------------------------------ _norm_config
def test_norm_config_shapes_row():
    out = A._norm_config(
        {
            "id": "df1048e6",
            "name": "Chat Mentioned",
            "status": "active",
            "noti_type": "chat",
            "description": None,
            "created_at": "2026-09-25T11:06:07Z",
            "updated_at": "2026-09-25T11:06:07Z",
            "config": {"self_mentioned": True, "symbols": "all"},
        }
    )
    assert out["id"] == "df1048e6"
    assert out["name"] == "Chat Mentioned"
    assert out["noti_type"] == "chat"
    assert out["status"] == "active"
    assert out["description"] == ""
    assert out["config"] == {"self_mentioned": True, "symbols": "all"}


@pytest.mark.parametrize("row", [None, {}, "x", 7, [], {"config": "nope"}])
def test_norm_config_never_raises(row):
    out = A._norm_config(row)
    assert set(out) == {"id", "name", "noti_type", "status", "description", "created_at", "updated_at", "config"}
    assert isinstance(out["status"], str) and out["status"]
    assert isinstance(out["config"], dict)


# ------------------------------------------------------------------ graceful empty
def test_build_native_alerts_empty(monkeypatch):
    monkeypatch.setattr(A, "UWClient", _EmptyClient)
    out = A.build_native_alerts()
    assert out["count"] == 0
    assert out["alerts"] == []
    assert out["configured"] == []
    assert out["filters"] == []
    assert "no alert configurations" in out["note"]
    assert set(out) == {"generated_at", "count", "configured", "filters", "alerts", "note"}


def test_build_native_alerts_degrades_on_error(monkeypatch):
    monkeypatch.setattr(A, "UWClient", _BoomClient)
    out = A.build_native_alerts()  # must not raise
    assert out["count"] == 0
    assert out["alerts"] == []
    assert out["configured"] == []
    assert out["filters"] == []


def test_build_native_alerts_note_when_configs_but_no_alerts(monkeypatch):
    class C(_EmptyClient):
        def get(self, path, **params):
            if path.endswith("/api/alerts/configuration"):
                return _Resp({"data": [{"id": "1", "name": "Chat", "noti_type": "chat", "status": "active"}]})
            if path.endswith("/api/alerts/filters"):
                return _Resp({})
            return _Resp({"data": []})

    monkeypatch.setattr(A, "UWClient", C)
    out = A.build_native_alerts()
    assert out["count"] == 0
    assert len(out["configured"]) == 1
    assert "none fired yet" in out["note"]


def test_build_alerts_includes_native_without_changing_oi(monkeypatch):
    monkeypatch.setattr(A, "UWClient", _EmptyClient)
    d = A.build_alerts()
    # existing contract intact
    assert d["alerts"] == []
    assert d["counts"] == {"critical": 0, "high": 0, "watch": 0}
    assert "session" in d and "tickers" in d and "total" in d
    # new keys
    assert d["native"] is d["nat"]
    assert d["native"]["count"] == 0
    assert "fetched_at" in d and d["fetched_at"]
