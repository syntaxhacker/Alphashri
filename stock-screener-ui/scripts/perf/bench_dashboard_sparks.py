#!/usr/bin/env python3
"""Deterministic fan-out profile for the dashboard spark pool.

No network, no disk cache: ``chart_patterns.candles.fetch_for_timeframe`` is
replaced with a stub that sleeps a fixed number of milliseconds and returns a
fixed 40-bar frame. The stub releases the GIL, so the measurement isolates the
thread-pool wait from per-symbol fetch work.

Run from ``stock-screener-ui`` with the task venv::

    PYTHONPATH=. CI_MODE=1 <venv>/bin/python \
        scripts/perf/bench_dashboard_sparks.py --out <artifacts>/run1.json

``--snapshot`` writes the full ``_build_payload`` for a deterministic fixture;
``--compare`` exits non-zero unless a freshly built payload is byte-identical
to that snapshot. Timestamps are frozen in both modes.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from api.screener_api import dashboard

LATENCY_MS = 20.0
SYMBOL_COUNT = 60  # dashboard.SPARK_MAX_SYMBOLS
WORKER_COUNTS = (6, 12, 16)
WARMUP = 5
REPS = 20
FAIL_SYMBOLS = frozenset({"SYM003", "SYM017"})


def _stub(symbol: str, timeframe: str, *args: Any, **kwargs: Any) -> pd.DataFrame:
    time.sleep(LATENCY_MS / 1000.0)
    if symbol in FAIL_SYMBOLS:
        raise RuntimeError("no candles for stub symbol")
    base = float(sum(ord(c) for c in symbol) % 50 + 50)
    return pd.DataFrame({"close": [base + i * 0.25 for i in range(40)]})


def _records(n: int = 80) -> list[dict]:
    """Deterministic TV-shaped records; >SPARK_MAX_SYMBOLS to exercise the cap."""
    out: list[dict] = []
    for i in range(n):
        close = 100.0 + i
        out.append(
            {
                "symbol": f"SYM{i:03d}",
                "name": f"Name {i}",
                "close": close,
                "change": ((i % 17) - 8) * 1.5,
                "volume": 1e6 + i * 1e4,
                "avgvol": 2e5 + i * 1e3,
                "relvol": float(i % 9),
                "logoid": f"logo-{i}" if i % 5 else None,
                "gap": ((i % 7) - 3) * 1.2,
                "high52": close + 2.0,
                "low52": close - 2.0,
                "atr": 1.0 + (i % 3),
                "rsi": 40.0 + float(i % 30),
                "vwap": close + 0.5,
                "market_cap": 6e9 + i * 1e8,
                "high": close + 5.0,
                "low": close - 2.0,
                "turnover": 1e9 + i * 1e7,
            }
        )
    return out


def _freeze_clock() -> None:
    class _FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 27, 10, 15, 0, tzinfo=tz)

    dashboard.datetime = _FixedDateTime  # type: ignore[assignment]


def _payload() -> dict:
    _freeze_clock()
    return dashboard._build_payload("nifty500", _records(), 8)


def _bench(fn: Callable[[], dict[str, list[float]]]) -> dict[str, float]:
    for _ in range(WARMUP):
        fn()
    samples: list[float] = []
    for _ in range(REPS):
        started = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - started) * 1000.0)
    ordered = sorted(samples)
    return {
        "median_ms": round(statistics.median(samples), 3),
        "p95_ms": round(ordered[int(0.95 * len(ordered)) - 1], 3),
        "min_ms": round(ordered[0], 3),
        "max_ms": round(ordered[-1], 3),
    }


def main() -> None:
    global LATENCY_MS, WARMUP, REPS
    parser = argparse.ArgumentParser()
    parser.add_argument("--latency-ms", type=float, default=LATENCY_MS)
    parser.add_argument("--workers", type=int, nargs="*", default=list(WORKER_COUNTS))
    parser.add_argument("--warmup", type=int, default=WARMUP)
    parser.add_argument("--reps", type=int, default=REPS)
    parser.add_argument("--out", type=Path, help="write this run's profile JSON here")
    parser.add_argument("--snapshot", type=Path, help="write deterministic payload here")
    parser.add_argument("--compare", type=Path, help="assert payload equals this snapshot")
    args = parser.parse_args()

    LATENCY_MS, WARMUP, REPS = args.latency_ms, args.warmup, args.reps

    import chart_patterns.candles as candles

    candles.fetch_for_timeframe = _stub  # _fetch_sparks imports it at call time

    if args.snapshot is not None:
        args.snapshot.parent.mkdir(parents=True, exist_ok=True)
        args.snapshot.write_text(
            json.dumps(_payload(), indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(f"snapshot written: {args.snapshot}")
    if args.compare is not None:
        expected_text = args.compare.read_text(encoding="utf-8")
        actual_text = json.dumps(_payload(), indent=2, ensure_ascii=False)
        if actual_text != expected_text:
            raise SystemExit("PAYLOAD PARITY FAILED: serialized bytes differ")
        print("payload parity: PASS (byte-identical JSON, field order included)")

    symbols = [f"SYM{i:03d}" for i in range(SYMBOL_COUNT)]
    original_workers = dashboard.SPARK_WORKERS
    results: dict[str, dict[str, float]] = {}
    profiles: dict[str, dict[str, Any]] = {}
    try:
        for workers in args.workers:
            dashboard.SPARK_WORKERS = workers
            outcome: dict[str, Any] = {}
            result = _bench(lambda: dashboard._fetch_sparks(symbols))
            ideal = math.ceil(len(symbols) / workers) * LATENCY_MS
            result["ideal_ms"] = round(ideal, 3)
            result["actual_over_ideal"] = round(result["median_ms"] / ideal, 3)
            results[str(workers)] = result
            outcome["timing"] = result
            outcome["spark_keys"] = list(dashboard._fetch_sparks(symbols))
            profiles[str(workers)] = outcome
    finally:
        dashboard.SPARK_WORKERS = original_workers

    baseline_keys = profiles[str(args.workers[0])]["spark_keys"]
    parity = all(p["spark_keys"] == baseline_keys for p in profiles.values())
    report = {
        "latency_ms": LATENCY_MS,
        "symbols": len(symbols),
        "warmup": WARMUP,
        "reps": REPS,
        "serial_ideal_ms": round(len(symbols) * LATENCY_MS, 3),
        "spark_key_parity_across_workers": parity,
        "results": results,
    }
    text = json.dumps(report, indent=2, sort_keys=False)
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
