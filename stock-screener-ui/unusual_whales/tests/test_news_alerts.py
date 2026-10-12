"""Unit tests for the news + OI-alert data builders (no network).

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
import news_data as N  # noqa: E402


# ---------------------------------------------------------------- contract parsing
@pytest.mark.parametrize(
    "symbol,typ,expiry,strike",
    [
        ("NVDA260925C00225000", "call", "2026-09-25", 225.0),
        ("SPY260925P00771000", "put", "2026-09-25", 771.0),
        ("AGNC261016P00009000", "put", "2026-10-16", 9.0),
        ("BBD261120C00003500", "call", "2026-11-20", 3.5),
    ],
)
def test_parse_contract(symbol, typ, expiry, strike):
    out = A._parse_contract(symbol)
    assert out["type"] == typ
    assert out["expiry"] == expiry
    assert out["strike"] == strike


def test_parse_contract_bad_input():
    out = A._parse_contract("NOT-A-CONTRACT")
    assert out["type"] == ""
    assert out["strike"] is None


# ---------------------------------------------------------------- severity ladder
@pytest.mark.parametrize(
    "ratio,delta,vol,expected",
    [
        (3.0, 40000, 30000, "critical"),   # big absolute build
        (6.0, 6000, 12000, "critical"),    # small base, explosive ratio
        (2.0, 16000, 16000, "high"),
        (4.0, 100, 16000, "high"),         # ratio-driven
        (1.2, 5000, 5000, "watch"),
        (0.5, 900, 400, "watch"),
    ],
)
def test_severity(ratio, delta, vol, expected):
    assert A._severity(ratio, delta, vol) == expected


# ---------------------------------------------------------------- alert shaping
SAMPLE = {
    "option_symbol": "NVDA260925C00225000",
    "underlying_symbol": "NVDA",
    "curr_oi": 87943,
    "last_oi": 38416,
    "oi_change": "1.2892284464806331",
    "oi_diff_plain": 49527,
    "volume": 260174,
    "trades": 31173,
    "prev_total_premium": "27464957.00",
    "avg_price": "1.0556",
    "days_of_oi_increases": 2,
    "curr_date": "2026-09-25",
}


def test_alert_shapes_row():
    a = A._alert(SAMPLE)
    assert a is not None
    assert a["ticker"] == "NVDA"
    assert a["type"] == "call"
    assert a["expiry"] == "2026-09-25"
    assert a["strike"] == 225.0
    assert a["oi_delta"] == 49527
    assert a["oi_ratio"] == 1.29
    assert a["vol_oi"] == round(260174 / 87943, 2)
    assert a["severity"] == "critical"
    assert a["id"] == "NVDA260925C00225000|2026-09-25"
    assert a["asset_class"] == "stock"
    assert a["notional"] > 0


def test_alert_skips_oi_decreases():
    row = dict(SAMPLE, oi_diff_plain=-5000, oi_change="0.5")
    assert A._alert(row) is None


# ---------------------------------------------------------------- news shaping
def test_news_tickers_normalised_and_deduped():
    assert N._tickers({"tickers": ["nvda", "NVDA", " aapl "]}) == ["NVDA", "AAPL"]
    assert N._tickers({"tickers": "tsla"}) == ["TSLA"]
    assert N._tickers({}) == []


def test_news_item_is_stable():
    row = {
        "created_at": "2026-09-28T11:48:48Z",
        "source": "Blockchain News",
        "headline": "NVDA hovering at $224.93",
        "tickers": ["NVDA"],
        "is_major": True,
        "sentiment": "Bullish",
    }
    it = N._item(row)
    assert it["id"] == "2026-09-28T11:48:48Z|NVDA hovering at $224.93"
    assert it["is_major"] is True
    assert it["sentiment"] == "bullish"  # lower-cased for the UI
    assert it["tickers"] == ["NVDA"]
