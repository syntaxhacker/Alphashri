"""Deterministic parity capture + payload benchmark for backtest chart data.

Usage (from stock-screener-ui):
  python scripts/perf/bench_backtest_chart.py capture
  python scripts/perf/bench_backtest_chart.py compare
  python scripts/perf/bench_backtest_chart.py bench

Artifacts live outside the repo so the worktree stays clean.
"""

import argparse
import hashlib
import os
import pickle
import statistics
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import config  # noqa: E402
from backtest import chart_data  # noqa: E402

INTRADAY_BARS = 22_000
SESSIONS = 92
BARS_PER_SESSION = 240


def artifact_dir() -> Path:
    override = os.environ.get("CHART_PERF_ARTIFACT_DIR")
    if override:
        return Path(override)
    if os.environ.get("CODESPACES") == "true":
        return Path("/workspaces/test-rag/.agent-artifacts/perf-backtest-chart")
    return Path("/tmp/opencode/perf-backtest-chart")


def intraday_fixture():
    """Frozen 22k-bar UTC-indexed intraday frame (IST session times)."""
    sessions = pd.bdate_range("2024-01-01", periods=SESSIONS)
    chunks = []
    for day in sessions:
        start = pd.Timestamp(day.date()) + pd.Timedelta(hours=9, minutes=15)
        chunks.append(pd.date_range(start, periods=BARS_PER_SESSION, freq="min", tz=config.IST).tz_convert("UTC"))
    index = chunks[0].append(chunks[1:])[:INTRADAY_BARS]

    n = len(index)
    i = np.arange(n, dtype=np.float64)
    base = 100.0 + i * 0.001 + np.sin(i / 37.0) * 1.5
    frame = pd.DataFrame(
        {
            "open": np.round(base, 4),
            "high": np.round(base + 0.35 + (i % 7) * 0.01, 4),
            "low": np.round(base - 0.30 - (i % 5) * 0.01, 4),
            "close": np.round(base + 0.05 * np.cos(i / 11.0), 4),
            "volume": (1000 + i * 7).astype(np.int64) % 5000 + 1000,
        },
        index=index,
    )
    return frame


def daily_fixture():
    """Frozen daily-ish frame with repeated dates and repeated timestamps."""
    times = []
    for day in pd.bdate_range("2024-03-01", periods=8):
        for minute in (555, 570, 585, 600, 615, 630, 870, 885, 900):
            stamp = pd.Timestamp(day.date()) + pd.Timedelta(minutes=minute)
            times.extend([stamp, stamp])  # duplicate-date + duplicate-time
    index = pd.DatetimeIndex(times)  # naive on purpose
    n = len(index)
    i = np.arange(n, dtype=np.float64)
    return pd.DataFrame(
        {
            "open": np.round(200.0 + i * 0.25, 4),
            "high": np.round(201.0 + i * 0.25, 4),
            "low": np.round(199.0 + i * 0.25, 4),
            "close": np.round(200.5 + i * 0.25, 4),
            "volume": (500 + i * 3).astype(np.int64),
        },
        index=index,
    )


