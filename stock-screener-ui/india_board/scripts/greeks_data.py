#!/usr/bin/env python3
"""Derived IV / greeks analytics for the India board (roadmap wave W1b).

Pure, offline-testable functions over an already-fetched Fyers chain payload
(the shape produced by ``fyers_data.get_chain(ticker, greeks=True)``)::

    {ticker, spot, expiries, expiry, expiry_flag, call_oi, put_oi, as_of,
     indiavix,
     strikes: [{strike, ce_oi, pe_oi, ..., ce_iv, pe_iv,
                ce_delta, ce_gamma, ce_theta, ce_vega,
                pe_delta, pe_gamma, pe_theta, pe_vega}]}

Missing greeks are ``None`` (never 0) — this module treats ``None`` as
"unavailable" and never fabricates a number.

No network calls happen here; callers hand in chain dicts. ``fyers_data`` is
imported *lazily*, only inside the Black-Scholes GEX fallback, so this module
imports cleanly even while ``fyers_data.py`` is being edited in parallel.

Implements:
  F5 iv_metrics        — ATM IV, 25Δ call/put, risk reversal, butterfly, skew
  F5 term_structure    — ATM IV per expiry, front/next spread, contango flag
  F6 gex_from_greeks   — dealer GEX from *true* gamma (replaces BS back-solve)
  F5 iv_rank           — IV rank + percentile over a historical series
  F7 vrp               — IV − HV20 and a CHEAP/FAIR/EXPENSIVE verdict

Every returned number is JSON-safe: NaN/Inf are normalised to ``None``.
"""
from __future__ import annotations

import math
import statistics
from datetime import date, datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

#: Frozen W1b interface literal (sic — "fyerts"); kept verbatim so callers can
#: key off the agreed string. Change only with the interface owner.
IV_SOURCE_FYERS = "fyers_greeks"
IV_SOURCE_BS = "bs_backsolved"
IV_SOURCE_NONE = "none"

#: Below this many IV-carrying legs the smile is too sparse to read.
_MIN_IV_LEGS = 5
#: Below this many history points IV rank/percentile is statistically junk.
_MIN_IV_SERIES = 10
#: A front/next ATM-IV spread inside +/- this band is "flat" (IV units).
_TERM_FLAT_EPS = 0.0025
#: OI * gamma * spot^2 * 0.01, then /1e7 -> Rs crore of dealer gamma per 1% move.
_GEX_SCALE = 0.01 / 1e7

__all__ = [
    "IV_SOURCE_FYERS",
    "IV_SOURCE_BS",
    "IV_SOURCE_NONE",
    "iv_metrics",
    "term_structure",
    "gex_from_greeks",
    "iv_rank",
    "vrp",
    "summarize",
]


# ---------------------------------------------------------------------------
# coercion / sanitising
# ---------------------------------------------------------------------------
def _num(value, default=None):
    """Finite float or ``default`` — None and NaN/Inf map to ``default``."""
    try:
        if value is None:
            return default
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


def _iv_ok(value):
    """Finite, strictly positive IV — or ``None``.

    Fyers returns ``iv: 0.0`` for illiquid/deep-OTM legs; a zero IV is not a
    real quote and would poison ATM interpolation, skew and max/min IV.
    """
    out = _num(value)
    return out if out is not None and out > 0 else None


def _clean(value):
    """Recursively replace non-finite floats with ``None`` (JSON safety)."""
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _interp_value(points, x, clamp=False):
    """Linear interpolation over sorted ``(x, y)`` points.

    ``clamp=False`` returns ``None`` when ``x`` falls outside the sampled
    range (used for delta targets). ``clamp=True`` snaps to the nearest edge
    (used for the ATM spot, which may sit just outside the strike grid).
    """
    if not points or x is None:
        return None
    pts = sorted(points, key=lambda p: p[0])
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    if x <= xs[0]:
        return ys[0] if (clamp or x == xs[0]) else None
    if x >= xs[-1]:
        return ys[-1] if (clamp or x == xs[-1]) else None
    for i in range(1, len(xs)):
        if xs[i] >= x:
            x0, x1 = xs[i - 1], xs[i]
            y0, y1 = ys[i - 1], ys[i]
            if x1 == x0:
                return y0
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return ys[-1]


