"""Wire contract for the agri prices redesign.

Every field is explicit and nullable where data can genuinely be missing —
the API never substitutes zero for an unavailable price or MSP.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

RANGES: tuple[str, ...] = ("1m", "3m", "6m", "1y", "max")
MAX_COMPARE: int = 5


class CommodityOption(BaseModel):
    key: str
    label: str
    group: str
    unit: str


class GroupOption(BaseModel):
    key: str
    label: str


class FiltersPayload(BaseModel):
    ok: bool
    as_of: Optional[str] = None
    freshness_days: Optional[int] = None
    commodities: list[CommodityOption]
    groups: list[GroupOption]
    states: list[str] = Field(default_factory=list)
    districts: list[str] = Field(default_factory=list)
    markets: list[str] = Field(default_factory=list)
    state_districts: dict[str, list[str]] = Field(default_factory=dict)
    district_markets: dict[str, list[str]] = Field(default_factory=dict)


class AppliedFilters(BaseModel):
    commodity: Optional[str] = None
    group: Optional[str] = None
    state: Optional[str] = None
    district: Optional[str] = None
    market: Optional[str] = None
    range: str
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class SeriesPoint(BaseModel):
    date: str
    modal: Optional[float] = None
    min: Optional[float] = None
    max: Optional[float] = None
    arrivals_qtl: Optional[float] = None
    market_count: int = 0


class Quote(BaseModel):
    date: str
    state: str
    district: str
    market: str
    variety: str
    grade: str
    min: Optional[float] = None
    max: Optional[float] = None
    modal: Optional[float] = None
    arrivals_qtl: Optional[float] = None


class Kpis(BaseModel):
    modal: Optional[float] = None
    min: Optional[float] = None
    max: Optional[float] = None
    unit: str
    chg_1w_pct: Optional[float] = None
    chg_1m_pct: Optional[float] = None
    chg_6m_pct: Optional[float] = None
    market_count: int = 0
    arrivals_qtl: Optional[float] = None
    arrivals_unit: str
    msp: Optional[float] = None
    distance_to_msp_pct: Optional[float] = None


class SnapshotRow(BaseModel):
    key: str
    label: str
    group: str
    date: Optional[str] = None
    modal: Optional[float] = None
    min: Optional[float] = None
    max: Optional[float] = None
    markets: int = 0
    chg_1w_pct: Optional[float] = None
    chg_1m_pct: Optional[float] = None
    chg_6m_pct: Optional[float] = None


class ComparisonPoint(BaseModel):
    date: str
    modal: Optional[float] = None


class ComparisonSeries(BaseModel):
    key: str
    label: str
    points: list[ComparisonPoint] = Field(default_factory=list)


class PricesResponse(BaseModel):
    ok: bool
    as_of: Optional[str] = None
    freshness_days: Optional[int] = None
    data_source: str
    filters: AppliedFilters
    kpis: Kpis
    series: list[SeriesPoint] = Field(default_factory=list)
    snapshot: list[SnapshotRow] = Field(default_factory=list)
    quotes: list[Quote] = Field(default_factory=list)
    comparison: list[ComparisonSeries] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class CommoditiesResponse(BaseModel):
    ok: bool
    commodities: list[CommodityOption]
    groups: list[GroupOption] = Field(default_factory=list)


__all__ = [
    "MAX_COMPARE",
    "RANGES",
    "AppliedFilters",
    "CommoditiesResponse",
    "CommodityOption",
    "ComparisonPoint",
    "ComparisonSeries",
    "FiltersPayload",
    "GroupOption",
    "Kpis",
    "PricesResponse",
    "Quote",
    "SeriesPoint",
    "SnapshotRow",
]
