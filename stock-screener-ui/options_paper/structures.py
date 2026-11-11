"""Pure multi-leg option structure maths (no I/O, no market access).

A structure is a list of :class:`LegSpec` referencing strikes **by name**
(``ATM``, ``ATM+2``, or an absolute value). Resolution needs only the spot and
that minute's ladder, so the same spec can be priced on any recorded tick.

Payoff maths is deliberately **gross of costs**: the simulator charges the
round trip separately, per leg, and the two must not be mixed or a structure
would look cheaper than it is.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Sequence

#: An offset beyond this many ladder steps is a typo, not a strike request.
MAX_STRIKE_OFFSET = 12

_ACTIONS = ("BUY", "SELL")
_OPTS = ("CE", "PE")


@dataclass(frozen=True)
class LegSpec:
    action: str          # "BUY" | "SELL"
    opt: str             # "CE" | "PE"
    strike: str          # "ATM" | "ATM+2" | "ATM-1" | "24900"
    lots: int = 1


@dataclass(frozen=True)
class ResolvedLeg:
    action: str
    opt: str
    strike: float
    lots: int
    qty: int
    entry_premium: float = 0.0


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------
def _int_or_none(text: str) -> Optional[int]:
    text = text.strip()
    if not text or not text.isdigit():
        return None
    return int(text)


def _parse_ref(ref) -> Optional[tuple[str, float]]:
    """``(kind, value)`` for a strike reference; ``None`` when malformed.

    ``kind`` is ``"ATM"``, ``"OFFSET"`` (value = signed steps) or ``"ABS"``.
    """
    s = str(ref).strip().upper().replace(" ", "")
    if not s:
        return None
    if s == "ATM":
        return ("ATM", 0.0)
    if s.startswith("ATM+") or s.startswith("ATM-"):
        sign = 1 if s[3] == "+" else -1
        n = _int_or_none(s[4:])
        if n is None or not 0 <= n <= MAX_STRIKE_OFFSET:
            return None
        # "ATM-0" is not a thing; only an explicit positive step is valid.
        if sign < 0 and n == 0:
            return None
        return ("OFFSET", float(sign * n))
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v) or v <= 0:
        return None
    return ("ABS", v)


def parse_leg_spec(raw: dict) -> LegSpec:
    """Validate one raw leg dict into a :class:`LegSpec`.

    Raises ``ValueError`` with a message that names the offending field — the
    API surfaces it to the user, so "invalid leg" is not good enough.
    """
    if not isinstance(raw, dict):
        raise ValueError(f"leg must be an object, got {type(raw).__name__}")

    action = str(raw.get("action", "")).strip().upper()
    if action not in _ACTIONS:
        raise ValueError(f"leg action must be BUY or SELL, got {raw.get('action')!r}")

    opt = str(raw.get("opt", "")).strip().upper()
    if opt not in _OPTS:
        raise ValueError(f"leg opt must be CE or PE, got {raw.get('opt')!r}")

    strike = raw.get("strike")
    if strike is None or str(strike).strip() == "":
        raise ValueError("leg strike is required (ATM, ATM+n, ATM-n or a number)")
    if _parse_ref(strike) is None:
        raise ValueError(f"invalid leg strike {strike!r}")

    lots = raw.get("lots", 1)
    if isinstance(lots, bool):
        raise ValueError(f"leg lots must be a positive integer, got {lots!r}")
    try:
        lots_i = int(lots)
    except (TypeError, ValueError):
        raise ValueError(f"leg lots must be a positive integer, got {lots!r}") from None
    if lots_i < 1:
        raise ValueError(f"leg lots must be >= 1, got {lots!r}")

    return LegSpec(action=action, opt=opt, strike=str(strike).strip(), lots=lots_i)


def leg_sign(action: str) -> int:
    """+1 for a bought leg, -1 for a sold one."""
    a = str(action).strip().upper()
    if a == "BUY":
        return 1
    if a == "SELL":
        return -1
    raise ValueError(f"leg action must be BUY or SELL, got {action!r}")


# --------------------------------------------------------------------------
# Strike resolution
# --------------------------------------------------------------------------
def _clean_ladder(ladder: Sequence[float]) -> list[float]:
    out: list[float] = []
    for k in ladder or []:
        try:
            v = float(k)
        except (TypeError, ValueError):
            continue
        if math.isfinite(v):
            out.append(v)
    return sorted(set(out))


def _atm_index(keys: list[float], spot: float) -> int:
    # A tie must go to the LOWER strike: rounding up would pick a different
    # contract than the exchange's own ATM when spot sits exactly between two.
    return min(range(len(keys)), key=lambda i: (abs(keys[i] - spot), keys[i]))


def resolve_strike(ref: str, spot: float,
                   ladder: Sequence[float]) -> Optional[float]:
    """Resolve a strike reference against this minute's real ladder.

    ``None`` means "this contract does not exist right now" — the caller must
    skip, never guess a nearby strike.
    """
    keys = _clean_ladder(ladder)
    if not keys:
        return None
    parsed = _parse_ref(ref)
    if parsed is None:
        return None
    kind, value = parsed
    try:
        spot_f = float(spot)
    except (TypeError, ValueError):
        return None

    if kind == "ATM":
        return keys[_atm_index(keys, spot_f)]
    if kind == "OFFSET":
        idx = _atm_index(keys, spot_f) + int(value)
        return keys[idx] if 0 <= idx < len(keys) else None
    for k in keys:
        if abs(k - value) < 1e-6:
            return k
    return None


def resolve_legs(specs, spot: float, ladder: Sequence[float],
                 lot_size: int) -> list[ResolvedLeg]:
    """Resolve every leg, raising when any strike is unavailable.

    Raising rather than dropping a leg is deliberate: a partially resolved
    structure is a different trade than the one the user asked for.
    """
    if lot_size <= 0:
        raise ValueError(f"lot_size must be positive, got {lot_size!r}")
    out: list[ResolvedLeg] = []
    for raw in specs or []:
        spec = parse_leg_spec(raw) if isinstance(raw, dict) else raw
        if not isinstance(spec, LegSpec):
            raise ValueError(f"leg must be a LegSpec or dict, got {type(spec).__name__}")
        strike = resolve_strike(spec.strike, spot, ladder)
        if strike is None:
            raise ValueError(
                f"strike {spec.strike!r} is not available at spot {spot:g}"
            )
        out.append(ResolvedLeg(
            action=spec.action, opt=spec.opt, strike=strike, lots=spec.lots,
            qty=spec.lots * lot_size,
        ))
    return out


# --------------------------------------------------------------------------
# Payoff
# --------------------------------------------------------------------------
def intrinsic(opt: str, strike: float, spot: float) -> float:
    """Expiry value of one option per unit."""
    o = str(opt).strip().upper()
    if o == "CE":
        return max(float(spot) - float(strike), 0.0)
    if o == "PE":
        return max(float(strike) - float(spot), 0.0)
    raise ValueError(f"opt must be CE or PE, got {opt!r}")


def payoff_at_expiry(legs: Sequence[ResolvedLeg], spot: float) -> float:
    """Structure P&L at ``spot`` in rupees, gross of costs."""
    total = 0.0
    for leg in legs or []:
        total += (leg_sign(leg.action)
                  * (intrinsic(leg.opt, leg.strike, spot) - leg.entry_premium)
                  * leg.qty)
    return total


def payoff_curve(legs: Sequence[ResolvedLeg],
                 spots: Sequence[float]) -> list[float]:
    return [payoff_at_expiry(legs, s) for s in spots or []]


def net_entry_cost(legs: Sequence[ResolvedLeg]) -> float:
    """Signed net premium in rupees: positive = debit, negative = credit."""
    return sum(leg_sign(leg.action) * leg.entry_premium * leg.qty
               for leg in legs or [])


def _linspace(lo: float, hi: float, n: int) -> list[float]:
    if n <= 1 or hi <= lo:
        return [lo]
    step = (hi - lo) / (n - 1)
    return [lo + step * i for i in range(n)]


def default_spot_range(legs: Sequence[ResolvedLeg], pct: float = 0.08,
                       n: int = 161) -> list[float]:
    """A payoff x-axis around the structure's strikes.

    The legs carry no spot, so the band is centred on the mid strike and is at
    least ``pct`` wide on each side — enough to show the wings of a condor
    without inventing a spot that was never traded.
    """
    if not legs:
        return []
    strikes = [leg.strike for leg in legs]
    lo_k, hi_k = min(strikes), max(strikes)
    mid = (lo_k + hi_k) / 2.0
    half = max((hi_k - lo_k) / 2.0, abs(float(pct)) * mid)
    lo = mid - half
    hi = mid + half
    if lo <= 0:
        # An axis cannot cross zero spot; keep the band on the positive side.
        lo = max(mid * 0.01, 0.01)
        hi = max(hi, mid * 1.5)
    return [round(x, 4) for x in _linspace(lo, hi, max(int(n), 2))]


def _bisect_root(legs: Sequence[ResolvedLeg], a: float, b: float,
                 fa: float) -> float:
    for _ in range(60):
        m = (a + b) / 2.0
        fm = payoff_at_expiry(legs, m)
        if fm == 0:
            return m
        if (fa < 0) == (fm < 0):
            a, fa = m, fm
        else:
            b = m
    return (a + b) / 2.0


def breakevens(legs: Sequence[ResolvedLeg], lo: float, hi: float,
               steps: int = 800) -> list[float]:
    """Spots where the expiry payoff crosses zero, rounded to 2dp.

    A flat zero stretch is reported once, and the list is capped: a malformed
    structure must not turn into a thousand labels on the chart.
    """
    if not legs or hi <= lo or steps < 1:
        return []
    xs = _linspace(float(lo), float(hi), steps + 1)
    vals = payoff_curve(legs, xs)
    roots: list[float] = []
    eps = 1e-7
    for i, v in enumerate(vals):
        if abs(v) <= eps:
            roots.append(xs[i])
    for i in range(steps):
        if vals[i] * vals[i + 1] < 0:
            roots.append(_bisect_root(legs, xs[i], xs[i + 1], vals[i]))

    seen: set[float] = set()
    out: list[float] = []
    for root in sorted(roots):
        r = round(float(root), 2)
        if r in seen:
            continue
        seen.add(r)
        out.append(r)
        if len(out) >= 8:
            break
    return out


def max_profit_loss(legs: Sequence[ResolvedLeg], lo: Optional[float] = None,
                    hi: Optional[float] = None) -> tuple[float, float]:
    """(max profit, max loss) sampled from the expiry payoff curve.

    For an unbounded structure (a naked call) this is the value at the edge of
    the sampled band, which is why the API also returns the curve itself.
    """
    if not legs:
        return (0.0, 0.0)
    if lo is None or hi is None:
        spots = default_spot_range(legs)
        if not spots:
            return (0.0, 0.0)
        lo, hi = spots[0], spots[-1]
    if hi <= lo:
        v = payoff_at_expiry(legs, float(lo))
        return (v, v)
    curve = payoff_curve(legs, _linspace(float(lo), float(hi), 161))
    return (max(curve), min(curve))
