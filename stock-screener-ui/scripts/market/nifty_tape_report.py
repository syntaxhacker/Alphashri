#!/usr/bin/env python3
"""Build the NIFTY tape-review page and its data artifact for one session.

Reads the recorder files written under experiments/data/ (tape, futures,
snapshots, 10-second chain) and emits a self-contained dark HTML report plus a
machine-readable JSON summary.  No network calls, no database access.

Usage:
    .venv/bin/python scripts/market/nifty_tape_report.py --date 2026-11-18
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
IST = timezone(timedelta(hours=5, minutes=30))

DATE_DEFAULT = "2026-11-18"
REPORT_DIR = ROOT / "reports" / "nifty_2026-11-18"
OUT_HTML = REPORT_DIR / "07-tape-review.html"
OUT_JSON = REPORT_DIR / "data" / "report_tape.json"
QUANT_JSON = REPORT_DIR / "research" / "quant_tape.json"

DATA = ROOT / "experiments" / "data"
FILES = {
    "tape": DATA / "nifty_tape" / "{date}.jsonl",
    "futures": DATA / "nifty_futures" / "{date}.jsonl",
    "snapshots": DATA / "nifty_snapshots" / "{date}.jsonl",
    "chain10s": DATA / "nifty_chain10s" / "{date}.jsonl",
}


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
def parse_ts(value: str) -> datetime:
    """Parse recorder timestamps; a few rows are naive and are assumed IST."""
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    return dt


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def sort_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: parse_ts(row["t"]))


def pct(value: float, base: float) -> float:
    return (value / base - 1.0) * 100.0 if base else 0.0


def fmt(value: float | int | None, digits: int = 2) -> str:
    if value is None:
        return "—"
    return f"{value:,.{digits}f}"


def signed(value: float | int | None, digits: int = 2) -> str:
    if value is None:
        return "—"
    return f"{value:+,.{digits}f}"


def millions(value: float | int | None, digits: int = 1) -> str:
    if value is None:
        return "—"
    return f"{value / 1e6:,.{digits}f}M"


def wilson(p: float, n: int, z: float = 1.96) -> tuple[float, float]:
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def pearson(a: list[float], b: list[float]) -> float:
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    return cov / math.sqrt(va * vb) if va and vb else 0.0


def corr_ci(a: list[float], b: list[float]) -> dict[str, float]:
    r = pearson(a, b)
    n = len(a)
    if n <= 3 or abs(r) >= 1:
        return {"r": r, "lo": r, "hi": r, "n": n}
    z = math.atanh(r)
    se = 1 / math.sqrt(n - 3)
    return {
        "r": r,
        "lo": math.tanh(z - 1.96 * se),
        "hi": math.tanh(z + 1.96 * se),
        "n": n,
    }


def alpha(hex_color: str, a: float) -> str:
    raw = hex_color.lstrip("#")
    r, g, b = (int(raw[i: i + 2], 16) for i in (0, 2, 4))
    return f"rgba({r}, {g}, {b}, {a})"


def load_palette() -> dict[str, Any]:
    """Read the product palette so the report cannot drift from the app theme."""
    path = ROOT / "src" / "ui" / "palette.ts"
    text = path.read_text() if path.exists() else ""
    anchors = dict(
        re.findall(r'export const (\w+) = "(#[0-9A-Fa-f]{6})";', text)
    )
    scales = {
        name: re.findall(r'"(#[0-9A-Fa-f]{6})"', body)
        for name, body in re.findall(
            r"export const (SCALE_\w+) = \[(.*?)\];", text, re.S
        )
    }
    fallback = {
        "PRIMARY": "#D9902A",
        "POSITIVE_COLOR": "#2FA36B",
        "NEGATIVE_COLOR": "#E5606A",
        "TEXT_COLOR": "#E8E8E8",
        "TEXT_MUTED_COLOR": "#9B9B9B",
        "BG_COLOR": "#000000",
        "SURFACE_COLOR": "#13161C",
        "SURFACE_ALT_COLOR": "#1F242D",
        "BORDER_COLOR": "#2C313B",
        "INFO": "#4A8FD8",
        "WARNING": "#C9912F",
    }
    anchors = {**fallback, **anchors}
    return {
        "amber": anchors["PRIMARY"],
        "green": anchors["POSITIVE_COLOR"],
        "red": anchors["NEGATIVE_COLOR"],
        "text": anchors["TEXT_COLOR"],
        "muted": anchors["TEXT_MUTED_COLOR"],
        "bg": anchors["BG_COLOR"],
        "panel": anchors["SURFACE_COLOR"],
        "raised": anchors["SURFACE_ALT_COLOR"],
        "border": anchors["BORDER_COLOR"],
        "blue": anchors.get("INFO", "#4A8FD8"),
        "yellow": anchors.get("WARNING", "#C9912F"),
        "teal": (scales.get("SCALE_TEAL") or ["#2B6777"])[5],
        "cyan": (scales.get("SCALE_CYAN") or ["#337D92"])[5],
    }


# ---------------------------------------------------------------------------
# analysis
# ---------------------------------------------------------------------------
def build(date: str) -> dict[str, Any]:
    paths = {name: Path(str(tpl).format(date=date)) for name, tpl in FILES.items()}
    for name, path in paths.items():
        if not path.exists():
            raise SystemExit(f"missing {name} file: {path}")

    tape_raw = load_jsonl(paths["tape"])
    fut_raw = load_jsonl(paths["futures"])
    snap_raw = load_jsonl(paths["snapshots"])
    chain_raw = load_jsonl(paths["chain10s"])

    tape_sorted = all(
        parse_ts(a["t"]) <= parse_ts(b["t"]) for a, b in zip(tape_raw, tape_raw[1:])
    )
    tape = sort_rows(tape_raw)
    futures = sort_rows(fut_raw)
    snapshots = sort_rows(snap_raw)
    chain = sort_rows(chain_raw)

    # The 09:15:54 tape row is a backfilled partial chain: price is usable, OI
    # is not (61.6M CE / 55.5M PE vs 129.4M / 139.7M one minute later).
    full = [row for row in tape if (row.get("ce_oi") or 0) > 100_000_000]
    base = full[0]
    last = tape[-1]

    spots = [row["spot"] for row in tape]
    open_px = spots[0]
    high_px, low_px = max(spots), min(spots)
    high_row = tape[spots.index(high_px)]
    low_row = tape[spots.index(low_px)]
    close_px = spots[-1]

    first_snap = snapshots[0]["report"]
    last_snap = snapshots[-1]["report"]
    pivot = last_snap.get("pivots") or first_snap.get("pivots") or {}
    prior_close = float((pivot.get("prev") or {}).get("close") or 25_387.40)

    # ---- path / returns ---------------------------------------------------
    # skip the 09:15:54 backfill-to-09:16 interval: it is 18 seconds, not a minute
    rets_full = [
        (b["spot"] - a["spot"]) / a["spot"] for a, b in zip(full, full[1:])
    ]
    returns = rets_full
    mean_ret = statistics.mean(returns)
    sd_ret = statistics.pstdev(returns)
    se_ret = sd_ret / math.sqrt(len(returns))
    rv_pts = math.sqrt(sum((b["spot"] - a["spot"]) ** 2 for a, b in zip(tape, tape[1:])))
    rv_pct = math.sqrt(
        sum(((b["spot"] - a["spot"]) / a["spot"]) ** 2 for a, b in zip(tape, tape[1:]))
    ) * 100
    below_open = sum(1 for spot in spots if spot < open_px) / len(spots)
    below_lo, below_hi = wilson(below_open, len(spots))
    lag1 = pearson(returns[:-1], returns[1:])

    # ---- futures ----------------------------------------------------------
    fut_nonnull = [row for row in futures if row.get("basis") is not None]
    basis_values = [row["basis"] for row in fut_nonnull]
    basis_min_row = min(fut_nonnull, key=lambda row: row["basis"])
    basis_max_row = max(fut_nonnull, key=lambda row: row["basis"])
    fut_vol_peak = max(futures, key=lambda row: row.get("volume") or 0)
    fut_first, fut_last = futures[0], futures[-1]
    fut_change = fut_last["close"] - fut_first["close"]
    fut_oi_change = fut_last["oi"] - fut_first["oi"]

    # ---- open interest ----------------------------------------------------
    ce_open, pe_open = base["ce_oi"], base["pe_oi"]
    ce_close, pe_close = last["ce_oi"], last["pe_oi"]
    ce_delta, pe_delta = ce_close - ce_open, pe_close - pe_open
    pcr_values = [row["pcr_oi"] for row in full]

    def series_change(metric: str) -> tuple[list[float], list[float], list[float]]:
        xs, dce, dpe = [], [], []
        for a, b in zip(full, full[1:]):
            xs.append(b["spot"])
            dce.append(b["ce_oi"] - a["ce_oi"])
            dpe.append(b["pe_oi"] - a["pe_oi"])
        return xs, dce, dpe

    _, dce, dpe = series_change("oi")
    corr_ce = corr_ci(rets_full, dce)
    corr_pe = corr_ci(rets_full, dpe)
    dpcr = [b["pcr_oi"] - a["pcr_oi"] for a, b in zip(full, full[1:])]
    corr_pcr = corr_ci(rets_full, dpcr)

    # ---- walls / max pain -------------------------------------------------
    pain_series = [row for row in tape if row.get("max_pain") is not None]
    pain_transitions = sum(
        1 for a, b in zip(pain_series, pain_series[1:])
        if a["max_pain"] != b["max_pain"]
    )
    call_walls = [row["call_wall"] for row in tape if row.get("call_wall") is not None]
    put_walls = [row["put_wall"] for row in tape if row.get("put_wall") is not None]
    pain_mode = statistics.mode([row["max_pain"] for row in pain_series])
    call_mode = statistics.mode(call_walls) if call_walls else None
    put_mode = statistics.mode(put_walls) if put_walls else None

    # ---- chain: surface, ITM put clusters, strike OI ----------------------
    def chain_map(row: dict[str, Any]) -> dict[float, list[float]]:
        if "chain" in row:
            return {
                float(strike): values
                for strike, values in row["chain"].items()
                if values and len(values) >= 6
            }
        # 10s rows: [strike, ce_ltp, ce_oi, ce_vol, ce_iv, pe_oi, pe_vol]
        return {
            float(values[0]): [values[1], None, values[2], values[5], values[3], values[6]]
            for values in row["rows"]
        }

    base_chain = chain_map(base)
    close_chain = chain_map(last)

    def at_minute(hhmm: str) -> dict[str, Any]:
        for row in tape:
            if row["t"][11:16] == hhmm:
                return row
        raise KeyError(hhmm)

    segments_spec = [
        ("09:15", "09:17", "Opening pop"),
        ("09:17", "09:47", "Opening fade"),
        ("09:47", "11:30", "Morning base"),
        ("11:30", "13:08", "Midday slide"),
        ("13:08", "13:39", "Low test"),
        ("13:39", "14:19", "Afternoon bounce"),
        ("14:19", "15:30", "Late drift"),
        ("15:30", "15:39", "CAS freeze"),
    ]
    segments = []
    for start, end, label in segments_spec:
        a, b = at_minute(start), at_minute(end)
        segments.append({
            "label": label,
            "start": start,
            "end": end,
            "from": a["spot"],
            "to": b["spot"],
            "change": b["spot"] - a["spot"],
            "change_pct": pct(b["spot"], a["spot"]),
            "ce_vol": max(0, b["ce_vol"] - a["ce_vol"]),
            "pe_vol": max(0, b["pe_vol"] - a["pe_vol"]),
        })

    # 5-minute extremes (1 row per minute, gaps verified below)
    moves = []
    for i in range(len(tape) - 5):
        a, b = tape[i], tape[i + 5]
        moves.append({
            "from_t": a["t"][11:16],
            "to_t": b["t"][11:16],
            "change": b["spot"] - a["spot"],
            "change_pct": pct(b["spot"], a["spot"]),
            "ce_vol": max(0, b["ce_vol"] - a["ce_vol"]),
            "pe_vol": max(0, b["pe_vol"] - a["pe_vol"]),
        })
    worst_5 = sorted(moves, key=lambda row: row["change"])[:3]
    best_5 = sorted(moves, key=lambda row: -row["change"])[:3]

    # volume by natural half-hour buckets
    bucket_spec = [
        ("09:15", "09:30"), ("09:30", "10:00"), ("10:00", "10:30"),
        ("10:30", "11:00"), ("11:00", "11:30"), ("11:30", "12:00"),
        ("12:00", "12:30"), ("12:30", "13:00"), ("13:00", "13:30"),
        ("13:30", "14:00"), ("14:00", "14:30"), ("14:30", "15:00"),
        ("15:00", "15:30"), ("15:30", "15:39"),
    ]
    vol_buckets = []
    for start, end in bucket_spec:
        a, b = at_minute(start), at_minute(end)
        vol_buckets.append({
            "label": f"{start}–{end}",
            "ce": max(0, b["ce_vol"] - a["ce_vol"]),
            "pe": max(0, b["pe_vol"] - a["pe_vol"]),
        })

    # 3D surface: 10-minute samples, 24 strikes around the money
    surface_rows = full[::10]
    if surface_rows[-1] is not last:
        surface_rows.append(last)
    surface_strikes = list(range(24_800, 26_001, 50))
    surface_labels = [row["t"][11:16] for row in surface_rows]
    surface_minutes = [
        int((parse_ts(row["t"]) - parse_ts(tape[0]["t"])).total_seconds() // 60)
        for row in surface_rows
    ]
    surface_z: list[list[float | None]] = []
    for strike in surface_strikes:
        line: list[float | None] = []
        for row in surface_rows:
            values = chain_map(row).get(float(strike))
            line.append(values[3] / 1e6 if values and values[3] is not None else None)
        surface_z.append(line)
    # forward-fill gaps along time so the surface has no holes
    for line in surface_z:
        prev = None
        for i, value in enumerate(line):
            if value is None:
                line[i] = prev
            else:
                prev = value
        nxt = None
        for i in range(len(line) - 1, -1, -1):
            if line[i] is None:
                line[i] = nxt
            else:
                nxt = line[i]

    top_strikes = sorted(
        (
            (strike, values)
            for strike, values in close_chain.items()
            if 24_000 <= strike <= 26_500 and values[2] and values[3]
        ),
        key=lambda item: -(item[1][2] + item[1][3]),
    )[:12]
    top_strikes.sort(key=lambda item: item[1][2] + item[1][3])

    oi_changes = []
    for strike, values in close_chain.items():
        old = base_chain.get(strike)
        if (
            old
            and values[2] is not None
            and values[3] is not None
            and old[2] is not None
            and old[3] is not None
        ):
            oi_changes.append({
                "strike": strike,
                "ce": values[2] - old[2],
                "pe": values[3] - old[3],
            })
    oi_changes.sort(key=lambda row: -(abs(row["ce"]) + abs(row["pe"])))
    oi_changes = oi_changes[:10]
    oi_changes.sort(key=lambda row: row["strike"])

    # ITM put clusters: exact single-strike OI values requested by the brief.
    # 09:42 is the first print of the 24,500 cluster; 09:46 is its peak.
    cluster_specs = [
        ("09:42", 24_500.0, "First 24,500 print"),
        ("09:46", 24_500.0, "Peak: 7.24M"),
        ("10:18", 25_300.0, "Largest ITM book"),
        ("13:08", 25_300.0, "Low-test put build"),
    ]
    chain_records = []
    for hhmm, strike, note in cluster_specs:
        candidates = [row for row in chain if row["t"][11:16] == hhmm]
        if not candidates:
            continue
        # use the minute's largest print for that strike: 13:08's 6.07M put
        # book was printed at 13:08:00, not at the end of the minute.
        record, values = max(
            (
                (row, chain_map(row).get(strike))
                for row in candidates
                if chain_map(row).get(strike)
            ),
            key=lambda item: item[1][3] or 0,
        )
        chain_records.append({
            "time": hhmm,
            "strike": strike,
            "pe_oi": values[3],
            "ce_oi": values[2],
            "spot": record["spot"],
            "depth": strike - record["spot"],
            "moneyness": "ITM" if strike > record["spot"] else "OTM",
            "note": note,
        })

    # ---- data quality -----------------------------------------------------
    def minute_list(first: str, last: str) -> list[str]:
        start = parse_ts(f"{date}T{first}:00+05:30")
        end = parse_ts(f"{date}T{last}:00+05:30")
        out = []
        cur = start
        while cur <= end:
            out.append(cur.strftime("%H:%M"))
            cur += timedelta(minutes=1)
        return out

    tape_minutes = {row["t"][11:16] for row in tape}
    sessions_minutes = minute_list("09:15", "15:39")
    tape_missing = [m for m in sessions_minutes if m not in tape_minutes]
    snap_minutes = {row["t"][11:16] for row in snapshots}
    snap_missing = [m for m in sessions_minutes if m not in snap_minutes]

    def gaps(rows: list[dict[str, Any]]) -> list[float]:
        ts = [parse_ts(row["t"]) for row in rows]
        return [(b - a).total_seconds() for a, b in zip(ts, ts[1:])]

    snap_gaps = gaps(snapshots)
    chain_gaps = gaps(chain)
    tape_gaps = gaps(tape)

    # The close window is flat but not a single price: 25,220.45 runs to
    # 15:27 and the CAS print re-fixes it at 25,227.95. Keep both levels.
    frozen_allowed: set[float] = set()
    frozen_start_idx = len(tape) - 1
    while frozen_start_idx >= 0:
        value = tape[frozen_start_idx]["spot"]
        if value not in frozen_allowed:
            if len(frozen_allowed) >= 2:
                break
            frozen_allowed.add(value)
        frozen_start_idx -= 1
    frozen_start_idx += 1
    frozen_run = len(tape) - frozen_start_idx
    frozen_levels = []
    for price in sorted(frozen_allowed):
        rows = [
            row for row in tape[frozen_start_idx:]
            if row["spot"] == price
        ]
        if rows:
            frozen_levels.append({
                "price": price,
                "count": len(rows),
                "first": rows[0]["t"][11:16],
                "last": rows[-1]["t"][11:16],
            })

    out_of_order = sum(
        1
        for a, b in zip(tape_raw, tape_raw[1:])
        if parse_ts(a["t"]) > parse_ts(b["t"])
    )

    # snapshot verdict distributions
    def counter(field: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for row in snapshots:
            value = (row["report"].get(field) or {}).get("verdict")
            key = str(value)
            counts[key] = counts.get(key, 0) + 1
        return counts

    verdicts = {
        "control": counter("control"),
        "regime": counter("regime"),
        "strength": counter("strength"),
        "positioning": counter("positioning"),
        "vix_last": last_snap.get("vix"),
        "straddle_pct": (last_snap.get("regime") or {}).get("straddle_pct"),
        "rv_iv": (last_snap.get("regime") or {}).get("rv_iv_ratio"),
    }

    # ---- chart series -----------------------------------------------------
    fut_by_minute = {row["t"][11:16]: row for row in futures}
    times = [row["t"][11:16] for row in tape]
    fut_aligned = [
        (fut_by_minute.get(minute) or {}).get("close") for minute in times
    ]
    basis_aligned = [
        (fut_by_minute.get(minute) or {}).get("basis") for minute in times
    ]
    full_times = [row["t"][11:16] for row in full]

    charts = {
        "spot": {
            "t": times,
            "spot": spots,
            "fut": fut_aligned,
            "basis": basis_aligned,
            "high_t": high_row["t"][11:16],
            "high": high_px,
            "low_t": low_row["t"][11:16],
            "low": low_px,
        },
        "oi": {
            "t": full_times,
            "ce": [row["ce_oi"] / 1e6 for row in full],
            "pe": [row["pe_oi"] / 1e6 for row in full],
            "pcr": [row["pcr_oi"] for row in full],
        },
        "volume": {
            "labels": [row["label"] for row in vol_buckets],
            "ce": [row["ce"] / 1e6 for row in vol_buckets],
            "pe": [row["pe"] / 1e6 for row in vol_buckets],
        },
        "walls": {
            "t": [row["t"][11:16] for row in tape],
            "spot": spots,
            "max_pain": [row.get("max_pain") for row in tape],
            "call_wall": [row.get("call_wall") for row in tape],
            "put_wall": [row.get("put_wall") for row in tape],
        },
        "surface": {
            "x": surface_minutes,
            "xlabels": surface_labels,
            "y": surface_strikes,
            "z": surface_z,
        },
        "strikes": {
            "labels": [f"{int(row[0]):,}" for row in top_strikes],
            "ce": [row[1][2] / 1e6 for row in top_strikes],
            "pe": [row[1][3] / 1e6 for row in top_strikes],
        },
        "changes": {
            "labels": [f"{int(row['strike']):,}" for row in oi_changes],
            "ce": [row["ce"] / 1e6 for row in oi_changes],
            "pe": [row["pe"] / 1e6 for row in oi_changes],
        },
        "timeline": [
            {
                "label": seg["label"],
                "start": int(
                    (
                        parse_ts(f"{date}T{seg['start']}:00+05:30")
                        - parse_ts(f"{date}T09:15:00+05:30")
                    ).total_seconds()
                    // 60
                ),
                "dur": int(
                    (
                        parse_ts(f"{date}T{seg['end']}:00+05:30")
                        - parse_ts(f"{date}T{seg['start']}:00+05:30")
                    ).total_seconds()
                    // 60
                ),
                "change": seg["change"],
            }
            for seg in segments
        ],
    }

    # external research lane, if it has landed by the time we build
    external_quant = None
    external = None
    if QUANT_JSON.exists():
        try:
            external_quant = json.loads(QUANT_JSON.read_text())
            ext_session = external_quant.get("session") or {}
            ext_futures = external_quant.get("futures") or {}
            ext_options = external_quant.get("options") or {}
            ext_flow = external_quant.get("flow") or {}
            top_bucket = (ext_flow.get("top_buckets") or [{}])[0]
            first_episode = (ext_flow.get("episodes") or [{}])[0]
            external = {
                "generated_at": external_quant.get("generated_at"),
                "session": {
                    "open": ext_session.get("open"),
                    "high": ext_session.get("high"),
                    "low": ext_session.get("low"),
                    "low_time": ext_session.get("low_time"),
                    "last_live_close": ext_session.get("last_live_close"),
                    "last_live_time": ext_session.get("last_live_time"),
                    "cas_print": ext_session.get("cas_print"),
                    "range_pts": ext_session.get("range_pts"),
                },
                "futures": {
                    "basis_mean": (ext_futures.get("basis") or {}).get("mean"),
                    "basis_positive_share": (ext_futures.get("basis") or {}).get("share_positive_pct"),
                    "basis_last": (ext_futures.get("basis") or {}).get("last"),
                    "basis_last_time": (ext_futures.get("basis") or {}).get("last_time"),
                    "oi_change_pct": (ext_futures.get("oi") or {}).get("change_pct"),
                    "price_change_pts": (ext_futures.get("price") or {}).get("change_pts"),
                },
                "options": {
                    "ce_open": (ext_options.get("oi") or {}).get("ce_open"),
                    "ce_close": (ext_options.get("oi") or {}).get("ce_close"),
                    "ce_change_pct": (ext_options.get("oi") or {}).get("ce_change_pct"),
                    "pe_open": (ext_options.get("oi") or {}).get("pe_open"),
                    "pe_close": (ext_options.get("oi") or {}).get("pe_close"),
                    "pe_change_pct": (ext_options.get("oi") or {}).get("pe_change_pct"),
                    "pcr_close": (ext_options.get("pcr_oi") or {}).get("close"),
                    "max_pain_close": (ext_options.get("max_pain") or {}).get("close"),
                },
                "flow": {
                    "top_bucket_from": top_bucket.get("from"),
                    "top_bucket_to": top_bucket.get("to"),
                    "top_bucket_d_itm": top_bucket.get("d_itm_pe_oi"),
                    "top_bucket_lots": round((top_bucket.get("d_itm_pe_oi") or 0) / 65),
                    "top_episode_from": top_bucket.get("from"),
                    "top_episode_to": top_bucket.get("to"),
                    "n_buckets": ext_flow.get("n_buckets"),
                },
                "quant_read": external_quant.get("quant_read") or [],
                "caveats": external_quant.get("caveats") or [],
            }
        except Exception:
            external_quant = None
            external = None

    return {
        "schema": "nifty_tape_report/v1",
        "date": date,
        "generated_at": datetime.now(IST).isoformat(timespec="seconds"),
        "source_files": {name: str(path.relative_to(ROOT)) for name, path in paths.items()},
        "external_quant_present": external_quant is not None,
        "external": external,
        "session": {
            "open": open_px,
            "prior_close": prior_close,
            "high": high_px,
            "high_time": high_row["t"][11:16],
            "low": low_px,
            "low_time": low_row["t"][11:16],
            "close": close_px,
            "change": close_px - prior_close,
            "change_pct": pct(close_px, prior_close),
            "open_gap": open_px - prior_close,
            "open_gap_pct": pct(open_px, prior_close),
            "range": high_px - low_px,
            "range_pct": (high_px - low_px) / prior_close * 100,
            "range_pct_of_prior": (high_px - low_px) / prior_close * 100,
            "below_open_share": below_open,
            "below_open_ci": [below_lo, below_hi],
            "rv_pts": rv_pts,
            "rv_pct": rv_pct,
            "n_returns": len(rets_full),
            "mean_1m_bps": mean_ret * 1e4,
            "mean_1m_ci_bps": [(mean_ret - 1.96 * se_ret) * 1e4, (mean_ret + 1.96 * se_ret) * 1e4],
            "sd_1m_bps": sd_ret * 1e4,
            "down_minutes_share": sum(1 for r in returns if r < 0) / len(returns),
            "lag1_autocorr": lag1,
            "pivots": {
                "pp": pivot.get("pp"),
                "r1": pivot.get("r1"),
                "r2": pivot.get("r2"),
                "s1": pivot.get("s1"),
                "s2": pivot.get("s2"),
                "s3": pivot.get("s3"),
            },
        },
        "futures": {
            "first": fut_first["close"],
            "last": fut_last["close"],
            "change": fut_change,
            "change_pct": pct(fut_last["close"], fut_first["close"]),
            "oi_first": fut_first["oi"],
            "oi_last": fut_last["oi"],
            "oi_change": fut_oi_change,
            "oi_change_pct": pct(fut_last["oi"], fut_first["oi"]),
            "basis_first": fut_nonnull[0]["basis"],
            "basis_first_time": fut_nonnull[0]["t"][11:16],
            "basis_last": fut_last.get("basis"),
            "basis_min": basis_min_row["basis"],
            "basis_min_time": basis_min_row["t"][11:16],
            "basis_max": basis_max_row["basis"],
            "basis_max_time": basis_max_row["t"][11:16],
            "volume_total": sum(row.get("volume") or 0 for row in futures),
            "volume_peak": fut_vol_peak.get("volume"),
            "volume_peak_time": fut_vol_peak["t"][11:16],
            "expiry": fut_last.get("expiry"),
        },
        "oi": {
            "ce_open": ce_open,
            "ce_close": ce_close,
            "ce_delta": ce_delta,
            "ce_pct": pct(ce_close, ce_open),
            "pe_open": pe_open,
            "pe_close": pe_close,
            "pe_delta": pe_delta,
            "pe_pct": pct(pe_close, pe_open),
            "pcr_open": pcr_values[0],
            "pcr_close": pcr_values[-1],
            "pcr_min": min(pcr_values),
            "pcr_max": max(pcr_values),
            "ce_vol": last["ce_vol"],
            "pe_vol": last["pe_vol"],
            "pcr_vol": last.get("pcr_vol"),
            "net_gex": last.get("net_gex"),
            "atm_iv": last.get("atm_ce_iv"),
            "top_changes": oi_changes,
            "top_strikes": [
                {
                    "strike": row[0],
                    "ce_oi": row[1][2],
                    "pe_oi": row[1][3],
                    "ce_change": (
                        row[1][2] - base_chain[row[0]][2]
                        if row[0] in base_chain and base_chain[row[0]][2] is not None
                        else None
                    ),
                    "pe_change": (
                        row[1][3] - base_chain[row[0]][3]
                        if row[0] in base_chain and base_chain[row[0]][3] is not None
                        else None
                    ),
                }
                for row in top_strikes
            ],
            "corr_return_dce": corr_ce,
            "corr_return_dpe": corr_pe,
            "corr_return_dpcr": corr_pcr,
        },
        "pain": {
            "start": pain_series[0]["max_pain"],
            "end": pain_series[-1]["max_pain"],
            "transitions": pain_transitions,
            "mode": pain_mode,
            "call_wall_mode": call_mode,
            "put_wall_mode": put_mode,
            "call_wall_last": last.get("call_wall"),
            "put_wall_last": last.get("put_wall"),
            "distance_close": close_px - (pain_series[-1]["max_pain"] or close_px),
        },
        "itm_pe": chain_records,
        "segments": segments,
        "moves": {"worst_5": worst_5, "best_5": best_5},
        "verdicts": verdicts,
        "quality": {
            "tape_rows": len(tape),
            "tape_first": tape[0]["t"][11:19],
            "tape_last": tape[-1]["t"][11:19],
            "tape_missing_minutes": tape_missing,
            "tape_sorted_in_file": tape_sorted,
            "tape_out_of_order_rows": out_of_order,
            "tape_max_gap_s": max(tape_gaps),
            "backfill_row": {
                "time": tape[0]["t"][11:19],
                "spot": tape[0]["spot"],
                "ce_oi": tape[0]["ce_oi"],
                "pe_oi": tape[0]["pe_oi"],
                "next_time": tape[1]["t"][11:19],
                "next_ce_oi": tape[1]["ce_oi"],
                "next_pe_oi": tape[1]["pe_oi"],
            },
            "futures_rows": len(futures),
            "futures_max_gap_s": max(gaps(futures)),
            "snapshot_rows": len(snapshots),
            "snapshot_missing_minutes": snap_missing,
            "snapshot_max_gap_s": max(snap_gaps),
            "snapshot_median_gap_s": statistics.median(snap_gaps),
            "chain_rows": len(chain),
            "chain_max_gap_s": max(chain_gaps),
            "chain_median_gap_s": statistics.median(chain_gaps),
            "chain_strikes_per_row": sorted({len(row["rows"]) for row in chain}),
            "chain_first": chain[0]["t"][11:19],
            "chain_last": chain[-1]["t"][11:19],
            "frozen_run_prints": frozen_run,
            "frozen_start": tape[frozen_start_idx]["t"][11:16],
            "frozen_price": close_px,
            "frozen_levels": frozen_levels,
            "chain_depth_note": "10s chain carries ~30 strikes near the money, not the full 158-strike book",
        },
        "charts": charts,
        "palette": load_palette(),
    }


# ---------------------------------------------------------------------------
# HTML rendering
# ---------------------------------------------------------------------------
CSS = """
:root{
  --tr-bg:__BG__;--tr-panel:__PANEL__;--tr-raised:__RAISED__;--tr-border:__BORDER__;
  --tr-text:__TEXT__;--tr-muted:__MUTED__;--tr-amber:__AMBER__;--tr-green:__GREEN__;
  --tr-red:__RED__;--tr-blue:__BLUE__;--tr-yellow:__YELLOW__;
  --tr-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--tr-bg);color:var(--tr-text);
  font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-variant-numeric:tabular-nums}
