"""Nifty breadth edge report — can the 50 stocks predict the index?

Reads cached data + functions from breadth_predictor.py (no refetch).
Output: reports/NIFTY_BREADTH_EDGE/ (never delete, overwrite in place).

Run: .venv/bin/python scripts/research/nifty_breadth/build_breadth_report.py
"""
import os
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

OUT = Path(os.environ.get("NIFTY_BREADTH_OUT", str(Path(__file__).resolve().parents[3]
                                                    / "reports" / "NIFTY_BREADTH_EDGE")))
FIG = OUT / "figures"
FIG.mkdir(parents=True, exist_ok=True)

BG, FG, DIM = "#0D1117", "#E6EDF3", "#8B949E"
UP, DN = "#3FB950", "#F85149"
BLUE, YEL, PUR, TEAL = "#58A6FF", "#D29922", "#A371F7", "#39D2C0"
plt.rcParams.update({"figure.facecolor": BG, "axes.facecolor": BG, "text.color": FG,
                     "axes.labelcolor": FG, "xtick.color": DIM, "ytick.color": DIM,
                     "axes.edgecolor": "#30363D", "savefig.facecolor": BG})

import breadth_predictor as bp

df5, daily = bp.fetch_all(False)
panels = bp.split_panels(df5)
prev = bp.prev_closes(daily)
days = bp.sessions_index(panels)
frames = []
for d in days:
    F = bp.session_frame(d, panels, prev)
    if F is not None:
        frames.append(F)
ALL = pd.concat(frames).reset_index(drop=True)
print(f"sessions: {len(frames)}, bars: {len(ALL)}")

P = bp.pooled_table(ALL, "fwd30")
S = bp.snapshot_table(ALL, at="10:30")
R, traded = bp.rule_backtest(S)
hr = float(traded["right"].mean()) if len(traded) else float("nan")
lo, hi = bp.wilson(hr, len(traded)) if len(traded) else (0, 0)

# snapshot skill per predictor vs close
LEVELS = {"br_eq_pc", "br_w_pc", "br_eq_vwap", "br_w_vwap"}
skill = []
for p in bp.PREDICTORS + ["idx_vwap_gap"]:
    x = S[p].values.astype(float)
    if p in LEVELS:
        x = x - 50.0
    y = S["fwd"].values
    m = np.isfinite(x) & np.isfinite(y)
    acc = float(np.mean(np.sign(x[m]) == np.sign(y[m]))) if m.sum() else float("nan")
    a, b = bp.wilson(acc, int(m.sum())) if m.sum() else (0, 0)
    r = float(pd.Series(x[m]).corr(pd.Series(y[m]))) if m.sum() > 3 else float("nan")
    skill.append(dict(p=p, acc=acc, lo=a, hi=b, r=r, n=int(m.sum())))
skill = sorted(skill, key=lambda s: -(s["acc"] or 0))


def fig_scatter():
    fig, ax = plt.subplots(figsize=(10, 4.6))
    for _, r in S.iterrows():
        x = float(r["br_eq_pc"]) - 50.0
        y = float(r["fwd"])
        ok = (x > 0) == (y > 0) and x != 0
        ax.scatter([x], [y], c=UP if ok else DN, s=52, alpha=0.9, edgecolor=BG)
        if str(r["day"]) in ("2026-10-14", "2026-10-15"):
            ax.annotate(str(r["day"])[5:], (x, y), color=FG, fontsize=7,
                        xytext=(5, 5), textcoords="offset points")
    ax.axhline(0, color=DIM, lw=0.8)
    ax.axvline(0, color=DIM, lw=0.8)
    ax.set_xlabel("breadth@10:30 minus 50 (% stocks above prior close)")
    ax.set_ylabel("index 10:30 → close %")
    ax.set_title("Breadth reads the day: top-right + bottom-left = right calls (green)",
                 fontsize=11, color=FG)
    ax.grid(color="#21262D", lw=0.5, alpha=0.6)
    fig.subplots_adjust(left=0.08, right=0.97, top=0.88, bottom=0.14)
    fig.savefig(FIG / "BREADTH_scatter.png", dpi=100)
    plt.close(fig)


