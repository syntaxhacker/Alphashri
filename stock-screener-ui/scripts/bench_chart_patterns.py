"""Reproducible benchmark for the chart-pattern detection hot path.

Times :func:`chart_patterns.engine.detect_patterns` over a fixed set of frames.
The default source is a seeded synthetic random walk (no network, no DB). Real
NSE frames can be fetched with yfinance and cached so repeated runs measure the
same bars. Every run reports min/median seconds per call, an output hash and a
hit count, broken down by timeframe.

Usage:
    .venv/bin/python scripts/bench_chart_patterns.py --synthetic --symbols 4 --bars 260 --runs 3
    .venv/bin/python scripts/bench_chart_patterns.py --real --tickers RELIANCE.NS TCS.NS --runs 3
    .venv/bin/python scripts/bench_chart_patterns.py --from-cache /tmp/alphashri_pattern_frames.pkl --runs 3
"""

from __future__ import annotations

import argparse
import hashlib
import math
import os
import pickle
import statistics
import sys
import time
from dataclasses import asdict, is_dataclass
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chart_patterns.engine import detect_patterns  # noqa: E402
from chart_patterns.features import OHLCV_COLUMNS  # noqa: E402
from chart_patterns.timeframes import TIMEFRAME_IDS  # noqa: E402

DEFAULT_CACHE = "/tmp/alphashri_pattern_frames.pkl"
DEFAULT_TICKERS = ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS"]
DEFAULT_TIMEFRAMES = ["1D", "1h", "5m"]
ANCHOR = pd.Timestamp("2024-01-01 09:15:00")
TF_FREQ = {
    "1m": "1min", "3m": "3min", "5m": "5min", "10m": "10min",
    "15m": "15min", "30m": "30min", "1h": "1h", "2h": "2h",
    "3h": "3h", "4h": "4h", "1D": "1D", "1W": "1W", "1M": "ME",
}
OPS = ("patterns",)




def _sanitize(obj: Any) -> Any:
    if is_dataclass(obj) and not isinstance(obj, type):
        return _sanitize(asdict(obj))
    if isinstance(obj, np.generic):
        return _sanitize(obj.item())
    if isinstance(obj, np.ndarray):
        return [_sanitize(v) for v in obj.tolist()]
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {str(k): _sanitize(v) for k, v in sorted(obj.items(), key=lambda kv: str(kv[0]))}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, float) and not math.isfinite(obj):
        return "nan" if math.isnan(obj) else ("inf" if obj > 0 else "-inf")
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    return str(obj)


def _canonical(obj: Any) -> str:
    """Stable string whose sha256 is the output-equivalence fingerprint."""
    import json

    return json.dumps(_sanitize(obj), sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _sha(obj: Any) -> str:
    return hashlib.sha256(_canonical(obj).encode("utf-8")).hexdigest()




def _synthetic_frame(bars: int, seed: int, freq: str) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    steps = rng.normal(0.0, 0.012, size=bars)
    close = 100.0 * np.exp(np.cumsum(steps))
    open_ = np.concatenate(([100.0], close[:-1]))
    high = np.maximum(open_, close) * (1.0 + rng.uniform(0.0, 0.008, size=bars))
    low = np.minimum(open_, close) * (1.0 - rng.uniform(0.0, 0.008, size=bars))
    volume = rng.integers(1_000, 100_000, size=bars).astype(float)
    index = pd.date_range(end=ANCHOR, periods=bars, freq=freq)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=index,
    )


def _bucket(tf: str) -> str:
    if tf in {"1D", "1W", "1M"}:
        return "1D"
    if tf in {"1h", "2h", "3h", "4h"}:
        return "1h"
    return "5m"


def _synthetic_frames(symbols: int, bars: int, timeframes: list[str], seed: int):
    frames: dict[tuple[str, str], pd.DataFrame] = {}
    syms = [f"SYN{i:04d}" for i in range(symbols)]
    for tf in timeframes:
        tf_i = TIMEFRAME_IDS.index(tf)
        for sym_i, sym in enumerate(syms):
            frames[(tf, sym)] = _synthetic_frame(
                bars, seed + tf_i * 10007 + sym_i * 97, TF_FREQ[tf]
            )
    return frames


def _normalize_yf(raw: pd.DataFrame, ticker: str) -> pd.DataFrame | None:
    if isinstance(raw.columns, pd.MultiIndex):
        level0 = raw.columns.get_level_values(0)
        level1 = raw.columns.get_level_values(1)
        if ticker in level0:
            df = raw[ticker].copy()
        elif ticker in level1:
            df = raw.xs(ticker, axis=1, level=1).copy()
        else:
            return None
    else:
        df = raw.copy()
    df.columns = [str(c).strip().lower() for c in df.columns]
    if not set(OHLCV_COLUMNS) <= set(df.columns):
        return None
    df = df[OHLCV_COLUMNS]
    df = df[~df.index.duplicated(keep="last")].sort_index().dropna(subset=["close"])
    df["volume"] = df["volume"].fillna(0.0)
    return df if not df.empty else None


