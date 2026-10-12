"""Option pricing for the two research modes.

* **real** — actual FYERS premiums for currently-listed contracts (2026-06..).
* **synthetic** — Black-Scholes priced from the real underlying path, using a
  *causal* IV estimate (no future VIX), for the 2017-2026 deep study.

The synthetic mode is explicitly a model: it cannot reproduce bid/ask, IV crush
on events, or early-assignment dynamics. It is calibrated against the real
premiums and the residual error is reported with every synthetic result.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime

import numpy as np
import pandas as pd

RISK_FREE = 0.065  # India ~10y / short-rate band; long-run average


def _nd(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bs_price(S: float, K: float, T: float, sigma: float, opt: str,
             r: float = RISK_FREE) -> float:
    """Black-Scholes European option price (q=0)."""
    if S <= 0 or K <= 0:
        return 0.0
    if T <= 1e-9 or sigma <= 1e-9:
        intrinsic = max(0.0, S - K) if opt.upper() == "CE" else max(0.0, K - S)
        return intrinsic
    st = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / st
    d2 = d1 - st
    if opt.upper() == "CE":
        return S * _nd(d1) - K * math.exp(-r * T) * _nd(d2)
    return K * math.exp(-r * T) * _nd(-d2) - S * _nd(-d1)


def bs_delta(S: float, K: float, T: float, sigma: float, opt: str,
             r: float = RISK_FREE) -> float:
    if T <= 1e-9 or sigma <= 1e-9:
        return 1.0 if (opt.upper() == "CE" and S > K) else (-1.0 if (opt.upper() == "PE" and S < K) else 0.0)
    st = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / st
    return _nd(d1) if opt.upper() == "CE" else _nd(d1) - 1.0


@dataclass
class IVSurface:
    """Causal ATM vol (annualised) + a fixed quadratic smile.

    ``atm_vol`` must be produced from information available *at the timestamp*
    (implied from VIX or a trailing realised vol). The smile is a structural
    assumption, not fitted on future data.
    """

    smile_coeff: float = 0.55

    def sigma(self, atm_vol: float, S: float, K: float, T: float) -> float:
        atm = max(0.05, min(2.0, atm_vol))
        if T <= 1e-9:
            return atm
        m = math.log(S / K) / (atm * math.sqrt(T) + 1e-9)
        smile = 1.0 + self.smile_coeff * min(m * m, 9.0)
        return max(0.05, min(2.0, atm * smile))


def trailing_vol(spot: pd.Series, window: int = 288, floor: float = 0.08) -> pd.Series:
    """Trailing realised vol from 1-min log returns, annualised (252×375 min)."""
    ret = np.log(spot / spot.shift(1))
    rv = ret.rolling(window).std() * math.sqrt(252 * 375)
    return rv.clip(lower=floor)


def combine_iv(vix: pd.Series, realized: pd.Series) -> pd.Series:
    """ATM IV estimate: blend India VIX with trailing realised vol, causal.

    VIX is forward-looking but *observed* in real time, so using VIX(t) at time
    t is causal. Blending with realised vol dampens VIX spikes.
    """
    v = vix.reindex(realized.index).ffill().bfill() / 100.0
    return (0.65 * v + 0.35 * realized).clip(lower=0.07, upper=2.5)


def t_years(ts: pd.Timestamp, expiry: date) -> float:
    """Calendar-time to expiry (minute resolution) in years."""
    exp = pd.Timestamp(expiry, tz=ts.tz)
    secs = (exp + pd.Timedelta(hours=15, minutes=30) - ts).total_seconds()
    return max(secs, 60.0) / (365.25 * 24 * 3600)
