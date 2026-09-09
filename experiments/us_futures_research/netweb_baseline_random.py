import sys
from pathlib import Path
sys.path.insert(0, str(Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")))
from market_data.market_data import fetch_candles
import pandas as pd, numpy as np, json, random
REPO=Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")
frm,to="2026-01-20","2026-04-15"
df=fetch_candles("NETWEB", tf=5, from_date=frm, to_date=to)
df.index=df.index.tz_convert("Asia/Kolkata")
df["day"]=df.index.normalize()
mins=df.index.hour*60+df.index.minute
mask=(mins>=555)&(mins<930)
df=df[mask]
RANGE_BARS=3
payload=[]
rows=[]
for day,g in df.groupby("day"):
    if len(g)<RANGE_BARS+6: continue
    rng=g.iloc[:RANGE_BARS]
    hi,lo=float(rng["high"].max()), float(rng["low"].min())
    body=g.iloc[RANGE_BARS:]
    times=body.index.strftime("%H:%M").tolist()
    o,h,l,c=[body[k].to_numpy(float) for k in ("open","high","low","close")]
    n=len(body)
    broke=next((i for i in range(n) if c[i]>hi or c[i]<lo), None)
    if broke is None: continue
    side=1 if c[broke]>hi else -1
    edge,sl=(hi,lo) if side==1 else (lo,hi)
    fill=next((j for j in range(broke+1,n) if (side==1 and l[j]<=edge) or (side==-1 and h[j]>=edge)), None)
    if fill is None: continue
    entry=edge
    dist=abs(entry-sl)
    tp=entry+side*2*dist
    r=None; exit_j=None
    for j in range(fill,n):
        if (l[j]<=sl if side==1 else h[j]>=sl):
            r=-1; exit_j=j; break
        if (h[j]>=tp if side==1 else l[j]<=tp):
            r=2; exit_j=j; break
    if r is None:
        px=c[-1]
        r=(px-entry)/dist if side==1 else (entry-px)/dist
        r=r -0.001
        exit_j=n-1
        reason="EOD flat"
        exit_px=px
    else:
        reason="TP hit (+2R)" if r>0 else "SL hit"
        exit_px=tp if r>0 else sl
        r=r -0.001
    rows.append(r)
    payload.append(dict(day=str(day.date()), side=side, hi=hi, lo=lo, stop=sl, tp=tp, entry=entry, exit=exit_px, t=g.index.strftime("%H:%M").tolist(), o=g["open"].round(2).tolist(), h=g["high"].round(2).tolist(), l=g["low"].round(2).tolist(), c=g["close"].round(2).tolist(), or_highs=rng["high"].round(2).tolist(), or_lows=rng["low"].round(2).tolist(), R_net=r, reason=reason, breakout_t=times[broke], entry_t=times[fill], exit_t=times[exit_j], eff=(hi-lo)/(rng["high"]-rng["low"]).sum() if (rng["high"]-rng["low"]).sum()>0 else 0))

arr=np.array(rows)
print(f"NETWEB baseline 5m OR15 retest TP2R Jan-Apr: n={len(arr)} win={(arr>0).mean()*100:.1f}% PF={arr[arr>0].sum()/abs(arr[arr<0].sum()):.2f}")
random.seed(7)
picked=random.sample(payload, min(8, len(payload)))
for p in picked:
    print(p["day"], f"R{p['R_net']:+.2f} {p['reason']}")
# build html
import pathlib
sys.path.insert(0,"/tmp/opencode")
import orb_showcase as oc
html_payload=[]
for p in picked:
    side_txt="LONG" if p["side"]==1 else "SHORT"
    color="#16a34a" if p["R_net"]>0 else "#dc2626"
    eff=p["eff"]
    hl_label=f"eff{eff:.2f}"
    html_payload.append({
        "date":p["day"], "title":p["day"], "side":side_txt,
        "range":[round(p["lo"],2),round(p["hi"],2)], "stop":round(p["stop"],2), "tp":round(p["tp"],2),
        "markers":[
            {"coord":[p["breakout_t"], p["hi"] if side_txt=="LONG" else p["lo"]],"symbol":"diamond","symbolSize":9,"itemStyle":{"color":"transparent","borderColor":"#e6a23c","borderWidth":2},"label":{"show":True,"formatter":"breakout","position":"top","fontSize":10,"color":"#e6a23c"}},
            {"coord":[p["entry_t"], p["entry"]],"symbol":"arrow","symbolSize":13,"symbolRotate":0 if side_txt=="LONG" else 180,"itemStyle":{"color":"#2563eb"},"label":{"show":True,"formatter":f"{side_txt} entry","position":"left" if side_txt=="LONG" else "right","fontSize":11,"fontWeight":"bold","color":"#2563eb"}},
            {"coord":[p["exit_t"], p["exit"]],"symbol":"circle","symbolSize":10,"itemStyle":{"color":color},"label":{"show":True,"formatter":f"{p['reason']} ({p['R_net']*100:+.2f}% eq)","position":"top","fontSize":11,"color":color}},
        ],
        "eff":round(float(eff),3),"or_width":round(p["hi"]-p["lo"],2),"hl":0,"chop_label":hl_label,"chop_color":"#22c55e","is_choppy":False,"R_net":float(p["R_net"]),
        "t":p["t"],"o":p["o"],"h":p["h"],"l":p["l"],"c":p["c"],"or_highs":p["or_highs"],"or_lows":p["or_lows"],
    })
echarts_js=(REPO/"node_modules"/"echarts"/"dist"/"echarts.min.js").read_text()
html=oc.TEMPLATE.replace("__ECHARTS__", echarts_js).replace("__DATA__", json.dumps(html_payload, default=lambda o: float(o) if isinstance(o, np.generic) else str(o))).replace("__SUMMARY__", json.dumps({"instrument":"NETWEB (NSE) — 5m OR15 retest TP2R (baseline, best for NSE)","strategy":"NSE 09:15 IST · 5m · retest wins 57% PF1.14 (33tr Jan-Apr) — refined 80% was ES, not NSE","window":"2026-01-20 → 2026-04-15 (Upstox 5m, 37 RTH days)","n_shown":len(html_payload),"sum_R_shown":round(float(sum(p["R_net"] for p in html_payload)),2)}, default=lambda o: float(o)))
out=REPO/"reports"/"ORB_ES_showcase"/"orb_netweb_random_baseline.html"
out.write_text(html)
print(f"[ok] {out}")
