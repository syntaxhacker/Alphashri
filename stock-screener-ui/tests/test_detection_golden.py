"""Golden regression tests for the detection hot path.

Pins the exact hit set ``(pattern_id, status, base_days, breakout_level,
confidence, start_date, end_date)`` — in engine order — for fixed synthetic
frames plus a few real cached 1D frames. Any optimisation of the detectors,
features or engine must keep these byte-identical; a mismatch here means the
"same results, less CPU" contract is broken.

Real-frame cases skip when the pattern cache is absent (CI) — the synthetic
cases always run.
"""

from __future__ import annotations

import os
import pickle

import numpy as np
import pandas as pd
import pytest

from chart_patterns.detectors.common import DETECTORS, PATTERN_CATALOG, PATTERN_MIN_BARS
from chart_patterns.engine import detect_patterns
from chart_patterns.features import normalize_ohlcv

_INDEX = pd.date_range("2024-01-01", periods=500, freq="D", tz="UTC")
_CACHE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "experiments",
    "data",
    "pattern_cache",
    "candles",
    "1D",
)


def frame(closes, spread: float = 0.5) -> pd.DataFrame:
    close = np.asarray(closes, dtype=float)
    n = len(close)
    return pd.DataFrame(
        {
            "open": np.concatenate([[close[0]], close[:-1]]),
            "high": close + spread,
            "low": close - spread,
            "close": close,
            "volume": np.full(n, 1000.0),
        },
        index=_INDEX[:n],
    )


def sig(hit) -> list:
    return [
        hit.pattern_id,
        hit.status,
        hit.base_days,
        hit.breakout_level,
        hit.confidence,
        hit.start_date,
        hit.end_date,
    ]


def detect(closes, spread: float = 0.5, symbol: str = "SYN") -> list:
    df = normalize_ohlcv(frame(closes, spread))
    return [sig(h) for h in detect_patterns(df, "1D", symbol)]


def _sine_base(n: int = 140, level: float = 100.0, half: float = 2.0):
    i = np.arange(n)
    return level + half * np.sin(i * 2.0 * np.pi / 20.0)


# ---------------------------------------------------------------------------
# Synthetic frames (always run — no cache needed)
# ---------------------------------------------------------------------------


def test_golden_sine_base():
    assert detect(_sine_base()) == [
        ["rectangle", "failed", 0, 102.5, 85.0, "2024-01-16", "2024-05-05"],
        ["triple_bottom", "failed", 0, 102.5, 75.0, "2024-01-16", "2024-02-25"],
    ]


def test_golden_base_then_breakout():
    i = np.arange(120)
    closes = np.concatenate([100.0 + 5.0 * np.sin(i * 2.0 * np.pi / 24.0), [108.0]])
    assert detect(closes) == [
        ["rectangle", "confirmed", 0, 105.5, 85.0, "2024-01-19", "2024-04-12"],
        ["triple_bottom", "confirmed", 0, 105.5, 75.0, "2024-01-19", "2024-04-30"],
    ]


def test_golden_base_then_breakdown():
    i = np.arange(120)
    closes = np.concatenate(
        [100.0 + 5.0 * np.sin(i * 2.0 * np.pi / 24.0), [100.0, 96.0, 92.0, 90.0, 88.0, 91.0]]
    )
    assert detect(closes) == [
        ["consolidation", "failed", 115, 105.5, 75.4, "2024-01-07", "2024-05-01"],
        ["rectangle", "confirmed", 0, 94.5, 73.6, "2024-03-19", "2024-04-12"],
    ]


def test_golden_trend_and_flat_have_no_consolidation():
    assert detect(np.linspace(100, 220, 260)) == [
        ["cup_handle", "confirmed", 0, 212.6236, 65.0, "2024-04-30", "2024-09-16"]
    ]
    assert detect(np.full(160, 100.0)) == []


def test_golden_short_frame_is_empty():
    assert detect(np.linspace(100, 105, 15)) == []


