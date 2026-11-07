#!/usr/bin/env python3
"""Compact wall-replay report: left day/trade sidebar, per-trade charts."""

from __future__ import annotations

import base64
import csv
import json
import sys
from collections import OrderedDict
from datetime import datetime, timedelta
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "wall_replay"))
import batch  # noqa: E402

OUT = ROOT / "reports" / "WALL_REPLAY" / "report"
FIG = OUT / "figures"
OUT.mkdir(parents=True, exist_ok=True)
FIG.mkdir(parents=True, exist_ok=True)

DATES = batch.DATES
AGGR = {"break": 1, "oi": 100_000, "stop": 0.15, "arm": 0.15, "give": 0.10,
        "corridor": 30, "room": 20, "hold": 20, "ema": False, "partial": True,
        "gex": "none", "target": "wall", "htf": "none", "vwap": "none", "vol": "break", "mp": "none", "strike": "itm"}

ENTRY_WHY = {
    "break up": "Break above the call wall — first 1-min close beyond + OI move",
    "break down": "Break below the put wall — first 1-min close beyond + OI move",
    "fade put": "Fade at the put wall — wall held, two-bar higher low",
    "fade call": "Fade at the call wall — wall held, two-bar lower high",
}
EXIT_WHY = {
    "STOP": "Stop / trail give-back",
    "TARGET": "Target — the next wall",
    "OPPOSITE": "Opposite break confirmed",
    "EOD": "15:00 cutoff",
    "EMA": "EMA exit",
}

plt.rcParams.update({
    "figure.facecolor": "#0D1117", "axes.facecolor": "#0D1117",
    "axes.edgecolor": "#30363D", "axes.labelcolor": "#8B949E",
    "xtick.color": "#8B949E", "ytick.color": "#8B949E", "text.color": "#E6EDF3",
    "grid.color": "#30363D", "savefig.facecolor": "#0D1117",
})


def date_h(d):
    return datetime.strptime(d, "%Y-%m-%d").strftime("%a %d %b %Y")


def enrich(cfg):
    out = []
    for d in DATES:
        rs = batch.rows(d)
        for t in batch.run(d, cfg):
            ei = next((i for i, r in enumerate(rs) if r["t"] == t["entry_time"]), None)
            if ei is None:
                continue
            vals = [batch.px(r, t["strike"], t["opt"]) for r in rs[ei:]]
            mx = max(vals) if vals else 0.0
            avg_exit = t["exit"]
            if t.get("partial"):
                pq = batch.LOT // 2
                avg_exit = (t["partial_px"] * pq + t["exit"] * (batch.LOT - pq)) / batch.LOT
            cap = ((avg_exit - t["entry"]) / (mx - t["entry"]) * 100) if mx > t["entry"] else 0.0
            row = rs[ei]
            calls = (row.get("walls") or {}).get("calls") or []
            puts = (row.get("walls") or {}).get("puts") or []
            ctx = []
            if calls:
                ctx.append(f"call {calls[0]['strike']:.0f} ({calls[0]['oi']/1e6:.1f}M)")
            if puts:
                ctx.append(f"put {puts[0]['strike']:.0f} ({puts[0]['oi']/1e6:.1f}M)")
            if row.get("max_pain"):
                ctx.append(f"max pain {row['max_pain']:.0f}")
            tid = f"trade-{d}-{t['opt']}{int(t['strike'])}-{t['entry_time'][11:16].replace(':','')}"
            out.append({**t, "date": d, "entry_i": ei, "max": mx, "capture": cap,
                        "gross": t.get("gross", 0), "costs": t.get("costs", 0),
                        "net": t.get("net", 0), "avg_exit": avg_exit,
                        "entry_ctx": " · ".join(ctx), "tid": tid})
    return out


def stats(tr):
    n = len(tr)
    w = sum(1 for t in tr if t["net"] > 0)
    net = sum(t["net"] for t in tr)
    gw = sum(t["net"] for t in tr if t["net"] > 0)
    gl = -sum(t["net"] for t in tr if t["net"] < 0)
    return n, w, net, (gw / gl if gl else 0.0)


