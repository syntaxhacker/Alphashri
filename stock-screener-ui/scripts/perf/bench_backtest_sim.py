#!/usr/bin/env python3
"""Deterministic 22k-bar parity capture and micro-benchmark for the sim wrangler.

Run from ``stock-screener-ui`` with a venv that has pandas/numpy::

    PYTHONPATH=. <venv>/bin/python scripts/perf/bench_backtest_sim.py capture <file.json>
    PYTHONPATH=. <venv>/bin/python scripts/perf/bench_backtest_sim.py compare <file.json>
    PYTHONPATH=. <venv>/bin/python scripts/perf/bench_backtest_sim.py bench <file.json>
    PYTHONPATH=. <venv>/bin/python scripts/perf/bench_backtest_sim.py ab <file.json>

``capture`` records every field of every bar delivered to ``on_bar`` (bit-exact
float hex plus formatted strings) and a set of edge-case outcomes. ``compare``
repeats the capture and diffs it field by field against a saved baseline.
``bench`` times ``BarDataWrangler.process`` only: 5 warmups and 50 reps per
run, three runs, median/p95 per run and best-of-three by median. ``ab`` runs
the verbatim pre-change loop and the current implementation interleaved in one
interpreter (after a field-by-field equality check) for a load-matched ratio.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import statistics
import sys
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

from backtest.sim.engine import Bar, BacktestEngine, BarDataWrangler, Price, Quantity

BARS = 22_000
WARMUP = 5
REPS = 50
RUNS = 3
BAR_TYPE = "TEST.SIMULATED-1-MINUTE-LAST-EXTERNAL"
COLUMNS = ("open", "high", "low", "close", "volume")


def build_frame(n: int = BARS) -> pd.DataFrame:
    """Seeded 1-minute UTC frame: float OHLC + int64 volume, as wrangle_bars builds."""
    rng = np.random.default_rng(20261127)
    close = np.round(100.0 + np.cumsum(rng.normal(0.0, 0.05, n)), 2)
    index = pd.date_range("2026-01-05T03:45:00Z", periods=n, freq="1min", tz="UTC")
    return pd.DataFrame(
        {
            "open": close - 0.25,
            "high": close + 0.75,
            "low": close - 0.75,
            "close": close,
            "volume": (1000 + (np.arange(n) % 997)).astype(np.int64),
        },
        index=index,
    )


class _Instrument:
    instrument_id = "TEST.SIMULATED"


def _wrangler() -> BarDataWrangler:
    return BarDataWrangler(bar_type=BAR_TYPE, instrument=_Instrument())


def _record(bar: Any) -> dict[str, Any]:
    """Bit-exact projection: float hex + the shim's own formatted strings."""
    out: dict[str, Any] = {
        "ts_event": int(bar.ts_event),
        "ts_init": int(bar.ts_init),
        "bar_type": str(bar.bar_type),
        "instrument_id": str(bar.instrument_id),
    }
    for name in ("open", "high", "low", "close", "volume"):
        value = getattr(bar, name)
        out[name] = float(value).hex()
        out[f"{name}_str"] = str(value)
    return out


class _Recorder:
    """Minimal strategy: the engine calls on_start/on_bar/on_stop in frame order."""

    def __init__(self) -> None:
        self.events: list[Any] = []

    def on_start(self) -> None:
        self.events.append(["start"])

    def on_bar(self, bar: Any) -> None:
        self.events.append(["bar", _record(bar)])

    def on_stop(self) -> None:
        self.events.append(["stop"])


def _edge(name: str, fn: Callable[[], Any]) -> dict[str, Any]:
    try:
        value = fn()
        if isinstance(value, list):
            result: Any = {"bars": len(value), "first": _record(value[0]) if value else None}
        else:
            result = _record(value)
        return {"name": name, "ok": True, "value": result}
    except BaseException as exc:  # capture the exception contract, not just success
        return {"name": name, "ok": False, "error": repr(exc)}


