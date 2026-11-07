#!/usr/bin/env python3
"""SNDK-style per-trade report for the premium-selling strangle book.

Each trade: spot candles with the short CE/PE strikes, entry/exit markers, and a
premium panel with the two short legs. Sidebar with days + TRAIN/TEST tags.

Run:
    .venv/bin/python scripts/wall_replay/premium_trades_report.py
"""

from __future__ import annotations

import base64
import sys
from collections import OrderedDict
from datetime import datetime, timedelta
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "wall_replay"))
sys.path.insert(0, str(ROOT))
import batch  # noqa: E402
import hist_batch as hb  # noqa: E402
import hist_premium as hp  # noqa: E402
import report as rp  # noqa: E402

OUT = ROOT / "reports" / "WALL_REPLAY" / "premium"
FIG = OUT / "trade_figs"
FIG.mkdir(parents=True, exist_ok=True)

CFG = {"kind": "strangle", "hold_to_expiry": True, "dynamic_skew": 100}

plt.rcParams.update({
    "figure.facecolor": "#0D1117", "axes.facecolor": "#0D1117",
    "axes.edgecolor": "#30363D", "axes.labelcolor": "#8B949E",
    "xtick.color": "#8B949E", "ytick.color": "#8B949E",
    "text.color": "#E6EDF3", "grid.color": "#21262D", "savefig.facecolor": "#0D1117",
})


def b64(p: Path) -> str:
    return base64.b64encode(p.read_bytes()).decode()


def fig_trade(t: dict, path: Path) -> None:
    d = t["entry_time"][:10]
    sb_full = rp.spot_bars(d)
    if not sb_full:
        return
    ed = datetime.fromisoformat(t["entry_time"])
    xd = datetime.fromisoformat(t["exit_time"])
    lo, hi = ed - timedelta(minutes=30), xd + timedelta(minutes=45)
    start = next((i for i, b in enumerate(sb_full) if b[0] >= lo), 0)
    end = next((i for i, b in enumerate(sb_full) if b[0] > hi), len(sb_full))
    sb = sb_full[start:end]
    shorts = [(k, o) for k, o, s in t["legs"] if s == -1]
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 5.2),
                                   gridspec_kw={"height_ratios": [2, 1]})
    rp.draw_candles(ax1, sb)
    lo_s = min(b[3] for b in sb); hi_s = max(b[2] for b in sb)
    pad = max((hi_s - lo_s) * .06, 5)
    ax1.set_ylim(lo_s - pad, hi_s + pad)
    for k, o in shorts:
        col = "#F85149" if o == "CE" else "#3FB950"
        ax1.axhline(k, color=col, ls="--", lw=1.0, alpha=.85, label=f"short {o} {k:.0f}")
    row = next((r for r in batch.rows(d) if r["t"] == t["entry_time"]), None)
    if row:
        mp = float(row.get("max_pain") or 0)
        if mp:
            ax1.axhline(mp, color="#D29922", ls=":", lw=1.0, alpha=.8, label=f"max pain {mp:.0f}")
        rp.mark(ax1, sb, ed, float(row["spot"]), kind="entry", plain=True)
        xr = next((r for r in batch.rows(d) if r["t"] == t["exit_time"]), row)
        rp.mark(ax1, sb, xd, float(xr["spot"]), kind="exit", plain=True)
    ax1.set_ylabel("NIFTY spot (1-min)", fontsize=8)
    ax1.legend(loc="upper left", fontsize=7, framealpha=.9, labelcolor="#E6EDF3", ncol=2)

    for k, o in shorts:
        ob = [b for b in rp.opt_bars(d, k, o) if lo <= b[0] <= hi]
        if not ob:
            continue
        col = "#F85149" if o == "CE" else "#3FB950"
        ax2.plot(range(len(ob)), [b[4] for b in ob], color=col, lw=1.2,
                 label=f"{o} {k:.0f} premium")
        rp.mark(ax2, ob, ed, t["entry"][f"{k}{o}"], kind="entry")
        cur = next((r for r in batch.rows(d) if r["t"] == t["exit_time"]), None)
        if cur:
            leg = (cur.get("chain") or {}).get(str(int(k)))
            px = float(leg[0] if o == "CE" else leg[1]) if leg else t["entry"][f"{k}{o}"]
            rp.mark(ax2, ob, xd, px, f"EXIT {px:.2f}", kind="exit")
    ax2.set_ylabel("premium", fontsize=8)
    ax2.legend(loc="upper left", fontsize=7, framealpha=.9, labelcolor="#E6EDF3", ncol=2)
    for a in (ax1, ax2):
        a.grid(color="#21262D", lw=.5, alpha=.6)
        a.tick_params(labelsize=7)
    strikes = " / ".join(f"{o} {k:.0f}" for k, o in shorts)
    ax1.set_title(f"{d}  short strangle {strikes}  ·  credit {t['credit']:.0f}  ·  "
                  f"{t['net']:+.0f} ({t['reason']})",
                  fontsize=10, color="#3FB950" if t["net"] > 0 else "#F85149")
    fig.tight_layout()
    fig.savefig(path, dpi=105)
    plt.close(fig)


