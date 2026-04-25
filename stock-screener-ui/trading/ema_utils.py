"""Shared EMA calculation - single source of truth for all EMA computations."""
from typing import Optional, Union

def calculate_ema(prices: list, period: int, return_full: bool = False) -> Union[list, float]:
    """
    Calculate EMA matching pandas ewm(span=period, adjust=False).

    Args:
        prices: List of close prices
        period: EMA period
        return_full: If True, return full list with None padding (for series).
                     If False, return only the latest EMA value as float.

    Returns:
        list: [None, ..., EMA_at_period, EMA_at_period+1, ...] if return_full
        float: Latest EMA value if not return_full
    """
    if not prices:
        return ([] if return_full else 0.0)

    if len(prices) < period:
        return ([] if return_full else (prices[-1] if prices else 0.0))

    multiplier = 2.0 / (period + 1)
    ema = sum(prices[:period]) / period  # SMA seed

    if not return_full:
        for price in prices[period:]:
            ema = (price - ema) * multiplier + ema
        return ema
    else:
        result = [None] * (period - 1) + [ema]
        for price in prices[period:]:
            ema = (price - ema) * multiplier + ema
            result.append(ema)
        return result
