"""Engine tests: orchestration, dedupe, sorting and edge cases."""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd
import pytest

from chart_patterns.detectors.common import PatternHit
from chart_patterns.engine import _dedupe, detect_patterns

_INDEX = pd.date_range("2024-01-01", periods=200, freq="D", tz="UTC")


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


def interp(anchors, n: int) -> np.ndarray:
    anchors = sorted(anchors)
    return np.interp(
        np.arange(n), [a[0] for a in anchors], [a[1] for a in anchors]
    )


def triple_bottom_frame():
    n = 70
    anchors = [(0, 112), (10, 100), (20, 115), (30, 100), (45, 115), (52, 100), (65, 118)]
    return frame(interp(anchors, n))


def make_hit(conf, family, direction, start, end, pid="double_bottom"):
    return PatternHit(
        pattern_id=pid,
        pattern_name=pid,
        family=family,
        direction=direction,
        status="forming",
        quality="fair",
        confidence=conf,
        start_date=start,
        end_date=end,
        start_price=100.0,
        end_price=110.0,
        breakout_level=110.0,
        target=120.0,
        stop=95.0,
        rr=2.0,
        bars_ago=0,
        volume_confirmed=False,
    )




def test_none_input_returns_empty():
    assert detect_patterns(None, "1D", "RELIANCE") == []


def test_empty_frame_returns_empty():
    empty = pd.DataFrame(
        columns=["open", "high", "low", "close", "volume"],
        index=pd.DatetimeIndex([], tz="UTC"),
    )
    assert detect_patterns(empty, "1D", "RELIANCE") == []


def test_below_min_bars_is_skipped():
    small = frame(np.linspace(100, 120, 40))
    # 1W requires 52 bars.
    assert detect_patterns(small, "1W", "RELIANCE") == []
    # 1D requires 60 -> 40 bars also skipped.
    assert detect_patterns(small, "1D", "RELIANCE") == []


def test_unknown_timeframe_raises():
    with pytest.raises(ValueError):
        detect_patterns(frame(np.linspace(100, 120, 80)), "bogus", "X")




def test_engine_runs_and_fills_symbol_timeframe():
    hits = detect_patterns(triple_bottom_frame(), "1D", "TEST")
    assert hits, "expected at least one pattern on triple-bottom geometry"
    for hit in hits:
        assert hit.symbol == "TEST"
        assert hit.timeframe == "1D"


def test_engine_runs_on_us_provider_style_frame():
    """Provider frames (tz-aware UTC index, int64 volume) need no NSE context."""
    anchors = [(0, 112), (10, 100), (20, 115), (30, 100), (45, 115), (52, 100), (65, 118)]
    n = 70
    close = np.interp(np.arange(n), [a[0] for a in anchors], [a[1] for a in anchors])
    idx = pd.date_range("2026-11-10 14:00", periods=n, freq="min", tz="UTC")
    df = pd.DataFrame(
        {
            "open": np.concatenate([[close[0]], close[:-1]]),
            "high": close + 0.5,
            "low": close - 0.5,
            "close": close,
            "volume": np.full(n, 1000, dtype=np.int64),
        },
        index=idx,
    )
    hits = detect_patterns(df, "1m", "AAPL")
    assert hits
    assert all(h.symbol == "AAPL" and h.timeframe == "1m" for h in hits)
    assert any(h.pattern_id == "triple_bottom" for h in hits)
    # Overlay timestamps stay tz-aware ISO strings, matching the candle series.
    points = [p for line in hits[0].trendlines for p in line]
    assert points and all(p["t"].endswith("+00:00") for p in points)


def test_engine_sorts_by_confidence_desc():
    hits = detect_patterns(triple_bottom_frame(), "1D", "TEST")
    confidences = [h.confidence for h in hits]
    assert confidences == sorted(confidences, reverse=True)


def test_engine_dedupes_overlapping_same_family_direction():
    hits = detect_patterns(triple_bottom_frame(), "1D", "TEST")
    reversal_bullish = [h for h in hits if h.family == "reversal" and h.direction == "bullish"]
    # double/triple bottom overlap; only the higher-confidence one survives.
    assert len(reversal_bullish) == 1




def test_dedupe_keeps_higher_confidence_overlap():
    low = make_hit(40, "reversal", "bullish", "2024-01-01", "2024-03-01", pid="double_bottom")
    high = make_hit(80, "reversal", "bullish", "2024-02-01", "2024-04-01", pid="triple_bottom")
    kept = _dedupe([high, low])  # sorted input, high first
    assert kept == [high]


def test_dedupe_keeps_different_family():
    a = make_hit(80, "reversal", "bullish", "2024-01-01", "2024-03-01")
    b = make_hit(70, "continuation", "bullish", "2024-02-01", "2024-04-01")
    kept = _dedupe([a, b])
    assert len(kept) == 2


def test_dedupe_keeps_different_direction():
    a = make_hit(80, "reversal", "bullish", "2024-01-01", "2024-03-01")
    b = make_hit(70, "reversal", "bearish", "2024-02-01", "2024-04-01")
    assert len(_dedupe([a, b])) == 2


def test_dedupe_keeps_non_overlapping_same_family():
    a = make_hit(80, "reversal", "bullish", "2024-01-01", "2024-03-01")
    b = make_hit(70, "reversal", "bullish", "2024-05-01", "2024-07-01")
    assert len(_dedupe([a, b])) == 2


def test_detector_exception_is_logged_and_isolated(monkeypatch, caplog):
    """A crashing detector must be observable and must not abort the scan."""
    import chart_patterns.engine as E

    def boom(df, ctx):
        raise RuntimeError("detector exploded")

    patched = [
        ("triple_bottom", boom) if pid == "triple_bottom" else (pid, fn)
        for pid, fn in E.DETECTORS
    ]
    monkeypatch.setattr(E, "DETECTORS", patched)

    with caplog.at_level(logging.ERROR, logger="chart_patterns.engine"):
        hits = detect_patterns(triple_bottom_frame(), "1D", "TEST")

    # Other detectors still run; the failing pattern contributes nothing.
    assert hits
    assert all(h.pattern_id != "triple_bottom" for h in hits)
    assert any(h.pattern_id == "rectangle" for h in hits)
    # The failure is logged with enough context to find the offending detector.
    assert any(
        "triple_bottom" in r.getMessage()
        and "TEST" in r.getMessage()
        and r.exc_info is not None
        and "detector exploded" in str(r.exc_info[1])
        for r in caplog.records
    )


def test_detect_patterns_output_is_stable_on_multi_pattern_frame():
    """Regression snapshot: a deterministic multi-pattern frame must keep yielding
    the same hits (pattern, family, direction, status, quality, confidence) so a
    detector performance change cannot silently alter detector output."""
    hits = detect_patterns(triple_bottom_frame(), "1D", "TEST")
    expected = [
        ("triple_bottom", "reversal", "bullish", "confirmed", "strong", 75.0),
        ("rectangle", "continuation", "neutral", "confirmed", "strong", 74.2),
        ("bull_flag", "continuation", "bullish", "forming", "fair", 47.5),
    ]
    actual = [(h.pattern_id, h.family, h.direction, h.status, h.quality, h.confidence)
              for h in hits]
    assert actual == expected, actual