def main() -> None:
    ds = hp.dates()
    batch.TAPE = hp.HIST
    batch._CACHE.clear()
    batch.DATES = ds
    ds = [d for d in ds if hb.chain_complete(d)]
    trades = []
    for d in ds:
        trades += hp.run(d, CFG)
    trades.sort(key=lambda t: t["entry_time"])
    print(f"{len(trades)} trades", flush=True)

    for i, t in enumerate(trades, start=1):
        t["date"] = t["entry_time"][:10]
        t["split"] = "train" if t["date"] < "2025-11-01" else "test"
        t["tid"] = f"p-{t['date']}-{i}"
        t["max"] = max(t["entry"].values())
        t["capture"] = 0.0
        p = FIG / f"{i:03d}_{t['date']}.png"
        fig_trade(t, p)
        t["fig"] = p
        if i % 20 == 0:
            print(f"  {i}/{len(trades)} charts", flush=True)

    days = OrderedDict()
    for t in trades:
        days.setdefault(t["date"], []).append(t)
    side = []
    for d, ts in days.items():
        net = sum(x["net"] for x in ts)
        links = "".join(
            f'<a class="trade" data-split="{x["split"]}" href="#{x["tid"]}">'
            f'<span class="tag {x["split"]}">{x["split"].upper()}</span> '
            f'{x["credit"]:.0f} cr <span class="{"pos" if x["net"] > 0 else "neg"}">{x["net"]:+.0f}</span></a>'
            for x in ts)
        side.append(f'<details class="day" open><summary>{rp.date_h(d)} '
                    f'<span class="dim">· <span class="{"pos" if net > 0 else "neg"}">{net:+.0f}</span></span></summary>'
                    f'{links}</details>')
    sidebar = "\n".join(side)

    n = len(trades)
    net = sum(t["net"] for t in trades)
    wins = sum(1 for t in trades if t["net"] > 0)
    gw = sum(t["net"] for t in trades if t["net"] > 0)
    gl = -sum(t["net"] for t in trades if t["net"] < 0)
    pf = gw / gl if gl else 0
    costs = sum(t["costs"] for t in trades)
    s = hp.stats(trades)
    dd = s[4]
    worst = min(trades, key=lambda t: t["net"])
    best = max(trades, key=lambda t: t["net"])

    sections = []
    for t in trades:
        cls = "pos" if t["net"] > 0 else "neg"
        sections.append(f"""<section id="{t['tid']}" data-split="{t['split']}" class="trade-sec">
<h3 class="{cls}"><span class="tag {t['split']}">{t['split'].upper()}</span>
{rp.date_h(t['date'])} · short strangle · {t['net']:+.0f}</h3>
<div class="reasons">
<div><span class="lbl">Entry</span> sell the walls @ {t['entry_time'][11:19]} · credit {t['credit']:.0f}</div>
<div><span class="lbl">Legs</span> {', '.join(f"{o} {k:.0f}" for k, o, s in t['legs'] if s == -1)}</div>
<div><span class="lbl">Exit</span> {t['reason']} @ {t['exit_time'][11:19]} · spot {t['exit_spot']:.0f}</div>
</div>
<table><tr><th>credit</th><th>gross</th><th>costs</th><th>net</th></tr>
<tr><td>{t['credit']:.0f}</td><td>{t['gross']:+.0f}</td><td>{t['costs']:.0f}</td>
<td class="{cls}">{t['net']:+.0f}</td></tr></table>
<img src="data:image/png;base64,{b64(t['fig'])}"/>
</section>""")

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Premium selling — {n} trades</title><style>
*{{box-sizing:border-box}} html{{scroll-behavior:smooth}}
body{{margin:0;background:#0D1117;color:#E6EDF3;font:12.5px/1.5 system-ui,sans-serif}}
.layout{{display:grid;grid-template-columns:255px minmax(0,1fr)}}
.side{{position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid #30363D;background:#0B0F14;padding:10px}}
.side-title{{font-size:12px;font-weight:700}} .side-sub{{color:#8B949E;font-size:10px;margin-bottom:8px}}
details.day{{margin:2px 0}} summary{{cursor:pointer;padding:4px 6px;border-radius:4px;font-size:11px;font-weight:600}}
summary:hover{{background:#161B22}}
a.trade{{display:block;padding:3px 6px 3px 14px;color:#8B949E;text-decoration:none;font-size:10.5px;border-left:2px solid transparent}}
a.trade:hover{{color:#E6EDF3;border-left-color:#1F6FEB;background:#161B22}}
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
.tag{{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.06em;padding:1px 5px;border-radius:4px}}
.tag.train{{background:#1F3A5F;color:#79C0FF}} .tag.test{{background:#1B3D2F;color:#56D364}}
.note{{background:#161B22;border-left:3px solid #D29922;padding:7px 9px;margin:8px 0;font-size:11px}}
.filter{{display:flex;gap:6px;margin:8px 0 2px}}
.filter button{{background:#161B22;color:#8B949E;border:1px solid #30363D;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer}}
.filter button.on{{background:#1F6FEB;color:#fff;border-color:#1F6FEB}}
@media(max-width:820px){{.layout{{grid-template-columns:1fr}}.side{{position:static;height:auto;border-right:0;border-bottom:1px solid #30363D}}.cards{{grid-template-columns:repeat(2,1fr)}}}}
</style></head><body><div class="layout">
<aside class="side">
<div class="side-title">Premium selling — strangle</div>
<div class="side-sub">Apr 2025 – Mar 2026 · {n} trades · 1 lot</div>
{sidebar}
</aside>
<main class="main">
<h1>Short strangle — {n} trades</h1>
<div class="dim" style="font-size:11px">Sell the OI walls, dynamic 100-pt skew with the HTF bias, hold to 15:15. 1 lot, costs included.</div>
<div class="cards">
<div class="card"><div class="k">Net</div><div class="v {'pos' if net>0 else 'neg'}">{net:+,.0f}</div><div class="dim" style="font-size:10px">{n} trades · PF {pf:.2f}</div></div>
<div class="card"><div class="k">Win rate</div><div class="v">{wins/n*100 if n else 0:.0f}%</div><div class="dim" style="font-size:10px">{wins}/{n}</div></div>
<div class="card"><div class="k">Max DD</div><div class="v neg">{dd:+,.0f}</div><div class="dim" style="font-size:10px">worst {worst['net']:+,.0f}</div></div>
<div class="card"><div class="k">Costs</div><div class="v">{costs:,.0f}</div><div class="dim" style="font-size:10px">~₹{costs/n if n else 0:.0f}/trade</div></div>
</div>
<div class="note"><b>How to read:</b> top = spot candles with the sold CE (red dashed) and PE (green dashed) strikes and max pain; white ▲ entry, yellow ✕ exit. Bottom = the two short-leg premiums.</div>
<h2>Trades</h2>
<div class="filter"><button class="on" onclick="flt('all',this)">All {n}</button>
<button onclick="flt('train',this)">Train {sum(1 for t in trades if t['split']=='train')}</button>
<button onclick="flt('test',this)">Test {sum(1 for t in trades if t['split']=='test')}</button></div>
{''.join(sections)}
<script>
function flt(s,btn){{
  document.querySelectorAll('.trade-sec').forEach(e=>e.style.display=(s==='all'||e.dataset.split===s)?'':'none');
  document.querySelectorAll('a.trade').forEach(e=>e.style.display=(s==='all'||e.dataset.split===s)?'':'none');
  document.querySelectorAll('.filter button').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}}
</script>
</main></div></body></html>"""
    p = OUT / "PREMIUM_TRADES.html"
    p.write_text(html)
    print(f"wrote {p} ({p.stat().st_size/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
