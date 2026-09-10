#!/usr/bin/env python
import json, sys
from pathlib import Path
import pandas as pd, yfinance as yf, numpy as np
REPO=Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")
RANGE_BARS=3 # 15m on 5m
COST_PT=1.0
def fetch_5min(period="1mo"):
    df=yf.download("ES=F", period=period, interval="5m", progress=False, auto_adjust=False)
    if isinstance(df.columns, pd.MultiIndex): df.columns=df.columns.get_level_values(0)
    df=df.rename(columns=str.lower)
    df.index=pd.to_datetime(df.index)
    if df.index.tz is None: df.index=df.index.tz_localize("UTC")
    else: df.index=df.index.tz_convert("UTC")
    b=df.resample("5min", label="left", closed="left").agg(open=("open","first"), high=("high","max"), low=("low","min"), close=("close","last"), volume=("volume","sum")).dropna(subset=["close"])
    et=b.index.tz_convert("America/New_York").tz_localize(None)
    rth_open=et.normalize()+pd.Timedelta(hours=9, minutes=30)
    off=(et-rth_open).total_seconds()/60
    mask=(off>=0)&(off<390)
    b=b[mask]
    b["day"]=et[mask].normalize()
    return b
b=fetch_5min("1mo")
print("fetched 5m days:", len(b["day"].unique()), sorted(set(b["day"].astype(str)))[:5], "...", sorted(set(b["day"].astype(str)))[-5:])
# filter August only
b_aug=b[b["day"]>=pd.Timestamp("2026-08-01")]
print("August days:", sorted(set(b_aug["day"].astype(str))))
def detail(g):
    if len(g)<RANGE_BARS+6: return None
    rng=g.iloc[:RANGE_BARS]
    hi,lo=float(rng["high"].max()), float(rng["low"].min())
    eff=(hi-lo)/(rng["high"]-rng["low"]).sum() if (rng["high"]-rng["low"]).sum()>0 else 0
    if eff<0.50: return None
    lows=rng["low"].to_numpy(float)
    hl=sum(lows[i]>lows[i-1] for i in range(1,3))
    ll=sum(lows[i]<lows[i-1] for i in range(1,3))
    body=g.iloc[RANGE_BARS:]
    times=body.index.tz_convert("America/New_York").strftime("%H:%M").tolist()
    o,h,l,c=[body[k].to_numpy(float) for k in ("open","high","low","close")]
    n=len(body)
    broke=next((i for i in range(n) if c[i]>hi or c[i]<lo), None)
    if broke is None: return None
    side=1 if c[broke]>hi else -1
    if side==1 and hl<2: return None
    if side==-1 and ll<2: return None
    fill=broke+1
    if fill>=n: return None
    entry=o[fill]
    sl=lo if side==1 else hi
    dist=abs(entry-sl)
    if dist==0: return None
    tp=entry+side*1.2*dist
    for j in range(fill,n):
        if (l[j]<=sl if side==1 else h[j]>=sl):
            return dict(side=side, hi=hi, lo=lo, edge=hi if side==1 else lo, stop=sl, tp=tp, breakout_t=times[broke], entry_t=times[fill], entry=entry, exit_t=times[j], exit=sl, reason="SL hit", R_net=-1 -1.0/dist, eff=eff, or_width=hi-lo, hl=hl, ll=ll, candles=dict(t=g.index.tz_convert("America/New_York").strftime("%H:%M").tolist(), o=g["open"].round(2).tolist(), h=g["high"].round(2).tolist(), l=g["low"].round(2).tolist(), c=g["close"].round(2).tolist()), or_highs=rng["high"].round(2).tolist(), or_lows=rng["low"].round(2).tolist(), day=str(g["day"].iloc[0].date()))
        if (h[j]>=tp if side==1 else l[j]<=tp):
            return dict(side=side, hi=hi, lo=lo, edge=hi if side==1 else lo, stop=sl, tp=tp, breakout_t=times[broke], entry_t=times[fill], entry=entry, exit_t=times[j], exit=tp, reason="TP hit (+1.2R)", R_net=1.2 -1.0/dist, eff=eff, or_width=hi-lo, hl=hl, ll=ll, candles=dict(t=g.index.tz_convert("America/New_York").strftime("%H:%M").tolist(), o=g["open"].round(2).tolist(), h=g["high"].round(2).tolist(), l=g["low"].round(2).tolist(), c=g["close"].round(2).tolist()), or_highs=rng["high"].round(2).tolist(), or_lows=rng["low"].round(2).tolist(), day=str(g["day"].iloc[0].date()))
    px=c[-1]
    r=(px-entry)/dist if side==1 else (entry-px)/dist
    r=r -1.0/dist
    return dict(side=side, hi=hi, lo=lo, edge=hi if side==1 else lo, stop=sl, tp=tp, breakout_t=times[broke], entry_t=times[fill], entry=entry, exit_t=times[-1], exit=px, reason="EOD flat", R_net=r, eff=eff, or_width=hi-lo, hl=hl, ll=ll, candles=dict(t=g.index.tz_convert("America/New_York").strftime("%H:%M").tolist(), o=g["open"].round(2).tolist(), h=g["high"].round(2).tolist(), l=g["low"].round(2).tolist(), c=g["close"].round(2).tolist()), or_highs=rng["high"].round(2).tolist(), or_lows=rng["low"].round(2).tolist(), day=str(g["day"].iloc[0].date()))

