"""Replay strategy plugin contract.

Defines the stable integration surface for tick-replay strategies so that the
generic ``/api/poc/replay/{strategy_id}`` endpoint can drive any engine without
knowing its internals. Adding a strategy requires only a new engine module plus
one import in ``trading/replay/__init__.py``.

Canonical trade dict shape (produced by every strategy's ``run``):
    {
        "time": int,        # entry time, unix seconds floored to the 1m bar
        "exit_time": int,   # exit time, unix seconds floored to the 1m bar
        "side": str,        # "LONG" | "SHORT"
        "kind": str,        # strategy-specific fill kind, e.g. "inv"/"retest"/"vwap-orb"
        "entry": float,
        "sl": float,
        "tp": float | None, # nullable: structure-trail positions may have no TP
        "exit": float,
        "result": str,      # "TP" | "SL" | "EOD" | "TRAIL" | "REV" | "FLAT" | ...
        "pnl": float,       # points (not currency)
        "rr": float,
        "meta": dict,       # optional strategy-specific extras
    }

Only ``time``/``exit_time`` are guaranteed to be bar-aligned; other keys mirror
what the legacy endpoints already returned so consumers keep working.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

_PARAM_TYPES = {"int", "float", "bool", "select", "text"}


@dataclass
class ParamSpec:
    """Declared query/UI parameter for a replay strategy.

    ``type`` is one of ``int`` | ``float`` | ``bool`` | ``select`` | ``text``.
    Optional fields describe bounds, step, allowed ``options`` (for ``select``)
    and human help text.
    """

    name: str
    label: str
    type: str
    default: Any
    min: float | None = None
    max: float | None = None
    step: float | None = None
    options: list | None = None
    description: str = ""

    def __post_init__(self):
        if self.type not in _PARAM_TYPES:
            raise ValueError(f"invalid ParamSpec type {self.type!r}; want one of {sorted(_PARAM_TYPES)}")

    def to_dict(self) -> dict:
        """JSON-serializable representation (optional keys omitted when unset)."""
        out = {"name": self.name, "label": self.label, "type": self.type, "default": self.default}
        if self.min is not None:
            out["min"] = self.min
        if self.max is not None:
            out["max"] = self.max
        if self.step is not None:
            out["step"] = self.step
        if self.options is not None:
            out["options"] = list(self.options)
        if self.description:
            out["description"] = self.description
        return out


@dataclass
class ReplayContext:
    """Everything an engine needs for one replay run — already loaded, no I/O."""

    date: str
    symbol: str
    params: dict
    ticks: list
    bars: list
    hist_bars: list | None = None
    basis: float | None = None


@dataclass
class StrategyResult:
    """Engine output. ``trades`` uses the canonical shape documented above."""

    trades: list
    zones: list = field(default_factory=list)
    trends: list = field(default_factory=list)
    levels: list = field(default_factory=list)
    kpis: dict = field(default_factory=dict)
    extras: dict = field(default_factory=dict)


@runtime_checkable
class ReplayStrategy(Protocol):
    """Structural contract every replay engine satisfies."""

    id: str
    label: str
    params: list[ParamSpec]
    required_data: set[str]

    def run(self, ctx: ReplayContext) -> StrategyResult:
        ...
