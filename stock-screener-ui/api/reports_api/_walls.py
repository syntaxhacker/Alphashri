"""Shared projection of ranked wall rows into the report's wall shape.

The Nifty and generic options reports both rank strikes with
:mod:`api.options_levels` and then project each result to ``{strike, oi,
distance}``. The projection lives here once so the two reports cannot drift.
"""

from __future__ import annotations

from typing import Optional

__all__ = ["as_report_walls"]


def as_report_walls(walls: list[dict], spot: Optional[float]) -> list[dict]:
    """Project shared ``{strike, side, strength, oi}`` rows to report rows.

    ``distance`` (strike minus spot, rounded to 2) is attached only when a
    usable spot was supplied, matching both reports' historical behaviour.
    """
    out = []
    for wall in walls:
        entry = {"strike": wall["strike"], "oi": wall["oi"]}
        if spot:
            entry["distance"] = round(float(wall["strike"]) - float(spot), 2)
        out.append(entry)
    return out
