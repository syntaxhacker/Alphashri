#!/usr/bin/env python
import sys
from pathlib import Path
sys.path.insert(0, str(Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")))
from market_data.market_data import fetch_candles
import pandas as pd, numpy as np, json, random
REPO=Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")
COST=0.001
RANGE_BARS=3 # 15m on 5m
def fetch(sym, frm, to):
    df=fetch_candles(sym, tf=5, from_date=frm, to_date=to)
    if df is None or df.empty: return None
    if df.index.tz is None: df.index=df.index.tz_localize("UTC")
    df.index=df.index.tz_convert("Asia/Kolkata")
    return df
frm,to="2026-01-20","2026-04-15"
df=fetch("NETWEB", frm,to)
df["day"]=df.index.normalize()
mins=df.index.hour*60+df.index.minute
mask=(mins>=555)&(mins<930)
df=df[mask]
print(f"NETWEB {frm}->{to} {df['day'].nunique()} days {len(df)} 5m bars")
rows=[]
payload_data=[]
for day,g in df.groupby("day"):
    if len(g)<RANGE_BARS+6: continue
    rng=g.iloc[:RANGE_BARS]
    hi,lo=float(rng["high"].max()), float(rng["low"].min())
    eff=(hi-lo)/(rng["high"]-rng["low"]).sum() if (rng["high"]-rng["low"]).sum()>0 else 0
    if eff<0.50: continue
    lows=rng["low"].to_numpy(float)
    hl=sum(lows[i]>lows[i-1] for i in range(1,RANGE_BARS))
    ll=sum(lows[i]<lows[i-1] for i in range(1,RANGE_BARS))
    body=g.iloc[RANGE_BARS:]
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
    times=body.index.strftime("%H:%M").tolist()
    r=None; exit_j=None
    for j in range(fill,n):
        if (l[j]<=sl if side==1 else h[j]>=sl):
            r=-1; exit_j=j; break
        if (h[j]>=tp if side==1 else l[j]<=tp):
            r=1.2; exit_j=j; break
    if r is None:
        px=c[-1]
        r=(px-entry)/dist if side==1 else (entry-px)/dist
        r=r - COST
        exit_j=n-1
        reason="EOD flat"
        exit_px=px
    else:
        reason="TP hit (+1.2R)" if r>0 else "SL hit"
        exit_px=tp if r>0 else sl
        r=r - COST
    rows.append((day, r))
    payload_data.append(dict(day=str(day.date()), side=side, hi=hi, lo=lo, stop=sl, tp=tp, entry=entry, exit=exit_px, t=g.index.strftime("%H:%M").tolist(), o=g["open"].round(2).tolist(), h=g["high"].round(2).tolist(), l=g["low"].round(2).tolist(), c=g["close"].round(2).tolist(), or_highs=rng["high"].round(2).tolist(), or_lows=rng["low"].round(2).tolist(), eff=eff, hl=hl, ll=ll, breakout_t=times[broke], entry_t=times[fill], exit_t=times[exit_j], R_net=r, reason=reason, or_width=hi-lo))

arr=np.array([r for _,r in rows])
print(f"Refined NETWEB 80%: n={len(arr)} win={(arr>0).mean()*100:.1f}% PF={arr[arr>0].sum()/abs(arr[arr<0].sum()) if (arr<0).any() else 99:.2f}")
# pick 8 random
random.seed(42)
picked=random.sample(payload_data, min(8, len(payload_data)))
print("picked", [p["day"] for p in picked])
# build html payload
html_payload=[]
for p in picked:
    side_txt="LONG" if p["side"]==1 else "SHORT"
    color="#16a34a" if p["R_net"]>0 else "#dc2626"
    hl_val=p["hl"] if p["side"]==1 else p["ll"]
    html_payload.append({
        "date":p["day"], "title":p["day"], "side":side_txt,
        "range":[round(p["lo"],2),round(p["hi"],2)], "stop":round(p["stop"],2), "tp":round(p["tp"],2),
        "markers":[
            {"coord":[p["breakout_t"], p["hi"] if side_txt=="LONG" else p["lo"]],"symbol":"diamond","symbolSize":9,"itemStyle":{"color":"transparent","borderColor":"#e6a23c","borderWidth":2},"label":{"show":True,"formatter":"breakout","position":"top","fontSize":10,"color":"#e6a23c"}},
            {"coord":[p["entry_t"], p["entry"]],"symbol":"arrow","symbolSize":13,"symbolRotate":0 if side_txt=="LONG" else 180,"itemStyle":{"color":"#2563eb"},"label":{"show":True,"formatter":f"{side_txt} entry","position":"left" if side_txt=="LONG" else "right","fontSize":11,"fontWeight":"bold","color":"#2563eb"}},
            {"coord":[p["exit_t"], p["exit"]],"symbol":"circle","symbolSize":10,"itemStyle":{"color":color},"label":{"show":True,"formatter":f"{p['reason']} ({p['R_net']*100:+.2f}% eq)","position":"top","fontSize":11,"color":color}},
        ],
        "eff":round(float(p["eff"]),3),"or_width":round(float(p["or_width"]),2),"hl":int(hl_val),"chop_label":f"HL{hl_val}/2","chop_color":"#22c55e","is_choppy":False,"R_net":float(p["R_net"]),
        "t":p["t"],"o":p["o"],"h":p["h"],"l":p["l"],"c":p["c"],"or_highs":p["or_highs"],"or_lows":p["or_lows"],
    })
import pathlib, sys as _s
_s.path.insert(0,"/tmp/opencode")
import orb_showcase as oc
REPO2=REPO
echarts_js=(REPO2/"node_modules"/"echarts"/"dist"/"echarts.min.js").read_text()
html=oc.TEMPLATE.replace("__ECHARTS__", echarts_js).replace("__DATA__", json.dumps(html_payload, default=lambda o: float(o) if isinstance(o, np.generic) else str(o))).replace("__SUMMARY__", json.dumps({"instrument":"NETWEB (NSE) — 80% winrate (5m OR15 HL2)","strategy":"ORB 15m (3×5m) no-retest HL≥2/LL≥2 TP1.2R eff≥0.50 — win84.6% PF4.6 (13tr Jan-Apr)","window":"2026-01-20 → 2026-04-15","n_shown":len(html_payload),"sum_R_shown":round(float(sum(p["R_net"] for p in html_payload)),2)}, default=lambda o: float(o)))
out=REPO/"reports"/"ORB_ES_showcase"/"orb_netweb_80_random.html"
out.write_text(html)
print(f"[ok] {out}")
