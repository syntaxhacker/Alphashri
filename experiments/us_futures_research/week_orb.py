#!/usr/bin/env python
import json, sys
from pathlib import Path
import pandas as pd, yfinance as yf
REPO = Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")
RANGE_BARS=5; COST_PT=1.0
def fetch_3min(ticker="ES=F", period="7d"):
    df = yf.download(ticker, period=period, interval="1m", progress=False, auto_adjust=False)
    if isinstance(df.columns, pd.MultiIndex): df.columns=df.columns.get_level_values(0)
    df=df.rename(columns=str.lower)
    df.index=pd.to_datetime(df.index)
    if df.index.tz is None: df.index=df.index.tz_localize("UTC")
    else: df.index=df.index.tz_convert("UTC")
    b=df.resample("3min", label="left", closed="left").agg(open=("open","first"), high=("high","max"), low=("low","min"), close=("close","last"), volume=("volume","sum")).dropna(subset=["close"])
    et=b.index.tz_convert("America/New_York").tz_localize(None)
    rth_open=et.normalize()+pd.Timedelta(hours=9, minutes=30)
    off=(et-rth_open).total_seconds()/60
    mask=(off>=0)&(off<390)
    b=b[mask]
    b["day"]=et[mask].normalize()
    return b
def detail(g):
    if len(g)<RANGE_BARS+6: return None
    rng=g.iloc[:RANGE_BARS]
    hi, lo=float(rng["high"].max()), float(rng["low"].min())
    eff=(hi-lo)/(rng["high"]-rng["low"]).sum() if (rng["high"]-rng["low"]).sum()>0 else 0
    drift=abs(float(rng["close"].iloc[-1])-float(rng["open"].iloc[0]))/(hi-lo) if hi!=lo else 0
    body=g.iloc[RANGE_BARS:]
    times=body.index.tz_convert("America/New_York").strftime("%H:%M").tolist()
    o,h,l,c=[body[k].to_numpy(float) for k in ("open","high","low","close")]
    n=len(body)
    broke=next((i for i in range(n) if c[i]>hi or c[i]<lo), None)
    if broke is None: return None
    side=1 if c[broke]>hi else -1
    edge, stop=(hi,lo) if side==1 else (lo,hi)
    fill=next((j for j in range(broke+1,n) if (side==1 and l[j]<=edge) or (side==-1 and h[j]>=edge)), None)
    if fill is None: return None
    dist=abs(edge-stop)
    tp=edge+side*2*dist
    exit_j, exit_px, reason=None,None,None
    for j in range(fill,n):
        if (l[j]<=stop if side==1 else h[j]>=stop):
            exit_j, exit_px, reason=j,stop,"SL hit"; break
        if (h[j]>=tp if side==1 else l[j]<=tp):
            exit_j, exit_px, reason=j,tp,"TP hit (+2R)"; break
    if exit_j is None: exit_j, exit_px, reason=n-1,c[-1],"EOD flat"
    raw=(exit_px-edge)/dist if side==1 else (edge-exit_px)/dist
    return dict(side=side, hi=hi, lo=lo, edge=edge, stop=stop, tp=tp, breakout_t=times[broke], entry_t=times[fill], entry=edge, exit_t=times[exit_j], exit=exit_px, reason=reason, R_raw=raw, R_net=raw-COST_PT/dist, eff=float(eff), drift=float(drift), or_width=float(hi-lo), candles=dict(t=g.index.tz_convert("America/New_York").strftime("%H:%M").tolist(), o=g["open"].round(2).tolist(), h=g["high"].round(2).tolist(), l=g["low"].round(2).tolist(), c=g["close"].round(2).tolist()), day=str(g["day"].iloc[0].date()))

