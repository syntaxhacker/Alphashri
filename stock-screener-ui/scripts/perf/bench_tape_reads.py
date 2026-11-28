#!/usr/bin/env python3
"""Deterministic tape read-path parity, parse-count and wall-clock evidence.

Run from ``stock-screener-ui`` with the task venv::

    PYTHONPATH=. CI_MODE=1 <venv>/bin/python scripts/perf/bench_tape_reads.py --label before
    PYTHONPATH=. CI_MODE=1 <venv>/bin/python scripts/perf/bench_tape_reads.py --label after

No network, no DB, no writes to the repo: the fixture and the JSON evidence go
under ``TAPE_READS_ARTIFACT_DIR`` (default ``/workspaces/test-rag/.agent-artifacts/tape-reads``).
``--label`` only names the evidence file; it never changes the workload.

Three measurements per run:

* ``parity`` — reader outputs + full endpoint responses (tape/bursts/chain10s/
  blasts/status/replay) for a deterministic multi-session, multi-symbol fixture,
  including the tail window with two different ``max_bytes`` values.
* ``counts`` — 10 consecutive polls of an unchanged file, instrumented at the
  parse boundary (``read_jsonl`` / ``read_jsonl_tail`` wrappers + ``json.loads``
  counter + ``builtins.open`` counter), then append and atomic-replace proofs.
* ``wall`` — 50k-row JSONL, 5 warmups + 20 reps, three fresh child processes;
  the parent reports each child's median/p95 and the best (lowest median) run.
"""

from __future__ import annotations

import argparse
import builtins
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve()
UI_ROOT = HERE.parent.parent.parent
if str(UI_ROOT) not in sys.path:
    sys.path.insert(0, str(UI_ROOT))

from api.reports_api import options_history as oh  # noqa: E402

DATES = ("2026-10-09", "2026-10-12", "2026-10-13")
SYMBOLS = ("RELIANCE", "SENSEX")
ARTIFACT_DIR = Path(os.getenv(
    "TAPE_READS_ARTIFACT_DIR",
    "/workspaces/test-rag/.agent-artifacts/tape-reads",
))


# --------------------------------------------------------------------- fixture

def _t(day: str, hhmm: str) -> str:
    return f"{day}T{hhmm}:00+05:30"


def _tape_row(day: str, i: int, spot: float) -> dict:
    return {
        "t": _t(day, f"09:{15 + i:02d}"),
        "spot": spot,
        "ce_oi": 1000 + i * 37,
        "pe_oi": 5000 + i * 19,
        "ce_vol": 100 + i * 7,
        "pe_vol": 200 + i * 5,
        "pcr_oi": 1.2,
        "pcr_vol": 1.1,
        "max_pain": 2900.0,
        "flip": 2895.0,
        "walls": {"calls": [{"strike": 3000.0, "oi": 5000}],
                  "puts": [{"strike": 2800.0, "oi": 6000}]},
        "expiry": "2026-10-29",
        "atm_strike": round(spot / 50) * 50,
        "chain": {str(k): [40.0 - abs(k - spot) / 10, 1000 + k, 20 + k]
                  for k in range(2850, 2960, 10)},
    }


def _chain10s_row(day: str, i: int, spot: float) -> dict:
    return {
        "t": f"{day}T13:{30 + i // 6:02d}:{(i % 6) * 10:02d}+05:30",
        "spot": spot,
        "expiry": "2026-10-29",
        "rows": [[2900.0, 40.0, 100000.0 + i * 10, 10.0,
                  35.0, 120000.0 + i * 10, 12.0],
                 [2950.0, 20.0, 800.0, 5.0, 55.0, 900.0, 6.0]],
    }


def _report(day: str, symbol: str) -> dict:
    return {
        "mode": "live", "underlying": symbol, "date": day,
        "expiry": "2026-10-29", "spot": 2900.0, "lot_size": 500,
        "pcr_oi": 1.2, "max_pain": 2900.0,
        "walls": {"calls": [{"strike": 3000.0, "oi": 5000}],
                  "puts": [{"strike": 2800.0, "oi": 6000}]},
        "walls_near": {"calls": [{"strike": 2950.0, "oi": 4000}],
                       "puts": [{"strike": 2850.0, "oi": 4500}]},
        "strikes": [
            {"strike": 2900.0, "ce": {"ltp": 40.0, "oi": 1000},
             "pe": {"ltp": 35.0, "oi": 1200}},
            {"strike": 2950.0, "ce": {"ltp": 20.0, "oi": 800},
             "pe": {"ltp": 55.0, "oi": 900}},
        ],
    }


