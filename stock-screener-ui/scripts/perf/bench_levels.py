#!/usr/bin/env python3
"""Deterministic LevelBook micro-benchmark (no network, no file writes).

Run from the project root with the task venv::

    PYTHONPATH=. CI_MODE=1 <venv>/bin/python scripts/perf/bench_levels.py

Each bar count is warmed up, then timed for 50 repetitions of:

* ``chart_patterns.levels.compute_sr_zones`` — the untouched raw detector.
* ``market_levels.build_level_book`` — all four adapters plus fusion.

Median and p95 wall-clock milliseconds are printed to stdout only.
"""

from __future__ import annotations

import statistics
import time
from datetime import date, timedelta

import numpy as np

from api.options_levels import build_levels  # warm the lazy options import
from chart_patterns.levels import compute_sr_zones
from market_levels import build_level_book
# Importing the adapters registers them; the service would do this lazily too,
# but doing it here keeps registration independent of timer order.
from market_levels.detectors import (  # noqa: F401
    gex,
    pivot,
    price_action,
    walls,
)

SYMBOL = "NIFTY"
TIMEFRAME = "1D"
AS_OF = "2026-01-01"
SPOT = 22962.6
BAR_COUNTS = (400, 1000)
WARMUP = 5
REPS = 50

PIVOT_HLC = {
    "high": 23100.0,
    "low": 22750.0,
    "close": 22962.6,
    "pivot_type": "classic",
}
OPTION_ROWS = [
    {"strike": 22500.0, "ce_oi": 100_000, "pe_oi": 1_000_000,
     "ce_gamma": 0.0001, "pe_gamma": 0.002},
    {"strike": 22700.0, "ce_oi": 300_000, "pe_oi": 500_000,
     "ce_gamma": 0.0004, "pe_gamma": 0.0008},
    {"strike": 22900.0, "ce_oi": 900_000, "pe_oi": 200_000,
     "ce_gamma": 0.0009, "pe_gamma": 0.0005},
    {"strike": 22950.0, "ce_oi": 1_500_000, "pe_oi": 700_000,
     "ce_gamma": 0.0006, "pe_gamma": 0.0006},
    {"strike": 23000.0, "ce_oi": 1_100_000, "pe_oi": 1_300_000,
     "ce_gamma": 0.0005, "pe_gamma": 0.0009},
    {"strike": 23200.0, "ce_oi": 800_000, "pe_oi": 400_000,
     "ce_gamma": 0.001, "pe_gamma": 0.0004},
]


def _candles(n: int) -> list[dict]:
    """Seeded mean-reverting closes: deterministic, finite, no I/O."""
    rng = np.random.default_rng(20261127)
    price = 22900.0
    closes: list[float] = []
    for _ in range(n):
        price += rng.normal(0.0, 8.0) + (22900.0 - price) * 0.08
        closes.append(float(price))
    start = date(2025, 1, 1)
    return [
        {
            "t": (start + timedelta(days=i)).isoformat(),
            "o": close,
            "h": close + 4.0,
            "l": close - 4.0,
            "c": close,
            "v": 1000.0,
        }
        for i, close in enumerate(closes)
    ]


def _bench(fn) -> tuple[float, float]:
    """Return (median_ms, p95_ms) over REPS timed calls."""
    samples: list[float] = []
    for _ in range(REPS):
        started = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - started) * 1000.0)
    ordered = sorted(samples)
    # Nearest-rank p95 over 50 samples (the 48th fastest / 3rd slowest).
    return statistics.median(samples), ordered[int(0.95 * len(ordered)) - 1]


def main() -> None:
    build_levels(OPTION_ROWS, SPOT)  # keep lazy imports outside the timer
    print(f"levels bench | warmup={WARMUP} reps={REPS} | no network, no writes")
    print(f"{'bars':>5} | {'function':<18} | {'median ms':>10} | {'p95 ms':>9}")
    print("-" * 53)
    for bar_count in BAR_COUNTS:
        candles = _candles(bar_count)

        def raw() -> None:
            compute_sr_zones(candles, timeframe=TIMEFRAME)

        def book() -> None:
            build_level_book(
                SYMBOL, TIMEFRAME, AS_OF,
                candles=candles,
                pivot_hlc=PIVOT_HLC,
                option_rows=OPTION_ROWS,
                spot=SPOT,
            )

        for name, fn in (("compute_sr_zones", raw), ("build_level_book", book)):
            for _ in range(WARMUP):
                fn()
            median, p95 = _bench(fn)
            print(f"{bar_count:>5} | {name:<18} | {median:>10.3f} | {p95:>9.3f}")


if __name__ == "__main__":
    main()
