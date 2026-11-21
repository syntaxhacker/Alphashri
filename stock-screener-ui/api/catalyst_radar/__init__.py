"""Catalyst Radar -- the Home Monitor's data-derived sector catalyst read.

Public surface:

    from api.catalyst_radar.contract import CatalystToday
    from api.catalyst_radar.router import router

The JSON shape is documented in ``docs/HOME_MONITOR_CONTRACT.md`` and mirrored
by ``src/api/catalysts.ts``. Change one, change the other.
"""

from .contract import (  # noqa: F401
    BREAKING_MAX_AGE_HOURS,
    BREADTH_CONFIRM_RATIO,
    DEFAULT_SECTOR,
    MARKET_LABEL,
    MARKET_SECTOR,
    MOVE_CONFIRM_PCT,
    VOLUME_CONFIRM_REL,
    CatalystCounts,
    CatalystRow,
    CatalystToday,
    Constituent,
    IndexQuote,
    MarketIndices,
    SectorBreadth,
    SectorOption,
    SectorRead,
)
from .router import router  # noqa: F401

__all__ = [
    "BREAKING_MAX_AGE_HOURS",
    "BREADTH_CONFIRM_RATIO",
    "CatalystCounts",
    "CatalystRow",
    "CatalystToday",
    "Constituent",
    "DEFAULT_SECTOR",
    "IndexQuote",
    "MARKET_LABEL",
    "MARKET_SECTOR",
    "MOVE_CONFIRM_PCT",
    "MarketIndices",
    "SectorBreadth",
    "SectorOption",
    "SectorRead",
    "VOLUME_CONFIRM_REL",
    "router",
]
