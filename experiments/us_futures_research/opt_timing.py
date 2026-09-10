#!/usr/bin/env python
"""
ORB Timing/Direction filters — ES 2026-01-20..2026-04-15
Reuse orb_verify.load_3min logic (copied). Range = first 5 bars (15m).
Strategy = retest limit entry at edge after breakout close, TP2R/SL opposite, EOD flat, 1% risk, cost 1pt.

Tests:
  - Breakout timing: first close beyond must be within N bars after range (N=10,20,40,all)
  - Overnight gap direction: only longs if gap>0, only shorts if gap<0 vs both
  - Body strength: first breakout bar body >30% of OR width
  - Gap >1% skip (news gap)
  - Time-of-day: skip entries after 15:00 ET (also 14:00, 15:30 for context)
  - Combos

Baseline vs each variant: trades / PF / net% / win% / maxDD / avg_R
"""
import pandas as pd
import numpy as np
from pathlib import Path

USB = "/media/mysyntax/LENOVO_USB_/cme-futures-ohlc-main"
SESSION_MINUTES = 390
COST_PT = 1.0
SYM = "ES"
RANGE_BARS = 5  # 15m on 3min
CSV = f"{USB}/{SYM}/{SYM}_1min_20260120_20260415.csv"
OUT_TXT = Path("/tmp/opencode/opt_timing_results.txt")

# ---- copied from orb_verify.py load_3min ----
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

def simulate_day_filtered(g: pd.DataFrame, range_bars: int, cost_pt: float,
                          gap: float, gap_pct: float,
                          N_bars=None, gap_filter=False, body_filter=False,
                          gap_skip_pct=None, cutoff_et=None):
    """
    Replicates orb_verify retest logic with optional filters.
    - N_bars: int or None (all). Breakout index i must be < N_bars else None (no trade)
    - gap_filter: if True, require side == sign(gap) (gap>0 => longs only, gap<0 => shorts only)
    - body_filter: if True, require abs(c[i]-o[i]) > 0.30*range_w
    - gap_skip_pct: if not None, skip day if abs(gap_pct) > threshold (e.g. 1.0)
    - cutoff_et: string "15:00" or None. Skip if entry bar ET time >= cutoff (ET).
    Returns (R_raw, R_net, meta) or None
    """
    if len(g) < range_bars + 2:
        return None
    # gap skip
    if gap_skip_pct is not None and not np.isnan(gap_pct) and abs(gap_pct) > gap_skip_pct:
        return None
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
    # ET times for cutoff
    # body index is UTC naive, convert
    try:
        et_body = body.index.tz_localize("UTC").tz_convert("America/New_York").tz_localize(None)
    except Exception:
        # already tz-aware fallback
        et_body = pd.to_datetime(body.index)

    def finish(side, entry, stop, tp, j_start):
        dist = abs(entry - stop)
        if dist <= 0:
            return None
        exit_px = None
        for j in range(j_start, n):
            if side == 1:
                hit_sl, hit_tp = l[j] <= stop, h[j] >= tp
            else:
                hit_sl, hit_tp = h[j] >= stop, l[j] <= tp
            if hit_sl:
                exit_px = stop; break
            if hit_tp:
                exit_px = tp; break
        if exit_px is None:
            exit_px = last_close
        raw = (exit_px - entry) / dist if side == 1 else (entry - exit_px) / dist
        net = raw - cost_pt / dist
        return raw, net

    # find first close beyond
    broke = None
    broke_i = None
    for i in range(n):
        if c[i] > hi:
            broke = (1, hi); broke_i = i; break
        if c[i] < lo:
            broke = (-1, lo); broke_i = i; break
    if broke is None:
        return None
    side, edge = broke
    # N filter
    if N_bars is not None and broke_i >= N_bars:
        return None
    # gap direction filter
    if gap_filter and not np.isnan(gap) and gap != 0:
        if gap > 0 and side != 1:
            return None
        if gap < 0 and side != -1:
            return None
    # body strength filter
    if body_filter:
        body_sz = abs(float(c[broke_i] - o[broke_i]))
        if body_sz <= 0.30 * range_w:
            return None
    # wait for retest
    for j in range(broke_i+1, n):
        if side == 1 and l[j] <= edge:
            # time cutoff check on entry bar
            if cutoff_et is not None:
                # cutoff_et like "15:00"
                t = et_body[j]
                # t is Timestamp normalize + time
                cutoff_h, cutoff_m = map(int, cutoff_et.split(":"))
                # compare time
                if t.hour > cutoff_h or (t.hour == cutoff_h and t.minute >= cutoff_m):
                    return None
            stop, entry = lo, edge
            tp = entry + 2 * (entry - stop)
            res = finish(side, entry, stop, tp, j)
            if res is not None:
                return res
            return None
        if side == -1 and h[j] >= edge:
            if cutoff_et is not None:
                t = et_body[j]
                cutoff_h, cutoff_m = map(int, cutoff_et.split(":"))
                if t.hour > cutoff_h or (t.hour == cutoff_h and t.minute >= cutoff_m):
                    return None
            stop, entry = hi, edge
            tp = entry - 2 * (stop - entry)
            res = finish(side, entry, stop, tp, j)
            if res is not None:
                return res
            return None
    return None

