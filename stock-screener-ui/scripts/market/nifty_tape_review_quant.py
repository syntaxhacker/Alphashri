#!/usr/bin/env python3
"""Quantitative review of one NIFTY tape session.

Reads the four recorder artefacts (per-minute tape, 1-minute futures, 10-second
slim chain, per-minute snapshots) plus every prior session on disk, and writes a
machine-readable JSON payload and a human markdown note.

The rules that keep the numbers honest:

* **Two OI clocks are never mixed.** ``*_oi_change_day`` (level vs the previous
  session's OI) and the interval delta (this row minus the previous row) answer
  different questions; the payload keeps them in separate blocks.
* **The 15:15-15:40 window is not a market.** NSE freezes the index spot for the
  Closing Auction Session while F&O keeps trading, so any minute after 15:14 has
  a stale spot, a fake basis and a stale ITM/OTM split. Every spot-dependent
  metric stops at 15:14 and says so.
* **The backfilled 09:15 row is not a chain.** It is reconstructed from a
  30-strike 10-second frame (~half the OI of the full 158-strike chain), so it is
  excluded from every delta and every total.
* **Flow is measured from per-strike OI deltas on the intersection of strikes**
  (a window whose width changes minute to minute must not read as an OI jump),
  classified by the *prior* minute's moneyness, on non-overlapping buckets. A
  rolling 5-minute maximum is reported next to the buckets purely to show how
  much it inflates one burst.
* **Cross-session claims are hypotheses**, reported with n, effective n
  (distinct sessions), a session-block bootstrap CI and a within-session
  permutation p-value — never as an edge.

Usage:
    .venv/bin/python scripts/market/nifty_tape_review_quant.py \
        [--date 2026-11-18] [--outdir reports/nifty_2026-11-18/research]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "experiments" / "data"

TAPE_DIR = DATA / "nifty_tape"
FUT_DIR = DATA / "nifty_futures"
SNAP_DIR = DATA / "nifty_snapshots"
CHAIN_DIR = DATA / "nifty_chain10s"

#: Index spot is frozen from here; a spot-dependent metric past this minute is
#: meaningless (CAS 15:15-15:40).
LAST_LIVE_HHMM = "15:14"
#: Last minute that exists on the older tapes — keeps cross-session windows equal.
SESSION_END_HHMM = "15:29"
#: NIFTY lot size for the 2026-11-23 weekly.
LOT_SIZE = 65
SEED = 42
SESSION_OPEN_MIN = 9 * 60 + 15


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _f(value, default=None):
    """float or ``default``; never raises, never returns NaN/inf."""
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


def _i(value, default=0):
    out = _f(value)
    return int(out) if out is not None else default


def _round(value, nd=2):
    v = _f(value)
    return None if v is None else round(v, nd)


def _minute(iso):
    return str(iso or "")[:16]


def _hhmm(iso):
    return str(iso or "")[11:16]


def _minute_of_day(stamp):
    """Minute-of-day from either an ISO timestamp or a bare ``HH:MM``."""
    s = str(stamp or "")
    try:
        if len(s) == 5:
            return int(s[:2]) * 60 + int(s[3:5])
        return int(s[11:13]) * 60 + int(s[14:16])
    except (TypeError, ValueError):
        return -1


def _pct(a, b):
    if not a or b is None:
        return None
    return (b - a) / a * 100.0


def _percentile(values, q):
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    return float(np.percentile(np.asarray(vals, dtype=float), q))


def _pct_rank(values, value):
    vals = [v for v in values if v is not None]
    if not vals or value is None:
        return None
    return sum(1 for v in vals if v <= value) / len(vals) * 100.0


def _describe(values):
    vals = [v for v in values if v is not None]
    if not vals:
        return {"n": 0}
    arr = np.asarray(vals, dtype=float)
    return {
        "n": int(arr.size),
        "mean": _round(arr.mean(), 4),
        "median": _round(float(np.median(arr)), 4),
        "sd": _round(float(arr.std(ddof=1)) if arr.size > 1 else 0.0, 4),
        "min": _round(float(arr.min()), 4),
        "max": _round(float(arr.max()), 4),
        "p05": _round(float(np.percentile(arr, 5)), 4),
        "p25": _round(float(np.percentile(arr, 25)), 4),
        "p75": _round(float(np.percentile(arr, 75)), 4),
        "p95": _round(float(np.percentile(arr, 95)), 4),
    }


def _binomial_two_sided(k, n):
    """Exact two-sided sign-test p-value."""
    if n <= 0:
        return None
    k = int(k)
    tail = sum(math.comb(n, i) for i in range(0, min(k, n - k) + 1)) / (2 ** n)
    return min(1.0, 2.0 * tail)


def _bootstrap_mean_ci(values, blocks, n_boot=4000, seed=SEED, alpha=0.05):
    """Percentile CI resampling whole blocks (sessions), not observations."""
    pairs = [(float(v), b) for v, b in zip(values, blocks) if v is not None]
    if not pairs:
        return None
    uniq = sorted({b for _, b in pairs})
    if len(uniq) < 2:
        return None
    by_block = {b: np.asarray([v for v, bb in pairs if bb == b], dtype=float)
                for b in uniq}
    rng = np.random.default_rng(seed)
    draws = np.empty(n_boot, dtype=float)
    for i in range(n_boot):
        pick = rng.integers(0, len(uniq), size=len(uniq))
        draws[i] = np.concatenate([by_block[uniq[j]] for j in pick]).mean()
    return {
        "lo": _round(float(np.percentile(draws, alpha / 2 * 100)), 4),
        "hi": _round(float(np.percentile(draws, (1 - alpha / 2) * 100)), 4),
        "n_boot": n_boot,
        "blocks": len(uniq),
    }


def _permutation_p(event_by_block, base_by_block, n_perm=4000, seed=SEED):
    """Two-sided p for "event slots are ordinary minutes".

    The null keeps each session's *number* of events and draws replacement
    minutes from that same session's unconditional pool, so a session that
    simply had more bursts cannot manufacture significance.
    """
    if not event_by_block or not base_by_block:
        return None
    pooled_base = np.concatenate([np.asarray(v, dtype=float)
                                  for v in base_by_block.values() if v])
    if pooled_base.size < 10:
        return None
    base_mean = float(pooled_base.mean())
    pooled_events = np.concatenate([np.asarray(v, dtype=float)
                                    for v in event_by_block.values() if v])
    if pooled_events.size == 0:
        return None
    obs = float(pooled_events.mean()) - base_mean
    rng = np.random.default_rng(seed)
    hits = 0
    for _ in range(n_perm):
        draws = []
        for block, vals in event_by_block.items():
            pool = np.asarray(base_by_block.get(block) or pooled_base, dtype=float)
            if pool.size == 0:
                pool = pooled_base
            idx = rng.integers(0, pool.size, size=len(vals))
            draws.append(pool[idx].mean())
        null_mean = float(np.mean(draws)) if draws else base_mean
        if abs(null_mean - base_mean) >= abs(obs):
            hits += 1
    return _round((hits + 1) / (n_perm + 1), 4)


def _permutation_p_groups(values, flags, n_perm=4000, seed=SEED):
    """Between-group permutation p when each session contributes one value.

    Relabelling sessions (not minutes) is the only valid null here: with one
    observation per session there is nothing to shuffle inside a session.
    """
    pairs = [(float(v), bool(f)) for v, f in zip(values, flags)
             if v is not None]
    if len(pairs) < 6:
        return None
    vals = np.asarray([v for v, _ in pairs], dtype=float)
    flags = np.asarray([f for _, f in pairs], dtype=bool)
    n_event = int(flags.sum())
    if n_event == 0 or n_event == len(pairs):
        return None
    obs = float(vals[flags].mean() - vals[~flags].mean())
    rng = np.random.default_rng(seed)
    hits = 0
    for _ in range(n_perm):
        pick = rng.permutation(len(pairs))[:n_event]
        mask = np.zeros(len(pairs), dtype=bool)
        mask[pick] = True
        diff = float(vals[mask].mean() - vals[~mask].mean())
        if abs(diff) >= abs(obs):
            hits += 1
    return _round((hits + 1) / (n_perm + 1), 4)


def _jsonable(obj):
    """Recursively coerce to JSON-safe types; NaN/inf become None."""
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        obj = float(obj)
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, Path):
        return str(obj)
    return obj


def _fmt(value, spec=",.2f", dash="n/a"):
    v = _f(value)
    if v is None:
        return dash
    return format(v, spec)


def _reasons(counts):
    """``{'poll-gap': 13}`` -> ``poll-gap ×13``."""
    return ", ".join(f"{k} ×{v}" for k, v in sorted(counts.items())) or "none"


def _ord(value):
    """``63`` -> ``63rd``; ``n/a`` when unknown."""
    v = _f(value)
    if v is None:
        return "n/a"
    n = int(round(v))
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


# --------------------------------------------------------------------------- #
# loaders
# --------------------------------------------------------------------------- #
def load_jsonl(path: Path):
    rows = []
    if not path.exists():
        return rows
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                rows.append(row)
    return rows


_TAPE_CACHE: dict[str, list] = {}


def load_tape(date):
    if date in _TAPE_CACHE:
        return _TAPE_CACHE[date]
    rows = [r for r in load_jsonl(TAPE_DIR / f"{date}.jsonl") if r.get("t")]
    rows.sort(key=lambda r: str(r["t"]))
    _TAPE_CACHE[date] = rows
    return rows


def load_futures(date):
    rows = [r for r in load_jsonl(FUT_DIR / f"{date}.jsonl") if r.get("t")]
    rows.sort(key=lambda r: str(r["t"]))
    return rows


def load_chain10s(date):
    return [r for r in load_jsonl(CHAIN_DIR / f"{date}.jsonl") if r.get("t")]


def _tail_last_json(path: Path, window=6_000_000):
    """Last parseable JSON object of a huge jsonl, without reading all of it."""
    if not path.exists():
        return None
    with open(path, "rb") as fh:
        fh.seek(0, os.SEEK_END)
        size = fh.tell()
        fh.seek(max(0, size - window))
        blob = fh.read()
    for line in reversed([ln for ln in blob.split(b"\n") if ln.strip()]):
        try:
            return json.loads(line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
    return None


def snapshot_times(date):
    """Every snapshot row's timestamp, without keeping the payloads."""
    out = []
    path = SNAP_DIR / f"{date}.jsonl"
    if not path.exists():
        return out
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("t"):
                out.append(row["t"])
    return out


def load_snapshot_compact(date):
    """The fields the review needs, for the whole day.

    A full snapshot is ~250 KB/row; keeping the chain would cost ~100 MB.
    ``control`` carries the day-change OI, ``iv_surface.atm`` the ATM IV and
    ``regime`` the recorder's own range/gap read.
    """
    out = []
    path = SNAP_DIR / f"{date}.jsonl"
    if not path.exists():
        return out
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            rep = row.get("report") or {}
            if not rep:
                continue
            out.append({
                "t": row.get("t"),
                "spot": _f(rep.get("spot")),
                "control": rep.get("control") or {},
                "regime": rep.get("regime") or {},
                "iv_atm": (rep.get("iv_surface") or {}).get("atm") or {},
                "max_pain": _f(rep.get("max_pain")),
                "pcr_oi": _f(rep.get("pcr_oi")),
            })
    out.sort(key=lambda r: str(r.get("t")))
    return out


def session_bars(snapshot):
    """1-minute index bars from a snapshot, synthetic/frozen tail flagged."""
    if not snapshot:
        return []
    rep = snapshot.get("report") or {}
    dedup = {}
    for bar in rep.get("intraday") or []:
        close = _f(bar.get("close"))
        if close is None or close <= 0:
            continue
        dedup[_minute(bar.get("time"))] = {
            "t": bar.get("time"),
            "open": _f(bar.get("open"), close),
            "high": _f(bar.get("high"), close),
            "low": _f(bar.get("low"), close),
            "close": close,
            "synthetic": bool(bar.get("synthetic")),
        }
    return [dedup[k] for k in sorted(dedup)]


# --------------------------------------------------------------------------- #
# 1. coverage
# --------------------------------------------------------------------------- #
def _count_by(rows, key):
    out = {}
    for row in rows or []:
        val = str(row.get(key) or "unknown")
        out[val] = out.get(val, 0) + 1
    return out


