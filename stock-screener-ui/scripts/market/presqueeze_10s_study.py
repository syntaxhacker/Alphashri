#!/usr/bin/env python3
"""v2 pre-squeeze score on the raw 10-second chain — causal, out-of-sample.

Uses only ``experiments/data/nifty_chain10s/<date>.jsonl``. At each snapshot:

* fixed strike universe = strikes present in the FIRST snapshot of the day
  (no future strikes leak in);
* totals are summed over that fixed set;
* the "wall" is the strike with the largest CE OI within +/-250 of spot, tracked
  against its own OI two minutes earlier;
* every feature uses snapshots ``<= i``; the label uses ``i+1 .. i+5min``.

Score v2: put writing (2) + call short-covering (2) + premium residual (1) +
wall erosion (1) + participation (1). Threshold 5, fixed a priori.

Run:
    .venv/bin/python scripts/market/presqueeze_10s_study.py
    .venv/bin/python scripts/market/presqueeze_10s_study.py --date 2026-10-28 --timeline 12:30-13:05
"""
from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import sys
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parents[2]
DIR = ROOT / "experiments" / "data" / "nifty_chain10s"


def load_day(date: str) -> list[dict]:
    path = DIR / f"{date}.jsonl"
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
            row["_t"] = datetime.fromisoformat(row["t"])
            if not (9 * 60 + 15 <= row["_t"].hour * 60 + row["_t"].minute <= 15 * 60 + 30):
                continue
            out.append(row)
        except (json.JSONDecodeError, KeyError, ValueError):
            continue
    out.sort(key=lambda r: r["_t"])
    return out


def cell(row: dict, strike: float):
    for c in row.get("rows") or []:
        if len(c) >= 7 and abs(float(c[0]) - strike) < 0.5:
            return c
    return None


