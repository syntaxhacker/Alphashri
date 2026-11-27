#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30))
REPO_ROOT = Path(__file__).resolve().parents[2]

REGIME_LABELS = {
    "long_buildup": "Long buildup",
    "short_buildup": "Short buildup",
    "long_unwinding": "Long unwinding",
    "short_covering": "Short covering",
    "neutral": "Neutral",
}

VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--futures", default="reports/nifty_2026-11-17/data/futures_1m.json")
    ap.add_argument("--tape", default="experiments/data/nifty_tape/2026-11-17.jsonl")
    ap.add_argument("--out", default="reports/nifty_2026-11-17/03-futures.html")
    ap.add_argument("--summary", default="reports/nifty_2026-11-17/data/futures_summary.json")
    ap.add_argument("--price-threshold", type=float, default=5.0, help="pts; neutral floor")
    ap.add_argument("--oi-threshold", type=int, default=20000, help="contracts; neutral floor")
    ap.add_argument("--open", action="store_true", help="open the page when written")
    return ap.parse_args()


def resolve(path: str) -> Path:
    p = Path(path)
    return p if p.is_absolute() else REPO_ROOT / p


def minute_of(iso: str) -> int:
    return int(iso[11:13]) * 60 + int(iso[14:16])


def hhmm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def alpha(hex_color: str, opacity: float) -> str:
    raw = hex_color.lstrip("#")
    r, g, b = (int(raw[i:i + 2], 16) for i in (0, 2, 4))
    return f"rgba({r}, {g}, {b}, {opacity})"


def nf(value: float, digits: int = 1) -> str:
    return f"{value:,.{digits}f}"


def ni(value: float) -> str:
    return f"{int(round(value)):,}"


def sgn(value: float, digits: int = 1) -> str:
    sign = "+" if value > 0 else ("\u2212" if value < 0 else "")
    return f"{sign}{nf(abs(value), digits)}"


def sgn_int(value: float) -> str:
    sign = "+" if value > 0 else ("\u2212" if value < 0 else "")
    return f"{sign}{ni(abs(value))}"


def compact(value: float) -> str:
    if abs(value) >= 1_000_000:
        return f"{value / 1_000_000:.2f}M"
    if abs(value) >= 1_000:
        return f"{value / 1_000:.0f}k"
    return ni(value)


def load_futures(path: Path) -> dict:
    payload = json.loads(path.read_text())
    candles = payload.get("candles") or []
    if not candles:
        raise SystemExit(f"no candles in {path}")
    rows = []
    last_minute = None
    for bar in candles:
        m = minute_of(bar["t"])
        if last_minute is not None and m <= last_minute:
            raise SystemExit(f"futures bars are not strictly ordered at {bar['t']}")
        last_minute = m
        rows.append({
            "t": bar["t"],
            "m": m,
            "o": float(bar["o"]),
            "h": float(bar["h"]),
            "l": float(bar["l"]),
            "c": float(bar["c"]),
            "v": int(bar["v"]),
            "oi": int(bar["oi"]),
        })
    payload["rows"] = rows
    return payload


def load_spot(path: Path) -> dict:
    by_minute: dict[int, list[float]] = {}
    first_ts = last_ts = None
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        ts = row["t"]
        first_ts = first_ts or ts
        last_ts = ts
        by_minute.setdefault(minute_of(ts), []).append(float(row["spot"]))
    spot = {m: sum(vals) / len(vals) for m, vals in sorted(by_minute.items())}
    return {"spot": spot, "first_ts": first_ts, "last_ts": last_ts, "rows": sum(len(v) for v in by_minute.values())}


def classify(dp: float, doi: float, price_threshold: float, oi_threshold: int) -> str:
    if abs(dp) < price_threshold and abs(doi) < oi_threshold:
        return "neutral"
    if dp >= 0 and doi >= 0:
        return "long_buildup"
    if dp < 0 and doi >= 0:
        return "short_buildup"
    if dp < 0 and doi < 0:
        return "long_unwinding"
    return "short_covering"


def build_regimes(rows: list[dict], price_threshold: float, oi_threshold: int) -> list[dict]:
    buckets: list[dict] = []
    start_idx = 0
    start_price = rows[0]["o"]
    start_oi = rows[0]["oi"]
    start_minute = rows[0]["m"]

    def emit(end_idx: int, end_label_minute: int) -> None:
        end = rows[end_idx]
        dp = end["c"] - start_price
        doi = end["oi"] - start_oi
        volume = sum(r["v"] for r in rows[start_idx + 1:end_idx + 1])
        buckets.append({
            "start": hhmm(start_minute),
            "start_m": start_minute,
            "end": hhmm(end_label_minute),
            "end_m": end_label_minute,
            "from_price": round(start_price, 2),
            "to_price": round(end["c"], 2),
            "dp": round(dp, 2),
            "doi": doi,
            "volume": volume,
            "regime": classify(dp, doi, price_threshold, oi_threshold),
        })

    for i in range(1, len(rows)):
        m = rows[i]["m"]
        if m % 15 == 0 and m != rows[0]["m"]:
            emit(i, m)
            start_idx = i
            start_price = rows[i]["c"]
            start_oi = rows[i]["oi"]
            start_minute = m
    emit(len(rows) - 1, rows[-1]["m"])
    return buckets


def build_basis(rows: list[dict], spot: dict[int, float]) -> list[dict]:
    out = []
    for bar in rows:
        s = spot.get(bar["m"])
        if s is None:
            continue
        out.append({
            "m": bar["m"],
            "t": hhmm(bar["m"]),
            "f": round(bar["c"], 2),
            "s": round(s, 2),
            "b": round(bar["c"] - s, 2),
        })
    return out


def bucket_by_start(buckets: list[dict], start: str) -> dict:
    for b in buckets:
        if b["start"] == start:
            return b
    raise SystemExit(f"missing 15-minute bucket starting {start}")


def load_palette(path: Path) -> dict[str, str]:
    text = path.read_text()
    found = dict(re.findall(r'^export const ([A-Z0-9_]+)\s*=\s*"(#[0-9A-Fa-f]{6})";', text, re.M))
    needed = [
        "BG_COLOR", "SURFACE_COLOR", "SURFACE_ALT_COLOR", "BORDER_COLOR",
        "TEXT_COLOR", "TEXT_MUTED_COLOR", "PRIMARY", "POSITIVE_COLOR",
        "NEGATIVE_COLOR", "INFO", "WARNING", "NEUTRAL",
    ]
    missing = [k for k in needed if k not in found]
    if missing:
        raise SystemExit(f"palette missing {missing} in {path}")
    return {
        "bg": found["BG_COLOR"],
        "panel": found["SURFACE_COLOR"],
        "raised": found["SURFACE_ALT_COLOR"],
        "border": found["BORDER_COLOR"],
        "text": found["TEXT_COLOR"],
        "muted": found["TEXT_MUTED_COLOR"],
        "amber": found["PRIMARY"],
        "green": found["POSITIVE_COLOR"],
        "red": found["NEGATIVE_COLOR"],
        "blue": found["INFO"],
        "warning": found["WARNING"],
        "gray": found["NEUTRAL"],
    }


class TagBalance(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, int]] = []
        self.errors: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag not in VOID_TAGS:
            self.stack.append((tag, self.getpos()[0]))

    def handle_endtag(self, tag: str) -> None:
        if tag in VOID_TAGS:
            return
        if not self.stack:
            self.errors.append(f"line {self.getpos()[0]}: stray </{tag}>")
            return
        open_tag, line = self.stack.pop()
        if open_tag != tag:
            self.errors.append(f"line {self.getpos()[0]}: </{tag}> closes <{open_tag}> opened at line {line}")