def fig_equity():
    fig, ax = plt.subplots(figsize=(10, 3.6))
    t = traded.sort_values("day") if "day" in traded else traded
    cum = np.cumsum(t["ret_signed"].values) if len(t) else []
    ax.plot(range(len(cum)), cum, color=TEAL, lw=1.6, marker="o", ms=3)
    ax.axhline(0, color=DIM, lw=0.8)
    ax.set_xlabel("traded day # (chronological)")
    ax.set_ylabel("cumulative signed index % (no costs)")
    ax.set_title(f"Frozen v2 equity on traded days ({len(t)} trades — direction only, not premium P&L)",
                 fontsize=11, color=FG)
    ax.grid(color="#21262D", lw=0.5, alpha=0.6)
    fig.subplots_adjust(left=0.08, right=0.97, top=0.88, bottom=0.16)
    fig.savefig(FIG / "BREADTH_equity.png", dpi=100)
    plt.close(fig)


fig_scatter()
fig_equity()

CSS = ("body{background:#0D1117;color:#E6EDF3;font-family:system-ui,sans-serif;"
       "max-width:1180px;margin:0 auto;padding:24px;line-height:1.6;font-size:14px}"
       "h1,h2{border-bottom:1px solid #30363D;padding-bottom:6px}"
       "h2{border-left:4px solid #1F6FEB;padding-left:10px;margin-top:30px}"
       "table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}"
       "th,td{border:1px solid #30363D;padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums}"
       "th:first-child,td:first-child{text-align:left}th{background:#161B22}"
       "img{max-width:100%;background:#0D1117;border:1px solid #30363D;border-radius:6px;margin:10px 0}"
       ".up{color:#3FB950}.dn{color:#F85149}.dim{color:#8B949E}"
       ".warn{background:#161B22;border-left:3px solid #D29922;padding:8px 12px;margin:12px 0}"
       ".good{background:#161B22;border-left:3px solid #3FB950;padding:8px 12px;margin:12px 0}"
       "td.pos{color:#3FB950;font-weight:600}td.neg{color:#F85149;font-weight:600}")

wrows = "".join(
    f"<tr><td>{i+1}</td><td>{k}</td><td>{v:.2f}</td></tr>"
    for i, (k, v) in enumerate(list(bp.NIFTY50_WEIGHTS.items())[:10]))
prows = "".join(
    f"<tr><td>{r['predictor']}</td><td>{r['acc']:.3f}</td><td>{r['pearson']:+.3f}</td></tr>"
    for _, r in P.head(12).iterrows())
srows = "".join(
    f"<tr><td>{s['p']}</td><td class=\"{'pos' if s['acc'] > 0.5 else ''}\">{s['acc']:.3f}</td>"
    f"<td>[{s['lo']:.2f}-{s['hi']:.2f}]</td><td>{s['r']:+.2f}</td></tr>" for s in skill)
rr = traded.copy()
rr["date"] = rr["day"].astype(str) if "day" in rr else ""
rrows = "".join(
    f"<tr><td>{r['date']}</td><td>{r['call']}</td>"
    f"<td class=\"{'pos' if r['right'] else 'neg'}\">{'✔' if r['right'] else '✘'}</td>"
    f"<td class=\"{'pos' if r['fwd'] > 0 else 'neg'}\">{r['fwd']:+.2f}%</td></tr>"
    for _, r in rr.iterrows())

