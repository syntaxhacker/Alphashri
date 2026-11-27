"""Deprecated compatibility shim; canonical code lives in ``trading.week52.ranges``."""
from trading.week52.ranges import (
    SessionLocal,
    _sanitize_52w_range_entry,
    _sanitize_52w_ranges_bulk,
    get_52w_range,
    load_all_52w_ranges,
)

__all__ = [
    "get_52w_range",
    "load_all_52w_ranges",
    "_sanitize_52w_range_entry",
    "_sanitize_52w_ranges_bulk",
    "SessionLocal",
]
