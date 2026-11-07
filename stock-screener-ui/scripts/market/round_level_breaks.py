#!/usr/bin/env python3
"""What happens after NIFTY crosses a round 100 level?

Read-only study over the recorded 1-min tape. An event is the first 1-min close
at/above the next round hundred (22,600 -> 22,700 etc.). For each event we
measure the next 5/15/30 minutes: displacement, MFE/MAE, and whether the level
held (all closes above it) or failed (a close more than 2 pts back below).

The point is to answer "does a 22,700 break continue or fade?" with data instead
of a feeling. It is descriptive, in-sample, and overlapping — not a backtest.

Run:
    .venv/bin/python scripts/market/round_level_breaks.py
    .venv/bin/python scripts/market/round_level_breaks.py --level 22700
"""
from __future__ import annotations

import argparse
import pathlib
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from nifty_momentum_study import TAPE_DIR, add_features, load_day  # noqa: E402


def events_for_day(day: pd.DataFrame) -> pd.DataFrame:
    spot = day["spot"]
    prev = spot.shift(1)
    level = (np.floor(prev / 100.0) + 1.0) * 100.0
    hit = (prev < level) & (spot >= level)
    rows = []
    seen: dict[float, pd.Timestamp] = {}
    for t in day.index[hit.fillna(False)]:
        L = float(level.loc[t])
        last = seen.get(L)
        if last is not None and (t - last).total_seconds() < 1800:
            continue
        seen[L] = t
        i = day.index.get_loc(t)
        if i + 30 >= len(day):
            continue
        fwd = spot.iloc[i + 1 : i + 31]
        if fwd.isna().any():
            continue
        after15 = fwd.iloc[:15]
        rows.append(
            {
                "t": t,
                "date": t.date(),
                "level": L,
                "spot": float(spot.loc[t]),
                "gap_pts": float(spot.loc[t] - L),
                "fwd5": float(spot.iloc[i + 5] - spot.iloc[i]),
                "fwd15": float(spot.iloc[i + 15] - spot.iloc[i]),
                "fwd30": float(spot.iloc[i + 30] - spot.iloc[i]),
                "mfe30": float(fwd.max() - L),
                "mae30": float(L - fwd.min()),
                "held15": bool((after15 >= L).all()),
                "failed15": bool((after15 < L - 2.0).any()),
                "expansion5": float(day["expansion5"].iloc[i]) if pd.notna(day["expansion5"].iloc[i]) else np.nan,
                "vol_ratio": float(day["vol_ratio"].iloc[i]) if pd.notna(day["vol_ratio"].iloc[i]) else np.nan,
                "rsi14": float(day["rsi14"].iloc[i]) if pd.notna(day["rsi14"].iloc[i]) else np.nan,
                "tod": int(day["tod"].iloc[i]),
            }
        )
    return pd.DataFrame(rows)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--level", type=float, default=None, help="only this hundred, e.g. 22700")
    ap.add_argument("--min-date", default="2026-10-14")
    args = ap.parse_args(argv)

    frames = []
    for path in sorted(TAPE_DIR.glob("2026-*.jsonl")):
        if ".gaps." in path.name or path.stem < args.min_date:
            continue
        day = load_day(path)
        if day.empty or len(day) < 40:
            continue
        day = add_features(day)
        ev = events_for_day(day)
        if not ev.empty:
            frames.append(ev)
    if not frames:
        print("no events")
        return 1
    ev = pd.concat(frames, ignore_index=True)
    if args.level is not None:
        ev = ev[ev["level"] == args.level]
        if ev.empty:
            print(f"no crosses of {args.level:g} in the tape")
            return 0
        print(f"crosses of {args.level:g}: {len(ev)}")
        print(ev[["t", "spot", "fwd5", "fwd15", "fwd30", "mfe30", "mae30", "held15", "failed15", "expansion5", "vol_ratio"]]
              .to_string(index=False, float_format=lambda v: f"{v:.1f}"))
        return 0

    total = len(ev)
    print(f"upward 100-level crosses: {total} over {ev['date'].nunique()} days")
    print(f"  held above the level for 15 min : {ev['held15'].mean():.1%}")
    print(f"  failed back below (close -2)    : {ev['failed15'].mean():.1%}")
    print(f"  median fwd 15m / 30m            : {ev['fwd15'].median():+.1f} / {ev['fwd30'].median():+.1f} pts")
    print(f"  median MFE30 / MAE30            : {ev['mfe30'].median():.1f} / {ev['mae30'].median():.1f} pts")
    print(f"  P(fwd30 > 0)                    : {(ev['fwd30'] > 0).mean():.1%}")

    print("\nsplit by expansion at the break:")
    for label, mask in (
        ("expansion < 1.0 (quiet)", ev["expansion5"] < 1.0),
        ("expansion 1.0-1.5", (ev["expansion5"] >= 1.0) & (ev["expansion5"] < 1.5)),
        ("expansion >= 1.5 (hot)", ev["expansion5"] >= 1.5),
    ):
        s = ev[mask]
        if len(s) == 0:
            continue
        print(f"  {label:<24} n={len(s):>3}  held={s['held15'].mean():.0%}  "
              f"fwd30={s['fwd30'].median():+.1f}  MFE/MAE={s['mfe30'].median():.0f}/{s['mae30'].median():.0f}")

    print("\nsplit by time of day:")
    for label, mask in (
        ("09:15-10:45", ev["tod"] <= 90),
        ("10:45-13:00", (ev["tod"] > 90) & (ev["tod"] <= 225)),
        ("13:00-15:30", ev["tod"] > 225),
    ):
        s = ev[mask]
        if len(s) == 0:
            continue
        print(f"  {label:<12} n={len(s):>3}  held={s['held15'].mean():.0%}  "
              f"fwd30={s['fwd30'].median():+.1f}  MFE/MAE={s['mfe30'].median():.0f}/{s['mae30'].median():.0f}")

    print("\nby level:")
    for level, g in ev.groupby("level"):
        print(f"  {level:>7.0f}  n={len(g):>2}  held={g['held15'].mean():.0%}  "
              f"fwd30={g['fwd30'].median():+.1f}  MFE/MAE={g['mfe30'].median():.0f}/{g['mae30'].median():.0f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
