#!/usr/bin/env python
from __future__ import annotations

import os
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import strategy as S
import nov_replay as NR

OUT = Path(S.OUTDIR) / "november"
FIG = OUT / "figures"
FIG.mkdir(parents=True, exist_ok=True)

BG, FG, DIM = "#0D1117", "#E6EDF3", "#8B949E"
UP, DN = "#3FB950", "#F85149"
BLUE, YEL, PUR, TEAL = "#58A6FF", "#D29922", "#A371F7", "#39D2C0"
plt.rcParams.update({"figure.facecolor": BG, "axes.facecolor": BG, "text.color": FG,
                     "axes.labelcolor": FG, "xtick.color": DIM, "ytick.color": DIM,
                     "axes.edgecolor": "#30363D", "savefig.facecolor": BG})

T_OPEN, T_CLOSE = 7 * 60, 16 * 60


def plot_session(d, tag, our, his):
    m = (d.t >= T_OPEN) & (d.t < T_CLOSE)
    if m.sum() < 20:
        return None
    idx = np.flatnonzero(m)
    t = d.t[idx]
    o, h, l, c, v = d.o[idx], d.h[idx], d.l[idx], d.c[idx], d.vol[idx]
    ny = d.ny_vwap[idx]
    n = len(idx)
    npre = int((t < S.RTH_OPEN).sum())
    xs = np.arange(n)

    fig, (ax, axv) = plt.subplots(2, 1, figsize=(11, 5.6), sharex=True,
                                  gridspec_kw=dict(height_ratios=[5, 1], hspace=0.06))
    for x in xs:
        up = c[x] >= o[x]
        col = UP if up else DN
        ax.vlines(x, l[x], h[x], color=col, lw=0.8)
        ax.add_patch(Rectangle((x - 0.32, min(o[x], c[x])), 0.64,
                               max(abs(c[x] - o[x]), 0.01),
                               facecolor=col, edgecolor=col, lw=0))
        axv.bar(x, v[x], width=0.7, color=col, alpha=0.65)

    ax.axvspan(-0.5, npre - 0.5, color="#161B22", zorder=0)
    axv.axvspan(-0.5, npre - 0.5, color="#161B22", zorder=0)
    ax.text(npre / 2 - 0.5, 0.97, "PREMARKET", transform=ax.get_xaxis_transform(),
            color=DIM, fontsize=7, ha="center", va="top")
    ax.text((npre + n) / 2 - 0.5, 0.97, "REGULAR", transform=ax.get_xaxis_transform(),
            color=DIM, fontsize=7, ha="center", va="top")

    w = NR.F.window_range(d, "pre", 120)
    if w:
        hi, lo = w[0], w[1]
        ax.axhspan(lo, hi, color=YEL, alpha=0.05, zorder=0)
        ax.axhline(hi, color=YEL, ls=":", lw=1.0, alpha=0.8, label=f"pre range {hi:,.0f}")
        ax.axhline(lo, color=YEL, ls=":", lw=1.0, alpha=0.8)
    ax.plot(xs, ny, color=BLUE, lw=1.2, label="NY VWAP")
    ax.axhline(d.on_vwap, color=YEL, ls="--", lw=1.0, alpha=0.75, label=f"ON VWAP {d.on_vwap:,.0f}")

    if our:
        ax.axhline(our["stop"], color=DN, ls="-", lw=1.0, alpha=0.85,
                   label=f"stop {our['stop']:,.0f}")
        ax.axhline(our["target"], color=UP, ls="--", lw=1.0, alpha=0.85,
                   label=f"target {our['target']:,.0f}")
        ex = int(np.flatnonzero(t >= S.RTH_OPEN)[0]) + 0
        eidx = int(np.flatnonzero(d.t == our["entry_t"])[0]) - idx[0]
        ax.scatter([eidx], [our["entry"]], marker="^" if our["side"] > 0 else "v",
                   color=FG, s=80, zorder=5, edgecolor=BG)
        xidx = max(0, min(n - 1, int(our.get("exit_idx", idx[0] + eidx)) - idx[0]))
        ax.scatter([xidx], [our["exit"]], marker="X", color=YEL, s=95, zorder=6, edgecolor=BG)
        ax.annotate(f"ours {our['kind']}  {our['R']:+.2f}R",
                    (xidx, our["exit"]), color=FG, fontsize=8,
                    xytext=(-12, -24), ha="right", textcoords="offset points",
                    bbox=dict(boxstyle="round,pad=0.35", fc="#161B22", ec=YEL, lw=0.8))

    for k, t_ in enumerate(his):
        hm = int(t_["t"][:2]) * 60 + int(t_["t"][3:])
        if hm < T_OPEN or hm >= T_CLOSE:
            continue
        xi = int(np.flatnonzero(d.t == hm)[0]) - idx[0] if np.any(d.t == hm) else None
        if xi is None or xi < 0 or xi >= n:
            continue
        ax.scatter([xi], [t_["entry"]], marker="D", color=PUR, s=55, zorder=6, edgecolor=BG)
        ax.annotate(f"{t_['leg']} {t_['entry']:,.2f}", (xi, t_["entry"]), color=PUR,
                    fontsize=7.5, xytext=(6, 8 if k % 2 == 0 else -12),
                    textcoords="offset points")
        if t_.get("exit") is not None:
            ax.scatter([xi], [t_["exit"]], marker="o", color=PUR, s=30, zorder=6, alpha=0.85)
            ax.annotate(f"x {t_['exit']:,.2f}", (xi, t_["exit"]), color=PUR, fontsize=7,
                        xytext=(6, -10), textcoords="offset points")

    ax.legend(loc="upper left", fontsize=7, framealpha=0.9, labelcolor=FG, ncol=2)
    rs = f"ours {our['R']:+.2f}R" if our else "ours: no signal"
    htxt = f" · his {len(his)} trade(s)" if his else ""
    ax.set_title(f"{d.date}  {tag}  ·  {rs}{htxt}", fontsize=11,
                 color=(UP if our and our["R"] > 0 else DN if our else FG))
    ticks = [x for i, x in enumerate(xs) if i % 30 == 0]
    ax.set_xticks(ticks)
    ax.set_xticklabels([f"{int(t[i])//60:02d}:{int(t[i])%60:02d}" for i in ticks], fontsize=7.5)
    ax.set_xlim(-0.5, n - 0.5)
    lo_v = min(l.min(), our["stop"] if our else l.min())
    hi_v = max(h.max(), our["stop"] if our else h.max())
    pad = (hi_v - lo_v) * 0.06
    ax.set_ylim(lo_v - pad, hi_v + pad)
    ax.grid(color="#21262D", lw=0.5, alpha=0.6)
    axv.set_ylabel("vol", fontsize=7)
    axv.grid(color="#21262D", lw=0.5, alpha=0.6, axis="y")
    fig.subplots_adjust(left=0.07, right=0.985, top=0.9, bottom=0.11)
    fn = f"NQ_{d.date}.png"
    fig.savefig(FIG / fn, dpi=110)
    plt.close(fig)
    return fn


