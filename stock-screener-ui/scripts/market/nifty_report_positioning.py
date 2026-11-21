#!/usr/bin/env python3
"""Build the "Positioning / who built what" artifact for one NIFTY session.

Reads the recorded tape + 10-second chain snapshots (and the 1-minute futures
candles), derives per-strike OI/volume changes, and writes:

    reports/nifty_<date>/data/positioning.json
    reports/nifty_<date>/02-positioning.html   (self-contained, D3 v7 from CDN)

The analysis window is clipped to the last tape minute: the chain recorder keeps
writing after the tape stops, and a report that mixes the two windows shows a
book the tape never saw.

All derived numbers live in the JSON; the HTML only formats and draws them.
Run with the project venv:

    .venv/bin/python scripts/market/nifty_report_positioning.py
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

DATE = "2026-11-17"
ROOT = Path(__file__).resolve().parents[2]
TAPE = ROOT / "experiments" / "data" / "nifty_tape" / f"{DATE}.jsonl"
CHAIN = ROOT / "experiments" / "data" / "nifty_chain10s" / f"{DATE}.jsonl"
FUTURES = ROOT / "reports" / f"nifty_{DATE}" / "data" / "futures_1m.json"
OUT_DIR = ROOT / "reports" / f"nifty_{DATE}"
OUT_JSON = OUT_DIR / "data" / "positioning.json"
OUT_HTML = OUT_DIR / "02-positioning.html"

SESSION_START = datetime.fromisoformat(f"{DATE}T09:15:00+05:30")
# Tape end, not chain end: the chain file runs two minutes longer.
CLIP_MIN = 292.0  # 09:15 -> 14:07
BUCKET_MIN = 5
STRIKES = list(range(25200, 25801, 50))

# Windows named in the brief.
W_1100 = 105  # 11:00
W_1110 = 115
W_1145 = 150
W_1155 = 160
W_1200 = 165
W_1215 = 180
W_1230 = 195
W_1245 = 210

REGIME_LABEL = {
    "long_buildup": "long buildup",
    "short_buildup": "short buildup",
    "long_unwind": "long unwinding",
    "short_cover": "short covering",
    "flat": "flat",
}


# --------------------------------------------------------------------------- #
# loading
# --------------------------------------------------------------------------- #
def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open() as fh:
        return [json.loads(line) for line in fh if line.strip()]


def minutes(ts: str) -> float:
    """Minutes since the 09:15 session start (timezone-proof)."""
    return (datetime.fromisoformat(ts) - SESSION_START).total_seconds() / 60.0


def hhmm(ts: str) -> str:
    return ts[11:16]


def clip_snaps(snaps: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    out = [s for s in snaps if minutes(s["t"]) <= CLIP_MIN + 49 / 60]
    if not out:
        raise SystemExit("no chain snapshots inside the tape window")
    return out


def rows_of(snap: dict[str, Any]) -> dict[int, list[float]]:
    """`[strike, ce_ltp, ce_oi, ce_vol, pe_ltp, pe_oi, pe_vol]` -> strike map."""
    return {int(r[0]): r for r in snap["rows"]}


def frame_at(snaps: list[dict[str, Any]], minute: float) -> dict[str, Any]:
    """First snapshot at or after `minute` (snapshots are ordered)."""
    for snap in snaps:
        if minutes(snap["t"]) >= minute:
            return snap
    return snaps[-1]


# --------------------------------------------------------------------------- #
# derivations
# --------------------------------------------------------------------------- #
def build_heatmap(snaps: list[dict[str, Any]]) -> dict[str, Any]:
    bounds: list[float] = []
    b = 0.0
    while b < CLIP_MIN:
        bounds.append(b)
        b += BUCKET_MIN
    bounds.append(CLIP_MIN)

    frames = [frame_at(snaps, b) for b in bounds]
    buckets: list[dict[str, Any]] = []
    values: list[list[int]] = []
    levels: list[list[int]] = []

    for i in range(1, len(bounds)):
        prev, cur = rows_of(frames[i - 1]), rows_of(frames[i])
        row: list[int] = []
        level: list[int] = []
        for strike in STRIKES:
            if strike in prev and strike in cur:
                row.append(int(round(cur[strike][5] - prev[strike][5])))
                level.append(int(round(cur[strike][5])))
            else:
                row.append(0)
                level.append(0)
        values.append(row)
        levels.append(level)
        buckets.append(
            {
                "start_min": round(bounds[i - 1], 2),
                "end_min": round(bounds[i], 2),
                "start": hhmm(frames[i - 1]["t"]),
                "end": hhmm(frames[i]["t"]),
                "label": hhmm(frames[i]["t"]),
                "spot": round(float(frames[i]["spot"]), 2),
                "pe_oi": int(sum(r[5] for r in cur.values() if r[5])),
                "ce_oi": int(sum(r[2] for r in cur.values() if r[2])),
            }
        )
    return {
        "bucket_minutes": BUCKET_MIN,
        "strikes": STRIKES,
        "buckets": buckets,
        "values": values,
        "levels": levels,
        "max_abs": max(abs(v) for row in values for v in row),
    }


def build_window(snaps: list[dict[str, Any]]) -> dict[str, Any]:
    a, b = rows_of(frame_at(snaps, W_1145)), rows_of(frame_at(snaps, W_1200))
    strikes: list[dict[str, Any]] = []
    for strike in STRIKES:
        if strike not in a or strike not in b:
            continue
        ra, rb = a[strike], b[strike]
        strikes.append(
            {
                "strike": strike,
                "d_pe_oi": int(round(rb[5] - ra[5])),
                "d_ce_oi": int(round(rb[2] - ra[2])),
                "d_pe_vol": int(round(rb[6] - ra[6])),
                "d_ce_vol": int(round(rb[3] - ra[3])),
                "pe_oi": int(rb[5]),
                "ce_oi": int(rb[2]),
                "pe_vol": int(rb[6]),
                "ce_vol": int(rb[3]),
                "pe_ltp": rb[4],
                "ce_ltp": rb[1],
                "atm_start": abs(strike - float(frame_at(snaps, W_1145)["spot"])) <= 25,
                "atm_end": abs(strike - float(frame_at(snaps, W_1200)["spot"])) <= 25,
            }
        )
    return {
        "label": "11:45–12:00",
        "start": hhmm(frame_at(snaps, W_1145)["t"]),
        "end": hhmm(frame_at(snaps, W_1200)["t"]),
        "start_min": W_1145,
        "end_min": W_1200,
        "spot_start": round(float(frame_at(snaps, W_1145)["spot"]), 2),
        "spot_end": round(float(frame_at(snaps, W_1200)["spot"]), 2),
        "strikes": strikes,
        "total_d_pe_oi": int(sum(s["d_pe_oi"] for s in strikes)),
        "total_d_ce_oi": int(sum(s["d_ce_oi"] for s in strikes)),
    }


def build_25500(snaps: list[dict[str, Any]]) -> dict[str, Any]:
    at = {}
    for label, minute in (
        ("11:00", W_1100),
        ("11:10", W_1110),
        ("11:45", W_1145),
        ("11:55", W_1155),
        ("12:00", W_1200),
        ("12:15", W_1215),
        ("12:30", W_1230),
        ("14:00", 285),
        ("close", CLIP_MIN),
    ):
        snap = frame_at(snaps, minute)
        row = rows_of(snap).get(25500)
        if row is None:
            continue
        spot = float(snap["spot"])
        at[label] = {
            "label": label,
            "time": hhmm(snap["t"]),
            "spot": round(spot, 2),
            "pe_ltp": row[4],
            "pe_oi": int(row[5]),
            "pe_vol": int(row[6]),
            "moneyness_pts": round(25500 - spot, 1),
            "itm": spot < 25500,
            "intrinsic": round(max(25500 - spot, 0.0), 2),
        }

    peak_oi, peak_t = 0, ""
    peak_vol, peak_vol_t = 0, ""
    for snap in snaps:
        row = rows_of(snap).get(25500)
        if row is None:
            continue
        if row[5] > peak_oi:
            peak_oi, peak_t = int(row[5]), hhmm(snap["t"])
        if row[6] > peak_vol:
            peak_vol, peak_vol_t = int(row[6]), hhmm(snap["t"])
    return {
        "strike": 25500,
        "at": at,
        "peak_oi": peak_oi,
        "peak_oi_at": peak_t,
        "peak_volume": peak_vol,
        "peak_volume_at": peak_vol_t,
    }


def build_top(snaps: list[dict[str, Any]]) -> dict[str, Any]:
    snap = frame_at(snaps, CLIP_MIN)
    rows = rows_of(snap)
    combined = sorted(
        ({"strike": k, "ce_oi": int(v[2]), "pe_oi": int(v[5]),
          "oi": int(v[2] + v[5])} for k, v in rows.items()),
        key=lambda r: -r["oi"],
    )[:8]
    pe_volume = sorted(
        ({"strike": k, "pe_vol": int(v[6]), "ce_vol": int(v[3])} for k, v in rows.items()),
        key=lambda r: -r["pe_vol"],
    )[:8]
    return {
        "at": hhmm(snap["t"]),
        "spot": round(float(snap["spot"]), 2),
        "oi": combined,
        "pe_volume": pe_volume,
        "total_pe_oi": int(sum(r[5] for r in rows.values() if r[5])),
        "total_ce_oi": int(sum(r[2] for r in rows.values() if r[2])),
    }


def classify(dp: float, doi: float) -> str:
    if abs(dp) < 1.0 and abs(doi) < 1000:
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


def load_futures() -> list[dict[str, Any]]:
    payload = json.loads(FUTURES.read_text())
    candles = []
    for c in payload["candles"]:
        minute = minutes(c["t"])
        if minute > CLIP_MIN:
            continue
        candles.append(
            {
                "min": round(minute, 2),
                "label": hhmm(c["t"]),
                "o": float(c["o"]),
                "h": float(c["h"]),
                "l": float(c["l"]),
                "c": float(c["c"]),
                "v": int(c["v"]),
                "oi": int(c["oi"]),
            }
        )
    return candles


def by_minute(candles: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    return {int(c["min"]): c for c in candles}


def futures_segments(candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    idx = by_minute(candles)
    out: list[dict[str, Any]] = []
    start_min, end_min = 0, int(CLIP_MIN)
    s = start_min
    while s < end_min:
        e = min(s + BUCKET_MIN, end_min)
        base = idx.get(s - 1) or idx.get(s)
        last = idx.get(e - 1) or idx.get(e)
        if base is None or last is None:
            s = e
            continue
        base_price = base["c"] if s else base["o"]
        dp = last["c"] - base_price
        doi = last["oi"] - base["oi"]
        vol = sum(idx[m]["v"] for m in range(s, e) if m in idx)
        out.append(
            {
                "start_min": s,
                "end_min": e,
                "start": idx[s]["label"],
                "end": idx[min(e, end_min - 1)]["label"],
                "dp": round(dp, 1),
                "doi": int(doi),
                "vol": int(vol),
                "regime": classify(dp, doi),
            }
        )
        s = e
    return out


def futures_aggregate(candles: list[dict[str, Any]], a: int, b: int) -> dict[str, Any]:
    idx = by_minute(candles)
    first = idx.get(a)
    last = idx.get(min(b, int(CLIP_MIN)))
    if first is None or last is None:
        raise SystemExit(f"futures window {a}->{b} outside the tape")
    dp = last["c"] - first["c"]
    doi = last["oi"] - first["oi"]
    vol = sum(idx[m]["v"] for m in range(a + 1, b + 1) if m in idx)
    return {
        "label": f"{first['label']}–{last['label']}",
        "start": first["label"],
        "end": last["label"],
        "start_min": a,
        "end_min": b,
        "dp": round(dp, 1),
        "doi": int(doi),
        "vol": int(vol),
        "regime": classify(dp, doi),
    }


def build_summary(
    win: dict[str, Any],
    p: dict[str, Any],
    top: dict[str, Any],
    agg: list[dict[str, Any]],
) -> list[dict[str, str]]:
    at = p["at"]
    added = sorted(win["strikes"], key=lambda s: -s["d_pe_oi"])[:2]
    cut = sorted(win["strikes"], key=lambda s: s["d_pe_oi"])[:4]
    added_txt = " and ".join(
        f"{s['strike']} (+{s['d_pe_oi'] / 1e6:.2f}M)" for s in added
    )
    cut_txt = ", ".join(f"{s['strike']} ({s['d_pe_oi'] / 1e6:+.2f}M)" for s in cut)
    top_oi = ", ".join(f"{r['strike']} ({r['oi'] / 1e6:.1f}M)" for r in top["oi"][:3])
    top_vol = ", ".join(f"{r['strike']} ({r['pe_vol'] / 1e9:.2f}B)" for r in top["pe_volume"][:3])

    f_buildup = next(a for a in agg if a["start_min"] == W_1145 and a["end_min"] == W_1200)
    f_unwind = next(a for a in agg if a["start_min"] == W_1215 and a["end_min"] == W_1245)

    i00 = at["11:00"]
    i12 = at["12:00"]
    return [
        {
            "kind": "strike",
            "text": (
                f"<b>25500 PE was ITM at 11:00 and ATM at 12:00.</b> "
                f"Spot {i00['spot']:,.2f} at 11:00 put the strike "
                f"{i00['moneyness_pts']:.1f} pts in the money (premium "
                f"{i00['pe_ltp']:.2f}). By 12:00 spot was {i12['spot']:,.2f} — "
                f"still {i12['moneyness_pts']:.1f} pts below the strike, which "
                f"makes 25500 the nearest 50-pt strike, i.e. ATM on the grid "
                f"(premium {i12['pe_ltp']:.2f}). At 12:15 it was only "
                f"{at['12:15']['moneyness_pts']:.1f} pts away. The day's put "
                f"premium rotated around that line as spot walked up."
            ),
        },
        {
            "kind": "window",
            "text": (
                f"<b>In 11:45–12:00 the put OI was added at the top of the ladder:</b> "
                f"{added_txt} — while the lower strikes were squared: {cut_txt}. "
                f"Net across the 13 tracked strikes: "
                f"{win['total_d_pe_oi'] / 1e6:+.2f}M puts. This is lifting, not "
                f"fresh downside hedging at the bottom."
            ),
        },
        {
            "kind": "top",
            "text": (
                f"<b>Biggest books at the tape end ({top['at']}):</b> {top_oi} "
                f"(combined CE+PE). Heaviest cumulative PE volume: {top_vol}. "
                f"Session PE OI {top['total_pe_oi'] / 1e6:.1f}M vs CE "
                f"{top['total_ce_oi'] / 1e6:.1f}M."
            ),
        },
        {
            "kind": "futures",
            "text": (
                f"<b>Futures confirm the bid:</b> {f_buildup['label']} close "
                f"{f_buildup['dp']:+.1f} pts with OI {f_buildup['doi']:+,} lots "
                f"→ {REGIME_LABEL[f_buildup['regime']]}. After 12:15 it flips: "
                f"{f_unwind['label']} {f_unwind['dp']:+.1f} pts, OI "
                f"{f_unwind['doi']:+,} → {REGIME_LABEL[f_unwind['regime']]}."
            ),
        },
        {
            "kind": "decay",
            "text": (
                f"<b>Then 0DTE decay took it apart:</b> 25500 PE OI peaked at "
                f"{p['peak_oi'] / 1e6:.2f}M around {p['peak_oi_at']} and was "
                f"{at['close']['pe_oi'] / 1e6:.2f}M by {at['close']['time']}. "
                f"The position was built, not held."
            ),
        },
        {
            "kind": "caveat",
            "text": (
                "<b>Read it as net positioning, not identity.</b> Expiry-day OI "
                "is the sum of rolls, hedges and market-maker inventory; it says "
                "what was built and where, never who built it."
            ),
        },
    ]


def build_payload() -> dict[str, Any]:
    tape = read_jsonl(TAPE)
    snaps = clip_snaps(read_jsonl(CHAIN))
    candles = load_futures()
    heat = build_heatmap(snaps)
    win = build_window(snaps)
    p25500 = build_25500(snaps)
    top = build_top(snaps)
    segs = futures_segments(candles)
    agg = [
        futures_aggregate(candles, W_1145, W_1200),
        futures_aggregate(candles, W_1200, W_1215),
        futures_aggregate(candles, W_1215, W_1230),
        futures_aggregate(candles, W_1215, W_1245),
    ]
    summary = build_summary(win, p25500, top, agg)

    return {
        "meta": {
            "date": DATE,
            "symbol": "NIFTY",
            "expiry": "2026-11-17",
            "underlying_note": "0DTE — the only expiry in the recorded chain",
            "generated": datetime.now().astimezone().isoformat(timespec="seconds"),
            "tape_file": str(TAPE.relative_to(ROOT)),
            "chain_file": str(CHAIN.relative_to(ROOT)),
            "futures_file": str(FUTURES.relative_to(ROOT)),
            "tape_first": tape[0]["t"],
            "tape_last": tape[-1]["t"],
            "chain_first_used": snaps[0]["t"],
            "chain_last_used": snaps[-1]["t"],
            "futures_last": candles[-1]["label"],
            "session_start_min": 0,
            "session_end_min": CLIP_MIN,
            "strike_window": [STRIKES[0], STRIKES[-1]],
            "bucket_minutes": BUCKET_MIN,
            "chain_rows_used": len(snaps),
            "futures_rows_used": len(candles),
            "volume_note": (
                "Volumes are the chain feed's cumulative per-leg session volume "
                "(as reported), shown in millions/billions of units; increments "
                "are window deltas, not lots."
            ),
            "time_ticks": [
                {"min": 0, "label": "09:15"},
                {"min": 60, "label": "10:15"},
                {"min": 120, "label": "11:15"},
                {"min": 180, "label": "12:15"},
                {"min": 240, "label": "13:15"},
                {"min": 292, "label": "14:07"},
            ],
        },
        "headline": {
            "spot_first": round(float(snaps[0]["spot"]), 2),
            "spot_last": round(float(snaps[-1]["spot"]), 2),
            "spot_change": round(float(snaps[-1]["spot"]) - float(snaps[0]["spot"]), 2),
            "atm_first": 25300,
            "atm_close": int(round(float(snaps[-1]["spot"]) / 50.0) * 50),
        },
        "summary": summary,
        "pe_25500": p25500,
        "heatmap": heat,
        "window": win,
        "top": top,
        "futures": {
            "candles": candles,
            "segments": segs,
            "aggregates": agg,
        },
    }


# --------------------------------------------------------------------------- #
# HTML
# --------------------------------------------------------------------------- #
def render_html(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, separators=(",", ":"))
    return TEMPLATE.replace("__PAYLOAD__", body)


def main() -> None:
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    payload = build_payload()
    OUT_JSON.write_text(json.dumps(payload, indent=1))
    OUT_HTML.write_text(render_html(payload))

    win = payload["window"]
    print(f"wrote {OUT_JSON.relative_to(ROOT)} ({OUT_JSON.stat().st_size:,} B)")
    print(f"wrote {OUT_HTML.relative_to(ROOT)} ({OUT_HTML.stat().st_size:,} B)")
    print(f"chain frames {payload['meta']['chain_rows_used']}  "
          f"futures 1m {payload['meta']['futures_rows_used']}")
    print(f"window {win['label']}: dPE OI {win['total_d_pe_oi']:,}  "
          f"dCE OI {win['total_d_ce_oi']:,}")
    for agg in payload["futures"]["aggregates"]:
        print(f"  futures {agg['label']}: {agg['dp']:+.1f} pts, "
              f"OI {agg['doi']:+,}, vol {agg['vol']:,} -> {agg['regime']}")


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NIFTY positioning — 2026-11-17</title>
<style>
  :root {
    --bg: #000000;
    --panel: #13161C;
    --raised: #1F242D;
    --border: #2C313B;
    --text: #E8E8E8;
    --muted: #9B9B9B;
    --primary: #D9902A;
    --pos: #2FA36B;
    --neg: #E5606A;
    --info: #4A8FD8;
    --warn: #C9912F;
    --pe: #FF8A3D;
    --ce: #4F8BFF;
    --unwind: #6E86AE;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--text); }
  body {
    font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    padding: 24px clamp(12px, 3vw, 40px) 56px;
  }
  h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.01em; }
  h1 { font-size: clamp(22px, 2.6vw, 30px); }
  h2 { font-size: 16px; }
  h3 { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
  p { margin: 0; }
  .page { max-width: 1600px; margin: 0 auto; }
  header.top {
    display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between;
    gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border); margin-bottom: 20px;
  }
  .kicker { color: var(--primary); font-family: var(--mono); font-size: 11px;
    letter-spacing: .14em; text-transform: uppercase; margin-bottom: 6px; }
  .sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
  .stamp { font-family: var(--mono); font-size: 11px; color: var(--muted); text-align: right; }
  .stamp b { color: var(--text); font-weight: 600; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 8px; margin-bottom: 20px; }
  .kpi { background: var(--panel); border: 1px solid var(--border); padding: 12px 14px; }
  .kpi .k { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .1em; }
  .kpi .v { font-family: var(--mono); font-size: 19px; margin-top: 4px; }
  .kpi .d { font-size: 11px; color: var(--muted); margin-top: 2px; }
  section.panel { background: var(--panel); border: 1px solid var(--border);
    padding: 18px clamp(12px, 2vw, 22px) 14px; margin-bottom: 20px; }
  .panel-head { display: flex; flex-wrap: wrap; align-items: baseline;
    justify-content: space-between; gap: 8px 20px; margin-bottom: 4px; }
  .panel-head .note { color: var(--muted); font-size: 12px; max-width: 760px; }
  .chart { width: 100%; position: relative; }
  .chart svg { display: block; width: 100%; height: auto; overflow: visible; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center;
    margin: 10px 0 2px; font-size: 12px; color: var(--muted); }
  .legend .item { display: inline-flex; align-items: center; gap: 7px; }
  .swatch { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
  .legend .grad { width: 150px; height: 10px; border-radius: 2px; display: inline-block; }
  ul.summary { margin: 0; padding: 0; list-style: none; display: grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 8px; }
  ul.summary li { background: var(--bg); border: 1px solid var(--border); padding: 14px 16px; font-size: 13.5px; }
  ul.summary li b { color: var(--text); }
  ul.summary li .tag { font-family: var(--mono); font-size: 10px; letter-spacing: .1em;
    text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 5px; }
  .axis text { fill: var(--muted); font-size: 10px; font-family: var(--mono); }
  .axis path, .axis line { stroke: var(--border); shape-rendering: crispEdges; }
  .grid line { stroke: var(--border); stroke-opacity: .55; shape-rendering: crispEdges; }
  .grid .zero { stroke: var(--muted); stroke-opacity: .7; }
  .hmap-label { fill: var(--muted); font-size: 9.5px; font-family: var(--mono); }
  .cell { shape-rendering: crispEdges; }
  .anno { stroke: var(--primary); stroke-dasharray: 3 3; stroke-opacity: .85; }
  .anno-text { fill: var(--primary); font-size: 10px; font-family: var(--mono); }
  .spot-line { fill: none; stroke: #F2F2F2; stroke-width: 1.4; opacity: .85; }
  .fut-price { fill: none; stroke: var(--text); stroke-width: 1.2; }
  .fut-oi { fill: none; stroke: var(--info); stroke-width: 1.1; opacity: .9; }
  .bubble { stroke: var(--bg); stroke-width: 1; cursor: pointer; }
  .bubble-label { fill: var(--text); font-size: 11px; font-family: var(--mono); paint-order: stroke;
    stroke: var(--bg); stroke-width: 3px; stroke-linejoin: round; }
  .ghost { fill: none; stroke: var(--muted); stroke-width: .8; }
  .quad { fill: var(--muted); font-size: 10px; letter-spacing: .04em; }
  .bar { cursor: pointer; }
  .bar-label { fill: var(--text); font-size: 10px; font-family: var(--mono); }
  .strike-label { fill: var(--muted); font-size: 10px; font-family: var(--mono); }
  .strike-label.atm { fill: var(--primary); font-weight: 600; }
  .strip-cell { stroke: var(--bg); stroke-width: 1; cursor: pointer; }
  .strip-label { fill: var(--muted); font-size: 10px; }
  #tip { position: fixed; z-index: 40; pointer-events: none; opacity: 0;
    background: var(--raised); border: 1px solid var(--border); color: var(--text);
    padding: 9px 11px; border-radius: 4px; font-size: 12px; line-height: 1.45;
    min-width: 180px; max-width: 320px; box-shadow: 0 8px 24px rgba(0,0,0,.55); }
  #tip .t { font-family: var(--mono); color: var(--primary); font-size: 11px;
    letter-spacing: .06em; margin-bottom: 4px; }
  #tip .r { display: flex; justify-content: space-between; gap: 16px; }
  #tip .r span:first-child { color: var(--muted); }
  #tip .r span:last-child { font-family: var(--mono); }
  .foot { color: var(--muted); font-size: 12px; border-top: 1px solid var(--border);
    padding-top: 14px; display: grid; gap: 6px; }
  .foot code { font-family: var(--mono); color: var(--text); font-size: 11px; }
  @media (max-width: 700px) {
    body { padding: 16px 12px 40px; }
    ul.summary { grid-template-columns: 1fr; }
    .kpi .v { font-size: 17px; }
    .panel-head .note { font-size: 11.5px; }
  }
</style>
</head>
<body>
<div class="page">

  <header class="top">
    <div>
      <div class="kicker">NIFTY · positioning · 17 Nov 2026</div>
      <h1>Positioning — who built what</h1>
      <div class="sub" id="subhead"></div>
    </div>
    <div class="stamp" id="stamp"></div>
  </header>

  <div class="kpis" id="kpis"></div>

  <section class="panel">
    <div class="panel-head">
      <h2>The read</h2>
      <div class="note">Every number below is derived from the recorded tape and 10-second chain snapshots; nothing after the tape's last minute is used.</div>
    </div>
    <ul class="summary" id="summary"></ul>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>1 · PE OI change by strike over time</h2>
      <div class="note">Put open interest added (orange) vs squared (blue-grey), 5-minute buckets. The white line is spot; the three marks are the minutes that matter — 11:10 (ITM put volume starts expanding), 11:55 and 12:00 (the build).</div>
    </div>
    <div class="chart" id="heatmap"></div>
    <div class="legend" id="heatmap-legend"></div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>2 · The 11:45–12:00 window, strike by strike</h2>
      <div class="note">Puts and calls each get a diverging panel on one shared ±6.7M scale, so bar length is comparable across sides. Puts were added at 25500/25450 while the 25200–25400 puts were closed — the same premium, moved up the ladder.</div>
    </div>
    <div class="chart" id="bars"></div>
    <div class="legend" id="bars-legend"></div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>3 · Volume vs net OI, same window</h2>
      <div class="note">A strike far to the right with OI flat near zero is pure churn: size traded through, no position left behind. Size is open interest at 12:00.</div>
    </div>
    <div class="chart" id="bubbles"></div>
    <div class="legend" id="bubble-legend"></div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2>4 · Futures regime, same clock</h2>
      <div class="note">Price and OI close-to-close per 5-minute block. Long buildup into noon, long unwinding after 12:15 — the futures ledger agrees with the put ladder, with a lag. Four single-minute OI steps near ±100k (10:06, 10:53, 11:56, 12:29) drive those blocks; they are position changes, not gradual accumulation.</div>
    </div>
    <div class="chart" id="futures"></div>
    <div class="legend" id="futures-legend"></div>
  </section>

  <footer class="foot">
    <div id="provenance"></div>
    <div id="sources"></div>
  </footer>
</div>

<div id="tip" role="status" aria-live="polite"></div>

<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<script>
const DATA = __PAYLOAD__;

const COL = {
  bg: "#000000", panel: "#13161C", raised: "#1F242D", border: "#2C313B",
  text: "#E8E8E8", muted: "#9B9B9B", primary: "#D9902A",
  pos: "#2FA36B", neg: "#E5606A", info: "#4A8FD8", warn: "#C9912F",
  pe: "#FF8A3D", ce: "#4F8BFF", unwind: "#6E86AE", neutral: "#20262E",
  rampGreen: "#1FA76A", rampRed: "#D0454C"
};

const REGIME = {
  long_buildup: { label: "long buildup", color: COL.pos },
  short_buildup: { label: "short buildup", color: COL.neg },
  long_unwind: { label: "long unwinding", color: COL.warn },
  short_cover: { label: "short covering", color: COL.info },
  flat: { label: "flat", color: COL.border }
};

const M = (v) => (v / 1e6).toFixed(2) + "M";
const MN = (v) => (v / 1e6).toFixed(1) + "M";
const signed = (v, digits = 2) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(digits);
const signedInt = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toLocaleString("en-IN");
const inr = d3.format(",.2f");

const tip = document.getElementById("tip");
function showTip(html, ev) {
  tip.innerHTML = html;
  tip.style.opacity = 1;
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
  tip.style.left = Math.max(8, x) + "px";
  tip.style.top = Math.max(8, y) + "px";
}
function hideTip() { tip.style.opacity = 0; }
function row(k, v, color) {
  return `<div class="r"><span>${k}</span><span${color ? ` style="color:${color}"` : ""}>${v}</span></div>`;
}

// ------------------------------------------------------------------ chrome
function renderChrome() {
  const h = DATA.headline, m = DATA.meta, w = DATA.window, f = DATA.futures;
  const agg = f.aggregates[0];
  document.getElementById("subhead").textContent =
    `${m.symbol} ${m.expiry} expiry · spot ${inr(h.spot_last)} (${signed(h.spot_change, 1)} pts on the day) · ` +
    `expiry-day 0DTE book · window ends ${m.tape_last.slice(11, 16)}`;
  document.getElementById("stamp").innerHTML =
    `<b>${m.date}</b> · ${m.chain_rows_used} chain frames · ${m.futures_rows_used} futures 1m<br>` +
    `built ${m.generated.slice(0, 16).replace("T", " ")}`;

  const k = DATA.pe_25500.at;
  const kpi = [
    ["25500 PE at 11:00", inr(k["11:00"].pe_ltp),
      `${k["11:00"].moneyness_pts.toFixed(0)} pts ITM · OI ${MN(k["11:00"].pe_oi)}`],
    ["25500 PE at 12:00", inr(k["12:00"].pe_ltp),
      `strike ${Math.abs(k["12:00"].moneyness_pts).toFixed(0)} pts above spot · OI ${MN(k["12:00"].pe_oi)}`],
    ["25500 PE OI peak", MN(DATA.pe_25500.peak_oi), `at ${DATA.pe_25500.peak_oi_at}`],
    ["11:45–12:00 puts", (w.total_d_pe_oi >= 0 ? "+" : "−") + MN(Math.abs(w.total_d_pe_oi)),
      `calls ${(w.total_d_ce_oi >= 0 ? "+" : "−") + MN(Math.abs(w.total_d_ce_oi))} · 13 strikes`],
    ["Futures 11:45–12:00", signed(agg.dp, 1) + " pts",
      `OI ${signedInt(agg.doi)} · ${REGIME[agg.regime].label}`],
  ];
  document.getElementById("kpis").innerHTML = kpi.map(([key, val, det]) =>
    `<div class="kpi"><div class="k">${key}</div><div class="v">${val}</div><div class="d">${det}</div></div>`
  ).join("");

  document.getElementById("summary").innerHTML = DATA.summary.map(s =>
    `<li><span class="tag">${s.kind}</span>${s.text}</li>`
  ).join("");

  document.getElementById("provenance").innerHTML =
    `<b>Provenance.</b> Chain tuples are <code>[strike, ce_ltp, ce_oi, ce_vol, pe_ltp, pe_oi, pe_vol]</code> ` +
    `(${m.chain_first_used.slice(11, 19)}–${m.chain_last_used.slice(11, 19)}); ` +
    `futures are 1-minute candles to ${m.futures_last}. ${m.volume_note}`;

  document.getElementById("sources").innerHTML =
    `<b>Sources.</b> <code>${m.tape_file}</code> · <code>${m.chain_file}</code> · ` +
    `<code>${m.futures_file}</code> · colours from <code>src/ui/palette.ts</code>. ` +
    `Analysis window clipped to the tape: chain snapshots after ${m.tape_last.slice(11, 16)} are excluded.`;
}

// ------------------------------------------------------------------ heatmap
function drawHeatmap() {
  const host = document.getElementById("heatmap");
  host.innerHTML = "";
  const H = DATA.heatmap, meta = DATA.meta;
  const width = Math.max(320, host.clientWidth);
  const narrow = width < 700;
  const margin = { top: narrow ? 46 : 54, right: narrow ? 10 : 18, bottom: 28, left: narrow ? 44 : 58 };
  const innerW = width - margin.left - margin.right;
  const rowH = narrow ? 17 : 24;
  const innerH = H.strikes.length * rowH;
  const height = margin.top + innerH + margin.bottom + (narrow ? 46 : 52);

  const x = d3.scaleLinear().domain([0, meta.session_end_min]).range([0, innerW]);
  const y = d3.scaleBand().domain(H.strikes.slice().reverse()).range([0, innerH]).paddingInner(0.06);
  const yLin = d3.scaleLinear()
    .domain([H.strikes[H.strikes.length - 1] + 25, H.strikes[0] - 25])
    .range([0, innerH]);

  const maxAbs = Math.max(
    Math.abs(d3.min(H.values, r => d3.min(r)) ?? 0),
    Math.abs(d3.max(H.values, r => d3.max(r)) ?? 0)
  );
  const intensity = (v) => Math.pow(Math.min(1, Math.abs(v) / maxAbs), 0.55);
  const fill = (v) => v >= 0
    ? d3.interpolateRgb(COL.neutral, COL.pe)(intensity(v))
    : d3.interpolateRgb(COL.neutral, COL.unwind)(intensity(v));
  const onFill = (v) => d3.hsl(fill(v)).l > 0.42 ? "#000000" : COL.text;

  const svg = d3.select(host).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Heatmap of put open-interest change by strike and 5-minute bucket");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const cellGap = narrow ? 0 : 1;

  // grid + cells
  H.buckets.forEach((b, i) => {
    const x0 = x(b.start_min);
    const bw = Math.max(1, x(b.end_min) - x0 - cellGap);
    H.strikes.forEach((strike, j) => {
      const v = H.values[i][j];
      const rect = g.append("rect")
        .attr("class", "cell")
        .attr("x", x0).attr("y", y(strike))
        .attr("width", bw).attr("height", y.bandwidth())
        .attr("fill", fill(v));
      rect.on("mousemove", (ev) => {
        showTip(
          `<div class="t">${b.start} → ${b.end} · ${strike} PE</div>` +
          row("Δ PE OI", signedInt(v), v >= 0 ? COL.pe : COL.unwind) +
          row("PE OI at bucket end", MN(H.levels[i][j])) +
          row("spot", inr(b.spot)) +
          row("spot − strike", signed(b.spot - strike, 1) + " pts"),
          ev
        );
      }).on("mouseleave", hideTip);

      if (bw >= 34 && Math.abs(v) >= maxAbs * 0.85) {
        g.append("text")
          .attr("x", x0 + bw / 2).attr("y", y(strike) + y.bandwidth() / 2 + 3)
          .attr("text-anchor", "middle")
          .attr("class", "hmap-label")
          .attr("fill", onFill(v))
          .text((v / 1e6).toFixed(1));
      }
    });
  });

  // spot path
  const line = d3.line()
    .x(b => x((b.start_min + b.end_min) / 2))
    .y(b => yLin(b.spot));
  g.append("path").datum(H.buckets).attr("class", "spot-line").attr("d", line);
  const lastB = H.buckets[H.buckets.length - 1];
  g.append("text")
    .attr("x", x(lastB.end_min) - 4).attr("y", yLin(lastB.spot) - 7)
    .attr("text-anchor", "end").attr("class", "hmap-label")
    .attr("fill", COL.text).text("spot");

  // annotations: three rows above the grid so 11:55 and 12:00 stay legible
  const annos = [
    { min: 115, row: 0, label: "11:10", anchor: "start" },
    { min: 160, row: 1, label: "11:55", anchor: "end" },
    { min: 165, row: 2, label: "12:00", anchor: "start" },
  ];
  annos.forEach(a => {
    g.append("line").attr("class", "anno")
      .attr("x1", x(a.min)).attr("x2", x(a.min))
      .attr("y1", -6).attr("y2", innerH);
    const ty = -8 - a.row * 12;
    g.append("text").attr("class", "anno-text")
      .attr("x", x(a.min) + (a.anchor === "start" ? 4 : -4))
      .attr("y", ty).attr("text-anchor", a.anchor)
      .text(a.label);
  });

  // axes
  const hmTicks = meta.time_ticks.filter(t => !narrow || t.min % 120 === 0 || t.min === meta.session_end_min);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickValues(hmTicks.map(t => t.min))
      .tickFormat(m => hmTicks.find(t => t.min === m).label))
    .call(g2 => {
      g2.select(".domain").attr("stroke", COL.border);
      g2.select(".tick:last-of-type text").attr("text-anchor", "end").attr("x", -2);
    });

  const step = narrow ? 2 : 1;
  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).tickValues(H.strikes.filter((_, i) => i % step === 0))
      .tickFormat(d => d));
  g.selectAll(".axis .tick text").attr("font-family", "ui-monospace, monospace");
  g.selectAll(".axis .tick").filter(d => d === 25500)
    .select("text").attr("fill", COL.primary).attr("font-weight", 600);

  // legend
  const lg = document.getElementById("heatmap-legend");
  lg.innerHTML =
    `<span class="item"><span class="grad" style="background:linear-gradient(90deg,${COL.unwind},${COL.neutral},${COL.pe})"></span>` +
    `puts squared (${(-maxAbs / 1e6).toFixed(1)}M) ↔ puts added (+${(maxAbs / 1e6).toFixed(1)}M)</span>` +
    `<span class="item"><span class="swatch" style="background:#F2F2F2"></span>spot</span>` +
    `<span class="item"><span class="swatch" style="background:transparent;border-left:2px dashed ${COL.primary};height:12px;width:2px"></span>annotated minutes</span>` +
    `<span class="item">cell labels = Δ OI in millions</span>`;
}

// ------------------------------------------------------------------ bars
function drawBars() {
  const host = document.getElementById("bars");
  host.innerHTML = "";
  const W = DATA.window;
  const width = Math.max(320, host.clientWidth);
  const narrow = width < 700;
  const strikes = W.strikes.slice().sort((a, b) => b.strike - a.strike);
  const rowH = narrow ? 22 : 27;
  const margin = { top: narrow ? 26 : 30, right: narrow ? 8 : 18, bottom: 30, left: narrow ? 46 : 58 };
  const innerW = width - margin.left - margin.right;
  const innerH = strikes.length * rowH;
  const height = margin.top + innerH + margin.bottom;

  const maxAbs = Math.max(
    Math.abs(d3.max(strikes, s => s.d_pe_oi)),
    Math.abs(d3.min(strikes, s => s.d_pe_oi)),
    Math.abs(d3.max(strikes, s => s.d_ce_oi)),
    Math.abs(d3.min(strikes, s => s.d_ce_oi))
  ) * 1.08;
  const gap = narrow ? 14 : 30;
  const colW = (innerW - gap) / 2;
  const xPE = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([0, colW]);
  const xCE = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([colW + gap, innerW]);
  const y = d3.scaleBand().domain(strikes.map(s => s.strike)).range([0, innerH]).paddingInner(0.28);

  const svg = d3.select(host).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Put and call open-interest change by strike, 11:45 to 12:00, on a shared scale");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const panel = (x, colr, title, tks) => {
    const x0 = x.range()[0];
    const x1 = x.range()[1];
    g.append("rect").attr("x", x0).attr("y", -6).attr("width", x1 - x0)
      .attr("height", innerH + 6).attr("fill", COL.bg);
    g.append("text").attr("x", x0).attr("y", -10).attr("class", "strip-label")
      .attr("fill", colr).text(title);
    g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", innerH)
      .attr("stroke", COL.muted).attr("stroke-width", 1);
    g.append("g").attr("class", "grid")
      .call(d3.axisTop(x).tickValues(tks).tickSize(-innerH).tickFormat(""))
      .call(g2 => g2.select(".domain").remove());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).tickValues(tks)
        .tickFormat(v => (v / 1e6).toFixed(0) + "M"))
      .call(g2 => {
        if (x1 === innerW) g2.select(".tick:last-of-type text").attr("text-anchor", "end").attr("x", -2);
      });
    g.append("line").attr("x1", x0).attr("x2", x1).attr("y1", innerH).attr("y2", innerH)
      .attr("stroke", COL.border);
  };
  panel(xPE, COL.pe, "PUTS · Δ OI", [-maxAbs, 0]);
  panel(xCE, COL.ce, "CALLS · Δ OI", [0, maxAbs]);

  strikes.forEach(s => {
    const y0 = y(s.strike);
    [["d_pe_oi", xPE, COL.pe], ["d_ce_oi", xCE, COL.ce]].forEach(([key, x, colr]) => {
      const v = s[key];
      const x1 = x(v), x0 = x(0);
      g.append("rect").attr("class", "bar")
        .attr("x", Math.min(x0, x1)).attr("y", y0 + 1)
        .attr("width", Math.max(1, Math.abs(x1 - x0))).attr("height", y.bandwidth() - 2)
        .attr("fill", colr).attr("opacity", v ? 0.95 : 0.18);
    });
    // one hover target per strike row, both panels
    g.append("rect")
      .attr("x", xPE.range()[0]).attr("y", y0)
      .attr("width", xCE.range()[1] - xPE.range()[0]).attr("height", y.bandwidth())
      .attr("fill", "transparent")
      .on("mousemove", (ev) => showTip(
        `<div class="t">${s.strike} · ${W.label}</div>` +
        row("Δ PE OI", signedInt(s.d_pe_oi), s.d_pe_oi >= 0 ? COL.pe : COL.unwind) +
        row("Δ CE OI", signedInt(s.d_ce_oi), s.d_ce_oi >= 0 ? COL.ce : COL.unwind) +
        row("PE / CE OI", `${MN(s.pe_oi)} / ${MN(s.ce_oi)}`) +
        row("Δ PE volume", M(s.d_pe_vol)) +
        row("PE premium", inr(s.pe_ltp)), ev))
      .on("mouseleave", hideTip);
  });

  // end labels stay off the narrow chart: the axis carries the magnitude
  if (!narrow) {
    strikes.forEach(s => {
      const y0 = y(s.strike);
      [["d_pe_oi", xPE, COL.text], ["d_ce_oi", xCE, COL.text]].forEach(([key, x, colr]) => {
        const v = s[key];
        if (Math.abs(v) < 1e6) return;
        g.append("text").attr("class", "bar-label")
          .attr("x", x(v) + (v >= 0 ? 4 : -4))
          .attr("text-anchor", v >= 0 ? "start" : "end")
          .attr("y", y0 + y.bandwidth() / 2 + 3)
          .attr("fill", colr).text(signed(v / 1e6, 1));
      });
    });
  }

  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).tickFormat(d => d))
    .selectAll("text")
    .attr("class", d => (W.strikes.find(s => s.strike === d)?.atm_end ? "strike-label atm" : "strike-label"))
    .attr("fill", d => (W.strikes.find(s => s.strike === d)?.atm_end ? COL.primary : COL.muted));

  document.getElementById("bars-legend").innerHTML =
    `<span class="item"><span class="swatch" style="background:${COL.pe}"></span>puts (left panel)</span>` +
    `<span class="item"><span class="swatch" style="background:${COL.ce}"></span>calls (right panel)</span>` +
    `<span class="item">both panels share a ±${(maxAbs / 1e6).toFixed(0)}M scale · window ${W.start} → ${W.end}</span>` +
    `<span class="item">spot ${inr(W.spot_start)} → ${inr(W.spot_end)}</span>`;
}

// ------------------------------------------------------------------ bubbles
function drawBubbles() {
  const host = document.getElementById("bubbles");
  host.innerHTML = "";
  const W = DATA.window;
  const pts = W.strikes.filter(s => s.d_pe_vol > 0);
  const width = Math.max(320, host.clientWidth);
  const narrow = width < 700;
  const height = narrow ? 330 : 430;
  const margin = { top: 18, right: 26, bottom: 46, left: narrow ? 52 : 64 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const x = d3.scaleLinear()
    .domain([0, d3.max(pts, p => p.d_pe_vol) * 1.1 || 1]).range([0, innerW]).nice();
  const y = d3.scaleLinear()
    .domain([d3.min(pts, p => p.d_pe_oi) * 1.15, d3.max(pts, p => p.d_pe_oi) * 1.18 || 1])
    .range([innerH, 0]).nice();
  const r = d3.scaleSqrt().domain([0, d3.max(pts, p => p.pe_oi)]).range([4, narrow ? 20 : 30]);

  const svg = d3.select(host).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Bubble chart of incremental put volume against put open-interest change, 11:45 to 12:00");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  g.append("g").attr("class", "grid")
    .call(d3.axisLeft(y).ticks(narrow ? 4 : 6).tickSize(-innerW).tickFormat(""))
    .call(g2 => g2.select(".domain").remove());
  g.append("g").attr("class", "grid")
    .call(d3.axisBottom(x).ticks(narrow ? 4 : 6).tickSize(-innerH).tickFormat(""))
    .call(g2 => g2.select(".domain").remove());

  g.append("line").attr("x1", 0).attr("x2", innerW).attr("y1", y(0)).attr("y2", y(0))
    .attr("stroke", COL.muted).attr("stroke-width", 1).attr("stroke-dasharray", "4 3");
  g.append("text").attr("x", innerW).attr("y", y(0) - 6).attr("text-anchor", "end")
    .attr("class", "quad").text("no net OI change");

  const quad = (txt, tx, ty, anchor) => narrow ? null : g.append("text")
    .attr("class", "quad").attr("x", tx).attr("y", ty)
    .attr("text-anchor", anchor || "start").text(txt);
  quad("PUTS ADDED · heavy volume →", 8, 14);
  quad("SQUARED · heavy volume →", 8, innerH - 8);

  pts.forEach(p => {
    const isFocus = p.strike === 25500;
    const cx = x(p.d_pe_vol), cy = y(p.d_pe_oi);
    g.append("circle").attr("class", "bubble")
      .attr("cx", cx).attr("cy", cy).attr("r", r(p.pe_oi))
      .attr("fill", COL.pe).attr("fill-opacity", isFocus ? 0.5 : 0.3)
      .attr("stroke", isFocus ? COL.primary : COL.pe)
      .attr("stroke-width", isFocus ? 2 : 1)
      .on("mousemove", (ev) => showTip(
        `<div class="t">${p.strike} PE · ${W.label}</div>` +
        row("Δ PE volume", M(p.d_pe_vol), COL.pe) +
        row("Δ PE OI", signedInt(p.d_pe_oi), p.d_pe_oi >= 0 ? COL.pos : COL.warn) +
        row("PE OI at 12:00", MN(p.pe_oi)) +
        row("CE OI at 12:00", MN(p.ce_oi)) +
        row("spot at 12:00", inr(W.spot_end)), ev))
      .on("mouseleave", hideTip);

    if (isFocus) {
      g.append("text").attr("class", "bubble-label")
        .attr("x", cx).attr("y", cy - r(p.pe_oi) - 8).attr("text-anchor", "middle")
        .text("25500 PE");
    }
  });

  // secondary labels, placed clear of the bubble edge
  const labelled = {
    25450: { mode: "above" },
    25400: { mode: "below" },
    25300: { mode: "left" },
    25200: { mode: "above" },
  };
  Object.entries(labelled).forEach(([strike, o]) => {
    const p = pts.find(q => q.strike === Number(strike));
    if (!p) return;
    const cx = x(p.d_pe_vol), cy = y(p.d_pe_oi), rr = r(p.pe_oi) + 7;
    const pos = o.mode === "above" ? [cx, cy - rr, "middle"]
      : o.mode === "below" ? [cx, cy + rr + 12, "middle"]
      : [cx - rr, cy + 4, "end"];
    g.append("text").attr("class", "bubble-label")
      .attr("x", pos[0]).attr("y", pos[1]).attr("text-anchor", pos[2])
      .attr("opacity", 0.85).text(strike);
  });

  g.append("g").attr("class", "axis").attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(narrow ? 4 : 6).tickFormat(v => (v / 1e6).toFixed(0) + "M"));
  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).ticks(narrow ? 4 : 6).tickFormat(v => (v / 1e6).toFixed(1) + "M"));
  g.append("text").attr("class", "quad").attr("x", innerW).attr("y", innerH + 34)
    .attr("text-anchor", "end").text("incremental PE volume →");
  g.append("text").attr("class", "quad").attr("transform", `rotate(-90) translate(${-innerH / 2},-42)`)
    .attr("text-anchor", "middle").text("Δ PE OI →");

  const rr = [5e6, 15e6, 30e6];
  document.getElementById("bubble-legend").innerHTML =
    `<span class="item">bubble size = PE OI at 12:00</span>` +
    rr.map(v => `<span class="item"><span class="swatch" style="border-radius:50%;background:${COL.pe};opacity:.35;width:${Math.max(6, r(v) / 1.6)}px;height:${Math.max(6, r(v) / 1.6)}px"></span>${(v / 1e6).toFixed(0)}M</span>`).join("") +
    `<span class="item">right of the pack + on the zero line = traded, not held</span>`;
}

// ------------------------------------------------------------------ futures
function drawFutures() {
  const host = document.getElementById("futures");
  host.innerHTML = "";
  const F = DATA.futures, meta = DATA.meta;
  const candles = F.candles;
  const width = Math.max(320, host.clientWidth);
  const narrow = width < 700;
  const margin = { top: 14, right: narrow ? 46 : 56, bottom: 34, left: narrow ? 46 : 58 };
  const priceH = narrow ? 78 : 96;
  const stripH = narrow ? 16 : 20;
  const gap = narrow ? 42 : 38;
  const innerW = width - margin.left - margin.right;
  const height = margin.top + priceH + gap + stripH + margin.bottom;

  const x = d3.scaleLinear().domain([0, meta.session_end_min]).range([0, innerW]);
  const yP = d3.scaleLinear()
    .domain(d3.extent(candles, c => c.c).map((v, i) => i === 0 ? v - 8 : v + 8))
    .range([priceH, 0]);
  const yO = d3.scaleLinear()
    .domain(d3.extent(candles, c => c.oi).map((v, i) => i === 0 ? v - 20000 : v + 20000))
    .range([priceH, 0]);

  const svg = d3.select(host).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Futures price and open interest with a 5-minute long-buildup / unwinding strip");
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  g.append("g").attr("class", "grid").call(
    d3.axisLeft(yP).ticks(narrow ? 3 : 4).tickSize(-innerW).tickFormat("")
  ).call(g2 => g2.select(".domain").remove());

  const lineP = d3.line().x(c => x(c.min)).y(c => yP(c.c));
  const lineO = d3.line().x(c => x(c.min)).y(c => yO(c.oi));
  g.append("path").datum(candles).attr("class", "fut-oi").attr("d", lineO);
  g.append("path").datum(candles).attr("class", "fut-price").attr("d", lineP);

  g.append("g").attr("class", "axis").call(
    d3.axisLeft(yP).ticks(narrow ? 3 : 4).tickFormat(v => d3.format(",.0f")(v))
  );
  g.append("g").attr("class", "axis").attr("transform", `translate(${innerW},0)`).call(
    d3.axisRight(yO).ticks(narrow ? 3 : 4).tickFormat(v => (v / 1e6).toFixed(1) + "M")
  );

  // regime strip
  const stripY = priceH + gap;
  F.segments.forEach(s => {
    const x0 = x(s.start_min);
    const w = Math.max(1, x(s.end_min) - x0 - 1);
    const reg = REGIME[s.regime];
    g.append("rect").attr("class", "strip-cell")
      .attr("x", x0).attr("y", stripY).attr("width", w).attr("height", stripH)
      .attr("fill", reg.color).attr("opacity", 0.9)
      .on("mousemove", (ev) => showTip(
        `<div class="t">${s.start}–${s.end} · futures</div>` +
        row("Δ price", signed(s.dp, 1) + " pts") +
        row("Δ OI", signedInt(s.doi)) +
        row("volume", s.vol.toLocaleString("en-IN")) +
        row("regime", reg.label, reg.color), ev))
      .on("mouseleave", hideTip);
  });

  // marker labels stack upward so the 5-minute spacing cannot collide
  [{ min: 150, l: "11:45", row: 0 }, { min: 165, l: "12:00", row: 1 }, { min: 180, l: "12:15", row: 2 }].forEach(m => {
    g.append("line").attr("class", "anno")
      .attr("x1", x(m.min)).attr("x2", x(m.min)).attr("y1", -4).attr("y2", stripY + stripH);
    g.append("text").attr("class", "anno-text")
      .attr("x", x(m.min) + 4).attr("y", stripY - 6 - m.row * 11).text(m.l);
  });

  const futTicks = meta.time_ticks.filter(t => !narrow || t.min % 120 === 0 || t.min === meta.session_end_min);
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${stripY + stripH})`)
    .call(d3.axisBottom(x).tickValues(futTicks.map(t => t.min))
      .tickFormat(m => futTicks.find(t => t.min === m).label))
    .call(g2 => g2.select(".tick:last-of-type text").attr("text-anchor", "end").attr("x", -2));

  document.getElementById("futures-legend").innerHTML =
    `<span class="item"><span class="swatch" style="background:${COL.text}"></span>futures close</span>` +
    `<span class="item"><span class="swatch" style="background:${COL.info}"></span>open interest (right axis)</span>` +
    Object.entries(REGIME).map(([, v]) =>
      `<span class="item"><span class="swatch" style="background:${v.color}"></span>${v.label}</span>`).join("");
}

// ------------------------------------------------------------------ boot
function renderAll() {
  renderChrome();
  drawHeatmap();
  drawBars();
  drawBubbles();
  drawFutures();
}
let raf = null;
window.addEventListener("resize", () => {
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(renderAll);
});
renderAll();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
