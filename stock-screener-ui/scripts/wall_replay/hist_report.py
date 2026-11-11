#!/usr/bin/env python3
"""HTML report: why the wall book's PF 10.38 is not real.

Builds the four trade sets (live/historical x shipped/corrected), draws the
charts and writes reports/WALL_REPLAY/hist/HISTORICAL_RUN.html.

Run:
    .venv/bin/python scripts/wall_replay/hist_report.py
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import MaxNLocator

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "wall_replay"))
sys.path.insert(0, str(ROOT))
import batch  # noqa: E402
import hist_batch as hb  # noqa: E402
import hist_fixed as hf  # noqa: E402

HIST = ROOT / "experiments" / "data" / "nifty_hist"
TAPE = ROOT / "experiments" / "data" / "nifty_tape"
OUT = ROOT / "reports" / "WALL_REPLAY" / "hist"
FIG = OUT / "figures"
FIG.mkdir(parents=True, exist_ok=True)

BG = "#0D1117"
PANEL = "#161B22"
GRID = "#21262D"
TXT = "#E6EDF3"
MUT = "#8B949E"
GREEN = "#3FB950"
RED = "#F85149"
BLUE = "#58A6FF"
TEAL = "#39D2C0"
YELLOW = "#D29922"
PURPLE = "#BC8CFF"

plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": BG, "axes.edgecolor": GRID,
    "axes.labelcolor": MUT, "xtick.color": MUT, "ytick.color": MUT,
    "text.color": TXT, "grid.color": GRID, "savefig.facecolor": BG,
    "font.size": 10,
})


def load_live() -> tuple[list[str], list[dict], list[dict]]:
    batch.TAPE = TAPE
    batch._CACHE.clear()
    dates = sorted(p.stem for p in TAPE.glob("2026-*.jsonl") if ".gaps" not in p.stem)
    batch.DATES = dates
    shipped, corrected = [], []
    for d in dates:
        shipped += batch.run(d, hb.AGGR)
        corrected += hf.run(d, hb.AGGR)
    return dates, shipped, corrected


def load_hist() -> tuple[list[dict], list[dict]]:
    a = json.loads((OUT / "hist_shipped_trades.json").read_text())
    b = json.loads((OUT / "hist_corrected_trades.json").read_text())
    return a, b


def stats(trades: list[dict]) -> dict:
    s = hb.curve_stats(trades)
    wins = [t["net"] for t in trades if t["net"] > 0]
    loss = [t["net"] for t in trades if t["net"] < 0]
    s["avg_win"] = float(np.mean(wins)) if wins else 0.0
    s["avg_loss"] = float(np.mean(loss)) if loss else 0.0
    s["big_wins"] = sum(1 for x in wins if x >= 1000)
    return s


def equity(trades: list[dict]) -> np.ndarray:
    return np.cumsum([t["net"] for t in sorted(trades, key=lambda x: x["exit_time"])])


def save(fig, name: str) -> str:
    p = FIG / name
    fig.savefig(p, dpi=140, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    return f"figures/{name}"


def fig_equity(a, b, title, la, lb, name):
    fig, ax = plt.subplots(figsize=(9.2, 3.4))
    for tr, lab, col in ((a, la, MUT), (b, lb, TEAL)):
        y = equity(tr)
        ax.plot(range(1, len(y) + 1), y, color=col, lw=2, label=f"{lab} ({len(tr)} trades)")
        ax.scatter([len(y)], [y[-1]], color=col, s=28, zorder=5)
    ax.axhline(0, color=GRID, lw=1)
    ax.xaxis.set_major_locator(MaxNLocator(integer=True))
    ax.grid(True, alpha=.25)
    ax.set_title(title, color=TXT, loc="left", fontsize=11, pad=10)
    ax.set_xlabel("trade #")
    ax.set_ylabel("cumulative net (₹)")
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TXT, fontsize=9, loc="upper right")
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    return save(fig, name)


def fig_live_bars(trades):
    tr = sorted(trades, key=lambda x: x["entry_time"])
    fig, ax = plt.subplots(figsize=(9.2, 3.6))
    x = np.arange(len(tr))
    nets = [t["net"] for t in tr]
    cols = [YELLOW if t["reason"] == "OPPOSITE" else (GREEN if t["net"] > 0 else RED) for t in tr]
    ax.bar(x, nets, color=cols, width=.7)
    ax.axhline(0, color=GRID, lw=1)
    ax.grid(True, axis="y", alpha=.25)
    ax.set_xticks(x)
    ax.set_xticklabels([t["entry_time"][5:10] for t in tr], rotation=0, fontsize=8)
    ax.set_ylabel("net ₹ per trade")
    ax.set_title("The 14 live trades — 7 were scratched at entry by the bug",
                 color=TXT, loc="left", fontsize=11, pad=10)
    for i, t in enumerate(tr):
        if t["reason"] == "OPPOSITE":
            ax.annotate("scratch", (i, t["net"]), textcoords="offset points",
                        xytext=(0, 6), ha="center", fontsize=7, color=YELLOW)
    ax.text(.99, .95, "yellow = OPPOSITE exit (the bug)", transform=ax.transAxes,
            ha="right", va="top", color=YELLOW, fontsize=8)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    return save(fig, "live_trades.png")


def fig_pf(rows):
    fig, ax = plt.subplots(figsize=(7.4, 3.0))
    labels = [r[0] for r in rows]
    vals = [r[1] for r in rows]
    cols = [GREEN if v >= 1 else RED for v in vals]
    ax.barh(labels, vals, color=cols, height=.55)
    ax.axvline(1.0, color=YELLOW, lw=1.5, ls="--")
    ax.text(1.02, -.55, "break-even", color=YELLOW, fontsize=8)
    for i, v in enumerate(vals):
        ax.text(v + .12, i, f"{v:.2f}", va="center", color=TXT, fontsize=10, fontweight="bold")
    ax.set_xlabel("profit factor")
    ax.set_title("PF is a correct calculation of the wrong trades", color=TXT, loc="left",
                 fontsize=11, pad=10)
    ax.grid(True, axis="x", alpha=.25)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    return save(fig, "pf.png")


def fig_gross_costs(rows):
    fig, ax = plt.subplots(figsize=(8.4, 3.3))
    labels = [r[0] for r in rows]
    x = np.arange(len(labels))
    w = .26
    ax.bar(x - w, [r[1] for r in rows], w, color=TEAL, label="gross")
    ax.bar(x, [r[2] for r in rows], w, color=RED, label="costs")
    ax.bar(x + w, [r[3] for r in rows], w, color=BLUE, label="net")
    ax.axhline(0, color=GRID, lw=1)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylabel("₹")
    ax.set_title("Gross vs costs vs net — the historical book pays more in fees than it earns",
                 color=TXT, loc="left", fontsize=11, pad=10)
    ax.grid(True, axis="y", alpha=.25)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TXT, fontsize=9, loc="upper right")
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    return save(fig, "gross_costs.png")


def fig_monthly(trades):
    bym = defaultdict(float)
    for t in trades:
        bym[t["entry_time"][:7]] += t["net"]
    ms = sorted(bym)
    fig, ax = plt.subplots(figsize=(9.2, 3.2))
    vals = [bym[m] for m in ms]
    ax.bar(ms, vals, color=[GREEN if v > 0 else RED for v in vals], width=.65)
    ax.axhline(0, color=GRID, lw=1)
    ax.grid(True, axis="y", alpha=.25)
    ax.set_ylabel("net ₹")
    ax.set_title("162 historical sessions by month — 8 of 11 months negative",
                 color=TXT, loc="left", fontsize=11, pad=10)
    ax.tick_params(axis="x", labelsize=8)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    return save(fig, "monthly.png")


def fig_split(trades):
    g = defaultdict(list)
    for t in trades:
        g[t["why"]].append(t)
    order = ["break up", "break down", "fade put", "fade call"]
    vals = [sum(t["net"] for t in g.get(k, [])) for k in order]
    ns = [len(g.get(k, [])) for k in order]
    fig, ax = plt.subplots(figsize=(7.6, 3.1))
    ax.barh(order, vals, color=[RED if v < 0 else GREEN for v in vals], height=.55)
    ax.axvline(0, color=GRID, lw=1)
    ax.set_yticks(range(len(order)))
    ax.set_yticklabels([f"{k}   ₹{v:,.0f}  ({n})" for k, v, n in zip(order, vals, ns)], fontsize=9)
    ax.set_xlabel("net ₹")
    ax.set_title("Historical split: breaks bleed, fades earn", color=TXT, loc="left",
                 fontsize=11, pad=10)
    ax.grid(True, axis="x", alpha=.25)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    return save(fig, "split.png")


def main() -> None:
    dates, live_s, live_c = load_live()
    hist_s, hist_c = load_hist()
    S = {"live_s": stats(live_s), "live_c": stats(live_c),
         "hist_s": stats(hist_s), "hist_c": stats(hist_c)}

    f_eq_live = fig_equity(live_s, live_c, "Live tape (13 sessions) — shipped vs corrected",
                           "shipped (buggy)", "corrected", "live_equity.png")
    f_eq_hist = fig_equity(hist_s, hist_c, "162 historical sessions — shipped vs corrected",
                           "shipped (buggy)", "corrected", "hist_equity.png")
    f_bars = fig_live_bars(live_s)
    f_pf = fig_pf([("live — shipped", S["live_s"]["pf"]), ("live — corrected", S["live_c"]["pf"]),
                   ("hist — shipped", S["hist_s"]["pf"]), ("hist — corrected", S["hist_c"]["pf"])])
    f_gc = fig_gross_costs([
        ("live shipped", S["live_s"]["gross"], S["live_s"]["costs"], S["live_s"]["net"]),
        ("live corrected", S["live_c"]["gross"], S["live_c"]["costs"], S["live_c"]["net"]),
        ("hist shipped", S["hist_s"]["gross"], S["hist_s"]["costs"], S["hist_s"]["net"]),
        ("hist corrected", S["hist_c"]["gross"], S["hist_c"]["costs"], S["hist_c"]["net"]),
    ])
    f_month = fig_monthly(hist_s)
    f_split = fig_split(hist_s)

    def money(x):
        return f"{x:+,.0f}"

    rows = ""
    for t in sorted(live_s, key=lambda x: x["entry_time"]):
        flag = " class='warn'" if t["reason"] == "OPPOSITE" else ""
        rows += (f"<tr{flag}><td>{t['entry_time'][5:16]}</td><td>{t['why']}</td>"
                 f"<td>{t['opt']} {t['strike']:.0f}</td><td>{t['entry']:.1f}</td>"
                 f"<td>{t['exit']:.1f}</td><td>{t['reason']}</td>"
                 f"<td class='num'>{money(t['net'])}</td></tr>")

    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Wall book — historical validation</title>
<style>
:root {{ --bg:{BG}; --panel:{PANEL}; --grid:{GRID}; --txt:{TXT}; --mut:{MUT};
        --green:{GREEN}; --red:{RED}; --blue:{BLUE}; --teal:{TEAL}; --yellow:{YELLOW}; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--txt);
        font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }}
.wrap {{ max-width:1120px; margin:0 auto; padding:28px 20px 60px; }}
h1 {{ font-size:24px; margin:0 0 6px; letter-spacing:-.3px; }}
h2 {{ font-size:15px; margin:34px 0 10px; color:var(--txt); }}
p {{ color:#C9D1D9; margin:8px 0; }}
.mut {{ color:var(--mut); }}
.kicker {{ color:var(--teal); font-size:11px; letter-spacing:1.4px; text-transform:uppercase; }}
.hero {{ border:1px solid var(--grid); border-radius:10px; padding:18px 20px;
         background:linear-gradient(180deg,#161B22,#0D1117); margin:18px 0 6px; }}
.hero b {{ color:var(--red); }}
.grid {{ display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin:16px 0; }}
.card {{ background:var(--panel); border:1px solid var(--grid); border-radius:8px; padding:12px 14px; }}
.card .k {{ color:var(--mut); font-size:11px; text-transform:uppercase; letter-spacing:.8px; }}
.card .v {{ font-size:22px; font-weight:650; margin-top:2px; }}
.card .s {{ color:var(--mut); font-size:11px; }}
.pos {{ color:var(--green); }} .neg {{ color:var(--red); }}
img {{ width:100%; display:block; border:1px solid var(--grid); border-radius:8px; background:var(--bg); }}
figure {{ margin:10px 0 4px; }}
figcaption {{ color:var(--mut); font-size:12px; margin-top:6px; }}
table {{ width:100%; border-collapse:collapse; font-size:12.5px; margin-top:8px; }}
th {{ text-align:left; color:var(--mut); font-weight:600; border-bottom:1px solid var(--grid);
      padding:7px 8px; }}
td {{ padding:6px 8px; border-bottom:1px solid #1c2128; }}
td.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
tr.warn td {{ background:#2a2110; color:var(--yellow); }}
ul {{ margin:8px 0 8px 18px; padding:0; }} li {{ margin:6px 0; color:#C9D1D9; }}
code {{ background:#1c2128; padding:1px 5px; border-radius:4px; font-size:12px; }}
.footer {{ color:var(--mut); font-size:12px; border-top:1px solid var(--grid);
           margin-top:36px; padding-top:14px; }}
</style></head><body><div class="wrap">

<div class="kicker">Wall replay · historical validation · {datetime.now():%d %b %Y}</div>
<h1>The PF wasn't wrong. The trades were.</h1>
<p class="mut">The Lenovo USB archive, 162 complete-chain sessions (Apr 2025 → Mar 2026),
run through the same wall engine as the live book.</p>

<div class="hero">
<p><b>Short answer.</b> PF is just total wins ÷ total losses. The engine fed it
14 trades, but <b>7 of those were fake</b> — closed at entry by a broken
“opposite break” rule. Those 7 lost only ~₹10 each, so they never counted as
losses, while the 6 real winners made ₹16.5k. Divide one by the other and you
get 10.38. <b>Fix the rule and the same 13 days give PF 1.21.</b></p>
</div>

<div class="grid">
  <div class="card"><div class="k">live · shipped</div>
    <div class="v pos">₹{S['live_s']['net']:,.0f}</div>
    <div class="s">PF {S['live_s']['pf']:.2f} · {S['live_s']['n']} trades</div></div>
  <div class="card"><div class="k">live · corrected</div>
    <div class="v pos">₹{S['live_c']['net']:,.0f}</div>
    <div class="s">PF {S['live_c']['pf']:.2f} · {S['live_c']['n']} trades</div></div>
  <div class="card"><div class="k">hist · shipped</div>
    <div class="v neg">₹{S['hist_s']['net']:,.0f}</div>
    <div class="s">PF {S['hist_s']['pf']:.2f} · {S['hist_s']['n']} trades</div></div>
  <div class="card"><div class="k">hist · corrected</div>
    <div class="v neg">₹{S['hist_c']['net']:,.0f}</div>
    <div class="s">PF {S['hist_c']['pf']:.2f} · {S['hist_c']['n']} trades</div></div>
</div>

<h2>1 · The live book, trade by trade</h2>
<figure><img src="{f_bars}" alt="live trades">
<figcaption>The 7 yellow bars are the bug. They are not “small losses” — they are
trades that were never allowed to run. The six green bars are the entire profit.</figcaption></figure>

<figure><img src="{f_eq_live}" alt="live equity">
<figcaption>Same 13 days. The shipped curve looks perfect because it never takes a
real loss; the corrected curve takes 20 trades and earns a normal amount.</figcaption></figure>

<h2>2 · Profit factor is a symptom, not the cause</h2>
<figure><img src="{f_pf}" alt="PF comparison">
<figcaption>PF 10.38 is a correct division of a wrong numerator and denominator.
With the exit fixed it is 1.21 on live data, and below 1.0 on the historical sample.</figcaption></figure>

<h2>3 · Why the historical book loses: costs</h2>
<figure><img src="{f_gc}" alt="gross vs costs">
<figcaption>On 162 sessions the strategy earned <b>₹{S['hist_s']['gross']:,.0f}</b> gross and
paid <b>₹{S['hist_s']['costs']:,.0f}</b> in brokerage/STT/fees. The edge is smaller than the friction.</figcaption></figure>

<figure><img src="{f_month}" alt="monthly">
<figcaption>Eight of eleven months are negative. There is no “one bad month” story.</figcaption></figure>

<h2>4 · The one part that worked: the fades</h2>
<figure><img src="{f_split}" alt="break vs fade">
<figcaption>The break side — the core of the playbook — lost ₹21,970 over 201 trades.
The fade side (betting a wall holds after a failed break) made ₹7,570 over 42.
That is your “opposite of the loss” observation showing up in a 162-session sample.</figcaption></figure>

<h2>5 · The 14 live trades</h2>
<table>
<tr><th>entry</th><th>signal</th><th>option</th><th>entry ₹</th><th>exit ₹</th><th>exit reason</th><th class="num">net ₹</th></tr>
{rows}
</table>
<p class="mut">Rows in yellow were closed by the buggy OPPOSITE exit at essentially the
entry price. Remove them and the book is 6 winners + 1 EOD trade — a sample far too
small to claim an edge.</p>

<h2>Why it didn’t work — in four lines</h2>
<ul>
<li><b>The exit was lying.</b> It tested a put wall that often sat <i>above</i> spot,
so “the opposite side broke” was true the moment you entered. It scratched half the book.</li>
<li><b>The break used the wrong wall.</b> It compared price to the current bar’s wall;
by then the crossed strike had already dropped out of the list.</li>
<li><b>The edge is smaller than the fees.</b> ₹35 gross per trade against ₹95 round-trip.</li>
<li><b>The sample was tiny.</b> 14 trades, 13 days, one regime — and 7 of them were fake.</li>
</ul>

<h2>What to do</h2>
<ul>
<li>Do <b>not</b> size up on the +₹16,327. It is withdrawn.</li>
<li>Paper only, 1 lot, with the corrected exit — or skip the breakout side entirely.</li>
<li>If anything is worth forward-testing, it is the <b>fade</b> side, not the break.</li>
<li>The 30-trade PF ≥ 1.3 gate restarts from +₹3,562 / PF 1.21.</li>
</ul>

<div class="footer">
Method: USB archive → 1-min chain rows (put-call-parity spot, forward-filled prices/OI,
cumulative volume, ±300-pt walls, max pain). Costs from <code>options_paper/costs.py</code>,
65-lot. 162 sessions have a complete 50-pt front chain; the early sparse folders are excluded.
Caveats: parity spot carries ±20–45 pts of level error, front expiry only, last-traded option
prices. Full write-up: <code>reports/WALL_REPLAY/hist/HISTORICAL_RUN.md</code>.
</div>
</div></body></html>"""

    p = OUT / "HISTORICAL_RUN.html"
    p.write_text(html)
    print(f"wrote {p}")
    print(f"figures: {', '.join(p.name for p in sorted(FIG.glob('*.png')))}")


if __name__ == "__main__":
    main()
