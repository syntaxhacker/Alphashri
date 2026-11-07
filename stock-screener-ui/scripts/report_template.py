#!/usr/bin/env python3
"""Reusable dark-theme trading report (SNDK style).

One builder for every strategy report: summary cards, left sidebar with
clickable days, per-trade sections (Entry / Context / Exit / Partial), a table,
and an embedded chart. No more rebuilding the HTML for each study.

Usage:
    from report_template import Report, trade_chart

    r = Report("Wall fade", "19 trades · 1 lot")
    r.cards([("Net", "+₹28,574", "19 trades · PF 4.72"),
             ("Max DD", "−₹2,332", "worst −₹540")])
    r.sidebar(trades, label=lambda t: f"{t['opt']} {t['strike']:.0f}")
    for t in trades:
        p = trade_chart(t, Path("figs") / f"{t['tid']}.png")
        r.trade(t, p, entry="...", context="...", exit="...", partial="")
    r.write(Path("report.html"))

`trade_chart` handles:
  - a long option  (t["opt"] in {"CE","PE"}, t["strike"])
  - a structure    (t["legs"] = [(strike, opt, side), ...])
"""

from __future__ import annotations

import base64
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Iterable, Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

BG, PANEL, GRID = "#0D1117", "#161B22", "#21262D"
TXT, MUT = "#E6EDF3", "#8B949E"
GREEN, RED, BLUE, TEAL, YELLOW, PURPLE = "#3FB950", "#F85149", "#58A6FF", "#39D2C0", "#D29922", "#BC8CFF"

plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": BG, "axes.edgecolor": GRID,
    "axes.labelcolor": MUT, "xtick.color": MUT, "ytick.color": MUT,
    "text.color": TXT, "grid.color": GRID, "savefig.facecolor": BG, "font.size": 10,
})

CSS = """
*{box-sizing:border-box} html{scroll-behavior:smooth}
body{margin:0;background:#0D1117;color:#E6EDF3;font:12.5px/1.5 system-ui,sans-serif}
.layout{display:grid;grid-template-columns:255px minmax(0,1fr)}
.side{position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid #30363D;background:#0B0F14;padding:10px}
.side-title{font-size:12px;font-weight:700} .side-sub{color:#8B949E;font-size:10px;margin-bottom:8px}
details.day{margin:2px 0} summary{cursor:pointer;padding:4px 6px;border-radius:4px;font-size:11px;font-weight:600}
summary:hover{background:#161B22}
a.trade{display:block;padding:3px 6px 3px 14px;color:#8B949E;text-decoration:none;font-size:10.5px;border-left:2px solid transparent}
a.trade:hover{color:#E6EDF3;border-left-color:#1F6FEB;background:#161B22}
.main{padding:16px 20px;max-width:1080px}
h1{font-size:17px;margin:0 0 2px} h2{font-size:13px;margin:16px 0 6px;border-left:3px solid #1F6FEB;padding-left:8px}
h3{font-size:12px;margin:0 0 4px}
table{border-collapse:collapse;width:100%;font-size:11px}
th,td{border:1px solid #30363D;padding:3px 5px;text-align:right;font-variant-numeric:tabular-nums}
th:first-child,td:first-child{text-align:left} th{background:#161B22;color:#8B949E;font-weight:600}
img{width:100%;border:1px solid #30363D;border-radius:6px;margin:6px 0}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}
.card{background:#161B22;border:1px solid #30363D;border-radius:6px;padding:8px}
.card .k{font-size:9.5px;color:#8B949E;text-transform:uppercase;letter-spacing:.03em}
.card .v{font-size:16px;font-weight:700}
.trade-sec{border:1px solid #30363D;border-radius:8px;padding:9px;margin:10px 0;background:#0B0F14;scroll-margin-top:10px}
.reasons{display:grid;gap:1px;font-size:11px;margin:3px 0 7px}
.lbl{display:inline-block;min-width:46px;color:#8B949E;font-size:9.5px;text-transform:uppercase}
.pos{color:#3FB950} .neg{color:#F85149} .dim{color:#8B949E}
.tag{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.06em;padding:1px 5px;border-radius:4px}
.tag.train{background:#1F3A5F;color:#79C0FF} .tag.test{background:#1B3D2F;color:#56D364}
.note{background:#161B22;border-left:3px solid #D29922;padding:7px 9px;margin:8px 0;font-size:11px}
.filter{display:flex;gap:6px;margin:8px 0 2px}
.filter button{background:#161B22;color:#8B949E;border:1px solid #30363D;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer}
.filter button.on{background:#1F6FEB;color:#fff;border-color:#1F6FEB}
@media(max-width:820px){.layout{grid-template-columns:1fr}.side{position:static;height:auto;border-right:0;border-bottom:1px solid #30363D}.cards{grid-template-columns:repeat(2,1fr)}}
"""