a{color:var(--tr-blue)}
.tr-shell{max-width:1600px;margin:0 auto;padding:28px 32px 54px}
.tr-kicker{font:600 10px/1.2 var(--tr-mono);letter-spacing:.15em;text-transform:uppercase;color:var(--tr-amber)}
h1{font-size:clamp(27px,4vw,46px);line-height:1.05;letter-spacing:-.025em;margin:12px 0 14px;max-width:1120px}
h2{font-size:19px;letter-spacing:-.01em;margin:0 0 4px;font-weight:650}
h3{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--tr-amber);
  margin:26px 0 10px;font-weight:600}
p{margin:0 0 10px}
.tr-dek{color:var(--tr-muted);font-size:15px;max-width:980px;margin:0 0 14px}
.tr-meta{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--tr-muted);font:11px/1.4 var(--tr-mono)}
.tr-meta b{color:var(--tr-text);font-weight:500}
.tr-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--tr-border);
  background:var(--tr-panel);border-radius:999px;padding:3px 9px;font:10px/1.4 var(--tr-mono);color:var(--tr-muted)}
.tr-dot{width:6px;height:6px;border-radius:50%;background:var(--tr-green);display:inline-block}
.tr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(142px,1fr));gap:8px;margin-top:18px}
.tr-kpi{background:var(--tr-panel);border:1px solid var(--tr-border);border-radius:8px;padding:10px 12px;min-width:0}
.tr-kpi .l{font:9px/1.3 var(--tr-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--tr-muted);
  display:block;margin-bottom:4px;white-space:nowrap}