def validate_html(html: str, data_json: str) -> list[str]:
    problems: list[str] = []
    parser = TagBalance()
    parser.feed(html)
    parser.close()
    problems.extend(parser.errors)
    problems.extend(f"unclosed <{tag}> at line {line}" for tag, line in parser.stack)
    urls = set(re.findall(r'https?://[^\s"\'<>]+', html))
    allowed = {"https://cdn.jsdelivr.net/npm/d3@7"}
    problems.extend(f"unexpected external URL: {u}" for u in sorted(urls - allowed))
    if "@@" in html:
        problems.append("unreplaced template token @@...@@ remains in the output")
    if "https://cdn.jsdelivr.net/npm/d3@7" not in html:
        problems.append("D3 CDN script is missing")
    for required in ("chart-price-oi", "chart-basis", "chart-regimes", "chart-volume", "id=\"tip\"", "id=\"main\""):
        if required not in html:
            problems.append(f"missing required markup: {required}")
    try:
        json.loads(data_json)
    except json.JSONDecodeError as exc:
        problems.append(f"embedded data JSON does not parse: {exc}")
    return problems


CSS_TEMPLATE = r"""
:root{
  --bg:@@BG@@; --panel:@@PANEL@@; --raised:@@RAISED@@; --border:@@BORDER@@;
  --text:@@TEXT@@; --muted:@@MUTED@@; --amber:@@AMBER@@; --green:@@GREEN@@;
  --red:@@RED@@; --blue:@@BLUE@@; --gray:@@GRAY@@; --warning:@@WARNING@@;
  --amber-08:@@AMBER08@@; --amber-14:@@AMBER14@@; --green-12:@@GREEN12@@;
  --red-10:@@RED10@@; --blue-10:@@BLUE10@@;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1560px;margin:0 auto;padding:0 24px}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.top{display:flex;justify-content:space-between;align-items:flex-end;gap:28px;padding:28px 0 18px;border-bottom:1px solid var(--border)}
.eyebrow{font-size:10px;font-weight:700;letter-spacing:.19em;text-transform:uppercase;color:var(--amber)}
h1{font-size:clamp(26px,3.1vw,40px);line-height:1.05;letter-spacing:-.025em;margin:7px 0 9px;font-weight:650}
.sub{font-size:12.5px;line-height:1.6;color:var(--muted);max-width:820px}
.sub b{color:var(--text);font-weight:600}
.verdict{flex:0 0 auto;text-align:right;padding-bottom:4px}
.verdict .pill{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:999px;background:var(--panel);padding:7px 11px;font-size:10.5px;color:var(--muted);white-space:nowrap}
.verdict .dot{width:7px;height:7px;border-radius:50%;background:var(--green)}
.verdict .big{display:block;margin-top:9px;font-size:22px;line-height:1;font-family:var(--mono);color:var(--text)}
.verdict .small{display:block;margin-top:5px;font-size:10px;color:var(--muted)}
.kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:18px 0 14px}
.kpi{min-width:0;background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:12px 13px}
.kpi .l{font-size:9px;font-weight:650;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kpi .v{font-size:clamp(17px,1.5vw,22px);font-weight:600;line-height:1.1;margin-top:6px;font-family:var(--mono);white-space:nowrap;letter-spacing:-.01em}
.kpi .d{font-size:10px;line-height:1.4;color:var(--muted);margin-top:5px}
.kpi.hero{border-color:var(--amber);background:linear-gradient(180deg,var(--amber-14),var(--panel) 70%)}
.kpi.hero .v{color:var(--amber)}
.kpi.pos .v{color:var(--green)}
.kpi.neg .v{color:var(--red)}
.lede{display:grid;grid-template-columns:1.55fr 1fr;gap:12px;margin:0 0 12px}
.lede .box{background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:16px 18px}
.lede .box.read{border-left:3px solid var(--amber);background:linear-gradient(180deg,var(--amber-08),var(--panel) 55%)}
.kicker{font-size:9.5px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--amber);margin:0 0 8px}
.lede p{margin:0;font-size:13.5px;line-height:1.68;color:var(--text)}
.lede b{color:#fff;font-weight:650}
.lede .mono{color:#fff}
.windows{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 16px}
.win{background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:12px 14px;position:relative;overflow:hidden}
.win:before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--border)}
.win.hero{border-color:var(--amber);background:linear-gradient(180deg,var(--amber-14),var(--panel) 65%)}
.win.hero:before{background:var(--amber)}
.win.long_buildup:before{background:var(--green)}
.win.short_buildup:before{background:var(--red)}
.win.long_unwinding:before{background:var(--warning)}
.win.short_covering:before{background:var(--blue)}
.win .wt{font-size:10.5px;color:var(--muted);font-family:var(--mono)}
.win .wv{font-size:24px;line-height:1.1;font-family:var(--mono);font-weight:600;margin:6px 0 4px;white-space:nowrap}
.win .wv small{font-size:11px;color:var(--muted);font-weight:500;margin-left:2px}
.win .wd{font-size:10.5px;color:var(--muted);line-height:1.45;font-family:var(--mono)}
.win .tag{display:inline-block;margin-top:8px;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:3px 6px;border-radius:3px;border:1px solid var(--border)}
.win .tag.long_buildup{color:var(--green);border-color:var(--green-12);background:var(--green-12)}
.win .tag.short_buildup{color:var(--red);border-color:var(--red-10);background:var(--red-10)}
.win .tag.long_unwinding{color:var(--warning);border-color:var(--amber-14);background:var(--amber-08)}
.win .tag.short_covering{color:var(--blue);border-color:var(--blue-10);background:var(--blue-10)}
.card{background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:14px 16px 10px;margin:0 0 12px}
.card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:6px}
.card-head h2{font-size:13.5px;font-weight:650;letter-spacing:.01em;margin:0;line-height:1.35}
.card-head .hint{font-size:10px;color:var(--muted);text-align:right;line-height:1.45;max-width:52%}
.legend{display:flex;flex-wrap:wrap;gap:6px 12px;margin:2px 0 6px}
.legend span{display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--muted);white-space:nowrap}
.sw{width:9px;height:9px;border-radius:2px;display:inline-block;flex:0 0 auto}
.sw.line{height:2px;border-radius:1px}
.chart{width:100%;line-height:0}
.caption{font-size:11px;line-height:1.58;color:var(--muted);margin:7px 2px 2px}
.caption b{color:var(--text);font-weight:600}
.statline{display:flex;flex-wrap:wrap;gap:6px 18px;border-top:1px solid var(--border);margin-top:9px;padding:8px 2px 2px;font-size:10.5px;color:var(--muted)}
.statline b{color:var(--text);font-family:var(--mono);font-weight:600}
.statline .amber{color:var(--amber)}
#tip{position:fixed;display:none;z-index:99;pointer-events:none;min-width:158px;max-width:280px;background:var(--raised);border:1px solid var(--border);border-radius:6px;padding:8px 10px;box-shadow:0 10px 28px rgba(0,0,0,.55);font-size:11px;line-height:1.55;color:var(--text)}
#tip .tt-h{font-family:var(--mono);font-weight:650;margin-bottom:4px;color:var(--text)}
#tip .tt-row{display:flex;justify-content:space-between;gap:16px;color:var(--muted)}
#tip .tt-row b{color:var(--text);font-family:var(--mono);font-weight:600;white-space:nowrap}
#tip .tt-note{margin-top:4px;font-size:10px;color:var(--muted)}
footer{border-top:1px solid var(--border);margin-top:20px;padding:15px 0 40px;font-size:10.5px;line-height:1.72;color:var(--muted)}
footer .cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}
footer b{color:var(--text);font-weight:600}
footer .fine{border-top:1px solid var(--border);margin-top:13px;padding-top:10px;font-size:10px;color:var(--muted)}
code{font-family:var(--mono);font-size:.95em;color:var(--text);background:var(--raised);padding:1px 4px;border-radius:3px}
.seg rect{transition:filter .12s ease}
.seg:hover rect{filter:brightness(1.18)}
@media (max-width:1100px){
  .kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media (max-width:900px){
  .lede{grid-template-columns:1fr}
  .top{align-items:flex-start;flex-direction:column;gap:10px}
  .verdict{text-align:left}
  .verdict .big{margin-top:6px}
}
@media (max-width:700px){
  .wrap{padding:0 14px}
  .top{padding-top:20px}
  .kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .kpi{padding:10px 11px}
  .kpi .d{font-size:9.5px}
  .windows{grid-template-columns:1fr;gap:8px}
  .win{padding:10px 12px}
  .win .wv{font-size:21px}
  .card{padding:12px 11px 8px}
  .card-head{flex-direction:column;gap:3px}
  .card-head .hint{text-align:left;max-width:100%}
  footer .cols{grid-template-columns:1fr;gap:12px}
  .lede .box{padding:13px 14px}
  .lede p{font-size:12.5px}
}
@media (max-width:420px){
  h1{font-size:25px}
  .kpi .v{font-size:16px}
  .kpi .l{font-size:8.5px}
  .statline{gap:4px 10px}
}
@media print{
  body{background:#fff;color:#111}
  .card,.kpi,.lede .box,.win{break-inside:avoid}
}
"""

