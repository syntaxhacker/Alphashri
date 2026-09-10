#!/usr/bin/env python
import sys
from pathlib import Path
sys.path.insert(0, str(Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")))
import pandas as pd, numpy as np, json, sys as _s
REPO=Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")
USB_5M="/media/mysyntax/LENOVO_USB_/cme-futures-ohlc-main/MNQ/MNQ_5min_20260120_20260415.csv"
df=pd.read_csv(USB_5M, parse_dates=["datetime"])
df["datetime"]=pd.to_datetime(df["datetime"])
if df["datetime"].dt.tz is None: df["datetime"]=df["datetime"].dt.tz_localize("UTC")
else: df["datetime"]=df["datetime"].dt.tz_convert("UTC")
df=df.set_index("datetime").sort_index()
df.index=df.index.tz_convert("America/New_York")
df["day"]=df.index.normalize()
mins=df.index.hour*60+df.index.minute
df=df[(mins>=570)&(mins<960)]
# pick best ICT v2 config: buffer10 fvg5 vol1.5 RR7 with HTF off (5tr) for showcase, show top wins/losses
# reuse ict_mnq_v2 backtest for trades
sys.path.insert(0, str(Path("/home/mysyntax/Documents/Alphashri/experiments/us_futures_research")))
import importlib.util, pathlib
spec=importlib.util.spec_from_file_location("ictv2", "/home/mysyntax/Documents/Alphashri/experiments/us_futures_research/ict_mnq_v2.py")
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
df_full=df
# collect trades for best config
def collect_trades(buffer=10,fvg_min=5,vol_mult=1.5,rr=7):
    daily=df_full.groupby("day").agg(high=("high","max"), low=("low","min"))
    df_1h=df_full.resample("1h").agg(open=("open","first"),high=("high","max"),low=("low","min"),close=("close","last"),volume=("volume","sum")).dropna()
    trades=[]
    for day,g in df_full.groupby("day"):
        if len(g)<30: continue
        idx=list(daily.index).index(day) if day in daily.index else -1
        if idx<=0: continue
        pdh=float(daily.iloc[idx-1]["high"]); pdl=float(daily.iloc[idx-1]["low"])
        med_vol=g["volume"].median()
        for i in range(20, len(g)-5):
            bar=g.iloc[i]
            body=abs(bar["close"]-bar["open"]); rng=bar["high"]-bar["low"]
            if not (body/rng>0.6 and bar["volume"]>vol_mult*med_vol): continue
            swing_high=float(g.iloc[max(0,i-20):i]["high"].max()); swing_low=float(g.iloc[max(0,i-20):i]["low"].min())
            direction=None; sweep_level=None
            if bar["high"] > pdh + buffer and bar["close"] < pdh: direction=-1; sweep_level=bar["high"]
            elif bar["low"] < pdl - buffer and bar["close"] > pdl: direction=1; sweep_level=bar["low"]
            elif bar["high"] > swing_high + buffer and bar["close"] < swing_high: direction=-1; sweep_level=bar["high"]
            elif bar["low"] < swing_low - buffer and bar["close"] > swing_low: direction=1; sweep_level=bar["low"]
            else: continue
            # FVG
            fvg_idx,fvg_range=None,None
            for fi in range(i+1, min(i+21, len(g)-2)):
                c1,c2,c3=g.iloc[fi],g.iloc[fi+1],g.iloc[fi+2]
                if direction==1 and c3["low"] > c1["high"] and (c3["low"]-c1["high"])>=fvg_min:
                    fvg_idx, fvg_range=fi+1, (c1["high"], c3["low"]); break
                if direction==-1 and c3["high"] < c1["low"] and (c1["low"]-c3["high"])>=fvg_min:
                    fvg_idx, fvg_range=fi+1, (c3["high"], c1["low"]); break
            if fvg_idx is None: continue
            fvg_mid=(fvg_range[0]+fvg_range[1])/2
            entry=fvg_mid; sl=sweep_level + (2 if direction==-1 else -2); dist=abs(entry-sl)
            if dist==0: continue
            tp=entry + direction*rr*dist
            entry_idx=None
            for j in range(fvg_idx+2, len(g)):
                if g.iloc[j]["low"] <= fvg_range[1] and g.iloc[j]["high"] >= fvg_range[0]:
                    entry_idx=j; break
            if entry_idx is None: continue
            r=None; exit_j=None
            for j in range(entry_idx, len(g)):
                if (g.iloc[j]["low"]<=sl if direction==1 else g.iloc[j]["high"]>=sl):
                    r=-1; exit_j=j; break
                if (g.iloc[j]["high"]>=tp if direction==1 else g.iloc[j]["low"]<=tp):
                    r=rr; exit_j=j; break
            if r is None:
                px=g.iloc[-1]["close"]
                r=(px-entry)/dist if direction==1 else (entry-px)/dist
                r=r - 2/dist
                exit_j=len(g)-1
            else: r=r - 2/dist
            fvg_t=g.index[fvg_idx].strftime("%H:%M")
            trades.append(dict(day=str(day.date()), side=direction, t=g.index.strftime("%H:%M").tolist(), o=g["open"].round(2).tolist(), h=g["high"].round(2).tolist(), l=g["low"].round(2).tolist(), c=g["close"].round(2).tolist(), entry=entry, sl=sl, tp=tp, fvg=fvg_range, sweep=sweep_level, fvg_t=fvg_t, entry_t=g.index[entry_idx].strftime("%H:%M"), exit_t=g.index[exit_j].strftime("%H:%M"), R=r, pdh=pdh, pdl=pdl))
            break
    return trades

trades=collect_trades(buffer=10,fvg_min=5,vol_mult=1.5,rr=7)
print(f"Collected {len(trades)} ICT trades")
for t in trades:
    print(t["day"], "LONG" if t["side"]==1 else "SHORT", f"R{t['R']:+.2f}", f"sweep{t['sweep']:.0f} FVG{t['fvg'][0]:.0f}-{t['fvg'][1]:.0f}")

# build HTML
payload=[]
for t in trades:
    side_txt="LONG" if t["side"]==1 else "SHORT"
    color="#16a34a" if t["R"]>0 else "#dc2626"
    payload.append({
        "date":t["day"], "title":t["day"], "side":side_txt,
        "range":[round(t["fvg"][0],2), round(t["fvg"][1],2)], "stop":round(t["sl"],2), "tp":round(t["tp"],2),
        "markers":[
            {"coord":[t["fvg_t"], (t["fvg"][0]+t["fvg"][1])/2],"symbol":"diamond","symbolSize":8,"itemStyle":{"color":"transparent","borderColor":"#8b5cf6","borderWidth":1.5},"label":{"show":True,"formatter":"FVG","position":"top","fontSize":9,"color":"#8b5cf6","distance":14}},
            {"coord":[t["entry_t"], t["entry"]],"symbol":"arrow","symbolSize":10,"symbolRotate":0 if t["side"]==1 else 180,"itemStyle":{"color":"#2563eb"},"label":{"show":True,"formatter":f"{side_txt}","position":"bottom","fontSize":9,"color":"#2563eb","distance":16}},
            {"coord":[t["exit_t"], t["tp"] if t["R"]>0 else t["sl"]],"symbol":"circle","symbolSize":7,"itemStyle":{"color":color},"label":{"show":True,"formatter":f"R{t['R']:+.2f}","position":"top","fontSize":9,"color":color,"distance":22}},
        ],
        "eff":0, "or_width":round(t["tp"]-t["sl"],2), "hl":0, "chop_label":f"FVG {t['fvg'][0]:.0f}-{t['fvg'][1]:.0f}","chop_color":"#8b5cf6","is_choppy":False,"R_net":float(t["R"]),
        "t":t["t"],"o":t["o"],"h":t["h"],"l":t["l"],"c":t["c"],"or_highs":[t["pdh"]]*5,"or_lows":[t["pdl"]]*5,
    })
import orb_showcase as oc
REPO2=Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")
echarts_js=(REPO2/"node_modules"/"echarts"/"dist"/"echarts.min.js").read_text()
# patch template header for ICT — robust substrings
tpl = oc.TEMPLATE.replace("ORB Backtest Trades", "ICT Liquidity Sweep + FVG")
tpl = tpl.replace("ES (E-mini", "MNQ (Micro")
tpl = tpl.replace("efficiency = range / sum(bar ranges) · choppy < 0.45", "FVG 50% entry · sweep buffer 10pt · vol 1.5× · RR7")
# fix ICT insight: show PF / avg R instead of eff 0.000 (ICT has no OR eff)
tpl = tpl.replace(
    "const avgEffWin = wins.length ? (wins.reduce((s,d)=>s+d.eff,0)/wins.length).toFixed(3) : '—';\nconst avgEffLoss = losses.length ? (losses.reduce((s,d)=>s+d.eff,0)/losses.length).toFixed(3) : '—';\nconst label = wins.length && losses.length ? `Refine view: <b>${wins.length} wins vs ${losses.length} losses</b> — avg opening efficiency `+\n  `<b style=\"color:#22c55e\">wins ${avgEffWin}</b> vs <b style=\"color:#f59e0b\">losses ${avgEffLoss}</b>. `+\n  `Winners tend to open <b>clean/directional</b> (eff 0.55+), losers <b>choppy/overlapping</b> — `+\n  `compare the orange range boxes. Use this to spot what to filter next.` : `Showing ${DATA.length} session(s) — avg eff ${(DATA.reduce((s,d)=>s+d.eff,0)/DATA.length).toFixed(3)}`;",
    "const avgRWin = wins.length ? (wins.reduce((s,d)=>s+d.R_net,0)/wins.length).toFixed(2) : '—';\nconst avgRLoss = losses.length ? (losses.reduce((s,d)=>s+d.R_net,0)/losses.length).toFixed(2) : '—';\nconst pf = (()=>{const w=wins.reduce((s,d)=>s+Math.max(0,d.R_net),0); const l=Math.abs(losses.reduce((s,d)=>s+Math.min(0,d.R_net),0)); return l? (w/l).toFixed(2):'—';})();\nconst label = wins.length || losses.length ? `ICT: <b>${wins.length}W ${losses.length}L</b> — PF <b>${pf}</b> · avg R <b style=\"color:#22c55e\">wins ${avgRWin}</b> vs <b style=\"color:#f59e0b\">losses ${avgRLoss}</b> · FVG size ≥5pt + sweep 10pt:` : `Showing ${DATA.length} session(s)`;"
)
tpl = tpl.replace("name:'opening range'", "name:'FVG'")
tpl = tpl.replace("OR Highs (HH)", "PDH").replace("OR Lows (HL)", "PDL")
html=tpl.replace("__ECHARTS__", echarts_js).replace("__DATA__", json.dumps(payload, default=lambda o: float(o) if isinstance(o, np.generic) else str(o))).replace("__SUMMARY__", json.dumps({"instrument":"MNQ (Micro Nasdaq) — ICT Sweep+FVG","strategy":"Sweep PDH/PDL or 20-bar swing (10pt) + displacement vol1.5× + FVG≥5pt + RR7 — PF2.07 on 5tr","window":"2026-01-20 → 2026-04-15 (5m, 61 RTH days)","n_shown":len(payload),"sum_R_shown":round(float(sum(p["R_net"] for p in payload)),2)}, default=lambda o: float(o)))
out=REPO2/"reports"/"ORB_ES_showcase"/"ict_mnq_showcase.html"
out.write_text(html)
print(f"[ok] {out}")
