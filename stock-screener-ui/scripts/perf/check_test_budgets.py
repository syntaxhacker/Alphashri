#!/usr/bin/env python3
"""Compare timing summaries against ``perf/budgets.json``.

WARNING-ONLY by default: misses are printed with actionable numbers but the
process exits 0, so CI cannot turn red on a noisy first week of measurements.
Pass ``--strict`` (later, once a baseline week exists) to exit 1 on misses.
Budgets are read, never rewritten -- there is no silent ratchet downward.

Tiers understood (from the summary's ``tier`` field):
  backend-pr-fast, backend-full, frontend-changed, frontend-full.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

BACKEND_TIERS = {
    "backend-pr-fast": "pr_fast",
    "backend-full": "full",
}
FRONTEND_TIERS = {
    "frontend-changed": "changed",
    "frontend-full": "full",
}


def check_summary(
    summary: Dict[str, Any], budgets: Dict[str, Any]
) -> List[str]:
    """Return a list of human-readable, actionable misses for one summary."""
    misses: List[str] = []
    tier = str(summary.get("tier", ""))
    label = tier or "<unknown tier>"

    if tier in BACKEND_TIERS:
        backend = budgets.get("backend", {})
        key = BACKEND_TIERS[tier]
        wall_budget = float(backend.get(key, {}).get("wall_seconds", 0))
        wall = float(summary.get("wall_seconds", 0.0))
        if wall_budget and wall >= wall_budget:
            misses.append(
                f"{label} wall {wall:.1f}s >= {wall_budget:.0f}s budget "
                f"(over by {wall - wall_budget:.1f}s); shard={summary.get('shard') or 'n/a'}"
            )

        collect_budget = float(backend.get("collection_seconds", 0))
        collect = float(summary.get("collection_seconds", 0.0))
        if collect_budget and collect >= collect_budget:
            misses.append(
                f"{label} collection {collect:.1f}s >= {collect_budget:.0f}s budget "
                "(check conftest imports / heavy collection hooks)"
            )

        p95_budget = float(backend.get("fixture_setup_p95_ms", 0))
        p95 = float(summary.get("fixture_setup_p95_ms", 0.0))
        if p95_budget and p95 >= p95_budget:
            misses.append(
                f"{label} fixture setup p95 {p95:.2f}ms >= {p95_budget:.0f}ms budget "
                "(find the expensive fixture in the timing artifact)"
            )

        max_seconds = float(backend.get("unmarked_test_max_seconds", 0))
        exempt = set(backend.get("unmarked_exempt_markers", []))
        if max_seconds:
            offenders = [
                t
                for t in summary.get("slow_tests", [])
                if float(t.get("duration_seconds", 0.0)) > max_seconds
                and not (set(t.get("markers", [])) & exempt)
            ]
            for test in offenders[:10]:
                misses.append(
                    f"{label} unmarked slow test {test.get('nodeid', '?')}: "
                    f"{test['duration_seconds']:.2f}s > {max_seconds:g}s "
                    "(mark it slow or make it faster)"
                )
            if len(offenders) > 10:
                misses.append(
                    f"{label} ...and {len(offenders) - 10} more unmarked slow tests "
                    "(see the timing artifact)"
                )

    elif tier in FRONTEND_TIERS:
        frontend = budgets.get("frontend", {})
        key = FRONTEND_TIERS[tier]
        wall_budget = float(frontend.get(key, {}).get("wall_seconds", 0))
        wall = float(summary.get("wall_seconds", 0.0))
        if wall_budget and wall >= wall_budget:
            misses.append(
                f"{label} wall {wall:.1f}s >= {wall_budget:.0f}s budget "
                f"(over by {wall - wall_budget:.1f}s)"
            )
    else:
        misses.append(
            f"unknown tier {label!r}: no budget applied "
            "(set PERF_TIER in CI: backend-pr-fast|backend-full|frontend-changed|frontend-full)"
        )

    return misses


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--budgets", default="perf/budgets.json")
    parser.add_argument(
        "--summary", "-s", action="append", default=[],
        help="summary JSON to check (repeatable)",
    )
    parser.add_argument(
        "--strict", action="store_true",
        help="exit 1 on misses (default: warning only, exit 0)",
    )
    args = parser.parse_args(argv)

    budget_path = Path(args.budgets)
    if not budget_path.is_file():
        print(f"ERROR: budgets file not found: {budget_path}", file=sys.stderr)
        return 2
    budgets = json.loads(budget_path.read_text(encoding="utf-8"))

    if not args.summary:
        print("ERROR: pass at least one --summary JSON", file=sys.stderr)
        return 2

    all_misses: List[str] = []
    for raw in args.summary:
        path = Path(raw)
        if not path.is_file():
            print(f"WARN: summary not found: {path}", file=sys.stderr)
            continue
        summary = json.loads(path.read_text(encoding="utf-8"))
        misses = check_summary(summary, budgets)
        if misses:
            all_misses.extend(misses)
            print(f"[{path}]")
            for miss in misses:
                print(f"  WARN  {miss}")
        else:
            print(
                f"[{path}] OK: {summary.get('tier', '?')} within budget "
                f"(wall={float(summary.get('wall_seconds', 0)):.1f}s)"
            )

    if all_misses:
        print(
            f"\n{len(all_misses)} budget miss(es). "
            + ("Failing (--strict)." if args.strict else "Warning only (no hard fail yet).")
        )
        return 1 if args.strict else 0

    print("\nAll configured test budgets met.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
