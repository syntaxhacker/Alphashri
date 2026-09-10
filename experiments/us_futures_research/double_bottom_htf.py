#!/usr/bin/env python
"""Double Bottom & ORB on higher TFs — MNQ & ES, 15m/30m/1h
Resample 5m RTH to target TF, reuse same W logic."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "stock-screener-ui"))
import pandas as pd, numpy as np

USB_5M_MNQ="/media/mysyntax/LENOVO_USB_/cme-futures-ohlc-main/MNQ/MNQ_5min_20260120_20260415.csv"
USB_5M_ES="/media/mysyntax/LENOVO_USB_/cme-futures-ohlc-main/NQ/../ES/ES_5min_20260120_20260415.csv"
# actually ES path
USB_5M_ES="/media/mysyntax/LENOVO_USB_/cme-futures-ohlc-main/ES/ES_5min_20260120_20260415.csv"

def load_5m(path):
    df=pd.read_csv(path, parse_dates=["datetime"])
    df["datetime"]=pd.to_datetime(df["datetime"])
    if df["datetime"].dt.tz is None: df["datetime"]=df["datetime"].dt.tz_localize("UTC")
    else: df["datetime"]=df["datetime"].dt.tz_convert("UTC")
    df=df.set_index("datetime").sort_index()
    df.index=df.index.tz_convert("America/New_York")
    df["day"]=df.index.normalize()
    mins=df.index.hour*60+df.index.minute
    df=df[(mins>=570)&(mins<960)]
    return df

def resample_to(df5, tf_min):
    # df5 is 5m RTH, resample to tf_min
    rule=f"{tf_min}min"
    agg={"open":"first","high":"max","low":"min","close":"last","volume":"sum","day":"first"}
    # need to keep day column, but resample will group
    df=df5.copy()
    # use index for resample
    df_r=df.resample(rule).agg({"open":"first","high":"max","low":"min","close":"last","volume":"sum"}).dropna(subset=["close"])
    df_r["day"]=df_r.index.normalize()
    # keep only RTH (already filtered, but resampled bins aligned to clock, should stay RTH)
    mins=df_r.index.hour*60+df_r.index.minute
    df_r=df_r[(mins>=570)&(mins<960)]
    return df_r

def test_db(df_htf, tol=0.4, rr=2.0):
    lows=df_htf["low"].to_numpy(float); highs=df_htf["high"].to_numpy(float)
    closes=df_htf["close"].to_numpy(float); opens=df_htf["open"].to_numpy(float)
    vols=df_htf["volume"].to_numpy(float)
    n=len(df_htf)
    # pivot lows
    piv=[]
    for i in range(2, n-2):
        if lows[i] < min(lows[i-2], lows[i-1], lows[i+1], lows[i+2]):
            piv.append(i)
    trades=[]
    for a in range(len(piv)):
        i1=piv[a]
        for b in range(a+1, len(piv)):
            i2=piv[b]
            sep=i2-i1
            if sep<6 or sep>40: continue
            L1, L2 = lows[i1], lows[i2]
            tol_pct=abs(L2-L1)/((L1+L2)/2)*100
            if tol_pct>0.4: continue
            neck=highs[i1+1:i2].max() if i2>i1+1 else highs[i1]
            height=neck - min(L1,L2)
            if height<12: continue
            # breakout close > neck with vol
            for k in range(i2+1, min(i2+12, n)):
                if closes[k] > neck and vols[k] > np.median(vols[max(0,k-10):k]):
                    entry=closes[k]
                    sl=min(L1,L2)-4
                    dist=entry-sl
                    if dist<=0: break
                    tp=entry+rr*dist
                    for j in range(k+1, n):
                        # same day check
                        if df_htf.index[j].normalize() != df_htf.index[k].normalize(): break
                        if df_htf.iloc[j]["low"] <= sl:
                            trades.append(-1); break
                        if df_htf.iloc[j]["high"] >= tp:
                            trades.append(rr); break
                    else:
                        # EOD
                        px=closes[-1]
                        # find EOD for that day
                        day=df_htf.index[k].normalize()
                        eod_idx = df_htf.index.get_indexer([df_htf.index[df_htf.index.normalize()==day][-1]])[0]
                        px=df_htf.iloc[eod_idx]["close"] if eod_idx < n else closes[-1]
                        r=(px-entry)/dist - 0.25/dist
                        trades.append(r)
                    break
            if trades: # one per W pair, break to next day? simplify one trade per day
                pass
        # limit one trade per day, break after first
        if trades: break
    return trades

for symbol, path in [("MNQ",USB_5M_MNQ),("ES",USB_5M_ES)]:
    print(f"\n=== {symbol} higher TFs Double Bottom (W) tol0.4 RR2 ===")
    df5=load_5m(path)
    print(f" 5m RTH {len(df5)} bars {df5.index[0].date()}->{df5.index[-1].date()} {df5['day'].nunique()} days")
    for tf in [15,30,60]:
        df_htf=resample_to(df5, tf)
        if len(df_htf)<50:
            print(f" TF{tf}: too few {len(df_htf)}")
            continue
        # group by day for per-day W, but our test_db is global pivot across days — need per-day split
        # redo per-day
        rows=[]
        for day,g in df_htf.groupby(df_htf.index.normalize()):
            if len(g)<20: continue
            tr=test_db(g, tol=0.4, rr=2.0)
            rows.extend(tr)
        arr=np.array(rows)
        if len(arr)==0:
            print(f" TF{tf:2d}: n=0")
        else:
            pf=arr[arr>0].sum()/abs(arr[arr<0].sum()) if (arr<0).any() else 99
            print(f" TF{tf:2d}: n={len(arr):2d} win{(arr>0).mean()*100:4.1f}% PF{pf:.2f} avg{arr.mean():+.3f} net{(1+0.01*arr).prod()-1:+.1%}")
        # also test RR3
        rows3=[]
        for day,g in df_htf.groupby(df_htf.index.normalize()):
            if len(g)<20: continue
            tr=test_db(g, tol=0.4, rr=3.0)
            rows3.extend(tr)
        arr3=np.array(rows3)
        if len(arr3):
            pf3=arr3[arr3>0].sum()/abs(arr3[arr3<0].sum()) if (arr3<0).any() else 99
            print(f"   RR3: n={len(arr3):2d} PF{pf3:.2f} win{(arr3>0).mean()*100:.1f}%")

# also ORB on higher TF for comparison
print("\n=== ORB 15m range on higher TFs (ES) — no-retest TP1.2 eff>=0.50 ===")
import importlib.util
# reuse load
for tf in [15,30,60]:
    df5=load_5m(USB_5M_ES)
    df_htf=resample_to(df5, tf)
    RANGE_BARS=15//tf if 15%tf==0 else 1
    if RANGE_BARS<1: continue
    rows=[]
    for day,g in df_htf.groupby(df_htf.index.normalize()):
        if len(g)<RANGE_BARS+6: continue
        rng=g.iloc[:RANGE_BARS]
        hi,lo=float(rng["high"].max()), float(rng["low"].min())
        eff=(hi-lo)/(rng["high"]-rng["low"]).sum() if (rng["high"]-rng["low"]).sum()>0 else 0
        if eff<0.50: continue
        body=g.iloc[RANGE_BARS:]
        o,h,l,c=[body[k].to_numpy(float) for k in ("open","high","low","close")]
        n=len(body)
        broke=next((i for i in range(n) if c[i]>hi or c[i]<lo), None)
        if broke is None: continue
        side=1 if c[broke]>hi else -1
        fill=broke+1
        if fill>=n: continue
        entry=o[fill]; sl=lo if side==1 else hi; dist=abs(entry-sl)
        if dist==0: continue
        tp=entry+side*1.2*dist
        for j in range(fill,n):
            if (l[j]<=sl if side==1 else h[j]>=sl):
                rows.append(-1); break
            if (h[j]>=tp if side==1 else l[j]<=tp):
                rows.append(1.2); break
        else:
            px=c[-1]
            r=(px-entry)/dist if side==1 else (entry-px)/dist
            rows.append(r - 0.25/dist)
    arr=np.array(rows)
    pf=arr[arr>0].sum()/abs(arr[arr<0].sum()) if len(arr) and (arr<0).any() else 0
    print(f" TF{tf:2d} OR15: n={len(arr):2d} win{(arr>0).mean()*100 if len(arr) else 0:.1f}% PF{pf:.2f}")
