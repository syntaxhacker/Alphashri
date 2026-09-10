#!/usr/bin/env python
"""
ORB Opening-Range QUALITY filters — optimization for ES 2026-01-20..2026-04-15

Reuses orb_verify.load_3min + simulate logic (copied, not imported for self-containment)
but ADDS filters:

  width     = hi-lo of first 5 bars (15m)  [pts]
  efficiency= (hi-lo)/sum(bar ranges)      in (0,1]
  drift     = abs(close_last - open_first)/(hi-lo)
  width vs prev day: ratio_or = width / prev_or_width ; ratio_day = width / prev_day_range

Tests:
  width >= {10,15,18,22,28}  and width <= same
  eff   >= {0.40,0.45,0.53} and eff <= same (for reference)
  drift >= {0.30,0.50,0.70} and drift <= {0.50,0.70,0.85}
  ratio_or >= {0.5,0.8,1.0} and <= {0.8,1.0,1.2}
  ratio_day >= {0.05,0.10,0.15} and <= {0.10,0.15,0.20}
  COMBINED: width>=18 AND eff>=0.45  (+ variants)

Metrics per filter (identical to orb_verify.run_backtest):
  1% risk/trade compounded, SL=opposite side, TP=2R, EOD flat, costs 1pt (ES)
  trades, win%, PF, net%, gross%, maxDD%

Baseline without filter is reported; best 5 combos by PF then net% printed.

Usage: python /tmp/opencode/opt_width_eff.py
"""
import numpy as np
import pandas as pd
from pathlib import Path

USB = "/media/mysyntax/LENOVO_USB_/cme-futures-ohlc-main"
DST_SWITCH = pd.Timestamp("2026-03-08")
SESSION_MINUTES = 390
COST_PT = 1.0  # ES points RT
SYM = "ES"
RANGE_BARS = 5  # 15m on 3-min
CONSEC = 4
MODE = "retest"  # baseline orb_verify uses retest; user baseline PF 1.64 matches retest 15m
OUT_TXT = Path("/tmp/opencode/opt_width_eff_results.txt")
CSV = f"{USB}/{SYM}/{SYM}_1min_20260120_20260415.csv"

# ---- copied from orb_verify.py ----
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

def simulate_day(g: pd.DataFrame, range_bars: int, consec: int, mode: str, cost_pt: float):
    if len(g) < range_bars + consec + 2:
        return None
    rng = g.iloc[:range_bars]
    hi, lo = float(rng["high"].max()), float(rng["low"].min())
    body = g.iloc[range_bars:]
    o = body["open"].to_numpy(float); h = body["high"].to_numpy(float)
    l = body["low"].to_numpy(float); c = body["close"].to_numpy(float)
    n = len(body)
    last_close = c[-1]
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
        return raw, raw - cost_pt / dist
    if mode == "run":
        above = (c > hi).astype(int); below = (c < lo).astype(int)
        for i in range(consec - 1, n):
            if above[i - consec + 1:i + 1].sum() == consec:
                side, entry, stop = 1, o[i], lo
            elif below[i - consec + 1:i + 1].sum() == consec:
                side, entry, stop = -1, o[i], hi
            else:
                continue
            if abs(entry - stop) <= 0:
                return None
            tp = entry + side * 2 * abs(entry - stop)
            return finish(side, entry, stop, tp, i)
        return None
    broke = None
    for i in range(n):
        if c[i] > hi:
            broke = (1, hi); break
        if c[i] < lo:
            broke = (-1, lo); break
    if broke is None:
        return None
    side, edge = broke
    for j in range(i + 1, n):
        if side == 1 and l[j] <= edge:
            stop, entry = lo, edge
            tp = entry + 2 * (entry - stop)
            return finish(side, entry, stop, tp, j)
        if side == -1 and h[j] >= edge:
            stop, entry = hi, edge
            tp = entry - 2 * (stop - entry)
            return finish(side, entry, stop, tp, j)
    return None

def compute_metrics(t: pd.DataFrame):
    """t has columns R_raw, R. Return dict stats."""
    if t.empty or len(t)==0:
        return {"trades":0, "win%":0, "PF":0, "net%":0, "gross%":0, "maxDD%":0, "avg_R":0}
    eq_gross = (1 + 0.01 * t["R_raw"]).cumprod()
    eq_net = (1 + 0.01 * t["R"]).cumprod()
    wins = (t["R"] > 0).sum()
    pos = t.loc[t.R > 0, "R"].sum()
    neg = abs(t.loc[t.R < 0, "R"].sum())
    pf = pos / neg if neg>0 else float("inf") if pos>0 else 0
    dd = (eq_net / eq_net.cummax() - 1).min()
    return {
        "trades": len(t),
        "win%": round(wins/len(t)*100,1),
        "PF": round(pf,2) if pf!=float("inf") else float("inf"),
        "net%": round((eq_net.iloc[-1]-1)*100,1),
        "gross%": round((eq_gross.iloc[-1]-1)*100,1),
        "maxDD%": round(dd*100,1),
        "avg_R": round(t["R"].mean(),3),
    }

