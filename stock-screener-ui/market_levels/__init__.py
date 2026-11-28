"""Additive market-levels contract: detectors → fused LevelBook.

Existing S/R, pivot and GEX outputs are untouched; adapters wrap them as
``Level`` objects and ``build_level_book`` fuses them without changing any
current API or UI payload.
"""

from .models import (
    FUEL,
    GEX,
    LEVEL_SCHEMA_VERSION,
    MAX_PAIN,
    OI,
    PIVOT,
    PRICE_ACTION,
    RESISTANCE,
    SESSION,
    SUPPORT,
    TRENDLINE,
    WALL,
    DetectorSpec,
    Level,
    LevelBook,
    level_id,
)
from .registry import (
    DETECTORS,
    clear_registry,
    iter_detectors,
    list_specs,
    register,
)
from .fusion import SOURCE_PRECEDENCE, fuse_levels
from .service import build_level_book

__all__ = [
    "LEVEL_SCHEMA_VERSION",
    "SUPPORT",
    "RESISTANCE",
    "PIVOT",
    "FUEL",
    "WALL",
    "MAX_PAIN",
    "TRENDLINE",
    "PRICE_ACTION",
    "GEX",
    "OI",
    "SESSION",
    "Level",
    "LevelBook",
    "level_id",
    "DetectorSpec",
    "DETECTORS",
    "register",
    "iter_detectors",
    "list_specs",
    "clear_registry",
    "SOURCE_PRECEDENCE",
    "fuse_levels",
    "build_level_book",
]
