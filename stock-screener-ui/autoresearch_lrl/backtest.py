"""Benchmark: MNQ/NQ LRL strategy — sweep -> iFVG -> retrace entry -> exit.
Walk-forward: IS = 2025, OOS = 2026.  Params in autoresearch_lrl/params.json.
Prints METRIC name=value lines."""
import json, pickle, sys, os
import pandas as pd, numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DUKA = "/tmp/opencode/duka_nq_1m.pkl"
P = json.load(open(os.path.join(HERE, "params.json")))
TF = P.get("tf", 5)

def load():
    df = pickle.load(open(DUKA, "rb")); df = df.rename(columns={c: c.lower() for c in df.columns})
    if df.index.tz is None: df.index = df.index.tz_localize("UTC")
    df.index = df.index.tz_convert("America/New_York")
    m = df.index.hour * 60 + df.index.minute
    return df[(m >= 570) & (m < 960)][["open", "high", "low", "close", "volume"]].astype(float)

def resample(raw, n):
    if n == 1: return raw.copy()
    o = pd.Timestamp(raw.index[0].date(), tz="America/New_York") + pd.Timedelta(hours=9, minutes=30)
    return raw.resample(f"{n}min", origin=o, label="left", closed="left").agg(
        open=("open","first"), high=("high","max"), low=("low","min"), close=("close","last"), volume=("volume","sum")).dropna()

