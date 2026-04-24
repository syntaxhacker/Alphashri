"""
Shared ORB (Opening Range Breakout) utilities.

Single source of truth for OR calculation logic used by both
paper trading (orb_signals.py) and backtest (backtest/strategies/orb.py).
"""

from datetime import datetime, timedelta
from typing import List, Optional, Dict, Tuple


def calculate_or_levels(
    candles: List[dict],
    or_minutes: int = 45,
    market_open: Tuple[int, int] = (9, 15),
) -> Optional[Dict]:
    """
    Calculate opening range levels from candles.

    Filters candles within the OR period (market_open to market_open + or_minutes)
    and calculates high, low, range, etc.

    This is the SINGLE SOURCE OF TRUTH for OR calculations.

    Args:
        candles: List of candle dicts with 'time', 'open', 'high', 'low', 'close'
        or_minutes: Opening range duration in minutes
        market_open: Market open time as (hour, minute)

    Returns:
        Dict with OR levels or None if insufficient data
    """
    if not candles:
        return None

    or_candles = []
    for candle in candles:
        candle_time = candle.get('time', '')
        if isinstance(candle_time, str):
            try:
                dt = datetime.fromisoformat(candle_time)
            except (ValueError, TypeError):
                continue
        else:
            dt = candle_time

        # Handle timezone-aware datetimes
        if hasattr(dt, 'tzinfo') and dt.tzinfo is not None:
            from config import IST
            dt = dt.astimezone(IST).replace(tzinfo=None)

        # Check if within OR period
        market_open_dt = datetime(dt.year, dt.month, dt.day, *market_open)
        or_end_dt = market_open_dt + timedelta(minutes=or_minutes)

        if market_open_dt <= dt <= or_end_dt:
            or_candles.append(candle)

    if len(or_candles) < 5:  # Need at least 5 candles
        return None

    # Calculate OR levels
    or_high = max(c['high'] for c in or_candles)
    or_low = min(c['low'] for c in or_candles)
    or_open = or_candles[0]['open'] if or_candles else 0
    or_range = or_high - or_low
    or_close = or_candles[-1]['close']
    or_range_pct = (or_range / or_close) * 100 if or_close > 0 else 0

    return {
        'or_high': or_high,
        'or_low': or_low,
        'or_open': or_open,
        'or_range': or_range,
        'or_range_pct': or_range_pct,
        'or_close': or_close,
        'or_candles': len(or_candles),
    }


def is_or_complete(
    current_time: datetime,
    or_minutes: int = 45,
    market_open: Tuple[int, int] = (9, 15),
) -> bool:
    """
    Check if the opening range period is complete.

    Args:
        current_time: Current datetime
        or_minutes: Opening range duration in minutes
        market_open: Market open time as (hour, minute)

    Returns:
        True if current_time is at or after OR end time
    """
    market_open_dt = datetime(
        current_time.year, current_time.month, current_time.day,
        *market_open
    )
    or_end_dt = market_open_dt + timedelta(minutes=or_minutes)
    return current_time >= or_end_dt


def get_or_end_time(
    date: datetime,
    or_minutes: int = 45,
    market_open: Tuple[int, int] = (9, 15),
) -> datetime:
    """
    Get the OR end time for a given date.

    Args:
        date: The date to calculate OR end time for
        or_minutes: Opening range duration in minutes
        market_open: Market open time as (hour, minute)

    Returns:
        Datetime of OR end time
    """
    market_open_dt = datetime(date.year, date.month, date.day, *market_open)
    return market_open_dt + timedelta(minutes=or_minutes)
