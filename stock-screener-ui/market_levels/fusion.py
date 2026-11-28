"""Pure fusion of detector levels into one deterministic, deduplicated tuple."""

from __future__ import annotations

import math
from dataclasses import replace
from typing import Any, Iterable, Optional

from .models import GEX, OI, PIVOT, PRICE_ACTION, SESSION, TRENDLINE, Level

SOURCE_PRECEDENCE = (PRICE_ACTION, PIVOT, GEX, OI, SESSION, TRENDLINE)
_SOURCE_RANK = {source: rank for rank, source in enumerate(SOURCE_PRECEDENCE)}
_UNKNOWN_SOURCE_RANK = len(SOURCE_PRECEDENCE)

_DEDUPE_FIELDS = (
    "source",
    "kind",
    "geometry",
    "price",
    "bottom",
    "top",
    "start_price",
    "end_price",
    "start_as_of",
    "end_as_of",
)


def _identity(level: Level) -> tuple:
    return tuple(getattr(level, name) for name in _DEDUPE_FIELDS)


def _quality(level: Level) -> tuple[float, int]:
    return (
        level.strength if level.strength is not None else float("-inf"),
        level.touches if level.touches is not None else -1,
    )


def _bounds(level: Level) -> Optional[tuple[float, float]]:
    if level.price is not None:
        value = float(level.price)
        return value, value
    if level.bottom is not None and level.top is not None:
        return float(level.bottom), float(level.top)
    if level.start_price is not None and level.end_price is not None:
        return (
            min(float(level.start_price), float(level.end_price)),
            max(float(level.start_price), float(level.end_price)),
        )
    return None


def _finite_spot(spot: Any) -> Optional[float]:
    try:
        value = float(spot)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value) or value <= 0:
        return None
    return value


def _side_for(level: Level, spot: Any) -> Optional[str]:
    spot_f = _finite_spot(spot)
    if spot_f is None:
        return None
    bounds = _bounds(level)
    if bounds is None:
        return None
    low, high = bounds
    if high < spot_f:
        return "below"
    if low > spot_f:
        return "above"
    return "inside"


def _distance(level: Level, spot: Optional[float]) -> float:
    spot_f = _finite_spot(spot)
    if spot_f is None:
        return float("inf")
    bounds = _bounds(level)
    if bounds is None:
        return float("inf")
    low, high = bounds
    return abs((low + high) / 2.0 - spot_f)


def _sort_key(level: Level, spot: Optional[float]) -> tuple:
    strength = -level.strength if level.strength is not None else float("inf")
    return (
        _SOURCE_RANK.get(level.source, _UNKNOWN_SOURCE_RANK),
        strength,
        _distance(level, spot),
        level.id,
    )


def fuse_levels(
    levels: Iterable[Level],
    *,
    spot: Optional[float] = None,
    max_per_side: Optional[int] = None,
) -> tuple[Level, ...]:
    """Deduplicate, label and order levels without ever merging provenance.

    With no positive finite ``spot`` every unresolved level shares one
    unknown-side bucket, so ``max_per_side`` keeps the top-N levels overall
    rather than one per real side.
    """
    if max_per_side is not None and (
        isinstance(max_per_side, bool)
        or not isinstance(max_per_side, int)
        or max_per_side < 0
    ):
        raise ValueError(
            f"max_per_side must be a non-negative integer, got {max_per_side!r}"
        )

    unique: dict[tuple, Level] = {}
    for level in levels:
        key = _identity(level)
        current = unique.get(key)
        if current is None or (_quality(level), level.id) > (
            _quality(current),
            current.id,
        ):
            unique[key] = level

    resolved = [
        replace(level, side=_side_for(level, spot), evidence=dict(level.evidence))
        if spot is not None and level.side is None
        else level
        for level in unique.values()
    ]
    resolved.sort(key=lambda level: _sort_key(level, spot))

    if max_per_side is None:
        return tuple(resolved)

    counts: dict[Optional[str], int] = {}
    capped: list[Level] = []
    for level in resolved:
        side = level.side
        if counts.get(side, 0) >= max_per_side:
            continue
        counts[side] = counts.get(side, 0) + 1
        capped.append(level)
    return tuple(capped)