def features(rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    first = rows[0]
    spot0 = float(first.get("spot") or 0)
    fixed = {float(c[0]) for c in first.get("rows") or [] if abs(float(c[0]) - spot0) <= 300}
    if not fixed:
        fixed = {float(c[0]) for c in first.get("rows") or []}
    out = []
    for i, r in enumerate(rows):
        spot = float(r.get("spot") or 0)
        ce = sum(float(c[2]) for c in r.get("rows") or [] if len(c) >= 7 and float(c[0]) in fixed)
        pe = sum(float(c[5]) for c in r.get("rows") or [] if len(c) >= 7 and float(c[0]) in fixed)
        vol = sum(float(c[3]) + float(c[6]) for c in r.get("rows") or [] if len(c) >= 7 and float(c[0]) in fixed)
        # ATM premium at the fixed strike nearest the day's first spot.
        atm_ref = min(fixed, key=lambda k: abs(k - spot0))
        atm = cell(r, atm_ref)
        cp = float(atm[1]) if atm else 0.0
        pp = float(atm[4]) if atm else 0.0
        # Wall = biggest CE OI within +/-250 of current spot.
        wall = None
        row_oi: dict[float, float] = {}
        for c in r.get("rows") or []:
            if len(c) < 7:
                continue
            k = float(c[0])
            if abs(k - spot) <= 300:
                row_oi[k] = float(c[2])
            if abs(k - spot) <= 250 and (wall is None or float(c[2]) > wall[0]):
                wall = (float(c[2]), k)
        out.append({"i": i, "t": r["_t"], "spot": spot, "ce": ce, "pe": pe, "vol": vol,
                    "cp": cp, "pp": pp, "wall_oi": wall[0] if wall else 0.0,
                    "wall_strike": wall[1] if wall else 0.0, "row_oi": row_oi})
    return out


def score(series: list[dict], i: int, horizon_s: float = 120.0) -> tuple[int, list[str]]:
    def ago(sec):
        j = i
        while j > 0 and (series[i]["t"] - series[j]["t"]).total_seconds() < sec:
            j -= 1
        return j
    j = ago(horizon_s)
    cur, prev = series[i], series[j]
    comps = []
    put = (cur["pe"] - prev["pe"] >= 300_000) and (cur["pp"] - prev["pp"] <= -1)
    cover = (cur["ce"] - prev["ce"] <= -500_000) and (cur["cp"] - prev["cp"] >= 1)
    if put:
        comps += ["put", "put"]  # weight 2
    if cover:
        comps += ["cover", "cover"]  # weight 2
    if prev["cp"] > 0 and (cur["cp"] - prev["cp"] - 0.5 * (cur["spot"] - prev["spot"])) / prev["cp"] > 0.01:
        comps.append("prem")
    # wall: same strike, OI down 150k, price within 40
    if cur["wall_strike"] > 0 and abs(cur["spot"] - cur["wall_strike"]) <= 40:
        prev_oi = prev.get("row_oi", {}).get(cur["wall_strike"])
        if prev_oi is not None and cur["wall_oi"] - prev_oi <= -150_000:
            comps.append("wall")
    # participation: 60s volume vs prior 20 min median
    k = ago(60)
    v = cur["vol"] - series[k]["vol"]
    base = []
    for m in range(max(0, i - 120), i, 6):
        kk = ago_at(series, m, 60)
        if kk < m:
            base.append(series[m]["vol"] - series[kk]["vol"])
    med = statistics.median(base) if base else 0
    if med > 0 and v / med >= 1.8:
        comps.append("rvol")
    return len(comps), comps


def ago_at(series, i, sec):
    j = i
    while j > 0 and (series[i]["t"] - series[j]["t"]).total_seconds() < sec:
        j -= 1
    return j


def first_arm(series, lo: str, hi: str):
    for s in series:
        hm = s["t"].strftime("%H:%M")
        if lo <= hm <= hi:
            sc, comps = score(series, s["i"])
            if sc >= 5:
                return s, sc, comps
    return None, 0, []


def evaluate(date: str, horizon_s: float, move: float) -> dict:
    rows = load_day(date)
    series = features(rows)
    if len(series) < 100:
        return {"date": date, "n": len(series), "armed": 0}
    arm = []
    for i in range(12, len(series)):
        sc, comps = score(series, i)
        if sc >= 5:
            arm.append((i, sc, comps))
    # forward up move within horizon
    events = 0
    caught = 0
    leads = []
    for i, s in enumerate(series):
        j = i
        while j < len(series) and (series[j]["t"] - s["t"]).total_seconds() <= horizon_s:
            j += 1
        if j >= len(series):
            continue
        if j <= i + 1:
            continue
        hi = max(x["spot"] for x in series[i + 1 : j])
        if hi - s["spot"] >= move:
            events += 1
            prior = [a for a in arm if 0 < i - a[0] <= 60 and (s["t"] - series[a[0]]["t"]).total_seconds() <= 600]
            if prior:
                caught += 1
                leads.append((s["t"] - series[prior[0][0]]["t"]).total_seconds())
    prec = 0.0
    for i, sc, comps in arm:
        j = i
        while j < len(series) and (series[j]["t"] - series[i]["t"]).total_seconds() <= horizon_s:
            j += 1
        if j < len(series) and j > i + 1:
            hi = max(x["spot"] for x in series[i + 1 : j])
            if hi - series[i]["spot"] >= move:
                prec += 1
    return {
        "date": date, "n": len(series), "armed": len(arm),
        "events": events, "caught": caught,
        "precision": prec / len(arm) if arm else 0.0,
        "recall": caught / events if events else 0.0,
        "median_lead_min": (statistics.median(leads) / 60.0) if leads else 0.0,
        "base": events / max(1, len(series)),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=None)
    ap.add_argument("--timeline", default=None)
    ap.add_argument("--move", type=float, default=40.0)
    ap.add_argument("--horizon", type=float, default=300.0)
    args = ap.parse_args(argv)

    if args.date and args.timeline:
        series = features(load_day(args.date))
        lo, hi = args.timeline.split("-")
        for s in series:
            hm = s["t"].strftime("%H:%M")
            if lo <= hm <= hi:
                sc, comps = score(series, s["i"])
                print(f"  {hm}:{s['t'].second:02d} spot {s['spot']:8.2f} score {sc}  {'+'.join(comps) or '-'}")
        return 0

    dates = sorted(p.stem for p in DIR.glob("2026-*.jsonl"))
    print(f"10s days: {dates}  event=+{args.move:g} pts in {args.horizon/60:.0f}m")
    for d in dates:
        res = evaluate(d, args.horizon, args.move)
        if "events" not in res:
            print(f"  {d}: only {res['n']} snapshots"); continue
        print(
            f"  {d}  n={res['n']:>4}  base={res['base']:.1%}  armed={res['armed']:>3}  "
            f"P={res['precision']:.0%}  R={res['recall']:.0%}  lead={res['median_lead_min']:.1f}m"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
