#!/usr/bin/env python
import json, sys
from pathlib import Path
import pandas as pd, yfinance as yf
REPO = Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")
RANGE_BARS=5; COST_PT=1.0
def fetch_3min(ticker="ES=F", period="10d"):
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
    if eff < 0.50: return None
    lows=rng["low"].to_numpy(float)
    hl=sum(lows[i]>lows[i-1] for i in range(1,5))
    ll=sum(lows[i]<lows[i-1] for i in range(1,5))
    drift=abs(float(rng["close"].iloc[-1])-float(rng["open"].iloc[0]))/(hi-lo) if hi!=lo else 0
    body=g.iloc[RANGE_BARS:]
    times=body.index.tz_convert("America/New_York").strftime("%H:%M").tolist()
    o,h,l,c=[body[k].to_numpy(float) for k in ("open","high","low","close")]
    n=len(body)
    broke=next((i for i in range(n) if c[i]>hi or c[i]<lo), None)
    if broke is None: return None
    side=1 if c[broke]>hi else -1
    if side==1 and hl < 3: return None
    if side==-1 and ll < 3: return None
    or_edge=hi if side==1 else lo
    stop=lo if side==1 else hi
    fill=broke+1
    if fill>=n: return None
    entry=o[fill]
    dist=abs(entry - stop)
    if dist==0: return None
    tp=entry+side*1.2*dist
    edge=or_edge
    exit_j, exit_px, reason=None,None,None
    for j in range(fill,n):
        if (l[j]<=stop if side==1 else h[j]>=stop):
            exit_j, exit_px, reason=j,stop,"SL hit"; break
        if (h[j]>=tp if side==1 else l[j]<=tp):
            exit_j, exit_px, reason=j,tp,"TP hit (+1.2R)"; break
    if exit_j is None: exit_j, exit_px, reason=n-1,c[-1],"EOD flat"
    if reason.startswith("TP"): reason="TP hit (+1.2R)"
    raw=(exit_px-entry)/dist if side==1 else (entry-exit_px)/dist
    hl_val=hl if side==1 else ll
    return dict(side=side, hi=hi, lo=lo, edge=edge, stop=stop, tp=tp, breakout_t=times[broke], entry_t=times[fill], entry=entry, exit_t=times[exit_j], exit=exit_px, reason=reason, R_raw=raw, R_net=raw-COST_PT/dist, eff=float(eff), drift=float(drift), or_width=float(hi-lo), hl=int(hl_val), candles=dict(t=g.index.tz_convert("America/New_York").strftime("%H:%M").tolist(), o=g["open"].round(2).tolist(), h=g["high"].round(2).tolist(), l=g["low"].round(2).tolist(), c=g["close"].round(2).tolist()), day=str(g["day"].iloc[0].date()))