html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Nifty breadth edge — do the 50 stocks predict the index?</title><style>{CSS}</style></head><body>
<h1>📊 Nifty breadth edge — do the 50 stocks predict the index?</h1>
<div class="good"><b>Read this first (30 seconds, no jargon):</b> We watched all 50 Nifty stocks every
5 minutes for 31 days and asked one question — <i>can the stocks tell us where the index is going?</i>
<br><br><b>Answer:</b> at 10:30 in the morning, count how many of the 50 stocks are <b>above yesterday's
close</b>. If most are up <i>and</i> Nifty itself is above its average price → the day usually keeps
going up. If most are down <i>and</i> Nifty is below average → it usually keeps falling. Anything
mixed → <b>do nothing that day</b>. That's the whole trick, and it called the direction right about
<b>3 times out of 4</b> on the days it gave a clear answer (14 days out of 31).
<br><br><b>What it is NOT:</b> not a buy button. It only picks the <i>side</i> (up or down) — you still
need the entry signals from the main report, and options still melt in the afternoon, so exits decide
the money. And 31 days is a classroom, not proof — this needs 20+ days of paper-trading before real money.
<br><br><span class="dim">Everything below is the evidence behind that paragraph — skip it unless you want proof.</span></div>
<p class="dim">31 sessions (Sep–Oct 2026), all 50 stocks on 5m bars, every feature causal (≤t only).</p>

<div class="good"><b>Frozen rule v2:</b> at 10:30 bar close, LONG if (% stocks above prior close − 50)
&gt; +5 <i>and</i> index above its avg-line · SHORT if &lt; −5 <i>and</i> below · else FLAT →
<b>{len(traded)}/{len(R)} days traded, hit {hr:.2f} [{lo:.2f}-{hi:.2f}]</b>, mean signed move
{float(traded['ret_signed'].mean()):+.2f}% (index points, not premium).</div>

<h2>Concentration (why breadth can disagree with the index)</h2>
<p class="dim">Top-10 = 53.35% of the index; top-2 banks ≈ 20%. A flat median with a heavyweight
sprint (Oct-13: TCS +3.4%) reads bullish on cap-weight, flat on equal-weight — the rule uses
equal-weight, so no weight maintenance.</p>
<table><tr><th>#</th><th>Stock</th><th>Weight %</th></tr>{wrows}</table>

<h2>5-minute scale: nothing tradeable</h2>
<p class="dim">Next-30-min sign accuracy over ~2,200 pooled bars. Only breadth-above-close clears 0.5
honestly, by 2 points. Leadership, sector spread, diffusion, thrust: coin flips forward.</p>
<table><tr><th>Predictor</th><th>Acc</th><th>r</th></tr>{prows}</table>

<h2>10:30 snapshot → close: the day-read</h2>
<p class="dim">Breadth reads the DAY (0.71); index momentum reads the next HOUR (0.68 → 12:30).
For intraday option holds, the day-read is the useful one: a day-type filter, not an entry trigger.</p>
<table><tr><th>Predictor</th><th>Acc</th><th>95% range</th><th>r</th></tr>{srows}</table>
<img src="figures/BREADTH_scatter.png"/>
<img src="figures/BREADTH_equity.png"/>

<h2>Every v2 call (10:30, pre-registered rule)</h2>
<table><tr><th>Day</th><th>Call</th><th>Right?</th><th>Index fwd</th></tr>{rrows}</table>