def or_metrics(g: pd.DataFrame, range_bars: int):
    rng = g.iloc[:range_bars]
    hi = float(rng["high"].max()); lo = float(rng["low"].min())
    width = hi - lo
    bar_ranges = (rng["high"] - rng["low"]).to_numpy(float)
    sum_ranges = bar_ranges.sum()
    eff = (width / sum_ranges) if sum_ranges>0 else 0
    drift = abs(float(rng["close"].iloc[-1]) - float(rng["open"].iloc[0])) / width if width>0 else 0
    day_range = float(g["high"].max() - g["low"].min())
    return {"hi":hi,"lo":lo,"width":width,"eff":eff,"drift":drift,"day_range":day_range,"sum_ranges":sum_ranges}

bars = load_3min(SYM)
# Build per-day records
days = []
for day, g in bars.groupby("day"):
    m = or_metrics(g, RANGE_BARS)
    res = simulate_day(g, RANGE_BARS, CONSEC, MODE, COST_PT)
    rec = {"day":day, **m}
    if res is not None:
        rec["R_raw"]=res[0]; rec["R"]=res[1]; rec["has_trade"]=True
    else:
        rec["R_raw"]=np.nan; rec["R"]=np.nan; rec["has_trade"]=False
    days.append(rec)

df = pd.DataFrame(days).sort_values("day").reset_index(drop=True)
# prev OR width and prev day range
df["prev_width"] = df["width"].shift(1)
df["prev_day_range"] = df["day_range"].shift(1)
df["ratio_or"] = df["width"] / df["prev_width"]
df["ratio_day"] = df["width"] / df["prev_day_range"]
# fill inf/nan for first row
df["ratio_or"] = df["ratio_or"].replace([np.inf,-np.inf], np.nan)
df["ratio_day"] = df["ratio_day"].replace([np.inf,-np.inf], np.nan)

# helper to evaluate filter
def eval_filter(mask_series, label):
    f = df[mask_series]
    t = f[f["has_trade"]][["R_raw","R"]].copy()
    if t.empty:
        t = pd.DataFrame({"R_raw":[],"R":[]})
    stats = compute_metrics(t)
    stats["label"]=label
    stats["filtered_days"]=int(mask_series.sum())
    stats["pass_rate%"]=round(mask_series.mean()*100,1)
    return stats

results = []

# baseline (no filter) on tradeable days
baseline_mask = pd.Series([True]*len(df))
# baseline should mimic orb_verify: all days considered, trades only where simulation returns
baseline_t = df[df["has_trade"]][["R_raw","R"]]
baseline_stats = compute_metrics(baseline_t)
baseline_stats["label"]="BASELINE (no filter)"
baseline_stats["filtered_days"]=len(df)
baseline_stats["pass_rate%"]=100.0
results.append(baseline_stats)
print(f"Baseline: {baseline_stats}")

# Verify baseline matches user claim ~ PF 1.64 net 15.5% 54 trades
# If run mode gives different, also test run mode for reference
# Additional baseline for run mode (not filtered, just for logging)
# Let's also compute distribution for insight
print(f"\nOR width stats: mean={df['width'].mean():.2f} median={df['width'].median():.2f} min={df['width'].min():.2f} max={df['width'].max():.2f}")
print(f"Eff stats: mean={df['eff'].mean():.3f} median={df['eff'].median():.3f} min={df['eff'].min():.3f} max={df['eff'].max():.3f}")
print(f"Drift stats: mean={df['drift'].mean():.3f} median={df['drift'].median():.3f} min={df['drift'].min():.3f} max={df['drift'].max():.3f}")
print(f"Ratio_or stats: mean={df['ratio_or'].mean():.3f} median={df['ratio_or'].median():.3f}")
print(f"Ratio_day stats: mean={df['ratio_day'].mean():.3f} median={df['ratio_day'].median():.3f}")
print(f"Total sessions: {len(df)}  trade sessions: {df['has_trade'].sum()}")

# ---- systematic filters ----
# Width absolute
for thr in [10,15,18,22,28]:
    for op, suffix in [("ge",">="),("le","<=")]:
        if op=="ge":
            mask = df["width"]>=thr
            label = f"width{suffix}{thr}"
        else:
            mask = df["width"]<=thr
            label = f"width{suffix}{thr}"
        results.append(eval_filter(mask,label))