def _download(tickers: list[str], period: str, intraday_period: str) -> dict:
    import yfinance as yf

    frames: dict[tuple[str, str], pd.DataFrame] = {}
    for interval, span in (("1d", period), ("1h", intraday_period), ("5m", intraday_period)):
        bucket = {"1d": "1D", "1h": "1h", "5m": "5m"}[interval]
        raw = yf.download(
            tickers, period=span, interval=interval, group_by="ticker",
            auto_adjust=False, progress=False, threads=True,
        )
        for ticker in tickers:
            frame = _normalize_yf(raw, ticker)
            if frame is not None:
                frames[(bucket, ticker)] = frame
    return frames


def _real_frames(args):
    frames = _download(args.tickers, args.period, args.intraday_period)
    if not frames:
        raise RuntimeError("yfinance returned no usable frames; check tickers/network or use --synthetic")
    payload = {
        "version": 1,
        "period": args.period,
        "intraday_period": args.intraday_period,
        "tickers": list(args.tickers),
        "frames": frames,
    }
    with open(args.cache, "wb") as fh:
        pickle.dump(payload, fh, protocol=pickle.HIGHEST_PROTOCOL)
    return _select_frames(frames, args.tickers, args.timeframes_list), payload


def _select_frames(frames: dict, tickers: list[str], timeframes: list[str]):
    selected: dict[tuple[str, str], pd.DataFrame] = {}
    missing: list[tuple[str, str]] = []
    for tf in timeframes:
        bucket = _bucket(tf)
        for ticker in tickers:
            frame = frames.get((bucket, ticker))
            if frame is None:
                missing.append((bucket, ticker))
            else:
                selected[(tf, ticker)] = frame
    for bucket, ticker in missing:
        print(f"WARN no {bucket} frame for {ticker} (skipped)")
    return selected


def _load_cache(path: str):
    with open(path, "rb") as fh:
        payload = pickle.load(fh)
    if not isinstance(payload, dict) or "frames" not in payload:
        raise ValueError(f"{path} is not a pattern-frame cache")
    return payload




def _apply(op: str, frame: pd.DataFrame, timeframe: str, symbol: str, lookback: int | None):
    return detect_patterns(frame, timeframe, symbol)


def _hit_count(op: str, out) -> int:
    return len(out or [])


def benchmark(frames, timeframes, runs, lookback) -> dict:
    keys = sorted(frames)
    first = keys[0]
    for op in OPS:
        _apply(op, frames[first], first[0], first[1], lookback)

    samples: dict[tuple[str, str], list[float]] = {(tf, op): [] for tf in timeframes for op in OPS}
    hits: dict[tuple[str, str], int] = {k: 0 for k in samples}
    run_payloads: dict[int, dict] = {}

    wall0 = time.perf_counter()
    for run in range(runs):
        payloads: dict[tuple[str, str, str], Any] = {}
        for tf, sym in keys:
            frame = frames[(tf, sym)]
            for op in OPS:
                t0 = time.perf_counter()
                out = _apply(op, frame, tf, sym, lookback)
                elapsed = time.perf_counter() - t0
                samples[(tf, op)].append(elapsed)
                hits[(tf, op)] += _hit_count(op, out)
                payloads[(tf, sym, op)] = out
        run_payloads[run] = payloads
    wall = time.perf_counter() - wall0

    stable = all(run_payloads[r] == run_payloads[0] for r in range(1, runs))
    base = run_payloads[0]

    def group_payload(tfs: list[str], ops: tuple[str, ...]) -> dict:
        out: dict = {}
        for op in ops:
            out[op] = [
                {"timeframe": tf, "symbol": sym, "output": base[(tf, sym, op)]}
                for tf, sym in keys if tf in tfs
            ]
        return out

    return {
        "keys": keys, "samples": samples, "hits": hits, "wall": wall,
        "runs": runs, "stable": stable,
        "group_hash": lambda tfs, ops: _sha(group_payload(tfs, ops)),
    }


def _fmt_row(label, values):
    calls, mn, med, count, digest = values
    return f"{label:<16}{calls:>7d}{mn:>11.6f}{med:>11.6f}{count:>9d}  {digest}"


