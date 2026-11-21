#!/usr/bin/env python
"""November 2026 replay page: our signal vs Austin Silver's posted trades.

Data: NQ=F from yfinance (1m for the last 7 days, 5m for the month).
Our rule: premarket-120 fade -> NY VWAP target, stop 30 beyond the sweep,
entries <= 10:30 (the variant that best matched his charts).
His trades: transcribed from the chart images (Oct-Nov posts).

  .venv/bin/python scripts/research/double_vwap/nov_replay.py
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import strategy as S
import failed_break as F

OUTDIR = os.path.join(S.OUTDIR, "november")
CUT = 10 * 60 + 30
BUF = 30.0

# transcribed from the chart images; exit None = not annotated
HIS = {
    "2026-11-06": [
        dict(leg="DB short", side=-1, entry=27282.50, exit=None, t="10:15", note="double break, add below"),
        dict(leg="DB add", side=-1, entry=27177.50, exit=None, t="10:30", note="second entry"),
    ],
    "2026-11-12": [
        dict(leg="scalp 1", side=-1, entry=28435.75, exit=28417.25, t="13:45", note="VWAP pullback"),
        dict(leg="scalp 2", side=-1, entry=28433.75, exit=28414.50, t="13:50", note="VWAP pullback"),
    ],
    "2026-11-17": [
        dict(leg="short 1", side=-1, entry=27191.92, exit=None, t="09:45", note="double break"),
        dict(leg="short 2", side=-1, entry=27278.92, exit=None, t="10:00", note="second short"),
        dict(leg="long 1", side=1, entry=26938.00, exit=27052.00, t="10:55", note="reclaim"),
        dict(leg="long 2", side=1, entry=26892.75, exit=27015.35, t="12:05", note="reclaim"),
    ],
    "2026-11-19": [
        dict(leg="first short", side=-1, entry=27833.75, exit=None, t="09:50", note="first break of range"),
        dict(leg="second short", side=-1, entry=27660.75, exit=27600.00, t="09:55", note="ON VWAP magnet"),
    ],
    "2026-11-20": [
        dict(leg="short 1", side=-1, entry=26363.00, exit=None, t="10:08", note="double break"),
        dict(leg="short 2", side=-1, entry=26139.60, exit=None, t="10:20", note="second entry"),
    ],
}


def load_yf():
    d1 = yf.download("NQ=F", period="7d", interval="1m", progress=False, auto_adjust=False)
    d5 = yf.download("NQ=F", period="1mo", interval="5m", progress=False, auto_adjust=False)
    out = {}
    for tag, df in (("1m", d1), ("5m", d5)):
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
        df = df.rename(columns={"Open": "o", "High": "h", "Low": "l", "Close": "c", "Volume": "vol"})
        df = df[["o", "h", "l", "c", "vol"]]
        df.index = df.index.tz_convert("America/New_York")
        out[tag] = df
    return out


def our_trade(d):
    """His first entry: fade the premarket break, target the NY VWAP, stop +30."""
    w = F.window_range(d, "pre", 120)
    if not w:
        return None
    hi, lo, start = w
    brk = F.find_break(d, start, hi, lo)
    if not brk:
        return None
    i, dr, _, _ = brk
    side = -dr
    e = i + 1
    if e >= len(d.c) or d.t[e] >= CUT:
        return None
    entry = d.o[e]
    stop = d.h[i] + BUF if side < 0 else d.l[i] - BUF
    risk = (entry - stop) if side > 0 else (stop - entry)
    if risk <= 0:
        return None
    target = d.ny_vwap[i]
    if (side < 0 and target >= entry) or (side > 0 and target <= entry):
        return None
    tr = S.simulate(dict(day=d, idx=e, side=side, entry=entry, stop=stop,
                         target=target, kind="A"), 1.1)
    if not tr:
        return None
    exit_px = entry + side * (tr["pts"] + 1.1)
    exit_idx = min(len(d.c) - 1, int(e + tr["bars"]))
    return dict(side=int(side), entry=float(entry), stop=float(stop),
                target=float(target), exit=float(exit_px), R=round(float(tr["R"]), 2),
                kind=tr["exit"], entry_t=int(d.t[e]), exit_t=int(d.t[exit_idx]),
                exit_idx=exit_idx, band=[float(hi), float(lo)])


def session_payload(d, tag):
    rth = (d.t >= S.RTH_OPEN) & (d.t < S.RTH_CLOSE)
    if rth.sum() < 10:
        return None
    idx = np.flatnonzero(rth)
    fmt = lambda v: f"{int(v)//60:02d}:{int(v)%60:02d}"
    o, h, l, c = d.o[idx], d.h[idx], d.l[idx], d.c[idx]
    ny = d.ny_vwap[idx]
    nt = [fmt(v) for v in d.t[idx]]
    w = F.window_range(d, "pre", 120)
    return dict(
        date=str(d.date), tf=tag, x=nt,
        candles=[[round(float(a), 2), round(float(b), 2), round(float(x_), 2), round(float(y), 2)]
                 for a, b, x_, y in zip(o, c, l, h)],
        ny=[None if not np.isfinite(v) else round(float(v), 2) for v in ny],
        on=round(float(d.on_vwap), 2),
        rng=[round(w[0], 2), round(w[1], 2)] if w else None,
        ours=our_trade(d), his=HIS.get(str(d.date), []),
    )


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    raw = load_yf()
    days = {}
    for tag in ("1m", "5m"):
        for d in S.build_days(raw[tag]):
            key = str(d.date)
            if key not in days or tag == "1m":   # prefer 1m
                days[key] = (d, tag)
    sessions = []
    for key in sorted(days):
        p = session_payload(*days[key])
        if p:
            sessions.append(p)
    print(f"sessions={len(sessions)} ours={sum(1 for s in sessions if s['ours'])} "
          f"his={sum(len(s['his']) for s in sessions)}")
    for s in sessions:
        o = s["ours"]
        ours = "none" if not o else f"{o['side']:+d} entry {o['entry']} R {o['R']:+}"
        print(f"  {s['date']} {s['tf']:3s} our={ours} his={len(s['his'])}")

    js = json.dumps({"sessions": sessions}, separators=(",", ":"))
    html = HTML.replace("__DATA__", js)
    path = os.path.join(OUTDIR, "index.html")
    with open(path, "w") as fh:
        fh.write(html)
    print("wrote", path, len(html), "bytes")


HTML = r"""<!doctype html><html><head><meta charset="utf-8">
<title>NQ November replay — ours vs Austin Silver</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
:root{--bg:#000;--panel:#13161C;--line:#2C313B;--txt:#E5E7EB;--mut:#9CA3AF;--long:#16A34A;--short:#DC2626;--ny:#3B82F6;--on:#F0B90B;--his:#C084FC}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:12px/1.45 ui-sans-serif,system-ui,sans-serif}
header{padding:14px 16px;border-bottom:1px solid var(--line)}
h1{font-size:15px;margin:0 0 4px} .sub{color:var(--mut);font-size:11px}
.wrap{padding:12px 16px 24px;display:grid;gap:12px}
.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
select{background:var(--panel);color:var(--txt);border:1px solid var(--line);border-radius:6px;height:30px;padding:0 8px}
.chart{background:var(--panel);border:1px solid var(--line);border-radius:6px;height:520px}
.meta{color:var(--mut);font-size:11px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:6px;overflow:hidden}
th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{color:var(--mut);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.tag{display:inline-block;padding:1px 6px;border-radius:999px;font-size:10px;border:1px solid var(--line)}
.ours{color:#93C5FD}.his{color:var(--his)}
.foot{color:var(--mut);font-size:11px;line-height:1.6}
</style></head><body>
<header><h1>NQ November 2026 — our signal vs his posted trades</h1>
<div class="sub">NQ=F · 1m (Nov 13–20) / 5m (earlier November) · our rule: premarket-120 fade → NY VWAP, stop +30, entries ≤10:30 · his trades transcribed from the chart images</div></header>
<div class="wrap">
  <div class="bar">
    <select id="sess"></select>
    <span class="meta" id="meta"></span>
    <span style="margin-left:auto" class="meta">
      <span style="color:var(--ny)">━ NY VWAP</span> ·
      <span style="color:var(--on)">┈ ON VWAP</span> ·
      <span style="color:#93C5FD">▲ ours</span> ·
      <span style="color:var(--his)">◆ his</span>
    </span>
  </div>
  <div id="chart" class="chart"></div>
  <table><thead><tr><th>who</th><th>leg</th><th>side</th><th>entry</th><th>stop</th><th>target</th><th>exit</th><th>R / note</th><th>time</th></tr></thead><tbody id="rows"></tbody></table>
  <div class="foot">Our exit price is reconstructed from the engine's net points (entry + side × (pts + 1.1)); his entries/exits are read off the posted TradingView images. Missing exit = not annotated in his chart. 5m sessions are coarser than the 1m rule.</div>
</div>
<script>
const DATA = __DATA__;
const sel = document.getElementById('sess'), rows = document.getElementById('rows'), meta = document.getElementById('meta');
DATA.sessions.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=s.date+' ('+s.tf+')';sel.appendChild(o);});
const chart = echarts.init(document.getElementById('chart'));
function fmt(v,n){return v==null?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:n||2,maximumFractionDigits:n||2});}
function hhmm(m){return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
function render(){
  const s = DATA.sessions[+sel.value||0]; const x=s.x; const last=x[x.length-1];
  const series=[{name:'Candles',type:'candlestick',data:s.candles,
    itemStyle:{color:'#16A34A',color0:'#DC2626',borderColor:'#16A34A',borderColor0:'#DC2626'},
    markLine:{silent:true,symbol:'none',label:{color:'#F0B90B',fontSize:10,position:'insideStartTop'},
      lineStyle:{color:'#F0B90B',type:'dotted',width:1,opacity:.7},
      data:[{yAxis:s.on,label:{formatter:'ON VWAP '+fmt(s.on)}}]}}];
  if(s.rng) series[0].markArea={silent:true,itemStyle:{color:'rgba(240,185,11,0.06)'},
    data:[[{yAxis:s.rng[0]},{yAxis:s.rng[1]}]]};
  series.push({name:'NY VWAP',type:'line',data:s.ny,showSymbol:false,lineStyle:{color:'#3B82F6',width:1.6},z:4});
  let lo=Infinity,hi=-Infinity; const acc=v=>{if(typeof v==='number'&&isFinite(v)){lo=Math.min(lo,v);hi=Math.max(hi,v)}};
  s.candles.forEach(k=>{acc(k[2]);acc(k[3])}); acc(s.on); if(s.rng){acc(s.rng[0]);acc(s.rng[1]);}
  if(s.ours){['entry','stop','target','exit'].forEach(k=>acc(s.ours[k]));}
  s.his.forEach(t=>{acc(t.entry); if(t.exit!=null)acc(t.exit);});
  const pad=Math.max(2,(hi-lo)*0.05);
  if(s.ours){
    const t=s.ours, col=t.side>0?'#16A34A':'#DC2626';
    series.push({name:'our-stop',type:'line',data:[[x[0],t.stop],[last,t.stop]],showSymbol:false,silent:true,lineStyle:{color:'#DC2626',width:1,type:'dashed',opacity:.6},z:3});
    series.push({name:'our-target',type:'line',data:[[x[0],t.target],[last,t.target]],showSymbol:false,silent:true,lineStyle:{color:'#16A34A',width:1,type:'dashed',opacity:.6},z:3});
    series.push({name:'ours-entry',type:'scatter',symbol:'triangle',symbolSize:13,itemStyle:{color:'#93C5FD'},
      labelLayout:{hideOverlap:true,moveOverlap:'shiftY'},
      data:[[hhmm(t.entry_t),t.entry]],label:{show:true,color:'#93C5FD',fontSize:10,position:'left',distance:8,
      formatter:'ours '+(t.side>0?'L':'S')+' '+fmt(t.entry)}});
  }
  s.his.forEach((t,i)=>{
    series.push({name:'his-'+i,type:'scatter',symbol:'diamond',symbolSize:12,itemStyle:{color:'#C084FC'},
      labelLayout:{hideOverlap:true,moveOverlap:'shiftY'},
      data:[[t.t,t.entry]],label:{show:true,color:'#C084FC',fontSize:10,position:'right',distance:8,
      formatter:t.leg+' '+fmt(t.entry)}});
    if(t.exit!=null) series.push({name:'his-x-'+i,type:'scatter',symbol:'circle',symbolSize:9,
      itemStyle:{color:'#C084FC',opacity:.8},data:[[t.t,t.exit]],label:{show:true,color:'#C084FC',fontSize:9,position:'right',formatter:'x '+fmt(t.exit)}});
  });
  chart.setOption({backgroundColor:'transparent',animation:false,
    grid:{left:64,right:90,top:34,bottom:44},
    tooltip:{trigger:'axis',backgroundColor:'#1F242D',borderColor:'#2C313B',textStyle:{color:'#E5E7EB',fontSize:11}},
    xAxis:{type:'category',data:x,boundaryGap:true,axisLine:{lineStyle:{color:'#2C313B'}},
      axisLabel:{color:'#9CA3AF',fontSize:10,interval:Math.max(1,Math.floor(x.length/12))},splitLine:{show:false}},
    yAxis:{type:'value',min:lo-pad,max:hi+pad,axisLine:{show:false},axisTick:{show:false},
      axisLabel:{color:'#9CA3AF',fontSize:10,formatter:v=>v.toLocaleString('en-US',{maximumFractionDigits:0})},
      splitLine:{lineStyle:{color:'#2C313B',type:'dashed',opacity:.6}}},
    series},true);
  meta.textContent = s.date+' · '+s.tf+' · ON VWAP '+fmt(s.on)+(s.rng?' · premarket range '+fmt(s.rng[0])+' / '+fmt(s.rng[1]):'');
  rows.innerHTML='';
  const add=(who,leg,side,entry,stop,target,exit,right,time,cls)=>{
    const tr=document.createElement('tr');
    tr.innerHTML='<td class="'+cls+'">'+who+'</td><td>'+leg+'</td><td style="color:'+(side>0?'var(--long)':'var(--short)')+'">'+(side>0?'LONG':'SHORT')+'</td>'+
      '<td class="num">'+fmt(entry)+'</td><td class="num">'+fmt(stop)+'</td><td class="num">'+fmt(target)+'</td><td class="num">'+fmt(exit)+'</td><td class="num">'+right+'</td><td>'+time+'</td>';
    rows.appendChild(tr);
  };
  if(s.ours){const t=s.ours;add('ours','premarket fade',t.side,t.entry,t.stop,t.target,t.exit,(t.R>0?'+':'')+t.R+'R',hhmm(t.entry_t),'ours');}
  s.his.forEach(t=>add('his',t.leg,t.side,t.entry,null,null,t.exit,t.note,t.t,'his'));
}
sel.addEventListener('change',render); window.addEventListener('resize',()=>chart.resize()); render();
</script></body></html>
"""


if __name__ == "__main__":
    raise SystemExit(main())