payload=[]
for day,g in b_aug.groupby("day"):
    d=detail(g)
    if not d:
        print(f"{day.date()} no trade/filtered")
        continue
    side_txt="LONG" if d["side"]==1 else "SHORT"
    color="#16a34a" if d["R_net"]>0 else "#dc2626"
    eff=d["eff"]; hl=d["hl"] if side_txt=="LONG" else d["ll"]
    payload.append({
        "date":str(day.date()), "title":day.strftime("%a %m-%d"), "side":side_txt,
        "range":[round(d["lo"],2),round(d["hi"],2)], "stop":round(d["stop"],2), "tp":round(d["tp"],2),
        "markers":[
            {"coord":[d["breakout_t"], d["edge"]],"symbol":"diamond","symbolSize":9,"itemStyle":{"color":"transparent","borderColor":"#e6a23c","borderWidth":2},"label":{"show":True,"formatter":"breakout","position":"top","fontSize":10,"color":"#e6a23c"}},
            {"coord":[d["entry_t"], d["entry"]],"symbol":"arrow","symbolSize":13,"symbolRotate":0 if d["side"]==1 else 180,"itemStyle":{"color":"#2563eb"},"label":{"show":True,"formatter":f"{side_txt} entry","position":"left" if d["side"]==1 else "right","fontSize":11,"fontWeight":"bold","color":"#2563eb"}},
            {"coord":[d["exit_t"], d["exit"]],"symbol":"circle","symbolSize":10,"itemStyle":{"color":color},"label":{"show":True,"formatter":f"{d['reason']} ({d['R_net']*100:+.2f}% eq)","position":"top","fontSize":11,"color":color}},
        ],
        "eff":round(float(eff),3),"or_width":round(float(d["or_width"]),2),"hl":int(hl),"is_choppy":eff<0.50,"chop_label":f"HL{hl}/2","chop_color":"#22c55e","R_net":float(d["R_net"]),
        "t":d["candles"]["t"],"o":d["candles"]["o"],"h":d["candles"]["h"],"l":d["candles"]["l"],"c":d["candles"]["c"],
        "or_highs":d["or_highs"],"or_lows":d["or_lows"],
    })
    print(f"{day.date()} {side_txt} eff{eff:.3f} HL{hl}/2 -> {d['reason']} R{d['R_net']:.2f}")

print(f"Total traded August: {len(payload)}")
if payload:
    import json
    REPO2=REPO
    echarts_js=(REPO2/"node_modules"/"echarts"/"dist"/"echarts.min.js").read_text()
    import sys; sys.path.insert(0,"/tmp/opencode"); import orb_showcase as os_
    def _jd(o):
        import numpy as np
        if isinstance(o, (np.generic,)): return float(o)
        if isinstance(o, (np.bool_,)): return bool(o)
        return str(o)
    html=os_.TEMPLATE.replace("__ECHARTS__", echarts_js).replace("__DATA__", json.dumps(payload, default=_jd)).replace("__SUMMARY__", json.dumps({
        "instrument":"ES (E-mini S&P 500 futures) — AUGUST 2026 (5m, eff≥0.50 HL≥2)",
        "strategy":"ORB 15m (3×5m) no-retest HL≥2/LL≥2 TP1.2R — 5m data (1m not avail >8d)",
        "window":"2026-08-01 → 2026-08-25", "n_shown":len(payload), "sum_R_shown":round(float(sum(p["R_net"] for p in payload)),2)
    }, default=_jd))
    out=REPO/"reports"/"ORB_ES_showcase"/"orb_august_2026.html"
    out.write_text(html)
    print(f"[ok] {out}")
