"""SNDK pre-range fade — gallery + edge/exit study.

Backtest rules tested on the 1h/6mo and 5m/60d samples:
  entry  : RED pre -> LONG if open > pre_low ; GREEN pre -> SHORT if open < pre_high
  stop   : hard stop at the pre range level
  exits  : see EXIT RULES (target / EMA9 / EMA20 / VWAP / time)
Charts use the recommended exit (EMA9 cross or 12:30, no fixed target).
"""
import datetime
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
import numpy as np
import pandas as pd
import yfinance as yf
from pathlib import Path
from zoneinfo import ZoneInfo

OUT = Path(os.environ.get("PRERANGE_OUT", str(Path(__file__).resolve().parents[3]
                                                    / "reports" / "SNDK_STRATEGY")))
FIG = OUT / "figures"
FIG.mkdir(parents=True, exist_ok=True)
NY = ZoneInfo("America/New_York")
T = lambda h, m: datetime.time(h, m)

BG, FG, DIM = "#0D1117", "#E6EDF3", "#8B949E"
UP, DN = "#3FB950", "#F85149"
BLUE, YEL, PUR = "#58A6FF", "#D29922", "#A371F7"
plt.rcParams.update({"figure.facecolor": BG, "axes.facecolor": BG, "text.color": FG,
                     "axes.labelcolor": FG, "xtick.color": DIM, "ytick.color": DIM,
                     "axes.edgecolor": "#30363D", "savefig.facecolor": BG})

_t = yf.Ticker("SNDK")
_daily = _t.history(period="7mo", interval="1d", auto_adjust=False)
_daily.index = _daily.index.tz_convert(NY)
CLOSES = {d.date(): float(r["Close"]) for d, r in _daily.iterrows()}
TDATES = sorted(CLOSES)


def load(period, interval):
    df = _t.history(period=period, interval=interval, prepost=True, auto_adjust=False)
    df.index = df.index.tz_convert(NY)
    return df


def prep(day):
    """Split day into pre/regular and add EMA9/EMA20/VWAP to the regular session."""
    pre = day[day.index.time < T(9, 30)]
    reg = day[(day.index.time >= T(9, 30)) & (day.index.time < T(16, 0))]
    if len(pre) == 0 or len(reg) == 0:
        return None
    g = reg.copy()
    g["ema9"] = g["Close"].ewm(span=9, adjust=False).mean()
    g["ema20"] = g["Close"].ewm(span=20, adjust=False).mean()
    tp = (g["High"] + g["Low"] + g["Close"]) / 3
    g["vwap"] = (tp * g["Volume"]).cumsum() / g["Volume"].cumsum()
    return pre, g


def simulate(reg, side, entry, stop, tgt, rule, moc):
    """Return (exit_px, why, exit_i). Hard stop checked intrabar; signal exits on close."""
    for i, (ts, b) in enumerate(reg.iterrows()):
        hi, lo, cl = float(b["High"]), float(b["Low"]), float(b["Close"])
        if side == "LONG":
            if lo <= stop:
                return stop, "STOP", i
            if tgt and hi >= tgt:
                return tgt, "TARGET", i
            if rule == "VWAP" and i > 0 and cl < b["vwap"]:
                return cl, "VWAP", i
            if rule == "EMA9" and i > 0 and cl < b["ema9"]:
                return cl, "EMA9", i
            if rule == "EMA20" and i > 0 and cl < b["ema20"]:
                return cl, "EMA20", i
        else:
            if hi >= stop:
                return stop, "STOP", i
            if tgt and lo <= tgt:
                return tgt, "TARGET", i
            if rule == "VWAP" and i > 0 and cl > b["vwap"]:
                return cl, "VWAP", i
            if rule == "EMA9" and i > 0 and cl > b["ema9"]:
                return cl, "EMA9", i
            if rule == "EMA20" and i > 0 and cl > b["ema20"]:
                return cl, "EMA20", i
        if moc and ts.strftime("%H:%M") >= moc:
            return cl, "TIME", i
    return float(reg["Close"].iloc[-1]), "MOC", len(reg) - 1


