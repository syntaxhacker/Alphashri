#!/usr/bin/env python3
"""Forward-test the Nifty OI-burst signals against the local tape.

Answers one question: *if we had traded every burst the detector fired, how many
would have worked?* Evaluated on the UNDERLYING (spot) direction, which is what
the signal actually claims — option premium adds theta/IV noise on top.

Usage:
    .venv/bin/python scripts/eval_oi_bursts.py
    .venv/bin/python scripts/eval_oi_bursts.py --dedupe-min 5 --budget-days 20

Reads every ``experiments/data/nifty_tape/*.jsonl``. Re-run it as the tape
accumulates — two days (99 signals) is far too small to be decisive.

Caveat: forward windows overlap, so treat the counts as indicative. The
``--dedupe-min`` flag keeps at most one signal per (side, kind, N-minute bucket)
to cut the worst of that overlap.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SKIP_ALEMBIC", "1")

from api.reports_api.nifty import derive_tape_rows  # noqa: E402
from api.reports_api.nifty_bursts import (  # noqa: E402
    detect_oi_bursts,
    detect_squeezes,
    session_trend,
)

TAPE_DIR = Path(__file__).resolve().parent.parent / "experiments/data/nifty_tape"
HORIZONS = (5, 15, 30)
THRESHOLDS = (0, 5, 10, 15)


def signal_is_bullish(burst: dict) -> bool:
    """Direction the burst implies for the underlying.

    Momentum events (squeeze, premium impulse) follow the side that moved; OI
    events use the detector's ``bearish``/``flow`` reading (OI + premium, so a
    put build is bearish when buyers paid up rather than writers selling). When
    the tape has no premium the field is absent and the old OI-only rule — put
    build -> writers -> bullish — is the fallback.
    """
    if burst.get("type") in ("squeeze", "premium"):
        leg = str(burst.get("leg") or ("CE" if burst.get("side") == "call" else "PE"))
        return leg.upper() == "CE"
    if isinstance(burst.get("bearish"), bool):
        return not burst["bearish"]
    building = (burst.get("delta") or 0) > 0
    if building:
        return burst.get("side") != "call"  # call build -> puts, put build -> calls
    return burst.get("side") == "call"  # call unwind -> calls, put unwind -> puts


def flow_classified(burst: dict) -> bool:
    """True when the burst carries a buyer/writer read, not the OI-only guess."""
    return isinstance(burst.get("bearish"), bool) and bool(burst.get("flow"))


def load_day(path: Path) -> list[dict]:
    raw = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                raw.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return derive_tape_rows(raw)


def evaluate(dedupe_min: int):
    cells = {(a, t, h): [0, 0] for a in (True, False) for t in THRESHOLDS for h in HORIZONS}
    moves = {a: {h: [] for h in HORIZONS} for a in (True, False)}
    seen: set[tuple] = set()
    days_used = []
    flow_n = oi_fallback_n = 0

    for path in sorted(TAPE_DIR.glob("*.jsonl")):
        rows = load_day(path)
        if len(rows) < 30:
            continue
        days_used.append(f"{path.stem}({len(rows)})")
        idx = {r["t"]: i for i, r in enumerate(rows)}
        for burst in detect_oi_bursts(rows) + detect_squeezes(rows):
            i = idx.get(burst.get("t"))
            if i is None:
                continue
            key = (path.stem, burst.get("side"), burst.get("type"), i // dedupe_min)
            if key in seen:
                continue
            seen.add(key)
            if burst.get("type") not in ("squeeze", "premium"):
                if flow_classified(burst):
                    flow_n += 1
                else:
                    oi_fallback_n += 1
            bull = signal_is_bullish(burst)
            trend = session_trend(rows, burst.get("t"))
            aligned = burst.get("type") == "squeeze" or trend is None or (trend == "up") == bull
            for h in HORIZONS:
                j = i + h
                if j >= len(rows):
                    continue
                mv = rows[j]["spot"] - rows[i]["spot"]
                signed = mv if bull else -mv  # > 0 means the signal was right
                moves[aligned][h].append(signed)
                for t in THRESHOLDS:
                    cells[(aligned, t, h)][1] += 1
                    cells[(aligned, t, h)][0] += int(signed > t)
    return cells, moves, days_used, (flow_n, oi_fallback_n)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dedupe-min", type=int, default=5, help="one signal per side/kind per N minutes")
    args = ap.parse_args()

    cells, moves, days, (flow_n, fallback_n) = evaluate(max(1, args.dedupe_min))
    n = sum(cells[(True, 0, 15)][1] for _ in (0,)) + cells[(False, 0, 15)][1]
    print(f"tape days: {', '.join(days)}")
    print(f"signals (deduped to 1 per {args.dedupe_min} min): {n}")
    print(f"direction from OI+premium flow: {flow_n}   OI-only fallback: {fallback_n}\n")

    for aligned, name in ((True, "TREND-ALIGNED"), (False, "COUNTER-TREND")):
        print(name)
        print(f"  {'min move to count':>18s} " + " ".join(f"{'+' + str(h) + 'm':>11s}" for h in HORIZONS))
        for t in THRESHOLDS:
            out = []
            for h in HORIZONS:
                w, tot = cells[(aligned, t, h)]
                out.append(f"{w / tot * 100:5.0f}% ({tot:3d})" if tot else "      n/a  ")
            print(f"  {('> ' + str(t) + ' pts'):>18s} " + " ".join(f"{c:>11s}" for c in out))
        for h in HORIZONS:
            series = moves[aligned][h]
            if series:
                print(f"  mean @+{h}m {st.mean(series):+6.1f} pts  median {st.median(series):+6.1f}  n={len(series)}")
        print()


if __name__ == "__main__":
    main()
