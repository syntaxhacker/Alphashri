#!/usr/bin/env python
import json, sys
from pathlib import Path
import pandas as pd, yfinance as yf, numpy as np

REPO = Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")
OUTDIR = REPO / "reports" / "ORB_ES_showcase"
RANGE_BARS = 5
COST_PT = 1.0

def fetch_3min(ticker="ES=F", period="5d"):
    df = yf.download(ticker, period=period, interval="1m", progress=False, auto_adjust=False)
    # flatten multiindex if needed
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.rename(columns=str.lower)
    # yfinance index is tz-aware UTC
    df.index = pd.to_datetime(df.index)
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    else:
        df.index = df.index.tz_convert("UTC")
    b = df.resample("3min", label="left", closed="left").agg(
        open=("open","first"), high=("high","max"), low=("low","min"), close=("close","last"), volume=("volume","sum")
    ).dropna(subset=["close"])
    # RTH 09:30 ET
    et = b.index.tz_convert("America/New_York").tz_localize(None)
    rth_open = et.normalize() + pd.Timedelta(hours=9, minutes=30)
    off = (et - rth_open).total_seconds()/60
    mask = (off>=0)&(off<390)
    b = b[mask]
    b["day"] = et[mask].normalize()
    return b

def detail(g):
    if len(g) < RANGE_BARS+6: return None
    rng = g.iloc[:RANGE_BARS]
    hi, lo = float(rng["high"].max()), float(rng["low"].min())
    bar_ranges = (rng["high"]-rng["low"]).to_numpy(float)
    eff = (hi-lo)/bar_ranges.sum() if bar_ranges.sum()>0 else 0
    drift = abs(float(rng["close"].iloc[-1])-float(rng["open"].iloc[0]))/(hi-lo) if hi!=lo else 0
    body = g.iloc[RANGE_BARS:]
    times = body.index.tz_convert("America/New_York").strftime("%H:%M").tolist()
    o, h, l, c = [body[k].to_numpy(float) for k in ("open","high","low","close")]
    n=len(body)
    broke = next((i for i in range(n) if c[i]>hi or c[i]<lo), None)
    if broke is None: return None
    side = 1 if c[broke]>hi else -1
    edge, stop = (hi, lo) if side==1 else (lo, hi)
    fill = next((j for j in range(broke+1,n) if (side==1 and l[j]<=edge) or (side==-1 and h[j]>=edge)), None)
    if fill is None: return None
    dist = abs(edge-stop)
    tp = edge + side*2*dist
    exit_j, exit_px, reason = None, None, None
    for j in range(fill, n):
        if (l[j]<=stop if side==1 else h[j]>=stop):
            exit_j, exit_px, reason = j, stop, "SL hit"; break
        if (h[j]>=tp if side==1 else l[j]<=tp):
            exit_j, exit_px, reason = j, tp, "TP hit (+2R)"; break
    if exit_j is None: exit_j, exit_px, reason = n-1, c[-1], "EOD flat"
    raw = (exit_px-edge)/dist if side==1 else (edge-exit_px)/dist
    return dict(side=side, hi=hi, lo=lo, edge=edge, stop=stop, tp=tp,
                breakout_t=times[broke], entry_t=times[fill], entry=edge,
                exit_t=times[exit_j], exit=exit_px, reason=reason,
                R_raw=raw, R_net=raw - COST_PT/dist,
                eff=eff, drift=drift, or_width=hi-lo,
                candles=dict(t=g.index.tz_convert("America/New_York").strftime("%H:%M").tolist(),
                             o=g["open"].round(2).tolist(), h=g["high"].round(2).tolist(),
                             l=g["low"].round(2).tolist(), c=g["close"].round(2).tolist()),
                day=str(g["day"].iloc[0].date()))

# fetch yesterday = 2026-08-25
yesterday_str = "2026-08-25"
b = fetch_3min("ES=F", period="5d")
print(f"fetched {len(b)} 3m RTH bars, days:", sorted(set(b['day'].astype(str))) )
# also compute gap/expanding filters like showcase
or_widths = {d: float(g.iloc[:RANGE_BARS]["high"].max()-g.iloc[:RANGE_BARS]["low"].min()) for d,g in b.groupby("day")}
daily_close = b.groupby("day")["close"].last()
# pick yesterday
yday = pd.Timestamp(yesterday_str)
g_y = b[b["day"]==yday]
if g_y.empty:
    print("No data for yesterday", yesterday_str); sys.exit(1)
# gap check
prev = yday - pd.Timedelta(days=1)
# find prev trading day
prev_trading = None
for d in sorted(or_widths.keys(), reverse=True):
    if d < yday: prev_trading=d; break
