"""Wrap the existing options-derived GEX levels as ``Level`` objects.

``api.options_levels`` stays the single source of the GEX numbers: this module
only gives its four level blocks a LevelBook shape. The import is deliberately
deferred to ``detect`` so importing the contract never pulls in the API layer.
"""

from __future__ import annotations

import math
from typing import Any, Optional

from market_levels import (
    FUEL,
    GEX,
    RESISTANCE,
    SUPPORT,
    DetectorSpec,
    Level,
    level_id,
    register,
)

SPEC = DetectorSpec(
    id="gex",
    version="1",
    kind=GEX,
    min_bars=0,
    required_inputs=("option_rows", "spot"),
    params_schema={},
)

_FIELD_KIND = {
    "support": SUPPORT,
    "resistance": RESISTANCE,
    "fuel_down": FUEL,
    "fuel_up": FUEL,
}


def _price(block: dict) -> Optional[float]:
    try:
        price = float(block.get("strike"))
    except (TypeError, ValueError):
        return None
    return price if math.isfinite(price) else None


def detect(ctx: dict[str, Any]) -> tuple[Level, ...]:
    raw = ctx.get("options_levels")
    if raw is None:
        from api.options_levels import build_levels

        raw = build_levels(ctx["option_rows"], ctx["spot"])
    gex = raw.get("gex") or {}
    if gex.get("degraded"):
        return ()

    as_of = ctx["as_of"]
    levels: list[Level] = []
    for field, kind in _FIELD_KIND.items():
        block = gex.get(field)
        if not isinstance(block, dict):
            continue
        price = _price(block)
        if price is None:
            continue
        strength = block.get("strength")
        levels.append(Level(
            id=level_id(GEX, kind, as_of, price=price, extra=field),
            symbol=ctx["symbol"],
            timeframe=ctx["timeframe"],
            as_of=as_of,
            kind=kind,
            source=GEX,
            geometry="horizontal",
            price=price,
            side=block.get("side"),
            strength=float(strength) if strength is not None else None,
            evidence={
                "field": field,
                "raw": dict(block),
                "net_gex": block.get("net_gex"),
            },
            detector_version=SPEC.version,
        ))
    return tuple(levels)


register(SPEC, detect)