.tr-kpi .v{display:block;font:600 19px/1.2 var(--tr-mono);letter-spacing:-.02em;white-space:nowrap}
.tr-kpi .s{display:block;font:9.5px/1.3 var(--tr-mono);color:var(--tr-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tr-neg{color:var(--tr-red)}.tr-pos{color:var(--tr-green)}.tr-amber{color:var(--tr-amber)}
.tr-section{margin-top:34px;padding-top:18px;border-top:1px solid var(--tr-border)}
.tr-read{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}
.tr-lead{grid-column:span 2;background:linear-gradient(180deg,var(--tr-raised),var(--tr-panel));
  border:1px solid var(--tr-border);border-left:3px solid var(--tr-amber);border-radius:8px;padding:16px 18px}
.tr-lead-body{columns:2;column-gap:30px}
.tr-lead-body p{break-inside:avoid}
.tr-lead p{font-size:16px;line-height:1.6;margin:0 0 10px}
.tr-lead p:last-child{margin:0}
.tr-bullets{grid-column:span 2;list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.tr-bullets li{background:var(--tr-panel);border:1px solid var(--tr-border);border-radius:8px;
  padding:9px 12px;font-size:13.2px;line-height:1.55}
.tr-bullets b{color:var(--tr-text);font-weight:650}
.tr-bullets li:last-child{grid-column:span 2}
.tr-bullets .tag{font:9px/1.3 var(--tr-mono);letter-spacing:.1em;text-transform:uppercase;
  color:var(--tr-muted);display:block;margin-bottom:2px}
.tr-note{color:var(--tr-muted);font-size:11px;line-height:1.5;margin:8px 2px 0}
.tr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
.tr-span2{grid-column:span 2}
.tr-panel{background:var(--tr-panel);border:1px solid var(--tr-border);border-radius:10px;
  padding:12px 14px 10px;min-width:0;overflow:hidden;margin:0}
.tr-panel figcaption{display:flex;justify-content:space-between;gap:10px;align-items:baseline;
  margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.01em}
.tr-panel figcaption span{font:10px/1.3 var(--tr-mono);color:var(--tr-muted);font-weight:400;text-align:right}
.tr-chart{width:100%;height:330px;min-width:0}
.tr-chart-sm{height:260px}
.tr-chart-lg{height:360px}
.tr-table-wrap{background:var(--tr-panel);border:1px solid var(--tr-border);border-radius:8px;
  overflow-x:auto;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;min-width:560px;font-size:12px}
caption{text-align:left;padding:10px 12px 8px;color:var(--tr-muted);font:10px/1.4 var(--tr-mono);
  letter-spacing:.04em;text-transform:uppercase}
th{font:9px/1.3 var(--tr-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--tr-muted);
  text-align:left;padding:8px 12px;border-bottom:1px solid var(--tr-border);background:var(--tr-raised);white-space:nowrap}
td{padding:7px 12px;border-bottom:1px solid rgba(44,49,59,.55);vertical-align:top}
tr:last-child td{border-bottom:0}
td.n,th.n{text-align:right;font-family:var(--tr-mono);white-space:nowrap}
td.c,th.c{text-align:center}
tbody tr:hover td{background:rgba(31,36,45,.55)}
.tr-sub{color:var(--tr-muted);font-size:10.5px}
.tr-hide-sm{display:table-cell}
@media(max-width:600px){
  .tr-hide-sm{display:none}
  table.tr-compact{min-width:0}
}
.tr-chip{display:inline-block;border-radius:999px;padding:1px 7px;font:9px/1.5 var(--tr-mono);
  border:1px solid transparent;white-space:nowrap}
.tr-chip-ok{color:var(--tr-green);border-color:rgba(47,163,107,.35);background:rgba(47,163,107,.1)}
.tr-chip-warn{color:var(--tr-yellow);border-color:rgba(201,145,47,.35);background:rgba(201,145,47,.1)}
.tr-chip-bad{color:var(--tr-red);border-color:rgba(229,96,106,.35);background:rgba(229,96,106,.1)}
.tr-chip-neutral{color:var(--tr-muted);border-color:var(--tr-border);background:var(--tr-raised)}
.tr-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.tr-card{background:var(--tr-panel);border:1px solid var(--tr-border);border-radius:8px;padding:12px 14px}
.tr-card h4{margin:0 0 6px;font:10px/1.3 var(--tr-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--tr-amber)}
.tr-card p{margin:0;color:var(--tr-muted);font-size:12px;line-height:1.55}
.tr-card p b{color:var(--tr-text)}
.tr-crosscheck{background:var(--tr-panel);border:1px solid var(--tr-border);border-radius:10px;padding:14px 16px;margin-top:12px}
.tr-crosscheck h4{margin:0 0 3px;font-size:13px;font-weight:650}
.tr-crosscheck .sub{color:var(--tr-muted);font-size:10.5px;margin-bottom:10px}
.tr-xgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin-bottom:10px}
.tr-xcell{background:var(--tr-raised);border:1px solid var(--tr-border);border-radius:6px;padding:8px 10px;min-width:0}
.tr-xcell .k{font:9px/1.3 var(--tr-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--tr-muted)}
.tr-xcell .a{font:600 14px/1.35 var(--tr-mono);margin-top:2px}
.tr-xcell .b{font:10px/1.4 var(--tr-mono);color:var(--tr-muted)}
.tr-xlist{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.tr-xlist li{font-size:11.5px;line-height:1.5;color:var(--tr-muted);padding-left:10px;border-left:2px solid var(--tr-border)}
.tr-xlist b{color:var(--tr-text);font-weight:600}
.tr-explain{display:flex;flex-direction:column;align-self:stretch}
.tr-explain-read{margin:11px 0 0;font-size:11.5px;line-height:1.5;color:var(--tr-muted)}
.tr-explain-read b{color:var(--tr-text);font-weight:600}
.tr-explain-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--tr-border);
  border:1px solid var(--tr-border);border-radius:6px;overflow:hidden;margin-top:12px}
.tr-explain-stats div{background:var(--tr-raised);padding:7px 8px;min-width:0}
.tr-explain-stats span{display:block;font:8.5px/1.3 var(--tr-mono);letter-spacing:.07em;text-transform:uppercase;color:var(--tr-muted)}
.tr-explain-stats b{display:block;font:600 13px/1.35 var(--tr-mono);margin-top:2px}
.tr-explain-foot{margin:auto 0 0;padding-top:10px;border-top:1px solid var(--tr-border);
  color:var(--tr-muted);font-size:10.5px;line-height:1.5}
.tr-explain ul{list-style:none;margin:2px 0 0;padding:0;display:grid;gap:9px}
.tr-explain li{font-size:11.5px;line-height:1.5;color:var(--tr-muted);padding-left:11px;border-left:2px solid var(--tr-border)}
.tr-explain li:first-child{border-left-color:var(--tr-green)}
.tr-explain li:nth-child(2){border-left-color:var(--tr-amber)}
.tr-explain li:nth-child(3){border-left-color:var(--tr-red)}
.tr-explain b{color:var(--tr-text);font-weight:600}
.tr-quality-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(232px,1fr));gap:8px}
.tr-qcard{background:var(--tr-panel);border:1px solid var(--tr-border);border-radius:8px;padding:10px 12px;min-width:0}
.tr-qcard .top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:5px}
.tr-qcard h4{margin:0;font:9px/1.3 var(--tr-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--tr-muted)}
.tr-qcard .res{font:600 13px/1.35 var(--tr-mono);margin-bottom:3px}
.tr-qcard .nt{font-size:10.5px;line-height:1.45;color:var(--tr-muted)}
.tr-quality td:first-child{white-space:nowrap}
.tr-foot{margin-top:34px;padding-top:14px;border-top:1px solid var(--tr-border);
  color:var(--tr-muted);font-size:10.5px;line-height:1.6}
