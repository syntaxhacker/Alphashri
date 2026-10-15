"""SNDK — today's playbook: raw signal, filter verdict, and both exits.

Usable as a module: `build()` returns the result dict (and writes the chart).
Regenerate standalone with: .venv/bin/python scripts/research/prerange/today_playbook.py
"""
import datetime
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
import pandas as pd
import yfinance as yf
from pathlib import Path
from zoneinfo import ZoneInfo

OUT = Path(os.environ.get("PRERANGE_OUT", str(Path(__file__).resolve().parents[3]
                                                    / "reports" / "SNDK_STRATEGY")))
FIG = OUT / "figures"
NY = ZoneInfo("America/New_York")
T = lambda h, m: datetime.time(h, m)
BG, FG, DIM, UP, DN = "#0D1117", "#E6EDF3", "#8B949E", "#3FB950", "#F85149"
BLUE, YEL, PUR, TEAL = "#58A6FF", "#D29922", "#A371F7", "#39D2C0"


def build(ticker="SNDK", min_move=1.0, max_move=5.0):
    FIG.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({"figure.facecolor": BG, "axes.facecolor": BG, "text.color": FG,
                         "axes.labelcolor": FG, "xtick.color": DIM, "ytick.color": DIM,
                         "axes.edgecolor": "#30363D", "savefig.facecolor": BG})
    t = yf.Ticker(ticker)
    d = t.history(period="5d", interval="5m", prepost=True, auto_adjust=False)
    d.index = d.index.tz_convert(NY)
    D = max(d.index.date)
    today = d[d.index.date == D].sort_index()
    pre = today[today.index.time < T(9, 30)]
    reg = today[(today.index.time >= T(9, 30)) & (today.index.time < T(16, 0))].copy()
    reg["ema9"] = reg["Close"].ewm(span=9, adjust=False).mean()
    tp = (reg["High"] + reg["Low"] + reg["Close"]) / 3
    reg["vwap"] = (tp * reg["Volume"]).cumsum() / reg["Volume"].cumsum()

    daily = t.history(period="10d", interval="1d", auto_adjust=False)
    daily.index = daily.index.tz_convert(NY)
    pc = float(daily["Close"].iloc[-2])
    pre_hi, pre_lo = float(pre["High"].max()), float(pre["Low"].min())
    entry = float(reg["Open"].iloc[0])
    stop = pre_lo
    pre_chg = (float(pre["Close"].iloc[-1]) / pc - 1) * 100
    side = "LONG"
    passed = min_move <= abs(pre_chg) <= max_move

    tz_exit = tz_px = ema_exit = ema_px = None
    for ts, b in reg.iterrows():
        if float(b["Low"]) <= stop:
            break
        if tz_exit is None and float(b["High"]) >= pre_hi:
            tz_exit, tz_px = ts, pre_hi
        if ema_exit is None and float(b["Close"]) < b["ema9"]:
            ema_exit, ema_px = ts, float(b["Close"])

    day = pd.concat([pre, reg])
    n, npre = len(day), len(pre)
    xs = list(range(n))
    fig, (ax, axv) = plt.subplots(2, 1, figsize=(12, 6), sharex=True,
                                  gridspec_kw=dict(height_ratios=[5, 1], hspace=0.06))
    for x, (_, b) in zip(xs, day.iterrows()):
        o, h, l, c = float(b["Open"]), float(b["High"]), float(b["Low"]), float(b["Close"])
        col = UP if c >= o else DN
        ax.vlines(x, l, h, color=col, lw=0.8)
        ax.add_patch(Rectangle((x - 0.32, min(o, c)), 0.64, max(abs(c - o), 0.01),
                               facecolor=col, edgecolor=col, lw=0))
        axv.bar(x, float(b["Volume"]), width=0.7, color=col, alpha=0.7)
    ax.axvspan(-0.5, npre - 0.5, color="#161B22", zorder=0)
    axv.axvspan(-0.5, npre - 0.5, color="#161B22", zorder=0)
    ax.plot(xs, reg["ema9"].reindex(day.index).values, color=PUR, lw=1.1, label="EMA9")
    ax.plot(xs, reg["vwap"].reindex(day.index).values, color=TEAL, lw=1.1, label="VWAP")
    for y, col, ls, lab in [(pc, BLUE, "--", f"prev close {pc:.2f}"),
                            (pre_hi, YEL, ":", f"range hi / naive target {pre_hi:.2f}"),
                            (stop, DN, "-", f"STOP {stop:.2f}"),
                            (entry, FG, "-", f"entry {entry:.2f}")]:
        ax.axhline(y, color=col, ls=ls, lw=1.1, alpha=0.85, label=lab)
    ax.scatter([npre], [entry], marker="^", color=FG, s=70, zorder=5, edgecolor=BG)

    idx_of = lambda ts: npre + list(reg.index).index(ts)
    if tz_exit is not None:
        x = idx_of(tz_exit)
        nr = x > n * 0.6
        ax.scatter([x], [tz_px], marker="X", color=YEL, s=110, zorder=6, edgecolor=BG)
        ax.annotate(f"naive TARGET {tz_px:.2f}  ({(tz_px/entry-1)*100:+.2f}%)  {tz_exit.strftime('%H:%M')}",
                    (x, tz_px), color=FG, fontsize=8, xytext=(-8, 14) if nr else (8, 14),
                    ha="right" if nr else "left", textcoords="offset points",
                    bbox=dict(boxstyle="round,pad=0.35", fc="#161B22", ec=YEL, lw=0.9))
    if ema_exit is not None:
        x = idx_of(ema_exit)
        nr = x > n * 0.6
        ax.scatter([x], [ema_px], marker="X", color=PUR, s=110, zorder=6, edgecolor=BG)
        ax.annotate(f"recommended EMA9 exit {ema_px:.2f}  ({(ema_px/entry-1)*100:+.2f}%)  {ema_exit.strftime('%H:%M')}",
                    (x, ema_px), color=FG, fontsize=8, xytext=(-8, -22) if nr else (8, -22),
                    ha="right" if nr else "left", textcoords="offset points",
                    bbox=dict(boxstyle="round,pad=0.35", fc="#161B22", ec=PUR, lw=0.9))
    ax.legend(loc="lower left", fontsize=7.5, framealpha=0.9, labelcolor=FG, ncol=2)
    ax.set_title(f"{ticker} {D}  {side}  pre {pre_chg:+.2f}%  ·  entry {entry:.2f}  ·  "
                 f"filter({min_move:g}-{max_move:g}%): {'PASS' if passed else 'SKIP — moved too much'}",
                 fontsize=11, color=FG)
    ticks = [x for i, x in enumerate(xs) if i % 12 == 0]
    ax.set_xticks(ticks)
    ax.set_xticklabels([day.index[i].strftime("%H:%M") for i in ticks], fontsize=8)
    ax.set_xlim(-0.5, n - 0.5)
    lo_v = min(day["Low"].min(), stop, entry)
    hi_v = max(day["High"].max(), pre_hi)
    pad = (hi_v - lo_v) * 0.06
    ax.set_ylim(lo_v - pad, hi_v + pad)
    ax.grid(color="#21262D", lw=0.5, alpha=0.6)
    axv.yaxis.set_major_formatter(lambda v, _: f"{v/1e6:.1f}M" if v >= 1e6 else f"{v/1e3:.0f}K")
    axv.set_ylabel("vol", fontsize=7)
    axv.set_yticks([axv.get_ylim()[1] * 0.5])
    axv.grid(color="#21262D", lw=0.5, alpha=0.6, axis="y")
    fig.subplots_adjust(left=0.06, right=0.985, top=0.9, bottom=0.09)
    fn = f"{ticker}_{D}_{side}_playbook.png"
    fig.savefig(FIG / fn, dpi=105)
    plt.close(fig)
    return dict(date=str(D), symbol=ticker, side=side, fig=fn, passed=passed,
                prev_close=pc, pre_hi=pre_hi, pre_lo=pre_lo, pre_chg=pre_chg,
                entry=entry, stop=stop,
                naive=(str(tz_exit.time()), tz_px) if tz_exit is not None else None,
                ema=(str(ema_exit.time()), ema_px) if ema_exit is not None else None,
                last_time=reg.index[-1].strftime("%H:%M"),
                last_close=float(reg["Close"].iloc[-1]))


if __name__ == "__main__":
    r = build()
    print("saved", FIG / r["fig"])
    print(f"pre_chg {r['pre_chg']:+.2f}% | filter -> {'PASS' if r['passed'] else 'SKIP'}")
    if r["naive"]:
        print(f"naive target {r['naive'][1]:.2f} {(r['naive'][1]/r['entry']-1)*100:+.2f}% at {r['naive'][0]}")
    if r["ema"]:
        print(f"EMA9 exit {r['ema'][1]:.2f} {(r['ema'][1]/r['entry']-1)*100:+.2f}% at {r['ema'][0]}")
    print("last bar", r["last_time"], "close", r["last_close"])