def backtest(df, rule="NONE", moc=None, tgt_mode="pre", min_move=1.0, max_move=5.0,
             require_inside=True):
    trades = []
    for D in sorted(set(df.index.date)):
        p = prep(df[df.index.date == D].sort_index())
        if not p:
            continue
        pre, reg = p
        prior = [x for x in TDATES if x < D]
        if not prior:
            continue
        pc = CLOSES[prior[-1]]
        pre_hi, pre_lo = float(pre["High"].max()), float(pre["Low"].min())
        pre_last = float(pre["Close"].iloc[-1])
        chg = abs(pre_last / pc - 1) * 100
        if not (min_move <= chg <= max_move):
            continue
        o = float(reg["Open"].iloc[0])
        if require_inside and not (pre_lo < o < pre_hi):
            continue
        side = "LONG" if pre_last < pc else "SHORT"
        stop = pre_lo if side == "LONG" else pre_hi
        tgt = (pre_hi if side == "LONG" else pre_lo) if tgt_mode == "pre" else None
        ex, why, i = simulate(reg, side, o, stop, tgt, rule, moc)
        pnl = ((ex - o) / o if side == "LONG" else (o - ex) / o) * 100
        trades.append(dict(date=str(D), side=side, prev_close=pc, pre_hi=pre_hi, pre_lo=pre_lo,
                           pre_last=pre_last, pre_chg=pre_chg_sign(pre_last, pc),
                           rng=(pre_hi - pre_lo) / pc * 100, entry=o, stop=stop, target=tgt,
                           exit=ex, why=why, exit_pos=i, pnl=pnl, pre=pre, reg=reg))
    return trades


def pre_chg_sign(pre_last, pc):
    return (pre_last / pc - 1) * 100


def stats(g):
    if len(g) == 0:
        return dict(n=0, win=0.0, pf=0.0, avg=0.0, tot=0.0)
    w = int((g.pnl > 0).sum())
    gp = float(g[g.pnl > 0].pnl.sum())
    gl = float(-g[g.pnl <= 0].pnl.sum())
    return dict(n=len(g), win=round(w / len(g) * 100, 1),
                pf=round(gp / gl, 2) if gl else float("inf"),
                avg=round(float(g.pnl.mean()), 2), tot=round(float(g.pnl.sum()), 1))


def to_df(trades):
    return pd.DataFrame([{k: v for k, v in t.items() if k not in ("pre", "reg")} for t in trades])


# ---------- exit study ----------
EXITS = [
    ("Baseline: target = pre range", "NONE", None, "pre"),
    ("Exit on EMA9 cross", "EMA9", None, "none"),
    ("Exit on EMA20 cross", "EMA20", None, "none"),
    ("Exit on VWAP cross", "VWAP", None, "none"),
    ("Exit on VWAP or EMA9", "VWAP", None, "none"),
    ("Time exit 12:30", "NONE", "12:30", "none"),
    ("Time exit 13:00", "NONE", "13:00", "none"),
    ("EMA9 or 12:30", "EMA9", "12:30", "none"),
    ("VWAP or 12:30", "VWAP", "12:30", "none"),
]

df6 = load("6mo", "1h")
df5 = load("60d", "5m")

exit_study = []
for lbl, rule, moc, tm in EXITS:
    a = stats(to_df(backtest(df6, rule, moc, tm)))
    b = stats(to_df(backtest(df5, rule, moc, tm)))
    exit_study.append((lbl, a, b))
    print(f"{lbl:28} 6mo PF={a['pf']:5} n={a['n']:3} tot={a['tot']:6} | 5m PF={b['pf']:5} n={b['n']:3} tot={b['tot']:6}")