def b64(path):
    return base64.b64encode(path.read_bytes()).decode()


def ema_series(vals, n=9):
    k = 2.0 / (n + 1)
    out, e = [], vals[0] if vals else 0.0
    for v in vals:
        e = v * k + e * (1 - k)
        out.append(e)
    return out


def vwap_series(vals, n=30):
    return [sum(vals[max(0, i - n + 1): i + 1]) / len(vals[max(0, i - n + 1): i + 1])
            for i in range(len(vals))]


def _bucket(ts):
    dt = datetime.fromisoformat(ts)
    return dt.replace(second=0, microsecond=0)


def spot_bars(date):
    p = ROOT / "experiments" / "data" / "nifty_ticks" / f"{date}.jsonl"
    if p.exists():
        buckets = {}
        for line in p.read_text().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            k = _bucket(r["t"]); s = float(r["spot"])
            b = buckets.get(k)
            if b is None:
                buckets[k] = [s, s, s, s]
            else:
                b[1] = max(b[1], s); b[2] = min(b[2], s); b[3] = s
        return [(k, *v) for k, v in sorted(buckets.items())]
    snap = ROOT / "experiments" / "data" / "nifty_snapshots" / f"{date}.jsonl"
    if snap.exists():
        with open(snap, "rb") as f:
            f.seek(0, 2); size = f.tell(); f.seek(max(0, size - 3_000_000))
            data = f.read().decode("utf-8", "ignore")
        rows = [json.loads(l) for l in data.splitlines() if l.strip().startswith("{")]
        if rows:
            intr = (rows[-1].get("report") or {}).get("intraday") or []
            out = []
            for b in intr:
                try:
                    out.append((datetime.fromisoformat(b["time"]), float(b["open"]),
                                float(b["high"]), float(b["low"]), float(b["close"])))
                except (KeyError, TypeError, ValueError):
                    pass
            if out:
                return out
    rs = batch.rows(date); out = []; prev = None
    for r in rs:
        k = _bucket(r["t"]); s = float(r["spot"])
        o = prev if prev is not None else s
        out.append((k, o, max(o, s), min(o, s), s)); prev = s
    return out


def opt_bars(date, strike, opt):
    p = ROOT / "experiments" / "data" / "nifty_chain10s" / f"{date}.jsonl"
    if p.exists():
        buckets = {}
        for line in p.read_text().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            ch = {float(x[0]): x for x in r.get("rows") or []}
            x = ch.get(float(strike))
            if not x:
                continue
            px = float(x[1] if opt == "CE" else x[4])
            if px <= 0:
                continue
            k = _bucket(r["t"]); b = buckets.get(k)
            if b is None:
                buckets[k] = [px, px, px, px]
            else:
                b[1] = max(b[1], px); b[2] = min(b[2], px); b[3] = px
        return [(k, *v) for k, v in sorted(buckets.items())]
    rs = batch.rows(date); out = []; prev = None
    for r in rs:
        px = batch.px(r, strike, opt)
        if px <= 0:
            continue
        k = _bucket(r["t"]); o = prev if prev is not None else px
        out.append((k, o, max(o, px), min(o, px), px)); prev = px
    return out


def draw_candles(ax, bars, width=0.64):
    for i, (k, o, h, l, c) in enumerate(bars):
        col = "#3FB950" if c >= o else "#F85149"
        ax.plot([i, i], [l, h], color=col, lw=0.8, zorder=2)
        ax.add_patch(Rectangle((i - width / 2, min(o, c)), width, max(abs(c - o), 0.01),
                               color=col, zorder=3))
    ax.set_xlim(-1, len(bars))
    step = 30
    ax.set_xticks(range(0, len(bars), step))
    ax.set_xticklabels([bars[i][0].strftime("%H:%M") for i in range(0, len(bars), step)],
                       fontsize=6)


