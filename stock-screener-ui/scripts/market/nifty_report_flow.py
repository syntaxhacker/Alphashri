#!/usr/bin/env python3
"""NIFTY flow report — where the option volume actually went, per 5 minutes.

Reads the recorder output for one session and writes a self-contained HTML
artifact plus the JSON summary that backs it:

    experiments/data/nifty_chain10s/<date>.jsonl   10-second chain snapshots
    experiments/data/nifty_tape/<date>.jsonl       per-minute tape (spot spine)
    reports/nifty_<date>/data/futures_1m.json      NIFTY futures 1-minute

Outputs (default ``reports/nifty_<date>/``):

    01-flow.html          D3 v7 via CDN, theme parsed from src/ui/palette.ts
    data/flow.json        the same numbers, minus the render theme

Method notes that matter for reading the result:

* chain10s rows are ``[strike, ce_ltp, ce_oi, ce_vol, pe_ltp, pe_oi, pe_vol]``
  and the volume legs are *cumulative for the day* — but the upstream feed
  occasionally re-serves a stale, lower cumulative value. We therefore keep a
  running maximum per strike and count only positive advances. Without this,
  ~28% of consecutive steps are negative and the increments double-subtract.
* "ITM PE" means ``strike > spot`` **at the snapshot where the volume printed**,
  so a strike migrates between ITM and OTM as spot moves. That is the only
  definition that stays honest on a trending day; a fixed reference strike
  turns most of the tape into "ITM" by noon.
* Everything stops at the last tape timestamp. The chain log runs ~90 s longer;
  that tail is deliberately dropped rather than mixed into a partial bucket.

Usage:
    .venv/bin/python scripts/market/nifty_report_flow.py
    .venv/bin/python scripts/market/nifty_report_flow.py --date 2026-11-17
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from statistics import median

REPO_ROOT = Path(__file__).resolve().parents[2]
PALETTE_FILE = REPO_ROOT / "src" / "ui" / "palette.ts"

BUCKET_MINUTES = 5

# Strikes are tagged ITM when the *put* is in the money, i.e. strike > spot.
# 25500 is called out in the brief, so it gets an explicit emphasis flag.
EMPHASIS_STRIKE = 25500.0


# theme — single source of truth is the app palette, never a local hex

def load_palette() -> dict[str, str]:
    txt = PALETTE_FILE.read_text()
    wanted = {
        "PRIMARY": "amber",
        "POSITIVE_COLOR": "green",
        "NEGATIVE_COLOR": "red",
        "TEXT_COLOR": "text",
        "TEXT_MUTED_COLOR": "muted",
        "BG_COLOR": "bg",
        "SURFACE_COLOR": "surface",
        "SURFACE_ALT_COLOR": "raised",
        "BORDER_COLOR": "border",
    }
    out: dict[str, str] = {}
    for const, name in wanted.items():
        m = re.search(rf'export const {const}\s*=\s*"(#[0-9A-Fa-f]{{6}})"', txt)
        if not m:
            raise SystemExit(f"palette.ts is missing {const}")
        out[name] = m.group(1)
    return out



def read_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value)


def bucket_floor(ts: datetime, minutes: int = BUCKET_MINUTES) -> datetime:
    return ts.replace(minute=(ts.minute // minutes) * minutes, second=0, microsecond=0)


def hhmm(ts: datetime) -> str:
    return ts.strftime("%H:%M")


def build_bucket_grid(start: datetime, end: datetime) -> list[datetime]:
    step = timedelta(minutes=BUCKET_MINUTES)
    grid: list[datetime] = []
    cur = bucket_floor(start)
    last = bucket_floor(end)
    while cur <= last:
        grid.append(cur)
        cur += step
    return grid


def chain_increments(snaps: list[dict], cutoff: datetime):
    """Positive advances of the cumulative per-strike volume.

    Returns ``(events, snapshots_used)`` where each event is
    ``(ts, strike, spot_ref, ce_delta, pe_delta)``.

    Two conventions matter here and both are load-bearing:

    * The per-strike cumulative volume is differenced **first**, so the strike
      set never enters the arithmetic. Summing the cumulative volume across
      "strikes above spot" and then differencing those sums produces swing
      artefacts of ±400M whenever spot crosses a strike.
    * ``spot_ref`` is the spot at the **previous** snapshot — the moneyness the
      interval opened with — so a tick that crosses a strike cannot
      retroactively re-label volume that traded before the cross.
    * Volume only ever advances, so a lower cumulative reading is a stale
      re-read from the feed, not negative flow: we hold the high-water mark and
      count each unit exactly once.
    """
    peak: dict[float, list[float]] = {}
    events: list[tuple[datetime, float, float, float, float]] = []
    used = 0
    prev_spot: float | None = None
    for snap in snaps:
        ts = parse_ts(snap["t"])
        if ts > cutoff:
            break
        used += 1
        spot = float(snap["spot"])
        spot_ref = spot if prev_spot is None else prev_spot
        for row in snap.get("rows") or []:
            if len(row) < 7:
                continue
            strike = float(row[0])
            ce_vol = float(row[3])
            pe_vol = float(row[6])
            prev = peak.get(strike)
            if prev is None:
                peak[strike] = [ce_vol, pe_vol]
                continue
            d_ce = ce_vol - prev[0]
            d_pe = pe_vol - prev[1]
            if d_ce > 0:
                prev[0] = ce_vol
            if d_pe > 0:
                prev[1] = pe_vol
            if d_ce > 0 or d_pe > 0:
                events.append((ts, strike, spot_ref, max(d_ce, 0.0), max(d_pe, 0.0)))
        prev_spot = spot
    return events, used


def tape_spots(tape: list[dict], grid: list[datetime]) -> dict[datetime, float]:
    """Last tape spot per bucket, carried forward across a missing minute."""
    by_bucket: dict[datetime, float] = {}
    for row in tape:
        ts = parse_ts(row["t"])
        by_bucket[bucket_floor(ts)] = float(row["spot"])
    out: dict[datetime, float] = {}
    last = None
    for slot in grid:
        last = by_bucket.get(slot, last)
        if last is not None:
            out[slot] = last
    return out


def futures_by_bucket(path: Path) -> dict[datetime, dict]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text())
    out: dict[datetime, dict] = {}
    for candle in payload.get("candles") or []:
        ts = parse_ts(candle["t"])
        if ts.hour == 9 and ts.minute < 15:
            continue
        slot = bucket_floor(ts)
        out[slot] = {
            "close": float(candle["c"]),
            "oi": float(candle.get("oi") or 0.0),
            "volume": float(candle.get("v") or 0.0),
        }
    return out



def millions(value: float) -> float:
    return round(value / 1e6, 1)


def build_payload(date: str, chain_path: Path, tape_path: Path, futures_path: Path) -> dict:
    snaps = read_jsonl(chain_path)
    tape = read_jsonl(tape_path)
    if not snaps or not tape:
        raise SystemExit("empty chain10s or tape file — nothing to report")

    tape.sort(key=lambda r: r["t"])
    cutoff = parse_ts(tape[-1]["t"])
    grid = build_bucket_grid(parse_ts(tape[0]["t"]), cutoff)
    spots = tape_spots(tape, grid)
    fut = futures_by_bucket(futures_path)

    events, snapshots_used = chain_increments(snaps, cutoff)

    ce_b = defaultdict(float)
    pe_b = defaultdict(float)
    ce_itm_b = defaultdict(float)
    pe_itm_b = defaultdict(float)
    strike_pe = defaultdict(float)
    strike_pe_itm = defaultdict(float)
    strike_ce = defaultdict(float)
    strike_itm_buckets: dict[float, set] = defaultdict(set)
    grid_index = {slot: i for i, slot in enumerate(grid)}
    minute_itm: dict[datetime, float] = defaultdict(float)
    minute_pe: dict[datetime, float] = defaultdict(float)

    for ts, strike, spot_ref, d_ce, d_pe in events:
        slot = bucket_floor(ts)
        minute = ts.replace(second=0, microsecond=0)
        if slot not in grid_index:
            continue
        ce_b[slot] += d_ce
        pe_b[slot] += d_pe
        minute_pe[minute] += d_pe
        strike_ce[strike] += d_ce
        strike_pe[strike] += d_pe
        if strike < spot_ref:
            ce_itm_b[slot] += d_ce
        if strike > spot_ref:
            pe_itm_b[slot] += d_pe
            minute_itm[minute] += d_pe
            strike_pe_itm[strike] += d_pe
            strike_itm_buckets[strike].add(slot)

    # A bucket must be the sum of its own minutes. This is the guard against
    # ever re-deriving a bucket from a strike set that changed inside it.
    for slot in grid:
        children = sum(
            minute_itm.get(slot + timedelta(minutes=i), 0.0) for i in range(BUCKET_MINUTES)
        )
        if abs(children - pe_itm_b[slot]) > 0.05:
            raise SystemExit(
                f"bucket {hhmm(slot)} ITM flow {pe_itm_b[slot]:.1f} != "
                f"sum of minutes {children:.1f}"
            )

    buckets = []
    for slot in grid:
        pe_total = pe_b[slot]
        itm = pe_itm_b[slot]
        f = fut.get(slot)
        buckets.append(
            {
                "t": hhmm(slot),
                "ce": millions(ce_b[slot]),
                "ce_itm": millions(ce_itm_b[slot]),
                "pe": millions(pe_total),
                "pe_itm": millions(itm),
                "pe_otm": millions(pe_total - itm),
                "share": round(itm / pe_total * 100, 1) if pe_total else 0.0,
                "spot": round(spots.get(slot, 0.0), 1),
                "fut": round(f["close"], 1) if f else None,
                "fut_oi": round(f["oi"] / 1e6, 2) if f else None,
            }
        )

    strikes = []
    for strike in sorted(strike_pe):
        total_pe = strike_pe[strike]
        itm = strike_pe_itm.get(strike, 0.0)
        strikes.append(
            {
                "strike": strike,
                "pe": millions(total_pe),
                "pe_itm": millions(itm),
                "ce": millions(strike_ce.get(strike, 0.0)),
                "itm_share": round(itm / total_pe * 100, 1) if total_pe else 0.0,
                "itm_buckets": len(strike_itm_buckets.get(strike, ())),
            }
        )

    # 12 heatmap rows: the most active ITM puts first, then the rest of the
    # ATM ladder filled by total PE volume — a pure ITM ranking would only
    # return 8 strikes and leave the ATM band (where the tape actually lives)
    # out of the picture entirely.
    itm_ranked = sorted(strikes, key=lambda s: (-s["pe_itm"], -s["pe"]))
    # A strike counts as "ITM-active" when it carried at least 2% of the ITM
    # tape; deep wings that only printed in the opening auction are noise.
    itm_floor = 0.02 * sum(s["pe_itm"] for s in strikes)
    heat: list[dict] = []
    seen: set[float] = set()
    for row in itm_ranked:
        if len(heat) >= 8 or row["pe_itm"] < itm_floor:
            break
        heat.append(row)
        seen.add(row["strike"])
    for row in sorted(strikes, key=lambda s: -s["pe"]):
        if len(heat) >= 12:
            break
        if row["strike"] not in seen:
            heat.append(row)
            seen.add(row["strike"])
    heat.sort(key=lambda s: -s["strike"])
    if EMPHASIS_STRIKE not in seen:
        raise SystemExit(f"{EMPHASIS_STRIKE:.0f} fell out of the heatmap selection")

    matrix = [[0.0] * len(grid) for _ in heat]
    row_index = {row["strike"]: i for i, row in enumerate(heat)}
    for ts, strike, _spot_ref, _d_ce, d_pe in events:
        idx = row_index.get(strike)
        slot = bucket_floor(ts)
        if idx is None or slot not in grid_index or d_pe <= 0:
            continue
        matrix[idx][grid_index[slot]] += d_pe
    matrix = [[millions(v) for v in row] for row in matrix]

    top_itm = sorted(strikes, key=lambda s: -s["pe_itm"])[:5]
    itm_total = sum(s["pe_itm"] for s in strikes)
    top_payload = [
        {
            "strike": s["strike"],
            "pe_itm": s["pe_itm"],
            "share_of_itm": round(s["pe_itm"] / itm_total * 100, 1) if itm_total else 0.0,
            "itm_share": s["itm_share"],
            "pe": s["pe"],
        }
        for s in top_itm
    ]

    def clip(lo: str, hi: str) -> list[dict]:
        return [b for b in buckets if lo <= b["t"] < hi]

    def avg_share(rows: list[dict]) -> float:
        rows = [r for r in rows if r["pe"] > 0]
        return round(sum(r["share"] for r in rows) / len(rows), 1) if rows else 0.0

    def avg_units(rows: list[dict], key: str) -> float:
        return round(sum(r[key] for r in rows) / len(rows), 1) if rows else 0.0

    by_label = {b["t"]: b for b in buckets}
    pre = clip("09:15", "11:10")
    baseline = clip("09:45", "11:10")
    run_up = clip("10:50", "11:55")
    shares = [b["share"] for b in buckets if b["pe"] > 0]
    ordered = sorted(shares)
    p25 = ordered[int(round(0.25 * (len(ordered) - 1)))]
    p75 = ordered[int(round(0.75 * (len(ordered) - 1)))]
    in_band = sum(1 for s in shares if 15.0 <= s <= 23.0)

    total_pe_raw = sum(pe_b.values())
    total_ce_raw = sum(ce_b.values())
    total_itm_raw = sum(pe_itm_b.values())

    fut_candles = json.loads(futures_path.read_text())["candles"] if futures_path.exists() else []
    fut_by_hhmm = {c["t"][11:16]: c for c in fut_candles}
    leg = None
    if "11:45" in fut_by_hhmm and "12:00" in fut_by_hhmm:
        a, b = fut_by_hhmm["11:45"], fut_by_hhmm["12:00"]
        vol = sum(c["v"] for c in fut_candles if "11:45" < c["t"][11:16] <= "12:00")
        leg = {
            "from": "11:45",
            "to": "12:00",
            "close_from": round(a["c"], 1),
            "close_to": round(b["c"], 1),
            "delta_pts": round(b["c"] - a["c"], 1),
            "oi_from": int(a["oi"]),
            "oi_to": int(b["oi"]),
            "oi_delta": int(b["oi"] - a["oi"]),
            "volume": int(vol),
        }
    oi_peak = max(fut_candles, key=lambda c: c.get("oi") or 0) if fut_candles else None

    b1155 = by_label.get("11:55", {})
    b1150 = by_label.get("11:50", {})
    b1200 = by_label.get("12:00", {})
    b1205 = by_label.get("12:05", {})
    b1235 = by_label.get("12:35", {})
    b1110 = by_label.get("11:10", {})
    b1030 = by_label.get("10:30", {})

    peak_min_t, peak_min_itm = max(minute_itm.items(), key=lambda kv: kv[1])
    peak_min_pe = minute_pe.get(peak_min_t, 0.0)
    bucket_peak = max(buckets, key=lambda b: b["pe_itm"])
    peak_bucket_minutes = []
    start = datetime.fromisoformat(f"{date}T{bucket_peak['t']}:00+05:30")
    for i in range(BUCKET_MINUTES):
        slot = start + timedelta(minutes=i)
        peak_bucket_minutes.append({"t": hhmm(slot), "itm": millions(minute_itm.get(slot, 0.0))})

    summary = {
        "total_ce": round(total_ce_raw / 1e6, 1),
        "total_pe": round(total_pe_raw / 1e6, 1),
        "total_itm_pe": round(total_itm_raw / 1e6, 1),
        "session_itm_share": (
            round(total_itm_raw / total_pe_raw * 100, 1) if total_pe_raw else 0.0
        ),
        "baseline_window": "09:45–11:10",
        "baseline_share": avg_share(baseline),
        "baseline_itm_per_bucket": avg_units(baseline, "pe_itm"),
        "baseline_pe_per_bucket": avg_units(baseline, "pe"),
        "pre_1110_share": avg_share(pre),
        "pre_1110_itm_per_bucket": avg_units(pre, "pe_itm"),
        "run_up_window": "10:50–11:50",
        "run_up_itm_per_bucket": avg_units(clip("10:50", "11:55"), "pe_itm"),
        "share_median": round(median(shares), 1) if shares else 0.0,
        "share_p25": p25,
        "share_p75": p75,
        "share_min": min(shares) if shares else 0.0,
        "share_max": max(shares) if shares else 0.0,
        "buckets_in_15_23": in_band,
        "bucket_count": len(buckets),
        "at_1110": {"share": b1110.get("share"), "itm": b1110.get("pe_itm"), "pe": b1110.get("pe")},
        "at_1030": {"share": b1030.get("share"), "itm": b1030.get("pe_itm"), "pe": b1030.get("pe")},
        "peak_min": {
            "t": hhmm(peak_min_t),
            "itm": millions(peak_min_itm),
            "pe": millions(peak_min_pe),
            "share": round(peak_min_itm / peak_min_pe * 100, 1) if peak_min_pe else 0.0,
        },
        "peak_bucket": {
            "t": bucket_peak["t"],
            "itm": bucket_peak["pe_itm"],
            "pe": bucket_peak["pe"],
            "share": bucket_peak["share"],
            "avg_per_min": round(bucket_peak["pe_itm"] / BUCKET_MINUTES, 1),
            "minutes": peak_bucket_minutes,
        },
        "at_1150": {"share": b1150.get("share"), "itm": b1150.get("pe_itm"), "pe": b1150.get("pe")},
        "at_1155": {"share": b1155.get("share"), "itm": b1155.get("pe_itm"), "pe": b1155.get("pe")},
        "at_1200": {"share": b1200.get("share"), "itm": b1200.get("pe_itm"), "pe": b1200.get("pe")},
        "at_1205": {"share": b1205.get("share"), "itm": b1205.get("pe_itm"), "pe": b1205.get("pe")},
        "at_1235": {"share": b1235.get("share"), "itm": b1235.get("pe_itm"), "pe": b1235.get("pe")},
        "fut_leg": leg,
        "fut_oi_peak": (
            {"t": oi_peak["t"][11:16], "oi": int(oi_peak["oi"])} if oi_peak else None
        ),
        "fut_oi_at_1235": (
            int(fut_by_hhmm["12:35"]["oi"]) if "12:35" in fut_by_hhmm else None
        ),
        "spot_first": buckets[0]["spot"],
        "spot_last": buckets[-1]["spot"],
        "spot_min": min(b["spot"] for b in buckets if b["spot"]),
        "spot_max": max(b["spot"] for b in buckets if b["spot"]),
    }

    return {
        "meta": {
            "date": date,
            "underlying": "NIFTY",
            "expiry": snaps[0].get("expiry", date),
            "window": f"{hhmm(parse_ts(tape[0]['t']))}–{hhmm(cutoff)} IST",
            "tape_last": tape[-1]["t"],
            "chain_snapshots_used": snapshots_used,
            "chain_snapshots_total": len(snaps),
            "bucket_minutes": BUCKET_MINUTES,
            "strikes_seen": len(strikes),
            "sources": {
                "chain10s": str(chain_path.relative_to(REPO_ROOT)),
                "tape": str(tape_path.relative_to(REPO_ROOT)),
                "futures": str(futures_path.relative_to(REPO_ROOT)),
            },
            "method": (
                "per-strike cumulative chain volume differenced first, then classified by the spot "
                "at the previous snapshot (moneyness the interval opened with); stale lower re-reads "
                "hold the high-water mark instead of subtracting; 5-minute buckets are asserted to "
                "equal the sum of their one-minute children; window trimmed to spot ±500 pts by the "
                "recorder; no data after the last tape row"
            ),
        },
        "buckets": buckets,
        "strikes": strikes,
        "heatmap": {
            "strikes": [row["strike"] for row in heat],
            "labels": [b["t"] for b in buckets],
            "matrix": matrix,
            "emphasis": EMPHASIS_STRIKE,
            "selection": (
                "ITM-active strikes (≥2% of ITM volume), then the ATM ladder by total PE volume"
            ),
        },
        "top_itm": top_payload,
        "summary": summary,
    }


# prose — every number below is read from the payload, never hand-typed

def bullets(payload: dict) -> list[str]:
    s = payload["summary"]
    leg = s["fut_leg"] or {}
    at1155 = s["at_1155"]
    at1150 = s["at_1150"]
    at1235 = s["at_1235"]
    at1030 = s.get("at_1030") or {}
    peak_bucket = s.get("peak_bucket") or {}
    block_minutes = peak_bucket.get("minutes") or []
    block_peak = max(block_minutes, key=lambda m: m["itm"]) if block_minutes else {}
    peak_multiple = (at1155.get("itm") or 0) / (at1150.get("itm") or 1)
    oi_peak = s.get("fut_oi_peak") or {}
    oi_1235 = s.get("fut_oi_at_1235") or 0

    return [
        (
            f"<b>Baseline.</b> Through {s['baseline_window']} in-the-money puts were "
            f"<b>{s['baseline_share']:.1f}%</b> of PE volume — {s['baseline_itm_per_bucket']:.1f}M units "
            f"per 5-minute bucket against {s['baseline_pe_per_bucket']:.1f}M of total PE. The tape is "
            f"bursty, not trending: an earlier ITM push at 10:30 printed "
            f"{at1030.get('itm', 0):.1f}M ({at1030.get('share', 0):.1f}% of that bucket), then "
            f"10:50–11:50 went quiet at {s['run_up_itm_per_bucket']:.1f}M per bucket."
        ),
        (
            f"<b>11:55 spike, 12:00 futures long buildup.</b> 11:55 printed "
            f"<b>{at1155.get('itm', 0):.1f}M</b> ITM PE units — {peak_multiple:.1f}× the 11:50 bucket "
            f"({at1150.get('itm', 0):.1f}M) and {at1155.get('share', 0):.1f}% of that bucket's PE volume. "
            f"12:00 and 12:05 held {s['at_1200'].get('itm', 0):.1f}M and {s['at_1205'].get('itm', 0):.1f}M. "
            f"Over 11:45→12:00 futures rose <b>{leg.get('delta_pts', 0):+.1f} pts</b> with OI "
            f"<b>{leg.get('oi_delta', 0):+,}</b> on {leg.get('volume', 0):,} contracts — long buildup, "
            f"so the put buying was protection into strength, not a put bid."
        ),
        (
            f"<b>Caveat.</b> ITM PE stayed a minority of the PE tape: 15–23% of total PE in "
            f"<b>{s['buckets_in_15_23']} of {s['bucket_count']}</b> buckets (median "
            f"{s['share_median']:.1f}%, session {s['session_itm_share']:.1f}%, p25–p75 "
            f"{s['share_p25']:.1f}–{s['share_p75']:.1f}%), and 11:55 is the morning peak, not the "
            f"session's: the biggest 5-minute bucket ({peak_bucket.get('t', '—')}) carried "
            f"{peak_bucket.get('itm', 0):.1f}M — {peak_bucket.get('avg_per_min', 0):.1f}M per minute, "
            f"busiest single minute {block_peak.get('itm', 0):.1f}M at {block_peak.get('t', '—')} — "
            f"sustained flow, not one print. The 12:35 wave ({at1235.get('itm', 0):.1f}M, "
            f"{at1235.get('share', 0):.1f}%) arrived as futures OI rolled off its "
            f"{oi_peak.get('t', '—')} peak ({oi_peak.get('oi', 0):,} → {oi_1235:,}), so that flow reads "
            f"as hedge unwind rather than fresh downside positioning."
        ),
    ]


def chart_reads(payload: dict) -> dict[str, str]:
    s = payload["summary"]
    buckets = payload["buckets"]
    peak = max(buckets, key=lambda b: b["pe"])
    ce_peak = max(buckets, key=lambda b: b["ce"])
    top = payload["top_itm"][0]

    tail = [b for b in buckets if b["t"] >= "12:35"]
    tail_share = sum(b["pe"] for b in tail) / s["total_pe"] * 100
    tail_width = len(tail) / len(buckets) * 100

    columns = payload["heatmap"]["labels"]
    matrix = payload["heatmap"]["matrix"]
    col_totals = [sum(row[i] for row in matrix) for i in range(len(columns))]
    hot_i = max(range(len(col_totals)), key=col_totals.__getitem__)
    i55 = columns.index("11:55") if "11:55" in columns else None
    rows_above = (
        sum(1 for row in matrix if row[i55] > sorted(row)[len(row) // 2]) if i55 is not None else 0
    )
    col_1155 = col_totals[i55] if i55 is not None else 0
    col_1150 = col_totals[columns.index("11:50")] if "11:50" in columns else 1

    return {
        "stream": (
            f"CE volume ({s['total_ce'] / 1000:.2f}B units) ran ahead of PE "
            f"({s['total_pe'] / 1000:.2f}B), but PE carries the late weight: its biggest bucket is "
            f"{peak['t']} ({peak['pe']:.1f}M) against CE's {ce_peak['t']} ({ce_peak['ce']:.1f}M). The "
            f"{tail[0]['t']}→{buckets[-1]['t']} tail holds {tail_share:.0f}% of PE volume in "
            f"{tail_width:.0f}% of the buckets, so the afternoon, not the open, is where the tape got heavy."
        ),
        "share": (
            f"ITM share is noisy because it is a ratio of two moving volumes: the median bucket is "
            f"{s['share_median']:.1f}%, yet the print swings {s['share_min']:.1f}–"
            f"{s['share_max']:.1f}%. Read the four marks as events, not as a trend line. "
            f"The busiest single minute of ITM put flow is {s['peak_min']['t']} at "
            f"{s['peak_min']['itm']:.1f}M ({s['peak_min']['share']:.1f}% of that minute's PE)."
        ),
        "heat": (
            f"{top['strike']:.0f} PE is {top['share_of_itm']:.1f}% of all ITM put volume "
            f"({top['pe_itm']:.1f}M units). The hottest 5-minute column is {columns[hot_i]} "
            f"({col_totals[hot_i]:.1f}M across these 12 strikes); 11:55 lifts "
            f"{rows_above} of {len(matrix)} rows above their own median "
            f"({col_1155:.1f}M, {col_1155 / col_1150:.1f}× the 11:50 column) — a hedge program, "
            f"not a single-strike bet."
        ),
        "bars": (
            f"The top five are the strikes that were actually in the money while they traded. "
            f"Size and purity diverge: {payload['top_itm'][3]['strike']:.0f} PE printed "
            f"{payload['top_itm'][3]['itm_share']:.0f}% of its volume ITM, while "
            f"{payload['top_itm'][4]['strike']:.0f} PE — a top-five name by size — printed only "
            f"{payload['top_itm'][4]['itm_share']:.0f}% ITM, so its total volume flatters it."
        ),
    }



HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NIFTY __DATE__ — Flow / where volume moved</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>
<style>
:root {
  --bg: __C_BG__; --surface: __C_SURFACE__; --raised: __C_RAISED__; --border: __C_BORDER__;
  --text: __C_TEXT__; --muted: __C_MUTED__; --amber: __C_AMBER__; --green: __C_GREEN__;
  --red: __C_RED__; --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); }
body {
  font: 13px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
main { max-width: 1560px; margin: 0 auto; padding: 28px 20px 56px; }
h1 { font-size: 26px; line-height: 1.25; margin: 6px 0 6px; letter-spacing: -0.01em; font-weight: 650; }
h2 { font-size: 14px; margin: 0; font-weight: 600; letter-spacing: 0.01em; }
.eyebrow { font: 600 11px/1 var(--mono); color: var(--amber); letter-spacing: 0.14em; text-transform: uppercase; }
.sub { color: var(--muted); font-size: 12.5px; max-width: 92ch; }
.sub b { color: var(--text); font-weight: 600; }
.kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 1px; background: var(--border);
  border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin: 18px 0 16px; }
.kpi { background: var(--surface); padding: 12px 14px 13px; }
.kpi .k { font: 600 10px/1.2 var(--mono); letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted); }
.kpi .v { font: 600 21px/1.15 var(--mono); margin-top: 6px; letter-spacing: -0.01em; }
.kpi .n { color: var(--muted); font-size: 11px; margin-top: 3px; font-family: var(--mono); }
.kpi .v.amber { color: var(--amber); }
.kpi .v.red { color: var(--red); }
.kpi .v.green { color: var(--green); }
.bullets { border: 1px solid var(--border); border-left: 3px solid var(--amber); border-radius: 6px;
  background: var(--surface); padding: 14px 18px; margin: 0 0 20px; }
.bullets ol { margin: 0; padding-left: 18px; }
.bullets li { margin: 0 0 9px; max-width: 150ch; }
.bullets li:last-child { margin-bottom: 0; }
.bullets b { color: var(--amber); font-weight: 600; }
.panel { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); margin: 0 0 16px; }
.panel > header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding: 12px 16px 10px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.panel > header .hint { color: var(--muted); font-size: 11px; font-family: var(--mono); }
.panel .body { padding: 12px 12px 4px; }
.panel .read { color: var(--muted); font-size: 11.5px; padding: 2px 16px 12px; max-width: 150ch; }
.grid2 { display: grid; grid-template-columns: minmax(0, 1.72fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 0 16px 8px; font-size: 11px; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
svg { display: block; width: 100%; height: auto; overflow: visible; }
.axis text { fill: var(--muted); font: 10px var(--mono); }
.axis line { stroke: var(--border); }
.gridline { stroke: var(--border); stroke-width: 1; }
.anno { fill: var(--amber); font: 600 10px var(--mono); }
.muted { fill: var(--muted); }
.mono9 { font: 9px var(--mono); }
.mono10 { font: 600 10px var(--mono); }
#tip { position: fixed; pointer-events: none; z-index: 30; opacity: 0; transition: opacity .08s linear;
  background: var(--raised); border: 1px solid var(--border); border-radius: 5px; padding: 8px 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,.55); font: 11px/1.5 var(--mono); min-width: 150px; }
#tip .t { color: var(--amber); font-weight: 600; margin-bottom: 3px; }
#tip .r { display: flex; justify-content: space-between; gap: 16px; }
#tip .r b { color: var(--text); font-weight: 500; }
#readout { font: 11px var(--mono); color: var(--muted); padding: 0 16px 10px; min-height: 16px; }
#readout b { color: var(--amber); }
.cell { cursor: crosshair; }
.rowlabel { font: 600 10.5px var(--mono); fill: var(--muted); cursor: pointer; }
.rowlabel.on { fill: var(--amber); }
.rowtot { font: 10px var(--mono); fill: var(--muted); }
.hbar { cursor: pointer; }
footer { color: var(--muted); font-size: 11.5px; border-top: 1px solid var(--border); margin-top: 24px; padding-top: 14px; }
footer code { color: var(--text); font-family: var(--mono); font-size: 11px; }
footer p { margin: 0 0 6px; max-width: 150ch; }
@media (max-width: 1080px) {
  .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .grid2 { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  main { padding: 18px 12px 40px; }
  h1 { font-size: 21px; }
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kpi .v { font-size: 18px; }
  .panel .body { padding: 8px 6px 2px; }
  .panel > header, .legend, .panel .read, #readout { padding-left: 10px; padding-right: 10px; }
}
</style>
</head>
<body>
<main>
  <div class="eyebrow">NIFTY · 0DTE · __DATE__ · flow anatomy</div>
  <h1>Flow / where volume moved</h1>
  <p class="sub">Per-strike option volume from the 10-second chain log, bucketed to 5 minutes.
  Session <b>__WINDOW__</b>, spot <b>__SPOT_RANGE__</b>, expiry <b>__EXPIRY__</b>.
  __CHAIN_ROWS__ chain snapshots → <b>__BUCKETS__</b> buckets. Everything stops at the last tape print
  (__TAPE_LAST__); nothing after it is inferred.</p>

  <section class="kpis">
    <div class="kpi"><div class="k">CE volume</div><div class="v green">__K_CE__</div><div class="n">units, session</div></div>
    <div class="kpi"><div class="k">PE volume</div><div class="v red">__K_PE__</div><div class="n">units, session</div></div>
    <div class="kpi"><div class="k">ITM PE share</div><div class="v amber">__K_SHARE__</div><div class="n">__K_ITM__ ITM units</div></div>
    <div class="kpi"><div class="k">11:55 ITM PE</div><div class="v">__K_PEAK__</div><div class="n">__K_PEAK_N__</div></div>
    <div class="kpi"><div class="k">Peak 1-min ITM PE</div><div class="v">__K_MIN__</div><div class="n">__K_MIN_N__</div></div>
    <div class="kpi"><div class="k">Futures 11:45→12:00</div><div class="v green">__K_FUT__</div><div class="n">__K_FUT_N__</div></div>
  </section>

  <section class="bullets"><ol>
    <li>__B1__</li>
    <li>__B2__</li>
    <li>__B3__</li>
  </ol></section>

  <section class="panel">
    <header>
      <h2>1 · CE vs PE volume increments, 5-minute stream</h2>
      <div class="hint">band thickness = volume · thin line = NIFTY spot (right)</div>
    </header>
    <div class="legend" id="legend-stream"></div>
    <div class="body"><div id="stream"></div></div>
    <div class="read">__READ_STREAM__</div>
  </section>

  <section class="panel">
    <header>
      <h2>2 · ITM PE share of PE volume</h2>
      <div class="hint">itm_pe_vol ÷ total_pe_vol per bucket</div>
    </header>
    <div class="body"><div id="share"></div></div>
    <div class="read">__READ_SHARE__</div>
  </section>

  <div class="grid2">
    <section class="panel">
      <header>
        <h2>3 · PE volume by strike × time</h2>
        <div class="hint">click a strike to isolate it</div>
      </header>
      <div class="body"><div id="heat"></div></div>
      <div id="readout">—</div>
      <div class="read">__READ_HEAT__</div>
    </section>
    <section class="panel">
      <header>
        <h2>4 · Top ITM PE strikes</h2>
        <div class="hint">incremental volume, session</div>
      </header>
      <div class="body"><div id="bars"></div></div>
      <div class="read">__READ_BARS__</div>
    </section>
  </div>

  <footer>
    <p><b>Method.</b> __METHOD__.</p>
    <p>Sources: <code>__SRC_CHAIN__</code> · <code>__SRC_TAPE__</code> · <code>__SRC_FUT__</code>.
    Generated __GENERATED__ by <code>scripts/market/nifty_report_flow.py</code>; summary numbers in
    <code>data/flow.json</code>.</p>
    <p>Chain rows are trimmed by the recorder to spot ±500 points, so far-wing volume is out of scope —
    percentages are shares of the captured tape, not of the exchange total. The last bucket (__LAST_BUCKET__)
    is partial: the tape stops at __LAST_AT__.</p>
  </footer>
</main>
<div id="tip" role="status" aria-live="polite"></div>
<script id="flow-data" type="application/json">__PAYLOAD__</script>
<script>
(function () {
  "use strict";
  const DATA = JSON.parse(document.getElementById("flow-data").textContent);
  const P = DATA.theme, B = DATA.buckets, HM = DATA.heatmap, TOP = DATA.top_itm;
  const S = new Map(DATA.strikes.map((s) => [s.strike, s]));
  const M = (v) => v.toFixed(1) + "M";
  const pct = (v) => v.toFixed(1) + "%";
  const labels = HM.labels;
  let selected = null;

  const tip = d3.select("#tip");
  function showTip(html, ev) {
    tip.html(html).style("opacity", 1);
    const pad = 14, box = tip.node().getBoundingClientRect();
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + box.width > window.innerWidth - 8) x = ev.clientX - box.width - pad;
    if (y + box.height > window.innerHeight - 8) y = ev.clientY - box.height - pad;
    tip.style("left", Math.max(8, x) + "px").style("top", Math.max(8, y) + "px");
  }
  function hideTip() { tip.style("opacity", 0); }
  const row = (k, v) => '<div class="r"><span>' + k + '</span><b>' + v + '</b></div>';

  function frame(el, height, wide) {
    const w = Math.max(300, el.clientWidth || 900);
    d3.select(el).selectAll("*").remove();
    const svg = d3.select(el).append("svg")
      .attr("viewBox", "0 0 " + w + " " + height)
      .attr("width", w).attr("height", height)
      .attr("preserveAspectRatio", "xMinYMin meet")
      .attr("role", "img");
    return { w: w, svg: svg };
  }

  // ---- 1. streamgraph ----------------------------------------------------
  function drawStream() {
    const el = document.getElementById("stream");
    const wide = el.clientWidth >= 720;
    const f = frame(el, wide ? 320 : 250, wide);
    const m = { t: 14, r: wide ? 62 : 44, b: 26, l: wide ? 12 : 8 };
    const iw = f.w - m.l - m.r, ih = (wide ? 320 : 250) - m.t - m.b;
    const g = f.svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");

    const keys = ["pe_otm", "pe_itm", "ce_otm", "ce_itm"];
    const rows = B.map((b) => Object.assign({}, b, { ce_otm: +(b.ce - b.ce_itm).toFixed(1) }));
    const stack = d3.stack().keys(keys).offset(d3.stackOffsetWiggle).order(d3.stackOrderNone);
    const series = stack(rows);
    const x = d3.scalePoint().domain(labels).range([0, iw]);
    const y = d3.scaleLinear()
      .domain([d3.min(series, (s) => d3.min(s, (d) => d[0])), d3.max(series, (s) => d3.max(s, (d) => d[1]))])
      .range([ih, 0]);
    const color = { pe_itm: P.red, pe_otm: P.red, ce_itm: P.green, ce_otm: P.green };
    const opac = { pe_itm: 0.92, pe_otm: 0.30, ce_itm: 0.80, ce_otm: 0.26 };

    const area = d3.area().x((d) => x(d.data.t)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveBasis);
    g.selectAll("path.band").data(series).join("path").attr("class", "band")
      .attr("d", area).attr("fill", (d) => color[d.key]).attr("opacity", (d) => opac[d.key]);

    // futures long-buildup window
    const band0 = labels.indexOf("11:45"), band1 = labels.indexOf("12:00");
    if (band0 >= 0 && band1 >= 0) {
      const step = iw / (labels.length - 1);
      g.append("rect").attr("x", x(labels[band0]) - step / 2).attr("y", -8)
        .attr("width", x(labels[band1]) - x(labels[band0]) + step).attr("height", ih + 8)
        .attr("fill", P.amber).attr("opacity", 0.07).attr("pointer-events", "none");
      g.append("line").attr("x1", x(labels[band0])).attr("x2", x(labels[band0]))
        .attr("y1", -4).attr("y2", ih).attr("stroke", P.amber).attr("stroke-dasharray", "2 3")
        .attr("opacity", 0.55);
      g.append("text").attr("class", "anno").attr("x", x(labels[band0]) + 4).attr("y", -8)
        .text(wide ? "11:45→12:00 futures long buildup" : "long buildup");
    }

    const spotVals = B.map((b) => b.spot).filter((v) => v > 0);
    const y2 = d3.scaleLinear()
      .domain([d3.min(spotVals) - 12, d3.max(spotVals) + 12]).range([ih, 0]);
    const line = d3.line().x((d) => x(d.t)).y((d) => y2(d.spot)).curve(d3.curveBasis);
    g.append("path").datum(B).attr("fill", "none").attr("stroke", P.bg).attr("stroke-width", 4)
      .attr("opacity", 0.55).attr("d", line);
    g.append("path").datum(B).attr("fill", "none").attr("stroke", P.amber).attr("stroke-width", 1.4)
      .attr("opacity", 0.95).attr("d", line);

    const ticks = labels.filter((l) => {
      const mm = +l.slice(3, 5);
      return wide ? mm % 30 === 0 : mm === 0;
    });
    const axis = g.append("g").attr("class", "axis").attr("transform", "translate(0," + (ih + 6) + ")");
    axis.selectAll("text").data(ticks).join("text").attr("x", (d) => x(d)).attr("text-anchor", "middle")
      .attr("dy", "0.85em").text((d) => d);
    const y2axis = g.append("g").attr("class", "axis").attr("transform", "translate(" + (iw + 6) + ",0)");
    y2axis.selectAll("text").data(y2.ticks(wide ? 4 : 3)).join("text")
      .attr("x", 0).attr("y", (d) => y2(d)).attr("dy", "0.32em")
      .text((d) => d3.format(",")(Math.round(d)));
    y2axis.append("text").attr("class", "muted mono9").attr("x", 0).attr("y", -10)
      .text("spot");

    const focus = g.append("line").attr("stroke", P.text).attr("opacity", 0.45)
      .attr("stroke-dasharray", "2 3").attr("y1", 0).attr("y2", ih).style("display", "none");
    const dot = g.append("circle").attr("r", 2.6).attr("fill", P.amber).style("display", "none");
    const hit = g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "transparent");
    hit.on("mousemove", function (ev) {
      const px = d3.pointer(ev, this)[0];
      let i = 0, best = Infinity;
      labels.forEach((l, j) => { const d = Math.abs(x(l) - px); if (d < best) { best = d; i = j; } });
      const b = B[i];
      focus.style("display", null).attr("x1", x(b.t)).attr("x2", x(b.t));
      dot.style("display", null).attr("cx", x(b.t)).attr("cy", y2(b.spot));
      showTip('<div class="t">' + b.t + "</div>" +
        row("CE", M(b.ce)) + row("PE", M(b.pe)) +
        row("ITM PE", M(b.pe_itm) + " · " + pct(b.share)) +
        row("spot", d3.format(",.1f")(b.spot)) +
        (b.fut ? row("futures", d3.format(",.1f")(b.fut)) : ""), ev);
    }).on("mouseleave", () => { focus.style("display", "none"); dot.style("display", "none"); hideTip(); });

    document.getElementById("legend-stream").innerHTML = [
      ["PE ITM", P.red, 0.92], ["PE OTM", P.red, 0.38],
      ["CE ITM", P.green, 0.80], ["CE OTM", P.green, 0.34],
      ["NIFTY spot", P.amber, 1],
    ].map(([n, c, o]) => '<span><i style="background:' + c + ';opacity:' + o + '"></i>' + n + "</span>").join("");
  }

  // ---- 2. ITM share line -------------------------------------------------
  const MARKS = [
    { t: "11:10", n: "1", txt: "ITM expansion starts" },
    { t: "11:55", n: "2", txt: "morning ITM burst" },
    { t: "12:00", n: "3", txt: "futures long buildup completes" },
    { t: "12:35", n: "4", txt: "second wave as futures OI rolls over" },
  ];

  function drawShare() {
    const el = document.getElementById("share");
    const wide = el.clientWidth >= 720;
    const H = wide ? 250 : 210;
    const f = frame(el, H, wide);
    const m = { t: 26, r: wide ? 48 : 34, b: 26, l: wide ? 38 : 30 };
    const iw = f.w - m.l - m.r, ih = H - m.t - m.b;
    const g = f.svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    const x = d3.scalePoint().domain(labels).range([0, iw]);
    const ymax = Math.max(40, Math.ceil(d3.max(B, (b) => b.share) / 5) * 5);
    const y = d3.scaleLinear().domain([0, ymax]).range([ih, 0]);
    const byT = new Map(B.map((b) => [b.t, b]));

    g.append("g").attr("class", "axis")
      .call(d3.axisLeft(y).ticks(wide ? 4 : 3).tickFormat((d) => d + "%").tickSize(-iw))
      .call((s) => s.selectAll(".tick line").attr("stroke", P.border).attr("opacity", 0.55))
      .call((s) => s.select(".domain").remove());

    const area = d3.area().x((d) => x(d.t)).y0(ih).y1((d) => y(d.share)).curve(d3.curveMonotoneX);
    g.append("path").datum(B).attr("d", area).attr("fill", P.red).attr("opacity", 0.14);
    const line = d3.line().x((d) => x(d.t)).y((d) => y(d.share)).curve(d3.curveMonotoneX);
    g.append("path").datum(B).attr("d", line).attr("fill", "none").attr("stroke", P.red)
      .attr("stroke-width", 1.6);

    // median reference
    const med = DATA.summary.share_median;
    g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(med)).attr("y2", y(med))
      .attr("stroke", P.muted).attr("stroke-dasharray", "4 4").attr("opacity", 0.6);
    g.append("text").attr("x", iw - 2).attr("y", y(med) - 5).attr("text-anchor", "end")
      .attr("class", "muted mono9").attr("paint-order", "stroke")
      .attr("stroke", P.surface).attr("stroke-width", 3)
      .text("median " + med.toFixed(1) + "%");

    MARKS.forEach((mk, i) => {
      const b = byT.get(mk.t);
      if (!b) return;
      const cx = x(mk.t), cy = y(b.share);
      g.append("line").attr("x1", cx).attr("x2", cx).attr("y1", 0).attr("y2", ih)
        .attr("stroke", P.amber).attr("opacity", 0.28).attr("stroke-dasharray", "2 3");
      g.append("circle").attr("cx", cx).attr("cy", cy).attr("r", 3.4)
        .attr("fill", P.amber).attr("stroke", P.bg).attr("stroke-width", 1.2);
      const by = i % 2 === 0 ? 10 : 24;
      g.append("rect").attr("x", cx - 7).attr("y", by - 8).attr("width", 14).attr("height", 13)
        .attr("rx", 2).attr("fill", P.raised).attr("stroke", P.amber).attr("stroke-width", 0.8);
      g.append("text").attr("x", cx).attr("y", by + 1.6).attr("text-anchor", "middle")
        .attr("class", "mono10").attr("fill", P.amber).text(mk.n);
    });

    const ticks = labels.filter((l) => { const mm = +l.slice(3, 5); return wide ? mm % 60 === 0 : mm === 0; });
    g.append("g").attr("class", "axis").attr("transform", "translate(0," + (ih + 6) + ")")
      .selectAll("text").data(ticks).join("text").attr("x", (d) => x(d))
      .attr("text-anchor", "middle").attr("dy", "0.85em").text((d) => d);

    const hit = g.append("rect").attr("width", iw).attr("height", ih).attr("fill", "transparent");
    hit.on("mousemove", function (ev) {
      const px = d3.pointer(ev, this)[0];
      let i = 0, best = Infinity;
      labels.forEach((l, j) => { const d = Math.abs(x(l) - px); if (d < best) { best = d; i = j; } });
      const b = B[i];
      showTip('<div class="t">' + b.t + "</div>" + row("ITM PE", M(b.pe_itm)) +
        row("total PE", M(b.pe)) + row("share", pct(b.share)) +
        row("spot", d3.format(",.1f")(b.spot)), ev);
    }).on("mouseleave", hideTip);

    const legend = document.createElement("div");
    legend.className = "legend";
    legend.style.padding = "6px 0 0";
    legend.innerHTML = MARKS.map((mk) => {
      const b = byT.get(mk.t);
      return '<span style="color:' + P.muted + '"><i style="background:' + P.amber + ';border-radius:50%;width:7px;height:7px"></i>'
        + mk.n + " " + mk.t + " · " + (b ? b.share.toFixed(1) + "%" : "—") + " · " + mk.txt + "</span>";
    }).join("");
    el.appendChild(legend);
  }

  // ---- 3. heatmap --------------------------------------------------------
  function drawHeat() {
    const el = document.getElementById("heat");
    const wide = el.clientWidth >= 620;
    const merge = wide ? 1 : 3; // 5-min cells on desktop, 15-min on phones
    const cols = [];
    for (let i = 0; i < labels.length; i += merge) cols.push(i);
    const heights = wide ? 22 : 18;
    const H = HM.strikes.length * heights + (wide ? 100 : 86);
    const f = frame(el, H, wide);
    const m = { t: 22, r: wide ? 58 : 46, b: 34, l: wide ? 58 : 50 };
    const iw = f.w - m.l - m.r, ih = HM.strikes.length * heights;
    const g = f.svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    const xs = d3.scaleBand().domain(cols.map(String)).range([0, iw]).paddingInner(0.12);
    const ys = d3.scaleBand().domain(HM.strikes.map(String)).range([0, ih]).paddingInner(0.1);
    const cellW = xs.bandwidth();

    const flat = HM.matrix.reduce((a, r) => a.concat(r), []);
    const maxV = d3.max(flat) || 1;
    const amber = d3.color(P.amber);
    const ramp = d3.scaleSequential((t) => d3.interpolateRgbBasis(
      [P.surface, amber.darker(3.2).formatHex(), amber.darker(1.5).formatHex(),
        P.amber, amber.brighter(1.3).formatHex()])(Math.pow(t, 0.62)))
      .domain([0, maxV]).clamp(true);

    const gcols = g.append("g");
    cols.forEach((ci) => {
      const c = gcols.append("g").attr("transform", "translate(" + xs(String(ci)) + ",0)");
      HM.strikes.forEach((strike, ri) => {
        const v = merge === 1
          ? HM.matrix[ri][ci]
          : d3.sum(HM.matrix[ri].slice(ci, ci + merge));
        c.append("rect").attr("class", "cell").attr("y", ys(String(strike)))
          .attr("width", cellW).attr("height", ys.bandwidth()).attr("rx", 1)
          .attr("fill", v > 0 ? ramp(v) : P.surface)
          .attr("stroke", v > 0 ? "none" : P.border).attr("stroke-width", v > 0 ? 0 : 0.5)
          .attr("opacity", selected && strike !== selected ? 0.3 : 1)
          .attr("data-strike", strike).attr("data-v", v)
          .on("click", () => selectStrike(strike))
          .on("mousemove", (ev) => {
            const b = B[ci];
            const span = merge > 1
              ? labels[ci] + "–" + labels[Math.min(ci + merge - 1, labels.length - 1)]
              : b.t;
            showTip('<div class="t">' + span + " · " + strike + " PE</div>" +
              row("increment", M(v)) +
              row("bucket PE", M(merge === 1 ? b.pe : d3.sum(B.slice(ci, ci + merge), (z) => z.pe))) +
              row("strike total", M((S.get(strike) || { pe: 0 }).pe)), ev);
          }).on("mouseleave", hideTip);
      });
    });

    HM.strikes.forEach((strike) => {
      const meta = S.get(strike) || { itm_share: 0, pe: 0 };
      const on = selected === strike;
      const yy = ys(String(strike)) + ys.bandwidth() / 2;
      g.append("rect").attr("x", -m.l).attr("y", ys(String(strike)) - 1)
        .attr("width", iw + m.l + m.r).attr("height", ys.bandwidth() + 2)
        .attr("fill", on ? P.amber : "transparent").attr("opacity", on ? 0.07 : 0)
        .attr("pointer-events", "none");
      if (strike === HM.emphasis || on) {
        g.append("rect").attr("x", -4).attr("y", ys(String(strike)) - 1)
          .attr("width", iw + 4).attr("height", ys.bandwidth() + 2)
          .attr("fill", "none").attr("stroke", P.amber)
          .attr("stroke-opacity", on ? 0.9 : 0.45).attr("pointer-events", "none");
        g.append("rect").attr("x", -m.l).attr("y", ys(String(strike)) - 1)
          .attr("width", 2.5).attr("height", ys.bandwidth() + 2).attr("fill", P.amber)
          .attr("pointer-events", "none");
      }
      const label = g.append("text").attr("class", "rowlabel" + (strike === HM.emphasis || on ? " on" : ""))
        .attr("x", -8).attr("y", yy).attr("text-anchor", "end").attr("dy", "0.34em")
        .attr("tabindex", 0).attr("role", "button")
        .attr("aria-label", strike + " PE, " + meta.pe.toFixed(1) + " million units")
        .text(d3.format("d")(strike) + (meta.itm_share > 0 ? " ⋆" : ""));
      label.on("click", () => selectStrike(strike)).on("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectStrike(strike); }
      });
      g.append("text").attr("class", "rowtot").attr("x", iw + 8).attr("y", yy).attr("dy", "0.34em")
        .text(meta.pe.toFixed(0));
    });

    // x ticks: every 30 min (wide) / 60 min (narrow)
    const tickCols = cols.filter((ci) => {
      const mm = +labels[ci].slice(3, 5);
      return wide ? mm % 30 === 0 : mm === 0;
    });
    g.append("g").attr("class", "axis").attr("transform", "translate(0," + (ih + 6) + ")")
      .selectAll("text").data(tickCols).join("text")
      .attr("x", (ci) => xs(String(ci)) + cellW / 2).attr("text-anchor", "middle")
      .attr("dy", "0.85em").text((ci) => labels[ci]);

    // colour key
    const keyW = Math.min(150, iw * 0.42), keyH = 6;
    const keyG = f.svg.append("g").attr("transform", "translate(" + m.l + "," + (m.t + ih + (wide ? 42 : 36)) + ")");
    const grad = keyG.append("defs").append("linearGradient").attr("id", "heatkey");
    d3.range(0, 1.01, 0.1).forEach((t) => {
      grad.append("stop").attr("offset", (t * 100) + "%").attr("stop-color", ramp(t * maxV));
    });
    keyG.append("rect").attr("width", keyW).attr("height", keyH).attr("rx", 1)
      .attr("fill", "url(#heatkey)");
    keyG.append("text").attr("class", "muted mono9").attr("y", keyH + 10)
      .text("0");
    keyG.append("text").attr("class", "muted mono9").attr("x", keyW).attr("y", keyH + 10)
      .attr("text-anchor", "end").text(M(maxV));
    keyG.append("text").attr("class", "muted mono9").attr("x", keyW + 14).attr("y", keyH + 3)
      .text(wide ? "units per 5 min · ⋆ = traded ITM" : "units / 15 min");

    g.append("g").attr("class", "axis").attr("transform", "translate(" + (iw + 6) + ",0)")
      .append("text").attr("class", "muted mono9").attr("y", -6)
      .text("PE M");
  }

  // ---- 4. top-5 bars -----------------------------------------------------
  function drawBars() {
    const el = document.getElementById("bars");
    const wide = el.clientWidth >= 400;
    const rowH = wide ? 34 : 30;
    const H = TOP.length * rowH + 34;
    const f = frame(el, H, wide);
    const m = { t: 8, r: wide ? 18 : 14, b: 22, l: 56 };
    const iw = f.w - m.l - m.r;
    const g = f.svg.append("g").attr("transform", "translate(" + m.l + "," + m.t + ")");
    const x = d3.scaleLinear().domain([0, d3.max(TOP, (d) => d.pe_itm)])
      .range([0, iw - (wide ? 96 : 46)]);

    TOP.forEach((d, i) => {
      const y = i * rowH, on = selected === d.strike;
      const emph = d.strike === HM.emphasis || on;
      g.append("text").attr("x", -8).attr("y", y + rowH / 2).attr("dy", "0.34em")
        .attr("text-anchor", "end").attr("class", "rowlabel" + (emph ? " on" : ""))
        .text(d3.format("d")(d.strike));
      const bar = g.append("g").attr("class", "hbar").attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", d.strike + " PE " + M(d.pe_itm) + " ITM");
      bar.append("rect").attr("x", 0).attr("y", y + 5).attr("height", rowH - 10)
        .attr("width", Math.max(1, x(d.pe_itm))).attr("rx", 2)
        .attr("fill", emph ? P.amber : P.red).attr("opacity", emph ? 0.95 : 0.55);
      bar.append("text").attr("x", x(d.pe_itm) + 6).attr("y", y + rowH / 2).attr("dy", "0.34em")
        .attr("class", "mono10").attr("fill", emph ? P.amber : P.text)
        .text(M(d.pe_itm));
      if (wide) {
        bar.append("text").attr("x", iw).attr("y", y + rowH / 2).attr("dy", "0.34em")
          .attr("text-anchor", "end").attr("class", "muted mono9")
          .text(d.share_of_itm.toFixed(1) + "%");
      }
      bar.on("click", () => selectStrike(d.strike)).on("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectStrike(d.strike); }
      }).on("mousemove", (ev) => {
        showTip('<div class="t">' + d3.format("d")(d.strike) + " PE</div>" +
          row("ITM volume", M(d.pe_itm)) + row("total volume", M(d.pe)) +
          row("share of ITM", pct(d.share_of_itm)), ev);
      }).on("mouseleave", hideTip);
    });
    g.append("text").attr("y", TOP.length * rowH + 14).attr("class", "muted mono9")
      .text(wide ? "ITM units · % of all ITM PE volume" : "ITM units");
  }

  // ---- shared selection --------------------------------------------------
  function selectStrike(strike) {
    selected = selected === strike ? null : strike;
    const meta = S.get(strike);
    const out = document.getElementById("readout");
    if (!selected) {
      out.innerHTML = "—";
    } else {
      const itmPct = (meta.pe_itm / DATA.summary.total_itm_pe * 100).toFixed(1);
      out.innerHTML = "Selected <b>" + d3.format("d")(strike) + " PE</b> · " + M(meta.pe_itm) +
        " ITM units (" + itmPct + "% of all ITM PE) · " + M(meta.pe) + " total · " +
        meta.itm_share.toFixed(1) + "% of its volume printed ITM · click again to clear";
    }
    drawHeat(); drawBars();
  }

  function render() {
    drawStream(); drawShare(); drawHeat(); drawBars();
  }
  render();
  let rid = null;
  window.addEventListener("resize", () => {
    clearTimeout(rid);
    rid = setTimeout(render, 160);
  });
})();
</script>
</body>
</html>
"""


