#!/usr/bin/env python3

from __future__ import annotations

import json
import statistics
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SESSION = "2026-11-17"
REPORT_DIR = ROOT / "reports" / f"nifty_{SESSION}"
DATA_DIR = REPORT_DIR / "data"
OUT_JSON = DATA_DIR / "3d.json"
OUT_HTML = REPORT_DIR / "06-3d.html"

TAPE_FILE = ROOT / "experiments/data/nifty_tape" / f"{SESSION}.jsonl"
CHAIN_FILE = ROOT / "experiments/data/nifty_chain10s" / f"{SESSION}.jsonl"
SNAP_FILE = ROOT / "experiments/data/nifty_snapshots" / f"{SESSION}.jsonl"
FUT_FILE = DATA_DIR / "futures_1m.json"
CTX_FILE = DATA_DIR / "context.json"

IST = timezone(timedelta(hours=5, minutes=30))

STRIKE_LO, STRIKE_HI, STRIKE_STEP = 25000, 26000, 50
BAND = list(range(STRIKE_LO, STRIKE_HI + 1, STRIKE_STEP))
IV_LO, IV_HI = 24950, 26050
IV_STRIKES = list(range(IV_LO, IV_HI + 1, STRIKE_STEP))
RIDGE_STRIKE = 25500
BUCKET_MIN = 5
SESSION_START = 9 * 60 + 15
SESSION_END = 14 * 60 + 7


def minutes(ts: str) -> int:
    return int(ts[11:13]) * 60 + int(ts[14:16])


def hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def key(strike: int) -> str:
    return f"{strike:g}"


def fixtures():
    ctx = json.loads(CTX_FILE.read_text())
    tape = load_jsonl(TAPE_FILE)
    snaps = load_jsonl(SNAP_FILE)
    futures = json.loads(FUT_FILE.read_text())["candles"]
    return ctx, tape, snaps, futures


def nearest(rows: list[dict], target: int, tolerance: int = 3) -> dict | None:
    best, best_d = None, 10**9
    for r in rows:
        d = abs(minutes(r["t"]) - target)
        if d < best_d:
            best, best_d = r, d
    if best is None or best_d > tolerance:
        return None
    return best


def carry(series: list[float | None]) -> list[float]:
    out: list[float] = []
    last = None
    for v in series:
        if v is not None:
            last = v
        out.append(last)
    first = next((v for v in out if v is not None), 0.0)
    return [first if v is None else v for v in out]


def field_matrix(tape: list[dict], idx: int) -> dict[int, list[float]]:
    return {
        k: carry([
            (float(r["chain"][key(k)][idx])
             if r["chain"].get(key(k)) and r["chain"][key(k)][idx] is not None
             else None)
            for r in tape
        ])
        for k in BAND
    }


def build_terrain(tape: list[dict]):
    times = list(range(SESSION_START, SESSION_END - 1, BUCKET_MIN))
    stamps = [nearest(tape, t) for t in times]
    assert all(stamps), "tape does not cover every 5-minute boundary"
    row_idx = []
    for st in stamps:
        # nearest row, but never after the boundary's end
        cand = [i for i, r in enumerate(tape) if minutes(r["t"]) <= minutes(st["t"])]
        row_idx.append(cand[-1] if cand else 0)

    pe_vol = field_matrix(tape, 5)
    ce_vol = field_matrix(tape, 4)
    pe_oi = field_matrix(tape, 3)
    ce_oi = field_matrix(tape, 2)

    labels = [hhmm(t) for t in times[1:]]
    metrics: dict[str, list[list[float]]] = {k: [] for k in
                                             ("pe_vol", "ce_vol", "pe_oi", "ce_oi")}
    grounds = {"pe_vol": pe_vol, "ce_vol": ce_vol, "pe_oi": pe_oi, "ce_oi": ce_oi}
    for metric, grid in grounds.items():
        for k in BAND:
            row = []
            for a, b in zip(row_idx, row_idx[1:]):
                delta = grid[k][b] - grid[k][a]
                if metric.endswith("_vol"):
                    delta = max(0.0, delta)
                row.append(round(delta / 1e6, 3))
            metrics[metric].append(row)

    ridge = {m: metrics[m][BAND.index(RIDGE_STRIKE)] for m in metrics}
    return {
        "times": labels,
        "minutes": times[1:],
        "strikes": BAND,
        "metrics": metrics,
        "ridge": ridge,
        "ridge_strike": RIDGE_STRIKE,
        "bucket_min": BUCKET_MIN,
        "pe_oi_level": {str(k): round(nearest(tape, t)["chain"][key(k)][3] / 1e6, 2)
                        for k in (RIDGE_STRIKE,) for t in (SESSION_START,)},
        "spot": [round(nearest(tape, t)["spot"], 1) for t in times[1:]],
    }


def otm_iv(point: dict, strike: float, spot: float) -> float | None:
    d = strike - spot
    if abs(d) <= 25:
        vals = [v for v in (point.get("ce_iv"), point.get("pe_iv")) if v]
        return sum(vals) / len(vals) if vals else None
    return point.get("ce_iv") if d > 0 else point.get("pe_iv")


def build_iv(snaps: list[dict], tape: list[dict]):
    times = list(range(SESSION_START, SESSION_END - 1, BUCKET_MIN))
    frames = []
    for t in times:
        cand = min(snaps, key=lambda s: abs(minutes(s["t"]) - t))
        if abs(minutes(cand["t"]) - t) > 4:
            frames.append(None)
        else:
            frames.append(cand)

    z: list[list[float | None]] = []
    cover = []
    for si, strike in enumerate(IV_STRIKES):
        row: list[float | None] = []
        for f in frames:
            if f is None:
                row.append(None)
                continue
            report = f["report"]
            pts = {p["strike"]: p for p in report.get("iv_surface", {}).get("points", [])}
            p = pts.get(float(strike))
            v = otm_iv(p, float(strike), report["spot"]) if p else None
            row.append(round(v, 2) if v is not None and 0 < v < 300 else None)
        z.append(row)
    for j in range(len(frames)):
        cover.append(sum(1 for i in range(len(IV_STRIKES)) if z[i][j] is not None))

    cells = len(IV_STRIKES) * len(frames)
    filled = sum(cover)
    spot_path = [round(f["report"]["spot"], 1) if f else None for f in frames]
    sufficient = filled >= 0.5 * cells and len(frames) >= 8 and min(cover) >= 4
    return {
        "times": [hhmm(t) for t in times],
        "minutes": times,
        "strikes": IV_STRIKES,
        "z": z,
        "spot": spot_path,
        "coverage": {
            "frames": len(frames),
            "cells": cells,
            "filled": filled,
            "pct": round(100 * filled / cells, 1),
            "min_per_frame": min(cover) if cover else 0,
            "median_per_frame": statistics.median(cover) if cover else 0,
            "strike_band": [IV_LO, IV_HI],
        },
        "sufficient": sufficient,
        "note": ("OTM IV (calls above spot, puts below, ATM averaged) from the "
                 "recorded report snapshots, 5-minute frames, 0 < IV < 300. "
                 "Each frame is the snapshot nearest the bucket boundary."),
    }