CSS = ("body{background:#0D1117;color:#E6EDF3;font-family:system-ui,sans-serif;"
       "max-width:1180px;margin:0 auto;padding:24px;line-height:1.55}"
       "h1,h2{border-bottom:1px solid #30363D;padding-bottom:6px}"
       "h2{border-left:4px solid #1F6FEB;padding-left:10px}"
       "table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}"
       "th,td{border:1px solid #30363D;padding:5px 8px;text-align:right;font-variant-numeric:tabular-nums}"
       "th:first-child,td:first-child{text-align:left}th{background:#161B22}"
       "img{max-width:100%;background:#0D1117;border:1px solid #30363D;border-radius:6px;margin:10px 0}"
       ".up{color:#3FB950}.dn{color:#F85149}.dim{color:#8B949E}"
       ".warn{background:#161B22;border-left:3px solid #D29922;padding:8px 12px;margin:12px 0}")


def main():
    raw = NR.load_yf()
    days = {}
    for tag in ("1m", "5m"):
        for d in S.build_days(raw[tag]):
            k = str(d.date)
            if k not in days or tag == "1m":
                days[k] = (d, tag)
    rows = []
    for k in sorted(days):
        d, tag = days[k]
        our = NR.our_trade(d)
        his = NR.HIS.get(k, [])
        if not our and not his:
            continue
        fn = plot_session(d, tag, our, his)
        if fn:
            rows.append(dict(date=k, tf=tag, our=our, his=his, fig=fn))

    parts = [f"<!doctype html><meta charset='utf-8'><title>NQ November replay (SNDK style)</title>"
             f"<style>{CSS}</style>"
             f"<h1>NQ November 2026 — replay</h1>"
             f"<p class='dim'>Our rule: premarket-120 fade → NY VWAP, stop +30, entries ≤10:30. "
             f"Purple diamonds = his posted trades (transcribed from the chart images). "
             f"5m sessions are coarser than the 1m rule.</p>"
             f"<table><tr><th>date</th><th>tf</th><th>ours</th><th>R</th><th>his trades</th></tr>"]
    for r in rows:
        o = r["our"]
        cls = "up" if o and o["R"] > 0 else "dn" if o else "dim"
        parts.append(f"<tr><td><a href='#{r['date']}'>{r['date']}</a></td><td>{r['tf']}</td>"
                     f"<td class='{cls}'>" + (f"{'L' if o['side'] > 0 else 'S'} {o['entry']:,.2f} → {o['exit']:,.2f}" if o else "—") +
                     f"</td><td class='{cls}'>" + (f"{o['R']:+.2f}" if o else "—") +
                     f"</td><td>{len(r['his'])}</td></tr>")
    parts.append("</table>")
    for r in rows:
        parts.append(f"<h2 id='{r['date']}'>{r['date']} · {r['tf']}</h2>")
        parts.append(f"<img src='figures/{r['fig']}' alt='{r['date']}'>")
        if r["his"]:
            parts.append("<table><tr><th>his leg</th><th>side</th><th>entry</th><th>exit</th>"
                         "<th>time</th><th>note</th></tr>")
            for t in r["his"]:
                parts.append(f"<tr><td>{t['leg']}</td><td>{'LONG' if t['side'] > 0 else 'SHORT'}</td>"
                             f"<td>{t['entry']:,.2f}</td><td>{'—' if t.get('exit') is None else format(t['exit'], ',.2f')}</td>"
                             f"<td>{t['t']}</td><td style='text-align:left'>{t['note']}</td></tr>")
            parts.append("</table>")
    html = "\n".join(parts)
    (OUT / "index.html").write_text(html)
    print(f"wrote {OUT/'index.html'}  figures={len(rows)}")


if __name__ == "__main__":
    raise SystemExit(main())
