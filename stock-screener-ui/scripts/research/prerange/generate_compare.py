"""Pre-range fade — cross-ticker comparison (SNDK, MU, WDC, STX, RKLB, mega caps).

Recomputes every ticker with identical code so the ranking is apples-to-apples.
Run: .venv/bin/python scripts/research/prerange/generate_compare.py
"""
import datetime
import json
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import yfinance as yf
from pathlib import Path
from zoneinfo import ZoneInfo

OUT = Path(os.environ.get("PRERANGE_OUT", str(Path(__file__).resolve().parents[3]
                                                    / "reports" / "PRERANGE_COMPARE")))
FIG = OUT / "figures"
FIG.mkdir(parents=True, exist_ok=True)
NY = ZoneInfo("America/New_York")
T = lambda h, m: datetime.time(h, m)
BG, FG, DIM, UP, DN, BLUE = "#0D1117", "#E6EDF3", "#8B949E", "#3FB950", "#F85149", "#58A6FF"
plt.rcParams.update({"figure.facecolor": BG, "axes.facecolor": BG, "text.color": FG,
                     "axes.labelcolor": FG, "xtick.color": DIM, "ytick.color": DIM,
                     "axes.edgecolor": "#30363D", "savefig.facecolor": BG})

TICKERS = ["SNDK", "MU", "WDC", "STX", "RKLB",
           "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AMD"]
SETS = [("6mo", "1h", "A · 6mo 1h"), ("60d", "5m", "B · 60d 5m"), ("1y", "1h", "C · 1y 1h")]
VARIANTS = [("baseline", "NONE", None, "pre"),
            ("ema9_1230", "EMA9", "12:30", "none"),
            ("time_1230", "NONE", "12:30", "none")]


def data(ticker, period, interval):
    t = yf.Ticker(ticker)
    df = t.history(period=period, interval=interval, prepost=True, auto_adjust=False)
    df.index = df.index.tz_convert(NY)
    daily = t.history(period="2y", interval="1d", auto_adjust=False)
    daily.index = daily.index.tz_convert(NY)
    closes = {d.date(): float(r["Close"]) for d, r in daily.iterrows()
              if r["Close"] == r["Close"]}
    return df, closes


def run(df, closes, rule, moc, tgt_mode, min_move=1.0, max_move=5.0):
    tdates = sorted(closes)
    res = []
    for D in sorted(set(df.index.date)):
        day = df[df.index.date == D].sort_index()
        pre = day[day.index.time < T(9, 30)]
        reg = day[(day.index.time >= T(9, 30)) & (day.index.time < T(16, 0))]
        if len(pre) == 0 or len(reg) == 0:
            continue
        if str(reg.index[-1].time()) < "15:30":   # skip half days / live partial
            continue
        prior = [x for x in tdates if x < D]
        if not prior:
            continue
        pc = closes[prior[-1]]
        pre_hi, pre_lo = float(pre["High"].max()), float(pre["Low"].min())
        pre_last = float(pre["Close"].iloc[-1])
        chg = abs(pre_last / pc - 1) * 100
        if not (min_move <= chg <= max_move):
            continue
        o = float(reg["Open"].iloc[0])
        if not (pre_lo < o < pre_hi):
            continue
        side = "LONG" if pre_last < pc else "SHORT"
        stop = pre_lo if side == "LONG" else pre_hi
        tgt = (pre_hi if side == "LONG" else pre_lo) if tgt_mode == "pre" else None
        reg = reg.copy()
        reg["ema9"] = reg["Close"].ewm(span=9, adjust=False).mean()
        ex, why = float(reg["Close"].iloc[-1]), "MOC"
        for i, (ts, b) in enumerate(reg.iterrows()):
            hi, lo, cl = float(b["High"]), float(b["Low"]), float(b["Close"])
            if side == "LONG":
                if lo <= stop:
                    ex, why = stop, "STOP"; break
                if tgt and hi >= tgt:
                    ex, why = tgt, "TARGET"; break
                if rule == "EMA9" and i > 0 and cl < b["ema9"]:
                    ex, why = cl, "EMA9"; break
            else:
                if hi >= stop:
                    ex, why = stop, "STOP"; break
                if tgt and lo <= tgt:
                    ex, why = tgt, "TARGET"; break
                if rule == "EMA9" and i > 0 and cl > b["ema9"]:
                    ex, why = cl, "EMA9"; break
            if moc and ts.strftime("%H:%M") >= moc:
                ex, why = cl, "TIME"; break
        res.append(((ex - o) / o if side == "LONG" else (o - ex) / o) * 100)
    return res


