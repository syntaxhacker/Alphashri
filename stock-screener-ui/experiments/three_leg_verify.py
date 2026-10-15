"""Independent adversarial verifier for the three-leg system (screen + catalyst + regime).

Own code throughout: raw pickle reads from experiments/data/pattern_cache/candles/1D,
own IST mapping, own indicators, own box finder, own trade simulator. Only shared
inputs: universe membership (chart_patterns.universes), cost math
(backtest/costs.py), and the sibling week-42 JSONs used SOLELY as compare targets.

Legs (reconstructed — no sibling three_leg files existed at verify time):
  L1 screen : union of rules A/B/C per experiments/missed_breakouts_week42.md sec 4
              A: own box AND base_days>=FLOOR AND range<=12% AND dist_to_box<=6%
                 AND close/EMA20>=0.98 AND (obv_slope>0 OR updown>1.2)
              B: gap_to_52w<=8% AND obv_slope>0 AND (updown>=1.5 OR vol5/20>=1.2)
                 AND close/EMA20>=0.98
              C: no box AND range60<=18% AND dist_to_20d_high<=4% AND vol>=1.0
                 AND close/EMA20>=0.98 AND obv_slope>0
  L2 catalyst: distinct news_articles (news_symbol_mentions.trading_symbol) with
               published_at in the 7 calendar days before the week Monday, count>=CAT_MIN
  L3 regime  : week is traded only if prior-week median universe Fri->Fri return >= REG_MIN

Trade: first close-break above ref level (box high else 20d high) Mon-Fri with
break-day vol>=1.5x20d-avg -> enter next session open; SL=entry-ATR14(signal);
TP=entry+2r; exit Fri close. LONG only, Rs.1,00,000/trade, costs on every trade.
No lookahead: setup slice is strictly bars with session date < week Monday.

Writes ONLY experiments/three_leg_verify.json (+ .md written by agent).
DB is opened read-only (sqlite uri mode=ro). No network.
"""
import json
import math
import os
import pickle
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

HERE = os.path.dirname(__file__)
CACHE_1D = os.path.join(HERE, "data", "pattern_cache", "candles", "1D")
DB_PATH = os.path.join(HERE__, "..", "db", "alphashri.db") if False else os.path.normpath(os.path.join(HERE, "..", "db", "alphashri.db"))
OUT_JSON = os.path.join(HERE, "three_leg_verify.json")

WEEKS = ["2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07",
         "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"]
NOTIONAL = 100_000

import importlib.util as _ilu

def _load_costs():
    p = os.path.normpath(os.path.join(HERE, "..", "backtest", "costs.py"))
    spec = _ilu.spec_from_file_location("verify_costs_mod", p)
    mod = _ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.calculate_trading_costs

calculate_trading_costs = _load_costs()


# ------------------------------------------------------------ data
def load_frame(sym):
    for name in (f"{sym}.v3.pkl", f"{sym}.lb500.v3.pkl", f"{sym}.v2.pkl"):
        p = os.path.join(CACHE_1D, name)
        if os.path.exists(p):
            try:
                df = pickle.load(open(p, "rb"))
                if df is not None and not df.empty:
                    return df
            except Exception:
                pass
    # dated variants (snapshot files)
    try:
        cands = sorted(f for f in os.listdir(CACHE_1D)
                       if f.startswith(sym + ".") and f.endswith(".v3.pkl"))
    except OSError:
        return None
    for name in cands:
        try:
            df = pickle.load(open(os.path.join(CACHE_1D, name), "rb"))
            if df is not None and not df.empty:
                return df
        except Exception:
            pass
    return None


def bars_ist(df):
    idx = df.index
    try:
        ist = idx.tz_convert("Asia/Kolkata") if idx.tz is not None else idx.tz_localize("UTC").tz_convert("Asia/Kolkata")
    except Exception:
        ist = idx
    rows = []
    for ts, (_, r) in zip(ist, df.iterrows()):
        try:
            rows.append({"date": ts.strftime("%Y-%m-%d"), "o": float(r["open"]),
                         "h": float(r["high"]), "l": float(r["low"]),
                         "c": float(r["close"]), "v": float(r.get("volume", 0) or 0)})
        except Exception:
            continue
    rows.sort(key=lambda x: x["date"])
    return rows


# ------------------------------------------------------------ indicators (own)
def ema(vals, n):
    k = 2.0 / (n + 1)
    out, e = [], None
    for v in vals:
        e = v if e is None else v * k + e * (1 - k)
        out.append(e)
    return out


def atr14(h, l, c):
    trs = []
    for i in range(len(c)):
        if i == 0:
            trs.append(h[0] - l[0])
        else:
            trs.append(max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])))
    a, out = None, []
    for t in trs:
        a = t if a is None else (a * 13 + t) / 14.0
        out.append(a)
    return out


