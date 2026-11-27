#!/usr/bin/env python3
"""Deterministic instrument-key resolution benchmark (no network, no writes).

Run from the project root with the task venv::

    PYTHONPATH=. CI_MODE=1 <venv>/bin/python scripts/perf/bench_instrument_index.py

Two passes are reported per resolver:

* ``wall``  — plain dict rows, one sweep over ``--symbols`` queries, with
  per-call median/p95 and total wall-clock. Run as best of 3 fresh processes.
* ``count`` — instrumented rows that count list iterations, visited items and
  dict ``.get`` calls. This is contention-robust: the linear scan must scale as
  O(K*N), the index as O(N + K).

``--assert-indexed`` fails when the counted pass still iterates per query.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path
from unittest.mock import patch

_UI_DIR = Path(__file__).resolve().parents[2]
_REPO_ROOT = _UI_DIR.parent
for _p in (str(_REPO_ROOT), str(_UI_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import upstox_trader.config_and_utils.upstox_api as upstox_api_module
from upstox_trader.brokers.upstox.mapping import UpstoxSymbolMap
from upstox_trader.config_and_utils.upstox_api import UpstoxAPI, EQUITY_FALLBACK_TYPES

EQ_ROWS = 20_000
MISS_SYMBOLS = 200
SUFFIX = ".EQ"


class CountingList(list):
    __slots__ = ("iterations", "visited")

    def __init__(self, items):
        super().__init__(items)
        self.iterations = 0
        self.visited = 0

    def __iter__(self):
        self.iterations += 1
        for item in super().__iter__():
            self.visited += 1
            yield item


class CountingDict(dict):
    __slots__ = ("gets",)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.gets = 0

    def get(self, key, default=None):
        self.gets += 1
        return super().get(key, default)


def _rows(n: int, counted: bool) -> list[dict]:
    row_cls = CountingDict if counted else dict
    rows = []
    for i in range(n):
        symbol = f"S{i:06d}"
        if i < EQ_ROWS:
            itype, segment = "EQ", "NSE_EQ"
        else:
            itype = EQUITY_FALLBACK_TYPES[(i - EQ_ROWS) % len(EQUITY_FALLBACK_TYPES)]
            segment = "NSE_EQ"
        rows.append(
            row_cls(
                trading_symbol=symbol,
                instrument_key=f"NSE_EQ|KEY{i:06d}",
                instrument_type=itype,
                segment=segment,
            )
        )
    return rows


def _symbols(k: int) -> list[str]:
    hits = [f"S{(i * 5037) % EQ_ROWS:06d}" for i in range(k - MISS_SYMBOLS)]
    return hits + [f"MISSING{i:04d}" for i in range(MISS_SYMBOLS)]


def _resolve_sweep(resolver, symbols: list[str]) -> tuple[float, float, float]:
    samples = []
    started = time.perf_counter()
    for symbol in symbols:
        t0 = time.perf_counter()
        resolver(symbol)
        samples.append((time.perf_counter() - t0) * 1000.0)
    total = time.perf_counter() - started
    ordered = sorted(samples)
    return total, statistics.median(samples), ordered[int(0.95 * len(ordered)) - 1]


def _counts(rows, symbols: list[str], which: str) -> tuple[int, int, int]:
    instruments = CountingList(rows)
    if which == "resolve":
        mapping = UpstoxSymbolMap.__new__(UpstoxSymbolMap)
        mapping._instruments = instruments
        resolver = mapping.resolve_token
    else:
        api = UpstoxAPI.__new__(UpstoxAPI)
        api.instruments = instruments
        api.quiet = True
        resolver = api.get_instrument_key
    for symbol in symbols:
        resolver(symbol)
    return (
        instruments.iterations,
        instruments.visited,
        sum(row.gets for row in rows),
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=100_000)
    parser.add_argument("--symbols", type=int, default=2_000)
    parser.add_argument("--only", choices=("both", "resolve", "api"), default="both")
    parser.add_argument("--count", action="store_true", help="run instrumented pass")
    parser.add_argument("--assert-indexed", action="store_true")
    args = parser.parse_args()

    rows = _rows(args.rows, counted=False)
    symbols = _symbols(args.symbols)
    targets = (
        ("resolve_token", "resolve"),
        ("get_instrument_key", "api"),
    )
    if args.only != "both":
        targets = [t for t in targets if t[1] == args.only]

    print(
        f"bench_instrument_index | rows={args.rows} symbols={args.symbols} "
        "| no network, no writes"
    )
    print(
        f"{'pass':<7} | {'resolver':<18} | {'total s':>9} | {'median ms':>10} "
        f"| {'p95 ms':>9} | {'iterations':>11} | {'item visits':>12} | {'dict gets':>11}"
    )
    print("-" * 112)

    with patch.object(
        upstox_api_module, "get_valid_symbol", lambda symbol: str(symbol).upper()
    ):
        for label, which in targets:
            if which == "resolve":
                mapping = UpstoxSymbolMap.__new__(UpstoxSymbolMap)
                mapping._instruments = rows
                resolver = mapping.resolve_token
            else:
                api = UpstoxAPI.__new__(UpstoxAPI)
                api.instruments = rows
                api.quiet = True
                resolver = api.get_instrument_key
            total, median, p95 = _resolve_sweep(resolver, symbols)
            print(
                f"{'wall':<7} | {label:<18} | {total:>9.3f} | {median:>10.4f} "
                f"| {p95:>9.4f} | {'-':>11} | {'-':>12} | {'-':>11}"
            )

            if args.count or args.assert_indexed:
                counted_rows = _rows(args.rows, counted=True)
                iterations, visits, gets = _counts(counted_rows, symbols, which)
                print(
                    f"{'count':<7} | {label:<18} | {'-':>9} | {'-':>10} "
                    f"| {'-':>9} | {iterations:>11} | {visits:>12} | {gets:>11}"
                )
                if args.assert_indexed:
                    # One build iteration over N rows, constant-time lookups:
                    # no per-symbol rescan of the master.
                    assert iterations <= 2, (label, iterations)
                    assert gets <= args.rows + 8 * args.symbols, (label, gets)


if __name__ == "__main__":
    main()