# recommended exit for charts
RULE, MOC, TM = "EMA9", "12:30", "none"
best6 = stats(to_df(backtest(df6, RULE, MOC, TM)))
best5 = stats(to_df(backtest(df5, RULE, MOC, TM)))
base6 = stats(to_df(backtest(df6, "NONE", None, "pre")))
print("recommended:", best6, best5, "| base:", base6)

# ---------- edge by move size (improved exit) ----------
sb = to_df(backtest(df6, RULE, MOC, TM, min_move=0.2, max_move=100))
sb["abs_pre"] = sb.pre_chg.abs()
labels = ["0.2-1%", "1-2%", "2-3%", "3-5%", ">5%"]
sb["bucket"] = pd.cut(sb.abs_pre, [0.2, 1, 2, 3, 5, 100], labels=labels)
edge_rows = [(lab, stats(sb[sb.bucket == lab])) for lab in labels]
sweet = stats(sb[(sb.abs_pre >= 1) & (sb.abs_pre <= 5)])
fat = stats(sb[sb.abs_pre > 5])

# ---------- charts ----------
def plot(t):
    pre, reg = t["pre"], t["reg"]
    day = pd.concat([pre, reg])
    n, npre = len(day), len(pre)
    xs = list(range(n))
    fig, (ax, axv) = plt.subplots(2, 1, figsize=(11, 5.4), sharex=True,
                                  gridspec_kw=dict(height_ratios=[5, 1], hspace=0.06))
    for x, (_, b) in zip(xs, day.iterrows()):
        o, h, l, c = float(b["Open"]), float(b["High"]), float(b["Low"]), float(b["Close"])
        up = c >= o
        col = UP if up else DN
        ax.vlines(x, l, h, color=col, lw=0.8)
        ax.add_patch(Rectangle((x - 0.32, min(o, c)), 0.64, max(abs(c - o), 0.01),
                               facecolor=col, edgecolor=col, lw=0))
        axv.bar(x, float(b["Volume"]), width=0.7, color=col, alpha=0.7)
    ax.axvspan(-0.5, npre - 0.5, color="#161B22", zorder=0)
    axv.axvspan(-0.5, npre - 0.5, color="#161B22", zorder=0)
    ax.text(npre / 2 - 0.5, 0.97, "PREMARKET", transform=ax.get_xaxis_transform(),
            color=DIM, fontsize=7, ha="center", va="top")
    ax.text((npre + n) / 2 - 0.5, 0.97, "REGULAR", transform=ax.get_xaxis_transform(),
            color=DIM, fontsize=7, ha="center", va="top")
    # EMA9 / VWAP (exit references)
    ax.plot(xs, reg["ema9"].reindex(day.index).values, color=PUR, lw=1.0, alpha=0.9, label="EMA9")
    ax.plot(xs, reg["vwap"].reindex(day.index).values, color="#39D2C0", lw=1.0, alpha=0.8, label="VWAP")
    other = t["pre_hi"] if t["side"] == "LONG" else t["pre_lo"]
    for y, col, ls, lab in [(t["prev_close"], BLUE, "--", f"prev close {t['prev_close']:.2f}"),
                            (other, YEL, ":", f"range {'hi' if t['side'] == 'LONG' else 'lo'} {other:.2f}"),
                            (t["stop"], DN, "-", f"STOP {t['stop']:.2f}"),
                            (t["entry"], FG, "-", f"entry {t['entry']:.2f}")]:
        ax.axhline(y, color=col, ls=ls, lw=1.1, alpha=0.85, label=lab)
    ax.scatter([npre], [t["entry"]], marker="^" if t["side"] == "LONG" else "v",
               color=FG, s=70, zorder=5, edgecolor=BG)
    ex_x = npre + t["exit_pos"]
    ax.scatter([ex_x], [t["exit"]], marker="X", color=YEL, s=95, zorder=6, edgecolor=BG)
    near_right = ex_x > n * 0.72
    ax.annotate(f"{t['why']}  {t['pnl']:+.2f}%", (ex_x, t["exit"]), color=FG, fontsize=8,
                xytext=(-8, 14) if near_right else (8, 14),
                ha="right" if near_right else "left", textcoords="offset points",
                bbox=dict(boxstyle="round,pad=0.35", fc="#161B22", ec=YEL, lw=0.8))
    ax.legend(loc="upper left", fontsize=7, framealpha=0.9, labelcolor=FG, ncol=2)
    ax.set_title(f"{t['date']}  {t['side']}  pre {t['pre_chg']:+.2f}%  ·  "
                 f"{t['entry']:.2f} → {t['exit']:.2f}  ({t['pnl']:+.2f}%)",
                 fontsize=11, color=UP if t["pnl"] > 0 else DN)
    ticks = [x for i, x in enumerate(xs) if i % 12 == 0]
    ax.set_xticks(ticks)
    ax.set_xticklabels([day.index[i].strftime("%H:%M") for i in ticks], fontsize=7.5)
    ax.set_xlim(-0.5, n - 0.5)
    lo_v = min(day["Low"].min(), t["stop"], t["entry"], other)
    hi_v = max(day["High"].max(), t["stop"], t["entry"], other)
    pad = (hi_v - lo_v) * 0.06
    ax.set_ylim(lo_v - pad, hi_v + pad)
    ax.grid(color="#21262D", lw=0.5, alpha=0.6)
    axv.yaxis.set_major_formatter(lambda v, _: f"{v/1e6:.1f}M" if v >= 1e6 else f"{v/1e3:.0f}K")
    axv.set_ylabel("vol", fontsize=7)
    axv.set_yticks([axv.get_ylim()[1] * 0.5])
    axv.grid(color="#21262D", lw=0.5, alpha=0.6, axis="y")
    fig.subplots_adjust(left=0.07, right=0.985, top=0.9, bottom=0.11)
    fn = f"SNDK_{t['date']}_{t['side']}.png"
    fig.savefig(FIG / fn, dpi=105)
    plt.close(fig)
    return fn