def scan(df, direction):
    buf=P.get("buf",2.0); maxdist=P.get("maxdist",45.0)
    db=P.get("disp_body",0.55); am=P.get("atr_mult",1.2); fmin=P.get("fvg_min",3.0); fmaxatr=P.get("fvg_max_atr",3.0)
    ld=P.get("look_disp",5); ewin=P.get("entry_win",15); slb=P.get("sl_buf",2.0)
    horizon=P.get("horizon",240); k=P.get("trail",0.5); mode=P.get("exit","trail"); fx=P.get("fixed_R",2.0)
    d=df.copy(); d["day"]=d.index.normalize()
    hi,lo,cl,op=d["high"].values,d["low"].values,d["close"].values,d["open"].values
    atr=(d["high"]-d["low"]).rolling(14).mean().values; N=len(d); w=3
    is_ph=np.zeros(N,bool); is_pl=np.zeros(N,bool)
    for i in range(w,N-w):
        if hi[i]==max(hi[i-w:i+w+1]): is_ph[i]=True
        if lo[i]==min(lo[i-w:i+w+1]): is_pl[i]=True
    days=list(pd.Index(d["day"].unique())); dmap={x:j for j,x in enumerate(days)}
    di=np.array([dmap[x] for x in d["day"]])
    daily=d.groupby("day").agg(dh=("high","max"),dl=("low","min"))
    pdh=np.full(len(days),np.nan); pdl=np.full(len(days),np.nan)
    for j in range(1,len(days)): pdh[j]=daily["dh"].iloc[j-1]; pdl[j]=daily["dl"].iloc[j-1]
    hb=max(1,int(round(horizon/d["day"].nunique() and horizon/TF)))
    seen=set(); out=[]
    for i in range(40,N-3):
        if not np.isfinite(atr[i]) or atr[i]<=0: continue
        j=di[i]
        if direction==1:
            c=[lo[t] for t in range(max(0,i-40),i) if is_pl[t]]
            if not np.isnan(pdl[j]): c.append(pdl[j])
            lv=[x for x in c if lo[i]<x-buf and lo[i]>=x-maxdist]
            if not lv: continue
            level=max(lv)
            if not (lo[i]<level-buf and cl[i]>level): continue
        else:
            c=[hi[t] for t in range(max(0,i-40),i) if is_ph[t]]
            if not np.isnan(pdh[j]): c.append(pdh[j])
            lv=[x for x in c if hi[i]>x+buf and hi[i]<=x+maxdist]
            if not lv: continue
            level=min(lv)
            if not (hi[i]>level+buf and cl[i]<level): continue
        key=(j,direction,round(level,1))
        if key in seen: continue
        found=None
        for kk in range(i+1,min(i+1+ld,N-2)):
            if di[kk]!=di[kk-1] or di[kk]!=di[kk-2]: continue
            rng=hi[kk]-lo[kk]; body=(cl[kk]-op[kk]) if direction==1 else (op[kk]-cl[kk])
            if rng<=0 or body/rng<db or rng<am*atr[kk]: continue
            if direction==1 and lo[kk]>hi[kk-2]:
                g=lo[kk]-hi[kk-2]
                if fmin<=g<=fmaxatr*atr[kk]: found=(kk,hi[kk-2],lo[kk]); break
            if direction==-1 and hi[kk]<lo[kk-2]:
                g=lo[kk-2]-hi[kk]
                if fmin<=g<=fmaxatr*atr[kk]: found=(kk,lo[kk-2],hi[kk]); break
        if not found: continue
        kk,a,b=found
        if di[kk]!=di[i]: continue
        if direction==1 and a<=lo[i]: continue
        if direction==-1 and b>=hi[i]: continue
        e=None
        for t in range(kk+1,min(kk+1+ewin,N)):
            if direction==1 and lo[t]<=b and hi[t]>=a: e=t; break
            if direction==-1 and hi[t]>=b and lo[t]<=a: e=t; break
        if e is None or di[e]!=di[i]: continue
        entry=float(cl[e]); sl=lo[i]-slb if direction==1 else hi[i]+slb
        if (direction==1 and entry<=sl) or (direction==-1 and entry>=sl): continue
        risk=abs(entry-sl)
        if risk<=0: continue
        seen.add(key)
        day_end=e+1
        while day_end<N and di[day_end]==di[i]: day_end+=1
        end=min(N,e+1+hb,day_end)
        stop=sl; peak=entry; R=None
        for t in range(e+1,end):   # entry at bar e's close; trade lives from e+1 (no look-ahead)
            if mode=="trail":
                peak=max(peak,hi[t]) if direction==1 else min(peak,lo[t])
                pf=(peak-entry) if direction==1 else (entry-peak)
                if pf>0: stop=(peak-k*risk) if direction==1 else (peak+k*risk)
                if ((lo[t]<=stop) if direction==1 else (hi[t]>=stop)):
                    R=((stop-entry) if direction==1 else (entry-stop))/risk; break
            else:
                if ((lo[t]<=sl) if direction==1 else (hi[t]>=sl)): R=-1.0; break
                tgt=entry+fx*risk if direction==1 else entry-fx*risk
                if ((hi[t]>=tgt) if direction==1 else (lo[t]<=tgt)): R=fx; break
        if R is None:
            px=cl[end-1]; R=((px-entry) if direction==1 else (entry-px))/risk
        out.append((df.index[i], float(R)))
    return out

raw=load()
months1={"1":1,"5":5}[str(TF)]
df=resample(raw, months1)
trades=[]
for s in (1,-1): trades+=scan(df,s)
t=pd.DataFrame(trades, columns=["ts","R"])
t["yr"]=pd.to_datetime(t["ts"]).dt.year
IS=t[t.yr<=2025]; OOS=t[t.yr>=2026]
def pf(r): 
    gp=r[r>0].sum(); gl=-r[r<0].sum(); return gp/gl if gl>0 else float("inf")
print(f"METRIC is_avgR={IS.R.mean() if len(IS) else 0:.4f}")
print(f"METRIC oos_avgR={OOS.R.mean() if len(OOS) else 0:.4f}")
print(f"METRIC oos_sumR={OOS.R.sum() if len(OOS) else 0:.1f}")
print(f"METRIC is_sumR={IS.R.sum() if len(IS) else 0:.1f}")
print(f"METRIC oos_n={len(OOS)}")
print(f"METRIC oos_pf={pf(OOS.R.values):.2f}")
print(f"METRIC oos_win={(OOS.R>0).mean()*100 if len(OOS) else 0:.0f}")
