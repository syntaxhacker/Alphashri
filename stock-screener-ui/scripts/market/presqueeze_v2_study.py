#!/usr/bin/env python3
"""Pre-squeeze score v2 — causal study on the 1-minute tape.

The v1 score (``niftyPreMove.ts``) rewards calls *building* (+OI). Today's
12:58 squeeze was calls *covering* (CE OI falling) while puts were written and
the 22,700 call wall eroded. v1 peaked at 4/7 and never armed; v2 adds:

    put writing         PE OI +300k / 2m and PE premium down      +2
    call short-covering CE OI -500k / 2m and CE premium up         +2
    call premium        CE premium > delta-implied by 1%           +1
    wall erosion        nearest call-wall OI -150k / 2m, dist<=40  +1
    GEX                 fresh positive flip or +10 / 5m            +1
    participation       chain volume >= 1.8x its 20-min median      +1
    IV rich penalty     IV/RV > 1.2                                 -2

No lookahead: every feature at minute *i* uses rows ``<= i``; the event label
uses ``i+1 .. i+10``. The threshold (5) is fixed a priori.

Run:
    .venv/bin/python scripts/market/presqueeze_v2_study.py
    .venv/bin/python scripts/market/presqueeze_v2_study.py --date 2026-10-28 --timeline 12:30-13:05
"""
from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import sys

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[2]
TAPE_DIR = ROOT / "experiments" / "data" / "nifty_tape"
OUT_DIR = ROOT / "reports" / "presqueeze_study"


def load_day(path: pathlib.Path) -> pd.DataFrame:
    rows = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    df = pd.DataFrame(rows)
    if df.empty or "spot" not in df:
        return pd.DataFrame()
    df["t"] = pd.to_datetime(df["t"], utc=True).dt.tz_convert("Asia/Kolkata").dt.floor("min")
    df = df.sort_values("t").drop_duplicates("t", keep="last").set_index("t")
    keep = [
        c for c in (
            "spot", "ce_oi", "pe_oi", "ce_vol", "pe_vol", "atm_strike",
            "atm_ce_ltp", "atm_pe_ltp", "net_gex", "walls", "strikes_top",
            "pcr_oi",
        ) if c in df.columns
    ]
    df = df[keep].copy()
    full = pd.date_range(df.index.min(), df.index.max(), freq="1min")
    df = df.reindex(full)
    df["missing"] = df["spot"].isna().astype(int)
    for col in df.columns:
        if col not in ("walls", "strikes_top", "missing", "atm_strike"):
            df[col] = df[col].ffill(limit=3)
    df["date"] = df.index.date
    return df


def _strike_oi(row, strike: float, side: str) -> float | None:
    top = row.get("strikes_top")
    if not isinstance(top, list):
        return None
    for item in top:
        try:
            if abs(float(item.get("strike", -1)) - strike) < 0.5:
                return float(item.get("ce_oi" if side == "ce" else "pe_oi") or 0)
        except (TypeError, ValueError):
            continue
    return None


def _nearest_call_wall(row) -> tuple[float, float] | None:
    walls = row.get("walls")
    if not isinstance(walls, dict):
        return None
    calls = walls.get("calls") or []
    best = None
    for w in calls:
        try:
            d = float(w.get("distance"))
            if d >= 0 and (best is None or d < best[0]):
                best = (d, float(w.get("strike")))
        except (TypeError, ValueError):
            continue
    return best


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    spot = out["spot"]
    out["atr14"] = spot.diff().abs().rolling(14, min_periods=10).mean()
    out["rng5"] = spot.rolling(5, min_periods=3).max() - spot.rolling(5, min_periods=3).min()
    out["expansion5"] = out["rng5"] / out["rng5"].shift(1).rolling(30, min_periods=10).median()
    out["twap30"] = spot.rolling(30, min_periods=10).mean()
    out["tod"] = out.index.hour * 60 + out.index.minute - (9 * 60 + 15)

    out["d_ce2"] = out["ce_oi"] - out["ce_oi"].shift(2)
    out["d_pe2"] = out["pe_oi"] - out["pe_oi"].shift(2)
    out["d_spot2"] = spot - spot.shift(2)
    roll = out["atm_strike"] != out["atm_strike"].shift(2)
    out["d_ceprem2"] = np.where(roll, np.nan, out["atm_ce_ltp"] - out["atm_ce_ltp"].shift(2))
    out["d_peprem2"] = np.where(roll, np.nan, out["atm_pe_ltp"] - out["atm_pe_ltp"].shift(2))

    out["put"] = (out["d_pe2"] >= 300_000) & (out["d_peprem2"] <= -1.0)
    out["cover"] = (out["d_ce2"] <= -500_000) & (out["d_ceprem2"] >= 1.0)
    out["prem"] = (
        (out["atm_ce_ltp"].shift(2) > 0)
        & ((out["d_ceprem2"] - 0.5 * out["d_spot2"]) / out["atm_ce_ltp"].shift(2) > 0.01)
    )

    # Wall: nearest call wall at i, same strike's OI 2 min ago.
    wall_erode = []
    for i in range(len(out)):
        cur = _nearest_call_wall(out.iloc[i])
        if cur is None:
            wall_erode.append(False)
            continue
        dist, strike = cur
        if dist > 40 or i < 2:
            wall_erode.append(False)
            continue
        oi_now = _strike_oi(out.iloc[i], strike, "ce")
        oi_prev = _strike_oi(out.iloc[i - 2], strike, "ce")
        wall_erode.append(bool(oi_now is not None and oi_prev is not None and oi_now - oi_prev <= -150_000))
    out["wall"] = wall_erode

    gex = out.get("net_gex", pd.Series(index=out.index, dtype=float))
    out["gex"] = (gex > 0) & ((gex - gex.shift(5) >= 10) | (gex.shift(5) < 0))

    vol = out.get("ce_vol", pd.Series(index=out.index, dtype=float)) + out.get(
        "pe_vol", pd.Series(index=out.index, dtype=float)
    )
    out["vol1"] = vol.diff().clip(lower=0)
    out["rvol"] = out["vol1"] / out["vol1"].shift(1).rolling(20, min_periods=8).median()
    out["particip"] = out["rvol"] >= 1.8
    out["iv_rich"] = False  # tape has no IV/RV block; penalty applied live only
    out["v2"] = (
        2 * out["put"].astype(int)
        + 2 * out["cover"].astype(int)
        + out["prem"].astype(int)
        + out["wall"].astype(int)
        + out["gex"].astype(int)
        + out["particip"].astype(int)
    )
    # v1 for comparison: calls building, not covering.
    out["build"] = (out["d_ce2"] >= 500_000) & (out["d_ceprem2"] >= 1.0)
    out["v1"] = (
        2 * out["put"].astype(int)
        + 2 * out["build"].astype(int)
        + out["prem"].astype(int)
        + out["gex"].astype(int)
        + out["particip"].astype(int)
    )
    out["fwd_up10"] = spot.shift(-1).rolling(10, min_periods=10).max() - spot
    out["fwd_dn10"] = spot - spot.shift(-1).rolling(10, min_periods=10).min()
    out["fwd_rng10"] = out["fwd_up10"] + out["fwd_dn10"]
    out["gap_fwd"] = out["missing"].shift(-1).rolling(10, min_periods=10).sum()
    return out


