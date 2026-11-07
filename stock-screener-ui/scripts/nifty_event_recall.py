#!/usr/bin/env python3
"""Recall audit for the Nifty wall-event feed.

Replays a recorded tape through :func:`detect_wall_events` and compares the
result with the alerts actually persisted by the bursts feed
(``experiments/data/nifty_wall_events/{date}.jsonl``).

The point is to catch the failure that is invisible from the UI: a detector
that works in tests but whose events never reached the journal. A non-zero
``missing`` means the feed dropped events; ``extra`` means the journal holds
alerts the current tape no longer reproduces (rewritten tape or a different
frame set).

Usage::

    python scripts/nifty_event_recall.py                # today (IST)
    python scripts/nifty_event_recall.py 2026-11-03
    python scripts/nifty_event_recall.py --json 2026-11-03
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

# scripts/ -> stock-screener-ui/ (repo root for imports)
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import config  # noqa: E402  (path bootstrap must run first)
from api.reports_api.nifty_wall_events import recall_report  # noqa: E402


def _fmt(event: dict) -> str:
    """One-line rendering of a wall event."""
    level = event.get("level")
    try:
        level_txt = f"{float(level):,.0f}"
    except (TypeError, ValueError):
        level_txt = "—"
    stamp = str(event.get("t") or "")[11:19]
    return (f"{stamp}  {event.get('kind', '?'):<9} "
            f"{event.get('side', '?'):<4} {level_txt}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("date", nargs="?",
                        default=datetime.now(config.IST).strftime("%Y-%m-%d"),
                        help="tape date YYYY-MM-DD (default: today IST)")
    parser.add_argument("--json", action="store_true",
                        help="print the raw report as JSON")
    args = parser.parse_args(argv)

    report = recall_report(args.date)
    if args.json:
        print(json.dumps(report, indent=2, default=str))
        return 0 if not report["missing"] else 1

    print(f"wall-event recall — {report['date']}")
    print(f"  journal:  {report['journal']}")
    print(f"  detected: {report['detected']}")
    print(f"  alerted:  {report['alerted']}")
    print(f"  matched:  {report['matched']}")
    print(f"  missing:  {len(report['missing'])}")
    for event in report["missing"]:
        print(f"    - {_fmt(event)}")
    if report["extra"]:
        print(f"  extra:    {len(report['extra'])} (in journal, not reproducible)")
        for event in report["extra"]:
            print(f"    + {_fmt(event)}")
    if not report["detected"] and not report["alerted"]:
        print("  (no tape rows and no journal for this date)")
    return 0 if not report["missing"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
