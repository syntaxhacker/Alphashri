#!/usr/bin/env python3
"""Shared indicator math for the desk/tooling layer.

Single home for the bar/pattern math that used to be copy-pasted across the
LRL-iFVG study scripts and the desk check. Six copies of one indicator meant
a number could drift between two reports without anyone noticing.

TWO DIFFERENT "ATR"s LIVE HERE ON PURPOSE — they are not the same number and
must never be merged:

* :func:`atr_range` — mean of ``high - low`` over ``n`` bars. The LRL-iFVG
  studies (``lrl_ifvg_check`` and its iterations) call this "ATR"; it has no
  previous-close term, so it is NOT a true range and it understates gaps.
* :func:`atr_true` — mean of TRUE range, with the ``|close - prev_close|``
  fallback for spot-only series. This is the desk speed panel's ATR
  (``scripts/desk_check.py``).

Bar shape: the study helpers take dicts with ``high``/``low``/``close`` keys;
:func:`atr_true` and :func:`candle_field` accept Upstox candles as dicts or
positional lists.
"""

from __future__ import annotations

import itertools

#: Mean true range over this many candles (desk speed panel default).
ATR_TRUE_PERIOD = 14


# ---------------------------------------------------------------------------
# range / volatility
# ---------------------------------------------------------------------------
def atr_range(bars, i, n: int = 14) -> float:
    """Mean ``high - low`` over the ``n`` bars ending at index ``i``.

    NOT a true range (no previous-close term) — see the module docstring.
    Returns 0.0 when fewer than ``n`` bars are available.
    """
    if i < n:
        return 0.0
    return sum(bars[k]["high"] - bars[k]["low"] for k in range(i - n + 1, i + 1)) / n


def candle_field(candle, name: str, idx: int):
    """Tolerant OHLCV getter: dict key first, then positional index.

    Returns None for a missing/unparseable/NaN value.
    """
    if isinstance(candle, dict):
        value = candle.get(name)
    else:
        try:
            value = candle[idx]
        except (IndexError, TypeError):
            value = None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out else None  # drop NaN


def atr_true(candles, period: int = ATR_TRUE_PERIOD):
    """Mean true range over the last ``period`` candles (simple mean).

    True range needs high/low/previous-close; spot-only series (tape ``t`` /
    ``spot`` rows mapped to ``{time, close}``) degrade to ``|close - prev|``.
    Returns None when fewer than one true range is available.
    """
    trs: list[float] = []
    prev_close = None
    for c in candles or []:
        high = candle_field(c, "high", 2)
        low = candle_field(c, "low", 3)
        close = candle_field(c, "close", 4)
        if close is None or close <= 0:
            continue
        if high is not None and low is not None and prev_close is not None:
            trs.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
        elif prev_close is not None:
            trs.append(abs(close - prev_close))
        prev_close = close
    if not trs:
        return None
    window = trs[-max(1, period):]
    return sum(window) / len(window)