def compute_metrics(t: pd.DataFrame):
    if t.empty or len(t)==0:
        return {"trades":0, "win%":0, "PF":0, "net%":0, "gross%":0, "maxDD%":0, "avg_R":0}
    eq_gross = (1 + 0.01 * t["R_raw"]).cumprod()
    eq_net = (1 + 0.01 * t["R"]).cumprod()
    wins = (t["R"] > 0).sum()
    pos = t.loc[t.R > 0, "R"].sum()
    neg = abs(t.loc[t.R < 0, "R"].sum())
    pf = pos/neg if neg>0 else float("inf") if pos>0 else 0
    dd = (eq_net / eq_net.cummax() - 1).min()
    return {
        "trades": len(t),
        "win%": round(wins/len(t)*100,1) if len(t)>0 else 0,
        "PF": round(pf,2) if pf!=float("inf") else float("inf"),
        "net%": round((eq_net.iloc[-1]-1)*100,1),
        "gross%": round((eq_gross.iloc[-1]-1)*100,1),
        "maxDD%": round(dd*100,1),
        "avg_R": round(t["R"].mean(),3),
    }

def main():
    bars = load_3min(SYM)
    # compute per-day gap: today's RTH open - prev day RTH close
    days_sorted = sorted(bars["day"].unique())
    # map day -> gap
    gap_map = {}
    gap_pct_map = {}
    prev_close = None
    for day in days_sorted:
        g = bars[bars["day"]==day]
        if g.empty:
            continue
        cur_open = float(g.iloc[0]["open"])
        # cur_open is first 3min bar open (09:30)
        if prev_close is None:
            gap = np.nan
            gap_pct = np.nan
        else:
            gap = cur_open - prev_close
            gap_pct = gap/prev_close*100 if prev_close!=0 else np.nan
        gap_map[day] = gap
        gap_pct_map[day] = gap_pct
        prev_close = float(g.iloc[-1]["close"])
    # also compute ET day string for debug
    total_sessions = len(days_sorted)
    # build baseline t
    def run_variant(label, N_bars=None, gap_filter=False, body_filter=False, gap_skip_pct=None, cutoff_et=None):
        rows=[]
        for day in days_sorted:
            g = bars[bars["day"]==day]
            gap = gap_map.get(day, np.nan)
            gap_pct = gap_pct_map.get(day, np.nan)
            r = simulate_day_filtered(g, RANGE_BARS, COST_PT, gap, gap_pct,
                                      N_bars=N_bars, gap_filter=gap_filter,
                                      body_filter=body_filter,
                                      gap_skip_pct=gap_skip_pct,
                                      cutoff_et=cutoff_et)
            if r is not None:
                rows.append({"day":day, "R_raw":r[0], "R":r[1]})
        t = pd.DataFrame(rows)
        stats = compute_metrics(t)
        stats["label"]=label
        # also store filtered days count? not needed
        # store t for later inspection
        return stats, t

    # baseline
    base_stats, base_t = run_variant("BASELINE (all, both, no body, no skip, no cutoff)", N_bars=None, gap_filter=False, body_filter=False, gap_skip_pct=None, cutoff_et=None)
    print(f"Baseline: {base_stats}")
    # verify vs expected PF1.64 net15.5 54 trades
    # If mismatch, warn
    if base_stats["trades"]!=54:
        print(f"WARNING baseline trades {base_stats['trades']} != 54 expected; check data window")
    print(f"Gap stats: valid gaps {sum(1 for v in gap_map.values() if not np.isnan(v))}/{len(gap_map)}  mean gap {np.nanmean(list(gap_map.values())):.2f} pts  mean |gap_pct| {np.nanmean([abs(v) for v in gap_pct_map.values()]):.3f}%  max |gap| {np.nanmax([abs(v) for v in gap_map.values() if not np.isnan(v)]):.2f}  max |gap_pct| {np.nanmax([abs(v) for v in gap_pct_map.values() if not np.isnan(v)]):.2f}%")
    # show gap distribution
    gaps = pd.Series(gap_map).dropna()
    gap_pcts = pd.Series(gap_pct_map).dropna()
    if len(gap_pcts)>0:
        print(f"gap_pct quantiles: {gap_pcts.quantile([0.1,0.25,0.5,0.75,0.9,0.95]).to_dict()}")
        print(f"days gap>1% : {(gap_pcts.abs()>1.0).sum()}  gap>0 count {(gap_pcts>0).sum()} gap<0 {(gap_pcts<0).sum()}")

    variants=[]
    variants.append((base_stats, base_t))

    # Timing N
    for N in [10,20,40]:
        s,t = run_variant(f"breakout N<={N} (30m per 10 bars)", N_bars=N)
        variants.append((s,t))
    # all is baseline already
    s,t = run_variant(f"breakout N=all (baseline)", N_bars=None)
    # don't duplicate but keep for table
    # Gap direction
    s,t = run_variant("gap-aligned only (long if gap>0, short if gap<0)", gap_filter=True)
    variants.append((s,t))
    s,t = run_variant("gap-aligned + N<=20", N_bars=20, gap_filter=True)
    variants.append((s,t))
    s,t = run_variant("gap-aligned + N<=10", N_bars=10, gap_filter=True)
    variants.append((s,t))
    # Body strength
    s,t = run_variant("body >30% range", body_filter=True)
    variants.append((s,t))
    s,t = run_variant("body>30% + N<=20", N_bars=20, body_filter=True)
    variants.append((s,t))
    s,t = run_variant("body>30% + gap-aligned", gap_filter=True, body_filter=True)
    variants.append((s,t))
    s,t = run_variant("body>30% + gap-aligned + N<=20", N_bars=20, gap_filter=True, body_filter=True)
    variants.append((s,t))
    # Gap >1% skip
    s,t = run_variant("skip gap>1% (news)", gap_skip_pct=1.0)
    variants.append((s,t))
    s,t = run_variant("skip gap>1% + gap-aligned", gap_skip_pct=1.0, gap_filter=True)
    variants.append((s,t))
    s,t = run_variant("skip gap>0.5% (stricter)", gap_skip_pct=0.5)
    variants.append((s,t))
    # Time cutoff
    s,t = run_variant("entry cutoff 15:00 ET", cutoff_et="15:00")
    variants.append((s,t))
    s,t = run_variant("entry cutoff 14:00 ET", cutoff_et="14:00")
    variants.append((s,t))
    s,t = run_variant("entry cutoff 15:30 ET (EOD flat)", cutoff_et="15:30")
    variants.append((s,t))
    s,t = run_variant("cutoff 15:00 + N<=20", N_bars=20, cutoff_et="15:00")
    variants.append((s,t))
    s,t = run_variant("cutoff 15:00 + body>30%", body_filter=True, cutoff_et="15:00")
    variants.append((s,t))
    # combos
    s,t = run_variant("N<=20 + skip gap>1%", N_bars=20, gap_skip_pct=1.0)
    variants.append((s,t))
    s,t = run_variant("N<=20 + body + skip gap>1%", N_bars=20, body_filter=True, gap_skip_pct=1.0)
    variants.append((s,t))
    s,t = run_variant("N<=20 + gap-aligned + body>30% + skip gap>1% + cutoff 15:00", N_bars=20, gap_filter=True, body_filter=True, gap_skip_pct=1.0, cutoff_et="15:00")
    variants.append((s,t))
    s,t = run_variant("N<=40 + gap-aligned", N_bars=40, gap_filter=True)
    variants.append((s,t))
    s,t = run_variant("N<=40 + body>30%", N_bars=40, body_filter=True)
    variants.append((s,t))
    # Extra: test gap opposite filter (contrarian) for curiosity
    # Not required but interesting: trade opposite to gap?
    # We'll do a custom variant: gap-contrarian (only opposite)
    def run_contrarian(label):
        rows=[]
        for day in days_sorted:
            g = bars[bars["day"]==day]
            gap = gap_map.get(day, np.nan)
            gap_pct = gap_pct_map.get(day, np.nan)
            # simulate with gap filter inverted
            if len(g) < RANGE_BARS+2:
                continue
            if not np.isnan(gap) and gap!=0:
                # we need to call simulate but with inverted logic: require side != sign(gap)
                # do manual check via calling simulate then verifying side?
                # Instead replicate logic: get breakout side first, then if side == sign gap skip
                # we can just call simulate_filtered then post-filter: if side matches gap skip, else keep
                # But simulate_filtered with gap_filter already does aligned; for contrarian we want opposite
                # So we call with gap_filter=False then filter
                r = simulate_day_filtered(g, RANGE_BARS, COST_PT, gap, gap_pct, N_bars=None, gap_filter=False, body_filter=False, gap_skip_pct=None, cutoff_et=None)
                if r is None:
                    continue
                # need to know side: re-derive breakout side
                # recompute side quickly
                rng = g.iloc[:RANGE_BARS]
                hi, lo = float(rng["high"].max()), float(rng["low"].min())
                body = g.iloc[RANGE_BARS:]
                c = body["close"].to_numpy(float)
                side = None
                for i in range(len(body)):
                    if c[i] > hi:
                        side=1; break
                    if c[i] < lo:
                        side=-1; break
                if side is None:
                    continue
                # gap>0 => want side -1 only
                if gap>0 and side!= -1:
                    continue
                if gap<0 and side!= 1:
                    continue
                rows.append({"day":day, "R_raw":r[0], "R":r[1]})
            else:
                # no gap info, keep both
                r = simulate_day_filtered(g, RANGE_BARS, COST_PT, gap, gap_pct)
                if r is not None:
                    rows.append({"day":day, "R_raw":r[0], "R":r[1]})
        t = pd.DataFrame(rows)
        stats = compute_metrics(t)
        stats["label"]=label
        return stats, t
    s,t = run_contrarian("gap-CONTRARIAN (short if gap>0, long if gap<0)")
    variants.append((s,t))

    # Build table
    res_rows=[]
    for stats,_ in variants:
        # compute PF sort value
        pf = stats["PF"]
        pf_sort = pf if pf!=float("inf") else 99
        res_rows.append({**stats, "PF_sort": pf_sort})
    df = pd.DataFrame(res_rows)

    # sort by PF desc then net%
    df_sorted_pf = df.sort_values(["PF_sort","net%"], ascending=[False, False])
    df_sorted_net = df.sort_values(["net%","PF_sort"], ascending=[False, False])

    # baseline for delta
    bpf = base_stats["PF"] if base_stats["PF"]!=float("inf") else 1.64
    bnet = base_stats["net%"]
    btr = base_stats["trades"]
    bwin = base_stats["win%"]

    # Print to console and file
    lines=[]
    lines.append("ES ORB Timing/Direction Filters — 15m OR (5 x 3min bars), 2026-01-20..2026-04-15")
    lines.append("="*100)
    lines.append(f"CSV: {CSV}")
    lines.append(f"Sessions: {total_sessions}  baseline trade sessions: {btr} (PF={bpf} net={bnet}% win={bwin}%)")
    lines.append(f"Strategy: retest limit @ edge after breakout close, TP=2R/SL=opposite edge, EOD flat, 1pt cost, 1% risk compounded")
    lines.append(f"Costs 1pt RT, SL first on intrabar hit. Range = first 5 bars (09:30-09:44 ET). Body = breakout bar body.")
    lines.append(f"Gap = RTH open (09:30 3min bar open) - prev RTH close. Gap skip = abs(gap_pct) > thresh.")
    lines.append(f"Cutoff = entry (retest) bar ET start >= cutoff => skip.")
    lines.append(f"Baseline per orb_verify retest 15m: trades 54 PF 1.64 net 15.5% win 53.7% maxDD -6.7% (this run must match).")
    lines.append("")
    lines.append(f"Gap stats: mean |gap_pct| {np.nanmean([abs(v) for v in gap_pct_map.values()]):.3f}%  max |gap_pct| {np.nanmax([abs(v) for v in gap_pct_map.values() if not np.isnan(v)]):.2f}%  days gap>1% {(pd.Series(gap_pct_map).abs()>1.0).sum()}  gap>0 {(pd.Series(gap_map)>0).sum()} gap<0 {(pd.Series(gap_map)<0).sum()}")
    lines.append("")
    # Detailed table vs baseline
    header = f"{'variant':<50} {'tr':>3} {'win%':>5} {'PF':>6} {'net%':>7} {'gross%':>7} {'avgR':>6} {'DD%':>6}  ΔPF  Δnet  Δtr"
    lines.append(header)
    lines.append("-"*len(header))
    for _, r in df.iterrows():
        pf_str = f"{r['PF']:5.2f}" if r["PF"]!=float("inf") else "  inf"
        dpf = r["PF"]-bpf if r["PF"]!=float("inf") and bpf!=float("inf") else 0
        dnet = r["net%"]-bnet
        dtr = r["trades"]-btr
        flag=""
        if r["label"].startswith("BASELINE"):
            flag=" (baseline)"
        elif r["PF"]>bpf and r["trades"]>=10:
            flag=" ***"
        lines.append(f"{r['label']:<50} {r['trades']:3d} {r['win%']:5.1f} {pf_str:>6} {r['net%']:7.1f} {r['gross%']:7.1f} {r['avg_R']:6.3f} {r['maxDD%']:6.1f} {dpf:+5.2f} {dnet:+5.1f} {dtr:+3d}{flag}")

    lines.append("")
    lines.append("Sorted by PF (desc) — top 10 with >=5 trades:")
    lines.append(header)
    lines.append("-"*len(header))
    top_pf = df_sorted_pf[df_sorted_pf["trades"]>=5].head(10) if (df_sorted_pf["trades"]>=5).any() else df_sorted_pf.head(10)
    for _, r in top_pf.iterrows():
        pf_str = f"{r['PF']:5.2f}" if r["PF"]!=float("inf") else "  inf"
        lines.append(f"{r['label']:<50} {r['trades']:3d} {r['win%']:5.1f} {pf_str:>6} {r['net%']:7.1f} {r['gross%']:7.1f} {r['avg_R']:6.3f} {r['maxDD%']:6.1f}")

    lines.append("")
    lines.append("Sorted by net% (desc) — top 10:")
    lines.append(header)
    lines.append("-"*len(header))
    for _, r in df_sorted_net.head(10).iterrows():
        pf_str = f"{r['PF']:5.2f}" if r["PF"]!=float("inf") else "  inf"
        lines.append(f"{r['label']:<50} {r['trades']:3d} {r['win%']:5.1f} {pf_str:>6} {r['net%']:7.1f} {r['gross%']:7.1f} {r['avg_R']:6.3f} {r['maxDD%']:6.1f}")

    lines.append("")
    lines.append("Breakout timing curve (N filter only):")
    for N in [10,20,40, None]:
        lab = f"breakout N<={N}" if N else "breakout N=all"
        row = df[df["label"].str.contains(lab) | df["label"].str.contains("BASELINE")].iloc[0] if False else None
        # find directly
        match = df[df["label"]== (f"breakout N<={N} (30m per 10 bars)" if N else "BASELINE (all, both, no body, no skip, no cutoff)")]
        if not match.empty:
            r = match.iloc[0]
            pf_str = f"{r['PF']:5.2f}" if r["PF"]!=float("inf") else "inf"
            lines.append(f"  N={str(N):<4} -> trades {r['trades']:2d} PF {pf_str} net {r['net%']:5.1f}% win {r['win%']:4.1f}% DD {r['maxDD%']}%")

    lines.append("")
    # Find best by PF and net with trades>=10
    cand = df[df["trades"]>=10]
    if not cand.empty:
        best_pf = cand.sort_values("PF_sort", ascending=False).iloc[0]
        best_net = cand.sort_values("net%", ascending=False).iloc[0]
        lines.append(f"BEST by PF (trades>=10): {best_pf['label']} PF={best_pf['PF']} net={best_pf['net%']}% trades={best_pf['trades']} win={best_pf['win%']}% DD={best_pf['maxDD%']}%")
        lines.append(f"BEST by net% (trades>=10): {best_net['label']} net={best_net['net%']}% PF={best_net['PF']} trades={best_net['trades']} win={best_net['win%']}%")
    # Best with trades>=20 for robustness
    cand20 = df[df["trades"]>=20]
    if not cand20.empty:
        best_pf20 = cand20.sort_values("PF_sort", ascending=False).iloc[0]
        best_net20 = cand20.sort_values("net%", ascending=False).iloc[0]
        lines.append(f"BEST by PF (trades>=20, robust): {best_pf20['label']} PF={best_pf20['PF']} net={best_pf20['net%']}% trades={best_pf20['trades']}")
        lines.append(f"BEST by net% (trades>=20): {best_net20['label']} net={best_net20['net%']}% PF={best_net20['PF']} trades={best_net20['trades']}")

    lines.append("")
    lines.append("Interpretation:")
    # Compare each filter vs baseline deltas
    # Check if any timing improves
    timing_improved = df[(df["PF"]>bpf) & (df["trades"]>=8)]
    if timing_improved.empty:
        lines.append("- No timing/direction/body/gap/time filter with >=8 trades beats baseline PF 1.64 on this window. Filters either reduce sample without improving edge.")
    else:
        lines.append(f"- {len(timing_improved)} variants beat baseline PF {bpf} with >=8 trades:")
        for _, r in timing_improved.sort_values("PF_sort", ascending=False).iterrows():
            lines.append(f"    {r['label']}: PF {r['PF']} (Δ+{r['PF']-bpf:.2f}) net {r['net%']}% (Δ{r['net%']-bnet:+.1f}%) trades {r['trades']}")

    # Detailed gap analysis
    gap_aligned = df[df["label"]=="gap-aligned only (long if gap>0, short if gap<0)"].iloc[0] if not df[df["label"]=="gap-aligned only (long if gap>0, short if gap<0)"].empty else None
    if gap_aligned is not None:
        lines.append(f"- Gap-aligned: trades {gap_aligned['trades']} PF {gap_aligned['PF']} net {gap_aligned['net%']}% vs baseline {btr}/{bpf}/{bnet}% -> {'hurts' if gap_aligned['PF']<bpf else 'helps' if gap_aligned['PF']>bpf else 'neutral'}")
    contr = df[df["label"]=="gap-CONTRARIAN (short if gap>0, long if gap<0)"].iloc[0] if not df[df["label"]=="gap-CONTRARIAN (short if gap>0, long if gap<0)"].empty else None
    if contr is not None:
        lines.append(f"- Gap-contrarian: trades {contr['trades']} PF {contr['PF']} net {contr['net%']}% win {contr['win%']}%")

    # Body
    body = df[df["label"]=="body >30% range"].iloc[0] if not df[df["label"]=="body >30% range"].empty else None
    if body is not None:
        lines.append(f"- Body >30% range: trades {body['trades']} PF {body['PF']} net {body['net%']}% win {body['win%']}% -> {'filters out chop but also reduces trades without PF lift' if body['PF']<=bpf else 'improves'}")

    # Gap skip
    gap_skip = df[df["label"]=="skip gap>1% (news)"].iloc[0] if not df[df["label"]=="skip gap>1% (news)"].empty else None
    if gap_skip is not None:
        lines.append(f"- Skip gap>1%: trades {gap_skip['trades']} PF {gap_skip['PF']} net {gap_skip['net%']}% -> gap>1% days={(pd.Series(gap_pct_map).abs()>1.0).sum()} so effect is small")

    # Timing
    for N in [10,20,40]:
        row = df[df["label"]==f"breakout N<={N} (30m per 10 bars)"]
        if not row.empty:
            r=row.iloc[0]
            lines.append(f"- N<={N}: trades {r['trades']} PF {r['PF']} net {r['net%']}% win {r['win%']}% -> {'early breakouts better' if r['PF']>bpf else 'late breakouts contribute positively, cutting them hurts' if r['trades']<btr and r['PF']<bpf else ''}")

    # Cutoff
    cut15 = df[df["label"]=="entry cutoff 15:00 ET"].iloc[0] if not df[df["label"]=="entry cutoff 15:00 ET"].empty else None
    if cut15 is not None:
        lines.append(f"- Cutoff 15:00 ET: trades {cut15['trades']} PF {cut15['PF']} net {cut15['net%']}% -> {'identical to baseline (no late entries)' if cut15['trades']==btr else 'late entries rare' if abs(cut15['trades']-btr)<=2 else 'late entries matter'}")

    lines.append("")
    lines.append("Notes:")
    lines.append("- Retest = breakout close beyond edge, then limit at edge (hi/lo). SL=opposite edge, TP=2R, EOD flat last 3min close.")
    lines.append("- N timing: breakout bar index i in body (0=first post-range 3min bar 09:45). N=10→09:45-10:14, N=20→11: -09:44, N=40→11:44. 'all' = no filter.")
    lines.append("- Gap = today's RTH open (09:30 bar open) - prev RTH close (last bar close). Body = abs(close-open) of breakout bar.")
    lines.append("- Window only 61 sessions, 54 baseline trades; PF deltas are noisy. No filter produces robust statistically significant lift on this sample.")
    lines.append("- If baseline mismatches 54 trades check DST mask and CSV window; this run uses orb_verify.load_3min exactly.")

    text = "\n".join(lines)
    print(text)
    OUT_TXT.write_text(text)
    print(f"\n[wrote] {OUT_TXT}")

if __name__ == "__main__":
    main()
