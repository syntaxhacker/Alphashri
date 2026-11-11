#!/usr/bin/env python3
"""Does NIFTY really travel wall-to-wall, and what happens at max pain?

Read-only study over the 1-minute tape (10 sessions). Definitions:

* **max-pain touch**: spot enters ±12 pts of the session's current ``max_pain``
  after being >12 away, with a 15-minute cooldown (distinct tests only).
* **hold**: every close in the next 30 min stays >= max_pain - 5.
* **wall touch**: spot comes within 10 pts of a wall strike from the tape's
  ``walls`` block (call or put).

For each touch we measure the next 15/30/60 min: forward return, max up/down,
and whether the far wall is reached.

Run:
    .venv/bin/python scripts/market/maxpain_touches.py
    .venv/bin/python scripts/market/maxpain_touches.py --date 2026-10-28
"""
from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import sys

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[2]
TAPE = ROOT / "experiments" / "data" / "nifty_tape"
TOUCH_PTS = 12.0
COOLDOWN_MIN = 15
HOLD_TOL = 5.0


def load(path: pathlib.Path) -> pd.DataFrame:
    rows = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
            r["t"] = pd.to_datetime(r["t"], utc=True).tz_convert("Asia/Kolkata").floor("min")
            rows.append(r)
        except Exception:
            continue
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df = df.sort_values("t").drop_duplicates("t").set_index("t")
    df["date"] = df.index.date
    mins = df.index.hour * 60 + df.index.minute
    return df[(mins >= 9 * 60 + 15) & (mins <= 15 * 60 + 29)].copy()


def walls_of(row) -> tuple[list[float], list[float]]:
    w = row.get("walls")
    if not isinstance(w, dict):
        return [], []
    calls = [float(x.get("strike")) for x in (w.get("calls") or []) if x.get("strike") is not None]
    puts = [float(x.get("strike")) for x in (w.get("puts") or []) if x.get("strike") is not None]
    return calls, puts


def touches(df: pd.DataFrame) -> list[dict]:
    out = []
    last_touch = None
    prev_dist = None
    for t, r in df.iterrows():
        mp = r.get("max_pain")
        spot = r.get("spot")
        if not isinstance(mp, (int, float)) or not isinstance(spot, (int, float)):
            continue
        dist = abs(float(spot) - float(mp))
        touched = prev_dist is not None and prev_dist > TOUCH_PTS >= dist
        prev_dist = dist
        if not touched:
            continue
        if last_touch is not None and (t - last_touch).total_seconds() < COOLDOWN_MIN * 60:
            continue
        last_touch = t
        calls, puts = walls_of(r)
        out.append({"t": t, "spot": float(spot), "mp": float(mp), "calls": calls, "puts": puts})
    return out


