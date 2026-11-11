"""Rolling prop eval for the frozen best LRL config (reads best_r5.json)."""
import json, pickle, os
import pandas as pd, numpy as np
HERE=os.path.dirname(os.path.abspath(__file__))
P=json.load(open(os.path.join(HERE,"best_r5.json"))); TF=P["tf"]
DUKA="/tmp/opencode/duka_nq_1m.pkl"; PT=2.0
def load():
    df=pickle.load(open(DUKA,"rb")); df=df.rename(columns={c:c.lower() for c in df.columns})
    if df.index.tz is None: df.index=df.index.tz_localize("UTC")
    df.index=df.index.tz_convert("America/New_York")
    mm=df.index.hour*60+df.index.minute
    return df[(mm>=570)&(mm<960)][["open","high","low","close","volume"]].astype(float)
raw=load(); df=raw
buf,md,db,am,slb=P["buf"],P["maxdist"],P["disp_body"],P["atr_mult"],P["sl_buf"]
fmin,fmax,ld,ew,hor=P["fvg_min"],P["fvg_max_atr"],P["look_disp"],P["entry_win"],P["horizon"]
ss,se=P["sess_start"],P["sess_end"]; tb=P["time_bars"]
d=df.copy(); d["day"]=d.index.normalize(); mins=d.index.hour*60+d.index.minute
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
out=[]; seen=set()
for direction in (1,-1):
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
    end=min(N,e+1+max(1,int(round(hor/TF))),day_end); R=None
    for t in range(e+1,end):
        if ((lo[t]<=sl) if direction==1 else (hi[t]>=sl)):
            R=((sl-entry) if direction==1 else (entry-sl))/risk; break
        if t-e>=tb:
            px=cl[t]; R=((px-entry) if direction==1 else (entry-px))/risk; break
    if R is None:
        px=cl[end-1]; R=((px-entry) if direction==1 else (entry-px))/risk
    out.append((d.index[e],float(R),float(risk)))
T=pd.DataFrame(out,columns=["ts","R","risk"]).sort_values("ts").reset_index(drop=True)
T["date"]=pd.to_datetime(T["ts"]).dt.date
print(f"trades {len(T)}  avgR {T.R.mean():+.3f}  win {(T.R>0).mean()*100:.0f}%")

def sim_from(i,risk_pct,target=3000.0,ddlim=2000.0,dailylim=1000.0,day_stop=800.0,cost=1.5):
    risk0=50000.0*risk_pct; eq=50000.0; peak=50000.0; day=0.0; cur=None; days=0
    for k in range(i,len(T)):
        r=T.iloc[k]
        if r["date"]!=cur: cur=r["date"]; day=0.0; days+=1
        if day<=-day_stop: continue
        ct=max(1,int(risk0//(r["risk"]*PT))); ru=ct*r["risk"]*PT
        net=r["R"]*ru - ct*cost; eq+=net; day+=net; peak=max(peak,eq)
        if peak-eq>ddlim: return ("FAIL_DD",days)
        if eq-50000.0>=target: return ("PASS",days)
    return ("NO_END",days)

for rp in (0.005,0.0035,0.0025):
    res=[sim_from(i,rp) for i in range(0,max(1,len(T)-15),2)]
    p=sum(1 for r,_ in res if r=="PASS"); fdd=sum(1 for r,_ in res if r=="FAIL_DD"); fen=sum(1 for r,_ in res if r=="NO_END")
    dd=[d for r,d in res if r=="PASS"]
    print(f"risk {rp*100:.2f}%: starts={len(res)} PASS={p} FAIL_DD={fdd} NO_END={fen} median_days={int(np.median(dd)) if dd else '-'}")
