"""Build a self-contained EDA HTML from the four nasdaq_hourly_eda research lanes.

Input:  reports/nasdaq_hourly_eda/{analysis_1h,analysis_4h,examples}.json + validation.md
Output: reports/nasdaq_hourly_eda/index.html (offline; charts embedded as base64 PNG)
"""

import base64
import html
import io
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.patches import Rectangle

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports" / "nasdaq_hourly_eda"
BG = "#0d1117"
PANEL = "#161b22"
INK = "#e6edf3"
MUTED = "#8b949e"
ACCENT = "#58a6ff"
POS = "#3fb950"
NEG = "#f85149"
GRID = "#30363d"
SERIES_COLORS = [ACCENT, "#d29922", "#a371f7", POS, NEG, "#39c5cf"]


def esc(value):
    return html.escape(str(value), quote=True)


def parse_time(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def fmt_span(bar_t, next_t):
    a = parse_time(bar_t)
    b = parse_time(next_t) if next_t else None
    if a is None:
        return str(bar_t)
    if b is None:
        return f"{a:%d %b %Y, %H:%M} UTC"
    if a.date() == b.date():
        return f"{a:%d %b %Y}, {a:%H:%M} → {b:%H:%M} UTC"
    return f"{a:%d %b %Y, %H:%M} → {b:%d %b %Y, %H:%M} UTC"


def png_b64(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=115, bbox_inches="tight",
                facecolor=BG, edgecolor="none")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def style_axes(ax, title="", xlabel="", ylabel=""):
    ax.set_facecolor(PANEL)
    ax.set_title(title, color=INK, fontsize=11, pad=9)
    ax.set_xlabel(xlabel, color=MUTED, fontsize=9)
    ax.set_ylabel(ylabel, color=MUTED, fontsize=9)
    ax.tick_params(colors=MUTED, labelsize=8)
    for spine in ax.spines.values():
        spine.set_color(GRID)
    ax.grid(True, color=GRID, alpha=0.45, linewidth=0.6)
    ax.set_axisbelow(True)


def numbers(values):
    return [float("nan") if v is None else float(v) for v in values]


def render_chart(chart):
    ctype = chart.get("type", "bar")
    labels = [str(x) for x in chart.get("labels", [])]
    series = chart.get("series", [])
    fig, ax = plt.subplots(figsize=(11, 3.5), facecolor=BG)
    x = np.arange(len(labels))
    if ctype in ("bar", "hist"):
        width = 0.72 / max(1, len(series))
        for i, s in enumerate(series):
            vals = numbers(s.get("values", []))
            ax.bar(x + (i - (len(series) - 1) / 2) * width, vals, width,
                   label=s.get("name", f"series {i+1}"), color=SERIES_COLORS[i % len(SERIES_COLORS)])
        ax.set_xticks(x)
        ax.set_xticklabels(labels, rotation=45 if any(len(l) > 5 for l in labels) else 0, ha="right")
        ax.axhline(0, color=MUTED, linewidth=0.7, alpha=0.6)
    elif ctype == "line":
        for i, s in enumerate(series):
            vals = numbers(s.get("values", []))
            ax.plot(x, vals, marker="o", markersize=3, linewidth=1.6,
                    label=s.get("name", f"series {i+1}"), color=SERIES_COLORS[i % len(SERIES_COLORS)])
        ax.set_xticks(x)
        ax.set_xticklabels(labels, rotation=45 if any(len(l) > 5 for l in labels) else 0, ha="right")
    elif ctype == "scatter":
        xs = numbers(labels)
        for i, s in enumerate(series):
            ax.scatter(xs, numbers(s.get("values", [])), s=16, alpha=0.7,
                       label=s.get("name", f"series {i+1}"), color=SERIES_COLORS[i % len(SERIES_COLORS)])
    else:
        ax.text(0.5, 0.5, f"unsupported chart type: {ctype}", ha="center", va="center", color=MUTED)
    style_axes(ax, chart.get("title", ""), chart.get("x_label", ""), chart.get("y_label", ""))
    if series:
        ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=INK, fontsize=8, loc="best")
    fig.tight_layout()
    return png_b64(fig)


