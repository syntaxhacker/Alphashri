"""Prop eval for the v3 breakout model. $50k, rolling, daily breaker."""
import pickle, json, os
import pandas as pd, numpy as np
HERE=os.path.dirname(os.path.abspath(__file__))
def load1m():
    df=pickle.load(open("/tmp/opencode/duka_nq_1m.pkl","rb")); df=df.rename(columns={c:c.lower() for c in df.columns})
    if df.index.tz is None: df.index=df.index.tz_localize("UTC")
    df.index=df.index.tz_convert("America/New_York")
    m=df.index.hour*60+df.index.minute
    return df[(m>=570)&(m<960)][["open","high","low","close","volume"]].astype(float)
def resample(df,n):
    o=pd.Timestamp(df.index[0].date(),tz="America/New_York")+pd.Timedelta(hours=9,minutes=30)
    return df.resample(f"{n}min",origin=o,label="left",closed="left").agg(
        open=("open","first"),high=("high","max"),low=("low","min"),close=("close","last"),volume=("volume","sum")).dropna()
LT=load1m()
def build(htf,K,trail,maxhold):
    HT=resample(LT,htf); hh,hl,hc=HT["high"].values,HT["low"].values,HT["close"].values
    hday=HT.index.normalize(); days=list(pd.Index(hday.unique())); dmap={x:j for j,x in enumerate(days)}
    hdi=np.array([dmap[x] for x in hday]); N=len(HT); res=[]; seen=set()
    for h in range(K+2,N-1):
        if hdi[h]!=hdi[h-1]: continue
        hiK=hh[h-K:h].max(); loK=hl[h-K:h].min()
        atr=(hh[max(0,h-14):h]-hl[max(0,h-14):h]).mean()
        if not np.isfinite(atr) or atr<=0: continue
        for direction in (1,-1):
            if direction==1 and not (hc[h]>hiK): continue
            if direction==-1 and not (hc[h]<loK): continue
            entry=hc[h]; sl=(hl[h]-0.2*atr) if direction==1 else (hh[h]+0.2*atr)
            if (direction==1 and entry<=sl) or (direction==-1 and entry>=sl): continue
            risk=abs(entry-sl)
            key=(h,direction)
            if key in seen: continue
            seen.add(key)
            end=min(N-1,h+maxhold); stop=sl; peak=entry; R=None
            for t in range(h+1,end+1):
                if ((hl[t]<=stop) if direction==1 else (hh[t]>=stop)): R=((stop-entry) if direction==1 else (entry-stop))/risk; break
                peak=max(peak,hh[t]) if direction==1 else min(peak,hl[t])
                pf=(peak-entry) if direction==1 else (entry-peak)
                if pf>trail*risk: stop=(peak-trail*risk) if direction==1 else (peak+trail*risk)
            if R is None: R=((hc[end]-entry) if direction==1 else (entry-hc[end]))/risk
            res.append((HT.index[h],float(R),float(risk),float(htf*risk*0)))
    return res
def prop(rows,acct,rp,target=3000.,dd=2000.,day_stop=800.,cost=4.,pt_val=2.,pt_per_R=1.0):
    risk0=acct*rp; eq=acct; pk=acct; day=0.; cur=None; dn=0
    for k in range(len(rows)):
        r=rows.iloc[k]
        if r["date"]!=cur: cur=r["date"]; day=0.; dn+=1
        if day<=-day_stop: continue
        net=r["R"]*risk0-cost; eq+=net; day+=net; pk=max(pk,eq)
        if pk-eq>dd: return ("FAIL_DD",dn)
        if eq-acct>=target: return ("PASS",dn)
    return ("NO_END",dn)
for lab,htf,K,trail,mh in [("htf30_K40_t1.25",30,40,1.25,20),("htf30_K60_t1",30,60,1.0,20),("htf15_K20_t1",15,20,1.0,20),("htf60_K40_t2",60,40,2.0,20)]:
    A=pd.DataFrame(build(htf,K,trail,mh),columns=["ts","R","risk","x"]).sort_values("ts").reset_index(drop=True)
    A["date"]=pd.to_datetime(A["ts"]).dt.date
    print(f"\n[{lab}] n={len(A)} win {(A.R>0).mean()*100:.0f}% avgR {A.R.mean():+.3f} R/mo {A.R.sum()/len(set(pd.to_datetime(A.ts).dt.to_period('M'))):.1f}")
    for rp in (0.0025,0.005,0.0075,0.01):
        res=[prop(A.iloc[i:].reset_index(drop=True),50000,rp) for i in range(0,max(1,len(A)-20),3)]
        p=sum(1 for r,_ in res if r=="PASS"); f=sum(1 for r,_ in res if r=="FAIL_DD"); ne=sum(1 for r,_ in res if r=="NO_END")
        dd=[d for r,d in res if r=="PASS"]
        print(f"  risk {rp*100:.2f}%: PASS {p}/{len(res)} FAIL_DD {f} NO_END {ne} median_days {int(np.median(dd)) if dd else '-'}")