def report(result: dict, timeframes: list[str]) -> None:
    samples, hits = result["samples"], result["hits"]
    print("\n=== Results (seconds per call; min/median over symbols x runs) ===")
    header = f"{'group':<16}{'calls':>7}{'min_s':>11}{'median_s':>11}{'hits':>9}  sha256"
    print(header)
    print("-" * len(header))
    for tf in timeframes:
        for op in OPS:
            s = samples[(tf, op)]
            digest = result["group_hash"]([tf], (op,))
            print(_fmt_row(f"{tf}/{op}", (len(s), min(s), statistics.median(s), hits[(tf, op)], digest)))
    for op in OPS:
        s = [x for tf in timeframes for x in samples[(tf, op)]]
        count = sum(hits[(tf, op)] for tf in timeframes)
        print(_fmt_row(f"ALL/{op}", (len(s), min(s), statistics.median(s), count,
                                     result["group_hash"](timeframes, (op,)))))
    all_samples = [x for v in samples.values() for x in v]
    print(_fmt_row("ALL/combined", (len(all_samples), min(all_samples), statistics.median(all_samples),
                                    sum(hits.values()), result["group_hash"](timeframes, OPS))))
    print(f"\nTotal timed wall: {result['wall']:.4f}s over {result['runs']} interleaved run(s)")
    print(f"Output stable across runs: {result['stable']}")


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="Benchmark chart-pattern detection (synthetic by default)")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--synthetic", action="store_true", help="seeded random-walk frames (default)")
    src.add_argument("--real", action="store_true", help="fetch NSE frames via yfinance (network)")
    ap.add_argument("--from-cache", metavar="PATH", help="load cached frames; never use network")
    ap.add_argument("--symbols", type=int, default=4, help="synthetic symbol count (default 4)")
    ap.add_argument("--bars", type=int, default=260, help="synthetic bars per frame (default 260)")
    ap.add_argument("--seed", type=int, default=42, help="synthetic RNG seed (default 42)")
    ap.add_argument("--timeframes", default=",".join(DEFAULT_TIMEFRAMES),
                    help="comma-separated timeframe ids (default 1D,1h,5m)")
    ap.add_argument("--runs", type=int, default=3, help="interleaved timed runs (default 3)")
    ap.add_argument("--tickers", nargs="+", default=DEFAULT_TICKERS,
                    help="yfinance tickers for --real (default RELIANCE.NS TCS.NS INFY.NS HDFCBANK.NS)")
    ap.add_argument("--period", default="2y", help="yfinance daily period (default 2y)")
    ap.add_argument("--intraday-period", default="60d", help="yfinance 1h/5m period (default 60d)")
    ap.add_argument("--cache", default=DEFAULT_CACHE, help=f"--real cache path (default {DEFAULT_CACHE})")
    args = ap.parse_args(argv)
    if args.from_cache and (args.synthetic or args.real):
        ap.error("--from-cache is mutually exclusive with --synthetic/--real")
    args.timeframes_list = [t.strip() for t in args.timeframes.split(",") if t.strip()]
    bad = [t for t in args.timeframes_list if t not in TIMEFRAME_IDS]
    if bad:
        ap.error(f"unknown timeframe(s): {bad}; valid: {', '.join(TIMEFRAME_IDS)}")
    if args.runs < 1 or args.symbols < 1 or args.bars < 2:
        ap.error("--runs/--symbols must be >=1 and --bars >=2")
    return args


def main(argv=None) -> None:
    args = parse_args(argv)
    if args.real:
        mode = "real (yfinance)"
    elif args.from_cache:
        mode = f"from-cache ({args.from_cache})"
    else:
        mode = "synthetic"
    print(f"=== Config ===\nmode: {mode}\ntimeframes: {','.join(args.timeframes_list)}"
          f"\nruns: {args.runs}  seed: {args.seed}")
    print("network: enabled (--real)" if args.real else "network: disabled")

    load0 = time.perf_counter()
    if args.from_cache:
        payload = _load_cache(args.from_cache)
        frames = _select_frames(payload["frames"], payload["tickers"], args.timeframes_list)
        print(f"cache: {args.from_cache} (period={payload.get('period')}, "
              f"intraday={payload.get('intraday_period')})")
        meta = None
    elif args.real:
        frames, meta = _real_frames(args)
        print(f"cache written: {args.cache}")
    else:
        frames = _synthetic_frames(args.symbols, args.bars, args.timeframes_list, args.seed)
        meta = None
    load = time.perf_counter() - load0

    if not frames:
        print("no frames available for the requested timeframes/symbols; aborting")
        sys.exit(1)
    lens = sorted({len(f) for f in frames.values()})
    print(f"frames: {len(frames)} (bars min/med/max: {lens[0]}/{lens[len(lens)//2]}/{lens[-1]})"
          f"  load: {load:.4f}s")

    result = benchmark(frames, args.timeframes_list, args.runs, None)
    report(result, args.timeframes_list)
    if not result["stable"]:
        print("WARNING: outputs differed across runs; hash is not a stable equivalence check")


if __name__ == "__main__":
    main()
