"""Tests for chart_patterns.trendlines.detect_trendlines."""
import numpy as np
import pandas as pd

from chart_patterns import config as pattern_config
from chart_patterns.trendlines import detect_trendlines


def _rising_support_df(n: int = 60) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=n, freq="D", tz="UTC")
    base = 100.0 + 0.3 * np.arange(n)
    high = base + 2.0
    low = base + 0.5
    pivots = [5, 20, 35, 50]
    for p in pivots:
        low[p] = base[p] - 0.5
    return pd.DataFrame(
        {"open": base + 0.5, "high": high, "low": low, "close": base + 0.5, "volume": 1000.0},
        index=idx,
    )


def _descending_resistance_df(n: int = 60) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=n, freq="D", tz="UTC")
    base = 200.0 - 0.3 * np.arange(n)
    low = base - 2.0
    high = base - 0.5
    pivots = [5, 20, 35, 50]
    for p in pivots:
        high[p] = base[p] + 0.5
    return pd.DataFrame(
        {"open": base, "high": high, "low": low, "close": base, "volume": 1000.0},
        index=idx,
    )


def test_rising_support_found():
    res = detect_trendlines(_rising_support_df())
    assert res["support"] is not None
    sup = res["support"]
    assert sup["kind"] == "support"
    assert sup["touches"] >= 2
    assert sup["span_bars"] >= 20


def test_descending_resistance_found():
    res = detect_trendlines(_descending_resistance_df())
    assert res["resistance"] is not None
    r = res["resistance"]
    assert r["kind"] == "resistance"
    assert r["touches"] >= 2
    assert r["span_bars"] >= 20


def test_noisy_series_does_not_crash():
    rng = np.random.default_rng(7)
    n = 80
    idx = pd.date_range("2026-01-01", periods=n, freq="D", tz="UTC")
    close = 100.0 + np.cumsum(rng.normal(0, 1.0, n))
    df = pd.DataFrame(
        {
            "open": close,
            "high": close + np.abs(rng.normal(0.5, 0.5, n)),
            "low": close - np.abs(rng.normal(0.5, 0.5, n)),
            "close": close,
            "volume": 1000.0,
        },
        index=idx,
    )
    res = detect_trendlines(df)
    assert set(res) == {"support", "resistance"}


def test_none_and_empty():
    assert detect_trendlines(None) == {"support": None, "resistance": None}
    assert detect_trendlines(pd.DataFrame()) == {"support": None, "resistance": None}


def test_default_lookback_constant_and_detection_still_works():
    assert pattern_config.TRENDLINE_LOOKBACK_BARS == 400
    res = detect_trendlines(_rising_support_df())
    assert res["support"] is not None


def _long_frame_with_recent_pivots(n: int = 600, side: str = "support") -> pd.DataFrame:
    """Frame longer than the lookback window, pivots only in the trailing window."""
    idx = pd.date_range("2026-01-01", periods=n, freq="D", tz="UTC")
    if side == "support":
        base = 100.0 + 0.3 * np.arange(n)
        high = base + 2.0
        low = base + 0.5
        for p in (n - 150, n - 100, n - 50, n - 20):
            low[p] = base[p] - 0.5
        return pd.DataFrame(
            {"open": base + 0.5, "high": high, "low": low, "close": base + 0.5, "volume": 1000.0},
            index=idx,
        )
    base = 200.0 - 0.3 * np.arange(n)
    low = base - 2.0
    high = base - 0.5
    for p in (n - 150, n - 100, n - 50, n - 20):
        high[p] = base[p] + 0.5
    return pd.DataFrame(
        {"open": base, "high": high, "low": low, "close": base, "volume": 1000.0},
        index=idx,
    )


def test_long_frame_lines_come_from_trailing_window():
    """On a frame longer than the lookback, lines end in the recent bars."""
    for side in ("support", "resistance"):
        df = _long_frame_with_recent_pivots(600, side)
        assert len(df) > 400
        res = detect_trendlines(df)
        line = res[side]
        assert line is not None, f"{side} not found on long frame"
        days = df.index.strftime("%Y-%m-%d").tolist()
        end_day = str(line["end_date"])[:10]
        assert end_day in days
        assert days.index(end_day) >= len(df) - 60
