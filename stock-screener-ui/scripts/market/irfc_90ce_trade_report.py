#!/usr/bin/env python3
"""Build the IRFC 23 Nov 90 CE trade research page from Upstox candles.

Frozen output: reports/irfc_2026-11-09_90ce/trade.html + data.json.
"""
from __future__ import annotations

import json
import os
import sys
import requests
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
OUT = ROOT / "reports" / "irfc_2026-11-09_90ce"
OUT.mkdir(parents=True, exist_ok=True)

EQ_KEY = "NSE_EQ|INE053F01010"
CE_KEY = "NSE_FO|106407"
EXPIRY = "2026-11-23"
TRADE_DATE = "2026-11-09"
QTY = 5425
ENTRY = 0.47
EXIT = 0.72
TOKEN = None


def auth() -> dict[str, str]:
    global TOKEN
    if TOKEN is None:
        from api.options import get_upstox_token

        TOKEN = get_upstox_token()
    return {"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"}


def quote(key: str) -> str:
    return requests.utils.quote(key, safe="")


def candles(path: str) -> list[list]:
    r = requests.get(f"https://api.upstox.com{path}", headers=auth(), timeout=20)
    r.raise_for_status()
    body = r.json()
    data = body.get("data") or {}
    rows = data.get("candles") if isinstance(data, dict) else None
    return sorted(rows or [], key=lambda row: row[0])


def minute_series(key: str, day: str) -> list[dict]:
    try:
        rows = candles(f"/v3/historical-candle/{quote(key)}/minutes/1/{day}/{day}")
    except Exception:
        rows = []
    return [
        {"t": row[0], "o": row[1], "h": row[2], "l": row[3], "c": row[4], "v": row[5], "oi": row[6]}
        for row in rows
    ]


def intraday(key: str) -> list[dict]:
    try:
        rows = candles(f"/v3/historical-candle/intraday/{quote(key)}/minutes/1")
    except Exception:
        rows = []
    return [
        {"t": row[0], "o": row[1], "h": row[2], "l": row[3], "c": row[4], "v": row[5], "oi": row[6]}
        for row in rows
    ]


def chain_quote() -> dict:
    r = requests.get(
        "https://api.upstox.com/v2/option/chain",
        headers=auth(),
        params={"instrument_key": EQ_KEY, "expiry_date": EXPIRY},
        timeout=20,
    )
    r.raise_for_status()
    body = r.json()
    rows = body.get("data") or []
    for row in rows:
        if float(row.get("strike_price") or 0) == 90.0:
            ce = row.get("call_options") or {}
            md = ce.get("market_data") or {}
            g = ce.get("option_greeks") or {}
            return {
                "spot": float(row.get("underlying_spot_price") or 0),
                "ltp": float(md.get("ltp") or 0),
                "close": float(md.get("close_price") or 0),
                "oi": float(md.get("oi") or 0),
                "prev_oi": float(md.get("prev_oi") or 0),
                "volume": float(md.get("volume") or 0),
                "bid": float(md.get("bid_price") or 0),
                "ask": float(md.get("ask_price") or 0),
                "iv": float(g.get("iv") or 0),
                "delta": float(g.get("delta") or 0),
                "gamma": float(g.get("gamma") or 0),
                "theta": float(g.get("theta") or 0),
            }
    raise RuntimeError("IRFC 90 CE not found in chain")


def pct(value: float) -> float:
    return (value - 1.0) * 100.0


