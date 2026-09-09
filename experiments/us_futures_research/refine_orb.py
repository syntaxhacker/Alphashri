#!/usr/bin/env python
"""
Refine ORB without overfit: test incremental filters on ES
Base: eff>=0.50 no-retest TP1.2R (win66.7% PF1.60, n=18)
Candidate filters (theory-backed):
- OR width >= median (27pt)
- Ratio OR/prev >=1.0 (expanding)
- Gap <=0.6%
- VWAP distance abs>5pt
- Breakout time >=15min (5 bars after OR)
We test incremental addition with holdout: train Jan-Apr (USB), test Aug 17-25 (yfinance)
Keep filter only if BOTH train PF improves and test not collapses, and n>=10
"""
import sys; sys.path.insert(0,'/tmp/opencode')
import orb_verify as ov, pandas as pd, numpy as np, yfinance as yf

COST_PT=1.0; RANGE_BARS=5

def load_usb():
    return ov.load_3min("ES")
def load_yf(period="8d"):
    import yfinance as yf
    df=yf.download("ES=F", period=period, interval="1m", progress=False, auto_adjust=False)
    if isinstance(df.columns, pd.MultiIndex): df.columns=df.columns.get_level_values(0)
    df=df.rename(columns=str.lower)
    df.index=pd.to_datetime(df.index)
    if df.index.tz is None: df.index=df.index.tz_localize("UTC")
    else: df.index=df.index.tz_convert("UTC")
    b=df.resample("3min", label="left", closed="left").agg(open=("open","first"), high=("high","max"), low=("low","min"), close=("close","last"), volume=("volume","sum")).dropna(subset=["close"])
    et=b.index.tz_convert("America/New_York").tz_localize(None)
    rth_open=et.normalize()+pd.Timedelta(hours=9, minutes=30)
    off=(et-rth_open).total_seconds()/60
    b=b[(off>=0)&(off<390)]
    b["day"]=et[(off>=0)&(off<390)].normalize()
    return b

def vwap(g): return (g["close"]*g["volume"]).cumsum()/g["volume"].cumsum()

def backtest(bars, filters):
    rows=[]
    daily=bars.groupby("day").agg(high=("high","max"), low=("low","min"), close=("close","last"))
    or_widths={d: float(g.iloc[:5]["high"].max()-g.iloc[:5]["low"].min()) for d,g in bars.groupby("day")}
    for day,g in bars.groupby("day"):
        if len(g)<5+6: continue
        rng=g.iloc[:5]
        hi,lo=float(rng["high"].max()), float(rng["low"].min())
        eff=(hi-lo)/(rng["high"]-rng["low"]).sum() if (rng["high"]-rng["low"]).sum()>0 else 0
        if eff < filters.get("eff",0): continue
        w=hi-lo
        if "min_width" in filters and w < filters["min_width"]: continue
        # ratio
        if "ratio" in filters:
            idx=list(daily.index).index(day) if day in daily.index else -1
            prev=daily.index[idx-1] if idx>0 else None
            ratio=w/or_widths[prev] if prev is not None and or_widths[prev]>0 else 1
            if ratio < filters["ratio"]: continue
            if "gap" in filters:
                gap=abs(float(g["open"].iloc[0])/float(daily.iloc[idx-1]["close"])-1) if idx>0 else 0
                if gap > filters["gap"]: continue
        # VWAP distance
        if "vwap_dist" in filters:
            vw=vwap(g).iloc[5:]
            body=g.iloc[5:]
            # need breakout to check distance, so defer
            pass
        body=g.iloc[5:]
        vw=vwap(g).iloc[5:]
        o,h,l,c=[body[k].to_numpy(float) for k in ("open","high","low","close")]
        n=len(body)
        broke=next((i for i in range(n) if c[i]>hi or c[i]<lo), None)
        if broke is None: continue
        if "vwap_dist" in filters:
            if abs(c[broke]-float(vw.iloc[broke])) < filters["vwap_dist"]: continue
        if "broke_time" in filters and broke*3 < filters["broke_time"]: continue
        side=1 if c[broke]>hi else -1
        fill=broke+1
        if fill>=n: continue
        entry=o[fill]
        sl=lo if side==1 else hi
        dist=abs(entry-sl)
        if dist==0: continue
        tp=entry+side*filters.get("tp",1.2)*dist
        r=None
        for j in range(fill,n):
            if (l[j]<=sl if side==1 else h[j]>=sl):
                r=-1; break
            if (h[j]>=tp if side==1 else l[j]<=tp):
                r=filters.get("tp",1.2); break
        if r is None:
            px=c[-1]
            r=(px-entry)/dist if side==1 else (entry-px)/dist
            r=r - COST_PT/dist
        else:
            r=r - COST_PT/dist
        rows.append(r)
    arr=np.array(rows)
    if len(arr)==0: return dict(n=0, pf=0, win=0, avg=0, net=0)
    pf=arr[arr>0].sum()/abs(arr[arr<0].sum()) if (arr<0).any() else 99
    return dict(n=len(arr), pf=pf, win=(arr>0).mean()*100, avg=arr.mean(), net=(1+0.01*arr).prod()-1)

train=load_usb()
test=load_yf("8d")
print(f"Train days {train['day'].nunique()} Test days {test['day'].nunique()}")

base=dict(eff=0.50, tp=1.2)
print("BASE", backtest(train, base), "| test", backtest(test, base))

candidates=[
    ("+ width>=27", dict(eff=0.50, tp=1.2, min_width=27)),
    ("+ ratio>=1.0", dict(eff=0.50, tp=1.2, ratio=1.0)),
    ("+ gap<=0.6%", dict(eff=0.50, tp=1.2, ratio=1.0, gap=0.006)),
    ("+ vwap>5", dict(eff=0.50, tp=1.2, vwap_dist=5)),
    ("+ broke>=15min", dict(eff=0.50, tp=1.2, broke_time=15)),
]
for name, f in candidates:
    tr=backtest(train, f); te=backtest(test, f)
    print(f"{name:18} train n={tr['n']:2d} PF={tr['pf']:.2f} win={tr['win']:.0f}% net={tr['net']:+.1%} | test n={te['n']:2d} PF={te['pf']:.2f} win={te['win']:.0f}%")

# incremental best combo
best=dict(eff=0.50, tp=1.2, ratio=1.0, vwap_dist=5)
print("COMBO ratio+vwap", backtest(train, best), backtest(test, best))
best2=dict(eff=0.50, tp=1.2, ratio=1.0, vwap_dist=5, broke_time=15)
print("COMBO +broke15", backtest(train, best2), backtest(test, best2))
