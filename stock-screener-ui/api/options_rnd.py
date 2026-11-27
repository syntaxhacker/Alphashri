"""Risk-neutral density (RND / implied PDF) from an option chain.

Pure and self-contained: no FastAPI, DB, network or I/O. Input is the same
chain / ``IvPoint`` shape the rest of the options analytics use (see
:mod:`api.options_iv` and :mod:`api.options_levels`).

Method
------
Breeden-Litzenberger: ``q(K) = e^{rT} d²C/dK²`` where ``C(K)`` is the option
chain translated onto a single *call* price axis. Out-of-the-money puts are
converted to calls by parity ``C = P + S - K e^{-rT}`` (dividend yield ``q=0``),
so one smooth call curve spans the whole strike range. The second derivative is
taken from a *local quadratic fit* to ``C(K)`` (stable enough for price noise)
rather than a raw three-point difference. The density is clamped at zero
(negatives counted in ``negative_density_pct``), then normalized to a discrete
probability mass over the **observed** strikes only — no synthetic wing points
are ever inserted and missing strikes are never zero-filled.

When a chain carries IVs but no reliable traded prices, the small public helper
:func:`pdf_from_smile` imputes call prices from a smooth implied-vol smile
(quadratic in log-moneyness, via :func:`api.options_iv.fit_smile` when there are
enough points; otherwise each leg's own IV). **Assumption:** ``q=0``, IVs are
annualized vol points (percent, as everywhere in the options modules), and
``T = expiry_dte / 365`` calendar days. The resulting PDF is a *model-implied*
estimate — only as good as the smile fit — and is flagged with
``used_smile_fallback``. There is no microstructure/liquidity information in it.

Every degradation is returned as a warning string, never an exception, and the
payload never contains NaN/Inf.
"""

from __future__ import annotations

import math
from typing import Any, Mapping

import numpy as np

from api.options_conventions import IV_MAX, IV_MIN
from api.options_iv import fit_smile

__all__ = ["risk_neutral_density", "pdf_from_smile"]

# --- RND-local conventions -------------------------------------------------
# Named here rather than restated as bare literals; not shared tunables.
MIN_POINTS = 3           # hard floor: a local quadratic needs three points
MIN_RELIABLE_POINTS = 6  # below this a second-derivative read is too sparse
LOCAL_WINDOW = 2         # local quadratic fits up to 2*w+1 neighbouring points
WING_BAND_PCT = 0.05     # expect strikes >=5% below and above spot for full wings
DAYS_PER_YEAR = 365.0
VOL_FLOOR = 0.5          # imputed sigma floor (vol points) to avoid divide-by-zero


