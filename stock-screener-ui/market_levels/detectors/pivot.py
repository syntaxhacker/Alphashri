"""Pivot points as LevelBook levels, wrapping the shared pivot math unchanged."""

from __future__ import annotations

from typing import Any

from trading.pivot_utils import calculate_pivot_points

from market_levels import (
    DetectorSpec,
    PIVOT,
    RESISTANCE,
    SUPPORT,
    Level,
    level_id,
    register,
)

SPEC = DetectorSpec(
    id="pivot",
    version="1",
    kind="pivot",
    min_bars=0,
    required_inputs=("pivot_hlc",),
    params_schema={"pivot_type": "classic|fibonacci|camarilla"},
)

_PIVOT_KEYS = (
    ("pp", PIVOT),
    ("r1", RESISTANCE),
    ("r2", RESISTANCE),
    ("r3", RESISTANCE),
    ("s1", SUPPORT),
    ("s2", SUPPORT),
    ("s3", SUPPORT),
    ("r4", RESISTANCE),
    ("s4", SUPPORT),
)


def detect(ctx: dict[str, Any]) -> list[Level]:
    hlc = ctx["pivot_hlc"]
    points = calculate_pivot_points(
        hlc["high"],
        hlc["low"],
        hlc["close"],
        hlc.get("pivot_type", "classic"),
    )
    symbol = ctx["symbol"]
    timeframe = ctx["timeframe"]
    as_of = ctx["as_of"]

    levels: list[Level] = []
    for key, kind in _PIVOT_KEYS:
        value = getattr(points, key)
        if value is None:
            continue
        levels.append(
            Level(
                id=level_id(PIVOT, kind, as_of, price=value, extra=key),
                symbol=symbol,
                timeframe=timeframe,
                as_of=as_of,
                kind=kind,
                source=PIVOT,
                geometry="horizontal",
                price=value,
                side=None,
                strength=None,
                touches=None,
                evidence={"pivot_key": key},
                detector_version=SPEC.version,
            )
        )
    return levels


register(SPEC, detect)