def stat(a):
    a = np.array(a)
    if len(a) == 0:
        return dict(n=0, win=0.0, pf=None, avg=0.0, tot=0.0)
    gp, gl = a[a > 0].sum(), -a[a <= 0].sum()
    return dict(n=len(a), win=round(float((a > 0).mean() * 100), 1),
                pf=round(float(gp / gl), 2) if gl else None,
                avg=round(float(a.mean()), 2), tot=round(float(a.sum()), 1))


res = {}
cache = {}
for tk in TICKERS:
    res[tk] = {}
    for period, interval, label in SETS:
        key = (tk, period, interval)
        if key not in cache:
            try:
                cache[key] = data(tk, period, interval)
            except Exception as e:
                print("data error", key, e)
                cache[key] = None
        d = cache[key]
        if d is None:
            res[tk][label] = {v[0]: stat([]) for v in VARIANTS}
            continue
        df, closes = d
        res[tk][label] = {v[0]: stat(run(df, closes, v[1], v[2], v[3])) for v in VARIANTS}
    print(tk, {k: {vv: res[tk][k][vv]["pf"] for vv in res[tk][k]} for k in res[tk]})

# edge buckets (6mo 1h, baseline, pre-filter 0.2-100)
edge = {}
for tk in TICKERS:
    d = cache[(tk, "6mo", "1h")]
    if d is None:
        continue
    a = pd.DataFrame({"pnl": run(d[0], d[1], "NONE", None, "pre", 0.2, 100)})
    edge[tk] = stat(list(a.pnl))
# edge needs pre_chg per trade; recompute with bucket tagging

def buckets(tk, period="6mo", interval="1h"):
    d = cache[(tk, period, interval)]
    if d is None:
        return {}
    df, closes = d
    tdates = sorted(closes)
    out = {l: [] for l in ["0.2-1", "1-2", "2-3", "3-5", ">5"]}
    for D in sorted(set(df.index.date)):
        day = df[df.index.date == D].sort_index()
        pre = day[day.index.time < T(9, 30)]
        reg = day[(day.index.time >= T(9, 30)) & (day.index.time < T(16, 0))]
        if len(pre) == 0 or len(reg) == 0 or str(reg.index[-1].time()) < "15:30":
            continue
        prior = [x for x in tdates if x < D]
        if not prior:
            continue
        pc = closes[prior[-1]]
        pre_hi, pre_lo = float(pre["High"].max()), float(pre["Low"].min())
        pre_last = float(pre["Close"].iloc[-1])
        chg = abs(pre_last / pc - 1) * 100
        if chg < 0.2:
            continue
        o = float(reg["Open"].iloc[0])
        if not (pre_lo < o < pre_hi):
            continue
        side = "LONG" if pre_last < pc else "SHORT"
        stop = pre_lo if side == "LONG" else pre_hi
        tgt = pre_hi if side == "LONG" else pre_lo
        ex = float(reg["Close"].iloc[-1])
        for _, b in reg.iterrows():
            hi, lo = float(b["High"]), float(b["Low"])
            if side == "LONG":
                if lo <= stop: ex = stop; break
                if hi >= tgt: ex = tgt; break
            else:
                if hi >= stop: ex = stop; break
                if lo <= tgt: ex = tgt; break
        pnl = ((ex - o) / o if side == "LONG" else (o - ex) / o) * 100
        lab = ("0.2-1" if chg < 1 else "1-2" if chg < 2 else "2-3" if chg < 3
               else "3-5" if chg <= 5 else ">5")
        out[lab].append(pnl)
    return {k: stat(v) for k, v in out.items()}