.tr-foot b{color:var(--tr-text)}
.tr-legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin:8px 0 0;color:var(--tr-muted);font:10px/1.4 var(--tr-mono)}
.tr-legend i{display:inline-block;width:9px;height:2px;margin-right:5px;vertical-align:middle}
@media(max-width:980px){
  .tr-shell{padding:18px 14px 40px}
  .tr-read{grid-template-columns:1fr}
  .tr-lead{grid-column:auto}
  .tr-lead-body{columns:1}
  .tr-bullets{grid-column:auto;grid-template-columns:1fr}
  .tr-bullets li:last-child{grid-column:auto}
  .tr-grid{grid-template-columns:1fr}
  .tr-span2{grid-column:auto}
  h1{font-size:28px}
  .tr-chart{height:280px}
  .tr-chart-sm{height:240px}
  .tr-chart-lg{height:360px}
}
@media(max-width:600px){
  .tr-shell{padding:14px 10px 34px}
  .tr-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tr-kpi .v{font-size:16px}
  h1{font-size:25px}
  .tr-chart{height:270px}
  .tr-chart-sm{height:230px}
  .tr-chart-lg{height:360px}
  table{min-width:520px}
  table.tr-compact{min-width:0}
  th,td{padding:6px 8px}
  table.tr-compact th,table.tr-compact td{padding:6px 5px}
  .tr-panel{padding:10px 8px 8px}
  .tr-panel figcaption{font-size:11px;flex-direction:column;gap:2px;align-items:flex-start}
}
"""

JS = r"""
const D = JSON.parse(document.getElementById('tr-data').textContent);
const C = D.colors;
const narrow = window.innerWidth < 700;
const AX = {
  gridcolor: 'rgba(155,155,155,0.13)',
  zerolinecolor: 'rgba(155,155,155,0.22)',
  linecolor: C.border,
  tickfont: {size: 9, color: C.muted},
  titlefont: {size: 9, color: C.muted},
  automargin: true
};
const BASE = {
  paper_bgcolor: C.panel,
  plot_bgcolor: C.panel,
  font: {family: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif', size: 10, color: C.text},
  margin: {l: narrow ? 40 : 54, r: narrow ? 30 : 24, t: 26, b: 34},
  hovermode: 'x unified',
  hoverlabel: {bgcolor: C.raised, bordercolor: C.border, font: {color: C.text, size: 10}},
  legend: {orientation: 'h', x: 0, y: 1.12, font: {size: 9, color: C.muted}, bgcolor: 'rgba(0,0,0,0)'},
  xaxis: Object.assign({}, AX, {type: 'category', nticks: narrow ? 5 : 9}),
  yaxis: Object.assign({}, AX, {side: 'right'})
};

function layout(extra) { return Object.assign({}, BASE, extra || {}); }
function draw(id, traces, extra) {
  const el = document.getElementById(id);
  const lay = layout(extra || {});
  lay.height = el.clientHeight;
  Plotly.newPlot(el, traces, lay, {responsive: true, displayModeBar: false, displaylogo: false, scrollZoom: false});
}
const pick = (arr, n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * (arr.length - 1) / (n - 1))]);
  return out;
};
const clockTicks = (labels) => {
  const wanted = narrow
    ? ['09:15', '10:30', '12:00', '13:30', '15:00']
    : ['09:15', '09:45', '10:30', '11:15', '12:00', '12:45', '13:30', '14:15', '15:00', '15:39'];
  return wanted.filter(t => labels.includes(t));
};
const line = (x, y, color, name, width, dash) => ({
  x, y, type: 'scatter', mode: 'lines', name,
  line: {color, width: width || 1.4, dash: dash || 'solid'},
  hovertemplate: '%{x} · %{y:,.2f}<extra></extra>'
});

/* 1. spot + futures */
const spotTraces = [
  line(D.spot.t, D.spot.spot, C.text, 'NIFTY spot', 1.5),
  line(D.spot.t, D.spot.fut, C.blue, 'NIFTY futures', 1.1, 'dot'),
  {x: [D.spot.high_t], y: [D.spot.high], mode: 'markers+text', name: 'High',
   marker: {color: C.red, size: 6}, text: ['HIGH'], textposition: 'top center', showlegend: false,
   textfont: {size: 8, color: C.muted}, hovertemplate: 'HIGH %{y:,.2f}<extra></extra>'},
  {x: [D.spot.low_t], y: [D.spot.low], mode: 'markers+text', name: 'Low',
   marker: {color: C.green, size: 6}, text: ['LOW'], textposition: 'bottom center', showlegend: false,
   textfont: {size: 8, color: C.muted}, hovertemplate: 'LOW %{y:,.2f}<extra></extra>'}
];
const levels = [
  ['Prior close ' + D.levels.prior.toLocaleString('en-IN'), D.levels.prior, C.muted, 'dash'],
  ['S1 ' + D.levels.s1.toLocaleString('en-IN'), D.levels.s1, C.amber, 'dot'],
  ['S2 ' + D.levels.s2.toLocaleString('en-IN'), D.levels.s2, C.yellow, 'dot']
];
draw('tr-chart-spot', spotTraces, {
  shapes: levels.map(l => ({type: 'line', xref: 'paper', x0: 0, x1: 1, y0: l[1], y1: l[1],
    line: {color: l[2], width: 1, dash: l[3]}})),
  annotations: narrow ? [] : levels.map((l, i) => ({xref: 'paper', x: 1, y: l[1], xanchor: 'right', yanchor: 'bottom',
    text: l[0], showarrow: false, font: {size: 8, color: C.muted}, bgcolor: C.panel, borderpad: 1})),
  xaxis: Object.assign({}, AX, {type: 'category', tickvals: clockTicks(D.spot.t), ticktext: clockTicks(D.spot.t)}),
  yaxis: Object.assign({}, AX, {side: 'right', range: [D.spot.low - 45, D.spot.high + 45],
    title: {text: 'index points', font: {size: 9, color: C.muted}}}),
  legend: {orientation: 'h', x: 0, y: 1.12, font: {size: 9, color: C.muted}},
  margin: {l: narrow ? 40 : 54, r: narrow ? 30 : 24, t: 36, b: 34}
});

