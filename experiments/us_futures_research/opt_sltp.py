#!/usr/bin/env python
"""
Optimize ORB SL/TP on ES futures WITHOUT modifying existing scripts.
Copies orb_verify.load_3min and simulate logic. Range=15m (5 bars 3min).
Base: SL=opposite edge (1.0x range), TP=2R, retest entry.
Grid:
  SL: 0.7x, 1.0x, 1.3x, tight (= swing low/high of breakout bar)
  TP: 1.0R,1.5R,2.0R,2.5R,3.0R
  Mode: retest (breakout close -> limit at edge) vs run (4 consec closes -> market)
Fixed TP only, no trail.

Ref baseline PF 1.64 (ES 15m retest 1.0x /2R) from orb_verify.py
"""
import pandas as pd
import numpy as np
from pathlib import Path

USB = "/media/mysyntax/LENOVO_USB_/cme-futures-ohlc-main"
SESSION_MINUTES = 390
COSTS_PT = {"ES": 1.0}

def load_3min(sym: str) -> pd.DataFrame:
    m = pd.read_csv(f"{USB}/{sym}/{sym}_1min_20260120_20260415.csv", parse_dates=["datetime"])
    m = m.set_index("datetime").sort_index()
    b = m.resample("3min", label="left", closed="left").agg(
        open=("open", "first"), high=("high", "max"), low=("low", "min"),
        close=("close", "last"), volume=("volume", "sum")).dropna(subset=["close"])
    et = b.index.tz_localize("UTC").tz_convert("America/New_York").tz_localize(None)
    rth_open_et = et.normalize() + pd.Timedelta(hours=9, minutes=30)
    off = (et - rth_open_et).total_seconds() / 60
    mask = (off >= 0) & (off < SESSION_MINUTES)
    b = b[mask]
    b["day"] = et[mask].normalize()
    return b

def simulate_day(g: pd.DataFrame, range_bars: int, mode: str, sl_mult: float, tp_r: float, is_tight: bool, cost_pt: float):
    """Return (R_raw, R_net) or None. mode='retest'|'run'"""
    if len(g) < range_bars + 2:
        return None
    if mode == "run" and len(g) < range_bars + 4 + 1:
        # need at least 4 consec after range
        pass
    rng = g.iloc[:range_bars]
    hi, lo = float(rng["high"].max()), float(rng["low"].min())
    range_w = hi - lo
    if range_w <= 0:
        return None
    body = g.iloc[range_bars:]
    o = body["open"].to_numpy(float); h = body["high"].to_numpy(float)
    l = body["low"].to_numpy(float); c = body["close"].to_numpy(float)
    n = len(body)
    if n == 0:
        return None
    last_close = c[-1]

    def finish(side, entry, stop, tp, j_start):
        dist = abs(entry - stop)
        if dist <= 1e-9:
            return None
        exit_px = None
        for j in range(j_start, n):
            if side == 1:
                hit_sl, hit_tp = l[j] <= stop, h[j] >= tp
            else:
                hit_sl, hit_tp = h[j] >= stop, l[j] <= tp
            if hit_sl:
                exit_px = stop
                break
            if hit_tp:
                exit_px = tp
                break
        if exit_px is None:
            exit_px = last_close
        raw = (exit_px - entry) / dist if side == 1 else (entry - exit_px) / dist
        net = raw - cost_pt / dist
        return (raw, net)

    # ---- run: 4 consecutive closes beyond range, market at open of 4th
    if mode == "run":
        consec = 4
        # quick check length
        if n < consec:
            return None
        # For vectorized check but also need to handle entry logic per i
        above = (c > hi).astype(int)
        below = (c < lo).astype(int)
        for i in range(consec - 1, n):
            # check window
            if above[i - consec + 1:i+1].sum() == consec:
                side = 1
                entry = float(o[i])
                if is_tight:
                    # tight = low of 4th bar (swing low of breakout bar)
                    # Alternative: min low of 4-bar cluster. We use bar i low for single-bar tight.
                    stop = float(l[i])
                    # if stop is too tight (above entry or dist<0.25*range_w) still trade but very small dist
                    # if stop >= entry, invalid -> skip
                    if stop >= entry:
                        # use low of cluster as fallback if single bar gives zero dist (rare)
                        stop = float(np.min(l[i-consec+1:i+1]))
                        if stop >= entry:
                            continue
                else:
                    if sl_mult == 1.0:
                        stop = lo  # exact opposite edge to preserve baseline identity
                    else:
                        stop = entry - sl_mult * range_w
                # ensure stop < entry else skip
                if stop >= entry:
                    continue
                dist = entry - stop
                tp = entry + tp_r * dist
                res = finish(side, entry, stop, tp, i)
                if res is not None:
                    return res
                else:
                    return None  # dist invalid
            elif below[i - consec + 1:i+1].sum() == consec:
                side = -1
                entry = float(o[i])
                if is_tight:
                    stop = float(h[i])
                    if stop <= entry:
                        stop = float(np.max(h[i-consec+1:i+1]))
                        if stop <= entry:
                            continue
                else:
                    if sl_mult == 1.0:
                        stop = hi
                    else:
                        stop = entry + sl_mult * range_w
                if stop <= entry:
                    continue
                dist = stop - entry
                tp = entry - tp_r * dist
                res = finish(side, entry, stop, tp, i)
                if res is not None:
                    return res
                return None
        return None

    # ---- retest: first close beyond, then limit at edge
    broke_i = None
    side = None
    edge = None
    for i in range(n):
        if c[i] > hi:
            broke_i = i; side = 1; edge = hi; break
        if c[i] < lo:
            broke_i = i; side = -1; edge = lo; break
    if broke_i is None:
        return None
    # breakout bar swing
    breakout_low = float(l[broke_i])
    breakout_high = float(h[broke_i])

    # search for retest touch after breakout
    for j in range(broke_i+1, n):
        if side == 1 and l[j] <= edge:
            entry = edge
            if is_tight:
                stop = breakout_low
                if stop >= entry:
                    # fallback to lo if breakout low not below edge (doji)
                    # treat as no tight edge, skip to next retest bar?
                    continue
            else:
                if sl_mult == 1.0:
                    stop = lo
                else:
                    stop = entry - sl_mult * range_w
            if stop >= entry:
                continue
            dist = entry - stop
            tp = entry + tp_r * dist
            return finish(side, entry, stop, tp, j)
        if side == -1 and h[j] >= edge:
            entry = edge
            if is_tight:
                stop = breakout_high
                if stop <= entry:
                    continue
            else:
                if sl_mult == 1.0:
                    stop = hi
                else:
                    stop = entry + sl_mult * range_w
            if stop <= entry:
                continue
            dist = stop - entry
            tp = entry - tp_r * dist
            return finish(side, entry, stop, tp, j)
    return None


