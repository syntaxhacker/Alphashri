"""Bit-exact parity pins for the research/desk indicator and pivot forks.

Expected values below were captured from the pre-consolidation implementations.
They are compared as IEEE-754 bit patterns, so a one-ULP drift fails.
"""
from __future__ import annotations

import struct
import subprocess
import sys
from pathlib import Path

import pytest

from scripts import indicators as desk
from scripts import paper_sensex, paper_sensex_hourly_backtest
from trading import indicators as canonical
from trading.pivot_utils import PivotPoints

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[1]


def _bits(value: float) -> str:
    return struct.pack(">d", value).hex()


def _bars():
    out = []
    for i in range(20):
        high = 100.0 + i * 0.37 + (i % 3) * 0.11
        low = 99.0 + i * 0.31 - (i % 4) * 0.07
        if i == 5:  # a zero-range bar
            high = low = 101.25
        out.append({"high": high, "low": low, "close": (high + low) / 2})
    return out


BARS = _bars()

# Dict candles, positional candles, skipped non-positive/NaN closes and the
# missing-high fallback all exercise distinct branches of the true-range loop.
CANDLES = [
    {"high": 101.0, "low": 100.0, "close": 100.5},
    [0, 100.5, 102.5, 100.2, 101.8, 42],
    {"high": 104.0, "low": 101.0, "close": 103.0},
    {"high": 103.5, "low": 100.0, "close": 0},
    {"high": None, "low": None, "close": 99.0},
    {"high": "n/a", "low": 98.0, "close": 98.5},
    {"high": 100.0, "low": 97.0, "close": float("nan")},
    {"high": 101.5, "low": 99.5, "close": 100.25},
]

CLASSIC_KEYS = ("r3", "r2", "r1", "pp", "s1", "s2", "s3")


@pytest.mark.parametrize(
    ("i", "n", "expected"),
    [
        (0, 14, "0000000000000000"),
        (13, 14, "0000000000000000"),
        (14, 14, "3ff8f2d593bfa24e"),
        (19, 14, "3fff796ac9dfd120"),
        (19, 1, "4003ae147ae147a0"),
        (19, 5, "4001df3b645a1ca6"),
        (5, 6, "0000000000000000"),
        (6, 6, "3ff28f5c28f5c280"),
    ],
)
def test_atr_mean_range_bits(i, n, expected):
    assert _bits(desk.atr_range(BARS, i, n)) == expected
    assert _bits(canonical.atr_mean_range(BARS, i, n)) == expected


@pytest.mark.parametrize(
    ("period", "expected"),
    [
        (0, "4008000000000000"),
        (1, "4008000000000000"),
        (3, "4004000000000000"),
        (14, "40047ae147ae147a"),
        (100, "40047ae147ae147a"),
    ],
)
def test_atr_mean_true_range_bits(period, expected):
    assert _bits(desk.atr_true(CANDLES, period)) == expected
    assert _bits(canonical.atr_mean_true_range(CANDLES, period)) == expected


def test_atr_mean_true_range_empty_and_positional():
    assert desk.atr_true([]) is None
    assert desk.atr_true(None) is None
    assert canonical.atr_mean_true_range([]) is None

    positional = [(0, 0, 105.0, 102.0, 104.0, 1),
                  {"high": 106.0, "low": 104.0, "close": 105.0}]
    assert _bits(desk.atr_true(positional, 2)) == "4000000000000000"
    assert _bits(canonical.atr_mean_true_range(positional, 2)) == "4000000000000000"


@pytest.mark.parametrize(
    ("style", "ohlc", "expected"),
    [
        ("classic", (40000.0, 40150.0, 39900.0, 40080.0), {
            "r3": "40e3be9555555556", "r2": "40e3acaaaaaaaaab",
            "r1": "40e39f5555555556", "pp": "40e38d6aaaaaaaab",
            "s1": "40e3801555555556", "s2": "40e36e2aaaaaaaab",
            "s3": "40e360d555555556",
        }),
        ("fibonacci", (40000.0, 40150.0, 39900.0, 40080.0), {
            "r3": "40e3acaaaaaaaaab", "r2": "40e3a0baaaaaaaab",
            "r1": "40e3995aaaaaaaab", "pp": "40e38d6aaaaaaaab",
            "s1": "40e3817aaaaaaaab", "s2": "40e37a1aaaaaaaab",
            "s3": "40e36e2aaaaaaaab",
        }),
        ("classic", (40000.0, 40150.0, 39900.0, 0), {
            "r3": "40e3b7eaaaaaaaaa", "r2": "40e3a95555555555",
            "r1": "40e398aaaaaaaaaa", "pp": "40e38a1555555555",
            "s1": "40e3796aaaaaaaaa", "s2": "40e36ad555555555",
            "s3": "40e35a2aaaaaaaaa",
        }),
        ("classic", (101.1, 100.9, 100.6, 101.05), {
            "r3": "405959999999999c", "r2": "405949999999999b",
            "r1": "4059466666666668", "pp": "4059366666666667",
            "s1": "4059333333333334", "s2": "4059233333333333",
            "s3": "4059200000000000",
        }),
    ],
)
def test_paper_sensex_pivot_bits(style, ohlc, expected):
    got = paper_sensex.pivot_levels(*ohlc, style=style)
    assert tuple(got) == CLASSIC_KEYS
    assert {k: _bits(v) for k, v in got.items()} == expected


