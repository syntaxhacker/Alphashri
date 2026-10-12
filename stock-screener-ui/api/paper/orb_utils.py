"""ORB signal computation utilities.

Single source for OR levels is trading/orb_utils.py (calculate_or_levels, is_or_complete).
This module provides paper-API-specific helpers (score, pivots) and re-exports
the canonical OR-level functions for callers that previously imported from here.
"""

from datetime import datetime, timedelta
import config

# Re-export canonical OR-level logic (single source of truth in trading/orb_utils)
from trading.orb_utils import calculate_or_levels, is_or_complete, get_or_end_time  # noqa: F401


def compute_orb_score(current_price: float, or_high: float, or_low: float) -> float:
    """Compute ORB signal strength score."""
    if or_high == or_low:
        return 0.0
    or_range = or_high - or_low
    if or_range <= 0:
        return 0.0
    or_mid = (or_high + or_low) / 2
    distance_pct = abs(current_price - or_mid) / or_range * 100
    return round(min(100, max(0, distance_pct)), 1)


def calculate_pivot_points(prev_high: float, prev_low: float, prev_close: float) -> dict:
    """Classic pivot points — delegates to the single source of truth."""
    from trading.pivot_utils import calculate_pivot_points as _pivot

    p = _pivot(prev_high, prev_low, prev_close, "classic")
    return {"PP": p.pp, "R1": p.r1, "S1": p.s1, "R2": p.r2, "S2": p.s2}
