"""Wrap the existing OI walls / max-pain blocks as ``Level`` objects.

``api.options_levels.build_levels`` remains the only place that computes the
wall rankings and the pain strike. This adapter adds provenance and a stable
id; it does not re-rank or rescale anything. ``degraded`` GEX is irrelevant to
OI levels, so walls survive a chain without greeks.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any, Optional

from market_levels import (
    MAX_PAIN,
    OI,
    WALL,
    DetectorSpec,
    Level,
    level_id,
    register,
)

SPEC = DetectorSpec(
    id="walls",
    version="1",
    kind=OI,
    min_bars=0,
    required_inputs=("option_rows", "spot"),
    params_schema={},
)

_WALL_FIELDS = (
    ("call_wall", "call"),
    ("put_wall", "put"),
    ("call_walls", "call"),
    ("put_walls", "put"),
)


def _price(block: Any) -> Optional[float]:
    value = block.get("strike") if isinstance(block, Mapping) else block
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    return price if math.isfinite(price) else None


def _side(price: float, spot: Any) -> Optional[str]:
    try:
        spot_f = float(spot)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(spot_f) or spot_f <= 0:
        return None
    if price < spot_f:
        return "below"
    if price > spot_f:
        return "above"
    return "inside"


def detect(ctx: dict[str, Any]) -> tuple[Level, ...]:
    raw = ctx.get("options_levels")
    if raw is None:
        from api.options_levels import build_levels

        raw = build_levels(ctx["option_rows"], ctx["spot"])
    as_of = ctx["as_of"]
    symbol = ctx["symbol"]
    timeframe = ctx["timeframe"]
    spot = ctx["spot"]

    levels: list[Level] = []
    seen: set[tuple[str, float]] = set()
    for field, wall in _WALL_FIELDS:
        block = raw.get(field)
        entries = block if isinstance(block, list) else [block]
        for index, entry in enumerate(entries):
            if entry is None:
                continue
            price = _price(entry)
            if price is None or (wall, price) in seen:
                continue
            seen.add((wall, price))
            levels.append(Level(
                id=level_id(OI, WALL, as_of, price=price, extra=field),
                symbol=symbol,
                timeframe=timeframe,
                as_of=as_of,
                kind=WALL,
                source=OI,
                geometry="horizontal",
                price=price,
                side=_side(price, spot),
                strength=None,
                evidence={
                    "field": field,
                    "wall": wall,
                    "rank": index + 1,
                    "index": index,
                    "raw": dict(entry) if isinstance(entry, Mapping) else entry,
                },
                detector_version=SPEC.version,
            ))

    pain = raw.get("max_pain")
    pain_price = _price(pain)
    if pain_price is not None:
        levels.append(Level(
            id=level_id(OI, MAX_PAIN, as_of, price=pain_price, extra="max_pain"),
            symbol=symbol,
            timeframe=timeframe,
            as_of=as_of,
            kind=MAX_PAIN,
            source=OI,
            geometry="horizontal",
            price=pain_price,
            side=_side(pain_price, spot),
            strength=None,
            evidence={
                "field": "max_pain",
                "raw": dict(pain) if isinstance(pain, Mapping) else pain,
            },
            detector_version=SPEC.version,
        ))
    return tuple(levels)


register(SPEC, detect)
