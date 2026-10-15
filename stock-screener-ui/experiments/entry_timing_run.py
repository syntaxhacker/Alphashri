"""Entry-timing study (experiment code, NOT prod).

Reuses screened signals (legs A/B/C) from experiments/three_leg_dataset.json
(screen built with bars <= setup_session; NOT rebuilt here). Tests 5 entry
variants + next-open baseline on the SAME signals, 10 outcome weeks ending
2026-10-09. Costs via backtest/costs.py:calculate_trading_costs on EVERY
trade/leg. Notional Rs 1L/trade (Rs 50k/leg for V5). LONG only except V4
(SHORT fade; intraday-style costs, swing-short constraint flagged).

Writes ONLY experiments/entry_timing.json + experiments/entry_timing.md.
Reads candles ONLY from local 1D pattern cache (no network).

Baseline B0 (next-open): break = first outcome-day close > level
(box high, else 20d high); enter NEXT outcome session open; SL = box low
(no-box: entry - 1xATR14 on setup bars); target = entry + 2R; Friday exit;
same-bar SL wins. Rows with already_above (extended) are skipped everywhere.

V1 hold-confirm: D+1 close > level required; enter session after D+1.
V2 hold+volume: V1 + D+1 volume >= 1.0 x avgvol20.
V3 limit-retest: within 3 sessions after break, first day with
    low <= level*1.01 and close > level -> enter AT level (best-case limit
    fill, flagged); manage from touch day; else skip.
V4 fade SHORT: break then close back below level within 2 sessions (fail day
    F); enter next session open SHORT; SL = break-day high; tgt = entry-2R;
    Friday exit.
V5 half+add: leg1 Rs50k at next open after break; leg2 Rs50k only if D+1
    holds (enter following open); each leg own 2R box + Friday exit; costs
    on both legs.

Slippage run: 5bps/side price adjust (long: entry*1.0005/exit*0.9995; short
mirrored), qty fixed from unslipped sizing, costs recomputed.
"""

import json
import math
import os
import pickle
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pandas as pd

from backtest.costs import calculate_trading_costs

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_1D = os.path.join(HERE, "data", "pattern_cache", "candles", "1D")
DATASET = os.path.join(HERE, "three_leg_dataset.json")
OUT_JSON = os.path.join(HERE, "entry_timing.json")
OUT_MD = os.path.join(HERE, "entry_timing.md")

NOTIONAL = 100000.0
SLIP = 0.0005

_frame_cache: dict = {}


def load_frame(sym: str):
    if sym in _frame_cache:
        return _frame_cache[sym]
    for name in (f"{sym}.v3.pkl", f"{sym}.v2.pkl"):
        p = os.path.join(CACHE_1D, name)
        if os.path.exists(p):
            try:
                df = pickle.load(open(p, "rb"))
                if df is not None and not df.empty:
                    _frame_cache[sym] = df
                    return df
            except Exception:
                pass
    try:
        cands = sorted((f for f in os.listdir(CACHE_1D)
                        if f.startswith(sym + ".") and f.endswith(".pkl")
                        and ".lb" not in f and ".meta" not in f), reverse=True)
    except Exception:
        cands = []
    for name in cands:
        try:
            df = pickle.load(open(os.path.join(CACHE_1D, name), "rb"))
            if df is not None and not df.empty:
                _frame_cache[sym] = df
                return df
        except Exception:
            pass
    _frame_cache[sym] = None
    return None


def ist_date(idx) -> pd.Series:
    try:
        return idx.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d")
    except Exception:
        return pd.Series([""] * len(idx), index=idx)


def day_bar(df, day: str):
    d = ist_date(df.index)
    m = df[d == day]
    if len(m) == 0:
        return None
    b = m.iloc[-1]
    return {"date": day, "open": float(b["open"]), "high": float(b["high"]),
            "low": float(b["low"]), "close": float(b["close"]),
            "vol": float(b["volume"])}


def atr14(df, setup_session: str):
    d = ist_date(df.index)
    s = df[d <= setup_session].tail(30)
    if len(s) < 15:
        return None
    trs = []
    prev = None
    for _, b in s.iterrows():
        hi, lo, cl = float(b["high"]), float(b["low"]), float(b["close"])
        if prev is None:
            trs.append(hi - lo)
        else:
            trs.append(max(hi - lo, abs(hi - prev), abs(lo - prev)))
        prev = cl
    tail = trs[-14:]
    v = sum(tail) / len(tail)
    return round(v, 2) if v and v > 0 else None


