"""Benchmark the chart-pattern detection hot path.

Loads ~150 cached 1D frames from ``experiments/data/pattern_cache/candles/1D/``
(``*.v2.pkl``) and times :func:`chart_patterns.engine.detect_patterns`
end-to-end plus a per-detector breakdown.

Usage:
    PYTHONPATH=. .venv/bin/python scripts/benchmark_detection.py [--n 150]
"""

from __future__ import annotations

import argparse
import glob
import os
import pickle
import sys
import time

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chart_patterns.detectors.common import DETECTORS  # noqa: E402
from chart_patterns.engine import detect_patterns  # noqa: E402
from chart_patterns.features import normalize_ohlcv  # noqa: E402

CACHE_GLOB = "experiments/data/pattern_cache/candles/1D/*.v2.pkl"


def load_frames(n: int) -> list[tuple[str, pd.DataFrame]]:
    """Load up to ``n`` cached 1D frames as normalised OHLCV (sorted by path)."""
    out: list[tuple[str, pd.DataFrame]] = []
    for path in sorted(glob.glob(CACHE_GLOB))[:n]:
        try:
            with open(path, "rb") as fh:
                obj = pickle.load(fh)
        except Exception as exc:  # corrupt cache entry: skip, do not abort
            print(f"skip {path}: {exc}")
            continue
        df = obj if isinstance(obj, pd.DataFrame) else obj.get("df")
        if df is None:
            continue
        norm = normalize_ohlcv(df)
        if norm is None or norm.empty:
            continue
        sym = os.path.basename(path).split(".")[0]
        out.append((sym, norm))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Benchmark pattern detection hot path")
    ap.add_argument("--n", type=int, default=150, help="frames to load (default 150)")
    ap.add_argument("--repeat", type=int, default=1, help="end-to-end passes (default 1)")
    args = ap.parse_args()

    frames = load_frames(args.n)
    if not frames:
        print(f"no frames found via {CACHE_GLOB}")
        sys.exit(1)
    lens = sorted({len(df) for _, df in frames})
    print(f"loaded {len(frames)} frames (bars min/med/max: {lens[0]}/{lens[len(lens)//2]}/{lens[-1]})")

    # Warm up once so import/first-call costs do not skew the numbers.
    detect_patterns(frames[0][1], "1D", frames[0][0])

    # --- end-to-end pass (exactly what a universe screen runs per symbol) ---
    t0 = time.perf_counter()
    total_hits = 0
    for _ in range(args.repeat):
        for sym, df in frames:
            total_hits += len(detect_patterns(df, "1D", sym))
    dt = time.perf_counter() - t0
    n_calls = len(frames) * args.repeat
    print(f"end-to-end: {n_calls} detect_patterns calls in {dt:.2f}s "
          f"-> {n_calls / dt:.1f} symbols/sec ({dt / n_calls * 1000:.0f} ms/symbol), "
          f"{total_hits} hits")

    # --- per-detector breakdown (shared ctx, engine order, like detect_patterns) ---
    per_det: dict[str, float] = {}
    per_hits: dict[str, int] = {}
    for sym, df in frames:
        ctx: dict = {"symbol": sym, "timeframe": "1D", "min_bars": 60}
        for pid, fn in DETECTORS:
            s = time.perf_counter()
            try:
                hits = fn(df, ctx) or []
            except Exception:
                hits = []
            per_det[pid] = per_det.get(pid, 0.0) + (time.perf_counter() - s)
            per_hits[pid] = per_hits.get(pid, 0) + len(hits)
    tot = sum(per_det.values()) or 1.0
    print(f"{'detector':<24}{'total s':>9}{'ms/sym':>9}{'share':>8}{'hits':>7}")
    for pid, secs in sorted(per_det.items(), key=lambda kv: -kv[1]):
        print(f"{pid:<24}{secs:>9.2f}{secs / len(frames) * 1000:>9.1f}"
              f"{secs / tot:>7.1%} {per_hits[pid]:>7d}")


if __name__ == "__main__":
    main()