def _finite(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return out if math.isfinite(out) else None


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _leg_price(leg: Any) -> float | None:
    """LTP of a leg, supporting the nested Upstox and flat analytics shapes.

    ``close_price`` is deliberately not accepted: it is a stale daily
    reference, not a tradable option price (same rule as :mod:`api.options_iv`).
    """
    data = _mapping(leg)
    if "market_data" in data:
        value = _finite(_mapping(data.get("market_data")).get("ltp"))
        return value if (value is not None and value > 0.0) else None
    for key in ("ltp", "price", "last_price"):
        value = _finite(data.get(key))
        if value is not None and value > 0.0:
            return value
    return None


def _leg_iv(leg: Any) -> float | None:
    data = _mapping(leg)
    if "option_greeks" in data:
        value = _finite(_mapping(data.get("option_greeks")).get("iv"))
    else:
        value = _finite(data.get("iv"))
    return value if (value is not None and IV_MIN < value <= IV_MAX) else None


def _extract_records(points: Any, spot: float, t_years: float, rate: float) -> list[dict]:
    """One record per strike: ``{strike, call_price, iv}``, OTM-preferred.

    Accepts chain rows ``{strike, ce, pe}`` and flat ``IvPoint`` records
    ``{strike, side, iv, ...}``. Puts are turned into call prices via parity so
    a single ``C(K)`` curve can be differentiated. A strike with no usable
    price keeps ``call_price=None``; it is dropped later, never zero-filled.
    """
    disc = math.exp(rate * t_years)
    by_strike: dict[float, dict] = {}
    for item in points or ():
        if not isinstance(item, Mapping):
            continue
        strike = _finite(item.get("strike"))
        if strike is None or strike <= 0.0:
            continue
        if "ce" in item or "pe" in item:
            ce, pe = _mapping(item.get("ce")), _mapping(item.get("pe"))
            ce_price, pe_price = _leg_price(ce), _leg_price(pe)
            ce_iv, pe_iv = _leg_iv(ce), _leg_iv(pe)
        else:
            side = str(item.get("side") or "").upper()
            price = _leg_price(item)
            iv = _leg_iv(item)
            ce_price = price if side == "CE" else None
            pe_price = price if side == "PE" else None
            ce_iv = iv if side == "CE" else None
            pe_iv = iv if side == "PE" else None

        rec = by_strike.setdefault(strike, {
            "strike": strike, "ce_price": None, "pe_price": None,
            "ce_iv": None, "pe_iv": None,
        })
        rec["ce_price"] = ce_price if ce_price is not None else rec["ce_price"]
        rec["pe_price"] = pe_price if pe_price is not None else rec["pe_price"]
        rec["ce_iv"] = ce_iv if ce_iv is not None else rec["ce_iv"]
        rec["pe_iv"] = pe_iv if pe_iv is not None else rec["pe_iv"]

    records: list[dict] = []
    for strike in sorted(by_strike):
        r = by_strike[strike]
        put_to_call = (r["pe_price"] + spot - strike / disc
                       if r["pe_price"] is not None else None)
        if strike > spot:
            price = r["ce_price"] if r["ce_price"] is not None else put_to_call
            iv = r["ce_iv"] if r["ce_iv"] is not None else r["pe_iv"]
        elif strike < spot:
            price = put_to_call if put_to_call is not None else r["ce_price"]
            iv = r["pe_iv"] if r["pe_iv"] is not None else r["ce_iv"]
        else:  # ATM: either leg is a valid C(K); prefer the call quote
            price = r["ce_price"] if r["ce_price"] is not None else put_to_call
            iv = (0.5 * (r["ce_iv"] + r["pe_iv"])
                  if r["ce_iv"] is not None and r["pe_iv"] is not None
                  else (r["ce_iv"] if r["ce_iv"] is not None else r["pe_iv"]))
        if price is not None and not math.isfinite(price):
            price = None
        records.append({"strike": strike, "call_price": price, "iv": iv})
    return records


def _call_prices_from_smile(records: list[dict], spot: float, t_years: float,
                            rate: float) -> tuple[list[float], list[float]]:
    """Impute Black-Scholes call prices from a smooth IV smile.

    ``q=0``; IV is annualized vol in percent (converted to a decimal inside).
    A fitted quadratic in log-moneyness is used when there are enough points;
    otherwise each strike's own IV is used. Sigma is clamped to
    ``[VOL_FLOOR, IV_MAX]`` so a dead wing cannot bend the price curve.
    """
    usable = [(r["strike"], r["iv"]) for r in records if r["iv"] is not None]
    if not usable or spot <= 0.0:
        return [], []
    strikes = sorted({k for k, _ in usable})

    fit = fit_smile([{"strike": k, "iv": v, "side": "CE"} for k, v in usable], spot)
    if fit is not None:
        c0, c1, c2 = fit["coef"]

        def sigma(k: float) -> float:
            x = math.log(k / spot)
            return min(max(c0 + c1 * x + c2 * x * x, VOL_FLOOR), IV_MAX)
    else:
        by_k = dict(usable)

        def sigma(k: float) -> float:
            return min(max(by_k.get(k, VOL_FLOOR), VOL_FLOOR), IV_MAX)

    disc = math.exp(rate * t_years)
    sqT = math.sqrt(t_years) if t_years > 0.0 else 0.0
    prices: list[float] = []
    for k in strikes:
        s = sigma(k) / 100.0
        denom = s * sqT
        if denom > 0.0:
            d1 = (math.log(spot / k) + (rate + 0.5 * s * s) * t_years) / denom
            d2 = d1 - denom
            price = spot * _norm_cdf(d1) - k / disc * _norm_cdf(d2)
        else:  # 0-DTE: payoff is a step, intrinsic value is the only price
            price = max(spot - k, 0.0)
        prices.append(price)
    return strikes, prices


def _local_quad_second(x: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Second derivative of a local quadratic fit, vectorized over strikes.

    For every strike the original code fitted ``c ~ a0 + a1*x + a2*x^2`` to the
    ``2*LOCAL_WINDOW+1`` centred neighbours (NaN-padded at the edges, so the
    first/last strikes use the nearest three points) and took ``2*a2``. That is a
    linear functional of the window's prices, so it is computed here in one
    batched least-squares solve instead of one ``np.polyfit`` per strike.

    ``x`` is centred per window by its weighted mean, which leaves the fitted
    quadratic coefficient unchanged but keeps the normal equations well
    conditioned. The result is mathematically identical to the old polyfit
    windows (up to float round-off), including edge handling; it also works on
    non-uniform strike grids.
    """
    n = x.size
    half = LOCAL_WINDOW
    max_w = 2 * half + 1

    xpad = np.full(n + 2 * half, np.nan, dtype=float)
    cpad = np.full(n + 2 * half, np.nan, dtype=float)
    xpad[half:half + n] = x
    cpad[half:half + n] = c
    X = np.lib.stride_tricks.sliding_window_view(xpad, max_w)  # (n, max_w)
    C = np.lib.stride_tricks.sliding_window_view(cpad, max_w)  # (n, max_w)

    w = (np.isfinite(X) & np.isfinite(C)).astype(float)
    wsum = w.sum(axis=1)
    Xf = np.where(w > 0.0, X, 0.0)
    Cf = np.where(w > 0.0, C, 0.0)
    xc = np.where(w > 0.0, X - (Xf.sum(axis=1) / wsum)[:, None], 0.0)

    # Gram matrix / RHS of the normal equations for [1, xc, xc^2].
    s0 = wsum
    s1 = (w * xc).sum(axis=1)
    s2 = (w * xc * xc).sum(axis=1)
    s3 = (w * xc * xc * xc).sum(axis=1)
    s4 = (w * xc * xc * xc * xc).sum(axis=1)
    t0 = (w * Cf).sum(axis=1)
    t1 = (w * Cf * xc).sum(axis=1)
    t2 = (w * Cf * xc * xc).sum(axis=1)

    mat = np.empty((n, 3, 3), dtype=float)
    mat[:, 0, 0], mat[:, 0, 1], mat[:, 0, 2] = s0, s1, s2
    mat[:, 1, 0], mat[:, 1, 1], mat[:, 1, 2] = s1, s2, s3
    mat[:, 2, 0], mat[:, 2, 1], mat[:, 2, 2] = s2, s3, s4
    rhs = np.stack((t0, t1, t2), axis=1)

    # A valid window has >=3 points and >=2 distinct strikes (full rank).
    valid = (wsum >= MIN_POINTS) & (s2 > 1e-12)
    second = np.zeros(n, dtype=float)
    if np.any(valid):
        try:
            coef = np.linalg.solve(mat[valid], rhs[valid][..., None])[..., 0]
            second[valid] = 2.0 * coef[:, 2]
        except np.linalg.LinAlgError:  # degenerate window -> leave zero
            pass
    return second


def _bl_density(strikes: list[float],
                call_prices: list[float | None],
                t_years: float,
                rate: float) -> tuple[list[float], np.ndarray, float]:
    """Breeden-Litzenberger density at the observed strikes.

    Returns ``(grid, raw_density, negative_pct)``. The density is not yet
    normalized; negatives are counted then clamped to zero.
    """
    idx = [i for i, p in enumerate(call_prices)
           if p is not None and math.isfinite(p)]
    if len(idx) < MIN_POINTS:
        return [], np.array([], dtype=float), 0.0

    ks = np.asarray([strikes[i] for i in idx], dtype=float)
    cs = np.asarray([call_prices[i] for i in idx], dtype=float)
    n = len(ks)
    center = float(np.mean(ks))
    scale = abs(float(np.std(ks)))
    if scale == 0.0:
        scale = abs(center) or 1.0
    x = (ks - center) / scale

    disc = math.exp(rate * t_years)
    raw = disc * _local_quad_second(x, cs) / (scale * scale)
    raw = np.where(np.isfinite(raw), raw, 0.0)

    negative_pct = float(np.sum(raw < 0.0)) / n if n else 0.0
    raw = np.clip(raw, 0.0, None)
    return list(ks), raw, negative_pct


def _empty(warnings: list[str], forward: float | None) -> dict:
    return {
        "strikes": [], "density": [], "cdf": [],
        "mean": None, "forward": forward, "warnings": warnings,
        "negative_density_pct": 0.0,
    }


def _finalize(grid: list[float], raw: np.ndarray, negative_pct: float,
              forward: float | None, warnings: list[str]) -> dict:
    if len(grid) < MIN_POINTS or len(raw) != len(grid):
        return _empty(warnings + ["insufficient_data"], forward)
    total = float(np.sum(raw))
    if not math.isfinite(total) or total <= 0.0:
        return _empty(warnings + ["degenerate_density"], forward)

    density = raw / total
    cdf = np.cumsum(density)
    mean = float(np.sum(np.asarray(grid, dtype=float) * density))
    if not math.isfinite(mean):
        mean = None

    has_lower = (any(k <= forward * (1.0 - WING_BAND_PCT) for k in grid)
                 if forward else False)
    has_upper = (any(k >= forward * (1.0 + WING_BAND_PCT) for k in grid)
                 if forward else False)
    if not (has_lower and has_upper):
        warnings.append("missing_wings")
    if len(grid) < MIN_RELIABLE_POINTS:
        warnings.append("too_few_points")
    if negative_pct > 0.0:
        warnings.append("negative_density_clamped")

    return {
        "strikes": [float(k) for k in grid],
        "density": [float(v) if math.isfinite(v) else 0.0 for v in density],
        "cdf": [float(v) if math.isfinite(v) else 0.0 for v in cdf],
        "mean": mean,
        "forward": forward,
        "warnings": warnings,
        "negative_density_pct": float(negative_pct),
    }


def risk_neutral_density(points: Any, spot: Any, expiry_dte: Any,
                         rate: float = 0.0) -> dict:
    """Risk-neutral density from a chain, with graceful degradation.

    ``points`` accepts chain rows ``{strike, ce, pe}`` or flat ``IvPoint``
    records ``{strike, side, iv, ...}``; a leg price is read from ``ltp`` /
    ``price`` / ``last_price``. Traded prices are used first. If fewer than
    :data:`MIN_POINTS` strikes carry a price but IVs are present, the smile
    fallback (:func:`pdf_from_smile`) is used instead.

    Returns ``{strikes, density, cdf, mean, forward, warnings,
    negative_density_pct}``. ``density`` is a discrete probability mass
    (``sum(density) == 1``, ``cdf[-1] == 1``) over the returned strikes only.
    """
    warnings: list[str] = []
    s = _finite(spot)
    dte = _finite(expiry_dte)
    r = _finite(rate)
    r = r if r is not None else 0.0
    t_years = max(dte, 0.0) / DAYS_PER_YEAR if dte is not None else 0.0
    forward = s * math.exp(r * t_years) if (s is not None and s > 0.0) else None

    if s is None or s <= 0.0:
        return _empty(warnings + ["invalid_spot"], forward)
    if dte is None or dte < 0.0:
        return _empty(warnings + ["invalid_expiry"], forward)

    records = _extract_records(points, s, t_years, r)
    if not records:
        return _empty(warnings + ["no_option_points"], forward)

    strikes = [rec["strike"] for rec in records]
    prices = [rec["call_price"] for rec in records]
    price_count = sum(1 for p in prices if p is not None and math.isfinite(p) and p > 0.0)
    if price_count < MIN_RELIABLE_POINTS:
        warnings.append("insufficient_prices")

    grid, raw, neg_pct = _bl_density(strikes, prices, t_years, r)
    if len(grid) < MIN_POINTS:
        smile_strikes, smile_prices = _call_prices_from_smile(records, s, t_years, r)
        if len(smile_strikes) >= MIN_POINTS:
            grid, raw, neg_pct = _bl_density(smile_strikes, smile_prices, t_years, r)
            warnings.append("used_smile_fallback")

    return _finalize(grid, raw, neg_pct, forward, warnings)


def pdf_from_smile(points: Any, spot: Any, expiry_dte: Any,
                   rate: float = 0.0) -> dict:
    """Implied PDF from IVs alone (the chain has no reliable traded prices).

    Pure helper with the same return contract as :func:`risk_neutral_density`.
    Assumption: no dividends (``q=0``), IVs are annualized vol points,
    ``T = expiry_dte / 365``, and the smile is smooth enough to impute call
    prices from. The output is a *model-implied* PDF, not a market read; the
    ``used_smile_fallback`` warning is always present so callers can label it.
    """
    warnings: list[str] = ["used_smile_fallback"]
    s = _finite(spot)
    dte = _finite(expiry_dte)
    r = _finite(rate)
    r = r if r is not None else 0.0
    t_years = max(dte, 0.0) / DAYS_PER_YEAR if dte is not None else 0.0
    forward = s * math.exp(r * t_years) if (s is not None and s > 0.0) else None

    if s is None or s <= 0.0:
        return _empty(warnings + ["invalid_spot"], forward)
    if dte is None or dte < 0.0:
        return _empty(warnings + ["invalid_expiry"], forward)

    records = _extract_records(points, s, t_years, r)
    strikes, prices = _call_prices_from_smile(records, s, t_years, r)
    grid, raw, neg_pct = _bl_density(strikes, prices, t_years, r)
    return _finalize(grid, raw, neg_pct, forward, warnings)