def forward(df: pd.DataFrame, t, mp: float, minutes: int) -> dict | None:
    i = df.index.get_loc(t)
    if i + minutes >= len(df):
        return None
    seg = df.iloc[i + 1 : i + minutes + 1]
    if seg["spot"].isna().any():
        return None
    spot = float(df.iloc[i]["spot"])
    fwd = float(seg["spot"].iloc[-1]) - spot
    up = float(seg["spot"].max()) - spot
    down = spot - float(seg["spot"].min())
    return {
        "fwd": fwd,
        "up": up,
        "down": down,
        "held": bool((seg["spot"] >= mp - HOLD_TOL).all()),
        "above": bool((seg["spot"] >= mp).all()),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=None, help="list touches for one day")
    args = ap.parse_args(argv)

    frames = []
    for path in sorted(TAPE.glob("2026-*.jsonl")):
        if ".gaps." in path.name:
            continue
        df = load(path)
        if len(df) > 30:
            frames.append(df)
    if not frames:
        print("no tape")
        return 1

    if args.date:
        df = [f for f in frames if str(f["date"].iloc[0]) == args.date]
        if not df:
            print("no day")
            return 1
        df = df[0]
        ts = touches(df)
        print(f"{args.date}: {len(ts)} max-pain touches")
        for n, x in enumerate(ts, 1):
            f15 = forward(df, x["t"], x["mp"], 15)
            f30 = forward(df, x["t"], x["mp"], 30)
            print(
                f"  #{n} {x['t']:%H:%M} spot {x['spot']:.1f} mp {x['mp']:.0f}  "
                f"fwd15 {f15['fwd']:+.0f} (up {f15['up']:.0f}/dn {f15['down']:.0f})  "
                f"fwd30 {f30['fwd']:+.0f} held={f30['held']}" if f15 and f30 else f"  #{n} {x['t']:%H:%M}"
            )
        return 0

    all_touches = []
    wall_summary = []
    for df in frames:
        day = str(df["date"].iloc[0])
        ts = touches(df)
        for n, x in enumerate(ts, 1):
            f15 = forward(df, x["t"], x["mp"], 15)
            f30 = forward(df, x["t"], x["mp"], 30)
            f60 = forward(df, x["t"], x["mp"], 60)
            if not f15 or not f30:
                continue
            calls = x["calls"]
            puts = x["puts"]
            far_call = min([c for c in calls if c >= x["spot"]], default=None)
            far_put = max([p for p in puts if p <= x["spot"]], default=None)
            reached_call = bool(far_call is not None and float(df.iloc[df.index.get_loc(x["t"]) + 1 : df.index.get_loc(x["t"]) + 31]["spot"].max()) >= far_call - 5)
            reached_put = bool(far_put is not None and float(df.iloc[df.index.get_loc(x["t"]) + 1 : df.index.get_loc(x["t"]) + 31]["spot"].min()) <= far_put + 5)
            all_touches.append({
                "date": day, "n": n, "t": x["t"], "spot": x["spot"], "mp": x["mp"],
                "fwd15": f15["fwd"], "fwd30": f30["fwd"], "fwd60": f60["fwd"] if f60 else None,
                "up30": f30["up"], "down30": f30["down"], "held30": f30["held"],
                "reached_call": reached_call, "reached_put": reached_put,
            })
        # wall-to-wall per day
        touched_calls = set()
        touched_puts = set()
        for t, r in df.iterrows():
            spot = r.get("spot")
            if not isinstance(spot, (int, float)):
                continue
            calls, puts = walls_of(r)
            for c in calls:
                if abs(c - spot) <= 10:
                    touched_calls.add(c)
            for p in puts:
                if abs(p - spot) <= 10:
                    touched_puts.add(p)
        wall_summary.append((day, len(touched_calls), len(touched_puts)))

    d = pd.DataFrame(all_touches)
    print(f"max-pain touches: {len(d)} over {d['date'].nunique()} days")
    print(f"  held above max pain for 30m: {d['held30'].mean():.0%}")
    print(f"  median fwd30: {d['fwd30'].median():+.1f} pts  (up30 {d['up30'].median():.0f} / down30 {d['down30'].median():.0f})")
    print(f"  reached the far call wall within 30m: {d['reached_call'].mean():.0%}")
    print(f"  reached the far put wall within 30m : {d['reached_put'].mean():.0%}")
    print("\nby touch number in the session:")
    for label, mask in (
        ("1st touch", d["n"] == 1),
        ("2nd touch", d["n"] == 2),
        ("3rd+ touch", d["n"] >= 3),
    ):
        s = d[mask]
        if len(s) == 0:
            continue
        held = s[s["held30"]]
        lost = s[~s["held30"]]
        print(
            f"  {label:<10} n={len(s):>3}  held={s['held30'].mean():.0%}  "
            f"fwd30={s['fwd30'].median():+.0f}  P(up30>=30)={(s['up30']>=30).mean():.0%}  "
            f"P(dn30>=30)={(s['down30']>=30).mean():.0%}"
        )
        if len(held):
            print(f"             held -> median fwd30 {held['fwd30'].median():+.0f}, P(up>=30) {(held['up30']>=30).mean():.0%}")
        if len(lost):
            print(f"             lost -> median fwd30 {lost['fwd30'].median():+.0f}, P(dn>=30) {(lost['down30']>=30).mean():.0%}")

    print("\nwall-to-wall per day (distinct call/put walls touched):")
    for day, nc, np_ in wall_summary:
        print(f"  {day}  calls {nc}  puts {np_}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
