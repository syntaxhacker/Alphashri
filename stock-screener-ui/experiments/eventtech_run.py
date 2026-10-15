"""EVENT + TECHNICAL-TIMING backtest (experiment code, NOT prod).

Variants (setup = prior Friday close only; Nifty-500; 10 weeks ending 2026-10-09):
  V1 event-day drift: catalyst_score>=2 in trailing 5 sessions AND close in
     top 30% of 20d range -> enter next (Mon) open, SL = setup-day low,
     target 3R, Friday-close time exit.
  V2 event + accumulation: V1 AND acc-green (OBV slope>0 AND
     (updown>=1.5 OR vol_ratio>=1.2)).
  V3 pre-event anticipation: acc-green AND a scheduled results date within
     7 calendar days after the setup session (yfinance earnings_dates,
     cached) -> enter setup-Friday close, exit day-after-results close
     or Friday close (time exit only, no SL -- as specced).
  V4 QIP follow: 'qip' in headline (DB read-only) in trailing 5 sessions.
     Day+1 = first outcome bar. If day+1 green -> LONG from day+2 open,
     SL = day+1 low, 3R target, Friday exit. If red -> skip long; a
     hypothetical SHORT is tracked separately (note only).

Costs: backtest/costs.py calculate_trading_costs EVERY trade (LONG side;
SHORT side for the V4 short-note). Slippage 5bps adverse both ways, costs
recomputed on slipped prices. Qty = floor(1L/entry). Same-bar SL+target hit
resolves to SL (conservative). No fitting: all thresholds fixed by mission.

Reads: experiments/three_leg_dataset.json, local 1D candle cache, DB in
read-only mode (QIP headlines), experiments/eventtech_earn_cache.json.
Writes ONLY experiments/eventtech*. No network except --phase fetch
(yfinance earnings dates, cached + resumable).
"""

import argparse
import json
import os
import pickle
import sqlite3
import sys
import time
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pandas as pd

from backtest.costs import calculate_trading_costs

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_1D = os.path.join(HERE, "data", "pattern_cache", "candles", "1D")
DS_JSON = os.path.join(HERE, "three_leg_dataset.json")
EARN_CACHE = os.path.join(HERE, "eventtech_earn_cache.json")
DB_PATH = os.path.join(HERE, "..", "db", "alphashri.db")

NOTIONAL = 100_000.0
SLIP = 0.0005  # 5 bps adverse per side

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
                    _frame_cache[sym] = (df, name)
                    return df, name
            except Exception:
                pass
    try:
        cands = sorted((f for f in os.listdir(CACHE_1D)
                        if f.startswith(sym + ".") and f.endswith(".pkl")
                        and ".lb" not in f and ".meta" not in f),
                       reverse=True)
    except Exception:
        cands = []
    for name in cands:
        try:
            df = pickle.load(open(os.path.join(CACHE_1D, name), "rb"))
            if df is not None and not df.empty:
                _frame_cache[sym] = (df, name)
                return df, name
        except Exception:
            pass
    _frame_cache[sym] = (None, None)
    return None, None


def ist_dates(df) -> pd.Series:
    try:
        return pd.Series(df.index.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d"),
                         index=df.index)
    except Exception:
        return pd.Series([""] * len(df), index=df.index)


def bars_upto(df, end: str) -> list:
    """All session bars with IST date <= end as dicts (oldest first)."""
    dates = ist_dates(df)
    cols = {c.lower(): c for c in df.columns}
    oc, hc, lc, cc, vc = (cols.get(k) for k in ("open", "high", "low", "close", "volume"))

    def val(row, c):
        try:
            v = row[c]
            return None if c is None or pd.isna(v) else float(v)
        except Exception:
            return None

    out = []
    for idx, row in df[dates <= end].iterrows():
        out.append({"date": str(dates.loc[idx]), "open": val(row, oc),
                    "high": val(row, hc), "low": val(row, lc),
                    "close": val(row, cc), "vol": val(row, vc)})
    return out


