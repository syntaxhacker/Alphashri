"""Unit tests for api.chart_patterns._slice_candles windowing.

The window must still include the pattern start/end bars but also extend past
``end_date`` so post-breakout price action is visible.
"""
import numpy as np
import pandas as pd

from api.chart_patterns import _slice_candles


def _make_df(n: int) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=n, freq="D", tz="UTC")
    base = np.linspace(100.0, 200.0, n)
    return pd.DataFrame(
        {"open": base, "high": base + 1.0, "low": base - 1.0, "close": base, "volume": 1000.0},
        index=idx,
    )


def test_slice_pads_post_breakout_bars_after_end_date():
    df = _make_df(100)
    start = df.index[59].strftime("%Y-%m-%d")
    end = df.index[69].strftime("%Y-%m-%d")

    series = _slice_candles(df, start, end)

    # Right edge padded ~30 bars past the pattern end (capped at the last bar).
    assert series[-1]["t"][:10] == df.index[99].strftime("%Y-%m-%d")
    assert series[0]["t"][:10] == df.index[54].strftime("%Y-%m-%d")
    assert len(series) == 46

    # The pattern end is retained and there are many bars after it.
    times = [bar["t"][:10] for bar in series]
    assert end in times
    assert sum(1 for t in times if t > end) >= 20


def test_slice_is_capped_but_keeps_pattern_endpoints():
    df = _make_df(500)
    start = df.index[50].strftime("%Y-%m-%d")
    end = df.index[400].strftime("%Y-%m-%d")

    series = _slice_candles(df, start, end, max_bars=160)

    assert len(series) <= 160
    times = [bar["t"][:10] for bar in series]
    assert start in times
    assert end in times


def test_slice_handles_empty_dataframe():
    empty = pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    assert _slice_candles(empty, "2026-01-01", "2026-01-10") == []
    assert _slice_candles(None, "2026-01-01", "2026-01-10") == []