FUT_REGIME = {
    "long_buildup": ("long buildup", "#2FA36B"),
    "short_buildup": ("short buildup", "#E5606A"),
    "long_unwind": ("long unwinding", "#C9912F"),
    "short_cover": ("short covering", "#4A8FD8"),
    "flat": ("flat", "#6E86AE"),
}


def regime_of(dp: float, doi: float) -> str:
    if abs(dp) < 1.0 and abs(doi) < 500:
        return "flat"
    if dp > 0 and doi > 0:
        return "long_buildup"
    if dp < 0 and doi > 0:
        return "short_buildup"
    if dp < 0 and doi < 0:
        return "long_unwind"
    if dp > 0 and doi < 0:
        return "short_cover"
    return "flat"


def build_futures(candles: list[dict]):
    rows = [c for c in candles if minutes(c["t"]) <= SESSION_END]
    assert rows and minutes(rows[0]["t"]) == SESSION_START
    step = 3
    picked = [r for r in rows if minutes(r["t"]) % step == 0] + [rows[-1]]
    picked = sorted({r["t"]: r for r in picked}.values(), key=lambda r: r["t"])

    points = []
    prev = None
    for r in picked:
        dp = 0.0 if prev is None else r["c"] - prev["c"]
        doi = 0.0 if prev is None else r["oi"] - prev["oi"]
        reg = regime_of(dp, doi)
        points.append({
            "t": hhmm(minutes(r["t"])),
            "min": minutes(r["t"]),
            "close": r["c"],
            "oi": round(r["oi"] / 1e6, 2),
            "vol": r["v"],
            "dp": round(dp, 1),
            "doi": int(doi),
            "regime": reg,
            "regime_label": FUT_REGIME[reg][0],
        })
        prev = r

    by_min = {minutes(c["t"]): c for c in rows}

    def window(a: str, b: str):
        ha, ma = map(int, a.split(":"))
        hb, mb = map(int, b.split(":"))
        start, end = ha * 60 + ma, hb * 60 + mb
        seg = [c for c in rows if start <= minutes(c["t"]) <= end]
        dp = by_min[end]["c"] - by_min[start]["c"]
        doi = by_min[end]["oi"] - by_min[start]["oi"]
        vol = sum(c["v"] for c in seg if minutes(c["t"]) > start)
        return {
            "from": a, "to": b,
            "dp": round(dp, 1),
            "doi": int(doi),
            "vol": int(vol),
            "regime": regime_of(dp, doi),
            "regime_label": FUT_REGIME[regime_of(dp, doi)][0],
            "open": by_min[start]["c"],
            "close": by_min[end]["c"],
        }

    return {
        "points": points,
        "step_min": step,
        "window": window("11:45", "12:00"),
        "unwind": window("12:15", "13:00"),
        "first": rows[0]["t"],
        "last": rows[-1]["t"],
        "clipped_from": candles[-1]["t"],
        "rows_used": len(rows),
    }


def build_facts(tape, terrain, iv, fut):
    times = terrain["times"]
    spot = terrain["spot"]
    band = terrain["strikes"]
    pe_vol = terrain["metrics"]["pe_vol"]
    pe_oi = terrain["metrics"]["pe_oi"]

    def col(label: str) -> int:
        return times.index(label)

    i110 = col("11:10")
    i1555, i1200, i1205 = col("11:55"), col("12:00"), col("12:05")

    def itm_pe_vol(idx: int) -> float:
        s = spot[idx]
        return round(sum(pe_vol[i][idx] for i, k in enumerate(band) if k > s), 2)

    def itm_pe_doi(idx: int) -> float:
        s = spot[idx]
        return round(sum(pe_oi[i][idx] for i, k in enumerate(band) if k > s), 2)

    prior_vol = [itm_pe_vol(i) for i in range(max(0, i110 - 5), i110)]
    prior_doi = [itm_pe_doi(i) for i in range(max(0, i110 - 5), i110)]
    med_prior_vol = statistics.median(prior_vol) if prior_vol else 0.0
    med_prior_doi = statistics.median(prior_doi) if prior_doi else 0.0
    post_doi = [itm_pe_doi(i) for i in range(i110, min(i110 + 5, len(times)))]

    ridge_vol = terrain["ridge"]["pe_vol"]
    ridge_oi = terrain["ridge"]["pe_oi"]
    ridge_oi_level = terrain["pe_oi_level"][str(RIDGE_STRIKE)]
    peak_vol_at = times[max(range(len(ridge_vol)), key=lambda i: ridge_vol[i])]
    peak_vol = max(ridge_vol)
    peak_doi_at = times[max(range(len(ridge_oi)), key=lambda i: ridge_oi[i])]
    peak_doi = max(ridge_oi)

    # bucket labelled L covers (L-5, L], so 11:55 -> 12:05 is the 12:00 + 12:05 buckets
    build_doi = round(ridge_oi[i1200] + ridge_oi[i1205], 2)
    build_vol = round(ridge_vol[i1200] + ridge_vol[i1205], 2)
    oi_start = round(ridge_oi_level + sum(ridge_oi[:i1555 + 1]), 2)
    oi_end = round(oi_start + build_doi, 2)

    vol_flat = [v for row in terrain["metrics"]["pe_vol"] for v in row]
    itm_name = "strikes above spot"
    median_cell = round(statistics.median(vol_flat), 2)
    return {
        "spot_open": round(tape[0]["spot"], 1),
        "spot_last": round(tape[-1]["spot"], 1),
        "spot_change": round(tape[-1]["spot"] - tape[0]["spot"], 1),
        "at_1110": {
            "spot": spot[i110],
            "ridge_itm_pts": round(RIDGE_STRIKE - spot[i110], 1),
            "itm_pe_vol": itm_pe_vol(i110),
            "itm_pe_vol_median_prior": round(med_prior_vol, 2),
            "itm_pe_doi": itm_pe_doi(i110),
            "itm_pe_doi_median_prior": round(med_prior_doi, 2),
            "post_doi_sum": round(sum(post_doi), 2),
            "post_positive": sum(1 for v in post_doi if v > 0),
            "post_buckets": len(post_doi),
            "ridge_vol": ridge_vol[i110],
            "ridge_doi": ridge_oi[i110],
        },
        "build_1155_1205": {
            "oi_start": oi_start,
            "oi_end": oi_end,
            "d_oi": build_doi,
            "vol": build_vol,
            "ridge_peak_vol": round(peak_vol, 2),
            "ridge_peak_vol_at": peak_vol_at,
            "ridge_peak_doi": round(peak_doi, 2),
            "ridge_peak_doi_at": peak_doi_at,
        },
        "median_pe_vol_cell": median_cell,
        "futures_window": fut["window"],
        "futures_unwind": fut["unwind"],
        "iv": iv["coverage"],
        "itm_name": itm_name,
    }


