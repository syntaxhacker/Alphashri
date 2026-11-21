"""Pure IV analytics for the options-analytics endpoint.

No FastAPI, no network, no DB, no I/O: every function is a function of its
arguments alone. The chain DTO hands in ``{"strike", "ce": {...}, "pe": {...}}``
rows; the analytics functions work on the ``IvPoint`` records produced by
:func:`otm_points`.

Data verification (2026-11-16) drove these conventions:

* **IV is in percent**, not a decimal fraction. A 14% vol arrives as ``14.0``.
  Values are never multiplied or divided by 100 here: a decimal ``0.14`` stays
  ``0.14`` (a 0.14% print), it is not silently promoted to 14%.
* **22-35% of near legs carry a missing or zero IV.** Upstox emits ``0`` for a
  dead strike and ``None`` before Greeks are computed. Both are *missing*, not
  a 0-vol print; missing is never zero-filled or interpolated over.
* **Wings can print >100** (a dead strike reported 281.25% with delta 0.0053).
  :data:`MAX_IV` caps a usable print at 100 vol points; anything above is an
  artefact and is dropped before it can bend a fit.
* **Deltas are coherent** (CE delta + |PE delta| ~ 1), so delta is a usable
  x-axis for the 25-delta reads. Delta magnitudes, not raw signed values, drive
  the interpolation; the sign only identifies the side.
* **LTP is the usable price.** Chain rows also carry ``close_price``, which is
  a stale daily reference for an option; it is never consulted here.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Mapping, Optional

import numpy as np

from api.options_conventions import (
    DELTA_BAND,
    DELTA_TARGET,
    IV_MAX,
    IV_MIN,
    NEAR_ATM_BAND_PCT,
)

__all__ = [
    "IV_MAX",
    "MAX_IV",
    "IvPoint",
    "valid_leg",
    "iv_source",
    "otm_points",
    "leg_points",
    "atm_iv",
    "gamma_coverage",
    "interp_iv_by_delta",
    "wing_iv",
    "rr25",
    "fit_smile",
    "smile_metrics",
    "filter_quality",
]

#: Analytics IV band, owned by :mod:`api.options_conventions`. ``MAX_IV`` is
#: kept as the historical public name; the canonical name is ``IV_MAX``.
MAX_IV = IV_MAX

#: An IV point on the OTM smile. ``oi`` may be ``None`` (open interest is
#: optional on the chain) — it is only a fit weight, never a validity gate.
IvPoint = dict[str, Any]


def _finite(value: Any) -> Optional[float]:
    """Finite float or ``None``. NaN/inf and unparseable values are not data."""
    try:
        out = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return out if math.isfinite(out) else None


def _iv(value: Any) -> Optional[float]:
    """Usable percent IV: finite, strictly positive, at most :data:`IV_MAX`."""
    out = _finite(value)
    if out is None or not (IV_MIN < out <= IV_MAX):
        return None
    return out


def _as_mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def valid_leg(leg: Any) -> bool:
    """A chain leg is usable when LTP, IV and delta are all present and sane.

    OI is deliberately *not* required: the chain omits it on some legs, and a
    leg with a live price, IV and delta is still a point on the smile. Only
    ``ltp`` counts as a price — ``close_price`` is the daily close and must not
    be substituted when LTP is missing.
    """
    row = _as_mapping(leg)
    ltp = _finite(row.get("ltp"))
    iv = _iv(row.get("iv"))
    delta = _finite(row.get("delta"))
    return ltp is not None and ltp > 0.0 and iv is not None and delta is not None


def iv_source(leg: Any) -> str:
    """Provenance of a leg's IV for the chain DTO / analytics payload.

    ``"missing"`` means no print (``None`` or Upstox's ``0`` for a dead
    strike); ``"invalid"`` means a value arrived but is unusable (negative,
    NaN/inf, or above :data:`MAX_IV`). This module has no inversion step, so a
    usable print is always ``"upstox"``.
    """
    row = _as_mapping(leg)
    raw = row.get("iv")
    if raw is None:
        return "missing"
    out = _finite(raw)
    if out is None or (out != IV_MIN and not (IV_MIN < out <= IV_MAX)):
        return "invalid"
    return "missing" if out == IV_MIN else "upstox"


def otm_points(rows: Any, spot: Any) -> list[IvPoint]:
    """Select usable OTM legs: CE above spot, PE below it.

    The chain is quoted by strike, so the same strike carries both a CE and a
    PE leg; only the out-of-the-money side survives. The ATM strike itself is
    excluded from both sides. Dead or missing legs are skipped outright — no
    zero IV is ever inserted to keep a strike in the smile.
    """
    s = _finite(spot)
    if s is None or s <= 0.0:
        return []
    if rows is None:
        rows = ()
    out: list[IvPoint] = []
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        strike = _finite(row.get("strike"))
        if strike is None or strike <= 0.0:
            continue
        if strike > s:
            side = "CE"
        elif strike < s:
            side = "PE"
        else:
            continue
        leg = row.get("ce" if side == "CE" else "pe")
        if not valid_leg(leg):
            continue
        data = _as_mapping(leg)
        out.append({
            "strike": strike,
            "iv": _iv(data.get("iv")),
            "delta": _finite(data.get("delta")),
            "oi": _finite(data.get("oi")),
            "side": side,
        })
    out.sort(key=lambda point: (point["strike"], point["side"]))
    return out


def leg_points(rows: Any) -> list[IvPoint]:
    """All usable CE and PE legs at every strike, ATM and ITM included.

    :func:`otm_points` is deliberately strict (one side per strike) so the
    smile never mixes ITM quotes in. ATM IV is the exception: the ATM strike's
    *own* CE and PE prints are the most accurate read of spot vol, so this
    candidate set keeps both sides and every strike. It must not be fed to the
    smile fit or the delta wings — only to :func:`atm_iv`.
    """
    if rows is None:
        rows = ()
    out: list[IvPoint] = []
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        strike = _finite(row.get("strike"))
        if strike is None or strike <= 0.0:
            continue
        for side in ("CE", "PE"):
            leg = row.get("ce" if side == "CE" else "pe")
            if not valid_leg(leg):
                continue
            data = _as_mapping(leg)
            out.append({
                "strike": strike,
                "iv": _iv(data.get("iv")),
                "delta": _finite(data.get("delta")),
                "oi": _finite(data.get("oi")),
                "side": side,
            })
    out.sort(key=lambda point: (point["strike"], point["side"]))
    return out


def _legs_by_strike(points: Any) -> dict[float, dict[str, float]]:
    """``strike -> {side: iv}`` for usable points, keeping both CE and PE."""
    out: dict[float, dict[str, float]] = {}
    for point in points or ():
        if not isinstance(point, Mapping):
            continue
        strike = _finite(point.get("strike"))
        iv = _iv(point.get("iv"))
        side = point.get("side")
        if strike is None or strike <= 0.0 or iv is None or side not in ("CE", "PE"):
            continue
        out.setdefault(strike, {})[side] = iv
    return out


def _usable_by_strike(points: Any) -> list[tuple[float, float]]:
    """``(strike, iv)`` pairs with a usable IV, sorted by strike."""
    if points is None:
        points = ()
    out: list[tuple[float, float]] = []
    for point in points:
        if not isinstance(point, Mapping):
            continue
        strike = _finite(point.get("strike"))
        iv = _iv(point.get("iv"))
        if strike is None or strike <= 0.0 or iv is None:
            continue
        out.append((strike, iv))
    out.sort(key=lambda pair: pair[0])
    return out


def _interp_by_strike(usable: list[tuple[float, float]], anchor: float) -> Optional[float]:
    """Linear-in-strike read, clamped to the observed strikes (no extrapolation)."""
    if not usable:
        return None
    if anchor <= usable[0][0]:
        return usable[0][1]
    if anchor >= usable[-1][0]:
        return usable[-1][1]
    for (k0, v0), (k1, v1) in zip(usable, usable[1:]):
        if k0 <= anchor <= k1:
            if k1 == k0:
                return v0
            weight = (anchor - k0) / (k1 - k0)
            return v0 + weight * (v1 - v0)
    return None


def atm_iv(points: Any, spot: Any, step: Any = None) -> Optional[float]:
    """ATM IV, preferring the ATM strike's own CE and PE prints.

    The ATM strike is the nearest strike to spot (snapped to ``step`` when
    given, e.g. spot 25,215 with a 50-point step reads at 25,200). When that
    strike carries both a CE and a PE leg, their IVs are averaged — the two ATM
    quotes are the best estimate of spot vol and must not be replaced by a wing
    interpolation. If only one side is present, that side is used. This is why
    the caller passes :func:`leg_points` (which keeps the ATM strike), not
    :func:`otm_points` (which drops it).

    With no ATM-strike quote at all — the strict OTM point set, or a chain with
    no leg at the nearest strike — the read falls back to linear interpolation
    between the bracketing strikes. Results are clamped to observed strikes;
    there is no extrapolation past the edge of the chain.
    """
    s = _finite(spot)
    if s is None or s <= 0.0:
        return None
    anchor = s
    stride = _finite(step)
    if stride is not None and stride > 0.0:
        anchor = math.floor(s / stride + 0.5) * stride

    by_strike = _legs_by_strike(points)
    if not by_strike:
        return None

    atm_strike: Optional[float] = None
    if anchor in by_strike:
        atm_strike = anchor
    else:
        # No leg exactly at the anchor: a strike quoted on *both* sides is the
        # closest thing to an ATM print. Single-side points fall through to the
        # bracketing interpolation below.
        both = [k for k, legs in by_strike.items() if set(legs) == {"CE", "PE"}]
        if both:
            atm_strike = min(both, key=lambda k: (abs(k - anchor), k))
    if atm_strike is not None:
        values = list(by_strike[atm_strike].values())
        return sum(values) / len(values)

    # Dedupe by strike (averaging CE/PE) so a two-sided neighbour cannot create
    # the equal-strike pair that would short-circuit _interp_by_strike.
    usable = [(k, sum(v.values()) / len(v)) for k, v in sorted(by_strike.items())]
    return _interp_by_strike(usable, anchor)


def gamma_coverage(rows: Any, spot: Any, band_pct: Any = NEAR_ATM_BAND_PCT) -> Optional[float]:
    """Fraction of near-ATM legs that carry a finite, positive gamma.

    ``rows`` are the flat chain rows ``{"strike", "ce": {...}, "pe": {...}}``
    produced by the analytics shaper; each leg carries a ``gamma`` key. Only
    strikes within ``±band_pct`` of spot (default ±5%) count, and both CE and
    PE legs are in the denominator. ``None`` means the chain has no near-ATM
    legs to judge — never a fabricated 0. A dead leg (missing/0/NaN/negative
    gamma) counts against coverage, the same way a dead IV does.
    """
    s = _finite(spot)
    if s is None or s <= 0.0:
        return None
    band = _finite(band_pct)
    if band is None or band < 0.0:
        band = NEAR_ATM_BAND_PCT
    lo, hi = s * (1.0 - band), s * (1.0 + band)
    total = 0
    covered = 0
    for row in rows or ():
        if not isinstance(row, Mapping):
            continue
        strike = _finite(row.get("strike"))
        if strike is None or not (lo <= strike <= hi):
            continue
        for side in ("ce", "pe"):
            leg = _as_mapping(row.get(side))
            gamma = _finite(leg.get("gamma"))
            total += 1
            if gamma is not None and gamma > 0.0:
                covered += 1
    return (covered / total) if total else None


def interp_iv_by_delta(points: Any, target: Any, side: str) -> Optional[float]:
    """IV at a target delta magnitude on one side, without extrapolation.

    Delta is read by magnitude so the caller can pass either ``0.25`` or the
    signed ``-0.25`` for a put; ``side`` decides which wing is used. At least
    two legs with a finite delta are needed to define a span, and the target
    must fall inside the observed |delta| range — outside it there is no data,
    so the answer is ``None`` rather than an invented wing IV.
    """
    if side not in ("CE", "PE"):
        return None
    raw = _finite(target)
    if raw is None or raw == 0.0:
        return None
    magnitude = abs(raw)
    if points is None:
        points = ()
    observed: list[tuple[float, float]] = []
    for point in points:
        if not isinstance(point, Mapping) or point.get("side") != side:
            continue
        iv = _iv(point.get("iv"))
        delta = _finite(point.get("delta"))
        if iv is None or delta is None:
            continue
        observed.append((abs(delta), iv))
    if len(observed) < 2:
        return None
    observed.sort(key=lambda pair: pair[0])
    if magnitude < observed[0][0] or magnitude > observed[-1][0]:
        return None
    for (d0, v0), (d1, v1) in zip(observed, observed[1:]):
        if d0 <= magnitude <= d1:
            if d1 == d0:
                return v0
            weight = (magnitude - d0) / (d1 - d0)
            return v0 + weight * (v1 - v0)
    return None


def wing_iv(
    points: Any,
    side: str,
    *,
    target: Any = DELTA_TARGET,
    delta_band: Any = DELTA_BAND,
) -> tuple[Optional[float], Optional[float]]:
    """``(strike, iv)`` for the wing whose ``|delta|`` is nearest ``target``.

    This is the shared 25-delta wing read used by the IV surface and its
    consumers. A leg only qualifies as the named wing when its ``|delta|``
    lands inside ``delta_band``: without that gate the "nearest to 0.25" leg on
    a gapped chain is a 0.005-delta lottery ticket printing 281 vol points,
    which is not a 25-delta quote at all. Bracketing legs used for interpolation
    may sit outside the band (a 0.38 leg still brackets 0.25 honestly), but the
    wing that is named must be inside it.

    The nearest leg's own IV wins. Interpolation is allowed only when that leg's
    IV is missing *and* both a below- and an above-target leg carry an IV with
    no intervening leg missing one — never a "skip to the next quoted strike"
    fallback, which would silently substitute a different wing.
    """
    wing = side.upper() if isinstance(side, str) else ""
    if wing not in ("CE", "PE"):
        return None, None
    tgt = _finite(target)
    if tgt is None or tgt == 0.0:
        return None, None
    band = delta_band if (isinstance(delta_band, (tuple, list))
                          and len(delta_band) == 2) else DELTA_BAND
    lo, hi = band

    observed: list[tuple[float, float, Optional[float]]] = []
    for point in points or ():
        if not isinstance(point, Mapping) or point.get("side") != wing:
            continue
        strike = _finite(point.get("strike"))
        delta = _finite(point.get("delta"))
        if strike is None or strike <= 0.0 or delta is None:
            continue
        observed.append((strike, abs(delta), _iv(point.get("iv"))))
    candidates = [leg for leg in observed if lo <= leg[1] <= hi]
    if not candidates:
        return None, None

    best = min(candidates, key=lambda leg: (abs(leg[1] - tgt), leg[0]))
    if best[2] is not None:
        return best[0], best[2]

    below = [leg for leg in observed if leg[1] < tgt and leg[2] is not None]
    above = [leg for leg in observed if leg[1] > tgt and leg[2] is not None]
    if not below or not above:
        return best[0], None

    lower = max(below, key=lambda leg: leg[1])
    upper = min(above, key=lambda leg: leg[1])
    if upper[1] == lower[1]:
        return best[0], None
    between = [leg for leg in observed
               if lower[1] < leg[1] < upper[1] and leg[0] != best[0]]
    if any(leg[2] is None for leg in between):
        return best[0], None

    interpolated = (lower[2] + (upper[2] - lower[2])
                    * (tgt - lower[1]) / (upper[1] - lower[1]))
    return best[0], round(interpolated, 4)


def _atm_from_points(points: Any) -> Optional[float]:
    """ATM proxy when the caller has no spot: the 50-delta IV.

    Delta ~0.5 is the ATM strike. Read it on both wings and average to cancel
    call/put noise; if only one wing reaches 50 delta, use that one. A
    one-sided chain with no 50-delta coverage falls back to the strike midpoint
    of the OTM boundary (highest PE strike, lowest CE strike).
    """
    call = interp_iv_by_delta(points, 0.5, "CE")
    put = interp_iv_by_delta(points, -0.5, "PE")
    if call is not None and put is not None:
        return 0.5 * (call + put)
    if call is not None:
        return call
    if put is not None:
        return put
    usable = _usable_by_strike(points)
    if not usable:
        return None
    if points is None:
        points = ()
    ce = [p["strike"] for p in points
          if isinstance(p, Mapping) and p.get("side") == "CE"
          and _finite(p.get("strike")) is not None]
    pe = [p["strike"] for p in points
          if isinstance(p, Mapping) and p.get("side") == "PE"
          and _finite(p.get("strike")) is not None]
    if ce and pe:
        anchor = 0.5 * (min(ce) + max(pe))
    else:
        anchor = 0.5 * (usable[0][0] + usable[-1][0])
    return _interp_by_strike(usable, anchor)


def rr25(points: Any, *, atm: Any = None) -> Optional[dict]:
    """25-delta call/put IVs, risk reversal and butterfly.

    ``rr = call - put`` (positive = calls rich). ``fly = (call+put)/2 - ATM``.
    With no spot argument, ATM is the 50-delta proxy from
    :func:`_atm_from_points`; a caller that knows spot can pass ``atm`` to use
    its own interpolated level. Both wings must be covered at 25 delta or the
    whole read is ``None`` — a one-sided skew is not a skew.
    """
    call = interp_iv_by_delta(points, DELTA_TARGET, "CE")
    put = interp_iv_by_delta(points, -DELTA_TARGET, "PE")
    if call is None or put is None:
        return None
    mid = _finite(atm)
    if mid is None:
        mid = _atm_from_points(points)
    fly = None if mid is None else 0.5 * (call + put) - mid
    return {"call": call, "put": put, "rr": call - put, "fly": fly}


def fit_smile(points: Any, spot: Any, *, weighted: bool = True) -> Optional[dict]:
    """Weighted quadratic smile ``iv = c0 + c1*x + c2*x^2``, ``x = ln(K/spot)``.

    Coefficients are returned in **ascending** power order: ``coef[0]`` is the
    ATM level, ``coef[1]`` the slope at ATM and ``coef[2]`` the curvature.
    OI is the weight (missing/zero OI gets unit weight); when nothing carries
    OI the fit falls back to equal weights. Fewer than five usable points is
    not a fit — callers should use a monotone interpolation instead.

    ``domain`` carries the observed x and strike bounds. A fit is only valid
    inside it: evaluating the polynomial outside ``domain`` would invent vol
    where the chain has no strikes.
    """
    s = _finite(spot)
    if s is None or s <= 0.0:
        return None
    xs: list[float] = []
    ys: list[float] = []
    ws: list[float] = []
    strikes: list[float] = []
    if points is None:
        points = ()
    for point in points:
        if not isinstance(point, Mapping):
            continue
        strike = _finite(point.get("strike"))
        iv = _iv(point.get("iv"))
        if strike is None or strike <= 0.0 or iv is None:
            continue
        x = math.log(strike / s)
        if not math.isfinite(x):
            continue
        oi = _finite(point.get("oi"))
        xs.append(x)
        ys.append(iv)
        ws.append(oi if (oi is not None and oi > 0.0) else 1.0)
        strikes.append(strike)
    n = len(xs)
    if n < 5:
        return None

    x_arr = np.asarray(xs, dtype=float)
    y_arr = np.asarray(ys, dtype=float)
    if weighted:
        w_arr = np.asarray(ws, dtype=float)
        total = float(w_arr.sum())
        w_arr = w_arr / total if math.isfinite(total) and total > 0.0 else np.ones(n)
    else:
        w_arr = np.ones(n)
    sqrt_w = np.sqrt(w_arr)
    try:
        descending = np.polyfit(x_arr, y_arr, 2, w=sqrt_w)
        fitted = np.polyval(descending, x_arr)
    except (ValueError, np.linalg.LinAlgError, TypeError):
        return None

    coef = [float(value) for value in descending[::-1]]
    residuals = y_arr - fitted
    weight_sum = float(np.sum(sqrt_w ** 2))
    ss_res = float(np.sum(sqrt_w ** 2 * residuals ** 2))
    mean = float(np.sum(sqrt_w ** 2 * y_arr) / weight_sum)
    ss_tot = float(np.sum(sqrt_w ** 2 * (y_arr - mean) ** 2))
    if ss_tot > 0.0:
        r2 = 1.0 - ss_res / ss_tot
    else:
        r2 = 1.0 if ss_res <= 1e-12 else 0.0
    if not math.isfinite(r2):
        r2 = 0.0

    return {
        "coef": coef,
        "r2": r2,
        "n": n,
        "domain": {
            "x_min": float(x_arr.min()),
            "x_max": float(x_arr.max()),
            "strike_min": float(min(strikes)),
            "strike_max": float(max(strikes)),
        },
    }


def smile_metrics(points: Any, spot: Any, *, atm: Any = None) -> Optional[dict]:
    """Per-expiry smile summary: ATM, 25-delta RR/BF, ATM slope, fit quality.

    Returns ``None`` only when no usable point exists at all. Partial chains
    keep whatever can be read — a missing wing or a sub-five-point chain shows
    up as ``None`` in the affected fields, never as a fabricated zero.

    ``atm`` lets a caller that built the richer :func:`leg_points` candidate
    set supply the ATM read; the 25-delta fly is then measured against that
    level. Without it the function derives ATM from ``points`` as before.
    """
    usable = _usable_by_strike(points)
    if not usable:
        return None
    atm = _finite(atm) if atm is not None else None
    if atm is None:
        atm = atm_iv(points, spot)
    wings = rr25(points, atm=atm)
    fit = fit_smile(points, spot)

    slope_atm: Optional[float] = None
    r2: Optional[float] = None
    if fit is not None:
        r2 = fit["r2"]
        domain = fit["domain"]
        if domain["x_min"] <= 0.0 <= domain["x_max"]:
            slope_atm = fit["coef"][1]

    fly: Optional[float] = None
    if wings is not None:
        fly = wings["fly"]
        if fly is not None and atm is not None:
            fly = 0.5 * (wings["call"] + wings["put"]) - atm

    return {
        "atm_iv": atm,
        "rr25": wings["rr"] if wings is not None else None,
        "fly25": fly,
        "slope_atm": slope_atm,
        "r2": r2,
        "n": fit["n"] if fit is not None else len(usable),
    }


def filter_quality(points: Any) -> dict:
    """Account for every input point: how many survived, how many did not.

    An invalid IV is charged to ``dropped_iv`` first; a point with a usable IV
    but no finite delta is charged to ``dropped_delta``. ``max_iv`` is the
    largest surviving IV — a quick check that a >60 artefact did not slip in.
    """
    used = 0
    dropped_iv = 0
    dropped_delta = 0
    max_iv: Optional[float] = None
    if points is None:
        points = ()
    for point in points:
        if not isinstance(point, Mapping):
            dropped_iv += 1
            continue
        iv = _iv(point.get("iv"))
        if iv is None:
            dropped_iv += 1
            continue
        if _finite(point.get("delta")) is None:
            dropped_delta += 1
            continue
        used += 1
        max_iv = iv if max_iv is None else max(max_iv, iv)
    return {
        "used": used,
        "dropped_iv": dropped_iv,
        "dropped_delta": dropped_delta,
        "max_iv": max_iv,
    }
