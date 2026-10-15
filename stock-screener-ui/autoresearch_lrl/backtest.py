"""Benchmark v2: LRL strategy — sweep -> iFVG -> retrace entry -> exit.
Corrected intrabar sim (stop checked before peak update). Tracks hold bars. Filters: session, trend.
IS = 2025, OOS = 2026. Params in params.json. Prints METRIC lines."""
import json, pickle, os
import pandas as pd, numpy as np
HERE=os.path.dirname(os.path.abspath(__file__)); DUKA="/tmp/opencode/duka_nq_1m.pkl"
P=json.load(open(os.path.join(HERE,"params.json"))); TF=P.get("tf",1)
def load():
    df=pickle.load(open(DUKA,"rb")); df=df.rename(columns={c:c.lower() for c in df.columns})
    if df.index.tz is None: df.index=df.index.tz_localize("UTC")
    df.index=df.index.tz_convert("America/New_York")
    mm=df.index.hour*60+df.index.minute
    return df[(mm>=570)&(mm<960)][["open","high","low","close","volume"]].astype(float)
def resample(raw,n):
    if n==1: return raw.copy()
    o=pd.Timestamp(raw.index[0].date(),tz="America/New_York")+pd.Timedelta(hours=9,minutes=30)
    return raw.resample(f"{n}min",origin=o,label="left",closed="left").agg(
        open=("open","first"),high=("high","max"),low=("low","min"),close=("close","last"),volume=("volume","sum")).dropna()
