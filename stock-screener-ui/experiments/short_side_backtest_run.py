"""SHORT-side mirror backtest (10 weeks ending 2026-10-09).

Reads ONLY experiments/three_leg_dataset.json (screen/box/legs per symbol-week)
+ cached daily candles (experiments/data/pattern_cache/candles/1D) + Nifty CSV.
Writes ONLY experiments/short_side.json and experiments/short_side.md.
Never touches db/alphashri.db. Costs via backtest.costs on EVERY trade.

Systems (all: short next-open, cover Friday close, Rs 1L/trade notional):
  S1 breakdown ......... breakdown (CLOSE below level) of 20d low or box low
                         on >=1.5x avgvol20 -> short next open.
                         SL = breakdown-day high, fallback entry+1xATR.
                         Target = entry - 2R.
  S2 failed-breakout ... screened long-breakout signals (legs A/B/C) whose
  fade                   breakout closes back below the level within 2 sessions
                         -> short next open. SL = max(breakout-day high,
                         fail-day high), fallback entry+1xATR. Target 2R.
  S3 distribution ...... setup screen (no outcome peek): in last 10 setup
  short                  sessions, >=3 distribution days (down day on >=1.3x
                         avgvol20 with weak close: (close-low)/(high-low)<0.5)
                         AND 5-session return < 0 -> short Monday (first
                         outcome day) open. SL = highest high of last 5 setup
                         sessions, fallback entry+1xATR. Target 2R.

CAVEAT (mission-stated, not solved here): swing shorting in cash is not
practical for most accounts (no short-sale carry in equity cash); this needs
intraday or F&O/SLB. Costs below are intraday-style; the question tested is
whether the EDGE exists, execution comes later.
"""
import json
import os
import pickle
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import pandas as pd

from backtest.costs import calculate_trading_costs

EXP = os.path.dirname(__file__)
CACHE_1D = os.path.join(EXP, "data", "pattern_cache", "candles", "1D")
DATASET = os.path.join(EXP, "three_leg_dataset.json")
NIFTY_CSV = os.path.join(EXP, "three_leg_nifty.csv")
OUT_JSON = os.path.join(EXP, "short_side.json")
OUT_MD = os.path.join(EXP, "short_side.md")

NOTIONAL = 100_000.0
SLIP_BPS = 0.0005  # 5 bps per side, same as three_leg study


def load_frame(sym, cache_hint=None):
    names = []
    if cache_hint:
        names.append(cache_hint)
    names += [f"{sym}.v3.pkl", f"{sym}.2026-10-09.v3.pkl",
              f"{sym}.2026-10-06.v3.pkl", f"{sym}.v2.pkl"]
    for name in names:
        p = os.path.join(CACHE_1D, name)
        if os.path.exists(p):
            try:
                df = pickle.load(open(p, "rb"))
                if df is not None and not df.empty:
                    return df
            except Exception:
                pass
    return None


def ist_dates(df):
    try:
        return df.index.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d")
    except Exception:
        return pd.Series([""] * len(df), index=df.index)


def day_bar(df, dates, d):
    sub = df[dates == d]
    if len(sub) == 0:
        return None
    b = sub.iloc[-1]
    o = sub.iloc[0]["open"]
    return {"date": d, "open": float(o), "high": float(b["high"]),
            "low": float(b["low"]), "close": float(b["close"]),
            "volume": float(b["volume"])}


def atr14(setup):
    h = setup["high"].astype(float)
    l = setup["low"].astype(float)
    c = setup["close"].astype(float)
    tr = pd.concat([h - l, (h - c.shift()).abs(),
                    (l - c.shift()).abs()], axis=1).max(axis=1)
    v = tr.ewm(alpha=1 / 14, adjust=False).mean().iloc[-1]
    return float(v) if np.isfinite(v) else None


