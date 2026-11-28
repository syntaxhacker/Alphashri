"""LevelBook adapter for the existing chart S/R zone detector.

The upstream ``compute_sr_zones`` payload is left untouched; this module only
projects each zone into the additive ``Level`` contract.
"""

from __future__ import annotations

import math
from typing import Any

from chart_patterns.levels import compute_sr_zones
from market_levels import PRICE_ACTION, DetectorSpec, Level, level_id, register

SPEC = DetectorSpec(
    id="price_action",
    version="1",
    kind="price_action",
    min_bars=5,
    required_inputs=("candles",),
    params_schema={},
)


def _finite_score(raw_score: Any) -> float:
    try:
        score = float(raw_score)
    except (TypeError, ValueError):
        return float("nan")
    return score if math.isfinite(score) else float("nan")


def _strength(raw_score: Any, max_raw_score: float) -> float:
    if not max_raw_score > 0.0:
        return 0.0
    score = _finite_score(raw_score)
    if not math.isfinite(score):
        return 0.0
    return min(1.0, max(0.0, score / max_raw_score))


def detect(ctx) -> list[Level]:
    zones = compute_sr_zones(
        ctx["candles"],
        session=ctx.get("session"),
        timeframe=ctx.get("timeframe"),
        market=ctx.get("market"),
    )
    scores = [_finite_score(zone["score"]) for zone in zones]
    max_raw_score = max((score for score in scores if math.isfinite(score)), default=0.0)
    levels: list[Level] = []
    for zone in zones:
        kind = zone["kind"]
        bottom = zone["bottom"]
        top = zone["top"]
        as_of = zone["end_date"]

        evidence: dict[str, Any] = {
            "raw_kind": zone.get("raw_kind", kind),
            "start_date": zone["start_date"],
            "end_date": zone["end_date"],
            "score": zone["score"],
            "touches": zone["touches"],
            "bars_since_touch": zone.get("bars_since_touch", 0),
        }
        for name in ("start_time", "end_time"):
            if name in zone:
                evidence[name] = zone[name]

        extra = "|".join(
            str(part)
            for part in (
                evidence["start_date"],
                evidence.get("start_time", ""),
                zone["touches"],
                zone["score"],
            )
        )
        levels.append(
            Level(
                id=level_id(
                    PRICE_ACTION, kind, as_of, bottom=bottom, top=top, extra=extra
                ),
                symbol=ctx["symbol"],
                timeframe=ctx["timeframe"],
                as_of=as_of,
                kind=kind,
                source=PRICE_ACTION,
                geometry="zone",
                bottom=bottom,
                top=top,
                side=None,
                strength=_strength(zone["score"], max_raw_score),
                touches=zone["touches"],
                start_as_of=zone["start_date"],
                end_as_of=zone["end_date"],
                evidence=evidence,
                detector_version=SPEC.version,
            )
        )
    return levels


register(SPEC, detect)