def run_backtest_grid(sym="ES", range_min=15):
    bars = load_3min(sym)
    rb = range_min // 3  # 15//3=5
    cost_pt = COSTS_PT[sym]
    # grid
    sl_configs = [
        ("0.7x", 0.7, False),
        ("1.0x", 1.0, False),
        ("1.3x", 1.3, False),
        ("tight", None, True),
    ]
    tp_rs = [1.0, 1.5, 2.0, 2.5, 3.0]
    modes = ["retest", "run"]
    rows = []
    baseline = None
    for mode in modes:
        for sl_label, sl_mult, is_tight in sl_configs:
            for tp_r in tp_rs:
                trades = []
                for day, g in bars.groupby("day"):
                    r = simulate_day(g, rb, mode, sl_mult, tp_r, is_tight, cost_pt)
                    if r is not None:
                        trades.append({"day": day, "R_raw": r[0], "R": r[1]})
                t = pd.DataFrame(trades)
                if t.empty:
                    res = dict(mode=mode, sl=sl_label, tp=f"{tp_r}R", trades=0, win=0, avg_R=0, PF=0, net=0, gross=0, maxDD=0)
                else:
                    eq_gross = (1 + 0.01*t["R_raw"]).cumprod()
                    eq_net = (1 + 0.01*t["R"]).cumprod()
                    wins = (t["R"]>0).sum()
                    win_pct = wins/len(t)*100
                    avg_R = t["R"].mean()
                    # PF
                    pos = t.loc[t.R>0,"R"].sum()
                    neg = abs(t.loc[t.R<0,"R"].sum())
                    pf = pos/neg if neg>0 else float("inf")
                    if pf==float("inf"):
                        pf_disp = 999.0
                    else:
                        pf_disp = pf
                    net_pct = (eq_net.iloc[-1]-1)*100
                    gross_pct = (eq_gross.iloc[-1]-1)*100
                    dd = (eq_net/eq_net.cummax()-1).min()*100
                    res = dict(mode=mode, sl=sl_label, tp=f"{tp_r}R", trades=len(t), win=round(win_pct,1), avg_R=round(avg_R,3), PF=round(pf_disp,2) if pf_disp!=999 else 999, net=round(net_pct,1), gross=round(gross_pct,1), maxDD=round(dd,1))
                    # store raw for sorting
                    res["_pf_raw"] = pf if pf!=float("inf") else 999
                    res["_net_raw"] = net_pct
                # check baseline
                if mode=="retest" and sl_label=="1.0x" and tp_r==2.0:
                    baseline = res
                rows.append(res)
    df = pd.DataFrame(rows)
    return df, baseline