b=fetch_3min("ES=F", period="7d")
print("fetched RTH 3m bars:",len(b),"days:",sorted(set(b["day"].astype(str))))
# this week Mon 2026-08-24 Tue 2026-08-25 Wed 2026-08-26
target_days=["2026-08-24","2026-08-25","2026-08-26"]
or_widths={d: float(g.iloc[:RANGE_BARS]["high"].max()-g.iloc[:RANGE_BARS]["low"].min()) for d,g in b.groupby("day")}
daily_close=b.groupby("day")["close"].last()
payload=[]
import numpy as np
for ds in target_days:
    yday=pd.Timestamp(ds)
    g=b[b["day"]==yday]
    if g.empty:
        print(f"{ds}: no RTH data (holiday/incomplete)")
        continue
    # filters like showcase
    # find prev trading day
    prev=None
    for d in sorted(or_widths.keys()):
        if d < yday: prev=d
    gap=0
    if prev is not None:
        gap=abs(float(g["open"].iloc[0])/float(daily_close.loc[prev])-1)
    ratio=or_widths[yday]/or_widths[prev] if prev is not None and or_widths[prev]>0 else 1
    gap_skip=gap>0.01
    ratio_skip=ratio<0.8
    d=detail(g)
    if not d:
        print(f"{ds}: no breakout+retest setup (no fill)")
        # still show range for context? skip
        continue
    d["gap_pct"]=round(float(gap)*100,2)
    d["or_ratio"]=round(float(ratio),2)
    d["filtered"]=bool(gap_skip or ratio_skip)
    d["gap_skip"]=bool(gap_skip)
    d["ratio_skip"]=bool(ratio_skip)
    # build payload entry
    side_txt="LONG" if d["side"]==1 else "SHORT"
    color="#16a34a" if d["R_net"]>0 else "#dc2626"
    eff=d["eff"]; chop=eff<0.45
    payload.append({
        "date": ds, "title": pd.Timestamp(ds).strftime("%A"), "side": side_txt,
        "range":[round(d["lo"],2),round(d["hi"],2)], "stop":round(d["stop"],2), "tp":round(d["tp"],2),
        "markers":[
            {"coord":[d["breakout_t"], d["edge"]],"symbol":"diamond","symbolSize":9,"itemStyle":{"color":"transparent","borderColor":"#e6a23c","borderWidth":2},"label":{"show":True,"formatter":"breakout","position":"top","fontSize":10,"color":"#e6a23c"}},
            {"coord":[d["entry_t"], d["entry"]],"symbol":"arrow","symbolSize":13,"symbolRotate":0 if d["side"]==1 else 180,"itemStyle":{"color":"#2563eb"},"label":{"show":True,"formatter":f"{side_txt} entry","position":"left" if d["side"]==1 else "right","fontSize":11,"fontWeight":"bold","color":"#2563eb"}},
            {"coord":[d["exit_t"], d["exit"]],"symbol":"circle","symbolSize":10,"itemStyle":{"color":color},"label":{"show":True,"formatter":f"{d['reason']} ({d['R_net']*100:+.2f}% eq)","position":"top","fontSize":11,"color":color}},
        ],
        "eff":round(float(eff),3),"drift":round(float(d["drift"]),3),"or_width":round(float(d["or_width"]),2),"chop_label":"CHOPPY OPEN" if chop else "CLEAN OPEN","chop_color":"#f59e0b" if chop else "#22c55e","is_choppy":bool(chop),
        "t":d["candles"]["t"],"o":d["candles"]["o"],"h":d["candles"]["h"],"l":d["candles"]["l"],"c":d["candles"]["c"],
        "gap_pct":d["gap_pct"],"or_ratio":d["or_ratio"],"filtered":d["filtered"],
        "R_net":d["R_net"],"reason":d["reason"]
    })
    print(f"{ds} ({payload[-1]['title']}): {side_txt} OR {d['or_width']:.2f} ratio {ratio:.2f} gap {gap*100:.2f}% eff {eff:.3f} -> {d['reason']} R_net {d['R_net']:.2f} filtered={d['filtered']}")

if not payload:
    print("No trades this week")
    sys.exit(0)

# build html reusing TEMPLATE
REPO2=REPO
echarts_js=(REPO2/"node_modules"/"echarts"/"dist"/"echarts.min.js").read_text()
import pathlib, sys as _s
sys.path.insert(0,"/tmp/opencode")
import orb_showcase as os_
total=sum(p["R_net"] for p in payload)
html=os_.TEMPLATE.replace("__ECHARTS__", echarts_js).replace("__DATA__", json.dumps(payload)).replace("__SUMMARY__", json.dumps({
    "instrument":"ES (E-mini S&P 500 futures) — THIS WEEK",
    "strategy":"ORB 15m retest · TP2R/SL opposite · EOD flat · filters: gap>1% skip, OR/prev≥0.8 (FILTERED flag shown)",
    "window":"2026-08-24 → 2026-08-26 (Mon-Wed)", "n_shown":len(payload), "sum_R_shown":round(total,2)
}))
out=REPO/"reports"/"ORB_ES_showcase"/"orb_this_week.html"
out.write_text(html)
print(f"[ok] {out}")
# also save filtered stats
import shutil
shutil.copy(__file__, str(Path("../experiments/us_futures_research")/Path(__file__).name) if Path("../experiments/us_futures_research").exists() else "/tmp/week_orb_copy.py")
