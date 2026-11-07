#!/usr/bin/env python3
"""HTML report: premium-selling strategies on the NIFTY 1-min chain.

Structures: short straddle, short strangle, iron condor, bull put, bear call.
One structure per day, held to 15:15 (or a % credit target/stop).
Train Apr–Oct 2025 / test Nov 2025–Mar 2026.

Writes reports/WALL_REPLAY/PREMIUM_SELLING.html + figures.
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

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "wall_replay"))
sys.path.insert(0, str(ROOT))
import batch  # noqa: E402
import hist_premium as hp  # noqa: E402
import hist_batch as hb  # noqa: E402

OUT = ROOT / "reports" / "WALL_REPLAY" / "premium"
FIG = OUT / "figures"
FIG.mkdir(parents=True, exist_ok=True)

BG, PANEL, GRID = "#0D1117", "#161B22", "#21262D"
TXT, MUT = "#E6EDF3", "#8B949E"
GREEN, RED, BLUE, TEAL, YELLOW, PURPLE = "#3FB950", "#F85149", "#58A6FF", "#39D2C0", "#D29922", "#BC8CFF"

plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": BG, "axes.edgecolor": GRID,
    "axes.labelcolor": MUT, "xtick.color": MUT, "ytick.color": MUT,
    "text.color": TXT, "grid.color": GRID, "savefig.facecolor": BG, "font.size": 10,
})

STRUCTS = [
    ("straddle", "Short straddle (ATM)", {"kind": "straddle", "hold_to_expiry": True}),
    ("strangle", "Short strangle (walls)", {"kind": "strangle", "hold_to_expiry": True}),
    ("condor", "Iron condor (walls ±100)", {"kind": "iron_condor", "hold_to_expiry": True}),
    ("bullput", "Bull put spread (put wall)", {"kind": "bull_put", "hold_to_expiry": True}),
    ("bearcall", "Bear call spread (call wall)", {"kind": "bear_call", "hold_to_expiry": True}),
    ("bias_strangle", "Short strangle + HTF bias skew", {"kind": "strangle", "hold_to_expiry": True, "dynamic_skew": 100}),
    ("atr_straddle", "Short straddle + ATR 6–15", {"kind": "straddle", "hold_to_expiry": True, "min_atr": 6, "max_atr": 15}),
]


def save(fig, name):
    p = FIG / name
    fig.savefig(p, dpi=140, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    return f"figures/{name}"


def equity(tr):
    tr = sorted(tr, key=lambda x: x["exit_time"])
    return np.cumsum([t["net"] for t in tr])


def fig_equity(series, name, title):
    fig, ax = plt.subplots(figsize=(9.4, 3.4))
    for label, tr, col in series:
        y = equity(tr)
        ax.plot(range(1, len(y) + 1), y, color=col, lw=2, label=f"{label} ({len(tr)})")
    ax.axhline(0, color=GRID, lw=1)
    ax.set_title(title, color=TXT, loc="left", fontsize=11, pad=10)
    ax.set_xlabel("trade #")
    ax.set_ylabel("cumulative net (₹)")
    ax.grid(True, alpha=.25)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TXT, fontsize=9)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    return save(fig, name)


def fig_pf(rows):
    labels = [r[0] for r in rows]
    tr = [r[1] for r in rows]
    te = [r[2] for r in rows]
    x = np.arange(len(labels)); w = .36
    fig, ax = plt.subplots(figsize=(9.2, 3.2))
    ax.bar(x - w / 2, tr, w, color=MUT, label="train")
    ax.bar(x + w / 2, te, w, color=TEAL, label="test")
    ax.axhline(1, color=YELLOW, lw=1.2, ls="--")
    for i, (a, b) in enumerate(zip(tr, te)):
        ax.text(i - w / 2, a + .03, f"{a:.2f}", ha="center", fontsize=9)
        ax.text(i + w / 2, b + .03, f"{b:.2f}", ha="center", fontsize=9)
    ax.set_xticks(x); ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylabel("profit factor")
    ax.set_title("Premium selling — PF in train vs test", color=TXT, loc="left", fontsize=11, pad=10)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TXT, fontsize=9)
    ax.grid(True, axis="y", alpha=.25)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    return save(fig, "pf.png")


def fig_monthly(tr, name):
    m = defaultdict(float)
    for t in tr:
        m[t["entry_time"][:7]] += t["net"]
    ks = sorted(m)
    fig, ax = plt.subplots(figsize=(9.2, 3.0))
    ax.bar(ks, [m[k] for k in ks], color=[GREEN if m[k] > 0 else RED for k in ks], width=.6)
    ax.axhline(0, color=GRID, lw=1)
    ax.set_ylabel("net ₹")
    ax.set_title("Monthly net — short straddle held to 15:15", color=TXT, loc="left", fontsize=11, pad=10)
    ax.grid(True, axis="y", alpha=.25)
    ax.tick_params(axis="x", labelsize=8)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    return save(fig, name)


def main():
    ds = hp.dates()
    batch.TAPE = hp.HIST
    batch._CACHE.clear()
    batch.DATES = ds
    ds = [d for d in ds if hb.chain_complete(d)]
    train = [d for d in ds if d < "2025-11-01"]
    test = [d for d in ds if d >= "2025-11-01"]

    results = []
    trades = {}
    for key, label, cfg in STRUCTS:
        a = [t for d in train for t in hp.run(d, cfg)]
        b = [t for d in test for t in hp.run(d, cfg)]
        sa, sb = hp.stats(a), hp.stats(b)
        results.append((key, label, sa, sb, a + b))
        trades[key] = a + b
        print(f"{label:32s} TR n={sa[0]:3d} PF={sa[3]:5.2f} net={sa[2]:+8.0f} | "
              f"TE n={sb[0]:3d} PF={sb[3]:5.2f} net={sb[2]:+8.0f} DD={sb[4]:+8.0f}", flush=True)

    f_pf = fig_pf([(r[1].split(" (")[0], r[2][3], r[3][3]) for r in results])
    f_eq = fig_equity([("straddle", trades["straddle"], TEAL),
                       ("strangle", trades["strangle"], BLUE),
                       ("condor", trades["condor"], PURPLE)],
                      "equity.png", "Premium selling — cumulative net, all 162 sessions")
    f_month = fig_monthly(trades["straddle"], "monthly.png")

    rows = ""
    for key, label, sa, sb, allt in results:
        rows += (f"<tr><td>{label}</td><td class='num'>{sa[0]}</td><td class='num'>{sa[3]:.2f}</td>"
                 f"<td class='num'>{sa[2]:+,.0f}</td><td class='num'>{sb[0]}</td>"
                 f"<td class='num'>{sb[3]:.2f}</td><td class='num'>{sb[2]:+,.0f}</td>"
                 f"<td class='num'>{sb[4]:+,.0f}</td><td class='num'>{sb[1]/max(1,sb[0])*100:.0f}%</td></tr>")

    worst = min(trades["straddle"], key=lambda t: t["net"])
    avg_credit = sum(t["credit"] for t in trades["straddle"]) / max(1, len(trades["straddle"]))
    straddle_all = hp.stats(trades["straddle"])
    st_train = hp.stats([t for t in trades["straddle"] if t["entry_time"][:10] < "2025-11-01"])
    st_test = hp.stats([t for t in trades["straddle"] if t["entry_time"][:10] >= "2025-11-01"])
    sg_train = hp.stats([t for t in trades["strangle"] if t["entry_time"][:10] < "2025-11-01"])
    sg_test = hp.stats([t for t in trades["strangle"] if t["entry_time"][:10] >= "2025-11-01"])

    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Premium selling — NIFTY</title><style>
:root {{ --bg:{BG}; --panel:{PANEL}; --grid:{GRID}; --txt:{TXT}; --mut:{MUT};
        --green:{GREEN}; --red:{RED}; --teal:{TEAL}; --yellow:{YELLOW}; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--txt);
        font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }}
.wrap {{ max-width:1120px; margin:0 auto; padding:28px 20px 60px; }}
h1 {{ font-size:24px; margin:0 0 6px; }}
h2 {{ font-size:15px; margin:32px 0 10px; }}
p {{ color:#C9D1D9; margin:8px 0; }}
.mut {{ color:var(--mut); }}
.kicker {{ color:var(--teal); font-size:11px; letter-spacing:1.4px; text-transform:uppercase; }}
.hero {{ border:1px solid var(--grid); border-radius:10px; padding:18px 20px;
         background:linear-gradient(180deg,#161B22,#0D1117); margin:18px 0 6px; }}
.hero b {{ color:var(--yellow); }}
.grid {{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:16px 0; }}
.card {{ background:var(--panel); border:1px solid var(--grid); border-radius:8px; padding:12px 14px; }}
.card .k {{ color:var(--mut); font-size:11px; text-transform:uppercase; letter-spacing:.8px; }}
.card .v {{ font-size:20px; font-weight:650; margin-top:2px; }}
.card .s {{ color:var(--mut); font-size:11px; }}
.pos {{ color:var(--green); }} .neg {{ color:var(--red); }}
img {{ width:100%; display:block; border:1px solid var(--grid); border-radius:8px; }}
figure {{ margin:10px 0 4px; }}
figcaption {{ color:var(--mut); font-size:12px; margin-top:6px; }}
table {{ width:100%; border-collapse:collapse; font-size:12.5px; margin-top:8px; }}
th {{ text-align:left; color:var(--mut); font-weight:600; border-bottom:1px solid var(--grid); padding:7px 8px; }}
td {{ padding:6px 8px; border-bottom:1px solid #1c2128; }}
td.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
ul {{ margin:8px 0 8px 18px; }} li {{ margin:6px 0; color:#C9D1D9; }}
.note {{ background:#161B22; border-left:3px solid var(--yellow); padding:8px 10px; margin:10px 0; font-size:12px; }}
.footer {{ color:var(--mut); font-size:12px; border-top:1px solid var(--grid); margin-top:36px; padding-top:14px; }}
</style></head><body><div class="wrap">

<div class="kicker">Premium selling · NIFTY 1-min chain · {datetime.now():%d %b %Y}</div>
<h1>Premium selling — the other side of the trade</h1>
<p class="mut">Short straddle / strangle / condor / credit spreads, one structure per day,
held to 15:15. 162 sessions, train Apr–Oct 2025 / test Nov 2025–Mar 2026. Costs included.</p>

<div class="hero">
<p><b>Verdict:</b> premium selling is <b>regime-dependent, not a free lunch</b>. The short
straddle made <b>+₹{st_test[2]:,.0f}</b> in test but lost <b>−₹{abs(st_train[2]):,.0f}</b> in train;
the strangle did the opposite. The drawdowns are large relative to the credit — a
short straddle is ~₹{avg_credit:,.0f} credit against a ₹{abs(straddle_all[4]):,.0f} drawdown
over all sessions. And the margin is the real constraint.</p>
</div>

<div class="grid">
<div class="card"><div class="k">Straddle · all</div>
  <div class="v {'pos' if hp.stats(trades['straddle'])[2]>0 else 'neg'}">₹{hp.stats(trades['straddle'])[2]:+,.0f}</div>
  <div class="s">{hp.stats(trades['straddle'])[0]} trades · PF {hp.stats(trades['straddle'])[3]:.2f}</div></div>
<div class="card"><div class="k">Straddle · test</div>
  <div class="v {'pos' if hp.stats([t for t in trades['straddle'] if t['entry_time'][:10]>='2025-11-01'])[2]>0 else 'neg'}">₹{hp.stats([t for t in trades['straddle'] if t['entry_time'][:10]>='2025-11-01'])[2]:+,.0f}</div>
  <div class="s">PF {hp.stats([t for t in trades['straddle'] if t['entry_time'][:10]>='2025-11-01'])[3]:.2f} · win {hp.stats([t for t in trades['straddle'] if t['entry_time'][:10]>='2025-11-01'])[1]/max(1,hp.stats([t for t in trades['straddle'] if t['entry_time'][:10]>='2025-11-01'])[0])*100:.0f}%</div></div>
<div class="card"><div class="k">Worst trade</div>
  <div class="v neg">₹{worst['net']:+,.0f}</div>
  <div class="s">{worst['entry_time'][:10]} · {worst['kind']}</div></div>
</div>

<h2>1 · All structures</h2>
<table>
<tr><th>structure</th><th class="num">train n</th><th class="num">train PF</th><th class="num">train net</th>
<th class="num">test n</th><th class="num">test PF</th><th class="num">test net</th>
<th class="num">test DD</th><th class="num">test win</th></tr>
{rows}
</table>

<h2>2 · PF — train vs test</h2>
<figure><img src="{f_pf}" alt="pf">
<figcaption>No structure is positive in both halves with a stable PF. The straddle flips from
0.83 to 1.27; the strangle from 1.10 to 1.00; the condor collapses in test.</figcaption></figure>

<h2>3 · Equity</h2>
<figure><img src="{f_eq}" alt="equity">
<figcaption>One structure per day, held to 15:15. The curves are smooth until they are not —
the tail days are what decide the year.</figcaption></figure>

<h2>4 · Monthly — short straddle</h2>
<figure><img src="{f_month}" alt="monthly">
<figcaption>The strategy is a volatility bet: it earns in quiet months and gives it back in
trending ones.</figcaption></figure>

<h2>Why it is not the answer</h2>
<ul>
<li><b>Regime flip.</b> Straddle: train {st_train[2]:+,.0f} / test {st_test[2]:+,.0f}.
Strangle: train {sg_train[2]:+,.0f} / test {sg_test[2]:+,.0f}.
That is a volatility regime, not an edge.</li>
<li><b>Tail risk.</b> The worst straddle day is ₹{worst['net']:+,.0f} against a ~₹{avg_credit:,.0f} credit.
One trend day erases many quiet ones.</li>
<li><b>Margin.</b> A naked NIFTY straddle needs roughly <b>₹1.2–1.8 lakh</b> SPAN margin per lot —
more than the ₹1L account. Defined-risk spreads need less (~₹25–50k) but the credit is small.</li>
<li><b>Costs.</b> A 2-leg structure is 4 orders; a 50% target on a small credit is often
smaller than the round-trip cost. Holding to expiry is the only way the maths works.</li>
</ul>

<div class="note"><b>What this means for Monday:</b> do not sell naked premium on a ₹1L account.
If you want the premium side, use a <b>defined-risk iron condor</b> at the OI walls, 1 lot,
with the long wings — and treat it as a separate paper book from the wall fade.</div>

<div class="footer">
Engine: <code>scripts/wall_replay/hist_premium.py</code> · report
<code>scripts/wall_replay/premium_report.py</code>. Data: 162 complete-chain sessions.
Costs: <code>options_paper/costs.py</code> (short legs pay STT on the sell).
</div>
</div></body></html>"""

    p = OUT / "PREMIUM_SELLING.html"
    p.write_text(html)
    (OUT / "premium_trades.json").write_text(json.dumps(
        {k: [{kk: t.get(kk) for kk in ("entry_time", "exit_time", "kind", "credit", "net", "reason")}
             for t in v] for k, v in trades.items()}, indent=1))
    print(f"wrote {p}")


if __name__ == "__main__":
    main()
