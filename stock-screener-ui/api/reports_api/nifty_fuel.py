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

from typing import Any, Iterable, Optional

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


# Setup labels for the alert layer. These are deliberately separate from the
# fuel 2x2: the same "writers covering" is a short squeeze on calls, a put
# squeeze on puts, and a no-trade liquidity event away from a wall.
SETUP_SHORT_SQUEEZE = "short_squeeze"
SETUP_WALL_SQUEEZE = "wall_squeeze"
SETUP_PUT_SQUEEZE = "put_squeeze"
SETUP_FRESH_LONG = "fresh_long"
SETUP_FRESH_SHORT = "fresh_short"
SETUP_PUT_FLOOR = "put_floor"
SETUP_CALL_CAP = "call_cap"


def setup_for_burst(
    *,
    side: str,
    fuel: Optional[str],
    trend: Optional[str] = None,
    spot: Optional[float] = None,
    wall: Optional[float] = None,
    burst_type: Optional[str] = None,
    score: Optional[float] = None,
) -> dict:
    """Classify a burst into the alert setup + playbook.

    ``short_squeeze`` is a *scalp* alert: wait for the wall break/retest, never
    chase the first spike. ``fresh_long`` is a swing alert only when the
    session trend is up. Everything else is a watch/heads-up.
    """
    s = "put" if str(side).lower() == "put" else "call"
    trig = float(wall) if wall else None
    trig_txt = f"{trig:,.0f}" if trig else "the level"

    if burst_type == "squeeze":
        if s == "call":
            return {
                "setup": SETUP_WALL_SQUEEZE,
                "setup_label": "WALL SQUEEZE",
                "horizon": "swing",
                "trigger": trig,
                "confidence": "high" if (score or 0) >= 2 else "medium",
                "playbook": (
                    f"Wait for a retest of {trig_txt} to hold; buy CE/futures, "
                    f"stop back below {trig_txt}; target the next wall. "
                    "Exit if call OI rebuilds or 5m flow flips."
                ),
            }
        return {
            "setup": SETUP_PUT_SQUEEZE,
            "setup_label": "PUT SQUEEZE",
            "horizon": "scalp",
            "trigger": trig,
            "confidence": "medium",
            "playbook": (
                f"Wait for a 1-min close below {trig_txt}; scalp puts, "
                f"stop back above {trig_txt}; exit on put OI rebuild."
            ),
        }

    if s == "call" and fuel == FUEL_WRITERS_COVERING:
        return {
            "setup": SETUP_SHORT_SQUEEZE,
            "setup_label": "SHORT SQUEEZE",
            "horizon": "scalp",
            "trigger": trig,
            "confidence": "medium",
            "playbook": (
                f"Wait for a 1-min close above {trig_txt}; buy the retest, "
                f"stop back below {trig_txt}; scalp 5-15m. "
                "Exit if call OI rebuilds or 5m flow flips."
            ),
        }
    if s == "call" and fuel == FUEL_FRESH_BUYERS:
        return {
            "setup": SETUP_FRESH_LONG,
            "setup_label": "FRESH BUYING",
            "horizon": "swing" if trend == "up" else "watch",
            "trigger": trig,
            "confidence": "high" if trend == "up" else "medium",
            "playbook": (
                "Buy the first pullback holding the breakout/VWAP; stop below "
                "the base; trail. Exit if CE OI rises while premium stalls."
            ),
        }
    if s == "put" and fuel == FUEL_FRESH_SELLERS:
        return {
            "setup": SETUP_PUT_FLOOR,
            "setup_label": "PUT FLOOR",
            "horizon": "watch",
            "trigger": trig,
            "confidence": "medium",
            "playbook": (
                f"Put writers defending {trig_txt}; bull put spread or buy the "
                "dip with a stop below the put wall."
            ),
        }
    if s == "put" and fuel == FUEL_WRITERS_COVERING:
        return {
            "setup": SETUP_PUT_SQUEEZE,
            "setup_label": "PUT SQUEEZE",
            "horizon": "scalp",
            "trigger": trig,
            "confidence": "medium",
            "playbook": (
                f"Wait for a 1-min close below {trig_txt}; scalp puts, "
                f"stop back above {trig_txt}; exit on put OI rebuild."
            ),
        }
    if s == "call" and fuel == FUEL_FRESH_SELLERS:
        return {
            "setup": SETUP_CALL_CAP,
            "setup_label": "CALL CAP",
            "horizon": "watch",
            "trigger": trig,
            "confidence": "medium",
            "playbook": "Writers capping the level; fade rallies only after a rejection, not before.",
        }
    if s == "put" and fuel == FUEL_FRESH_BUYERS:
        return {
            "setup": SETUP_FRESH_SHORT,
            "setup_label": "FRESH SHORT",
            "horizon": "watch",
            "trigger": trig,
            "confidence": "medium",
            "playbook": "Put buyers pressing; short only on a failed bounce, stop above the level.",
        }
    return {}