def obv_slope(closes, vols, n=20):
    if len(closes) < n + 1:
        return 0.0
    o = [0.0]
    for i in range(1, len(closes)):
        if closes[i] > closes[i - 1]:
            o.append(o[-1] + vols[i])
        elif closes[i] < closes[i - 1]:
            o.append(o[-1] - vols[i])
        else:
            o.append(o[-1])
    y = o[-n:]
    x = list(range(n))
    mx, my = sum(x) / n, sum(y) / n
    den = sum((xi - mx) ** 2 for xi in x)
    if den == 0:
        return 0.0
    return sum((xi - mx) * (yi - my) for xi, yi in zip(x, y)) / den


def updown_ratio(closes, vols, n=20):
    up = dn = 0.0
    for i in range(len(closes) - n, len(closes)):
        if i < 1:
            continue
        if closes[i] >= closes[i - 1]:
            up += vols[i]
        else:
            dn += vols[i]
    if dn <= 0:
        return 99.0 if up > 0 else 1.0
    return up / dn


def own_box(bars):
    """Longest trailing window (>=20 bars, within last 60) with range<=12%.
    Returns dict(high, low, base_days, range_pct) or None."""
    if len(bars) < 20:
        return None
    win = bars[-60:]
    best = None
    for start in range(len(win)):
        seg = win[start:]
        if len(seg) < 20:
            break
        hi = max(b["h"] for b in seg)
        lo = min(b["l"] for b in seg)
        mp = sum(b["c"] for b in seg) / len(seg)
        rng = (hi - lo) / mp * 100 if mp > 0 else 999
        if rng <= 12.0 and (best is None or len(seg) > best["base_days"]):
            best = {"high": hi, "low": lo, "base_days": len(seg), "range_pct": rng}
    return best


# ------------------------------------------------------------ screen (own, rules A/B/C)
def screen_symbol(setup, floor_days=30):
    """setup: list of bars strictly before the week. Returns (flagged, rules, feats)."""
    if len(setup) < 60:
        return False, [], {}
    c = [b["c"] for b in setup]
    v = [b["v"] for b in setup]
    ref = c[-1]
    e20 = ema(c, 20)[-1]
    ema_ok = (ref / e20) >= 0.98 if e20 else False
    obv = obv_slope(c, v)
    ud = updown_ratio(c, v)
    av20 = sum(v[-20:]) / 20 if len(v) >= 20 else 0
    av5 = sum(v[-5:]) / 5 if len(v) >= 5 else 0
    vr = (av5 / av20) if av20 > 0 else 0
    hi252 = max(b["h"] for b in setup[-252:])
    gap52 = (hi252 - ref) / ref * 100 if ref > 0 else 999
    hi20 = max(b["h"] for b in setup[-20:])
    dist20 = (hi20 - ref) / ref * 100 if ref > 0 else 999
    w60 = setup[-60:]
    hi60 = max(b["h"] for b in w60)
    lo60 = min(b["l"] for b in w60)
    mp60 = sum(b["c"] for b in w60) / len(w60)
    range60 = (hi60 - lo60) / mp60 * 100 if mp60 > 0 else 999
    volx = (v[-1] / av20) if av20 > 0 else 0
    box = own_box(setup)
    dist_box = ((box["high"] - ref) / ref * 100) if box else None
    acc = (obv > 0) and (ud >= 1.5 or vr >= 1.2)
    rules = []
    if box and box["base_days"] >= floor_days and box["range_pct"] <= 12.0 \
            and dist_box is not None and dist_box <= 6.0 and ema_ok \
            and (obv > 0 or ud > 1.2):
        rules.append("A")
    if gap52 <= 8.0 and obv > 0 and (ud >= 1.5 or vr >= 1.2) and ema_ok:
        rules.append("B")
    if box is None and range60 <= 18.0 and dist20 <= 4.0 and volx >= 1.0 and ema_ok and obv > 0:
        rules.append("C")
    feats = {"gap52": round(gap52, 2), "obv": round(obv, 1), "ud": round(ud, 2),
             "vr": round(vr, 2), "dist20": round(dist20, 2), "range60": round(range60, 2),
             "box_days": box["base_days"] if box else None,
             "box_range": round(box["range_pct"], 2) if box else None,
             "dist_box": round(dist_box, 2) if dist_box is not None else None,
             "ref": round(ref, 2)}
    return (len(rules) > 0), rules, feats


