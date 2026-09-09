#!/usr/bin/env python
import sys
from pathlib import Path
sys.path.insert(0, str(Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")))
sys.path.insert(0, str(Path("/home/mysyntax/Documents/Alphashri")))
from market_data.market_data import fetch_candles
import pandas as pd, numpy as np

def fetch_range(sym, tf, frm, to):
    df = fetch_candles(sym, tf=tf, from_date=frm, to_date=to)
    if df is None or df.empty:
        print(f"No data {sym} {tf} {frm}->{to}")
        return None
    # convert UTC index to IST date
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    df.index = df.index.tz_convert("Asia/Kolkata")
    return df

for months, frm in [(3, "2026-05-26"), (5, "2026-03-26")]:
    to = "2026-08-26"
    print(f"\n=== NETWEB {months}mo {frm}->{to} ===")
    df5 = fetch_range("NETWEB", 5, frm, to)
    if df5 is None: continue
    print(f"Fetched {len(df5)} 5m bars, {df5.index.normalize().nunique()} days, {df5.index[0]} -> {df5.index[-1]}")
    # RTH filter 09:15-15:30 IST
    df5["day"] = df5.index.normalize()
    # filter to RTH
    mins = df5.index.hour*60 + df5.index.minute
    # 09:15 = 555, 15:30 = 930
    mask = (mins >= 555) & (mins < 930)
    df5 = df5[mask]
    print(f"After RTH filter: {len(df5)} bars, {df5['day'].nunique()} days")
    # run ORB strategies
    RANGE_BARS=3
    def run(refined=False):
        rows=[]
        for day,g in df5.groupby("day"):
            if len(g)<RANGE_BARS+6: continue
            rng=g.iloc[:RANGE_BARS]
            hi,lo=float(rng["high"].max()), float(rng["low"].min())
            eff=(hi-lo)/(rng["high"]-rng["low"]).sum() if (rng["high"]-rng["low"]).sum()>0 else 0
            if refined and eff<0.50: continue
            lows=rng["low"].to_numpy(float)
            hl=sum(lows[i]>lows[i-1] for i in range(1,RANGE_BARS))
            ll=sum(lows[i]<lows[i-1] for i in range(1,RANGE_BARS))
            body=g.iloc[RANGE_BARS:]
            o,h,l,c=[body[k].to_numpy(float) for k in ("open","high","low","close")]
            n=len(body)
            broke=next((i for i in range(n) if c[i]>hi or c[i]<lo), None)
            if broke is None: continue
            side=1 if c[broke]>hi else -1
            if refined:
                if side==1 and hl<2: continue
                if side==-1 and ll<2: continue
                fill=broke+1
                if fill>=n: continue
                entry=o[fill]
                sl=lo if side==1 else hi
                dist=abs(entry-sl)
                if dist==0: continue
                tp=entry+side*1.2*dist
            else:
                edge=hi if side==1 else lo
                sl=lo if side==1 else hi
                fill=next((j for j in range(broke+1,n) if (side==1 and l[j]<=edge) or (side==-1 and h[j]>=edge)), None)
                if fill is None: continue
                entry=edge
                dist=abs(entry-sl)
                tp=entry+side*2*dist
            r=None
            for j in range(fill,n):
                if (l[j]<=sl if side==1 else h[j]>=sl):
                    r=-1; break
                if (h[j]>=tp if side==1 else l[j]<=tp):
                    r=1.2 if refined else 2.0; break
            if r is None:
                px=c[-1]
                r=(px-entry)/dist if side==1 else (entry-px)/dist
                r=r - 0.001
            else:
                r=r - 0.001
            rows.append(r)
        arr=np.array(rows)
        if len(arr)==0: return dict(n=0, pf=0, win=0, net=0)
        pf=arr[arr>0].sum()/abs(arr[arr<0].sum()) if (arr<0).any() else 99
        return dict(n=len(arr), win=(arr>0).mean()*100, pf=pf, net=(1+0.01*arr).prod()-1, avg=arr.mean())
    for name, refined in [("Baseline retest TP2R (no filter)", False), ("Refined eff>=0.50 HL>=2 no-retest TP1.2", True)]:
        r=run(refined=refined)
        print(f" {name:35} n={r['n']:2d} win={r['win']:4.1f}% PF={r['pf']:.2f} net={r['net']:+.1%} avgR={r['avg']:+.3f}")
