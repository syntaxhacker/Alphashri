"""Pure options-chain level analytics shared by the chain and report routes.

No FastAPI, no network, no DB — every function takes and returns plain
dicts/lists so ``/api/options/chain`` and the Nifty report can reuse one
formula set. The GEX constants and algorithm mirror
``api/reports_api/nifty.compute_gex``; the anti-drift test in
``tests/api/test_options_levels.py`` fails when the two diverge.
"""

from __future__ import annotations

import math
import statistics
from collections import Counter
from typing import Any, Iterable, Optional, TypedDict


class Strike(TypedDict):
    """Normalized one-strike view used by every analytics function here."""

    strike: float
    ce_oi: int
    pe_oi: int
    ce_gamma: float
    pe_gamma: float


# Keep in lockstep with api/reports_api/nifty.py (the anti-drift test pins this).
GEX_LEVEL_MIN_SHARE = 0.10
GEX_LEVEL_MAX_DIST_PCT = 0.05
GEX_FLIP_MAX_DIST_PCT = 0.05

WALL_NEAR_DIST_PCT = 0.01
THIN_MIN_TOTAL_OI = 50_000
THIN_MIN_ROWS = 5
THIN_MAX_SINGLE_SHARE = 0.4


def _f(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


def _i(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------

def normalize_strikes(rows: Optional[Iterable[dict]]) -> list[Strike]:
    """Flatten the three chain shapes into one ``Strike`` list.

    Accepts the raw Upstox nested leg (``ce.market_data.oi`` /
    ``ce.option_greeks.gamma``), the report's flat leg (``ce.oi`` /
    ``ce.gamma``), and the terse ``{strike, ce_oi, pe_oi, ce_gamma, pe_gamma}``
    form. Missing/non-dict legs and malformed rows are skipped, never fatal.
    """
    out: list[Strike] = []
    for row in (rows or []):
        if not isinstance(row, dict):
            continue
        ce = row.get("ce") or {}
        pe = row.get("pe") or {}
        if not isinstance(ce, dict):
            ce = {}
        if not isinstance(pe, dict):
            pe = {}

        if "market_data" in ce or "option_greeks" in ce:
            ce_oi = _i((ce.get("market_data") or {}).get("oi"))
            ce_gamma = _f((ce.get("option_greeks") or {}).get("gamma"))
        else:
            ce_oi = _i(ce.get("oi"))
            ce_gamma = _f(ce.get("gamma"))
        if "market_data" in pe or "option_greeks" in pe:
            pe_oi = _i((pe.get("market_data") or {}).get("oi"))
            pe_gamma = _f((pe.get("option_greeks") or {}).get("gamma"))
        else:
            pe_oi = _i(pe.get("oi"))
            pe_gamma = _f(pe.get("gamma"))

        if "ce_oi" in row:
            ce_oi = _i(row.get("ce_oi"))
        if "pe_oi" in row:
            pe_oi = _i(row.get("pe_oi"))
        if "ce_gamma" in row:
            ce_gamma = _f(row.get("ce_gamma"))
        if "pe_gamma" in row:
            pe_gamma = _f(row.get("pe_gamma"))

        out.append({
            "strike": _f(row.get("strike")),
            "ce_oi": ce_oi,
            "pe_oi": pe_oi,
            "ce_gamma": ce_gamma,
            "pe_gamma": pe_gamma,
        })
    out.sort(key=lambda r: r["strike"])
    return out


# ---------------------------------------------------------------------------
# Max pain
# ---------------------------------------------------------------------------

def _payouts(strikes: list[Strike]) -> list[tuple[float, float]]:
    """``(strike, writer payout)`` for every candidate, whole chain."""
    ordered = sorted(strikes, key=lambda r: r["strike"])
    result: list[tuple[float, float]] = []
    for cand in ordered:
        t = cand["strike"]
        loss = 0.0
        for row in ordered:
            s = row["strike"]
            if t > s:
                loss += (t - s) * row["ce_oi"]
            elif t < s:
                loss += (s - t) * row["pe_oi"]
        result.append((t, loss))
    return result


def compute_max_pain(strikes: list[Strike]) -> Optional[float]:
    """Payout-minimising strike over the whole chain, ties -> lowest.

    ``None`` (never ``0``) when there is no open interest anywhere: there is
    no pain level to report, and printing the lowest strike would look like a
    real (and wildly wrong) level.
    """
    if not strikes or not any(r["ce_oi"] or r["pe_oi"] for r in strikes):
        return None
    return min(_payouts(strikes), key=lambda tp: (tp[1], tp[0]))[0]


# ---------------------------------------------------------------------------
# GEX — port of api/reports_api/nifty.compute_gex (constants/gates unchanged)
# ---------------------------------------------------------------------------

def _gex_level(entry: Optional[dict], side: str) -> Optional[dict]:
    return ({"strike": entry["strike"], "net_gex": entry["net_gex"],
             "side": side} if entry else None)


def compute_gex(strikes: list[Strike], spot: float, lot_size: int = 65) -> dict:
    """Simplified dealer gamma exposure per strike, in Cr per point.

    ``lot_size`` is accepted for backwards compatibility but **not applied**:
    Upstox reports option OI in units (shares). The full return shape matches
    ``nifty.compute_gex`` so the anti-drift test can compare them field by
    field. Levels are spot-relative and gated by ``GEX_LEVEL_MIN_SHARE`` /
    ``GEX_LEVEL_MAX_DIST_PCT``; flip by ``GEX_FLIP_MAX_DIST_PCT``.
    """
    spot_f = _f(spot)
    # A zero spot makes every gamma term zero; use the median strike as scale.
    strike_vals = sorted(_f(r.get("strike")) for r in (strikes or []))
    strike_vals = [s for s in strike_vals if s > 0]
    if spot_f <= 0 and strike_vals:
        spot_f = strike_vals[len(strike_vals) // 2]
    has_gamma = any(
        _f(r.get("ce_gamma")) or _f(r.get("pe_gamma"))
        for r in (strikes or [])
    )

    per: list[dict] = []
    for r in strikes or []:
        g_ce = _f(r.get("ce_gamma"))
        g_pe = _f(r.get("pe_gamma"))
        oi_ce = _i(r.get("ce_oi"))
        oi_pe = _i(r.get("pe_oi"))
        if has_gamma:
            call_gex = round(g_ce * oi_ce * spot_f / 1e7, 2)
            put_gex = round(-g_pe * oi_pe * spot_f / 1e7, 2)
        else:
            # No greeks anywhere: OI is the only exposure signal, scaled like
            # real GEX (same Cr conversion with the missing gamma dropped).
            call_gex = round(oi_ce * spot_f / 1e7, 2)
            put_gex = round(-oi_pe * spot_f / 1e7, 2)
        net_gex = round(call_gex + put_gex, 2)
        per.append({"strike": r.get("strike", 0.0), "call_gex": call_gex,
                    "put_gex": put_gex, "net_gex": net_gex})
    per.sort(key=lambda e: e["strike"])
    net_total = round(sum(e["net_gex"] for e in per), 2)
    by_desc = sorted(per, key=lambda e: e["net_gex"], reverse=True)
    by_asc = sorted(per, key=lambda e: e["net_gex"])
    top_positive = [{"strike": e["strike"], "net_gex": e["net_gex"]} for e in by_desc[:2]]
    top_negative = [{"strike": e["strike"], "net_gex": e["net_gex"]} for e in by_asc[:2]]

    peak_abs = max((abs(e["net_gex"]) for e in per), default=0.0)
    min_abs = peak_abs * GEX_LEVEL_MIN_SHARE
    max_dist = spot_f * GEX_LEVEL_MAX_DIST_PCT if spot_f > 0 else 0.0
    near = [e for e in per if max_dist <= 0 or abs(e["strike"] - spot_f) <= max_dist]
    below = [e for e in near if e["strike"] <= spot_f]
    above = [e for e in near if e["strike"] >= spot_f]

    def _pick(entries: list[dict], sign: int) -> Optional[dict]:
        pool = [e for e in entries
                if e["net_gex"] * sign > 0 and abs(e["net_gex"]) >= min_abs]
        if not pool:
            return None
        return max(pool, key=lambda e: e["net_gex"]) if sign > 0 else \
            min(pool, key=lambda e: e["net_gex"])

    support = _pick(below, 1)
    resistance = _pick(above, 1)
    fuel_down = _pick(below, -1)
    fuel_up = _pick(above, -1)
    levels = {
        "support": _gex_level(support, "below"),
        "resistance": _gex_level(resistance, "above"),
        "fuel_down": _gex_level(fuel_down, "below"),
        "fuel_up": _gex_level(fuel_up, "above"),
    }

    crossings: list[float] = []
    cum = 0.0
    cum_at_spot = 0.0
    prev: Optional[float] = None
    for e in per:
        cum = round(cum + e["net_gex"], 2)
        if e["strike"] <= spot_f:
            cum_at_spot = cum
        if prev is not None and prev < 0 <= cum:
            crossings.append(e["strike"])
        prev = cum
    zero_cross = None
    if crossings and cum >= 0 and has_gamma:
        max_flip_dist = spot_f * GEX_FLIP_MAX_DIST_PCT
        candidates = [s for s in crossings if abs(s - spot_f) <= max_flip_dist]
        if candidates:
            zero_cross = min(candidates, key=lambda s: abs(s - spot_f))
    if zero_cross is not None:
        if spot_f < zero_cross and cum_at_spot >= 0:
            zero_cross = None
        elif spot_f > zero_cross and cum_at_spot < 0:
            zero_cross = None
    if abs(cum_at_spot) < 1.0:
        regime = "flat"
    elif cum_at_spot > 0:
        regime = "long"
    else:
        regime = "short"
    return {
        "strikes": per,
        "net_total": net_total,
        "regime": regime,
        "top_positive": top_positive,
        "top_negative": top_negative,
        "levels": levels,
        "zero_cross": zero_cross,
        "degraded": not has_gamma,
    }


# ---------------------------------------------------------------------------
# Walls / shape helpers
# ---------------------------------------------------------------------------

def _oi_key(side: str) -> str:
    s = (side or "").lower()
    if s in {"ce", "call", "calls"}:
        return "ce_oi"
    if s in {"pe", "put", "puts"}:
        return "pe_oi"
    raise ValueError(f"unknown option side: {side!r}")


def _side_of(strike: float, spot: Optional[float]) -> Optional[str]:
    """Unrounded-spot-relative side; ``None`` when spot is unusable."""
    s = _f(spot)
    if s <= 0:
        return None
    return "above" if strike >= s else "below"


def top_walls(strikes: list[Strike], side: str, spot: Optional[float] = None,
              n: int = 3, max_dist: Optional[float] = None) -> list[dict]:
    """Top-``n`` strikes by OI for one leg, ``strength = oi / leg total OI``.

    With ``spot``/``max_dist`` the ranking is limited to strikes within
    ``max_dist`` points of spot. Zero-OI strikes are never returned, so a
    one-sided chain yields no wall for the empty leg.
    """
    key = _oi_key(side)
    total = sum(_i(r.get(key)) for r in strikes)
    pool = strikes
    if spot and max_dist:
        pool = [r for r in strikes
                if abs(_f(r.get("strike")) - _f(spot)) <= float(max_dist)]
    ranked = sorted(pool, key=lambda r: _i(r.get(key)), reverse=True)
    out: list[dict] = []
    for r in ranked:
        oi = _i(r.get(key))
        if oi <= 0:
            continue
        strike = _f(r.get("strike"))
        out.append({
            "strike": strike,
            "side": _side_of(strike, spot),
            "strength": (oi / total) if total else None,
            "oi": oi,
        })
        if len(out) >= n:
            break
    return out


def near_walls(strikes: list[Strike], side: str, spot: Optional[float] = None,
               n: int = 3, max_dist: Optional[float] = None) -> list[dict]:
    """Heaviest OI within 1% of spot, falling back to the global ranking."""
    s = _f(spot)
    if s <= 0:
        return top_walls(strikes, side, spot=spot, n=n, max_dist=max_dist)
    band = float(max_dist) if max_dist is not None else s * WALL_NEAR_DIST_PCT
    near = top_walls(strikes, side, spot=spot, n=n, max_dist=band)
    return near or top_walls(strikes, side, spot=spot, n=n, max_dist=None)


def is_thin(strikes: list[Strike]) -> bool:
    """Failed/empty chain guard: too little OI, too few rows, or one leg dominates."""
    if len(strikes) < THIN_MIN_ROWS:
        return True
    total = sum(_i(r.get("ce_oi")) + _i(r.get("pe_oi")) for r in strikes)
    if total < THIN_MIN_TOTAL_OI:
        return True
    peak = max((max(_i(r.get("ce_oi")), _i(r.get("pe_oi")))
                for r in strikes), default=0)
    return total > 0 and peak / total > THIN_MAX_SINGLE_SHARE


def infer_step(strikes: list[Strike]) -> Optional[float]:
    """Modal positive strike gap, median when no gap repeats."""
    vals = sorted({round(_f(r.get("strike")), 6) for r in strikes})
    gaps = [round(b - a, 6) for a, b in zip(vals, vals[1:]) if b > a]
    if not gaps:
        return None
    freq = Counter(gaps)
    top = max(freq.values())
    if top == 1:
        return round(statistics.median(gaps), 6)
    return round(min(g for g, c in freq.items() if c == top), 6)


def _pain_view(strikes: list[Strike], spot: float) -> Optional[dict]:
    pain = compute_max_pain(strikes)
    if pain is None:
        return None
    payouts = dict(_payouts(strikes))
    payout = payouts.get(pain, 0.0)
    mean = statistics.mean(payouts.values()) if payouts else 0.0
    strength = None if mean <= 0 else \
        round(min(1.0, max(0.0, 1 - payout / mean)), 4)
    return {
        "strike": pain,
        "side": _side_of(pain, spot),
        "strength": strength,
        "payout": round(payout, 2),
    }


def build_levels(rows: Optional[Iterable[dict]], spot: float) -> dict:
    """Contract-shaped ``levels`` object for the chain response.

    Every absent level is ``null`` (never ``0`` / ``{}``); ``side`` comes from
    the unrounded float spot. Walls and max pain survive a 0-DTE chain; GEX
    levels/flip are nulled when the greeks are missing or round to zero.
    """
    strikes = normalize_strikes(rows)
    spot_f = _f(spot)
    gex_raw = compute_gex(strikes, spot_f)
    peak_abs = max((abs(s["net_gex"]) for s in gex_raw["strikes"]), default=0.0)
    total_oi = sum(_i(r.get("ce_oi")) + _i(r.get("pe_oi")) for r in strikes)
    degraded = bool(gex_raw["degraded"]) or total_oi <= 0

    call_top = top_walls(strikes, "ce", spot_f, n=1)
    put_top = top_walls(strikes, "pe", spot_f, n=1)

    def gex_view(level: Optional[dict]) -> Optional[dict]:
        if level is None or degraded:
            return None
        return {
            "strike": level["strike"],
            "side": level["side"] if spot_f > 0 else None,
            "strength": (None if peak_abs <= 0 else
                         round(min(1.0, abs(level["net_gex"]) / peak_abs), 4)),
            "net_gex": level["net_gex"],
        }

    return {
        "spot": spot_f,
        "step": infer_step(strikes),
        "thin": is_thin(strikes),
        "call_wall": call_top[0] if call_top else None,
        "put_wall": put_top[0] if put_top else None,
        "call_walls": near_walls(strikes, "ce", spot_f, n=3),
        "put_walls": near_walls(strikes, "pe", spot_f, n=3),
        "max_pain": _pain_view(strikes, spot_f),
        "gex": {
            "support": gex_view(gex_raw["levels"]["support"]),
            "resistance": gex_view(gex_raw["levels"]["resistance"]),
            "fuel_down": gex_view(gex_raw["levels"]["fuel_down"]),
            "fuel_up": gex_view(gex_raw["levels"]["fuel_up"]),
            "flip": gex_raw["zero_cross"] if not degraded else None,
            "regime": gex_raw["regime"],
            "degraded": degraded,
        },
    }