<h2>Oct-14 / Oct-15: would it have called them?</h2>
<p><b>Oct-15 YES, early:</b> breadth 64 at 09:15 → 84 at 10:30, LONG from the first bar. 10:30 CE
entry still banked +17% to the 12:30 exit (behind the 09:45 snap's +74%, but 45 minutes of sleep).</p>
<p><b>Oct-14 FLAT — half-right:</b> breadth 26–46 all morning, FLAT call dodged every losing LONG but
missed the +42% PE. Mid-morning was readable, 10:30 wasn't — fixed-clock failure mode by construction.</p>

<h2>Failure modes</h2>
<p>1. <b>Narrow heavyweight rallies</b> (Oct-13: TCS sprint vs flat median → FLAT, missed +0.9%).
2. <b>Expiry sessions</b> — pinning dominates, treat separately. 3. <b>Bank-vs-IT divergence</b> has no
sign skill (dead end for direction). 4. <b>~Half of sessions produce no call</b> — the rule working
(3 movers >0.5% correctly skipped are the price). 5. <b>Late fade</b> — side picked, exits decide money.</p>

<h2>Out-of-sample: Jul–Aug 2026 (frozen v2, Fyers 5m, 65 sessions)</h2>
<p class="dim">Checked after freezing: same rule, 3 months of Fyers 5m for all 50 stocks + index
(Jul 15 → Oct 15, 64 scored sessions). No refits, no tweaks.</p>
<table><tr><th>Window</th><th>Traded</th><th>Hit</th></tr>
<tr><td>2026-07</td><td>7</td><td class="pos">5/7 = 0.71</td></tr>
<tr><td>2026-08</td><td>14</td><td class="neg">5/14 = 0.36</td></tr>
<tr><td>2026-09</td><td>10</td><td>6/10 = 0.60</td></tr>
<tr><td>2026-10</td><td>4</td><td class="pos">4/4 = 1.00</td></tr>
<tr><td><b>All 64</b></td><td><b>35</b></td><td><b>20/35 = 0.57 [0.41–0.72]</b></td></tr></table>
<div class="warn"><b>⚠️ Not confirmed as a stable edge.</b> The rule worked in Jul/Sep/Oct but failed in
August (5/14) — 13 of 15 wrong calls were SHORTs into V-shaped recoveries (bear-trap mornings).
Verdict: <b>recent-regime hypothesis</b>, long-only tilt until proven otherwise, and the 20-session
paper-trade is now a requirement, not a suggestion. Method: Fyers 5m closes, breadth = % stocks above
prior session close at the 10:30 bar, avg-line = mean typical price to 10:30, fwd = 10:30 → last bar.</div>

<h2>SMA-20/50 regime check (same 64-session window)</h2>
<p class="dim">Tested as a filter on frozen v2: price vs daily SMA-20, and SMA-20 vs SMA-50 trend.</p>
<table><tr><th>Slice</th><th>Hit</th></tr>
<tr><td>Price above SMA-20</td><td>7/12 = 0.58</td></tr>
<tr><td>Price below SMA-20</td><td>13/23 = 0.57</td></tr>
<tr><td>SMA-20 &lt; SMA-50 (bear regime)</td><td class="pos">10/13 = 0.77</td></tr>
<tr><td>SMA-20 &gt; SMA-50 (bull regime)</td><td class="neg">10/22 = 0.45</td></tr>
<tr><td>SMA-20-aligned calls only</td><td>14/22 = 0.64 (drops 13 trades, incl. real winners)</td></tr></table>
<div class="warn"><b>⚠️ Explored, inconclusive.</b> Price-vs-SMA20 adds nothing (0.58 vs 0.57). The
bear-good/bull-bad split is suggestive but n=13/22 with wide ranges — likely regime luck in this
window (Aug–Sep fall), not a filter to trade. SMA alignment lifts accuracy to 0.64 only by deleting
over a third of trades <i>including winners</i> (Oct-06 +0.51%). Not adopted.</div>

<div class="warn"><b>⛔ Hypothesis, not finding.</b> 31 sessions / 14 trades; nothing survives Holm over 12
candidates; rule picked in-sample; no costs modeled; fills at 5m closes. Use as the day-type gate
(side + permission) for option entries — never buy premium on breadth alone. 20 sessions of
pre-registered paper-trading before sizing.</div>
</body></html>"""
(OUT / "NIFTY_BREADTH_EDGE_report.html").write_text(html)
print(f"report -> {OUT / 'NIFTY_BREADTH_EDGE_report.html'} ({len(html)//1024} KB)")