def render_html(payload: dict, palette: dict[str, str]) -> str:
    s = payload["summary"]
    meta = payload["meta"]
    doc = HTML_TEMPLATE
    doc = doc.replace("__DATE__", meta["date"])
    doc = doc.replace("__WINDOW__", meta["window"])
    doc = doc.replace("__EXPIRY__", meta["expiry"])
    doc = doc.replace("__CHAIN_ROWS__", f"{meta['chain_snapshots_used']:,}")
    doc = doc.replace("__BUCKETS__", str(len(payload["buckets"])))
    doc = doc.replace("__TAPE_LAST__", meta["tape_last"][11:19] + " IST")
    doc = doc.replace(
        "__SPOT_RANGE__",
        f"{s['spot_min']:,.1f} – {s['spot_max']:,.1f}",
    )
    doc = doc.replace("__K_CE__", f"{s['total_ce'] / 1000:,.2f}B")
    doc = doc.replace("__K_PE__", f"{s['total_pe'] / 1000:,.2f}B")
    doc = doc.replace("__K_SHARE__", f"{s['session_itm_share']:.1f}%")
    doc = doc.replace("__K_ITM__", f"{s['total_itm_pe'] / 1000:,.2f}B")
    doc = doc.replace("__K_PEAK__", f"{s['at_1155']['itm']:.1f}M")
    doc = doc.replace(
        "__K_PEAK_N__",
        f"{s['at_1155']['share']:.1f}% of bucket PE · {s['at_1150']['itm']:.1f}M at 11:50",
    )
    doc = doc.replace("__K_MIN__", f"{s['peak_min']['itm']:.1f}M")
    doc = doc.replace(
        "__K_MIN_N__",
        f"{s['peak_min']['t']} · {s['peak_min']['share']:.1f}% of that minute's PE",
    )
    leg = s["fut_leg"] or {}
    doc = doc.replace("__K_FUT__", f"{leg.get('delta_pts', 0):+.1f} pts")
    doc = doc.replace(
        "__K_FUT_N__",
        f"OI {leg.get('oi_delta', 0):+,} · {leg.get('volume', 0):,} lots",
    )

    b1, b2, b3 = bullets(payload)
    doc = doc.replace("__B1__", b1).replace("__B2__", b2).replace("__B3__", b3)
    reads = chart_reads(payload)
    doc = doc.replace("__READ_STREAM__", reads["stream"])
    doc = doc.replace("__READ_SHARE__", reads["share"])
    doc = doc.replace("__READ_HEAT__", reads["heat"])
    doc = doc.replace("__READ_BARS__", reads["bars"])

    doc = doc.replace("__C_BG__", palette["bg"])
    doc = doc.replace("__C_SURFACE__", palette["surface"])
    doc = doc.replace("__C_RAISED__", palette["raised"])
    doc = doc.replace("__C_BORDER__", palette["border"])
    doc = doc.replace("__C_TEXT__", palette["text"])
    doc = doc.replace("__C_MUTED__", palette["muted"])
    doc = doc.replace("__C_AMBER__", palette["amber"])
    doc = doc.replace("__C_GREEN__", palette["green"])
    doc = doc.replace("__C_RED__", palette["red"])

    doc = doc.replace("__METHOD__", meta["method"])
    doc = doc.replace("__SRC_CHAIN__", meta["sources"]["chain10s"])
    doc = doc.replace("__SRC_TAPE__", meta["sources"]["tape"])
    doc = doc.replace("__SRC_FUT__", meta["sources"]["futures"])
    doc = doc.replace("__GENERATED__", datetime.now().strftime("%Y-%m-%d %H:%M"))
    doc = doc.replace("__LAST_BUCKET__", payload["buckets"][-1]["t"])
    doc = doc.replace("__LAST_AT__", meta["tape_last"][11:19] + " IST")

    theme = {
        "amber": palette["amber"],
        "green": palette["green"],
        "red": palette["red"],
        "text": palette["text"],
        "muted": palette["muted"],
        "bg": palette["bg"],
        "surface": palette["surface"],
        "raised": palette["raised"],
        "border": palette["border"],
    }
    body = dict(payload, theme=theme)
    blob = json.dumps(body, separators=(",", ":")).replace("</", "<\\/")
    return doc.replace("__PAYLOAD__", blob)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", default="2026-11-17")
    ap.add_argument("--out-dir", default=None)
    args = ap.parse_args()

    date = args.date
    out_dir = Path(args.out_dir) if args.out_dir else REPO_ROOT / "reports" / f"nifty_{date}"
    chain_path = REPO_ROOT / "experiments" / "data" / "nifty_chain10s" / f"{date}.jsonl"
    tape_path = REPO_ROOT / "experiments" / "data" / "nifty_tape" / f"{date}.jsonl"
    futures_path = out_dir / "data" / "futures_1m.json"

    payload = build_payload(date, chain_path, tape_path, futures_path)
    palette = load_palette()
    html = render_html(payload, palette)

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "data").mkdir(exist_ok=True)
    html_path = out_dir / "01-flow.html"
    json_path = out_dir / "data" / "flow.json"
    html_path.write_text(html)
    json_path.write_text(json.dumps(payload, indent=2) + "\n")

    s = payload["summary"]
    print(f"wrote {html_path.relative_to(REPO_ROOT)} ({html_path.stat().st_size / 1024:.1f} KB)")
    print(f"wrote {json_path.relative_to(REPO_ROOT)} ({json_path.stat().st_size / 1024:.1f} KB)")
    print(
        "session: CE {ce:,.0f}M PE {pe:,.0f}M ITM-PE {itm:,.0f}M ({share}%)".format(
            ce=s["total_ce"], pe=s["total_pe"], itm=s["total_itm_pe"], share=s["session_itm_share"]
        )
    )
    print(
        "buckets {n} | median share {med}% | 11:55 {a}M ({b}%) | 12:00 {c}M | 12:35 {d}M".format(
            n=s["bucket_count"], med=s["share_median"], a=s["at_1155"]["itm"],
            b=s["at_1155"]["share"], c=s["at_1200"]["itm"], d=s["at_1235"]["itm"],
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