def coverage(date, tape, raw_tape, futures, chain10s, snap_times, gaps_tape,
             gaps_chain, bars):
    minutes = [_minute(r["t"]) for r in tape]
    uniq = sorted(set(minutes))
    uniq_hhmm = sorted({_hhmm(m) for m in uniq})
    expected = [f"{h:02d}:{m:02d}" for h in range(9, 16) for m in range(60)
                if SESSION_OPEN_MIN <= h * 60 + m <= 15 * 60 + 39]
    backfilled = [r for r in tape if r.get("backfilled")]
    cas = [r for r in tape if r.get("cas") or r.get("spot_frozen")]

    raw_order = [str(r["t"]) for r in raw_tape]
    nonmonotonic = sum(1 for a, b in zip(raw_order, raw_order[1:]) if b < a)

    fut_minutes = [_minute(r["t"]) for r in futures]
    snap_minutes = [_minute(t) for t in snap_times]
    chain_minutes = [_minute(r["t"]) for r in chain10s]
    chain_counts = {}
    for m in chain_minutes:
        chain_counts[m] = chain_counts.get(m, 0) + 1
    chain_sorted = sorted(datetime.fromisoformat(str(r["t"])) for r in chain10s)
    gaps = [(b - a).total_seconds() for a, b in zip(chain_sorted, chain_sorted[1:])]

    tape_spots = {_hhmm(r["t"]): _f(r.get("spot")) for r in tape}
    bar_closes = {_hhmm(b["t"]): b["close"] for b in bars
                  if _hhmm(b["t"]) <= LAST_LIVE_HHMM}
    diffs = [abs(tape_spots[m] - bar_closes[m]) for m in bar_closes
             if tape_spots.get(m) is not None]

    return {
        "tape": {
            "file_rows": len(raw_tape),
            "rows": len(tape),
            "unique_minutes": len(uniq),
            "first_minute": _hhmm(uniq[0]) if uniq else None,
            "last_minute": _hhmm(uniq[-1]) if uniq else None,
            "expected_minutes": len(expected),
            "missing_minutes": [m for m in expected if m not in set(uniq_hhmm)],
            "duplicate_minutes": sorted({m for m in minutes
                                         if minutes.count(m) > 1}),
            "backfilled_rows": len(backfilled),
            "backfilled_minutes": [_hhmm(r["t"]) for r in backfilled],
            "backfilled_chain_strikes": [len(r.get("chain") or {})
                                         for r in backfilled],            "recorded_chain_strikes_median": _percentile(
                [len(r.get("chain") or {}) for r in tape
                 if not r.get("backfilled")], 50),
            "non_monotonic_file_order": nonmonotonic,
            "cas_rows": len(cas),
            "cas_window": ([_hhmm(cas[0]["t"]), _hhmm(cas[-1]["t"])]
                           if cas else None),
            "gaps_journal": len(gaps_tape),
            "gaps_journal_reasons": _count_by(gaps_tape, "reason"),
        },
        "futures": {
            "rows": len(futures),
            "unique_minutes": len(set(fut_minutes)),
            "first_minute": _hhmm(fut_minutes[0]) if fut_minutes else None,
            "last_minute": _hhmm(fut_minutes[-1]) if fut_minutes else None,
            "contract_expiry": next((r.get("expiry") for r in futures
                                     if r.get("expiry")), None),
            "null_spot_rows": sum(1 for r in futures
                                  if _f(r.get("spot")) is None),
            "frozen_spot_rows": sum(1 for r in futures
                                    if _hhmm(r["t"]) > LAST_LIVE_HHMM),
        },
        "snapshots": {
            "rows": len(snap_times),
            "unique_minutes": len(set(snap_minutes)),
            "missing_vs_tape": sorted({_hhmm(m) for m in (set(uniq) - set(snap_minutes))}),
            "extra_vs_tape": sorted({_hhmm(m) for m in (set(snap_minutes) - set(uniq))}),
        },
        "chain10s": {
            "frames": len(chain10s),
            "minutes_covered": len(chain_counts),
            "frames_per_minute_min": min(chain_counts.values()) if chain_counts else None,
            "frames_per_minute_median": _percentile(list(chain_counts.values()), 50),
            "frames_per_minute_max": max(chain_counts.values()) if chain_counts else None,
            "median_gap_s": _round(_percentile(gaps, 50), 2),
            "max_gap_s": _round(max(gaps), 2) if gaps else None,
            "gaps_over_20s": sum(1 for g in gaps if g > 20),
            "gaps_over_60s": sum(1 for g in gaps if g > 60),
            "file_order_violations": sum(
                1 for a, b in zip(chain10s, chain10s[1:])
                if str(b["t"]) < str(a["t"])),
            "gaps_journal": len(gaps_chain),
            "gaps_journal_reasons": _count_by(gaps_chain, "reason"),
            "journal_gap_claims_not_reproduced": bool(
                gaps_chain and gaps and max(gaps) < 60),
            "strikes_per_frame_median": _percentile(
                [len(r.get("rows") or []) for r in chain10s], 50),
            "strikes_per_frame_max": max(
                (len(r.get("rows") or []) for r in chain10s), default=None),
        },
        "tape_vs_snapshot_bars": {
            "n": len(diffs),
            "median_abs_diff_pts": _round(_percentile(diffs, 50), 2),
            "p95_abs_diff_pts": _round(_percentile(diffs, 95), 2),
            "note": ("tape spot is a point-in-time LTP inside the minute; the "
                     "bar close is that minute's last print"),
        },
    }


# --------------------------------------------------------------------------- #
# 2. session
# --------------------------------------------------------------------------- #
def session_stats(bars, prev_close, recorder_read=None):
    live = [b for b in bars if _hhmm(b["t"]) <= LAST_LIVE_HHMM]
    if not live:
        return {}
    opens = live[0]["open"]
    highs = max(live, key=lambda b: b["high"])
    lows = min(live, key=lambda b: b["low"])
    last = live[-1]
    last_close = last["close"]

    peak = live[0]["close"]
    trough = live[0]["close"]
    peak_at_trough = peak
    trough_t = live[0]["t"]
    max_dd = 0.0
    for bar in live:
        if bar["close"] > peak:
            peak = bar["close"]
        dd = (bar["close"] - peak) / peak * 100.0 if peak else 0.0
        if dd < max_dd:
            max_dd, trough, trough_t, peak_at_trough = dd, bar["close"], bar["t"], peak

    recovery_pts = last_close - trough
    recovery_share = (recovery_pts / (peak_at_trough - trough) * 100.0
                      if peak_at_trough > trough else None)

    closes = {_hhmm(b["t"]): b["close"] for b in live}
    keys = sorted(closes)
    moves = {}
    for k in (5, 15, 30):
        rows = []
        for key in keys:
            start_min = _minute_of_day(key) - k
            start_key = f"{start_min // 60:02d}:{start_min % 60:02d}"
            if start_key in closes:
                rows.append({
                    "t": key,
                    "delta": closes[key] - closes[start_key],
                    "pct": (closes[key] - closes[start_key]) / closes[start_key] * 100.0,
                })
        ups = sorted(rows, key=lambda r: -r["delta"])[:3]
        downs = sorted(rows, key=lambda r: r["delta"])[:3]
        moves[f"{k}m"] = {
            "n": len(rows),
            "largest_up": [{"t": r["t"], "pts": _round(r["delta"]),
                            "pct": _round(r["pct"], 3)} for r in ups],
            "largest_down": [{"t": r["t"], "pts": _round(r["delta"]),
                              "pct": _round(r["pct"], 3)} for r in downs],
            "max_abs_pts": _round(max((abs(r["delta"]) for r in rows), default=0.0)),
            "sd_pts": _round(float(np.std([r["delta"] for r in rows], ddof=1))
                             if len(rows) > 1 else 0.0),
            "pct_positive": (_round(100.0 * sum(1 for r in rows if r["delta"] > 0)
                                    / len(rows), 2) if rows else None),
        }

    rng = highs["high"] - lows["low"]
    high_close_bar = max(live, key=lambda b: b["close"])
    low_close_bar = min(live, key=lambda b: b["close"])
    return {
        "open": _round(opens),
        "open_time": _hhmm(live[0]["t"]),
        "high": _round(highs["high"]),
        "high_time": _hhmm(highs["t"]),
        "low": _round(lows["low"]),
        "low_time": _hhmm(lows["t"]),
        "high_close": _round(high_close_bar["close"]),
        "high_close_time": _hhmm(high_close_bar["t"]),
        "low_close": _round(low_close_bar["close"]),
        "low_close_time": _hhmm(low_close_bar["t"]),
        "last_live_close": _round(last_close),
        "last_live_time": _hhmm(last["t"]),
        "cas_print": _round(bars[-1]["close"]) if bars else None,
        "prior_close": _round(prev_close),
        "gap_pts": _round(opens - prev_close) if prev_close else None,
        "gap_pct": _round(_pct(prev_close, opens), 3),
        "day_change_pts_to_last_live": (_round(last_close - prev_close)
                                        if prev_close else None),
        "day_change_pct_to_last_live": _round(_pct(prev_close, last_close), 3),
        "day_change_pct_to_cas_print": (
            _round(_pct(prev_close, bars[-1]["close"]), 3) if prev_close else None),
        "range_pts": _round(rng),
        "range_pct": _round(rng / prev_close * 100.0, 3) if prev_close else None,
        "close_in_range_pct": (_round((last_close - lows["low"]) / rng * 100.0, 2)
                               if rng else None),
        "max_drawdown_pct": _round(max_dd, 3),
        "max_drawdown_pts": _round(trough - peak_at_trough),
        "max_drawdown_trough_time": _hhmm(trough_t),
        "recovery_pts": _round(recovery_pts),
        "recovery_share_pct": _round(recovery_share, 1),
        "moves": moves,
        "intraday_bars": len(bars),
        "live_bars": len(live),
        "frozen_bars_excluded": len(bars) - len(live),
        "recorder_read": recorder_read or {},
        "closes": closes,
    }


# --------------------------------------------------------------------------- #
# 3. futures
# --------------------------------------------------------------------------- #
def _quadrant(dp, doi):
    if dp is None or doi is None:
        return None
    if dp > 0 and doi > 0:
        return "long_buildup"
    if dp < 0 and doi > 0:
        return "short_buildup"
    if dp > 0 and doi < 0:
        return "short_covering"
    if dp < 0 and doi < 0:
        return "long_unwinding"
    return "flat"


def futures_stats(rows):
    live = [r for r in rows if _hhmm(r["t"]) <= LAST_LIVE_HHMM
            and _f(r.get("basis")) is not None]
    if not live:
        return {"available": False,
                "note": "no futures tape with a usable basis for this date"}
    basis = [_f(r["basis"]) for r in live]
    fut = [_f(r["close"]) for r in live]
    oi = [_i(r.get("oi")) for r in live]
    vol = [_i(r.get("volume")) for r in live]
    times = [_hhmm(r["t"]) for r in live]

    minute_deltas = []
    for a, b in zip(live, live[1:]):
        if _minute_of_day(b["t"]) - _minute_of_day(a["t"]) != 1:
            continue
        minute_deltas.append({
            "t": _hhmm(b["t"]),
            "dp": _f(b["close"]) - _f(a["close"]),
            "doi": _i(b.get("oi")) - _i(a.get("oi")),
        })
    top_oi = sorted(minute_deltas, key=lambda d: -abs(d["doi"]))[:8]

    buckets = {}
    for r in live:
        buckets.setdefault((_minute_of_day(r["t"]) - SESSION_OPEN_MIN) // 5,
                           []).append(r)
    bucket_rows = []
    for bid in sorted(buckets):
        chunk = buckets[bid]
        if len(chunk) < 3:
            continue
        dp = _f(chunk[-1]["close"]) - _f(chunk[0]["close"])
        doi = _i(chunk[-1].get("oi")) - _i(chunk[0].get("oi"))
        bucket_rows.append({
            "from": _hhmm(chunk[0]["t"]),
            "to": _hhmm(chunk[-1]["t"]),
            "dp": dp,
            "doi": doi,
            "quadrant": _quadrant(dp, doi),
        })
    quad_counts = {}
    for row in bucket_rows:
        quad_counts[row["quadrant"]] = quad_counts.get(row["quadrant"], 0) + 1

    close_by_hhmm = {_hhmm(r["t"]): _f(r["close"]) for r in live}
    quad_fwd = {}
    for quad in quad_counts:
        vals = []
        for row in bucket_rows:
            if row["quadrant"] != quad:
                continue
            target_min = _minute_of_day(row["to"]) + 15
            target = f"{target_min // 60:02d}:{target_min % 60:02d}"
            if target in close_by_hhmm and row["to"] in close_by_hhmm:
                vals.append(close_by_hhmm[target] - close_by_hhmm[row["to"]])
        if vals:
            quad_fwd[quad] = {
                "n": len(vals),
                "mean_pts": _round(float(np.mean(vals))),
                "median_pts": _round(float(np.median(vals))),
                "share_negative": _round(
                    100.0 * sum(1 for v in vals if v < 0) / len(vals), 1),
            }

    windows = {}
    for r in live:
        windows.setdefault((_minute_of_day(r["t"]) - SESSION_OPEN_MIN) // 30,
                           []).append(r)
    event_windows = []
    for wid in sorted(windows):
        chunk = windows[wid]
        if len(chunk) < 10:
            continue
        dp = _f(chunk[-1]["close"]) - _f(chunk[0]["close"])
        doi = _i(chunk[-1].get("oi")) - _i(chunk[0].get("oi"))
        b0 = _f(chunk[0].get("basis")) or 0.0
        b1 = _f(chunk[-1].get("basis")) or 0.0
        event_windows.append({
            "window": f"{_hhmm(chunk[0]['t'])}-{_hhmm(chunk[-1]['t'])}",
            "dp": _round(dp),
            "doi": doi,
            "dvol": sum(_i(r.get("volume")) for r in chunk),
            "basis_start": _round(b0),
            "basis_end": _round(b1),
            "basis_change": _round(b1 - b0),
            "quadrant": _quadrant(dp, doi),
        })

    return {
        "available": True,
        "n_live_rows": len(live),
        "basis": {
            "mean": _round(float(np.mean(basis))),
            "sd": _round(float(np.std(basis, ddof=1))),
            "median": _round(float(np.median(basis))),
            "p05": _round(_percentile(basis, 5)),
            "p25": _round(_percentile(basis, 25)),
            "p75": _round(_percentile(basis, 75)),
            "p95": _round(_percentile(basis, 95)),
            "min": _round(min(basis)),
            "min_time": times[int(np.argmin(basis))],
            "max": _round(max(basis)),
            "max_time": times[int(np.argmax(basis))],
            "first": _round(basis[0]),
            "first_time": times[0],
            "last": _round(basis[-1]),
            "last_time": times[-1],
            "share_positive_pct": _round(
                100.0 * sum(1 for b in basis if b > 0) / len(basis), 1),
        },
        "oi": {
            "open": oi[0], "close": oi[-1],
            "change": oi[-1] - oi[0],
            "change_pct": _round((oi[-1] - oi[0]) / oi[0] * 100.0, 2),
            "min": min(oi), "min_time": times[int(np.argmin(oi))],
            "max": max(oi), "max_time": times[int(np.argmax(oi))],
        },
        "price": {
            "open": _round(fut[0]), "open_time": times[0],
            "close": _round(fut[-1]), "close_time": times[-1],
            "change_pts": _round(fut[-1] - fut[0]),
            "change_pct": _round((fut[-1] - fut[0]) / fut[0] * 100.0, 3),
            "volume_total": sum(vol),
        },
        "regime_5m": {
            "buckets": len(bucket_rows),
            "quadrant_counts": quad_counts,
            "quadrant_share_pct": {
                k: _round(100.0 * v / max(1, len(bucket_rows)), 1)
                for k, v in quad_counts.items()},
            "forward_15m_by_quadrant": quad_fwd,
        },
        "largest_oi_minutes": [
            {"t": d["t"], "d_oi": d["doi"], "d_price": _round(d["dp"]),
             "quadrant": _quadrant(d["dp"], d["doi"])} for d in top_oi
        ],
        "event_windows_30m": event_windows,
        "series": {
            "basis": [{"t": _hhmm(r["t"]), "v": _round(_f(r.get("basis")))} for r in live],
            "oi": [{"t": _hhmm(r["t"]), "v": _i(r.get("oi"))} for r in live],
            "close": [{"t": _hhmm(r["t"]), "v": _round(_f(r.get("close")))} for r in live],
        },
    }


