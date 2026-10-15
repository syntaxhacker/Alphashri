"""Centralised chart-patterns tuning constants (env-overridable).

Matches the existing pattern in :mod:`chart_patterns.jobs`
(``PATTERN_SCAN_MAX_QUEUE = int(os.environ.get(...))``): every value reads an
env var with the previous hard-coded literal as the default, so behaviour is
identical unless the operator overrides it.
"""
from __future__ import annotations

import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


TRENDLINE_LOOKBACK_BARS = _int("PATTERN_TRENDLINE_LOOKBACK_BARS", 400)
TRENDLINE_SWING_ORDER = _int("PATTERN_TRENDLINE_SWING_ORDER", 6)
TRENDLINE_SWING_MIN_BARS = _int("PATTERN_TRENDLINE_SWING_MIN_BARS", 500)
TRENDLINE_TOUCH_TOL_ATR = _float("PATTERN_TRENDLINE_TOUCH_TOL_ATR", 0.6)
TRENDLINE_MIN_TOUCHES = _int("PATTERN_TRENDLINE_MIN_TOUCHES", 2)
TRENDLINE_MIN_SPAN = _int("PATTERN_TRENDLINE_MIN_SPAN", 20)
TRENDLINE_ENVELOPE_TOL_ATR = _float("PATTERN_TRENDLINE_ENVELOPE_TOL_ATR", 0.25)
READ_LOOKBACK_BARS = _int("PATTERN_READ_LOOKBACK_BARS", 500)


def trendline_signature() -> str:
    """Short stable string identifying the current trendline detector settings.

    Stored alongside each hit's ``trend_lines`` (``trend_lines_sig``) so reads
    can tell whether stored lines are stale after a detector change. It must
    change whenever any of the trendline constants above change.
    """
    return "|".join((
        str(TRENDLINE_LOOKBACK_BARS),
        str(TRENDLINE_SWING_ORDER),
        str(TRENDLINE_TOUCH_TOL_ATR),
        str(TRENDLINE_MIN_TOUCHES),
        str(TRENDLINE_MIN_SPAN),
        str(TRENDLINE_ENVELOPE_TOL_ATR),
    ))
CARD_MAX_BARS = _int("PATTERN_CARD_MAX_BARS", 160)
CHART_MAX_BARS = _int("PATTERN_CHART_MAX_BARS", 2000)
RESULTS_MAX_LIMIT = _int("PATTERN_RESULTS_MAX_LIMIT", 1000)
CUSTOM_SYMBOLS_MAX = _int("PATTERN_CUSTOM_SYMBOLS_MAX", 200)
LOOKBACK_MIN = _int("PATTERN_LOOKBACK_MIN", 60)
LOOKBACK_MAX = _int("PATTERN_LOOKBACK_MAX", 5000)