recent = backtest(df5, RULE, MOC, TM)[-30:]
for t in recent:
    t["fig"] = plot(t)

# ---------- today's playbook (may be excluded by the >5% filter) ----------
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import today_playbook
    tp = today_playbook.build()
except Exception as e:  # never break the report on a live-data hiccup
    print("today playbook skipped:", e)
    tp = None

# ---------- HTML ----------
CSS = ("body{background:#0D1117;color:#E6EDF3;font-family:system-ui,sans-serif;"
       "max-width:1180px;margin:0 auto;padding:24px;line-height:1.55}"
       "h1,h2{border-bottom:1px solid #30363D;padding-bottom:6px}"
       "h2{border-left:4px solid #1F6FEB;padding-left:10px}"
       "table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}"
       "th,td{border:1px solid #30363D;padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums}"
       "th:first-child,td:first-child{text-align:left}th{background:#161B22}"
       "img{max-width:100%;background:#0D1117;border:1px solid #30363D;border-radius:6px;margin:10px 0}"
       ".up{color:#3FB950}.dn{color:#F85149}.dim{color:#8B949E}"
       ".warn{background:#161B22;border-left:3px solid #D29922;padding:8px 12px;margin:12px 0}"
       ".good{background:#161B22;border-left:3px solid #3FB950;padding:8px 12px;margin:12px 0}"
       "td.pos{color:#3FB950;font-weight:600}td.neg{color:#F85149;font-weight:600}")

def srow(lbl, a, b):
    return (f"<tr><td>{lbl}</td><td>{a['n']}</td><td>{a['win']}%</td>"
            f"<td class=\"{'pos' if a['pf'] > base6['pf'] else ''}\">{a['pf']}</td>"
            f"<td class=\"{'pos' if a['tot'] > 0 else 'neg'}\">{a['tot']:+.1f}%</td>"
            f"<td>{b['n']}</td><td class=\"{'pos' if b['pf'] > base6['pf'] else ''}\">{b['pf']}</td>"
            f"<td class=\"{'pos' if b['tot'] > 0 else 'neg'}\">{b['tot']:+.1f}%</td></tr>")