def simulate_short(entry, sl, week_bars, j_entry):
    """Short next-open simulation. j_entry = index of entry day in week_bars.

    SL first on ambiguous same-bar hits (conservative, mirrors long study).
    Returns (exit_px, why).
    """
    risk = sl - entry
    tgt = entry - 2 * risk
    exit_px, why = None, None
    for b in week_bars[j_entry:]:
        hit_sl = b["low"] is not None and b["high"] is not None and b["high"] >= sl
        hit_tg = b["low"] is not None and b["low"] <= tgt
        if hit_sl and hit_tg:
            exit_px, why = sl, "SL-same-bar"
            break
        if hit_sl:
            exit_px, why = sl, "SL"
            break
        if hit_tg:
            exit_px, why = tgt, "TARGET"
            break
    if exit_px is None:
        exit_px, why = week_bars[-1]["close"], "TIME-Friday"
    return exit_px, why, tgt


def book_trade(system, sym, week_n, entry_day, entry, sl, tgt, qty,
               exit_px, why, extra=None):
    gross = (entry - exit_px) * qty  # short: profit when exit < entry
    costs = calculate_trading_costs(entry, exit_px, qty, side="SHORT")["total_costs"]
    e_s = entry * (1 - SLIP_BPS)
    x_s = exit_px * (1 + SLIP_BPS)
    gross_s = (e_s - x_s) * qty
    costs_s = calculate_trading_costs(e_s, x_s, qty, side="SHORT")["total_costs"]
    tr = {"system": system, "symbol": sym, "week": week_n,
          "entry_day": entry_day, "entry": round(entry, 2),
          "sl": round(sl, 2), "tgt": round(tgt, 2), "qty": qty,
          "exit": round(exit_px, 2), "why": why,
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
                "expectancy": None, "maxDD": 0.0}
    nets = [t["net"] for t in trades]
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
            "net_slip": round(sum(t["net_slip"] for t in trades), 2),
            "pf": round(gp / gl, 2) if gl > 0 else None,
            "expectancy": round(sum(nets) / n, 2),
            "maxDD": round(mdd, 2)}