def render_example(ex, minute_lookup):
    """SNDK-style candle view: 1m candles, tick subplot, shaded bar regions, level lines."""
    s = ex["series"]
    ts = [datetime.fromisoformat(t) for t in s["t"]]
    close = numbers(s["close"])
    high = numbers(s["high"])
    low = numbers(s["low"])
    opens, volumes = [], []
    for t, c in zip(ts, close):
        row = minute_lookup.get(t)
        opens.append(float(row[0]) if row is not None else c)
        volumes.append(float(row[1]) if row is not None else 0.0)

    fig, (ax, axv) = plt.subplots(
        2, 1, figsize=(11, 4.6), sharex=True, facecolor=BG,
        gridspec_kw={"height_ratios": [5, 1], "hspace": 0.07})
    xs = np.arange(len(ts))
    span = max(high) - min(low) or 1.0
    colors = []
    for i, (o, h, l, c) in enumerate(zip(opens, high, low, close)):
        col = POS if c >= o else NEG
        colors.append(col)
        ax.vlines(i, l, h, color=col, linewidth=0.75, zorder=3)
        ax.add_patch(Rectangle((i - 0.32, min(o, c)), 0.64,
                               max(abs(c - o), span * 0.0012),
                               facecolor=col, edgecolor=col, linewidth=0, zorder=4))
    axv.bar(xs, volumes, width=0.7, color=colors, alpha=0.65, linewidth=0)

    bar_t = datetime.fromisoformat(ex["bar_t"])
    boundary = bar_t + timedelta(hours=1 if ex["kind"] == "1h" else 4)
    boundary_x = sum(1 for t in ts if t < boundary)
    if 0 < boundary_x < len(ts):
        ax.axvspan(-0.5, boundary_x - 0.5, color="#1b2733", zorder=0)
        axv.axvspan(-0.5, boundary_x - 0.5, color="#1b2733", zorder=0)
        ax.axvline(boundary_x, color="#d29922", linestyle="--", linewidth=1, alpha=0.9)
        axv.axvline(boundary_x, color="#d29922", linestyle="--", linewidth=1, alpha=0.9)
        ax.text((boundary_x - 1) / 2, 0.97, "EXAMPLE BAR", transform=ax.get_xaxis_transform(),
                color=MUTED, fontsize=7, ha="center", va="top")
        ax.text((boundary_x + len(ts)) / 2, 0.97, "NEXT BAR", transform=ax.get_xaxis_transform(),
                color=MUTED, fontsize=7, ha="center", va="top")

    stats = ex.get("stats", {}) or {}
    marker_colors = {"H": POS, "L": NEG, "O": "#d29922", "C": "#a371f7"}
    for m in ex.get("markers", []):
        try:
            mi = min(range(len(ts)), key=lambda i: abs((ts[i] - datetime.fromisoformat(m["t"])).total_seconds()))
        except (ValueError, TypeError):
            continue
        color = marker_colors.get(m.get("label", ""), INK)
        value = float(m["value"])
        label = m.get("label", "?")
        if label in ("H", "L", "O"):
            ax.axhline(value, color=color, linestyle=":" if label in ("H", "L") else "--",
                       linewidth=1, alpha=0.75, zorder=2)
        ax.scatter([mi], [value], s=30, color=color, zorder=6, edgecolors=BG, linewidths=0.7)
        ax.annotate(label, (mi, value), textcoords="offset points", xytext=(4, 5),
                    color=color, fontsize=8, fontweight="bold")

    step = max(1, len(ts) // 8)
    xticks = list(range(0, len(ts), step))
    axv.set_xticks(xticks)
    axv.set_xticklabels([ts[i].strftime("%H:%M") for i in xticks], color=MUTED, fontsize=8)
    ax.grid(color=GRID, linewidth=0.5, alpha=0.55, axis="y")
    axv.grid(color=GRID, linewidth=0.5, alpha=0.55, axis="y")
    for sp in (ax, axv):
        sp.set_facecolor(PANEL)
        for side in sp.spines.values():
            side.set_color(GRID)
        sp.tick_params(colors=MUTED, labelsize=8)
    ax.set_ylabel("index level", color=MUTED, fontsize=9)
    axv.set_ylabel("ticks/min", color=MUTED, fontsize=8)
    body = stats.get("body_bp")
    rng = stats.get("range_bp")
    nxt = stats.get("next_ret_bp")
    sub = []
    if body is not None:
        sub.append(f"body {float(body):+.0f} bp")
    if rng is not None:
        sub.append(f"range {float(rng):.0f} bp")
    if stats.get("high_min") is not None and stats.get("low_min") is not None:
        sub.append(f"H@{int(stats['high_min'])}m L@{int(stats['low_min'])}m")
    if nxt is not None:
        sub.append(f"next {float(nxt):+.0f} bp")
    when = parse_time(ex["bar_t"])
    prefix = f"{when:%d %b %Y, %H:%M} UTC · " if when else ""
    ax.set_title(prefix + f"{ex['kind'].upper()} · {ex['label']}" + (f"  —  {' · '.join(sub)}" if sub else ""),
                 color=INK, fontsize=10.5, pad=8)
    fig.subplots_adjust(left=0.075, right=0.985, top=0.9, bottom=0.12)
    return png_b64(fig)


def render_hourly_context(ex, bars1h):
    """Second chart: the surrounding 1-hour candles for context (SNDK-style)."""
    bar_t = pd.Timestamp(ex["bar_t"])
    next_t = pd.Timestamp(ex["next_bar_t"]) if ex.get("next_bar_t") else None
    if next_t is None:
        next_t = bar_t + pd.Timedelta(hours=1 if ex["kind"] == "1h" else 4)
    look_before = 2 if ex["kind"] == "1h" else 1
    look_after = 2 if ex["kind"] == "1h" else 4
    start = bar_t - pd.Timedelta(hours=look_before)
    end = min(next_t + pd.Timedelta(hours=look_after), bar_t + pd.Timedelta(hours=12))
    sub = bars1h[(bars1h.index >= start) & (bars1h.index < end)]
    if sub.empty:
        return ""

    fig, (ax, axv) = plt.subplots(2, 1, figsize=(11, 3.1), sharex=True, facecolor=BG,
                                  gridspec_kw={"height_ratios": [5, 1], "hspace": 0.07})
    xs = np.arange(len(sub))
    span = float(sub.h.max() - sub.l.min()) or 1.0
    colors = []
    for i, (_, row) in enumerate(sub.iterrows()):
        o, h, l, c = float(row.o), float(row.h), float(row.l), float(row.c)
        col = POS if c >= o else NEG
        colors.append(col)
        ax.vlines(i, l, h, color=col, linewidth=1.1, zorder=3)
        ax.add_patch(Rectangle((i - 0.32, min(o, c)), 0.64, max(abs(c - o), span * 0.002),
                               facecolor=col, edgecolor=col, linewidth=0, zorder=4))
    axv.bar(xs, [float(x) for x in sub.ticks], width=0.7, color=colors, alpha=0.65, linewidth=0)

    idx = list(sub.index)
    xs_example = [i for i, t in enumerate(idx) if bar_t <= t < next_t]
    next_end = next_t + pd.Timedelta(hours=1 if ex["kind"] == "1h" else 4)
    xs_next = [i for i, t in enumerate(idx) if next_t <= t < next_end]
    if xs_example:
        ax.axvspan(min(xs_example) - 0.5, max(xs_example) + 0.5, color="#1b2733", zorder=0)
        axv.axvspan(min(xs_example) - 0.5, max(xs_example) + 0.5, color="#1b2733", zorder=0)
        label = "EXAMPLE 1h BAR" if ex["kind"] == "1h" else "EXAMPLE 4h BAR (4 hourly candles)"
        ax.text((min(xs_example) + max(xs_example)) / 2, 0.96, label,
                transform=ax.get_xaxis_transform(), color=MUTED, fontsize=7, ha="center", va="top")
    if xs_next:
        ax.axvspan(min(xs_next) - 0.5, max(xs_next) + 0.5, color="#2a2116", zorder=0)
        axv.axvspan(min(xs_next) - 0.5, max(xs_next) + 0.5, color="#2a2116", zorder=0)
        ax.axvline(min(xs_next) - 0.5, color="#d29922", linestyle="--", linewidth=1)
        ax.text((min(xs_next) + max(xs_next)) / 2, 0.96, "NEXT BAR",
                transform=ax.get_xaxis_transform(), color="#d29922", fontsize=7, ha="center", va="top")

    for m in ex.get("markers", []):
        label = m.get("label")
        if label not in ("H", "L", "O") or m.get("value") is None:
            continue
        color = {"H": POS, "L": NEG, "O": "#d29922"}[label]
        ax.axhline(float(m["value"]), color=color, linestyle=":" if label in ("H", "L") else "--",
                   linewidth=0.9, alpha=0.7, zorder=2)

    step = max(1, len(sub) // 8)
    xticks = list(range(0, len(sub), step))
    axv.set_xticks(xticks)
    axv.set_xticklabels([idx[i].strftime("%d %b %H:%M") for i in xticks], color=MUTED, fontsize=8)
    for sp in (ax, axv):
        sp.set_facecolor(PANEL)
        sp.grid(color=GRID, linewidth=0.5, alpha=0.55, axis="y")
        sp.tick_params(colors=MUTED, labelsize=8)
        for side in sp.spines.values():
            side.set_color(GRID)
    ax.set_ylabel("index level", color=MUTED, fontsize=9)
    axv.set_ylabel("ticks/min", color=MUTED, fontsize=8)
    ax.set_title("Hourly candles for context · " + fmt_span(ex["bar_t"], ex.get("next_bar_t")),
                 color=INK, fontsize=10, pad=8)
    fig.subplots_adjust(left=0.075, right=0.985, top=0.9, bottom=0.14)
    return png_b64(fig)


def render_table(table):
    cols = table.get("columns", [])
    rows = table.get("rows", [])
    if not cols or not rows:
        return ""
    head = "".join(f"<th>{esc(c)}</th>" for c in cols)
    body = "".join("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in row) + "</tr>" for row in rows)
    return f'<div class="table-wrap"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


def md_to_html(text):
    """Minimal markdown: headings, bullets, bold, tables, paragraphs."""
    out, lines = [], text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line:
            i += 1
            continue
        if line.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|$", lines[i + 1].strip()):
            header = [c.strip() for c in line.strip("|").split("|")]
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            out.append("<div class='table-wrap'><table><thead><tr>" +
                       "".join(f"<th>{esc(c)}</th>" for c in header) + "</tr></thead><tbody>" +
                       "".join("<tr>" + "".join(f"<td>{esc(c)}</td>" for c in r) + "</tr>" for r in rows) +
                       "</tbody></table></div>")
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            level = len(m.group(1)) + 1
            out.append(f"<h{level}>{esc(m.group(2))}</h{level}>")
            i += 1
            continue
        if line.lstrip().startswith(("- ", "* ")):
            items = []
            while i < len(lines) and lines[i].lstrip().startswith(("- ", "* ")):
                items.append(lines[i].lstrip()[2:])
                i += 1
            out.append("<ul>" + "".join(f"<li>{esc(x)}</li>" for x in items) + "</ul>")
            continue
        m = re.match(r"^(\d+)\.\s+(.*)$", line)
        if m:
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s+", lines[i]):
                items.append(re.sub(r"^\d+\.\s+", "", lines[i]))
                i += 1
            out.append("<ol>" + "".join(f"<li>{esc(x)}</li>" for x in items) + "</ol>")
            continue
        para = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,4}\s|[-*]\s|\d+\.\s|\|)", lines[i]):
            para.append(lines[i].strip())
            i += 1
        text = " ".join(para)
        # Escape paragraphs like headings/table cells/list items. Escape before
        # inserting markup so only our own <strong> tag stays raw; ** survive esc().
        text = esc(text)
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        out.append(f"<p>{text}</p>")
    return "\n".join(out)


def kpi(label, value, sub=""):
    return (f'<div class="kpi"><div class="kpi-label">{esc(label)}</div>'
            f'<div class="kpi-value">{esc(value)}</div>'
            f'<div class="kpi-sub">{esc(sub)}</div></div>')


def findings_block(items):
    return '<ul class="findings">' + "".join(f"<li>{esc(x)}</li>" for x in items) + "</ul>" if items else ""


def main():
    manifest = json.loads((OUT / "data" / "manifest.json").read_text())
    a1 = json.loads((OUT / "analysis_1h.json").read_text())
    a4 = json.loads((OUT / "analysis_4h.json").read_text())
    ex = json.loads((OUT / "examples.json").read_text())
    validation = (OUT / "validation.md").read_text()

    def load_optional(name, default):
        path = OUT / name
        return json.loads(path.read_text()) if path.exists() else default

    plain1 = load_optional("plain_1h.json", {})
    plain4 = load_optional("plain_4h.json", {})
    plain_notes = load_optional("plain_notes.json", {})
    minute = pd.read_parquet(OUT / "data" / "minute_1m.parquet", columns=["o", "ticks"])
    minute_lookup = {t: (float(o), float(tk)) for t, o, tk in
                     zip(minute.index, minute["o"], minute["ticks"])}
    bars1h = pd.read_parquet(OUT / "data" / "bars_1h.parquet")

    css = f"""
    :root{{--bg:{BG};--panel:{PANEL};--ink:{INK};--muted:{MUTED};--accent:{ACCENT};--grid:{GRID};--pos:{POS};}}
    *{{box-sizing:border-box}}
    body{{margin:0;background:var(--bg);color:var(--ink);font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}}
    header{{padding:26px 34px 20px;border-bottom:1px solid var(--grid);background:linear-gradient(180deg,#111820,{BG})}}
    h1{{margin:0 0 6px;font-size:25px;letter-spacing:-.4px}}
    h2{{font-size:19px;margin:34px 0 10px;padding-bottom:8px;border-bottom:1px solid var(--grid)}}
    h3{{font-size:15px;margin:22px 0 8px;color:var(--accent)}}
    h4{{font-size:13px;margin:14px 0 6px}}
    p{{margin:7px 0;color:var(--ink)}}
    .sub{{color:var(--muted);max-width:1000px}}
    .meta{{color:var(--muted);font-size:12px;margin-top:10px}}
    nav{{position:sticky;top:0;z-index:5;background:rgba(13,17,23,.96);border-bottom:1px solid var(--grid);padding:9px 34px}}
    nav a{{color:var(--muted);text-decoration:none;margin-right:18px;font-size:12px}}
    nav a:hover{{color:var(--accent)}}
    main{{padding:8px 34px 60px;max-width:1400px;margin:0 auto}}
    .kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}}
    .kpi{{background:var(--panel);border:1px solid var(--grid);border-radius:7px;padding:12px 14px}}
    .kpi-label{{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px}}
    .kpi-value{{font-size:21px;font-weight:650;margin:3px 0;color:var(--accent)}}
    .kpi-sub{{color:var(--muted);font-size:11px}}
    .card{{background:var(--panel);border:1px solid var(--grid);border-radius:8px;padding:14px 16px;margin:14px 0}}
    .insight{{background:#111c27;border-left:3px solid var(--accent);padding:10px 13px;border-radius:0 6px 6px 0;color:#cfe3f7;margin:9px 0}}
    .plain{{background:#12211b;border-left:3px solid var(--pos);color:#d6f0dc;font-size:13.5px}}
    .tech{{margin:8px 0 12px;border:1px solid var(--grid);border-radius:6px;background:#111820}}
    .tech summary{{cursor:pointer;color:var(--muted);font-size:11px;padding:7px 11px}}
    .tech>div{{padding:0 12px 10px;color:var(--muted);font-size:12px}}
    .findings{{background:var(--panel);border:1px solid var(--grid);border-radius:8px;padding:12px 16px 12px 32px}}
    .findings li{{margin:5px 0;color:#cbd5e1}}
    .table-wrap{{overflow-x:auto;max-height:330px;margin:10px 0;border:1px solid var(--grid);border-radius:6px}}
    table{{border-collapse:collapse;width:100%;font-size:12px}}
    th,td{{padding:6px 9px;text-align:right;border-bottom:1px solid var(--grid);white-space:nowrap}}
    th{{color:var(--muted);font-weight:600;background:#111820;position:sticky;top:0}}
    th:first-child,td:first-child{{text-align:left}}
    tbody tr:hover{{background:#1b2430}}
    .fig{{margin:8px 0 2px;min-width:0}}
    .fig img{{width:100%;max-width:1100px;display:block;border:1px solid var(--grid);border-radius:6px;background:var(--panel)}}
    .cap{{color:var(--muted);font-size:11px;margin:4px 0 0}}
    .chart-row{{display:flex;gap:12px;align-items:flex-start}}
    .chart-row>.fig{{flex:1 1 0}}
    @media(max-width:760px){{.chart-row{{flex-direction:column}}}}
    .example-title{{font-weight:650;color:var(--ink)}}
    .tag{{display:inline-block;background:#1f2b39;color:var(--accent);border:1px solid var(--grid);border-radius:20px;padding:1px 8px;font-size:10px;margin-left:8px}}
    .md h3{{color:var(--ink)}} .md h4{{color:var(--accent)}}
    code{{overflow-wrap:anywhere;word-break:break-word;font-size:.92em}}
    footer{{color:var(--muted);font-size:11px;padding:20px 34px 40px;border-top:1px solid var(--grid)}}
    """

    parts = [f"<!doctype html><html lang='en'><head><meta charset='utf-8'>",
             "<meta name='viewport' content='width=device-width,initial-scale=1'>",
             "<title>Nasdaq 1h / 4h Candle EDA — Mar–Sep 2026</title>",
             f"<style>{css}</style></head><body>",
             "<header><h1>Nasdaq 1h / 4h Candle EDA</h1>",
             "<div class='sub'>Open, close, high, low and next-bar behaviour of Nasdaq-100 hourly and 4-hourly candles, "
             "with visual examples built from the underlying 1-minute series. Dukascopy cash-index CFD used as an NQ proxy.</div>",
             f"<div class='meta'>Window {esc(manifest['window'][0][:10])} → {esc(manifest['window'][1][:10])} · "
             f"{manifest['sessions']} sessions · {manifest['bars_1h']} 1h bars · {manifest['bars_4h']} 4h bars · "
             f"UTC · generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}</div></header>",
             "<nav><a href='#overview'>Overview</a><a href='#1h'>1-hour candles</a><a href='#4h'>4-hour candles</a>"
             "<a href='#examples'>Visual examples</a><a href='#validation'>Data validation</a><a href='#method'>Method & caveats</a></nav>",
             "<main><h2 id='overview'>Overview</h2>"]

    parts.append("<div class='kpis'>" +
                 kpi("1h bars", manifest["bars_1h"], "60-minute OHLC") +
                 kpi("4h bars", manifest["bars_4h"], "240-minute OHLC") +
                 kpi("Sessions", manifest["sessions"], "04:00 UTC day") +
                 kpi("1m source bars", f"{manifest['minute_bars']:,}", "Dukascopy cache") +
                 kpi("Examples", len(ex["examples"]), "chart walkthroughs") + "</div>")

    parts.append("<h3>Headline findings — in plain English</h3>")
    for label, obj, plain in (("1-hour", a1, plain1), ("4-hour", a4, plain4)):
        bullets = plain.get("key_findings") or obj.get("key_findings", [])
        parts.append("<div class='card'><h3>" + label + "</h3>" + findings_block(bullets))
        if plain.get("key_findings"):
            parts.append("<details class='tech'><summary>Show the technical version</summary><div>" +
                         findings_block(obj.get("key_findings", [])) + "</div></details>")
        parts.append("</div>")
    parts.append("<div class='card'><h3>How to read these numbers (probability-first)</h3><ul class='findings'>"
                 "<li>Every conditional result is a probability estimated from a finite sample, not a rule. "
                 "Each table reports its <strong>base rate</strong> and <strong>n</strong> so you can judge the lift against chance.</li>"
                 "<li>A 53% hit rate is only interesting relative to the ~50% base rate — and only if the sample is large enough "
                 "that the confidence interval excludes it. Small per-bucket counts are flagged, not hidden.</li>"
                 "<li>Effect size in basis points matters more than a p-value: a statistically significant 2 bp burst may still be "
                 "untradeable once spread and costs are paid. Significance and usefulness are different questions.</li>"
                 "<li>A real <em>volatility</em> effect does not imply a <em>directional</em> effect. Near-zero correlation between "
                 "the opening burst and the rest of the bar means the faster move is unpredictable in sign.</li>"
                 f"<li>The 4h sample ({manifest['bars_4h']} bars) is much smaller than the 1h sample "
                 f"({manifest['bars_1h']} bars), so its sub-group numbers are less certain.</li>"
                 "</ul></div>")

    for key, anchor, obj, plain in (("1h", "1h", a1, plain1), ("4h", "4h", a4, plain4)):
        parts.append(f"<h2 id='{anchor}'>{key.upper()} candles</h2>")
        for sec in obj.get("sections", []):
            sid = sec.get("id", "")
            parts.append(f"<div class='card'><h3>{esc(sec.get('title', sid))}</h3>")
            plain_text = (plain.get("sections", {}) or {}).get(sid)
            if plain_text:
                parts.append(f"<div class='insight plain'>{esc(plain_text)}</div>")
                parts.append("<details class='tech'><summary>Show the technical detail</summary><div>" +
                             esc(sec.get("insight", "")) + "</div></details>")
            else:
                parts.append(f"<div class='insight'>{esc(sec.get('insight',''))}</div>")
            parts.append(render_table(sec.get("table", {})))
            if sec.get("chart", {}).get("series"):
                parts.append(f"<div class='fig'><img alt='{esc(sec['chart'].get('title',''))}' "
                             f"src='data:image/png;base64,{render_chart(sec['chart'])}'>"
                             f"<div class='cap'>{esc(sec['chart'].get('title',''))}</div></div>")
            parts.append("</div>")

    parts.append("<h2 id='examples'>Visual examples</h2>")
    parts.append("<p class='sub'>Each example has two charts side by side: the <strong>1-minute detail</strong> and the "
                 "<strong>1-hour candles around it</strong> so you can see the bigger picture. Green = that candle closed up, "
                 "red = down; the thin line is its high and low. The lower strip counts ticks per minute (our volume proxy). "
                 "The dark shaded area is the example bar; the dashed yellow line is where the next bar starts. "
                 "H = high, L = low, O = open, C = close, marked on the minute where they actually happened.</p>")
    for e in ex.get("examples", []):
        parts.append("<div class='card'>")
        parts.append(f"<div class='example-title'>{esc(e['id'])} · {esc(e['label'])}"
                     f"<span class='tag'>{esc(e['kind'])}</span><span class='tag'>{esc(e['phenomenon'])}</span></div>")
        parts.append(f"<div class='meta'>Bar: {esc(fmt_span(e['bar_t'], e.get('next_bar_t')))}</div>")
        plain_ex = (plain_notes.get("examples", {}) or {}).get(e["id"])
        if plain_ex:
            parts.append(f"<div class='insight plain'>{esc(plain_ex)}</div>")
            parts.append("<details class='tech'><summary>Show the numbers behind it</summary><div>" +
                         esc(e.get("notes", "")) + "</div></details>")
        else:
            parts.append(f"<div class='insight'>{esc(e.get('notes',''))}</div>")
        stats = e.get("stats", {})
        if stats:
            cols = list(stats.keys())
            parts.append(render_table({"columns": cols, "rows": [[stats[c] for c in cols]]}))
        parts.append("<div class='chart-row'>")
        parts.append(f"<div class='fig'><img alt='{esc(e['label'])} — 1-minute detail' "
                     f"src='data:image/png;base64,{render_example(e, minute_lookup)}'>"
                     "<div class='cap'>1-minute candles: the example bar and the following bar.</div></div>")
        hourly = render_hourly_context(e, bars1h)
        if hourly:
            parts.append(f"<div class='fig'><img alt='{esc(e['label'])} — hourly context' "
                         f"src='data:image/png;base64,{hourly}'>"
                         "<div class='cap'>1-hour candles: before, during and after the example.</div></div>")
        parts.append("</div></div>")

    parts.append("<h2 id='validation'>Data validation</h2><div class='card'>")
    if plain_notes.get("validation"):
        parts.append("<div class='insight plain'>" + esc(plain_notes["validation"]) + "</div>")
    parts.append("<details class='tech'><summary>Show the full audit</summary><div class='md'>" +
                 md_to_html(validation) + "</div></details></div>")
    if plain_notes.get("must_remember"):
        parts.append("<div class='card'><h3>Things to keep in mind</h3>" +
                     findings_block(plain_notes["must_remember"]) + "</div>")
    glossary = (plain1.get("glossary", []) or []) + (plain4.get("glossary", []) or [])
    if glossary:
        seen, unique = set(), []
        for item in glossary:
            term = item.get("term", "")
            if term and term.lower() not in seen:
                seen.add(term.lower())
                unique.append(item)
        rows = [[i["term"], i["meaning"]] for i in unique]
        parts.append("<div class='card'><h3>Words & measures, in plain English</h3>" +
                     render_table({"columns": ["Term", "What it means"], "rows": rows}) + "</div>")
    parts.append("<h2 id='method'>Method & caveats</h2><div class='card'>")
    parts.append("<ul class='findings'>"
                 "<li>Instrument: Dukascopy <code>usatechidxusd</code>, a Nasdaq-100 <strong>cash index CFD</strong> used here as an NQ futures proxy. "
                 "It is not the CME futures contract; it tracks the same index with a shifting basis and no exchange volume.</li>"
                 "<li>Time is UTC. A session runs 04:00 UTC to 03:59 UTC the next day (Globex-style); 4h bars align to 00/04/08/12/16/20 UTC. "
                 "The US cash open (13:30 UTC in EDT months) falls inside the 12:00 UTC 4h bar.</li>"
                 "<li>All <code>next_*</code> fields are the following bar of the same timeframe within the same session; "
                 "<code>has_next = 0</code> marks the boundary rows where they are null, so next-bar statistics exclude them.</li>"
                 "<li>The Dukascopy feed has a daily maintenance gap around 21:00 UTC. Raw minute-0 statistics are inflated by "
                 "the gap, so where the research separates <em>raw</em> from <em>contiguous</em> 1-minute returns, prefer the contiguous numbers.</li>"
                 "<li>Statistics are descriptive, not predictive. Correlations and conditional means on a 6.5-month sample are regime-dependent; "
                 "no causal claim is made and nothing here is trading advice.</li>"
                 "<li>Charts are generated from the JSON research outputs by <code>scripts/market/build_nasdaq_hourly_eda_report.py</code> "
                 "and embedded as base64 PNGs, so this HTML works offline.</li>"
                 "</ul></div></main>")
    parts.append("<footer>Rebuild: <code>.venv/bin/python scripts/market/prepare_nasdaq_bar_data.py</code> → research lanes → "
                 "<code>.venv/bin/python scripts/market/build_nasdaq_hourly_eda_report.py</code> → "
                 "<code>.venv/bin/python scripts/market/reports_index.py</code></footer>")
    parts.append("</body></html>")

    target = OUT / "index.html"
    target.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {target} ({target.stat().st_size:,} bytes)")
    for name in ("analysis_1h.json", "analysis_4h.json", "examples.json", "validation.md"):
        p = OUT / name
        print(f"  {name}: {'OK' if p.exists() else 'MISSING'}")


if __name__ == "__main__":
    main()