def range_pos20(setup_bars: list):
    """(close - lo20)/(hi20 - lo20) on last 20 setup bars; None if unusable."""
    if len(setup_bars) < 20:
        return None
    win = setup_bars[-20:]
    try:
        hi = max(b["high"] for b in win if b["high"] is not None)
        lo = min(b["low"] for b in win if b["low"] is not None)
        cl = win[-1]["close"]
        if hi is None or lo is None or cl is None or hi <= lo:
            return None
        return (cl - lo) / (hi - lo)
    except Exception:
        return None


def acc_green(gauges: dict) -> bool:
    return (gauges.get("obv_slope") or 0) > 0 and (
        (gauges.get("updown") or 0) >= 1.5 or (gauges.get("vol_ratio") or 0) >= 1.2)


def sim_long(entry, sl, tgt, exit_bars: list, qty: int, entry_day: str) -> dict:
    """Walk exit_bars (starting at entry bar); same-bar SL+tgt -> SL."""
    exit_px, why = None, None
    for b in exit_bars:
        hit_sl = b["low"] is not None and b["low"] <= sl
        hit_tg = b["high"] is not None and b["high"] >= tgt
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
        exit_px, why = exit_bars[-1]["close"], "TIME-Friday"
    gross = (exit_px - entry) * qty
    costs = calculate_trading_costs(entry, exit_px, qty, side="LONG")["total_costs"]
    e_s, x_s = entry * (1 + SLIP), exit_px * (1 - SLIP)
    gross_s = (x_s - e_s) * qty
    costs_s = calculate_trading_costs(e_s, x_s, qty, side="LONG")["total_costs"]
    return {"entry": round(entry, 2), "exit": round(exit_px, 2), "qty": qty,
            "sl": round(sl, 2), "tgt": round(tgt, 2), "why": why,
            "gross": round(gross, 2), "costs": costs,
            "net": round(gross - costs, 2), "gross_slip": round(gross_s, 2),
            "costs_slip": costs_s, "net_slip": round(gross_s - costs_s, 2),
            "entry_day": entry_day}


def sim_short(entry, sl, tgt, exit_bars: list, qty: int, entry_day: str) -> dict:
    exit_px, why = None, None
    for b in exit_bars:
        hit_sl = b["high"] is not None and b["high"] >= sl
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
        exit_px, why = exit_bars[-1]["close"], "TIME-Friday"
    gross = (entry - exit_px) * qty
    costs = calculate_trading_costs(entry, exit_px, qty, side="SHORT")["total_costs"]
    e_s, x_s = entry * (1 - SLIP), exit_px * (1 + SLIP)
    gross_s = (e_s - x_s) * qty
    costs_s = calculate_trading_costs(e_s, x_s, qty, side="SHORT")["total_costs"]
    return {"entry": round(entry, 2), "exit": round(exit_px, 2), "qty": qty,
            "sl": round(sl, 2), "tgt": round(tgt, 2), "why": why,
            "gross": round(gross, 2), "costs": costs,
            "net": round(gross - costs, 2), "gross_slip": round(gross_s, 2),
            "costs_slip": costs_s, "net_slip": round(gross_s - costs_s, 2),
            "entry_day": entry_day}


