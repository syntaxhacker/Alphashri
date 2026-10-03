"""Pattern detection engine.

``detect_patterns(df, timeframe, symbol)`` runs every registered detector,
dedupes overlapping same-family hits (keeping the higher confidence one) and
returns hits sorted by confidence (descending).
"""

from __future__ import annotations

import pandas as pd

# Import the detectors package for its side effect: every detector registers
# itself into ``detectors.common.DETECTORS``.
from . import detectors  # noqa: F401
from .detectors.common import DETECTORS
from .features import normalize_ohlcv
from .timeframes import get_timeframe


def _overlaps(a, b) -> bool:
    """Date-range overlap using ISO-lexicographic ordering."""
    try:
        return a.start_date <= b.end_date and b.start_date <= a.end_date
    except TypeError:
        return False


def _dedupe(hits: list) -> list:
    """Drop a hit when a higher-confidence same-family/direction hit overlaps."""
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

    hits: list = []
    for _pattern_id, detect in DETECTORS:
        try:
            produced = detect(data, ctx) or []
        except Exception:
            # A single detector must never abort the scan.
            continue
        for hit in produced:
            if hit is None:
                continue
            hit.symbol = symbol
            hit.timeframe = timeframe
            hits.append(hit)

    hits.sort(key=lambda h: h.confidence, reverse=True)
    return _dedupe(hits)