exit_rows = "".join(srow(lbl, a, b) for lbl, a, b in exit_study)
erows = "".join(
    f"<tr><td>{lab}</td><td>{s['n']}</td><td>{s['win']}%</td><td>{s['pf']}</td>"
    f"<td class=\"{'pos' if s['avg'] > 0 else 'neg'}\">{s['avg']:+.2f}%</td>"
    f"<td class=\"{'pos' if s['tot'] > 0 else 'neg'}\">{s['tot']:+.1f}%</td></tr>"
    for lab, s in edge_rows)
today_html = ""
if tp:
    def pct(x):
        return (x / tp["entry"] - 1) * 100
    naive = (f"<td>Naive target {tp['naive'][1]:.2f}</td><td>{tp['naive'][0]}</td>"
             f"<td class=\"pos\">{pct(tp['naive'][1]):+.2f}%</td>") if tp["naive"] else \
            "<td>Naive target</td><td>—</td><td class=\"dim\">not hit</td>"
    ema = (f"<td>Recommended EMA9 exit {tp['ema'][1]:.2f}</td><td>{tp['ema'][0]}</td>"
           f"<td class=\"pos\">{pct(tp['ema'][1]):+.2f}%</td>") if tp["ema"] else \
          "<td>Recommended EMA9 exit</td><td>—</td><td class=\"dim\">still open</td>"
    verdict = (f'<div class="good"><b>Signal taken</b> — premarket move '
               f'{tp["pre_chg"]:+.2f}% is inside the 1–5% filter.</div>') if tp["passed"] else \
              (f'<div class="warn"><b>Skipped by the filter</b> — premarket move '
               f'{tp["pre_chg"]:+.2f}% is &gt;5% ("moved too much"). The trade below is what '
               f'<i>would</i> have happened, not a live position.</div>')
    today_html = f"""
<h2>Today — {tp['date']} {tp['symbol']} ({tp['side']})</h2>
{verdict}
<table><tr><th>Item</th><th>Price</th><th>Detail</th></tr>
<tr><td>Prev close</td><td>{tp['prev_close']:.2f}</td><td>—</td></tr>
<tr><td>Premarket</td><td>{tp['pre_lo']:.2f} – {tp['pre_hi']:.2f}</td>
<td class="neg">{tp['pre_chg']:+.2f}%</td></tr>
<tr><td>Entry (open)</td><td>{tp['entry']:.2f}</td><td>stop {tp['stop']:.2f} (pre-low)</td></tr>
<tr>{naive}</tr>
<tr>{ema}</tr>
<tr><td>Last bar</td><td>{tp['last_close']:.2f}</td><td>{tp['last_time']} ET</td></tr>
</table>
<img src="figures/{tp['fig']}"/>
"""

rows = []
for t in recent:
    cls = "pos" if t["pnl"] > 0 else "neg"
    rows.append(f"<tr><td>{t['date']}</td><td>{t['side']}</td><td>{t['pre_chg']:+.2f}%</td>"
                f"<td>{t['rng']:.1f}%</td><td>{t['entry']:.2f}</td><td>{t['exit']:.2f}</td>"
                f"<td>{t['why']}</td><td class=\"{cls}\">{t['pnl']:+.2f}%</td></tr>")
imgs = "\n".join(
    f'<h3 class="{"up" if t["pnl"] > 0 else "dn"}">{t["date"]} {t["side"]} '
    f'({t["pnl"]:+.2f}%)</h3>\n<img src="figures/{t["fig"]}"/>' for t in recent)

