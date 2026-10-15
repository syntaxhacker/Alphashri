"""Bounded autonomous research loop: pre-weekend setups (10 wks ending 2026-10-09).

Writes ONLY experiments/loop_search_out.json. Reads ONLY
experiments/three_leg_dataset.json + local 1D candle cache. Setup-sliced only
(bars with IST date <= setup session; no outcome peek). Never touches
db/alphashri.db. Costs via backtest.costs on EVERY trade; 5bps slip both ways.
Rs 1L/trade, qty=floor(1L/entry).

SPLIT: FIT = weeks 1-7, OOS = weeks 8-10 (locked, ONE eval per candidate).
CONFIRM bar: pooled expectancy_slip > +Rs300 AND fit net_slip>0 AND oos
net_slip>0 AND pooled n>=40.
"""
import bisect
import datetime as _dt
import json
import os
import pickle
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pandas as pd

from backtest.costs import calculate_trading_costs

EXP = os.path.dirname(__file__)
CACHE_1D = os.path.join(EXP, "data", "pattern_cache", "candles", "1D")
DATASET = os.path.join(EXP, "three_leg_dataset.json")
OUT_JSON = os.path.join(EXP, "loop_search_out.json")

NOTIONAL = 100_000.0
SLIP = 0.0005
FIT_WEEKS = {1, 2, 3, 4, 5, 6, 7}
OOS_WEEKS = {8, 9, 10}

_frames = {}
_symcache = {}


def load_frame(sym, hint=None):
    if sym in _frames:
        return _frames[sym]
    names = []
    if hint:
        names.append(hint)
    names += [f"{sym}.v3.pkl", f"{sym}.2026-10-09.v3.pkl",
              f"{sym}.2026-10-06.v3.pkl", f"{sym}.v2.pkl"]
    for name in names:
        p = os.path.join(CACHE_1D, name)
        if os.path.exists(p):
            try:
                df = pickle.load(open(p, "rb"))
                if df is not None and not df.empty:
                    _frames[sym] = df
                    return df
            except Exception:
                pass
    _frames[sym] = None
    return None


def ist_dates(df):
    try:
        return df.index.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d")
    except Exception:
        return pd.Series([""] * len(df), index=df.index)


def symcache(sym, hint=None):
    """Per-symbol O(1) bar dict + weekly bars, built once."""
    if sym in _symcache:
        return _symcache[sym]
    df = load_frame(sym, hint)
    if df is None:
        _symcache[sym] = None
        return None
    dates = ist_dates(df).tolist()
    bars = {}
    for d, o, h, l, c, v in zip(dates, df["open"].tolist(),
                                df["high"].tolist(), df["low"].tolist(),
                                df["close"].tolist(), df["volume"].tolist()):
        bars[d] = (float(o), float(h), float(l), float(c), float(v))
    sdates = sorted(bars)
    wk, cur = [], None
    for d in sdates:
        o, h, l, c, v = bars[d]
        if cur is None:
            cur = {"hi": h, "lo": l, "cl": c, "end": d}
        else:
            cur = {"hi": max(cur["hi"], h), "lo": min(cur["lo"], l),
                   "cl": c, "end": d}
        if _dt.date.fromisoformat(d).weekday() == 4 or d == sdates[-1]:
            wk.append(cur)
            cur = None
    if cur is not None:
        wk.append(cur)
    obj = {"bars": bars, "sdates": sdates, "weeks": wk}
    _symcache[sym] = obj
    return obj


def wbars(sc, O):
    out = []
    for d in O:
        b = sc["bars"].get(d)
        if b:
            out.append({"date": d, "open": b[0], "high": b[1], "low": b[2],
                        "close": b[3], "volume": b[4]})
    return out


def atr_to(sc, i):
    """Wilder ATR(14) over sessions [..., i]."""
    sd = sc["sdates"]
    j0 = max(1, i - 60)
    prev_c = None
    trs = []
    for k in range(j0, i + 1):
        o, h, l, c, v = sc["bars"][sd[k]]
        if prev_c is None:
            prev_c = sc["bars"][sd[k - 1]][3] if k > 0 else c
        trs.append(max(h - l, abs(h - prev_c), abs(l - prev_c)))
        prev_c = c
    if len(trs) < 14:
        return None
    atr = sum(trs[:14]) / 14
    for t in trs[14:]:
        atr = (atr * 13 + t) / 14
    return atr if atr > 0 else None


