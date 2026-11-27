#!/usr/bin/env python3
"""Merge raw pytest timing JSON(s) into a compact, budget-checkable summary.

Input is one or more documents written by ``tests/perf_plugin.py`` (each shard
writes its own). The output is a single summary that
``scripts/perf/check_test_budgets.py`` consumes. This script performs no
network, git, or pytest work -- it only reads/writes JSON.

The summary keeps the slow tail of the distribution (all tests >= 1 s) so the
budget checker can apply the "unmarked test > 2 s" rule with marker context.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List


def percentile95(values: List[float]) -> float:
    """Nearest-rank p95; returns 0.0 for an empty sample."""
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = max(0, min(int(math.ceil(0.95 * len(ordered))) - 1, len(ordered) - 1))
    return ordered[idx]


def _status_counts(tests: List[Dict[str, Any]]) -> Dict[str, int]:
    counts = {"passed": 0, "failed": 0, "skipped": 0, "errors": 0}
    for test in tests:
        status = str(test.get("status", "passed"))
        if status == "error":
            counts["errors"] += 1
        elif status in counts:
            counts[status] += 1
        else:
            counts["failed"] += 1
    return counts


def build_summary(raw_inputs: List[Path], wall_override: float | None) -> Dict[str, Any]:
    tests: List[Dict[str, Any]] = []
    fixtures: Dict[str, Dict[str, float]] = {}
    meta: Dict[str, Any] = {
        "tier": "",
        "marker_expr": "",
        "shard": "",
        "total_shards": "",
        "xdist_workers": 0,
    }
    collection_seconds = 0.0
    wall_seconds = 0.0
    missing: List[str] = []

    for path in raw_inputs:
        if not path.is_file():
            missing.append(str(path))
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            missing.append(f"{path} ({exc})")
            continue

        tests.extend(data.get("tests", []))
        for name, agg in data.get("fixtures", {}).items():
            dst = fixtures.setdefault(
                name, {"count": 0, "total_seconds": 0.0, "max_ms": 0.0}
            )
            dst["count"] += int(agg.get("count", 0))
            dst["total_seconds"] += float(agg.get("total_seconds", 0.0))
            dst["max_ms"] = max(dst["max_ms"], float(agg.get("max_ms", 0.0)))

        for key in ("tier", "marker_expr", "shard", "total_shards", "xdist_workers"):
            if not meta[key] and data.get(key):
                meta[key] = data[key]
        collection_seconds = max(
            collection_seconds, float(data.get("collection_seconds", 0.0))
        )
        wall_seconds = max(wall_seconds, float(data.get("wall_seconds", 0.0)))

    if missing:
        print(
            "WARN: missing/unreadable pytest timing inputs: " + ", ".join(missing),
            file=sys.stderr,
        )
    if wall_override is not None:
        wall_seconds = wall_override

    setup_values: List[float] = []
    enriched: List[Dict[str, Any]] = []
    for test in tests:
        phase = {
            key: float(test.get(key, 0.0) or 0.0)
            for key in ("setup", "call", "teardown")
        }
        duration = float(test.get("duration", sum(phase.values())) or 0.0)
        setup_values.append(phase["setup"] * 1000.0)
        enriched.append(
            {
                "nodeid": test.get("nodeid", ""),
                "file": test.get("file", ""),
                "status": test.get("status", "passed"),
                "markers": test.get("markers", []),
                "duration_seconds": round(duration, 6),
                "setup_seconds": round(phase["setup"], 6),
                "call_seconds": round(phase["call"], 6),
                "teardown_seconds": round(phase["teardown"], 6),
            }
        )

    by_duration = sorted(
        enriched, key=lambda t: t["duration_seconds"], reverse=True
    )
    slow_tests = [t for t in by_duration if t["duration_seconds"] >= 1.0]
    truncated = len(slow_tests) > 200
    slow_tests = slow_tests[:200]

    counts = _status_counts(enriched)
    return {
        "schema_version": 1,
        "generator": "scripts/perf/collect_pytest_timings.py",
        "tier": meta["tier"],
        "marker_expr": meta["marker_expr"],
        "shard": meta["shard"],
        "total_shards": meta["total_shards"],
        "xdist_workers": meta["xdist_workers"],
        "inputs": [str(p) for p in raw_inputs],
        "missing_inputs": missing,
        "wall_seconds": round(wall_seconds, 3),
        "collection_seconds": round(collection_seconds, 3),
        "test_count": len(enriched),
        **counts,
        "fixture_setup_p95_ms": round(percentile95(setup_values), 4),
        "fixture_setup_mean_ms": round(
            sum(setup_values) / len(setup_values) if setup_values else 0.0, 4
        ),
        "fixture_setup_max_ms": round(max(setup_values) if setup_values else 0.0, 4),
        "fixture_totals": fixtures,
        "slowest": by_duration[:10],
        "slow_tests": slow_tests,
        "slow_tests_truncated": truncated,
    }


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", "-i", action="append", default=[], required=True,
        help="raw pytest-timings JSON file (repeatable)",
    )
    parser.add_argument(
        "--output", "-o", required=True, help="where to write the summary JSON"
    )
    parser.add_argument(
        "--wall-seconds", type=float, default=None,
        help="override measured wall time (e.g. from CI `date`)",
    )
    args = parser.parse_args(argv)

    summary = build_summary([Path(p) for p in args.input], args.wall_seconds)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(
        f"pytest timing summary: {summary['test_count']} tests, "
        f"wall={summary['wall_seconds']:.1f}s, "
        f"collection={summary['collection_seconds']:.1f}s, "
        f"fixture p95={summary['fixture_setup_p95_ms']:.2f}ms -> {out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