/* 2. basis */
const basisY = D.spot.basis;
draw('tr-chart-basis', [{
  x: D.spot.t, y: basisY, type: 'scatter', mode: 'lines', name: 'Futures − spot',
  line: {color: C.amber, width: 1.3}, fill: 'tozeroy', fillcolor: 'rgba(217,144,42,0.13)',
  connectgaps: false, hovertemplate: '%{x} · %{y:+.2f} pts<extra></extra>'
}], {
  showlegend: false,
  xaxis: Object.assign({}, AX, {type: 'category', tickvals: clockTicks(D.spot.t), ticktext: clockTicks(D.spot.t)}),
  yaxis: Object.assign({}, AX, {side: 'right', title: {text: 'basis (pts)', font: {size: 9, color: C.muted}}}),
  shapes: [{type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0,
    line: {color: C.muted, width: 1, dash: 'dot'}}]
});

/* 3. open interest + PCR */
draw('tr-chart-oi', [
  {x: D.oi.t, y: D.oi.ce, type: 'scatter', mode: 'lines', name: 'CE OI',
   line: {color: C.red, width: 1.5}, hovertemplate: 'CE OI %{y:,.1f}M<extra></extra>'},
  {x: D.oi.t, y: D.oi.pe, type: 'scatter', mode: 'lines', name: 'PE OI',
   line: {color: C.green, width: 1.5}, hovertemplate: 'PE OI %{y:,.1f}M<extra></extra>'},
  {x: D.oi.t, y: D.oi.pcr, type: 'scatter', mode: 'lines', name: 'PCR (OI)',
   yaxis: 'y2', line: {color: C.text, width: 1, dash: 'dot'},
   hovertemplate: 'PCR %{y:.2f}<extra></extra>'}
], {
  xaxis: Object.assign({}, AX, {type: 'category', tickvals: clockTicks(D.oi.t), ticktext: clockTicks(D.oi.t)}),
  yaxis: Object.assign({}, AX, {side: 'left', title: {text: 'OI (M contracts)', font: {size: 9, color: C.muted}}}),
  yaxis2: Object.assign({}, AX, {overlaying: 'y', side: 'right', showgrid: false,
    title: {text: 'PCR', font: {size: 9, color: C.muted}}, range: [0.6, 1.2]}),
  legend: {orientation: 'h', x: 0, y: 1.14, font: {size: 9, color: C.muted}},
  margin: {l: narrow ? 40 : 54, r: narrow ? 30 : 24, t: 36, b: 34}
});

/* 4. volume bars */
draw('tr-chart-volume', [
  {x: D.volume.labels, y: D.volume.ce, type: 'bar', name: 'CE volume',
   marker: {color: C.red, opacity: 0.8}, hovertemplate: 'CE %{y:,.1f}M<extra></extra>'},
  {x: D.volume.labels, y: D.volume.pe, type: 'bar', name: 'PE volume',
   marker: {color: C.green, opacity: 0.8}, hovertemplate: 'PE %{y:,.1f}M<extra></extra>'}
], {
  barmode: 'group', bargap: 0.22,
  legend: {orientation: 'h', x: 0, y: 1.13, font: {size: 9, color: C.muted}},
  margin: {l: narrow ? 40 : 54, r: narrow ? 30 : 24, t: 34, b: 40},
  xaxis: Object.assign({}, AX, {type: 'category', tickangle: narrow ? 0 : -45,
    tickvals: (narrow ? [0, 3, 6, 9, 12] : D.volume.labels.map((_, i) => i)
      .filter(i => i % 2 === 0 || i === D.volume.labels.length - 1)).map(i => D.volume.labels[i]),
    ticktext: (narrow ? [0, 3, 6, 9, 12] : D.volume.labels.map((_, i) => i)
      .filter(i => i % 2 === 0 || i === D.volume.labels.length - 1)).map(i =>
        narrow ? D.volume.labels[i].split('–')[0] : D.volume.labels[i])}),
  yaxis: Object.assign({}, AX, {side: 'right', title: {text: narrow ? 'M' : 'contracts (M)', font: {size: 9, color: C.muted}}})
});

/* 5. max pain + walls */
draw('tr-chart-walls', [
  line(D.walls.t, D.walls.spot, C.text, 'Spot', 1.1),
  {x: D.walls.t, y: D.walls.call_wall, type: 'scatter', mode: 'lines', name: 'Call wall',
   line: {color: C.red, width: 1.2, shape: 'hv'}, connectgaps: true, hovertemplate: 'call wall %{y:,.0f}<extra></extra>'},
  {x: D.walls.t, y: D.walls.put_wall, type: 'scatter', mode: 'lines', name: 'Put wall',
   line: {color: C.green, width: 1.2, shape: 'hv'}, connectgaps: true, hovertemplate: 'put wall %{y:,.0f}<extra></extra>'},
  {x: D.walls.t, y: D.walls.max_pain, type: 'scatter', mode: 'lines', name: 'Max pain',
   line: {color: C.amber, width: 1.4, shape: 'hv', dash: 'dash'}, connectgaps: true, hovertemplate: 'max pain %{y:,.0f}<extra></extra>'}
], {
  xaxis: Object.assign({}, AX, {type: 'category', tickvals: clockTicks(D.walls.t), ticktext: clockTicks(D.walls.t)}),
  margin: {l: narrow ? 40 : 54, r: narrow ? 34 : 30, t: 46, b: 34},
  legend: {orientation: 'h', x: 0, y: 1.2, font: {size: narrow ? 8.5 : 9, color: C.muted}},
  yaxis: Object.assign({}, AX, {side: 'right', range: [24950, 25620],
    title: {text: narrow ? '' : 'strike', font: {size: 9, color: C.muted}}})
});

/* 6. 3D surface */
draw('tr-chart-3d', [{
  type: 'surface', x: D.surface.x, y: D.surface.y, z: D.surface.z,
  colorscale: [[0, C.panel], [0.25, C.teal], [0.55, C.amber], [0.8, '#E8E8E8'], [1, '#FFFFFF']],
  showscale: true,
  colorbar: {title: {text: 'PE OI (M)', side: 'top', font: {size: 9, color: C.muted}},
    tickfont: {size: 8, color: C.muted}, thickness: 10, len: 0.65},
  contours: {z: {show: false}},
  hovertemplate: '%{y:,.0f} · %{z:,.1f}M<extra></extra>'
}], {
  margin: {l: 0, r: 0, t: 8, b: 0},
  scene: {
    bgcolor: C.panel,
    xaxis: {title: {text: 'time', font: {size: narrow ? 9 : 11, color: C.muted}},
      tickvals: D.surface.x.filter((_, i) => i % 13 === 0 || i === D.surface.x.length - 1),
      ticktext: D.surface.xlabels.filter((_, i) => i % 13 === 0 || i === D.surface.xlabels.length - 1),
      tickfont: {size: narrow ? 8 : 9, color: C.muted}, nticks: 5},
    yaxis: {title: {text: 'strike', font: {size: narrow ? 9 : 11, color: C.muted}},
      tickfont: {size: narrow ? 8 : 9, color: C.muted}, nticks: 5},
    zaxis: {title: {text: narrow ? '' : 'PE OI (M)', font: {size: narrow ? 9 : 11, color: C.muted}},
      tickfont: {size: narrow ? 8 : 9, color: C.muted}, nticks: 4},
    aspectratio: {x: 1.55, y: 1, z: 0.85},
    camera: {eye: {x: narrow ? 3.25 : 2.35, y: narrow ? 3.25 : 2.35, z: narrow ? 1.75 : 1.25}}
  }
});

/* 7. top strikes */
draw('tr-chart-strikes', [
  {y: D.strikes.labels, x: D.strikes.ce, type: 'bar', orientation: 'h', name: 'CE OI',
   marker: {color: C.red, opacity: 0.82}, hovertemplate: 'CE %{x:,.1f}M<extra></extra>'},
  {y: D.strikes.labels, x: D.strikes.pe, type: 'bar', orientation: 'h', name: 'PE OI',
   marker: {color: C.green, opacity: 0.82}, hovertemplate: 'PE %{x:,.1f}M<extra></extra>'}
], {
  barmode: 'group', bargap: 0.25,
  legend: {orientation: 'h', x: 0, y: 1.14, font: {size: 9, color: C.muted}},
  margin: {l: narrow ? 50 : 58, r: 12, t: 40, b: 30},
  xaxis: Object.assign({}, AX, {title: {text: 'OI at 15:39 (M)', font: {size: 9, color: C.muted}}}),
  yaxis: Object.assign({}, AX, {side: 'left', type: 'category', tickfont: {size: 9, color: C.muted}})
});

/* 8. OI change by strike */
draw('tr-chart-changes', [
  {y: D.changes.labels, x: D.changes.ce, type: 'bar', orientation: 'h', name: 'CE ΔOI',
   marker: {color: C.red, opacity: 0.82}, hovertemplate: 'CE Δ %{x:+,.2f}M<extra></extra>'},
  {y: D.changes.labels, x: D.changes.pe, type: 'bar', orientation: 'h', name: 'PE ΔOI',
   marker: {color: C.green, opacity: 0.82}, hovertemplate: 'PE Δ %{x:+,.2f}M<extra></extra>'}
], {
  barmode: 'group', bargap: 0.25,
  legend: {orientation: 'h', x: 0, y: 1.14, font: {size: 9, color: C.muted}},
  margin: {l: narrow ? 50 : 58, r: 12, t: 40, b: 30},
  xaxis: Object.assign({}, AX, {zeroline: true, zerolinecolor: C.muted,
    title: {text: '09:16 → 15:39 change (M)', font: {size: 9, color: C.muted}}}),
  yaxis: Object.assign({}, AX, {side: 'left', type: 'category', tickfont: {size: 9, color: C.muted}})
});