def qty_for(notional, price):
    q = math.floor(notional / price) if price and price > 0 else 0
    return max(1, q)


def slip_long(entry, exit_):
    return entry * (1 + SLIP), exit_ * (1 - SLIP)


def slip_short(entry, exit_):
    return entry * (1 - SLIP), exit_ * (1 + SLIP)


def manage_long(bars, entry, sl, tgt):
    """bars: list of day bars from entry day..Friday. Same-bar SL wins."""
    r = entry - sl
    if r <= 0:
        return None
    for b in bars:
        sl_hit = b["low"] <= sl
        tg_hit = b["high"] >= tgt
        if sl_hit and tg_hit:
            return {"exit": sl, "day": b["date"], "why": "SL"}
        if sl_hit:
            return {"exit": sl, "day": b["date"], "why": "SL"}
        if tg_hit:
            return {"exit": tgt, "day": b["date"], "why": "TARGET"}
    last = bars[-1]
    return {"exit": last["close"], "day": last["date"], "why": "TIME-Friday"}


def manage_short(bars, entry, sl, tgt):
    r = sl - entry
    if r <= 0:
        return None
    for b in bars:
        sl_hit = b["high"] >= sl
        tg_hit = b["low"] <= tgt
        if sl_hit and tg_hit:
            return {"exit": sl, "day": b["date"], "why": "SL"}
        if sl_hit:
            return {"exit": sl, "day": b["date"], "why": "SL"}
        if tg_hit:
            return {"exit": tgt, "day": b["date"], "why": "TARGET"}
    last = bars[-1]
    return {"exit": last["close"], "day": last["date"], "why": "TIME-Friday"}


def finish_long(entry, ex, qty, side_note="LONG"):
    gross = round((ex["exit"] - entry) * qty, 2)
    costs = calculate_trading_costs(entry, ex["exit"], qty, side="LONG")["total_costs"]
    net = round(gross - costs, 2)
    se, sx = slip_long(entry, ex["exit"])
    gross_s = round((sx - se) * qty, 2)
    costs_s = calculate_trading_costs(se, sx, qty, side="LONG")["total_costs"]
    net_s = round(gross_s - costs_s, 2)
    return {"gross": gross, "costs": costs, "net": net,
            "gross_slip": gross_s, "costs_slip": costs_s, "net_slip": net_s}


def finish_short(entry, ex, qty):
    gross = round((entry - ex["exit"]) * qty, 2)
    costs = calculate_trading_costs(entry, ex["exit"], qty, side="SHORT")["total_costs"]
    net = round(gross - costs, 2)
    se, sx = slip_short(entry, ex["exit"])
    gross_s = round((se - sx) * qty, 2)
    costs_s = calculate_trading_costs(se, sx, qty, side="SHORT")["total_costs"]
    net_s = round(gross_s - costs_s, 2)
    return {"gross": gross, "costs": costs, "net": net,
            "gross_slip": gross_s, "costs_slip": costs_s, "net_slip": net_s}


def summarize(trades, key="net"):
    n = len(trades)
    if n == 0:
        return {"trades": 0, "win_pct": None, "net": 0.0, "expectancy": None,
                "pf": None, "maxdd": 0.0}
    vals = [t[key] for t in trades]
    wins = [v for v in vals if v > 0]
    losses = [v for v in vals if v <= 0]
    net = round(sum(vals), 2)
    win_pct = round(len(wins) / n * 100, 1)
    exp = round(sum(vals) / n, 2)
    gp = sum(wins)
    gl = abs(sum(losses))
    pf = round(gp / gl, 2) if gl > 0 else (float("inf") if gp > 0 else None)
    peak, dd = 0.0, 0.0
    cum = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        dd = min(dd, cum - peak)
    return {"trades": n, "win_pct": win_pct, "net": net, "expectancy": exp,
            "pf": pf if pf != float("inf") else "inf", "maxdd": round(dd, 2)}


