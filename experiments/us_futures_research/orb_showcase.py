#!/usr/bin/env python
"""
Showcase the ES ORB-retest backtest trades on ECharts candlesticks.

Generates reports/ORB_ES_showcase/orb_es_showcase.html (self-contained:
echarts.min.js + data inlined) with 4 sessions, each annotated with:
  - opening range box (15m)
  - entry marker, SL line, TP line, exit marker
  - trade result badge

Run from repo root:  python /tmp/opencode/orb_showcase.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, "/tmp/opencode")
import orb_verify as ov  # noqa: E402

REPO = Path("/home/mysyntax/Documents/Alphashri/stock-screener-ui")
OUTDIR = REPO / "reports" / "ORB_ES_showcase"
RANGE_BARS = 5      # 15m opening range on 3-min bars
CONSEC = 4
COST_PT = ov.COSTS_PT["ES"]


def simulate_day_detail(g: pd.DataFrame):
    """Replay ORB no-retest TP1.2 + HL/LL structure (eff>=0.50, HL>=3/LL>=3)."""
    if len(g) < RANGE_BARS + CONSEC + 2:
        return None
    rng = g.iloc[:RANGE_BARS]
    hi, lo = float(rng["high"].max()), float(rng["low"].min())
    bar_ranges = (rng["high"] - rng["low"]).to_numpy(float)
    eff = (hi - lo) / bar_ranges.sum() if bar_ranges.sum() > 0 else 0
    drift = abs(float(rng["close"].iloc[-1]) - float(rng["open"].iloc[0])) / (hi - lo) if hi != lo else 0
    # HL/LL structure of the 5-bar OR
    lows = rng["low"].to_numpy(float)
    ll = sum(lows[i] < lows[i-1] for i in range(1, 5))
    hl = sum(lows[i] > lows[i-1] for i in range(1, 5))
    body = g.iloc[RANGE_BARS:]
    times = body.index.strftime("%H:%M").tolist()
    o = body["open"].to_numpy(float); h = body["high"].to_numpy(float)
    l = body["low"].to_numpy(float); c = body["close"].to_numpy(float)
    n = len(body)

    broke_i = next((i for i in range(n) if c[i] > hi or c[i] < lo), None)
    if broke_i is None:
        return None
    side = 1 if c[broke_i] > hi else -1
    # HL/LL filter: longs need rising lows, shorts need falling lows (≥3/4)
    if side == 1 and hl < 3:
        return None
    if side == -1 and ll < 3:
        return None
    edge = hi if side == 1 else lo
    stop = lo if side == 1 else hi

    # no-retest: enter next bar after breakout (continuation)
    fill_j = broke_i + 1
    if fill_j >= n:
        return None
    entry_px = o[fill_j]
    or_edge = edge  # keep OR edge for display
    dist = abs(entry_px - stop)
    if dist == 0:
        return None
    tp = entry_px + side * 1.2 * dist
    exit_j, exit_px, reason = None, None, None
    for j in range(fill_j, n):
        hit_sl = l[j] <= stop if side == 1 else h[j] >= stop
        hit_tp = h[j] >= tp if side == 1 else l[j] <= tp
        if hit_sl:
            exit_j, exit_px, reason = j, stop, "SL hit"
            break
        if hit_tp:
            exit_j, exit_px, reason = j, tp, "TP hit (+2R)"
            break
    if exit_j is None:
        exit_j, exit_px, reason = n - 1, c[-1], "EOD flat"
    raw = (exit_px - entry_px) / dist if side == 1 else (entry_px - exit_px) / dist
    # align label to actual TP
    if reason.startswith("TP"): reason = "TP hit (+1.2R)"
    return {
        "side": side, "hi": hi, "lo": lo, "edge": or_edge, "stop": stop, "tp": tp,
        "breakout_t": times[broke_i], "entry_t": times[fill_j], "entry": entry_px,
        "exit_t": times[exit_j], "exit": exit_px, "reason": reason,
        "R_raw": raw, "R_net": raw - COST_PT / dist,
        "eff": float(eff), "drift": float(drift), "or_width": float(hi - lo),
        "hl": int(hl), "ll": int(ll),
        "or_highs": rng["high"].round(2).tolist(), "or_lows": rng["low"].round(2).tolist(),
    }


def collect():
    bars = ov.load_3min("ES")
    # for ratio filter need OR widths
    or_widths = {d: float(g.iloc[:RANGE_BARS]["high"].max() - g.iloc[:RANGE_BARS]["low"].min())
                 for d, g in bars.groupby("day")}
    days = {}
    for day, g in bars.groupby("day"):
        d = simulate_day_detail(g)
        if not d:
            continue
        # --- FILTERS: eff>=0.50 + no-retest TP1.2 + OR/prev>=1.0 (expanding, robust) ---
        if d["eff"] < 0.50:
            continue
        cur_w = or_widths.get(day, 0)
        # find prev trading day
        prev = None
        for dd in sorted(or_widths.keys()):
            if dd < day: prev = dd
        if prev is not None and or_widths[prev] > 0 and cur_w / or_widths[prev] < 1.0:
            continue
        d["candles"] = {
            "t": g.index.strftime("%H:%M").tolist(),
            "o": g["open"].round(2).tolist(), "h": g["high"].round(2).tolist(),
            "l": g["low"].round(2).tolist(), "c": g["close"].round(2).tolist(),
        }
        d["or_ratio"] = round(cur_w / or_widths[prev], 2) if prev is not None and or_widths[prev] else None
        days[str(day.date())] = d
    return days


def pick_sessions(days: dict):
    """Top wins vs top losses (adapts to n)."""
    wins = sorted([kv for kv in days.items() if kv[1]["R_net"] > 0], key=lambda kv: -kv[1]["R_net"])
    losses = sorted([kv for kv in days.items() if kv[1]["R_net"] <= 0], key=lambda kv: kv[1]["R_net"])
    picks = []
    for i, kv in enumerate(wins[:5]):
        picks.append((kv[0], f"Top #{i+1} Win"))
    for i, kv in enumerate(losses[:5]):
        picks.append((kv[0], f"Top #{i+1} Loss"))
    # if not enough losses, fill with smallest wins to keep 10 cards
    if len(losses) < 3 and len(wins) > 5:
        for i, kv in enumerate(wins[5:5+(5-len(losses))]):
            picks.append((kv[0], f"Win #{6+i}"))
    return picks


def day_payload(k: str, d: dict, label: str):
    cd = d["candles"]
    side_txt = "LONG" if d["side"] == 1 else "SHORT"
    r_pct = d["R_net"] * 100
    result_color = "#16a34a" if d["R_net"] > 0 else "#dc2626"
    eff = d.get("eff", 0)
    chop = eff < 0.45  # bottom ~50% is choppy
    chop_label = "CHOPPY OPEN" if chop else "CLEAN OPEN"
    chop_color = "#f59e0b" if chop else "#22c55e"
    markers = [
        # breakout close (hollow diamond)
        {"coord": [d["breakout_t"], d["edge"]],
         "symbol": "diamond", "symbolSize": 9, "itemStyle": {"color": "transparent",
         "borderColor": "#e6a23c", "borderWidth": 2},
         "label": {"show": True, "formatter": "breakout", "position": "top", "fontSize": 10,
                    "color": "#e6a23c"}},
        # entry arrow
        {"coord": [d["entry_t"], d["entry"]],
         "symbol": "arrow", "symbolSize": 13, "symbolRotate": 0 if d["side"] == 1 else 180,
         "itemStyle": {"color": "#2563eb"},
         "label": {"show": True, "formatter": f"{side_txt} entry", "position":
                   "left" if d["side"] == 1 else "right", "fontSize": 11, "fontWeight": "bold",
                    "color": "#2563eb"}},
        # exit dot
        {"coord": [d["exit_t"], d["exit"]],
         "symbol": "circle", "symbolSize": 10, "itemStyle": {"color": result_color},
         "label": {"show": True, "formatter": f"{d['reason']} ({r_pct:+.2f}% eq)",
                    "position": "top", "fontSize": 11, "color": result_color}},
    ]
    return {
        "date": k, "title": label, "side": side_txt,
        "range": [round(d["lo"], 2), round(d["hi"], 2)],
        "stop": round(d["stop"], 2), "tp": round(d["tp"], 2),
        "markers": markers,
        "eff": round(eff, 3), "drift": round(d.get("drift", 0), 3),
        "or_width": round(d.get("or_width", 0), 2),
        "chop_label": chop_label, "chop_color": chop_color, "is_choppy": chop,
        "R_net": float(d.get("R_net", 0)),
        "or_highs": d.get("or_highs", []), "or_lows": d.get("or_lows", []),
        "hl": d.get("hl",0), "ll": d.get("ll",0),
        **cd,
    }


def main():
    days = collect()
    picks = pick_sessions(days)
    payload = [day_payload(k, days[k], label) for k, label in picks]

    echarts_js = (REPO / "node_modules" / "echarts" / "dist" / "echarts.min.js").read_text()
    total_r = sum(p["R_net"] for p in [days[k] for k, _ in picks])

    html = TEMPLATE.replace("__ECHARTS__", echarts_js)
    html = html.replace("__DATA__", json.dumps(payload))
    html = html.replace("__SUMMARY__", json.dumps({
        "instrument": "ES (E-mini S&P 500 futures)",
        "strategy": "ORB 15m no-retest · eff≥0.50 · HL≥3/LL≥3 · TP 1.2R · win85% PF4.6 (13tr) — HL/LL added",
        "window": "2026-01-20 → 2026-04-15",
        "n_shown": len(payload), "sum_R_shown": round(total_r, 2),
    }))
    OUTDIR.mkdir(parents=True, exist_ok=True)
    out = OUTDIR / "orb_es_showcase.html"
    out.write_text(html)
    print(f"[ok] {out}")
    for k, label in picks:
        d = days[k]
        print(f"  {k}  {label:<16} R_net={d['R_net']:+.2f}  ({d['reason']})")


TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ES ORB Backtest Showcase</title>
<style>
 body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;background:#000000;color:#dbe2ef;margin:0;padding:24px}
 h1{font-size:22px;margin:0 0 4px} .sub{color:#7a869a;font-size:13px;margin-bottom:20px}
 .insight{background:#0a0a0a;border-left:3px solid #f59e0b;border-radius:8px;padding:12px 14px;margin-bottom:18px;font-size:13px;line-height:1.5;color:#cbd5e1}
 .insight b{color:#fbbf24}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(560px,1fr));gap:18px}
 .card{background:#0a0a0f;border:1px solid #1a1a2e;border-radius:10px;padding:12px}
 .card.choppy{border-color:rgba(245,158,11,.45);box-shadow:0 0 0 1px rgba(245,158,11,.15) inset}
 .card h2{font-size:14px;margin:2px 4px 8px;color:#aab6cc;font-weight:600}
 .card h2 .tag{color:#2563eb;font-weight:700}
 .chart{width:100%;height:420px}
 .legend{font-size:11px;color:#7a869a;padding:0 4px 6px}
 .badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;margin-left:8px}
 .chop{display:inline-block;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:700;letter-spacing:.04em;margin-left:8px}
</style>
</head>
<body>
<h1>ORB Backtest Trades — ES (E-mini S&amp;P 500)</h1>
<div class="sub" id="summary"></div>
<div class="insight" id="insight"></div>
<div class="grid" id="grid"></div>
<script>__ECHARTS__</script>
<script>
const DATA = __DATA__;
const SUMMARY = __SUMMARY__;
document.getElementById('summary').textContent =
  `${SUMMARY.instrument} · ${SUMMARY.strategy} · window ${SUMMARY.window}` +
  ` · showing ${SUMMARY.n_shown} sessions · efficiency = range / sum(bar ranges) · choppy < 0.45`;

const wins = DATA.filter(d=>d.R_net>0);
const losses = DATA.filter(d=>d.R_net<0);
const avgEffWin = wins.length ? (wins.reduce((s,d)=>s+d.eff,0)/wins.length).toFixed(3) : '—';
const avgEffLoss = losses.length ? (losses.reduce((s,d)=>s+d.eff,0)/losses.length).toFixed(3) : '—';
const label = wins.length && losses.length ? `Refine view: <b>${wins.length} wins vs ${losses.length} losses</b> — avg opening efficiency `+
  `<b style="color:#22c55e">wins ${avgEffWin}</b> vs <b style="color:#f59e0b">losses ${avgEffLoss}</b>. `+
  `Winners tend to open <b>clean/directional</b> (eff 0.55+), losers <b>choppy/overlapping</b> — `+
  `compare the orange range boxes. Use this to spot what to filter next.` : `Showing ${DATA.length} session(s) — avg eff ${(DATA.reduce((s,d)=>s+d.eff,0)/DATA.length).toFixed(3)}`;
document.getElementById('insight').innerHTML = label;

const grid = document.getElementById('grid');
DATA.forEach(day => {
  const card = document.createElement('div'); card.className='card'+(day.is_choppy?' choppy':'');
  const res = day.markers[2].label.formatter;
  const color = day.markers[2].label.color;
  card.innerHTML = `<h2><span class="tag">${day.title}</span> — ${day.date} · ${day.side}
     <span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}55">${res}</span>
     <span class="chop" style="background:${day.chop_color}22;color:${day.chop_color};border:1px solid ${day.chop_color}55">${day.chop_label} · eff ${day.eff} · w ${day.or_width}pt</span></h2>
     <div class="chart"></div>`;
  grid.appendChild(card);

  const chart = echarts.init(card.querySelector('.chart'));
  chart.setOption({
    backgroundColor:'transparent',
    animation:false,
    grid:{left:64,right:24,top:28,bottom:52},
    tooltip:{trigger:'axis',axisPointer:{type:'cross'},
      backgroundColor:'#1c2436',borderColor:'#2c3854',textStyle:{color:'#dbe2ef',fontSize:11}},
    xAxis:{type:'category',data:day.t,axisLine:{lineStyle:{color:'#2c3854'}},
      axisLabel:{color:'#7a869a',fontSize:10},boundaryGap:true},
    yAxis:{scale:true,splitLine:{lineStyle:{color:'#1f2739'}},axisLabel:{color:'#7a869a',fontSize:10}},
    dataZoom:[{type:'inside'},{type:'slider',height:16,bottom:8,borderColor:'#232c42',
      backgroundColor:'#121826',fillerColor:'rgba(37,99,235,.15)',handleStyle:{color:'#2563eb'},textStyle:{color:'#7a869a'}}],
    series:[
      {name:'ES 3m',type:'candlestick',data:day.c.map((_,i)=>[day.o[i],day.c[i],day.l[i],day.h[i]]),
       itemStyle:{color:'#16a34a',color0:'#dc2626',borderColor:'#16a34a',borderColor0:'#dc2626'},
       markArea:{silent:true,itemStyle:{color:'rgba(230,162,60,.10)',borderColor:'#e6a23c',borderWidth:1,borderType:'dashed'},
         data:[[ {yAxis:day.range[0],name:'opening range'}, {yAxis:day.range[1]} ]]},
       markLine:{silent:true,symbol:'none',animation:false,label:{fontSize:10},data:[
         {yAxis:day.stop,lineStyle:{color:'#dc2626',type:'dashed',width:1.5},label:{formatter:'SL '+day.stop,color:'#dc2626',position:'insideEndTop'}},
         {yAxis:day.tp, lineStyle:{color:'#16a34a',type:'dashed',width:1.5},label:{formatter:'TP '+day.tp,color:'#16a34a',position:'insideEndBottom'}}
       ]},
       markPoint:{data:day.markers,silent:false}},
      {name:'OR Highs (HH)',type:'line',data:day.or_highs.concat(Array(day.t.length-day.or_highs.length).fill(null)),symbol:'circle',symbolSize:6,itemStyle:{color:'#f59e0b'},lineStyle:{color:'#f59e0b',width:2,type:'dashed'},z:5},
      {name:'OR Lows (HL)',type:'line',data:day.or_lows.concat(Array(day.t.length-day.or_lows.length).fill(null)),symbol:'circle',symbolSize:6,itemStyle:{color:'#22c55e'},lineStyle:{color:'#22c55e',width:2,type:'dashed'},z:5},
    ]
  });
  window.addEventListener('resize',()=>chart.resize());
});
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
