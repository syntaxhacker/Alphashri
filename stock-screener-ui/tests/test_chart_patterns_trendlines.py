"""Tests for chart_patterns.trendlines.detect_trendlines."""
import numpy as np
import pandas as pd

from chart_patterns import config as pattern_config
from chart_patterns.trendlines import (
    detect_trendlines,
    window_matches,
    window_signature,
)


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


def test_nan_bar_keeps_nan_tolerant_pivots_and_line_fields():
    """A NaN in bar 0 admits an extra near-boundary pivot at bar 2.

    The strict fractal scan would report 4 touches; the NaN-tolerant one used
    by the detector reports 5. Both sides' exact line fields are pinned here.
    """
    support = _rising_support_df()
    support.iloc[0, support.columns.get_loc("low")] = np.nan
    assert detect_trendlines(support) == {
        "support": {
            "kind": "support",
            "start_date": "2026-01-06T00:00:00+00:00",
            "start_price": 101.0,
            "end_date": "2026-02-20T00:00:00+00:00",
            "end_price": 114.5,
            "slope": 0.3,
            "touches": 5,
            "span_bars": 45,
            "violations": 0,
        },
        "resistance": None,
    }

    resistance = _descending_resistance_df()
    resistance.iloc[0, resistance.columns.get_loc("high")] = np.nan
    assert detect_trendlines(resistance) == {
        "support": None,
        "resistance": {
            "kind": "resistance",
            "start_date": "2026-01-06T00:00:00+00:00",
            "start_price": 199.0,
            "end_date": "2026-02-20T00:00:00+00:00",
            "end_price": 185.5,
            "slope": -0.3,
            "touches": 5,
            "span_bars": 45,
            "violations": 0,
        },
    }


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


def test_explicit_lookback_uses_trailing_window():
    """`lookback_bars=200` runs detection over the last 200 bars only."""
    for side in ("support", "resistance"):
        df = _long_frame_with_recent_pivots(600, side)
        res = detect_trendlines(df, lookback_bars=200)
        line = res[side]
        assert line is not None, f"{side} not found with lookback_bars=200"
        days = df.index.strftime("%Y-%m-%d").tolist()
        end_day = str(line["end_date"])[:10]
        assert end_day in days
        assert days.index(end_day) >= len(df) - 60


def test_invalid_lookback_falls_back_to_default():
    """Non-positive/non-int lookbacks behave exactly like the default."""
    df = _long_frame_with_recent_pivots(600, "support")
    expected = detect_trendlines(df)
    for bad in (None, 0, -5, "200", 3.5):
        assert detect_trendlines(df, lookback_bars=bad) == expected


def test_min_touches_guard_rejects_lines(monkeypatch):
    """An unsatisfiable touches guard yields no lines (no crash)."""
    df = _rising_support_df()
    assert detect_trendlines(df)["support"] is not None
    monkeypatch.setattr(pattern_config, "TRENDLINE_MIN_TOUCHES", 10**6)
    res = detect_trendlines(df)
    assert res == {"support": None, "resistance": None}


def test_min_span_guard_rejects_lines(monkeypatch):
    """An unsatisfiable span guard yields no lines (no crash)."""
    df = _descending_resistance_df()
    assert detect_trendlines(df)["resistance"] is not None
    monkeypatch.setattr(pattern_config, "TRENDLINE_MIN_SPAN", 10**6)
    res = detect_trendlines(df)
    assert res == {"support": None, "resistance": None}


def test_malformed_frame_returns_empty_without_raising():
    """Frames without OHLC columns yield both None instead of raising."""
    idx = pd.date_range("2026-01-01", periods=60, freq="D", tz="UTC")
    bad = pd.DataFrame({"foo": range(60), "bar": range(60)}, index=idx)
    assert detect_trendlines(bad) == {"support": None, "resistance": None}


def test_signature_changes_with_config(monkeypatch):
    """`trendline_signature` tracks every detector constant."""
    base = pattern_config.trendline_signature()
    assert isinstance(base, str) and base
    monkeypatch.setattr(pattern_config, "TRENDLINE_MIN_TOUCHES", 999)
    assert pattern_config.trendline_signature() != base
    monkeypatch.setattr(pattern_config, "TRENDLINE_MIN_SPAN", 999)
    assert pattern_config.trendline_signature() != base
    monkeypatch.setattr(pattern_config, "TRENDLINE_TOUCH_TOL_ATR", 123.456)
    assert pattern_config.trendline_signature() != base
    monkeypatch.setattr(pattern_config, "TRENDLINE_ENVELOPE_TOL_ATR", 123.456)
    assert pattern_config.trendline_signature() != base
    monkeypatch.setattr(pattern_config, "TRENDLINE_SWING_ORDER", 999)
    assert pattern_config.trendline_signature() != base
    monkeypatch.setattr(pattern_config, "TRENDLINE_LOOKBACK_BARS", 999)
    assert pattern_config.trendline_signature() != base


# ---------------------------------------------------------------------------
# window_signature / window_matches: proving stored lines still apply.
# ---------------------------------------------------------------------------


def test_window_signature_is_stable_and_length_tagged():
    df = _rising_support_df()
    sig = window_signature(df)
    assert sig and sig == window_signature(df.copy())
    length, _, digest = sig.partition(":")
    assert 0 < int(length) <= len(df)
    assert len(digest) == 16


def test_window_signature_tracks_the_trailing_window_not_the_head():
    """Same tail, different head → same lines on the default window."""
    full = _rising_support_df(400)
    tail_only = full.iloc[-pattern_config.TRENDLINE_LOOKBACK_BARS:]
    assert window_signature(full) == window_signature(tail_only)


def test_window_signature_changes_when_the_trail_changes():
    """A new/edited bar in the window must invalidate the fingerprint."""
    df = _rising_support_df(120)
    edited = df.copy()
    edited.iloc[-1, edited.columns.get_loc("close")] += 1.0
    assert window_signature(df) != window_signature(edited)


def test_window_signature_honours_an_explicit_length():
    df = _rising_support_df(300)
    short = window_signature(df, 120)
    assert short and short.startswith("120:")
    assert short != window_signature(df)
    assert window_matches(short, df)


def test_window_matches_rejects_mismatched_or_missing_signatures():
    df = _rising_support_df(120)
    other = _descending_resistance_df(120)
    assert window_matches(window_signature(df), df)
    assert not window_matches(window_signature(other), df)
    assert not window_matches(None, df)
    assert not window_matches("", df)
    assert not window_matches("not-a-signature", df)


def test_window_signature_ignores_an_in_progress_trailing_bar():
    """The read path has no tape bar, so its presence must not block reuse."""
    df = _rising_support_df(120)
    with_partial = df.copy()
    with_partial.attrs["partial_today"] = True
    assert window_signature(with_partial) == window_signature(df.iloc[:-1])


def test_window_signature_none_for_missing_or_malformed_frames():
    assert window_signature(None) is None
    assert window_signature(pd.DataFrame()) is None
    idx = pd.date_range("2026-01-01", periods=40, freq="D", tz="UTC")
    assert window_signature(pd.DataFrame({"foo": range(40)}, index=idx)) is None
