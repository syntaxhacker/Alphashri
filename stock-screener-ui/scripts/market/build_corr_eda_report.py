"""Build the correlation EDA report from the loop's fixed-schema result JSONs.

Inputs under /tmp/opencode/nasdaq_corr_loop/ (intraday primary) plus /tmp/opencode/corr_us.json
(daily context). Output: reports/nasdaq_corr_eda/index.html (self-contained, base64 charts).

NOTE: the hardcoded narrative conclusions (lines ~471-474, 492-494, 509-516, 584-585,
711-714) are pinned to the 2026-11-24 cached JSONs under /tmp/opencode/nasdaq_corr_loop.
Those caches are ephemeral; if the JSONs are regenerated the conclusions MUST be re-verified
against the new values (they are static strings, not computed from the JSON).
"""

import base64
import html
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HEADER_MAP = {}
SIMPLE_SECTIONS = {}
SIMPLE_SUMMARY = {}

ROOT = Path(__file__).resolve().parents[2]
LOOP = Path("/tmp/opencode/nasdaq_corr_loop")
OUT = ROOT / "reports" / "nasdaq_corr_eda"
BG, PANEL, INK, MUTED, ACCENT, GRID = "#0d1117", "#161b22", "#e6edf3", "#8b949e", "#58a6ff", "#30363d"
POS, NEG, GOLD = "#3fb950", "#f85149", "#d29922"


def esc(v):
    return html.escape(str(v), quote=True)


def parse_any(v):
    if not v:
        return "?"
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).strftime("%d %b %Y, %H:%M")
    except (ValueError, TypeError):
        return str(v)


def load(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def fig_b64(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=110, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def axes(ax, title, xlabel="", ylabel=""):
    ax.set_facecolor(PANEL)
    ax.set_title(title, color=INK, fontsize=11, pad=9)
    ax.set_xlabel(xlabel, color=MUTED, fontsize=9)
    ax.set_ylabel(ylabel, color=MUTED, fontsize=9)
    ax.tick_params(colors=MUTED, labelsize=8)
    for sp in ax.spines.values():
        sp.set_color(GRID)
    ax.grid(color=GRID, alpha=0.4, linewidth=0.6)
    ax.set_axisbelow(True)


def bar_chart(rows, value_key, title, ylabel, color=ACCENT):
    if not rows:
        return ""
    labels = [r.get("ticker") or r.get("name", "?") for r in rows]
    vals = [float(r.get(value_key) or 0) for r in rows]
    fig, ax = plt.subplots(figsize=(10, 3), facecolor=BG)
    bars = ax.bar(labels, vals, color=color, alpha=0.85)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v, f"{v:.2f}", ha="center", va="bottom",
                color=INK, fontsize=8)
    axes(ax, title, ylabel=ylabel)
    fig.tight_layout()
    return fig_b64(fig)


def scatter_chart(rows, title):
    rows = [r for r in rows if r.get("corr") is not None and r.get("stability") is not None]
    if not rows:
        return ""
    x = [float(r["corr"]) for r in rows]
    y = [float(r["stability"]) for r in rows]
    fig, ax = plt.subplots(figsize=(10, 3.2), facecolor=BG)
    ax.scatter(x, y, s=28, color=ACCENT, alpha=0.75, edgecolors=BG)
    for r in rows[:6]:
        ax.annotate(r.get("ticker", ""), (float(r["corr"]), float(r["stability"])),
                    textcoords="offset points", xytext=(4, 4), color=MUTED, fontsize=7)
    ax.axvline(0.7, color=POS, linestyle="--", linewidth=0.9, alpha=0.7)
    ax.axhline(0.8, color=GOLD, linestyle="--", linewidth=0.9, alpha=0.7)
    axes(ax, title, "correlation with index", "fraction of sessions with r > 0.5")
    fig.tight_layout()
    return fig_b64(fig)


def hbar(rows, label_key, value_key, title, xlabel, color=None, threshold=None, note=None):
    """Horizontal bar chart with value labels — readable stock names on the y-axis."""
    if not rows:
        return ""
    labels = [str(r.get(label_key, "?")) for r in rows]
    vals = [float(r.get(value_key) or 0) for r in rows]
    colors = [color or (POS if v >= 0 else NEG) for v in vals]
    fig, ax = plt.subplots(figsize=(10, max(2.0, 0.42 * len(rows) + 1.1)), facecolor=BG)
    bars = ax.barh(range(len(rows)), vals, color=colors, alpha=0.88, height=0.6)
    ax.set_yticks(range(len(rows)))
    ax.set_yticklabels(labels, color=INK, fontsize=9)
    ax.invert_yaxis()
    pad = max(vals + [0]) * 0.03 if vals else 0.01
    for b, v in zip(bars, vals):
        ax.text(v + (pad if v >= 0 else -pad), b.get_y() + b.get_height() / 2,
                f"{v:.3f}", va="center", ha="left" if v >= 0 else "right",
                color=INK, fontsize=8)
    if threshold is not None:
        ax.axvline(threshold, color=GOLD, linestyle="--", linewidth=1, alpha=0.85)
    ax.axvline(0, color=MUTED, linewidth=0.8, alpha=0.7)
    axes(ax, title, xlabel)
    ax.tick_params(axis="y", colors=INK)
    fig.tight_layout()
    return fig_b64(fig)


def grouped_bars(groups, series_specs, title, xlabel, ylabel=""):
    """groups = [label,...]; series_specs = [(name, [values], color), ...]."""
    if not groups or not series_specs:
        return ""
    fig, ax = plt.subplots(figsize=(10.5, max(2.4, 0.38 * len(groups) + 1.2)), facecolor=BG)
    n = len(series_specs)
    h = 0.78 / n
    y = np.arange(len(groups))
    for i, (name, vals, color) in enumerate(series_specs):
        pos = y + (i - (n - 1) / 2) * h
        ax.barh(pos, vals, height=h, label=name, color=color, alpha=0.88)
        for yi, v in zip(pos, vals):
            ax.text(v + 0.008, yi, f"{v:.2f}", va="center", fontsize=7, color=MUTED)
    ax.set_yticks(y)
    ax.set_yticklabels(groups, color=INK, fontsize=9)
    ax.invert_yaxis()
    axes(ax, title, xlabel, ylabel)
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=INK, fontsize=8, loc="lower right")
    fig.tight_layout()
    return fig_b64(fig)