def mark(ax, bars, when, price, label="", kind="entry", plain=False):
    idx = min(range(len(bars)), key=lambda i: abs((bars[i][0] - when).total_seconds()))
    if kind == "entry":
        ax.scatter([idx], [price], marker="^", color="#E6EDF3", s=70, zorder=5, edgecolor="#0D1117")
    elif kind == "partial":
        ax.scatter([idx], [price], marker="D", color="#3FB950", s=55, zorder=5, edgecolor="#0D1117")
        if label and not plain:
            ax.annotate(label, (idx, price), color="#E6EDF3", fontsize=7, xytext=(8, 10),
                        textcoords="offset points", ha="left",
                        bbox=dict(boxstyle="round,pad=0.3", fc="#161B22", ec="#3FB950", lw=0.7))
    else:
        ax.scatter([idx], [price], marker="X", color="#D29922", s=95, zorder=6, edgecolor="#0D1117")
        if label and not plain:
            near_right = idx > len(bars) * 0.72
            ax.annotate(label, (idx, price), color="#E6EDF3", fontsize=8,
                        xytext=(-8, 14) if near_right else (8, 14),
                        ha="right" if near_right else "left", textcoords="offset points",
                        bbox=dict(boxstyle="round,pad=0.35", fc="#161B22", ec="#D29922", lw=0.8))


def fig_trade(t, path):
    sb_full = spot_bars(t["date"]); ob = opt_bars(t["date"], t["strike"], t["opt"])
    if not sb_full or not ob:
        return
    ed = datetime.fromisoformat(t["entry_time"]); xd = datetime.fromisoformat(t["exit_time"])
    lo, hi = ed - timedelta(minutes=30), xd + timedelta(minutes=60)
    start = next((i for i, b in enumerate(sb_full) if b[0] >= lo), 0)
    end = next((i for i, b in enumerate(sb_full) if b[0] > hi), len(sb_full))
    sb = sb_full[start:end]
    ob = [b for b in ob if lo <= b[0] <= hi]
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 5.4),
                                   gridspec_kw={"height_ratios": [2, 1]})
    draw_candles(ax1, sb); draw_candles(ax2, ob)
    closes_full = [b[4] for b in sb_full]
    e9 = ema_series(closes_full, 9)[start:end]
    vw = vwap_series(closes_full, 30)[start:end]
    ax1.plot(range(len(sb)), e9, color="#8957E5", lw=1.0, alpha=0.9, label="EMA9")
    ax1.plot(range(len(sb)), vw, color="#39D2C0", lw=1.0, alpha=0.8, label="VWAP")
    lo_s = min(b[3] for b in sb) if sb else 0
    hi_s = max(b[2] for b in sb) if sb else 0
    pad = max((hi_s - lo_s) * 0.06, 5)
    ax1.set_ylim(lo_s - pad, hi_s + pad)
    lo_o = min([b[3] for b in ob] + [t["entry"] * 0.85]) if ob else 0
    hi_o = max([b[2] for b in ob] + [t["max"]]) if ob else 0
    pad_o = max((hi_o - lo_o) * 0.06, 2)
    ax2.set_ylim(lo_o - pad_o, hi_o + pad_o)

    rs = batch.rows(t["date"])
    row = next((r for r in rs if r["t"] == t["entry_time"]), None)
    if row:
        calls = (row.get("walls") or {}).get("calls") or []
        puts = (row.get("walls") or {}).get("puts") or []
        if calls:
            ax1.axhline(calls[0]["strike"], color="#F85149", ls="--", lw=1.0, alpha=0.8,
                        label=f"call wall {calls[0]['strike']:.0f}")
        if puts:
            ax1.axhline(puts[0]["strike"], color="#3FB950", ls="--", lw=1.0, alpha=0.8,
                        label=f"put wall {puts[0]['strike']:.0f}")
        mp = float(row.get("max_pain") or 0)
        if mp:
            ax1.axhline(mp, color="#D29922", ls=":", lw=1.0, alpha=0.8, label=f"max pain {mp:.0f}")
        ax1.axhline(t["target_spot"], color="#D29922", ls=":", lw=0.8, alpha=0.5,
                    label=f"target {t['target_spot']:.0f}")
        xr = next((r for r in rs if r["t"] == t["exit_time"]), row)
        mark(ax1, sb, ed, float(row["spot"]), kind="entry", plain=True)
        mark(ax1, sb, xd, float(xr["spot"]), kind="exit", plain=True)

    ax2.axhline(t["entry"], color="#E6EDF3", ls="-", lw=1.0, alpha=0.85,
                label=f"entry {t['entry']:.2f}")
    ax2.axhline(round(t["entry"] * 0.85, 2), color="#F85149", ls="-", lw=1.0, alpha=0.85,
                label=f"STOP {t['entry']*0.85:.2f}")
    ax2.axhline(t["max"], color="#D29922", ls=":", lw=1.0, alpha=0.8, label=f"max {t['max']:.2f}")
    mark(ax2, ob, ed, t["entry"], kind="entry")
    mark(ax2, ob, xd, t["exit"], f"EXIT {t['exit']:.2f} · {t['reason']}", kind="exit")
    if t.get("partial"):
        mark(ax2, ob, datetime.fromisoformat(t["partial_time"]), t["partial_px"],
             f"PARTIAL {t['partial_px']:.2f}", kind="partial")
    if ax1.get_legend_handles_labels()[0]:
        ax1.legend(loc="upper left", fontsize=7, framealpha=0.9, labelcolor="#E6EDF3", ncol=2)
    if ax2.get_legend_handles_labels()[0]:
        ax2.legend(loc="upper left", fontsize=7, framealpha=0.9, labelcolor="#E6EDF3", ncol=2)

    src = ("1s ticks" if (ROOT / "experiments" / "data" / "nifty_ticks" / f"{t['date']}.jsonl").exists()
           else "1-min OHLC")
    osrc = ("10s chain" if (ROOT / "experiments" / "data" / "nifty_chain10s" / f"{t['date']}.jsonl").exists()
            else "close-only tape")
    tag = f"{t.get('split', '').upper()} · " if t.get("split") else ""
    ax1.set_title(f"{tag}{t['date']}  {t['opt']} {t['strike']:.0f}  ·  {t['why']}  ·  "
                  f"{t['entry']:.2f} → {t['exit']:.2f}  ({t['net']:+.0f})",
                  fontsize=11, color="#3FB950" if t["net"] > 0 else "#F85149")
    ax1.set_ylabel(f"NIFTY spot ({src})", fontsize=8)
    ax2.set_ylabel(f"{t['opt']} premium ({osrc})", fontsize=8)
    for a in (ax1, ax2):
        a.grid(color="#21262D", lw=0.5, alpha=0.6)
        a.tick_params(labelsize=7)
    fig.tight_layout()
    fig.savefig(path, dpi=105)
    plt.close(fig)


