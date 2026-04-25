"""
Shared pivot point calculation utilities.

Provides a single source of truth for pivot point calculations used by both
live trading signals (trading/sr_breakout_signals.py) and backtest strategies
(backtest/strategies/sr_breakout.py).

All calculations use previous day's HLC data to avoid look-ahead bias.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class PivotPoints:
    """Pivot point levels for all supported types."""
    pp: float  # Pivot Point
    r1: float  # Resistance 1
    r2: float  # Resistance 2
    r3: float  # Resistance 3
    s1: float  # Support 1
    s2: float  # Support 2
    s3: float  # Support 3
    r4: Optional[float] = None  # Resistance 4 (Camarilla only)
    s4: Optional[float] = None  # Support 4 (Camarilla only)


def calculate_pivot_points(
    prev_high: float,
    prev_low: float,
    prev_close: float,
    pivot_type: str = "classic"
) -> PivotPoints:
    """
    Calculate pivot points from previous day's HLC data.

    Args:
        prev_high: Previous day's high
        prev_low: Previous day's low
        prev_close: Previous day's close
        pivot_type: 'classic', 'fibonacci', or 'camarilla'

    Returns:
        PivotPoints with all levels calculated

    Notes:
        - Classic/Fibonacci: PP = (H + L + C) / 3
        - Camarilla: Uses close as base for R1-R4/S1-S4 (standard formula)
          R1 = C + (H - L) * 0.0917, etc.
    """
    hl = prev_high - prev_low

    if pivot_type == "fibonacci":
        pp = (prev_high + prev_low + prev_close) / 3
        return PivotPoints(
            pp=pp,
            r1=pp + 0.382 * hl,
            r2=pp + 0.618 * hl,
            r3=pp + 1.000 * hl,
            s1=pp - 0.382 * hl,
            s2=pp - 0.618 * hl,
            s3=pp - 1.000 * hl,
        )

    elif pivot_type == "camarilla":
        pp = (prev_high + prev_low + prev_close) / 3
        # Standard Camarilla: use close as base (not high/low)
        # Using exact fractions: 1.1/12, 1.1/6, 1.1/4, 1.1/2
        r1 = prev_close + hl * 1.1 / 12
        r2 = prev_close + hl * 1.1 / 6
        r3 = prev_close + hl * 1.1 / 4
        r4 = prev_close + hl * 1.1 / 2
        s1 = prev_close - hl * 1.1 / 12
        s2 = prev_close - hl * 1.1 / 6
        s3 = prev_close - hl * 1.1 / 4
        s4 = prev_close - hl * 1.1 / 2
        return PivotPoints(
            pp=pp,
            r1=r1, r2=r2, r3=r3, r4=r4,
            s1=s1, s2=s2, s3=s3, s4=s4,
        )

    else:  # classic (default)
        pp = (prev_high + prev_low + prev_close) / 3
        return PivotPoints(
            pp=pp,
            r1=2 * pp - prev_low,
            r2=pp + hl,
            r3=prev_high + 2 * (pp - prev_low),
            s1=2 * pp - prev_high,
            s2=pp - hl,
            s3=prev_low - 2 * (prev_high - pp),
        )
