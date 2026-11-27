"""Frozen value objects shared by every market-levels detector and consumer.

This module is deliberately stdlib-only: adapters, services and API layers can
import the contract without pulling in I/O dependencies.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from typing import Any, Optional

LEVEL_SCHEMA_VERSION = 1

# Kinds. ``PIVOT`` and ``TRENDLINE`` double as source values: the identifiers
# below are the canonical strings for both roles.
SUPPORT = "support"
RESISTANCE = "resistance"
PIVOT = "pivot"
FUEL = "fuel"
WALL = "wall"
MAX_PAIN = "max_pain"
TRENDLINE = "trendline"

# Sources.
PRICE_ACTION = "price_action"
GEX = "gex"
OI = "oi"
SESSION = "session"

_GEOMETRIES = ("horizontal", "zone", "segment")
_SIDES = ("below", "above", "inside")


def _checked_finite(name: str, value: Any) -> None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a finite number, got {value!r}") from None
    if not math.isfinite(number):
        raise ValueError(f"{name} must be finite, got {value!r}")


@dataclass(frozen=True)
class Level:
    """One immutable level observation with its provenance attached."""

    id: str
    symbol: str
    timeframe: str
    as_of: str
    kind: str
    source: str
    geometry: str = "horizontal"
    price: Optional[float] = None
    bottom: Optional[float] = None
    top: Optional[float] = None
    side: Optional[str] = None
    strength: Optional[float] = None
    touches: Optional[int] = None
    start_price: Optional[float] = None
    end_price: Optional[float] = None
    start_as_of: Optional[str] = None
    end_as_of: Optional[str] = None
    evidence: dict = field(default_factory=dict)
    detector_version: str = ""
    schema_version: int = LEVEL_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.geometry not in _GEOMETRIES:
            raise ValueError(
                f"geometry must be one of {_GEOMETRIES}, got {self.geometry!r}"
            )
        if self.side is not None and self.side not in _SIDES:
            raise ValueError(f"side must be one of {_SIDES}, got {self.side!r}")

        has_price = self.price is not None
        has_zone = self.bottom is not None and self.top is not None
        has_segment = self.start_price is not None and self.end_price is not None
        if not (has_price or has_zone or has_segment):
            raise ValueError(
                "level needs price, bottom+top, or start_price+end_price"
            )
        if self.geometry == "segment":
            if not has_segment:
                raise ValueError(
                    "segment geometry requires start_price+end_price"
                )
            if self.start_as_of is None or self.end_as_of is None:
                raise ValueError(
                    "segment geometry requires start_as_of and end_as_of, got "
                    f"start_as_of={self.start_as_of!r}, end_as_of={self.end_as_of!r}"
                )
            if has_price or has_zone:
                raise ValueError(
                    "segment geometry cannot use price or bottom/top"
                )

        for name in ("price", "bottom", "top", "start_price", "end_price"):
            value = getattr(self, name)
            if value is not None:
                _checked_finite(name, value)
        if self.strength is not None:
            _checked_finite("strength", self.strength)

        if has_zone and float(self.bottom) > float(self.top):
            raise ValueError(
                f"bottom must be <= top, got {self.bottom!r} > {self.top!r}"
            )
        if self.strength is not None and not 0.0 <= float(self.strength) <= 1.0:
            raise ValueError(
                f"strength must be between 0 and 1, got {self.strength!r}"
            )
        if not isinstance(self.schema_version, int) or isinstance(
            self.schema_version, bool
        ) or self.schema_version <= 0:
            raise ValueError(
                f"schema_version must be a positive integer, got {self.schema_version!r}"
            )
        if self.evidence is None:
            object.__setattr__(self, "evidence", {})

    def __hash__(self) -> int:
        return hash(self.id)


@dataclass(frozen=True)
class LevelBook:
    """Fused, immutable level snapshot for one symbol/timeframe/as-of."""

    symbol: str
    timeframe: str
    as_of: str
    spot: Optional[float] = None
    levels: tuple[Level, ...] = ()
    schema_version: int = LEVEL_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.spot is not None:
            _checked_finite("spot", self.spot)
        if not isinstance(self.levels, tuple):
            raise ValueError(
                f"levels must be a tuple, got {type(self.levels).__name__}"
            )
        if (
            not isinstance(self.schema_version, int)
            or isinstance(self.schema_version, bool)
            or self.schema_version < 1
        ):
            raise ValueError(
                "schema_version must be a positive integer, got "
                f"{self.schema_version!r}"
            )


def level_id(
    source: str,
    kind: str,
    as_of: str,
    *,
    price: Optional[float] = None,
    bottom: Optional[float] = None,
    top: Optional[float] = None,
    start_price: Optional[float] = None,
    end_price: Optional[float] = None,
    start_as_of: Optional[str] = None,
    end_as_of: Optional[str] = None,
    extra: str = "",
) -> str:
    """Return a stable 12-char id for one level's identity and geometry."""
    parts = [source, kind, as_of, price, bottom, top, start_price, end_price]
    # Omitting absent dates keeps horizontal/zone ids byte-for-byte unchanged.
    if start_as_of is not None or end_as_of is not None:
        parts.extend([start_as_of, end_as_of])
    parts.append(extra)
    canonical = json.dumps(
        parts,
        separators=(",", ":"),
        ensure_ascii=True,
        default=str,
    )
    return hashlib.sha1(canonical.encode("utf-8")).hexdigest()[:12]


@dataclass(frozen=True)
class DetectorSpec:
    """Declarative description of a registered level detector."""

    id: str
    version: str
    kind: str
    min_bars: int = 0
    required_inputs: tuple[str, ...] = ()
    params_schema: dict = field(default_factory=dict)