def fig_equity(tr, path):
    fig, ax = plt.subplots(figsize=(9, 2.8))
    run, xs, ys = 0, [], []
    for i, t in enumerate(tr):
        run += t["net"]; xs.append(i + 1); ys.append(run)
    ax.plot(xs, ys, marker="o", lw=2, color="#1F6FEB")
    ax.axhline(0, color="#8B949E", lw=0.8)
    ax.set_title("Equity — wall ITM v3.14 (1 lot)", fontsize=10)
    ax.set_xlabel("trade"); ax.set_ylabel("cumulative ₹")
    ax.grid(alpha=0.2); ax.tick_params(labelsize=7)
    fig.tight_layout(); fig.savefig(path, dpi=140); plt.close(fig)


def fig_capture(tr, path):
    tr = sorted(tr, key=lambda t: t["capture"], reverse=True)
    labels = [f"{t['date'][5:]} {t['opt']}{t['strike']:.0f}" for t in tr]
    vals = [t["capture"] for t in tr]
    fig, ax = plt.subplots(figsize=(9, 2.8))
    colors = ["#3FB950" if v >= 50 else "#D29922" if v > 0 else "#F85149" for v in vals]
    ax.barh(labels, vals, color=colors)
    ax.axvline(0, color="#8B949E", lw=0.8)
    ax.set_title("Capture: (exit − entry) / (max − entry)", fontsize=10)
    ax.set_xlabel("%"); ax.grid(axis="x", alpha=0.2); ax.tick_params(labelsize=7)
    fig.tight_layout(); fig.savefig(path, dpi=140); plt.close(fig)