def leg_oi_ltp(row: Any, side: str) -> Optional[tuple[float, float]]:
    """``(oi, ltp)`` from a chain10s 7-tuple for ``side``.

    The slim row is ``[strike, ceLtp, ceOi, ceVol, peLtp, peOi, peVol]``.
    A malformed / non-finite cell is ``None``, never a fabricated zero.
    """
    if not isinstance(row, (list, tuple)) or len(row) < 7:
        return None
    oi_at, ltp_at = (2, 1) if str(side).lower() == "call" else (5, 4)
    try:
        oi, ltp = float(row[oi_at]), float(row[ltp_at])
    except (TypeError, ValueError):
        return None
    if oi != oi or ltp != ltp:  # NaN is missing, not a real quote
        return None
    return oi, ltp


def same_strike_move(prev_frame: Optional[dict], cur_frame: Optional[dict],
                     side: str) -> Optional[dict]:
    """Largest same-strike OI move for ``side`` between two chain10s frames.

    ``{strike, oi_delta, premium_change}`` or ``None`` when a frame is missing
    or no strike is present in both. Comparing a strike to itself is the whole
    point: an ATM roll changes the contract and makes a raw premium difference
    a strike artefact rather than a trade.
    """
    if not isinstance(prev_frame, dict) or not isinstance(cur_frame, dict):
        return None
    prev: dict[float, tuple[float, float]] = {}
    for row in prev_frame.get("rows") or []:
        if not isinstance(row, (list, tuple)) or not row:
            continue
        try:
            strike = float(row[0])
        except (TypeError, ValueError):
            continue
        leg = leg_oi_ltp(row, side)
        if leg is not None:
            prev[strike] = leg
    best: Optional[tuple[float, float, float, float]] = None
    for row in cur_frame.get("rows") or []:
        if not isinstance(row, (list, tuple)) or not row:
            continue
        try:
            strike = float(row[0])
        except (TypeError, ValueError):
            continue
        cur = leg_oi_ltp(row, side)
        old = prev.get(strike)
        if cur is None or old is None:
            continue
        oi_delta = cur[0] - old[0]
        premium_change = cur[1] - old[1]
        magnitude = abs(oi_delta)
        if best is None or magnitude > best[0]:
            best = (magnitude, strike, oi_delta, premium_change)
    if best is None:
        return None
    return {"strike": best[1], "oi_delta": best[2],
            "premium_change": best[3]}


def minute_spot_change(rows: Iterable[dict], minute: str) -> Optional[float]:
    """Spot change across one tape minute; ``None`` when either end is unknown."""
    spots: list[tuple[str, float]] = []
    for row in rows or ():
        if not isinstance(row, dict):
            continue
        t = str(row.get("t") or "")[:16]
        try:
            spot = float(row.get("spot"))
        except (TypeError, ValueError):
            continue
        if not t or spot <= 0 or spot != spot:
            continue
        spots.append((t, spot))
    index = None
    for i, (t, _) in enumerate(spots):
        if t == minute:
            index = i  # a late duplicate of the minute wins, as in the tape
    if index is None or index == 0:
        return None
    return spots[index][1] - spots[index - 1][1]


def implied_direction(flow: Optional[dict], side: str, delta: float) -> str:
    """The direction the burst CLAIMS before verification: ``up``/``down``.

    Prefers the flow verdict; without one falls back to the legacy OI-only leg
    rule (call build and put unwind fade with PE, the other two with CE). This
    claim is what the same-strike premium and the spot have to confirm.
    """
    if isinstance(flow, dict) and isinstance(flow.get("bearish"), bool):
        return "down" if flow["bearish"] else "up"
    building = float(delta or 0) > 0
    return "down" if (str(side).lower() == "call") == building else "up"


