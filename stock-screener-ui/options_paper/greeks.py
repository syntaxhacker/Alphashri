"""Option greeks and P&L attribution for the paper sandbox.

Why this module exists
----------------------
The v1 engine priced only the premium: it knew a trade made or lost rupees but
not *why*. For an option buyer, the premium moves for four reasons — the
underlying (delta, gamma), time passing (theta) and implied vol (vega) — and
without them a P&L number is uninterpretable. This module adds that lens.

Model
-----
Black-76 on the **forward**: index options are priced off the forward ``F``,
which we recover from the recorded premium pair by put-call parity,

    F = K + (C - P) * exp(r T)

so the implied forward is *observed*, not assumed. Implied vol is then inverted
from either leg with a bisection search, and greeks are central differences on
the Black-76 price (robust, and no scipy dependency).

Conventions (all disclosed, none hidden)
----------------------------------------
* ``r`` default 6.5% — the RBI repo rate band, applied flat. A real desk would
  use the OIS curve; the flat rate is a documented approximation.
* ``T`` is **calendar** time to the contract expiry, floored at 15 minutes so
  greeks stay finite on a 0-DTE close.
* delta/gamma are with respect to the **spot** (index level); vega is per one
  **vol point** (1%); theta is per **calendar day**.
* Attribution is a first-order Taylor decomposition; the residual is reported,
  never hidden, so a bad fit is visible.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

RISK_FREE = 0.065          # flat annual rate (RBI repo band); disclosed, not fitted
MIN_T_YEARS = 15.0 / (60 * 24 * 365)   # 15 minutes, keeps 0-DTE greeks finite
DAYS_PER_YEAR = 365.0


# --------------------------------------------------------------------------
# Normal distribution helpers (no scipy)
# --------------------------------------------------------------------------
def norm_cdf(x: float) -> float:
    """Standard normal CDF (no scipy)."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _d1_d2(f: float, k: float, sigma: float, t: float) -> tuple[float, float]:
    v = sigma * math.sqrt(t)
    d1 = (math.log(f / k) + 0.5 * sigma * sigma * t) / v
    return d1, d1 - v


def black76(f: float, k: float, t: float, sigma: float, opt: str,
            r: float = RISK_FREE) -> float:
    """Undiscounted-forward Black-76 price of a European option."""
    if f <= 0 or k <= 0 or t <= 0 or sigma <= 0:
        return 0.0
    d1, d2 = _d1_d2(f, k, sigma, t)
    disc = math.exp(-r * t)
    if opt.upper() == "CE":
        return disc * (f * norm_cdf(d1) - k * norm_cdf(d2))
    return disc * (k * norm_cdf(-d2) - f * norm_cdf(-d1))


def bs_price(side: str, spot: float, strike: float, t_years: float, iv: float,
             r: float) -> float:
    """Black-Scholes premium on the SPOT (not the forward), floored at intrinsic.

    The SENSEX backtests price premiums this way while this module's
    :func:`black76` prices off the forward. Both models are kept explicit:
    mixing them silently changes every premium by the forward adjustment.

    ``r`` has no default on purpose — the backtests that use this priced with
    5%, while this module's :data:`RISK_FREE` is 6.5%, and a shared default
    would quietly re-price historical results.
    """
    t = max(t_years, 1e-6)
    intrinsic = max(spot - strike, 0) if side.upper() == "CE" else max(strike - spot, 0)
    d1 = (math.log(spot / strike) + (r + iv * iv / 2) * t) / (iv * math.sqrt(t))
    d2 = d1 - iv * math.sqrt(t)
    if side.upper() == "CE":
        value = spot * norm_cdf(d1) - strike * math.exp(-r * t) * norm_cdf(d2)
    else:
        value = strike * math.exp(-r * t) * norm_cdf(-d2) - spot * norm_cdf(-d1)
    return max(value, intrinsic)


def implied_forward(k: float, ce: float, pe: float, t: float,
                    r: float = RISK_FREE) -> float | None:
    """Forward from put-call parity, ``F = K + (C - P) e^{rT}``.

    Returns None when either leg is missing/unpriced. The result is a genuine
    market observation (the market's own forward), which is why we prefer it to
    ``S e^{rT}``.
    """
    if ce <= 0 or pe <= 0 or t <= 0:
        return None
    f = k + (ce - pe) * math.exp(r * t)
    return f if f > 0 else None


def implied_vol(price: float, f: float, k: float, t: float, opt: str,
                r: float = RISK_FREE, lo: float = 0.005,
                hi: float = 5.0) -> float | None:
    """Invert Black-76 for sigma by bisection. None if the price is unruly."""
    if price <= 0 or f <= 0 or k <= 0 or t <= 0:
        return None
    disc = math.exp(-r * t)
    intrinsic = disc * (max(f - k, 0.0) if opt.upper() == "CE" else max(k - f, 0.0))
    if price < intrinsic - 1e-6:          # below intrinsic = stale/arb print
        return None
    if black76(f, k, t, hi, opt, r) < price:
        return None
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if black76(f, k, t, mid, opt, r) < price:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