def build_payload():
    ctx, tape, snaps, candles = fixtures()
    terrain = build_terrain(tape)
    iv = build_iv(snaps, tape)
    fut = build_futures(candles)
    facts = build_facts(tape, terrain, iv, fut)

    generated = datetime.now(IST).isoformat(timespec="seconds")
    return {
        "meta": {
            "session": SESSION,
            "symbol": ctx["underlying"],
            "expiry": ctx["expiry"],
            "generated": generated,
            "tape_first": tape[0]["t"],
            "tape_last": tape[-1]["t"],
            "tape_rows": len(tape),
            "snapshot_rows": len(snaps),
            "futures_rows": fut["rows_used"],
            "futures_file_last": fut["clipped_from"],
            "chain_rows": ctx.get("chain10s_rows"),
            "files": {
                "tape": str(TAPE_FILE.relative_to(ROOT)),
                "chain": str(CHAIN_FILE.relative_to(ROOT)),
                "snapshots": str(SNAP_FILE.relative_to(ROOT)),
                "futures": str(FUT_FILE.relative_to(ROOT)),
            },
        },
        "headline": {
            "spot_open": facts["spot_open"],
            "spot_last": facts["spot_last"],
            "spot_change": facts["spot_change"],
            "futures_last": fut["points"][-1]["close"],
        },
        "terrain": terrain,
        "iv": iv,
        "futures": fut,
        "facts": facts,
    }


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NIFTY 3D — terrain, IV surface, futures path · 2026-11-17</title>
<style>
  :root {
    --bg: #000000;
    --surface: #13161C;
    --raised: #1F242D;
    --border: #2C313B;
    --text: #E8E8E8;
    --muted: #9B9B9B;
    --amber: #D9902A;
    --pe: #FF8A3D;
    --ce: #4F8BFF;
    --pos: #2FA36B;
    --neg: #E5606A;
    --info: #4A8FD8;
    --warn: #C9912F;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--text); }
  body {
    font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    padding: 24px clamp(12px, 2.5vw, 32px) 56px;
    overflow-x: hidden;
  }
  .wrap { max-width: 1600px; margin: 0 auto; min-width: 0; }
  header {
    display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;
    gap: 16px; margin-bottom: 18px; padding-bottom: 16px; border-bottom: 1px solid var(--border);
  }
  h1 { font-size: clamp(22px, 2.4vw, 30px); line-height: 1.15; margin: 0 0 6px; letter-spacing: -.02em; }
  h1 .thin { color: var(--muted); font-weight: 400; }
  h2 { font-size: 15px; margin: 0; letter-spacing: -.01em; }
  h3 { font-size: 10px; margin: 0; color: var(--muted); text-transform: uppercase; letter-spacing: .1em; }
  .kicker { color: var(--amber); font: 600 10px/1.2 var(--mono); letter-spacing: .14em; text-transform: uppercase; margin-bottom: 7px; }
  .sub { color: var(--muted); font-size: 12px; max-width: 940px; }
  .sub b { color: var(--text); font-weight: 600; }
  .stamp { font: 11px/1.5 var(--mono); color: var(--muted); text-align: right; }
  .stamp b { color: var(--text); }
  .frozen {
    display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--amber);
    color: var(--amber); border-radius: 999px; padding: 6px 11px; font: 600 10px/1 var(--mono);
    letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; margin-top: 8px;
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--amber); }
  .kpis {
    display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 1px;
    background: var(--border); border: 1px solid var(--border); border-radius: 8px;
    overflow: hidden; margin: 0 0 18px;
  }
  .kpi { background: var(--surface); padding: 11px 13px; min-width: 0; }
  .kpi .label { color: var(--muted); font: 600 9px/1.2 var(--mono); letter-spacing: .09em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kpi .value { font: 600 19px/1.25 var(--mono); margin-top: 5px; white-space: nowrap; }
  .kpi .delta { font: 11px/1.3 var(--mono); margin-top: 2px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .up { color: var(--pos); } .down { color: var(--neg); }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px; min-width: 0; }
  .panel-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 20px; margin-bottom: 2px; }
  .panel-head .note { color: var(--muted); font-size: 11.5px; max-width: 820px; }
  .panel-head .right { font: 11px/1.4 var(--mono); color: var(--muted); }
  .caveat { color: var(--warn); }
  .controls {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 10px 0 2px;
    padding: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; min-width: 0;
  }
  .controls .grp { display: inline-flex; gap: 4px; flex-wrap: wrap; }
  .controls .sep { width: 1px; align-self: stretch; background: var(--border); margin: 0 4px; }
  .controls .lbl { font: 600 9px/1 var(--mono); letter-spacing: .09em; text-transform: uppercase; color: var(--muted); margin-right: 2px; }
  button {
    appearance: none; border: 1px solid var(--border); background: transparent; color: var(--muted);
    border-radius: 4px; padding: 0 10px; height: 28px; font: 600 10px/1 var(--mono);
    letter-spacing: .05em; text-transform: uppercase; cursor: pointer; white-space: nowrap;
    transition: color .12s, border-color .12s, background .12s;
  }
  button:hover { color: var(--text); border-color: var(--muted); }
  button[aria-pressed="true"] { color: var(--bg); background: var(--amber); border-color: var(--amber); }
  button:focus-visible { outline: 2px solid var(--info); outline-offset: 1px; }
  .plot { width: 100%; min-width: 0; height: 640px; }
  .plot.iv { height: 560px; }
  .plot.fut { height: 520px; }
  .plot .plot-container { width: 100% !important; }
  .fallback {
    display: none; color: var(--neg); font-size: 12px; border: 1px dashed var(--neg);
    border-radius: 6px; padding: 14px; margin-top: 10px;
  }
  ul.summary { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 8px; }
  ul.summary li { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 13px 15px; font-size: 13px; min-width: 0; }
  ul.summary li .tag { font: 600 9.5px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 6px; }
  ul.summary li b { color: var(--text); }
  ul.summary li code { font: 11px var(--mono); color: var(--text); }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin-top: 8px; font: 10.5px/1.4 var(--mono); color: var(--muted); }
  .legend .item { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .legend .grad { width: 120px; height: 9px; border-radius: 2px; }
  footer { color: var(--muted); font-size: 11.5px; border-top: 1px solid var(--border); padding-top: 14px; display: grid; gap: 6px; }
  footer code { font: 11px var(--mono); color: var(--text); }
  .insufficient { border: 1px dashed var(--warn); color: var(--warn); border-radius: 6px; padding: 16px; font-size: 13px; display: none; }
  @media (max-width: 980px) {
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .plot { height: 520px; }
    .plot.iv, .plot.fut { height: 460px; }
  }
  @media (max-width: 700px) {
    body { padding: 16px 12px 40px; }
    .stamp { text-align: left; }
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .kpi .value { font-size: 16px; }
    .controls { display: grid; grid-template-columns: 1fr; gap: 8px; }
    .controls .sep { display: none; }
    .controls .grp { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .controls button { width: 100%; height: 32px; }
    .plot { height: 400px; }
    .plot.iv, .plot.fut { height: 360px; }
    ul.summary { grid-template-columns: 1fr; }
    .panel { padding: 12px 10px; }
    .panel-head .note { font-size: 11px; }
  }
</style>
</head>
<body>
<div class="wrap">

  <header>
    <div>
      <div class="kicker">NIFTY · 3D view · 17 Nov 2026 · 0DTE</div>
      <h1>Shape of the session <span class="thin">— positioning, vol, futures</span></h1>
      <div class="sub" id="subhead"></div>
      <div class="frozen"><span class="dot"></span><span id="frozen-label"></span></div>
    </div>
    <div class="stamp" id="stamp"></div>
  </header>

  <div class="kpis" id="kpis"></div>

  <section class="panel">
    <div class="panel-head">
      <h2>The read — three views, one clock</h2>
      <div class="note">Every surface below is a 5-minute resample of recorded data. Hover any point for time, strike and value; drag to rotate, scroll to zoom.</div>
    </div>
    <ul class="summary" id="summary" style="margin-top:12px"></ul>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>1 · Positioning terrain</h2>
      <div class="note" id="terrain-note"></div>
      <div class="right" id="terrain-stat"></div>
    </div>
    <div class="controls" role="group" aria-label="Terrain metric and camera">
      <span class="lbl">Metric</span>
      <div class="grp" id="metric-buttons"></div>
      <span class="sep"></span>
      <span class="lbl">Camera</span>
      <div class="grp" id="terrain-cams"></div>
    </div>
    <div id="terrain" class="plot" role="img" aria-label="3D terrain of option positioning by strike and time"></div>
    <div id="terrain-fail" class="fallback">Plotly could not load from the CDN — the 3D view is unavailable in this browser session. The figures in the summary and the data file remain valid.</div>
    <div class="legend" id="terrain-legend"></div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>2 · IV surface</h2>
      <div class="note" id="iv-note"></div>
      <div class="right" id="iv-stat"></div>
    </div>
    <div id="iv-insufficient" class="insufficient"></div>
    <div class="controls" id="iv-controls" role="group" aria-label="IV camera">
      <span class="lbl">Camera</span>
      <div class="grp" id="iv-cams"></div>
    </div>
    <div id="iv" class="plot iv" role="img" aria-label="3D implied volatility surface by strike and time"></div>
    <div id="iv-fail" class="fallback">Plotly could not load from the CDN — the IV surface is unavailable in this browser session.</div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>3 · Futures path — time × OI × price</h2>
      <div class="note" id="fut-note"></div>
      <div class="right" id="fut-stat"></div>
    </div>
    <div id="fut-fail" class="fallback">Plotly could not load from the CDN — the futures path is unavailable in this browser session.</div>
    <div id="fut" class="plot fut" role="img" aria-label="3D futures close and open interest path through the session"></div>
    <div class="legend" id="fut-legend"></div>
  </section>

  <footer>
    <div id="provenance"></div>
    <div id="sources"></div>
    <div class="caveat" id="caveat"></div>
  </footer>
</div>

<script src="https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js"
        onerror="document.getElementById('terrain-fail').style.display='block';document.getElementById('iv-fail').style.display='block';document.getElementById('fut-fail').style.display='block';"></script>
<script>
const DATA = __PAYLOAD__;
const PLOTLY = window.Plotly;
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const C = {
  bg: '#000000', surface: '#13161C', raised: '#1F242D', border: '#2C313B',
  text: '#E8E8E8', muted: '#9B9B9B', amber: '#D9902A',
  pe: '#FF8A3D', ce: '#4F8BFF', pos: '#2FA36B', neg: '#E5606A',
  info: '#4A8FD8', warn: '#C9912F', flat: '#6E86AE',
  ridgePe: '#FFD9A0', ridgeCe: '#BBD4FF'
};

const METRICS = {
  pe_vol: { label: 'PE volume', kind: 'vol', cs: 'PEvol', ridge: 'PE', color: C.pe, unit: 'put volume added / 5 min', z: 'PE volume added (√M)' },
  ce_vol: { label: 'CE volume', kind: 'vol', cs: 'CEvol', ridge: 'CE', color: C.ce, unit: 'call volume added / 5 min', z: 'CE volume added (√M)' },
  pe_oi:  { label: 'PE OI',     kind: 'oi',  cs: 'PEoi',  ridge: 'PE', color: C.pe, unit: 'put OI change / 5 min', z: 'PE OI change (√M)' },
  ce_oi:  { label: 'CE OI',     kind: 'oi',  cs: 'CEoi',  ridge: 'CE', color: C.ce, unit: 'call OI change / 5 min', z: 'CE OI change (√M)' }
};
// signed square root: four orders of magnitude share one height axis, sign survives
const heightOf = (v) => Math.sign(v) * Math.sqrt(Math.abs(v));

const COLORSCALES = {
  PEvol: [[0, '#2A1206'], [0.25, '#7A3A12'], [0.55, '#D06A22'], [0.8, '#FF8A3D'], [1, '#FFE0B8']],
  CEvol: [[0, '#071326'], [0.25, '#123A73'], [0.55, '#2C66C4'], [0.8, '#4F8BFF'], [1, '#CFE1FF']],
  PEoi:  [[0, '#E5606A'], [0.35, '#7A2A31'], [0.5, '#20262E'], [0.65, '#1E6B4A'], [1, '#2FA36B']],
  CEoi:  [[0, '#E5606A'], [0.35, '#7A2A31'], [0.5, '#20262E'], [0.65, '#1E5E8C'], [1, '#4F8BFF']]
};

const F = (v, d = 2) => (v === null || v === undefined) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
const N = (v) => Number(v).toLocaleString('en-IN');
const M = (v, d = 2) => (v === null || v === undefined) ? '—' : Number(v).toFixed(d) + 'M';
const FM = (v, d = 2) => F(v, d) + 'M';

function sceneAxis(title, extra) {
  return Object.assign({
    title: { text: title, font: { size: 10, color: C.muted, family: MONO } },
    gridcolor: C.border, zerolinecolor: C.border,
    showbackground: true, backgroundcolor: 'rgba(31,36,45,0.32)',
    tickfont: { size: 9, color: C.muted, family: MONO },
    showspikes: false, spikecolor: C.muted, spikesides: false
  }, extra || {});
}

function timeTicks() {
  return {
    tickmode: 'array',
    tickvals: [555, 600, 660, 720, 780, 840],
    ticktext: ['09:15', '10:00', '11:00', '12:00', '13:00', '14:00']
  };
}

function camera(eye, up) {
  return { eye: eye, center: { x: 0, y: 0, z: -0.06 }, up: up || { x: 0, y: 0, z: 1 } };
}

const CAM_TERRAIN = {
  reset: camera({ x: 1.25, y: -1.6, z: 1.0 }),
  ridge: camera({ x: 0.8, y: -1.5, z: 1.45 }),
  top: camera({ x: 0, y: -0.05, z: 2.35 }, { x: 0, y: 1, z: 0 }),
  side: camera({ x: 2.0, y: 0.05, z: 0.3 })
};
const CAM_IV = {
  reset: camera({ x: 1.5, y: -1.9, z: 1.0 }),
  front: camera({ x: 0.05, y: -2.3, z: 0.45 }),
  top: camera({ x: 0, y: -0.05, z: 2.55 }, { x: 0, y: 1, z: 0 })
};
const CAM_FUT = {
  reset: camera({ x: 1.3, y: -1.55, z: 1.1 }),
  oi: camera({ x: 0.2, y: -1.85, z: 0.7 }),
  top: camera({ x: 0, y: -0.05, z: 2.35 }, { x: 0, y: 1, z: 0 })
};

const camState = { terrain: CAM_TERRAIN.reset, iv: CAM_IV.reset, fut: CAM_FUT.reset };

// ------------------------------------------------------------------ chrome
function renderChrome() {
  const m = DATA.meta, h = DATA.headline, f = DATA.facts, fut = DATA.futures;
  document.getElementById('subhead').innerHTML =
    `<b>${m.symbol} ${m.expiry}</b> expiry · spot <b>${h.spot_last.toLocaleString('en-IN')}</b> ` +
    `(${F(h.spot_change, 1)} pts on the tape) · ${m.tape_rows} tape minutes, ` +
    `${m.snapshot_rows} report snapshots, ${fut.points.length} futures points`;
  document.getElementById('stamp').innerHTML =
    `<b>${m.session}</b> · tape ${m.tape_first.slice(11, 16)}–${m.tape_last.slice(11, 16)} IST<br>` +
    `built ${m.generated.slice(0, 16).replace('T', ' ')}`;
  document.getElementById('frozen-label').textContent =
    `Frozen at tape end ${m.tape_last.slice(11, 16)} — nothing later is drawn`;

  const w = f.futures_window, b = f.build_1155_1205, a = f.at_1110;
  const kpi = [
    ['Spot, tape last', h.spot_last.toLocaleString('en-IN'), `${F(h.spot_change, 1)} pts vs open ${h.spot_open.toLocaleString('en-IN')}`],
    ['25500 PE OI, 12:05', M(b.oi_end, 1), `${FM(b.d_oi, 2)} across 11:55–12:05`],
    ['11:10 ITM put OI', FM(a.itm_pe_doi, 2), `prior 5-bucket median ${FM(a.itm_pe_doi_median_prior, 2)}`],
    ['Futures 11:45→12:00', F(w.dp, 1) + ' pts', `OI ${F(w.doi / 1000, 0)}k · vol ${N(w.vol)} · ${w.regime_label}`],
    ['IV coverage', `${DATA.iv.coverage.pct}%`, `${DATA.iv.coverage.frames} frames × ${DATA.iv.strikes.length} strikes`]
  ];
  document.getElementById('kpis').innerHTML = kpi.map(([k, v, d]) =>
    `<div class="kpi"><div class="label">${k}</div><div class="value">${v}</div><div class="delta">${d}</div></div>`
  ).join('');

  const un = f.futures_unwind;
  const bullets = [
    ['11:10 · ITM puts expand',
      `Spot ${a.spot.toLocaleString('en-IN')} put the <b>25500 PE ${a.ridge_itm_pts} pts in the money</b>. ` +
      `Puts struck above spot added <b>${FM(a.itm_pe_doi, 2)} OI</b> in the 11:05–11:10 bucket against a ` +
      `${FM(a.itm_pe_doi_median_prior, 2)} median for the five buckets before, then kept adding — ` +
      `<b>${a.post_positive} of the next ${a.post_buckets}</b> buckets positive, ${FM(a.post_doi_sum, 2)} in total. ` +
      `Volume in that bucket was ${M(a.itm_pe_vol, 2)} vs a ${M(a.itm_pe_vol_median_prior, 2)} prior median; ` +
      `the 25500 PE alone added ${M(a.ridge_vol, 2)} volume and ${FM(a.ridge_doi, 2)} OI.`],
    ['11:55–12:05 · the build',
      `The 25500 PE went from <b>${M(b.oi_start, 2)}</b> to <b>${M(b.oi_end, 2)}</b> OI ` +
      `(${FM(b.d_oi, 2)}) while ${M(b.vol, 2)} of volume printed in ten minutes. ` +
      `Its largest single 5-minute OI addition was <b>${FM(b.ridge_peak_doi, 2)}</b> at ${b.ridge_peak_doi_at}.`],
    ['12:00 · futures long buildup',
      `Between 11:45 and 12:00 the futures <b>${F(w.dp, 1)} pts</b> with OI <b>${F(w.doi / 1000, 0)}k</b> ` +
      `and ${N(w.vol)} contracts traded — price up, OI up, ${w.regime_label}. ` +
      `Then 12:15–13:00 ${F(un.dp, 1)} pts with OI ${F(un.doi / 1000, 0)}k: ${un.regime_label}.`],
    ['Shape, not levels',
      `The 3D view is a <b>relative</b> read: the terrain multiplies 5-minute increments by strike, so a tall spike ` +
      `means “more of it here” — not a precise price. <b>Height is a signed √ of the M value</b> so four orders of ` +
      `magnitude share one axis: the largest PE volume bucket is <b>${M(b.ridge_peak_vol, 2)}</b> at ${b.ridge_peak_vol_at} ` +
      `(expiry churn) against a ${M(f.median_pe_vol_cell, 1)} median cell, and on a linear axis that single print would flatten the 11:00–12:10 build. ` +
      `Hover always gives the true M value; the strike axis spans ` +
      `${DATA.terrain.strikes[0].toLocaleString('en-IN')}–${DATA.terrain.strikes[DATA.terrain.strikes.length - 1].toLocaleString('en-IN')}.`],
    ['IV coverage',
      `${DATA.iv.coverage.filled} of ${DATA.iv.coverage.cells} cells ` +
      `(${DATA.iv.coverage.pct}%) carry a usable OTM IV; the thinnest frame still has ` +
      `${DATA.iv.coverage.min_per_frame} of ${DATA.iv.strikes.length} strikes. ` +
      `Snapshots are downsampled to 5 minutes and clipped at the tape end.`]
  ];
  document.getElementById('summary').innerHTML = bullets.map(([tag, text]) =>
    `<li><span class="tag">${tag}</span>${text}</li>`
  ).join('');

  document.getElementById('provenance').innerHTML =
    `<b>Provenance.</b> Tape <code>${m.files.tape}</code> (${m.tape_rows} minutes, ` +
    `${m.tape_first.slice(11, 19)}–${m.tape_last.slice(11, 19)}), snapshots <code>${m.files.snapshots}</code> ` +
    `(${m.snapshot_rows} frames). Chain tuples are <code>[ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]</code>; ` +
    `volumes are cumulative, so the terrain plots <b>increments between 5-minute boundaries</b>, never raw totals.`;
  document.getElementById('sources').innerHTML =
    `<b>Sources.</b> <code>${m.files.futures}</code> — ${m.futures_rows} one-minute candles, clipped at ` +
    `${m.tape_last.slice(11, 16)} (the file itself runs to ${m.futures_file_last.slice(11, 16)}). ` +
    `Colours follow <code>src/ui/palette.ts</code>; rendering is Plotly 3D WebGL, no build step.`;
  document.getElementById('caveat').innerHTML =
    `<b>Caveat.</b> A 3D surface is for relative shape and timing, not exact prices. ` +
    `Rotate the camera before comparing two ridges — occlusion hides the far side of every terrain.`;
}

// ----------------------------------------------------------------- terrain
let terrainMetric = 'pe_oi';

function terrainTraces(metric) {
  const T = DATA.terrain;
  const cfg = METRICS[metric];
  const raw = T.metrics[metric];
  const isOi = cfg.kind === 'oi';
  const z = raw.map(row => row.map(v => Math.round(heightOf(v) * 1000) / 1000));
  const flat = z.flat();
  const lo = Math.min.apply(null, flat);
  const hi = Math.max.apply(null, flat);
  const labels = T.times;
  // hover carries the true (unscaled) value even when height is √-compressed
  const custom = raw.map(row => row.map((v, j) => `${labels[j]} · ${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}M`));

  const traces = [{
    type: 'surface', name: cfg.label,
    x: T.minutes, y: T.strikes, z: z, customdata: custom,
    colorscale: COLORSCALES[cfg.cs],
    cmin: isOi ? lo : 0, cmax: hi,
    cmid: isOi ? 0 : undefined,
    showscale: true,
    colorbar: {
      title: { text: cfg.z.replace(' (M)', ''), side: 'top', font: { size: 9, color: C.muted, family: MONO } },
      thickness: 9, len: 0.62, outlinewidth: 0, ticks: 'outside',
      tickfont: { size: 9, color: C.muted, family: MONO },
      bgcolor: 'rgba(0,0,0,0)'
    },
    contours: { z: { show: false } },
    lighting: { ambient: 0.88, diffuse: 0.45, specular: 0.06, roughness: 0.85, fresnel: 0.05 },
    hovertemplate: `<b>%{customdata}</b><br>strike %{y}<extra>${cfg.label}</extra>`,
    hoverlabel: { bgcolor: C.raised, bordercolor: C.border, font: { color: C.text, family: MONO, size: 11 } }
  }];

  const ridge = T.ridge[metric];
  const lift = Math.max(0.02, Math.abs(hi - lo) * 0.03);
  const ridgeZ = ridge.map(v => Math.round((heightOf(v) + lift) * 1000) / 1000);
  const ridgeHover = ridge.map((v, j) => `${labels[j]} · strike ${T.ridge_strike} · ${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}M`);
  traces.push({
    type: 'scatter3d', mode: 'lines+markers', name: '25500 ridge',
    x: T.minutes, y: T.strikes.map(() => T.ridge_strike), z: ridgeZ,
    customdata: ridgeHover,
    line: { color: cfg.ridge === 'PE' ? C.ridgePe : C.ridgeCe, width: 5 },
    marker: { size: 2.6, color: cfg.ridge === 'PE' ? C.ridgePe : C.ridgeCe, opacity: 0.9 },
    hovertemplate: `<b>%{customdata}</b><extra>25500 ridge</extra>`,
    hoverlabel: { bgcolor: C.raised, bordercolor: C.border, font: { color: C.text, family: MONO, size: 11 } }
  });

  const marks = [
    { t: 11 * 60 + 10, label: '11:10 puts ITM', z: lo + (hi - lo) * 0.94 },
    { t: 12 * 60, label: '12:00 futures bid', z: lo + (hi - lo) * 0.8 }
  ];
  marks.forEach(mk => {
    traces.push({
      type: 'scatter3d', mode: 'text', name: mk.label,
      x: [mk.t], y: [T.strikes[0]], z: [mk.z],
      text: [mk.label], textposition: 'middle center',
      textfont: { size: 10, color: C.amber, family: MONO },
      hoverinfo: 'skip', showlegend: false
    });
  });
  return traces;
}

function terrainLayout(metric) {
  const cfg = METRICS[metric];
  const isOi = cfg.kind === 'oi';
  return {
    paper_bgcolor: C.bg, plot_bgcolor: C.bg,
    margin: { l: 0, r: 0, t: 8, b: 0 },
    font: { family: MONO, color: C.muted, size: 10 },
    scene: {
      bgcolor: C.bg,
      camera: camState.terrain,
      xaxis: sceneAxis('time (IST)', Object.assign({}, timeTicks(), { nticks: 6 })),
      yaxis: sceneAxis('strike', { tickformat: '.0f', nticks: 7 }),
      zaxis: sceneAxis(cfg.z, { nticks: 6, zeroline: isOi }),
      aspectmode: 'manual',
      aspectratio: { x: 1.7, y: 1.0, z: 0.66 },
      dragmode: 'orbit'
    },
    hovermode: 'closest',
    showlegend: false
  };
}

function renderTerrain() {
  const host = document.getElementById('terrain');
  const cfg = METRICS[terrainMetric];
  const traces = terrainTraces(terrainMetric);
  const layout = terrainLayout(terrainMetric);
  if (host.dataset.drawn === '1') {
    PLOTLY.react(host, traces, layout, { responsive: true, displaylogo: false, scrollZoom: true });
  } else {
    PLOTLY.newPlot(host, traces, layout, { responsive: true, displaylogo: false, scrollZoom: true });
    host.dataset.drawn = '1';
    host.on('plotly_relayout', ev => {
      if (ev['scene.camera']) camState.terrain = ev['scene.camera'];
    });
  }
  document.getElementById('metric-buttons').querySelectorAll('button').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.metric === terrainMetric));
  });

  const T = DATA.terrain;
  const ridge = T.ridge[terrainMetric];
  const peakIdx = ridge.indexOf(Math.max.apply(null, ridge));
  document.getElementById('terrain-note').innerHTML =
    `x = time, depth = strike, height = ${cfg.unit} on a <b>signed √ scale</b> — volume reaches 95M and OI ±14M, ` +
    `so a linear axis would flatten the 11:55–12:05 build; hover always reports the true M value. ` +
    `The pale line rides the <b>25500 ${cfg.ridge} ridge</b>; 4 metrics share one grid, so switching metric keeps the same camera.`;
  document.getElementById('terrain-stat').textContent =
    `peak 25500 ${cfg.ridge} ${FM(ridge[peakIdx])} at ${T.times[peakIdx]}`;
  document.getElementById('terrain-legend').innerHTML =
    `<span class="item"><span class="swatch" style="background:${cfg.color}"></span>${cfg.unit}</span>` +
    `<span class="item"><span class="swatch" style="background:${cfg.ridge === 'PE' ? C.ridgePe : C.ridgeCe}"></span>25500 ${cfg.ridge} ridge</span>` +
    `<span class="item">${T.strikes.length} strikes × ${T.times.length} buckets</span>` +
    `<span class="item">height = signed √M · hover = true M</span>` +
    `<span class="item">drag = rotate · scroll = zoom</span>`;
}