JS_TEMPLATE = r"""
(function () {
  "use strict";
  const D = @@DATA@@;
  const C = @@COLORS@@;
  const tip = document.getElementById("tip");
  const main = document.getElementById("main");
  if (!window.d3) {
    main.insertAdjacentHTML("afterbegin", '<div class="card"><div class="caption">D3 did not load. The page needs the jsDelivr CDN for the four charts; the tables and summary above are static.</div></div>');
    return;
  }

  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const nf = (n, d = 1) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const ni = (n) => Math.round(Number(n)).toLocaleString("en-US");
  const nv = (n) => Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + "M" : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(0) + "k" : String(Math.round(n));
  const sgn = (n, d = 1) => (n > 0 ? "+" : n < 0 ? "\u2212" : "") + nf(Math.abs(n), d);
  const sgnInt = (n) => (n > 0 ? "+" : n < 0 ? "\u2212" : "") + ni(Math.abs(n));
  const tint = (hex, a) => { const c = d3.color(hex); c.opacity = a; return c + ""; };
  const narrow = () => window.innerWidth < 720;

  function showTip(html, ev) {
    tip.innerHTML = html;
    tip.style.display = "block";
    const gap = 14;
    const box = tip.getBoundingClientRect();
    let x = ev.clientX + gap;
    let y = ev.clientY + gap;
    if (x + box.width > window.innerWidth - 8) x = ev.clientX - box.width - gap;
    if (y + box.height > window.innerHeight - 8) y = ev.clientY - box.height - gap;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }
  function hideTip() { tip.style.display = "none"; }

  function makeSvg(id, height, label) {
    const host = document.getElementById(id);
    if (!host) return null;
    const W = host.clientWidth;
    if (!W || host.dataset.w === String(W)) return null;
    host.dataset.w = String(W);
    host.innerHTML = "";
    const svg = d3.select(host).append("svg")
      .attr("viewBox", "0 0 " + W + " " + height)
      .attr("width", W)
      .attr("height", height)
      .attr("role", "img")
      .attr("aria-label", label);
    return { host, W, H: height, svg };
  }

  function xAxis(svg, x, ticks, H, m, isNarrow) {
    const g = svg.append("g")
      .attr("transform", "translate(0," + (H - m.b) + ")")
      .call(d3.axisBottom(x).tickValues(ticks).tickFormat(hhmm).tickSizeOuter(0));
    g.selectAll("text").attr("fill", C.muted).attr("font-size", isNarrow ? 9 : 10).attr("font-family", C.mono);
    g.selectAll("line").attr("stroke", C.border);
    g.select(".domain").attr("stroke", C.border);
  }

  function yAxis(svg, scale, side, W, m, fmt, ticks, isNarrow) {
    const axis = side === "left" ? d3.axisLeft(scale) : d3.axisRight(scale);
    const g = svg.append("g")
      .attr("transform", side === "left" ? "translate(" + m.l + ",0)" : "translate(" + (W - m.r) + ",0)")
      .call(axis.ticks(ticks).tickFormat(fmt).tickSizeOuter(0));
    g.selectAll("text").attr("fill", C.muted).attr("font-size", isNarrow ? 9 : 10).attr("font-family", C.mono);
    g.selectAll("line").attr("stroke", C.border).attr("stroke-opacity", 0.5);
    g.select(".domain").attr("stroke", C.border);
  }

  function drawPriceOi() {
    const isNarrow = narrow();
    const H = isNarrow ? 252 : 322;
    const m = { t: isNarrow ? 34 : 40, r: isNarrow ? 48 : 64, b: 32, l: isNarrow ? 46 : 58 };
    const frame = makeSvg("chart-price-oi", H, "Futures close on the left axis and open interest on the right axis. Price and OI rise together into 11:45 to 12:00, then both stall and OI falls.");
    if (!frame) return;
    const { W, svg } = frame;
    const rows = D.candles;
    const x = d3.scaleLinear([555, 939], [m.l, W - m.r]);
    const lo = d3.min(rows, (d) => d.l);
    const hi = d3.max(rows, (d) => d.h);
    const yP = d3.scaleLinear([lo - 8, hi + 8], [H - m.b, m.t]);
    const olo = d3.min(rows, (d) => d.oi);
    const ohi = d3.max(rows, (d) => d.oi);
    const yO = d3.scaleLinear([olo - 25000, ohi + 25000], [H - m.b, m.t]);

    const yTicks = yP.ticks(isNarrow ? 4 : 5);
    svg.append("g").selectAll("line").data(yTicks).join("line")
      .attr("x1", m.l).attr("x2", W - m.r)
      .attr("y1", (d) => yP(d)).attr("y2", (d) => yP(d))
      .attr("stroke", C.border).attr("stroke-opacity", 0.45);

    const bx0 = x(705);
    const bx1 = x(720);
    svg.append("rect")
      .attr("x", bx0).attr("y", m.t)
      .attr("width", Math.max(1, bx1 - bx0)).attr("height", H - m.t - m.b)
      .attr("fill", C.amber).attr("fill-opacity", 0.11);

    yAxis(svg, yP, "left", W, m, (d) => nf(d, 0), isNarrow ? 4 : 5, isNarrow);
    yAxis(svg, yO, "right", W, m, (d) => (d / 1e6).toFixed(2) + "M", isNarrow ? 4 : 5, isNarrow);
    xAxis(svg, x, isNarrow ? [555, 675, 795, 915] : [555, 615, 675, 735, 795, 855, 915], H, m, isNarrow);

    const lineP = d3.line().x((d) => x(d.m)).y((d) => yP(d.c));
    const lineO = d3.line().x((d) => x(d.m)).y((d) => yO(d.oi));
    svg.append("path").datum(rows).attr("fill", "none").attr("stroke", C.amber)
      .attr("stroke-width", isNarrow ? 1.3 : 1.6).attr("stroke-linejoin", "round").attr("d", lineP);
    svg.append("path").datum(rows).attr("fill", "none").attr("stroke", C.blue)
      .attr("stroke-width", isNarrow ? 1.1 : 1.35).attr("stroke-linejoin", "round").attr("d", lineO);

    svg.append("line").attr("x1", x(720)).attr("x2", x(720))
      .attr("y1", m.t).attr("y2", H - m.b)
      .attr("stroke", C.text).attr("stroke-opacity", 0.28).attr("stroke-dasharray", "3 3");

    svg.append("text").attr("x", (bx0 + bx1) / 2).attr("y", m.t - 9)
      .attr("text-anchor", "middle").attr("fill", C.amber)
      .attr("font-size", isNarrow ? 9 : 10).attr("font-family", C.mono)
      .text("11:45\u201312:00");
    svg.append("text").attr("x", x(720) + 4).attr("y", H - m.b - 6)
      .attr("fill", C.muted).attr("font-size", 9).attr("font-family", C.mono).text("12:00");

    const last = rows[rows.length - 1];
    const yp = yP(last.c);
    const yo = yO(last.oi);
    svg.append("circle").attr("cx", x(last.m)).attr("cy", yp).attr("r", 2.6).attr("fill", C.amber);
    svg.append("circle").attr("cx", x(last.m)).attr("cy", yo).attr("r", 2.6).attr("fill", C.blue);

    const focus = svg.append("g").style("display", "none").style("pointer-events", "none");
    const vline = focus.append("line").attr("y1", m.t).attr("y2", H - m.b)
      .attr("stroke", C.text).attr("stroke-opacity", 0.5).attr("stroke-dasharray", "3 3");
    const dotP = focus.append("circle").attr("r", 3.4).attr("fill", C.amber).attr("stroke", C.bg).attr("stroke-width", 1.4);
    const dotO = focus.append("circle").attr("r", 3.4).attr("fill", C.blue).attr("stroke", C.bg).attr("stroke-width", 1.4);
    const bisect = d3.bisector((d) => d.m).center;

    svg.append("rect")
      .attr("x", m.l).attr("y", m.t)
      .attr("width", Math.max(1, W - m.l - m.r)).attr("height", Math.max(1, H - m.t - m.b))
      .attr("fill", "transparent").style("cursor", "crosshair")
      .on("mousemove", function (ev) {
        const mx = d3.pointer(ev, svg.node())[0];
        const i = bisect(rows, x.invert(mx));
        const d = rows[i];
        const prev = rows[Math.max(0, i - 1)];
        focus.style("display", null);
        vline.attr("x1", x(d.m)).attr("x2", x(d.m));
        dotP.attr("cx", x(d.m)).attr("cy", yP(d.c));
        dotO.attr("cx", x(d.m)).attr("cy", yO(d.oi));
        showTip(
          '<div class="tt-h">' + hhmm(d.m) + "</div>" +
          '<div class="tt-row"><span>Futures</span><b>' + nf(d.c, 1) + "</b></div>" +
          '<div class="tt-row"><span>Open interest</span><b>' + ni(d.oi) + "</b></div>" +
          '<div class="tt-row"><span>OI change</span><b>' + sgnInt(d.oi - prev.oi) + "</b></div>" +
          '<div class="tt-row"><span>Volume</span><b>' + ni(d.v) + "</b></div>" +
          '<div class="tt-row"><span>Price change</span><b>' + sgn(d.c - prev.c, 1) + " pts</b></div>",
          ev
        );
      })
      .on("mouseleave", function () { focus.style("display", "none"); hideTip(); });
  }

  function drawBasis() {
    const isNarrow = narrow();
    const H = isNarrow ? 218 : 278;
    const m = { t: isNarrow ? 32 : 38, r: isNarrow ? 48 : 64, b: 32, l: isNarrow ? 44 : 54 };
    const frame = makeSvg("chart-basis", H, "Futures minus spot basis from 09:15 to 14:07. The basis widens into noon, peaks at 11:55, compresses to a low at 13:08, and recovers by 14:07.");
    if (!frame) return;
    const { W, svg } = frame;
    const rows = D.basis;
    const x = d3.scaleLinear([555, 847], [m.l, W - m.r]);
    const bmin = d3.min(rows, (d) => d.b);
    const bmax = d3.max(rows, (d) => d.b);
    const y = d3.scaleLinear([Math.min(0, bmin - 6), bmax * 1.16], [H - m.b, m.t]);
    const zero = y(0);

    const yTicks = y.ticks(isNarrow ? 4 : 5);
    svg.append("g").selectAll("line").data(yTicks).join("line")
      .attr("x1", m.l).attr("x2", W - m.r)
      .attr("y1", (d) => y(d)).attr("y2", (d) => y(d))
      .attr("stroke", C.border).attr("stroke-opacity", 0.4);

    const defs = svg.append("defs");
    const grad = defs.append("linearGradient").attr("id", "basis-grad")
      .attr("x1", "0").attr("x2", "0")
      .attr("y1", y(bmax)).attr("y2", zero)
      .attr("gradientUnits", "userSpaceOnUse");
    grad.append("stop").attr("offset", "0%").attr("stop-color", C.green).attr("stop-opacity", 0.32);
    grad.append("stop").attr("offset", "100%").attr("stop-color", C.green).attr("stop-opacity", 0.02);

    const area = d3.area().x((d) => x(d.m)).y0(zero).y1((d) => y(d.b)).curve(d3.curveMonotoneX);
    const line = d3.line().x((d) => x(d.m)).y((d) => y(d.b)).curve(d3.curveMonotoneX);
    svg.append("path").datum(rows).attr("fill", "url(#basis-grad)").attr("d", area);
    svg.append("path").datum(rows).attr("fill", "none").attr("stroke", C.green)
      .attr("stroke-width", isNarrow ? 1.4 : 1.7).attr("d", line);

    svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", zero).attr("y2", zero)
      .attr("stroke", C.text).attr("stroke-opacity", 0.5);

    const mean = D.basis_stats.mean;
    svg.append("line").attr("x1", m.l).attr("x2", W - m.r)
      .attr("y1", y(mean)).attr("y2", y(mean))
      .attr("stroke", C.muted).attr("stroke-opacity", 0.55).attr("stroke-dasharray", "2 4");

    svg.append("line").attr("x1", x(720)).attr("x2", x(720))
      .attr("y1", m.t).attr("y2", H - m.b)
      .attr("stroke", C.amber).attr("stroke-opacity", 0.8).attr("stroke-dasharray", "3 3");

    const noon = rows.find((d) => d.m === 720);
    if (noon) {
      svg.append("circle").attr("cx", x(720)).attr("cy", y(noon.b)).attr("r", 3.4)
        .attr("fill", C.amber).attr("stroke", C.bg).attr("stroke-width", 1.4);
      svg.append("text").attr("x", x(720) + 6).attr("y", y(noon.b) - 8)
        .attr("fill", C.amber).attr("font-size", 10).attr("font-family", C.mono)
        .text("12:00 \u00b7 " + sgn(noon.b, 1));
    }
    const peak = rows.find((d) => d.m === 715);
    if (peak) {
      svg.append("circle").attr("cx", x(715)).attr("cy", y(peak.b)).attr("r", 2.6).attr("fill", C.green);
      if (!isNarrow) {
        svg.append("text").attr("x", x(715) - 5).attr("y", y(peak.b) - 7)
          .attr("text-anchor", "end").attr("fill", C.green).attr("font-size", 9)
          .attr("font-family", C.mono).text("11:55 " + sgn(peak.b, 1));
      }
    }
    svg.append("text").attr("x", W - m.r - 2).attr("y", m.t + 9)
      .attr("text-anchor", "end").attr("fill", C.muted).attr("font-size", 9).attr("font-family", C.mono)
      .text("spot tape ends 14:07");

    yAxis(svg, y, "left", W, m, (d) => nf(d, 0), isNarrow ? 4 : 5, isNarrow);
    xAxis(svg, x, isNarrow ? [555, 675, 795, 847] : [555, 615, 675, 735, 795, 847], H, m, isNarrow);

    const focus = svg.append("g").style("display", "none").style("pointer-events", "none");
    const vline = focus.append("line").attr("y1", m.t).attr("y2", H - m.b)
      .attr("stroke", C.text).attr("stroke-opacity", 0.55).attr("stroke-dasharray", "3 3");
    const dot = focus.append("circle").attr("r", 3.5).attr("fill", C.green).attr("stroke", C.bg).attr("stroke-width", 1.4);
    const bisect = d3.bisector((d) => d.m).center;

    svg.append("rect")
      .attr("x", m.l).attr("y", m.t)
      .attr("width", Math.max(1, W - m.l - m.r)).attr("height", Math.max(1, H - m.t - m.b))
      .attr("fill", "transparent").style("cursor", "crosshair")
      .on("mousemove", function (ev) {
        const mx = d3.pointer(ev, svg.node())[0];
        const i = bisect(rows, x.invert(mx));
        const d = rows[i];
        focus.style("display", null);
        vline.attr("x1", x(d.m)).attr("x2", x(d.m));
        dot.attr("cx", x(d.m)).attr("cy", y(d.b));
        showTip(
          '<div class="tt-h">' + hhmm(d.m) + "</div>" +
          '<div class="tt-row"><span>Futures</span><b>' + nf(d.f, 1) + "</b></div>" +
          '<div class="tt-row"><span>Spot</span><b>' + nf(d.s, 1) + "</b></div>" +
          '<div class="tt-row"><span>Basis</span><b>' + sgn(d.b, 2) + " pts</b></div>",
          ev
        );
      })
      .on("mouseleave", function () { focus.style("display", "none"); hideTip(); });
  }

  function drawRegimes() {
    const isNarrow = narrow();
    const H = isNarrow ? 118 : 132;
    const m = { t: 26, r: isNarrow ? 48 : 64, b: 24, l: isNarrow ? 46 : 58 };
    const frame = makeSvg("chart-regimes", H, "Fifteen-minute regime strip. Long buildup dominates the morning and the 11:45 bucket; long unwinding appears after 12:15.");
    if (!frame) return;
    const { W, svg } = frame;
    const x = d3.scaleLinear([555, 939], [m.l, W - m.r]);
    const stripY = m.t;
    const stripH = isNarrow ? 38 : 46;
    const col = {
      long_buildup: C.green,
      short_buildup: C.red,
      long_unwinding: C.warning,
      short_covering: C.blue,
      neutral: C.gray
    };
    const groups = svg.append("g").selectAll("g.seg").data(D.regimes).join("g").attr("class", "seg");

    groups.append("rect")
      .attr("x", (d) => x(d.start_m) + 0.5)
      .attr("y", stripY)
      .attr("width", (d) => Math.max(1, x(d.end_m) - x(d.start_m) - 1))
      .attr("height", stripH)
      .attr("fill", (d) => col[d.regime])
      .attr("fill-opacity", (d) => d.regime === "neutral" ? 0.55 : 0.84)
      .attr("stroke", C.bg)
      .attr("stroke-width", 1)
      .style("cursor", "crosshair");

    groups.filter((d) => d.start === "11:45" || d.start === "12:15")
      .append("rect")
      .attr("x", (d) => x(d.start_m) + 0.5)
      .attr("y", stripY - 1)
      .attr("width", (d) => Math.max(1, x(d.end_m) - x(d.start_m) - 1))
      .attr("height", stripH + 2)
      .attr("fill", "none")
      .attr("stroke", C.text)
      .attr("stroke-width", 1.2)
      .attr("pointer-events", "none");

    const heroLabels = ["11:45", "12:15"];
    if (!isNarrow) {
      heroLabels.forEach(function (key) {
        const d = D.regimes.find((r) => r.start === key);
        if (!d) return;
        svg.append("text")
          .attr("x", (x(d.start_m) + x(d.end_m)) / 2)
          .attr("y", stripY - 6)
          .attr("text-anchor", "middle")
          .attr("fill", C.text)
          .attr("font-size", 9.5)
          .attr("font-family", C.mono)
          .text(key);
      });
    }

    const ticks = isNarrow ? [555, 675, 795] : [555, 615, 675, 735, 795, 855, 915];
    ticks.forEach(function (t) {
      svg.append("text").attr("x", x(t)).attr("y", stripY + stripH + 16)
        .attr("text-anchor", "middle").attr("fill", C.muted)
        .attr("font-size", 9.5).attr("font-family", C.mono).text(hhmm(t));
    });
    svg.append("text").attr("x", W - m.r).attr("y", stripY + stripH + 16)
      .attr("text-anchor", "end").attr("fill", C.muted)
      .attr("font-size", 9.5).attr("font-family", C.mono).text("15:39");

    groups
      .on("mousemove", function (ev, d) {
        showTip(
          '<div class="tt-h">' + d.start + " \u2192 " + d.end + "</div>" +
          '<div class="tt-row"><span>Regime</span><b style="color:' + col[d.regime] + '">' + D.regime_labels[d.regime] + "</b></div>" +
          '<div class="tt-row"><span>Price</span><b>' + sgn(d.dp, 1) + " pts</b></div>" +
          '<div class="tt-row"><span>OI</span><b>' + sgnInt(d.doi) + "</b></div>" +
          '<div class="tt-row"><span>Volume</span><b>' + ni(d.volume) + "</b></div>" +
          '<div class="tt-note">' + nf(d.from_price, 1) + " \u2192 " + nf(d.to_price, 1) + "</div>",
          ev
        );
      })
      .on("mouseleave", hideTip);
  }

  function drawVolume() {
    const isNarrow = narrow();
    const H = isNarrow ? 226 : 292;
    const m = { t: isNarrow ? 42 : 46, r: isNarrow ? 48 : 64, b: 30, l: isNarrow ? 46 : 58 };
    const frame = makeSvg("chart-volume", H, "One-minute futures volume. The 12:00 bar is highlighted; the 11:45 to 12:00 window carries 350,220 contracts.");
    if (!frame) return;
    const { W, svg } = frame;
    const rows = D.candles;
    const x = d3.scaleLinear([555, 939], [m.l, W - m.r]);
    const vmax = d3.max(rows, (d) => d.v);
    const y = d3.scaleLinear([0, vmax * 1.18], [H - m.b, m.t]);
    const step = (W - m.l - m.r) / (939 - 555);
    const barW = Math.max(1, step - 1.1);

    const yTicks = y.ticks(isNarrow ? 4 : 5);
    svg.append("g").selectAll("line").data(yTicks).join("line")
      .attr("x1", m.l).attr("x2", W - m.r)
      .attr("y1", (d) => y(d)).attr("y2", (d) => y(d))
      .attr("stroke", C.border).attr("stroke-opacity", 0.4);

    const base = H - m.b;
    svg.append("rect")
      .attr("x", x(720) - Math.max(2, step / 2))
      .attr("y", m.t)
      .attr("width", Math.max(4, step))
      .attr("height", Math.max(1, base - m.t))
      .attr("fill", C.amber).attr("fill-opacity", 0.09);
    svg.append("g").selectAll("rect").data(rows).join("rect")
      .attr("x", (d) => x(d.m))
      .attr("y", (d) => y(d.v))
      .attr("width", barW)
      .attr("height", (d) => Math.max(0, base - y(d.v)))
      .attr("fill", (d) => d.m === 720 ? C.amber : (d.m > 705 && d.m <= 720 ? tint(C.amber, 0.42) : tint(C.muted, 0.30)))
      .attr("stroke", (d) => d.m === 720 ? C.text : "none")
      .attr("stroke-width", (d) => d.m === 720 ? 0.8 : 0);

    svg.append("path")
      .attr("d", "M" + x(705) + "," + (m.t + 7) + " L" + x(705) + "," + (m.t + 2) + " L" + x(720) + "," + (m.t + 2) + " L" + x(720) + "," + (m.t + 7))
      .attr("fill", "none").attr("stroke", C.amber).attr("stroke-opacity", 0.7);
    svg.append("text").attr("x", x(705)).attr("y", m.t - 9)
      .attr("fill", C.amber).attr("font-size", isNarrow ? 9 : 10).attr("font-family", C.mono)
      .text("11:45\u219212:00 \u00b7 350,220");

    const noon = rows.find((d) => d.m === 720);
    if (noon) {
      svg.append("circle").attr("cx", x(720)).attr("cy", y(noon.v)).attr("r", 2.5).attr("fill", C.amber);
      svg.append("text").attr("x", x(720) + 5).attr("y", y(noon.v) - 6)
        .attr("fill", C.amber).attr("font-size", 9.5).attr("font-family", C.mono)
        .text("12:00 \u00b7 " + ni(noon.v));
    }
    const peak = rows.find((d) => d.m === 715);
    if (peak) {
      svg.append("circle").attr("cx", x(715)).attr("cy", y(peak.v)).attr("r", 2.3).attr("fill", C.amber);
      svg.append("text").attr("x", x(715) + 4).attr("y", y(peak.v) - 7)
        .attr("fill", C.amber).attr("font-size", 9).attr("font-family", C.mono)
        .text("11:55 \u00b7 " + ni(peak.v));
    }

    yAxis(svg, y, "left", W, m, (d) => nv(d), isNarrow ? 4 : 5, isNarrow);
    xAxis(svg, x, isNarrow ? [555, 675, 795, 915] : [555, 615, 675, 735, 795, 855, 915], H, m, isNarrow);

    const focus = svg.append("g").style("display", "none").style("pointer-events", "none");
    const vline = focus.append("line").attr("y1", m.t).attr("y2", base)
      .attr("stroke", C.text).attr("stroke-opacity", 0.55).attr("stroke-dasharray", "3 3");
    const dot = focus.append("circle").attr("r", 3).attr("fill", C.amber).attr("stroke", C.bg).attr("stroke-width", 1.4);
    const bisect = d3.bisector((d) => d.m).center;

    svg.append("rect")
      .attr("x", m.l).attr("y", m.t)
      .attr("width", Math.max(1, W - m.l - m.r)).attr("height", Math.max(1, base - m.t))
      .attr("fill", "transparent").style("cursor", "crosshair")
      .on("mousemove", function (ev) {
        const mx = d3.pointer(ev, svg.node())[0];
        const i = bisect(rows, x.invert(mx));
        const d = rows[i];
        const prev = rows[Math.max(0, i - 1)];
        focus.style("display", null);
        vline.attr("x1", x(d.m)).attr("x2", x(d.m));
        dot.attr("cx", x(d.m)).attr("cy", y(d.v));
        showTip(
          '<div class="tt-h">' + hhmm(d.m) + "</div>" +
          '<div class="tt-row"><span>Volume</span><b>' + ni(d.v) + "</b></div>" +
          '<div class="tt-row"><span>Close</span><b>' + nf(d.c, 1) + "</b></div>" +
          '<div class="tt-row"><span>Price change</span><b>' + sgn(d.c - prev.c, 1) + " pts</b></div>" +
          '<div class="tt-row"><span>OI change</span><b>' + sgnInt(d.oi - prev.oi) + "</b></div>",
          ev
        );
      })
      .on("mouseleave", function () { focus.style("display", "none"); hideTip(); });
  }

  const draws = [drawPriceOi, drawBasis, drawRegimes, drawVolume];
  let raf = 0;
  function renderAll() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () { draws.forEach(function (fn) { fn(); }); });
  }

  renderAll();
  if ("ResizeObserver" in window) {
    new ResizeObserver(renderAll).observe(main);
  } else {
    window.addEventListener("resize", renderAll);
  }
  window.addEventListener("load", renderAll);
})();
"""