def main():
    ds = json.load(open(DATASET))
    weeks_meta = {w["n"]: w for w in ds["meta"]["weeks"]}
    rows_by_week = {}
    for r in ds["rows"]:
        rows_by_week.setdefault(r["week"], []).append(r)

    nifty = pd.read_csv(NIFTY_CSV, parse_dates=["date"])
    nifty["date"] = pd.to_datetime(nifty["date"]).dt.strftime("%Y-%m-%d")
    nifty = nifty.set_index("date")["close"].astype(float)

    # outcome-week Nifty return (first outcome open proxy: prev close -> Friday close)
    wk_nifty_ret = {}
    for n, w in weeks_meta.items():
        days = w["outcome"]
        try:
            c0 = float(nifty.loc[days[0]])
            c1 = float(nifty.loc[days[-1]])
            # use close before first outcome day as base
            idx = nifty.index.tolist()
            i0 = idx.index(days[0])
            base = float(nifty.iloc[i0 - 1]) if i0 > 0 else c0
            wk_nifty_ret[n] = round((c1 / base - 1) * 100, 2)
        except Exception:
            wk_nifty_ret[n] = None
    wk_dir = {n: ("down" if v is not None and v < 0 else "up")
              for n, v in wk_nifty_ret.items()}

    frames = {}

    def frame(sym, hint):
        if sym not in frames:
            frames[sym] = load_frame(sym, hint)
        return frames[sym]

    per_week = {}
    pooled = {"S1_breakdown": [], "S2_fade": [], "S3_dist": []}
    counts = {"S1_signals": 0, "S2_candidates": 0, "S3_candidates": 0}

    for n in sorted(weeks_meta):
        w = weeks_meta[n]
        S = w["setup_session"]
        O = w["outcome"]
        rec = {"n": n, "setup": S, "outcome_days": O,
               "nifty_outcome_ret": wk_nifty_ret[n], "week_dir": wk_dir[n],
               "setup_regime_chg": None}
        wk_trades = {"S1_breakdown": [], "S2_fade": [], "S3_dist": []}
        for r in rows_by_week[n]:
            sym = r["symbol"]
            if rec["setup_regime_chg"] is None:
                rec["setup_regime_chg"] = r["regime"]["weekly_change_pct"]
            df = frame(sym, r.get("cache"))
            if df is None:
                continue
            dates = ist_dates(df)
            setup = df[dates <= S]
            if len(setup) < 60:
                continue
            wb = [day_bar(df, dates, d) for d in O]
            wb = [b for b in wb if b is not None]
            if len(wb) < 2:
                continue
            atr = atr14(setup)
            if atr is None or atr <= 0:
                continue
            scr = r["screen"]
            avgvol = scr.get("avgvol20") or 0
            box = scr.get("box")

            # ---- S1: breakdown of 20d low or box low ----
            # Proximity gate (mirror of long leg-A dist filter): the level is
            # only a live support test if setup close is at/near it. Without
            # this, stale box lows far above price (already broken long ago)
            # trigger trivially. Skip if already below, or >10% above.
            low20 = float(setup["low"].tail(20).min())
            level = float(box["low"]) if box else low20
            lvl_kind = "boxlow" if box else "low20"
            ref_close = float(scr.get("ref_close") or setup["close"].iloc[-1])
            s1_live = (ref_close >= level
                       and (ref_close - level) / ref_close <= 0.10)
            for i, b in enumerate(wb):
                if (s1_live and b["close"] < level and avgvol > 0
                        and b["volume"] >= 1.5 * avgvol):
                    counts["S1_signals"] += 1
                    if i + 1 < len(wb):
                        entry = wb[i + 1]["open"]
                        sl = b["high"]
                        if not (sl > entry):
                            sl = entry + atr
                        qty = int(NOTIONAL // entry)
                        if qty > 0 and entry > 0:
                            ex, why, tgt = simulate_short(entry, sl, wb, i + 1)
                            wk_trades["S1_breakdown"].append(book_trade(
                                "S1_breakdown", sym, n, wb[i + 1]["date"],
                                entry, sl, tgt, qty, ex, why,
                                {"break_day": b["date"], "level": round(level, 2),
                                 "level_kind": lvl_kind,
                                 "break_volx": round(b["volume"] / avgvol, 2)}))
                    break  # first breakdown only

            # ---- S2: failed-breakout fade ----
            if scr.get("screened"):
                counts["S2_candidates"] += 1
                ref = r["outcome"]["ref_level"]
                brk = None
                for i, b in enumerate(wb):
                    if b["high"] > ref:
                        brk = i
                        break
                if brk is not None:
                    fail = None
                    for j in range(brk, min(brk + 3, len(wb))):
                        # within 2 sessions after breakout day (j-brk<=2)
                        if wb[j]["close"] < ref:
                            fail = j
                            break
                    if fail is not None and fail + 1 < len(wb):
                        entry = wb[fail + 1]["open"]
                        sl = max(wb[brk]["high"], wb[fail]["high"])
                        if not (sl > entry):
                            sl = entry + atr
                        qty = int(NOTIONAL // entry)
                        if qty > 0 and entry > 0:
                            ex, why, tgt = simulate_short(entry, sl, wb, fail + 1)
                            wk_trades["S2_fade"].append(book_trade(
                                "S2_fade", sym, n, wb[fail + 1]["date"],
                                entry, sl, tgt, qty, ex, why,
                                {"break_day": wb[brk]["date"],
                                 "fail_day": wb[fail]["date"],
                                 "ref_level": ref,
                                 "rules": scr.get("leg_a") and "A" or
                                          (scr.get("leg_b") and "B" or "C")}))

            # ---- S3: distribution short (setup-only screen) ----
            sdates = sorted(set(dates[dates <= S].tolist()))
            last10 = sdates[-10:]
            if len(last10) == 10 and avgvol > 0:
                dist_n = 0
                for k, d in enumerate(last10):
                    b = day_bar(df, dates, d)
                    prev = day_bar(df, dates, last10[k - 1]) if k > 0 else None
                    if b is None:
                        continue
                    rng = b["high"] - b["low"]
                    weak = ((b["close"] - b["low"]) / rng < 0.5) if rng > 0 else False
                    down = (prev is not None and b["close"] < prev["close"])
                    if down and b["volume"] >= 1.3 * avgvol and weak:
                        dist_n += 1
                c_now = float(setup["close"].iloc[-1])
                c_5 = float(setup["close"].iloc[-6])
                ret5 = c_now / c_5 - 1
                if dist_n >= 3 and ret5 < 0:
                    counts["S3_candidates"] += 1
                    entry = wb[0]["open"]
                    sl = max(float(setup["high"].iloc[-5:].max()), entry + 0.01)
                    if not (sl > entry):
                        sl = entry + atr
                    qty = int(NOTIONAL // entry)
                    if qty > 0 and entry > 0:
                        ex, why, tgt = simulate_short(entry, sl, wb, 0)
                        wk_trades["S3_dist"].append(book_trade(
                            "S3_dist", sym, n, wb[0]["date"], entry, sl, tgt,
                            qty, ex, why,
                            {"dist_days": dist_n,
                             "ret5_pct": round(ret5 * 100, 2)}))
        rec["trades"] = {k: v for k, v in wk_trades.items()}
        rec["metrics"] = {k: metrics(v) for k, v in wk_trades.items()}
        per_week[str(n)] = rec
        for k, v in wk_trades.items():
            pooled[k].extend(v)

    # splits
    up = {k: [t for t in v if wk_dir[t["week"]] == "up"] for k, v in pooled.items()}
    down = {k: [t for t in v if wk_dir[t["week"]] == "down"] for k, v in pooled.items()}
    first5 = {k: [t for t in v if t["week"] <= 5] for k, v in pooled.items()}
    last5 = {k: [t for t in v if t["week"] > 5] for k, v in pooled.items()}

    out = {
        "meta": {
            "notional": NOTIONAL, "slip_bps": 5, "costs": "backtest.costs SHORT",
            "nifty_outcome_ret": wk_nifty_ret,
            "week_dir": wk_dir,
            "counts": counts,
            "caveat": ("Swing shorting in cash is not practical for most accounts; "
                       "needs intraday or F&O/SLB. Costs are intraday-style; "
                       "this tests whether the EDGE exists."),
            "s3_spec": ("dist day = close<prev close & vol>=1.3x avgvol20 & "
                        "close in bottom half of day range; >=3 in last 10 "
                        "setup sessions & 5-session return<0 -> short first "
                        "outcome-day open; SL = max high last 5 setup sessions "
                        "(fallback entry+ATR); target entry-2R; cover Friday."),
        },
        "per_week": per_week,
        "pooled": {k: metrics(v) for k, v in pooled.items()},
        "up_weeks": {k: metrics(v) for k, v in up.items()},
        "down_weeks": {k: metrics(v) for k, v in down.items()},
        "first5": {k: metrics(v) for k, v in first5.items()},
        "last5": {k: metrics(v) for k, v in last5.items()},
        "trades": {k: v for k, v in pooled.items()},
    }
    json.dump(out, open(OUT_JSON, "w"), indent=1)
    print(json.dumps({k: metrics(v) for k, v in pooled.items()}, indent=1))
    print("UP:", json.dumps({k: metrics(v)["net"] for k, v in up.items()}))
    print("DOWN:", json.dumps({k: metrics(v)["net"] for k, v in down.items()}))
    print("counts:", counts)

    # ---- hand-verify 3 trades from raw candles ----
    picks = []
    for k in ("S1_breakdown", "S2_fade", "S3_dist"):
        if pooled[k]:
            picks.append(pooled[k][0])
    lines = ["# Hand-verification (raw candles vs booked trade)"]
    for t in picks:
        df = frame(t["symbol"], None)
        dates = ist_dates(df)
        w = weeks_meta[t["week"]]
        show = [w["setup_session"]] + w["outcome"]
        lines.append(f"\n## {t['system']} {t['symbol']} wk{t['week']}")
        lines.append(f"booked: {json.dumps(t)}")
        for d in show:
            b = day_bar(df, dates, d)
            lines.append(f"  {d}: {json.dumps(b)}")
        # recompute expected gross from raw prints
        qty, e, x = t["qty"], t["entry"], t["exit"]
        lines.append(f"  check: gross=(entry-exit)*qty={(e - x) * qty:.2f} "
                     f"booked={t['gross']}; "
                     f"costs={calculate_trading_costs(e, x, qty, side='SHORT')}")
    open(OUT_MD + ".verify.txt", "w").write("\n".join(lines))
    print("\n".join(lines[:40]))


if __name__ == "__main__":
    main()