// ----------------------------------------------------------------- IV
function ivTraces() {
  const I = DATA.iv;
  const z = I.z;
  const all = z.flat().filter(v => v !== null && v !== undefined);
  const lo = Math.floor(Math.min.apply(null, all));
  const hi = Math.ceil(Math.max.apply(null, all));
  const custom = z.map(() => I.times.slice());
  return [{
    type: 'surface', name: 'OTM IV',
    x: I.minutes, y: I.strikes, z: z, customdata: custom,
    colorscale: [[0, '#0B1B33'], [0.2, '#1E4B8F'], [0.45, '#3F86D8'], [0.65, '#5FBFA8'], [0.82, '#D9B45A'], [1, '#E5606A']],
    cmin: lo, cmax: hi, connectgaps: false,
    colorbar: {
      title: { text: 'IV %', side: 'top', font: { size: 9, color: C.muted, family: MONO } },
      thickness: 9, len: 0.62, outlinewidth: 0, ticks: 'outside',
      tickfont: { size: 9, color: C.muted, family: MONO }
    },
    contours: { z: { show: false } },
    lighting: { ambient: 0.7, diffuse: 0.65, specular: 0.16, roughness: 0.68, fresnel: 0.1 },
    hovertemplate: `<b>%{customdata}</b><br>strike %{y}<br>IV <b>%{z:.1f}%</b><extra></extra>`,
    hoverlabel: { bgcolor: C.raised, bordercolor: C.border, font: { color: C.text, family: MONO, size: 11 } }
  }];
}