/* 9. event timeline */
const ev = D.timeline;
const evColor = ev.map(e => e.change < -1 ? C.red : (e.change > 1 ? C.green : C.muted));
draw('tr-chart-timeline', [{
  x: ev.map(e => e.dur), y: ev.map(e => e.label), base: ev.map(e => e.start),
  type: 'bar', orientation: 'h', marker: {color: evColor, opacity: 0.85},
  text: ev.map(e => (e.change >= 0 ? '+' : '') + e.change.toFixed(0) + ' pts'),
  textposition: 'inside', insidetextanchor: 'middle',
  textfont: {size: 9, color: '#000000'},
  hovertemplate: '%{y} · %{text}<extra></extra>'
}], {
  margin: {l: narrow ? 96 : 110, r: 12, t: 22, b: 34},
  xaxis: Object.assign({}, AX, {type: 'linear', range: [0, 385],
    tickvals: [0, 60, 120, 180, 240, 300, 360],
    ticktext: ['09:15', '10:15', '11:15', '12:15', '13:15', '14:15', '15:15'],
    title: {text: 'session clock (IST)', font: {size: 9, color: C.muted}}}),
  yaxis: Object.assign({}, AX, {side: 'left', autorange: 'reversed', tickfont: {size: 8.5, color: C.text}}),
  showlegend: false
});
"""


def table(
    headers: list[str],
    rows: list[list[str]],
    aligns: list[str],
    caption: str = "",
    hide_sm: list[int] | None = None,
    compact: bool = False,
) -> str:
    hide_sm = hide_sm or []
    hidden = "tr-compact" if compact else ""

    def cell_cls(index: int) -> str:
        return aligns[index] + (" tr-hide-sm" if index in hide_sm else "")

    head = "".join(
        f'<th class="{cell_cls(i)}">{header}</th>' for i, header in enumerate(headers)
    )
    body = "".join(
        "<tr>" + "".join(
            f'<td class="{cell_cls(i)}">{cell}</td>' for i, cell in enumerate(row)
        ) + "</tr>"
        for row in rows
    )
    cap = f"<caption>{caption}</caption>" if caption else ""
    return (
        f'<div class="tr-table-wrap"><table class="{hidden.strip()}">{cap}<thead><tr>{head}</tr></thead>'
        f"<tbody>{body}</tbody></table></div>"
    )


def render(data: dict[str, Any]) -> str:
    s = data["session"]
    oi = data["oi"]
    fut = data["futures"]
    pain = data["pain"]
    q = data["quality"]
    pal = data["palette"]
    verdicts = data["verdicts"]
    corr_ce, corr_pe, corr_pcr = (
        oi["corr_return_dce"], oi["corr_return_dpe"], oi["corr_return_dpcr"]
    )
    change_cls = "tr-neg" if s["change"] < 0 else "tr-pos"

    kpis = [
        ("Close", fmt(s["close"]), f'{signed(s["change"])} · {signed(s["change_pct"])}%', change_cls),
        ("Open", fmt(s["open"]), f'prior {fmt(s["prior_close"])}', ""),
        ("High", fmt(s["high"]), s["high_time"], ""),
        ("Low", fmt(s["low"]), s["low_time"], ""),
        ("Range", fmt(s["range"]), f'{s["range_pct_of_prior"]:.2f}% of prior', ""),
        ("Futures", fmt(fut["last"]), f'basis {signed(fut["basis_last"])}', ""),
        ("PCR (OI)", f'{oi["pcr_close"]:.2f}', f'from {oi["pcr_open"]:.2f}', "tr-neg"),
        ("CE OI", millions(oi["ce_close"]), f'{signed(oi["ce_delta"] / 1e6, 1)}M', "tr-neg"),
        ("PE OI", millions(oi["pe_close"]), f'{signed(oi["pe_delta"] / 1e6, 1)}M', "tr-pos"),
        ("Max pain", fmt(pain["end"], 0), f'close {signed(pain["distance_close"], 0)} away', ""),
    ]
    kpi_html = "".join(
        f'<div class="tr-kpi"><span class="l">{label}</span>'
        f'<span class="v {cls}">{value}</span><span class="s">{sub}</span></div>'
        for label, value, sub, cls in kpis
    )

    # --- simple read -------------------------------------------------------
    above_open = 100 - s["below_open_share"] * 100
    lead = (
        f'<p><b>NIFTY sold off all day, then bounced, and still closed lower.</b> '
        f'The tape opened at {fmt(s["open"])}, printed its high at {fmt(s["high"])} '
        f'in the first two minutes, and then stayed under the opening price for '
        f'{s["below_open_share"] * 100:.1f}% of the session.</p>'
        f'<p>The tape low was {fmt(s["low"])} at {s["low_time"]} — within '
        f'{abs(s["low"] - 25151.30):.2f} points of the classic S2 pivot — and the afternoon '
        f'bounce carried it back to {fmt(s["close"])}. That is {signed(s["change"])} points '
        f'({signed(s["change_pct"])}%) from the prior close of {fmt(s["prior_close"])}.</p>'
    )
    bullets = [
        ("What happened",
         f'<b>One-way morning, grind into midday, late bounce.</b> The opening fade took '
         f'{abs(data["segments"][1]["change"]):.0f} points in 30 minutes; the midday slide '
         f'took another {abs(data["segments"][3]["change"]):.0f}; the 13:39 low was followed by '
         f'a {data["segments"][5]["change"]:+.0f}-point recovery into 14:19.'),
        ("Who seemed to be selling",
         f'<b>Call sellers were the visible supply.</b> The number of open call contracts rose '
         f'{millions(oi["ce_delta"])} ({millions(oi["ce_open"])} → {millions(oi["ce_close"])}), '
         f'while open put contracts rose only {millions(oi["pe_delta"])}. The put-to-call ratio '
         f'fell from {oi["pcr_open"]:.2f} to {oi["pcr_close"]:.2f}. Most of the new calls sat at '
         f'25,250–25,500, above the market.'),
        ("Who seemed to be buying",
         f'<b>Put buyers added protection, mostly lower.</b> Open put contracts built at '
         f'24,000–25,200, including deep-tail positions at 24,000–24,600 and near-money puts at '
         f'25,200. That is hedging and positioning, not evidence that those buyers were right.'),
        ("The futures tell",
         f'<b>No persistent futures discount.</b> Futures closed at {fmt(fut["last"])}, '
         f'{signed(fut["basis_last"])} points above spot. The gap between futures and spot ranged '
         f'from {signed(fut["basis_min"])} to {signed(fut["basis_max"])} and ended near the middle '
         f'of that range, so futures did not lead cash into a deeper sell-off.'),
        ("What it means",
         f'<b>A supply-heavy, range-down session where option sellers were paid.</b> '
         f'The day\'s back-and-forth travel ({s["rv_pct"]:.2f}%) came in below the market\'s '
         f'implied move (ratio {verdicts["rv_iv"]:.2f}); the at-the-money call-plus-put pair '
         f'lost {abs(verdicts["straddle_pct"]):.1f}% of its value. Price closed between the '
         f'biggest put strike (25,000) and biggest call strike (25,500), near the max-pain level '
         f'(25,050), where the most option value would expire worthless.'),
        ("What it does not mean",
         f'<b>It is not proof of manipulation, and not a forecast.</b> Open interest shows '
         f'contracts added, not who initiated them. The 7.24M print is a deep out-of-the-money '
         f'tail put; the 6.07M print is an in-the-money put at the low. Both are positioning '
         f'footprints, not signals.'),
        ("What to watch next",
         f'<b>Whether the 25,000 put strike and the 25,500 call strike keep holding.</b> A close '
         f'outside that band, or the put-to-call ratio breaking below 0.76 / above 1.08, would '
         f'say the positioning map changed. Until then the tape describes a balance, not a trend.'),
    ]
    bullets_html = "".join(
        f'<li><span class="tag">{tag}</span>{text}</li>' for tag, text in bullets
    )

    # --- quant tables ------------------------------------------------------
    seg_rows = [
        [
            f'<b>{row["label"]}</b>',
            f'{row["start"]}–{row["end"]}',
            f'{fmt(row["from"])} → {fmt(row["to"])}',
            f'<span class="{"tr-neg" if row["change"] < 0 else "tr-pos"}">{signed(row["change"])}</span>',
            f'{signed(row["change_pct"])}%',
            millions(row["ce_vol"]),
            millions(row["pe_vol"]),
        ]
        for row in data["segments"]
    ]
    seg_table = table(
        ["Leg", "Window", "Spot path", "Change", "%", "CE volume", "PE volume"],
        seg_rows, ["", "", "n", "n", "n", "n", "n"],
        "Session legs · all times IST · volume is cumulative-volume change inside the leg",
        hide_sm=[4, 5, 6], compact=True,
    )

    oi_rows = [
        ["Call OI", millions(oi["ce_open"]), millions(oi["ce_close"]),
         f'<span class="tr-neg">{signed(oi["ce_delta"] / 1e6, 1)}M</span>',
         f'<span class="tr-neg">{signed(oi["ce_pct"])}%</span>'],
        ["Put OI", millions(oi["pe_open"]), millions(oi["pe_close"]),
         f'<span class="tr-pos">{signed(oi["pe_delta"] / 1e6, 1)}M</span>',
         f'<span class="tr-pos">{signed(oi["pe_pct"])}%</span>'],
        ["PCR (OI)", f'{oi["pcr_open"]:.2f}', f'{oi["pcr_close"]:.2f}',
         f'<span class="tr-neg">{signed(oi["pcr_close"] - oi["pcr_open"])}</span>',
         f'range {oi["pcr_min"]:.2f}–{oi["pcr_max"]:.2f}'],
        ["Call volume", "—", millions(oi["ce_vol"]), "—", "day total"],
        ["Put volume", "—", millions(oi["pe_vol"]), "—", "day total"],
    ]
    oi_table = table(
        ["Metric", "09:16 baseline", "15:39 close", "Change", "Detail"],
        oi_rows, ["", "n", "n", "n", "n"],
        "Open interest · baseline is the first full chain (09:16), not the partial 09:15 backfill · PCR range 0.76–1.08",
        hide_sm=[4], compact=True,
    )

    strike_rows = []
    for row in sorted(data["oi"]["top_strikes"], key=lambda r: -r["ce_oi"] - r["pe_oi"]):
        strike_rows.append([
            f'{int(row["strike"]):,}',
            millions(row["ce_oi"]),
            millions(row["pe_oi"]),
            f'{signed(row["ce_change"] / 1e6, 2)}M' if row["ce_change"] is not None else "—",
            f'{signed(row["pe_change"] / 1e6, 2)}M' if row["pe_change"] is not None else "—",
        ])

    strike_table = table(
        ["Strike", "CE OI", "PE OI", "CE Δ", "PE Δ"],
        strike_rows, ["n", "n", "n", "n", "n"],
        "Largest strikes by total open interest at the close",
        compact=True,
    )

    itm_rows = [
        [
            row["time"],
            f'{int(row["strike"]):,}',
            fmt(row["spot"]),
            f'{row["depth"]:+,.0f}',
            f'<span class="{"tr-pos" if row["moneyness"] == "ITM" else "tr-amber"}">{row["moneyness"]}</span>',
            f'{row["pe_oi"] / 1e6:.3f}M',
            row["note"],
        ]
        for row in data["itm_pe"]
    ]
    itm_table = table(
        ["Time", "Strike", "Spot", "Strike − spot", "Moneyness", "PE OI", "Read"],
        itm_rows, ["n", "n", "n", "n", "c", "n", ""],
        "Large put OI clusters · single-strike values from the 10-second chain",
        hide_sm=[2], compact=True,
    )

    worst_rows = [
        [
            f'{row["from_t"]} → {row["to_t"]}',
            f'<span class="tr-neg">{signed(row["change"])}</span>',
            f'{signed(row["change_pct"])}%',
            millions(row["ce_vol"] + row["pe_vol"]),
        ]
        for row in data["moves"]["worst_5"]
    ]
    best_rows = [
        [
            f'{row["from_t"]} → {row["to_t"]}',
            f'<span class="tr-pos">{signed(row["change"])}</span>',
            f'{signed(row["change_pct"])}%',
            millions(row["ce_vol"] + row["pe_vol"]),
        ]
        for row in data["moves"]["best_5"]
    ]
    move_table = table(
        ["5-minute window", "Move", "%", "CE+PE volume"],
        worst_rows + best_rows, ["", "n", "n", "n"],
        "Largest 5-minute moves · 5 consecutive tape minutes; clock-aligned bars in the research lane differ slightly",
        compact=True,
    )

    stat_rows = [
        ["1-minute mean return", f'{signed(s["mean_1m_bps"], 2)} bps',
         f'95% CI {signed(s["mean_1m_ci_bps"][0], 2)} to {signed(s["mean_1m_ci_bps"][1], 2)} bps',
         "indistinguishable from zero"],
        ["1-minute volatility", f'{s["sd_1m_bps"]:.2f} bps', f'{s["n_returns"]} observations',
         f'down minutes {s["down_minutes_share"] * 100:.1f}%'],
        ["Below the open", f'{s["below_open_share"] * 100:.1f}%',
         f'Wilson 95% CI {s["below_open_ci"][0] * 100:.1f}–{s["below_open_ci"][1] * 100:.1f}%',
         f'{len(data["charts"]["spot"]["t"])} prints'],
        ["Realised travel", f'{s["rv_pts"]:.1f} pts', f'{s["rv_pct"]:.3f}% of spot',
         "close-to-close moves, not high-low"],
        ["1-min autocorrelation", f'{s["lag1_autocorr"]:+.3f}', "lag-1 Pearson",
         "no usable short-horizon memory"],
        ["Return vs ΔCE OI", f'{corr_ce["r"]:+.3f}',
         f'95% CI {corr_ce["lo"]:+.3f} to {corr_ce["hi"]:+.3f}', f'n={corr_ce["n"]}'],
        ["Return vs ΔPE OI", f'{corr_pe["r"]:+.3f}',
         f'95% CI {corr_pe["lo"]:+.3f} to {corr_pe["hi"]:+.3f}', f'n={corr_pe["n"]}'],
        ["Return vs ΔPCR", f'{corr_pcr["r"]:+.3f}',
         f'95% CI {corr_pcr["lo"]:+.3f} to {corr_pcr["hi"]:+.3f}', f'n={corr_pcr["n"]}'],
    ]
    stat_table = table(
        ["Statistic", "Value", "Uncertainty", "Read"],
        stat_rows, ["", "n", "n", ""],
        "Quant read · associations are contemporaneous, not causal",
    )

    ext = data.get("external")
    if ext:
        es, ef, eo, efl = ext["session"], ext["futures"], ext["options"], ext["flow"]
        xcells = [
            ("Open", f'{fmt(es["open"])}', f'tape {fmt(s["open"])}'),
            ("High", f'{fmt(es["high"])}', f'tape {fmt(s["high"])}'),
            ("Low", f'{fmt(es["low"])} @ {es["low_time"]}', f'tape {fmt(s["low"])} @ {s["low_time"]}'),
            ("Last live", f'{fmt(es["last_live_close"])} @ {es["last_live_time"]}', f'CAS print {fmt(es["cas_print"])}'),
            ("CE / PE OI @ 15:14", f'{millions(eo["ce_close"])} / {millions(eo["pe_close"])}',
             f'15:39 tape {millions(oi["ce_close"])} / {millions(oi["pe_close"])}'),
            ("Basis", f'avg {signed(ef["basis_mean"])} · {ef["basis_positive_share"]:.0f}% positive',
             f'last {signed(ef["basis_last"])} @ {ef["basis_last_time"]}; 15:39 {signed(fut["basis_last"])}'),
        ]
        crosscheck_html = f"""<div class="tr-crosscheck">
  <h4>Cross-check · the research lane's snapshot bars</h4>
  <div class="sub">quant_tape.json (generated {ext["generated_at"]}) reads the same recorder with snapshot 1-minute bars and a 15:14 cutoff.
  The tape below uses LTP prints through 15:39. Both are correct for their clock; the brief's key numbers are the tape-LTP column.</div>
  <div class="tr-xgrid">{"".join(
      f'<div class="tr-xcell"><div class="k">{k}</div><div class="a">{a}</div><div class="b">{b}</div></div>'
      for k, a, b in xcells
  )}</div>
  <ul class="tr-xlist">
    <li><b>The ITM put flow burst was an opening event, not a late hedge.</b> The largest non-overlapping 5-minute build was
    {efl["top_episode_from"]}–{efl["top_episode_to"]} ({efl["top_bucket_lots"]:,} lots); 5-minute buckets were net negative on average.
    The 13:08 6.07M figure in the ITM table above is a single-strike level, not a 5-minute flow bucket.</li>
    <li><b>No follow-through.</b> Across 18 prior sessions, ITM put bursts (106 buckets) had a +0.021% forward 15-minute mean
    versus +0.009% unconditional — CI -0.005 to +0.063%, permutation p=0.210. That agrees with the near-zero OI/return
    correlations in the table above: positioning is not a timing signal.</li>
    <li><b>One sharp leg, not an unusual day.</b> The research lane's clock-aligned 5-minute maximum (71.65 pts) is top-1% against pooled windows, but only
    the 63rd percentile against the prior 19 session maxima. Overlapping windows inflate the pooled percentile.</li>
    <li><b>No wall test.</b> Max pain was 25,100 into the close (spot 25,221) and the 25,500 call wall stayed {25500 - es["last_live_close"]:.0f} points overhead;
    the tape was flow-driven, not pin-driven. At 15:39 max pain had drifted to {fmt(pain["end"], 0)}.</li>
  </ul>
