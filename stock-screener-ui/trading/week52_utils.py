"""Shared 52-week high calculation - single source of truth."""
from typing import List, Optional


def calculate_52w_high(highs: List[float], period: int = 252, exclude_current: bool = True) -> Optional[float]:
    """
    Calculate 52-week (252 trading days) rolling high.

    Args:
        highs: List of high prices (chronological order)
        period: Lookback period (default 252 = 1 year)
        exclude_current: If True, exclude last value to prevent look-ahead bias

    Returns:
        float: 52-week high, or None if insufficient data
    """
    if not highs:
        return None

    # Determine the window
    if exclude_current:
        # Exclude current bar (last value) to prevent look-ahead bias
        window = highs[:-1] if len(highs) > 1 else []
    else:
        window = highs

    # If window is empty, return None
    if not window:
        return None

    # If we have less than period data, use what we have
    if len(window) > period:
        window = window[-period:]

    return max(window)
