"""
Fuel-model helpers for the Nifty OI-burst feed (backend side).

The 2×2 (OI direction × premium direction) tells whether fresh money arrived
or whether the existing book is being spent. A *spent* fuel state (writers
covering / longs liquidating) prints as "the premium rose", which reads like
an instruction but is a liquidity event. It is only tradeable when the
underlying has CLOSED BEYOND A LEVEL IN THE SAME DIRECTION — the line that
separates the 2026-10-22 11:13 trap (writers covering at the day's high) from
the 11:44 read (put writers covering after a close below 22,697).

Pure functions, no I/O — the caller supplies the tape rows and the levels.
"""

from __future__ import annotations

from typing import Any, Optional

#: OI build/unwind × premium up/down.
FUEL_FRESH_BUYERS = "fresh_buyers"
FUEL_FRESH_SELLERS = "fresh_sellers"
FUEL_WRITERS_COVERING = "writers_covering"
FUEL_LONGS_LIQUIDATING = "longs_liquidating"

#: Human label for the alert headline.
FUEL_LABELS = {
    FUEL_FRESH_BUYERS: "FRESH BUYING",
    FUEL_FRESH_SELLERS: "FRESH SELLING",
    FUEL_WRITERS_COVERING: "WRITERS COVERING",
    FUEL_LONGS_LIQUIDATING: "LONGS LIQUIDATING",
}

#: The side's own premium rose/fell over the burst minute (₹). None = unknown.
#: The ATM strike rolls between minutes, which makes a raw ATM-premium
#: difference a strike artefact — the caller must pass a same-strike change.
#: A None premium means the fuel state is UNKNOWN, which is never treated as
#: fresh.


def fuel_state(building: bool, premium_change: Optional[float]) -> Optional[str]:
    """The 2×2 cell, or ``None`` when the premium direction is unknown."""
    if not isinstance(building, bool):
        # A raw OI delta is always truthy, so passing one silently labels
        # every burst "fresh" (it happened during the 2026-10-22 squeeze).
        raise TypeError("building must be a bool, not an OI delta")
    if premium_change is None:
        return None
    if building:
        return FUEL_FRESH_BUYERS if premium_change > 0 else FUEL_FRESH_SELLERS
    return FUEL_WRITERS_COVERING if premium_change > 0 else FUEL_LONGS_LIQUIDATING


def covering_direction(side: str) -> str:
    """The direction a covering burst on ``side`` implies.

    The side's own premium rose because shorts on that side bought back, so
    the market moved in that side's direction (a put-side covering = down).
    """
    return "down" if str(side).lower() == "put" else "up"


def structure_evidence(rows: list[dict], at_time: str,
                        levels: Optional[dict] = None) -> Optional[dict]:
    """The named level the underlying closed beyond at ``at_time``.

    ``levels`` maps a kind to a strike (``day_high``/``day_low``/``pivot``/
    ``wall``/``max_pain``). The check uses the 1-min closes in ``rows`` up to
    ``at_time``: a close beyond a level is structure, a tick is not.

    Returns ``{level, direction, kind, close, confirmed_at}`` or ``None``.
    """
    if not rows:
        return None
    closes: list[tuple[str, float]] = []
    for r in rows:
        t = str(r.get("t") or "")
        s = r.get("spot")
        try:
            s = float(s)
        except (TypeError, ValueError):
            continue
        if not t or s <= 0:
            continue
        closes.append((t, s))
    if not closes:
        return None
    closes.sort(key=lambda x: x[0])
    upto = [c for c in closes if c[0] <= at_time]
    if not upto:
        return None
    close_t, close = upto[-1]

    # Levels worth breaking: the day's high/low so far, plus any named level.
    prior = [s for _, s in upto[:-1]]
    if not prior:
        return None
    candidates: list[tuple[float, str]] = []
    if levels:
        for kind, strike in levels.items():
            try:
                candidates.append((float(strike), kind))
            except (TypeError, ValueError):
                continue
    day_high = max(prior)
    day_low = min(prior)
    candidates.append((day_high, "day_high"))
    candidates.append((day_low, "day_low"))

    best: Optional[dict] = None
    for level, kind in candidates:
        if level <= 0:
            continue
        if close > level:
            direction = "up"
        elif close < level:
            direction = "down"
        else:
            continue
        # The closest level that was closed beyond is the meaningful one.
        dist = abs(close - level)
        if best is None or dist < best["_dist"]:
            best = {"level": level, "direction": direction, "kind": kind,
                    "close": close, "confirmed_at": close_t, "_dist": dist}
    if best is None:
        return None
    best.pop("_dist", None)
    return best


def plan_allowed(fuel: Optional[str], structure: Optional[dict],
                 side: str) -> bool:
    """Whether a burst may carry a trade plan.

    Fresh money (a build) may always. A *spent* fuel state may only when the
    underlying closed beyond structure in the covering direction. Without
    structure evidence the answer is "no trade": the move is running on
    borrowed fuel.
    """
    if fuel in (None, FUEL_FRESH_BUYERS, FUEL_FRESH_SELLERS):
        return True
    if not structure:
        return False
    return structure.get("direction") == covering_direction(side)


def basis_text(fuel: Optional[str], side: str, structure: Optional[dict],
               spot: Optional[float], leg: Optional[str] = None) -> str:
    """The WHAT · WHERE · GUARD one-liner shown in the alert."""
    s = "put" if str(side).lower() == "put" else "call"
    what = FUEL_LABELS.get(fuel or "", "FLOW UNKNOWN")
    where = ""
    if structure:
        where = (f" ({structure.get('direction')} the "
                 f"{structure.get('level'):,.0f} {structure.get('kind')})")
    elif spot:
        where = f" @ {spot:,.0f}"
    if not structure:
        return f"{s} OI {what}{where} · no level closed — no trade"
    return f"{s} OI {what}{where} · structure broken in this direction"