def test_golden_seeded_random_walk():
    rng = np.random.default_rng(42)
    closes = 100 + np.cumsum(rng.normal(0, 1.2, 300))
    # No consolidation: this walk drifts down (first-half mean ~98 → ~89), so its
    # "box" only tests the high early and the low late — a trend, not a range.
    # The stricter both-halves oscillation check (see ``_range_bound_swings``)
    # now rejects it.
    assert detect(closes) == [
        ["inverse_head_shoulders", "failed", 0, 86.14, 59.3, "2024-06-23", "2024-09-20"],
        ["head_shoulders", "failed", 0, 84.0009, 55.8, "2024-07-12", "2024-08-15"],
    ]


# ---------------------------------------------------------------------------
# Real cached frames (skip when the cache is absent)
# ---------------------------------------------------------------------------


def _real(symbol: str):
    path = os.path.join(_CACHE, f"{symbol}.v2.pkl")
    if not os.path.exists(path):
        pytest.skip(f"no cached frame for {symbol}")
    with open(path, "rb") as fh:
        obj = pickle.load(fh)
    df = obj if isinstance(obj, pd.DataFrame) else obj.get("df")
    return [sig(h) for h in detect_patterns(normalize_ohlcv(df), "1D", symbol)]


def test_golden_real_20microns():
    assert _real("20MICRONS") == [
        ["ascending_channel", "failed", 0, 207.95, 72.9, "2026-04-19 18:30", "2026-07-20 18:30"],
        ["consolidation", "failed", 45, 233.53, 68.8, "2026-08-20 18:30", "2026-10-04 18:30"],
        ["descending_channel", "failed", 0, 186.7407, 67.7, "2026-07-07 18:30", "2026-08-10 18:30"],
    ]


def test_golden_real_21stcenmgm():
    assert _real("21STCENMGM") == [
        ["consolidation", "confirmed", 55, 35.5, 71.9, "2026-05-26 18:30", "2026-07-20 18:30"],
        ["ascending_channel", "failed", 0, 46.49, 67.4, "2026-07-08 18:30", "2026-08-18 18:30"],
        ["bear_flag", "forming", 0, 37.24, 62.5, "2026-08-24 18:30", "2026-10-04 18:30"],
    ]


def test_golden_real_360one():
    assert _real("360ONE") == [
        ["ascending_channel", "failed", 0, 1196.8523, 80.8, "2026-04-20 18:30", "2026-08-19 18:30"],
        ["rising_wedge", "failed", 0, 1045.2905, 65.8, "2026-04-06 18:30", "2026-09-27 18:30"],
    ]


# ---------------------------------------------------------------------------
# Pre-gate contract: every registered detector must have a threshold, and the
# gate must be a no-op for frames at/above it (covered by the goldens above).
# ---------------------------------------------------------------------------


def test_pregate_covers_every_detector():
    registered = sorted(pid for pid, _ in DETECTORS)
    assert sorted(PATTERN_MIN_BARS) == registered
    assert set(PATTERN_MIN_BARS) <= set(PATTERN_CATALOG)
    assert all(isinstance(v, int) and v >= 0 for v in PATTERN_MIN_BARS.values())


@pytest.mark.parametrize("n", [24, 30, 40, 59, 60, 120])
def test_pregate_short_frames_match_ungated(n: int, monkeypatch):
    """Engine pre-gate is a no-op: gate-on == gate-off on short 1M frames.

    ``1M`` has ``min_bars=24``, so frames with ``24 <= n < 60`` reach the
    detectors while gates (up to 60) actually skip some of them.
    """
    import chart_patterns.engine as E

    rng = np.random.default_rng(7)
    closes = 50 + np.cumsum(rng.normal(0, 0.8, n))
    df = frame(closes)
    gated = [sig(h) for h in detect_patterns(normalize_ohlcv(df), "1M", "S")]
    monkeypatch.setattr(E, "PATTERN_MIN_BARS", {})
    ungated = [sig(h) for h in detect_patterns(normalize_ohlcv(df), "1M", "S")]
    assert gated == ungated
