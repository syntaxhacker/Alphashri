"""Shared timeframe parsing utilities for chart and ORB calculations.

Single source of truth for converting timeframe strings to minutes
and calculating candle counts for OR periods.
"""

TF_TO_MINUTES = {
    '1min': 1,
    '5min': 5,
    '15min': 15,
    '30min': 30,
    '1hour': 60,
    '2hour': 120,
    '4hour': 240,
    '12hour': 720,
    '1day': 1440,
}


def parse_timeframe_minutes(tf: str) -> int:
    """Convert a timeframe string like '15min' or '1hour' to minutes."""
    return TF_TO_MINUTES.get(tf, 5)


def calculate_or_candle_count(or_minutes: int, tf_minutes: int) -> int:
    """Calculate how many candles cover the opening range period.

    Args:
        or_minutes: Duration of the opening range in minutes (e.g. 45)
        tf_minutes: Minutes per candle (e.g. 1, 5, 15, 30, 60)

    Returns:
        Number of candles that fit within the OR period (minimum 1)
    """
    return max(1, or_minutes // tf_minutes)