def book_long(sym, wn, entry_day, entry, exit_px, why, extra=None):
    qty = int(NOTIONAL // entry)
    gross = (exit_px - entry) * qty
    costs = calculate_trading_costs(entry, exit_px, qty)["total_costs"]
    e_s, x_s = entry * (1 + SLIP), exit_px * (1 - SLIP)
    gross_s = (x_s - e_s) * qty
    costs_s = calculate_trading_costs(e_s, x_s, qty)["total_costs"]
    tr = {"symbol": sym, "week": wn, "entry_day": entry_day,
          "entry": round(entry, 2), "qty": qty,
          "exit": round(exit_px, 2), "why": why,
          "gross": round(gross, 2), "costs": costs,
          "net": round(gross - costs, 2),
          "gross_slip": round(gross_s, 2), "costs_slip": costs_s,
          "net_slip": round(gross_s - costs_s, 2)}
    if extra:
        tr.update(extra)
    return tr


def book_short(sym, wn, entry_day, entry, sl, tgt, qty, exit_px, why, extra=None):
    gross = (entry - exit_px) * qty
    costs = calculate_trading_costs(entry, exit_px, qty, side="SHORT")["total_costs"]
    e_s, x_s = entry * (1 - SLIP), exit_px * (1 + SLIP)
    gross_s = (e_s - x_s) * qty
    costs_s = calculate_trading_costs(e_s, x_s, qty, side="SHORT")["total_costs"]
    tr = {"symbol": sym, "week": wn, "entry_day": entry_day,
          "entry": round(entry, 2), "sl": round(sl, 2), "tgt": round(tgt, 2),
          "qty": qty, "exit": round(exit_px, 2), "why": why,
          "gross": round(gross, 2), "costs": costs,
          "net": round(gross - costs, 2),
          "gross_slip": round(gross_s, 2), "costs_slip": costs_s,
          "net_slip": round(gross_s - costs_s, 2)}
    if extra:
        tr.update(extra)
    return tr


def metrics(trades):
    n = len(trades)
    if n == 0:
        return {"trades": 0, "wins": 0, "win_pct": None, "gross": 0.0,
                "costs": 0.0, "net": 0.0, "net_slip": 0.0, "pf": None,
                "expectancy": None, "expectancy_slip": None, "maxDD": 0.0}
    nets = [t["net"] for t in trades]
    nsl = [t["net_slip"] for t in trades]
    gp = sum(t["gross"] for t in trades if t["gross"] > 0)
    gl = -sum(t["gross"] for t in trades if t["gross"] < 0)
    eq, peak, mdd = 0.0, 0.0, 0.0
    for v in nets:
        eq += v
        peak = max(peak, eq)
        mdd = max(mdd, peak - eq)
    return {"trades": n, "wins": sum(1 for t in trades if t["net"] > 0),
            "win_pct": round(100 * sum(1 for t in trades if t["net"] > 0) / n, 1),
            "gross": round(sum(t["gross"] for t in trades), 2),
            "costs": round(sum(t["costs"] for t in trades), 2),
            "net": round(sum(nets), 2),
            "net_slip": round(sum(nsl), 2),
            "pf": round(gp / gl, 2) if gl > 0 else None,
            "expectancy": round(sum(nets) / n, 2),
            "expectancy_slip": round(sum(nsl) / n, 2),
            "maxDD": round(mdd, 2)}


def split_eval(trades):
    fit = [t for t in trades if t["week"] in FIT_WEEKS]
    oos = [t for t in trades if t["week"] in OOS_WEEKS]
    mf, mo = metrics(fit), metrics(oos)
    pooled = metrics(trades)
    confirmed = (pooled["expectancy_slip"] is not None
                 and pooled["expectancy_slip"] > 300
                 and mf["net_slip"] > 0 and mo["net_slip"] > 0
                 and pooled["trades"] >= 40)
    return {"fit": mf, "oos": mo, "pooled": pooled, "confirmed": bool(confirmed)}


def max_concurrent(trades):
    by_wk = {}
    for t in trades:
        by_wk[t["week"]] = by_wk.get(t["week"], 0) + 1
    return max(by_wk.values()) if by_wk else 0


def trade_mon_fri_target(sym, wn, wb, pct):
    entry = wb[0]["open"]
    if not entry or entry <= 0 or int(NOTIONAL // entry) <= 0:
        return None
    tgt = entry * (1 + pct)
    for b in wb:
        if b["high"] is not None and b["high"] >= tgt:
            return book_long(sym, wn, wb[0]["date"], entry, tgt, "TARGET")
    return book_long(sym, wn, wb[0]["date"], entry, wb[-1]["close"], "TIME-Friday")


def trade_mon_fri(sym, wn, wb):
    entry = wb[0]["open"]
    if not entry or entry <= 0 or int(NOTIONAL // entry) <= 0:
        return None
    return book_long(sym, wn, wb[0]["date"], entry, wb[-1]["close"], "TIME-Friday")


def trade_breakout_chase(sym, wn, wb, level, ref_close, boxlow, sc, i_setup):
    if ref_close > level:
        return None
    if wb[0]["open"] is not None and wb[0]["open"] > ref_close * 1.03:
        return None
    brk = next((i for i, b in enumerate(wb)
                if b["high"] is not None and b["high"] > level), None)
    if brk is None or brk + 1 >= len(wb):
        return None
    entry = wb[brk + 1]["open"]
    if not entry or entry <= 0:
        return None
    atr = atr_to(sc, i_setup)
    if atr is None or atr <= 0:
        return None
    risk = min(entry - boxlow, atr) if (boxlow and entry > boxlow) else atr
    if risk <= 0:
        return None
    sl, tgt = entry - risk, entry + 2 * risk
    if int(NOTIONAL // entry) <= 0:
        return None
    exit_px, why = None, None
    for b in wb[brk + 1:]:
        hs = b["low"] is not None and b["low"] <= sl
        ht = b["high"] is not None and b["high"] >= tgt
        if hs and ht:
            exit_px, why = sl, "SL-same-bar"
            break
        if hs:
            exit_px, why = sl, "SL"
            break
        if ht:
            exit_px, why = tgt, "TARGET"
            break
    if exit_px is None:
        exit_px, why = wb[-1]["close"], "TIME-Friday"
    return book_long(sym, wn, wb[brk + 1]["date"], entry, exit_px, why,
                     {"sl": round(sl, 2), "tgt": round(tgt, 2),
                      "break_day": wb[brk]["date"]})


def main():
    ds = json.load(open(DATASET))
    weeks = {w["n"]: w for w in ds["meta"]["weeks"]}
    by_week = {}
    for r in ds["rows"]:
        by_week.setdefault(r["week"], []).append(r)

    print("warming symbol cache...", flush=True)
    syms = {r["symbol"] for rs in by_week.values() for r in rs if "screen" in r}
    hints = {}
    for rs in by_week.values():
        for r in rs:
            hints.setdefault(r["symbol"], r.get("cache"))
    for s in syms:
        symcache(s, hints.get(s))
    print(f"cached {len(_symcache)} symbols", flush=True)

    log = []
    results = {}

    # ================= C1: MR-long on oversold screened names ==============
    def c1_run(ret_thr, dry_thr, tgt_pct, require_reclaim=True):
        out = []
        for wn in sorted(weeks):
            w = weeks[wn]
            for r in by_week[wn]:
                scr = r.get("screen")
                if not scr or not scr.get("screened"):
                    continue
                sc = _symcache.get(r["symbol"])
                if sc is None:
                    continue
                i = bisect.bisect_right(sc["sdates"], w["setup_session"]) - 1
                if i < 10:
                    continue
                avgvol = scr.get("avgvol20") or 0
                if avgvol <= 0:
                    continue
                ref = sc["bars"][sc["sdates"][i]][3]
                c5 = sc["bars"][sc["sdates"][i - 5]][3]
                ret5 = ref / c5 - 1
                dma5 = sum(sc["bars"][sc["sdates"][k]][3] for k in range(i - 4, i + 1)) / 5
                vol5 = sum(sc["bars"][sc["sdates"][k]][4] for k in range(i - 4, i + 1)) / 5
                if not (ret5 < ret_thr):
                    continue
                if not (vol5 / avgvol < dry_thr):
                    continue
                if require_reclaim and not (ref > dma5):
                    continue
                wb = wbars(sc, w["outcome"])
                if len(wb) < 2:
                    continue
                t = trade_mon_fri_target(r["symbol"], wn, wb, tgt_pct)
                if t:
                    t["extra"] = {"ret5": round(ret5 * 100, 2),
                                  "dry": round(vol5 / avgvol, 2)}
                    out.append(t)
        return out

    c1_vars = [((-0.05, 0.8, 0.03, True), "base:ret5<-5%,dry<0.8,reclaim,tgt3%"),
               ((-0.07, 0.8, 0.03, True), "r1:ret5<-7%,dry<0.8,reclaim,tgt3%"),
               ((-0.05, 0.7, 0.04, True), "r2:ret5<-5%,dry<0.7,reclaim,tgt4%"),
               ((-0.03, 0.8, 0.03, False), "r3:ret5<-3%,dry<0.8,no-reclaim,tgt3%")]
    c1_runs = []
    for (params, name) in c1_vars:
        tr = c1_run(*params)
        e = split_eval(tr)
        c1_runs.append((e, tr, name))
        log.append({"cand": "C1", "params": name,
                    "fit_n": e["fit"]["trades"],
                    "fit_exp_slip": e["fit"]["expectancy_slip"]})
        print(f"C1 {name}: fit={json.dumps(e['fit'])}", flush=True)
    be, btr, bname = max(c1_runs, key=lambda x: (x[0]["fit"]["expectancy_slip"]
                                                if x[0]["fit"]["expectancy_slip"] is not None else -1e9))
    results["C1"] = {"variant": bname, "eval": split_eval(btr),
                     "max_concurrent": max_concurrent(btr),
                     "trades": btr}
    print("C1 BEST", bname, json.dumps(results["C1"]["eval"], indent=1), flush=True)

    # ================= C2: smallcap momentum (proxy) ========================
    fit_rv = sorted(scr["avgvol20"] * scr["ref_close"]
                    for wn in FIT_WEEKS for r in by_week[wn]
                    for scr in [r.get("screen")]
                    if scr and scr.get("screened") and scr.get("avgvol20"))
    med_rv = fit_rv[len(fit_rv) // 2]
    print(f"C2 proxy cutoff (fit-median 20d rupee-vol): Rs {med_rv:,.0f}", flush=True)

    def c2_run(mult):
        out = []
        for wn in sorted(weeks):
            w = weeks[wn]
            for r in by_week[wn]:
                scr = r.get("screen")
                if not scr or not scr.get("screened") or not scr.get("avgvol20"):
                    continue
                if scr["avgvol20"] * scr["ref_close"] >= med_rv * mult:
                    continue
                sc = _symcache.get(r["symbol"])
                if sc is None:
                    continue
                i = bisect.bisect_right(sc["sdates"], w["setup_session"]) - 1
                if i < 60:
                    continue
                wb = wbars(sc, w["outcome"])
                if len(wb) < 2:
                    continue
                level = scr["box"]["high"] if scr["box"] else scr["hi20"]
                boxlow = scr["box"]["low"] if scr["box"] else None
                t = trade_breakout_chase(r["symbol"], wn, wb, level,
                                         scr["ref_close"], boxlow, sc, i)
                if t:
                    out.append(t)
        return out

    c2_runs = []
    for mult, name in [(1.0, "base:rv<median,chase"), (0.5, "r1:rv<0.5med,chase")]:
        tr = c2_run(mult)
        e = split_eval(tr)
        c2_runs.append((e, tr, name))
        log.append({"cand": "C2'", "params": name,
                    "fit_n": e["fit"]["trades"],
                    "fit_exp_slip": e["fit"]["expectancy_slip"]})
        print(f"C2 {name}: fit={json.dumps(e['fit'])}", flush=True)
    be2, bt2, bn2 = max(c2_runs, key=lambda x: (x[0]["fit"]["expectancy_slip"]
                                               if x[0]["fit"]["expectancy_slip"] is not None else -1e9))
    results["C2"] = {"variant": bn2, "cutoff_rupeevol": med_rv,
                     "eval": split_eval(bt2), "max_concurrent": max_concurrent(bt2),
                     "trades": bt2,
                     "note": "as-specified mcap<8000cr BLOCKED (no PIT cap data)"}
    print("C2 BEST", bn2, json.dumps(results["C2"]["eval"], indent=1), flush=True)

    # ================= C3: weekly-base breakout =============================
    def c3_run(rng_max, dist_max):
        out = []
        for wn in sorted(weeks):
            w = weeks[wn]
            for r in by_week[wn]:
                if "screen" not in r:
                    continue
                sc = _symcache.get(r["symbol"])
                if sc is None:
                    continue
                past = [x for x in sc["weeks"] if x["end"] <= w["setup_session"]]
                if len(past) < 12:
                    continue
                base = past[-12:]
                hi = max(x["hi"] for x in base)
                lo = min(x["lo"] for x in base)
                mean = sum(x["cl"] for x in base) / 12
                last = base[-1]["cl"]
                rng = (hi - lo) / mean * 100 if mean > 0 else 999
                dist = (hi - last) / last * 100 if last > 0 else 999
                if not (rng <= rng_max and dist <= dist_max):
                    continue
                wb = wbars(sc, w["outcome"])
                if len(wb) < 2:
                    continue
                t = trade_mon_fri(r["symbol"], wn, wb)
                if t:
                    t["extra"] = {"base_rng": round(rng, 2),
                                  "base_dist": round(dist, 2)}
                    out.append(t)
        return out

    c3_runs = []
    for params, name in [((12.0, 4.0), "base:rng<=12,dist<=4"),
                         ((10.0, 4.0), "r1:rng<=10,dist<=4"),
                         ((12.0, 6.0), "r2:rng<=12,dist<=6")]:
        tr = c3_run(*params)
        e = split_eval(tr)
        c3_runs.append((e, tr, name))
        log.append({"cand": "C3", "params": name,
                    "fit_n": e["fit"]["trades"],
                    "fit_exp_slip": e["fit"]["expectancy_slip"]})
        print(f"C3 {name}: fit={json.dumps(e['fit'])}", flush=True)
    be3, bt3, bn3 = max(c3_runs, key=lambda x: (x[0]["fit"]["expectancy_slip"]
                                               if x[0]["fit"]["expectancy_slip"] is not None else -1e9))
    results["C3"] = {"variant": bn3, "eval": split_eval(bt3),
                     "max_concurrent": max_concurrent(bt3), "trades": bt3}
    print("C3 BEST", bn3, json.dumps(results["C3"]["eval"], indent=1), flush=True)

    # ================= C4: catalyst>=2 drift ================================
    out4 = []
    for wn in sorted(weeks):
        w = weeks[wn]
        for r in by_week[wn]:
            scr = r.get("screen")
            if not scr or not scr.get("screened"):
                continue
            if r.get("catalyst", {}).get("catalyst_score", 0) < 2:
                continue
            sc = _symcache.get(r["symbol"])
            if sc is None:
                continue
            wb = wbars(sc, w["outcome"])
            if len(wb) < 2:
                continue
            t = trade_mon_fri(r["symbol"], wn, wb)
            if t:
                out4.append(t)
    e4 = split_eval(out4)
    log.append({"cand": "C4", "params": "screened&cat>=2,Mon-Fri",
                "fit_n": e4["fit"]["trades"],
                "fit_exp_slip": e4["fit"]["expectancy_slip"]})
    results["C4"] = {"variant": "base", "eval": e4,
                     "max_concurrent": max_concurrent(out4), "trades": out4}
    print("C4", json.dumps(e4, indent=1), flush=True)

    # ================= C5: S3 distribution-short (verbatim) =================
    def c5_run(dist_min, vol_mult):
        out = []
        for wn in sorted(weeks):
            w = weeks[wn]
            for r in by_week[wn]:
                scr = r.get("screen")
                if not scr:
                    continue
                sc = _symcache.get(r["symbol"])
                if sc is None:
                    continue
                i = bisect.bisect_right(sc["sdates"], w["setup_session"]) - 1
                if i < 59:  # verbatim S3: >=60 setup bars
                    continue
                avgvol = scr.get("avgvol20") or 0
                if avgvol <= 0:
                    continue
                dist_n = 0
                for k in range(i - 9, i + 1):
                    b = sc["bars"][sc["sdates"][k]]
                    prev = sc["bars"][sc["sdates"][k - 1]]
                    rng = b[1] - b[2]
                    weak = ((b[3] - b[2]) / rng < 0.5) if rng > 0 else False
                    down = b[3] < prev[3]
                    if down and b[4] >= vol_mult * avgvol and weak:
                        dist_n += 1
                c_now = sc["bars"][sc["sdates"][i]][3]
                c_5 = sc["bars"][sc["sdates"][i - 5]][3]
                ret5 = c_now / c_5 - 1
                if not (dist_n >= dist_min and ret5 < 0):
                    continue
                wb = wbars(sc, w["outcome"])
                if len(wb) < 2:
                    continue
                atr = atr_to(sc, i)
                if atr is None or atr <= 0:
                    continue
                entry = wb[0]["open"]
                sl5 = max(sc["bars"][sc["sdates"][k]][1] for k in range(i - 4, i + 1))
                sl = max(sl5, entry + 0.01)
                if not (sl > entry):
                    sl = entry + atr
                risk = sl - entry
                tgt = entry - 2 * risk
                if int(NOTIONAL // entry) <= 0 or entry <= 0:
                    continue
                exit_px, why = None, None
                for b in wb:
                    hs = b["high"] is not None and b["high"] >= sl
                    ht = b["low"] is not None and b["low"] <= tgt
                    if hs and ht:
                        exit_px, why = sl, "SL-same-bar"
                        break
                    if hs:
                        exit_px, why = sl, "SL"
                        break
                    if ht:
                        exit_px, why = tgt, "TARGET"
                        break
                if exit_px is None:
                    exit_px, why = wb[-1]["close"], "TIME-Friday"
                out.append(book_short(r["symbol"], wn, wb[0]["date"], entry,
                                      sl, tgt, int(NOTIONAL // entry), exit_px,
                                      why, {"dist_days": dist_n,
                                            "ret5_pct": round(ret5 * 100, 2)}))
        return out

    g0 = split_eval(c5_run(3, 1.3))
    log.append({"cand": "C5", "params": "base:S3-verbatim dist>=3,vol>=1.3x",
                "fit_n": g0["fit"]["trades"],
                "fit_exp_slip": g0["fit"]["expectancy_slip"]})
    print(f"C5 base: fit={json.dumps(g0['fit'])}", flush=True)
    c5_runs = [(g0, None, "base")]
    # refinements only if fit shows promise; count them
    v0 = None
    if g0["fit"]["expectancy_slip"] and g0["fit"]["expectancy_slip"] > 0:
        v0 = c5_run(3, 1.3)
        for params, name in [((4, 1.3), "r1:dist>=4,vol>=1.3x"),
                             ((3, 1.5), "r2:dist>=3,vol>=1.5x")]:
            tr = c5_run(*params)
            e = split_eval(tr)
            c5_runs.append((e, tr, name))
            log.append({"cand": "C5", "params": name,
                        "fit_n": e["fit"]["trades"],
                        "fit_exp_slip": e["fit"]["expectancy_slip"]})
            print(f"C5 {name}: fit={json.dumps(e['fit'])}", flush=True)
        be5, bt5, bn5 = max(c5_runs, key=lambda x: (x[0]["fit"]["expectancy_slip"]
                                                   if x[0]["fit"]["expectancy_slip"] is not None else -1e9))
        if bt5 is None:
            bt5 = v0
            be5 = g0
            bn5 = "base"
    else:
        v0 = c5_run(3, 1.3)
        be5, bt5, bn5 = g0, v0, "base"
    results["C5"] = {"variant": bn5, "eval": split_eval(bt5),
                     "max_concurrent": max_concurrent(bt5), "trades": bt5,
                     "note": "14w extension impossible (cache ends 2026-10-09)"}
    print("C5 BEST", bn5, json.dumps(results["C5"]["eval"], indent=1), flush=True)

    out = {"meta": {"notional": NOTIONAL, "slip_bps": 5,
                    "fit": sorted(FIT_WEEKS), "oos": sorted(OOS_WEEKS),
                    "confirm_bar": "pooled exp_slip>+300 AND fit>0 AND oos>0 AND n>=40",
                    "costs": "backtest.costs EVERY trade"},
           "rounds": log,
           "results": {k: {kk: vv for kk, vv in v.items() if kk != "trades"}
                       for k, v in results.items()},
           "trades": {k: v.get("trades", []) for k, v in results.items()}}
    json.dump(out, open(OUT_JSON, "w"), indent=1)
    print("wrote", OUT_JSON, flush=True)


if __name__ == "__main__":
    main()
