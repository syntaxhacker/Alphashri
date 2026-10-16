"""v2 model: HTF (15m/1h) liquidity sweep -> LTF (1m) iFVG retrace entry -> SL at HTF sweep -> exit.
Params in params.json. Prints METRIC lines. IS=2025 OOS=2026 (walk-forward)."""
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
lh,ll,lc,lo_,lp=LT["high"].values,LT["low"].values,LT["close"].values,LT["open"].values,None
hh,hl,hc,hg=HT["high"].values,HT["low"].values,HT["close"].values,HT["open"].values
hmin=HT.index.hour*60+HT.index.minute
N=len(LT)
# map each 1m bar -> HTF bar index (the last completed HTF bar start)
hpos=np.searchsorted(HT.index, LT.index, side="right")-1
# HTF fractal pivots
hw=2
his_ph=np.zeros(len(HT),bool); his_pl=np.zeros(len(HT),bool)
for i in range(hw,len(HT)-hw):
    if hh[i]==max(hh[i-hw:i+hw+1]): his_ph[i]=True
    if hl[i]==min(hl[i-hw:i+hw+1]): his_pl[i]=True
# precompute HTF daily levels
hday=HT.index.normalize(); days=list(pd.Index(hday.unique())); dmap={x:j for j,x in enumerate(days)}
hdi=np.array([dmap[x] for x in hday])
hdpd=HT.groupby(hday) if False else None
hdaily=HT.groupby("day" if "day" in HT else hday)
lt_atr=(LT["high"]-LT["low"]).rolling(14).mean().values

def scan():
    res=[]; seen=set()
    lt_mins=LT.index.hour*60+LT.index.minute
    for hi_ in range(P["htf_look"]+2, len(HT)-1):
        # sweep of prior HTF swing low/high
        seg_lo=hl[max(0,hi_-P["htf_look"]):hi_]; seg_hi=hh[max(0,hi_-P["htf_look"]):hi_]
        dirs=[]
        if len(seg_lo) and hl[hi_]<seg_lo.min()-P["htf_buf"] and hc[hi_]>seg_lo.min(): dirs.append(1)
        if len(seg_hi) and hh[hi_]>seg_hi.max()+P["htf_buf"] and hc[hi_]<seg_hi.max(): dirs.append(-1)
        if not dirs: continue
        # 1m window after the HTF bar start (the sweep bar spans [t0, t0+htf))
        t0=HT.index[hi_]
        # find the first 1m bar index at/after the HTF bar END
        t_end=t0+pd.Timedelta(minutes=P["htf"])
        j0=np.searchsorted(LT.index, t_end)
        if j0>=N: continue
        j1=min(N, j0+P["ltf_win"])
        for direction in dirs:
            level=(seg_lo.min() if direction==1 else seg_hi.max())
            sweep_ext=(hl[hi_] if direction==1 else hh[hi_])
            # find iFVG on the 1m
            found=None
            for kk in range(j0+1, j1-2):
                rng=lh[kk]-ll[kk]; body=(lc[kk]-lo_[kk]) if direction==1 else (lo_[kk]-lc[kk])
                if rng<=0 or body/rng<P["disp_body"] or rng<P["atr_mult"]*lt_atr[kk]: continue
                if direction==1 and ll[kk]>lh[kk-2] and P["fvg_min"]<=ll[kk]-lh[kk-2]<=P["fvg_max_atr"]*lt_atr[kk]: found=(kk,lh[kk-2],ll[kk]); break
                if direction==-1 and lh[kk]<ll[kk-2] and P["fvg_min"]<=ll[kk-2]-lh[kk]<=P["fvg_max_atr"]*lt_atr[kk]: found=(kk,ll[kk-2],lh[kk]); break
            if not found: continue
            kk,a,b=found; mid=(a+b)/2; e=None
            for t in range(kk+1,min(kk+1+P["entry_win"],N)):
                if ll[t]<=mid<=lh[t]: e=t; break
            if e is None: continue
            entry=float(mid); sl=sweep_ext-P["sl_buf"] if direction==1 else sweep_ext+P["sl_buf"]
            if (direction==1 and entry<=sl) or (direction==-1 and entry>=sl): continue
            risk=abs(entry-sl)
            key=(hi_,direction,round(level,1))
            if key in seen: continue
            seen.add(key)
            end=min(N,e+1+P["time_bars"]); R=None; last=end-1
            for t in range(e+1,end):
                if ((ll[t]<=sl) if direction==1 else (lh[t]>=sl)): R=((sl-entry) if direction==1 else (entry-sl))/risk; break
                if t-e>=P["time_bars"]: R=((lc[t]-entry) if direction==1 else (entry-lc[t]))/risk; last=t; break
            if R is None: R=((lc[last]-entry) if direction==1 else (entry-lc[last]))/risk
            res.append((LT.index[e],float(R),int(e)))
    return res
tr=scan()
T=pd.DataFrame(tr,columns=["ts","R","e"]); T["yr"]=pd.to_datetime(T["ts"]).dt.year
IS=T[T.yr<=2025]; OOS=T[T.yr>=2026]
def pf(r): gp=r[r>0].sum(); gl=-r[r<0].sum(); return gp/gl if gl>0 else 99.0
print(f"METRIC is_avgR={IS.R.mean() if len(IS) else 0:.4f}")
print(f"METRIC oos_avgR={OOS.R.mean() if len(OOS) else 0:.4f}")
print(f"METRIC oos_n={len(OOS)}")
print(f"METRIC is_n={len(IS)}")
print(f"METRIC oos_pf={pf(OOS.R.values):.2f}")
print(f"METRIC oos_win={(OOS.R>0).mean()*100 if len(OOS) else 0:.0f}")
print(f"METRIC total_n={len(T)} avgR={T.R.mean() if len(T) else 0:.4f}")
