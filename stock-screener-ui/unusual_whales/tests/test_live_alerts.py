"""Unit tests for the live intraday alert normalisers (no network)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import live_alerts as L  # noqa: E402


def test_f_rejects_non_finite():
    assert L._f("nan") == 0.0
    assert L._f("inf") == 0.0
    assert L._f("250000") == 250000.0
    assert L._f(None, 5) == 5.0


def test_side_inference():
    assert L._side("call", ask=100, bid=0) == "bullish"   # bought calls
    assert L._side("call", ask=0, bid=100) == "bearish"   # sold calls
    assert L._side("put", ask=100, bid=0) == "bearish"    # bought puts
    assert L._side("put", ask=0, bid=100) == "bullish"    # sold puts
    assert L._side("", 0, 0) == ""


def test_flow_shape():
    r = {
        "id": "abc",
        "ticker": "nvda",
        "created_at": "2026-09-28T14:00:00Z",
        "type": "call",
        "strike": "200",
        "expiry": "2026-10-16",
        "total_premium": "1250000",
        "total_ask_side_prem": "1000000",
        "total_bid_side_prem": "250000",
        "has_sweep": True,
        "total_size": "500",
        "volume": "1200",
        "open_interest": "3000",
        "volume_oi_ratio": "0.4",
        "alert_rule": "RepeatedHits",
    }
    a = L._flow(r)
    assert a["kind"] == "flow"
    assert a["ticker"] == "NVDA"
    assert a["premium"] == 1250000.0
    assert a["sweep"] is True
    assert a["side"] == "bullish"
    assert a["id"] == "flow:abc"


def test_flow_rejects_zero_premium():
    assert L._flow({"ticker": "X", "total_premium": "0"}) is None


def test_unusual_shape():
    r = {
        "ticker_symbol": "spy",
        "option_symbol": "SPY260928P00770000",
        "option_type": "put",
        "strike": "770",
        "expiry": "2026-09-28",
        "premium": "45844549",
        "volume": "529190",
        "open_interest": "2312",
        "sweep_volume": "25194",
        "last_fill": "2026-09-25T20:14:58Z",
        "ask_side_volume": "400000",
        "bid_side_volume": "100000",
    }
    a = L._unusual(r)
    assert a["kind"] == "unusual"
    assert a["ticker"] == "SPY"
    assert a["premium"] == 45844549.0
    assert a["sweep"] is True
    assert a["side"] == "bearish"
    assert a["asset_class"] == "etf"  # SPY


def test_darkpool_shape_and_ext_flag():
    r = {"ticker": "meta", "premium": "287163", "size": "400", "price": "717.9", "executed_at": "2026-09-25T23:59:43Z", "ext_hour_sold_codes": "extended_hours_trade"}
    a = L._darkpool(r)
    assert a["kind"] == "darkpool"
    assert a["ticker"] == "META"
    assert a["premium"] == 287163.0
    assert a["side"] == "ext"
    assert L._darkpool({"ticker": "X", "premium": "0"}) is None


def test_ttl_phase_keys():
    assert set(L._TTL) == {"open", "premarket", "afterhours", "closed"}
    assert L._TTL["open"] < L._TTL["closed"]
