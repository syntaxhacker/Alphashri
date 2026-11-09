"""Event study for Nifty OI setups (read-only research script).

Replays every stored tape, classifies each burst/squeeze with
``setup_for_burst`` and measures forward spot returns. Use this to decide
whether an alert setup actually pays before shipping a threshold.

Usage:
    .venv/bin/python scripts/market/nifty_setup_study.py
    .venv/bin/python scripts/market/nifty_setup_study.py --days 30 --verbose
"""

from __future__ import annotations

import argparse
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.reports_api.nifty import derive_tape_rows, read_tape  # noqa: E402
from api.reports_api.nifty_bursts import (  # noqa: E402
    detect_oi_bursts,
    detect_squeezes,
    session_trend,
)
from api.reports_api.nifty_fuel import setup_for_burst  # noqa: E402

TAPE_DIR = ROOT / "experiments" / "data" / "nifty_tape"
BULLISH = {"short_squeeze", "wall_squeeze", "put_squeeze", "fresh_long", "put_floor"}


def _forward(rows: list[dict], at: str, minutes: int):
    stamps = [r.get("t") for r in rows]
    try:
        i = stamps.index(at)
    except ValueError:
        return None
    spot = float(rows[i].get("spot") or 0)
    j = min(len(rows) - 1, i + minutes)
    if spot <= 0 or j <= i:
        return None
    seg = [float(r.get("spot") or spot) for r in rows[i : j + 1]]
    return (seg[-1] - spot) / spot * 100, (min(seg) - spot) / spot * 100, (max(seg) - spot) / spot * 100


def _row_at(rows: list[dict], at: str) -> dict:
    for row in rows:
        if row.get("t") == at:
            return row
    return {}


def _classify(burst: dict, rows: list[dict]) -> dict:
    row = _row_at(rows, str(burst.get("t") or ""))
    side = str(burst.get("side") or "call").lower()
    wall = row.get("call_wall") if side == "call" else row.get("put_wall")
    if wall is None:
        wall = burst.get("wall")
    return setup_for_burst(
        side=side,
        fuel=burst.get("fuel_state") or burst.get("flow") and {
            "covering": "writers_covering",
            "liquidation": "longs_liquidating",
            "buyers": "fresh_buyers",
            "writers": "fresh_sellers",
        }.get(str(burst.get("flow"))),
        trend=session_trend(rows, at_time=burst.get("t")),
        spot=burst.get("spot"),
        wall=wall,
        burst_type=burst.get("type"),
        score=burst.get("score"),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=0, help="most recent N tapes (0 = all)")
    parser.add_argument("--verbose", action="store_true", help="print each event")
    args = parser.parse_args()

    dates = sorted(
        p.stem for p in TAPE_DIR.glob("*.jsonl") if not p.name.endswith(".gaps.jsonl")
    )
    if args.days > 0:
        dates = dates[-args.days :]
    if not dates:
        print(f"no tapes under {TAPE_DIR}")
        return 1

    by_setup: dict[str, list[tuple]] = defaultdict(list)
    total = 0
    for date in dates:
        raw = read_tape(date)
        if not raw:
            continue
        rows = derive_tape_rows(raw)
        events = detect_oi_bursts(rows) + detect_squeezes(rows)
        total += len(events)
        for burst in events:
            setup = _classify(burst, rows)
            name = setup.get("setup")
            if not name:
                continue
            f5 = _forward(rows, burst["t"], 5)
            f15 = _forward(rows, burst["t"], 15)
            f30 = _forward(rows, burst["t"], 30)
            if not f30:
                continue
            by_setup[name].append((date, burst, f5, f15, f30, setup))
            if args.verbose:
                print(
                    date,
                    burst["t"][11:19],
                    name,
                    setup.get("horizon"),
                    f"spot={burst.get('spot')}",
                    f"5m={f5[0]:+.2f}% 15m={f15[0]:+.2f}% 30m={f30[0]:+.2f}%",
                )

    print(f"\ndates={len(dates)} events={total}")
    print("setup             n   5m      15m     30m     hit    MFE30   MAE30")
    for name, vals in sorted(by_setup.items(), key=lambda kv: -len(kv[1])):
        n = len(vals)
        avg5 = st.mean(v[2][0] for v in vals)
        avg15 = st.mean(v[3][0] for v in vals)
        avg30 = st.mean(v[4][0] for v in vals)
        direction = 1 if name in BULLISH else -1
        hit = sum(1 for v in vals if v[4][0] * direction > 0) / n * 100
        mfe = st.mean(v[4][2] for v in vals)
        mae = st.mean(v[4][1] for v in vals)
        print(f"{name:16} {n:4} {avg5:+6.2f}% {avg15:+6.2f}% {avg30:+6.2f}% {hit:5.1f}% {mfe:+6.2f}% {mae:+6.2f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
