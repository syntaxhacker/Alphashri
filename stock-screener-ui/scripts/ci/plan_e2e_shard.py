#!/usr/bin/env python3
"""Assign E2E spec files to shards using measured per-file durations.

The manifest at perf/e2e-file-durations.json holds per-file wall-clock totals
from a prior full Playwright run. Files missing from it get a conservative
5.0-second estimate. Assignment is deterministic longest-processing-time
first (LPT): sort by descending measured seconds (ties by path), then place
each file in the shard with the smallest (total_seconds, file_count, index).

This is a CI-only tool; it has no third-party dependencies.
"""

import argparse
import json
import sys
from pathlib import Path

# Script lives at <repo>/scripts/ci/plan_e2e_shard.py, where <repo> is the
# stock-screener-ui directory. All paths below are relative to <repo>.
REPO_ROOT = Path(__file__).resolve().parents[2]
SPEC_ROOT = REPO_ROOT / "tests" / "e2e"
DURATIONS_PATH = REPO_ROOT / "perf" / "e2e-file-durations.json"
DEFAULT_SECONDS = 5.0


def load_durations():
    """Return the {spec path: seconds} map from the measured manifest."""
    with DURATIONS_PATH.open(encoding="utf-8") as fh:
        manifest = json.load(fh)
    files = manifest.get("files", {})
    return {path: float(entry["seconds"]) for path, entry in files.items()}


def discover_specs():
    """Return repo-relative paths of every E2E spec file, sorted."""
    if not SPEC_ROOT.is_dir():
        raise SystemExit(f"::error::E2E spec directory not found: {SPEC_ROOT}")
    return sorted(
        path.relative_to(REPO_ROOT).as_posix()
        for path in SPEC_ROOT.rglob("*.spec.ts")
        if path.is_file()
    )


def plan(specs, durations, count):
    """Return a list of `count` lists of spec paths (deterministic LPT)."""
    shards = [[] for _ in range(count)]
    totals = [0.0] * count
    sizes = [0] * count
    for path in sorted(specs, key=lambda p: (-durations.get(p, DEFAULT_SECONDS), p)):
        shard = min(range(count), key=lambda i: (totals[i], sizes[i], i))
        shards[shard].append(path)
        totals[shard] += durations.get(path, DEFAULT_SECONDS)
        sizes[shard] += 1
    return shards


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shard", type=int, help="1-based shard index to print")
    parser.add_argument("--count", type=int, default=16, help="number of shards (default: 16)")
    parser.add_argument("--check", action="store_true", help="print a per-shard summary and validate the plan")
    args = parser.parse_args()

    if args.count < 1:
        parser.error("--count must be at least 1")
    if not args.check and args.shard is None:
        parser.error("one of --shard or --check is required")
    if args.shard is not None and not 1 <= args.shard <= args.count:
        parser.error(f"--shard must be between 1 and {args.count}")

    if not DURATIONS_PATH.is_file():
        raise SystemExit(f"::error::duration manifest not found: {DURATIONS_PATH}")
    specs = discover_specs()
    durations = load_durations()
    shards = plan(specs, durations, args.count)

    if args.check:
        assigned = [path for shard in shards for path in shard]
        errors = []
        for index, shard in enumerate(shards, start=1):
            if not shard:
                errors.append(f"shard {index}/{args.count} is empty")
        if len(assigned) != len(set(assigned)):
            errors.append("spec file assigned to more than one shard")
        if set(assigned) != set(specs):
            errors.append("some spec files are unassigned or unknown files were assigned")
        for index, shard in enumerate(shards, start=1):
            seconds = sum(durations.get(path, DEFAULT_SECONDS) for path in shard)
            print(f"shard {index}/{args.count}: {len(shard)} files, {seconds:.3f}s")
        if errors:
            for error in errors:
                print(f"::error::{error}", file=sys.stderr)
            return 1
        print(f"OK: {len(specs)} spec files across {args.count} shards")
        return 0

    for path in shards[args.shard - 1]:
        print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
