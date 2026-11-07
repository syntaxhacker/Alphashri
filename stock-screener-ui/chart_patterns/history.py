"""Select the last N non-overlapping pattern hits.

The engine already computes every historical hit; the chart only needs the
last few. This module is the single place that decides *which* hits those are.

Rules:
  - newest first by ``end_date`` (tie-break: higher confidence);
  - a hit is skipped when its ``[start_date, end_date]`` span intersects a
    hit already selected (so the drawn patterns are sequential, never stacked);
  - stop at ``n``.

Pure functions only — no DB, no I/O, so it is trivially testable.
"""

from __future__ import annotations

from typing import Iterable


def _span(hit: dict) -> tuple[str, str]:
    return (str(hit.get("start_date") or ""), str(hit.get("end_date") or ""))


def overlaps(a: dict, b: dict) -> bool:
    """True when the two hits' date spans intersect (inclusive)."""
    a_start, a_end = _span(a)
    b_start, b_end = _span(b)
    if not a_start or not a_end or not b_start or not b_end:
        return False
    return a_start <= b_end and b_start <= a_end


def select_last_n(
    hits: Iterable[dict],
    n: int = 3,
    non_overlapping: bool = True,
) -> list[dict]:
    """Return at most ``n`` hits, newest first, optionally non-overlapping."""
    if n <= 0:
        return []
    ordered = sorted(
        hits or [],
        key=lambda h: (str(h.get("end_date") or ""), float(h.get("confidence") or 0.0)),
        reverse=True,
    )
    out: list[dict] = []
    for hit in ordered:
        if non_overlapping and any(overlaps(hit, kept) for kept in out):
            continue
        out.append(hit)
        if len(out) >= n:
            break
    return out