def scan(df,direction):
    buf,md,db,am,slb=P["buf"],P["maxdist"],P["disp_body"],P["atr_mult"],P["sl_buf"]
    fmin,fmax,ld,ew,hor,k=P["fvg_min"],P["fvg_max_atr"],P["look_disp"],P["entry_win"],P["horizon"],P["trail"]
    ex=P.get("exit","trail"); fx=P.get("fixed_R",2.0); tb=P.get("time_bars",10); be=P.get("be",0.0)
    ss,se=P.get("sess_start",570),P.get("sess_end",960); tr=P.get("trend","none")
    d=df.copy(); d["day"]=d.index.normalize()
    mins=d.index.hour*60+d.index.minute
    hi,lo,cl,op=d["high"].values,d["low"].values,d["close"].values,d["open"].values
    atr=(d["high"]-d["low"]).rolling(14).mean().values
    ema=pd.Series(cl).ewm(span=200).mean().values
    N=len(d); w=3
    is_ph=np.zeros(N,bool); is_pl=np.zeros(N,bool)
    for i in range(w,N-w):
        if hi[i]==max(hi[i-w:i+w+1]): is_ph[i]=True
        if lo[i]==min(lo[i-w:i+w+1]): is_pl[i]=True
    days=list(pd.Index(d["day"].unique())); dmap={x:j for j,x in enumerate(days)}
    di=np.array([dmap[x] for x in d["day"]])
    daily=d.groupby("day").agg(dh=("high","max"),dl=("low","min"),do=("open","first"))
    pdh=np.full(len(days),np.nan); pdl=np.full(len(days),np.nan)
    for j in range(1,len(days)): pdh[j]=daily["dh"].iloc[j-1]; pdl[j]=daily["dl"].iloc[j-1]
    hb=max(1,int(round(hor/TF))); seen=set(); out=[]
    for i in range(40,N-3):
        if not np.isfinite(atr[i]) or atr[i]<=0: continue
        if mins[i]<ss or mins[i]>=se: continue
        j=di[i]
        if direction==1:
            c=[lo[t] for t in range(max(0,i-40),i) if is_pl[t]]
            if not np.isnan(pdl[j]): c.append(pdl[j])
            lv=[x for x in c if lo[i]<x-buf and lo[i]>=x-md]
            if not lv: continue
            level=max(lv)
            if not (lo[i]<level-buf and cl[i]>level): continue
        else:
            c=[hi[t] for t in range(max(0,i-40),i) if is_ph[t]]
            if not np.isnan(pdh[j]): c.append(pdh[j])
            lv=[x for x in c if hi[i]>x+buf and hi[i]<=x+md]
            if not lv: continue
            level=min(lv)
            if not (hi[i]>level+buf and cl[i]<level): continue
        if tr=="ema200":
            if direction==1 and cl[i]<ema[i]: continue
            if direction==-1 and cl[i]>ema[i]: continue
        if tr=="dayopen":
            do=float(daily["do"].iloc[j])
            if direction==1 and cl[i]<do: continue
            if direction==-1 and cl[i]>do: continue
        key=(j,direction,round(level,1))
        if key in seen: continue
        found=None
        for kk in range(i+1,min(i+1+ld,N-2)):
            if di[kk]!=di[kk-1] or di[kk]!=di[kk-2]: continue
            rng=hi[kk]-lo[kk]; body=(cl[kk]-op[kk]) if direction==1 else (op[kk]-cl[kk])
            if rng<=0 or body/rng<db or rng<am*atr[kk]: continue
            if direction==1 and lo[kk]>hi[kk-2]:
                g=lo[kk]-hi[kk-2]
                if fmin<=g<=fmax*atr[kk]: found=(kk,hi[kk-2],lo[kk]); break
            if direction==-1 and hi[kk]<lo[kk-2]:
                g=lo[kk-2]-hi[kk]
                if fmin<=g<=fmax*atr[kk]: found=(kk,lo[kk-2],hi[kk]); break
        if not found: continue
        kk,a,b=found
        if di[kk]!=di[i] or (direction==1 and a<=lo[i]) or (direction==-1 and b>=hi[i]): continue
        e=None
        for t in range(kk+1,min(kk+1+ew,N)):
            if direction==1 and lo[t]<=b and hi[t]>=a: e=t; break
            if direction==-1 and hi[t]>=b and lo[t]<=a: e=t; break
        if e is None or di[e]!=di[i]: continue
        entry=float(cl[e]); sl=lo[i]-slb if direction==1 else hi[i]+slb
        if (direction==1 and entry<=sl) or (direction==-1 and entry>=sl): continue
        risk=abs(entry-sl)
        seen.add(key); day_end=e+1
        while day_end<N and di[day_end]==di[i]: day_end+=1
        end=min(N,e+1+hb,day_end); stop=sl; peak=entry; R=None; hold=0; tgt=entry+fx*risk if direction==1 else entry-fx*risk
        for t in range(e+1,end):
            hold=t-e
            fwd=(hi[t]>=tgt) if direction==1 else (lo[t]<=tgt)
            adv=(lo[t]<=stop) if direction==1 else (hi[t]>=stop)
            if ex=="fixed":
                if adv: R=((stop-entry) if direction==1 else (entry-stop))/risk; break
                if fwd: R=fx; break
            elif ex=="time":
                if adv: R=((stop-entry) if direction==1 else (entry-stop))/risk; break
                if hold>=tb:
                    px=cl[t]; R=((px-entry) if direction==1 else (entry-px))/risk; break
            else:
                if adv: R=((stop-entry) if direction==1 else (entry-stop))/risk; break
                peak=max(peak,hi[t]) if direction==1 else min(peak,lo[t])
                pfx=(peak-entry) if direction==1 else (entry-peak)
                if pfx>0: stop=(peak-k*risk) if direction==1 else (peak+k*risk)
                if be>0 and pfx>=be*risk: stop=max(stop,entry) if direction==1 else min(stop,entry)
        if R is None:
            px=cl[end-1]; R=((px-entry) if direction==1 else (entry-px))/risk; hold=end-1-e
        out.append((df.index[e],float(R),hold))
    return out
raw=load(); df=resample(raw,TF)
tr=[]
for s in (1,-1): tr+=scan(df,s)
t=pd.DataFrame(tr,columns=["ts","R","hold"]); t["yr"]=pd.to_datetime(t["ts"]).dt.year
IS=t[t.yr<=2025]; OOS=t[t.yr>=2026]
def pf(r):
    gp=r[r>0].sum(); gl=-r[r<0].sum(); return gp/gl if gl>0 else float("inf")
print(f"METRIC is_avgR={IS.R.mean() if len(IS) else 0:.4f}")
print(f"METRIC oos_avgR={OOS.R.mean() if len(OOS) else 0:.4f}")
print(f"METRIC oos_n={len(OOS)}")
print(f"METRIC is_n={len(IS)}")
print(f"METRIC oos_pf={pf(OOS.R.values):.2f}")
print(f"METRIC oos_win={(OOS.R>0).mean()*100 if len(OOS) else 0:.0f}")
print(f"METRIC oos_hold={int(OOS.hold.median()) if len(OOS) else 0}")
print(f"METRIC is_hold={int(IS.hold.median()) if len(IS) else 0}")
print(f"METRIC oos_frac0={(OOS.hold<3).mean()*100 if len(OOS) else 0:.0f}")