def test_unknown_pivot_style_still_means_classic():
    """The script has always treated any non-fibonacci style as classic."""
    got = paper_sensex.pivot_levels(40000.0, 40150.0, 39900.0, 40080.0,
                                   style="camarilla")
    assert got == paper_sensex.pivot_levels(40000.0, 40150.0, 39900.0, 40080.0)


@pytest.mark.parametrize(
    ("ohlc", "expected"),
    [
        ({"open": 40000.0, "high": 40150.0, "low": 39900.0,
          "close": 40080.0}, {"s1": "40e3801555555556",
                              "r1": "40e39f5555555556"}),
        ({"open": 40000.0, "high": 40150.0, "low": 39900.0,
          "close": 0}, {"s1": "40e3796aaaaaaaaa",
                        "r1": "40e398aaaaaaaaaa"}),
    ],
)
def test_hourly_backtest_pivot_bits(ohlc, expected):
    got = paper_sensex_hourly_backtest.pivot_levels(ohlc)
    assert tuple(got) == ("s1", "r1")
    assert {k: _bits(v) for k, v in got.items()} == expected


def test_scan_levels_rounding_is_unchanged(monkeypatch):
    ohlc = {"open": 40000.0, "high": 40150.0, "low": 39900.0,
            "close": 40080.0, "last": 40100.0}
    monkeypatch.setattr(paper_sensex, "fetch_day_ohlc", lambda token=None: dict(ohlc))
    monkeypatch.setattr(paper_sensex, "fetch_chain", lambda expiry=None, token=None: {"data": []})
    monkeypatch.setattr(paper_sensex, "max_pain", lambda chain, spot: spot)
    out = paper_sensex.scan_levels()
    assert out["pivots"] == {
        "r3": 40436.67, "r2": 40293.33, "r1": 40186.67, "pp": 40043.33,
        "s1": 39936.67, "s2": 39793.33, "s3": 39686.67,
    }
    assert out["next_support"] == 39936.67
    assert out["next_resistance"] == 40150.0


def test_tolerant_candle_getter_has_not_drifted():
    from trading.indicators.volatility import _candle_field

    cases = [
        ({"high": 101.5}, "high", 2, 101.5),
        ({"high": "n/a"}, "high", 2, None),
        ({"high": None}, "high", 2, None),
        ({}, "high", 2, None),
        ([0, 1, 102.0, 99.0], "low", 3, 99.0),
        ([0, 1], "high", 2, None),
        ({"close": float("nan")}, "close", 4, None),
    ]
    for candle, name, idx, expected in cases:
        assert desk.candle_field(candle, name, idx) == expected
        assert _candle_field(candle, name, idx) == expected


def test_script_atr_math_is_delegated(monkeypatch):
    monkeypatch.setattr(desk, "atr_mean_range", lambda bars, i, n=14: "range")
    monkeypatch.setattr(desk, "atr_mean_true_range", lambda candles, period=14: "true")
    assert desk.atr_range(BARS, 19, 5) == "range"
    assert desk.atr_true(CANDLES, 3) == "true"


def test_script_pivot_projection_uses_canonical_fields(monkeypatch):
    sentinel = PivotPoints(pp=1.0, r1=2.0, r2=3.0, r3=4.0,
                           s1=5.0, s2=6.0, s3=7.0)
    monkeypatch.setattr(paper_sensex, "calculate_pivot_points",
                        lambda *args: sentinel)
    assert paper_sensex.pivot_levels(1, 2, 3, 4, style="anything") == {
        "r3": 4.0, "r2": 3.0, "r1": 2.0, "pp": 1.0,
        "s1": 5.0, "s2": 6.0, "s3": 7.0,
    }

    monkeypatch.setattr(paper_sensex_hourly_backtest, "calculate_pivot_points",
                        lambda *args: sentinel)
    assert paper_sensex_hourly_backtest.pivot_levels(
        {"open": 1, "high": 2, "low": 3, "close": 4},
    ) == {"s1": 5.0, "r1": 2.0}


def test_scripts_import_in_fresh_interpreter():
    code = (
        "import sys; sys.path.insert(0, %r); "
        "import scripts.indicators, scripts.paper_sensex, "
        "scripts.paper_sensex_hourly_backtest" % str(ROOT)
    )
    result = subprocess.run([sys.executable, "-c", code], cwd=ROOT,
                            capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
