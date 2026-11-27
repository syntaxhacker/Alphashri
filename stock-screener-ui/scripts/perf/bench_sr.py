"""Repeatable micro-benchmark and golden-output check for compute_sr_zones.

Inputs are deterministic seeded candles (no network). Each benchmark run does
5 warmups + 50 timed reps and reports median/p95/min in milliseconds using
``time.perf_counter_ns``. Run the script as several separate processes and take
the best-of-run median when the host is contended.

Examples:
    PYTHONPATH=. python scripts/perf/bench_sr.py --mode bench
    PYTHONPATH=. python scripts/perf/bench_sr.py --mode profile --bars 1000
    PYTHONPATH=. python scripts/perf/bench_sr.py --mode dump --out /tmp/sr_golden.json
    PYTHONPATH=. python scripts/perf/bench_sr.py --mode compare --golden /tmp/sr_golden.json
"""

from __future__ import annotations

import argparse
import cProfile
import io
import json
import pstats
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from chart_patterns.levels import compute_sr_zones  # noqa: E402

WARMUPS = 5
REPS = 50
SIZES = (400, 1000)
SEED = 20261127


def make_candles(n: int, seed: int = SEED):
    """Deterministic wire candles with recurring pivots so zones are exercised."""
    rng = np.random.default_rng(seed + n)
    close = 100.0 + np.cumsum(rng.normal(0.0, 0.35, n)) + 3.0 * np.sin(
        np.arange(n) / 11.0
    )
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) + rng.uniform(0.05, 0.55, n)
    low = np.minimum(open_, close) - rng.uniform(0.05, 0.55, n)
    stamps = pd.date_range("2025-01-01", periods=n, freq="15min")
    wire = [
        {
            "t": stamp.isoformat(),
            "o": float(o),
            "h": float(h),
            "l": float(low_),
            "c": float(c),
            "v": float(v),
        }
        for stamp, o, h, low_, c, v in zip(
            stamps, open_, high, low, close, rng.integers(100, 2000, n)
        )
    ]
    frame = pd.DataFrame(
        {
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": np.arange(n, dtype=float),
        },
        index=pd.Index([c["t"] for c in wire]),
    )
    return wire, frame


def _bench(fn, warmups: int, reps: int) -> dict:
    for _ in range(warmups):
        fn()
    samples = []
    for _ in range(reps):
        start = time.perf_counter_ns()
        fn()
        samples.append((time.perf_counter_ns() - start) / 1_000_000.0)
    return {
        "median_ms": round(float(np.median(samples)), 4),
        "p95_ms": round(float(np.percentile(samples, 95)), 4),
        "min_ms": round(float(min(samples)), 4),
        "reps": len(samples),
    }


def _cases(which: str):
    for n in SIZES:
        wire, frame = make_candles(n)
        if which in ("wire", "both"):
            yield f"wire-{n}", wire
        if which in ("frame", "both"):
            yield f"frame-{n}", frame


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("bench", "profile", "dump", "compare"),
                        default="bench")
    parser.add_argument("--input", choices=("wire", "frame", "both"), default="wire")
    parser.add_argument("--bars", type=int, default=1000)
    parser.add_argument("--warmups", type=int, default=WARMUPS)
    parser.add_argument("--reps", type=int, default=REPS)
    parser.add_argument("--out", type=Path, help="dump: destination JSON path")
    parser.add_argument("--golden", type=Path, help="compare: baseline JSON path")
    args = parser.parse_args()

    if args.mode == "bench":
        for name, candles in _cases(args.input):
            result = _bench(lambda: compute_sr_zones(candles, timeframe="15m"),
                            args.warmups, args.reps)
            print(json.dumps({"case": name, **result}))

    elif args.mode == "profile":
        _, frame = make_candles(args.bars)
        wire, _ = make_candles(args.bars)

        def run() -> None:
            for _ in range(20):
                compute_sr_zones(wire, timeframe="15m")

        profiler = cProfile.Profile()
        profiler.enable()
        run()
        profiler.disable()
        buf = io.StringIO()
        pstats.Stats(profiler, stream=buf).sort_stats("cumulative").print_stats(28)
        print(f"# profile: {args.bars} wire candles x 20 calls")
        print(buf.getvalue())

    elif args.mode == "dump":
        payload = {}
        for name, candles in _cases("both"):
            payload[name] = compute_sr_zones(candles, timeframe="15m")
        text = json.dumps(payload, sort_keys=True, indent=2)
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(text, encoding="utf-8")
            print(f"wrote {args.out}")
        else:
            print(text)

    elif args.mode == "compare":
        if args.golden is None:
            parser.error("compare requires --golden")
        baseline = json.loads(args.golden.read_text(encoding="utf-8"))
        current = {}
        for name, candles in _cases("both"):
            current[name] = compute_sr_zones(candles, timeframe="15m")
        ok = baseline == current
        for name in sorted(set(baseline) | set(current)):
            print(f"{name}: {'MATCH' if baseline.get(name) == current.get(name) else 'DIFF'}")
        print("PARITY:", "PASS" if ok else "FAIL")
        if not ok:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