</div>""" if True else ""
    else:
        crosscheck_html = """<div class="tr-crosscheck"><h4>Cross-check · research lane</h4>
        <p class="sub">quant_tape.json was not present at build time; the numbers above are computed from the recorder directly.</p></div>"""

    # --- data quality ------------------------------------------------------
    frozen_txt = ", then ".join(
        f'{fmt(level["price"])} ({level["first"]}–{level["last"]})'
        for level in q["frozen_levels"]
    )
    quality_rows = [
        ["Tape minutes", f'{q["tape_rows"]}/{q["tape_rows"] + len(q["tape_missing_minutes"])}',
         f'<span class="tr-chip tr-chip-ok">complete</span>',
         f'{q["tape_first"]}–{q["tape_last"]}; every minute covered, max gap {q["tape_max_gap_s"]:.0f}s'],
        ["Tape ordering", f'{q["tape_out_of_order_rows"]} row out of order',
         f'<span class="tr-chip tr-chip-warn">sorted at read</span>',
         "09:15:54 backfill was appended inside the 14:52 block"],
        ["09:15 backfill", f'{millions(q["backfill_row"]["ce_oi"])} CE / {millions(q["backfill_row"]["pe_oi"])} PE',
         f'<span class="tr-chip tr-chip-warn">partial chain</span>',
         f'09:16 full chain is {millions(q["backfill_row"]["next_ce_oi"])} / {millions(q["backfill_row"]["next_pe_oi"])}; used for open price only'],
        ["Futures minutes", f'{q["futures_rows"]}', f'<span class="tr-chip tr-chip-ok">complete</span>',
         f'60s cadence; max gap {q["futures_max_gap_s"]:.0f}s'],
        ["Tape vs snapshot", "two clocks", f'<span class="tr-chip tr-chip-warn">source gap</span>',
         "tape open 25,362.75 vs snapshot bar 25,323.15; high 25,382.95 vs 25,390.80; low 25,148.65 vs 25,141.80; median gap 5.5 pts"],
        ["OI endpoint clock", f'{millions(oi["ce_close"])} / {millions(oi["pe_close"])}', f'<span class="tr-chip tr-chip-warn">15:39 vs 15:14</span>',
         f'research lane at 15:14: {millions(ext["options"]["ce_close"]) if ext else "—"} CE / {millions(ext["options"]["pe_close"]) if ext else "—"} PE; the last 25 minutes unwound ~9.5M calls and ~7.6M puts'],
        ["Snapshot minutes", f'{q["snapshot_rows"]}', f'<span class="tr-chip tr-chip-warn">5 missing</span>',
         f'missing {", ".join(q["snapshot_missing_minutes"])}; max gap {q["snapshot_max_gap_s"]:.0f}s'],
        ["10s chain", f'{q["chain_rows"]:,} snapshots', f'<span class="tr-chip tr-chip-ok">dense</span>',
         f'median {q["chain_median_gap_s"]:.1f}s, max {q["chain_max_gap_s"]:.0f}s'],
        ["Chain depth", f'{q["chain_strikes_per_row"][0]} strikes', f'<span class="tr-chip tr-chip-warn">near-money only</span>',
         f'{q["chain_strikes_per_row"][0]} strikes per row (three rows carry {q["chain_strikes_per_row"][-1]}); not the 158-strike full book'],
        ["Close / CAS", f'{q["frozen_run_prints"]} prints flat', f'<span class="tr-chip tr-chip-warn">frozen spot</span>',
         f'flat {q["frozen_start"]}–15:39: {frozen_txt}; OI/volume still printed'],
        ["Causal claims", "none", f'<span class="tr-chip tr-chip-neutral">by design</span>',
         "OI, PCR and walls are positioning descriptions, not forecasts"],
    ]
    quality_table = table(
        ["Check", "Result", "Status", "Note"],
        quality_rows, ["", "n", "c", ""],
        "What the data can and cannot support",
    )
    quality_cards = "".join(
        f'<div class="tr-qcard"><div class="top"><h4>{row[0]}</h4>{row[2]}</div>'
        f'<div class="res">{row[1]}</div><div class="nt">{row[3]}</div></div>'
        for row in quality_rows
    )

    # --- chart panels ------------------------------------------------------
    panels = f"""
<figure class="tr-panel tr-span2">
  <figcaption>Spot and futures · the whole session
    <span>prior {fmt(s["prior_close"])} · S1 {fmt(s["pivots"]["s1"])} · S2 {fmt(s["pivots"]["s2"])}</span>
  </figcaption>
  <div id="tr-chart-spot" class="tr-chart" role="img"
       aria-label="NIFTY spot and futures lines through the session with prior close, S1 and S2 levels"></div>
  <p class="tr-note">Cash stayed below the open after 09:17 and tested S2 at the low. The futures line is aligned to the
  same minute buckets. Dotted lines are the prior close, S1 and S2; they are reference levels, not predictions.</p>
</figure>

<figure class="tr-panel">
  <figcaption>Futures basis · spot-to-futures spread
    <span>{signed(fut["basis_min"])} to {signed(fut["basis_max"])} pts · close {signed(fut["basis_last"])}</span>
  </figcaption>
  <div id="tr-chart-basis" class="tr-chart tr-chart-sm" role="img"
       aria-label="NIFTY futures basis in points through the session"></div>
  <p class="tr-note">Positive = futures above spot. The basis crossed zero repeatedly; the close was a small premium,
  not a widening discount.</p>
</figure>

<figure class="tr-panel">
  <figcaption>Open interest and PCR
    <span>CE {millions(oi["ce_open"])} → {millions(oi["ce_close"])} · PE {millions(oi["pe_open"])} → {millions(oi["pe_close"])}</span>
  </figcaption>
  <div id="tr-chart-oi" class="tr-chart tr-chart-sm" role="img"
       aria-label="Call and put open interest in millions with put-call ratio on a second axis"></div>
  <p class="tr-note">Call OI added {millions(oi["ce_delta"])} while put OI added {millions(oi["pe_delta"])}; PCR fell
  from {oi["pcr_open"]:.2f} to {oi["pcr_close"]:.2f}. The 09:16 jump is the first full chain, not a one-minute build.</p>
</figure>

<figure class="tr-panel">
  <figcaption>Volume by half-hour · where the activity was
    <span>CE {millions(oi["ce_vol"])} · PE {millions(oi["pe_vol"])} day total</span>
  </figcaption>
  <div id="tr-chart-volume" class="tr-chart tr-chart-sm" role="img"
       aria-label="Grouped bars of call and put volume by half-hour bucket"></div>
  <p class="tr-note">Volume is the change in cumulative day volume inside each bucket. The 09:17 open and the
  13:07–13:08 low test carry the loudest prints.</p>
</figure>

<figure class="tr-panel">
  <figcaption>Max pain and walls · the positioning map
    <span>call wall {fmt(pain["call_wall_mode"], 0)} ({pain["call_wall_mode"] and "mode"}) · put wall {fmt(pain["put_wall_mode"], 0)}</span>
  </figcaption>
  <div id="tr-chart-walls" class="tr-chart tr-chart-sm" role="img"
       aria-label="Max pain, call wall and put wall step lines with spot"></div>
  <p class="tr-note">Max pain changed {pain["transitions"]} times and ended at {fmt(pain["end"], 0)}, below the close.
  Walls are the largest near-money OI strikes, re-computed each minute.</p>
