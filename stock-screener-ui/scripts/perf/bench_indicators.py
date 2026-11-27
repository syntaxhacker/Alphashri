#!/usr/bin/env python3
"""Deterministic, network-free benchmark + golden parity check for indicators.

Run from the UI root with the task venv::

    PYTHONPATH=. CI_MODE=1 <venv>/bin/python scripts/perf/bench_indicators.py
    PYTHONPATH=. CI_MODE=1 <venv>/bin/python scripts/perf/bench_indicators.py --profile
    PYTHONPATH=. CI_MODE=1 <venv>/bin/python scripts/perf/bench_indicators.py --golden <path>
    PYTHONPATH=. CI_MODE=1 <venv>/bin/python scripts/perf/bench_indicators.py --compare <path>

Three *separate processes* are expected for a before/after comparison; single
runs under CPU contention are not comparable. Each process does 5 warmups and
50 measured reps per timeframe, timed with ``time.perf_counter_ns``.
"""

from __future__ import annotations

import argparse
import cProfile
import json
import math
import os
import pstats
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

UI_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(UI_ROOT))

from chart_patterns.indicators import compute_indicators  # noqa: E402
from chart_patterns.timeframes import TIMEFRAMES  # noqa: E402

IST = "Asia/Kolkata"
DISABLED_TIMEFRAMES = {"3m", "2h"}
BARS: dict[str, int] = {
    "1m": 500,
    "5m": 500,
    "10m": 500,
    "15m": 500,
    "30m": 500,
    "1h": 500,
    "3h": 500,
    "4h": 500,
    "1D": 500,
    "1W": 260,
    "1M": 120,
}
SEED = 20261127
WARMUP_BARS = 120
PAYLOAD_KEYS = ("aligned", "timeframe", "session", "partial_last", "series", "crosses")


def artifact_root() -> Path:
    override = os.environ.get("CHART_PERF_ARTIFACT_DIR")
    if override:
        return Path(override).expanduser()
    if os.environ.get("CODESPACES"):
        return Path("/workspaces/test-rag/.agent-artifacts/chart-perf")
    return Path("/tmp/opencode/chart-perf")


def enabled_timeframes() -> list[str]:
    return [tf.id for tf in TIMEFRAMES if tf.id not in DISABLED_TIMEFRAMES]


def _intraday_times(minutes: int, bars: int) -> list[str]:
    """Exchange-local bars inside 09:15-15:30 sessions, no network."""
    out: list[str] = []
    stamp = pd.Timestamp("2026-01-05T09:15:00", tz=IST)
    market_close = 15 * 60 + 30
    while len(out) < bars:
        minute = stamp.hour * 60 + stamp.minute
        if minute + minutes > market_close:
            stamp = stamp.normalize() + pd.Timedelta(days=1)
            while stamp.weekday() >= 5:
                stamp += pd.Timedelta(days=1)
            stamp += pd.Timedelta(hours=9, minutes=15)
            continue
        out.append(stamp.isoformat())
        stamp += pd.Timedelta(minutes=minutes)
    return out


def _daily_times(tf_id: str, bars: int) -> list[str]:
    freq = {"1D": "D", "1W": "W-FRI", "1M": "ME"}[tf_id]
    index = pd.date_range("2020-01-01", periods=bars, freq=freq, tz=IST)
    return [stamp.isoformat() for stamp in index]


