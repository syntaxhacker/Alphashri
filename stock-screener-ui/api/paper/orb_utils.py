"""ORB (Opening Range Breakout) signal computation utilities."""

from datetime import datetime, timedelta
import config


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
    """Calculate classic pivot points."""
    pp = (prev_high + prev_low + prev_close) / 3
    return {
        "PP": pp,
        "R1": 2 * pp - prev_low,
        "S1": 2 * pp - prev_high,
        "R2": pp + (prev_high - prev_low),
        "S2": pp - (prev_high - prev_low),
    }
