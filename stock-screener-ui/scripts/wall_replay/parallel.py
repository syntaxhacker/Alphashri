#!/usr/bin/env python3
"""Parallel date runner for the wall research scripts (default 6 workers).

Each session is independent, so `ProcessPoolExecutor` maps cleanly. The worker
sets the module-level tape path per process (the `batch` cache is per-process).
"""

from __future__ import annotations

import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "wall_replay"))

WORKERS = 6


def _worker(args):
    date, cfg, tape, which = args
    import batch  # noqa: F401  (import inside the process)
    batch.TAPE = Path(tape)
    batch._CACHE.clear()
    if which == "fade":
        import hist_fade as fn
    elif which == "fixed":
        import hist_fixed as fn
    else:
        import batch as fn  # module with .run
    return fn.run(date, cfg)


def run_dates(dates, cfg, tape, which="fade", workers=WORKERS):
    jobs = [(d, cfg, str(tape), which) for d in dates]
    with ProcessPoolExecutor(max_workers=workers) as ex:
        out = list(ex.map(_worker, jobs))
    return [t for ts in out for t in ts]


if __name__ == "__main__":
    print(f"default workers = {WORKERS}")
