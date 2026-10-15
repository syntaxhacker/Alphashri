"""Unit tests for the Market Pulse data builder (pure helpers, no network).

Run:
    cd stock-screener-ui/unusual_whales
    ../.venv/bin/python -m pytest tests/test_pulse_data.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import pulse_data as P  # noqa: E402


# --------------------------------------------------------------------------- _num
def test_num_parses_numbers_and_strings():
    assert P._num(3) == 3.0
    assert P._num("2.50") == 2.5
    assert P._num("-0.4") == -0.4
    assert P._num(0) == 0.0


@pytest.mark.parametrize("bad", [None, "", "abc", True, False, float("nan"), float("inf"), float("-inf")])
def test_num_rejects_bad_values(bad):
    assert P._num(bad) is None


# ------------------------------------------------------------------- _pulse_latest
def test_pulse_latest_computes_put_call_ratio():
    out = P._pulse_latest(
        {
            "put_txn": 2481427,
            "call_txn": 4145487,
            "sntm_score": 0.25,
            "intvl_sntm_score": -0.35,
            "mkt_sntm": 167.06,
            "trd_dt": "2026-09-25",
            "hr_min": "1620",
        }
    )
    assert out["date"] == "2026-09-25"
    assert out["hr_min"] == "1620"
    assert out["put_call_ratio"] == pytest.approx(2481427 / 4145487)
    assert out["sntm_score"] == 0.25
    assert out["intvl_sntm_score"] == -0.35
    assert out["mkt_sntm"] == 167.06


def test_pulse_latest_zero_call_guard_and_empty():
    assert P._pulse_latest({"call_txn": 0, "put_txn": 5})["put_call_ratio"] is None
    empty = P._pulse_latest({})
    assert empty["call_txn"] is None
    assert empty["put_call_ratio"] is None


# ------------------------------------------------------------------ _pulse_intraday
def test_pulse_intraday_sorts_and_normalises():
    rows = P._pulse_intraday(
        {
            "data": [
                {"hr_min": "1000", "call_txn": 727788, "put_txn": 320965, "sntm_score": 0.39, "intvl_sntm_score": 0.38, "mkt_sntm": 226.75},
                {"hr_min": "0940", "call_txn": 333172, "put_txn": 144894, "sntm_score": 0.39, "intvl_sntm_score": 0.39, "mkt_sntm": 229.94},
                {"hr_min": "", "call_txn": "x"},
                "junk",
            ]
        }
    )
    assert [r["hr_min"] for r in rows] == ["", "0940", "1000"]
    assert rows[1]["call_txn"] == 333172.0
    assert rows[2]["mkt_sntm"] == 226.75
    assert rows[2]["call_txn"] == 727788.0


def test_pulse_intraday_empty():
    assert P._pulse_intraday({}) == []
    assert P._pulse_intraday(None) == []


# ---------------------------------------------------------------- _sentiment_split
RAW_SENTIMENT = [
    {
        "date": "2026-09-25",
        "ticker": "BBAI",
        "direction": "bullish",
        "score": "100.0",
        "components": {"avar": {"value": 0.563248}, "vwks": {"value": 0.096921}},
        "sample_size": 12,
    },
    {
        "date": "2026-09-25",
        "ticker": "IOVA",
        "direction": "bearish",
        "score": "-89.27",
        "components": {"avar": {"value": -0.70481}, "vwks": {"value": -0.065688}},
        "sample_size": 16,
    },
    {"ticker": "SIDEWAYS", "direction": "neutral", "score": "1.0"},
]


def test_sentiment_split_bullish_bearish():
    out = P._sentiment_split(RAW_SENTIMENT)
    assert [r["ticker"] for r in out["bullish"]] == ["BBAI"]
    assert [r["ticker"] for r in out["bearish"]] == ["IOVA"]
    assert out["bullish"][0]["score"] == 100.0
    assert out["bullish"][0]["avar"] == 0.563248
    assert out["bullish"][0]["vwks"] == 0.096921
    assert out["bearish"][0]["score"] == -89.27
    assert out["bearish"][0]["sample_size"] == 16.0


def test_sentiment_split_prefers_top_level_fields():
    row = {
        "ticker": "X",
        "direction": "bullish",
        "score": "5",
        "avar": "0.1",
        "vwks": "0.2",
        "components": {"avar": {"value": 9.9}, "vwks": {"value": 9.9}},
    }
    out = P._sentiment_split([row])["bullish"][0]
    assert out["avar"] == 0.1
    assert out["vwks"] == 0.2


def test_sentiment_split_graceful_empty():
    empty = {"bullish": [], "bearish": []}
    assert P._sentiment_split([]) == empty
    assert P._sentiment_split(None) == empty
    assert P._sentiment_split({"data": []}) == empty


# --------------------------------------------------------------------- _sector_rows
RAW_SECTORS = {
    "data": [
        {"category": "industry", "classification": "Banking", "put_txn": 14126, "call_txn": 44613, "sntm_score": 0.52, "intvl_sntm_score": 0.0, "hr_min": "1620"},
        {"category": "industry", "classification": "Aerospace", "put_txn": 7549, "call_txn": 32342, "sntm_score": 0.62, "intvl_sntm_score": 0.0, "hr_min": "1620"},
        {"category": "industry", "classification": "", "sntm_score": 0.4},
        {"category": "sector", "classification": "Energy", "sntm_score": None, "put_txn": 1},
        "junk",
    ]
}


def test_sector_rows_filters_and_sorts_desc():
    rows = P._sector_rows(RAW_SECTORS)
    assert [r["name"] for r in rows] == ["Aerospace", "Banking"]
    assert rows[0]["sntm_score"] == 0.62
    assert rows[0]["call_txn"] == 32342
    assert rows[0]["category"] == "industry"


def test_sector_rows_graceful_empty():
    assert P._sector_rows({}) == []
    assert P._sector_rows(None) == []


# --------------------------------------------------------------------- _volume_row
def test_volume_row_normalises():
    out = P._volume_row(
        {
            "data": [
                {
                    "date": "2026-09-25",
                    "call_volume": 100,
                    "put_volume": 50,
                    "call_premium": "1000.5",
                    "put_premium": "400",
                }
            ]
        }
    )
    assert out["date"] == "2026-09-25"
    assert out["call_volume"] == 100.0
    assert out["put_volume"] == 50.0
    assert out["call_share"] == pytest.approx(2 / 3)
    assert out["put_call_ratio"] == pytest.approx(0.5)
    assert out["call_premium"] == 1000.5
    assert out["put_premium"] == 400.0


def test_volume_row_graceful_empty():
    out = P._volume_row({})
    assert out["call_volume"] is None
    assert out["put_volume"] is None
    assert out["call_share"] is None
    assert out["put_call_ratio"] is None