# --------------------------------------------------------------------------
# Greeks
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Greeks:
    delta: float          # per 1 index point (spot)
    gamma: float          # per 1 index point^2
    theta: float          # per calendar day (rupees of premium per unit)
    vega: float           # per 1 vol point (1% = 0.01 in sigma)
    iv: float             # implied vol, annualised fraction
    price: float          # model price (should match the market input)
    t_years: float
    forward: float

    def as_dict(self) -> dict:
        return {
            "delta": round(self.delta, 4), "gamma": round(self.gamma, 6),
            "theta": round(self.theta, 4), "vega": round(self.vega, 4),
            "iv": round(self.iv, 4), "price": round(self.price, 4),
            "t_years": round(self.t_years, 6), "forward": round(self.forward, 2),
        }


def _spot_from_forward(f: float, t: float, r: float) -> float:
    return f * math.exp(-r * t)


def greeks_from_iv(f: float, k: float, t: float, sigma: float, opt: str,
                   r: float = RISK_FREE) -> "Greeks":
    """Greeks directly from a known sigma (no inversion) via central differences."""
    t = max(t, MIN_T_YEARS)
    s = _spot_from_forward(f, t, r)
    eps_s = max(s * 1e-4, 0.5)
    eps_v = 1e-3
    eps_t = min(t * 1e-3, 1.0 / 365.0)

    p_up = black76(f * (1 + eps_s / s), k, t, sigma, opt, r)
    p_dn = black76(f * (1 - eps_s / s), k, t, sigma, opt, r)
    p_c = black76(f, k, t, sigma, opt, r)
    delta = (p_up - p_dn) / (2 * eps_s)
    gamma = (p_up - 2 * p_c + p_dn) / (eps_s * eps_s)
    vega = (black76(f, k, t, sigma + eps_v, opt, r)
            - black76(f, k, t, sigma - eps_v, opt, r)) / (2 * eps_v) / 100.0
    t_dn = max(t - eps_t, MIN_T_YEARS)
    theta = (black76(f, k, t_dn, sigma, opt, r) - p_c) / (eps_t * DAYS_PER_YEAR)
    return Greeks(delta=delta, gamma=gamma, theta=theta, vega=vega,
                  iv=sigma, price=p_c, t_years=t, forward=f)


def greeks(price: float, f: float, k: float, t: float, opt: str,
           r: float = RISK_FREE) -> Greeks | None:
    """Greeks from a market premium via implied vol + central differences."""
    t = max(t, MIN_T_YEARS)
    sigma = implied_vol(price, f, k, t, opt, r)
    if sigma is None:
        return None
    return greeks_from_iv(f, k, t, sigma, opt, r)


# --------------------------------------------------------------------------
# P&L attribution — decompose a premium move into its greek sources
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Attribution:
    d_spot: float
    d_iv_points: float
    hours: float
    delta_pnl: float
    gamma_pnl: float
    theta_pnl: float
    vega_pnl: float
    explained: float
    actual: float
    residual: float
    g_entry: Greeks
    g_exit: Greeks | None

    def as_dict(self) -> dict:
        d = {
            "d_spot": round(self.d_spot, 2),
            "d_iv_points": round(self.d_iv_points, 2),
            "hours": round(self.hours, 1),
            "delta_pnl": round(self.delta_pnl, 4),
            "gamma_pnl": round(self.gamma_pnl, 4),
            "theta_pnl": round(self.theta_pnl, 4),
            "vega_pnl": round(self.vega_pnl, 4),
            "explained": round(self.explained, 4),
            "actual": round(self.actual, 4),
            "residual": round(self.residual, 4),
            "entry": self.g_entry.as_dict(),
        }
        d["exit"] = self.g_exit.as_dict() if self.g_exit else None
        return d


def attribute(entry_premium: float, exit_premium: float, entry_spot: float,
              exit_spot: float, entry_iv: float, exit_iv: float, f_entry: float,
              k: float, t_entry: float, t_exit: float, opt: str,
              hold_min: float, r: float = RISK_FREE,
              short: bool = False) -> Attribution | None:
    """Taylor-decompose ``exit_premium - entry_premium`` into greek sources.

    All terms are per unit of premium (i.e. per share of the option), so they
    sum to the per-unit premium change. Sign is applied for a long by default;
    pass ``short=True`` to flip (a short's P&L is the negative premium move).
    """
    ge = greeks(entry_premium, f_entry, k, max(t_entry, MIN_T_YEARS), opt, r)
    if ge is None:
        return None
    sgn = -1.0 if short else 1.0
    d_spot = exit_spot - entry_spot
    d_iv = (exit_iv - entry_iv) * 100.0            # vol points
    dt_days = hold_min / (60.0 * 24.0)

    delta_pnl = ge.delta * d_spot
    gamma_pnl = 0.5 * ge.gamma * d_spot * d_spot
    theta_pnl = ge.theta * dt_days
    vega_pnl = ge.vega * d_iv
    explained = delta_pnl + gamma_pnl + theta_pnl + vega_pnl
    actual = (exit_premium - entry_premium)

    # exit greeks: the model only needs a forward, so use S e^{rT} at exit
    f_x = exit_spot * math.exp(r * max(t_exit, MIN_T_YEARS))
    gx = greeks(exit_premium, f_x, k, max(t_exit, MIN_T_YEARS), opt, r)

    return Attribution(
        d_spot=d_spot, d_iv_points=d_iv, hours=hold_min / 60.0,
        delta_pnl=sgn * delta_pnl, gamma_pnl=sgn * gamma_pnl,
        theta_pnl=sgn * theta_pnl, vega_pnl=sgn * vega_pnl,
        explained=sgn * explained, actual=sgn * actual,
        residual=sgn * (actual - explained), g_entry=ge, g_exit=gx,
    )