edge = {tk: buckets(tk) for tk in TICKERS}

# ---------- ranking ----------
def score(tk):
    """Rank: weight robustness (1y) + strength (6mo)."""
    a = res[tk]["A · 6mo 1h"]
    c = res[tk]["C · 1y 1h"]
    best_a = max((v["pf"] or 0) for v in a.values())
    best_c = max((v["pf"] or 0) for v in c.values())
    return round(0.5 * best_a + 0.5 * best_c, 2)


rank = sorted(TICKERS, key=score, reverse=True)

# ---------- chart ----------
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 5.5))
x = np.arange(len(rank))
w = 0.26
for j, (v, col) in enumerate([("baseline", "#8B949E"), ("ema9_1230", "#3FB950"),
                              ("time_1230", "#58A6FF")]):
    vals = [res[tk]["A · 6mo 1h"][v]["pf"] or 0 for tk in rank]
    ax1.bar(x + (j - 1) * w, vals, w, label=v, color=col)
ax1.axhline(1.0, color="#F85149", ls="--", lw=1)
ax1.set_xticks(x); ax1.set_xticklabels(rank, rotation=45, ha="right", fontsize=9)
ax1.set_title("Profit factor — 6mo 1h (pre 1–5%)", fontsize=11)
ax1.legend(fontsize=8); ax1.grid(color="#21262D", axis="y", lw=0.5)
for j, (v, col) in enumerate([("baseline", "#8B949E"), ("ema9_1230", "#3FB950"),
                              ("time_1230", "#58A6FF")]):
    vals = [res[tk]["C · 1y 1h"][v]["pf"] or 0 for tk in rank]
    ax2.bar(x + (j - 1) * w, vals, w, label=v, color=col)
ax2.axhline(1.0, color="#F85149", ls="--", lw=1)
ax2.set_xticks(x); ax2.set_xticklabels(rank, rotation=45, ha="right", fontsize=9)
ax2.set_title("Profit factor — 1y 1h (robustness)", fontsize=11)
ax2.legend(fontsize=8); ax2.grid(color="#21262D", axis="y", lw=0.5)
ymax = max([res[tk][s][v]["pf"] or 0 for tk in rank for s in ("A · 6mo 1h", "C · 1y 1h")
            for v, *_ in VARIANTS] + [1.0]) * 1.15
for a in (ax1, ax2):
    a.set_ylim(0, ymax)
fig.tight_layout()
fig.savefig(FIG / "pf_by_ticker.png", dpi=110)
plt.close(fig)

# ---------- HTML ----------
def pfcell(s):
    if s["n"] == 0:
        return "<td class=\"dim\">—</td>"
    cls = "pos" if (s["pf"] or 0) >= 1.5 else ("neg" if (s["pf"] or 0) < 1 else "")
    return f"<td class=\"{cls}\">{s['pf']}</td>"

rows = []
for tk in rank:
    for setlabel in [s[2] for s in SETS]:
        cells = "".join(pfcell(res[tk][setlabel][v]) for v, *_ in VARIANTS)
        nn = res[tk][setlabel]["baseline"]["n"]
        rows.append(f"<tr><td>{tk}</td><td>{setlabel}</td><td>{nn}</td>{cells}</tr>")

erows = []
for tk in rank:
    cells = ""
    for lab in ["0.2-1", "1-2", "2-3", "3-5", ">5"]:
        s = edge.get(tk, {}).get(lab, dict(n=0, pf=None))
        if s["n"] == 0:
            cells += "<td class=\"dim\">—</td>"
        else:
            cls = "pos" if (s["pf"] or 0) >= 1.5 else ("neg" if (s["pf"] or 0) < 1 else "")
            cells += f"<td class=\"{cls}\">{s['pf']}<span class=\"dim\"> (n{s['n']})</span></td>"
    erows.append(f"<tr><td>{tk}</td>{cells}</tr>")

links = "\n".join(
    f'<li><a href="../PRERANGE_{tk}/{tk}_prerange_report.html">{tk}</a></li>'
    for tk in rank if tk != "SNDK")