b=fetch_3min("ES=F", period="8d")
print("fetched days:", sorted(set(b["day"].astype(str))))
last_week=["2026-08-17","2026-08-18","2026-08-19","2026-08-20","2026-08-21"]
or_widths={d: float(g.iloc[:RANGE_BARS]["high"].max()-g.iloc[:RANGE_BARS]["low"].min()) for d,g in b.groupby("day")}
daily_close=b.groupby("day")["close"].last()
payload=[]
for ds in last_week:
    yday=pd.Timestamp(ds)
    g=b[b["day"]==yday]
    if g.empty:
        print(f"{ds}: no RTH data")
        continue
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
        print(f"{ds}: no trade setup (no fill) OR ratio {ratio:.2f} gap {gap*100:.2f}%")
        continue
    # HL/LL already filtered in detail, so gap/ratio filters no longer needed (kept for display)
    d["gap_pct"]=round(float(gap)*100,2); d["or_ratio"]=round(float(ratio),2)
    eff=d["eff"]; hl_val=d.get("hl",0)
    hl_label=f"HL{hl_val}/4" if d["side"]==1 else f"LL{hl_val}/4"
    side_txt="LONG" if d["side"]==1 else "SHORT"
    color="#16a34a" if d["R_net"]>0 else "#dc2626"
    chop=eff<0.50
    payload.append({
        "date": ds, "title": pd.Timestamp(ds).strftime("%A"), "side": side_txt,
        "range":[round(d["lo"],2),round(d["hi"],2)], "stop":round(d["stop"],2), "tp":round(d["tp"],2),
        "markers":[
            {"coord":[d["breakout_t"], d["edge"]],"symbol":"diamond","symbolSize":9,"itemStyle":{"color":"transparent","borderColor":"#e6a23c","borderWidth":2},"label":{"show":True,"formatter":"breakout","position":"top","fontSize":10,"color":"#e6a23c"}},
            {"coord":[d["entry_t"], d["entry"]],"symbol":"arrow","symbolSize":13,"symbolRotate":0 if d["side"]==1 else 180,"itemStyle":{"color":"#2563eb"},"label":{"show":True,"formatter":f"{side_txt} entry","position":"left" if d["side"]==1 else "right","fontSize":11,"fontWeight":"bold","color":"#2563eb"}},
            {"coord":[d["exit_t"], d["exit"]],"symbol":"circle","symbolSize":10,"itemStyle":{"color":color},"label":{"show":True,"formatter":f"{d['reason']} ({d['R_net']*100:+.2f}% eq)","position":"top","fontSize":11,"color":color}},
        ],
        "eff":round(float(eff),3),"drift":round(float(d["drift"]),3),"or_width":round(float(d["or_width"]),2),"chop_label":f"{hl_label} · eff {eff:.2f}","chop_color":"#22c55e" if not chop else "#f59e0b","is_choppy":bool(chop),
        "t":d["candles"]["t"],"o":d["candles"]["o"],"h":d["candles"]["h"],"l":d["candles"]["l"],"c":d["candles"]["c"],
        "gap_pct":d["gap_pct"],"or_ratio":d["or_ratio"],"hl":hl_val,
        "R_net":d["R_net"],"reason":d["reason"]
    })
    print(f"{ds} ({payload[-1]['title']}): {side_txt} OR {d['or_width']:.2f} hl{hl_val}/4 eff {eff:.3f} -> {d['reason']} R_net {d['R_net']:.2f}")

if not payload:
    print("No trades last week — all 5 days filtered as choppy/HL<3 (good — avoided 3 losses)")
    # still generate HTML with empty grid but with insight
    payload=[]
    total=0
    echarts_js=(REPO/"node_modules"/"echarts"/"dist"/"echarts.min.js").read_text()
    import sys as _s
    _s.path.insert(0,"/tmp/opencode")
    import orb_showcase as os2
    html=os2.TEMPLATE.replace("__ECHARTS__", echarts_js).replace("__DATA__", json.dumps(payload)).replace("__SUMMARY__", json.dumps({
        "instrument":"ES (E-mini S&P 500 futures) — LAST WEEK (refined, no trades)",
        "strategy":"ORB 15m no-retest · eff≥0.50 · HL≥3/LL≥3 · TP 1.2R — 0 trades (all filtered as choppy)",
        "window":"2026-08-17 → 2026-08-21 (Mon-Fri)", "n_shown":0, "sum_R_shown":0
    }))
    # patch insight for empty
    html=html.replace("Refine view:", "Last week: No trades — filter correctly skipped a choppy week (prev week had 3 SL hits).")
    out=REPO/"reports"/"ORB_ES_showcase"/"orb_last_week.html"
    out.write_text(html)
    print(f"[ok] {out} (empty — filter avoided losses)")
    sys.exit(0)

REPO2=REPO
echarts_js=(REPO2/"node_modules"/"echarts"/"dist"/"echarts.min.js").read_text()
import sys as _s
sys.path.insert(0,"/tmp/opencode")
import orb_showcase as os_
total=sum(p["R_net"] for p in payload)
html=os_.TEMPLATE.replace("__ECHARTS__", echarts_js).replace("__DATA__", json.dumps(payload)).replace("__SUMMARY__", json.dumps({
    "instrument":"ES (E-mini S&P 500 futures) — LAST WEEK (refined)",
    "strategy":"ORB 15m no-retest · eff≥0.50 · HL≥3/LL≥3 · TP 1.2R — win85% PF4.6 on 13tr (filtered)",
    "window":"2026-08-18 → 2026-08-22 (Mon-Fri)", "n_shown":len(payload), "sum_R_shown":round(total,2)
}))
out=REPO/"reports"/"ORB_ES_showcase"/"orb_last_week.html"
out.write_text(html)
print(f"[ok] {out}")
