"""Pure 52-week math helpers (moved verbatim from api/screener_api/screener_models.py).

Threshold readers and STALE_52W_BREAKOUT_PCT live in .config; bodies below
are byte-identical copies of the originals.
"""

import re
from typing import Optional

from api.utils import _to_float

from .config import (
    STALE_52W_BREAKOUT_PCT,
    retest_window_days,
    touch_eps_pct,
    touched_52w_gap_threshold_pct,
)

__all__ = [
    "is_likely_etf",
    "classify_approach",
    "has_live_data",
    "gap_pct_to_52w_high",
    "is_within_52w_touch_gap",
    "is_plausible_52w_gap",
]

# Liquid/overnight fund names that don't match the generic ETF/BEES/LIQUID rules.
_ETF_EXACT_SYMBOLS = frozenset({
    'AONELIQUID',
    'GROWWLIQID',
    'LIQUIDSHRI',
    'LIQUIDCASE',
    'ELIQUID',
    'LIQUIDBETA',
    'LIQUIDSBI',
    'HDFCLIQUID',
    'SBILIQETF',
})


def is_likely_etf(symbol: Optional[str]) -> bool:
    """Heuristic ETF detection for NSE symbols (liquid funds, BEES, *ETF naming)."""
    s = re.sub(r'[^A-Z0-9]', '', str(symbol or '').upper())
    if not s:
        return False
    if s in _ETF_EXACT_SYMBOLS:
        return True
    if 'ETF' in s:
        return True
    if s.endswith('BEES'):
        return True
    if s.startswith('LIQUID'):
        return True
    return False


def classify_approach(touched_now: bool, days_since_touch: Optional[int], window_days: Optional[int] = None) -> str:
    """Bucket a near-high row as 'touched' | 'retest' | 'fresh'.

    days_since_touch None means no touch found in the bar lookback => fresh
    (callers omit the field entirely when no bar check was performed).
    """
    if touched_now:
        return 'touched'
    w = window_days if window_days is not None else retest_window_days()
    if days_since_touch is not None and days_since_touch <= w:
        return 'retest'
    return 'fresh'


def has_live_data(stock: dict) -> bool:
    """False when TV enrichment missed entirely (RSI/ADX/volume all zero)."""
    if _to_float(stock.get('volume_m'), 0) > 0:
        return True
    if _to_float(stock.get('rsi'), 0) > 0:
        return True
    if _to_float(stock.get('adx'), 0) > 0:
        return True
    return False


def gap_pct_to_52w_high(high: float, price: float) -> Optional[float]:
    """Percent below 52W high (negative = price above high). None if inputs invalid."""
    if high <= 0 or price <= 0:
        return None
    return round(((high - price) / high) * 100, 2)


def is_within_52w_touch_gap(gap_pct: float, threshold_pct: Optional[float] = None) -> bool:
    th = threshold_pct if threshold_pct is not None else touched_52w_gap_threshold_pct()
    return gap_pct < th


def is_plausible_52w_gap(gap_pct: Optional[float]) -> bool:
    """False for stale-high rows (gap far negative) or invalid input."""
    if gap_pct is None:
        return False
    try:
        gap = float(gap_pct)
    except (TypeError, ValueError):
        return False
    import math
    if not math.isfinite(gap):
        return False
    return gap >= -STALE_52W_BREAKOUT_PCT