gap = 0
if prev_trading is not None:
    gap = abs(float(g_y["open"].iloc[0])/float(daily_close.loc[prev_trading])-1)
gap_skip = gap>0.01
ratio = or_widths[yday]/or_widths[prev_trading] if prev_trading and or_widths[prev_trading]>0 else 1
ratio_skip = ratio<0.8
print(f"yesterday OR {or_widths[yday]:.2f} prev {or_widths.get(prev_trading,0):.2f} ratio {ratio:.2f} gap {gap*100:.2f}% -> filters: gap_skip={gap_skip}, ratio_skip={ratio_skip}")

d = detail(g_y)
if not d:
    print("No trade setup yesterday (no breakout+retest)")
else:
    print(f"Trade: {('LONG' if d['side']==1 else 'SHORT')} eff {d['eff']:.3f} drift {d['drift']:.3f} R_net {d['R_net']:.2f} {d['reason']}")
    # also copy html template logic
    REPO2 = REPO
    echarts_js = (REPO2 / "node_modules" / "echarts" / "dist" / "echarts.min.js").read_text()
    # build payload like showcase but single day
    side_txt = "LONG" if d["side"]==1 else "SHORT"
    color = "#16a34a" if d["R_net"]>0 else "#dc2626"
    eff = d["eff"]; chop = eff<0.45
    chop_label = "CHOPPY OPEN" if chop else "CLEAN OPEN"
    chop_color = "#f59e0b" if chop else "#22c55e"
    payload = [{
        "date": yesterday_str, "title": "Yesterday", "side": side_txt,
        "range": [round(d["lo"],2), round(d["hi"],2)], "stop": round(d["stop"],2), "tp": round(d["tp"],2),
        "markers": [
            {"coord":[d["breakout_t"], d["edge"]], "symbol":"diamond","symbolSize":9,"itemStyle":{"color":"transparent","borderColor":"#e6a23c","borderWidth":2},"label":{"show":True,"formatter":"breakout","position":"top","fontSize":10,"color":"#e6a23c"}},
            {"coord":[d["entry_t"], d["entry"]], "symbol":"arrow","symbolSize":13,"symbolRotate":0 if d["side"]==1 else 180,"itemStyle":{"color":"#2563eb"},"label":{"show":True,"formatter":f"{side_txt} entry","position":"left" if d["side"]==1 else "right","fontSize":11,"fontWeight":"bold","color":"#2563eb"}},
            {"coord":[d["exit_t"], d["exit"]], "symbol":"circle","symbolSize":10,"itemStyle":{"color":color},"label":{"show":True,"formatter":f"{d['reason']} ({d['R_net']*100:+.2f}% eq)","position":"top","fontSize":11,"color":color}},
        ],
        "eff": round(float(eff),3), "drift": round(float(d["drift"]),3), "or_width": round(float(d["or_width"]),2),
        "chop_label": chop_label, "chop_color": chop_color, "is_choppy": bool(chop),
        "t": d["candles"]["t"], "o": d["candles"]["o"], "h": d["candles"]["h"], "l": d["candles"]["l"], "c": d["candles"]["c"],
        "gap_pct": round(float(gap)*100,2), "or_ratio": round(float(ratio),2), "filtered": bool(gap_skip or ratio_skip),
    }]
    html_template = (REPO2 / "reports" / "ORB_ES_showcase" / "orb_es_showcase.html").read_text()
    # reuse template structure but inject single payload; simpler: load orb_showcase TEMPLATE via import?
    # Instead build minimal html copying style
    import pathlib
    tpl_path = REPO2 / "reports" / "ORB_ES_showcase" / "orb_es_showcase.html"
    # we already have echarts_js, build new html from scratch using same TEMPLATE as orb_showcase.py
    sys.path.insert(0, "/tmp/opencode")
    import orb_showcase as os_  # reuse TEMPLATE
    html = os_.TEMPLATE.replace("__ECHARTS__", echarts_js).replace("__DATA__", json.dumps(payload)).replace("__SUMMARY__", json.dumps({
        "instrument":"ES (E-mini S&P 500 futures) — YESTERDAY ONLY",
        "strategy":"ORB 15m range · breakout close → limit at edge → TP 2R / SL opposite · EOD flat · filters: gap>1% skip, OR/prev≥0.8",
        "window": yesterday_str, "n_shown":1, "sum_R_shown": round(d["R_net"],2)
    }))
    out = REPO / "reports" / "ORB_ES_showcase" / f"orb_yesterday_{yesterday_str}.html"
    out.write_text(html)
    print(f"[ok] {out}")
    # also save filtered vs unfiltered note
    print(f"Filtered out by rules? {gap_skip or ratio_skip} (if True, our filtered system would SKIP this trade)")
