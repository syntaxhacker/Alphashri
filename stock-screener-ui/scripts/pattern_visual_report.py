"""Render one real detected hit per pattern to a self-contained HTML gallery.

For every pattern in the catalog it scans a liquid universe (real Upstox V3
candles), takes the first hit found, and draws the candlesticks + the detector's
boundary trendlines + breakout/target/stop guides. This is the visual audit used
to confirm each detector's geometry on real data (see docs/chart_patterns_verification.md).

Usage:
    .venv/bin/python scripts/pattern_visual_report.py
    .venv/bin/python scripts/pattern_visual_report.py --out reports/patterns_visual
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from chart_patterns import candles, engine  # noqa: E402
from chart_patterns.detectors import common as det_common  # noqa: E402

WORKERS = int(os.environ.get("PATTERN_VISUAL_WORKERS", "8"))

SYMBOLS = [
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "SBIN", "BHARTIARTL", "ITC",
    "LT", "KOTAKBANK", "AXISBANK", "BAJFINANCE", "HINDUNILVR", "MARUTI", "SUNPHARMA",
    "ASIANPAINT", "TITAN", "ULTRACEMCO", "WIPRO", "NTPC", "POWERGRID", "TATASTEEL",
    "JSWSTEEL", "COALINDIA", "ADANIENT", "ADANIPORTS", "ONGC", "GRASIM", "HCLTECH",
    "HINDALCO", "DRREDDY", "CIPLA", "SBILIFE", "APOLLOHOSP", "EICHERMOT", "BAJAJ-AUTO",
]
TIMEFRAMES = ["1D", "1W", "1h", "15m", "1M", "5m"]


def slice_candles(df, start_date, end_date, max_bars=160):
    if df is None or df.empty:
        return []
    try:
        n = len(df)
        days = df.index.strftime("%Y-%m-%d").tolist()
        s = str(start_date)[:10]
        e = str(end_date)[:10]
        si = days.index(s) if s in days else 0
        ei = (n - 1 - days[::-1].index(e)) if e in days else n - 1
        if ei < si:
            si, ei = 0, n - 1
    except Exception:
        si, ei = 0, len(df) - 1
    pad = max(5, int((ei - si + 1) * 0.12))
    # Pad the right edge ~30 bars past the pattern end so post-breakout action shows.
    lo, hi = max(0, si - pad), min(len(df) - 1, ei + max(pad, 30))
    win = df.iloc[lo:hi + 1]
    if len(win) > max_bars:
        win = win.iloc[-max_bars:]
    return candles.candles_to_series(win, max_bars)


def catalog_ids():
    try:
        return [pid for pid, _ in det_common.DETECTORS]
    except Exception:
        return []


def collect(hits_found: dict, limit_symbols: int):
    """Scan (timeframe, symbol) pairs in parallel and keep the first hit per pattern."""
    pairs = [(symbol, tf) for tf in TIMEFRAMES for symbol in SYMBOLS[:limit_symbols]]

    def one(symbol: str, tf: str):
        try:
            df = candles.fetch_for_timeframe(symbol, tf)
        except Exception:
            return None
        if df is None or len(df) < 60:
            return None
        try:
            hits = engine.detect_patterns(df, tf, symbol)
        except Exception:
            return None
        return df, hits

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(one, symbol, tf): (symbol, tf) for symbol, tf in pairs}
        for future in as_completed(futures):
            result = future.result()
            if not result:
                continue
            df, hits = result
            symbol, _tf = futures[future]
            for h in hits:
                if h.pattern_id in hits_found:
                    continue
                hits_found[h.pattern_id] = {
                    "pattern_id": h.pattern_id,
                    "pattern_name": h.pattern_name,
                    "family": h.family,
                    "direction": h.direction,
                    "status": h.status,
                    "quality": h.quality,
                    "confidence": h.confidence,
                    "symbol": symbol,
                    "timeframe": h.timeframe,
                    "notes": h.notes,
                    "breakout_level": h.breakout_level,
                    "target": h.target,
                    "stop": h.stop,
                    "rr": h.rr,
                    "start_date": h.start_date,
                    "end_date": h.end_date,
                    "candles": slice_candles(df, h.start_date, h.end_date),
                    "trendlines": h.trendlines,
                    "pivots": list(getattr(h, "pivots", []) or []),
                }


HTML = """<!doctype html><html><head><meta charset="utf-8">
<title>Chart Patterns - visual audit</title>
<script src="./echarts.min.js"></script>
<style>
 body{background:#0d1117;color:#c9d1d9;font-family:system-ui,sans-serif;margin:0;padding:16px}
 h1{font-size:18px} .sub{color:#8b949e;font-size:12px;margin-bottom:12px}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
 .card{border:1px solid #30363d;border-radius:8px;background:#161b22;padding:10px}
 .hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
 .name{font-weight:700} .meta{font-size:11px;color:#8b949e}
 .badge{font-size:11px;padding:1px 6px;border-radius:6px;border:1px solid #30363d}
 .lvl{font-size:11px;color:#8b949e;margin-top:6px;display:flex;gap:14px;flex-wrap:wrap}
 .chart{width:100%;height:260px}
 .missing{border:1px dashed #6e7681;color:#8b949e;padding:20px;text-align:center}
 .pivots{margin-top:6px;font-size:11px;color:#8b949e;line-height:1.5}
 .pivots .plabel{color:#6e7681;text-transform:uppercase;font-weight:700;margin-right:6px}
 .pivots .p{display:inline-block;white-space:nowrap;margin:0 10px 3px 0}
</style></head><body>
<h1>Chart Patterns - visual audit (real Upstox V3 candles)</h1>
<div class="sub">One real detected hit per pattern. Blue/orange lines = detector boundary trendlines; dashed = breakout/target/stop.</div>
<div class="grid" id="grid"></div>
<script>
const DATA = __DATA__;
function idxFor(times, t){
  for(let i=0;i<times.length;i++){ if(times[i]===t) return i; }
  if(t.length<=10){ const day=t.slice(0,10); for(let i=0;i<times.length;i++){ if(times[i].slice(0,10)===day) return i; } }
  const target=Date.parse(t.replace(' ','T')); let best=-1,bd=Infinity;
  times.forEach((x,i)=>{ const d=Math.abs(Date.parse(x)-target); if(d<bd){bd=d;best=i;} });
  return best;
}
function fmtTs(iso, tick){
  if(iso===null||iso===undefined) return '';
  const s=String(iso);
  const dm=/^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(s);
  if(dm){
    const d=new Date(Date.UTC(+dm[1],+dm[2]-1,+dm[3],12));
    const opt={timeZone:'Asia/Kolkata',day:'2-digit',month:'short'};
    if(!tick) opt.year='numeric';
    return d.toLocaleString('en-IN',opt);
  }
  const d=new Date(s);
  if(isNaN(d.getTime())) return s;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);
  let hh='00',mm='00';
  parts.forEach(p=>{ if(p.type==='hour') hh=p.value; if(p.type==='minute') mm=p.value; });
  const daily=hh==='00'&&mm==='00';
  const dateOpt={timeZone:'Asia/Kolkata',day:'2-digit',month:'short'};
  if(!tick&&daily) dateOpt.year='numeric';
  const dateStr=d.toLocaleString('en-IN',dateOpt);
  if(daily) return dateStr;
  return tick ? dateStr+' '+hh+':'+mm : dateStr+', '+hh+':'+mm;
}
function tooltipFmt(params){
  const arr=Array.isArray(params)?params:[params];
  const first=arr[0]||{};
  const header=fmtTs(first.axisValue,false);
  const lines=arr.map(p=>{
    if(p.value===null||p.value===undefined) return '';
    let v;
    if(p.seriesType==='candlestick'&&Array.isArray(p.value)){
      v='O '+p.value[0]+'  H '+p.value[3]+'  L '+p.value[2]+'  C '+p.value[1];
    } else if(p.seriesType==='scatter'&&Array.isArray(p.value)){ v='₹'+p.value[1]; }
    else if(Array.isArray(p.value)){ v=p.value.join(' / '); }
    else { v=p.value; }
    return (p.marker||'')+(p.seriesName||'')+': '+v;
  }).filter(x=>x!=='');
  return [header].concat(lines).join('<br/>');
}
const grid = document.getElementById('grid');
for(const d of DATA){
  const card=document.createElement('div'); card.className='card';
  const pivots=d.pivots||[];
  const pivotHtml = pivots.length
    ? `<div class="pivots"><span class="plabel">Pivots</span>` + pivots.map(p=>`<span class="p">${fmtTs(p.t,false)} · ₹${Number(p.price).toFixed(2)} · ${p.kind==='low'?'Low':'High'}</span>`).join('') + `</div>`
    : '';
  card.innerHTML = `<div class="hdr"><div><div class="name">${d.pattern_name} <span class="meta">${d.pattern_id}</span></div>
    <div class="meta">${d.symbol} · ${d.timeframe} · ${d.family}/${d.direction}</div></div>
    <span class="badge">${d.status} · ${d.quality}</span></div>`
    + (d.candles && d.candles.length ? `<div class="chart"></div>` : `<div class="missing">No candles</div>`)
    + `<div class="lvl"><span>Breakout ${d.breakout_level?.toFixed(2)}</span><span>Target ${d.target?.toFixed(2)}</span><span>Stop ${d.stop?.toFixed(2)}</span><span>R:R ${d.rr?.toFixed(2)}</span></div>`
    + pivotHtml
    + `<div class="meta" style="margin-top:4px">${d.notes||''}</div>`;
  grid.appendChild(card);
  if(!d.candles || !d.candles.length) continue;
  const el=card.querySelector('.chart');
  const chart=echarts.init(el, null, {renderer:'canvas'});
  const times=d.candles.map(c=>c.t);
  const series=[{type:'candlestick', data:d.candles.map(c=>[c.o,c.c,c.l,c.h]),
    itemStyle:{color:'#3FB950',color0:'#F85149',borderColor:'#3FB950',borderColor0:'#F85149'},
    markLine:{symbol:'none',silent:true,data:[
      {yAxis:d.breakout_level,label:{formatter:'Breakout',position:'insideEndTop',color:'#58A6FF',fontSize:10},lineStyle:{color:'#58A6FF',type:'dashed'}},
      {yAxis:d.target,label:{formatter:'Target',position:'insideEndTop',color:'#3FB950',fontSize:10},lineStyle:{color:'#3FB950',type:'dashed'}},
      {yAxis:d.stop,label:{formatter:'Stop',position:'insideEndBottom',color:'#F85149',fontSize:10},lineStyle:{color:'#F85149',type:'dashed'}}]}}];
  const colors=['#58A6FF','#F0883E'];
  (d.trendlines||[]).forEach((line,li)=>{
    const arr=new Array(times.length).fill(null);
    line.forEach(p=>{ const i=idxFor(times,p.t); if(i>=0) arr[i]=p.price; });
    series.push({type:'line',showSymbol:false,connectNulls:true,silent:true,data:arr,lineStyle:{width:2,color:colors[li%2]}});
  });
  const highs=pivots.filter(p=>p.kind!=='low');
  const lows=pivots.filter(p=>p.kind==='low');
  if(highs.length) series.push({type:'scatter',name:'Pivot High',symbol:'triangle',symbolRotate:180,symbolSize:9,itemStyle:{color:'#F85149'},z:4,data:highs.map(p=>[idxFor(times,p.t),p.price])});
  if(lows.length) series.push({type:'scatter',name:'Pivot Low',symbol:'triangle',symbolRotate:0,symbolSize:9,itemStyle:{color:'#3FB950'},z:4,data:lows.map(p=>[idxFor(times,p.t),p.price])});
  const legendData=(d.trendlines||[]).map((_,i)=>i===0?'Upper boundary':'Lower boundary');
  if(highs.length) legendData.push('Pivot High');
  if(lows.length) legendData.push('Pivot Low');
  chart.setOption({animation:false,grid:{left:52,right:14,top:10,bottom:34},
    tooltip:{trigger:'axis',formatter:tooltipFmt},legend:{show:legendData.length>0,top:0,textStyle:{color:'#8b949e',fontSize:11},data:legendData},
    xAxis:{type:'category',data:times,axisLabel:{fontSize:10,color:'#8b949e',formatter:(v)=>fmtTs(v,true)}},
    yAxis:{type:'value',scale:true,axisLabel:{fontSize:10,color:'#8b949e'},splitLine:{lineStyle:{color:'#21262d'}}},
    series});
  window.addEventListener('resize',()=>chart.resize());
}
</script></body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="reports/patterns_visual")
    ap.add_argument("--limit-symbols", type=int, default=36)
    args = ap.parse_args()

    hits = {}
    collect(hits, args.limit_symbols)
    ids = catalog_ids()
    ordered = [hits[pid] for pid in ids if pid in hits]
    missing = [pid for pid in ids if pid not in hits]
    out_dir = ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "data.json").write_text(json.dumps(ordered, indent=2))
    (out_dir / "index.html").write_text(HTML.replace("__DATA__", json.dumps(ordered)))
    print(f"rendered {len(ordered)}/{len(ids)} patterns -> {out_dir/'index.html'}")
    if missing:
        print("NO REAL HIT FOUND FOR:", ", ".join(missing))
    for h in ordered:
        print(f"  {h['pattern_id']:<22} {h['symbol']:<12} {h['timeframe']:<4} {h['status']:<9} {h['quality']}")


if __name__ == "__main__":
    main()
