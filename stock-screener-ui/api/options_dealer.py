"""Dealer-hedging analytics — GEX, DEX, vanna, charm and theta.

Pure module: no FastAPI, no network, no DB. Every function takes and returns
plain dicts/lists so the option chain and report routes can reuse one formula
set.

Contract (``dealer_block(rows, spot, dte_years)``)::

    {
      "strikes": [ {"strike", "netGex", "netDex", "vanna", "charm", "theta",
                    "ceOi", "peOi", "ceIv", "peIv"}, ... ],
      "netGex": float | None,     # ₹ Cr per point, from the shared GEX helper
      "netDex": float | None,     # ₹ Cr of delta-equivalent exposure
      "vanna":  float | None,     # OI-weighted BS vanna (₹ Cr / unit σ)
      "charm":  float | None,     # OI-weighted BS charm (₹ Cr / day)
      "theta":  float | None,     # OI-weighted reported theta (₹ Cr / day)
      "zeroGamma": float | None,  # cumulative-GEX zero crossing strike
      "gammaFlip": {"level", "regime", "flipped"},
      "thetaByDte": [ {"dteDays", "theta"}, ... ],  # BS theta decay curve
      "warnings": [str, ...],
    }

Invariants:

* **GEX is never restated.** :func:`api.options_levels.compute_gex` is the
  single owner of the GEX formula, gates and units; this module only forwards
  its output. The anti-drift test asserts exact parity with that function.
* **Nullable, never zero-filled.** A missing delta/IV/theta leaves that
  strike's term ``None``. Aggregates sum the strikes that have data; when none
  do, the aggregate is ``None`` (not ``0``). No NaN/Inf can escape.
* **DEX sign is by side** (call +, put −) with ``|delta|`` magnitude, matching
  the GEX side convention; Upstox's negative put delta is made absolute so a
  put leg never flips the sign the desk expects.
"""
from __future__ import annotations

import math
from typing import Any, Iterable, Optional

from api.options_conventions import DTE_FLOOR_DAYS, IV_MAX, IV_MIN
from api.options_levels import compute_gex, is_thin, normalize_strikes

#: ₹-crore conversion, identical to the one in ``options_levels.compute_gex``.
EXPOSURE_SCALE = 1e7

_DAYS_PER_YEAR = 365.0
#: Upstox prints IV in vol points (18.0 == 18%); the closed-form BS greeks take
#: annualised vol as a decimal (0.18). Without this division d1/d2 blow up and
#: the vanna/charm curves collapse to ~1e-6 — numerically empty on the chart.
_VOL_POINTS_PER_DECIMAL = 100.0
_SQRT_2 = math.sqrt(2.0)
_SQRT_2PI = math.sqrt(2.0 * math.pi)
_TERSE_KEYS = ("oi", "delta", "gamma", "theta", "vega", "iv")
#: Small, fixed grid for the UI's "theta decays as expiry approaches" curve.
_THETA_DTE_GRID = (1, 3, 7, 14, 30)


# ---------------------------------------------------------------------------
# Coercion helpers
# ---------------------------------------------------------------------------

def _finite(value: Any) -> Optional[float]:
    """Finite float or ``None`` — never NaN, Inf or a 0 for missing data."""
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return out if math.isfinite(out) else None


def _num(value: Any, default: float = 0.0) -> float:
    out = _finite(value)
    return default if out is None else out


def _round(value: Optional[float], ndigits: int = 6) -> Optional[float]:
    if value is None or not math.isfinite(value):
        return None
    return round(value, ndigits)


# ---------------------------------------------------------------------------
# Chain leg adapter — accepts nested / flat / terse shapes
# ---------------------------------------------------------------------------