def main():
    ds = json.load(open(DATASET))
    weeks = ds["meta"]["weeks"]
    rows = ds["rows"]
    by_week = {w["n"]: w for w in weeks}

    variants = ["B0", "V1", "V2", "V3", "V3c", "V4", "V5"]
    trades = {v: [] for v in variants}
    skipped = {"extended": 0, "no_cache": 0, "no_bars": 0}
    no_break = 0

    for r in rows:
        scr = r.get("screen") or {}
        if not scr.get("screened"):
            continue
        out = r.get("outcome") or {}
        if out.get("already_above"):
            skipped["extended"] += 1
            continue
        sym = r["symbol"]
        wk = by_week[r["week"]]
        wdays = wk["outcome"]
        friday = wk["outcome_friday"]
        df = load_frame(sym)
        if df is None:
            skipped["no_cache"] += 1
            continue
        bars = [day_bar(df, d) for d in wdays]
        if any(b is None for b in bars):
            skipped["no_bars"] += 1
            continue
        level = out.get("ref_level")
        if not level or level <= 0:
            continue
        box = scr.get("box") or {}
        box_low = box.get("low")
        avgvol20 = scr.get("avgvol20")
        setup_session = r.get("setup_session")

        # break = first outcome-day close > level
        bi = next((i for i, b in enumerate(bars) if b["close"] > level), None)
        if bi is None:
            no_break += 1
            continue
        break_bar = bars[bi]

        def box_sl(entry):
            if box_low and box_low < entry:
                return round(float(box_low), 2)
            a = atr14(df, setup_session)
            if a:
                return round(entry - a, 2)
            return None

        # ---- B0 baseline: next-open ----
        if bi + 1 < len(bars):
            entry = bars[bi + 1]["open"]
            sl = box_sl(entry)
            if sl is not None:
                tgt = round(entry + 2 * (entry - sl), 2)
                ex = manage_long(bars[bi + 1:], entry, sl, tgt)
                if ex:
                    q = qty_for(NOTIONAL, entry)
                    f = finish_long(entry, ex, q)
                    trades["B0"].append({"symbol": sym, "week": r["week"],
                                         "variant": "B0", "entry": entry,
                                         "sl": sl, "tgt": tgt, "qty": q,
                                         "entry_day": bars[bi + 1]["date"],
                                         "break_day": break_bar["date"],
                                         **ex, **f})

        # ---- V1 hold-confirm ----
        v1_entry_idx = None
        if bi + 1 < len(bars) and bars[bi + 1]["close"] > level \
                and bi + 2 < len(bars):
            v1_entry_idx = bi + 2
            entry = bars[v1_entry_idx]["open"]
            sl = box_sl(entry)
            if sl is not None:
                tgt = round(entry + 2 * (entry - sl), 2)
                ex = manage_long(bars[v1_entry_idx:], entry, sl, tgt)
                if ex:
                    q = qty_for(NOTIONAL, entry)
                    f = finish_long(entry, ex, q)
                    trades["V1"].append({"symbol": sym, "week": r["week"],
                                         "variant": "V1", "entry": entry,
                                         "sl": sl, "tgt": tgt, "qty": q,
                                         "entry_day": bars[v1_entry_idx]["date"],
                                         "break_day": break_bar["date"],
                                         **ex, **f})

        # ---- V2 hold + volume ----
        if v1_entry_idx is not None and avgvol20:
            d1 = bars[bi + 1]
            if d1["vol"] >= float(avgvol20):
                entry = bars[v1_entry_idx]["open"]
                sl = box_sl(entry)
                if sl is not None:
                    tgt = round(entry + 2 * (entry - sl), 2)
                    ex = manage_long(bars[v1_entry_idx:], entry, sl, tgt)
                    if ex:
                        q = qty_for(NOTIONAL, entry)
                        f = finish_long(entry, ex, q)
                        trades["V2"].append({"symbol": sym, "week": r["week"],
                                             "variant": "V2", "entry": entry,
                                             "sl": sl, "tgt": tgt, "qty": q,
                                             "entry_day": bars[v1_entry_idx]["date"],
                                             "break_day": break_bar["date"],
                                             **ex, **f})

        # ---- V3 limit retest at level ----
        touch_idx = None
        for j in range(bi + 1, min(bi + 4, len(bars))):
            b = bars[j]
            if b["low"] <= level * 1.01 and b["close"] > level:
                touch_idx = j
                break
        if touch_idx is not None:
            entry = round(level, 2)
            sl = box_sl(entry)
            if sl is not None and sl < entry:
                tgt = round(entry + 2 * (entry - sl), 2)
                ex = manage_long(bars[touch_idx:], entry, sl, tgt)
                if ex:
                    q = qty_for(NOTIONAL, entry)
                    f = finish_long(entry, ex, q)
                    trades["V3"].append({"symbol": sym, "week": r["week"],
                                         "variant": "V3", "entry": entry,
                                         "sl": sl, "tgt": tgt, "qty": q,
                                         "entry_day": bars[touch_idx]["date"],
                                         "break_day": break_bar["date"],
                                         **ex, **f})
            # ---- V3c sensitivity: same trigger, feasible fill at touch-day CLOSE
            entry_c = bars[touch_idx]["close"]
            sl_c = box_sl(entry_c)
            if sl_c is not None and sl_c < entry_c:
                tgt_c = round(entry_c + 2 * (entry_c - sl_c), 2)
                ex_c = manage_long(bars[touch_idx:], entry_c, sl_c, tgt_c)
                if ex_c:
                    q_c = qty_for(NOTIONAL, entry_c)
                    f_c = finish_long(entry_c, ex_c, q_c)
                    trades["V3c"].append({"symbol": sym, "week": r["week"],
                                          "variant": "V3c", "entry": entry_c,
                                          "sl": sl_c, "tgt": tgt_c, "qty": q_c,
                                          "entry_day": bars[touch_idx]["date"],
                                          "break_day": break_bar["date"],
                                          **ex_c, **f_c})

        # ---- V4 fade-the-flag SHORT ----
        fail_idx = next((j for j in range(bi + 1, min(bi + 3, len(bars)))
                         if bars[j]["close"] < level), None)
        if fail_idx is not None and fail_idx + 1 < len(bars):
            entry = bars[fail_idx + 1]["open"]
            sl = round(break_bar["high"], 2)
            risco = sl - entry
            if risco > 0:
                tgt = round(entry - 2 * risco, 2)
                ex = manage_short(bars[fail_idx + 1:], entry, sl, tgt)
                if ex:
                    q = qty_for(NOTIONAL, entry)
                    f = finish_short(entry, ex, q)
                    trades["V4"].append({"symbol": sym, "week": r["week"],
                                         "variant": "V4", "entry": entry,
                                         "sl": sl, "tgt": tgt, "qty": q,
                                         "entry_day": bars[fail_idx + 1]["date"],
                                         "break_day": break_bar["date"],
                                         "fail_day": bars[fail_idx]["date"],
                                         **ex, **f})

        # ---- V5 half + add ----
        if bi + 1 < len(bars):
            # leg1: 50k at next open
            e1 = bars[bi + 1]["open"]
            s1 = box_sl(e1)
            if s1 is not None:
                t1 = round(e1 + 2 * (e1 - s1), 2)
                x1 = manage_long(bars[bi + 1:], e1, s1, t1)
                if x1:
                    q1 = qty_for(NOTIONAL / 2, e1)
                    f1 = finish_long(e1, x1, q1)
                    leg1 = {"symbol": sym, "week": r["week"], "variant": "V5",
                            "leg": 1, "entry": e1, "sl": s1, "tgt": t1,
                            "qty": q1, "entry_day": bars[bi + 1]["date"],
                            "break_day": break_bar["date"], **x1, **f1}
                    legs = [leg1]
                    # leg2: only if D+1 holds, enter following open
                    if v1_entry_idx is not None:
                        e2 = bars[v1_entry_idx]["open"]
                        s2 = box_sl(e2)
                        if s2 is not None:
                            t2 = round(e2 + 2 * (e2 - s2), 2)
                            x2 = manage_long(bars[v1_entry_idx:], e2, s2, t2)
                            if x2:
                                q2 = qty_for(NOTIONAL / 2, e2)
                                f2 = finish_long(e2, x2, q2)
                                legs.append({"symbol": sym, "week": r["week"],
                                             "variant": "V5", "leg": 2,
                                             "entry": e2, "sl": s2, "tgt": t2,
                                             "qty": q2,
                                             "entry_day": bars[v1_entry_idx]["date"],
                                             "break_day": break_bar["date"],
                                             **x2, **f2})
                    # aggregate legs into one trade row (costs on both legs)
                    net = round(sum(leg["net"] for leg in legs), 2)
                    net_s = round(sum(leg["net_slip"] for leg in legs), 2)
                    gross = round(sum(leg["gross"] for leg in legs), 2)
                    gross_s = round(sum(leg["gross_slip"] for leg in legs), 2)
                    costs = round(sum(leg["costs"] for leg in legs), 2)
                    costs_s = round(sum(leg["costs_slip"] for leg in legs), 2)
                    trades["V5"].append({"symbol": sym, "week": r["week"],
                                         "variant": "V5",
                                         "entry": e1, "sl": s1, "tgt": t1,
                                         "qty": sum(leg["qty"] for leg in legs),
                                         "entry_day": bars[bi + 1]["date"],
                                         "break_day": break_bar["date"],
                                         "n_legs": len(legs), "legs": legs,
                                         "exit": legs[0]["exit"],
                                         "why": ("legs:%s" % ",".join(
                                             f"{leg['leg']}{leg['why'][0]}" for leg in legs)),
                                         "gross": gross, "costs": costs,
                                         "net": net, "gross_slip": gross_s,
                                         "costs_slip": costs_s,
                                         "net_slip": net_s})

    for v in variants:
        trades[v].sort(key=lambda t: (t["week"], t["symbol"]))

    per_week = {}
    for v in variants:
        per_week[v] = {}
        for w in weeks:
            n = w["n"]
            wt = [t for t in trades[v] if t["week"] == n]
            per_week[v][str(n)] = {"no_slip": summarize(wt, "net"),
                                   "slip": summarize(wt, "net_slip")}

    pooled = {v: {"no_slip": summarize(trades[v], "net"),
                  "slip": summarize(trades[v], "net_slip")} for v in variants}
    first5 = {v: summarize([t for t in trades[v] if t["week"] <= 5], "net")
              for v in variants}
    first5_s = {v: summarize([t for t in trades[v] if t["week"] <= 5], "net_slip")
                for v in variants}
    last5 = {v: summarize([t for t in trades[v] if t["week"] >= 6], "net")
             for v in variants}
    last5_s = {v: summarize([t for t in trades[v] if t["week"] >= 6], "net_slip")
               for v in variants}

    payload = {
        "meta": {
            "dataset": "experiments/three_leg_dataset.json",
            "notional": NOTIONAL, "slip_bps_per_side": 5.0,
            "rules": "screened A/B/C rows only, already_above skipped; "
                     "break=first outcome close>level(box high else 20d high); "
                     "B0=next-open SL box-low(no-box entry-ATR14) tgt 2R Fri exit; "
                     "V1=hold-confirm; V2=V1+vol>=1.0xavg20; V3=limit@level on "
                     "first touch(low<=level*1.01,close>level) within 3 sessions; "
                     "V4=short failed break(close back below level within 2 sessions) "
                     "SL=break-day high tgt 2R; V5=50% next-open + 50% on hold; "
                     "V3c=same V3 trigger filled at touch-day CLOSE (feasible); "
                     "same-bar SL wins; costs=calculate_trading_costs every leg; "
                     "slip run: 5bps/side price adjust, qty fixed, costs recomputed",
            "constraints": "V4 swing-short needs F&O/SLB in reality; "
                           "V3 limit@level is best-case fill",
            "skipped": skipped, "no_break_screened": no_break,
            "weeks": [{"n": w["n"], "outcome": w["outcome"],
                       "setup_session": w["setup_session"]} for w in weeks],
        },
        "pooled": pooled,
        "per_week": per_week,
        "first5": {"no_slip": first5, "slip": first5_s},
        "last5": {"no_slip": last5, "slip": last5_s},
        "trades": trades,
    }
    json.dump(payload, open(OUT_JSON, "w"))
    print(f"wrote {OUT_JSON}")
    for v in variants:
        print(f"{v}: n={pooled[v]['no_slip']} | slip={pooled[v]['slip']}")
    print("skipped:", skipped, "no_break:", no_break)


if __name__ == "__main__":
    main()