def minute_frames(frames: Iterable[dict]) -> dict[str, dict]:
    """``{HH:MM: last frame}`` from a day's chain10s snapshots (last wins).

    Shared by NIFTY's day file and each generic symbol's own day file: a minute
    holds ~6 frames and the LAST one is the state the minute closed on.
    """
    out: dict[str, dict] = {}
    for frame in frames or ():
        if not isinstance(frame, dict):
            continue
        t = frame.get("t")
        if isinstance(t, str) and len(t) >= 16:
            out[t[:16]] = frame
    return out


def previous_minute_key(minute: str) -> Optional[str]:
    """The preceding ``YYYY-MM-DDTHH:MM`` key, or ``None`` when unparseable."""
    try:
        from datetime import datetime, timedelta

        prev = datetime.fromisoformat(minute) - timedelta(minutes=1)
    except (TypeError, ValueError):
        return None
    return prev.strftime("%Y-%m-%dT%H:%M")


def verify_burst_flow(burst: dict, rows: Iterable[dict], date_str: str,
                      frames: dict[str, dict], classify) -> bool:
    """Same-strike + spot confirmation gate, shared by NIFTY and generic feeds.

    ``classify`` is ``nifty_bursts.classify_flow`` injected by the caller so the
    2×2 buyer/writer rule stays single-sourced and this module stays free of a
    circular import. Returns True when the burst may carry a directional plan;
    on False the burst already has no flow verdict, no fuel and no plan, with
    ``plan_suppressed`` set — both callers simply skip enrichment.

    Only the burst is mutated. The chain frames and tape rows stay read-only,
    and every value in ``confirmation`` comes from those two inputs — an absent
    frame or premium is reported as missing, never invented.
    """
    minute = str(burst.get("t") or "")[:16]
    side = str(burst.get("side") or "").lower()
    cur_frame = frames.get(minute)
    prev_key = previous_minute_key(minute)
    prev_frame = frames.get(prev_key) if prev_key else None
    move = (same_strike_move(prev_frame, cur_frame, side)
            if side in ("call", "put") else None)
    spot_change = minute_spot_change(rows, minute)
    confirmation = {
        "same_strike": move["strike"] if move else None,
        "strike_oi_delta": move["oi_delta"] if move else None,
        "strike_premium_change": move["premium_change"] if move else None,
        "spot_change": spot_change,
        "reasons": [],
    }
    burst["confirmation"] = confirmation

    delta = 0.0
    try:
        delta = float(burst.get("delta") or 0)
    except (TypeError, ValueError):
        pass
    is_zero_dte_unwind = bool(
        cur_frame
        and str(cur_frame.get("expiry") or "") == date_str
        and delta < 0
        and move is not None
        and move["oi_delta"] < 0
    )
    if is_zero_dte_unwind:
        # 0-DTE: an unwind at expiry is mechanical (roll-off / assignment).
        burst["context"] = "expiry_unwind"
        confirmation["reasons"].append("expiry_unwind")

    def _deny(reason: str) -> bool:
        if reason not in confirmation["reasons"]:
            confirmation["reasons"].append(reason)
        if burst.get("context") != "expiry_unwind":
            burst["flow"] = "unconfirmed"
            burst["bearish"] = None
        burst["fuel_state"] = None
        burst["signal"] = None
        burst["plan_suppressed"] = True
        return False

    if side not in ("call", "put"):
        return _deny("no_oi_flow_claim")
    if move is None:
        return _deny(
            "missing_chain10s_frame"
            if cur_frame is None or prev_frame is None else "no_shared_strike"
        )

    claimed = implied_direction(
        {"bearish": burst["bearish"]} if isinstance(burst.get("bearish"), bool) else None,
        side, delta,
    )
    verified = classify(side, move["oi_delta"], move["premium_change"])
    if not verified:
        return _deny("same_strike_premium_undecidable")
    if ("down" if verified["bearish"] else "up") != claimed:
        return _deny("same_strike_premium_disagrees")
    if spot_change is None:
        return _deny("spot_change_missing")
    if spot_change != 0 and ("up" if spot_change > 0 else "down") != claimed:
        return _deny("spot_disagrees")

    # The verified values replace the ATM proxy: fuel and signal must read the
    # contract that moved, not the nearest strike to spot.
    burst["flow"] = verified["flow"]
    burst["bearish"] = verified["bearish"]
    burst["premChg"] = move["premium_change"]
    if is_zero_dte_unwind:
        _deny("expiry_unwind")
        return False
    return True

