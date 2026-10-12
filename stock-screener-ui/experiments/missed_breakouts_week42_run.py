"""Missed-breakouts post-mortem: week Mon 2026-10-05 -> Fri 2026-10-09 (Nifty-500).

Setup side uses ONLY bars with IST session date <= 2026-10-03
(effectively <= 2026-10-01: Oct 2 = Gandhi Jayanti holiday, no bars;
Oct 3 = Saturday). Outcome side uses IST sessions Oct 5..9 only.

Reads ONLY the local 1D candle cache (no network). Writes ONLY here.
"""
import json
import os
import pickle
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import pandas as pd

SETUP_END = "2026-10-03"  # slicer; effective last session = Oct 1 (Thu)
WEEK = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]
CACHE_1D = os.path.join(os.path.dirname(__file__), "data", "pattern_cache", "candles", "1D")
OUT_JSON = os.path.join(os.path.dirname(__file__), "missed_breakouts_week42.json")

from chart_patterns.detectors.consolidation import detect_consolidation
from chart_patterns.universes import get_universe
from chart_patterns.watch import _near52w_row

try:
    from trading.indicators.trend import adx as _ta_adx
    ADX_SRC = "trading.indicators.trend.adx"
except Exception:
    _ta_adx = None
    ADX_SRC = "manual-wilder"


def load_frame(sym):
    for name in (f"{sym}.v3.pkl", f"{sym}.2026-10-09.v3.pkl",
                 f"{sym}.2026-10-06.v3.pkl", f"{sym}.v2.pkl"):
        p = os.path.join(CACHE_1D, name)
        if os.path.exists(p):
            try:
                df = pickle.load(open(p, "rb"))
                if df is not None and not df.empty:
                    return df, name
            except Exception:
                pass
    return None, None


def ist_dates(df):
    try:
        return df.index.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d")
    except Exception:
        return pd.Series([""] * len(df), index=df.index)


def adx14(setup):
    try:
        if _ta_adx is not None:
            r = _ta_adx(setup["high"], setup["low"], setup["close"], length=14)
            if r is not None:
                a = np.asarray(r.iloc[:, -1] if hasattr(r, "iloc") else r, dtype=float)
                a = a[~np.isnan(a)]
                if len(a):
                    return round(float(a[-1]), 2)
    except Exception:
        pass
    try:  # manual Wilder fallback
        h = setup["high"].astype(float); l = setup["low"].astype(float); c = setup["close"].astype(float)
        up = h.diff(); dn = -l.diff()
        plus = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=h.index)
        minus = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=h.index)
        tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
        atr = tr.ewm(alpha=1 / 14, adjust=False).mean()
        pdi = 100 * plus.ewm(alpha=1 / 14, adjust=False).mean() / atr
        mdi = 100 * minus.ewm(alpha=1 / 14, adjust=False).mean() / atr
        dx = 100 * (pdi - mdi).abs() / (pdi + mdi)
        v = dx.ewm(alpha=1 / 14, adjust=False).mean().iloc[-1]
        return round(float(v), 2) if np.isfinite(v) else None
    except Exception:
        return None


def trailing_range(setup, w):
    try:
        win = setup.tail(w)
        if len(win) < 20:
            return None, None
        hi = float(win["high"].max()); lo = float(win["low"].min())
        mp = float(win["close"].mean())
        rng = (hi - lo) / mp * 100.0 if mp > 0 else None
        drift = (float(win["close"].iloc[-1]) - float(win["close"].iloc[0])) / mp * 100.0 if mp > 0 else None
        return (round(rng, 2) if rng is not None else None,
                round(drift, 2) if drift is not None else None)
    except Exception:
        return None, None


