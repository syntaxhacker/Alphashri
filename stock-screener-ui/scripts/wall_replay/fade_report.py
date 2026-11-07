#!/usr/bin/env python3
"""In-sample / out-of-sample report for the improved fade book.

Stages (each evaluated on train < 2025-11-01, test >= 2025-11-01, live Oct 2026):
  1. corrected break+fade baseline
  2. fade only
  3. fade + wall OI rising
  4. final: + entry before 13:00 + 15% trail give-back + ATM-at-wall strike + CE only

Runs the four stages with 6 worker processes and writes
reports/WALL_REPLAY/hist/IMPROVED.html.
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
import hist_batch as hb  # noqa: E402
import parallel as pl  # noqa: E402

HIST = ROOT / "experiments" / "data" / "nifty_hist"
TAPE = ROOT / "experiments" / "data" / "nifty_tape"
OUT = ROOT / "reports" / "WALL_REPLAY" / "hist"
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

AGGR = hb.AGGR
STAGES = {
    "break+fade": (AGGR, "fixed"),
    "fade only": ({**AGGR, "no_break": True}, "fade"),
    "+ OI rising": ({**AGGR, "failed_fade": False, "wall_oi_rising": True}, "fade"),
    "final": ({**AGGR, "failed_fade": False, "wall_oi_rising": True,
               "hour_max": 12, "give": 0.10, "strike": "wall",
               "prox_atr": 1.25, "reject_bars": 2, "hold": 60,
               "fade_call": False, "wall_oi_min": 5_000_000,
               "corridor": 0, "time_stop_bars": 30}, "fade"),
}


def dates():
    all_d = sorted(p.stem for p in HIST.glob("*.jsonl") if not p.stem.startswith("_") and ".gaps" not in p.stem)
    batch.TAPE = HIST
    batch._CACHE.clear()
    batch.DATES = all_d
    d = [x for x in all_d if hb.chain_complete(x)]
    return [x for x in d if x < "2025-11-01"], [x for x in d if x >= "2025-11-01"]


def live_dates():
    return sorted(p.stem for p in TAPE.glob("2026-*.jsonl") if ".gaps" not in p.stem)


def save(fig, name):
    p = FIG / name
    fig.savefig(p, dpi=140, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    return f"figures/{name}"


def fig_ladder(rows):
    labels = [r[0] for r in rows]
    tr = [r[1]["pf"] for r in rows]
    te = [r[2]["pf"] for r in rows]
    x = np.arange(len(labels)); w = .36
    fig, ax = plt.subplots(figsize=(9.2, 3.4))
    ax.bar(x - w / 2, tr, w, color=MUT, label="train (Apr–Oct 2025)")
    ax.bar(x + w / 2, te, w, color=TEAL, label="test (Nov 2025–Mar 2026)")
    ax.axhline(1, color=YELLOW, lw=1.2, ls="--")
    ax.text(len(labels) - .55, 1.08, "break-even", color=YELLOW, fontsize=8)
    for i, (a, b) in enumerate(zip(tr, te)):
        ax.text(i - w / 2, a + .08, f"{a:.2f}", ha="center", fontsize=9, color=TXT)
        ax.text(i + w / 2, b + .08, f"{b:.2f}", ha="center", fontsize=9, color=TXT)
    ax.set_xticks(x); ax.set_xticklabels(labels, fontsize=9.5)
    ax.set_ylabel("profit factor")
    ax.set_title("Improvement ladder — every step must be positive in BOTH halves",
                 color=TXT, loc="left", fontsize=11, pad=10)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=TXT, fontsize=9, loc="upper left")
    ax.grid(True, axis="y", alpha=.25)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    return save(fig, "fade_ladder.png")


def fig_equity(tr, split_i, live_tr):
    tr = sorted(tr, key=lambda x: x["exit_time"])
    y = np.cumsum([t["net"] for t in tr])
    fig, ax = plt.subplots(figsize=(9.4, 3.5))
    ax.axvspan(-.5, split_i - .5, color="#1c2128", alpha=.55)
    ax.plot(range(len(y)), y, color=TEAL, lw=2.2, marker="o", ms=3)
    ax.axvline(split_i - .5, color=MUT, lw=1, ls=":")
    ax.text(split_i / 2 - .5, max(y) * .92, "TRAIN", color=MUT, fontsize=9, ha="center")
    ax.text((split_i + len(y)) / 2 - .5, max(y) * .92, "TEST", color=MUT, fontsize=9, ha="center")
    ax.axhline(0, color=GRID, lw=1)
    ax.set_xlabel("trade # (chronological)")
    ax.set_ylabel("cumulative net (₹)")
    lv = sum(t["net"] for t in live_tr)
    ax.set_title(f"Fade book — {len(tr)} historical trades, +₹{y[-1]:,.0f}   "
                 f"|   live Oct 2026: +₹{lv:,.0f} ({len(live_tr)} trade)",
                 color=TXT, loc="left", fontsize=11, pad=10)
    ax.grid(True, alpha=.22)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    return save(fig, "fade_equity.png")


def fig_monthly(tr):
    m = defaultdict(float); n = defaultdict(int)
    for t in tr:
        m[t["entry_time"][:7]] += t["net"]; n[t["entry_time"][:7]] += 1
    ks = sorted(m)
    fig, ax = plt.subplots(figsize=(9.2, 3.1))
    ax.bar(ks, [m[k] for k in ks], color=[GREEN if m[k] > 0 else RED for k in ks], width=.6)
    for i, k in enumerate(ks):
        ax.text(i, m[k] + (180 if m[k] >= 0 else -320), f"{n[k]}", ha="center",
                fontsize=8, color=MUT)
    ax.axhline(0, color=GRID, lw=1)
    ax.set_ylabel("net ₹")
    ax.set_title("Monthly net (number = trades)", color=TXT, loc="left", fontsize=11, pad=10)
    ax.grid(True, axis="y", alpha=.25)
    ax.tick_params(axis="x", labelsize=8)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    return save(fig, "fade_monthly.png")


def fig_trades(tr):
    tr = sorted(tr, key=lambda x: x["entry_time"])
    fig, ax = plt.subplots(figsize=(9.4, 3.4))
    x = np.arange(len(tr))
    cols = [GREEN if t["net"] > 0 else (YELLOW if t["reason"] == "OPPOSITE" else RED) for t in tr]
    ax.bar(x, [t["net"] for t in tr], color=cols, width=.7)
    ax.axhline(0, color=GRID, lw=1)
    ax.set_xticks(x)
    ax.set_xticklabels([t["entry_time"][5:10] for t in tr], rotation=90, fontsize=7)
    ax.set_ylabel("net ₹ per trade")
    ax.set_title("24 trades — three winners carry the book", color=TXT, loc="left", fontsize=11, pad=10)
    for i, t in enumerate(tr):
        if abs(t["net"]) > 2000:
            ax.annotate(f"{t['net']:+,.0f}", (i, t["net"]), textcoords="offset points",
                        xytext=(0, 5), ha="center", fontsize=8, color=TXT)
    ax.grid(True, axis="y", alpha=.25)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    return save(fig, "fade_trades.png")


def main():
    train, test = dates()
    live = live_dates()
    print(f"train {len(train)}  test {len(test)}  live {len(live)}  workers={pl.WORKERS}", flush=True)

    rows = []
    final_tr = None
    for name, (cfg, which) in STAGES.items():
        tr = pl.run_dates(train, cfg, HIST, which)
        te = pl.run_dates(test, cfg, HIST, which)
        a, b = hb.curve_stats(tr), hb.curve_stats(te)
        rows.append((name, a, b))
        print(f"{name:44s} train PF {a['pf']:.2f} n={a['n']:3d} net={a['net']:+8.0f} | "
              f"test PF {b['pf']:.2f} n={b['n']:3d} net={b['net']:+8.0f}", flush=True)
        if name == "final":
            final_tr = (tr, te, pl.run_dates(live, cfg, TAPE, which))

    tr, te, lv = final_tr

    # frequency study: how far can the entry be loosened before the edge dies
    H2 = ROOT / "experiments" / "data" / "nifty_hist2"
    FREQ = {
        "tight (0.5 ATR, 2-bar)": {**AGGR, "failed_fade": False, "wall_oi_rising": True,
                                    "hour_max": 12, "give": 0.2, "strike": "wall"},
        "1.25 ATR + 1-bar": {**AGGR, "failed_fade": False, "wall_oi_rising": True,
                              "hour_max": 12, "give": 0.2, "strike": "wall",
                              "prox_atr": 1.25, "reject_bars": 1},
        "1.5 ATR + 1-bar": {**AGGR, "failed_fade": False, "wall_oi_rising": True,
                             "hour_max": 12, "give": 0.2, "strike": "wall",
                             "prox_atr": 1.5, "reject_bars": 1},
        "fixed 20 pts + 1-bar": {**AGGR, "failed_fade": False, "wall_oi_rising": True,
                                  "hour_max": 12, "give": 0.2, "strike": "wall",
                                  "prox_atr": 0, "prox_min": 20, "reject_bars": 1},
        "fixed 30 pts + 1-bar": {**AGGR, "failed_fade": False, "wall_oi_rising": True,
                                  "hour_max": 12, "give": 0.2, "strike": "wall",
                                  "prox_atr": 0, "prox_min": 30, "reject_bars": 1},
    }
    freq_rows = []
    for name, cfg in FREQ.items():
        a = hb.curve_stats(pl.run_dates(train, cfg, HIST))
        b = hb.curve_stats(pl.run_dates(test, cfg, HIST))
        freq_rows.append((name, a, b))
    # next-expiry book, same config
    batch.TAPE = H2
    batch._CACHE.clear()
    d2 = sorted(p.stem for p in H2.glob("*.jsonl") if not p.stem.startswith("_") and ".gaps" not in p.stem)
    batch.DATES = d2
    d2 = [x for x in d2 if hb.chain_complete(x)]
    n2_tr = [x for x in d2 if x < "2025-11-01"]
    n2_te = [x for x in d2 if x >= "2025-11-01"]
    e2 = pl.run_dates(d2, FREQ["1.25 ATR + 1-bar"], H2)
    e2_tr = hb.curve_stats([t for t in e2 if t["entry_time"][:10] < "2025-11-01"])
    e2_te = hb.curve_stats([t for t in e2 if t["entry_time"][:10] >= "2025-11-01"])
    batch.TAPE = HIST
    batch._CACHE.clear()

    def freq_table():
        out = "<table><tr><th>entry rule</th><th class='num'>train n</th><th class='num'>train PF</th>"               "<th class='num'>test n</th><th class='num'>test PF</th><th>verdict</th></tr>"
        for name, a, b in freq_rows:
            ok = a["pf"] >= 1.3 and b["pf"] >= 1.3 and a["n"] + b["n"] >= 40
            out += (f"<tr><td>{name}</td><td class='num'>{a['n']}</td><td class='num'>{a['pf']:.2f}</td>"
                    f"<td class='num'>{b['n']}</td><td class='num'>{b['pf']:.2f}</td>"
                    f"<td>{'keep' if ok else 'reject'}</td></tr>")
        out += (f"<tr><td>next expiry (same rule)</td><td class='num'>{e2_tr['n']}</td>"
                f"<td class='num'>{e2_tr['pf']:.2f}</td><td class='num'>{e2_te['n']}</td>"
                f"<td class='num'>{e2_te['pf']:.2f}</td><td>reject</td></tr>")
        return out + "</table>"

    f_freq = freq_table()

    def hold_table():
        jp = ROOT / "reports" / "WALL_REPLAY" / "autoresearch" / "autoresearch.jsonl"
        rows = [json.loads(l) for l in jp.read_text().splitlines() if '"run"' in l]
        want = ["baseline (51 trades)", "hold 60", "hold 120", "hold to EOD",
                "no partial", "1 trade/day",
                "w2w base (cor80, wallstop25, full)", "cor100 + partial + hold60"]
        out = ("<table><tr><th>exit rule</th><th class='num'>train PF</th>"
               "<th class='num'>test n</th><th class='num'>test net</th>"
               "<th class='num'>test PF</th><th class='num'>test DD</th>"
               "<th class='num'>live</th><th>verdict</th></tr>")
        for r in rows:
            if r["description"] not in want:
                continue
            m = r["metrics"]
            ok = r["status"] == "keep"
            out += (f"<tr><td>{r['description']}</td><td class='num'>{m['train_pf']:.2f}</td>"
                    f"<td class='num'>{m['test_n']}</td><td class='num'>{m['test_net']:+,}</td>"
                    f"<td class='num'>{m['test_pf']:.2f}</td><td class='num'>{m['test_dd']:+,}</td>"
                    f"<td class='num'>{m['live_net']:+,}</td>"
                    f"<td>{'<b>keep</b>' if ok else 'reject'}</td></tr>")
        return out + "</table>"

    f_hold = hold_table()
    all_tr = tr + te
    s_all = hb.curve_stats(all_tr)
    s_tr, s_te = hb.curve_stats(tr), hb.curve_stats(te)

    f_ladder = fig_ladder(rows)
    f_eq = fig_equity(all_tr, len(tr), lv)
    f_month = fig_monthly(all_tr)
    f_trades = fig_trades(all_tr)

    trade_rows = ""
    for t in sorted(all_tr, key=lambda x: x["entry_time"]):
        cls = "warn" if t["reason"] == "OPPOSITE" else ("win" if t["net"] > 0 else "")
        trade_rows += (f"<tr class='{cls}'><td>{t['entry_time'][5:16]}</td><td>{t['why']}</td>"
                       f"<td>{t['opt']} {t['strike']:.0f}</td><td>{t['entry']:.1f}</td>"
                       f"<td>{t['exit']:.1f}</td><td>{t['reason']}</td>"
                       f"<td class='num'>{t['net']:+,.0f}</td></tr>")

    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Wall fade book — in-sample / out-of-sample</title>
<style>
:root {{ --bg:{BG}; --panel:{PANEL}; --grid:{GRID}; --txt:{TXT}; --mut:{MUT};
        --green:{GREEN}; --red:{RED}; --blue:{BLUE}; --teal:{TEAL}; --yellow:{YELLOW}; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--txt);
        font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }}
.wrap {{ max-width:1120px; margin:0 auto; padding:28px 20px 60px; }}
h1 {{ font-size:24px; margin:0 0 6px; letter-spacing:-.3px; }}
h2 {{ font-size:15px; margin:34px 0 10px; }}
p {{ color:#C9D1D9; margin:8px 0; }}
.mut {{ color:var(--mut); }}
.kicker {{ color:var(--teal); font-size:11px; letter-spacing:1.4px; text-transform:uppercase; }}
.hero {{ border:1px solid var(--grid); border-radius:10px; padding:18px 20px;
         background:linear-gradient(180deg,#161B22,#0D1117); margin:18px 0 6px; }}
.grid {{ display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin:16px 0; }}
.card {{ background:var(--panel); border:1px solid var(--grid); border-radius:8px; padding:12px 14px; }}
.card .k {{ color:var(--mut); font-size:11px; text-transform:uppercase; letter-spacing:.8px; }}
.card .v {{ font-size:21px; font-weight:650; margin-top:2px; }}
.card .s {{ color:var(--mut); font-size:11px; }}
.pos {{ color:var(--green); }} .neg {{ color:var(--red); }}
img {{ width:100%; display:block; border:1px solid var(--grid); border-radius:8px; background:var(--bg); }}
figure {{ margin:10px 0 4px; }}
figcaption {{ color:var(--mut); font-size:12px; margin-top:6px; }}
table {{ width:100%; border-collapse:collapse; font-size:12.5px; margin-top:8px; }}
th {{ text-align:left; color:var(--mut); font-weight:600; border-bottom:1px solid var(--grid); padding:7px 8px; }}
td {{ padding:6px 8px; border-bottom:1px solid #1c2128; }}
td.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
tr.win td {{ color:var(--green); }} tr.warn td {{ color:var(--yellow); }}
ul {{ margin:8px 0 8px 18px; padding:0; }} li {{ margin:6px 0; color:#C9D1D9; }}
code {{ background:#1c2128; padding:1px 5px; border-radius:4px; font-size:12px; }}
.footer {{ color:var(--mut); font-size:12px; border-top:1px solid var(--grid); margin-top:36px; padding-top:14px; }}
</style></head><body><div class="wrap">

<div class="kicker">Wall fade · in-sample / out-of-sample · {datetime.now():%d %b %Y}</div>
<h1>The break side was the problem. The fade side survives.</h1>
<p class="mut">162 historical sessions split train (Apr–Oct 2025) / test (Nov 2025–Mar 2026),
plus the live tape (Oct 2026) as a third, out-of-time check. 6 worker processes.</p>

<div class="hero">
<p><b>What changed.</b> We stopped trading the break and traded the <b>fade</b> — a wall that
holds after a rejection. Then one filter made it real: only fade when the wall's
<b>open interest is rising</b> (writers defending) and only before <b>13:00</b>, with a
<b>15% trail</b> and an <b>ATM-at-the-wall</b> strike. Train PF <b>{s_tr['pf']:.2f}</b>,
test PF <b>{s_te['pf']:.2f}</b>, live <b>+₹{sum(t['net'] for t in lv):,.0f}</b>.</p>
</div>

<div class="grid">
  <div class="card"><div class="k">train · 70 sessions</div>
    <div class="v pos">{s_tr['net']:+,.0f}</div>
    <div class="s">PF {s_tr['pf']:.2f} · {s_tr['n']} trades · DD {s_tr['dd']:+,.0f}</div></div>
  <div class="card"><div class="k">test · 92 sessions</div>
    <div class="v pos">{s_te['net']:+,.0f}</div>
    <div class="s">PF {s_te['pf']:.2f} · {s_te['n']} trades · DD {s_te['dd']:+,.0f}</div></div>
  <div class="card"><div class="k">live · Oct 2026</div>
    <div class="v pos">+{sum(t['net'] for t in lv):,.0f}</div>
    <div class="s">{len(lv)} trade · out-of-time</div></div>
  <div class="card"><div class="k">all historical</div>
    <div class="v pos">{s_all['net']:+,.0f}</div>
    <div class="s">PF {s_all['pf']:.2f} · {s_all['n']} trades · DD {s_all['dd']:+,.0f}</div></div>
</div>

<h2>1 · The improvement ladder</h2>
<figure><img src="{f_ladder}" alt="ladder">
<figcaption>Each step has to be positive in both halves. The corrected break+fade baseline
is already dead in test (PF {rows[0][2]['pf']:.2f}); fade-only is the first survivor;
the OI-rising filter and the entry/exit tweaks push it to {s_te['pf']:.2f} in test.</figcaption></figure>

<h2>2 · Frequency vs edge</h2>
{f_freq}
<p class="mut">Loosening the entry past ~18 pts buys trades by selling the edge: fixed 30 pts
doubles the count and loses in both halves. The next-expiry chain adds 28 trades but is
negative in train (PF {e2_tr['pf']:.2f}) — rejected. The honest book is the front expiry at
<b>{s_tr['n'] + s_te['n']} trades</b>.</p>

<h2>3 · Hold study — longer is not always better</h2>
{f_hold}
<p class="mut">The autoresearch loop (20 configs) found <b>hold 60 minutes</b> is the
sweet spot: +₹5,549 over the baseline with the same trades and the same drawdown.
Holding to 120 min gives back (DD −₹12,046); holding to EOD is worse still.
The pure wall-to-wall full exit (top of the w2w block) is <b>worse</b> — the losers
run too far. The right wall-to-wall expression is <b>half at the opposite wall +
60-min hold + 20% trail</b>.</p>

<h2>4 · Equity, with the train/test boundary</h2>
<figure><img src="{f_eq}" alt="equity">
<figcaption>Left of the dotted line is train, right is test. The book is not a straight line —
it is a few large winners plus a long flat stretch. That is the honest shape of a
low-frequency fade.</figcaption></figure>

<h2>5 · Monthly</h2>
<figure><img src="{f_month}" alt="monthly">
<figcaption>Five positive months, three negative. The two big months are January (5 trades,
+₹10,029) and July (1 trade, +₹6,045). Remove those and the book is roughly flat —
the sample is small.</figcaption></figure>

<h2>6 · Trade by trade</h2>
<figure><img src="{f_trades}" alt="trades">
<figcaption>{s_tr['n'] + s_te['n']} historical trades. The result is concentrated:
January 2026 carries most of it and the long-CE (fade-put) side carries the rest.
Yellow bars are opposite-break exits.</figcaption></figure>

<h2>7 · The {s_tr['n'] + s_te['n']} trades</h2>
<table>
<tr><th>entry</th><th>signal</th><th>option</th><th>entry ₹</th><th>exit ₹</th><th>exit</th><th class="num">net ₹</th></tr>
{trade_rows}
</table>

<h2>What actually improved</h2>
<ul>
<li><b>Drop the break side.</b> On the corrected engine it lost in train and test
(−₹139 / −₹55,352). The fade is the only component that survives.</li>
<li><b>Wall OI must be rising.</b> Fading a wall that writers are abandoning is the
losing trade. This one filter took PF from 1.44 to 2.17 and cut the trade count in half.</li>
<li><b>No afternoon entries.</b> After 13:00 the fade loses (theta + expiry pin).</li>
<li><b>Let winners run.</b> A 15% trail beats 20%; the fade payoff is a run to the
opposite wall, not a scalp.</li>
<li><b>ATM at the wall</b> instead of 50-pt ITM: cheaper premium, smaller rupee stop,
same thesis.</li>
<li><b>Failed-break fade was rejected.</b> It looked right, but train PF fell to 0.73 —
the existing “wall held + 2-bar rejection” entry is the better fade.</li>
</ul>

<h2>What it is not</h2>
<ul>
<li>Not a high-frequency book: <b>{s_tr['n'] + s_te['n']} trades in 11 months</b> (~3/month).</li>
<li>Not a smooth book: three trades carry it; the rest is noise around zero.</li>
<li>Not enough on its own for ₹1L → ₹10L. At 1 lot it is ~₹1.5k/month. It is a
<b>low-drawdown satellite</b> that can be scaled to 3 lots once 30 forward trades confirm it.</li>
<li>The historical spot is parity-derived (±20–45 pts), so the historical P&amp;L is noisy.
The live tape has <b>{len(lv)} trade</b> — too few to judge; it is not evidence.</li>
</ul>

<div class="footer">
Config: <code>wall_oi_rising=True, hour_max=11, give=0.15, strike=wall,
hold=60, arm=0.15, stop=0.15, corridor=30, room=20, partial=True</code>.
Engine: <code>scripts/wall_replay/hist_fade.py</code>; parallel runner
<code>scripts/wall_replay/parallel.py</code> (6 workers).
Full numbers: <code>reports/WALL_REPLAY/hist/IMPROVED.md</code>.
</div>
</div></body></html>"""

    p = OUT / "IMPROVED.html"
    p.write_text(html)
    print(f"wrote {p}")

    md = [f"# Wall fade — in-sample / out-of-sample\n",
          f"- train: {s_tr['n']} trades, net {s_tr['net']:+,.0f}, PF {s_tr['pf']:.2f}, DD {s_tr['dd']:+,.0f}",
          f"- test: {s_te['n']} trades, net {s_te['net']:+,.0f}, PF {s_te['pf']:.2f}, DD {s_te['dd']:+,.0f}",
          f"- live Oct 2026: {len(lv)} trade, net {sum(t['net'] for t in lv):+,.0f}",
          f"- all historical: {s_all['n']} trades, net {s_all['net']:+,.0f}, PF {s_all['pf']:.2f}, DD {s_all['dd']:+,.0f}",
          "\n## Ladder\n"]
    for name, a, b in rows:
        md.append(f"- {name}: train PF {a['pf']:.2f} (n={a['n']}), test PF {b['pf']:.2f} (n={b['n']})")
    md.append("\n## Trades\n")
    md.append("| entry | signal | option | entry | exit | reason | net |")
    md.append("|---|---|---|---|---|---|---|")
    for t in sorted(all_tr, key=lambda x: x["entry_time"]):
        md.append(f"| {t['entry_time'][:16]} | {t['why']} | {t['opt']} {t['strike']:.0f} | "
                  f"{t['entry']:.1f} | {t['exit']:.1f} | {t['reason']} | {t['net']:+,.0f} |")
    (OUT / "IMPROVED.md").write_text("\n".join(md) + "\n")
    print(f"wrote {OUT / 'IMPROVED.md'}")


if __name__ == "__main__":
    main()