# Efficiency
for thr in [0.40,0.45,0.53]:
    for op in ["ge","le"]:
        if op=="ge":
            mask = df["eff"]>=thr
            label = f"eff>={thr:.2f}"
        else:
            mask = df["eff"]<=thr
            label = f"eff<={thr:.2f}"
        results.append(eval_filter(mask,label))
# also test eff between? (0.45-0.53 etc) but keep simple

# Drift
for thr in [0.30,0.50,0.70,0.85]:
    for op in ["ge","le"]:
        if op=="ge":
            mask = df["drift"]>=thr
            label = f"drift>={thr:.2f}"
        else:
            mask = df["drift"]<=thr
            label = f"drift<={thr:.2f}"
        results.append(eval_filter(mask,label))

# Width vs prev day range
for thr in [0.5,0.8,1.0,1.2]:
    for op in ["ge","le"]:
        mask = df["ratio_or"]>=thr if op=="ge" else df["ratio_or"]<=thr
        # fill NaN (first day) as False for ge, True for le? Use fillna False to be conservative
        mask = mask.fillna(False)
        label = f"ratio_or{'>=' if op=='ge' else '<='}{thr:.1f}"
        results.append(eval_filter(mask,label))

for thr in [0.05,0.10,0.15,0.20]:
    for op in ["ge","le"]:
        mask = df["ratio_day"]>=thr if op=="ge" else df["ratio_day"]<=thr
        mask = mask.fillna(False)
        label = f"ratio_day{'>=' if op=='ge' else '<='}{thr:.2f}"
        results.append(eval_filter(mask,label))

# Combined
mask = (df["width"]>=18) & (df["eff"]>=0.45)
results.append(eval_filter(mask,"COMBINED width>=18 & eff>=0.45"))
# extra combined variants
for wth in [15,18,22]:
    for eth in [0.40,0.45,0.53]:
        if wth==18 and eth==0.45:
            continue
        mask = (df["width"]>=wth) & (df["eff"]>=eth)
        results.append(eval_filter(mask,f"width>={wth} & eff>={eth:.2f}"))
# width+drift combined
mask = (df["width"]>=18) & (df["drift"]>=0.50)
results.append(eval_filter(mask,"width>=18 & drift>=0.50"))
mask = (df["eff"]>=0.45) & (df["drift"]>=0.50)
results.append(eval_filter(mask,"eff>=0.45 & drift>=0.50"))
mask = (df["width"]>=15) & (df["eff"]>=0.45) & (df["drift"]>=0.30)
results.append(eval_filter(mask,"width>=15 & eff>=0.45 & drift>=0.30"))

# Width band (between thresholds)
for lo_thr, hi_thr in [(10,22),(15,28),(10,18)]:
    mask = (df["width"]>=lo_thr) & (df["width"]<=hi_thr)
    results.append(eval_filter(mask,f"width {lo_thr}-{hi_thr}"))

# Eff + width_ratio etc
mask = (df["eff"]>=0.45) & (df["ratio_or"]<=1.2)
results.append(eval_filter(mask,"eff>=0.45 & ratio_or<=1.2"))

res_df = pd.DataFrame(results)

# Sort by PF then net%
# Replace inf PF with large number for sorting
res_df["PF_sort"] = res_df["PF"].replace(float("inf"), 99)
# Filter out trivial <5 trades (noise) except baseline
filt = res_df[(res_df["trades"]>=5) | (res_df["label"].str.contains("BASELINE"))]
# Rank best by PF, then net%
ranked = filt.sort_values(["PF_sort","net%"], ascending=[False, False]).reset_index(drop=True)

# Also rank by net%
ranked_net = filt.sort_values(["net%","PF_sort"], ascending=[False,False]).reset_index(drop=True)

print("\n=== ALL FILTER RESULTS (trades>=5 or baseline) sorted by PF ===")
cols = ["label","trades","win%","PF","net%","gross%","maxDD%","filtered_days","pass_rate%"]
print(ranked[cols].to_string(index=False))

print("\n=== TOP 10 by PF ===")
print(ranked.head(10)[cols].to_string(index=False))

print("\n=== TOP 10 by net% ===")
print(ranked_net.head(10)[cols].to_string(index=False))

# Best 5 for combined reporting: top PF with net improvement over baseline
baseline_pf = baseline_stats["PF"]
baseline_net = baseline_stats["net%"]
print(f"\nBaseline PF={baseline_pf} net%={baseline_net} trades={baseline_stats['trades']}")