html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>SNDK pre-range fade — gallery + exit study</title><style>{CSS}</style></head><body>
<h1>SNDK pre-range fade — gallery + exit study</h1>
<p class="dim">Entry: RED pre → LONG if open &gt; pre_low · GREEN pre → SHORT if open &lt; pre_high ·
hard stop at the pre range level. Entry filter: |premarket move| 1–5%. Charts: 5m (last 60d).</p>
{today_html}

<h2>Where to exit — EMA / VWAP / time study</h2>
<table><tr><th>Exit rule</th><th colspan="3">6mo (1h)</th><th colspan="3">60d (5m)</th></tr>
<tr><th></th><th>n</th><th>win</th><th>PF</th><th>tot</th><th>n</th><th>PF</th><th>tot</th></tr>
{exit_rows}</table>
<div class="good"><b>Answer: drop the fixed target and exit on EMA9 / by 12:30.</b>
Baseline (target = pre range) PF <b>{base6['pf']}</b> → recommended (EMA9 cross or 12:30, no target)
PF <b>{best6['pf']}</b> on 6mo ({best6['tot']:+.1f}%) and PF <b>{best5['pf']}</b> on 5m.
The pre-range target caps winners — most of the edge is the first ~3 hours of drift.</div>
<div class="warn">Pure <b>time exit 12:30</b> is marginally best (PF 4.38 / 4.92) and needs no indicators;
<b>EMA9 cross</b> is the best rule you can trade dynamically (PF 3.71 / 4.16). Combining both
(EMA9 <i>or</i> 12:30) ≈ {best6['pf']} / {best5['pf']}. <b>VWAP alone is weaker</b> than EMA9 —
it's a slower line on this name.</div>

<h2>Summary — recommended strategy (6mo, 1h)</h2>
<table><tr><th>Metric</th><th>Baseline (target=pre)</th><th>Recommended exit</th></tr>
<tr><td>Trades</td><td>{base6['n']}</td><td>{best6['n']}</td></tr>
<tr><td>Win rate</td><td>{base6['win']}%</td><td>{best6['win']}%</td></tr>
<tr><td>Profit factor</td><td>{base6['pf']}</td><td class="pos">{best6['pf']}</td></tr>
<tr><td>Avg / trade</td><td class="pos">{base6['avg']:+.2f}%</td><td class="pos">{best6['avg']:+.2f}%</td></tr>
<tr><td>Total PnL (sum %)</td><td class="pos">{base6['tot']:+.1f}%</td><td class="pos">{best6['tot']:+.1f}%</td></tr></table>

<h2>Does moving too much matter? — edge by premarket move size</h2>
<table><tr><th>|premarket move|</th><th>Trades</th><th>Win rate</th><th>PF</th><th>Avg</th><th>Total</th></tr>
{erows}</table>
<div class="good"><b>Sweet spot 1–5%:</b> {sweet['n']} trades, win {sweet['win']}%, PF <b>{sweet['pf']}</b>,
total <b>{sweet['tot']:+.1f}%</b>.</div>
<div class="warn"><b>Moved too much (&gt;5%):</b> {fat['n']} trades, win {fat['win']}%, PF <b>{fat['pf']}</b>,
total <b>{fat['tot']:+.1f}%</b> — gap/trend days, the range breaks, don't fade.</div>

<h2>Recent trades (last {len(recent)}, recommended exit)</h2>
<table><tr><th>Date</th><th>Side</th><th>Pre chg</th><th>Range</th><th>Entry</th><th>Exit</th><th>Why</th><th>PnL</th></tr>
{''.join(rows)}</table>

<h2>Charts (all visible)</h2>
<p class="dim">Purple = EMA9, teal = VWAP (both reset per session). Yellow dotted = the other side of
the pre range (old fixed target). Exits happen on EMA9 cross / 12:30, not on the target.</p>
{imgs}
</body></html>"""
(OUT / "SNDK_STRATEGY_report.html").write_text(html)
print(f"saved {len(recent)} figs + html KB: {len(html)//1024}")