def make_candles(tf_id: str, bars: int) -> list[dict]:
    """Seeded OHLCV wire candles: one deterministic frame per timeframe."""
    rng = np.random.default_rng(SEED + int(bars) + len(tf_id))
    steps = rng.normal(0.0, 0.004, bars).cumsum()
    close = 100.0 * np.exp(steps)
    spread = 0.002 + 0.003 * rng.random(bars)
    opens = close * (1.0 + rng.normal(0.0, 0.001, bars))
    highs = np.maximum(opens, close) * (1.0 + spread)
    lows = np.minimum(opens, close) * (1.0 - spread)
    volumes = np.round(500.0 + 2500.0 * rng.random(bars), 3)
    minutes = next(int(tf.minutes) for tf in TIMEFRAMES if tf.id == tf_id)
    times = (
        _intraday_times(minutes, bars)
        if minutes < 1440
        else _daily_times(tf_id, bars)
    )
    candles = [
        {
            "t": t,
            "o": float(o),
            "h": float(h),
            "l": float(l),
            "c": float(c),
            "v": float(v),
        }
        for t, o, h, l, c, v in zip(times, opens, highs, lows, close, volumes)
    ]
    # A zero-volume bar and a partial tail are realistic and exercise both
    # VWAP carry-forward and cross suppression without changing determinism.
    candles[bars // 3]["v"] = 0.0
    if tf_id == "5m":
        candles[-1]["is_partial"] = True
    return candles


def cases() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for tf_id in enabled_timeframes():
        use_warmup = tf_id in {"1m", "5m", "15m", "1h"}
        bars = BARS[tf_id] + (WARMUP_BARS if use_warmup else 0)
        full = make_candles(tf_id, bars)
        call: dict[str, Any] = {
            "candles": full[WARMUP_BARS:] if use_warmup else full,
            "timeframe": tf_id,
            "session": IST,
            "partial_last": None,
        }
        if use_warmup:
            call["warmup"] = full[:WARMUP_BARS]
        out[tf_id] = call
    return out


def _compute(case: dict[str, Any]) -> dict:
    return compute_indicators(**case)


def _percentile(samples: list[float], fraction: float) -> float:
    ordered = sorted(samples)
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def _summary(samples_ns: list[int]) -> dict[str, float]:
    ms = [value / 1e6 for value in samples_ns]
    return {
        "median_ms": round(float(np.median(ms)), 3),
        "p95_ms": round(_percentile(ms, 0.95), 3),
        "min_ms": round(min(ms), 3),
    }


def run_bench(reps: int, warmups: int) -> dict[str, Any]:
    all_cases = cases()
    per_tf: dict[str, dict[str, float]] = {}
    totals: list[int] = []
    for tf_id, case in all_cases.items():
        for _ in range(warmups):
            _compute(case)
        samples: list[int] = []
        for _ in range(reps):
            started = time.perf_counter_ns()
            _compute(case)
            samples.append(time.perf_counter_ns() - started)
        per_tf[tf_id] = _summary(samples)
        totals.append(sum(samples))
    return {
        "per_tf": per_tf,
        "total": _summary(totals),
        "bars": {tf: BARS[tf] for tf in all_cases},
        "reps": reps,
        "warmups": warmups,
    }


def run_profile(reps: int) -> None:
    all_cases = cases()
    for tf_id, case in all_cases.items():
        _compute(case)
    profiler = cProfile.Profile()
    profiler.enable()
    for _ in range(reps):
        for case in all_cases.values():
            _compute(case)
    profiler.disable()
    print(f"cProfile cumulative top 30 ({reps} full 11-TF passes)")
    pstats.Stats(profiler).strip_dirs().sort_stats("cumulative").print_stats(30)


def _golden_text(payloads: dict[str, dict]) -> str:
    return json.dumps(payloads, sort_keys=True, separators=(",", ":"), allow_nan=False)


def write_golden(path: Path) -> None:
    payloads = {tf: _compute(case) for tf, case in cases().items()}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_golden_text(payloads) + "\n", encoding="utf-8")
    print(f"wrote golden {path} ({len(payloads)} timeframes)")


def compare_golden(path: Path) -> int:
    expected = json.loads(path.read_text(encoding="utf-8"))
    actual = {tf: _compute(case) for tf, case in cases().items()}
    failures = 0
    for tf_id in sorted(expected):
        want = expected[tf_id]
        got = actual.get(tf_id)
        if got is None:
            print(f"FAIL {tf_id}: missing")
            failures += 1
            continue
        bad = [key for key in PAYLOAD_KEYS if want.get(key) != got.get(key)]
        exact = json.dumps(want, sort_keys=True, separators=(",", ":")) == json.dumps(
            got, sort_keys=True, separators=(",", ":")
        )
        status = "OK" if not bad and exact else "FAIL"
        print(
            f"{status} {tf_id}: keys={PAYLOAD_KEYS} raw_byte_equal={exact} "
            f"mismatched_keys={bad} series={len(got['series'])} "
            f"crosses={len(got['crosses'])}"
        )
        failures += bool(bad) or not exact
    if sorted(expected) != sorted(actual):
        print(f"FAIL timeframe set: {sorted(expected)} != {sorted(actual)}")
        failures += 1
    print(f"parity: {'PASS' if not failures else 'FAIL'} ({len(expected)} timeframes)")
    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reps", type=int, default=50)
    parser.add_argument("--warmups", type=int, default=5)
    parser.add_argument("--profile", action="store_true")
    parser.add_argument("--golden", type=Path)
    parser.add_argument("--compare", type=Path)
    args = parser.parse_args(argv)
    if args.golden:
        write_golden(args.golden)
        return 0
    if args.compare:
        return compare_golden(args.compare)
    if args.profile:
        run_profile(args.reps)
        return 0
    print(f"benchmark: {len(enabled_timeframes())} TFs, {args.warmups} warmups, {args.reps} reps")
    result = run_bench(args.reps, args.warmups)
    for tf_id in enabled_timeframes():
        stats = result["per_tf"][tf_id]
        print(
            f"  {tf_id:<3} {result['bars'][tf_id]:>4} bars  "
            f"median {stats['median_ms']:>8.3f} ms  "
            f"p95 {stats['p95_ms']:>8.3f} ms  min {stats['min_ms']:>8.3f} ms"
        )
    total = result["total"]
    print(
        f"  TOTAL median {total['median_ms']:.3f} ms  "
        f"p95 {total['p95_ms']:.3f} ms  min {total['min_ms']:.3f} ms"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