# Build concise table of best 5 combos with edge improvement
# criteria: trades>=8 to avoid tiny sample, PF>baseline_pf or net>baseline_net
candidates = ranked[ranked["trades"]>=8].copy()
candidates["pf_delta"] = candidates["PF"] - baseline_pf
candidates["net_delta"] = candidates["net%"] - baseline_net
# sort by pf_delta then net_delta
candidates = candidates.sort_values(["pf_delta","net_delta"], ascending=[False,False])
best5 = candidates.head(5)

print("\n=== BEST 5 FILTER COMBOS (trades>=8, sorted by PF improvement) ===")
print(best5[cols + ["pf_delta","net_delta"]].to_string(index=False))
# Also include combined explicitly
combined_row = res_df[res_df["label"]=="COMBINED width>=18 & eff>=0.45"]
print("\n=== COMBINED width>=18 & eff>=0.45 ===")
print(combined_row[cols].to_string(index=False))
if not combined_row.empty:
    cr = combined_row.iloc[0]
    print(f"  vs baseline: PF {cr['PF']} vs {baseline_pf} (Δ{cr['PF']-baseline_pf:+.2f}), net {cr['net%']}% vs {baseline_net}% (Δ{cr['net%']-baseline_net:+.1f}%), trades {cr['trades']} vs {baseline_stats['trades']}")

# Save results to txt
with open(OUT_TXT,"w") as f:
    f.write("ORB Opening-Range QUALITY filter optimization — ES 2026-01-20..2026-04-15\n")
    f.write("="*80+"\n")
    f.write(f"CSV: {CSV}\n")
    f.write(f"Baseline (no filter): {baseline_stats}\n")
    f.write(f"Sessions: {len(df)}  trade sessions baseline: {df['has_trade'].sum()}\n")
    f.write(f"OR width  mean {df['width'].mean():.2f} median {df['width'].median():.2f} range {df['width'].min():.1f}-{df['width'].max():.1f} pts\n")
    f.write(f"Eff       mean {df['eff'].mean():.3f} median {df['eff'].median():.3f}\n")
    f.write(f"Drift     mean {df['drift'].mean():.3f} median {df['drift'].median():.3f}\n")
    f.write(f"Costs 1pt RT, 1% risk, TP 2R/SL opposite, EOD flat, mode={MODE}, range 15m (5x3m bars)\n")
    f.write("\nAll filters (trades>=5) sorted by PF:\n")
    f.write(ranked[cols].to_string(index=False))
    f.write("\n\nTop 10 by PF:\n")
    f.write(ranked.head(10)[cols].to_string(index=False))
    f.write("\n\nTop 10 by net%:\n")
    f.write(ranked_net.head(10)[cols].to_string(index=False))
    f.write("\n\nBest 5 (trades>=8) by PF improvement over baseline:\n")
    f.write(best5[cols+["pf_delta","net_delta"]].to_string(index=False))
    f.write("\n\nCOMBINED width>=18 & eff>=0.45:\n")
    f.write(combined_row[cols].to_string(index=False))
    f.write("\n\nInterpretation:\n")
    # Find strongest signal
    # Check if any filter actually improves
    best = best5.iloc[0] if not best5.empty else None
    if best is not None:
        f.write(f"- Best filter: {best['label']} PF={best['PF']} (baseline {baseline_pf}), net {best['net%']}% vs {baseline_net}%, trades {best['trades']}\n")
    # Width analysis
    w_ge = res_df[res_df["label"].str.match(r"width>=")]
    w_le = res_df[res_df["label"].str.match(r"width<=")]
    f.write(f"- Width filters (ge): {w_ge[cols].to_string(index=False)}\n")
    f.write(f"- Eff filters: {res_df[res_df['label'].str.contains('eff')][cols].to_string(index=False)}\n")
    f.write(f"- Drift filters: {res_df[res_df['label'].str.contains('drift')][cols].to_string(index=False)}\n")
    # Edge summary
    improved = candidates[candidates["PF"]>baseline_pf]
    if improved.empty:
        f.write("- No filter with >=8 trades beats baseline PF. Filters tested reduce sample without improving edge.\n")
    else:
        f.write(f"- {len(improved)} filters beat baseline PF with >=8 trades.\n")
    f.write("\nGenerated by /tmp/opencode/opt_width_eff.py\n")

print(f"\n[ok] results saved to {OUT_TXT}")

# Also output concise table for user answer
print("\n" + "="*70)
print("CONCISE — BEST 5 (edge improvement)")
print("="*70)
for _, r in best5.iterrows():
    print(f"{r['label']:<30} trades {r['trades']:2d}  win {r['win%']:4.1f}%  PF {r['PF']:4.2f} (Δ{r['pf_delta']:+.2f})  net {r['net%']:+5.1f}% (Δ{r['net_delta']:+.1f}%)  DD {r['maxDD%']}%")
