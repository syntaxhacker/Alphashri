#!/usr/bin/env python
import sys
from pathlib import Path
sys.path.insert(0, str(Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")))
from market_data.market_data import fetch_candles
import pandas as pd, numpy as np

def fetch(tf, sym, frm, to):
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

def backtest(df, or_min, tf, rr, retest):
    df["day"]=df.index.normalize()
    mins=df.index.hour*60+df.index.minute
    mask=(mins>=555)&(mins<930)
    df=df[mask]
    RANGE_BARS=or_min//tf
    if RANGE_BARS<1: return None
    rows=[]
    for day,g in df.groupby("day"):
        if len(g)<RANGE_BARS+3: continue
        rng=g.iloc[:RANGE_BARS]
        hi,lo=float(rng["high"].max()), float(rng["low"].min())
        body=g.iloc[RANGE_BARS:]
        o,h,l,c=[body[k].to_numpy(float) for k in ("open","high","low","close")]
        n=len(body)
        broke=next((i for i in range(n) if c[i]>hi or c[i]<lo), None)
        if broke is None: continue
        side=1 if c[broke]>hi else -1
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
        tp=entry+side*rr*dist
        r=None
        for j in range(fill,n):
            if (l[j]<=sl if side==1 else h[j]>=sl):
                r=-1; break
            if (h[j]>=tp if side==1 else l[j]<=tp):
                r=rr; break
        if r is None:
            px=c[-1]
            r=(px-entry)/dist if side==1 else (entry-px)/dist
            r=r - 0.001
        else:
            r=r - 0.001
        rows.append(r)
    arr=np.array(rows)
    if len(arr)==0: return dict(n=0, pf=0, win=0, net=0, avg=0)
    pf=arr[arr>0].sum()/abs(arr[arr<0].sum()) if (arr<0).any() else 99
    return dict(n=len(arr), win=(arr>0).mean()*100, pf=pf, net=(1+0.01*arr).prod()-1, avg=arr.mean())

frm,to="2026-03-26","2026-08-26"
sym="NETWEB"
print(f"RR sweep {sym} {frm}->{to}")
for tf in [3,5,15]:
    for or_min in [15,30]:
        if or_min%tf!=0: continue
        df=fetch(tf,sym,frm,to)
        if df is None: continue
        best=None
        for rr in [0.8,1.0,1.2,1.5,2.0,2.5,3.0]:
            for retest in [True, False]:
                r=backtest(df.copy(), or_min, tf, rr, retest)
                if r["n"]<10: continue
                if best is None or r["pf"]>best[2]["pf"]:
                    best=(rr,retest,r)
        if best:
            rr,retest,r=best
            print(f" TF{tf:2d} OR{or_min:2d} best -> {'retest' if retest else 'noRet'} RR{rr:.1f} n={r['n']:2d} win={r['win']:4.1f}% PF={r['pf']:.2f} net={r['net']:+.1%} avgR={r['avg']:+.3f}")

# detailed grid for best TF
print("\nDetailed TF3 OR30:")
df=fetch(3,sym,frm,to)
for rr in [0.8,1.0,1.2,1.5,2.0,2.5,3.0]:
    for retest in [True, False]:
        r=backtest(df.copy(), 30, 3, rr, retest)
        print(f" {'retest' if retest else 'noRet'} RR{rr:.1f} -> n={r['n']:2d} win={r['win']:4.1f}% PF={r['pf']:.2f} net={r['net']:+.1%}")

print("\nDetailed TF15 OR15:")
df=fetch(15,sym,frm,to)
for rr in [0.8,1.0,1.2,1.5,2.0,2.5,3.0]:
    for retest in [True, False]:
        r=backtest(df.copy(), 15, 15, rr, retest)
        print(f" {'retest' if retest else 'noRet'} RR{rr:.1f} -> n={r['n']:2d} win={r['win']:4.1f}% PF={r['pf']:.2f} net={r['net']:+.1%}")