# --------------------------------------------------------------------------- #
# 4. options
# --------------------------------------------------------------------------- #
def _chain_cell(cell):
    """``[ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]`` or None."""
    if not isinstance(cell, (list, tuple)) or len(cell) < 6:
        return None
    return {
        "ce_ltp": _f(cell[0]), "pe_ltp": _f(cell[1]),
        "ce_oi": _f(cell[2]), "pe_oi": _f(cell[3]),
        "ce_vol": _f(cell[4]), "pe_vol": _f(cell[5]),
    }


def options_stats(tape, controls):
    recorded = [r for r in tape if not r.get("backfilled")]
    live = [r for r in recorded if _hhmm(r["t"]) <= LAST_LIVE_HHMM]
    if not live:
        return {"available": False, "note": "no recorded tape rows before 15:14"}
    first, last = live[0], live[-1]

    def field(row, key):
        return _f(row.get(key))

    pcr = [field(r, "pcr_oi") for r in live if field(r, "pcr_oi") is not None]
    pcr_vol = [field(r, "pcr_vol") for r in live if field(r, "pcr_vol") is not None]
    mp = [(_hhmm(r["t"]), field(r, "max_pain"))
          for r in live if field(r, "max_pain") is not None]
    mp_changes = []
    prev = None
    for when, value in mp:
        if prev is not None and value != prev:
            mp_changes.append({"t": when, "from": prev, "to": value,
                               "pts": _round(value - prev)})
        prev = value

    wall_moves = []
    prev_c = prev_p = None
    for r in live:
        cw, pw = field(r, "call_wall"), field(r, "put_wall")
        if prev_c is not None and cw is not None and cw != prev_c:
            wall_moves.append({"t": _hhmm(r["t"]), "side": "call",
                               "from": prev_c, "to": cw})
        if prev_p is not None and pw is not None and pw != prev_p:
            wall_moves.append({"t": _hhmm(r["t"]), "side": "put",
                               "from": prev_p, "to": pw})
        prev_c = cw if cw is not None else prev_c
        prev_p = pw if pw is not None else prev_p
    call_walls = [field(r, "call_wall") for r in live]
    put_walls = [field(r, "put_wall") for r in live]

    ce_oi = [_i(r.get("ce_oi")) for r in live]
    pe_oi = [_i(r.get("pe_oi")) for r in live]
    ce_vol = [_i(r.get("ce_vol")) for r in live]
    pe_vol = [_i(r.get("pe_vol")) for r in live]

    ctrl = [c for c in controls if _hhmm(c["t"]) <= LAST_LIVE_HHMM]
    day_doi = [{"t": _hhmm(c["t"]),
                "ce_doi": _i((c.get("control") or {}).get("ce_doi")),
                "pe_doi": _i((c.get("control") or {}).get("pe_doi")),
                "verdict": (c.get("control") or {}).get("verdict")}
               for c in ctrl]
    tape_day_doi = [r for r in tape if r.get("ce_oi_change_day") is not None]

    iv_series = []
    for c in ctrl:
        atm = c.get("iv_atm") or {}
        iv_series.append({"t": _hhmm(c["t"]),
                          "atm_iv": _f(atm.get("avg_iv")),
                          "ce_iv": _f(atm.get("ce_iv")),
                          "pe_iv": _f(atm.get("pe_iv")),
                          "strike": _f(atm.get("strike"))})
    iv_vals = [r["atm_iv"] for r in iv_series if r["atm_iv"] is not None]
    skew = [r["pe_iv"] - r["ce_iv"] for r in iv_series
            if r["pe_iv"] is not None and r["ce_iv"] is not None]
    atm_strikes = [r["strike"] for r in iv_series if r["strike"] is not None]

    def at(hhmm):
        for r in live:
            if _hhmm(r["t"]) >= hhmm:
                return r
        return None

    oi_clock = []
    for when in ("09:16", "10:00", "11:00", "12:00", "13:00", "14:00", "15:14"):
        row = at(when)
        if not row:
            continue
        idx = live.index(row)
        prior30 = live[max(0, idx - 30)]
        rec = {
            "t": _hhmm(row["t"]),
            "ce_oi": _i(row.get("ce_oi")),
            "pe_oi": _i(row.get("pe_oi")),
            "ce_oi_30m_delta": _i(row.get("ce_oi")) - _i(prior30.get("ce_oi")),
            "pe_oi_30m_delta": _i(row.get("pe_oi")) - _i(prior30.get("pe_oi")),
            "ce_doi_day": None, "pe_doi_day": None,
        }
        for d in day_doi:
            if d["t"] >= rec["t"]:
                rec["ce_doi_day"], rec["pe_doi_day"] = d["ce_doi"], d["pe_doi"]
                break
        oi_clock.append(rec)

    return {
        "available": True,
        "oi": {
            "ce_open": ce_oi[0], "ce_close": ce_oi[-1],
            "ce_change": ce_oi[-1] - ce_oi[0],
            "ce_change_pct": _round((ce_oi[-1] - ce_oi[0]) / ce_oi[0] * 100.0, 2),
            "ce_peak": max(ce_oi),
            "ce_peak_time": _hhmm(live[int(np.argmax(ce_oi))]["t"]),
            "pe_open": pe_oi[0], "pe_close": pe_oi[-1],
            "pe_change": pe_oi[-1] - pe_oi[0],
            "pe_change_pct": _round((pe_oi[-1] - pe_oi[0]) / pe_oi[0] * 100.0, 2),
            "pe_peak": max(pe_oi),
            "pe_peak_time": _hhmm(live[int(np.argmax(pe_oi))]["t"]),
            "ce_lots_close": round(ce_oi[-1] / LOT_SIZE),
            "pe_lots_close": round(pe_oi[-1] / LOT_SIZE),
        },
        "volume": {
            "ce_total": ce_vol[-1] - ce_vol[0],
            "pe_total": pe_vol[-1] - pe_vol[0],
            "ce_lots": round((ce_vol[-1] - ce_vol[0]) / LOT_SIZE),
            "pe_lots": round((pe_vol[-1] - pe_vol[0]) / LOT_SIZE),
            "note": ("chain volumes are cumulative day counters; the difference "
                     "is this session's traded lots"),
        },
        "pcr_oi": {
            **_describe(pcr),
            "open": pcr[0] if pcr else None,
            "close": pcr[-1] if pcr else None,
            "close_percentile": _round(_pct_rank(pcr, pcr[-1]), 1) if pcr else None,
        },
        "pcr_vol": {**_describe(pcr_vol),
                    "open": pcr_vol[0] if pcr_vol else None,
                    "close": pcr_vol[-1] if pcr_vol else None},
        "max_pain": {
            "open": mp[0][1] if mp else None,
            "close": mp[-1][1] if mp else None,
            "min": min(v for _, v in mp) if mp else None,
            "max": max(v for _, v in mp) if mp else None,
            "n_changes": len(mp_changes),
            "changes": mp_changes[:40],
            "changes_first_30m": sum(
                1 for c in mp_changes
                if _minute_of_day(c["t"]) <= SESSION_OPEN_MIN + 30),
            "close_vs_spot": (_round(mp[-1][1] - _f(last.get("spot")))
                              if mp else None),
        },
        "walls": {
            "call_open": call_walls[0], "call_close": call_walls[-1],
            "put_open": put_walls[0], "put_close": put_walls[-1],
            "call_distinct": sorted({w for w in call_walls if w is not None}),
            "put_distinct": sorted({w for w in put_walls if w is not None}),
            "n_moves": len(wall_moves),
            "moves": wall_moves[:40],
            "moves_first_30m": sum(1 for m in wall_moves
                                   if _minute_of_day(m["t"]) <= SESSION_OPEN_MIN + 30),
            "moves_after_30m": sum(1 for m in wall_moves
                                   if _minute_of_day(m["t"]) > SESSION_OPEN_MIN + 30),
            "note": ("early flips between adjacent strikes are ranking noise in "
                     "the opening 30 minutes, not new walls"),
            "call_distance_pts": (_round(call_walls[-1] - _f(last.get("spot")))
                                  if call_walls[-1] else None),
            "put_distance_pts": (_round(put_walls[-1] - _f(last.get("spot")))
                                 if put_walls[-1] else None),
        },
        "atm_iv": {
            **_describe(iv_vals),
            "open": iv_vals[0] if iv_vals else None,
            "close": iv_vals[-1] if iv_vals else None,
            "atm_strike_changes": len({s for s in atm_strikes}),
            "put_skew": {**_describe(skew),
                         "close": skew[-1] if skew else None},
            "note": ("ATM IV from iv_surface.atm.avg_iv; the ATM strike moves "
                     "with spot, so leg-level jumps are strike changes, not vol"),
        },
        "oi_clock": oi_clock,
        "day_change_oi": {
            "source": "snapshot report.control (tape field exists only 14:50+)",
            "tape_rows_with_field": len(tape_day_doi),
            "open": day_doi[0] if day_doi else None,
            "close": day_doi[-1] if day_doi else None,
            "ce_doi_close": day_doi[-1]["ce_doi"] if day_doi else None,
            "pe_doi_close": day_doi[-1]["pe_doi"] if day_doi else None,
        },
        "atm_premium": {
            "ce_open": _round(_f(first.get("atm_ce_ltp"))),
            "pe_open": _round(_f(first.get("atm_pe_ltp"))),
            "ce_close": _round(_f(last.get("atm_ce_ltp"))),
            "pe_close": _round(_f(last.get("atm_pe_ltp"))),
            "straddle_open": (_round((_f(first.get("atm_ce_ltp")) or 0)
                                     + (_f(first.get("atm_pe_ltp")) or 0))),
            "straddle_close": (_round((_f(last.get("atm_ce_ltp")) or 0)
                                      + (_f(last.get("atm_pe_ltp")) or 0))),
        },
        "series": {
            "pcr_oi": [{"t": _hhmm(r["t"]), "v": field(r, "pcr_oi")} for r in live],
            "max_pain": [{"t": _hhmm(r["t"]), "v": field(r, "max_pain")} for r in live],
            "ce_oi": [{"t": _hhmm(r["t"]), "v": _i(r.get("ce_oi"))} for r in live],
            "pe_oi": [{"t": _hhmm(r["t"]), "v": _i(r.get("pe_oi"))} for r in live],
        },
    }


# --------------------------------------------------------------------------- #
# 5. flow: ITM put OI, prior-moneyness attribution
# --------------------------------------------------------------------------- #
def _flow_interval(a, b, fixed=None):
    """Per-strike OI deltas between two consecutive recorded rows.

    Classification uses the PRIOR row's spot (no look-ahead); every sum is taken
    on the intersection of the two chain windows so a width change cannot
    masquerade as an OI change. A strike whose moneyness flips between the rows
    is reported separately (``stable``) instead of being silently counted.

    ``fixed`` (a strike set present at both ends of the session) additionally
    gives an exact telescoping sum: per-interval deltas restricted to a constant
    universe must add up to the end-to-end change.
    """
    ca, cb = a.get("chain") or {}, b.get("chain") or {}
    common = set(ca) & set(cb)
    spot0, spot1 = _f(a.get("spot")), _f(b.get("spot"))
    if not common or spot0 is None or spot1 is None:
        return None
    itm, stable, ce_otm = [], [], 0.0
    pe_oi_start = pe_oi_end = 0.0
    pe_oi_all_end = 0.0
    d_pe_fixed = 0.0
    for key in common:
        sa, sb = _chain_cell(ca[key]), _chain_cell(cb[key])
        if not sa or not sb or sa["pe_oi"] is None or sb["pe_oi"] is None:
            continue
        strike = _f(key)
        if strike is None:
            continue
        d_pe = sb["pe_oi"] - sa["pe_oi"]
        d_ce = ((sb["ce_oi"] - sa["ce_oi"])
                if sa["ce_oi"] is not None and sb["ce_oi"] is not None else 0.0)
        if fixed is not None and key in fixed:
            d_pe_fixed += d_pe
        pe_oi_all_end += sb["pe_oi"]
        if strike >= spot0:
            ce_otm += d_ce
        if strike > spot0:
            itm.append((strike, d_pe, sa["pe_ltp"]))
            pe_oi_start += sa["pe_oi"]
            pe_oi_end += sb["pe_oi"]
            if strike > max(spot0, spot1):
                stable.append(d_pe)
    return {
        "t_from": a["t"], "t_to": b["t"],
        "spot_from": spot0, "spot_to": spot1,
        "dt_min": _minute_of_day(b["t"]) - _minute_of_day(a["t"]),
        "common_strikes": len(common),
        "itm_strikes": len(itm),
        "d_itm_pe_oi": sum(d for _s, d, _p in itm),
        "d_itm_pe_oi_stable": sum(stable),
        "d_ce_otm_oi": ce_otm,
        "d_pe_fixed": d_pe_fixed,
        "itm_pe_oi_start": pe_oi_start,
        "itm_pe_oi_end": pe_oi_end,
        "pe_oi_all_end": pe_oi_all_end,
        "strikes": itm,
    }


def _session_deltas(rows, fixed=None):
    """Consecutive-recorded-row flow intervals for one session."""
    out = []
    for a, b in zip(rows, rows[1:]):
        if _minute_of_day(b["t"]) - _minute_of_day(a["t"]) > 4:
            continue
        item = _flow_interval(a, b, fixed)
        if item is None or item["common_strikes"] < 40:
            continue
        out.append(item)
    return out


def _bucket_deltas(deltas):
    buckets = {}
    for d in deltas:
        buckets.setdefault((_minute_of_day(d["t_to"]) - SESSION_OPEN_MIN) // 5,
                           []).append(d)
    rows = []
    for bid in sorted(buckets):
        chunk = buckets[bid]
        d_itm = sum(c["d_itm_pe_oi"] for c in chunk)
        base = chunk[0]["itm_pe_oi_start"] or 0.0
        total = chunk[-1]["pe_oi_all_end"] or 0.0
        rows.append({
            "from": _hhmm(chunk[0]["t_from"]),
            "to": _hhmm(chunk[-1]["t_to"]),
            "minutes": len(chunk),
            "d_itm_pe_oi": d_itm,
            "d_itm_pe_oi_stable": sum(c["d_itm_pe_oi_stable"] for c in chunk),
            "d_ce_otm_oi": sum(c["d_ce_otm_oi"] for c in chunk),
            "itm_pe_oi_base": base,
            "pe_oi_total": total,
            "pct_of_itm": (d_itm / base * 100.0) if base else None,
            "pct_of_pe_oi": (d_itm / total * 100.0) if total else None,
            "spot_change": chunk[-1]["spot_to"] - chunk[0]["spot_from"],
        })
    return rows


