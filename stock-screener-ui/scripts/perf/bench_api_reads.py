#!/usr/bin/env python3
"""Read-only benchmark for the 52W touch-history enrichment read path.

Runs entirely on ``sqlite:///:memory:`` with deterministic fixtures and a
frozen clock, so the serialized payload is byte-stable across processes.
Nothing in this script imports the FastAPI app or reaches the network.

Usage (from stock-screener-ui)::

    VENV/bin/python scripts/perf/bench_api_reads.py --out /path/to/payload.json
    VENV/bin/python scripts/perf/bench_api_reads.py --profile
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import statistics
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

# Pin the DB URL before any project import so an import side effect cannot
# touch the developer's local database.
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

_REPO = Path(__file__).resolve().parents[2]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

import config  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from api.screener_api import screener_scan  # noqa: E402
from db.models.base import Base  # noqa: E402
from db.models.stock_52w_touch import Stock52WeekTouch  # noqa: E402

WARMUPS = 5
REPS = 50
N_SYMBOLS = 300

FIXED_NOW = datetime(2026, 11, 27, 12, 0, 0, tzinfo=config.IST)


class _FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return FIXED_NOW if tz is None else FIXED_NOW.astimezone(tz)


def _make_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=[Stock52WeekTouch.__table__])
    return engine


def _seed(engine):
    session = sessionmaker(bind=engine)()
    try:
        rows = []
        for i in range(N_SYMBOLS):
            sym = f"PERFSYM{i:04d}"
            # Every 11th symbol has no history at all.
            if i % 11 == 0:
                continue
            # A recent high touch (two of them: newest must win).
            rows.append((sym, FIXED_NOW.replace(tzinfo=None) - timedelta(days=1), 100.0 + i, True))
            rows.append((sym, FIXED_NOW.replace(tzinfo=None) - timedelta(days=3), 99.0 + i, True))
            # A recent NON-high touch that must never enter touch_map.
            rows.append((sym, FIXED_NOW.replace(tzinfo=None) - timedelta(days=2), 98.0 + i, False))
            # Old touches: last_touched_info still sees them for symbols whose
            # newest touch is older than the 7-day window.
            if i % 7 == 0:
                continue  # this symbol's only touches are the three above
            rows.append((sym, FIXED_NOW.replace(tzinfo=None) - timedelta(days=10), 97.0 + i, True))
            rows.append((sym, FIXED_NOW.replace(tzinfo=None) - timedelta(days=30), 96.0 + i, False))
        session.bulk_save_objects(
            [
                Stock52WeekTouch(
                    symbol=sym, touched_date=date, touched_price=price, is_high=is_high
                )
                for sym, date, price, is_high in rows
            ]
        )
        session.commit()
    finally:
        session.close()


def _make_data():
    # Mirrors the shape produced by the screener: two buckets of candidate dicts.
    approach = []
    touched = []
    for i in range(N_SYMBOLS):
        sym = f"PERFSYM{i:04d}"
        row = {
            "symbol": sym,
            "score": 50,
            "tv_price": 100.0 + i,
            "upstox_price": 100.0 + i,
            "high_52w": 110.0 + i,
            "to_52w_high": 2.0,
            "touched_52w": False,
            "days_ago": None,
        }
        (touched if i % 5 == 0 else approach).append(row)
    return {"approaching": approach, "touched": touched}


def _install():
    engine = _make_engine()
    _seed(engine)
    screener_scan.SessionLocal = sessionmaker(bind=engine)
    screener_scan.datetime = _FrozenDatetime
    return engine


def _percentile(values, pct):
    ordered = sorted(values)
    idx = (len(ordered) - 1) * pct
    lo, hi = int(idx), min(int(idx) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (idx - lo)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, help="write the canonical payload to this path")
    ap.add_argument("--profile", action="store_true", help="print a cProfile report for one call")
    args = ap.parse_args()

    engine = _install()

    counter = {"n": 0}

    def _count_sql(conn, cursor, statement, parameters, context, executemany):
        counter["n"] += 1

    event.listen(engine, "before_cursor_execute", _count_sql)

    template = _make_data()
    reference = None

    def _call():
        data = copy.deepcopy(template)
        screener_scan._enrich_with_touch_history(data, "trending")
        return data

    if args.profile:
        import cProfile
        import pstats

        prof = cProfile.Profile()
        prof.enable()
        _call()
        prof.disable()
        pstats.Stats(prof).sort_stats("cumulative").print_stats(15)
        return

    for _ in range(WARMUPS):
        _call()

    counter["n"] = 0
    reference = _call()
    sql_per_call = counter["n"]

    payload = json.dumps(reference, sort_keys=True, default=str, separators=(",", ":"))
    digest = hashlib.sha256(payload.encode()).hexdigest()
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(payload + "\n", encoding="utf-8")

    samples = []
    for _ in range(REPS):
        t0 = time.perf_counter_ns()
        _call()
        samples.append(time.perf_counter_ns() - t0)

    print(
        json.dumps(
            {
                "symbols": N_SYMBOLS,
                "warmups": WARMUPS,
                "reps": REPS,
                "sql_per_call": sql_per_call,
                "median_ns": int(statistics.median(samples)),
                "p95_ns": int(_percentile(samples, 0.95)),
                "min_ns": int(min(samples)),
                "payload_sha256": digest,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
