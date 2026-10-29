"""v3 model: HTF K-bar range breakout -> hold for a big move. Prints METRIC lines. IS=2025 OOS=2026."""
import json, pickle, os
import pandas as pd, numpy as np
HERE=os.path.dirname(os.path.abspath(__file__)); P=json.load(open(os.path.join(HERE,"params.json")))
DUKA="/tmp/opencode/duka_nq_1m.pkl"
def load1m():
    df=pickle.load(open(DUKA,"rb")); df=df.rename(columns={c:c.lower() for c in df.columns})
    if df.index.tz is None: df.index=df.index.tz_localize("UTC")
    df.index=df.index.tz_convert("America/New_York")
    m=df.index.hour*60+df.index.minute
    return df[(m>=570)&(m<960)][["open","high","low","close","volume"]].astype(float)
def resample(df,n):
    if n==1: return df.copy()
    o=pd.Timestamp(df.index[0].date(),tz="America/New_York")+pd.Timedelta(hours=9,minutes=30)
    return df.resample(f"{n}min",origin=o,label="left",closed="left").agg(
        open=("open","first"),high=("high","max"),low=("low","min"),close=("close","last"),volume=("volume","sum")).dropna()
LT=load1m(); HT=resample(LT,P["htf"])
hh,hl,hc,ho=HT["high"].values,HT["low"].values,HT["close"].values,HT["open"].values
hday=HT.index.normalize(); days=list(pd.Index(hday.unique())); dmap={x:j for j,x in enumerate(days)}
hdi=np.array([dmap[x] for x in hday])
N=len(HT); K=P["K"]
res=[]; seen=set()
for h in range(K+2, N-1):
    if hdi[h]!=hdi[h-1]: continue    # start-of-day bars skip (need prior range in the same session? allow)
    hiK=hh[h-K:h].max(); loK=hl[h-K:h].min()
    rng=hiK-loK
    if rng<=0: continue
    for direction in (1,-1):
        br = (hc[h]>hiK+P["brk"]*(rng*0 if P["brk"]==0 else 0)) and (hc[h]>hiK) if direction==1 else (hc[h]<loK)
        if direction==1 and not (hc[h]>hiK): continue
        if direction==-1 and not (hc[h]<loK): continue
        # size filter: the range must be meaningful vs ATR
        atr=(hh[max(0,h-14):h] - hl[max(0,h-14):h]).mean()
        if not np.isfinite(atr) or atr<=0: continue
        if rng < P["min_rng_atr"]*atr: continue
        entry=hc[h]
        sl=(hl[h]-P["sl_buf"]*atr) if direction==1 else (hh[h]+P["sl_buf"]*atr)
        if (direction==1 and entry<=sl) or (direction==-1 and entry>=sl): continue
        risk=abs(entry-sl)
        key=(h,direction)
        if key in seen: continue
        seen.add(key)
        # simulate forward on the HTF bars
        end=min(N-1, h+P["maxhold"])
        stop=sl; peak=entry; R=None
        for t in range(h+1,end+1):
            if ((hl[t]<=stop) if direction==1 else (hh[t]>=stop)):
                R=((stop-entry) if direction==1 else (entry-stop))/risk; break
            if P["exit"]=="trail":
                peak=max(peak,hh[t]) if direction==1 else min(peak,hl[t])
                pf=(peak-entry) if direction==1 else (entry-peak)
                if pf>P["trail"]*risk: stop=(peak-P["trail"]*risk) if direction==1 else (peak+P["trail"]*risk)
            elif P["exit"]=="fixed":
                tgt=entry+P["fixed_R"]*risk if direction==1 else entry-P["fixed_R"]*risk
                if ((hh[t]>=tgt) if direction==1 else (hl[t]<=tgt)):
                    R=P["fixed_R"]; break
            if t-h>=P["maxhold"]: 
                R=((hc[t]-entry) if direction==1 else (entry-hc[t]))/risk; break
        if R is None:
            R=((hc[end]-entry) if direction==1 else (entry-hc[end]))/risk if end>h else 0.0
        res.append((HT.index[h],float(R)))
T=pd.DataFrame(res,columns=["ts","R"]); T["yr"]=pd.to_datetime(T["ts"]).dt.year
IS=T[T.yr<=2025]; OOS=T[T.yr>=2026]
def pf(r): gp=r[r>0].sum(); gl=-r[r<0].sum(); return gp/gl if gl>0 else 99.0
print(f"METRIC is_avgR={IS.R.mean() if len(IS) else 0:.4f}")
print(f"METRIC oos_avgR={OOS.R.mean() if len(OOS) else 0:.4f}")
print(f"METRIC oos_n={len(OOS)}")
print(f"METRIC total_n={len(T)}")
print(f"METRIC oos_pf={pf(OOS.R.values):.2f}")
print(f"METRIC oos_win={(OOS.R>0).mean()*100 if len(OOS) else 0:.0f}")
print(f"METRIC oos_best={OOS.R.max() if len(OOS) else 0:.1f}")
print(f"METRIC oos_rpermo={OOS.R.sum()/max(1,len(set(pd.to_datetime(OOS.ts).dt.to_period('M')))):.1f}")