function ivLayout() {
  return {
    paper_bgcolor: C.bg, plot_bgcolor: C.bg,
    margin: { l: 0, r: 0, t: 8, b: 0 },
    font: { family: MONO, color: C.muted, size: 10 },
    scene: {
      bgcolor: C.bg,
      camera: camState.iv,
      xaxis: sceneAxis('time (IST)', Object.assign({}, timeTicks(), { nticks: 6 })),
      yaxis: sceneAxis('strike', { tickformat: '.0f', nticks: 7 }),
      zaxis: sceneAxis('IV %', { nticks: 6 }),
      aspectmode: 'manual',
      aspectratio: { x: 1.55, y: 1.0, z: 0.7 },
      dragmode: 'orbit'
    },
    showlegend: false
  };
}

function renderIv() {
  const I = DATA.iv;
  const host = document.getElementById('iv');
  document.getElementById('iv-note').textContent = I.note;
  document.getElementById('iv-stat').textContent =
    `${I.coverage.filled}/${I.coverage.cells} cells · ${I.coverage.min_per_frame}-${I.strikes.length} strikes per frame`;
  if (!I.sufficient) {
    document.getElementById('iv-insufficient').style.display = 'block';
    document.getElementById('iv-insufficient').textContent =
      'Insufficient IV coverage: the snapshots did not carry a usable OTM IV across enough strikes and frames to build an honest surface. No surface is drawn rather than interpolating one that was never recorded.';
    document.getElementById('iv-controls').style.display = 'none';
    return;
  }
  PLOTLY.newPlot(host, ivTraces(), ivLayout(), { responsive: true, displaylogo: false, scrollZoom: true });
  host.on('plotly_relayout', ev => {
    if (ev['scene.camera']) camState.iv = ev['scene.camera'];
  });
}

