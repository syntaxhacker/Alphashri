"""Render the Sep 15 LRL+iFVG replay with ICT audit annotations."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT.parent))

from lrl_liquidity_reversion import (  # noqa: E402
    LRLLiquidityConfig,
    build_bars,
    detect_lrl_signals,
    run_lrl_liquidity_strategy,
)
from timeless_reversion import _shift_cash_ticks_to_nq  # noqa: E402


ET = ZoneInfo("America/New_York")
UTC = timezone.utc
SESSION_DATE = "2026-09-15"


def _fetch_ticks() -> tuple[list[dict], float]:
    start = datetime(2026, 9, 15, 4, tzinfo=UTC)
    end = start + timedelta(days=1)
    js = f'''const {{ getHistoricalRates }} = require("dukascopy-node");
(async () => {{
  try {{
    const data = await getHistoricalRates({{
      instrument: "usatechidxusd",
      dates: {{ from: new Date("{start.isoformat()}"), to: new Date("{end.isoformat()}") }},
      timeframe: "tick",
      format: "json",
    }});
    process.stdout.write(JSON.stringify(data));
  }} catch (error) {{
    process.stdout.write(JSON.stringify({{ error: error.message }}));
    process.exitCode = 1;
  }}
}})();'''
    result = subprocess.run(
        ["npm", "exec", "--yes", "--package=dukascopy-node", "--", "node", "-e", js],
        capture_output=True,
        text=True,
        timeout=600,
        check=True,
    )
    raw = json.loads(result.stdout)
    if isinstance(raw, dict) and raw.get("error"):
        raise RuntimeError(raw["error"])
    return _shift_cash_ticks_to_nq(SESSION_DATE, raw)


def _et(timestamp: int) -> datetime:
    return datetime.fromtimestamp(timestamp, tz=UTC).astimezone(ET)


def _time(timestamp: int) -> str:
    return _et(timestamp).strftime("%H:%M")


def _label(timestamp: int) -> str:
    return _et(timestamp).strftime("%H:%M")


def _floor_bar(timestamp: int, seconds: int = 300) -> int:
    return timestamp // seconds * seconds


def _nearest_signal(trade: dict, signals: list) -> object | None:
    candidates = [
        signal
        for signal in signals
        if signal.side == trade["side"] and signal.bar_time + 60 <= trade["time"]
    ]
    return max(candidates, key=lambda signal: signal.bar_time) if candidates else None


def _reason(trade: dict, signal: object | None) -> tuple[str, str]:
    time = _time(trade["time"])
    reasons = {
        "01:37": ("VALID CONTINUATION", "Bullish HTF context; pullback after early sell-side reaction; cleanest long."),
        "01:56": ("LOWER-QUALITY WIN", "Chart-only 30s iFVG scalp after a high reaction; not an A+ timeframe."),
        "18:46": ("SKIP: NO BOS", "Mixed HTF, no confirmed 5m BOS, and entry sat around previous-day-high liquidity."),
        "20:13": ("SKIP: WEAK CONTEXT", "Repeated long attempt near prior-day-high area without fresh displacement."),
        "21:47": ("CONDITIONAL SHORT", "Bearish HTF pressure and a quick move lower; valid only with confirmed bearish displacement."),
        "22:12": ("SKIP: 30s ONLY", "Lower-timeframe inversion after sell-side activity; insufficient structural confirmation."),
        "22:47": ("SKIP: STALE SHORT", "Sell-side was already swept and bullish displacement had appeared; old short context was stale."),
        "23:11": ("SKIP: REPEAT/CHOP", "Repeated short after the market had already changed state; no fresh BOS."),
        "23:26": ("SKIP: BUY-SIDE TAKEN", "Long came after the overnight buy-side high was swept; mixed HTF and premium entry."),
        "23:50": ("SKIP: TOO LATE", "Late entry with little time and room; effectively an EOD trade."),
    }
    return reasons.get(time, ("REVIEW", "No preset explanation."))


def _load_previous_day() -> list[dict]:
    path = ROOT / "data" / "duka_cache" / "usatechidxusd_2026-09-14.json"
    return json.loads(path.read_text())


def render(output: Path) -> None:
    ticks, basis = _fetch_ticks()
    config = LRLLiquidityConfig()
    signals = detect_lrl_signals(ticks, config)
    trades = run_lrl_liquidity_strategy(ticks, config)
    candles_5m = build_bars(ticks, 300)
    candles_15m = build_bars(_load_previous_day() + ticks, 900)
    closes = [float(bar["close"]) for bar in candles_15m]

    def ema(period: int) -> list[float]:
        alpha = 2.0 / (period + 1.0)
        values = [closes[0]]
        for close in closes[1:]:
            values.append(alpha * close + (1.0 - alpha) * values[-1])
        return values

    ema20 = ema(20)
    ema50 = ema(50)
    previous = _load_previous_day()
    previous_high = max(float(tick["bidPrice"]) for tick in previous)
    previous_low = min(float(tick["bidPrice"]) for tick in previous)
    evening = [tick for tick in ticks if 18 <= _et(int(tick["timestamp"]) // 1000).hour < 24]
    overnight_high = max(float(tick["bidPrice"]) for tick in evening)
    overnight_low = min(float(tick["bidPrice"]) for tick in evening)

    labels = [_label(int(bar["time"])) for bar in candles_5m]
    label_index = {label: index for index, label in enumerate(labels)}
    values = [
        [
            round(float(bar["open"]), 2),
            round(float(bar["close"]), 2),
            round(float(bar["low"]), 2),
            round(float(bar["high"]), 2),
        ]
        for bar in candles_5m
    ]
    candle_times = [int(bar["time"]) for bar in candles_5m]
    trade_data = []
    lrl_lines = []
    fvg_areas = []
    risk_areas = []
    entries = []
    exits = []
    annotations = []
    for number, trade in enumerate(trades, 1):
        signal = _nearest_signal(trade, signals)
        title, explanation = _reason(trade, signal)
        signal_time = signal.bar_time if signal else trade["time"] - 60
        entry_label = _label(_floor_bar(trade["time"]))
        exit_label = _label(_floor_bar(trade["exit_time"]))
        signal_label = _label(_floor_bar(signal_time))
        if entry_label not in label_index:
            entry_label = labels[max(0, min(len(labels) - 1, len(labels) - 1))]
        if exit_label not in label_index:
            exit_label = labels[-1]
        if signal_label not in label_index:
            signal_label = entry_label
        meta = trade["meta"]
        trade_data.append(
            {
                "number": number,
                "time": _time(trade["time"]),
                "exitTime": _time(trade["exit_time"]),
                "side": trade["side"],
                "result": trade["result"],
                "entry": trade["entry"],
                "exit": trade["exit"],
                "sl": trade["sl"],
                "tp": trade["tp"],
                "pnl": trade["pnl"],
                "touches": meta["lrl_touches"],
                "fvg": meta["fvg_timeframe_seconds"],
                "lrlTarget": meta["lrl_target"],
                "signalTime": _time(signal_time),
                "title": title,
                "explanation": explanation,
            }
        )
        color = "#19d38a" if trade["result"] == "TP" else "#ff4d67"
        entries.append(
            {
                "value": [entry_label, trade["entry"]],
                "trade": {"number": number, "side": trade["side"], "result": trade["result"], "title": title},
                "itemStyle": {"color": color},
            }
        )
        exits.append(
            {
                "value": [exit_label, trade["exit"]],
                "trade": {"number": number, "result": trade["result"], "title": title},
                "itemStyle": {"color": color},
            }
        )
        risk_areas.append(
            [
                {"name": f"#{number} risk", "xAxis": entry_label, "yAxis": min(trade["sl"], trade["tp"]), "itemStyle": {"color": "rgba(255,77,103,.10)"}},
                {"xAxis": exit_label, "yAxis": max(trade["sl"], trade["tp"])},
            ]
        )
        if signal:
            inversion_time = candles_5m[min(len(candles_5m) - 1, signal.inversion.inversion_index)].get("time", signal_time)
            fvg_start = _label(_floor_bar(int(inversion_time)))
            fvg_end = exit_label
            if fvg_start not in label_index:
                fvg_start = signal_label
            fvg_areas.append(
                [
                    {"name": f"#{number} iFVG", "xAxis": fvg_start, "yAxis": signal.inversion.zone_low, "itemStyle": {"color": "rgba(44,184,194,.16)"}},
                    {"xAxis": fvg_end, "yAxis": signal.inversion.zone_high},
                ]
            )
            start_ix = max(0, min(len(candles_5m) - 1, signal.lrl.pivot_indices[0] // 5))
            end_ix = max(start_ix + 1, min(len(candles_5m) - 1, signal.signal_index // 5 + 6))
            intercept = signal.lrl.target - signal.lrl.slope * signal.signal_index
            line_data = [None] * len(labels)
            for index in range(start_ix, end_ix + 1):
                base_index = index * 5
                line_data[index] = round(signal.lrl.slope * base_index + intercept, 2)
            lrl_lines.append({"name": f"LRL #{number}", "data": line_data, "color": color, "number": number})
        annotations.append({"value": [entry_label, trade["entry"]], "number": number, "text": f"#{number} {title}"})

    ema20_chart = []
    ema50_chart = []
    for timestamp in candle_times:
        ix = max(i for i, bar in enumerate(candles_15m) if int(bar["time"]) + 900 <= timestamp + 300)
        ema20_chart.append(round(ema20[ix], 2))
        ema50_chart.append(round(ema50[ix], 2))
    pnls = [float(trade["pnl"]) for trade in trades]
    gross_profit = sum(value for value in pnls if value > 0)
    gross_loss = -sum(value for value in pnls if value < 0)
    payload = {
        "date": SESSION_DATE,
        "basis": round(float(basis), 2),
        "ticks": len(ticks),
        "candles": [{"time": label, "values": value} for label, value in zip(labels, values)],
        "ema20": ema20_chart,
        "ema50": ema50_chart,
        "previousHigh": round(previous_high, 2),
        "previousLow": round(previous_low, 2),
        "overnightHigh": round(overnight_high, 2),
        "overnightLow": round(overnight_low, 2),
        "trades": trade_data,
        "entries": entries,
        "exits": exits,
        "riskAreas": risk_areas,
        "fvgAreas": fvg_areas,
        "lrlLines": lrl_lines,
        "annotations": annotations,
        "net": round(sum(pnls), 2),
        "pf": round(gross_profit / gross_loss, 2) if gross_loss else 0.0,
    }
    data_json = json.dumps(payload, separators=(",", ":"))
    cards = "".join(
        f'<div class="trade {"loss" if t["result"] == "SL" else "win"}"><div class="trade-head"><b>#{t["number"]} {t["time"]} {t["side"]}</b><b>{t["result"]} {t["pnl"]:+.2f}</b></div><div class="trade-meta">{t["title"]}<br>Entry {t["entry"]:.2f} → Exit {t["exit"]:.2f}<br>SL {t["sl"]:.2f} · TP {t["tp"]:.2f}<br>LRL {t["touches"]} touches · {t["fvg"]}s iFVG · signal {t["signalTime"]}</div><div class="why">{t["explanation"]}</div></div>'
        for t in trade_data
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NQ LRL+iFVG ICT Audit — {SESSION_DATE}</title><script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script><style>
:root{{--bg:#0b0f14;--panel:#101720;--line:#263240;--muted:#8c9aaa;--text:#e8eef5;--green:#19d38a;--red:#ff4d67;--cyan:#39c6d8;--yellow:#ffc857;--blue:#5ca9ff;--orange:#ff9f43}}*{{box-sizing:border-box}}html,body{{margin:0;height:100%;background:var(--bg);color:var(--text);font:12px Inter,ui-sans-serif,system-ui,sans-serif}}body{{display:flex;flex-direction:column;overflow:hidden}}.top{{height:58px;display:flex;align-items:center;gap:16px;padding:0 16px;background:#0d131b;border-bottom:1px solid var(--line)}}.brand{{font-size:15px;font-weight:800;letter-spacing:.4px}}.tag{{border:1px solid #3e566b;border-radius:4px;padding:4px 8px;color:var(--cyan);font-size:10px;text-transform:uppercase;letter-spacing:.7px}}.meta{{color:var(--muted)}}.spacer{{flex:1}}.summary{{font-size:17px;font-weight:800;color:{'#19d38a' if payload['net'] >= 0 else '#ff4d67'}}}.layout{{display:flex;flex:1;min-height:0}}.side{{width:330px;min-width:330px;overflow:auto;background:#0d131b;border-right:1px solid var(--line);padding:12px}}.section{{border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:12px}}.label{{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}}.kv{{display:flex;justify-content:space-between;padding:4px 0}}.kv span{{color:var(--muted)}}.trade{{border:1px solid var(--line);border-left:3px solid var(--green);border-radius:4px;padding:8px;margin:7px 0;background:#111a24}}.trade.loss{{border-left-color:var(--red)}}.trade.win{{border-left-color:var(--green)}}.trade-head{{display:flex;justify-content:space-between;margin-bottom:5px}}.trade.loss .trade-head b:last-child{{color:var(--red)}}.trade.win .trade-head b:last-child{{color:var(--green)}}.trade-meta{{color:var(--muted);line-height:1.45}}.why{{margin-top:6px;color:#d7e1ea;line-height:1.4}}.legend{{display:grid;grid-template-columns:1fr 1fr;gap:6px;color:var(--muted)}}.legend span::before{{content:'●';margin-right:5px;color:var(--cyan)}}.main{{flex:1;min-width:0;display:flex;flex-direction:column;padding:12px}}.chart-wrap{{flex:1;min-height:0;border:1px solid var(--line);border-radius:5px;overflow:hidden;background:var(--panel)}}#chart{{width:100%;height:100%}}.hint{{height:26px;color:var(--muted);display:flex;align-items:center;padding-left:4px}}@media(max-width:900px){{.side{{width:270px;min-width:270px}}}} 
</style></head><body><div class="top"><div class="brand">NQ · LRL+iFVG · ICT AUDIT</div><div class="tag">Sep 15 Replay</div><div class="meta">Dukascopy ticks · NQ basis +{basis:.2f}</div><div class="spacer"></div><div class="summary">{payload['net']:+.2f} pts · PF {payload['pf']:.2f}</div></div><div class="layout"><aside class="side"><div class="section"><div class="label">Market map</div><div class="kv"><span>Previous-day high</span><b>{previous_high:.2f}</b></div><div class="kv"><span>Previous-day low</span><b>{previous_low:.2f}</b></div><div class="kv"><span>Overnight high</span><b>{overnight_high:.2f}</b></div><div class="kv"><span>Overnight low</span><b>{overnight_low:.2f}</b></div><div class="kv"><span>Trades / ticks</span><b>{len(trades)} / {len(ticks):,}</b></div></div><div class="section"><div class="label">Trade audit</div>{cards}</div><div class="section"><div class="label">Chart keys</div><div class="legend"><span>green win / TP</span><span>red loss / SL</span><span>cyan iFVG zone</span><span>blue LRL line</span><span>yellow liquidity</span><span>orange entry</span></div></div></aside><main class="main"><div class="chart-wrap"><div id="chart"></div></div><div class="hint">Drag / wheel to zoom · arrows = entries · circles = exits · shaded boxes = risk · cyan = iFVG · click legend items to isolate layers</div></main></div><script>const DATA={data_json};
const chart=echarts.init(document.getElementById('chart'));const times=DATA.candles.map(x=>x.time),values=DATA.candles.map(x=>x.values);const lineData=(name,data,color)=>({{name,type:'line',data,symbol:'none',connectNulls:true,lineStyle:{{color,width:1.2,type:'solid'}},itemStyle:{{color}},z:3}});const markLines=[{{yAxis:DATA.previousHigh,name:'PDH',lineStyle:{{color:'#ffc857',type:'dashed',width:1.5}}}},{{yAxis:DATA.previousLow,name:'PDL',lineStyle:{{color:'#ffc857',type:'dashed',width:1.5}}}},{{yAxis:DATA.overnightHigh,name:'Overnight high',lineStyle:{{color:'#ff9f43',type:'dotted',width:1.3}}}},{{yAxis:DATA.overnightLow,name:'Overnight low',lineStyle:{{color:'#ff9f43',type:'dotted',width:1.3}}}}];const series=[{{name:'NQ 5m',type:'candlestick',data:values,itemStyle:{{color:'#19d38a',color0:'#ff4d67',borderColor:'#19d38a',borderColor0:'#ff4d67'}},markLine:{{silent:true,symbol:['none','none'],label:{{color:'#ffc857',fontSize:9}},data:markLines}},markArea:{{silent:true,data:DATA.riskAreas,label:{{show:false}}}}}},{{name:'15m EMA20',type:'line',data:DATA.ema20,symbol:'none',lineStyle:{{color:'#5ca9ff',width:1.1}},z:2}},{{name:'15m EMA50',type:'line',data:DATA.ema50,symbol:'none',lineStyle:{{color:'#b58cff',width:1.1}},z:2}},{{name:'iFVG zones',type:'line',data:times.map(()=>null),symbol:'none',markArea:{{silent:true,data:DATA.fvgAreas,label:{{show:true,color:'#b7f3f5',fontSize:9,formatter:p=>p.name}}}}}}];DATA.lrlLines.forEach(x=>series.push(lineData('LRL #'+x.number,x.data,x.color)));const longEntries=DATA.entries.filter(x=>x.trade.side==='LONG'),shortEntries=DATA.entries.filter(x=>x.trade.side==='SHORT');series.push({{name:'Long entry',type:'scatter',data:longEntries,symbol:'arrow',symbolRotate:0,symbolSize:14,label:{{show:true,formatter:p=>`#${{p.data.trade.number}} LONG`,color:'#ff9f43',fontSize:10,position:'top'}},z:8}});series.push({{name:'Short entry',type:'scatter',data:shortEntries,symbol:'arrow',symbolRotate:180,symbolSize:14,label:{{show:true,formatter:p=>`#${{p.data.trade.number}} SHORT`,color:'#ff9f43',fontSize:10,position:'top'}},z:8}});series.push({{name:'Exit',type:'scatter',data:DATA.exits,symbol:'circle',symbolSize:9,label:{{show:true,formatter:p=>`#${{p.data.trade.number}} ${{p.data.trade.result}}`,color:'#e8eef5',fontSize:9,position:'bottom'}},z:9}});chart.setOption({{backgroundColor:'#101720',animation:false,legend:{{top:5,textStyle:{{color:'#9aa8b6',fontSize:10}}}},grid:{{left:64,right:28,top:34,bottom:76}},tooltip:{{trigger:'axis',axisPointer:{{type:'cross'}},backgroundColor:'#10151c',borderColor:'#334155',textStyle:{{color:'#e8eef5',fontSize:11}},formatter(params){{const p=params.find(x=>x.seriesName==='NQ 5m');if(!p)return '';const v=p.value;return `<b>${{p.axisValue}} ET</b><br>O ${{v[1].toFixed(2)}} · H ${{v[3].toFixed(2)}}<br>L ${{v[2].toFixed(2)}} · C ${{v[1].toFixed(2)}}`;}}}},xAxis:{{type:'category',data:times,boundaryGap:true,axisLine:{{lineStyle:{{color:'#334155'}}}},axisLabel:{{color:'#9aa8b6',fontSize:10}},splitLine:{{show:false}}}},yAxis:{{scale:true,axisLine:{{lineStyle:{{color:'#334155'}}}},splitLine:{{lineStyle:{{color:'#263240'}}}},axisLabel:{{color:'#9aa8b6',fontSize:10}}}},dataZoom:[{{type:'inside',start:0,end:100}},{{type:'slider',bottom:18,height:18,start:0,end:100,backgroundColor:'#0b0f14',borderColor:'#334155',fillerColor:'#263240',textStyle:{{color:'#9aa8b6'}}}}],series}});window.addEventListener('resize',()=>chart.resize());</script></body></html>''', encoding="utf-8")
    print(f"wrote {output} ({len(candles_5m)} candles, {len(trades)} trades)")


if __name__ == "__main__":
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "output" / "sep15_ict_lrl_audit.html"
    render(output)
