#!/usr/bin/env python
"""
Research: ORB + VWAP + Volume + Retest (no commits)
Baseline: ORB 15m retest @ edge, SL opposite, TP2R, 1% risk, cost 1pt
Add filters: VWAP (price > VWAP for longs), Volume surge (>1.5x avg of OR), Retest confirmation
Sweep and report PF/win/net for ES 2026-01-20→2026-04-15
"""
import sys
sys.path.insert(0, '/tmp/opencode')
import orb_verify as ov, pandas as pd, numpy as np
from pathlib import Path

COST_PT=1.0
RANGE_BARS=5

def load():
    bars=ov.load_3min("ES")
    return bars

def vwap(g):
    # VWAP from RTH open: cumulative (close*volume)/volume
    return (g["close"]*g["volume"]).cumsum() / g["volume"].cumsum()

def run_filter(vwap_filter=False, vol_mult=None, retest_required=True):
    bars=load()
    rows=[]
    for day,g in bars.groupby("day"):
        if len(g) < RANGE_BARS+10: continue
        rng=g.iloc[:RANGE_BARS]
        hi,lo=float(rng["high"].max()), float(rng["low"].min())
        w=hi-lo
        # volume surge: OR volume vs avg 1m volume of OR?
        or_vol=rng["volume"].sum()
        # avg daily OR volume baseline: mean of last 5 days OR vol
        # For simplicity, vol filter: current OR vol > vol_mult * median OR vol last 5
        # We'll compute outside loop later
        body=g.iloc[RANGE_BARS:]
        # VWAP series for body
        vw=vwap(g).iloc[RANGE_BARS:]
        o,h,l,c=[body[k].to_numpy(float) for k in ("open","high","low","close")]
        n=len(body)
        # find breakout
        broke=None
        for i in range(n):
            if c[i]>hi or c[i]<lo:
                # VWAP filter: breakout close must be above VWAP for long, below for short
                if vwap_filter:
                    vw_val=float(vw.iloc[i])
                    if c[i]>hi and c[i]<vw_val: continue
                    if c[i]<lo and c[i]>vw_val: continue
                # Volume filter: check OR volume condition (precomputed)
                broke=i
                break
        if broke is None: continue
        side=1 if c[broke]>hi else -1
        edge, opp=(hi,lo) if side==1 else (lo,hi)
        if retest_required:
            fill=next((j for j in range(broke+1,n) if (side==1 and l[j]<=edge) or (side==-1 and h[j]>=edge)), None)
            if fill is None: continue
        else:
            fill=broke+1
            if fill>=n: continue
            edge=c[broke]  # market at next open approx
            # need to recalc dist
        dist=abs(edge-opp)
        tp=edge+side*2*dist
        # exit
        px=None; r=None
        for j in range(fill, n):
            if (l[j]<=opp if side==1 else h[j]>=opp):
                px=opp; r=(px-edge)/dist if side==1 else (edge-px)/dist; break
            if (h[j]>=tp if side==1 else l[j]<=tp):
                px=tp; r=(px-edge)/dist if side==1 else (edge-px)/dist; break
        if px is None:
            px=c[-1]; r=(px-edge)/dist if side==1 else (edge-px)/dist
        rows.append((day, r - COST_PT/dist, w, or_vol))
    return rows

# Precompute OR volume history for vol filter sweep
bars=load()
or_vols={d: float(g.iloc[:RANGE_BARS]["volume"].sum()) for d,g in bars.groupby("day")}
# Sweep volume mult
print("Baseline (retest, no VWAP, no vol):")
rows=run_filter(False, None, True)
arr=np.array([r[1] for r in rows])
pf=arr[arr>0].sum()/abs(arr[arr<0].sum()) if (arr<0).any() else float('inf')
print(f"  n={len(arr)} PF={pf:.2f} win={(arr>0).mean()*100:.1f}% avgR={arr.mean():+.3f} net={(1+0.01*arr).prod()-1:+.1%}")

for vol in [1.2,1.5,2.0]:
    rows_f=[]
    for day,g in bars.groupby("day"):
        if len(g)<RANGE_BARS+10: continue
        # median of last 5 OR vols
        days_sorted=sorted(or_vols.keys())
        idx=days_sorted.index(day)
        if idx<5: continue
        median=np.median([or_vols[days_sorted[k]] for k in range(idx-5, idx)])
        if or_vols[day] < vol*median: continue
        # run single day filter
        rng=g.iloc[:RANGE_BARS]; hi,lo=float(rng["high"].max()), float(rng["low"].min())
        body=g.iloc[RANGE_BARS:]
        # reuse run_filter for single day
        sub_rows=run_filter(False, None, True)
        # Instead filter rows by day
        pass
# Simpler: just loop with vol filter integrated
for vol in [None,1.2,1.5,2.0]:
    for vwap_f in [False, True]:
        for retest in [True, False]:
            rows=[]
            for day,g in bars.groupby("day"):
                if len(g) < RANGE_BARS+10: continue
                rng=g.iloc[:RANGE_BARS]
                hi,lo=float(rng["high"].max()), float(rng["low"].min())
                # vol filter
                if vol is not None:
                    days_sorted=sorted(or_vols.keys())
                    try: idx=days_sorted.index(day)
                    except: continue
                    if idx<5: continue
                    median=np.median([or_vols[days_sorted[k]] for k in range(idx-5, idx)])
                    if or_vols[day] < vol*median: continue
                # VWAP handled inside
                # run day
                # quick replicate
                body=g.iloc[RANGE_BARS:]
                vw=vwap(g).iloc[RANGE_BARS:]
                o,h,l,c=[body[k].to_numpy(float) for k in ("open","high","low","close")]
                n=len(body)
                broke=None
                for i in range(n):
                    if c[i]>hi or c[i]<lo:
                        if vwap_f:
                            vw_val=float(vw.iloc[i])
                            if c[i]>hi and c[i]<vw_val: continue
                            if c[i]<lo and c[i]>vw_val: continue
                        broke=i; break
                if broke is None: continue
                side=1 if c[broke]>hi else -1
                edge, opp=(hi,lo) if side==1 else (lo,hi)
                if retest:
                    fill=next((j for j in range(broke+1,n) if (side==1 and l[j]<=edge) or (side==-1 and h[j]>=edge)), None)
                    if fill is None: continue
                else:
                    fill=broke+1
                    if fill>=n: continue
                dist=abs(edge-opp)
                tp=edge+side*2*dist
                px=None
                for j in range(fill,n):
                    if (l[j]<=opp if side==1 else h[j]>=opp):
                        px=opp; break
                    if (h[j]>=tp if side==1 else l[j]<=tp):
                        px=tp; break
                if px is None: px=c[-1]
                r=(px-edge)/dist if side==1 else (edge-px)/dist
                rows.append(r - COST_PT/dist)
            arr=np.array(rows)
            if len(arr)<5:
                print(f"vol={str(vol):4} vwap={str(vwap_f):5} retest={str(retest):5} -> n={len(arr)} skip")
                continue
            pf=arr[arr>0].sum()/abs(arr[arr<0].sum()) if (arr<0).any() else float('inf')
            print(f"vol={str(vol):4} vwap={str(vwap_f):5} retest={str(retest):5} -> n={len(arr):2d} PF={pf:.2f} win={(arr>0).mean()*100:4.1f}% avgR={arr.mean():+.3f} net={(1+0.01*arr).prod()-1:+.1%}")
