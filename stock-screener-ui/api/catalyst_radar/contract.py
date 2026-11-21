"""Response contract for the Home Monitor Catalyst Radar.

The sector list is derived from the live market snapshot: raw TradingView
sector names become selector options, and the selected sector's rows come from
the same frame. There is deliberately no hand-maintained sector or constituent
list here -- adding a sector is a data change, not a code change.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal, Optional

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Taxonomies (mirrored by src/api/catalysts.ts)
# --------------------------------------------------------------------------- #

CatalystScore = Literal["high", "medium", "low"]
CatalystState = Literal["scheduled", "breaking", "confirmed", "fading"]
CatalystKind = Literal["news", "event", "positioning"]

MOVE_CONFIRM_PCT: Final[float] = 1.0
VOLUME_CONFIRM_REL: Final[float] = 1.5
BREADTH_CONFIRM_RATIO: Final[float] = 0.6
BREAKING_MAX_AGE_HOURS: Final[float] = 6.0

#: No selection means the whole market. The UI prepends this option to the
#: data-derived sector list.
DEFAULT_SECTOR: Final[str] = "all"
MARKET_SECTOR: Final[str] = "all"
MARKET_LABEL: Final[str] = "MARKET"


@dataclass(frozen=True, slots=True)
class Constituent:
    """One snapshot row promoted to a news-matchable constituent."""

    symbol: str
    name: str
    aliases: tuple[str, ...]
    sector: Optional[str] = None


# --------------------------------------------------------------------------- #
# Response models
# --------------------------------------------------------------------------- #


class IndexQuote(BaseModel):
    last: Optional[float] = None
    change_pct: Optional[float] = None


class MarketIndices(BaseModel):
    nifty: Optional[IndexQuote] = None
    sensex: Optional[IndexQuote] = None
    vix: Optional[float] = None


class SectorBreadth(BaseModel):
    advancing: int = Field(default=0, ge=0)
    declining: int = Field(default=0, ge=0)
    total: int = Field(default=0, ge=0)


class SectorRead(BaseModel):
    id: str = MARKET_SECTOR
    label: str = MARKET_LABEL
    change_pct: Optional[float] = None
    relative_strength_pct: Optional[float] = None
    breadth: SectorBreadth = Field(default_factory=SectorBreadth)


class SectorOption(BaseModel):
    """One data-derived value in the Monitor sector selector."""

    id: str
    label: str
    count: int = 0


class CatalystRow(BaseModel):
    """One catalyst. ``headline`` is a real article title or ``None``."""

    symbol: str
    name: Optional[str] = None
    sector: Optional[str] = None
    kind: CatalystKind
    headline: Optional[str] = None
    source: Optional[str] = None
    source_url: Optional[str] = None
    first_seen: str
    event_at: Optional[str] = None
    state: CatalystState
    score: CatalystScore
    confidence: float = Field(ge=0.0, le=1.0)
    move_pct: Optional[float] = None
    rel_volume: Optional[float] = None
    reasons: list[str] = Field(default_factory=list)
    invalidates: list[str] = Field(default_factory=list)


class CatalystCounts(BaseModel):
    high: int = 0
    medium: int = 0
    low: int = 0
    total: int = 0


class CatalystToday(BaseModel):
    """``GET /api/catalysts/today`` payload."""

    as_of: str
    market: MarketIndices = Field(default_factory=MarketIndices)
    sector: SectorRead = Field(default_factory=SectorRead)
    available_sectors: list[SectorOption] = Field(default_factory=list)
    rows: list[CatalystRow] = Field(default_factory=list)
    counts: CatalystCounts = Field(default_factory=CatalystCounts)
    warnings: list[str] = Field(default_factory=list)


__all__ = [
    "BREAKING_MAX_AGE_HOURS",
    "BREADTH_CONFIRM_RATIO",
    "CatalystCounts",
    "CatalystKind",
    "CatalystRow",
    "CatalystScore",
    "CatalystState",
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
]
