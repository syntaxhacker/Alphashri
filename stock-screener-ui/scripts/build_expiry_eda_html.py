#!/usr/bin/env python3
"""Generate a self-contained HTML EDA report for Nifty weekly expiry 2026-10-06.

Reads experiments/data/expiry_snapshots/2026-10-06/ and writes
reports/EXPIRY_2026-10-06_EDA.html with inline SVG charts (no external deps).
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

IST = ZoneInfo("Asia/Kolkata")
SNAP = REPO_ROOT / "experiments" / "data" / "expiry_snapshots" / "2026-10-06"


def load_bundle():
    import pandas as pd

    b = pd.read_pickle(SNAP / "candles_5s.pkl")
    day_start = datetime(2026, 10, 6, tzinfo=IST).timestamp()
    out = {}
    for k, df in b.items():
        if len(df) == 0:
            continue
        d = df[df["ts"] >= day_start].copy()
        d["dt"] = pd.to_datetime(d["ts"], unit="s", utc=True).dt.tz_convert(IST)
        out[k] = d
    return out


def svg_line(series_list, w=860, h=240, title="", bands=(), notes=(), fmt="{:.0f}"):
    """series_list: [(label, [(x_label, value)], color)]. x positions evenly spaced."""
    import html as H

    pad_l, pad_r, pad_t, pad_b = 56, 12, 14, 26
    iw, ih = w - pad_l - pad_r, h - pad_t - pad_b
    allv = [v for _, s, _ in series_list for _, v in s]
    lo, hi = min(allv), max(allv)
    if hi == lo:
        hi = lo + 1
    pad = (hi - lo) * 0.08
    lo, hi = lo - pad, hi + pad
    n = max(len(s) for _, s, _ in series_list)

    def X(i):
        return pad_l + iw * i / max(n - 1, 1)

    def Y(v):
        return pad_t + ih * (1 - (v - lo) / (hi - lo))

    parts = [f'<svg viewBox="0 0 {w} {h}" class="chart" role="img">']
    for k in range(5):
        v = lo + (hi - lo) * k / 4
        y = Y(v)
        parts.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{w-pad_r}" y2="{y:.1f}" class="grid"/>')
        parts.append(f'<text x="{pad_l-6}" y="{y+4:.1f}" class="ylab" text-anchor="end">{H.escape(fmt.format(v))}</text>')
    for b0, b1, color, label in bands:
        x0 = pad_l + iw * b0
        x1 = pad_l + iw * b1
        parts.append(f'<rect x="{x0:.1f}" y="{pad_t}" width="{x1-x0:.1f}" height="{ih}" fill="{color}" opacity="0.12"/>')
        if label:
            parts.append(f'<text x="{(x0+x1)/2:.1f}" y="{pad_t+12}" class="bandlab" text-anchor="middle">{H.escape(label)}</text>')
    for label, s, color in series_list:
        pts = " ".join(f"{X(i):.1f},{Y(v):.1f}" for i, (_, v) in enumerate(s))
        parts.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2"/>')
    step = max(1, n // 8)
    for i in range(0, n, step):
        parts.append(f'<text x="{X(i):.1f}" y="{h-8}" class="xlab" text-anchor="middle">{H.escape(series_list[0][1][i][0])}</text>')
    for tx, ty_, color, label in notes:
        parts.append(f'<circle cx="{tx}" cy="{ty_}" r="4" fill="{color}"/>')
        parts.append(f'<text x="{tx+7}" y="{ty_+4}" class="notelab">{H.escape(label)}</text>')
    if title:
        parts.append(f'<text x="{pad_l}" y="12" class="ctitle">{H.escape(title)}</text>')
    parts.append("</svg>")
    return "\n".join(parts)


def svg_bars(groups, w=860, h=260, title="", fmt="{:,.1f}M"):
    """groups: [(label, [(series_label, value)], )]. Grouped bars."""
    import html as H

    colors = ["#38BDF8", "#F59E0B", "#16A34A", "#DC2626"]
    pad_l, pad_r, pad_t, pad_b = 70, 12, 26, 30
    iw, ih = w - pad_l - pad_r, h - pad_t - pad_b
    nseries = max(len(g[1]) for g in groups)
    hi = max(v for _, g in groups for _, v in g) or 1
    gw = iw / len(groups)
    bw = min(34, (gw - 14) / nseries)
    parts = [f'<svg viewBox="0 0 {w} {h}" class="chart" role="img">']
    if title:
        parts.append(f'<text x="{pad_l}" y="14" class="ctitle">{H.escape(title)}</text>')
    for k in range(5):
        v = hi * k / 4
        y = pad_t + ih * (1 - k / 4)
        parts.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{w-pad_r}" y2="{y:.1f}" class="grid"/>')
        parts.append(f'<text x="{pad_l-6}" y="{y+4:.1f}" class="ylab" text-anchor="end">{H.escape(fmt.format(v/1e6))}</text>')
    for gi, (label, vals) in enumerate(groups):
        cx = pad_l + gw * gi + gw / 2
        for si, (sl, v) in enumerate(vals):
            bh = ih * v / hi
            x = cx - (nseries * bw + (nseries - 1) * 4) / 2 + si * (bw + 4)
            parts.append(f'<rect x="{x:.1f}" y="{pad_t+ih-bh:.1f}" width="{bw}" height="{bh:.1f}" fill="{colors[si % 4]}" rx="2"><title>{H.escape(sl)}: {v:,.0f}</title></rect>')
        parts.append(f'<text x="{cx:.1f}" y="{h-10}" class="xlab" text-anchor="middle">{H.escape(label)}</text>')
    parts.append("</svg>")
    return "\n".join(parts)


def main():
    import pandas as pd

    bundle = load_bundle()
    spot = bundle["UNDERLYING"].set_index("dt").between_time("09:15", "15:30")
    m1 = spot["c"].resample("5min").agg(["first", "max", "min", "last"]).dropna()
    idx = [t.strftime("%H:%M") for t in m1.index.tz_convert(IST)]
    n = len(idx)
    fr = lambda t: next((i / max(n - 1, 1) for i, x in enumerate(idx) if x >= t), 1.0)
    spot_curve = [("NIFTY", list(zip(idx, m1["last"].tolist())), "#38BDF8")]
    vwap = float((spot["c"] * spot["v"]).sum() / max(spot["v"].sum(), 1))
    vwap_curve = ("VWAP", [(t, vwap) for t in idx], "#94A3B8")
    chart_spot = svg_line(
        [spot_curve[0], vwap_curve],
        title="NIFTY 2026-10-06 — 5-min close (VWAP gray)",
        bands=[(fr("15:15"), fr("15:30"), "#F59E0B", "feed freeze 15:15-15:29")],
    )

    # straddle curves: 22600 fixed + 22700 pinned, 15-min samples
    ce26 = bundle["NSE:NIFTY26O0622600CE"].set_index("dt").between_time("09:15", "15:30")
    pe26 = bundle["NSE:NIFTY26O0622600PE"].set_index("dt").between_time("09:15", "15:30")
    ce27 = bundle["NSE:NIFTY26O0622700CE"].set_index("dt").between_time("09:15", "15:30")
    pe27 = bundle["NSE:NIFTY26O0622700PE"].set_index("dt").between_time("09:15", "15:30")

    def sample(df, rule="15min"):
        g = df["c"].resample(rule).last().dropna()
        return [(t.strftime("%H:%M"), float(v)) for t, v in g.items()]

    s26 = sample(ce26)
    s26 = [(t, a + b) for (t, a), (_, b) in zip(s26, sample(pe26))]
    s27 = [(t, a + b) for (t, a), (_, b) in zip(sample(ce27), sample(pe27))]
    labels = [t for t, _ in s26]
    chart_decay = svg_line(
        [("22600 straddle (fixed @ open)", list(zip(labels, [v for _, v in s26])), "#38BDF8"),
         ("22700 straddle (pinned)", list(zip(labels, [v for _, v in s27])), "#F59E0B")],
        title="Straddle decay (₹, 15-min)", fmt="₹{:.0f}",
    )

    # OI walls first vs last snapshot
    files = sorted(SNAP.glob("chain_*.json"))
    first = json.loads(files[0].read_text())["response"]["data"]["optionsChain"]
    last = json.loads(files[-1].read_text())["response"]["data"]["optionsChain"]

    def walls(rows):
        ce, pe = {}, {}
        for r in rows:
            try:
                k = float(r.get("strike_price", 0))
            except (TypeError, ValueError):
                continue
            if k <= 0:
                continue
            (ce if r.get("option_type") == "CE" else pe)[k] = float(r.get("oi") or 0)
        return ce, pe

    ce0, pe0 = walls(first)
    ce1, pe1 = walls(last)
    topk = sorted(set(list(ce0) + list(pe0)), key=lambda k: ce0.get(k, 0) + pe0.get(k, 0), reverse=True)[:6]
    ce_groups = [(f"{k:.0f}", [("14:38", ce0.get(k, 0)), ("15:30", ce1.get(k, 0))]) for k in topk]
    pe_groups = [(f"{k:.0f}", [("14:38", pe0.get(k, 0)), ("15:30", pe1.get(k, 0))]) for k in topk]
    chart_ce = svg_bars(ce_groups, title="CE OI by strike: 14:38 vs 15:30 (shares)")
    chart_pe = svg_bars(pe_groups, title="PE OI by strike: 14:38 vs 15:30 (shares)")

    # per-contract day table
    rows = []
    for sym, df in sorted(bundle.items()):
        if sym == "UNDERLYING":
            continue
        d = df.set_index("dt").between_time("09:15", "15:30")
        if len(d) == 0:
            continue
        o, hi, lo, c = d["c"].iloc[0], d["h"].max(), d["l"].min(), d["c"].iloc[-1]
        import re

        m = re.search(r"(\d+)(CE|PE)$", sym)
        label = f"{m.group(1)} {m.group(2)}" if m else sym
        ret = (c - o) / o * 100 if o else 0
        mfe = (hi - o) / o * 100 if o else 0
        rows.append((label, o, hi, lo, c, ret, mfe))
    rows_html = "\n".join(
        f"<tr><td>{s}</td><td class='r'>{o:.2f}</td><td class='r'>{h:.2f}</td>"
        f"<td class='r'>{l:.2f}</td><td class='r'>{c:.2f}</td>"
        f"<td class='r {('pos' if r >= 0 else 'neg')}'>{r:+.1f}%</td>"
        f"<td class='r pos'>+{m:.1f}%</td></tr>"
        for s, o, h, l, c, r, m in rows
    )

    so, sh, sl, sc = (spot["c"].iloc[0], spot["h"].max(), spot["l"].min(), spot["c"].iloc[-1])
    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nifty Weekly Expiry EDA — 2026-10-06</title>
<style>
body{{background:#0B1220;color:#E2E8F0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:24px}}
.wrap{{max-width:960px;margin:0 auto}}
h1{{font-size:26px;margin:0 0 4px}}h2{{font-size:19px;margin:28px 0 10px;color:#7DD3FC}}
.sub{{color:#94A3B8;margin-bottom:18px}}
.card{{background:#111C33;border:1px solid #1E3A5F;border-radius:10px;padding:16px;margin:14px 0}}
.grid2{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}@media(max-width:700px){{.grid2{{grid-template-columns:1fr}}}}
.kv{{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed #1E3A5F;font-size:14px}}
.kv b{{font-variant-numeric:tabular-nums}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
th,td{{padding:5px 8px;border-bottom:1px solid #1E3A5F;text-align:left}}
th{{color:#94A3B8;font-weight:600}}td.r{{text-align:right;font-variant-numeric:tabular-nums}}
.pos{{color:#16A34A}}.neg{{color:#F87171}}
.chart{{width:100%;height:auto;background:#0B1220}}
.grid{{stroke:#1E3A5F;stroke-width:1}}.ylab,.xlab{{fill:#64748B;font-size:10px}}
.ctitle{{fill:#E2E8F0;font-size:12px;font-weight:600}}.bandlab{{fill:#F59E0B;font-size:10px}}.notelab{{fill:#94A3B8;font-size:10px}}
ol li,ul li{{margin:6px 0;font-size:14px;line-height:1.5}}
.badge{{display:inline-block;padding:2px 10px;border-radius:20px;font-size:12px;font-weight:700}}
.exp{{background:#3b1d1d;color:#F87171}}.cheap{{background:#0c2e1f;color:#16A34A}}
.foot{{color:#64748B;font-size:12px;margin-top:24px}}
</style></head><body><div class="wrap">
<h1>Nifty Weekly Expiry EDA <span class="badge exp">EXPENSIVE→TREND DAY</span></h1>
<div class="sub">Tue 2026-10-06 · NSE NIFTY weekly expiry · 5-sec candles + OI, 57 chain snapshots, 51,498 live ticks · settlement <b>22776.1</b></div>

<div class="card"><h2 style="margin-top:0">1 · Spot regime — slow grind-up</h2>
<div class="grid2">
<div>
<div class="kv"><span>Open / High / Low / Close</span><b>{so:.1f} / {sh:.1f} / {sl:.1f} / {sc:.1f}</b></div>
<div class="kv"><span>Day range</span><b>{(sh-sl)/so*100:.2f}%</b></div>
<div class="kv"><span>Day return</span><b class="pos">+{(sc-so)/so*100:.2f}%</b></div>
<div class="kv"><span>VWAP</span><b>{vwap:.1f}</b></div>
<div class="kv"><span>OR 09:15–09:45 break</span><b>Up 09:47, never retested</b></div>
</div>
<div>
<div class="kv"><span>Gap vs prior close</span><b class="pos">+0.21%</b></div>
<div class="kv"><span>Time above VWAP</span><b>62%</b></div>
<div class="kv"><span>15:15–15:29 prints</span><b>frozen 22717.7 (exchange-wide)</b></div>
<div class="kv"><span>15:29:10 settlement bar</span><b class="pos">+58 pts, 9M vol</b></div>
<div class="kv"><span>Classification</span><b>stair-step trend, zero panic</b></div>
</div></div>
{chart_spot}
</div>

<div class="card"><h2 style="margin-top:0">2 · Straddle decay — pinned 22700 bled −66.6%</h2>
{chart_decay}
<ul>
<li>22700 straddle 146.50 → 48.90 (−₹97.60). Morning bled fastest in ₹, last 85 min fastest in % (−33% of remainder).</li>
<li>Fixed-22600 straddle <b class="pos">gained +14%</b> — trend rescued it. Define the straddle by expected pin, not morning spot.</li>
<li>Wrong-side 150pt OTM (22450PE): halves by 11:30, −99.4% day. Right-side OTM (22750CE) survived to 15:00, expired ITM.</li>
<li>Far-OTM (&gt;250pts): dust by noon. Buying after that = donation.</li>
</ul></div>

<div class="card"><h2 style="margin-top:0">3 · OI walls — 22700 surrendered, 22800 held</h2>
{chart_ce}
{chart_pe}
<ul>
<li>22700 CE wall −60.6% (−20.3M, biggest dump); settlement 76 pts ITM. Writers lost the strike.</li>
<li>22800 CE −11.8% only; spot never breached it; premium → 0. The defended line.</li>
<li>~52M of 22700/22750 PE walls expired worthless. 22750PE OI <b>doubled</b> 15:20→15:30 while price → 0.05.</li>
<li>Max pain 22700 → 22750; settlement +26 above it (call skew, not a pin). PCR 1.456 → 1.30 → 1.46 snap-back.</li>
<li>Real expiry event: <b>15:20–15:29</b> — top-3 all-time 5-sec dumps + 22700CE −5.44M capitulation bar.</li>
</ul></div>

<div class="card"><h2 style="margin-top:0">4 · Per-contract day table (09:15 open → 15:30)</h2>
<table><tr><th>Contract</th><th style="text-align:right">Open</th><th style="text-align:right">High</th><th style="text-align:right">Low</th><th style="text-align:right">Close</th><th style="text-align:right">Day</th><th style="text-align:right">MFE</th></tr>
{rows_html}</table></div>

<div class="card"><h2 style="margin-top:0">5 · Closing microstructure (ticks 14:50–15:35)</h2>
<ul>
<li><b>15:20 strike-touch whipsaw:</b> both 22800 legs ±20–100% per tick for ~15 sec (PE 86.8→60.7→…→63.2).</li>
<li><b>15:29:10 pin slam:</b> 22800PE 35→24 (−45%) in one tick, then frozen 23.88–24.10. 244 of 732 ticks printed exactly 23.88.</li>
<li><b>Liquidity picked a side:</b> surviving PE spreads compressed 25→5 paise into the bell; OTM legs became 5-paise stubs (bid → 0, standard withdrawal).</li>
<li>Volume peaked 15:25–15:29 (35% of window on 22800PE). 15:30 bucket collapses — settlement, not auction.</li>
<li>Feed honesty: tick volume/OI fields are zeros (use candle v); tick rate fixed ~73/min; 15% of depth prints absurdly sized (unit artifact).</li>
</ul></div>

<div class="card"><h2 style="margin-top:0">6 · Playbook lessons</h2>
<ol>
<li>Trend-day expiry = long ITM calls from the morning dip; OTM lottery needs a midday exit (22800CE +202% at 12:44 → 0.05).</li>
<li>Never evaluate expiry strategy on closing marks — ~40% of the move was untradeable settlement print.</li>
<li>Short the side the market is leaving; right-side shorts carry pin risk to 15:25.</li>
<li>Exit shorts by 15:20 — after that, single-tick 40% prints + settlement lottery.</li>
<li>Size for the last 30 min, not the direction. The grind lulls, the print punishes.</li>
</ol></div>

<div class="foot">Sources: experiments/data/expiry_snapshots/2026-10-06/ (57 chain_*.json, 22 ticks_*.jsonl, candles_5s.pkl, spot_yf_1m.csv) · Nifty lot 75 · all times IST</div>
</div></body></html>"""

    out = REPO_ROOT / "reports" / "EXPIRY_2026-10-06_EDA.html"
    out.write_text(html)
    print(f"wrote {out} ({len(html)//1024} KB)")


if __name__ == "__main__":
    main()