# ---------------------------------------------------------------------------
# F5 — IV skew metrics
# ---------------------------------------------------------------------------
def _rows(chain):
    return [r for r in (chain.get("strikes") or []) if isinstance(r, dict)]


def _smile_points(chain, spot):
    """OTM-convention smile: puts below spot, calls above, mean at the money."""
    pts = []
    for row in _rows(chain):
        k = _num(row.get("strike"))
        if k is None or k <= 0:
            continue
        ce = _iv_ok(row.get("ce_iv"))
        pe = _iv_ok(row.get("pe_iv"))
        if spot is not None and k < spot:
            v = pe if pe is not None else ce
        elif spot is not None and k > spot:
            v = ce if ce is not None else pe
        else:
            vals = [v for v in (ce, pe) if v is not None]
            v = sum(vals) / len(vals) if vals else None
        if v is not None:
            pts.append((k, v))
    return pts


def _atm_iv(chain, spot):
    """``(atm_iv, atm_strike)`` interpolated to spot (median strike if no spot)."""
    pts = _smile_points(chain, spot)
    if not pts:
        return None, None
    anchor = spot if spot is not None else statistics.median([p[0] for p in pts])
    atm_strike = min((p[0] for p in pts), key=lambda k: abs(k - anchor))
    return _interp_value(pts, anchor, clamp=True), atm_strike


def _delta_points(chain, side):
    """``(delta, iv)`` points for a side, normalising delta sign convention.

    Real broker deltas are used verbatim for the *value*; only the sign is
    normalised (calls >= 0, puts <= 0) so a provider that emits absolute-value
    put deltas still interpolates correctly.
    """
    pts = []
    for row in _rows(chain):
        iv = _iv_ok(row.get(f"{side}_iv"))
        d = _num(row.get(f"{side}_delta"))
        if iv is None or d is None:
            continue
        d = abs(d) if side == "ce" else -abs(d)
        pts.append((d, iv))
    return pts


def _iv_at_delta(chain, side, target):
    return _interp_value(_delta_points(chain, side), target, clamp=False)


def _skew_slope(points, spot):
    """Least-squares slope of IV vs log(K/S) over the smile. <0 == put skew."""
    if spot is None or spot <= 0 or len(points) < 2:
        return None
    xs = [math.log(k / spot) for k, _ in points]
    ys = [v for _, v in points]
    n = len(xs)
    mx = sum(xs) / n
    my = sum(ys) / n
    var = sum((x - mx) ** 2 for x in xs)
    if var == 0:
        return None
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    slope = cov / var
    return slope if math.isfinite(slope) else None


def _extremes(chain):
    """Highest / lowest IV leg as ``{strike, iv, side}`` dicts."""
    best = worst = None
    for row in _rows(chain):
        k = _num(row.get("strike"))
        if k is None:
            continue
        for side in ("ce", "pe"):
            v = _iv_ok(row.get(f"{side}_iv"))
            if v is None:
                continue
            item = {"strike": k, "iv": v, "side": side}
            if best is None or v > best["iv"]:
                best = item
            if worst is None or v < worst["iv"]:
                worst = item
    return best, worst