def _leg_values(leg: Any, terse: Optional[dict] = None) -> dict:
    """One CE/PE leg as ``{oi, delta, gamma, theta, vega, iv}``.

    Nested ``market_data``/``option_greeks`` win, then flat leg keys, then the
    ``ce_*``/``pe_*`` terse keys from the row. An invalid IV (non-finite, 0,
    above the shared :data:`IV_MAX`, or flagged ``iv_valid=False``) is ``None``.
    """
    if not isinstance(leg, dict):
        leg = {}
    md = leg.get("market_data") or {}
    gk = leg.get("option_greeks") or {}
    if not isinstance(md, dict):
        md = {}
    if not isinstance(gk, dict):
        gk = {}

    def greek(name: str) -> Optional[float]:
        if name in gk:
            return _finite(gk.get(name))
        return _finite(leg.get(name))

    out = {
        "oi": _num(md.get("oi")) if "oi" in md else _num(leg.get("oi")),
        "delta": greek("delta"),
        "gamma": greek("gamma"),
        "theta": greek("theta"),
        "vega": greek("vega"),
        "iv": greek("iv"),
    }
    for key in _TERSE_KEYS:
        if terse and key in terse:
            out[key] = _num(terse[key]) if key == "oi" else _finite(terse[key])
    if leg.get("iv_valid") is False or gk.get("iv_valid") is False:
        out["iv"] = None
    iv = out["iv"]
    if iv is not None and not (IV_MIN < iv <= IV_MAX):
        out["iv"] = None
    out["oi"] = max(0.0, out["oi"])
    return out


def _terse_for(row: dict, side: str) -> dict:
    prefix = f"{side}_"
    return {k[len(prefix):]: row[k] for k in row
            if k.startswith(prefix) and k[len(prefix):] in _TERSE_KEYS}


def _sanitize(value: Any) -> Any:
    """Replace non-finite numbers with ``None`` before the shared helpers see them.

    ``options_levels._i`` calls ``int(float(x))`` without catching
    ``OverflowError``, so an ``inf`` OI would otherwise raise instead of
    degrading to a warning. This module owns the "no 500 on a bad chain"
    guarantee, so the boundary is here.
    """
    if isinstance(value, dict):
        return {k: _sanitize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize(v) for v in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, str):
        try:
            number = float(value)
        except (ValueError, OverflowError):
            return value
        if not math.isfinite(number):
            return None
    return value


def _row_details(rows: Optional[Iterable[dict]]) -> list[dict]:
    """Per-row leg detail, one entry per dict row (matching ``normalize_strikes``)."""
    out: list[dict] = []
    for row in (rows or []):
        if not isinstance(row, dict):
            continue
        strike = _finite(row.get("strike"))
        out.append({
            "strike": 0.0 if strike is None else strike,
            "ce": _leg_values(row.get("ce"), _terse_for(row, "ce")),
            "pe": _leg_values(row.get("pe"), _terse_for(row, "pe")),
        })
    return out


# ---------------------------------------------------------------------------
# Black–Scholes closed-form vanna / charm / theta
# ---------------------------------------------------------------------------

def _d1d2(spot: float, strike: float, sigma: float, tau: float,
          rate: float) -> Optional[tuple[float, float]]:
    if spot <= 0 or strike <= 0 or sigma <= 0 or tau <= 0:
        return None
    try:
        sqrt_t = math.sqrt(tau)
        d1 = (math.log(spot / strike) + (rate + 0.5 * sigma * sigma) * tau) \
            / (sigma * sqrt_t)
    except (ValueError, ZeroDivisionError, OverflowError):
        return None
    if not math.isfinite(d1):
        return None
    return d1, d1 - sigma * sqrt_t


def _pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / _SQRT_2PI


def _cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / _SQRT_2))


def _bs_vanna(spot: float, strike: float, sigma: float, tau: float,
              rate: float = 0.0) -> Optional[float]:
    """∂²V/∂S∂σ = −φ(d1)·d2/σ (equal for calls and puts)."""
    pair = _d1d2(spot, strike, sigma, tau, rate)
    if pair is None:
        return None
    d1, d2 = pair
    value = -_pdf(d1) * d2 / sigma
    return value if math.isfinite(value) else None


def _bs_charm_per_day(spot: float, strike: float, sigma: float, tau: float,
                      rate: float = 0.0) -> Optional[float]:
    """∂Δ/∂calendar-day = φ(d1)·(d2/(2τ) − r/(σ√τ)) / 365 (calls and puts)."""
    pair = _d1d2(spot, strike, sigma, tau, rate)
    if pair is None:
        return None
    d1, d2 = pair
    annual = _pdf(d1) * (d2 / (2.0 * tau) - rate / (sigma * math.sqrt(tau)))
    value = annual / _DAYS_PER_YEAR
    return value if math.isfinite(value) else None


