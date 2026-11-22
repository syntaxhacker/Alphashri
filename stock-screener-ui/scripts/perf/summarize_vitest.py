#!/usr/bin/env python3
"""Summarize Vitest's JSON reporter output into a budget-checkable summary.

Vitest's ``--reporter=json`` emits a Jest-compatible document: top-level test
counts, a ``startTime``, and ``testResults`` (one per test file) whose
``assertionResults`` carry per-test ``duration`` in milliseconds. This script
reads that file and writes a compact summary consumed by
``scripts/perf/check_test_budgets.py``. It never launches vitest or changes
coverage/test behaviour.

Wall time is derived from ``startTime``/``endTime`` in the report (test
execution only, excluding worker startup). Pass ``--wall-seconds`` to override
it with an externally measured end-to-end value.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List


def build_summary(data: Dict[str, Any], wall_override: float | None) -> Dict[str, Any]:
    results = data.get("testResults", []) or []

    starts: List[float] = []
    ends: List[float] = []
    tests: List[Dict[str, Any]] = []

    for suite in results:
        suite_start = suite.get("startTime")
        suite_end = suite.get("endTime")
        if isinstance(suite_start, (int, float)):
            starts.append(float(suite_start))
        if isinstance(suite_end, (int, float)):
            ends.append(float(suite_end))
        suite_name = str(suite.get("name", ""))
        for assertion in suite.get("assertionResults", []) or []:
            duration_ms = float(assertion.get("duration", 0.0) or 0.0)
            tests.append(
                {
                    "file": suite_name,
                    "full_name": str(assertion.get("fullName", "")),
                    "status": str(assertion.get("status", "passed")),
                    "duration_seconds": round(duration_ms / 1000.0, 6),
                }
            )

    top_start = data.get("startTime")
    if isinstance(top_start, (int, float)):
        starts.append(float(top_start))
    if starts and ends:
        wall_seconds = (max(ends) - min(starts)) / 1000.0
    else:
        wall_seconds = 0.0
    if wall_override is not None:
        wall_seconds = wall_override

    by_duration = sorted(tests, key=lambda t: t["duration_seconds"], reverse=True)
    slow_tests = [t for t in by_duration if t["duration_seconds"] >= 1.0]
    truncated = len(slow_tests) > 200
    slow_tests = slow_tests[:200]

    status_counts: Dict[str, int] = {}
    for test in tests:
        status = test["status"]
        status_counts[status] = status_counts.get(status, 0) + 1

    return {
        "schema_version": 1,
        "generator": "scripts/perf/summarize_vitest.py",
        "tier": os.environ.get("PERF_TIER", ""),
        "wall_seconds": round(wall_seconds, 3),
        "success": bool(data.get("success", True)),
        "suite_count": len(results),
        "test_count": int(data.get("numTotalTests", len(tests))),
        "passed": int(data.get("numPassedTests", status_counts.get("passed", 0))),
        "failed": int(data.get("numFailedTests", status_counts.get("failed", 0))),
        "skipped": int(data.get("numPendingTests", status_counts.get("pending", 0))),
        "todo": int(data.get("numTodoTests", 0)),
        "slowest": by_duration[:10],
        "slow_tests": slow_tests,
        "slow_tests_truncated": truncated,
    }


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", "-i", required=True, help="vitest JSON report")
    parser.add_argument(
        "--output", "-o", required=True, help="where to write the summary JSON"
    )
    parser.add_argument(
        "--wall-seconds", type=float, default=None,
        help="override measured wall time (e.g. from CI `date`)",
    )
    args = parser.parse_args(argv)

    source = Path(args.input)
    if not source.is_file():
        print(f"WARN: vitest JSON report not found: {source}", file=sys.stderr)
        data: Dict[str, Any] = {}
    else:
        try:
            data = json.loads(source.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            print(f"WARN: could not read {source}: {exc}", file=sys.stderr)
            data = {}

    summary = build_summary(data, args.wall_seconds)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(
        f"vitest timing summary: {summary['test_count']} tests, "
        f"wall={summary['wall_seconds']:.1f}s -> {out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