// ----------------------------------------------------------------- futures
function futTraces() {
  const P = DATA.futures.points;
  const colors = P.map(p => (p.regime === 'long_buildup' ? C.pos
    : p.regime === 'short_buildup' ? C.neg
      : p.regime === 'long_unwind' ? C.warn
        : p.regime === 'short_cover' ? C.info : C.flat));
  const labels = P.map(p => `${p.t} · ${p.close.toFixed(1)} · OI ${p.oi.toFixed(2)}M · vol ${N(p.vol)} · ${p.regime_label}`);

  const floor = Math.min.apply(null, P.map(p => p.close)) - 6;
  const traces = [
    {
      // projection of the same points onto the price floor: a reading aid, not extra data
      type: 'scatter3d', mode: 'markers', name: 'floor projection',
      x: P.map(p => p.min), y: P.map(() => floor), z: P.map(p => p.oi),
      hoverinfo: 'skip', showlegend: false,
      marker: { size: 2, color: colors, opacity: 0.32, line: { width: 0 } }
    },
    {
      type: 'scatter3d', mode: 'lines+markers', name: 'futures path',
      x: P.map(p => p.min), y: P.map(p => p.close), z: P.map(p => p.oi),
      text: labels, hoverinfo: 'text',
      line: { color: 'rgba(180,180,180,0.65)', width: 4 },
      marker: { size: 4, color: colors, line: { width: 0 } },
      hoverlabel: { bgcolor: C.raised, bordercolor: C.border, font: { color: C.text, family: MONO, size: 11 } }
    }
  ];

  const seg = P.filter(p => p.min >= 11 * 60 + 45 && p.min <= 12 * 60);
  if (seg.length) {
    traces.push({
      type: 'scatter3d', mode: 'lines+markers', name: '11:45–12:00',
      x: seg.map(p => p.min), y: seg.map(p => p.close), z: seg.map(p => p.oi),
      text: seg.map(p => `${p.t} · ${p.close.toFixed(1)} · OI ${p.oi.toFixed(2)}M (+${N(p.doi)})`),
      hoverinfo: 'text',
      line: { color: C.ridgePe, width: 8 },
      marker: { size: 7, color: C.ridgePe, line: { color: C.bg, width: 1 } },
      hoverlabel: { bgcolor: C.raised, bordercolor: C.border, font: { color: C.text, family: MONO, size: 11 } }
    });
    const last = seg[seg.length - 1];
    traces.push({
      type: 'scatter3d', mode: 'text', name: 'annotation',
      x: [last.min + 18], y: [last.close + 2], z: [last.oi + 0.05],
      text: [`11:45–12:00 long buildup<br>${F(DATA.futures.window.dp, 1)} pts · OI ${F(DATA.futures.window.doi / 1000, 0)}k`],
      textfont: { size: 10, color: C.ridgePe, family: MONO },
      hoverinfo: 'skip', showlegend: false
    });
  }
  return traces;
}