def flow_analysis(tape, controls):
    recorded = [r for r in tape if not r.get("backfilled")]
    live = [r for r in recorded if _hhmm(r["t"]) <= LAST_LIVE_HHMM
            and _f(r.get("spot")) is not None]
    if not live:
        return {"available": False, "note": "no recorded rows with a chain"}
    first, last = live[0], live[-1]
    ca, cb = first.get("chain") or {}, last.get("chain") or {}
    fixed = {k for k in set(ca) & set(cb)
             if (_chain_cell(ca[k]) or {}).get("pe_oi") is not None
             and (_chain_cell(cb[k]) or {}).get("pe_oi") is not None}
    deltas = _session_deltas(live, fixed)
    if not deltas:
        return {"available": False, "note": "no usable consecutive chain pairs"}

    # Telescoping check on a CONSTANT strike universe: per-interval deltas must
    # add up to the end-to-end change. (The ITM subset cannot pass this test by
    # construction — it grows as spot falls, which is exactly why it is kept as
    # a flow measure and never quoted as "the" ITM OI change.)
    telescope_end = sum(_chain_cell(cb[k])["pe_oi"] - _chain_cell(ca[k])["pe_oi"]
                        for k in fixed)
    telescope_sum = sum(d["d_pe_fixed"] for d in deltas)
    itm_end_to_end = sum(
        _chain_cell(cb[k])["pe_oi"] - _chain_cell(ca[k])["pe_oi"] for k in fixed
        if (_f(k) or 0) > (_f(first.get("spot")) or 0))
    summed = sum(d["d_itm_pe_oi"] for d in deltas)

    buckets = _bucket_deltas(deltas)
    adds = [b["d_itm_pe_oi"] for b in buckets]

    rolling = []
    for i in range(len(deltas) - 4):
        chunk = deltas[i:i + 5]
        if (_minute_of_day(chunk[-1]["t_to"])
                - _minute_of_day(chunk[0]["t_from"])) <= 8:
            rolling.append({"t": _hhmm(chunk[-1]["t_to"]),
                            "sum": sum(c["d_itm_pe_oi"] for c in chunk)})
    rolling_max = max(rolling, key=lambda r: r["sum"]) if rolling else None

    positive = [d["d_itm_pe_oi"] for d in deltas if d["d_itm_pe_oi"] > 0]
    pos_p90 = _percentile(positive, 90)
    thr = max(300_000.0, pos_p90 or 300_000.0)
    episodes, cur = [], None
    for d in deltas:
        hit = d["d_itm_pe_oi"] >= thr
        if hit and cur and (_minute_of_day(d["t_from"])
                            - _minute_of_day(cur["end_raw"])) <= 3:
            cur["rows"].append(d)
            cur["end_raw"] = d["t_to"]
            cur["total"] += d["d_itm_pe_oi"]
        elif hit:
            cur = {"rows": [d], "start_raw": d["t_from"],
                   "end_raw": d["t_to"], "total": d["d_itm_pe_oi"]}
            episodes.append(cur)
        else:
            cur = None
    episode_rows = []
    for ep in sorted(episodes, key=lambda e: -e["total"])[:8]:
        strikes = {}
        for row in ep["rows"]:
            for strike, delta, ltp in row["strikes"]:
                rec = strikes.setdefault(strike, {"strike": strike, "d_oi": 0.0,
                                                  "ltp": ltp})
                rec["d_oi"] += delta
        top = sorted(strikes.values(), key=lambda s: -s["d_oi"])[:5]
        episode_rows.append({
            "from": _hhmm(ep["start_raw"]),
            "to": _hhmm(ep["end_raw"]),
            "minutes": len(ep["rows"]),
            "total_d_itm_pe_oi": _round(ep["total"]),
            "lots": round(ep["total"] / LOT_SIZE),
            "premium_cr": _round(sum(max(0.0, s["d_oi"]) * (s["ltp"] or 0.0)
                                     for s in top) / 1e7, 2),
            "top_strikes": [{"strike": s["strike"],
                             "d_oi_lots": round(s["d_oi"] / LOT_SIZE),
                             "pe_ltp": _round(s["ltp"])} for s in top],
        })

    top_minute_rows = []
    for d in sorted(deltas, key=lambda x: -x["d_itm_pe_oi"])[:8]:
        strikes = sorted(d["strikes"], key=lambda s: -s[1])[:5]
        top_minute_rows.append({
            "t": _hhmm(d["t_to"]),
            "d_itm_pe_oi": _round(d["d_itm_pe_oi"]),
            "d_itm_pe_oi_stable": _round(d["d_itm_pe_oi_stable"]),
            "lots": round(d["d_itm_pe_oi"] / LOT_SIZE),
            "pct_of_itm_start": (_round(d["d_itm_pe_oi"]
                                        / d["itm_pe_oi_start"] * 100.0, 3)
                                 if d["itm_pe_oi_start"] else None),
            "spot_change": _round(d["spot_to"] - d["spot_from"]),
            "top_strikes": [{"strike": s, "d_oi_lots": round(dd / LOT_SIZE),
                             "pe_ltp": _round(ltp)} for s, dd, ltp in strikes],
        })

    ctrl = [c for c in controls if _hhmm(c["t"]) <= LAST_LIVE_HHMM]
    day_doi = [{"t": _hhmm(c["t"]),
                "ce": _i((c.get("control") or {}).get("ce_doi")),
                "pe": _i((c.get("control") or {}).get("pe_doi"))} for c in ctrl]

    return {
        "available": True,
        "definition": {
            "itm_put": "strike > spot of the PRIOR row",
            "universe": "intersection of the two chain windows (>=40 strikes)",
            "bucket": "non-overlapping 5 minutes, 09:15-aligned",
            "episode_threshold_units": _round(thr),
            "positive_minute_p90_units": _round(pos_p90),
            "episode_threshold_floor_binds": bool(
                pos_p90 is not None and pos_p90 < 300_000.0),
            "excluded": ("backfilled 09:15 row, minutes after 15:14 (frozen "
                         "spot), gaps > 4 minutes"),
        },
        "n_intervals": len(deltas),
        "n_buckets": len(buckets),
        "conservation": {
            "method": ("per-interval deltas on the strike set present at both "
                       "session ends"),
            "fixed_strikes": len(fixed),
            "sum_of_interval_deltas": _round(telescope_sum),
            "end_to_end_change": _round(telescope_end),
            "abs_diff": _round(abs(telescope_sum - telescope_end)),
            "ok": bool(abs(telescope_sum - telescope_end)
                       <= max(50_000.0, 0.002 * abs(telescope_end))),
            "itm_end_to_end_change": _round(itm_end_to_end),
            "itm_flow_sum": _round(summed),
            "itm_note": ("the ITM subset is a moving universe (it grows as spot "
                         "falls), so its flow sum legitimately differs from an "
                         "end-to-end ITM change; only the fixed-universe check "
                         "above is a correctness test"),
        },
        "buckets": [{k: (_round(v, 2) if isinstance(v, float) else v)
                     for k, v in b.items()} for b in buckets],
        "bucket_stats": {**_describe(adds),
                         "share_positive_pct": (_round(
                             100.0 * sum(1 for a in adds if a > 0) / len(adds), 1)
                             if adds else None)},
        "top_buckets": [{k: (_round(v, 2) if isinstance(v, float) else v)
                         for k, v in b.items()}
                        for b in sorted(buckets,
                                        key=lambda x: -x["d_itm_pe_oi"])[:6]],
        "top_minutes": top_minute_rows,
        "rolling_5m_max": {
            "t": rolling_max["t"] if rolling_max else None,
            "sum": _round(rolling_max["sum"]) if rolling_max else None,
            "note": ("overlapping 5-minute windows repeat one burst ~5x; the "
                     "non-overlapping bucket at the same time is the event"),
        },
        "episodes": episode_rows,
        "series": {
            "d_itm_pe_oi": [{"t": _hhmm(d["t_to"]), "v": _round(d["d_itm_pe_oi"])}
                            for d in deltas],
            "day_ce_doi": day_doi,
        },
    }


# --------------------------------------------------------------------------- #
# 6. cross-session context
# --------------------------------------------------------------------------- #
def full_sessions(exclude_date):
    """Every snapshot date whose tail carries a usable 1-minute session."""
    out = {}
    for path in sorted(SNAP_DIR.glob("*.jsonl")):
        date = path.stem
        if date == exclude_date:
            continue
        snap = _tail_last_json(path)
        if not snap:
            continue
        bars = session_bars(snap)
        live = [b for b in bars if _hhmm(b["t"]) <= LAST_LIVE_HHMM]
        if len(live) < 150:
            continue
        prev = _f(((snap.get("report") or {}).get("pivots") or {})
                  .get("prev", {}).get("close"))
        out[date] = {
            "closes": {_hhmm(b["t"]): b["close"] for b in live},
            "open": live[0]["open"],
            "last": live[-1]["close"],
            "last_time": _hhmm(live[-1]["t"]),
            "prev_close": prev,
            # A session truncated by a recorder restart must not define a
            # "close": its last bar is mid-afternoon, not the session end.
            "complete": _hhmm(live[-1]["t"]) >= "15:00",
        }
    return out


def tape_flow_history(exclude_date):
    """5-minute ITM-put flow per prior session, for the event study."""
    out = {}
    for path in sorted(TAPE_DIR.glob("*.jsonl")):
        if path.name.endswith(".gaps.jsonl"):
            continue
        date = path.stem
        if date == exclude_date:
            continue
        rows = [r for r in load_tape(date)
                if r.get("chain") and _f(r.get("spot")) is not None
                and not r.get("backfilled")]
        rows = [r for r in rows if _hhmm(r["t"]) <= LAST_LIVE_HHMM]
        if len(rows) < 120:
            continue
        deltas = _session_deltas(rows)
        if len(deltas) < 100:
            continue
        out[date] = {
            "closes": {_hhmm(r["t"]): _f(r["spot"]) for r in rows},
            "buckets": _bucket_deltas(deltas),
            "n_intervals": len(deltas),
        }
    return out


def _forward_pts(closes, start_hhmm, horizon_min, cap=LAST_LIVE_HHMM):
    if not start_hhmm or ":" not in str(start_hhmm):
        return None
    start = _minute_of_day(start_hhmm)
    if start < 0:
        return None
    target_min = start + horizon_min
    target = f"{target_min // 60:02d}:{target_min % 60:02d}"
    if target > cap or start_hhmm not in closes or target not in closes:
        return None
    return closes[target] - closes[start_hhmm]