def b64(p: Path) -> str:
    return base64.b64encode(Path(p).read_bytes()).decode()


def _date_h(d: str) -> str:
    return datetime.strptime(d, "%Y-%m-%d").strftime("%a %d %b %Y")


def _bars(rows, strike, opt, bucket="5min"):
    """Spot or option bars from tape rows."""
    out, prev = [], None
    for r in rows:
        px = float(r["spot"]) if opt is None else _leg_px(r, strike, opt)
        if px <= 0:
            continue
        key = r["t"][11:16]
        if bucket == "5min":
            key = r["t"][11:15] + "0"
        if out and out[-1][0] == key:
            b = out[-1]
            out[-1] = (key, b[1], max(b[2], px), min(b[3], px), px)
        else:
            out.append((key, prev if prev is not None else px, px, px, px))
        prev = px
    return out


def _leg_px(r, strike, opt):
    leg = (r.get("chain") or {}).get(str(int(strike)))
    return float(leg[0] if opt == "CE" else leg[1]) if leg and len(leg) >= 2 else 0.0


def _candles(ax, bars, width=.64):
    for i, (k, o, h, l, c) in enumerate(bars):
        col = GREEN if c >= o else RED
        ax.plot([i, i], [l, h], color=col, lw=.8, zorder=2)
        ax.add_patch(Rectangle((i - width / 2, min(o, c)), width,
                               max(abs(c - o), .01), color=col, zorder=3))
    ax.set_xlim(-1, len(bars))
    step = max(1, len(bars) // 12)
    ax.set_xticks(range(0, len(bars), step))
    ax.set_xticklabels([bars[i][0] for i in range(0, len(bars), step)], fontsize=6)


def _mark(ax, bars, when, price, label="", kind="entry"):
    idx = min(range(len(bars)), key=lambda i: abs(
        (datetime.strptime(bars[i][0], "%H:%M").replace(year=2000) -
         datetime.strptime(when, "%H:%M").replace(year=2000)).total_seconds()))
    if kind == "entry":
        ax.scatter([idx], [price], marker="^", color=TXT, s=70, zorder=5, edgecolor=BG)
    else:
        ax.scatter([idx], [price], marker="X", color=YELLOW, s=95, zorder=6, edgecolor=BG)
        if label:
            ax.annotate(label, (idx, price), color=TXT, fontsize=8,
                        xytext=(8, 12), textcoords="offset points",
                        bbox=dict(boxstyle="round,pad=.3", fc=PANEL, ec=YELLOW, lw=.8))


def trade_chart(t: dict, path: Path, rows: list, title: str = "") -> Path:
    """Generic chart: spot candles + strikes + entry/exit, premium panel."""
    d = t["entry_time"][:10]
    ed = datetime.fromisoformat(t["entry_time"]).time().strftime("%H:%M")
    xd = datetime.fromisoformat(t["exit_time"]).time().strftime("%H:%M")
    sb = _bars(rows, 0, None)
    if not sb:
        return path
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 5.2),
                                   gridspec_kw={"height_ratios": [2, 1]})
    _candles(ax1, sb)
    lo = min(b[3] for b in sb); hi = max(b[2] for b in sb)
    pad = max((hi - lo) * .06, 5)
    ax1.set_ylim(lo - pad, hi + pad)

    legs = t.get("legs") or [(t["strike"], t["opt"], -1)]
    for k, o, side in legs:
        col = RED if o == "CE" else GREEN
        ax1.axhline(k, color=col, ls="--", lw=1, alpha=.85,
                    label=f"{'short' if side < 0 else 'long'} {o} {k:.0f}")
    row = next((r for r in rows if r["t"] == t["entry_time"]), rows[0])
    xr = next((r for r in rows if r["t"] == t["exit_time"]), row)
    _mark(ax1, sb, ed, float(row["spot"]), kind="entry")
    _mark(ax1, sb, xd, float(xr["spot"]), kind="exit")
    ax1.set_ylabel("spot", fontsize=8)
    ax1.legend(loc="upper left", fontsize=7, framealpha=.9, labelcolor=TXT, ncol=2)

    for k, o, side in legs:
        ob = _bars(rows, k, o)
        if not ob:
            continue
        col = RED if o == "CE" else GREEN
        ax2.plot(range(len(ob)), [b[4] for b in ob], color=col, lw=1.2, label=f"{o} {k:.0f}")
        entry_px = (t.get("entry") or {}).get(f"{k}{o}") if isinstance(t.get("entry"), dict) else None
        if entry_px:
            _mark(ax2, ob, ed, entry_px, kind="entry")
        _mark(ax2, ob, xd, _leg_px(xr, k, o) or 0, kind="exit")
    ax2.set_ylabel("premium", fontsize=8)
    ax2.legend(loc="upper left", fontsize=7, framealpha=.9, labelcolor=TXT, ncol=2)
    for a in (ax1, ax2):
        a.grid(color=GRID, lw=.5, alpha=.6)
        a.tick_params(labelsize=7)
    ax1.set_title(title or f"{d}  {t.get('why', '')}  {t['net']:+.0f}",
                  fontsize=10, color=GREEN if t["net"] > 0 else RED)
    fig.tight_layout()
    fig.savefig(path, dpi=105)
    plt.close(fig)
    return path