def iv_metrics(chain) -> dict:
    """ATM IV, 25Δ call/put IV, risk reversal, butterfly and skew slope.

    Uses only legs carrying a non-None IV. With fewer than ~5 IV legs the
    smile is unreadable, so every metric is ``None`` with a ``reason``.
    25Δ is found by interpolating across *real* deltas; no BS approximation is
    used when deltas are present. If deltas are absent the 25Δ fields stay
    ``None`` (``reason='no_delta_greeks'``) rather than being guessed.
    """
    chain = chain or {}
    strikes = _rows(chain)
    spot = _num(chain.get("spot"))

    n_iv = 0
    has_delta = False
    for row in strikes:
        if _iv_ok(row.get("ce_iv")) is not None:
            n_iv += 1
        if _iv_ok(row.get("pe_iv")) is not None:
            n_iv += 1
        if _num(row.get("ce_delta")) is not None or _num(row.get("pe_delta")) is not None:
            has_delta = True

    out = {
        "atm_iv": None,
        "atm_strike": None,
        "call_25d_iv": None,
        "put_25d_iv": None,
        "risk_reversal": None,   # 25ΔP − 25ΔC; >0 == put skew / downside fear
        "butterfly": None,       # (25ΔC + 25ΔP)/2 − ATM; >0 == wings bid
        "skew_slope": None,      # d IV / d log(K/S); <0 == put skew
        "max_iv": None,
        "min_iv": None,
        "n_legs_with_iv": n_iv,
        "reason": None,
    }

    if not strikes:
        out["reason"] = "empty_chain"
        return _clean(out)
    if n_iv < _MIN_IV_LEGS:
        out["reason"] = f"insufficient_iv_legs ({n_iv}<{_MIN_IV_LEGS})"
        return _clean(out)

    atm_iv, atm_strike = _atm_iv(chain, spot)
    call_25 = _iv_at_delta(chain, "ce", 0.25)
    put_25 = _iv_at_delta(chain, "pe", -0.25)

    reason = None
    if not has_delta:
        reason = "no_delta_greeks"
    elif call_25 is None or put_25 is None:
        reason = "delta_out_of_range"

    rr = (put_25 - call_25) if (call_25 is not None and put_25 is not None) else None
    fly = (
        (call_25 + put_25) / 2.0 - atm_iv
        if (call_25 is not None and put_25 is not None and atm_iv is not None)
        else None
    )
    best, worst = _extremes(chain)

    out.update(
        {
            "atm_iv": atm_iv,
            "atm_strike": atm_strike,
            "call_25d_iv": call_25,
            "put_25d_iv": put_25,
            "risk_reversal": rr,
            "butterfly": fly,
            "skew_slope": _skew_slope(_smile_points(chain, spot), spot),
            "max_iv": best,
            "min_iv": worst,
            "reason": reason,
        }
    )
    return _clean(out)