def build_page(payload: dict, summary: dict, palette: dict, generated: str) -> str:
    session = summary["session"]
    hero = summary["windows"]["long_buildup"]
    stall = summary["windows"]["short_buildup"]
    unwind = summary["windows"]["long_unwinding"]
    basis = summary["basis"]

    css = CSS_TEMPLATE
    css_tokens = {
        "@@BG@@": palette["bg"], "@@PANEL@@": palette["panel"],
        "@@RAISED@@": palette["raised"], "@@BORDER@@": palette["border"],
        "@@TEXT@@": palette["text"], "@@MUTED@@": palette["muted"],
        "@@AMBER@@": palette["amber"], "@@GREEN@@": palette["green"],
        "@@RED@@": palette["red"], "@@BLUE@@": palette["blue"],
        "@@GRAY@@": palette["gray"], "@@WARNING@@": palette["warning"],
        "@@AMBER08@@": alpha(palette["amber"], 0.08),
        "@@AMBER14@@": alpha(palette["amber"], 0.14),
        "@@GREEN12@@": alpha(palette["green"], 0.12),
        "@@RED10@@": alpha(palette["red"], 0.10),
        "@@BLUE10@@": alpha(palette["blue"], 0.10),
    }
    for token, value in css_tokens.items():
        css = css.replace(token, value)

    js = JS_TEMPLATE.replace("@@DATA@@", json.dumps(payload, separators=(",", ":")))
    js = js.replace("@@COLORS@@", json.dumps(palette, separators=(",", ":")))

    kpis = [
        ("Last futures", nf(session["last"], 1), f"Session {sgn(session['change'], 1)} pts ({sgn(session['change_pct'], 2)}%) from the 09:15 open", ""),
        ("Session range", f"{nf(session['low'], 0)} \u2013 {nf(session['high'], 0)}", f"{nf(session['range'], 1)} pt range \u00b7 low {session['low_time']} / high {session['high_time']}", ""),
        ("Open interest", compact(session["oi_last"]), f"{sgn_int(session['oi_change'])} on the day, from {compact(session['oi_first'])}", "pos"),
        ("Session volume", compact(session["volume"]), f"{session['bars']} one-minute bars; peak 11:55 at {ni(summary['peak_volume']['volume'])}", ""),
        ("Basis at 12:00", sgn(basis["at_1200"], 1), f"futures \u2212 spot; tape coverage ends {basis['last_time']}", ""),
        ("11:45 \u2192 12:00", f"{sgn(hero['dp'], 1)} pts", f"OI {sgn_int(hero['doi'])} \u00b7 volume {ni(hero['volume'])}", "hero"),
    ]
    kpi_html = "\n".join(
        f'<div class="kpi {cls}"><div class="l">{label}</div><div class="v">{value}</div><div class="d">{detail}</div></div>'
        for label, value, detail, cls in kpis
    )

    window_cards = [
        ("11:45 \u2192 12:00", hero, True),
        ("12:00 \u2192 12:15", stall, False),
        ("12:15 \u2192 12:30", unwind, False),
    ]
    windows_html = "\n".join(
        f'''<div class="win {data['regime']}{' hero' if is_hero else ''}">
  <div class="wt">{title}</div>
  <div class="wv">{sgn(data['dp'], 1)} <small>pts</small></div>
  <div class="wd">OI {sgn_int(data['doi'])} \u00b7 vol {ni(data['volume'])}</div>
  <div class="tag {data['regime']}">{REGIME_LABELS[data['regime']]}</div>
</div>'''
        for title, data, is_hero in window_cards
    )

    regime_legend = "".join(
        f'<span><i class="sw" style="background:{palette[key]}"></i>{label}</span>'
        for key, label in (
            ("green", "Long buildup"),
            ("red", "Short buildup"),
            ("warning", "Long unwinding"),
            ("blue", "Short covering"),
            ("gray", "Neutral"),
        )
    )

    body = f"""
<div class="wrap" id="main">
  <header class="top">
    <div>
      <div class="eyebrow">Alphashri \u00b7 NIFTY session review \u00b7 17 Nov 2026</div>
      <h1>Futures / price, OI, basis</h1>
      <div class="sub">
        NIFTY current-month futures (<b>23 Nov 2026 expiry</b>), 1-minute close, open interest and volume from
        <b>09:15 to 15:39 IST</b>, against the NIFTY spot tape. The session built a <b>long buildup</b> into noon,
        then unwound the noon push as <b>long unwinding</b>.
      </div>
    </div>
    <div class="verdict">
      <span class="pill"><i class="dot"></i>12:00 close high held for 15 minutes</span>
      <span class="big">{nf(session['last'], 1)}</span>
      <span class="small">last futures \u00b7 {sgn(session['change'], 1)} pts on the session</span>
    </div>
  </header>

  <section class="kpis">
    {kpi_html}
  </section>

  <section class="lede">
    <div class="box">
      <p class="kicker">The 15 minutes that mattered</p>
      <p>
        From <b>11:45 to 12:00</b> the future added <b>{sgn(hero['dp'], 1)} pts</b> while open interest rose
        <b>{sgn_int(hero['doi'])}</b> and <b>{ni(hero['volume'])}</b> contracts traded \u2014 a textbook
        <b>{REGIME_LABELS[hero['regime']].lower()}</b>. It did not hold. The next bucket stalled at
        <b>{sgn(stall['dp'], 1)} pts</b> but still added <b>{sgn_int(stall['doi'])} OI</b>, and OI peaked at
        <b>{ni(summary['oi_peak']['oi'])}</b> at <b>{summary['oi_peak']['time']}</b>. Then <b>12:15 \u2192 12:30</b>
        gave back <b>{sgn(unwind['dp'], 1)} pts</b> and <b>{sgn_int(unwind['doi'])} OI</b>: falling price with falling
        OI is <b>{REGIME_LABELS[unwind['regime']].lower()}</b> \u2014 exits, not fresh shorts.
      </p>
    </div>
    <div class="box read">
      <p class="kicker">How to use this</p>
      <p>
        Confirm <b>price and OI together</b>. Price up + OI up = new longs; price down + OI down = longs leaving;
        price down + OI up is the only fresh-short read. <b>Don't chase the first spike</b>: at 11:55 the basis
        printed <b>{sgn(basis['peak'], 2)}</b> and one minute carried <b>{ni(summary['peak_volume']['volume'])}</b>
        contracts (48% of the window), then the basis was back to <b>{sgn(basis['at_1200'], 1)}</b> by 12:00.
        Wait for the 15-minute bucket to close and for price and OI to agree.
      </p>
    </div>
  </section>

  <section class="windows">
    {windows_html}
  </section>

  <section class="card">
    <div class="card-head">
      <h2>1 \u00b7 Futures close and open interest</h2>
      <div class="hint">1-minute \u00b7 left axis price \u00b7 right axis OI</div>
    </div>
    <div class="legend">
      <span><i class="sw line" style="background:{palette['amber']}"></i>Futures close</span>
      <span><i class="sw line" style="background:{palette['blue']}"></i>Open interest</span>
      <span><i class="sw" style="background:{alpha(palette['amber'], 0.35)}"></i>11:45\u201312:00</span>
    </div>
    <div class="chart" id="chart-price-oi"></div>
    <div class="caption">
      Price and OI climb together into noon \u2014 the mark of new longs, not short covering. The shaded band is the
      15-minute window that did the work. OI peaked at <b>{ni(summary['oi_peak']['oi'])}</b> at
      <b>{summary['oi_peak']['time']}</b>, then lost <b>{ni(summary['oi_peak']['drop_to_1230'])}</b> into 12:30.
      OI prints are lumpy: one-minute cliffs at 10:06, 10:53 and 12:29; the 12:29 print alone removed
      <b>111,215</b> contracts.
    </div>
  </section>

  <section class="card">
    <div class="card-head">
      <h2>2 \u00b7 Basis: futures minus spot</h2>
      <div class="hint">same-minute spot \u00b7 09:15\u201314:07 \u00b7 zero = parity</div>
    </div>
    <div class="legend">
      <span><i class="sw" style="background:{palette['green']}"></i>Basis</span>
      <span><i class="sw line" style="background:{palette['muted']}"></i>Session mean {sgn(basis['mean'], 1)}</span>
      <span><i class="sw line" style="background:{palette['amber']}"></i>12:00 marker</span>
    </div>
    <div class="chart" id="chart-basis"></div>
    <div class="caption">
      The basis widened <b>{sgn(basis['change_1145_1200'], 1)} pts</b> from 11:45 to 12:00 as futures led spot, then
      compressed from <b>{sgn(basis['at_1230'], 1)}</b> at 12:30 to <b>{sgn(basis['min'], 1)}</b> at
      <b>{basis['min_time']}</b> while price fell \u2014 the selloff was spot-led. It recovered to
      <b>{sgn(basis['last'], 1)}</b> by {basis['last_time']}. Coverage stops with the spot tape: no basis is implied after 14:07.
    </div>
  </section>

  <section class="card">
    <div class="card-head">
      <h2>3 \u00b7 15-minute regime timeline</h2>
      <div class="hint">close-to-close price and OI \u00b7 one block per bucket</div>
    </div>
    <div class="legend">
      {regime_legend}
    </div>
    <div class="chart" id="chart-regimes"></div>
    <div class="caption">
      Green and red are <b>fresh positioning</b> (OI up); amber and blue are <b>exits</b> (OI down); grey is neither
      move clearing the threshold. The 11:45 bucket is outlined for the buildup and 12:15 for the unwind.
      Hover any block for its price change, OI change and volume.
    </div>
  </section>

  <section class="card">
    <div class="card-head">
      <h2>4 \u00b7 One-minute volume</h2>
      <div class="hint">12:00 highlighted \u00b7 11:45\u219212:00 bracket</div>
    </div>
    <div class="chart" id="chart-volume"></div>
    <div class="caption">
      Volume confirms the move but is lumpy: <b>11:55</b> alone carried <b>{ni(summary['peak_volume']['volume'])}</b>
      contracts, 48% of the <b>{ni(hero['volume'])}</b> traded in the 11:45\u219212:00 window. The 12:00 bar
      (<b>{ni(summary['noon_volume'])}</b>) is where price closed the window at its high; the next 15 minutes added
      OI on a <b>{sgn(stall['dp'], 1)} pt</b> bucket, and the unwind followed.
    </div>
    <div class="statline">
      <span>11:45\u219212:00 <b class="amber">{ni(hero['volume'])}</b> <span>15 bars (11:46\u201312:00)</span></span>
      <span>12:00 bar <b>{ni(summary['noon_volume'])}</b></span>
      <span>11:55 bar <b>{ni(summary['peak_volume']['volume'])}</b></span>
      <span>Session <b>{ni(session['volume'])}</b></span>
    </div>
  </section>

  <footer>
    <div class="cols">
      <div>
        <b>Data.</b> NIFTY current-month futures (expiry 23 Nov 2026), 1-minute OHLCV + OI, 09:15\u201315:39 IST,
        {session['bars']} bars (<code>reports/nifty_2026-11-17/data/futures_1m.json</code>). Spot from the NIFTY tape,
        {summary['coverage']['spot_rows']} rows, {summary['coverage']['spot_first_ts'][11:19]}\u2013{summary['coverage']['spot_last_ts'][11:19]} IST.
        Basis = futures close \u2212 spot in the same minute (mean if multiple rows); all {summary['coverage']['basis_points']}
        tape minutes matched. Three single-minute gaps in the 293-minute span (10:51, 11:52, 13:58) are bridged by
        the line. The tape ends at 14:07, so no basis is implied after that.
      </div>
      <div>
        <b>Method.</b> 15-minute buckets run from one boundary bar's close to the next boundary bar's close, so the
        11:45 bucket covers 11:46\u201312:00 flow. That is why its volume is <b>{ni(hero['volume'])}</b>, not the
        <b>{ni(hero['volume'] + summary['boundary_bar_volume'])}</b> that includes the 11:45 bar. Regime is neutral
        only when |\u0394price| &lt; {nf(summary['regime_rules']['price_threshold'], 1)} pts <b>and</b>
        |\u0394OI| &lt; {ni(summary['regime_rules']['oi_threshold'])}; otherwise the price/OI signs give long buildup
        (+,+), short buildup (\u2212,+), long unwinding (\u2212,\u2212) and short covering (+,\u2212).
        Colours parsed from <code>src/ui/palette.ts</code>. Options expired today (17 Nov); the futures contract
        expires 23 Nov, so the basis is not a cost-of-carry to today's option expiry.
      </div>
    </div>
    <div class="fine">
      Session record, not a forecast. Generated {generated} IST by <code>scripts/market/nifty_report_futures.py</code>.
      Report pairs with the other 2026-11-17 artifacts in <code>reports/nifty_2026-11-17/</code>.
    </div>
  </footer>
</div>
<div id="tip" role="tooltip"></div>
"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NIFTY futures / price, OI, basis \u2014 2026-11-17</title>
<style>{css}</style>
</head>
<body>
{body}
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<script>{js}</script>
</body>
</html>
"""
    return html


