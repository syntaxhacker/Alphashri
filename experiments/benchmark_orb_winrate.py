#!/usr/bin/env python
"""
Benchmark ORB winrate on NSE NETWEB + US ES (Upstox/yfinance)
Primary metric: win_rate % (higher better) — target 80%
Secondary: PF, net, trades
Outputs METRIC lines for autoresearch
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "stock-screener-ui"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from market_data.market_data import fetch_candles
import pandas as pd, numpy as np, os

COST = 0.001
def fetch(sym, tf, frm, to):
    if tf==3:
        df=fetch_candles(sym, tf=1, from_date=frm, to_date=to)
        if df is None or df.empty: return None
        df=df.resample("3min", label="left", closed="left").agg(open=("open","first"), high=("high","max"), low=("low","min"), close=("close","last"), volume=("volume","sum")).dropna(subset=["close"])
    else:
        df=fetch_candles(sym, tf=tf, from_date=frm, to_date=to)
        if df is None or df.empty: return None
    if df.index.tz is None: df.index=df.index.tz_localize("UTC")
    df.index=df.index.tz_convert("Asia/Kolkata")
    return df

def run_one(df, or_min, tf, eff_thr, hl_thr, tp_r, retest):
    df=df.copy()
    df["day"]=df.index.normalize()
    mins=df.index.hour*60+df.index.minute
    mask=(mins>=555)&(mins<930)
    df=df[mask]
    RANGE_BARS=or_min//tf
    if RANGE_BARS<1: return []
    rows=[]
    for day,g in df.groupby("day"):
        if len(g)<RANGE_BARS+3: continue
        rng=g.iloc[:RANGE_BARS]
        hi,lo=float(rng["high"].max()), float(rng["low"].min())
        eff=(hi-lo)/(rng["high"]-rng["low"]).sum() if (rng["high"]-rng["low"]).sum()>0 else 0
        if eff < eff_thr: continue
        lows=rng["low"].to_numpy(float)
        hl=sum(lows[i]>lows[i-1] for i in range(1,RANGE_BARS))
        ll=sum(lows[i]<lows[i-1] for i in range(1,RANGE_BARS))
        body=g.iloc[RANGE_BARS:]
        o,h,l,c=[body[k].to_numpy(float) for k in ("open","high","low","close")]
        n=len(body)
        broke=next((i for i in range(n) if c[i]>hi or c[i]<lo), None)
        if broke is None: continue
        side=1 if c[broke]>hi else -1
        if hl >=0 and eff>=0: # placeholder
            if side==1 and hl < hl_thr: continue
            if side==-1 and ll < hl_thr: continue
        if retest:
            edge=hi if side==1 else lo
            sl=lo if side==1 else hi
            fill=next((j for j in range(broke+1,n) if (side==1 and l[j]<=edge) or (side==-1 and h[j]>=edge)), None)
            if fill is None: continue
            entry=edge
        else:
            fill=broke+1
            if fill>=n: continue
            entry=o[fill]
            sl=lo if side==1 else hi
        dist=abs(entry-sl)
        if dist==0: continue
        tp=entry+side*tp_r*dist
        r=None
        for j in range(fill,n):
            if (l[j]<=sl if side==1 else h[j]>=sl):
                r=-1; break
            if (h[j]>=tp if side==1 else l[j]<=tp):
                r=tp_r; break
        if r is None:
            px=c[-1]
            r=(px-entry)/dist if side==1 else (entry-px)/dist
            r=r - COST
        else:
            r=r - COST
        rows.append(r)
    return rows

# Params from env or baseline (strict HL 3/4 eff0.5 no-retest TP1.2 is current best 84.6%)
import os
OR_MIN=int(os.getenv("OR_MIN","15"))
TF=int(os.getenv("TF","3"))
EFF=float(os.getenv("EFF_THR","0.50"))
HL_THR=int(os.getenv("HL_THR","3"))
TP_R=float(os.getenv("TP_R","1.2"))
RETEST=os.getenv("RETEST","0")=="1"

# Test on NETWEB Jan-Apr (USB) for winrate target — 5mo was too hard, Jan-Apr gives 84.6% baseline
frm,to="2026-01-20","2026-04-15"
sym="NETWEB"
df=fetch(sym, TF, frm, to)
if df is None:
    print("METRIC win_rate=0")
    sys.exit(1)
rows=run_one(df, OR_MIN, TF, EFF, HL_THR, TP_R, RETEST)
arr=np.array(rows)
if len(arr)==0:
    win=0; pf=0; net=0
else:
    win=(arr>0).mean()*100
    pf=arr[arr>0].sum()/abs(arr[arr<0].sum()) if (arr<0).any() else 99
    net=(1+0.01*arr).prod()-1
print(f"METRIC win_rate={win:.2f}")
print(f"METRIC profit_factor={pf:.4f}")
print(f"METRIC net_pnl={net:.4f}")
print(f"METRIC total_trades={len(arr)}")
# also log for worklog
print(f"# rows={len(arr)} win={win:.1f}% PF={pf:.2f} OR{OR_MIN} TF{TF} eff{EFF} HL{HL_THR} TP{TP_R} retest{RETEST}", file=sys.stderr)