# ------------------------------------------------------------ catalyst (own, news DB read-only)
def catalyst_counts(week_monday):
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        rows = con.execute(
            """SELECT COALESCE(NULLIF(m.trading_symbol,''), m.symbol_code) AS s,
                      COUNT(DISTINCT a.id) AS n
               FROM news_symbol_mentions m JOIN news_articles a ON a.id = m.article_id
               WHERE a.published_at >= date(?, '-7 days') AND a.published_at < date(?)
               GROUP BY s""", (week_monday, week_monday)).fetchall()
    finally:
        con.close()
    return {s: n for s, n in rows if s}


# ------------------------------------------------------------ week runner
def run_week(all_bars, cata, monday, floor_days=30, cat_min=1):
    """Returns dict with flags, regime inputs, trades for L1/L2/L3."""
    week_dates = [d for d in sorted({b["date"] for bars in all_bars.values() for b in bars})
                  if d >= monday][:5]
    if len(week_dates) < 4:
        return None
    setup_end = monday  # strictly before
    screened, feats = {}, {}
    for sym, bars in all_bars.items():
        setup = [b for b in bars if b["date"] < setup_end]
        f, rules, ft = screen_symbol(setup, floor_days)
        if f:
            screened[sym] = rules
            feats[sym] = ft
    # regime: prior-week median Fri->Fri universe return
    friars = sorted({b["date"] for bars in all_bars.values() for b in bars if b["date"] < monday})
    prev_fri = friars[-1] if friars else None
    prev_prev = friars[-6] if len(friars) >= 6 else (friars[0] if friars else None)
    rets = []
    for bars in all_bars.values():
        d0 = next((b["c"] for b in bars if b["date"] == prev_prev), None)
        d1 = next((b["c"] for b in bars if b["date"] == prev_fri), None)
        if d0 and d1 and d0 > 0:
            rets.append((d1 - d0) / d0 * 100)
    rets.sort()
    regime = rets[len(rets) // 2] if rets else 0.0

    trades = []
    for sym, rules in screened.items():
        bars = all_bars[sym]
        setup = [b for b in bars if b["date"] < setup_end]
        wk = [b for b in bars if b["date"] in week_dates]
        if len(wk) < 3 or len(setup) < 60:
            continue
        ft = feats[sym]
        box_hi = None
        # recompute ref level: own box high else 20d high
        box = own_box(setup)
        ref_level = box["high"] if box else max(b["h"] for b in setup[-20:])
        ref_close = setup[-1]["c"]
        if ref_close > ref_level:
            continue  # extended, excluded
        av20 = sum(b["v"] for b in setup[-20:]) / 20
        c_all = [b["c"] for b in setup]
        h_all = [b["h"] for b in setup]
        l_all = [b["l"] for b in setup]
        a_all = atr14(h_all, l_all, c_all)
        sig_atr = a_all[-1]
        # first close-break
        bi = None
        for i, b in enumerate(wk):
            if b["c"] > ref_level:
                bi = i
                break
        if bi is None or bi + 1 >= len(wk):
            continue
        bb = wk[bi]
        if av20 > 0 and (bb["v"] / av20) < 1.5:
            continue  # no volume confirmation
        entry = wk[bi + 1]["o"]
        if not entry or entry <= 0 or not math.isfinite(sig_atr) or sig_atr <= 0:
            continue
        sl = entry - sig_atr
        risk = entry - sl
        tp = entry + 2 * risk
        qty = max(1, int(NOTIONAL // entry))
        exit_px, exit_day, why = wk[-1]["c"], wk[-1]["date"], "EOW"
        for b in wk[bi + 1:]:
            hit_sl = b["l"] <= sl
            hit_tp = b["h"] >= tp
            if hit_sl and hit_tp:
                exit_px, exit_day, why = sl, b["date"], "SL"
                break
            if hit_sl:
                exit_px, exit_day, why = sl, b["date"], "SL"
                break
            if hit_tp:
                exit_px, exit_day, why = tp, b["date"], "TP"
                break
        costs = calculate_trading_costs(entry, exit_px, qty, "LONG")
        net = (exit_px - entry) * qty - costs["total_costs"]
        trades.append({"symbol": sym, "rules": rules, "signal": bb["date"],
                       "entry_day": wk[bi + 1]["date"], "entry": round(entry, 2),
                       "sl": round(sl, 2), "tp": round(tp, 2), "qty": qty,
                       "exit": round(exit_px, 2), "exit_day": exit_day, "why": why,
                       "cat": int(cata.get(sym, 0)),
                       "net": round(net, 2)})
    return {"monday": monday, "week_dates": week_dates, "n_screened": len(screened),
            "regime_med": round(regime, 2), "trades": trades}


def summarize(trades):
    n = len(trades)
    net = sum(t["net"] for t in trades)
    w = sum(1 for t in trades if t["net"] > 0)
    return {"trades": n, "net": round(net, 2), "win_pct": round(100.0 * w / n, 1) if n else 0.0,
            "avg": round(net / n, 2) if n else 0.0}


def main():
    from chart_patterns.universes import get_universe
    uni = get_universe("nifty500")
    print(f"universe={len(uni)}", flush=True)
    all_bars = {}
    for i, s in enumerate(uni):
        df = load_frame(s)
        if df is not None:
            all_bars[s] = bars_ist(df)
        if (i + 1) % 100 == 0:
            print(f"  loaded {i + 1}/{len(uni)} -> {len(all_bars)}", flush=True)
    print(f"cached={len(all_bars)}", flush=True)

    # weekly median returns (up/down classification)
    weekly_med = {}
    for m in WEEKS[:9]:
        pass

    results = []
    for m in WEEKS[:9]:  # 9 completed weeks (10th starts Oct 12, future)
        cata = catalyst_counts(m)
        r = run_week(all_bars, cata, m)
        if r is None:
            continue
        l1 = summarize(r["trades"])
        l2 = summarize([t for t in r["trades"] if t["cat"] >= 1])
        l3 = summarize([t for t in r["trades"] if t["cat"] >= 1]) if r["regime_med"] >= -1.0 else {"trades": 0, "net": 0.0, "win_pct": 0.0, "avg": 0.0}
        l3_blocked = r["regime_med"] < -1.0
        results.append({"monday": m, "week_dates": r["week_dates"], "n_screened": r["n_screened"],
                        "regime_med": r["regime_med"], "regime_blocked": l3_blocked,
                        "L1": l1, "L2": l2, "L3": l3,
                        "trades": r["trades"]})
        print(f"{m} {r['week_dates'][0]}..{r['week_dates'][-1]} reg={r['regime_med']:+.2f} "
              f"scr={r['n_screened']} L1={l1} L2={l2} L3={l3}{' BLOCKED' if l3_blocked else ''}", flush=True)

    # sensitivity on full 9 weeks
    sens = {}
    for label, kw in {"base": {}, "floor45": {"floor_days": 45}, "cat2": {"cat_min": 2}}.items():
        tot = {"trades": 0, "net": 0.0}
        per_week = []
        for w in results:
            m = w["monday"]
            cata = catalyst_counts(m)
            r = run_week(all_bars, cata, m, floor_days=kw.get("floor_days", 30),
                         cat_min=kw.get("cat_min", 1))
            ts = [t for t in r["trades"] if t["cat"] >= kw.get("cat_min", 1)]
            if r["regime_med"] < -1.0:
                ts = []
            s = summarize(ts)
            tot["trades"] += s["trades"]
            tot["net"] += s["net"]
            per_week.append({"monday": m, "net": s["net"], "trades": s["trades"]})
        sens[label] = {"trades": tot["trades"], "net": round(tot["net"], 2), "weeks": per_week}
    # regime notch separately (needs re-gating)
    for label, reg in {"reg0": 0.0}.items():
        tot = {"trades": 0, "net": 0.0}
        per_week = []
        for w in results:
            ts = [t for t in w["trades"] if t["cat"] >= 1]
            if w["regime_med"] < reg:
                ts = []
            s = summarize(ts)
            tot["trades"] += s["trades"]
            tot["net"] += s["net"]
            per_week.append({"monday": w["monday"], "net": s["net"], "trades": s["trades"]})
        sens[label] = {"trades": tot["trades"], "net": round(tot["net"], 2), "weeks": per_week}

    first5 = results[:5]
    last4 = results[5:]
    def half(h):
        t = [x for w in h for x in w["trades"] if x["cat"] >= 1 and not w["regime_blocked"]]
        return summarize(t)
    out = {"meta": {"weeks": [w["monday"] for w in results], "notional": NOTIONAL,
                    "note": "no sibling three_leg files existed; legs reconstructed from week-42 docs; own code throughout"},
           "weeks": [{k: w[k] for k in ("monday", "week_dates", "n_screened", "regime_med",
                                        "regime_blocked", "L1", "L2", "L3")} for w in results],
           "trades_by_week": {w["monday"]: w["trades"] for w in results},
           "split": {"first5_L3": half(first5), "last4_L3": half(last4)},
           "sensitivity": sens}
    json.dump(out, open(OUT_JSON, "w"), indent=1)
    print("SPLIT first5:", out["split"]["first5_L3"], "last4:", out["split"]["last4_L3"])
    print("SENS:", {k: {"trades": v["trades"], "net": v["net"]} for k, v in sens.items()})
    print("wrote", OUT_JSON)


if __name__ == "__main__":
    main()