def _write_jsonl(path: Path, rows: list[dict], *, corrupt: bool = False) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as fh:
        if corrupt:
            fh.write("\n")                      # blank line must be skipped
            fh.write("{not json\n")             # malformed line must be skipped
            fh.write("[1, 2, 3]\n")             # non-dict row must be skipped
        for row in rows:
            fh.write(json.dumps(row, sort_keys=True) + "\n")
    return path


def build_fixture(root: Path) -> dict[str, Any]:
    """Three sessions x two symbols, with malformed lines in one day file."""
    paths: dict[str, Any] = {}
    for di, day in enumerate(DATES):
        for si, symbol in enumerate(SYMBOLS):
            spot = 2900.0 + si * 15 + di
            tape = [_tape_row(day, i, spot) for i in range(12)]
            if symbol == "RELIANCE":
                tape[-3]["spot"] = spot - 55      # exercise spot_flip / trims
            paths[(day, symbol, "tape")] = _write_jsonl(
                root / oh.TAPE_DIR / symbol / f"{day}.jsonl", tape,
                corrupt=(di == 1 and si == 0))
            chain = [_chain10s_row(day, i, spot) for i in range(30)]
            paths[(day, symbol, "chain")] = _write_jsonl(
                root / oh.CHAIN10S_DIR / symbol / f"{day}.jsonl", chain)
            snaps = [
                {"t": _t(day, f"09:{15 + i:02d}"), "fetched_at": _t(day, f"09:{15 + i:02d}"),
                 "report": _report(day, symbol), "sensex": None}
                for i in range(5)
            ]
            paths[(day, symbol, "snaps")] = _write_jsonl(
                root / oh.SNAPSHOTS_DIR / symbol / f"{day}.jsonl", snaps)
            rp = root / oh.SNAPSHOTS_DIR / symbol / f"{day}.json"
            rp.parent.mkdir(parents=True, exist_ok=True)
            rp.write_text(json.dumps(_report(day, symbol), sort_keys=True))
            paths[(day, symbol, "report")] = rp
    return paths


def build_large_tape(path: Path, rows: int = 50_000) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    base = _tape_row("2026-10-13", 0, 2900.0)
    line = json.dumps(base, sort_keys=True) + "\n"
    with open(path, "w") as fh:
        for _ in range(rows):
            fh.write(line)
    return path


# ---------------------------------------------------------------------- parity