function futLayout() {
  const P = DATA.futures.points;
  const closes = P.map(p => p.close);
  const ois = P.map(p => p.oi);
  return {
    paper_bgcolor: C.bg, plot_bgcolor: C.bg,
    margin: { l: 0, r: 0, t: 8, b: 0 },
    font: { family: MONO, color: C.muted, size: 10 },
    scene: {
      bgcolor: C.bg,
      camera: camState.fut,
      xaxis: sceneAxis('time (IST)', Object.assign({}, timeTicks(), { nticks: 6 })),
      yaxis: sceneAxis('futures close', {
        nticks: 6, range: [Math.min.apply(null, closes) - 8, Math.max.apply(null, closes) + 8], tickformat: '.0f'
      }),
      zaxis: sceneAxis('OI (M contracts)', {
        nticks: 6, range: [Math.min.apply(null, ois) - 0.05, Math.max.apply(null, ois) + 0.05], tickformat: '.1f'
      }),
      aspectmode: 'manual',
      aspectratio: { x: 1.45, y: 1.0, z: 0.72 },
      dragmode: 'orbit'
    },
    showlegend: false
  };
}

function renderFutures() {
  const F_ = DATA.futures;
  const host = document.getElementById('fut');
  const w = F_.window;
  document.getElementById('fut-note').innerHTML =
    `One line for the whole session: height is open interest, depth is price. The pale segment is ` +
    `the <b>11:45–12:00 long buildup</b> (+${w.dp.toFixed(1)} pts, OI +${N(w.doi)}, ${N(w.vol)} lots), ` +
    `coloured points are the per-step regime.`;
  document.getElementById('fut-stat').textContent =
    `${F_.points.length} points · ${F_.step_min}-minute steps · ${F_.rows_used} candles clipped`;
  PLOTLY.newPlot(host, futTraces(), futLayout(), { responsive: true, displaylogo: false, scrollZoom: true });
  host.on('plotly_relayout', ev => {
    if (ev['scene.camera']) camState.fut = ev['scene.camera'];
  });
  const legend = [
    ['long buildup', C.pos], ['short buildup', C.neg], ['long unwinding', C.warn], ['short covering', C.info], ['flat', C.flat]
  ];
  document.getElementById('fut-legend').innerHTML =
    legend.map(([l, c]) => `<span class="item"><span class="swatch" style="background:${c}"></span>${l}</span>`).join('') +
    `<span class="item"><span class="swatch" style="background:${C.ridgePe}"></span>11:45–12:00</span>`;
}