def metrics(trades: list) -> dict:
    n = len(trades)
    if n == 0:
        return {"trades": 0, "wins": 0, "win_pct": None, "gross": 0.0,
                "costs": 0.0, "net": 0.0, "net_slip": 0.0, "expectancy": None,
                "pf": None, "pf_slip": None, "maxDD": 0.0, "maxDD_slip": 0.0}
    nets = [t["net"] for t in trades]
    wins = sum(1 for t in trades if t["net"] > 0)
    gp = sum(t for t in nets if t > 0)
    gl = -sum(t for t in nets if t < 0)
    nets_s = [t["net_slip"] for t in trades]
    gp_s = sum(t for t in nets_s if t > 0)
    gl_s = -sum(t for t in nets_s if t < 0)

    def mdd(eq):
        peak, dd = 0.0, 0.0
        run = 0.0
        for v in eq:
            run += v
            peak = max(peak, run)
            dd = min(dd, run - peak)
        return round(dd, 2)

    return {"trades": n, "wins": wins, "win_pct": round(100 * wins / n, 1),
            "gross": round(sum(t["gross"] for t in trades), 2),
            "costs": round(sum(t["costs"] for t in trades), 2),
            "net": round(sum(nets), 2), "net_slip": round(sum(nets_s), 2),
            "expectancy": round(sum(nets) / n, 2),
            "expectancy_slip": round(sum(nets_s) / n, 2),
            "pf": round(gp / gl, 2) if gl > 0 else None,
            "pf_slip": round(gp_s / gl_s, 2) if gl_s > 0 else None,
            "maxDD": mdd(nets), "maxDD_slip": mdd(nets_s)}


def load_qip_set(rows: list) -> set:
    """{(SYM, week)} with 'qip' in a catalyst-session headline. RO Query."""
    wanted = set()
    for r in rows:
        if "catalyst" not in r:
            continue
        for s in r["catalyst"]["sessions"]:
            wanted.add((r["symbol"], s))
    uri = f"file:{os.path.abspath(DB_PATH)}?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    try:
        q = ("SELECT UPPER(COALESCE(NULLIF(m.trading_symbol,''), m.symbol_code)), "
             "substr(a.published_at,1,10), a.headline "
             "FROM news_symbol_mentions m JOIN news_articles a "
             "ON a.id = m.article_id "
             "WHERE a.published_at >= '2026-07-20' "
             "AND a.published_at < '2026-10-10'")
        hits = set()
        for sym, d, hl in con.execute(q):
            if (sym, d) in wanted and hl and "qip" in hl.lower():
                hits.add((sym, d))
    finally:
        con.close()
    out = set()
    for r in rows:
        if "catalyst" not in r:
            continue
        if any((r["symbol"], s) in hits for s in r["catalyst"]["sessions"]):
            out.add((r["symbol"], r["week"]))
    return out, hits