def _bs_theta_per_day(spot: float, strike: float, sigma: float, tau: float,
                      rate: float = 0.0) -> Optional[float]:
    """Black–Scholes theta per calendar day, call convention.

    At ``rate=0`` (the default) call and put theta are identical; the carry
    term is kept so a desk can layer a rate in later.
    """
    pair = _d1d2(spot, strike, sigma, tau, rate)
    if pair is None:
        return None
    d1, d2 = pair
    annual = (-spot * _pdf(d1) * sigma / (2.0 * math.sqrt(tau))
              - rate * strike * math.exp(-rate * tau) * _cdf(d2))
    value = annual / _DAYS_PER_YEAR
    return value if math.isfinite(value) else None


def _theta_curve(details: list[dict], spot: Optional[float], rate: float) -> list[dict]:
    """OI-weighted BS theta at a fixed grid of DTEs (spot held constant).

    Chain IV is in vol points, so divide into decimal vol before re-pricing;
    the same positive-T floor keeps the grid explicit even for a 0-DTE chain.
    """
    curve: list[dict] = []
    for day in _THETA_DTE_GRID:
        tau = max(day, DTE_FLOOR_DAYS) / _DAYS_PER_YEAR
        total = 0.0
        used = 0
        if spot is not None and spot > 0:
            for item in details:
                strike = item["strike"]
                ce, pe = item["ce"], item["pe"]
                if strike <= 0 or ce["iv"] is None or pe["iv"] is None:
                    continue
                sigma_c = ce["iv"] / _VOL_POINTS_PER_DECIMAL
                sigma_p = pe["iv"] / _VOL_POINTS_PER_DECIMAL
                c = _bs_theta_per_day(spot, strike, sigma_c, tau, rate)
                p = _bs_theta_per_day(spot, strike, sigma_p, tau, rate)
                if c is None or p is None:
                    continue
                total += c * ce["oi"] + p * pe["oi"]
                used += 1
        curve.append({"dteDays": day,
                      "theta": _round(total / EXPOSURE_SCALE) if used else None})
    return curve


