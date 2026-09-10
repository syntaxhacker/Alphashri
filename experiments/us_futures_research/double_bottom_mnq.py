#!/usr/bin/env python
"""Double Bottom (W) on MNQ — 5m RTH, neckline break, RR 2-3, HL/LL style filter
Pattern: L1 -> H (neck) -> L2 ~= L1 (within tol) -> break H with displacement
Entry: close > neckline, SL: L2 - buffer, TP: neck + (neck - min(L1,L2))*mult or RR
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "stock-screener-ui"))
import pandas as pd, numpy as np, itertools, json

USB_5M="/media/mysyntax/LENOVO_USB_/cme-futures-ohlc-main/MNQ/MNQ_5min_20260120_20260415.csv"
COST_TICKS=2 # ticks cost

def load_mnq():
    df=pd.read_csv(USB_5M, parse_dates=["datetime"])
    df["datetime"]=pd.to_datetime(df["datetime"])
    if df["datetime"].dt.tz is None: df["datetime"]=df["datetime"].dt.tz_localize("UTC")
    else: df["datetime"]=df["datetime"].dt.tz_convert("UTC")
    df=df.set_index("datetime").sort_index()
    df.index=df.index.tz_convert("America/New_York")
    df["day"]=df.index.normalize()
    mins=df.index.hour*60+df.index.minute
    df=df[(mins>=570)&(mins<960)]
    return df

def find_double_bottom(g, tol_pct=0.4, min_sep=8, max_sep=30, rr=2.0, buffer=4):
    """scan g (day's 5m bars), return trades list for that day (0 or 1)"""
    lows=g["low"].to_numpy(float); highs=g["high"].to_numpy(float)
    closes=g["close"].to_numpy(float); opens=g["open"].to_numpy(float)
    vols=g["volume"].to_numpy(float)
    n=len(g)
    trades=[]
    # find local lows (pivot 2 bars each side)
    piv_lows=[]
    for i in range(2, n-2):
        if lows[i] < min(lows[i-2], lows[i-1], lows[i+1], lows[i+2]):
            piv_lows.append(i)
    for a in range(len(piv_lows)):
        i1=piv_lows[a]
        L1=lows[i1]
        for b in range(a+1, len(piv_lows)):
            i2=piv_lows[b]
            sep=i2-i1
            if sep < min_sep or sep > max_sep: continue
            L2=lows[i2]
            # tolerance: |L2-L1|/avg < tol
            tol=abs(L2-L1)/((L1+L2)/2)*100
            if tol > tol_pct: continue
            # neck = max high between
            neck=highs[i1+1:i2].max() if i2>i1+1 else highs[i1]
            neck_idx=np.argmax(highs[i1+1:i2])+i1+1 if i2>i1+1 else i1+1
            height=neck - min(L1,L2)
            if height < 12: continue # min height 12pt for MNQ
            # displacement on second bottom? volume or body
            # breakout: close > neck after i2
            for k in range(i2+1, min(i2+12, n)):
                if closes[k] > neck and (closes[k]-opens[k])>0 and vols[k] > np.median(vols[max(0,k-10):k]):
                    entry=closes[k] # or neck
                    entry=neck if closes[k] > neck else closes[k]
                    sl=min(L1,L2) - buffer
                    dist=entry - sl
                    if dist<=0: break
                    tp=entry + rr*dist # or measured move neck+height
                    # also measure tp2 = neck+height
                    # find exit
                    r=None; exit_j=None
                    for j in range(k+1, n):
                        if g.iloc[j]["low"] <= sl:
                            r=-1; exit_j=j; break
                        if g.iloc[j]["high"] >= tp:
                            r=rr; exit_j=j; break
                    if r is None:
                        px=closes[-1]
                        r=(px-entry)/dist - COST_TICKS*0.25/dist
                        exit_j=n-1
                    else:
                        r=r - COST_TICKS*0.25/dist
                    trades.append(dict(i1=i1,i2=i2,neck=neck,neck_idx=neck_idx, L1=L1,L2=L2, entry=entry, sl=sl, tp=tp, k=k, entry_t=g.index[k].strftime("%H:%M"), exit_t=g.index[exit_j].strftime("%H:%M"), R=r, height=height, tol=tol))
                    break
            # only first valid double bottom per day
            if trades: break
        if trades: break
    return trades

if __name__=="__main__":
    df=load_mnq()
    print(f"Loaded {len(df)} 5m RTH bars, {df['day'].nunique()} days {df.index[0].date()}->{df.index[-1].date()}")
    # sweep
    grid=[]
    for tol,rr in itertools.product([0.3,0.4,0.6],[2.0,2.5,3.0]):
        rows=[]
        for day,g in df.groupby("day"):
            if len(g)<30: continue
            tr=find_double_bottom(g, tol_pct=tol, rr=rr)
            if tr: rows.extend([t["R"] for t in tr])
        arr=np.array(rows)
        if len(arr)<4: continue
        pf=arr[arr>0].sum()/abs(arr[arr<0].sum()) if (arr<0).any() else 99
        grid.append((pf, f"tol{tol} RR{rr}", len(arr), (arr>0).mean()*100, pf, arr.mean(), (1+0.01*arr).prod()-1))
    grid.sort(reverse=True)
    print("\nTop 10 Double Bottom configs:")
    for pf,desc,n,win,pf2,avg,net in grid[:10]:
        print(f" PF{pf:.2f} {desc:15} n={n:2d} win{win:4.1f}% avg{avg:+.3f} net{net:+.1%}")
    # detail best
    best_tol, best_rr = 0.4, 2.0
    print(f"\nDetail best tol{best_tol} RR{best_rr}:")
    rows=[]
    for day,g in df.groupby("day"):
        tr=find_double_bottom(g, tol_pct=best_tol, rr=best_rr)
        for t in tr:
            rows.append((str(day.date()), t))
    for d,t in rows[:8]:
        print(d, f"L1{t['L1']:.0f} L2{t['L2']:.0f} neck{t['neck']:.0f} h{t['height']:.0f} tol{t['tol']:.2f}% -> R{t['R']:+.2f}")
    # also try without tol tight
    # save html showcase for best
    import json, pathlib
    from pathlib import Path as P
    import sys as _s
    _s.path.insert(0, str(Path(__file__).resolve().parents[2] / "stock-screener-ui"))
    # build 5 showcase days (wins + losses)
    rows_show=[]
    for day,g in df.groupby("day"):
        tr=find_double_bottom(g, tol_pct=best_tol, rr=best_rr)
        for t in tr:
            rows_show.append((day,t,g))
    random_rows=rows_show[:5] if len(rows_show)>=5 else rows_show
    print(f"\nShowcase {len(random_rows)} double bottoms")
    # simple html with labels
    try:
        sys.path.insert(0, str(P("/home/mysyntax/Documents/Alphashri/experiments/us_futures_research")))
        import orb_showcase as oc
        REPO2=P("/home/mysyntax/Documents/Alphashri/stock-screener-ui")
        echarts_js=(REPO2/"node_modules"/"echarts"/"dist"/"echarts.min.js").read_text()
        payload=[]
        for day,t,g in random_rows[:5]:
            side_txt="LONG"
            color="#16a34a" if t["R"]>0 else "#dc2626"
            payload.append({
                "date":str(day.date()), "title":str(day.date()), "side":side_txt,
                "range":[round(min(t["L1"],t["L2"]),2), round(t["neck"],2)], "stop":round(t["sl"],2), "tp":round(t["tp"],2),
                "markers":[
                    {"coord":[t["entry_t"], t["entry"]],"symbol":"arrow","symbolSize":10,"symbolRotate":0,"itemStyle":{"color":"#2563eb"},"label":{"show":True,"formatter":"DB entry","position":"bottom","fontSize":9,"color":"#2563eb","distance":14}},
                    {"coord":[t["exit_t"], t["tp"] if t["R"]>0 else t["sl"]],"symbol":"circle","symbolSize":7,"itemStyle":{"color":color},"label":{"show":True,"formatter":f"R{t['R']:+.2f}","position":"top","fontSize":9,"color":color,"distance":12}},
                ],
                "eff":0, "or_width":round(t["height"],2), "hl":0, "chop_label":f"W {t['L1']:.0f}/{t['L2']:.0f} tol{t['tol']:.1f}%","chop_color":"#8b5cf6","is_choppy":False,"R_net":float(t["R"]),
                "t":g.index.strftime("%H:%M").tolist(),"o":g["open"].round(2).tolist(),"h":g["high"].round(2).tolist(),"l":g["low"].round(2).tolist(),"c":g["close"].round(2).tolist(),"or_highs":[t["neck"]]*5,"or_lows":[min(t["L1"],t["L2"])]*5,
            })
        tpl=oc.TEMPLATE.replace("ORB Backtest Trades — ES (E-mini S&amp;P 500)", "Double Bottom (W) — MNQ (Micro Nasdaq)")
        tpl=tpl.replace("efficiency = range / sum(bar ranges) · choppy < 0.45", "W bottoms tol 0.4% · neck break · RR2")
        html=tpl.replace("__ECHARTS__", echarts_js).replace("__DATA__", json.dumps(payload, default=lambda o: float(o) if isinstance(o, np.generic) else str(o))).replace("__SUMMARY__", json.dumps({"instrument":"MNQ — Double Bottom (W)","strategy":"L1->H->L2 tol0.4% height>=12pt -> break neck + vol + RR2 — PF on 5m","window":"2026-01-20 → 2026-04-15 (5m, 61 RTH days)","n_shown":len(payload),"sum_R_shown":round(float(sum(p["R_net"] for p in payload)),2)}, default=lambda o: float(o)))
        out=REPO2/"reports"/"ORB_ES_showcase"/"double_bottom_mnq.html"
        out.write_text(html)
        print(f"[ok] {out}")
    except Exception as e:
        print("html failed", e)
        import traceback; traceback.print_exc()