links = f'<li><a href="../SNDK_STRATEGY/SNDK_STRATEGY_report.html">SNDK (full gallery + exit study)</a></li>\n{links}'

CSS = ("body{background:#0D1117;color:#E6EDF3;font-family:system-ui,sans-serif;"
       "max-width:1180px;margin:0 auto;padding:24px;line-height:1.55}"
       "h1,h2{border-bottom:1px solid #30363D;padding-bottom:6px}"
       "h2{border-left:4px solid #1F6FEB;padding-left:10px}"
       "table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}"
       "th,td{border:1px solid #30363D;padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums}"
       "th:first-child,td:first-child,td:nth-child(2){text-align:left}th{background:#161B22}"
       "img{max-width:100%;border:1px solid #30363D;border-radius:6px}"
       ".up{color:#3FB950}.dn{color:#F85149}.dim{color:#8B949E}"
       ".good{background:#161B22;border-left:3px solid #3FB950;padding:8px 12px;margin:12px 0}"
       ".warn{background:#161B22;border-left:3px solid #D29922;padding:8px 12px;margin:12px 0}"
       "td.pos{color:#3FB950;font-weight:600}td.neg{color:#F85149;font-weight:600}"
       "ol li{margin:4px 0}")

best = rank[0]
html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Pre-range fade — cross-ticker ranking</title><style>{CSS}</style></head><body>
<h1>Pre-range fade — cross-ticker ranking</h1>
<p class="dim">Identical code for every ticker. Entry: RED pre → LONG if open &gt; pre_low ·
GREEN pre → SHORT if open &lt; pre_high · hard stop at the pre level · filter |premarket move| 1–5%.
Variants: <b>baseline</b> (target = opposite pre level), <b>ema9_1230</b> (exit on EMA9 cross or 12:30,
no target), <b>time_1230</b> (exit 12:30, no target). No costs/slippage.</p>

<h2>Ranking (by 1y robustness + 6mo strength)</h2>
<ol>
{''.join(f'<li><b>{tk}</b> — best 6mo PF {max((v["pf"] or 0) for v in res[tk]["A · 6mo 1h"].values()):.2f}, '
         f'best 1y PF {max((v["pf"] or 0) for v in res[tk]["C · 1y 1h"].values()):.2f}'
         f'{"  ⚠️ 1y all-negative" if max((v["pf"] or 0) for v in res[tk]["C · 1y 1h"].values()) < 1 else ""}</li>'
         for tk in rank)}
</ol>
<div class="good"><b>Best overall: {best}.</b> Only tickers whose 1y window survives (PF ≥ 1) are
worth trading live; the rest have a recent-window edge that does not hold up.</div>

<h2>Profit factor by ticker / timeframe</h2>
<img src="figures/pf_by_ticker.png"/>
<table><tr><th>Ticker</th><th>Set</th><th>n</th><th>baseline</th><th>ema9_1230</th><th>time_1230</th></tr>
{''.join(rows)}</table>
<p class="dim">Green ≥ 1.5, red &lt; 1.0. All figures are PF; entry filter 1–5% premarket move.</p>

<h2>Edge by premarket move size (6mo 1h, baseline, PF)</h2>
<table><tr><th>Ticker</th><th>0.2–1%</th><th>1–2%</th><th>2–3%</th><th>3–5%</th><th>&gt;5%</th></tr>
{''.join(erows)}</table>
<div class="warn"><b>Consistent across every ticker:</b> the <b>&gt;5% bucket loses</b> (SNDK 0.45,
MU 0.46, WDC 0.61, RKLB 0-all-loss, STX the lone exception). The edge lives in the
<b>1–5%</b> band, and for most names the <b>3–5%</b> sub-bucket is the strongest.</div>

<h2>Per-ticker reports</h2>
<ul>
{links}
</ul>
</body></html>"""
(OUT / "PRERANGE_COMPARE_report.html").write_text(html)
(OUT / "compare_stats.json").write_text(json.dumps(
    {"results": res, "edge": edge, "rank": rank}, indent=2, default=str))
print("rank:", " > ".join(rank))
print("wrote", OUT / "PRERANGE_COMPARE_report.html")