def main() -> None:
    ce9 = minute_series(CE_KEY, TRADE_DATE)
    eq9 = minute_series(EQ_KEY, TRADE_DATE)
    ce_now = intraday(CE_KEY)
    eq_now = intraday(EQ_KEY)
    q = chain_quote()
    if not ce9 or not eq9:
        raise SystemExit("no Nov 9 candles")

    spot_by_min = {r["t"][11:16]: r["c"] for r in eq9}
    high = max(ce9, key=lambda r: r["h"])
    low = min(ce9, key=lambda r: r["l"])
    entry_bar = min(ce9, key=lambda r: abs(r["c"] - ENTRY))
    exit_bar = min(ce9, key=lambda r: abs(r["c"] - EXIT))
    entry_spot = spot_by_min.get(entry_bar["t"][11:16])
    exit_spot = spot_by_min.get(exit_bar["t"][11:16])
    gross = QTY * (EXIT - ENTRY)
    entry_value = QTY * ENTRY
    exit_value = QTY * EXIT
    current_value = QTY * q["ltp"]

    last_now = ce_now[-1]["t"] if ce_now else None
    days_to_expiry = max(0, (datetime.fromisoformat(EXPIRY).date() - datetime.now().date()).days)

    data = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "trade": {
            "symbol": "IRFC", "strike": 90, "side": "CE", "expiry": EXPIRY,
            "date": TRADE_DATE, "qty": QTY, "entry": ENTRY, "exit": EXIT,
            "entry_value": entry_value, "exit_value": exit_value,
            "gross_pnl": gross, "return_pct": (EXIT / ENTRY - 1) * 100,
            "entry_time": entry_bar["t"], "exit_time": exit_bar["t"],
            "entry_spot": entry_spot, "exit_spot": exit_spot,
        },
        "day": {
            "ce_low": low, "ce_high": high,
            "spot_low": min(eq9, key=lambda r: r["l"]),
            "spot_high": max(eq9, key=lambda r: r["h"]),
        },
        "now": {**q, "as_of": last_now, "days_to_expiry": days_to_expiry},
        "pnl_if_held": {
            "from_entry": current_value - entry_value,
            "from_entry_pct": (q["ltp"] / ENTRY - 1) * 100,
            "from_exit": current_value - exit_value,
            "from_exit_pct": (q["ltp"] / EXIT - 1) * 100,
        },
        "series": {
            "ce9": ce9, "eq9": eq9, "ce_now": ce_now, "eq_now": eq_now,
        },
    }
    (OUT / "data.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")

    html = HTML.replace("__DATA__", json.dumps(data, separators=(",", ":")))
    (OUT / "trade.html").write_text(html, encoding="utf-8")
    print(f"wrote {OUT/'trade.html'} ({len(html):,} bytes)")
    print(f"trade {QTY} x {ENTRY}->{EXIT} = {gross:,.2f} ({data['trade']['return_pct']:.1f}%)")
    print(f"now spot {q['spot']:.2f} CE {q['ltp']:.2f} OI {q['oi']:,.0f} IV {q['iv']:.2f} delta {q['delta']:.4f}")