def sidebar(tr):
    days = OrderedDict()
    for t in tr:
        days.setdefault(t["date"], []).append(t)
    out = []
    for d, ts in days.items():
        net = sum(x["net"] for x in ts)
        cls = "pos" if net > 0 else "neg"
        links = []
        for x in ts:
            c = "pos" if x["net"] > 0 else "neg"
            links.append(f'<a class="trade" href="#{x["tid"]}">{x["opt"]} {x["strike"]:.0f} '
                         f'<span class="dim">· {x["why"]}</span> <span class="{c}">{x["net"]:+.0f}</span></a>')
        out.append(f'<details class="day" open><summary>{date_h(d)} '
                   f'<span class="dim">· {len(ts)} · <span class="{cls}">{net:+.0f}</span></span></summary>'
                   f'{"".join(links)}</details>')
    flat = [d for d in DATES if d not in days]
    if flat:
        reasons = {"2026-10-13": "no option data", "2026-10-16": "no chain (ATM only)",
                   "2026-10-28": "pin, no wall cross", "2026-10-29": "09:17 wall cross before the 9:30 blackout; then mid-corridor trend, 23,000 never touched"}
        txt = " · ".join(f"{d[5:]} {reasons.get(d, 'no setup')}" for d in flat)
        out.append(f'<details class="day"><summary class="dim">Flat days — wall ITM, no trade ({len(flat)})</summary>'
                   f'<div class="flat">{txt}</div></details>')
    return "\n".join(out)


def trade_sections(tr, charts):
    out = []
    for t in tr:
        cls = "pos" if t["net"] > 0 else "neg"
        entry_why = ENTRY_WHY.get(t["why"], t["why"])
        exit_why = EXIT_WHY.get(t["reason"], t["reason"])
        partial = ""
        if t.get("partial"):
            partial = (f'<div><span class="lbl">Partial</span> half at {t["partial_px"]:.2f} · '
                       f'net {t["partial_net"]:+.0f}</div>')
        out.append(f"""<section id="{t['tid']}" class="trade-sec">
<h3 class="{cls}">{date_h(t['date'])} · {t['opt']} {t['strike']:.0f} · {t['why']} · {t['net']:+.0f}</h3>
<div class="reasons">
<div><span class="lbl">Entry</span> {entry_why} @ {t['entry']:.2f} · {t['entry_time'][11:19]}</div>
<div><span class="lbl">Context</span> {t['entry_ctx']}</div>
<div><span class="lbl">Exit</span> {exit_why} @ {t['exit']:.2f} · {t['exit_time'][11:19]}</div>
{partial}
</div>
<table><tr><th>entry</th><th>exit</th><th>max</th><th>capture</th><th>gross</th><th>costs</th><th>net</th></tr>
<tr><td>{t['entry']:.2f}</td><td>{t['exit']:.2f}</td><td>{t['max']:.2f}</td>
<td>{t['capture']:.0f}%</td><td>{t['gross']:+.0f}</td><td>{t['costs']:.0f}</td>
<td class="{cls}">{t['net']:+.0f}</td></tr></table>
<img src="data:image/png;base64,{b64(charts[id(t)])}"/>
</section>""")
    return "\n".join(out)


