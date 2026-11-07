#!/usr/bin/env python3
"""SNDK-style per-trade report for the wall-fade book.

Reuses `report.fig_trade` (candlesticks, white entry triangle, yellow exit X,
purple EMA9, teal VWAP, wall/max-pain lines) and `report.trade_sections`.

Run:
    .venv/bin/python scripts/wall_replay/fade_trades_report.py
"""

from __future__ import annotations

import base64
import sys
from collections import OrderedDict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "wall_replay"))
sys.path.insert(0, str(ROOT))
import batch  # noqa: E402
import hist_batch as hb  # noqa: E402
import parallel as pl  # noqa: E402
import report as rp  # noqa: E402

HIST = ROOT / "experiments" / "data" / "nifty_hist"
OUT = ROOT / "reports" / "WALL_REPLAY" / "hist"
FIG = OUT / "trade_figs"
FIG.mkdir(parents=True, exist_ok=True)

FINAL = {**hb.AGGR, "failed_fade": False, "wall_oi_rising": True, "hour_max": 12,
         "give": 0.10, "strike": "wall", "prox_atr": 1.25, "reject_bars": 2, "hold": 60,
         "fade_call": False, "wall_oi_min": 5_000_000, "corridor": 0, "time_stop_bars": 30}


def b64(p: Path) -> str:
    return base64.b64encode(p.read_bytes()).decode()


def enrich(t: dict, rs: list[dict]) -> dict:
    d = t["entry_time"][:10]
    row = next((r for r in rs if r["t"] == t["entry_time"]), rs[0])
    spot = float(row["spot"])
    calls = (row.get("walls") or {}).get("calls") or []
    puts = (row.get("walls") or {}).get("puts") or []
    mp = float(row.get("max_pain") or 0)
    corr = (calls[0]["strike"] - puts[0]["strike"]) if (calls and puts) else 0
    mx = float(t.get("best") or t["entry"])
    pq = batch.LOT // 2
    avg_exit = t["exit"]
    if t.get("partial"):
        avg_exit = (t["partial_px"] * pq + t["exit"] * (batch.LOT - pq)) / batch.LOT
    cap = ((avg_exit - t["entry"]) / (mx - t["entry"]) * 100) if mx > t["entry"] else 0.0
    ctx = (f"spot {spot:.0f} · call wall {calls[0]['strike']:.0f} · put wall {puts[0]['strike']:.0f}"
           f" · max pain {mp:.0f} · corridor {corr:.0f} · OI rising")
    split = "train" if d < "2025-11-01" else "test"
    return {**t, "date": d, "split": split, "max": mx, "capture": cap, "avg_exit": avg_exit,
            "entry_ctx": ctx,
            "tid": f"trade-{d}-{t['opt']}{int(t['strike'])}-{t['entry_time'][11:16].replace(':','')}"}


