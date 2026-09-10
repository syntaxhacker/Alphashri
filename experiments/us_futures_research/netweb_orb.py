#!/usr/bin/env python
import pandas as pd, yfinance as yf, numpy as np, json
from pathlib import Path
REPO=Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")
RANGE_BARS=3 # 15m on 5m
COST_PCT=0.001 # 0.1% approx
# fetch NETWEB 5m 1mo
df=yf.download("NETWEB.NS", period="1mo", interval="5m", progress=False, auto_adjust=False)
if isinstance(df.columns, pd.MultiIndex): df.columns=df.columns.get_level_values(0)
df=df.rename(columns=str.lower)
df.index=pd.to_datetime(df.index)
if df.index.tz is None: df.index=df.index.tz_localize("UTC")
else: df.index=df.index.tz_convert("UTC")
# NSE RTH 09:15-15:30 IST = 03:45-10:00 UTC
et=df.index.tz_convert("Asia/Kolkata").tz_localize(None)
rth_open=et.normalize()+pd.Timedelta(hours=9, minutes=15)
rth_close=et.normalize()+pd.Timedelta(hours=15, minutes=30)
off_open=(et - rth_open).total_seconds()/60
off_close=(et - rth_close).total_seconds()/60
mask=(off_open>=0)&(off_close<0)
b=df[mask]
b["day"]=et[mask].normalize()
print("NETWEB 5m RTH rows", len(b), "days", b["day"].nunique(), sorted(set(b["day"].astype(str)))[:3], "->", sorted(set(b["day"].astype(str)))[-3:])
# also need to handle resampling? df is already 5m, use as is
# run refined ORB no-retest TP1.2 eff>=0.50 HL>=2
def vwap(g): return (g["close"]*g["volume"]).cumsum()/g["volume"].cumsum()
rows=[]
payload=[]
for day,g in b.groupby("day"):
    if len(g)<RANGE_BARS+6: continue
    rng=g.iloc[:RANGE_BARS]
    hi,lo=float(rng["high"].max()), float(rng["low"].min())
    eff=(hi-lo)/(rng["high"]-rng["low"]).sum() if (rng["high"]-rng["low"]).sum()>0 else 0
    if eff<0.50: continue
    lows=rng["low"].to_numpy(float)
    hl=sum(lows[i]>lows[i-1] for i in range(1,RANGE_BARS))
    ll=sum(lows[i]<lows[i-1] for i in range(1,RANGE_BARS))
    body=g.iloc[RANGE_BARS:]
    times=body.index.tz_convert("Asia/Kolkata").strftime("%H:%M").tolist()
    o,h,l,c=[body[k].to_numpy(float) for k in ("open","high","low","close")]
    n=len(body)
    broke=next((i for i in range(n) if c[i]>hi or c[i]<lo), None)
    if broke is None: continue
    side=1 if c[broke]>hi else -1
    if side==1 and hl<2: continue
    if side==-1 and ll<2: continue
    fill=broke+1
    if fill>=n: continue
    entry=o[fill]
    sl=lo if side==1 else hi
    dist=abs(entry-sl)
    if dist==0: continue
    tp=entry+side*1.2*dist
    # exit
    r=None; exit_j=None
    for j in range(fill,n):
        if (l[j]<=sl if side==1 else h[j]>=sl):
            r=-1; exit_j=j; break
        if (h[j]>=tp if side==1 else l[j]<=tp):
            r=1.2; exit_j=j; break
    if r is None:
        px=c[-1]
        r=(px-entry)/dist if side==1 else (entry-px)/dist
        r=r - COST_PCT/dist*entry/dist # approx cost as % of price?
        # simpler: cost as 0.1% of entry
        r=r - 0.001
        exit_j=n-1
        reason="EOD flat"
    else:
        reason="TP hit (+1.2R)" if r>0 else "SL hit"
        r=r - 0.001
    rows.append(r)
    # for payload, need candles for day
    # use g for full day candles
    payload.append(dict(date=str(day.date()), side="LONG" if side==1 else "SHORT", eff=round(eff,3), hl=hl if side==1 else ll, or_width=round(hi-lo,2), R_net=round(float(r),2), reason=reason, hi=hi, lo=lo, stop=sl, tp=tp, entry=entry, exit=c[exit_j] if exit_j is not None else c[-1], t=g.index.tz_convert("Asia/Kolkata").strftime("%H:%M").tolist(), o=g["open"].round(2).tolist(), h=g["high"].round(2).tolist(), l=g["low"].round(2).tolist(), c=g["close"].round(2).tolist(), or_highs=rng["high"].round(2).tolist(), or_lows=rng["low"].round(2).tolist(), breakout_t=times[broke], entry_t=times[fill], exit_t=times[exit_j] if exit_j is not None else times[-1]))

arr=np.array(rows)
if len(arr)>0:
    pf=arr[arr>0].sum()/abs(arr[arr<0].sum()) if (arr<0).any() else 99
    print(f"NETWEB refined (5m, eff>=0.50 HL>=2 no-retest TP1.2): n={len(arr)} win={(arr>0).mean()*100:.1f}% PF={pf:.2f} avgR={arr.mean():+.3f} net={(1+0.01*arr).prod()-1:+.1%}")
    for p in payload:
        print(f"{p['date']} {p['side']} eff{p['eff']} HL{p['hl']}/2 -> {p['reason']} R{p['R_net']:+.2f}")