def main():
    d = enrich(AGGR)
    for name, tr in (("wall_itm", d),):
        with open(OUT / f"trades_{name}.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["date", "why", "opt", "strike", "entry", "exit", "max", "capture_pct",
                        "gross", "costs", "net", "reason"])
            for t in tr:
                w.writerow([t["date"], t["why"], t["opt"], t["strike"], round(t["entry"], 2),
                            round(t["exit"], 2), round(t["max"], 2), round(t["capture"], 1),
                            round(t["gross"], 2), round(t["costs"], 2), round(t["net"], 2), t["reason"]])

    fig_equity(d, FIG / "equity.png")
    fig_capture(d, FIG / "capture.png")
    charts = {}
    for t in d:
        p = FIG / f"WALL_{t['date']}_{t['opt']}{t['strike']:.0f}.png"
        fig_trade(t, p)
        charts[id(t)] = p

    exit_rows = []
    for give in (0.10, 0.20, 0.30):
        tr = enrich({**AGGR, "give": give})
        n, w, net, pf = stats(tr)
        exit_rows.append((give, n, w, net, pf))
    hold_rows = []
    for hold in (0, 10, 15, 20):
        tr = enrich({**AGGR, "hold": hold})
        n, w, net, pf = stats(tr)
        hold_rows.append((hold, n, w, net, pf))
    size_rows = []
    for lots in (1, 3, 5):
        batch.LOT = 65 * lots
        tr = enrich(AGGR)
        n, w, net, pf = stats(tr)
        run = peak = dd = 0.0
        for t in tr:
            run += t["net"]; peak = max(peak, run); dd = min(dd, run - peak)
        size_rows.append((lots, n, w, net, pf, dd, 900_000 / net if net > 0 else 0.0))
    batch.LOT = 65
    setups = []
    for why in ("break up", "break down", "fade put", "fade call"):
        tr = [t for t in d if t["why"] == why]
        if tr:
            n, w, net, pf = stats(tr)
            setups.append((why, n, w, net, pf))

    dn, dw, dnet, dpf = stats(d)
    total_costs = sum(t["costs"] for t in d)
    big = sorted(d, key=lambda t: t["net"], reverse=True)[0]
    low_cap = [t for t in d if t["capture"] < 50]
    low_txt = "; ".join(
        f"{t['date'][5:]} {t['opt']} {t['strike']:.0f} ran {t['entry']:.2f} → {t['max']:.2f} (took {t['capture']:.0f}%)"
        for t in low_cap[:3])

    def rows_html(rows, cols):
        return "\n".join(
            "<tr>" + "".join(
                f"<td class='{'pos' if v > 0 else 'neg'}'>{v:+.0f}</td>" if isinstance(v, float) and i >= 3
                else f"<td>{v:.2f}</td>" if isinstance(v, float) else f"<td>{v}</td>"
                for i, v in enumerate(r)) + "</tr>"
            for r in rows)

    def tbl(headers, rows, fmts):
        head = "".join(f"<th>{h}</th>" for h in headers)
        body = []
        for r in rows:
            cells = []
            for i, v in enumerate(r):
                if fmts[i] == "money":
                    cells.append(f"<td class='{'pos' if v > 0 else 'neg'}'>{v:+,.0f}</td>")
                elif fmts[i] == "pf":
                    cells.append(f"<td>{v:.2f}</td>")
                elif fmts[i] == "pct":
                    cells.append(f"<td>{v:.0%}</td>")
                elif fmts[i] == "int":
                    cells.append(f"<td>{v}</td>")
                else:
                    cells.append(f"<td>{v}</td>")
            body.append("<tr>" + "".join(cells) + "</tr>")
        return f"<table><tr>{head}</tr>{''.join(body)}</table>"

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>NIFTY wall-to-wall replay — v3.14</title><style>
*{{box-sizing:border-box}} html{{scroll-behavior:smooth}}
body{{margin:0;background:#0D1117;color:#E6EDF3;font:12.5px/1.5 system-ui,sans-serif}}
.layout{{display:grid;grid-template-columns:255px minmax(0,1fr)}}
.side{{position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid #30363D;background:#0B0F14;padding:10px}}
.side-title{{font-size:12px;font-weight:700;letter-spacing:.02em}}
.side-sub{{color:#8B949E;font-size:10px;margin-bottom:8px}}
details.day{{margin:2px 0}}
summary{{cursor:pointer;padding:4px 6px;border-radius:4px;font-size:11px;font-weight:600}}
summary:hover{{background:#161B22}}
a.trade{{display:block;padding:3px 6px 3px 14px;color:#8B949E;text-decoration:none;font-size:10.5px;border-left:2px solid transparent}}
a.trade:hover{{color:#E6EDF3;border-left-color:#1F6FEB;background:#161B22}}
.flat{{padding:4px 6px;color:#8B949E;font-size:10px}}
.main{{padding:16px 20px;max-width:1080px}}
h1{{font-size:17px;margin:0 0 2px}} h2{{font-size:13px;margin:16px 0 6px;border-left:3px solid #1F6FEB;padding-left:8px}}
h3{{font-size:12px;margin:0 0 4px}}
table{{border-collapse:collapse;width:100%;font-size:11px}}
th,td{{border:1px solid #30363D;padding:3px 5px;text-align:right;font-variant-numeric:tabular-nums}}
th:first-child,td:first-child{{text-align:left}} th{{background:#161B22;color:#8B949E;font-weight:600}}
img{{width:100%;border:1px solid #30363D;border-radius:6px;margin:6px 0}}
.grid2{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}
.cards{{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}}
.card{{background:#161B22;border:1px solid #30363D;border-radius:6px;padding:8px}}
.card .k{{font-size:9.5px;color:#8B949E;text-transform:uppercase;letter-spacing:.03em}}
.card .v{{font-size:16px;font-weight:700}}
.trade-sec{{border:1px solid #30363D;border-radius:8px;padding:9px;margin:10px 0;background:#0B0F14;scroll-margin-top:10px}}
.reasons{{display:grid;gap:1px;font-size:11px;margin:3px 0 7px}}
.lbl{{display:inline-block;min-width:46px;color:#8B949E;font-size:9.5px;text-transform:uppercase}}
.pos{{color:#3FB950}} .neg{{color:#F85149}} .dim{{color:#8B949E}}
.note{{background:#161B22;border-left:3px solid #D29922;padding:7px 9px;margin:8px 0;font-size:11px}}
@media(max-width:820px){{.layout{{grid-template-columns:1fr}}.side{{position:static;height:auto;border-right:0;border-bottom:1px solid #30363D}}.grid2{{grid-template-columns:1fr}}.cards{{grid-template-columns:repeat(2,1fr)}}}}
</style></head><body><div class="layout">
<aside class="side">
<div class="side-title">NIFTY wall replay</div>
<div class="side-sub">13–30 Oct 2026 · 1 lot · v3.14</div>
{sidebar(d)}
</aside>
<main class="main">
<h1>Wall-to-wall replay — v3.14</h1>
<div class="dim" style="font-size:11px">Tape 13–30 Oct 2026 · 1 lot (65 qty) · costs included · signal at bar t, fill at t+1.</div>
<div class="cards">
<div class="card"><div class="k">Wall ITM</div><div class="v {'pos' if dnet>0 else 'neg'}">{dnet:+,.0f}</div><div class="dim" style="font-size:10px">{dn} trades · PF {dpf:.2f}</div></div>
<div class="card"><div class="k">Win rate</div><div class="v">{dw/dn*100 if dn else 0:.0f}%</div><div class="dim" style="font-size:10px">{dw}/{dn} trades</div></div>
<div class="card"><div class="k">Costs</div><div class="v">{total_costs:,.0f}</div><div class="dim" style="font-size:10px">~₹{total_costs/dn if dn else 0:.0f}/trade</div></div>
<div class="card"><div class="k">Best trade</div><div class="v pos">{big['net']:+,.0f}</div><div class="dim" style="font-size:10px">{big['date']} {big['why']} · capture {big['capture']:.0f}%</div></div>
</div>

<h2>Edge</h2>
<div class="grid2">
<div><h3>Hold time</h3>{tbl(["hold","n","win","net","PF"], [(f"{h} min", n, w, net, pf) for h, n, w, net, pf in hold_rows], ["str","int","int","money","pf"])}</div>
<div><h3>Trail give-back</h3>{tbl(["give","n","win","net","PF"], [(f"{g:.0%}", n, w, net, pf) for g, n, w, net, pf in exit_rows], ["str","int","int","money","pf"])}</div>
</div>
<div class="grid2">
<div><h3>Sizing (wall ITM)</h3>{tbl(["size","n","win","net","PF","DD","cycles"], [(f"{l} lot" + ("s" if l>1 else ""), n, w, net, pf, dd, cyc) for l, n, w, net, pf, dd, cyc in size_rows], ["str","int","int","money","pf","money","pf"])}</div>
<div><h3>By setup</h3>{tbl(["setup","n","win","net","PF"], setups, ["str","int","int","money","pf"])}</div>
</div>

<h2>Curves & capture</h2>
<div class="grid2">
<img src="data:image/png;base64,{b64(FIG/'equity.png')}"/>
<img src="data:image/png;base64,{b64(FIG/'capture.png')}"/>
</div>
<div class="note"><b>Best trade:</b> {big['capture']:.0f}% capture ({big['entry']:.2f} → {big['exit']:.2f}, max {big['max']:.2f}).
<b>Others:</b> {low_txt}. The 20-min hold + partial + 10% trail is the current exit.</div>

<h2>Trades</h2>
{trade_sections(d, charts)}

<h2>Findings</h2>
<ul style="font-size:11.5px;padding-left:18px">
<li><b>Costs:</b> ₹{total_costs:,.0f} across {dn} trades (~₹{total_costs/dn if dn else 0:.0f}/trade); every net figure is after costs.</li>
<li><b>Exit:</b> 20-min minimum hold + partial at the target + 10% trail — the tables above show each variant.</li>
<li><b>Volume filter:</b> above-median 5-min volume at the <b>wall</b> (not the ITM strike) — the 10-30 fix recovered the +₹1,531 break.</li>
<li><b>ITM strike:</b> enter <b>50 pts ITM</b> (CE wall−50 / PE wall+50) — the ATM pays the most theta. Current: <b>+₹16,327, PF 10.38</b> on 14 trades.</li>
<li><b>Risk:</b> a 1-pt break into a large static call wall with max pain below is a fade, not a break — skip at 1 lot, half size at 2+.</li>
<li><b>Sizing:</b> the table above (1 / 3 / 5 lots, same config). In-sample; forward paper first.</li>
</ul>
</main></div></body></html>"""

    (OUT / "WALL_REPLAY_report.html").write_text(html)
    md = f"""# NIFTY wall-to-wall replay — v3.14

Tape 13–30 Oct 2026 · 1 lot · costs included.

| config | trades | wins | net ₹ | PF |
|---|---|---|---|---|
| **wall ITM (1-pt break)** | {dn} | {dw} | {dnet:+,.0f} | {dpf:.2f} |

Costs: ₹{total_costs:,.0f} (~₹{total_costs/dn if dn else 0:.0f}/trade).

## Trades

""" + "\n".join(
        f"### {date_h(t['date'])} · {t['opt']} {t['strike']:.0f} · {t['why']} · {t['net']:+.0f}\n"
        f"- Entry: {ENTRY_WHY.get(t['why'], t['why'])} @ {t['entry']:.2f} ({t['entry_time'][11:19]})\n"
        f"- Context: {t['entry_ctx']}\n"
        f"- Exit: {EXIT_WHY.get(t['reason'], t['reason'])} @ {t['exit']:.2f} ({t['exit_time'][11:19]})\n"
        + (f"- Partial: {t['partial_px']:.2f} · net {t['partial_net']:+.0f}\n" if t.get("partial") else "")
        + f"- Max {t['max']:.2f} · capture {t['capture']:.0f}% · gross {t['gross']:+.0f} · costs {t['costs']:.0f} · **net {t['net']:+.0f}**\n"
        for t in d) + f"""
## Findings

- 20-min hold + partial + 10% trail: +₹10,414, PF 3.21 (from +₹5,706 / 2.20).
- Volume break filter: +₹12,638, PF 5.00 (from +₹10,414 / 3.21); test half +₹9,769.
- GEX, HTF and VWAP filters all reduce the net.
- Aggressive 5 lots: +₹57,734 / 13 sessions, max DD −₹6,985 (7%), ~16 cycles to ₹9L.
- In-sample; forward paper at 1 lot is the gate.

HTML: `WALL_REPLAY_report.html` · figures: `figures/` · CSV: `trades_wall_itm.csv`
"""
    (OUT / "WALL_REPLAY_report.md").write_text(md)
    print(f"wrote {OUT}")
    print(f"wall ITM n={dn} net={dnet:+.0f} PF={dpf:.2f}")


if __name__ == "__main__":
    main()