</figure>

<figure class="tr-panel">
  <figcaption>3D PE open interest · time × strike × contracts
    <span>10-minute samples · 24 strikes · values in millions</span>
  </figcaption>
  <div id="tr-chart-3d" class="tr-chart tr-chart-lg" role="img"
       aria-label="Three dimensional surface of put open interest by time and strike"></div>
  <p class="tr-note">The ridge at 25,000–25,300 is the put wall; the deep shelf at 24,500 is the hedge cluster.
  Drag to rotate. The 10s chain covers only the near-money window, so the surface is not the full book.</p>
</figure>

<article class="tr-panel tr-explain">
  <figcaption>What the surface says <span>read the ridges, not the noise</span></figcaption>
  <ul>
    <li><b>25,000–25,300 put ridge.</b> It thickens through the midday slide, then holds into the close. That is the
    put wall doing its job as the downside reference.</li>
    <li><b>24,500 shelf.</b> A deep, persistent put book from the morning onward — a tail hedge or a carry position,
    not a same-minute trade signal. It sits ~700 points below spot.</li>
    <li><b>26,000 call ridge.</b> Call OI builds above the market all session; that is the overhead supply visible in
    the OI-change chart.</li>
    <li><b>Edges are truncated.</b> The 10-second chain records ~30 strikes, so the surface stops near ±750 points
    from spot. Do not read the outer edge as zero.</li>
  </ul>
  <p class="tr-explain-read"><b>Practical read:</b> the put ridge at 25,000–25,300 is the downside reference;
  the call ridge at 25,500–26,000 is the overhead supply. Price closed between them.</p>
  <div class="tr-explain-stats">
    <div><span>Surface peak</span><b>{max(max(row) for row in data["charts"]["surface"]["z"]):.1f}M</b></div>
    <div><span>Put wall</span><b>{fmt(pain["put_wall_mode"], 0)}</b></div>
    <div><span>Call wall</span><b>{fmt(pain["call_wall_mode"], 0)}</b></div>
  </div>
  <p class="tr-explain-foot">A thick ridge is contracts <i>outstanding</i>, not fresh buying. The OI-change chart is
  the flow proxy; the surface is the stock of positioning.</p>
</article>

<figure class="tr-panel">
  <figcaption>Largest strikes at the close
    <span>total OI · millions</span>
  </figcaption>
  <div id="tr-chart-strikes" class="tr-chart tr-chart-sm" role="img"
       aria-label="Horizontal grouped bars of call and put open interest for the largest strikes"></div>
  <p class="tr-note">The 25,500 call and 25,000 put dominate the near-money book; deep strikes hold older positions
  that are not necessarily today's flow.</p>
</figure>

<figure class="tr-panel">
  <figcaption>Open-interest change by strike
    <span>09:16 → 15:39 · millions</span>
  </figcaption>
  <div id="tr-chart-changes" class="tr-chart tr-chart-sm" role="img"
       aria-label="Horizontal bars of call and put open interest change by strike"></div>
  <p class="tr-note">Calls were added at 25,250–25,500 (overhead supply); puts were added lower, with deep hedges at
  24,000–24,600 and near-money builds at 25,200.</p>
</figure>

<figure class="tr-panel tr-span2">
  <figcaption>Event timeline · the session in legs
    <span>bar length = duration · label = net point change</span>
  </figcaption>
  <div id="tr-chart-timeline" class="tr-chart" role="img"
       aria-label="Horizontal event timeline of session legs with point changes"></div>
  <p class="tr-note">The two down legs (opening fade, midday slide) did the damage; the afternoon bounce recovered
  about half of the midday leg. The CAS freeze is a flat-price window, not a flat market.</p>
</figure>
"""

    # --- page --------------------------------------------------------------
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NIFTY tape review · {data["date"]}</title>
<style>{CSS.replace("__BG__", pal["bg"]).replace("__PANEL__", pal["panel"]).replace("__RAISED__", pal["raised"]).replace("__BORDER__", pal["border"]).replace("__TEXT__", pal["text"]).replace("__MUTED__", pal["muted"]).replace("__AMBER__", pal["amber"]).replace("__GREEN__", pal["green"]).replace("__RED__", pal["red"]).replace("__BLUE__", pal["blue"]).replace("__YELLOW__", pal["yellow"])}</style>
</head>
<body>
<div class="tr-shell">

<header>
  <div class="tr-kicker">Alphashri · NIFTY tape review · {data["date"]}</div>
  <h1>Sellers owned the session. Calls carried the supply.</h1>
  <p class="tr-dek">A supply-heavy, range-down day: NIFTY opened near 25,363, slid to 25,149 at the S2 pivot,
  bounced, and still closed {signed(s["change_pct"])}% lower. Call open interest grew almost three times as much as
  put open interest, and the put-call ratio fell from {oi["pcr_open"]:.2f} to {oi["pcr_close"]:.2f}.</p>
  <div class="tr-meta">
    <span><span class="tr-dot"></span> Session closed</span>
    <span>Data to <b>{q["tape_last"]} IST</b></span>
    <span>385 tape minutes</span>
    <span>380 snapshots</span>
    <span>{q["chain_rows"]:,} chain prints</span>
    <span>Futures expiry <b>{fut["expiry"]}</b></span>
  </div>
  <div class="tr-kpis">{kpi_html}</div>
</header>

<section class="tr-section">
  <h2>01 · The simple read</h2>
  <p class="tr-note" style="margin:2px 0 12px">Plain English first — terms are explained as they appear. The tables and charts below carry the exact numbers.</p>
  <div class="tr-read">
    <article class="tr-lead"><div class="tr-lead-body">{lead}</div>
      <p style="color:var(--tr-muted);font-size:12px;margin-top:12px">Plain-English summary · tape-LTP basis; the snapshot 1-minute bars differ at the open (see §03).</p>
    </article>
    <ul class="tr-bullets">{bullets_html}</ul>
  </div>
</section>

<section class="tr-section">
  <h2>02 · Quant detail</h2>
  <p class="tr-note" style="margin:2px 0 12px">All times IST. OI = contracts outstanding. PCR = put OI ÷ call OI.
  Positive basis = futures above spot. Confidence intervals are 95%.</p>
  <div class="tr-grid">{panels}</div>

  <h3>Session path</h3>
  {seg_table}

  <h3>Open interest</h3>
  {oi_table}

  <h3>Largest strikes</h3>
  {strike_table}

  <h3>ITM put clusters</h3>
  {itm_table}
  <p class="tr-note">The 7.24M print is the 24,500 put cluster: 7.09M at 09:42, peaking at 7.249M at 09:46.
  That strike is ~727 points <b>below</b> spot, so it is a deep out-of-the-money tail hedge, not an ITM position.
  The 13:08 print is the 25,300 put at 6.07M — 147 points <b>above</b> spot, so that one is genuinely ITM.
  10:18 carries the session's largest single-strike ITM put book (9.68M). These are OI levels, not one-minute
  flow: the chain has no trade-level aggressor flag.</p>

  <h3>Largest five-minute moves</h3>
  {move_table}

  <h3>Quant read and caveats</h3>
  {stat_table}
  {crosscheck_html}
  <p class="tr-note">The minute-level OI/return correlations are essentially zero and their intervals cross zero.
  That is the honest result: OI is a map of where contracts sit, not a timing signal. The day-level sample is n=1;
  treat every "tomorrow" implication as a hypothesis. The 30-strike chain truncates sums of ITM OI at the window
  edge, so single-strike values are shown instead of a total.</p>
</section>

<section class="tr-section">
  <h2>03 · Data quality</h2>
  <div class="tr-cards">
    <div class="tr-card"><h4>Tape</h4><p><b>{q["tape_rows"]} minute prints</b> from {q["tape_first"]} to
    {q["tape_last"]}, no missing minutes. One 09:15:54 backfill row was out of order and is sorted at read time.</p></div>
    <div class="tr-card"><h4>Snapshots</h4><p><b>{q["snapshot_rows"]} reports</b>, 5 minutes missing
    ({", ".join(q["snapshot_missing_minutes"])}). Median cadence {q["snapshot_median_gap_s"]:.0f}s, worst gap
    {q["snapshot_max_gap_s"]:.0f}s.</p></div>
    <div class="tr-card"><h4>Chain</h4><p><b>{q["chain_rows"]:,} ten-second prints</b>, median
    {q["chain_median_gap_s"]:.1f}s, worst {q["chain_max_gap_s"]:.0f}s. Each row carries
    {q["chain_strikes_per_row"][0]} near-money strikes, not the full book.</p></div>
    <div class="tr-card"><h4>Close window</h4><p><b>Spot went flat at {q["frozen_start"]}</b> — {q["frozen_run_prints"]} prints
    through 15:39. It held 25,220.45 to 15:27, then reprinted 25,227.95 from 15:28. Treat the window as
    auction/settlement, not continuous price discovery.</p></div>
  </div>
  <div class="tr-quality-grid" style="margin-top:12px">{quality_cards}</div>
  <p class="tr-note">No causal claims: the report describes co-movement between price, OI and volume. It does not
  identify the buyer or seller behind a print, and it does not forecast the next session.</p>
</section>

<footer class="tr-foot">
  <p><b>Sources.</b> {data["source_files"]["tape"]} · {data["source_files"]["futures"]} ·
  {data["source_files"]["snapshots"]} · {data["source_files"]["chain10s"]}. External
  <b>quant_tape.json</b> {"was present and is cross-checked in §02" if data["external_quant_present"] else "was not present at build time; this page computes its own summary"}.</p>
  <p><b>Method.</b> Tape sorted by timestamp. OI baseline is the first full chain at 09:16; the 09:15:54 row is
  price-only. Returns are 1-minute simple percentage changes; realised range is the root sum of squared point
  changes. ITM means strike above spot for puts. Max pain and walls are the recorder's own minute calculations.</p>
  <p>Generated {data["generated_at"]} · Alphashri research artifact · not investment advice.</p>
</footer>

</div>
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
<script id="tr-data" type="application/json">__DATA__</script>
<script>{JS}</script>
</body>
</html>
"""
    payload = json.dumps({
        "colors": pal,
        "spot": data["charts"]["spot"],
        "levels": {
            **data["session"]["pivots"],
            "prior": data["session"]["prior_close"],
            "open": data["session"]["open"],
        },
        "oi": data["charts"]["oi"],
        "volume": data["charts"]["volume"],
        "walls": data["charts"]["walls"],
        "surface": data["charts"]["surface"],
        "strikes": data["charts"]["strikes"],
        "changes": data["charts"]["changes"],
        "timeline": data["charts"]["timeline"],
    }, allow_nan=False, separators=(",", ":")).replace("</", "<\\/")
    return html.replace("__DATA__", payload)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=DATE_DEFAULT)
    parser.add_argument("--html", default=str(OUT_HTML))
    parser.add_argument("--json", default=str(OUT_JSON))
    args = parser.parse_args()

    data = build(args.date)
    json_path = Path(args.json)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(data, indent=2, allow_nan=False) + "\n")
    html = render(data)
    html_path = Path(args.html)
    html_path.parent.mkdir(parents=True, exist_ok=True)
    html_path.write_text(html)
    print(f"wrote {json_path} ({json_path.stat().st_size:,} bytes)")
    print(f"wrote {html_path} ({html_path.stat().st_size:,} bytes)")
    print(
        f"tape={data['quality']['tape_rows']} fut={data['quality']['futures_rows']} "
        f"snap={data['quality']['snapshot_rows']} chain={data['quality']['chain_rows']} "
        f"charts=9"
    )


if __name__ == "__main__":
    main()
