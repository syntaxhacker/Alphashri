"""Pattern detection engine.

``detect_patterns(df, timeframe, symbol)`` runs every registered detector,
dedupes overlapping same-family hits (keeping the higher confidence one) and
returns hits sorted by confidence (descending).
"""

from __future__ import annotations

import logging

import pandas as pd

logger = logging.getLogger(__name__)

# Import the detectors package for its side effect: every detector registers
# itself into ``detectors.common.DETECTORS``.
from . import detectors  # noqa: F401
from .detectors.common import DETECTORS, PATTERN_MIN_BARS
from .features import normalize_ohlcv
from .timeframes import get_timeframe


def _overlaps(a, b) -> bool:
    """Date-range overlap using ISO-lexicographic ordering."""
    try:
        return a.start_date <= b.end_date and b.start_date <= a.end_date
    except TypeError:
        return False


def _dedupe(hits: list) -> list:
    kept: list = []
    for hit in hits:  # already sorted confidence desc
        duplicate = False
        for k in kept:
            if (
                k.family == hit.family
                and k.direction == hit.direction
                and _overlaps(k, hit)
            ):
                duplicate = True
                break
        if not duplicate:
            kept.append(hit)
    return kept


def detect_patterns(
    df: pd.DataFrame | None, timeframe: str, symbol: str = ""
) -> list:
    """Detect all patterns in ``df`` for ``timeframe`` and ``symbol``.

    Returns ``[]`` when ``df`` is ``None``/empty or has fewer than the
    timeframe's ``min_bars``. Raises ``ValueError`` for an unknown timeframe.
    """
    spec = get_timeframe(timeframe)
    data = normalize_ohlcv(df)
    if data is None or len(data) < spec.min_bars:
        return []

    ctx = {
        "symbol": symbol,
        "timeframe": timeframe,
        "min_bars": spec.min_bars,
    }
    # One ``ctx`` is shared by every detector in this call, so the frame-level
    # ``get_swings`` cache is computed once per symbol, not once per detector.
    # Detectors that cannot fire on a frame this short are skipped up front;
    # each threshold mirrors the detector's own early exit (see
    # ``PATTERN_MIN_BARS``), so skipping never changes the hit set. Cache-only
    # ``ctx`` entries are pure functions of the frame, so skipping a detector
    # cannot alter what a later detector computes.
    n_bars = len(data)

    hits: list = []
    for pattern_id, detect in DETECTORS:
        if n_bars < PATTERN_MIN_BARS.get(pattern_id, 0):
            continue
        try:
            produced = detect(data, ctx) or []
        except Exception:
            # Isolate the failure, but never swallow it silently: a crashing
            # detector would otherwise vanish from every scan with no signal.
            logger.exception(
                "chart-pattern detector failed (pattern=%s symbol=%s timeframe=%s)",
                pattern_id, symbol, timeframe,
            )
            continue
        for hit in produced:
            if hit is None:
                continue
            hit.symbol = symbol
            hit.timeframe = timeframe
            hits.append(hit)

    hits.sort(key=lambda h: h.confidence, reverse=True)
    return _dedupe(hits)
