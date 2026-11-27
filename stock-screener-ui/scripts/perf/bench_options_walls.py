#!/usr/bin/env python3
"""Deterministic options-wall payload/count/timing probe.

Run from stock-screener-ui with the task venv::

    PYTHONPATH=. CI_MODE=1 <venv>/bin/python scripts/perf/bench_options_walls.py payload
    PYTHONPATH=. CI_MODE=1 <venv>/bin/python scripts/perf/bench_options_walls.py counts
    PYTHONPATH=. CI_MODE=1 <venv>/bin/python scripts/perf/bench_options_walls.py time

``payload`` writes exact per-config JSON strings (field order included) to
``OPTIONS_WALLS_ARTIFACT_DIR/options_walls_payloads.json`` for parity checks.
``counts`` reports raw call counts for one compute_wall_state request.  ``time``
reports median/p95 milliseconds over 5 warmups + 20 timed reps in one process.
"""

from __future__ import annotations

import json
import math
import os
import statistics
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

from api.reports_api import options_walls as ow

DATE_STR = "2026-11-17"
ARTIFACT_DIR = Path(
    os.environ.get(
        "OPTIONS_WALLS_ARTIFACT_DIR",
        "/workspaces/test-rag/.agent-artifacts/perf-options-walls",
    )
)


def _chain(index: int, n_strikes: int = 25) -> dict:
    strikes = [25000.0 + (i - n_strikes // 2) * 50.0 for i in range(n_strikes)]
    chain: dict[str, list[float]] = {}
    for strike in strikes:
        dist = abs(strike - 25000.0)
        ce_oi = 4_000_000.0 / (1 + dist / 300.0) - index * 100.0
        pe_oi = 3_500_000.0 / (1 + dist / 350.0) + index * 60.0
        ce_ltp = max(1.0, 400.0 - dist / 5.0)
        pe_ltp = max(1.0, 350.0 - dist / 5.0)
        chain[str(int(strike))] = [
            ce_ltp,
            pe_ltp,
            ce_oi,
            pe_oi,
            100000.0 + index * 100.0 + dist,
            90000.0 + index * 90.0 + dist,
        ]
    # Duplicate numeric strike (distinct key), malformed key and short cell:
    # _top's ordering/tie behaviour must stay identical under the memo cache.
    chain["25000.0"] = [410.0, 360.0, 3_999_000.0, 3_400_000.0, 7.0, 9.0]
    chain["bad-key"] = [1.0, 1.0, 700.0, 700.0, 1.0, 1.0]
    chain["short"] = [1.0, 1.0, 999.0]
    return chain


def _rows(n: int = 120) -> list[dict]:
    start = datetime(2026, 11, 17, 9, 15, 0)
    rows = []
    for i in range(n):
        ts = (start + timedelta(minutes=i)).isoformat() + "+05:30"
        rows.append({
            "t": ts,
            "spot": 24980.0 + 60.0 * i / max(1, n - 1),
            "max_pain": 25000.0 + 50.0 * (i // 30),
            "flip": 25100.0,
            "net_gex": 100.0,
            "atm_strike": 25000.0,
            "expiry": DATE_STR,
            "gex_degraded": False,
            "chain": _chain(i),
        })
    return rows


FULL_ROWS = _rows()
SHORT_ROWS = _rows(3)
NOW = datetime.fromisoformat(FULL_ROWS[-1]["t"]) + timedelta(minutes=1)
CONFIGS = {
    f"{tape}-w{w}-map{int(m)}": dict(
        rows=FULL_ROWS if tape == "full" else SHORT_ROWS,
        window_min=w,
        include_map=m,
    )
    for tape in ("full", "short")
    for w in (5, 15, 60)
    for m in (False, True)
}


def _compute(name: str) -> dict:
    cfg = CONFIGS[name]
    return ow.compute_wall_state(
        cfg["rows"],
        symbol="NIFTY",
        date_str=DATE_STR,
        expiry=DATE_STR,
        now=NOW,
        window_min=cfg["window_min"],
        top_n=3,
        include_map=cfg["include_map"],
    )


def run_payload() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    out = {name: json.dumps(_compute(name)) for name in CONFIGS}
    (ARTIFACT_DIR / "options_walls_payloads.json").write_text(
        json.dumps(out, indent=2, sort_keys=True) + "\n"
    )
    print(f"payloads written: {len(out)} configs -> {ARTIFACT_DIR}")


def run_counts() -> None:
    originals = (ow._epoch, ow._vol_delta, ow._top)
    counts = {"epoch": 0, "vol_delta": 0, "top_pass": 0}

    def epoch(value):
        counts["epoch"] += 1
        return originals[0](value)

    def vol_delta(rows, index, side, strike, minutes):
        counts["vol_delta"] += 1
        return originals[1](rows, index, side, strike, minutes)

    def top(chain, side, n):
        counts["top_pass"] += 1
        return originals[2](chain, side, n)

    ow._epoch, ow._vol_delta, ow._top = epoch, vol_delta, top
    try:
        _compute("full-w60-map1")
    finally:
        ow._epoch, ow._vol_delta, ow._top = originals
    print(json.dumps(counts, sort_keys=True))


def run_time() -> None:
    name = "full-w60-map1"
    for _ in range(5):
        _compute(name)
    samples = []
    for _ in range(20):
        started = time.perf_counter()
        _compute(name)
        samples.append((time.perf_counter() - started) * 1000.0)
    ordered = sorted(samples)
    p95 = ordered[math.ceil(0.95 * len(ordered)) - 1]
    print(json.dumps({
        "config": name,
        "reps": len(samples),
        "warmups": 5,
        "median_ms": round(statistics.median(samples), 4),
        "p95_ms": round(p95, 4),
        "min_ms": round(ordered[0], 4),
        "max_ms": round(ordered[-1], 4),
    }, sort_keys=True))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "payload"
    {"payload": run_payload, "counts": run_counts, "time": run_time}[mode]()