def sector_bars(sector_rank, title):
    if not sector_rank:
        return ""
    rows = [{"s": s.get("sector", "?"), "v": float(s.get("mean_corr") or 0)} for s in sector_rank]
    return hbar(rows, "s", "v", title, "mean 5m correlation", color=ACCENT)


def quadrant(rows, title):
    pts = [r for r in rows if r.get("corr") is not None and r.get("stability") is not None]
    if not pts:
        return ""
    x = [float(r["corr"]) for r in pts]
    y = [float(r["stability"]) for r in pts]
    good = [bool(r.get("passes_gate")) for r in pts]
    fig, ax = plt.subplots(figsize=(10, 4.2), facecolor=BG)
    ax.axvspan(0.7, max(x + [0.8]) + 0.05, color=POS, alpha=0.06)
    ax.axhspan(0.8, 1.02, color=ACCENT, alpha=0.05)
    cols = [POS if g else GOLD for g in good]
    ax.scatter(x, y, s=70, c=cols, alpha=0.9, edgecolors=BG, linewidths=0.8, zorder=4)
    for r in pts[:8]:
        ax.annotate(r.get("ticker", ""), (float(r["corr"]), float(r["stability"])),
                    textcoords="offset points", xytext=(5, 5), color=INK, fontsize=8)
    ax.axvline(0.7, color=POS, linestyle="--", linewidth=1, alpha=0.7)
    ax.axhline(0.8, color=ACCENT, linestyle="--", linewidth=1, alpha=0.7)
    ax.text(0.72, 0.99, "STRONG + STABLE", color=POS, fontsize=8, va="top")
    axes(ax, title, "5m correlation with index", "stability (share of sessions r>0.5)")
    fig.tight_layout()
    return fig_b64(fig)


def two_metric_scatter(rows, xk, yk, title, xlabel, ylabel, target=None):
    pts = [r for r in rows if r.get(xk) is not None and r.get(yk) is not None]
    if not pts:
        return ""
    x = [float(r[xk]) for r in pts]
    y = [float(r[yk]) for r in pts]
    fig, ax = plt.subplots(figsize=(9.5, 3.6), facecolor=BG)
    ax.scatter(x, y, s=55, color=ACCENT, alpha=0.8, edgecolors=BG, zorder=3)
    lo, hi = min(x + [0]), max(x + [0.7])
    ax.plot([lo, hi], [lo, hi], color=MUTED, linestyle=":", linewidth=1, zorder=1)
    for r in pts[:8]:
        ax.annotate(r.get("ticker", ""), (float(r[xk]), float(r[yk])),
                    textcoords="offset points", xytext=(4, 4), color=INK, fontsize=8)
    if target is not None:
        ax.axhline(target, color=GOLD, linestyle="--", linewidth=1, alpha=0.8)
    axes(ax, title, xlabel, ylabel)
    fig.tight_layout()
    return fig_b64(fig)


def trend_lines(pairs, title):
    pts = [p for p in pairs if p.get("r_start") is not None and p.get("r_current") is not None]
    if not pts:
        return ""
    fig, ax = plt.subplots(figsize=(10, 3.6), facecolor=BG)
    xs = [0, 1, 2]
    for p in pts[:8]:
        ys = [float(p.get("r_start") or 0), float(p.get("r_prior") or 0), float(p.get("r_current") or 0)]
        ax.plot(xs, ys, marker="o", linewidth=1.6, label=p.get("ticker", "?"), alpha=0.9)
    ax.set_xticks(xs)
    ax.set_xticklabels(["first 10d", "previous 10d", "last 10d"], color=MUTED, fontsize=9)
    axes(ax, title, "", "5m correlation")
    ax.legend(facecolor=PANEL, edgecolor=GRID, labelcolor=INK, fontsize=8, ncol=2)
    fig.tight_layout()
    return fig_b64(fig)


def bullet_list(items):
    if not items:
        return ""
    return "<ul class='findings'>" + "".join(f"<li>{esc(x)}</li>" for x in items) + "</ul>"


