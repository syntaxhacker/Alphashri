"""Swing-cache ctx threading for the continuation detectors.

Covers the perf/patterns-deep-opt change: ``_flag_hit``, ``_find_pennant`` and
``detect_pennant`` now call ``get_swings(df, ctx)`` instead of ``get_swings(df)``,
so they read and populate the frame-level ``ctx["_swings"]`` cache shared by the
engine's other detectors (channels, rectangles, triangles).

Behaviour must be identical: same hits, same fields, same order. These tests pin
both the cache wiring (identity / reuse) and the output equivalence.
"""

from __future__ import annotations

from dataclasses import asdict

import numpy as np
import pandas as pd
import pytest

from chart_patterns import features as F
from chart_patterns.detectors import continuation as C
from chart_patterns.detectors.common import get_swings

_INDEX = pd.date_range("2024-01-01", periods=120, freq="D", tz="UTC")
SWINGS_KEY = (2, 2)  # get_swings default left/right


def _frame(close, high=None, low=None) -> pd.DataFrame:
    close = np.asarray(close, dtype=float)
    n = len(close)
    if high is None:
        high = close + 0.5
    if low is None:
        low = close - 0.5
    return pd.DataFrame(
        {
            "open": np.concatenate([[close[0]], close[:-1]]),
            "high": np.asarray(high, dtype=float),
            "low": np.asarray(low, dtype=float),
            "close": close,
            "volume": np.full(n, 1000.0),
        },
        index=_INDEX[:n],
    )


def _bull_flag_frame() -> pd.DataFrame:
    """Pole 38->48 (100->130), tight consolidation 48->59, breakout above."""
    n = 60
    close = np.interp(
        np.arange(n), [0, 38, 48, n - 1], [100.0, 100.0, 130.0, 126.0]
    )
    return _frame(close)


def _bear_flag_frame() -> pd.DataFrame:
    """Down pole 38->48 (130->100), tight consolidation, breakdown below."""
    n = 60
    close = np.interp(
        np.arange(n), [0, 38, 48, n - 1], [130.0, 130.0, 100.0, 104.0]
    )
    return _frame(close)


def _pennant_frame(converge: bool = True) -> pd.DataFrame:
    """Pole 59->68 (100->112) then a converging consolidation 67->79."""
    n = 80
    close = np.full(n, 100.0)
    high = close + 0.5
    low = close - 0.5
    for i in range(59, 68):
        c = 100 + (112 - 100) * (i - 59) / 8.0
        close[i] = c
        high[i] = c + 0.5
        low[i] = c - 0.5
    for k, i in enumerate(range(67, 80)):
        half = (3.0 - 0.20 * k) if converge else (2.0 + 0.02 * k)
        center = 110.0
        wig = 0.35 * np.sin(k)
        close[i] = center + half * (1 if k % 2 == 0 else -1)
        high[i] = center + half + wig
        low[i] = center - half - wig
    return _frame(close, high, low)


def _normalize(df: pd.DataFrame) -> pd.DataFrame:
    return F.normalize_ohlcv(df)


def _hit_signature(hit) -> dict:
    return asdict(hit)


# ---------------------------------------------------------------------------
# get_swings ctx caching
# ---------------------------------------------------------------------------


def test_get_swings_caches_under_ctx_and_reuses_object():
    df = _normalize(_bull_flag_frame())
    ctx: dict = {}
    first = get_swings(df, ctx)
    assert SWINGS_KEY in ctx["_swings"]
    second = get_swings(df, ctx)
    # Same object returned from the cache (no recompute).
    assert ctx["_swings"][SWINGS_KEY] is first
    assert second is first
    assert first == second


def test_get_swings_without_ctx_does_not_cache():
    df = _normalize(_bull_flag_frame())
    first = get_swings(df, None)
    assert first == get_swings(df, None)  # values stable
    # No ctx -> nothing stored.


# ---------------------------------------------------------------------------
# within-detector cache reuse
# ---------------------------------------------------------------------------


def test_detect_pennant_reuses_cached_swings_across_calls():
    df = _normalize(_pennant_frame())
    ctx: dict = {}
    hits1 = C.detect_pennant(df, ctx)
    assert hits1, "pennant should fire on its geometry"
    assert SWINGS_KEY in ctx["_swings"]
    swings = ctx["_swings"][SWINGS_KEY]
    hits2 = C.detect_pennant(df, ctx)
    # Second call reads the cached swings object instead of recomputing.
    assert ctx["_swings"][SWINGS_KEY] is swings
    assert [_hit_signature(h) for h in hits2] == [_hit_signature(h) for h in hits1]


def test_flag_detector_reuses_cached_swings_across_calls():
    df = _normalize(_bull_flag_frame())
    ctx: dict = {}
    hits1 = C.detect_bull_flag(df, ctx)
    assert hits1, "bull flag should fire on its geometry"
    assert SWINGS_KEY in ctx["_swings"]
    swings = ctx["_swings"][SWINGS_KEY]
    hits2 = C.detect_bull_flag(df, ctx)
    assert ctx["_swings"][SWINGS_KEY] is swings
    assert [_hit_signature(h) for h in hits2] == [_hit_signature(h) for h in hits1]


# ---------------------------------------------------------------------------
# cross-detector sharing: detect_pennant reads a pre-warmed ctx swing cache
# ---------------------------------------------------------------------------


def test_detect_pennant_reads_prewarmed_ctx_swings():
    df = _normalize(_pennant_frame())
    ctx: dict = {}
    swings = get_swings(df, ctx)  # pre-warm the shared cache
    hits = C.detect_pennant(df, ctx)
    assert hits, "pennant should fire on its geometry"
    # detect_pennant (_find_pennant + its own call) reuses the cached object.
    assert ctx["_swings"][SWINGS_KEY] is swings


# ---------------------------------------------------------------------------
# output equivalence: ctx threading must not change hits
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "detect,frame",
    [
        (C.detect_bull_flag, _bull_flag_frame),
        (C.detect_bear_flag, _bear_flag_frame),
        (C.detect_pennant, lambda: _pennant_frame(converge=True)),
    ],
)
def test_ctx_hits_identical_to_empty_ctx(detect, frame):
    df = _normalize(frame())
    empty_hits = detect(df, {})
    ctx_hits = detect(df, {"symbol": "SYN", "timeframe": "1D"})
    assert [_hit_signature(h) for h in empty_hits] == [_hit_signature(h) for h in ctx_hits]


def test_pennant_rejects_flat_consolidation_with_ctx():
    df = _normalize(_pennant_frame(converge=False))
    ctx: dict = {}
    assert C.detect_pennant(df, ctx) == [], "flat consolidation must not be a pennant"
    # Even a rejected scan still populates the shared cache via _find_pennant.
    assert SWINGS_KEY in ctx["_swings"]
