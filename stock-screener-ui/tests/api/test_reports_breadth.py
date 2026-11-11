"""Breadth endpoint: shape, % change, up-count, and graceful failure."""

from __future__ import annotations

import pytest

from api.reports_api import breadth


@pytest.fixture(autouse=True)
def _reset_cache():
    breadth._cache["payload"] = None
    breadth._cache["at"] = 0.0
    yield
    breadth._cache["payload"] = None
    breadth._cache["at"] = 0.0


def _quote(last: float, close: float) -> dict:
    return {"last_price": last, "ohlc": {"close": close}}


def test_breadth_computes_change_and_up_count(monkeypatch):
    data = {
        "NSE_INDEX|Nifty 50": _quote(22_600, 22_687),
        "NSE_INDEX|Nifty Bank": _quote(54_200, 54_300),
        "NSE_INDEX|NIFTY MIDCAP 150": _quote(19_800, 20_600),
        "NSE_INDEX|Nifty Smallcap 500": _quote(18_600, 19_300),
        "NSE_INDEX|Nifty 500": _quote(21_400, 21_600),
    }
    monkeypatch.setattr(
        "scripts.upstox_common.get",
        lambda *a, **k: {"data": data},
    )
    out = breadth.get_breadth()
    assert out["available"] is True
    assert out["count"] == 5
    assert out["up"] == 0
    small = next(r for r in out["rows"] if r["label"] == "SMALL")
    assert small["change_pct"] == pytest.approx(-3.63, abs=0.01)


def test_breadth_is_unavailable_without_quotes(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no Upstox token")

    monkeypatch.setattr("scripts.upstox_common.get", boom)
    out = breadth.get_breadth()
    assert out["available"] is False
    assert out["count"] == 0
    assert len(out["rows"]) == 5  # shape stays stable for the UI


def test_breadth_caches_for_a_minute(monkeypatch):
    calls = {"n": 0}

    def fake(*a, **k):
        calls["n"] += 1
        return {"data": {"NSE_INDEX|Nifty 50": _quote(22_600, 22_687)}}

    monkeypatch.setattr("scripts.upstox_common.get", fake)
    breadth.get_breadth()
    breadth.get_breadth()
    assert calls["n"] == 1