def _edges() -> list[dict[str, Any]]:
    small = build_frame(4)
    missing = small.drop(columns=["volume"])
    nan_close = small.copy()
    nan_close["close"] = np.nan
    tz_naive = small.copy()
    tz_naive.index = tz_naive.index.tz_localize(None)
    huge_volume = small.copy()
    huge_volume["sym"] = "X"  # object column keeps int64 exact in df.iloc[i]
    huge_volume["volume"] = np.array([2**60 + 3] * 4, dtype=np.int64)
    ranged = small.copy()
    ranged.index = pd.RangeIndex(10, 14)
    empty = small.iloc[:0]
    dupes = pd.concat([small, small["close"]], axis=1)

    return [
        _edge("datetime_index_tz_aware", lambda: _wrangler().process(small)[0]),
        _edge("datetime_index_tz_naive", lambda: _wrangler().process(tz_naive)[0]),
        _edge("nan_close", lambda: _wrangler().process(nan_close)[0]),
        _edge("huge_volume_object_frame", lambda: _wrangler().process(huge_volume)[0]),
        _edge("range_index", lambda: _wrangler().process(ranged)[0]),
        _edge("empty_frame", lambda: _wrangler().process(empty)),
        _edge("missing_volume_column", lambda: _wrangler().process(missing)),
        _edge("duplicate_columns", lambda: _wrangler().process(dupes)[0]),
    ]


def capture() -> dict[str, Any]:
    frame = build_frame()
    bars = _wrangler().process(frame)
    recorder = _Recorder()
    engine = BacktestEngine()
    engine.add_data(bars)
    engine.add_strategy(recorder)
    engine.run()
    engine.dispose()
    return {
        "bars": len(bars),
        "on_bar_calls": sum(1 for event in recorder.events if event[0] == "bar"),
        "events": recorder.events,
        "edges": _edges(),
    }


def _digest(payload: dict[str, Any]) -> str:
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()


def _diff(before: Any, after: Any, path: str, diffs: list[str]) -> None:
    if len(diffs) >= 20:
        return
    if isinstance(before, dict) and isinstance(after, dict):
        for key in sorted(set(before) | set(after)):
            if key not in before or key not in after:
                diffs.append(f"{path}.{key}: present only in {'before' if key in before else 'after'}")
            else:
                _diff(before[key], after[key], f"{path}.{key}", diffs)
        return
    if isinstance(before, list) and isinstance(after, list):
        if len(before) != len(after):
            diffs.append(f"{path}: length before={len(before)} after={len(after)}")
            return
        for i, (left, right) in enumerate(zip(before, after)):
            _diff(left, right, f"{path}[{i}]", diffs)
            if len(diffs) >= 20:
                return
        return
    if isinstance(before, float) and isinstance(after, float):
        if math.isnan(before) and math.isnan(after):
            return
    if before != after:
        diffs.append(f"{path}: before={before!r} after={after!r}")


def compare(baseline_path: Path) -> int:
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    fresh = capture()
    diffs: list[str] = []
    _diff(baseline, fresh, "", diffs)
    print(f"parity digest before={_digest(baseline)}")
    print(f"parity digest after ={_digest(fresh)}")
    print(
        f"bars={fresh['bars']} on_bar_calls={fresh['on_bar_calls']} "
        f"edges={len(fresh['edges'])} diffs={len(diffs)}"
    )
    for line in diffs:
        print(f"  {line}")
    return 0 if not diffs else 1


def _legacy_process(wrangler: BarDataWrangler, df: pd.DataFrame) -> list[Bar]:
    """Verbatim pre-change loop, used only for the interleaved A/B measurement."""
    bars: list[Bar] = []
    columns = ["open", "high", "low", "close", "volume"]
    for i in range(len(df)):
        index_value = df.index[i]
        ts_event = int(index_value.value) if hasattr(index_value, "value") else int(index_value)
        row = df.iloc[i]
        bars.append(
            Bar(
                bar_type=wrangler.bar_type,
                instrument_id=getattr(wrangler.instrument, "instrument_id", None),
                open=Price(float(row[columns[0]])),
                high=Price(float(row[columns[1]])),
                low=Price(float(row[columns[2]])),
                close=Price(float(row[columns[3]])),
                volume=Quantity.from_str(str(int(row[columns[4]]))),
                ts_event=ts_event,
                ts_init=ts_event,
            )
        )
    return bars


