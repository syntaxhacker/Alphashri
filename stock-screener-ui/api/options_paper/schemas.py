"""Wire schemas for ``/api/options-paper``.

Mirrors ``src/types/optionsPaper.ts``. Request models accept both camelCase and
snake_case (the dock sends camelCase, curl and older callers send snake_case);
response models use the camelCase keys the frontend normaliser reads first.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class _Loose(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")


class OptionLegInput(_Loose):
    action: str
    opt: str = Field(validation_alias=AliasChoices("opt", "optType", "opt_type", "type"))
    strike: str | float
    lots: int = 1
    instrument_key: str | None = Field(
        default=None, validation_alias=AliasChoices("instrument_key", "instrumentKey")
    )
    # Optional guard: a leg may carry its own expiry, but it must match the
    # order's. Mixed expiries are rejected with a 400 naming this field.
    expiry: str | None = None


class OptionPaperOrderRequest(_Loose):
    underlying: str
    expiry: str
    source: Literal["live", "replay"]
    entry_ts: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("entry_ts", "entryTs", "entry_time", "entryTime"),
    )
    legs: list[OptionLegInput] = Field(default_factory=list)
    slippage_ticks: float = Field(
        default=0.0, validation_alias=AliasChoices("slippage_ticks", "slippageTicks")
    )
    name: str = ""
    notes: str = ""
    dry_run: bool = Field(default=False, validation_alias=AliasChoices("dry_run", "dryRun"))


class AddLegRequest(_Loose):
    """One extra leg appended to an open position after entry."""

    action: str
    opt: str = Field(validation_alias=AliasChoices("opt", "optType", "opt_type", "type"))
    strike: str | float
    lots: int = 1
    instrument_key: str | None = Field(
        default=None, validation_alias=AliasChoices("instrument_key", "instrumentKey")
    )
    entry_ts: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("entry_ts", "entryTs", "entry_time", "entryTime"),
    )
    # Optional guards: a late leg cannot silently belong to another contract.
    expiry: str | None = None
    underlying: str | None = None


class CloseRequest(_Loose):
    premiums: dict[str, float] | None = None


class OptionPaperLegOut(_Loose):
    id: int = 0
    positionId: int = 0
    action: str = "BUY"
    optType: str = "CE"
    strike: float = 0.0
    lots: int = 0
    qty: int = 0
    instrumentKey: str | None = None
    entryTs: str | None = None
    entryPremium: float = 0.0
    markPremium: float | None = 0.0
    markTs: str | None = None
    exitPremium: float | None = None


class OptionPaperPositionOut(_Loose):
    id: int = 0
    uuid: str = ""
    userId: int = 0
    source: str = "live"
    status: str = "open"
    underlying: str = ""
    expiry: str = ""
    name: str = ""
    entryTs: str | None = None
    entrySpot: float = 0.0
    lots: int = 0
    netDebit: float = 0.0
    costsEst: float = 0.0
    maxProfit: float | None = None
    maxLoss: float | None = None
    breakevens: list[float] = Field(default_factory=list)
    realizedPnl: float = 0.0
    closeReason: str | None = None
    closedAt: str | None = None
    notes: str = ""
    legs: list[OptionPaperLegOut] = Field(default_factory=list)
    unrealizedPnl: float = 0.0
    totalPnl: float = 0.0
    markSpot: float = 0.0
    markTs: str | None = None
    dte: int = 0
    createdAt: str | None = None
    updatedAt: str | None = None


class OptionReplayResultOut(_Loose):
    positionId: int | None = None
    underlying: str = ""
    expiry: str = ""
    source: str = ""
    frames: list[dict[str, Any]] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
    coverage: dict[str, Any] = Field(default_factory=dict)
    payoff: dict[str, Any] = Field(default_factory=dict)
    breakevens: list[float] = Field(default_factory=list)
    maxProfit: float = 0.0
    maxLoss: float = 0.0
    skipped: str | None = None


class OptionPaperOrderResultOut(_Loose):
    dryRun: bool = False
    position: OptionPaperPositionOut | None = None
    replay: OptionReplayResultOut | None = None


class OptionPaperPositionListOut(_Loose):
    positions: list[OptionPaperPositionOut] = Field(default_factory=list)


class ReplaySessionOut(_Loose):
    underlying: str = ""
    expiry: str = ""
    date: str = ""
    source: Literal["snapshot", "chain10s", "upstox"] = "snapshot"
    frames: int = 0


class ReplaySessionListOut(_Loose):
    sessions: list[ReplaySessionOut] = Field(default_factory=list)


class ChainSnapshotOut(_Loose):
    t: str = ""
    spot: float = 0.0
    expiry: str = ""
    source: str = ""
    gaps: int = 0
    legs: list[list[float]] = Field(default_factory=list)


__all__ = [
    "OptionLegInput",
    "OptionPaperOrderRequest",
    "AddLegRequest",
    "CloseRequest",
    "OptionPaperLegOut",
    "OptionPaperPositionOut",
    "OptionReplayResultOut",
    "OptionPaperOrderResultOut",
    "OptionPaperPositionListOut",
    "ReplaySessionOut",
    "ReplaySessionListOut",
    "ChainSnapshotOut",
]
