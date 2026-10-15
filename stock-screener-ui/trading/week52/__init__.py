"""52W-high screener: single home for config, keys, math, ranges, job and scan.

Import the public API from here:
    from trading.week52 import fetch_52w_high_data, load_all_52w_ranges
"""
from .math import (
    classify_approach,
    gap_pct_to_52w_high,
    has_live_data,
    is_likely_etf,
    is_plausible_52w_gap,
    is_within_52w_touch_gap,
)
from .ranges import get_52w_range, load_all_52w_ranges
from . import config, keys

__all__ = [
    "classify_approach",
    "gap_pct_to_52w_high",
    "has_live_data",
    "is_likely_etf",
    "is_plausible_52w_gap",
    "is_within_52w_touch_gap",
    "get_52w_range",
    "load_all_52w_ranges",
    "config",
    "keys",
]