def _sum_or_none(values: list[Optional[float]]) -> Optional[float]:
    present = [v for v in values if v is not None]
    return _round(sum(present)) if present else None


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def dealer_block(rows: Optional[Iterable[dict]], spot: Any, dte_years: Any,
                 rate: float = 0.0) -> dict:
    """Dealer-hedging exposures for one option chain.

    ``dte_years`` is time to expiry in years (e.g. ``7/365``); ``rate`` is the
    optional continuous risk-free rate (default 0). Empty, thin or greek-less
    chains return a fully shaped object with warnings — never an exception.
    """
    warnings: set[str] = set()

    safe_rows = [_sanitize(r) for r in (rows or [])]
    normalized = normalize_strikes(safe_rows)
    gex = compute_gex(normalized, spot)
    details = sorted(_row_details(safe_rows), key=lambda d: d["strike"])

    spot_f = _finite(spot)
    if spot_f is None or spot_f <= 0:
        warnings.add("invalid_spot")
        spot_f = None
    tau = _finite(dte_years)
    if tau is None or tau <= 0:
        warnings.add("invalid_dte")
        tau = None
    if not normalized:
        warnings.add("empty_chain")
    if is_thin(normalized):
        warnings.add("thin_chain")
    if gex.get("degraded"):
        warnings.add("gex_degraded")

    if len(details) != len(gex["strikes"]):
        warnings.add("chain_shape_mismatch")

    missing_delta = missing_iv = missing_theta = partial = False
    gex_per_strike: list[Optional[float]] = []
    dex_per_strike: list[Optional[float]] = []
    vanna_per_strike: list[Optional[float]] = []
    charm_per_strike: list[Optional[float]] = []
    theta_per_strike: list[Optional[float]] = []
    strikes_out: list[dict] = []

    for i, item in enumerate(details):
        g = gex["strikes"][i] if i < len(gex["strikes"]) else None
        net_gex = _round(g["net_gex"]) if g else None
        ce, pe = item["ce"], item["pe"]
        strike = item["strike"]

        # DEX — call +, put −, |delta| magnitude so Upstox's negative put
        # delta cannot flip the desk's side convention.
        if ce["delta"] is None or pe["delta"] is None:
            missing_delta = True
            partial = True
            net_dex = None
        else:
            net_dex = _round(
                (abs(ce["delta"]) * ce["oi"] - abs(pe["delta"]) * pe["oi"])
                * spot_f / EXPOSURE_SCALE
            ) if spot_f is not None else None
            if net_dex is None:
                partial = True

        # Vanna / charm — closed-form BS from each leg's own IV. The chain
        # carries IV in vol points, so divide into decimal vol before the
        # formula. A 0-DTE (or otherwise unusable) expiry still gets a positive
        # T floor so the profile is not numerically empty.
        if ce["iv"] is None or pe["iv"] is None:
            missing_iv = True
            partial = True
            vanna = charm = None
        elif spot_f is None or strike <= 0:
            partial = True
            vanna = charm = None
        else:
            tau_vc = tau if tau is not None and tau > 0 else DTE_FLOOR_DAYS / _DAYS_PER_YEAR
            sigma_c = ce["iv"] / _VOL_POINTS_PER_DECIMAL
            sigma_p = pe["iv"] / _VOL_POINTS_PER_DECIMAL
            vc = _bs_vanna(spot_f, strike, sigma_c, tau_vc, rate)
            vp = _bs_vanna(spot_f, strike, sigma_p, tau_vc, rate)
            cc = _bs_charm_per_day(spot_f, strike, sigma_c, tau_vc, rate)
            cp = _bs_charm_per_day(spot_f, strike, sigma_p, tau_vc, rate)
            if None in (vc, vp, cc, cp):
                vanna = charm = None
                partial = True
            else:
                vanna = _round((vc * ce["oi"] + vp * pe["oi"]) / EXPOSURE_SCALE)
                charm = _round((cc * ce["oi"] + cp * pe["oi"]) / EXPOSURE_SCALE)

        # Theta — OI-weighted reported theta (₹/day per contract).
        if ce["theta"] is None or pe["theta"] is None:
            missing_theta = True
            partial = True
            theta = None
        else:
            theta = _round(
                (ce["theta"] * ce["oi"] + pe["theta"] * pe["oi"]) / EXPOSURE_SCALE
            )

        strikes_out.append({
            "strike": strike,
            "netGex": net_gex,
            "netDex": net_dex,
            "vanna": vanna,
            "charm": charm,
            "theta": theta,
            "ceOi": ce["oi"],
            "peOi": pe["oi"],
            "ceIv": ce["iv"],
            "peIv": pe["iv"],
        })
        gex_per_strike.append(net_gex)
        dex_per_strike.append(net_dex)
        vanna_per_strike.append(vanna)
        charm_per_strike.append(charm)
        theta_per_strike.append(theta)

    zero_gamma = gex.get("zero_cross")
    if zero_gamma is not None:
        zero_gamma = _round(zero_gamma)
    regime = str(gex.get("regime") or "flat")
    gamma_flip = {
        "level": zero_gamma,
        "regime": regime,
        # "flipped" = spot sits on the short-gamma side of the crossing.
        "flipped": bool(zero_gamma is not None and regime == "short"),
    }

    if missing_delta:
        warnings.add("missing_delta")
    if missing_iv:
        warnings.add("missing_iv")
    if missing_theta:
        warnings.add("missing_theta")
    if partial:
        warnings.add("partial_chain")

    aggregates = {
        "netGex": _sum_or_none(gex_per_strike),
        "netDex": _sum_or_none(dex_per_strike),
        "vanna": _sum_or_none(vanna_per_strike),
        "charm": _sum_or_none(charm_per_strike),
        "theta": _sum_or_none(theta_per_strike),
    }
    if all(v is None for v in aggregates.values()):
        warnings.add("no_exposure")

    return {
        "strikes": strikes_out,
        **aggregates,
        "zeroGamma": zero_gamma,
        "gammaFlip": gamma_flip,
        "thetaByDte": _theta_curve(details, spot_f, rate),
        "warnings": sorted(warnings),
    }