def evaluate(df: pd.DataFrame, col: str, threshold: int, event_pts: float) -> dict:
    d = df[(df["gap_fwd"] <= 2) & df["fwd_up10"].notna()].copy()
    d["event"] = d["fwd_up10"] >= event_pts
    armed = d[col] >= threshold
    base = float(d["event"].mean())
    if armed.sum() == 0:
        return {"armed": 0, "precision": 0.0, "recall": 0.0, "lift": 0.0, "base": base}
    precision = float(d.loc[armed, "event"].mean())
    # Recall: an event is caught if any arm in the prior 10 minutes.
    arm_flag = (d[col] >= threshold).rolling(10, min_periods=1).max().astype(bool)
    caught = d["event"] & arm_flag
    recall = float(caught.sum() / max(d["event"].sum(), 1))
    return {
        "armed": int(armed.sum()),
        "precision": precision,
        "recall": recall,
        "lift": precision / base if base else 0.0,
        "base": base,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-date", default="2026-10-14")
    ap.add_argument("--threshold", type=int, default=5)
    ap.add_argument("--event-pts", type=float, default=40.0)
    ap.add_argument("--date", default=None, help="timeline for one day")
    ap.add_argument("--timeline", default=None, help="HH:MM-HH:MM")
    args = ap.parse_args(argv)

    frames = []
    for path in sorted(TAPE_DIR.glob("2026-*.jsonl")):
        if ".gaps." in path.name or path.stem < args.min_date:
            continue
        day = load_day(path)
        if day.empty or len(day) < 60:
            continue
        frames.append(add_features(day))
    if not frames:
        print("no tape")
        return 1
    df = pd.concat(frames)
    df = df[~df.index.duplicated(keep="first")]

    if args.date and args.timeline:
        day = df[df["date"].astype(str) == args.date]
        lo, hi = args.timeline.split("-")
        rows = day[(day.index.strftime("%H:%M") >= lo) & (day.index.strftime("%H:%M") <= hi)]
        print(f"{args.date} {args.timeline}  (v2 / v1)")
        for t, r in rows.iterrows():
            comps = "+".join(
                k for k in ("put", "cover", "prem", "wall", "gex", "particip") if bool(r[k])
            ) or "-"
            print(
                f"  {t:%H:%M}  spot {r['spot']:8.2f}  v2 {int(r['v2'])}  v1 {int(r['v1'])}  "
                f"rvol {r['rvol'] if pd.notna(r['rvol']) else 0:.1f}  {comps}"
            )
        return 0

    print(f"days={df['date'].nunique()}  rows={len(df)}  event=+{args.event_pts:g} pts in 10m")
    for col, name in (("v1", "v1 (build only)"), ("v2", "v2 (+cover +wall)")):
        s = evaluate(df, col, args.threshold, args.event_pts)
        print(
            f"  {name:<20} armed={s['armed']:>4}  P={s['precision']:.1%}  "
            f"R={s['recall']:.1%}  lift={s['lift']:.2f}x  base={s['base']:.1%}"
        )

    print("\nper-day v2:")
    for day, g in df.groupby("date"):
        if len(g) < 60:
            continue
        s = evaluate(g, "v2", args.threshold, args.event_pts)
        print(
            f"  {day}  n={len(g):>3}  base={s['base']:.1%}  armed={s['armed']:>3}  "
            f"P={s['precision']:.0%}  R={s['recall']:.0%}"
        )

    args_out = OUT_DIR
    args_out.mkdir(parents=True, exist_ok=True)
    cols = ["spot", "v1", "v2", "put", "cover", "prem", "wall", "gex", "particip",
            "rvol", "expansion5", "fwd_up10", "fwd_dn10"]
    df[cols].to_csv(args_out / "presqueeze_v2.csv")
    print(f"\nsaved -> {args_out / 'presqueeze_v2.csv'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