def analyze(sym):
    df, src = load_frame(sym)
    if df is None:
        return {"symbol": sym, "skip": "no-cache"}
    dates = ist_dates(df)
    setup = df[dates <= SETUP_END]
    weekmask = dates.isin(WEEK)
    week = df[weekmask]
    if len(setup) < 60:
        return {"symbol": sym, "skip": f"setup-bars-{len(setup)}"}
    if len(week) == 0:
        return {"symbol": sym, "skip": "no-week-bars"}
    wdates = sorted(set(ist_dates(week)))
    ref_close = float(setup["close"].iloc[-1])

    # --- setup: consolidation box (Oct-3-sliced frame only) ---
    try:
        hits = detect_consolidation(setup)
    except Exception:
        hits = []
    box = None
    if hits:
        h0 = hits[0]
        def _g(name, default=None):
            try:
                if isinstance(h0, dict):
                    return h0.get(name, default)
                return getattr(h0, name, default)
            except Exception:
                return default
        try:
            tl = _g("trendlines") or []
            lo_px = None
            try:
                if len(tl) >= 2 and tl[1]:
                    lo_px = float(tl[1][0].get("price"))
            except Exception:
                lo_px = None
            if lo_px is None:
                lo_px = float(_g("breakout_level")) * (1 - float(_g("range_pct", 0) or 0) / 100)
            box = {
                "high": round(float(_g("breakout_level")), 2),
                "low": round(lo_px, 2),
                "base_days": int(_g("base_days", 0) or 0),
                "range_pct": round(float(_g("range_pct", 0) or 0), 2),
                "range_pos": round(float(_g("range_pos", 0) or 0), 1),
                "status": _g("status"),
                "confidence": round(float(_g("confidence", 0) or 0), 3),
            }
        except Exception:
            box = None

    # --- setup: accumulation gauges (imported, not copied) ---
    try:
        acc = _near52w_row(sym, setup)
    except Exception:
        acc = None
    acc_out = None
    if acc:
        acc_out = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in acc.items()
                   if k in ("trigger_level", "high_gap", "close_gap", "obv_slope",
                            "updown", "vol_ratio", "rising_lows", "touched")}

    # --- setup: EMAs / 20d reference / ADX ---
    ema = {}
    try:
        c = setup["close"].astype(float)
        for n in (20, 50, 200):
            ema[n] = float(c.ewm(span=n, adjust=False).mean().iloc[-1]) if len(c) >= n else None
    except Exception:
        ema = {20: None, 50: None, 200: None}
    try:
        hi20 = float(setup["high"].tail(20).max()); av20 = float(setup["volume"].tail(20).mean())
    except Exception:
        hi20, av20 = None, None
    dist_box = round((box["high"] - ref_close) / ref_close * 100, 2) if box else None
    dist_20d = round((hi20 - ref_close) / ref_close * 100, 2) if hi20 else None
    stack = None
    if ema.get(20) and ema.get(50) and ema.get(200):
        stack = ("bull" if ema[20] > ema[50] > ema[200] else
                 "bear" if ema[20] < ema[50] < ema[200] else "mixed")
    above_ema20 = (ref_close > ema[20]) if ema.get(20) else None
    r60, d60 = trailing_range(setup, 60)
    r120, d120 = trailing_range(setup, 120)

    # --- outcome: week Oct 5..9 ---
    ref_level = box["high"] if box else hi20
    already_above = bool(ref_level and ref_close > ref_level)
    wk = []
    for d in WEEK:
        bars = week[ist_dates(week) == d]
        if len(bars) == 0:
            continue
        b = bars.iloc[-1]
        wk.append({"date": d, "close": float(b["close"]), "high": float(b["high"]),
                   "low": float(b["low"]), "vol": float(b["volume"])})
    first_break = None
    if not already_above:
        for b in wk:
            if ref_level and b["close"] > ref_level:
                first_break = b["date"]
                break
    prior52 = acc_out["trigger_level"] if acc_out else None
    first_52 = None
    for b in wk:
        if prior52 and b["close"] > prior52:
            first_52 = b["date"]
            break
    maxhi = max((b["high"] for b in wk), default=None)
    mfe = round((maxhi - ref_close) / ref_close * 100, 2) if maxhi else None
    fri = wk[-1]["close"] if wk else None
    wkret = round((fri - ref_close) / ref_close * 100, 2) if fri else None
    brvol = None
    if first_break:
        for b in wk:
            if b["date"] == first_break:
                brvol = round(b["vol"] / av20, 2) if av20 else None
                break
    broke = first_break is not None
    if already_above:
        cls = "extended"
    else:
        cls = "no_break" if not broke else ("broke_monday" if first_break == "2026-10-05" else "broke_midweek")

    # --- pre-signal verdict (rules fixed before looking) ---
    has_box = box is not None
    tight = has_box and box["range_pct"] <= 15.0
    accum_ok = bool(acc_out) and (acc_out["obv_slope"] > 0) and (
        acc_out["updown"] > 1.2 or acc_out["vol_ratio"] > 1.1)
    near = bool((acc_out and acc_out["close_gap"] is not None and acc_out["close_gap"] <= 8.0)
                or (dist_box is not None and dist_box <= 3.0))
    if broke:
        if has_box and tight and accum_ok and near:
            verdict = "should-have-caught"
        elif has_box and (accum_ok or near):
            verdict = "partial-signal"
        elif has_box:
            verdict = "box-but-no-edge"
        elif acc_out and accum_ok and near:
            verdict = "accum-no-box"
        else:
            verdict = "came-from-nowhere"
    else:
        verdict = None

    fail = None
    if broke and verdict != "should-have-caught":
        modes = []
        if not has_box:
            modes.append("no-consolidation-hit" +
                         (f"(60d-range {r60}% drift {d60}%)" if r60 else "") +
                         (f"(120d-range {r120}% drift {d120}%)" if r120 else ""))
        else:
            if box["base_days"] < 60:
                modes.append(f"base-too-short({box['base_days']}d<60 arm-gate)")
            if box["range_pct"] > 15.0:
                modes.append(f"range-wide({box['range_pct']}%)")
            if box["status"] not in ("forming", "failed", "marginal"):
                modes.append(f"status-gate({box['status']})")
            if dist_box is not None and dist_box > 3.0:
                modes.append(f"extended-from-box(+{dist_box}%)")
        if acc_out:
            if acc_out["obv_slope"] <= 0:
                modes.append("obv-slope-neg")
            if not (acc_out["updown"] > 1.2 or acc_out["vol_ratio"] > 1.1):
                modes.append(f"vol-gate(updown {acc_out['updown']:.2f} volratio {acc_out['vol_ratio']:.2f})")
            if acc_out["close_gap"] is not None and acc_out["close_gap"] > 8.0:
                modes.append(f"far-from-52w({acc_out['close_gap']:.1f}%)")
        else:
            modes.append("no-accum-row")
        fail = "; ".join(modes) if modes else "edge-case"

    return {
        "symbol": sym, "cache": src,
        "setup_last": str(ist_dates(setup)[-1]),
        "ref_close": round(ref_close, 2),
        "box": box, "accum": acc_out,
        "ema20": round(ema[20], 2) if ema.get(20) else None,
        "ema50": round(ema[50], 2) if ema.get(50) else None,
        "ema200": round(ema[200], 2) if ema.get(200) else None,
        "stack": stack, "above_ema20": above_ema20,
        "hi20": round(hi20, 2) if hi20 else None, "avgvol20": round(av20) if av20 else None,
        "dist_box_pct": dist_box, "dist_20d_pct": dist_20d, "adx14": adx14(setup),
        "range60_pct": r60, "drift60_pct": d60, "range120_pct": r120, "drift120_pct": d120,
        "ref_level": round(ref_level, 2) if ref_level else None,
        "ref_kind": ("box" if box else "hi20"),
        "week_days": [b["date"] for b in wk],
        "first_break": first_break, "first_52w": first_52, "class": cls,
        "mfe_pct": mfe, "week_ret_pct": wkret, "break_volx": brvol,
        "verdict": verdict, "failure": fail,
    }


def main():
    uni = get_universe("nifty500")
    print(f"universe={len(uni)} adx_src={ADX_SRC}", flush=True)
    rows = []
    for i, s in enumerate(uni):
        try:
            rows.append(analyze(s))
        except Exception as e:
            rows.append({"symbol": s, "skip": f"err:{e}"})
        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{len(uni)}", flush=True)
    br = [r for r in rows if not r.get("skip") and r.get("first_break")]
    print(f"analyzed={len([r for r in rows if not r.get('skip')])} "
          f"skipped={len([r for r in rows if r.get('skip')])} breakouts={len(br)}")
    json.dump({"meta": {"setup_end": SETUP_END, "effective_last_session": "2026-10-01",
                        "week": WEEK, "universe": "nifty500", "n": len(uni), "adx_src": ADX_SRC},
               "rows": rows},
              open(OUT_JSON, "w"), indent=1)
    print("wrote", OUT_JSON)


if __name__ == "__main__":
    main()