else:
    print("No trades NETWEB with refined filter")

# also baseline without HL/eff for comparison
rows2=[]
for day,g in b.groupby("day"):
    if len(g)<RANGE_BARS+6: continue
    rng=g.iloc[:RANGE_BARS]
    hi,lo=float(rng["high"].max()), float(rng["low"].min())
    body=g.iloc[RANGE_BARS:]
    o,h,l,c=[body[k].to_numpy(float) for k in ("open","high","low","close")]
    n=len(body)
    broke=next((i for i in range(n) if c[i]>hi or c[i]<lo), None)
    if broke is None: continue
    side=1 if c[broke]>hi else -1
    edge=hi if side==1 else lo
    sl=lo if side==1 else hi
    fill=next((j for j in range(broke+1,n) if (side==1 and l[j]<=edge) or (side==-1 and h[j]>=edge)), None)
    if fill is None: continue
    entry=edge
    dist=abs(entry-sl)
    tp=entry+side*2*dist
    r=None
    for j in range(fill,n):
        if (l[j]<=sl if side==1 else h[j]>=sl):
            r=-1; break
        if (h[j]>=tp if side==1 else l[j]<=tp):
            r=2; break
    if r is None:
        px=c[-1]
        r=(px-entry)/dist if side==1 else (entry-px)/dist
        r=r -0.001
    else:
        r=r -0.001
    rows2.append(r)
arr2=np.array(rows2)
if len(arr2)>0:
    pf2=arr2[arr2>0].sum()/abs(arr2[arr2<0].sum()) if (arr2<0).any() else 99
    print(f"NETWEB baseline retest TP2R: n={len(arr2)} win={(arr2>0).mean()*100:.1f}% PF={pf2:.2f} net={(1+0.01*arr2).prod()-1:+.1%}")

# generate HTML for NETWEB refined payload
if payload:
    import pathlib, sys
    sys.path.insert(0, "/tmp/opencode")
    # reuse showcase template but need to handle NSE times
    REPO2=REPO
    echarts_js=(REPO2/"node_modules"/"echarts"/"dist"/"echarts.min.js").read_text()
    sys.path.insert(0,"/tmp/opencode")
    import orb_showcase as os_
    # build payload for html
    html_payload=[]
    for p in payload:
        side_txt=p["side"]
        color="#16a34a" if p["R_net"]>0 else "#dc2626"
        hl_label=f"HL{p['hl']}/2"
        html_payload.append({
            "date":p["date"], "title":p["date"], "side":side_txt,
            "range":[round(p["lo"],2),round(p["hi"],2)], "stop":round(p["stop"],2), "tp":round(p["tp"],2),
            "markers":[
                {"coord":[p["breakout_t"], p["hi"] if side_txt=="LONG" else p["lo"]],"symbol":"diamond","symbolSize":9,"itemStyle":{"color":"transparent","borderColor":"#e6a23c","borderWidth":2},"label":{"show":True,"formatter":"breakout","position":"top","fontSize":10,"color":"#e6a23c"}},
                {"coord":[p["entry_t"], p["entry"]],"symbol":"arrow","symbolSize":13,"symbolRotate":0 if side_txt=="LONG" else 180,"itemStyle":{"color":"#2563eb"},"label":{"show":True,"formatter":f"{side_txt} entry","position":"left" if side_txt=="LONG" else "right","fontSize":11,"fontWeight":"bold","color":"#2563eb"}},
                {"coord":[p["exit_t"], p["exit"]],"symbol":"circle","symbolSize":10,"itemStyle":{"color":color},"label":{"show":True,"formatter":f"{p['reason']} ({p['R_net']*100:+.2f}% eq)","position":"top","fontSize":11,"color":color}},
            ],
            "eff":p["eff"],"or_width":p["or_width"],"hl":p["hl"],"chop_label":hl_label,"chop_color":"#22c55e","is_choppy":False,"R_net":p["R_net"],
            "t":p["t"],"o":p["o"],"h":p["h"],"l":p["l"],"c":p["c"],
            "or_highs":p["or_highs"],"or_lows":p["or_lows"],
        })
    def _jd(o):
        import numpy as np
        if isinstance(o, (np.generic,)): return float(o)
        return str(o)
    html=os_.TEMPLATE.replace("__ECHARTS__", echarts_js).replace("__DATA__", json.dumps(html_payload, default=_jd)).replace("__SUMMARY__", json.dumps({
        "instrument":"NETWEB (NSE) — 5m ORB 15m no-retest HL≥2 eff≥0.50 TP1.2R",
        "strategy":"NSE 09:15-15:30 IST · 5m bars · same refined as ES",
        "window":"2026-07-27 → 2026-08-25 (5m, ~22 sessions)", "n_shown":len(html_payload), "sum_R_shown":round(float(sum(p["R_net"] for p in html_payload)),2)
    }, default=_jd))
    out=REPO/"reports"/"ORB_ES_showcase"/"orb_netweb.html"
    out.write_text(html)
    print(f"[ok] {out}")
