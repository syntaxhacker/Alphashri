"""Deterministic parity, operation-count and wall-clock harness for value_scan scoring.

Run from any cwd::

    python scripts/perf/bench_value_scan.py snapshot --out baseline.json
    python scripts/perf/bench_value_scan.py parity --baseline baseline.json
    python scripts/perf/bench_value_scan.py counts --out counts.json
    python scripts/perf/bench_value_scan.py wall --out wall.json

The fixture is fixed: duplicate values, exact distribution boundaries, NaN /
missing fundamentals and several sector buckets. ``snapshot`` writes a canonical
representation of every output field (floats as ``float.hex()``, dict order kept)
so parity can be checked bit-for-bit after an optimisation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import sys
import time
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from api.value_scan import scoring as sc  # noqa: E402
from api.value_scan.scoring import (  # noqa: E402
    FUNDAMENTAL_KEYS,
    ScoreConfig,
    peer_medians,
    score_row,
)

N_ROWS = 2000

SECTORS = (
    "Technology", "Healthcare", "Banks", "Insurance", "Energy",
    "Financial Services", "Utilities", "Mystery sector", None, "  banks ",
)
PE = (6.0, 8.0, 10.0, 10.0, 12.0, 15.0, 20.0, 30.0, 40.0, 60.0, None)
PS = (0.4, 0.8, 1.0, 1.0, 1.5, 2.0, 3.0, 5.0, None)
PB = (0.5, 0.9, 1.0, 1.0, 2.0, 3.0, 5.0, None)
ROE = (-5.0, 5.0, 12.0, 18.0, 25.0, 25.0, 40.0, None)
MARGIN = (0.0, 8.0, 15.0, 30.0, 45.0, 50.0, None)
DE = (-1.0, 0.0, 0.3, 0.7, 1.0, 1.5, 3.0, None)
CR = (0.5, 1.0, 1.2, 2.0, 3.0, None)
REV = (-20.0, 0.0, 5.0, 12.0, 15.0, 25.0, 40.0, None)
EPS_YOY = (-70.0, -30.0, 0.0, 10.0, 30.0, 60.0, 90.0, None)
EPS = (-4.0, 0.0, 1.0, 5.0, 12.0, None)
DIV = (0.0, 0.5, 2.0, 4.0, 6.0, None)
CLOSE = (40.0, 80.0, 90.0, 100.0, 100.0, 110.0, 140.0, None)
HIGH = (80.0, 100.0, 120.0, 120.0, 150.0, 200.0, None)
SMA200 = (70.0, 90.0, 100.0, 100.0, 130.0, None)
FCF = (-2e9, 0.0, 0.5e9, 2e9, 2e9, 8e9, None)
MCAP = (-1e9, 0.0, 1e8, 1e9, 20e9, 20e9, 200e9, None)


def make_rows(n: int = N_ROWS) -> list[dict[str, Any]]:
    """Fixed frame: values are drawn from discrete sets, so rows hit boundaries."""
    rows: list[dict[str, Any]] = []
    for i in range(n):
        gm = MARGIN[(i * 13) % len(MARGIN)]
        row: dict[str, Any] = {
            "name": f"SYM{i:04d}",
            "description": f"Co {i}",
            "sector": SECTORS[i % len(SECTORS)],
            "close": CLOSE[(i * 41) % len(CLOSE)],
            "SMA200": SMA200[(i * 47) % len(SMA200)],
            "price_52_week_high": HIGH[(i * 43) % len(HIGH)],
            "volume": (10_000.0, 100_000.0, 1_000_000.0)[(i * 67) % 3],
            "market_cap_basic": MCAP[(i * 59) % len(MCAP)],
            "price_earnings_ttm": PE[(i * 3) % len(PE)],
            "price_sales_ratio": PS[(i * 5) % len(PS)],
            "price_book_fq": PB[(i * 7) % len(PB)],
            "return_on_equity_fq": ROE[(i * 11) % len(ROE)],
            "gross_margin_ttm": gm,
            "operating_margin_ttm": (gm / 2.0) if gm is not None else None,
            "debt_to_equity_fq": DE[(i * 17) % len(DE)],
            "current_ratio": CR[(i * 19) % len(CR)],
            "free_cash_flow_ttm": FCF[(i * 53) % len(FCF)],
            "total_revenue_yoy_growth_ttm": REV[(i * 23) % len(REV)],
            "earnings_per_share_diluted_yoy_growth_ttm": EPS_YOY[(i * 29) % len(EPS_YOY)],
            "earnings_per_share_diluted_ttm": EPS[(i * 31) % len(EPS)],
            "dividends_yield_current": DIV[(i * 37) % len(DIV)],
            "RSI": (10.0, 25.0, 55.0, 75.0, 85.0, None)[(i * 71) % 6],
            "Perf.3M": (-30.0, 0.0, 5.0, 20.0, None)[(i * 73) % 5],
            "Perf.1M": (-20.0, 0.0, 3.0, 12.0, None)[(i * 79) % 5],
            "Recommend.All": (-1.0, -0.2, 0.0, 0.2, 1.0, None)[(i * 83) % 6],
        }
        if i % 17 == 0:
            row["return_on_equity_fq"] = float("nan")
        if i % 23 == 0:
            row["total_revenue_yoy_growth_ttm"] = None
        if i % 29 == 0:
            row["free_cash_flow_ttm"] = float("nan")
        if i % 31 == 0:
            row["price_52_week_high"] = None
        if i % 211 == 0:
            for key in FUNDAMENTAL_KEYS:
                row[key] = None
        rows.append(row)
    return rows


def canonical(value: Any) -> Any:
    """Byte-stable, order-preserving representation with exact float bits."""
    if value is None:
        return None
    if isinstance(value, bool):
        return ["bool", value]
    if isinstance(value, int):
        return ["int", value]
    if isinstance(value, float):
        return ["float", value.hex()]
    if isinstance(value, str):
        return ["str", value]
    if isinstance(value, dict):
        return ["dict", [[canonical(k), canonical(v)] for k, v in value.items()]]
    if isinstance(value, (list, tuple)):
        return ["list", [canonical(v) for v in value]]
    raise TypeError(f"cannot canonicalise {type(value)!r}")


def snapshot(rows: list[dict], peers: dict) -> dict:
    """Full scored frame for default + both alternate configs."""
    configs: tuple[ScoreConfig | None, ...] = (
        None,
        ScoreConfig(use_peer_relative=False),
        ScoreConfig(penalise_trend=False),
    )
    return {
        "rows": len(rows),
        "frames": [
            [canonical(score_row(row, peers, cfg)) for row in rows] for cfg in configs
        ],
    }


def _first_diff(a: Any, b: Any, path: str = "") -> str | None:
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{path}: length {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            found = _first_diff(x, y, f"{path}[{i}]")
            if found:
                return found
        return None
    return None if a == b else f"{path}: {a!r} != {b!r}"


class TracingList(list):
    """List that counts element visits (iteration) and random probes (bisect)."""

    def __init__(self, values: list[float]):
        super().__init__(values)
        self.iter_calls = 0
        self.visits = 0
        self.probes = 0

    def __iter__(self):
        self.iter_calls += 1
        self.visits += len(self)
        return super().__iter__()

    def __getitem__(self, index):
        self.probes += 1
        return super().__getitem__(index)


def traced_peers(peers: dict) -> tuple[dict, dict[str, dict[str, TracingList]]]:
    traced = dict(peers)
    dists = {
        bucket: {key: TracingList(series) for key, series in metrics.items()}
        for bucket, metrics in peers[sc._DIST_KEY].items()
    }
    traced[sc._DIST_KEY] = dists
    return traced, dists


def count_operations(rows: list[dict], peers: dict) -> dict:
    """Count _num conversions and distribution visits, total and for one row."""
    original_num = sc._num
    calls = {"n": 0}

    def counting_num(value):
        calls["n"] += 1
        return original_num(value)

    # The first row is deliberately blank; use a row where every percentile is
    # populated so the per-row distribution counts show all nine metrics.
    probe_row = next(row for row in rows if len(score_row(row, peers)["_pct"]) == len(sc._DIST_METRICS))
    traced, dists = traced_peers(peers)
    sc._num = counting_num
    try:
        for row in rows:
            score_row(row, traced)
        total_num = calls["n"]

        calls["n"] = 0
        traced_one, dists_one = traced_peers(peers)
        score_row(probe_row, traced_one)
        one_num = calls["n"]
    finally:
        sc._num = original_num

    def summarise(dist: dict[str, dict[str, TracingList]]) -> dict:
        out = {}
        for bucket, metrics in dist.items():
            for key, series in metrics.items():
                out[f"{bucket}/{key}"] = {
                    "len": len(series),
                    "iter_calls": series.iter_calls,
                    "visits": series.visits,
                    "probes": series.probes,
                }
        return out

    all_dist = summarise(dists)
    one_dist = summarise(dists_one)
    return {
        "rows": len(rows),
        "num_calls_total": total_num,
        "num_calls_per_row": total_num / len(rows),
        "num_calls_single_row": one_num,
        "iter_calls_total": sum(d["iter_calls"] for d in all_dist.values()),
        "visits_total": sum(d["visits"] for d in all_dist.values()),
        "probes_total": sum(d["probes"] for d in all_dist.values()),
        "metrics_scanned_single_row": sum(1 for d in one_dist.values() if d["iter_calls"]),
        "metrics_probed_single_row": sum(1 for d in one_dist.values() if d["probes"]),
        "single_row_distributions": one_dist,
    }


def run_wall(rows: list[dict], peers: dict, reps: int, warmups: int) -> dict:
    def score_pass() -> float:
        start = time.perf_counter()
        for row in rows:
            score_row(row, peers)
        return time.perf_counter() - start

    for _ in range(warmups):
        score_pass()
    times = [score_pass() for _ in range(reps)]
    ordered = sorted(times)
    p95 = ordered[math.ceil(0.95 * len(ordered)) - 1]
    return {
        "reps": reps,
        "warmups": warmups,
        "rows": len(rows),
        "times": times,
        "median": statistics.median(times),
        "p95": p95,
        "min": ordered[0],
    }


def write_json(path: str, payload: Any) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_snap = sub.add_parser("snapshot")
    p_snap.add_argument("--out", required=True)
    p_snap.add_argument("--rows", type=int, default=N_ROWS)
    p_par = sub.add_parser("parity")
    p_par.add_argument("--baseline", required=True)
    p_par.add_argument("--rows", type=int, default=N_ROWS)
    p_cnt = sub.add_parser("counts")
    p_cnt.add_argument("--out", required=True)
    p_cnt.add_argument("--rows", type=int, default=N_ROWS)
    p_wall = sub.add_parser("wall")
    p_wall.add_argument("--out", required=True)
    p_wall.add_argument("--rows", type=int, default=N_ROWS)
    p_wall.add_argument("--reps", type=int, default=20)
    p_wall.add_argument("--warmups", type=int, default=5)
    p_sum = sub.add_parser("summarize")
    p_sum.add_argument("--files", nargs="+", required=True)
    args = parser.parse_args()

    if args.cmd == "summarize":
        runs = [json.loads(Path(f).read_text(encoding="utf-8")) for f in args.files]
        best = min(runs, key=lambda r: r["median"])
        print(json.dumps({
            "runs": [{"median": r["median"], "p95": r["p95"], "min": r["min"]} for r in runs],
            "best_median": best["median"],
            "best_p95": best["p95"],
        }))
        return

    rows = make_rows(args.rows)
    peers = peer_medians(rows)
    if args.cmd in ("snapshot", "parity"):
        current = snapshot(rows, peers)
        blob = json.dumps(current, separators=(",", ":"))
        digest = hashlib.sha256(blob.encode()).hexdigest()
        print(f"sha256={digest} frames={len(current['frames'])} rows={current['rows']}")
        if args.cmd == "snapshot":
            write_json(args.out, current)
        else:
            baseline = json.loads(Path(args.baseline).read_text(encoding="utf-8"))
            diff = _first_diff(baseline, current)
            print("PARITY" if diff is None else f"MISMATCH {diff}")
            if diff is not None:
                raise SystemExit(1)
    elif args.cmd == "counts":
        result = count_operations(rows, peers)
        write_json(args.out, result)
        print(json.dumps({k: v for k, v in result.items() if k != "single_row_distributions"}))
    elif args.cmd == "wall":
        result = run_wall(rows, peers, args.reps, args.warmups)
        write_json(args.out, result)
        print(json.dumps({"median": result["median"], "p95": result["p95"], "min": result["min"]}))


if __name__ == "__main__":
    main()
