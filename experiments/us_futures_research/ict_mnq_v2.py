#!/usr/bin/env python
"""ICT MNQ v2 — parameterized sweep for high RR.
Sweep params: wick buffer, FVG min size, displacement vol, HTF bias, RR
Logs learning from mistakes."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "stock-screener-ui"))
import pandas as pd, numpy as np, itertools, json, os
from pathlib import Path as P

USB_5M="/media/mysyntax/LENOVO_USB_/cme-futures-ohlc-main/MNQ/MNQ_5min_20260120_20260415.csv"

def load_mnq():
    df=pd.read_csv(USB_5M, parse_dates=["datetime"])
    df["datetime"]=pd.to_datetime(df["datetime"])
    if df["datetime"].dt.tz is None: df["datetime"]=df["datetime"].dt.tz_localize("UTC")
    else: df["datetime"]=df["datetime"].dt.tz_convert("UTC")
    df=df.set_index("datetime").sort_index()
    df.index=df.index.tz_convert("America/New_York")
    df["day"]=df.index.normalize()
    mins=df.index.hour*60+df.index.minute
    df=df[(mins>=570)&(mins<960)]
    return df

def find_fvg(df, start, direction, min_size=0):
    for i in range(start, min(start+20, len(df)-2)):
        c1,c2,c3=df.iloc[i],df.iloc[i+1],df.iloc[i+2]
        if direction==1 and c3["low"] > c1["high"] and (c3["low"]-c1["high"])>=min_size:
            return i+1, (c1["high"], c3["low"])
        if direction==-1 and c3["high"] < c1["low"] and (c1["low"]-c3["high"])>=min_size:
            return i+1, (c3["high"], c1["low"])
    return None, None

def backtest(df, buffer=10, fvg_min=5, vol_mult=1.0, htf_bias=False, rr=5.0):
    daily=df.groupby("day").agg(high=("high","max"), low=("low","min"), volume=("volume","sum"))
    # HTF 1h trend: 20EMA
    df_1h=df.resample("1h").agg(open=("open","first"),high=("high","max"),low=("low","min"),close=("close","last"),volume=("volume","sum")).dropna()
    df_1h["ema20"]=df_1h["close"].ewm(span=20).mean()
    rows=[]
    for day,g in df.groupby("day"):
        if len(g)<30: continue
        idx=list(daily.index).index(day) if day in daily.index else -1
        if idx<=0: continue
        pdh=float(daily.iloc[idx-1]["high"]); pdl=float(daily.iloc[idx-1]["low"])
        # HTF bias
        htf=None
        if htf_bias:
            try:
                e=df_1h.loc[:day].iloc[-1]
                htf=1 if e["close"]>e["ema20"] else -1
            except: htf=None
        # volume median
        med_vol=g["volume"].median()
        for i in range(20, len(g)-5):
            bar=g.iloc[i]
            # displacement: body > 50% of range and volume > vol_mult*median
            body=abs(bar["close"]-bar["open"]); rng=bar["high"]-bar["low"]
            disp = (body/rng>0.6 if rng>0 else False) and bar["volume"]>vol_mult*med_vol
            if vol_mult>0 and not disp:
                # if vol_mult==0 skip displacement check
                if vol_mult!=0: continue
            swing_high=float(g.iloc[max(0,i-20):i]["high"].max())
            swing_low=float(g.iloc[max(0,i-20):i]["low"].min())
            direction=None; sweep_level=None
            if bar["high"] > pdh + buffer and bar["close"] < pdh:
                direction=-1; sweep_level=bar["high"]
            elif bar["low"] < pdl - buffer and bar["close"] > pdl:
                direction=1; sweep_level=bar["low"]
            elif bar["high"] > swing_high + buffer and bar["close"] < swing_high:
                direction=-1; sweep_level=bar["high"]
            elif bar["low"] < swing_low - buffer and bar["close"] > swing_low:
                direction=1; sweep_level=bar["low"]
            else: continue
            if htf_bias and htf is not None and direction!=htf:
                continue
            fvg_idx, fvg_range=find_fvg(g, i+1, direction, min_size=fvg_min)
            if fvg_idx is None: continue
            fvg_mid=(fvg_range[0]+fvg_range[1])/2
            entry=fvg_mid
            sl=sweep_level + (2 if direction==-1 else -2)
            dist=abs(entry-sl)
            if dist==0: continue
            tp=entry + direction*rr*dist
            # entry fill: must touch FVG
            entry_idx=None
            for j in range(fvg_idx+2, len(g)):
                if g.iloc[j]["low"] <= fvg_range[1] and g.iloc[j]["high"] >= fvg_range[0]:
                    entry_idx=j; break
            if entry_idx is None: continue
            r=None
            for j in range(entry_idx, len(g)):
                hj,lj=g.iloc[j]["high"],g.iloc[j]["low"]
                if (lj<=sl if direction==1 else hj>=sl):
                    r=-1; break
                if (hj>=tp if direction==1 else lj<=tp):
                    r=rr; break
            if r is None:
                px=g.iloc[-1]["close"]
                r=(px-entry)/dist if direction==1 else (entry-px)/dist
                r=r - 2/dist
            else:
                r=r - 2/dist
            rows.append(r)
            break
    return rows

if __name__=="__main__":
    df=load_mnq()
    print(f"Loaded {len(df)} 5m RTH bars, {df['day'].nunique()} days")
    # sweep grid
    grid=[]
    for buffer,fvg_min,vol_mult,rr in itertools.product([10,15],[5,10],[0,1.5],[3,5,7]):
        rows=backtest(df, buffer=buffer, fvg_min=fvg_min, vol_mult=vol_mult, htf_bias=False, rr=rr)
        arr=np.array(rows)
        if len(arr)<5: continue
        pf=arr[arr>0].sum()/abs(arr[arr<0].sum()) if (arr<0).any() else 99
        grid.append((pf, f"buf{buffer} fvg{fvg_min} vol{vol_mult} RR{rr}", len(arr), (arr>0).mean()*100, pf, arr.mean(), (1+0.01*arr).prod()-1))
    grid.sort(reverse=True)
    print("\nTop 10 ICT v2 configs (PF sorted):")
    for pf,desc,n,win,pf2,avg,net in grid[:10]:
        print(f" PF{pf:.2f} {desc:20} n={n:2d} win{win:4.1f}% avg{avg:+.3f} net{net:+.1%}")
    # also test HTF bias on top
    print("\nHTF bias test on best:")
    for htf in [False, True]:
        rows=backtest(df, buffer=10, fvg_min=5, vol_mult=1.5, htf_bias=htf, rr=5)
        arr=np.array(rows)
        pf=arr[arr>0].sum()/abs(arr[arr<0].sum()) if len(arr) else 0
        print(f" htf={htf} n={len(arr)} PF{pf:.2f} win{(arr>0).mean()*100:.1f}%")
    # save
    with open(Path(__file__).parent/"ict_v2_results.json","w") as f:
        json.dump([{"pf":float(pf),"desc":d,"n":n,"win":float(win)} for pf,d,n,win,_,_,_ in grid], f, indent=2)