# ---------------------------------------------------------------------------
# bar construction
# ---------------------------------------------------------------------------
def build_bars(ticks, sec):
    """Bucket ticks into ``sec``-second OHLC bars keyed on the bid price."""
    bars = {}
    for t in ticks:
        ts = t["timestamp"] / 1000.0
        bkt = int(ts // sec) * sec
        bid = t["bidPrice"]
        b = bars.get(bkt)
        if b is None:
            bars[bkt] = {"time": bkt, "open": bid, "high": bid, "low": bid, "close": bid}
        else:
            b["high"] = max(b["high"], bid)
            b["low"] = min(b["low"], bid)
            b["close"] = bid
    return [bars[k] for k in sorted(bars)]


# ---------------------------------------------------------------------------
# patterns
# ---------------------------------------------------------------------------
def detect_fvg(bars, i, gap_min: float = 2.0):
    """3-bar fair-value-gap pattern ending at index ``i``. None when absent."""
    if i < 2:
        return None
    a, c = bars[i - 2], bars[i]
    if c["high"] < a["low"] and a["low"] - c["high"] > gap_min:
        return {"type": "bear", "top": a["low"], "bot": c["high"], "form": i}
    if c["low"] > a["high"] and c["low"] - a["high"] > gap_min:
        return {"type": "bull", "top": c["low"], "bot": a["high"], "form": i}
    return None


def swing_pivots(bars, i, left: int = 2, right: int = 2):
    """Fractal pivots confirmed at ``i`` (center = ``i - right``)."""
    out_hi, out_lo = None, None
    if i >= left + right:
        j = i - right
        w = bars[j - left:j + right + 1]
        if all(w[left]["high"] > w[k]["high"] for k in range(len(w)) if k != left):
            out_hi = (j, w[left]["high"])
        if all(w[left]["low"] < w[k]["low"] for k in range(len(w)) if k != left):
            out_lo = (j, w[left]["low"])
    return out_hi, out_lo


def detect_lrl(bars, i, lookback: int = 120, min_touches: int = 3,
               tol_mult: float = 0.60, max_dist_atr: float = 5.0):
    """Liquidity line: ``{'dir': 'above'|'below', 'touches': n, 'target': px}`` or None.

    Best-3-of-recent-6 collinear pivots (not all-6 must fit), residual
    < ``tol_mult`` x :func:`atr_range`.
    """
    if i < 20:
        return None
    a = atr_range(bars, i) or 5.0
    tol = tol_mult * a
    his, los = [], []
    for k in range(max(i - lookback, 4), i):
        # pivot centered at k needs k+2 <= i to confirm
        if k + 2 > i:
            continue
        w = bars[k - 2:k + 3]
        if len(w) < 5:
            continue
        if all(w[2]["high"] > w[m]["high"] for m in (0, 1, 3, 4)):
            his.append((k, w[2]["high"]))
        if all(w[2]["low"] < w[m]["low"] for m in (0, 1, 3, 4)):
            los.append((k, w[2]["low"]))
    cands = []
    for side, pts in (("above", his), ("below", los)):
        if len(pts) < min_touches:
            continue
        # best subset of 3 (or more) from recent 6 — one outlier must not kill the setup
        pool = pts[-6:]
        best = None
        for r in (4, 3) if len(pool) >= 4 else (3,):
            if len(pool) < r:
                continue
            for combo in itertools.combinations(pool, r):
                n = len(combo)
                sx = sum(p[0] for p in combo) / n
                sy = sum(p[1] for p in combo) / n
                den = sum((p[0] - sx) ** 2 for p in combo) or 1
                slope = sum((p[0] - sx) * (p[1] - sy) for p in combo) / den
                max_res = max(abs(p[1] - (sy + slope * (p[0] - sx))) for p in combo)
                if max_res > tol:
                    continue
                target = sy + slope * (i - sx)
                px = bars[i]["close"]
                if side == "above" and target <= px + 2:
                    continue  # already swept/touching
                if side == "below" and target >= px - 2:
                    continue
                if abs(target - px) > max_dist_atr * a:
                    continue
                score = (-n, max_res)
                if best is None or score < (best["score"]):
                    best = {"dir": side, "touches": n, "target": target,
                            "resid": max_res, "slope": slope, "score": score}
            if best:
                break
        if best:
            del best["score"]
            cands.append(best)
    if not cands:
        return None
    # prefer most touches, then smallest residual
    cands.sort(key=lambda c: (-c["touches"], c["resid"]))
    return cands[0]


# ---------------------------------------------------------------------------
# session helpers
# ---------------------------------------------------------------------------
def prev_trading_day(date_str: str) -> str:
    """The previous weekday before ``date_str`` (YYYY-MM-DD)."""
    from datetime import date as _d, timedelta as _td

    p = _d.fromisoformat(date_str) - _td(days=1)
    while p.weekday() >= 5:
        p -= _td(days=1)
    return p.isoformat()


def session_profile(ticks, t_end_ms, bin_pts: float = 5.0):
    """Volume profile (bid+ask vol weights) over ticks with ``ts < t_end_ms``.

    Returns ``(poc, vah, val)`` with 70% value-area expansion from POC, or
    None when there are no ticks.
    """
    bins = {}
    for x in ticks:
        if x["timestamp"] >= t_end_ms:
            break  # ticks are time-ordered
        mid = (x["bidPrice"] + x["askPrice"]) / 2.0
        w = (x.get("bidVolume") or 0) + (x.get("askVolume") or 0)
        k = int(mid // bin_pts)
        bins[k] = bins.get(k, 0) + w
    if not bins:
        return None
    total = sum(bins.values())
    poc_k = max(bins, key=lambda k: bins[k])
    lo = hi = poc_k
    covered = bins[poc_k]
    while covered < 0.70 * total:
        up = bins.get(hi + 1, 0)
        dn = bins.get(lo - 1, 0)
        if up == 0 and dn == 0:
            break
        if up >= dn:
            hi += 1
            covered += up
        else:
            lo -= 1
            covered += dn
    c = lambda k: (k + 0.5) * bin_pts
    return {"poc": c(poc_k), "vah": c(hi) + bin_pts / 2, "val": c(lo) - bin_pts / 2}