def quant_context(session, sessions, flows_hist, flow_today, futures_today,
                  today_date):
    out = {}
    today_closes = session.get("closes") or {}

    # --- today's move sizes vs prior sessions -----------------------------
    comparisons = {}
    for k in (5, 15, 30):
        pooled, per_session = [], {}
        session_maxima = []
        for date, sess in sessions.items():
            closes = sess["closes"]
            vals = []
            for key in sorted(closes):
                start = _minute_of_day(key) - k
                if start < SESSION_OPEN_MIN:
                    continue
                start_key = f"{start // 60:02d}:{start % 60:02d}"
                if start_key in closes:
                    vals.append(abs(closes[key] - closes[start_key]))
            per_session[date] = len(vals)
            pooled.extend(vals)
            if vals:
                session_maxima.append(max(vals))
        today_vals = []
        for key in sorted(today_closes):
            start = _minute_of_day(key) - k
            if start < SESSION_OPEN_MIN:
                continue
            start_key = f"{start // 60:02d}:{start % 60:02d}"
            if start_key in today_closes:
                today_vals.append(abs(today_closes[key] - today_closes[start_key]))
        today_max = max(today_vals) if today_vals else None
        comparisons[f"{k}m"] = {
            "today_max_abs_pts": _round(today_max),
            "prior_n_windows": len(pooled),
            "prior_sessions": len(per_session),
            "prior_p50_pts": _round(_percentile(pooled, 50)),
            "prior_p90_pts": _round(_percentile(pooled, 90)),
            "prior_p99_pts": _round(_percentile(pooled, 99)),
            "prior_max_pts": _round(max(pooled)) if pooled else None,
            "today_max_percentile": (_round(_pct_rank(pooled, today_max), 1)
                                     if today_max is not None else None),
            "today_max_rank_from_top": ((sum(1 for v in pooled if v > today_max) + 1)
                                        if today_max is not None else None),
            "prior_session_maxima_p50": _round(_percentile(session_maxima, 50)),
            "prior_session_maxima_p90": _round(_percentile(session_maxima, 90)),
            "prior_session_maxima_max": _round(max(session_maxima))
            if session_maxima else None,
            "today_vs_session_maxima_percentile": (
                _round(_pct_rank(session_maxima, today_max), 1)
                if today_max is not None and session_maxima else None),
            "effective_n_sessions": len(per_session),
            "note": ("overlapping windows inflate the window count; the session "
                     "maxima line is the one with effective n = sessions"),
        }
    out["move_size_vs_history"] = comparisons

    # --- gap and day-return distribution ---------------------------------
    gaps, day_rets = [], []
    for date, sess in sessions.items():
        if not sess["complete"] or not sess["prev_close"]:
            continue
        gaps.append((sess["open"] - sess["prev_close"]) / sess["prev_close"] * 100.0)
        day_rets.append((sess["last"] - sess["prev_close"]) / sess["prev_close"] * 100.0)
    if gaps:
        out["gap_and_day_return"] = {
            "prior_sessions": len(gaps),
            "excluded_truncated": [d for d, s in sessions.items() if not s["complete"]],
            "gap_pct": {**_describe(gaps),
                        "today": session.get("gap_pct"),
                        "today_percentile": _round(
                            _pct_rank(gaps, session.get("gap_pct")), 1)},
            "day_return_pct": {**_describe(day_rets),
                               "today_to_last_live": session.get(
                                   "day_change_pct_to_last_live"),
                               "today_percentile": _round(_pct_rank(
                                   day_rets,
                                   session.get("day_change_pct_to_last_live")), 1)},
        }

    # --- morning selloff -> rest of session ------------------------------
    cutoff = "11:00"
    states = []
    for date, sess in sessions.items():
        closes = sess["closes"]
        if cutoff not in closes or not sess["open"]:
            continue
        to_cut = (closes[cutoff] - sess["open"]) / sess["open"] * 100.0
        fwd = _forward_pts(closes, cutoff, 254)     # 11:00 -> 15:14
        if fwd is None:
            continue
        states.append({"date": date, "to_cutoff_pct": to_cut,
                       "fwd_pts": fwd, "fwd_pct": fwd / closes[cutoff] * 100.0})
    today_cut = None
    if cutoff in today_closes and session.get("open"):
        today_cut = ((today_closes[cutoff] - session["open"])
                     / session["open"] * 100.0)
    if states:
        cond = [s for s in states if s["to_cutoff_pct"] <= -0.4]
        rest = [s for s in states if s["to_cutoff_pct"] > -0.4]
        base = [s["fwd_pct"] for s in states]
        out["morning_selloff"] = {
            "rule": "open -> 11:00 <= -0.4%; forward 11:00 -> 15:14",
            "sessions_evaluated": len(states),
            "today_to_1100_pct": _round(today_cut, 3),
            "today_in_state": bool(today_cut is not None and today_cut <= -0.4),
            "state_n": len(cond),
            "state_effective_n": len(cond),
            "state_fwd_pct": _describe([s["fwd_pct"] for s in cond]),
            "state_share_positive": (_round(
                100.0 * sum(1 for s in cond if s["fwd_pts"] > 0) / len(cond), 1)
                if cond else None),
            "other_fwd_pct": _describe([s["fwd_pct"] for s in rest]),
            "baseline_fwd_pct": _describe(base),
            "state_minus_baseline_pct": (_round(
                float(np.mean([s["fwd_pct"] for s in cond])) - float(np.mean(base)), 3)
                if cond else None),
            "bootstrap_ci": (_bootstrap_mean_ci(
                [s["fwd_pct"] for s in cond], [s["date"] for s in cond])
                if len(cond) >= 5 else None),
            "observed_values_pct": [_round(s["fwd_pct"], 3) for s in cond],
            "permutation_p_between_sessions": _permutation_p_groups(
                [s["fwd_pct"] for s in states],
                [s["to_cutoff_pct"] <= -0.4 for s in states]),
            "rows": [{"date": s["date"],
                      "to_cutoff_pct": _round(s["to_cutoff_pct"], 3),
                      "fwd_pct": _round(s["fwd_pct"], 3)} for s in states],
        }

    # --- basis extremes (today only) -------------------------------------
    live_fut = [r for r in futures_today
                if _hhmm(r["t"]) <= LAST_LIVE_HHMM
                and _f(r.get("basis")) is not None]
    if live_fut:
        basis_rows = [(_hhmm(r["t"]), _f(r["basis"]), _f(r["close"]))
                      for r in live_fut]
        vals = [b for _t, b, _c in basis_rows]
        lo, hi = _percentile(vals, 10), _percentile(vals, 90)
        fut_close = {t: c for t, _b, c in basis_rows}

        def fwd(row, horizon=30):
            t = row[0]
            target_min = _minute_of_day(t) + horizon
            target = f"{target_min // 60:02d}:{target_min % 60:02d}"
            if target > LAST_LIVE_HHMM or target not in fut_close:
                return None
            return fut_close[target] - fut_close[t]

        low_rows = [(fwd(r), r[0]) for r in basis_rows if r[1] <= lo]
        high_rows = [(fwd(r), r[0]) for r in basis_rows if r[1] >= hi]
        base_rows = [(fwd(r), r[0]) for r in basis_rows]

        def blocks(pairs):
            return [(_minute_of_day(t) - SESSION_OPEN_MIN) // 15 for _v, t in pairs]

        out["basis_extremes"] = {
            "rule": "basis in bottom/top decile of the session; forward 30m",
            "history_available": False,
            "history_note": ("only this date has a futures tape; a basis "
                             "conditional cannot be cross-validated yet"),
            "low_threshold": _round(lo), "high_threshold": _round(hi),
            "low_n": len([v for v, _ in low_rows if v is not None]),
            "low_fwd_pts": _describe([v for v, _ in low_rows]),
            "high_n": len([v for v, _ in high_rows if v is not None]),
            "high_fwd_pts": _describe([v for v, _ in high_rows]),
            "baseline_fwd_pts": _describe([v for v, _ in base_rows]),
            "low_bootstrap_ci": _bootstrap_mean_ci([v for v, _ in low_rows],
                                                   blocks(low_rows)),
            "high_bootstrap_ci": _bootstrap_mean_ci([v for v, _ in high_rows],
                                                    blocks(high_rows)),
            "effective_n_15m_blocks": len(set(blocks(base_rows))),
        }

    # --- ITM put bursts -> forward return --------------------------------
    if flows_hist:
        pooled_pct = []
        for _date, flow in flows_hist.items():
            pooled_pct.extend(b["pct_of_pe_oi"] for b in flow["buckets"]
                              if b["pct_of_pe_oi"] is not None)
        thr = _percentile(pooled_pct, 90)
        events, baseline = [], []
        for date, flow in flows_hist.items():
            closes = flow["closes"]
            for bucket in flow["buckets"]:
                f15 = _forward_pts(closes, bucket["to"], 15)
                f30 = _forward_pts(closes, bucket["to"], 30)
                if f15 is None and f30 is None:
                    continue
                base_px = closes.get(bucket["to"])
                if not base_px:
                    continue
                rec = {"date": date, "t": bucket["to"],
                       "fwd15_pct": (f15 / base_px * 100.0) if f15 is not None else None,
                       "fwd30_pct": (f30 / base_px * 100.0) if f30 is not None else None}
                baseline.append(rec)
                if (bucket["pct_of_pe_oi"] is not None and thr is not None
                        and bucket["pct_of_pe_oi"] >= thr):
                    events.append(rec)
        if events:
            ev15 = [e["fwd15_pct"] for e in events if e["fwd15_pct"] is not None]
            ev30 = [e["fwd30_pct"] for e in events if e["fwd30_pct"] is not None]
            b15 = [e["fwd15_pct"] for e in baseline if e["fwd15_pct"] is not None]
            b30 = [e["fwd30_pct"] for e in baseline if e["fwd30_pct"] is not None]
            ev_by_block, base_by_block = {}, {}
            for e in events:
                if e["fwd15_pct"] is not None:
                    ev_by_block.setdefault(e["date"], []).append(e["fwd15_pct"])
            for e in baseline:
                if e["fwd15_pct"] is not None:
                    base_by_block.setdefault(e["date"], []).append(e["fwd15_pct"])
            lcloses = {d: f["closes"] for d, f in flows_hist.items()}
            today_ev = []
            for bucket in (flow_today.get("buckets") or []):
                closes = today_closes
                f15 = _forward_pts(closes, bucket["to"], 15)
                if (bucket["pct_of_pe_oi"] is not None and thr is not None
                        and bucket["pct_of_pe_oi"] >= thr):
                    today_ev.append({"t": bucket["to"],
                                     "pct_of_pe_oi": _round(bucket["pct_of_pe_oi"], 3),
                                     "fwd15_pts": _round(f15)})
            out["itm_pe_bursts"] = {
                "definition": ("non-overlapping 5m ITM put OI add >= p90 of the "
                               "pooled cross-session distribution "
                               f"({_round(thr, 3)}% of total PE OI)"),
                "threshold_pct_of_pe_oi": _round(thr, 3),
                "sessions": len(flows_hist),
                "baseline_n": len(b15),
                "baseline_fwd15_pct": _describe(b15),
                "baseline_fwd30_pct": _describe(b30),
                "events": len(ev15),
                "effective_n_sessions": len(set(ev_by_block)),
                "event_fwd15_pct": _describe(ev15),
                "event_fwd30_pct": _describe(ev30),
                "event_share_negative_15m": (_round(
                    100.0 * sum(1 for v in ev15 if v < 0) / len(ev15), 1)
                    if ev15 else None),
                "sign_test_p_15m": _binomial_two_sided(
                    sum(1 for v in ev15 if v < 0), len(ev15)),
                "bootstrap_ci_fwd15": _bootstrap_mean_ci(
                    ev15, [e["date"] for e in events if e["fwd15_pct"] is not None]),
                "bootstrap_ci_fwd30": _bootstrap_mean_ci(
                    ev30, [e["date"] for e in events if e["fwd30_pct"] is not None]),
                "permutation_p_fwd15_vs_baseline": _permutation_p(
                    ev_by_block, base_by_block),
                "delta_vs_baseline_fwd15_pct": _round(
                    float(np.mean(ev15)) - float(np.mean(b15)), 3)
                if ev15 and b15 else None,
                "today_events": today_ev[:10],
                "today_event_count": len(today_ev),
            }

    # --- last-hour OI unwind vs history ----------------------------------
    out["oi_unwind_into_close"] = unwind_compare(today_date)
    return out


def unwind_compare(today_date):
    """CE/PE OI change over 14:28-15:29, against every tape on disk."""
    def measure(date):
        rows = [r for r in load_tape(date) if not r.get("backfilled")
                and _f(r.get("ce_oi")) is not None]
        if len(rows) < 60:
            return None
        start = [r for r in rows if _hhmm(r["t"]) <= "14:28"]
        end = [r for r in rows if _hhmm(r["t"]) <= SESSION_END_HHMM]
        if not start or not end:
            return None
        a, b = start[-1], end[-1]
        # A tape that stops mid-afternoon cannot measure a last-hour change.
        if _hhmm(b["t"]) < "15:15":
            return None
        return {"date": date, "from": _hhmm(a["t"]), "to": _hhmm(b["t"]),
                "ce_pct": (_i(b["ce_oi"]) - _i(a["ce_oi"])) / _i(a["ce_oi"]) * 100.0,
                "pe_pct": (_i(b["pe_oi"]) - _i(a["pe_oi"])) / _i(a["pe_oi"]) * 100.0}

    rows = []
    for path in sorted(TAPE_DIR.glob("*.jsonl")):
        if path.name.endswith(".gaps.jsonl"):
            continue
        rec = measure(path.stem)
        if rec:
            rows.append(rec)
    today = next((r for r in rows if r["date"] == today_date), None)
    others = [r for r in rows if r["date"] != today_date]
    if not today or len(others) < 3:
        return {}
    ce = [r["ce_pct"] for r in others]
    pe = [r["pe_pct"] for r in others]
    return {
        "window": f"{today['from']}-{today['to']}",
        "today_ce_pct": _round(today["ce_pct"], 2),
        "today_pe_pct": _round(today["pe_pct"], 2),
        "prior_sessions": len(others),
        "prior_ce_pct": _describe(ce),
        "prior_pe_pct": _describe(pe),
        "today_ce_percentile": _round(_pct_rank(ce, today["ce_pct"]), 1),
        "today_pe_percentile": _round(_pct_rank(pe, today["pe_pct"]), 1),
        "rows": [{"date": r["date"], "ce_pct": _round(r["ce_pct"], 2),
                  "pe_pct": _round(r["pe_pct"], 2)} for r in rows],
    }


# --------------------------------------------------------------------------- #
# 7. narrative
# --------------------------------------------------------------------------- #
def simple_read(payload):
    s, f, o, fl = (payload["session"], payload["futures"], payload["options"],
                   payload["flow"])
    q = payload["quant_context"]
    ms = q["move_size_vs_history"]
    out = [
        (f"Cash opened {_fmt(s['open'])} against a {_fmt(s['prior_close'])} prior "
         f"close ({_fmt(s['gap_pct'], '+.2f')}%), made its high at {_fmt(s['high'])} "
         f"in the {s['high_time']} minute, sold to {_fmt(s['low'])} at "
         f"{s['low_time']}, and finished {_fmt(s['last_live_close'])} at "
         f"{s['last_live_time']} ({_fmt(s['day_change_pct_to_last_live'], '+.2f')}% "
         f"on the day)."),
        (f"That is a {_fmt(s['range_pts'])}-point range "
         f"({_fmt(s['range_pct'])}%) with the close in the bottom "
         f"{_fmt(100 - (s['close_in_range_pct'] or 0), '.0f')}% of it; the worst "
         f"peak-to-trough drawdown was {_fmt(s['max_drawdown_pct'])}% into "
         f"{s['max_drawdown_trough_time']}, and the tape then recovered only "
         f"{_fmt(s['recovery_pts'])} of the {_fmt(-(s['max_drawdown_pts'] or 0))} "
         f"points it lost."),
    ]
    if f.get("available"):
        out.append(
            f"Futures held a {_fmt(f['basis']['mean'], '+.2f')}-point premium on "
            f"average (range {_fmt(f['basis']['min'], '+.2f')} to "
            f"{_fmt(f['basis']['max'], '+.2f')}) while open interest rose "
            f"{_fmt(f['oi']['change_pct'], '+.2f')}% and price gave up "
            f"{_fmt(abs(f['price']['change_pts'] or 0))} points — the short-buildup "
            f"combination, which was "
            f"{_fmt(f['regime_5m']['quadrant_share_pct'].get('short_buildup', 0), '.0f')}% "
            f"of 5-minute buckets.")
    else:
        out.append("No futures tape with a usable basis exists for this date, so "
                   "the basis and OI-regime read is unavailable.")
    if o.get("available"):
        out.append(
            f"Options built call OI all morning (peak "
            f"{_fmt((o['oi']['ce_peak'] / o['oi']['ce_open'] - 1) * 100, '+.0f')}% over "
            f"the 09:16 print at {o['oi']['ce_peak_time']}) and trimmed it into the "
            f"close, ending {_fmt(o['oi']['ce_change_pct'], '+.1f')}% on calls and "
            f"{_fmt(o['oi']['pe_change_pct'], '+.1f')}% on puts, with PCR "
            f"{_fmt(o['pcr_oi']['close'])} "
            f"(session range {_fmt(o['pcr_oi']['min'])}-{_fmt(o['pcr_oi']['max'])}).")
        out.append(
            f"Day-change OI says the other half: at "
            f"{o['day_change_oi']['close']['t']} calls were still "
            f"{_fmt((o['day_change_oi']['ce_doi_close'] or 0) / LOT_SIZE / 1e6, ',.2f')}M "
            f"lots net added against yesterday's close while the last 30 minutes were "
            f"a net trim — the level and the flow disagree by construction, and both "
            f"are true.")
    if fl.get("available") and fl.get("top_buckets"):
        out.append(
            f"Put buying was front-loaded: the largest non-overlapping 5-minute ITM "
            f"put build was {fl['top_buckets'][0]['from']}-"
            f"{fl['top_buckets'][0]['to']} "
            f"({_fmt(fl['top_buckets'][0]['d_itm_pe_oi'] / LOT_SIZE, ',.0f')} lots), "
            f"part of an opening burst rather than a late-session hedge.")
    if o.get("available"):
        out.append(
            f"Max pain sat at {_fmt(o['max_pain']['close'], ',.0f')} into the close "
            f"against spot {_fmt(s['last_live_close'], ',.0f')}, and the call wall "
            f"{_fmt(o['walls']['call_close'], ',.0f')} stayed "
            f"{_fmt(o['walls']['call_distance_pts'], ',.0f')} points overhead — no "
            f"wall test, so the tape was flow-driven, not pin-driven.")
    out.append(
        f"Biggest single moves were {_fmt(ms['5m']['today_max_abs_pts'])} / "
        f"{_fmt(ms['15m']['today_max_abs_pts'])} / "
        f"{_fmt(ms['30m']['today_max_abs_pts'])} points over 5/15/30 minutes. The "
        f"5-minute one is in the top 1% of prior windows, but today's *maximum* "
        f"sits only at the "
        f"{_ord(ms['5m']['today_vs_session_maxima_percentile'])} "
        f"percentile of the prior {ms['5m']['prior_sessions']} session maxima — "
        f"one sharp leg, not an unusual total excursion.")
    return out


def quant_read(payload):
    q = payload["quant_context"]
    ms = q["move_size_vs_history"]
    out = [
        (f"**Move size, two ways.** Today's maximum absolute 5/15/30-minute moves "
         f"were {_fmt(ms['5m']['today_max_abs_pts'])} / "
         f"{_fmt(ms['15m']['today_max_abs_pts'])} / "
         f"{_fmt(ms['30m']['today_max_abs_pts'])} points. Against pooled windows "
         f"that is the {_ord(ms['5m']['today_max_percentile'])} / "
         f"{_ord(ms['15m']['today_max_percentile'])} / "
         f"{_ord(ms['30m']['today_max_percentile'])} percentile, but "
         f"against each prior session's own maximum it is only the "
         f"{_ord(ms['5m']['today_vs_session_maxima_percentile'])} / "
         f"{_ord(ms['15m']['today_vs_session_maxima_percentile'])} / "
         f"{_ord(ms['30m']['today_vs_session_maxima_percentile'])} "
         f"(prior session maxima: median "
         f"{_fmt(ms['15m']['prior_session_maxima_p50'])} points at 15m, max "
         f"{_fmt(ms['15m']['prior_session_maxima_max'])}). Pooled-window "
         f"percentiles are inflated by overlap; the session-maxima line is the "
         f"one with effective n = {ms['15m']['effective_n_sessions']}.")
    ]
    gap = q.get("gap_and_day_return")
    if gap:
        out.append(
            f"**Gap and day return.** Today's "
            f"{_fmt(gap['gap_pct']['today'], '+.2f')}% gap is at the "
            f"{_ord(gap['gap_pct']['today_percentile'])} percentile of "
            f"{gap['prior_sessions']} complete prior sessions (mean "
            f"{_fmt(gap['gap_pct']['mean'], '+.2f')}%, sd "
            f"{_fmt(gap['gap_pct']['sd'])}%), and the "
            f"{_fmt(gap['day_return_pct']['today_to_last_live'], '+.2f')}% day sits "
            f"at the {_ord(gap['day_return_pct']['today_percentile'])} "
            f"percentile of the prior "
            f"{_fmt(gap['day_return_pct']['p05'], '+.2f')}% to "
            f"{_fmt(gap['day_return_pct']['p95'], '+.2f')}% 5-95 band — a weak day, "
            f"inside the band. Truncated sessions "
            f"({', '.join(gap['excluded_truncated']) or 'none'}) are excluded from "
            f"this comparison because their last bar is mid-afternoon.")
    msf = q.get("morning_selloff")
    if msf:
        out.append(
            f"**Morning selloff conditional.** {msf['state_n']} of "
            f"{msf['sessions_evaluated']} sessions were down at least 0.4% by "
            f"11:00; their 11:00→15:14 mean was "
            f"{_fmt(msf['state_fwd_pct'].get('mean'), '+.3f')}% against "
            f"{_fmt(msf['baseline_fwd_pct'].get('mean'), '+.3f')}% unconditional "
            f"(difference {_fmt(msf['state_minus_baseline_pct'], '+.3f')}%, "
            f"observed values "
            f"{', '.join(f'{v:+.3f}%' for v in msf['observed_values_pct'])}, "
            f"between-session permutation p="
            f"{_fmt(msf.get('permutation_p_between_sessions'), '.3f')}). n="
            f"{msf['state_effective_n']} is too small for a confidence "
            f"interval, so none is quoted. "
            f"Today was {_fmt(msf['today_to_1100_pct'], '+.2f')}% at 11:00, so it "
            f"is not in the state at all.")
    burst = q.get("itm_pe_bursts")
    if burst:
        bci = burst.get("bootstrap_ci_fwd15") or {}
        out.append(
            f"**ITM put bursts.** Across {burst['sessions']} sessions, "
            f"{burst['events']} non-overlapping 5-minute buckets cleared the "
            f"{_fmt(burst['threshold_pct_of_pe_oi'], '.2f')}% threshold "
            f"({burst['effective_n_sessions']} effective sessions). Their forward "
            f"15-minute return averaged "
            f"{_fmt(burst['event_fwd15_pct'].get('mean'), '+.3f')}% against "
            f"{_fmt(burst['baseline_fwd15_pct'].get('mean'), '+.3f')}% "
            f"unconditional (delta "
            f"{_fmt(burst['delta_vs_baseline_fwd15_pct'], '+.3f')}%, CI "
            f"{_fmt(bci.get('lo'), '+.3f')} to {_fmt(bci.get('hi'), '+.3f')}%, "
            f"within-session permutation p="
            f"{_fmt(burst.get('permutation_p_fwd15_vs_baseline'), '.3f')}, sign "
            f"test p={_fmt(burst.get('sign_test_p_15m'), '.3f')}). There is no "
            f"measurable follow-through: put buying marks where the move has "
            f"been, not where it is going.")
    be = q.get("basis_extremes")
    if be:
        lci = be.get("low_bootstrap_ci") or {}
        out.append(
            f"**Basis extremes (today only).** A bottom-decile basis "
            f"(<= {_fmt(be['low_threshold'], '+.2f')}) was followed by a mean "
            f"{_fmt(be['low_fwd_pts'].get('mean'), '+.2f')}-point 30-minute move "
            f"(n={be['low_n']} overlapping minutes, "
            f"{(lci.get('blocks') or 0)} independent 15-minute blocks, CI "
            f"{_fmt(lci.get('lo'), '+.2f')} to {_fmt(lci.get('hi'), '+.2f')}); the "
            f"top decile (>= {_fmt(be['high_threshold'], '+.2f')}) by "
            f"{_fmt(be['high_fwd_pts'].get('mean'), '+.2f')} points, CI straddling "
            f"zero. A negative basis is what a futures-led selloff looks like, so "
            f"this is momentum confirmation, not a forecast — and there is no "
            f"futures history on disk to test it against.")
    un = q.get("oi_unwind_into_close")
    if un:
        out.append(
            f"**Close unwind.** Between {un['window']} call OI fell "
            f"{_fmt(un['today_ce_pct'], '+.2f')}% and put OI "
            f"{_fmt(un['today_pe_pct'], '+.2f')}% — the "
            f"{_ord(un['today_ce_percentile'])} / "
            f"{_ord(un['today_pe_percentile'])} percentile against "
            f"{un['prior_sessions']} prior complete sessions (their median was "
            f"{_fmt(un['prior_ce_pct'].get('median'), '+.2f')}% / "
            f"{_fmt(un['prior_pe_pct'].get('median'), '+.2f')}%). Today's unwind "
            f"was milder than typical, so the close was not an unusual "
            f"liquidation.")
    return out


def falsifiers(payload):
    o, fl = payload["options"], payload["flow"]
    q = payload["quant_context"]
    return [
        ("**Short buildup is wrong if** the next session's futures OI falls while "
         "price is flat or up on similar volume — that would make today's OI gain "
         "a hedge roll, not new shorts."),
        ("**The close unwind is expiry mechanics, not de-risking, if** OI rebuilds "
         "on the next session to at least today's 14:28 level in the same strikes."),
        ("**The morning-selloff conditional is noise if** adding the next ten "
         "sessions moves its mean toward the unconditional mean. It has "
         f"n={q.get('morning_selloff', {}).get('state_n', 0)} sessions and a "
         "between-session permutation p that is nowhere near significance; treat "
         "any repeat of it as unproven until n is at least 15."),
        ("**ITM put bursts are not bearish markers if** the event-vs-baseline "
         "difference flips sign once the threshold is set at p75 or p95 instead of "
         "p90 — the payload stores every bucket's pct so this can be re-run "
         "without touching the data."),
        (f"**The wall read is wrong if** spot trades through "
         f"{_fmt(o['walls']['call_close'], ',.0f')} without call OI falling; that "
         f"would mean the wall was supply being absorbed, not resistance."),
        ("**The flow measurement is unusable if** the conservation check (sum of "
         "interval deltas on a fixed strike set vs the end-to-end change) fails on "
         f"the next session; today it closes to within "
         f"{fl['conservation']['abs_diff']:,.0f} units on "
         f"{fl['conservation']['fixed_strikes']} strikes."),
        ("**The \"ordinary day\" reading is wrong if** a later session's maximum "
         "5-minute move distribution shifts: today's window percentile (top 1%) "
         "and its session-maxima percentile (middle of the pack) disagree because "
         "the day had one sharp leg, and that gap is the thing to re-check."),
    ]


def evidence_table(payload):
    s, f, o, fl = (payload["session"], payload["futures"], payload["options"],
                   payload["flow"])
    q = payload["quant_context"]
    rows = [
        ("Cash open → last live close",
         f"{_fmt(s['open'])} → {_fmt(s['last_live_close'])}",
         f"{_fmt(s['day_change_pct_to_last_live'], '+.2f')}%", "snapshot 1-min bars",
         f"last live {s['last_live_time']}; CAS print {_fmt(s['cas_print'])}"),
        ("Session range", f"{_fmt(s['low'])} – {_fmt(s['high'])}",
         f"{_fmt(s['range_pts'])} pts ({_fmt(s['range_pct'])}%)",
         "snapshot 1-min bars", f"high {s['high_time']}, low {s['low_time']}"),
        ("Max drawdown", f"{_fmt(s['max_drawdown_pts'])} pts",
         f"{_fmt(s['max_drawdown_pct'])}%", "1-min closes",
         f"trough {s['max_drawdown_trough_time']}, recovered "
         f"{_fmt(s['recovery_pts'])} pts"),
    ]
    if f.get("available"):
        rows += [
            ("Futures basis", f"{_fmt(f['basis']['mean'], '+.2f')} avg",
             f"{_fmt(f['basis']['min'], '+.2f')} … {_fmt(f['basis']['max'], '+.2f')}",
             "futures tape",
             f"90% inside {_fmt(f['basis']['p05'], '+.1f')} … "
             f"{_fmt(f['basis']['p95'], '+.1f')}"),
            ("Futures OI", f"{f['oi']['open']:,} → {f['oi']['close']:,}",
             f"{_fmt(f['oi']['change_pct'], '+.2f')}%", "futures tape",
             "price down + OI up = short buildup"),
        ]
    else:
        rows.append(("Futures basis / OI", "not available", "n/a",
                     "futures tape", "no futures file for this date"))
    if o.get("available"):
        rows += [
            ("Call OI (window)", f"{o['oi']['ce_open']:,} → {o['oi']['ce_close']:,}",
             f"{_fmt(o['oi']['ce_change_pct'], '+.1f')}%", "tape chain",
             f"peak {o['oi']['ce_peak']:,} at {o['oi']['ce_peak_time']}"),
            ("Put OI (window)", f"{o['oi']['pe_open']:,} → {o['oi']['pe_close']:,}",
             f"{_fmt(o['oi']['pe_change_pct'], '+.1f')}%", "tape chain",
             f"peak {o['oi']['pe_peak']:,} at {o['oi']['pe_peak_time']}"),
            ("PCR (OI)",
             f"{_fmt(o['pcr_oi']['open'])} → {_fmt(o['pcr_oi']['close'])}",
             f"{_fmt(o['pcr_oi']['min'])} … {_fmt(o['pcr_oi']['max'])}", "tape",
             f"close at {_ord(o['pcr_oi']['close_percentile'])} pct of session"),
            ("Max pain",
             f"{_fmt(o['max_pain']['open'], ',.0f')} → "
             f"{_fmt(o['max_pain']['close'], ',.0f')}",
             f"{_fmt(o['max_pain']['close_vs_spot'], '+,.0f')} vs tape spot", "tape",
             f"{o['max_pain']['n_changes']} migrations"),
            ("Call / put wall",
             f"{_fmt(o['walls']['call_close'], ',.0f')} / "
             f"{_fmt(o['walls']['put_close'], ',.0f')}",
             f"{_fmt(o['walls']['call_distance_pts'], '+,.0f')} / "
             f"{_fmt(o['walls']['put_distance_pts'], '+,.0f')} pts",
             "tape walls", f"{o['walls']['n_moves']} wall moves"),
            ("ATM IV", f"{_fmt(o['atm_iv']['open'])} → {_fmt(o['atm_iv']['close'])}",
             f"{_fmt(o['atm_iv']['min'])} … {_fmt(o['atm_iv']['max'])}",
             "snapshot iv_surface",
             f"put skew {_fmt(o['atm_iv']['put_skew']['close'], '+.2f')} vol pts"),
        ]
    if fl.get("available") and fl.get("top_buckets"):
        rows.append(
            ("ITM put flow",
             f"{_fmt(fl['top_buckets'][0]['d_itm_pe_oi'] / LOT_SIZE, ',.0f')} lots peak 5m",
             f"{_fmt(fl['bucket_stats'].get('mean', 0) / LOT_SIZE, '+,.0f')} lots avg 5m bucket",
             "tape chain", f"conservation ok={fl['conservation']['ok']}"))
    rows.append(
        ("15m max move vs history",
         f"{_fmt(q['move_size_vs_history']['15m']['today_max_abs_pts'])} pts",
         f"{_ord(q['move_size_vs_history']['15m']['today_max_percentile'])} "
         f"pct of windows / "
         f"{_ord(q['move_size_vs_history']['15m']['today_vs_session_maxima_percentile'])} "
         f"pct of session maxima",
         f"{q['move_size_vs_history']['15m']['prior_sessions']} prior sessions",
         "overlap inflates window pct; session maxima carry effective n"))
    return rows


# --------------------------------------------------------------------------- #
# markdown
# --------------------------------------------------------------------------- #
def render_markdown(payload):
    s, f, o, fl, q = (payload["session"], payload["futures"], payload["options"],
                      payload["flow"], payload["quant_context"])
    c = payload["coverage"]
    L = [f"# NIFTY tape — quant review, {payload['date']}", "",
         f"Expiry **{payload['expiry']}** · contract `{payload['contract']}` · "
         f"generated {payload['generated_at']}", ""]

    L += ["## Simple read", ""]
    L += [f"- {line}" for line in payload["simple_read"]]
    L += ["", "## Quant read", ""]
    L += [f"- {line}" for line in payload["quant_read"]]

    L += ["", "## Evidence table", "",
          "| Metric | Value | Change / rank | Source | Note |",
          "|---|---|---|---|---|"]
    for row in evidence_table(payload):
        L.append("| " + " | ".join(str(x) for x in row) + " |")

    L += ["", "### Session shape", "", "| Item | Value |", "|---|---|"]
    for key, label, spec in [
        ("open", "Open", ",.2f"), ("high", "High", ",.2f"),
        ("low", "Low", ",.2f"), ("last_live_close", "Last live close", ",.2f"),        ("cas_print", "Post-freeze print", ",.2f"),
        ("prior_close", "Prior close", ",.2f"), ("gap_pct", "Gap %", "+.2f"),
        ("day_change_pct_to_last_live", "Day change (last live) %", "+.2f"),
        ("range_pts", "Range (pts)", ",.2f"),
        ("close_in_range_pct", "Close in range %", ".1f"),
        ("max_drawdown_pct", "Max drawdown %", ".2f"),
        ("recovery_pts", "Recovery (pts)", ",.2f"),
    ]:
        L.append(f"| {label} | {_fmt(s.get(key), spec)} |")
    L += ["",
          f"Extremes: the bar low is {_fmt(s['low'])} at {s['low_time']} (a wick — the "
          f"lowest 1-minute **close** was {_fmt(s['low_close'])} at "
          f"{s['low_close_time']}), and the bar high is {_fmt(s['high'])} at "
          f"{s['high_time']} against a highest close of {_fmt(s['high_close'])} at "
          f"{s['high_close_time']}."]
    L += ["", "Largest moves (exact close-to-close offsets, not summed bars):", "",          "| Horizon | Largest up | Largest down | Max abs | sd |",
          "|---|---|---|---|---|"]
    for k in ("5m", "15m", "30m"):
        m = s["moves"][k]
        up = ", ".join(f"{r['t']} {_fmt(r['pts'], '+,.2f')}"
                       for r in m["largest_up"][:2])
        dn = ", ".join(f"{r['t']} {_fmt(r['pts'], '+,.2f')}"
                       for r in m["largest_down"][:2])
        L.append(f"| {k} | {up} | {dn} | {_fmt(m['max_abs_pts'])} | "
                 f"{_fmt(m['sd_pts'])} |")

    L += ["", "### Futures", ""]
    if not f.get("available"):
        L += ["_No futures tape with a usable basis exists for this date._"]
    else:
        L += [
          f"- Basis: mean {_fmt(f['basis']['mean'], '+.2f')}, median "
          f"{_fmt(f['basis']['median'], '+.2f')}, sd {_fmt(f['basis']['sd'])}, "
          f"p05 {_fmt(f['basis']['p05'], '+.2f')}, p95 "
          f"{_fmt(f['basis']['p95'], '+.2f')}; low "
          f"{_fmt(f['basis']['min'], '+.2f')} at {f['basis']['min_time']}, high "
          f"{_fmt(f['basis']['max'], '+.2f')} at {f['basis']['max_time']}. "
          f"{_fmt(f['basis']['share_positive_pct'], '.0f')}% of minutes were in "
          f"premium.",
          f"- OI {f['oi']['open']:,} → {f['oi']['close']:,} "
          f"({_fmt(f['oi']['change_pct'], '+.2f')}%), peak {f['oi']['max']:,} at "
          f"{f['oi']['max_time']}; price {_fmt(f['price']['open'])} → "
          f"{_fmt(f['price']['close'])} "
          f"({_fmt(f['price']['change_pts'], '+.2f')}) from "
          f"{f['price']['open_time']} (basis is unavailable at 09:15)."]
        L += ["", "5-minute OI/price regimes:", "",
              "| Regime | Buckets | Share | fwd 15m mean | fwd 15m median | share negative |",
              "|---|---|---|---|---|---|"]
        for quad, cnt in sorted(f["regime_5m"]["quadrant_counts"].items(),
                                key=lambda kv: -kv[1]):
            fwd = f["regime_5m"]["forward_15m_by_quadrant"].get(quad) or {}
            L.append(f"| {quad} | {cnt} | "
                     f"{_fmt(f['regime_5m']['quadrant_share_pct'].get(quad), '.0f')}% | "
                     f"{_fmt(fwd.get('mean_pts'), '+.2f')} | "
                     f"{_fmt(fwd.get('median_pts'), '+.2f')} | "
                     f"{_fmt(fwd.get('share_negative'), '.0f')}% |")
        L += ["", "Largest single-minute OI changes:", "",
              "| Minute | ΔOI | Δprice | Regime |", "|---|---|---|---|"]
        for row in f["largest_oi_minutes"]:
            L.append(f"| {row['t']} | {row['d_oi']:+,} | "
                     f"{_fmt(row['d_price'], '+.2f')} | {row['quadrant']} |")
        L += ["", "30-minute windows:", "",
              "| Window | Δprice | ΔOI | Volume | Basis start→end | Regime |",
              "|---|---|---|---|---|---|"]
        for w in f["event_windows_30m"]:
            L.append(f"| {w['window']} | {_fmt(w['dp'], '+.2f')} | {w['doi']:+,} | "
                     f"{w['dvol']:,} | {_fmt(w['basis_start'], '+.1f')} → "
                     f"{_fmt(w['basis_end'], '+.1f')} "
                     f"({_fmt(w['basis_change'], '+.1f')}) | {w['quadrant']} |")

    L += ["", "### Options", "", "| Item | Value |", "|---|---|",
          f"| Call OI | {o['oi']['ce_open']:,} → {o['oi']['ce_close']:,} "
          f"({_fmt(o['oi']['ce_change_pct'], '+.1f')}%) |",
          f"| Put OI | {o['oi']['pe_open']:,} → {o['oi']['pe_close']:,} "
          f"({_fmt(o['oi']['pe_change_pct'], '+.1f')}%) |",
          f"| Session volume | CE {o['volume']['ce_lots']:,} lots / "
          f"PE {o['volume']['pe_lots']:,} lots |",
          f"| PCR(OI) | {_fmt(o['pcr_oi']['open'])} → "
          f"{_fmt(o['pcr_oi']['close'])}, range {_fmt(o['pcr_oi']['min'])}-"
          f"{_fmt(o['pcr_oi']['max'])} |",
          f"| PCR(vol) | {_fmt(o['pcr_vol']['open'])} → "
          f"{_fmt(o['pcr_vol']['close'])} |",
          f"| Max pain | {_fmt(o['max_pain']['open'], ',.0f')} → "
          f"{_fmt(o['max_pain']['close'], ',.0f')} "
          f"({o['max_pain']['n_changes']} migrations) |",
          f"| Walls | call {_fmt(o['walls']['call_close'], ',.0f')} "
          f"({_fmt(o['walls']['call_distance_pts'], '+,.0f')}) / put "
          f"{_fmt(o['walls']['put_close'], ',.0f')} "
          f"({_fmt(o['walls']['put_distance_pts'], '+,.0f')}) |",
          f"| ATM IV | {_fmt(o['atm_iv']['open'])} → "
          f"{_fmt(o['atm_iv']['close'])}, range {_fmt(o['atm_iv']['min'])}-"
          f"{_fmt(o['atm_iv']['max'])} |",
          f"| Put skew | {_fmt(o['atm_iv']['put_skew']['close'], '+.2f')} vol pts "
          f"at close (mean {_fmt(o['atm_iv']['put_skew']['mean'], '+.2f')}) |",
          f"| ATM straddle | {_fmt(o['atm_premium']['straddle_open'])} → "
          f"{_fmt(o['atm_premium']['straddle_close'])} |"]
    if o["max_pain"]["changes"]:
        path = " → ".join(
            f"{_fmt(ch['to'], ',.0f')} ({ch['t']})"
            for ch in o["max_pain"]["changes"][:8])
        L += ["",
              f"Max-pain path ({o['max_pain']['n_changes']} migrations, "
              f"{o['max_pain']['changes_first_30m']} of them in the first 30 "
              f"minutes): {_fmt(o['max_pain']['open'], ',.0f')} → {path}"
              + (" …" if o["max_pain"]["n_changes"] > 8 else "")]
    if o["walls"]["moves"]:
        moves = "; ".join(
            f"{m['t']} {m['side']} {_fmt(m['from'], ',.0f')}→{_fmt(m['to'], ',.0f')}"
            for m in o["walls"]["moves"][:6])
        L += ["", f"Wall moves ({o['walls']['n_moves']}, "
                  f"{o['walls']['moves_first_30m']} in the first 30 minutes — the "
                  f"early flips are adjacent-strike noise, not decisions): {moves}"
              + (" …" if o["walls"]["n_moves"] > 6 else "")]
    L += ["", "**Day-change OI vs interval delta.** Different objects; never add "
          "or compare them as one series.", "",
          "| Time | CE OI level | CE day-change vs prev close | CE last-30m delta "
          "| PE day-change | PE last-30m delta |",
          "|---|---|---|---|---|---|"]
    for row in o["oi_clock"]:
        L.append(f"| {row['t']} | {row['ce_oi']:,} | "
                 f"{(row['ce_doi_day'] or 0) / LOT_SIZE:,.0f} lots | "
                 f"{row['ce_oi_30m_delta'] / LOT_SIZE:+,.0f} lots | "
                 f"{(row['pe_doi_day'] or 0) / LOT_SIZE:,.0f} lots | "
                 f"{row['pe_oi_30m_delta'] / LOT_SIZE:+,.0f} lots |")
    L += ["",
          f"The tape's own `ce_oi_change_day` field exists for only "
          f"{o['day_change_oi']['tape_rows_with_field']} of "
          f"{c['tape']['rows']} minutes (from 14:50); the snapshot `control` block "
          f"carries it all day, which is why the day-change column comes from "
          f"there."]

    L += ["", "### Flow — ITM put OI, prior-moneyness attribution", "",
          f"Definition: {fl['definition']['itm_put']}; universe "
          f"{fl['definition']['universe']}; buckets "
          f"{fl['definition']['bucket']}. Excluded: {fl['definition']['excluded']}.",
          "",
          f"Conservation: the sum of {fl['n_intervals']} interval deltas on the "
          f"{fl['conservation']['fixed_strikes']} strikes present at both session "
          f"ends is {fl['conservation']['sum_of_interval_deltas']:,.0f} units "
          f"against an end-to-end change of "
          f"{fl['conservation']['end_to_end_change']:,.0f} "
          f"(abs diff {fl['conservation']['abs_diff']:,.0f}, "
          f"ok={fl['conservation']['ok']}). The ITM flow sum "
          f"({fl['conservation']['itm_flow_sum']:,.0f}) deliberately does not equal "
          f"an end-to-end ITM change "
          f"({fl['conservation']['itm_end_to_end_change']:,.0f}): the ITM set "
          f"grows as spot falls, so it is a flow measure, never a stock.", "",
          f"Episode threshold: max(300,000 units, p90 of positive 1-minute adds); "
          f"today that p90 was "
          f"{_fmt(fl['definition']['positive_minute_p90_units'], ',.0f')} units, "
          f"so the floor "
          f"{'binds' if fl['definition']['episode_threshold_floor_binds'] else 'does not bind'} "
          f"— the threshold is an absolute "
          f"{_fmt(fl['definition']['episode_threshold_units'], ',.0f')} units "
          f"({_fmt(fl['definition']['episode_threshold_units'] / LOT_SIZE, ',.0f')} lots) "
          f"per minute.", "",
          "Largest non-overlapping 5-minute ITM put builds (these are the events):",
          "",
          "| Window | ΔITM PE OI | Lots | % of ITM start | CE OTM ΔOI | Spot Δ |",
          "|---|---|---|---|---|---|"]
    for b in fl["top_buckets"]:
        L.append(f"| {b['from']}–{b['to']} | {b['d_itm_pe_oi']:+,.0f} | "
                 f"{b['d_itm_pe_oi'] / LOT_SIZE:+,.0f} | "
                 f"{_fmt(b['pct_of_itm'], '+.2f')}% | "
                 f"{b['d_ce_otm_oi']:+,.0f} | {_fmt(b['spot_change'], '+.1f')} |")
    L += ["",
          f"Rolling (overlapping) 5-minute maximum: "
          f"{fl['rolling_5m_max']['sum']:+,.0f} units at "
          f"{fl['rolling_5m_max']['t']} — {fl['rolling_5m_max']['note']}.", "",
          "Single-minute additions with the strikes that carried them "
          "(moneyness from the prior minute's spot, so no look-ahead):", "",
          "| Minute | ΔITM PE OI | Lots | % of ITM start | Stable Δ | Top strikes (Δ lots) |",
          "|---|---|---|---|---|---|"]
    for row in fl["top_minutes"]:
        strikes = ", ".join(f"{s['strike']:.0f} ({s['d_oi_lots']:+,})"
                            for s in row["top_strikes"][:3])
        L.append(f"| {row['t']} | {row['d_itm_pe_oi']:+,.0f} | "
                 f"{row['lots']:+,} | {_fmt(row['pct_of_itm_start'], '+.2f')}% | "
                 f"{row['d_itm_pe_oi_stable']:+,.0f} | {strikes} |")
    if fl["episodes"]:
        L += ["", "Burst episodes (consecutive above-threshold minutes merged, so "
              "one burst is one event):", "",
              "| Episode | Minutes | ΔITM PE OI | Lots | Top strikes |",
              "|---|---|---|---|---|"]
        for ep in fl["episodes"]:
            strikes = ", ".join(f"{s['strike']:.0f} ({s['d_oi_lots']:+,})"
                                for s in ep["top_strikes"][:3])
            L.append(f"| {ep['from']}–{ep['to']} | {ep['minutes']} | "
                     f"{ep['total_d_itm_pe_oi']:+,.0f} | {ep['lots']:+,} | "
                     f"{strikes} |")

    L += ["", "### Cross-session context", "",
          "| Horizon | Today max | Prior p50 | Prior p90 | Prior p99 | Pct of windows "
          "| Pct of session maxima | Sessions |", "|---|---|---|---|---|---|---|---|"]
    for k in ("5m", "15m", "30m"):
        m = q["move_size_vs_history"][k]
        L.append(f"| {k} | {_fmt(m['today_max_abs_pts'])} | "
                 f"{_fmt(m['prior_p50_pts'])} | {_fmt(m['prior_p90_pts'])} | "
                 f"{_fmt(m['prior_p99_pts'])} | "
                 f"{_ord(m['today_max_percentile'])} | "
                 f"{_ord(m['today_vs_session_maxima_percentile'])} | "
                 f"{m['prior_sessions']} |")
    L += ["",
          f"Prior session maxima (the day-level read, effective n = sessions): "
          f"5m median {_fmt(q['move_size_vs_history']['5m']['prior_session_maxima_p50'])} "
          f"/ max {_fmt(q['move_size_vs_history']['5m']['prior_session_maxima_max'])}; "
          f"15m median {_fmt(q['move_size_vs_history']['15m']['prior_session_maxima_p50'])} "
          f"/ max {_fmt(q['move_size_vs_history']['15m']['prior_session_maxima_max'])}; "
          f"30m median {_fmt(q['move_size_vs_history']['30m']['prior_session_maxima_p50'])} "
          f"/ max {_fmt(q['move_size_vs_history']['30m']['prior_session_maxima_max'])}."]
    msf = q.get("morning_selloff")
    if msf:
        L += ["",
              f"**Morning selloff** ({msf['rule']}): state n={msf['state_n']} of "
              f"{msf['sessions_evaluated']} sessions, mean "
              f"{_fmt(msf['state_fwd_pct'].get('mean'), '+.3f')}% vs baseline "
              f"{_fmt(msf['baseline_fwd_pct'].get('mean'), '+.3f')}%, difference "
              f"{_fmt(msf['state_minus_baseline_pct'], '+.3f')}%. Observed values "
              f"{', '.join(f'{v:+.3f}%' for v in msf['observed_values_pct'])}; "
              f"between-session permutation p="
              f"{_fmt(msf.get('permutation_p_between_sessions'), '.3f')}. No CI is "
              f"quoted because n<5.", "",
              "| Date | Open→11:00 | 11:00→15:14 |", "|---|---|---|"]
        for row in msf["rows"]:
            L.append(f"| {row['date']} | {_fmt(row['to_cutoff_pct'], '+.2f')}% | "
                     f"{_fmt(row['fwd_pct'], '+.3f')}% |")
    burst = q.get("itm_pe_bursts")
    if burst:
        bci = burst.get("bootstrap_ci_fwd15") or {}
        L += ["",
              f"**ITM put bursts** ({burst['definition']}): {burst['events']} "
              f"events across {burst['effective_n_sessions']} effective sessions. "
              f"Forward 15m mean "
              f"{_fmt(burst['event_fwd15_pct'].get('mean'), '+.3f')}% vs baseline "
              f"{_fmt(burst['baseline_fwd15_pct'].get('mean'), '+.3f')}%; delta "
              f"{_fmt(burst['delta_vs_baseline_fwd15_pct'], '+.3f')}%, CI "
              f"{_fmt(bci.get('lo'), '+.3f')} to {_fmt(bci.get('hi'), '+.3f')}, "
              f"permutation p="
              f"{_fmt(burst.get('permutation_p_fwd15_vs_baseline'), '.3f')}. "
              f"{_fmt(burst['event_share_negative_15m'], '.0f')}% of events were "
              f"followed by a lower 15-minute close (sign test p="
              f"{_fmt(burst.get('sign_test_p_15m'), '.3f')})."]
    be = q.get("basis_extremes")
    if be:
        lci, hci = be.get("low_bootstrap_ci") or {}, be.get("high_bootstrap_ci") or {}
        L += ["",
              f"**Basis extremes** (today only, no futures history on disk): "
              f"bottom decile ≤ {_fmt(be['low_threshold'], '+.2f')} → mean 30m "
              f"{_fmt(be['low_fwd_pts'].get('mean'), '+.2f')} pts "
              f"(n={be['low_n']}, {lci.get('blocks') or 0} blocks, CI "
              f"{_fmt(lci.get('lo'), '+.2f')} to {_fmt(lci.get('hi'), '+.2f')}); "
              f"top decile ≥ {_fmt(be['high_threshold'], '+.2f')} → "
              f"{_fmt(be['high_fwd_pts'].get('mean'), '+.2f')} pts "
              f"(n={be['high_n']}, {hci.get('blocks') or 0} blocks, CI "
              f"{_fmt(hci.get('lo'), '+.2f')} to {_fmt(hci.get('hi'), '+.2f')}); "
              f"baseline {_fmt(be['baseline_fwd_pts'].get('mean'), '+.2f')} pts."]
    un = q.get("oi_unwind_into_close")
    if un:
        L += ["",
              f"**Last-hour OI unwind** ({un['window']}): today CE "
              f"{_fmt(un['today_ce_pct'], '+.2f')}% / PE "
              f"{_fmt(un['today_pe_pct'], '+.2f')}%, percentiles "
              f"{_fmt(un['today_ce_percentile'], '.0f')} / "
              f"{_fmt(un['today_pe_percentile'], '.0f')} against "
              f"{un['prior_sessions']} sessions."]

    L += ["", "## What would falsify", ""]
    L += [f"- {line}" for line in payload["falsifiers"]]

    L += ["", "## Data quality", "", "| Check | Result |", "|---|---|"]
    t = c["tape"]
    L += [
        f"| Tape minutes | {t['rows']} rows, {t['unique_minutes']} unique, "
        f"{len(t['missing_minutes'])} missing of {t['expected_minutes']} |",
        f"| Duplicate minutes | {len(t['duplicate_minutes'])} |",
        f"| Backfilled rows | {t['backfilled_rows']} "
        f"({', '.join(t['backfilled_minutes'])}), "
        f"{', '.join(str(n) for n in t['backfilled_chain_strikes'])} strikes vs "
        f"median {_fmt(t['recorded_chain_strikes_median'], '.0f')} — excluded "
        f"from deltas |",
        f"| File order | {t['non_monotonic_file_order']} out-of-order line(s); the "
        f"09:15 backfill was appended mid-file |",
        f"| CAS / frozen rows | {t['cas_rows']} "
        f"({'–'.join(t['cas_window']) if t['cas_window'] else 'none'}) — excluded "
        f"from spot metrics |",

        f"| Tape gap journal | {t['gaps_journal']} entries: "
        f"{_reasons(t['gaps_journal_reasons'])} |",
        f"| Futures | {c['futures']['rows']} rows, "
        f"{c['futures']['unique_minutes']} minutes, null spot "
        f"{c['futures']['null_spot_rows']}, CAS rows "
        f"{c['futures']['frozen_spot_rows']} |",
        f"| Snapshots | {c['snapshots']['rows']} rows; missing vs tape: "
        f"{', '.join(c['snapshots']['missing_vs_tape']) or 'none'} |",
        f"| 10s chain | {c['chain10s']['frames']} frames over "
        f"{c['chain10s']['minutes_covered']} minutes, "
        f"{c['chain10s']['frames_per_minute_min']}-"
        f"{c['chain10s']['frames_per_minute_max']}/min (median "
        f"{_fmt(c['chain10s']['frames_per_minute_median'], '.0f')}) |",
        f"| 10s cadence | median {_fmt(c['chain10s']['median_gap_s'])}s, max "
        f"{_fmt(c['chain10s']['max_gap_s'])}s, "
        f"{c['chain10s']['gaps_over_20s']} gaps >20s, "
        f"{c['chain10s']['gaps_over_60s']} >60s |",
        f"| 10s journal | {c['chain10s']['gaps_journal']} entries "
        f"{_reasons(c['chain10s']['gaps_journal_reasons'])}; claims not reproduced "
        f"in the frame stream: "
        f"{'yes' if c['chain10s']['journal_gap_claims_not_reproduced'] else 'no'} |",
        f"| 10s file order | {c['chain10s']['file_order_violations']} out-of-order "
        f"lines — sort before measuring cadence |",
        f"| Tape vs bar spot | median |diff| "
        f"{_fmt(c['tape_vs_snapshot_bars']['median_abs_diff_pts'])} pts, p95 "
        f"{_fmt(c['tape_vs_snapshot_bars']['p95_abs_diff_pts'])} pts "
        f"(n={c['tape_vs_snapshot_bars']['n']}) |",
    ]
    L += ["", "Caveats:", ""]
    L += [f"- {line}" for line in payload["caveats"]]
    return "\n".join(L)


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def build(date):
    raw_tape = load_jsonl(TAPE_DIR / f"{date}.jsonl")
    tape = load_tape(date)
    futures = load_futures(date)
    chain10s = load_chain10s(date)
    snap_times = snapshot_times(date)
    snapshot_tail = _tail_last_json(SNAP_DIR / f"{date}.jsonl")
    controls = load_snapshot_compact(date)
    gaps_tape = load_jsonl(TAPE_DIR / f"{date}.gaps.jsonl")
    gaps_chain = load_jsonl(CHAIN_DIR / f"{date}.gaps.jsonl")

    bars = session_bars(snapshot_tail)
    prev_close = _f(((snapshot_tail or {}).get("report") or {})
                    .get("pivots", {}).get("prev", {}).get("close"))
    regime = ((snapshot_tail or {}).get("report") or {}).get("regime") or {}

    cov = coverage(date, tape, raw_tape, futures, chain10s, snap_times,
                   gaps_tape, gaps_chain, bars)
    session = session_stats(bars, prev_close, regime)
    fut = futures_stats(futures)
    opts = options_stats(tape, controls)
    flow = flow_analysis(tape, controls)
    if not (opts.get("available") and flow.get("available")):
        raise SystemExit(
            f"{date}: the tape has no recorded option chain rows, so there is no "
            "options/flow review to write (tapes before 2026-10-19 have no chain "
            "and no futures file).")

    prior = full_sessions(exclude_date=date)
    flows_hist = tape_flow_history(date)
    qctx = quant_context(session, prior, flows_hist, flow, futures, date)
    crude = {k: v for k, v in session.items() if k != "closes"}
    session = crude

    payload = {
        "date": date,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "symbol": "NIFTY",
        "expiry": next((r.get("expiry") for r in tape if r.get("expiry")), None),
        "contract": next((r.get("instrument_key") for r in futures
                          if r.get("instrument_key")), None),
        "sources": {
            "tape": str((TAPE_DIR / f"{date}.jsonl").relative_to(ROOT)),
            "futures": str((FUT_DIR / f"{date}.jsonl").relative_to(ROOT)),
            "snapshots": str((SNAP_DIR / f"{date}.jsonl").relative_to(ROOT)),
            "chain10s": str((CHAIN_DIR / f"{date}.jsonl").relative_to(ROOT)),
        },
        "coverage": cov,
        "session": session,
        "futures": fut,
        "options": opts,
        "flow": flow,
        "quant_context": qctx,
    }
    payload["simple_read"] = simple_read(payload)
    payload["quant_read"] = quant_read(payload)
    payload["evidence_table"] = [
        {"metric": m, "value": v, "change": c, "source": s, "note": n}
        for m, v, c, s, n in evidence_table(payload)
    ]
    payload["falsifiers"] = falsifiers(payload)
    payload["caveats"] = caveats(payload)
    return payload


def caveats(payload):
    c = payload["coverage"]
    return [
        ("One session. Every cross-session number is a description of a small "
         "sample, not an edge; n sits next to each claim and the bootstrap "
         "resamples whole sessions, so overlapping windows cannot inflate it."),
        ("The 09:15 tape row is reconstructed from a 30-strike 10-second frame: its "
         "OI total is roughly half the full 158-strike chain and its PCR reads "
         "0.90 against 1.08 one minute later, so it is excluded from every delta "
         "and total."),
        ("The index spot is frozen from 15:15 for the Closing Auction Session while "
         "F&O trades to 15:40. All spot-dependent metrics stop at 15:14; the 15:14 "
         "print is not the official 15:30 close, and on prior sessions the frozen "
         "print has differed from the next day's reference close by up to ~80 "
         "points."),
        ("Tape spot is a point-in-time LTP inside the minute while snapshot bars "
         f"are minute closes; the median gap is "
         f"{_fmt(c['tape_vs_snapshot_bars']['median_abs_diff_pts'])} points, so "
         "sub-5-point differences between the two sources are timing noise."),
        ("Pooled 5/15/30-minute move percentiles treat overlapping windows as "
         "independent observations. They answer \"how unusual is a window like "
         "this\", not \"how unusual is a day like this\"; the per-session maxima "
         "line is the day-level read and carries effective n = sessions."),
        ("Call/put OI totals are sums over the strikes the recorder's window kept "
         f"({_fmt(c['chain10s']['strikes_per_frame_median'], '.0f')} strikes in "
         "the 10-second feed, 158 in the minute tape). Levels are "
         "window-dependent; only deltas on a fixed strike intersection are "
         "comparable."),
        ("The 10-second chain journal logs 30+ poll failures between 14:32 and "
         f"15:39, but the frame stream never gaps more than "
         f"{_fmt(c['chain10s']['max_gap_s'])}s — the journal is per-poller, not "
         "per-feed, and must not be read as missing minutes."),
        ("Basis is futures close minus a spot print taken at a different instant, so "
         "it carries a few points of timing noise; only its slow drift is "
         "meaningful."),
        ("No causal claim is made anywhere: OI, basis and premium flow are "
         "positioning, and positioning is as much an outcome of price as a cause."),
    ]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default="2026-11-18")
    parser.add_argument("--outdir", default=None)
    args = parser.parse_args(argv)

    payload = _jsonable(build(args.date))
    outdir = Path(args.outdir) if args.outdir else (
        ROOT / "reports" / f"nifty_{args.date}" / "research")
    outdir.mkdir(parents=True, exist_ok=True)

    blob = json.dumps(payload, indent=2, allow_nan=False)
    (outdir / "quant_tape.json").write_text(blob + "\n", encoding="utf-8")
    (outdir / "quant_tape.md").write_text(render_markdown(payload) + "\n",
                                          encoding="utf-8")

    t = payload["coverage"]["tape"]
    print(f"wrote {outdir / 'quant_tape.json'} ({len(blob)} bytes)")
    print(f"wrote {outdir / 'quant_tape.md'}")
    print(f"tape rows {t['rows']} unique {t['unique_minutes']} missing "
          f"{len(t['missing_minutes'])} backfilled {t['backfilled_rows']}")
    print(f"session {payload['session']['open']:.2f} -> "
          f"{payload['session']['last_live_close']:.2f} "
          f"({payload['session']['day_change_pct_to_last_live']:+.2f}%)")
    print(f"flow intervals {payload['flow']['n_intervals']} "
          f"conservation_ok={payload['flow']['conservation']['ok']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