def format_results(df, baseline):
    out_lines = []
    out_lines.append("ES ORB SL/TP Optimization — 15m Opening Range (5 x 3min bars), 2026-01-20..2026-04-15")
    out_lines.append("Costs: 1.0 pt RT (~$50), 1% per trade compounded, EOD flat, SL first on intrabar hit")
    out_lines.append("Modes: retest = breakout close -> limit at edge; run = 4 consec closes -> market at 4th open")
    out_lines.append("SL: 0.7x=0.7*range below/above entry, 1.0x=opposite edge, 1.3x=1.3*range, tight=swing low/high of breakout bar")
    out_lines.append("")
    if baseline is not None:
        out_lines.append(f"BASELINE (retest 1.0x 2.0R): trades={baseline['trades']} PF={baseline['PF']} net={baseline['net']}% win={baseline['win']}% maxDD={baseline['maxDD']}% avg_R={baseline['avg_R']}")
        out_lines.append("Baseline PF 1.64 expected per orb_verify.py (small diff due to SL def: entry-1.0*range vs opposite edge ~identical for retest)")
        out_lines.append("")
    # table header
    cols = ["mode","sl","tp","trades","win","avg_R","PF","net","gross","maxDD"]
    header = f"{'mode':<7} {'SL':<6} {'TP':<5} {'tr':>3} {'win%':>5} {'avgR':>6} {'PF':>6} {'net%':>7} {'gross%':>7} {'DD%':>6}  vsBase"
    out_lines.append(header)
    out_lines.append("-"*len(header))
    # sort by PF desc then net
    df_sorted = df.sort_values(by=["_pf_raw","_net_raw"], ascending=[False, False])
    baseline_pf = baseline["PF"] if baseline and baseline["PF"] not in (0,999) else 1.64
    baseline_raw = baseline["_pf_raw"] if baseline is not None and "_pf_raw" in baseline else baseline_pf
    for _, r in df_sorted.iterrows():
        vs = ""
        if r["_pf_raw"] > baseline_raw + 1e-9 and r["trades"]>=10:
            vs = " *** IMPROVES ***"
        elif abs(r["_pf_raw"]-baseline_raw) < 1e-6:
            vs = " (baseline)"
        # mark tradeless
        pf_str = f"{r['PF']:5.2f}" if r["PF"]!=999 else "  inf"
        line = f"{r['mode']:<7} {r['sl']:<6} {r['tp']:<5} {r['trades']:3d} {r['win']:5.1f} {r['avg_R']:6.3f} {pf_str:>6} {r['net']:7.1f} {r['gross']:7.1f} {r['maxDD']:6.1f}{vs}"
        out_lines.append(line)
    out_lines.append("")
    # second sort by net%
    out_lines.append("Sorted by net% (desc):")
    out_lines.append(header)
    out_lines.append("-"*len(header))
    df_net = df.sort_values(by="_net_raw", ascending=False)
    for _, r in df_net.iterrows():
        pf_str = f"{r['PF']:5.2f}" if r["PF"]!=999 else "  inf"
        line = f"{r['mode']:<7} {r['sl']:<6} {r['tp']:<5} {r['trades']:3d} {r['win']:5.1f} {r['avg_R']:6.3f} {pf_str:>6} {r['net']:7.1f} {r['gross']:7.1f} {r['maxDD']:6.1f}"
        out_lines.append(line)
    out_lines.append("")
    # Analysis sections
    # best PF
    best_pf = df_sorted.iloc[0]
    best_net = df_net.iloc[0]
    out_lines.append(f"BEST by PF: {best_pf['mode']} SL={best_pf['sl']} TP={best_pf['tp']} PF={best_pf['PF']} net={best_pf['net']}% trades={best_pf['trades']} win={best_pf['win']}% maxDD={best_pf['maxDD']}%")
    out_lines.append(f"BEST by net%: {best_net['mode']} SL={best_net['sl']} TP={best_net['tp']} net={best_net['net']}% PF={best_net['PF']} trades={best_net['trades']}")
    out_lines.append("")
    # Improvement count - use raw PF to avoid rounding inclusion of baseline itself
    imp = df[df["_pf_raw"] > baseline_raw + 1e-9]
    out_lines.append(f"Combos beating baseline PF {baseline_pf} (raw {baseline_raw:.3f}): {len(imp)} / {len(df)}")
    if len(imp):
        out_lines.append("  (list sorted PF desc):")
        for _, r in imp.sort_values(by="_pf_raw", ascending=False).iterrows():
            out_lines.append(f"    {r['mode']} {r['sl']} {r['tp']} PF={r['PF']} net={r['net']}% trades={r['trades']}")
    out_lines.append("")
    # Retest vs Run comparison for tight SL
    out_lines.append("=== Tight SL analysis ===")
    tight = df[df["sl"]=="tight"].sort_values(["mode","tp"])
    for _, r in tight.iterrows():
        out_lines.append(f"  {r['mode']} tight {r['tp']} -> PF={r['PF']} net={r['net']}% win={r['win']}% trades={r['trades']} maxDD={r['maxDD']}%")
    out_lines.append("")
    # Does 4th-candle help with tighter SL?
    # Compare retest tight vs run tight averages
    retest_tight = tight[tight["mode"]=="retest"]
    run_tight = tight[tight["mode"]=="run"]
    out_lines.append("Does 4th-candle (run) help with tighter SL?")
    # Best tight retest vs best tight run
    if not retest_tight.empty and not run_tight.empty:
        best_rt = retest_tight.sort_values("_pf_raw", ascending=False).iloc[0]
        best_run = run_tight.sort_values("_pf_raw", ascending=False).iloc[0]
        out_lines.append(f"  Best retest tight: {best_rt['tp']} PF={best_rt['PF']} net={best_rt['net']}%")
        out_lines.append(f"  Best run    tight: {best_run['tp']} PF={best_run['PF']} net={best_run['net']}%")
        if best_run["_pf_raw"] > best_rt["_pf_raw"] and best_run["_pf_raw"] > baseline_pf:
            out_lines.append("  -> YES: run+tight best beats retest+tight best AND baseline — but check trades/DD.")
        elif best_rt["_pf_raw"] > best_run["_pf_raw"]:
            out_lines.append("  -> NO: retest+tight remains superior to run+tight; YouTuber's 4th-candle entry DOES NOT help tighter SL.")
        else:
            out_lines.append("  -> MIXED: similar, neither dominates.")
    out_lines.append("")
    # 0.7 vs 1.0 vs 1.3
    out_lines.append("=== SL multiplier impact (retest only, avg across TP) ===")
    for sl in ["0.7x","1.0x","1.3x","tight"]:
        sub = df[(df["mode"]=="retest") & (df["sl"]==sl)]
        avg_pf = sub["_pf_raw"].replace(999, np.nan).mean()
        avg_net = sub["_net_raw"].mean()
        out_lines.append(f"  retest {sl}: avg PF={avg_pf:.2f} avg net={avg_net:.1f}% (over 5 TPs)")
    out_lines.append("")
    out_lines.append("=== SL multiplier impact (run only) ===")
    for sl in ["0.7x","1.0x","1.3x","tight"]:
        sub = df[(df["mode"]=="run") & (df["sl"]==sl)]
        avg_pf = sub["_pf_raw"].replace(999, np.nan).mean()
        avg_net = sub["_net_raw"].mean()
        out_lines.append(f"  run {sl}: avg PF={avg_pf:.2f} avg net={avg_net:.1f}%")
    out_lines.append("")
    out_lines.append("Notes:")
    out_lines.append(" - Fixed TP only, intrabar SL-first, 15m OR = high=max(high[0:5]), low=min(low[0:5]) on 3-min bars, RTH 09:30 ET")
    out_lines.append(" - Tight SL = low/high of the breakout bar that first closed beyond range (retest) or low/high of 4th consec bar (run)")
    out_lines.append(" - 0.7x tightens, 1.3x widens — both change win% and R psych: tighter higher win% if chop but worse PF if wicks stop you")
    out_lines.append(" - Window only ~54 traded days with fills (out of ~74 sessions); not 12-month claim — treat PF comparisons as head-to-head on same window")
    return "\n".join(out_lines), best_pf, best_net

if __name__ == "__main__":
    df, baseline = run_backtest_grid(sym="ES", range_min=15)
    text, best_pf, best_net = format_results(df, baseline)
    print(text)
    out = Path("/tmp/opencode/opt_sltp_results.txt")
    out.write_text(text)
    print(f"\n[wrote] {out}")
