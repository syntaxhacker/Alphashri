"""Ordered pattern sequences (e.g. Consolidation -> Rising Wedge).

The scan filter is an OR over pattern ids. This module answers the different
question: did pattern A finish and pattern B start **after it** (optionally
with the last step being the current one)?

Pure functions only — the caller supplies the hits for one symbol/timeframe.
"""

from __future__ import annotations

from datetime import datetime
from typing import Iterable, Optional


def _dt(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _gap_days(a: dict, b: dict) -> Optional[float]:
    """Days from a's end to b's start (b is later)."""
    end, start = _dt(a.get("end_date")), _dt(b.get("start_date"))
    if end is None or start is None:
        return None
    return (start - end).total_seconds() / 86400.0


def match_sequence(
    hits: Iterable[dict],
    steps: list[str],
    max_gap_days: float | None = None,
    current_only: bool = True,
    max_bars_ago: int | None = None,
    step_statuses: list[str] | None = None,
) -> list[dict]:
    """Return the hits forming ``steps`` in order, or ``[]``.

    ``current_only`` requires the latest hit (max ``end_date``) to be the last
    step — i.e. the sequence is the live setup, not a historical one.
    Non-overlap is enforced: each earlier step must end before the next starts.
    ``max_gap_days`` is the maximum gap between a step's end and the next
    step's start.
    """
    steps = [str(s) for s in (steps or []) if s]
    if len(steps) < 2:
        return []
    ordered = sorted(
        [h for h in (hits or []) if h.get("pattern_id")],
        key=lambda h: str(h.get("end_date") or ""),
    )
    if not ordered:
        return []
    latest = ordered[-1]
    if current_only and latest.get("pattern_id") != steps[-1]:
        return []
    if max_bars_ago is not None and (latest.get("bars_ago") or 10**9) > max_bars_ago:
        return []
    allowed = set(step_statuses or [])

    chain: list[dict] = []
    upper: dict | None = None
    for index in range(len(steps) - 1, -1, -1):
        step = steps[index]
        candidates = [h for h in ordered if h.get("pattern_id") == step]
        if index == len(steps) - 1 and current_only:
            candidates = [h for h in candidates if h is ordered[-1]]
        else:
            if allowed:
                candidates = [h for h in candidates if str(h.get("status") or "") in allowed]
        if upper is not None:
            candidates = [
                h for h in candidates
                if str(h.get("end_date") or "") < str(upper.get("start_date") or "")
            ]
            if max_gap_days is not None:
                candidates = [
                    h for h in candidates
                    if (_gap_days(h, upper) is not None and _gap_days(h, upper) <= max_gap_days)
                ]
        if not candidates:
            return []
        prev = candidates[-1]
        chain.append(prev)
        upper = prev
    return list(reversed(chain))