def _one_run(fn: Callable[[], Any]) -> dict[str, float]:
    for _ in range(WARMUP):
        fn()
    samples: list[float] = []
    for _ in range(REPS):
        started = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - started) * 1000.0)
    ordered = sorted(samples)
    return {
        "median_ms": statistics.median(samples),
        "p95_ms": ordered[int(0.95 * len(ordered)) - 1],
        "min_ms": ordered[0],
    }


def bench(out_path: Path) -> None:
    frame = build_frame()
    wrangler = _wrangler()
    load_before = Path("/proc/loadavg").read_text().strip()
    runs = [_one_run(lambda: wrangler.process(frame)) for _ in range(RUNS)]
    load_after = Path("/proc/loadavg").read_text().strip()
    best = min(runs, key=lambda item: item["median_ms"])
    payload = {
        "bars": BARS,
        "warmup": WARMUP,
        "reps": REPS,
        "runs": runs,
        "best_of_3": best,
        "loadavg_before": load_before,
        "loadavg_after": load_after,
        "ncpu": os.cpu_count(),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    for i, run in enumerate(runs, 1):
        print(
            f"run {i}: median={run['median_ms']:.3f} ms "
            f"p95={run['p95_ms']:.3f} ms min={run['min_ms']:.3f} ms"
        )
    print(
        f"best of {RUNS}: median={best['median_ms']:.3f} ms p95={best['p95_ms']:.3f} ms "
        f"| loadavg {load_before} -> {load_after} | ncpu={payload['ncpu']}"
    )


def ab_bench(out_path: Path) -> None:
    """Contention-matched A/B: legacy and current process in one interpreter."""
    frame = build_frame()
    wrangler = _wrangler()
    legacy = [_record(bar) for bar in _legacy_process(wrangler, frame)]
    current = [_record(bar) for bar in wrangler.process(frame)]
    diffs: list[str] = []
    _diff(legacy, current, "bars", diffs)
    if diffs:
        raise AssertionError("legacy/current mismatch: " + "; ".join(diffs[:5]))

    load_before = Path("/proc/loadavg").read_text().strip()
    results: dict[str, list[dict[str, float]]] = {"legacy": [], "current": []}
    for run in range(RUNS):
        order = ("legacy", "current") if run % 2 == 0 else ("current", "legacy")
        for name in order:
            fn = (
                (lambda: _legacy_process(wrangler, frame))
                if name == "legacy"
                else (lambda: wrangler.process(frame))
            )
            results[name].append(_one_run(fn))
    load_after = Path("/proc/loadavg").read_text().strip()
    best = {name: min(runs, key=lambda item: item["median_ms"]) for name, runs in results.items()}
    ratio = best["legacy"]["median_ms"] / best["current"]["median_ms"]
    payload = {
        "bars": BARS,
        "warmup": WARMUP,
        "reps": REPS,
        "results": results,
        "best_of_3": best,
        "best_median_ratio": ratio,
        "loadavg_before": load_before,
        "loadavg_after": load_after,
        "ncpu": os.cpu_count(),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    for name in ("legacy", "current"):
        for i, run in enumerate(results[name], 1):
            print(
                f"{name} run {i}: median={run['median_ms']:.3f} ms "
                f"p95={run['p95_ms']:.3f} ms min={run['min_ms']:.3f} ms"
            )
        b = best[name]
        print(f"{name} best of {RUNS}: median={b['median_ms']:.3f} ms p95={b['p95_ms']:.3f} ms")
    print(
        f"best-median ratio legacy/current={ratio:.2f}x "
        f"| loadavg {load_before} -> {load_after} | ncpu={payload['ncpu']}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    for mode in ("capture", "compare", "bench", "ab"):
        sub.add_parser(mode).add_argument("path", type=Path)
    args = parser.parse_args()
    if args.mode == "capture":
        args.path.parent.mkdir(parents=True, exist_ok=True)
        payload = capture()
        args.path.write_text(json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8")
        print(f"captured bars={payload['bars']} on_bar_calls={payload['on_bar_calls']} -> {args.path}")
        return 0
    if args.mode == "compare":
        return compare(args.path)
    if args.mode == "ab":
        ab_bench(args.path)
        return 0
    bench(args.path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