# ---------------------------------------------------------------------------
# F5 — term structure (caller passes multiple expiries)
# ---------------------------------------------------------------------------
def _parse_expiry(value):
    """Parse Fyers ('DD-MM-YYYY'), ISO, slash-dates or epoch -> ``date``."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(int(value), tz=IST).date()
        except (OSError, OverflowError, ValueError):
            return None
    s = str(value).strip()
    if not s:
        return None
    if s.isdigit():
        return _parse_expiry(int(s))
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def term_structure(chains_by_expiry: dict, as_of=None) -> dict:
    """ATM IV per expiry + front/next spread + contango/backwardation flag.

    ``chains_by_expiry`` maps an expiry date string (ISO or Fyers) to its chain
    dict (the rollover agent fetches these). ``front_next_spread`` is
    ``next_atm_iv − front_atm_iv``: positive ⇒ later expiry richer ⇒
    **contango**; negative ⇒ **backwardation**.
    """
    ref = as_of or datetime.now(IST).date()
    entries = []
    for key, chain in (chains_by_expiry or {}).items():
        chain = chain if isinstance(chain, dict) else {}
        exp_date = _parse_expiry(key) or _parse_expiry(chain.get("expiry"))
        dte = (exp_date - ref).days if exp_date is not None else None
        atm_iv, atm_strike = _atm_iv(chain, _num(chain.get("spot")))
        entries.append(
            {
                "expiry": exp_date.isoformat() if exp_date is not None else str(key),
                "expiry_flag": chain.get("expiry_flag"),
                "dte": dte,
                "atm_iv": atm_iv,
                "atm_strike": atm_strike,
            }
        )

    entries.sort(key=lambda e: (e["dte"] is None, e["dte"] if e["dte"] is not None else 10**9))
    valid = [e for e in entries if e["atm_iv"] is not None]
    front = valid[0] if valid else None
    nxt = valid[1] if len(valid) > 1 else None

    spread = structure = reason = None
    if front is None or nxt is None:
        reason = "need_two_expiries_with_iv"
    else:
        spread = nxt["atm_iv"] - front["atm_iv"]
        if abs(spread) < _TERM_FLAT_EPS:
            structure = "flat"
        elif spread > 0:
            structure = "contango"
        else:
            structure = "backwardation"

    return _clean(
        {
            "expiries": entries,
            "front": front,
            "next": nxt,
            "front_next_spread": spread,
            "structure": structure,
            "reason": reason,
        }
    )


# ---------------------------------------------------------------------------
# F6 — true-gamma dealer GEX
# ---------------------------------------------------------------------------
def _empty_gex(reason, iv_source):
    return {
        "rows": [],
        "net_gex": None,
        "gamma_flip": None,
        "call_wall": None,
        "put_wall": None,
        "magnet": None,
        "iv_source": iv_source,
        "reason": reason,
    }


def _gex_bundle(rows, raw_strikes, spot, iv_source, reason):
    nets = [r["net_gex"] for r in rows if r.get("net_gex") is not None]
    net_gex = sum(nets) if nets else None

    # Gamma flip: interpolated zero crossing of per-strike net GEX, nearest spot.
    candidates = []
    for a, b in zip(rows, rows[1:]):
        ya, yb = a.get("net_gex"), b.get("net_gex")
        if ya is None or yb is None:
            continue
        if ya == 0.0:
            candidates.append(float(a["strike"]))
        elif (ya < 0) != (yb < 0) and yb != ya:
            x = a["strike"] + (0.0 - ya) * (b["strike"] - a["strike"]) / (yb - ya)
            if math.isfinite(x):
                candidates.append(x)
    flip = None
    if candidates:
        flip = min(candidates, key=lambda k: abs(k - spot)) if spot is not None else candidates[0]

    ce_by_k, pe_by_k = {}, {}
    for r in raw_strikes:
        k = _num(r.get("strike"))
        if k is None:
            continue
        ce_by_k[k] = _num(r.get("ce_oi"), 0.0) or 0.0
        pe_by_k[k] = _num(r.get("pe_oi"), 0.0) or 0.0
    if spot is not None:
        call_wall = max((k for k in ce_by_k if k > spot), key=lambda k: ce_by_k[k], default=None)
        put_wall = max((k for k in pe_by_k if k < spot), key=lambda k: pe_by_k[k], default=None)
    else:
        call_wall = put_wall = None

    mag_row = max(
        (r for r in rows if r.get("net_gex") is not None),
        key=lambda r: abs(r["net_gex"]),
        default=None,
    )
    return {
        "rows": rows,
        "net_gex": net_gex,
        "gamma_flip": flip,
        "call_wall": call_wall,
        "put_wall": put_wall,
        "magnet": mag_row["strike"] if mag_row else None,
        "iv_source": iv_source,
        "reason": reason,
    }


def _load_compute_gex():
    """Lazily resolve ``fyers_data.compute_gex`` (module may be mid-edit)."""
    try:
        import fyers_data as fd  # india_board/scripts on sys.path
    except ImportError:
        try:
            from india_board.scripts import fyers_data as fd  # pytest pythonpath='.'
        except ImportError:
            return None
    fn = getattr(fd, "compute_gex", None)
    return fn if callable(fn) else None


def _fallback_bs_gex(chain):
    fn = _load_compute_gex()
    if fn is None:
        return _empty_gex("bs_fallback_unavailable", IV_SOURCE_BS)
    try:
        out = fn(chain) or {}
    except Exception:  # noqa: BLE001 — fallback must never break the bundle
        return _empty_gex("bs_fallback_failed", IV_SOURCE_BS)
    rows = []
    for r in out.get("rows") or []:
        if not isinstance(r, dict):
            continue
        rows.append(
            {
                "strike": r.get("strike"),
                "call_gex": r.get("call_gex"),
                "put_gex": r.get("put_gex"),
                # existing compute_gex names the row field "net"
                "net_gex": r.get("net_gex", r.get("net")),
            }
        )
    return _clean(
        {
            "rows": rows,
            "net_gex": out.get("net_gex"),
            "gamma_flip": out.get("gamma_flip"),
            "call_wall": out.get("call_wall"),
            "put_wall": out.get("put_wall"),
            "magnet": out.get("magnet"),
            "iv_source": IV_SOURCE_BS,
            "reason": None,
        }
    )


def gex_from_greeks(chain) -> dict:
    """Dealer gamma exposure from **true** per-leg gamma (replaces BS back-solve).

    Dealer convention (matches ``fyers_data.compute_gex``): dealers are short
    calls / long puts, so ``call_gex = -CE_OI * ce_gamma * spot^2 * 0.01`` and
    ``put_gex = +PE_OI * pe_gamma * spot^2 * 0.01``, scaled to Rs crore per 1%
    move. A leg whose gamma is ``None`` contributes ``None`` (never 0).
    If *no* strike carries gamma, falls back to ``fyers_data.compute_gex`` and
    marks ``iv_source='bs_backsolved'``.
    """
    chain = chain if isinstance(chain, dict) else {}
    strikes = _rows(chain)
    spot = _num(chain.get("spot"))
    if not strikes:
        return _empty_gex("empty_chain", IV_SOURCE_NONE)

    if not any(
        _num(r.get("ce_gamma")) is not None or _num(r.get("pe_gamma")) is not None
        for r in strikes
    ):
        return _fallback_bs_gex(chain)

    if spot is None or spot <= 0:
        return _empty_gex("spot_missing", IV_SOURCE_NONE)

    rows = []
    for r in strikes:
        k = _num(r.get("strike"))
        if k is None or k <= 0:
            continue
        ce_g = _num(r.get("ce_gamma"))
        pe_g = _num(r.get("pe_gamma"))
        ce_oi = _num(r.get("ce_oi"), 0.0) or 0.0
        pe_oi = _num(r.get("pe_oi"), 0.0) or 0.0
        call_gex = (-ce_oi * ce_g * spot * spot * _GEX_SCALE) if ce_g is not None else None
        put_gex = (pe_oi * pe_g * spot * spot * _GEX_SCALE) if pe_g is not None else None
        if call_gex is None and put_gex is None:
            net = None
        else:
            net = (call_gex or 0.0) + (put_gex or 0.0)
        rows.append({"strike": k, "call_gex": call_gex, "put_gex": put_gex, "net_gex": net})
    rows.sort(key=lambda r: r["strike"])

    return _clean(_gex_bundle(rows, strikes, spot, IV_SOURCE_FYERS, None))


# ---------------------------------------------------------------------------
# F5 — IV rank / percentile
# ---------------------------------------------------------------------------
def _series_values(iv_series):
    """Coerce a series of floats / ``(date, value)`` / ``{iv|value}`` to floats."""
    vals = []
    for item in iv_series or []:
        if isinstance(item, dict):
            v = _num(item.get("iv", item.get("value")))
        elif isinstance(item, (list, tuple)):
            v = _num(item[1]) if len(item) >= 2 else (_num(item[0]) if item else None)
        else:
            v = _num(item)
        if v is not None:
            vals.append(v)
    return vals


def iv_rank(iv_now, iv_series) -> dict:
    """IV rank + IV percentile over a supplied historical IV series.

    ``iv_rank = (iv_now − min) / (max − min) * 100``;
    ``iv_percentile`` = share of the series <= ``iv_now`` (0–100).
    Fewer than ~10 points ⇒ ``None`` + ``reason`` (stats still reported).
    """
    now = _num(iv_now)
    vals = _series_values(iv_series)
    n = len(vals)
    out = {
        "iv_now": now,
        "iv_rank": None,
        "iv_percentile": None,
        "min": None,
        "max": None,
        "median": None,
        "n": n,
        "reason": None,
    }
    if now is None:
        out["reason"] = "iv_now_missing"
        return _clean(out)
    if n < _MIN_IV_SERIES:
        out["reason"] = f"insufficient_series ({n}<{_MIN_IV_SERIES})"
        if vals:
            out.update(
                {"min": min(vals), "max": max(vals), "median": statistics.median(vals)}
            )
        return _clean(out)

    lo, hi = min(vals), max(vals)
    out["min"], out["max"], out["median"] = lo, hi, statistics.median(vals)
    out["iv_rank"] = ((now - lo) / (hi - lo) * 100.0) if hi > lo else None
    out["iv_percentile"] = sum(1 for v in vals if v <= now) / n * 100.0
    return _clean(out)


# ---------------------------------------------------------------------------
# F7 — variance risk premium
# ---------------------------------------------------------------------------
def _as_decimal(value):
    """Normalise IV/HV to decimal form — raw values >3 are read as percent."""
    x = _num(value)
    if x is None:
        return None
    return x / 100.0 if x > 3.0 else x


def _vrp_verdict(ratio):
    """CHEAP/FAIR/EXPENSIVE bands.

    NOTE: mirrors ``api/premium_tracker.py:_verdict`` (1.1 / 0.9) exactly.
    Duplicated intentionally: importing a FastAPI router from this pure data
    layer would couple the engine to the web app. Keep the two in sync.
    """
    if ratio is None:
        return "UNKNOWN"
    if ratio >= 1.1:
        return "EXPENSIVE"
    if ratio <= 0.9:
        return "CHEAP"
    return "FAIR"


def vrp(iv_now, hv20) -> dict:
    """Variance risk premium ``IV − HV20``, ratio and verdict band.

    Inputs are normalised to decimals first (18.0 -> 0.18) so percent and
    decimal callers both work; ``vrp`` is returned in decimal IV units and
    ``vrp_pct`` in points.
    """
    iv = _as_decimal(iv_now)
    hv = _as_decimal(hv20)
    out = {
        "iv": iv,
        "hv20": hv,
        "vrp": None,
        "vrp_pct": None,
        "ratio": None,
        "verdict": "UNKNOWN",
        "reason": None,
    }
    if iv is None or hv is None or hv <= 0:
        out["reason"] = "missing_input"
        return _clean(out)
    diff = iv - hv
    ratio = iv / hv
    out["vrp"] = diff
    out["vrp_pct"] = diff * 100.0
    out["ratio"] = ratio
    out["verdict"] = _vrp_verdict(ratio)
    return _clean(out)


# ---------------------------------------------------------------------------
# bundle for the HTTP layer
# ---------------------------------------------------------------------------
def _smile(chain):
    """Per-strike IV smile rows for the UI: ``[{strike, ce_iv, pe_iv}]``.

    Only strikes carrying at least one usable (finite, >0) IV are included, so
    the frontend never has to guess whether a blank means "no quote".
    """
    rows = []
    for row in _rows(chain):
        k = _num(row.get("strike"))
        if k is None or k <= 0:
            continue
        ce, pe = _iv_ok(row.get("ce_iv")), _iv_ok(row.get("pe_iv"))
        if ce is None and pe is None:
            continue
        rows.append({"strike": k, "ce_iv": ce, "pe_iv": pe})
    return sorted(rows, key=lambda r: r["strike"])


def summarize(
    ticker: str,
    chain: dict,
    *,
    hv20=None,
    iv_series=None,
    chains_by_expiry=None,
) -> dict:
    """One JSON-serialisable IV/greeks bundle for an HTTP endpoint.

    Combines ``iv_metrics`` (F5/1) + ``gex_from_greeks`` (F6/3) always, plus
    ``vrp`` (F7/5) when ``hv20`` is given, ``iv_rank`` (F5/4) when
    ``iv_series`` is given, and ``term_structure`` (F5/2) when
    ``chains_by_expiry`` is given. ``as_of`` comes from the chain payload.
    """
    chain = chain if isinstance(chain, dict) else {}
    metrics = iv_metrics(chain)
    out = {
        "ticker": (ticker or "").upper().strip() or None,
        "as_of": chain.get("as_of") or datetime.now(IST).date().isoformat(),
        "spot": _num(chain.get("spot")),
        "expiry": chain.get("expiry"),
        "expiry_flag": chain.get("expiry_flag"),
        "indiavix": _num(chain.get("indiavix")),
        "iv": metrics,
        "smile": _smile(chain),
        "gex": gex_from_greeks(chain),
        "vrp": None,
        "iv_rank": None,
        "term_structure": None,
    }
    if hv20 is not None:
        out["vrp"] = vrp(metrics.get("atm_iv"), hv20)
    if iv_series is not None:
        out["iv_rank"] = iv_rank(metrics.get("atm_iv"), iv_series)
    if chains_by_expiry is not None:
        out["term_structure"] = term_structure(chains_by_expiry)
    return _clean(out)


if __name__ == "__main__":  # pragma: no cover - tiny manual demo
    import json

    demo = {
        "ticker": "NIFTY",
        "spot": 24000.0,
        "as_of": date.today().isoformat(),
        "strikes": [],
    }
    print(json.dumps(summarize("NIFTY", demo), indent=2))