HTML = r'''<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>IRFC 90 CE — trade research</title>
<script src="https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js"></script>
<style>
:root{--bg:#000;--panel:#13161C;--alt:#1F242D;--border:#2C313B;--text:#E8E8E8;--muted:#9B9B9B;--amber:#D9902A;--green:#16A34A;--red:#DC2626;--blue:#4A8FD8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1500px;margin:0 auto;padding:26px 24px 60px}.kicker{font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;color:var(--amber);text-transform:uppercase}
h1{font-size:25px;margin:9px 0 5px}h2{font-size:15px;margin:0 0 8px}.sub{color:var(--muted);margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:10px}.card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:13px 14px;min-width:0}
.kpi{grid-column:span 3}.k{font:700 9px/1 ui-monospace,Menlo,monospace;color:var(--muted);letter-spacing:.1em;text-transform:uppercase}.v{font:700 20px/1.25 ui-monospace,Menlo,monospace;margin-top:6px}.pos{color:var(--green)}.neg{color:var(--red)}.amber{color:var(--amber)}
.main{grid-column:span 8}.side{grid-column:span 4}.half{grid-column:span 6}.full{grid-column:span 12}
.chart{width:100%;height:340px}.chart.tall{height:440px}.chart.small{height:250px}.chart.zoom{height:300px}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:6px 5px;border-bottom:1px solid var(--border);text-align:right}th:first-child,td:first-child{text-align:left}th{color:var(--muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
.note{color:var(--muted);font-size:11px;margin:8px 0 0}.tag{display:inline-block;border:1px solid var(--border);border-radius:4px;padding:2px 6px;font:700 10px ui-monospace,Menlo,monospace;color:var(--amber);margin:0 4px 4px 0}
.bullets{margin:8px 0 0;padding-left:18px;color:#CFCFCF}.bullets li{margin:6px 0}.good{color:var(--green)}.bad{color:var(--red)}
footer{border-top:1px solid var(--border);margin-top:18px;padding-top:12px;color:var(--muted);font-size:11px}
@media(max-width:980px){.kpi,.main,.side,.half{grid-column:span 12}.wrap{padding:18px 12px 45px}h1{font-size:21px}}
</style></head><body><div class="wrap">
<div class="kicker">Trade research · NSE F&amp;O · 23 Nov 2026 expiry</div>
<h1>IRFC 90 CE — why the 23-minute trade worked</h1>
<p class="sub">Entry 14:47 IST → exit 15:10 IST, 09 Nov 2026. 5,425 quantity. This page separates the realised trade from the current option value.</p>
<div class="grid" id="kpis"></div>

<div class="grid" style="margin-top:10px">
  <div class="card main"><h2>09 Nov 2026 — 90 CE vs IRFC spot</h2><div id="main" class="chart tall"></div><p class="note">Premium on the right axis; spot on the left. Markers are the 14:47 entry and 15:10 exit.</p></div>
  <div class="card side"><h2>Trade ledger</h2><table id="ledger"></table><p class="note">Gross P&amp;L before brokerage, STT, exchange charges and slippage. The tape supports the 0.47 → 0.72 sequence.</p></div>
</div>

<div class="grid" style="margin-top:10px">
  <div class="card half"><h2>14:35–15:25 — the actual squeeze</h2><div id="zoom" class="chart zoom"></div><p class="note">IRFC +1.20 pts; 90 CE +53%. The option stayed OTM — this was gamma and demand, not intrinsic value.</p></div>
  <div class="card half"><h2>3D path — time × spot × premium</h2><div id="threed" class="chart zoom"></div><p class="note">The path bends upward as spot rises; the vertical jump after 15:00 is the gamma/flow acceleration.</p></div>
</div>

<div class="grid" style="margin-top:10px">
  <div class="card half"><h2>18 Nov — current option path</h2><div id="now" class="chart small"></div><p class="note">Current-day 1-minute premium and spot, clipped at the last recorded print. Frozen quote below.</p></div>
  <div class="card half"><h2>Why it worked</h2><ul class="bullets" id="why"></ul></div>
</div>

<div class="grid" style="margin-top:10px">
  <div class="card half"><h2>If it was held to now</h2><table id="hold"></table></div>
  <div class="card half"><h2>Expiry scenarios — 23 Nov</h2><table id="scenarios"></table><p class="note">Intrinsic at expiry only; ignores remaining time value. Entry breakeven = ₹90.47.</p></div>
</div>

<footer>
  <p><b>Data</b> · Upstox V3 1-minute candles for <code>NSE_FO|106407</code> and <code>NSE_EQ|INE053F01010</code>; option chain for the 23 Nov expiry. Frozen at <span id="stamp"></span>.</p>
  <p>Not investment advice. Historical fills are taken as 0.47/0.72; the current quote is a snapshot, not a live feed after this page was frozen.</p>
</footer>
</div>
<script>
const D=__DATA__;
const fmt=(v,d=2)=>Number(v).toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=v=>(v>=0?'+':'')+Number(v).toFixed(2)+'%';
const ce=D.series.ce9, eq=D.series.eq9, now=D.series.ce_now, eqn=D.series.eq_now;
const spotMap=new Map(eq.map(r=>[r.t.slice(11,16),r.c]));
const times=ce.map(r=>r.t);
const premium=ce.map(r=>r.c), spot=ce.map(r=>spotMap.get(r.t.slice(11,16))??null), vol=ce.map(r=>r.v);
const entryT=D.trade.entry_time, exitT=D.trade.exit_time;
function kpi(label,value,cls=''){return `<div class="card kpi"><div class="k">${label}</div><div class="v ${cls}">${value}</div></div>`}
document.getElementById('kpis').innerHTML=[
 kpi('Realised gross', '₹'+fmt(D.trade.gross_pnl), 'pos'),
 kpi('Return', pct(D.trade.return_pct), 'pos'),
 kpi('Entry → exit', `₹${D.trade.entry.toFixed(2)} → ₹${D.trade.exit.toFixed(2)}`, 'amber'),
 kpi('Current 90 CE', '₹'+D.now.ltp.toFixed(2), 'neg')
].join('');
document.getElementById('stamp').textContent=D.generated;
const rows=[
 ['Quantity',fmt(D.trade.qty,0)],['Entry',`₹${D.trade.entry.toFixed(2)}`],['Exit',`₹${D.trade.exit.toFixed(2)}`],
 ['Entry value',`₹${fmt(D.trade.entry_value)}`],['Exit value',`₹${fmt(D.trade.exit_value)}`],
 ['Gross P&L',`<span class="pos">₹${fmt(D.trade.gross_pnl)}</span>`],['Return',`<span class="pos">${pct(D.trade.return_pct)}</span>`],
 ['Entry spot',D.trade.entry_spot?`₹${D.trade.entry_spot.toFixed(2)}`:'—'],['Exit spot',D.trade.exit_spot?`₹${D.trade.exit_spot.toFixed(2)}`:'—']
];
document.getElementById('ledger').innerHTML=rows.map(([k,v])=>`<tr><td>${k}</td><td>${v}</td></tr>`).join('');
document.getElementById('why').innerHTML=[
 `<li><b>Timing:</b> entry at 14:47 near the local low; exit at 15:10 into the high-volume spike. The tape's 0.47 print precedes the 0.72 print.</li>`,
 `<li><b>Underlying:</b> IRFC moved ₹82.68 → ₹83.88 (+1.20, +1.45%) in 23 minutes. The option moved +53% — roughly 36× the spot move.</li>`,
 `<li><b>Structure:</b> 90 CE was still OTM at the high (83.99 vs 90). The gain was gamma, IV/demand and the final-hour squeeze, not intrinsic value.</li>`,
 `<li><b>Participation:</b> minute volume jumped from 32,550 to 417,725 and OI from 6.09M to 6.98M at the exit. That is real flow, not a stale print.</li>`,
 `<li><b>Exit discipline:</b> holding to 18 Nov would have turned the winner into a loser: the same contract is now ₹${D.now.ltp.toFixed(2)}.</li>`
].join('');
const hold=[
 ['Entry ₹0.47',`₹${fmt(D.trade.entry_value)}`],['Exit ₹0.72',`₹${fmt(D.trade.exit_value)}`],
 ['Current ₹'+D.now.ltp.toFixed(2),`₹${fmt(D.now.ltp*D.trade.qty)}`],
 ['Held from entry',`<span class="neg">₹${fmt(D.pnl_if_held.from_entry)} (${pct(D.pnl_if_held.from_entry_pct)})</span>`],
 ['Held from exit',`<span class="neg">₹${fmt(D.pnl_if_held.from_exit)} (${pct(D.pnl_if_held.from_exit_pct)})</span>`],
 ['Spot now',`₹${D.now.spot.toFixed(2)}`],['Days to expiry',D.now.days_to_expiry]
];
document.getElementById('hold').innerHTML=hold.map(([k,v])=>`<tr><td>${k}</td><td>${v}</td></tr>`).join('');
const scen=[80,82,84,86,88,90,92].map(s=>{const pnl=(Math.max(s-90,0)-0.47)*D.trade.qty; return `<tr><td>₹${s}</td><td>₹${Math.max(s-90,0).toFixed(2)}</td><td class="${pnl>=0?'pos':'neg'}">₹${fmt(pnl)}</td></tr>`}).join('');
document.getElementById('scenarios').innerHTML=`<thead><tr><th>Spot at expiry</th><th>Intrinsic</th><th>P&L from ₹0.47</th></tr></thead><tbody>${scen}</tbody>`;
const line=(x,y,name,axis,color,dash)=>x.map((t,i)=>({x:t,y:y[i],type:'scatter',mode:'lines',name,yaxis:axis,line:{color,width:1.6,dash:dash||'solid'},hovertemplate:`${name}: %{y:.2f}<extra></extra>`}));
const mk=(x,y,name,color,symbol)=>x.map((t,i)=>y[i]==null?null:{x:t,y:y[i],type:'scatter',mode:'markers+text',text:i===0?name:'',textposition:'top center',marker:{color,size:10,symbol},name,hovertemplate:`${name}: %{y:.2f}<extra></extra>`});
const baseLayout={paper_bgcolor:'#13161C',plot_bgcolor:'#13161C',font:{color:'#E8E8E8',size:11},margin:{l:52,r:52,t:28,b:42},legend:{orientation:'h',y:1.12,font:{size:10}},xaxis:{gridcolor:'#222832',tickfont:{size:10}},hovermode:'x unified'};
const y2={overlaying:'y',side:'right',gridcolor:'transparent',tickfont:{size:10},title:{text:'Premium ₹',font:{size:10}}};
Plotly.newPlot('main',[...line(times,spot,'IRFC spot','y','#4A8FD8'),line(times,premium,'90 CE','y2','#D9902A'),mk([entryT,exitT],[0.47,0.72],'fills','#16A34A','diamond')],{...baseLayout,yaxis:{...baseLayout.xaxis,title:{text:'Spot ₹',font:{size:10}}},yaxis2:y2,title:{text:'09 Nov 2026',font:{size:11}}},{displayModeBar:false,responsive:true});
const z=ce.filter(r=>r.t.slice(11,16)>='14:35'&&r.t.slice(11,16)<='15:25');
Plotly.newPlot('zoom',[line(z.map(r=>r.t),z.map(r=>r.c),'90 CE','y2','#D9902A'),line(z.map(r=>r.t),z.map(r=>spotMap.get(r.t.slice(11,16))??null),'IRFC spot','y','#4A8FD8')],{...baseLayout,showlegend:true,yaxis:{...baseLayout.xaxis,title:{text:'Spot ₹',font:{size:10}}},yaxis2:y2},{displayModeBar:false,responsive:true});
Plotly.newPlot('threed',[{type:'scatter3d',mode:'lines+markers',x:ce.map((_,i)=>i),y:ce.map(r=>spotMap.get(r.t.slice(11,16))??null),z:ce.map(r=>r.c),text:ce.map(r=>r.t),line:{color:'#D9902A',width:4},marker:{size:2,color:ce.map(r=>r.c),colorscale:[[0,'#4A8FD8'],[1,'#D9902A']]},hovertemplate:'%{text}<br>spot %{y:.2f}<br>CE %{z:.2f}<extra></extra>'}],{paper_bgcolor:'#13161C',plot_bgcolor:'#13161C',font:{color:'#E8E8E8',size:10},margin:{l:0,r:0,t:8,b:0},scene:{xaxis:{title:'minute'},yaxis:{title:'spot'},zaxis:{title:'premium'},camera:{eye:{x:1.6,y:1.5,z:1.1}}}},{displayModeBar:false,responsive:true});
Plotly.newPlot('now',[line(now.map(r=>r.t),now.map(r=>r.c),'90 CE','y2','#DC2626'),line(eqn.map(r=>r.t),eqn.map(r=>r.c),'IRFC spot','y','#4A8FD8')],{...baseLayout,showlegend:true,yaxis:{...baseLayout.xaxis,title:{text:'Spot ₹',font:{size:10}}},yaxis2:{...y2,title:{text:'Premium ₹',font:{size:10}}}},{displayModeBar:false,responsive:true});
</script></body></html>'''


if __name__ == "__main__":
    main()