class Report:
    def __init__(self, title: str, subtitle: str):
        self.title = title
        self.subtitle = subtitle
        self._cards: list[tuple] = []
        self._trades: list[dict] = []
        self._sections: list[str] = []
        self._sidebar: str = ""
        self._notes: list[str] = []

    def cards(self, items: Iterable[tuple]):
        self._cards = list(items)
        return self

    def note(self, text: str):
        self._notes.append(text)
        return self

    def sidebar(self, trades: list[dict], label: Callable[[dict], str],
                date_key: str = "entry_time", split_key: str = "split"):
        days: dict[str, list] = {}
        for t in trades:
            days.setdefault(t[date_key][:10], []).append(t)
        out = []
        for d, ts in days.items():
            net = sum(x["net"] for x in ts)
            links = "".join(
                f'<a class="trade" data-split="{x.get(split_key, "")}" href="#{x["tid"]}">'
                f'<span class="tag {x.get(split_key, "")}">{x.get(split_key, "").upper()}</span> '
                f'{label(x)} <span class="{"pos" if x["net"] > 0 else "neg"}">{x["net"]:+.0f}</span></a>'
                for x in ts)
            out.append(f'<details class="day" open><summary>{_date_h(d)} '
                       f'<span class="dim">· <span class="{"pos" if net > 0 else "neg"}">{net:+.0f}</span>'
                       f'</span></summary>{links}</details>')
        self._sidebar = "\n".join(out)
        self._trades = trades
        return self

    def trade(self, t: dict, chart: Optional[Path], entry: str = "", context: str = "",
              exit_: str = "", partial: str = ""):
        cls = "pos" if t["net"] > 0 else "neg"
        part = f'<div><span class="lbl">Partial</span> {partial}</div>' if partial else ""
        img = f'<img src="data:image/png;base64,{b64(chart)}"/>' if chart else ""
        self._sections.append(f"""<section id="{t['tid']}" data-split="{t.get('split','')}" class="trade-sec">
<h3 class="{cls}"><span class="tag {t.get('split','')}">{t.get('split','').upper()}</span>
{_date_h(t['entry_time'][:10])} · {t.get('why','')} · {t['net']:+.0f}</h3>
<div class="reasons">
<div><span class="lbl">Entry</span> {entry}</div>
<div><span class="lbl">Context</span> {context}</div>
<div><span class="lbl">Exit</span> {exit_}</div>
{part}
</div>
<table><tr><th>entry</th><th>exit</th><th>gross</th><th>costs</th><th>net</th></tr>
<tr><td>{t.get('entry', 0) if not isinstance(t.get('entry'), dict) else t['credit']:.0f}</td>
<td>{t.get('exit', 0) if not isinstance(t.get('entry'), dict) else ''}</td>
<td>{t['gross']:+.0f}</td><td>{t['costs']:.0f}</td><td class="{cls}">{t['net']:+.0f}</td></tr></table>
{img}
</section>""")
        return self

    def write(self, path: Path):
        cards = "".join(f'<div class="card"><div class="k">{k}</div>'
                        f'<div class="v">{v}</div><div class="dim" style="font-size:10px">{s}</div></div>'
                        for k, v, s in self._cards)
        notes = "".join(f'<div class="note">{n}</div>' for n in self._notes)
        html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>{self.title}</title><style>{CSS}</style></head><body><div class="layout">
<aside class="side"><div class="side-title">{self.title}</div>
<div class="side-sub">{self.subtitle}</div>{self._sidebar}</aside>
<main class="main"><h1>{self.title}</h1>
<div class="dim" style="font-size:11px">{self.subtitle}</div>
<div class="cards">{cards}</div>{notes}<h2>Trades</h2>{''.join(self._sections)}
</main></div></body></html>"""
        Path(path).write_text(html)
        return path