def trades_for(candles, count=180):
    """Exact hits, sub-minute misses, out-of-range and unknown dates."""
    reasons = ["TP", "SL", "EOD", "TRAILING_STOP", "MAX_HOLDING", "NEW_52W_HIGH"]
    trades = []
    step = max(1, len(candles) // count)
    for n in range(count):
        exact = candles[min(len(candles) - 1, n * step)]
        stamp = datetime.fromisoformat(exact["time"])
        mode = n % 4
        if mode == 0:
            entry = exact["time"]  # exact candle_time_map hit
        elif mode == 1:
            entry = (stamp + timedelta(seconds=30)).isoformat()  # last-candle-on-date miss
        elif mode == 2:
            entry = (stamp + timedelta(seconds=90)).isoformat()  # often next candle
        else:
            entry = (stamp - timedelta(days=400)).isoformat()  # no such date
        exit_stamp = datetime.fromisoformat(entry) + timedelta(minutes=15)
        trades.append(
            {
                "entry_price": 100.0 + n,
                "exit_price": 101.0 + n,
                "entry_time": entry,
                "exit_time": exit_stamp.isoformat(),
                "date": entry[:10],
                "quantity": 10 + n,
                "gross_pnl": 10.0,
                "trading_costs": 1.0,
                "net_pnl": 9.0,
                "net_pnl_pct": 0.9,
                "exit_reason": reasons[n % len(reasons)],
            }
        )
    return trades


def capture_one(frame, trade_count):
    candles = chart_data.format_candle_data(frame)
    trades = trades_for(candles, trade_count)
    chart = chart_data.build_chart_data_for_symbol("TEST", frame, trades, or_minutes=45)
    series = chart_data.build_echarts_series(chart)
    return {
        "candles": candles,
        "markers": chart["trades"],
        "series": series,
    }


def digest(obj) -> str:
    return hashlib.sha256(pickle.dumps(obj, protocol=4)).hexdigest()


def capture(path: Path):
    payload = {
        "intraday": capture_one(intraday_fixture(), 180),
        "daily": capture_one(daily_fixture(), 40),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    blob = pickle.dumps(payload, protocol=4)
    path.write_bytes(blob)
    print(f"captured {path} ({len(blob)} bytes)")
    for name, section in payload.items():
        for key, value in section.items():
            print(f"  {name}.{key}: {digest(value)} ({len(value) if isinstance(value, (list, dict)) else '-'})")


def compare(path: Path):
    baseline = pickle.loads(path.read_bytes())
    current = {
        "intraday": capture_one(intraday_fixture(), 180),
        "daily": capture_one(daily_fixture(), 40),
    }
    assert set(baseline) == set(current), "fixture set changed"
    for name in baseline:
        for key in baseline[name]:
            old_blob = pickle.dumps(baseline[name][key], protocol=4)
            new_blob = pickle.dumps(current[name][key], protocol=4)
            assert old_blob == new_blob, f"PARITY FAIL: {name}.{key} (sha {digest(baseline[name][key])} != {digest(current[name][key])})"
            print(f"  EXACT {name}.{key}: {digest(current[name][key])} ({len(current[name][key])} items)")
    print("PARITY OK — byte-identical candle strings, trade markers and ECharts series")


def bench(rounds: int, reps: int):
    frame = intraday_fixture()
    trades = trades_for(chart_data.format_candle_data(frame), 180)

    def payload_build():
        chart = chart_data.build_chart_data_for_symbol("TEST", frame, trades, or_minutes=45)
        chart_data.build_echarts_series(chart)
        return chart

    for _ in range(2):
        payload_build()

    results = []
    for r in range(rounds):
        durations = []
        for _ in range(reps):
            started = time.perf_counter()
            payload_build()
            durations.append((time.perf_counter() - started) * 1000.0)
        results.append(durations)
        print(f"round {r + 1}: median {statistics.median(durations):.2f} ms  p95 {np.percentile(durations, 95):.2f} ms  min {min(durations):.2f} ms")

    best_idx = min(range(rounds), key=lambda i: statistics.median(results[i]))
    best = results[best_idx]
    load = Path("/proc/loadavg").read_text().split()
    print(f"best-of-{rounds}: round {best_idx + 1} median {statistics.median(best):.2f} ms  p95 {np.percentile(best, 95):.2f} ms")
    print(f"contention: loadavg1={load[0]} loadavg5={load[1]} cpus={os.cpu_count()} ({'CONTENDED' if float(load[0]) > (os.cpu_count() or 1) else 'serial-friendly'})")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["capture", "compare", "bench"])
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--reps", type=int, default=10)
    args = parser.parse_args()
    path = artifact_dir() / "baseline.pkl"
    if args.mode == "capture":
        capture(path)
    elif args.mode == "compare":
        compare(path)
    else:
        bench(args.rounds, args.reps)


if __name__ == "__main__":
    main()