def _reader_parity(paths: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for day in DATES:
        for symbol in SYMBOLS:
            for kind in ("tape", "chain", "snaps"):
                key = f"{day}/{symbol}/{kind}"
                p = paths[(day, symbol, kind)]
                out[f"full:{key}"] = oh._read_jsonl(p)
            cp = paths[(day, symbol, "chain")]
            out[f"tail-default:{day}/{symbol}"] = oh._read_jsonl_tail(cp)
            out[f"tail-small:{day}/{symbol}"] = oh._read_jsonl_tail(cp, max_bytes=200)
    return out


def _endpoint_parity(root: Path, paths: dict[str, Any]) -> dict[str, Any]:
    # Deterministic lot sizing: never touch the instrument file or the recorder.
    oh._resolve_lot_size = lambda *a: (500, True)  # type: ignore[assignment]
    out: dict[str, Any] = {}
    for day in DATES:
        for symbol in SYMBOLS:
            out[f"tape:{day}/{symbol}"] = oh.get_options_tape(symbol, date=day)
            out[f"bursts:{day}/{symbol}"] = oh.get_options_bursts(
                symbol, date=day, window=3, min_abs=1000)
            out[f"chain10s:{day}/{symbol}"] = oh.get_options_chain10s(
                symbol, date=day, start=None, end=None, limit=240, summary=False)
            out[f"blasts:{day}/{symbol}"] = oh.get_options_blasts(
                symbol, date=day, lookback_min=5, limit=40)
            out[f"status:{day}/{symbol}"] = oh.get_options_tape_status(symbol)
    return out


async def _async_replay(symbol: str, day: str, **kwargs: Any) -> dict[str, Any]:
    return await oh.get_options_replay(symbol, date=day, **kwargs)


def capture_parity(root: Path, paths: dict[str, Any]) -> dict[str, Any]:
    import asyncio

    out = {"readers": _reader_parity(paths),
           "endpoints": _endpoint_parity(root, paths)}
    day, symbol = DATES[-1], SYMBOLS[0]
    out["endpoints"]["replay-meta"] = asyncio.run(
        _async_replay(symbol, day, t=None, meta=True))
    out["endpoints"]["replay-full"] = asyncio.run(
        _async_replay(symbol, day, t=None, meta=False))
    return out


# ---------------------------------------------------------------------- counts

def count_polls(root: Path, paths: dict[str, Any]) -> dict[str, Any]:
    """10 unchanged polls per endpoint, plus append / atomic-replace proofs."""
    import io

    real_jsonl = oh.read_jsonl
    real_tail = oh.read_jsonl_tail
    real_open = builtins.open
    real_loads = json.loads
    calls = {"jsonl": 0, "tail": 0, "loads": 0, "opens": 0}

    def counted_jsonl(path: Path, *a: Any, **k: Any) -> list[dict]:
        calls["jsonl"] += 1
        return real_jsonl(path, *a, **k)

    def counted_tail(path: Path, *a: Any, **k: Any) -> list[dict]:
        calls["tail"] += 1
        return real_tail(path, *a, **k)

    def counted_open(file: Any, *a: Any, **k: Any):
        if isinstance(file, (str, os.PathLike)) and str(root) in os.fspath(file):
            calls["opens"] += 1
        return real_open(file, *a, **k)

    def counted_loads(s: Any, *a: Any, **k: Any) -> Any:
        calls["loads"] += 1
        return real_loads(s, *a, **k)

    oh.read_jsonl = counted_jsonl        # type: ignore[assignment]
    oh.read_jsonl_tail = counted_tail    # type: ignore[assignment]
    builtins.open = counted_open         # type: ignore[assignment]
    json.loads = counted_loads           # type: ignore[assignment]
    try:
        day, symbol = DATES[-1], SYMBOLS[0]
        tape_path = paths[(day, symbol, "tape")]
        chain_path = paths[(day, symbol, "chain")]
        cache = getattr(oh, "_JSONL_CACHE", None)
        if cache is not None:
            cache.clear()

        def snapshot() -> dict[str, int]:
            return dict(calls)

        def reset(*, cold: bool = False) -> None:
            calls.update(jsonl=0, tail=0, loads=0, opens=0)
            if cold and cache is not None:
                cache.clear()

        # 10 consecutive polls of each endpoint on an unchanged file.
        reset(cold=True)
        for _ in range(10):
            oh.get_options_tape(symbol, date=day)
        tape_10 = snapshot()

        reset(cold=True)
        for _ in range(10):
            oh.get_options_bursts(symbol, date=day, window=3, min_abs=1000)
        bursts_10 = snapshot()

        reset(cold=True)
        for _ in range(10):
            oh.get_options_blasts(symbol, date=day, lookback_min=5, limit=40)
        blasts_10 = snapshot()

        # Both polled endpoints share one tape entry: one parse per file, not
        # one parse per endpoint.
        reset(cold=True)
        for _ in range(10):
            oh.get_options_tape(symbol, date=day)
            oh.get_options_bursts(symbol, date=day, window=3, min_abs=1000)
        shared_20_polls = snapshot()

        # Invalidation proof 1: append one row (size changes).
        oh._read_jsonl(tape_path)  # ensure the entry exists before the mutation
        reset()
        with real_open(tape_path, "a") as fh:
            fh.write(json.dumps(_tape_row(day, 99, 2900.0), sort_keys=True) + "\n")
        oh.get_options_tape(symbol, date=day)
        appended = snapshot()

        # Invalidation proof 2: atomic replace of the tape file (inode changes;
        # mtime_ns changes too).
        reset()
        staging = tape_path.with_suffix(".tmp")
        with real_open(tape_path) as src, real_open(staging, "w") as dst:
            dst.write(src.read())
        os.replace(staging, tape_path)
        oh.get_options_tape(symbol, date=day)
        replaced = snapshot()

        # Tail window: two reads of an unchanged file cost one parse.
        reset(cold=True)
        oh._read_jsonl_tail(chain_path)
        oh._read_jsonl_tail(chain_path)
        tail_twice = snapshot()
        # Appending to the chain file invalidates the cached tail too.
        reset()
        with real_open(chain_path, "a") as fh:
            fh.write(json.dumps(_chain10s_row(DATES[-1], 99, 2900.0), sort_keys=True) + "\n")
        oh._read_jsonl_tail(chain_path)
        tail_after_append = snapshot()

        return {
            "tape_10_polls": tape_10,
            "bursts_10_polls": bursts_10,
            "blasts_10_polls": blasts_10,
            "shared_20_polls": shared_20_polls,
            "tail_after_append_one_call": tail_after_append,
            "after_append_one_call": appended,
            "after_atomic_replace_one_call": replaced,
            "tail_two_calls": tail_twice,
            "cache_entries_after": len(cache) if cache is not None else None,
        }
    finally:
        oh.read_jsonl = real_jsonl        # type: ignore[assignment]
        oh.read_jsonl_tail = real_tail    # type: ignore[assignment]
        builtins.open = real_open         # type: ignore[assignment]
        json.loads = real_loads           # type: ignore[assignment]


# ------------------------------------------------------------------------ wall

def _worker(root: Path, path: Path, warmup: int, reps: int) -> dict[str, Any]:
    if getattr(oh, "_JSONL_CACHE", None) is not None:
        oh._JSONL_CACHE.clear()
    samples: list[float] = []
    for _ in range(warmup):
        oh._read_jsonl(path)
    for _ in range(reps):
        t0 = time.perf_counter()
        oh._read_jsonl(path)
        samples.append((time.perf_counter() - t0) * 1000.0)
    ordered = sorted(samples)
    return {
        "samples_ms": samples,
        "median_ms": statistics.median(samples),
        "p95_ms": ordered[min(len(ordered) - 1, int(0.95 * len(ordered)))],
        "min_ms": ordered[0],
        "loadavg": Path("/proc/loadavg").read_text().strip(),
    }


def wall_clock(root: Path, big: Path, warmup: int, reps: int, processes: int) -> dict[str, Any]:
    runs: list[dict[str, Any]] = []
    for _ in range(processes):
        proc = subprocess.run(
            [sys.executable, str(HERE), "--worker", "--big", str(big),
             "--warmup", str(warmup), "--reps", str(reps)],
            text=True, capture_output=True, check=True,
            env={**os.environ, "PYTHONPATH": str(UI_ROOT), "CI_MODE": "1"},
        )
        runs.append(json.loads(proc.stdout))
    best = min(runs, key=lambda r: r["median_ms"])
    return {
        "rows": 50_000,
        "bytes": big.stat().st_size,
        "warmup": warmup,
        "reps": reps,
        "processes": processes,
        "runs": runs,
        "best_of_n": {"median_ms": best["median_ms"], "p95_ms": best["p95_ms"],
                      "min_ms": best["min_ms"], "loadavg": best["loadavg"]},
    }


# ------------------------------------------------------------------------ main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="run")
    ap.add_argument("--worker", action="store_true")
    ap.add_argument("--big", default="")
    ap.add_argument("--warmup", type=int, default=5)
    ap.add_argument("--reps", type=int, default=20)
    ap.add_argument("--processes", type=int, default=3)
    args = ap.parse_args()

    if args.worker:
        print(json.dumps(_worker(Path(), Path(args.big), args.warmup, args.reps)))
        return 0

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="tape-reads-") as td:
        root = Path(td) / "experiments" / "data"
        oh.DATA_ROOT = root
        paths = build_fixture(root)
        big = build_large_tape(root / "options_tape" / "BIG" / f"{DATES[-1]}.jsonl")
        evidence = {
            "label": args.label,
            "python": sys.version.split()[0],
            "loadavg": Path("/proc/loadavg").read_text().strip(),
            "parity": capture_parity(root, paths),
            "counts": count_polls(root, paths),
            "wall": wall_clock(root, big, args.warmup, args.reps, args.processes),
        }
    out = ARTIFACT_DIR / f"{args.label}.json"
    out.write_text(json.dumps(evidence, indent=2, sort_keys=True))
    print(f"wrote {out}")
    print(json.dumps({
        "counts": evidence["counts"],
        "wall_best": evidence["wall"]["best_of_n"],
        "wall_bytes": evidence["wall"]["bytes"],
        "loadavg": evidence["loadavg"],
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