// ----------------------------------------------------------------- controls
function buildButtons(hostId, items, onPick, isActive) {
  const host = document.getElementById(hostId);
  host.innerHTML = '';
  items.forEach(it => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.label;
    b.dataset.metric = it.id || '';
    b.dataset.cam = it.id || '';
    b.setAttribute('aria-pressed', String(isActive(it.id)));
    b.addEventListener('click', () => onPick(it.id));
    host.appendChild(b);
  });
}

function syncButtons(hostId, activeId) {
  document.getElementById(hostId).querySelectorAll('button').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.cam === activeId));
  });
}

function applyCamera(sceneKey, host, cam) {
  camState[sceneKey] = cam;
  PLOTLY.relayout(host, { 'scene.camera': cam });
}

function wireControls() {
  buildButtons('metric-buttons',
    Object.keys(METRICS).map(k => ({ id: k, label: METRICS[k].label })),
    id => { terrainMetric = id; renderTerrain(); },
    id => id === terrainMetric);

  const terrainCams = [
    { id: 'reset', label: 'Reset' }, { id: 'ridge', label: 'Ridge' },
    { id: 'top', label: 'Top' }, { id: 'side', label: 'Side' }
  ];
  buildButtons('terrain-cams', terrainCams, id => {
    applyCamera('terrain', 'terrain', CAM_TERRAIN[id]);
    syncButtons('terrain-cams', id);
  }, id => id === 'reset');

  const ivCams = [{ id: 'reset', label: 'Reset' }, { id: 'front', label: 'Front' }, { id: 'top', label: 'Top' }];
  buildButtons('iv-cams', ivCams, id => {
    applyCamera('iv', 'iv', CAM_IV[id]);
    syncButtons('iv-cams', id);
  }, id => id === 'reset');

  // futures uses the same camera keys on its own host
  const futCams = [{ id: 'reset', label: 'Reset' }, { id: 'oi', label: 'OI face' }, { id: 'top', label: 'Top' }];
  const bar = document.createElement('div');
  bar.className = 'controls';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Futures camera');
  bar.innerHTML = '<span class="lbl">Camera</span><div class="grp" id="fut-cams"></div>';
  document.getElementById('fut').before(bar);
  buildButtons('fut-cams', futCams, id => {
    applyCamera('fut', 'fut', CAM_FUT[id]);
    syncButtons('fut-cams', id);
  }, id => id === 'reset');
}

// ----------------------------------------------------------------- boot
function boot() {
  if (!PLOTLY) return;
  renderChrome();
  renderTerrain();
  renderIv();
  renderFutures();
  wireControls();

  let t = null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      ['terrain', 'iv', 'fut'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.dataset.drawn !== undefined) PLOTLY.Plots.resize(el);
      });
    }, 160);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
</script>
</body>
</html>
"""


def render_html(payload: dict) -> str:
    compact = json.dumps(payload, separators=(",", ":"), allow_nan=False)
    return TEMPLATE.replace("__PAYLOAD__", compact)


def validate(html: str, payload: dict) -> list[str]:
    notes = []
    checks = {
        "plotly": "plotly" in html.lower(),
        "surface trace": "'surface'" in html,
        "scatter3d": "scatter3d" in html,
        "no placeholder": "__PAYLOAD__" not in html,
        "no todo marker": "TODO" not in html and "FIXME" not in html,
    }
    for name, ok in checks.items():
        if not ok:
            raise SystemExit(f"validation failed: {name}")
        notes.append(f"{name}: ok")

    terrain = payload["terrain"]
    cells = sum(len(row) for row in terrain["metrics"]["pe_vol"])
    points = {
        "terrain_cells_per_metric": cells,
        "terrain_metrics": len(terrain["metrics"]),
        "iv_cells": payload["iv"]["coverage"]["cells"],
        "iv_filled": payload["iv"]["coverage"]["filled"],
        "futures_points": len(payload["futures"]["points"]),
    }
    if not payload["iv"]["sufficient"]:
        notes.append("IV coverage below threshold — surface suppressed by design")
    return notes + [f"{k}: {v}" for k, v in points.items()]


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = build_payload()
    OUT_JSON.write_text(json.dumps(payload, indent=1))

    html = render_html(payload)
    OUT_HTML.write_text(html)

    notes = validate(html, payload)
    size = OUT_HTML.stat().st_size
    if size > 10 * 1024 * 1024:
        raise SystemExit(f"HTML too large: {size:,} B")

    print(f"wrote {OUT_JSON.relative_to(ROOT)} ({OUT_JSON.stat().st_size:,} B)")
    print(f"wrote {OUT_HTML.relative_to(ROOT)} ({size:,} B)")
    for n in notes:
        print(" ", n)
    f = payload["facts"]
    print(f"terrain: {len(payload['terrain']['strikes'])} strikes x "
          f"{len(payload['terrain']['times'])} buckets x 4 metrics")
    print(f"iv: {payload['iv']['coverage']['pct']}% coverage, "
          f"{payload['iv']['coverage']['frames']} frames")
    print(f"futures 11:45-12:00 {f['futures_window']['dp']:+.1f} pts, "
          f"OI {f['futures_window']['doi']:+,}, vol {f['futures_window']['vol']:,}")


if __name__ == "__main__":
    main()