def main() -> None:
    all_d = sorted(p.stem for p in HIST.glob("*.jsonl") if not p.stem.startswith("_") and ".gaps" not in p.stem)
    batch.TAPE = HIST
    batch._CACHE.clear()
    batch.DATES = all_d
    dates = [x for x in all_d if hb.chain_complete(x)]
    trades = pl.run_dates(dates, FINAL, HIST)
    trades.sort(key=lambda t: t["entry_time"])
    print(f"{len(trades)} trades on {len(dates)} sessions", flush=True)

    # enrich + chart
    enriched = []
    charts: dict[int, Path] = {}
    for i, t in enumerate(trades, start=1):
        rs = batch.rows(t["entry_time"][:10])
        e = enrich(t, rs)
        enriched.append(e)
        p = FIG / f"{i:02d}_{e['date']}_{e['opt']}{int(e['strike'])}.png"
        rp.fig_trade(e, p)
        charts[id(e)] = p
        if i % 10 == 0:
            print(f"  {i}/{len(trades)} charts", flush=True)

    # sidebar: days with trades + flat-day count
    days = OrderedDict()
    for t in enriched:
        days.setdefault(t["date"], []).append(t)
    side = []
    for d, ts in days.items():
        net = sum(x["net"] for x in ts)
        cls = "pos" if net > 0 else "neg"
        links = "".join(
            f'<a class="trade" data-split="{x["split"]}" href="#{x["tid"]}">'
            f'<span class="tag {x["split"]}">{x["split"].upper()}</span> {x["opt"]} {x["strike"]:.0f} '
            f'<span class="dim">· {x["why"]}</span> '
            f'<span class="{"pos" if x["net"] > 0 else "neg"}">{x["net"]:+.0f}</span></a>'
            for x in ts)
        side.append(f'<details class="day" open><summary>{rp.date_h(d)} '
                    f'<span class="dim">· {len(ts)} · <span class="{cls}">{net:+.0f}</span></span></summary>'
                    f'{links}</details>')
    flat = [d for d in dates if d not in days]
    side.append(f'<details class="day"><summary class="dim">Flat days ({len(flat)}) — no fade setup</summary>'
                f'<div class="flat">{" · ".join(d[5:] for d in flat)}</div></details>')
    sidebar = "\n".join(side)

    n = len(enriched)
    net = sum(t["net"] for t in enriched)
    wins = sum(1 for t in enriched if t["net"] > 0)
    gw = sum(t["net"] for t in enriched if t["net"] > 0)
    gl = -sum(t["net"] for t in enriched if t["net"] < 0)
    pf = gw / gl if gl else 0
    costs = sum(t["costs"] for t in enriched)
    dd = hb.curve_stats(enriched)["dd"]
    best = max(enriched, key=lambda t: t["net"])

    def sections_html():
        out = []
        for t in enriched:
            cls = "pos" if t["net"] > 0 else "neg"
            entry_why = rp.ENTRY_WHY.get(t["why"], t["why"])
            exit_why = rp.EXIT_WHY.get(t["reason"], t["reason"])
            partial = ""
            if t.get("partial"):
                partial = (f'<div><span class="lbl">Partial</span> half at {t["partial_px"]:.2f} · '
                           f'net {t["partial_net"]:+.0f}</div>')
            out.append(f"""<section id="{t['tid']}" data-split="{t['split']}" class="trade-sec">
<h3 class="{cls}"><span class="tag {t['split']}">{t['split'].upper()}</span>
{rp.date_h(t['date'])} · {t['opt']} {t['strike']:.0f} · {t['why']} · {t['net']:+.0f}</h3>
<div class="reasons">
<div><span class="lbl">Entry</span> {entry_why} @ {t['entry']:.2f} · {t['entry_time'][11:19]}</div>
<div><span class="lbl">Context</span> {t['entry_ctx']}</div>
<div><span class="lbl">Exit</span> {exit_why} @ {t['exit']:.2f} · {t['exit_time'][11:19]}</div>
{partial}
</div>
<table><tr><th>entry</th><th>exit</th><th>max</th><th>capture</th><th>gross</th><th>costs</th><th>net</th></tr>
<tr><td>{t['entry']:.2f}</td><td>{t['exit']:.2f}</td><td>{t['max']:.2f}</td>
<td>{t['capture']:.0f}%</td><td>{t['gross']:+.0f}</td><td>{t['costs']:.0f}</td>
<td class="{cls}">{t['net']:+.0f}</td></tr></table>
<img src="data:image/png;base64,{b64(charts[id(t)])}"/>
</section>""")
        return "\n".join(out)

    sections = sections_html()

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>NIFTY wall fade — {n} trades</title><style>
*{{box-sizing:border-box}} html{{scroll-behavior:smooth}}
body{{margin:0;background:#0D1117;color:#E6EDF3;font:12.5px/1.5 system-ui,sans-serif}}
.layout{{display:grid;grid-template-columns:255px minmax(0,1fr)}}
.side{{position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid #30363D;background:#0B0F14;padding:10px}}
.side-title{{font-size:12px;font-weight:700;letter-spacing:.02em}}
.side-sub{{color:#8B949E;font-size:10px;margin-bottom:8px}}
details.day{{margin:2px 0}}
summary{{cursor:pointer;padding:4px 6px;border-radius:4px;font-size:11px;font-weight:600}}
summary:hover{{background:#161B22}}
a.trade{{display:block;padding:3px 6px 3px 14px;color:#8B949E;text-decoration:none;font-size:10.5px;border-left:2px solid transparent}}
a.trade:hover{{color:#E6EDF3;border-left-color:#1F6FEB;background:#161B22}}
.flat{{padding:4px 6px;color:#8B949E;font-size:10px}}
.main{{padding:16px 20px;max-width:1080px}}
h1{{font-size:17px;margin:0 0 2px}} h2{{font-size:13px;margin:16px 0 6px;border-left:3px solid #1F6FEB;padding-left:8px}}
h3{{font-size:12px;margin:0 0 4px}}
table{{border-collapse:collapse;width:100%;font-size:11px}}
th,td{{border:1px solid #30363D;padding:3px 5px;text-align:right;font-variant-numeric:tabular-nums}}
th:first-child,td:first-child{{text-align:left}} th{{background:#161B22;color:#8B949E;font-weight:600}}
img{{width:100%;border:1px solid #30363D;border-radius:6px;margin:6px 0}}
.cards{{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}}
.card{{background:#161B22;border:1px solid #30363D;border-radius:6px;padding:8px}}
.card .k{{font-size:9.5px;color:#8B949E;text-transform:uppercase;letter-spacing:.03em}}
.card .v{{font-size:16px;font-weight:700}}
.trade-sec{{border:1px solid #30363D;border-radius:8px;padding:9px;margin:10px 0;background:#0B0F14;scroll-margin-top:10px}}
.reasons{{display:grid;gap:1px;font-size:11px;margin:3px 0 7px}}
.lbl{{display:inline-block;min-width:46px;color:#8B949E;font-size:9.5px;text-transform:uppercase}}
.pos{{color:#3FB950}} .neg{{color:#F85149}} .dim{{color:#8B949E}}
.note{{background:#161B22;border-left:3px solid #D29922;padding:7px 9px;margin:8px 0;font-size:11px}}
.tag{{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.06em;padding:1px 5px;border-radius:4px;vertical-align:middle}}
.tag.train{{background:#1F3A5F;color:#79C0FF}} .tag.test{{background:#1B3D2F;color:#56D364}}
.filter{{display:flex;gap:6px;margin:8px 0 2px}}
.filter button{{background:#161B22;color:#8B949E;border:1px solid #30363D;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer}}
.filter button.on{{background:#1F6FEB;color:#fff;border-color:#1F6FEB}}
@media(max-width:820px){{.layout{{grid-template-columns:1fr}}.side{{position:static;height:auto;border-right:0;border-bottom:1px solid #30363D}}.cards{{grid-template-columns:repeat(2,1fr)}}}}
</style></head><body><div class="layout">
<aside class="side">
<div class="side-title">NIFTY wall fade</div>
<div class="side-sub">Apr 2025 – Mar 2026 · {n} trades · 1 lot</div>
{sidebar}
</aside>
<main class="main">
<h1>Wall fade — {n} trades, SNDK-style</h1>
<div class="dim" style="font-size:11px">1-min chain · 1 lot (65 qty) · costs included · signal at bar t, fill at t+1 · hold 60 min · partial at the opposite wall · 20% trail.</div>
<div class="cards">
<div class="card"><div class="k">Train net</div><div class="v {'pos' if sum(t['net'] for t in enriched if t['split']=='train')>0 else 'neg'}">{sum(t['net'] for t in enriched if t['split']=='train'):+,.0f}</div><div class="dim" style="font-size:10px">{sum(1 for t in enriched if t['split']=='train')} trades · Apr–Oct 2025</div></div>
<div class="card"><div class="k">Test net</div><div class="v {'pos' if sum(t['net'] for t in enriched if t['split']=='test')>0 else 'neg'}">{sum(t['net'] for t in enriched if t['split']=='test'):+,.0f}</div><div class="dim" style="font-size:10px">{sum(1 for t in enriched if t['split']=='test')} trades · Nov 2025–Mar 2026</div></div>
<div class="card"><div class="k">Net</div><div class="v {'pos' if net>0 else 'neg'}">{net:+,.0f}</div><div class="dim" style="font-size:10px">{n} trades · PF {pf:.2f}</div></div>
<div class="card"><div class="k">Win rate</div><div class="v">{wins/n*100 if n else 0:.0f}%</div><div class="dim" style="font-size:10px">{wins}/{n} trades</div></div>
<div class="card"><div class="k">Costs</div><div class="v">{costs:,.0f}</div><div class="dim" style="font-size:10px">~₹{costs/n if n else 0:.0f}/trade</div></div>
<div class="card"><div class="k">Max DD</div><div class="v neg">{dd:+,.0f}</div><div class="dim" style="font-size:10px">best {best['net']:+,.0f} · {best['date']}</div></div>
</div>
<div class="note"><b>How to read a chart:</b> top panel = NIFTY spot 1-min candles with the call wall (red dashed), put wall (green dashed), max pain (yellow dotted) and target; white triangle = entry, yellow X = exit. Bottom panel = the option premium with entry/stop/max lines, the exit box and the partial diamond (if taken).</div>
<h2>Trades</h2>
<div class="filter"><button class="on" onclick="flt('all',this)">All {n}</button>
<button onclick="flt('train',this)">Train {sum(1 for t in enriched if t['split']=='train')}</button>
<button onclick="flt('test',this)">Test {sum(1 for t in enriched if t['split']=='test')}</button></div>
{sections}
<script>
function flt(s,btn){{
  document.querySelectorAll('.trade-sec').forEach(e=>e.style.display=(s==='all'||e.dataset.split===s)?'':'none');
  document.querySelectorAll('a.trade').forEach(e=>e.style.display=(s==='all'||e.dataset.split===s)?'':'none');
  document.querySelectorAll('.filter button').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}}
</script>
</main></div></body></html>"""

    p = OUT / "TRADES.html"
    p.write_text(html)
    print(f"wrote {p} ({p.stat().st_size/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
