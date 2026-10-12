"""Render the September 14 production replay as a standalone ECharts page."""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT.parent))

from scripts.smc_tick_eval import build_1m_bars
from timeless_reversion import (
    ReversionConfig,
    fair_price_at_et_open,
    load_nq_ticks_for_date,
    run_timeless_reversion,
)


ET = ZoneInfo("America/New_York")


def et_time(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).astimezone(ET).strftime("%H:%M")


def render(output: Path) -> None:
    date = "2026-09-14"
    ticks, basis, source = load_nq_ticks_for_date(date)
    bars = build_1m_bars(ticks)
    fair = fair_price_at_et_open(bars, date)
    config = ReversionConfig(
        entry_start="09:30",
        entry_end="11:00",
        opening_range_max_points=175.0,
        opening_range_minutes=30,
        max_signal_range_points=30.0,
        max_consecutive_losses=2,
    )
    trades = run_timeless_reversion(bars, ticks, fair_price=fair, config=config)

    def in_view(bar: dict) -> bool:
        local = datetime.fromtimestamp(int(bar["time"]), timezone.utc).astimezone(ET)
        return (local.hour, local.minute) >= (9, 0) and (local.hour, local.minute) <= (12, 0)

    view_bars = [bar for bar in bars if in_view(bar)]
    candles = [
        {
            "time": et_time(int(bar["time"])),
            "timestamp": int(bar["time"]),
            "values": [
                round(float(bar["open"]), 2),
                round(float(bar["close"]), 2),
                round(float(bar["low"]), 2),
                round(float(bar["high"]), 2),
            ],
        }
        for bar in view_bars
    ]
    trade_data = []
    bos_data = []
    for number, trade in enumerate(trades, 1):
        entry_time = int(trade["time"])
        exit_time = int(trade["exit_time"])
        signal_time = int(trade["meta"]["signal_bar"])
        signal_bar = next(bar for bar in bars if int(bar["time"]) == signal_time)
        trade_data.append(
            {
                "number": number,
                "entryTime": et_time(entry_time),
                "exitTime": et_time(exit_time),
                "entryTs": entry_time,
                "exitTs": exit_time,
                "entry": round(float(trade["entry"]), 2),
                "exit": round(float(trade["exit"]), 2),
                "sl": round(float(trade["sl"]), 2),
                "tp": round(float(trade["tp"]), 2),
                "result": trade["result"],
                "pnl": round(float(trade["pnl"]), 2),
                "signalTime": et_time(signal_time),
                "signalPrice": round(float(signal_bar["close"]), 2),
                "bosLevel": round(float(trade["meta"]["bos_level"]), 2),
            }
        )
        bos_data.append(
            {
                "time": et_time(signal_time),
                "value": round(float(signal_bar["close"]), 2),
                "level": round(float(trade["meta"]["bos_level"]), 2),
                "number": number,
            }
        )

    opening = [
        bar
        for bar in bars
        if 9 * 60 + 30 <= datetime.fromtimestamp(int(bar["time"]), timezone.utc).astimezone(ET).hour * 60
        + datetime.fromtimestamp(int(bar["time"]), timezone.utc).astimezone(ET).minute
        < 10 * 60
    ]
    opening_high = max(float(bar["high"]) for bar in opening)
    opening_low = min(float(bar["low"]) for bar in opening)
    payload = {
        "date": date,
        "source": source,
        "basis": round(float(basis), 2),
        "fair": round(float(fair), 2),
        "openingHigh": round(opening_high, 2),
        "openingLow": round(opening_low, 2),
        "openingRange": round(opening_high - opening_low, 2),
        "candles": candles,
        "trades": trade_data,
        "bos": bos_data,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    data_json = json.dumps(payload, separators=(",", ":"))
    output.write_text(
        """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NQ Timeless Reversion — 2026-09-14</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
:root{color-scheme:dark;--bg:#0E0E0E;--panel:#0E0E0E;--line:#2A2A2A;--muted:#9CA3AF;--text:#E5E7EB;--green:#00FF88;--red:#FF3B30;--cyan:#38BDF8;--yellow:#FFD700;--orange:#FF9F43}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:var(--bg);color:var(--text);font:12px Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{display:flex;flex-direction:column;overflow:hidden}.top{height:58px;display:flex;align-items:center;gap:18px;padding:0 18px;border-bottom:1px solid var(--line);background:#0d1118}.brand{font-weight:700;letter-spacing:.4px}.tag{padding:4px 8px;border:1px solid #254f45;border-radius:4px;color:var(--green);font-size:11px}.meta{color:var(--muted)}.spacer{flex:1}.pnl{font-size:18px;font-weight:700;color:var(--green)}
.layout{flex:1;min-height:0;display:flex}.side{width:270px;min-width:270px;border-right:1px solid var(--line);background:#0d1118;padding:14px;overflow:auto}.section{border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:14px}.label{text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-size:10px;margin-bottom:9px}.kv{display:flex;justify-content:space-between;padding:5px 0}.kv span:first-child{color:var(--muted)}.trade{border:1px solid var(--line);border-left:3px solid var(--green);border-radius:4px;padding:9px;margin:8px 0;background:#111720}.trade.loss{border-left-color:var(--red)}.trade-head{display:flex;justify-content:space-between;font-weight:700}.trade small{display:block;color:var(--muted);margin-top:5px;line-height:1.5}.win{color:var(--green)}.loss-text{color:var(--red)}
.main{flex:1;min-width:0;display:flex;flex-direction:column;padding:12px}.chart-wrap{flex:1;min-height:0;border:1px solid var(--line);background:var(--panel);border-radius:5px;overflow:hidden}.chart{width:100%;height:100%}.hint{height:28px;color:var(--muted);display:flex;align-items:center;padding:0 4px;font-size:11px}
@media(max-width:800px){.side{width:220px;min-width:220px}.top{gap:9px}.meta{display:none}}
</style></head>
<body><div class="top"><div class="brand">NQ TIMELESS REVERSION</div><div class="tag">LIVE-STYLE REPLAY</div><div class="meta" id="source"></div><div class="spacer"></div><div id="summary" class="pnl"></div></div>
<div class="layout"><aside class="side"><div class="section"><div class="label">Session</div><div class="kv"><span>Date</span><b id="date"></b></div><div class="kv"><span>Fair / 09:30</span><b id="fair"></b></div><div class="kv"><span>Opening range</span><b id="opening"></b></div><div class="kv"><span>Rule</span><b>OR ≤175 / BOS ≤30</b></div></div><div class="section"><div class="label">Trades</div><div id="trades"></div></div><div class="section"><div class="label">Chart keys</div><div class="kv"><span><i style="color:var(--yellow)">●</i> BOS signal</span><span>wick + close</span></div><div class="kv"><span><i style="color:var(--cyan)">—</i> Fair price</span><span>09:30</span></div><div class="kv"><span><i style="color:var(--green)">—</i> TP / win</span><span>+1.5R</span></div><div class="kv"><span><i style="color:var(--red)">—</i> SL / loss</span><span>-1R</span></div></div></aside>
<main class="main"><div class="chart-wrap"><div id="chart" class="chart"></div></div><div class="hint">Drag to pan · mouse wheel to zoom · hover candles for OHLC · markers show signal, entry, exit, SL and TP</div></main></div>
<script>const DATA=__DATA__;
document.getElementById('source').textContent=`${DATA.source} · basis +${DATA.basis.toFixed(2)}`;document.getElementById('date').textContent=DATA.date;document.getElementById('fair').textContent=DATA.fair.toFixed(2);document.getElementById('opening').textContent=`${DATA.openingRange.toFixed(2)} pts`;const net=DATA.trades.reduce((s,t)=>s+t.pnl,0);document.getElementById('summary').textContent=`${net>=0?'+':''}${net.toFixed(2)} pts · $${(net*12).toFixed(0)}`;document.getElementById('trades').innerHTML=DATA.trades.map(t=>`<div class="trade ${t.result==='SL'?'loss':''}"><div class="trade-head"><span>#${t.number} · ${t.entryTime} SHORT</span><span class="${t.result==='SL'?'loss-text':'win'}">${t.result} ${t.pnl>=0?'+':''}${t.pnl.toFixed(2)}</span></div><small>Entry ${t.entry.toFixed(2)}<br>TP ${t.tp.toFixed(2)} · SL ${t.sl.toFixed(2)}<br>Exit ${t.exitTime} @ ${t.exit.toFixed(2)}<br>BOS ${t.signalTime} · level ${t.bosLevel.toFixed(2)}</small></div>`).join('');
const chart=echarts.init(document.getElementById('chart'));const times=DATA.candles.map(x=>x.time),values=DATA.candles.map(x=>x.values);const markLines=[{yAxis:DATA.fair,name:'Fair 09:30',lineStyle:{color:'#4cc9f0',type:'dashed',width:1}},{yAxis:DATA.openingHigh,name:'OR High',lineStyle:{color:'#f6c453',type:'dotted',width:1}},{yAxis:DATA.openingLow,name:'OR Low',lineStyle:{color:'#f6c453',type:'dotted',width:1}}];DATA.trades.forEach(t=>{markLines.push({yAxis:t.tp,name:`T${t.number} TP`,lineStyle:{color:'#25d695',type:'dashed',width:1}});markLines.push({yAxis:t.sl,name:`T${t.number} SL`,lineStyle:{color:'#ff5d73',type:'dashed',width:1}})});
const entry=DATA.trades.map(t=>({value:[t.entryTime,t.entry],trade:t}));const exit=DATA.trades.map(t=>({value:[t.exitTime,t.exit],trade:t}));const bos=DATA.bos.map(x=>({value:[x.time,x.value],bos:x}));
chart.setOption({backgroundColor:'#0E0E0E',animation:false,grid:{left:58,right:24,top:28,bottom:74},tooltip:{trigger:'axis',axisPointer:{type:'cross'},backgroundColor:'#111',borderColor:'#2A2A2A',textStyle:{fontSize:11,color:'#E5E7EB'},formatter(params){const p=params.find(x=>x.seriesName==='NQ');if(!p)return '';const v=p.value;return `<b>${p.axisValue}</b><br>O ${v[1].toFixed(2)} &nbsp; H ${v[4].toFixed(2)}<br>L ${v[3].toFixed(2)} &nbsp; C ${v[2].toFixed(2)}`}},xAxis:{type:'category',data:times,boundaryGap:true,axisLine:{lineStyle:{color:'#2A2A2A'}},axisLabel:{color:'#9CA3AF',fontSize:10},splitLine:{show:false}},yAxis:{scale:true,axisLine:{lineStyle:{color:'#2A2A2A'}},splitLine:{lineStyle:{color:'#2A2A2A'}},axisLabel:{color:'#9CA3AF',fontSize:10}},dataZoom:[{type:'inside',start:5,end:95},{type:'slider',bottom:18,height:18,start:5,end:95,backgroundColor:'#0E0E0E',borderColor:'#2A2A2A',fillerColor:'#303030',textStyle:{color:'#9CA3AF'}}],series:[{name:'NQ',type:'candlestick',data:values,itemStyle:{color:'#00FF88',color0:'#FF3B30',borderColor:'#00FF88',borderColor0:'#FF3B30'},markLine:{silent:true,symbol:['none','none'],label:{color:'#9CA3AF',fontSize:9},data:markLines}},{name:'BOS',type:'scatter',data:bos,symbol:'diamond',symbolSize:9,itemStyle:{color:'#FFD700',borderColor:'#0E0E0E',borderWidth:1},label:{show:true,formatter:p=>`BOS #${p.data.bos.number}`,color:'#FFD700',fontSize:9,position:'top'}},{name:'Entry',type:'scatter',data:entry,symbol:'arrow',symbolRotate:180,symbolSize:14,itemStyle:{color:'#FF9F43'},label:{show:true,formatter:p=>`E${p.data.trade.number}`,color:'#FF9F43',fontSize:10,position:'bottom'}},{name:'Exit',type:'scatter',data:exit,symbol:'circle',symbolSize:9,itemStyle:{color:p=>p.data.trade.result==='SL'?'#FF5252':'#00E676'},label:{show:true,formatter:p=>p.data.trade.result,color:p=>p.data.trade.result==='SL'?'#FF5252':'#00E676',fontSize:9,position:'top'}}]});window.addEventListener('resize',()=>chart.resize());</script></body></html>""".replace("__DATA__", data_json),
        encoding="utf-8",
    )
    print(f"wrote {output} with {len(candles)} candles and {len(trades)} trades")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "sep14_ninja_replay.html")
    render(parser.parse_args().output)