def fetch_earnings(symbols: list):
    """yfinance earnings_dates per symbol -> cache {sym: [YYYY-MM-DD,...]}."""
    import yfinance as yf
    cache = {}
    if os.path.exists(EARN_CACHE):
        try:
            cache = json.load(open(EARN_CACHE))
        except Exception:
            cache = {}
    missing = [s for s in symbols if s not in cache]
    print(f"earn cache: {len(cache)} cached, {len(missing)} to fetch")
    fails = 0
    for i, s in enumerate(missing):
        try:
            ed = yf.Ticker(s + ".NS").earnings_dates
            if ed is not None and len(ed):
                cache[s] = sorted({d.date().isoformat() for d in ed.index
                                   if d.date().isoformat() >= "2026-07-01"})
            else:
                cache[s] = []
        except Exception as e:
            fails += 1
            cache[s] = []
            print(f"  {s}: {type(e).__name__} {str(e)[:100]}")
            time.sleep(5)
        if (i + 1) % 25 == 0:
            json.dump(cache, open(EARN_CACHE, "w"))
            print(f"  {i + 1}/{len(missing)} done, fails={fails}")
        time.sleep(1.2)
    json.dump(cache, open(EARN_CACHE, "w"))
    print(f"fetch done: fails/empty-marked={fails}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", choices=["fetch", "run"], default="run")
    args = ap.parse_args()

    ds = json.load(open(DS_JSON))
    weeks = {w["n"]: w for w in ds["meta"]["weeks"]}
    rows = [r for r in ds["rows"] if "screen" in r]

    if args.phase == "fetch":
        syms = sorted({r["symbol"] for r in rows
                       if acc_green(r["screen"]["gauges"])})
        fetch_earnings(syms)
        return

    qip_weeks, qip_hits = load_qip_set(rows)
    print(f"QIP headline (sym,session) hits: {len(qip_hits)}; "
          f"(sym,week) with QIP: {len(qip_weeks)}")

    earn = {}
    if os.path.exists(EARN_CACHE):
        earn = json.load(open(EARN_CACHE))
    print(f"earnings cache symbols: {len(earn)}")

    by_variant = {"V1": [], "V2": [], "V3": [], "V4_long": [], "V4_short_note": []}
    skips = {"no-frame": 0, "no-setup-bar": 0, "no-range20": 0, "no-entry-open": 0,
             "no-risk": 0, "no-week-bars": 0, "v3-no-earn-data": 0, "v4-short-week": 0}
    v3_elig_detail = []

    for r in rows:
        sym, wk = r["symbol"], r["week"]
        week = weeks[wk]
        df, _ = load_frame(sym)
        if df is None:
            skips["no-frame"] += 1
            continue
        setup_end = r.get("setup_session") or week["setup_session"]
        setup_bars = bars_upto(df, setup_end)
        if not setup_bars or setup_bars[-1]["date"] != setup_end:
            # tolerate: last bar must be the setup session for SL/range validity
            if not setup_bars or setup_bars[-1]["date"] > setup_end:
                skips["no-setup-bar"] += 1
                continue
        setup = setup_bars[-1]
        if setup["close"] is None or setup["low"] is None:
            skips["no-setup-bar"] += 1
            continue
        dates = ist_dates(df)
        wbars = []
        for d in week["outcome"]:
            sub = df[dates == d]
            if len(sub) == 0:
                continue
            row = sub.iloc[-1]
            try:
                wbars.append({"date": d, "open": float(row["open"]),
                              "high": float(row["high"]), "low": float(row["low"]),
                              "close": float(row["close"])})
            except Exception:
                continue
        if not wbars:
            skips["no-week-bars"] += 1
            continue
        g = r["screen"]["gauges"]
        acc = acc_green(g)
        evt = r["catalyst"]["catalyst_score"] >= 2
        rp = range_pos20(setup_bars)
        if rp is None:
            skips["no-range20"] += 1
            continue

        # ---- V1: event + top-30% of 20d range ----
        if evt and rp >= 0.70:
            entry = wbars[0]["open"]
            sl = setup["low"]
            if entry is None or entry <= 0:
                skips["no-entry-open"] += 1
            elif entry - sl <= 0:
                skips["no-risk"] += 1
            else:
                risk = entry - sl
                qty = int(NOTIONAL // entry)
                if qty > 0:
                    t = sim_long(entry, sl, entry + 3 * risk, wbars, qty,
                                 wbars[0]["date"])
                    t.update({"symbol": sym, "week": wk, "range_pos": round(rp, 3)})
                    by_variant["V1"].append(t)
                    # ---- V2: V1 + accumulation ----
                    if acc:
                        t2 = dict(t)
                        t2["variant"] = "V2"
                        by_variant["V2"].append(t2)
                else:
                    skips["no-risk"] += 1

        # ---- V3: acc-green + results within 7d after setup ----
        if acc:
            edates = earn.get(sym, None)
            if edates is None:
                skips["v3-no-earn-data"] += 1
            else:
                s0 = date.fromisoformat(setup_end)
                upcoming = [d for d in edates
                            if 0 < (date.fromisoformat(d) - s0).days <= 7]
                if upcoming:
                    R = min(upcoming)
                    entry = setup["close"]
                    qty = int(NOTIONAL // entry)
                    # exit: day-after-results close if in week else Friday close
                    exit_day = (date.fromisoformat(R) + timedelta(days=1)).isoformat()
                    in_week = [b for b in wbars if b["date"] <= exit_day]
                    if in_week and exit_day in [b["date"] for b in wbars]:
                        exit_px, why = in_week[-1]["close"], "DAY-AFTER-RESULTS"
                    else:
                        exit_px, why = wbars[-1]["close"], "TIME-Friday"
                    gross = (exit_px - entry) * qty
                    costs = calculate_trading_costs(entry, exit_px, qty)["total_costs"]
                    e_s, x_s = entry * (1 + SLIP), exit_px * (1 - SLIP)
                    gross_s = (x_s - e_s) * qty
                    costs_s = calculate_trading_costs(e_s, x_s, qty)["total_costs"]
                    by_variant["V3"].append({
                        "symbol": sym, "week": wk, "results": R,
                        "entry": round(entry, 2), "exit": round(exit_px, 2),
                        "qty": qty, "sl": None, "tgt": None, "why": why,
                        "gross": round(gross, 2), "costs": costs,
                        "net": round(gross - costs, 2),
                        "gross_slip": round(gross_s, 2), "costs_slip": costs_s,
                        "net_slip": round(gross_s - costs_s, 2),
                        "entry_day": setup_end})
                    v3_elig_detail.append({"symbol": sym, "week": wk, "results": R})

        # ---- V4: QIP in trailing sessions ----
        if (sym, wk) in qip_weeks and len(wbars) >= 1:
            d1 = wbars[0]
            if d1["open"] and d1["close"]:
                if d1["close"] > d1["open"]:
                    if len(wbars) >= 2 and wbars[1]["open"]:
                        entry, sl = wbars[1]["open"], d1["low"]
                        if entry and sl and entry - sl > 0:
                            risk = entry - sl
                            qty = int(NOTIONAL // entry)
                            if qty > 0:
                                t = sim_long(entry, sl, entry + 3 * risk,
                                             wbars[1:], qty, wbars[1]["date"])
                                t.update({"symbol": sym, "week": wk})
                                by_variant["V4_long"].append(t)
                else:
                    # red day+1: skip long, track hypothetical short (note)
                    if len(wbars) >= 2 and wbars[1]["open"]:
                        entry, sl = wbars[1]["open"], d1["high"]
                        if entry and sl and sl - entry > 0:
                            risk = sl - entry
                            qty = int(NOTIONAL // entry)
                            if qty > 0:
                                t = sim_short(entry, sl, entry - 3 * risk,
                                              wbars[1:], qty, wbars[1]["date"])
                                t.update({"symbol": sym, "week": wk})
                                by_variant["V4_short_note"].append(t)
                    else:
                        skips["v4-short-week"] += 1

    out = {"meta": {
        "rules": "fixed by mission; no fitting",
        "notional": NOTIONAL, "slip_bps": 5, "costs": "calculate_trading_costs every trade",
        "same_bar": "SL wins ties (conservative)", "qty": "floor(1L/entry)",
        "qip_weeks": len(qip_weeks), "earn_cached_syms": len(earn),
        "skips": skips, "v3_eligible": v3_elig_detail},
        "variants": {}}
    for v, trades in by_variant.items():
        first = [t for t in trades if t["week"] <= 5]
        last = [t for t in trades if t["week"] >= 6]
        out["variants"][v] = {"pooled": metrics(trades),
                              "first5": metrics(first),
                              "last5": metrics(last),
                              "trades": sorted(trades, key=lambda t: (t["week"], t["symbol"]))}
    json.dump(out, open(os.path.join(HERE, "eventtech.json"), "w"), indent=1)

    for v in by_variant:
        m = out["variants"][v]
        print(f"\n== {v} == n={len(by_variant[v])}")
        for s in ("pooled", "first5", "last5"):
            print(f"  {s}: {json.dumps(m[s])}")
        for t in by_variant[v][:12]:
            print(f"    w{t['week']} {t['symbol']} in={t['entry']} "
                  f"out={t['exit']} {t['why']} net={t['net']} slip={t['net_slip']}")
    print(f"\nskips: {json.dumps(skips)}")


if __name__ == "__main__":
    main()