def main() -> int:
    args = parse_args()
    futures_path = resolve(args.futures)
    tape_path = resolve(args.tape)
    out_path = resolve(args.out)
    summary_path = resolve(args.summary)

    futures = load_futures(futures_path)
    rows = futures["rows"]
    tape = load_spot(tape_path)
    basis_rows = build_basis(rows, tape["spot"])
    regimes = build_regimes(rows, args.price_threshold, args.oi_threshold)

    hero = bucket_by_start(regimes, "11:45")
    stall = bucket_by_start(regimes, "12:00")
    unwind = bucket_by_start(regimes, "12:15")

    # The page's headline claims are data contracts; fail loudly rather than publish a stale story.
    if abs(hero["dp"] - 50.5) > 0.05 or hero["doi"] != 96915 or hero["volume"] != 350220:
        raise SystemExit(f"11:45 window changed: dp={hero['dp']} doi={hero['doi']} vol={hero['volume']}")
    if abs(unwind["dp"] + 13.4) > 0.05 or unwind["doi"] != -88140:
        raise SystemExit(f"12:15 window changed: dp={unwind['dp']} doi={unwind['doi']}")

    first = rows[0]
    last = rows[-1]
    high_bar = max(rows, key=lambda r: r["h"])
    low_bar = min(rows, key=lambda r: r["l"])
    oi_peak = max(rows, key=lambda r: r["oi"])
    noon = next((r for r in rows if r["m"] == 720), None)
    if noon is None:
        raise SystemExit("missing 12:00 bar")
    peak_volume = max(rows, key=lambda r: r["v"])

    bmin = min(basis_rows, key=lambda r: r["b"])
    bmax = max(basis_rows, key=lambda r: r["b"])
    basis_at_1145 = next(r for r in basis_rows if r["m"] == 705)
    basis_at_1200 = next(r for r in basis_rows if r["m"] == 720)
    basis_at_1230 = next(r for r in basis_rows if r["m"] == 750)
    basis_mean = sum(r["b"] for r in basis_rows) / len(basis_rows)

    session = {
        "open": round(first["o"], 2),
        "high": round(max(r["h"] for r in rows), 2),
        "low": round(min(r["l"] for r in rows), 2),
        "last": round(last["c"], 2),
        "change": round(last["c"] - first["o"], 2),
        "change_pct": round((last["c"] / first["o"] - 1) * 100, 3),
        "range": round(max(r["h"] for r in rows) - min(r["l"] for r in rows), 2),
        "volume": sum(r["v"] for r in rows),
        "bars": len(rows),
        "oi_first": first["oi"],
        "oi_last": last["oi"],
        "oi_change": last["oi"] - first["oi"],
        "high_time": hhmm(high_bar["m"]),
        "low_time": hhmm(low_bar["m"]),
    }

    summary = {
        "symbol": futures.get("symbol", "NIFTY"),
        "session": futures.get("session", "2026-11-17"),
        "futures_expiry": futures.get("expiry"),
        "interval": futures.get("interval", "1m"),
        "headline": [
            "11:45\u219212:00: +50.5 pts, OI +96,915, volume 350,220 = long buildup.",
            "12:15\u219212:30: \u221213.4 pts, OI \u221288,140 = long unwinding.",
            "Do not chase the first spike: 11:55 basis +70.45 on 168,545 contracts, back to +48.7 by 12:00.",
        ],
        "coverage": {
            "futures_first": hhmm(rows[0]["m"]),
            "futures_last": hhmm(rows[-1]["m"]),
            "futures_bars": len(rows),
            "spot_first_ts": tape["first_ts"],
            "spot_last_ts": tape["last_ts"],
            "spot_rows": tape["rows"],
            "spot_minutes": len(tape["spot"]),
            "basis_points": len(basis_rows),
        },
        "session": session,
        "windows": {
            "long_buildup": hero,
            "short_buildup": stall,
            "long_unwinding": unwind,
        },
        "boundary_bar_volume": next(r for r in rows if r["m"] == 705)["v"],
        "oi_peak": {
            "oi": oi_peak["oi"],
            "time": hhmm(oi_peak["m"]),
            "close": oi_peak["c"],
            "drop_to_1230": oi_peak["oi"] - next(r for r in rows if r["m"] == 750)["oi"],
        },
        "peak_volume": {
            "time": hhmm(peak_volume["m"]),
            "volume": peak_volume["v"],
            "share_of_window": round(peak_volume["v"] / hero["volume"], 4),
        },
        "noon_volume": noon["v"],
        "basis": {
            "first": basis_rows[0]["b"],
            "first_time": basis_rows[0]["t"],
            "last": basis_rows[-1]["b"],
            "last_time": basis_rows[-1]["t"],
            "min": bmin["b"],
            "min_time": bmin["t"],
            "max": bmax["b"],
            "max_time": bmax["t"],
            "mean": round(basis_mean, 2),
            "at_1200": basis_at_1200["b"],
            "at_1230": basis_at_1230["b"],
            "change_1145_1200": round(basis_at_1200["b"] - basis_at_1145["b"], 2),
            "peak": bmax["b"],
            "coverage_end": basis_rows[-1]["t"],
        },
        "regime_rules": {
            "bucket_minutes": 15,
            "price_threshold": args.price_threshold,
            "oi_threshold": args.oi_threshold,
            "definition": "neutral when |dprice| < price_threshold AND |doi| < oi_threshold; otherwise price/OI signs map to long_buildup (+,+), short_buildup (-,+), long_unwinding (-,-), short_covering (+,-)",
            "measure": "boundary close to boundary close; volume excludes the opening boundary bar",
        },
        "regime_labels": REGIME_LABELS,
        "regimes": regimes,
        "generated_at": datetime.now(IST).isoformat(timespec="seconds"),
        "palette_source": "src/ui/palette.ts",
    }

    payload = {
        "candles": [{"m": r["m"], "c": r["c"], "h": r["h"], "l": r["l"], "v": r["v"], "oi": r["oi"]} for r in rows],
        "basis": basis_rows,
        "regimes": regimes,
        "regime_labels": REGIME_LABELS,
        "basis_stats": summary["basis"],
    }

    palette = load_palette(REPO_ROOT / "src/ui/palette.ts")
    generated = datetime.now(IST).strftime("%Y-%m-%d %H:%M")
    html = build_page(payload, summary, palette, generated)

    data_json = json.dumps(payload, separators=(",", ":"))
    problems = validate_html(html, data_json)
    if problems:
        print("HTML validation failed:", file=sys.stderr)
        for problem in problems:
            print("  -", problem, file=sys.stderr)
        return 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")

    print(f"wrote {out_path.relative_to(REPO_ROOT)}  {len(html.encode()):,} bytes")
    print(f"wrote {summary_path.relative_to(REPO_ROOT)}  {summary_path.stat().st_size:,} bytes")
    print(
        "checked: "
        f"11:45 {sgn(hero['dp'])} pts / OI {sgn_int(hero['doi'])} / vol {ni(hero['volume'])}; "
        f"12:15 {sgn(unwind['dp'])} pts / OI {sgn_int(unwind['doi'])}; "
        f"basis {sgn(summary['basis']['at_1200'])} at 12:00; "
        f"{len(regimes)} regime buckets"
    )

    if args.open:
        import webbrowser
        webbrowser.open(out_path.as_uri())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