def table(columns, rows):
    if not rows:
        return ""
    head = "".join(f"<th>{esc(HEADER_MAP.get(c, c))}</th>" for c in columns)
    body = "".join("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in r) + "</tr>" for r in rows)
    return f'<div class="table-wrap"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


def top_rows(data):
    out = []
    for i, r in enumerate(data.get("top", []), 1):
        out.append([i, r.get("ticker", "?"), r.get("name", ""), r.get("sector", ""),
                    f"{r.get('corr', 0):.3f}", f"{r.get('corr_30d', 0):.3f}",
                    f"{r.get('session_median', 0):.3f}", f"{r.get('stability', 0):.2f}",
                    f"{r.get('beta', 0):.2f}", f"{r.get('placebo_corr', 0):.3f}",
                    r.get("n", "?"), "YES" if r.get("passes_gate") else "NO"])
    return out


def main():
    global HEADER_MAP, SIMPLE_SECTIONS, SIMPLE_SUMMARY
    OUT.mkdir(parents=True, exist_ok=True)
    SIMPLE_SECTIONS = load(LOOP / "simple_sections.json") or {}
    SIMPLE_SUMMARY = load(LOOP / "simple_summary.json") or {}
    HEADER_MAP = dict(SIMPLE_SECTIONS.get("headers", {}))
    lanes = [
        ("us_intraday.json", "Nasdaq Composite", "^IXIC", "US stocks"),
        ("nifty_intraday.json", "Nifty 50", "^NSEI", "Nifty 50 stocks"),
        ("sensex_intraday.json", "BSE Sensex", "^BSESN", "Sensex 30 stocks"),
        ("banknifty_intraday.json", "Bank Nifty", "^NSEBANK", "Bank Nifty stocks"),
    ]
    results = [(f, title, idx, universe, load(LOOP / f)) for f, title, idx, universe in lanes]
    daily_us = load(Path("/tmp/opencode/corr_us.json"))
    verifies = [(m, load(LOOP / f"verify_{m}.json")) for m in ("us", "nifty", "sensex", "banknifty")]
    extras = {
        "lead_lag": load(LOOP / "lead_lag.json"),
        "time_of_day": load(LOOP / "time_of_day.json"),
        "one_minute": load(LOOP / "one_minute.json"),
    }

    css = f"""
    :root{{--bg:{BG};--panel:{PANEL};--ink:{INK};--muted:{MUTED};--accent:{ACCENT};--grid:{GRID};--pos:{POS};--neg:{NEG};--gold:{GOLD}}}
    *{{box-sizing:border-box}}
    body{{margin:0;background:{BG};color:var(--ink);font:13px/1.42 system-ui,-apple-system,"Segoe UI",sans-serif}}
    header{{padding:14px 26px 10px;border-bottom:1px solid var(--grid)}}
    h1{{margin:0 0 3px;font-size:22px;letter-spacing:-.4px;font-weight:700}}
    h2{{font-size:16px;margin:14px 0 6px;padding:0 0 5px;border-bottom:1px solid var(--grid);
        display:flex;align-items:center;gap:8px}}
    h2:before{{content:"";width:3px;height:15px;border-radius:2px;background:var(--accent)}}
    h3{{font-size:13px;color:var(--accent);margin:10px 0 4px;font-weight:650}}
    p{{margin:4px 0}}
    .sub{{color:#b6c2d1;font-size:12.5px}}
    .meta{{color:var(--muted);font-size:10.5px;margin-top:3px}}
    nav{{position:sticky;top:0;background:rgba(13,17,23,.96);border-bottom:1px solid var(--grid);
         padding:5px 26px;z-index:5;display:flex;gap:4px;flex-wrap:wrap}}
    nav a{{color:var(--muted);text-decoration:none;font-size:11px;padding:2px 7px;border-radius:12px}}
    nav a:hover{{color:var(--accent);background:#16202c}}
    main{{padding:4px 26px 24px;max-width:1360px;margin:0 auto}}
    .card{{background:var(--panel);border:1px solid var(--grid);border-radius:7px;padding:9px 12px;margin:7px 0}}
    .plain{{background:#12211b;border-left:3px solid var(--pos);padding:7px 10px;border-radius:0 5px 5px 0;
            color:#d6f0dc;margin:6px 0;font-size:12.5px}}
    .kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;margin:7px 0}}
    .kpi{{background:var(--panel);border:1px solid var(--grid);border-top:2px solid var(--accent);
          border-radius:6px;padding:7px 10px}}
    .kpi-label{{color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.4px}}
    .kpi-value{{font-size:18px;font-weight:700;color:var(--accent);margin:1px 0}}
    .kpi-sub{{color:#9fb0c2;font-size:10px}}
    .findings{{margin:5px 0;padding-left:20px}} .findings li{{margin:2px 0;color:#cbd5e1}}
    .tech{{margin:4px 0;border:1px solid var(--grid);border-radius:5px;background:#111820}}
    .tech summary{{cursor:pointer;color:var(--muted);font-size:11px;padding:4px 9px}}
    .tech>div{{padding:0 10px 7px;color:var(--muted);font-size:11.5px}}
    .table-wrap{{overflow-x:auto;border:1px solid var(--grid);border-radius:5px;margin:6px 0}}
    table{{border-collapse:collapse;width:100%;font-size:11.5px;font-variant-numeric:tabular-nums}}
    th,td{{padding:3px 7px;text-align:right;border-bottom:1px solid var(--grid);white-space:nowrap}}
    th{{color:var(--muted);background:#111820;font-size:10px;text-transform:uppercase;letter-spacing:.3px}}
    th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){{text-align:left}}
    tbody tr:hover{{background:rgba(88,166,255,.05)}}
    .fig{{margin:6px 0 2px;border:1px solid var(--grid);border-radius:6px;background:rgba(10,14,20,.5);padding:4px}}
    .fig img{{width:100%;display:block;border-radius:4px}}
    .fig-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:7px}}
    .cap{{color:var(--muted);font-size:10px;padding:1px 3px}} code{{overflow-wrap:anywhere;color:#9fd0ff}}
    footer{{color:var(--muted);font-size:10px;border-top:1px solid var(--grid);padding:10px 26px 20px}}
    @media(max-width:760px){{header{{padding:12px 16px 8px}} nav{{padding:5px 16px}} main{{padding:4px 14px 20px}}
      h1{{font-size:19px}} .fig-grid{{grid-template-columns:1fr}}}}
    """

    parts = ["<!doctype html><html><head><meta charset='utf-8'>",
             "<meta name='viewport' content='width=device-width,initial-scale=1'>",
             "<title>Intraday correlation EDA — Nasdaq, Nifty, Sensex, Bank Nifty</title>",
             f"<style>{css}</style></head><body>",
             "<header><h1>Intraday correlation EDA</h1>",
             "<div class='sub'>Which stocks move most closely with their index on a 5-minute basis? "
             "Four markets, with placebo controls, stability checks and honest caveats.</div>",
             f"<div class='cap'>Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M UTC}</div></header>",
             "<nav><a href='#summary'>Summary</a><a href='#us'>Nasdaq</a><a href='#nifty'>Nifty</a>"
             "<a href='#sensex'>Sensex</a><a href='#banknifty'>Bank Nifty</a>"
             "<a href='#leadlag'>Lead/lag</a><a href='#timeofday'>Time of day</a>"
             "<a href='#onemin'>1m check</a><a href='#weighted'>Weight-adjusted</a>"
             "<a href='#method'>Method</a></nav>",
             "<main>"]
    titles = SIMPLE_SECTIONS.get("titles", {})
    notes = SIMPLE_SECTIONS.get("notes", {})
    parts.append(f"<h2 id='summary'>{esc(titles.get('summary', 'Summary'))}</h2>")
    if SIMPLE_SUMMARY:
        parts.append("<div class='card'><div class='insight plain'>" +
                     esc(SIMPLE_SUMMARY.get("hero", "")) + "</div>")
        if SIMPLE_SUMMARY.get("top_line"):
            parts.append("<div class='card' style='border-left:3px solid #58a6ff'>" +
                         esc(SIMPLE_SUMMARY["top_line"]) + "</div>")
        if SIMPLE_SUMMARY.get("weighted_note"):
            parts.append("<div class='plain'>" + esc(SIMPLE_SUMMARY["weighted_note"]) + "</div>")
        if SIMPLE_SUMMARY.get("faq"):
            parts.append("<h3>Questions you might have</h3>")
            for item in SIMPLE_SUMMARY["faq"]:
                parts.append("<details class='tech'><summary>" + esc(item.get("q", "")) + "</summary><div>" +
                             esc(item.get("a", "")) + "</div></details>")
        if SIMPLE_SUMMARY.get("what_to_remember"):
            parts.append("<h3>Things to keep in mind</h3>" +
                         bullet_list(SIMPLE_SUMMARY["what_to_remember"]))
        parts.append("</div>")
    parts.append("<div class='plain'>" + esc(notes.get("summary", "")) + "</div>")
    if notes:
        parts.append("<div class='card'><h3>Plain English guide to every section</h3><ul class='findings'>")
        for key, label in (("market", "Each market"), ("leadlag", "Lead or lag"), ("timeofday", "Time of day"),
                           ("onemin", "1-minute check"), ("updown", "Up vs down minutes"), ("decay", "Decay"),
                           ("clusters", "Redundancy"), ("quiet", "Quiet minutes"), ("etf", "ETF check"),
                           ("overnight", "Nasdaq to India"), ("bootstrap", "Reliability"),
                           ("attribution", "Sector or stock"), ("weighted", "Weight-adjusted"), ("method", "Method")):
            if notes.get(key):
                parts.append(f"<li><b>{esc(titles.get(key,label))}:</b> {esc(notes[key])}</li>")
        parts.append("</ul></div>")

    available = [d for _, _, _, _, d in results if d]
    parts.append("<div class='kpis'>")
    for _, title, idx, _, d in results:
        if not d:
            continue
        best = (d.get("top") or [{}])[0]
        parts.append(f"<div class='kpi'><div class='kpi-label'>{esc(title)}</div>"
                     f"<div class='kpi-value'>{esc(best.get('ticker','?'))}</div>"
                     f"<div class='kpi-sub'>r = {float(best.get('corr') or 0):.3f} · n = {best.get('n','?')}</div></div>")
    parts.append("</div>")
    if available:
        rows = []
        for f, title, idx, _, d in results:
            if not d:
                continue
            for i, r in enumerate(d.get("top", []), 1):
                rows.append([title, i, r.get("ticker", "?"), f"{float(r.get('corr') or 0):.3f}",
                             f"{float(r.get('stability') or 0):.2f}",
                             "PASS" if r.get("passes_gate") else "CHECK"])
        parts.append(table(["Index", "#", "Stock", "5m r", "Stability", "Gate"], rows))
        mkt = [title for fname, title, idx, universe, d in results if d]
        tops = [d.get("top", []) for _, _, _, _, d in results if d]
        overview = grouped_bars(mkt, [
            ("#1", [float((t[0].get("corr") if len(t) > 0 else 0) or 0) for t in tops], ACCENT),
            ("#2", [float((t[1].get("corr") if len(t) > 1 else 0) or 0) for t in tops], POS),
            ("#3", [float((t[2].get("corr") if len(t) > 2 else 0) or 0) for t in tops], GOLD),
        ], "Top 3 correlation by market — at a glance", "5m Pearson r")
        if overview:
            parts.append(f"<div class='fig'><img alt='overview' src='data:image/png;base64,{overview}'>"
                         "<div class='cap'>Each market's three closest index trackers. Longer bar = tighter co-movement.</div></div>")

    vrows = []
    for market, v in verifies:
        if not v:
            continue
        diffs = [abs(float(r.get("diff") or 0)) for r in v.get("recomputed", [])]
        verdict = v.get("verdict", "?")
        note = ("Primary method flawed; corrected within-session lane used instead"
                if verdict == "DISPUTE" else "Fresh independent recompute matches primary")
        vrows.append([market.upper(), verdict, f"{max(diffs):.3f}" if diffs else "?", note])
    if vrows:
        parts.append("<div class='card'><h3>Adversarial verification — fresh re-implementation</h3>" +
                     table(["Market", "Verdict", "Max |diff|", "Notes"], vrows) + "</div>")

    anchors = {"us_intraday.json": "us", "nifty_intraday.json": "nifty",
               "sensex_intraday.json": "sensex", "banknifty_intraday.json": "banknifty"}
    for fname, title, idx, universe, d in results:
        parts.append(f"<h2 id='{anchors[fname]}'>{esc(title)} ({esc(idx)})</h2>")
        if not d:
            parts.append("<div class='card'>Result not available yet.</div>")
            continue
        w = d.get("window", {})
        start = parse_any(w.get("start"))
        end = parse_any(w.get("end"))
        parts.append(f"<div class='card'><div class='cap'>{esc(d.get('method',''))} "
                     f"· {esc(start)} → {esc(end)} "
                     f"· index 5m bars: {w.get('bars_index','?')} "
                     f"· universe {d.get('universe_size','?')} → usable {d.get('usable','?')}</div>")
        parts.append("<div class='plain'>Read the table as a ranking of <b>co-movement</b>, not as a prediction. "
                     "'Stability' is the share of individual sessions where the stock still moved closely with the index. "
                     "The placebo column is the correlation after deliberately mis-aligning the dates — it should be near zero.</div>")
        cols = ["#", "Ticker", "Name", "Sector", "5m r", "Last 30d r", "Session median r",
                "Stability", "Beta", "Placebo r", "n", "Gate"]
        parts.append("<h3>Top 3</h3>" + table(cols, top_rows(d)))
        bot = []
        for i, r in enumerate(d.get("bottom", []), 1):
            bot.append([i, r.get("ticker", "?"), r.get("name", ""), r.get("sector", ""),
                        f"{float(r.get('corr') or 0):.3f}", f"{r.get('n','?')}"])
        parts.append("<h3>Least correlated (bottom 3)</h3>" +
                     table(["#", "Ticker", "Name", "Sector", "5m r", "n"], bot))
        allrows = (d.get("top", []) or []) + (d.get("bottom", []) or [])
        hb = hbar(allrows, "ticker", "corr", f"Who moves with {idx}?", "5m Pearson r")
        qd = quadrant(allrows, f"Strength vs consistency — {idx}")
        if hb or qd:
            parts.append("<div class='fig-grid'>")
            if hb:
                parts.append(f"<div class='fig'><img alt='correlation bars' src='data:image/png;base64,{hb}'>"
                             "<div class='cap'>Green = positive co-movement, red = opposite direction.</div></div>")
            if qd:
                parts.append(f"<div class='fig'><img alt='quadrant' src='data:image/png;base64,{qd}'>"
                             "<div class='cap'>Top-right = strong and consistent. Dashed lines: r=0.7, stability=0.8.</div></div>")
            parts.append("</div>")
        groups = [r.get("ticker", "?") for r in allrows]
        gb = grouped_bars(groups, [
            ("full 60d", [float(r.get("corr") or 0) for r in allrows], ACCENT),
            ("last 30d", [float(r.get("corr_30d") or 0) for r in allrows], GOLD),
            ("session median", [float(r.get("session_median") or 0) for r in allrows], POS),
        ], f"Does the ranking hold up? — {idx}", "correlation r")
        if gb:
            parts.append(f"<div class='fig'><img alt='window comparison' src='data:image/png;base64,{gb}'>"
                         "<div class='cap'>Three independent views of the same relationship. "
                         "Bars that shrink a lot are less reliable.</div></div>")
        sec = d.get("sector_rank", [])
        if sec:
            sb = sector_bars(sec[:10], f"Sector co-movement — {idx}")
            parts.append("<h3>By sector</h3>")
            if sb:
                parts.append(f"<div class='fig'><img alt='sectors' src='data:image/png;base64,{sb}'>"
                             "<div class='cap'>Average 5m correlation of each sector's stocks with the index.</div></div>")
            parts.append(table(["Sector", "Mean 5m r", "Stocks"],
                [[s.get("sector", "?"), f"{float(s.get('mean_corr') or 0):.3f}", s.get("n", "?")] for s in sec]))
        if d.get("notes"):
            parts.append("<div class='cap'>" + "<br>".join(esc(n) for n in d["notes"]) + "</div>")
        if d.get("robustness", {}).get("notes"):
            parts.append("<div class='cap'>Robustness: " + esc(d["robustness"]["notes"]) + "</div>")
        parts.append("</div>")

    ll = extras.get("lead_lag")
    if ll:
        rows = []
        for m in ll.get("markets", []):
            for p in m.get("pairs", []):
                rows.append([m.get("index", "?"), p.get("ticker", "?"),
                             f"{float(p.get('r_lag0') or 0):.3f}", p.get("best_lag", "?"),
                             f"{float(p.get('r_best') or 0):.3f}", p.get("verdict", "?")])
        parts.append("<h2 id='leadlag'>Lead or lag?</h2><div class='card'><div class='plain'>All 12 pairs peak at "
                     "lag zero: these stocks move <b>with</b> the index, not before or after it. "
                     "There is no usable timing edge at 5-minute resolution.</div>" +
                     table(["Index", "Stock", "r at lag 0", "Best lag", "r at best", "Verdict"], rows) + "</div>")

    tod = extras.get("time_of_day")
    if tod:
        rows = []
        for m in tod.get("markets", []):
            for p in m.get("pairs", []):
                rows.append([m.get("index", "?"), p.get("ticker", "?"),
                             f"{float(p.get('r_open') or 0):.3f}", f"{float(p.get('r_mid') or 0):.3f}",
                             f"{float(p.get('r_close') or 0):.3f}", p.get("best", "?")])
        labels = [f"{m.get('index','?')} · {p.get('ticker','?')}"
                  for m in tod.get("markets", []) for p in m.get("pairs", [])]
        allp = [p for m in tod.get("markets", []) for p in m.get("pairs", [])]
        tch = grouped_bars(labels, [
            ("open", [float(p.get("r_open") or 0) for p in allp], ACCENT),
            ("mid", [float(p.get("r_mid") or 0) for p in allp], POS),
            ("close", [float(p.get("r_close") or 0) for p in allp], NEG),
        ], "Correlation through the session", "5m correlation r")
        parts.append("<h2 id='timeofday'>When in the session?</h2><div class='card'><div class='plain'>Co-movement is "
                     "strongest in the <b>middle</b> of the trading day (11/12 pairs) and weakest into the close. "
                     "The open is dominated by auction noise; the close by position-unwinding.</div>" +
                     (f"<div class='fig'><img alt='time of day' src='data:image/png;base64,{tch}'>"
                      "<div class='cap'>Each stock's correlation in the open, middle and close of its session.</div></div>" if tch else "") +
                     table(["Index", "Stock", "Open r", "Mid r", "Close r", "Strongest"], rows) + "</div>")

    om = extras.get("one_minute")
    if om:
        rows = []
        for p in om.get("pairs", []):
            rows.append([p.get("index", "?"), p.get("ticker", "?"),
                         f"{float(p.get('r_1m') or 0):.3f}", f"{float(p.get('r_5m') or 0):.3f}",
                         f"{float(p.get('delta') or 0):.3f}",
                         "YES" if p.get("granularity_sensitive") else "no"])
        och = two_metric_scatter(om.get("pairs", []), "r_5m", "r_1m",
                                 "1-minute vs 5-minute correlation", "5m r", "1m r")
        parts.append("<h2 id='onemin'>Does 1 minute change the answer?</h2><div class='card'><div class='plain'>"
                     "Yes — measured correlation is <b>lower at 1 minute for every pair</b> (the Epps effect: "
                     "stale quotes and bid-ask bounce add noise). Resampling 1m back to 5m reproduces the 5m "
                     "number exactly, so this is a sampling effect, not a different market.</div>" +
                     (f"<div class='fig'><img alt='granularity' src='data:image/png;base64,{och}'>"
                      "<div class='cap'>Every point below the dotted line loses correlation at 1m resolution.</div></div>"
                      if och else "") +
                     table(["Index", "Stock", "1m r", "5m r", "Delta", "Sensitive"], rows) + "</div>")

    ud = load(LOOP / "up_down.json")
    if ud:
        rows = []
        for m in ud.get("markets", []):
            for p in m.get("pairs", []):
                rows.append([m.get("index", "?"), p.get("ticker", "?"),
                             f"{float(p.get('r_up') or 0):.3f}", f"{float(p.get('r_down') or 0):.3f}",
                             f"{float(p.get('asym_up') or 0):+.3f}",
                             f"{float(p.get('asym_vol') or 0):+.3f}", p.get("verdict", "?")])
        upd_pairs = [p for m in ud.get("markets", []) for p in m.get("pairs", [])]
        upd_labels = [f"{p.get('ticker','?')}" for p in upd_pairs]
        uch = grouped_bars(upd_labels, [
            ("calm minutes", [float(p.get("r_lowvol") or 0) for p in upd_pairs], ACCENT),
            ("turbulent minutes", [float(p.get("r_highvol") or 0) for p in upd_pairs], POS),
        ], "Correlation in calm vs turbulent minutes", "5m correlation r")
        parts.append("<h2>Up vs down minutes</h2><div class='card'><div class='plain'>A stock that tracks the "
                     "index only on up days is a different risk from one that tracks it on the way down. "
                     "'SYMMETRIC' means no reliable difference after bootstrapping. The biggest split is "
                     "<b>calm vs turbulent</b> minutes, not up vs down.</div>" +
                     (f"<div class='fig'><img alt='volatility asymmetry' src='data:image/png;base64,{uch}'>"
                      "<div class='cap'>Correlation jumps sharply when the index is moving fast.</div></div>" if uch else "") +
                     table(["Index", "Stock", "Up r", "Down r", "Up−Down", "HighVol−LowVol", "Verdict"], rows) + "</div>")

    rt = load(LOOP / "rolling_trend.json")
    if rt:
        rows = []
        for m in rt.get("markets", []):
            for p in m.get("pairs", []):
                rows.append([m.get("index", "?"), p.get("ticker", "?"),
                             f"{float(p.get('r_start') or 0):.3f}", f"{float(p.get('r_current') or 0):.3f}",
                             f"{float(p.get('delta_recent') or 0):+.3f}",
                             f"{float(p.get('p_value') or 0):.3f}", p.get("verdict", "?")])
        trch = trend_lines([p for m in rt.get("markets", []) for p in m.get("pairs", [])],
                           "Correlation over the 60-session window")
        parts.append("<h2>Is the correlation decaying?</h2><div class='card'><div class='plain'>"
                     "Comparison of the latest 10 sessions with the 10 before, plus a trend test. "
                     "Most high-correlation names remain 'STABLE' over this short window.</div>" +
                     (f"<div class='fig'><img alt='trend' src='data:image/png;base64,{trch}'>"
                      "<div class='cap'>First vs previous vs latest 10 sessions of correlation.</div></div>" if trch else "") +
                     table(["Index", "Stock", "First 10d r", "Last 10d r", "Recent change", "Trend p", "Verdict"], rows) + "</div>")

    cl = load(LOOP / "clusters.json")
    if cl:
        rows = []
        for m in cl.get("markets", []):
            for p in m.get("top_stock_pairs", [])[:4]:
                rows.append([m.get("index", "?"), f"{p.get('a')} + {p.get('b')}",
                             f"{float(p.get('r') or 0):.3f}", p.get("n", "?")])
        parts.append("<h2>Redundant baskets</h2><div class='card'><div class='plain'>"
                     "The tightest stock-to-stock pairs. Very high values mean the names are almost "
                     "interchangeable for intraday co-movement — holding several adds little diversification.</div>" +
                     table(["Index", "Pair", "Pair r", "n"], rows) + "</div>")

    qr = load(LOOP / "quiet_rank.json")
    if qr:
        rows = []
        for m in qr.get("markets", []):
            for p in m.get("quiet_top3", [])[:3]:
                rows.append([m.get("index", "?"), p.get("ticker", "?"),
                             f"{float(p.get('r_quiet') or 0):.3f}", p.get("n_quiet", "?"),
                             "YES" if p.get("quiet_robust") else "no"])
        qp = [p for m in qr.get("markets", []) for p in m.get("primary_top", [])]
        qch = two_metric_scatter(qp, "r_all", "r_quiet",
                                 "Full-sample vs quiet-minute correlation", "full 60d r", "quiet-half r", target=0.35)
        parts.append("<h2>Quiet-minute ranking</h2><div class='card'><div class='plain'>"
                     "Who still tracks the index when nothing dramatic is happening? These are the leaders "
                     "when we keep only the calmest half of 5-minute moves — every point falls far below the "
                     "dotted 0.35 robustness line.</div>" +
                     (f"<div class='fig'><img alt='quiet' src='data:image/png;base64,{qch}'>"
                      "<div class='cap'>Distance below the dotted line shows how much of the correlation is big-move driven.</div></div>"
                      if qch else "") +
                     table(["Index", "Stock", "Quiet r", "n", "Robust"], rows) + "</div>")

    etf = load(LOOP / "etf_benchmark.json")
    if etf:
        rows = []
        for p in etf.get("pairs", []):
            rows.append([p.get("benchmark_index", "?"), p.get("benchmark_etf", "?"),
                         f"{float(p.get('index_etf_corr') or 0):.3f}", p.get("verdict", "?"),
                         ", ".join(p.get("top3_etf", []) or [])])
        parts.append("<h2>Tradeable ETF benchmarks</h2><div class='card'><div class='plain'>"
                     "Would using an ETF instead of the official index change the answer? "
                     "'SAFE' means the ETF tracks the index closely and the top-3 set is unchanged.</div>" +
                     table(["Index", "ETF", "Index↔ETF r", "Verdict", "Top 3 with ETF"], rows) + "</div>")

    ov = load(LOOP / "overnight_link.json")
    if ov:
        rows = []
        for p in ov.get("pairs", []):
            rows.append([p.get("ticker", "?"), f"{float(p.get('r_gap_vs_us_prev') or 0):.3f}",
                         f"{float(p.get('r_intraday_vs_us_prev') or 0):.3f}",
                         f"{float(p.get('placebo_gap') or 0):.3f}", p.get("n", "?"), p.get("verdict", "?")])
        parts.append("<h2>Does Nasdaq carry into India next morning?</h2><div class='card'>"
                     "<div class='plain'>The US session finishes after India closes. This checks whether "
                     "last night's Nasdaq move shows up in Indian opening gaps or the following session.</div>" +
                     table(["Stock", "Gap vs US prev", "Intraday vs US prev", "Placebo", "n", "Verdict"], rows) + "</div>")

    bs = load(LOOP / "bootstrap_rank.json")
    if bs:
        rows = []
        for m in bs.get("markets", []):
            for p in m.get("primary_top3", []):
                rows.append([m.get("index", "?"), p.get("ticker", "?"),
                             f"{float(p.get('p_top3') or 0):.2f}", p.get("verdict", "?")])
        bpts = [{"t": f"{m.get('index','?')} · {p.get('ticker','?')}", "p": float(p.get("p_top3") or 0)}
                for m in bs.get("markets", []) for p in m.get("primary_top3", [])]
        bch = hbar(bpts, "t", "p", "Bootstrap probability of being in the top 3", "p(top 3)",
                   threshold=0.6, color=POS)
        parts.append("<h2>How reliable is 'top 3'?</h2><div class='card'><div class='plain'>"
                     "500 bootstrap resamples of whole sessions. p(top-3) is how often that stock lands in the "
                     "top three when we resample the days — 1.00 means it always did, 0.50 means half the time. "
                     "Dotted line = 0.60 robustness threshold.</div>" +
                     (f"<div class='fig'><img alt='bootstrap' src='data:image/png;base64,{bch}'>"
                      "<div class='cap'>Bars below the dotted line are fragile rank claims.</div></div>" if bch else "") +
                     table(["Index", "Stock", "p(top 3)", "Verdict"], rows) + "</div>")

    att = load(LOOP / "attribution.json")
    if att:
        rows = []
        for m in att.get("markets", []):
            for p in m.get("top3", [])[:6]:
                rows.append([m.get("index", "?"), p.get("ticker", "?"), p.get("sector", "?"),
                             f"{float(p.get('r') or 0):.3f}", f"{float(p.get('sector_mean_r') or 0):.3f}",
                             f"{float(p.get('r_residual') or 0):+.3f}", p.get("verdict", "?")])
        apts = [p for m in att.get("markets", []) for p in m.get("top3", [])][:12]
        ach = grouped_bars([f"{p.get('ticker','?')}" for p in apts], [
            ("stock r", [float(p.get("r") or 0) for p in apts], ACCENT),
            ("sector mean r", [float(p.get("sector_mean_r") or 0) for p in apts], GOLD),
        ], "How much is just the sector?", "5m correlation r")
        parts.append("<h2>Sector or stock?</h2><div class='card'><div class='plain'>"
                     "'Residual' is the part of a stock's correlation not explained by its sector's average. "
                     "A large positive residual means the name co-moves with the index more than its peers do.</div>" +
                     (f"<div class='fig'><img alt='attribution' src='data:image/png;base64,{ach}'>"
                      "<div class='cap'>Blue bar = the stock; gold = its sector average. The gap is the name-specific part.</div></div>"
                      if ach else "") +
                     table(["Index", "Stock", "Sector", "r", "Sector mean r", "Residual", "Verdict"], rows) + "</div>")

    wi = load(LOOP / "weighted_india.json")
    wu = load(LOOP / "weighted_us.json")
    wparts = [x for x in (wi, wu) if x]
    if wparts:
        parts.append("<h2 id='weighted'>Weight-adjusted — who actually moves the index?</h2>")
        parts.append("<div class='card'><div class='plain'>Raw correlation ignores size. A small stock can track the "
                     "index tightly yet barely influence it. Here each stock's correlation is multiplied by its "
                     "<b>index weight</b> and its <b>beta</b>. The key number is the <b>contribution share</b> "
                     "(weight × beta): the portion of the index's movement that comes from that stock.</div>")
        def weight_blocks(wd):
            return wd.get("markets") or [wd]

        contrib = []
        for wd in wparts:
            for blk in weight_blocks(wd):
                mname = blk.get("market", "?")
                for r in blk.get("top_contribution", [])[:8]:
                    contrib.append({"t": f"{mname}: {r.get('ticker','?')}", "v": float(r.get("contribution_pct") or 0)})
        cch = hbar(contrib, "t", "v", "Contribution share (weight × beta)", "% of index variance", color=POS)
        if cch:
            parts.append(f"<div class='fig'><img alt='contribution' src='data:image/png;base64,{cch}'>"
                         "<div class='cap'>A big weight AND tight co-movement are both needed to score high.</div></div>")
        rows = []
        for wd in wparts:
            for blk in weight_blocks(wd):
                for r in blk.get("top_contribution", [])[:8]:
                    rows.append([blk.get("market", "?"), r.get("ticker", "?"),
                                 f"{float(r.get('weight_pct') or 0):.2f}", f"{float(r.get('corr') or 0):.3f}",
                                 f"{float(r.get('beta') or 0):.2f}", f"{float(r.get('contribution_pct') or 0):.2f}",
                                 f"{float(r.get('weighted_corr') or 0):.3f}", r.get("n", "?")])
        parts.append(table(["Market", "Stock", "Weight %", "5m r", "Beta", "Contribution %", "Weight×r", "n"], rows))
        for wd in wparts:
            for f in wd.get("focus", []):
                if f.get("conclusion"):
                    parts.append("<div class='plain'>" + esc(f["conclusion"]) + "</div>")
        parts.append("<div class='cap'>Efficiency (correlation per 1% weight) is reported in the underlying JSON "
                     "but is mechanically dominated by tiny weights — treat it as a curiosity, not a ranking.</div>")
        parts.append("</div>")

    parts.append("<h2 id='method'>Method & caveats</h2><div class='card'>")
    if SIMPLE_SECTIONS.get("method_simple"):
        parts.append("<div class='plain'>" + "<br>".join(
            "• " + esc(b) for b in SIMPLE_SECTIONS["method_simple"]) + "</div>")
    parts.append("<ul>"
                 "<li><b>5-minute bars, last ~60 days</b> from Yahoo Finance via yfinance. 1-minute data is only "
                 "available in 8-day chunks, so 5-minute bars were chosen for a usable sample.</li>"
                 "<li>Returns are computed <b>within each trading day only</b> — the first bar of each day is dropped, "
                 "so overnight gaps never enter the correlation.</li>"
                 "<li>Indian index and stock closes are on the same session and same timezone; US names are aligned to "
                 "US market time. The two markets are never mixed.</li>"
                 "<li><b>Placebo test:</b> the index series is shifted by 1–5 sessions. If the 'correlation' stays high "
                 "after shifting, the result is an artifact and is flagged.</li>"
                 "<li>A high 5-minute correlation usually means the stock is a <b>large index weight</b> with similar "
                 "sector exposure. It does not mean the stock leads the index, nor that it is a good trade.</li>"
                 "<li>Sample is one 60-day regime. Correlations can decay; treat the last-30-day and session-stability "
                 "columns as the reality check on the full-window rank.</li>"
                 "<li><b>Adversarial verification:</b> three markets were independently CONFIRMED. The first Sensex lane was "
                 "DISPUTED because it joined price levels before taking pct_change, stretching returns across missing bars. "
                 "The corrected within-session top 3 (HDFCBANK 0.579, ICICIBANK 0.577, LT 0.529) were reproduced by two "
                 "independent recomputations; RELIANCE's correct 0.512 ranks #5.</li>"
                 "<li>The <b>redundancy/cluster</b> section uses a stricter all-stocks-common-date join and unadjusted prices, "
                 "so its raw r levels are NOT comparable to the primary per-pair numbers — read it for relative grouping only.</li>"
                 "<li>The #1/#2 order in the US (NVDA vs TSM, gap 0.003) and the #3 slot in Nifty swap under 15-minute "
                 "resampling. The correlation <em>levels</em> are solid; the exact ordering of close ranks is not.</li>"
                 "</ul>")
    if daily_us:
        parts.append("<h3>Daily-window context (not the primary answer)</h3>")
        parts.append(table(["#", "Ticker", "Daily r", "Beta", "1y r", "n"],
            [[i, r.get("ticker"), f"{float(r.get('corr') or 0):.3f}", f"{float(r.get('beta') or 0):.2f}",
              f"{float(r.get('corr_1y') or 0):.3f}", r.get("n")]
             for i, r in enumerate(daily_us.get("top", []), 1)]))
    parts.append("</div></main>")
    parts.append("<footer>Rebuild: research lanes write fixed-schema JSONs under <code>/tmp/opencode/nasdaq_corr_loop/</code>, "
                 "then <code>.venv/bin/python scripts/market/build_corr_eda_report.py</code>.</footer>")
    parts.append("</body></html>")

    glossary = SIMPLE_SECTIONS.get("glossary", [])
    if glossary:
        parts.append("<h2>Words in plain English</h2><div class='card'>" +
                     table(["Word", "What it means"],
                           [[g.get("term", "?"), g.get("meaning", "")] for g in glossary]) + "</div>")

    html_text = "\n".join(parts)
    old_titles = {
        "Lead or lag?": "leadlag", "When in the session?": "timeofday",
        "Does 1 minute change the answer?": "onemin", "Up vs down minutes": "updown",
        "Is the correlation decaying?": "decay", "Redundant baskets": "clusters",
        "Quiet-minute ranking": "quiet", "Tradeable ETF benchmarks": "etf",
        "Does Nasdaq carry into India next morning?": "overnight",
        "How reliable is 'top 3'?": "bootstrap", "Sector or stock?": "attribution",
        "Weight-adjusted — who actually moves the index?": "weighted",
        "Method & caveats": "method",
    }
    for old, key in old_titles.items():
        new = titles.get(key)
        if new:
            html_text = re.sub(r"(<h2[^>]*>)" + re.escape(old) + r"(</h2>)",
                               lambda m, n=esc(new): m.group(1) + n + m.group(2), html_text)
    parts = [html_text]

    target = OUT / "index.html"
    target.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {target} ({target.stat().st_size:,} bytes); lanes available: {sum(1 for d in available)}/4")


if __name__ == "__main__":
    main()
