#!/usr/bin/env python3
"""Max-pain hold/dump strategy — causal study on the 1-minute tape.

Hypothesis under test
---------------------
NIFTY oscillates around max pain. When it touches max pain and **holds**, it
squeezes away (usually up); when it loses it, it does not necessarily dump.
Filter candidates: touch number, 30-min TWAP (VWAP proxy), day regime, and
who is buying (CE/PE OI + premium flow).

Honesty contract
----------------
* A touch is detected at minute *t* from data <= t.
* Confirmation (hold + flow) is evaluated at *t+5*, entry at *t+6*.
* Exits start at *t+7*; a stop may fill on the entry+1 bar, a target too
  (kept conservative for the study).
* Costs use ``options_paper.costs.option_round_trip_cost`` on 1 lot.

Run:
    .venv/bin/python scripts/market/maxpain_strategy_study.py
    .venv/bin/python scripts/market/maxpain_strategy_study.py --date 2026-10-28
"""
from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import sys

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from options_paper.costs import option_round_trip_cost  # noqa: E402

TAPE = ROOT / "experiments" / "data" / "nifty_tape"
TOUCH = 10.0
COOLDOWN = 15
CONFIRM = 5          # minutes after the touch
HOLD_TOL = 5.0
LOT = 65
SL = 0.30
TP = 0.60
MAX_HOLD = 30


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
    mins = df.index.hour * 60 + df.index.minute
    df = df[(mins >= 9 * 60 + 15) & (mins <= 15 * 60 + 29)].copy()
    df["date"] = df.index.date
    df["twap"] = df["spot"].rolling(30, min_periods=10).mean()
    return df


def premium(df: pd.DataFrame, t, strike: float, side: str) -> float:
    row = df.loc[t]
    chain = row.get("chain")
    if isinstance(chain, dict):
        cell = chain.get(str(int(strike))) or chain.get(int(strike))
        if cell:
            px = cell[0] if side.upper() == "CE" else cell[1]
            if px:
                return float(px)
    px = row.get("atm_ce_ltp" if side.upper() == "CE" else "atm_pe_ltp")
    return float(px or 0)


def flow(df: pd.DataFrame, i: int, side: str) -> tuple[bool, bool]:
    """(bull_flow, bear_flow) from 5-min OI + premium changes."""
    j = max(0, i - 5)
    a, b = df.iloc[j], df.iloc[i]
    d_ce = float(b.get("ce_oi") or 0) - float(a.get("ce_oi") or 0)
    d_pe = float(b.get("pe_oi") or 0) - float(a.get("pe_oi") or 0)
    d_cp = float(b.get("atm_ce_ltp") or 0) - float(a.get("atm_ce_ltp") or 0)
    d_pp = float(b.get("atm_pe_ltp") or 0) - float(a.get("atm_pe_ltp") or 0)
    if b.get("atm_strike") != a.get("atm_strike"):
        d_cp = d_pp = 0.0
    bull = 0
    bear = 0
    if d_ce >= 300_000:
        bull += 1 if d_cp > 0 else 0
        bear += 1 if d_cp < 0 else 0
    if d_ce <= -300_000 and d_cp > 0:
        bull += 1
    if d_pe >= 300_000:
        bull += 1 if d_pp < 0 else 0
        bear += 1 if d_pp > 0 else 0
    if d_pe <= -300_000 and d_pp > 0:
        bear += 1
    return bull > bear, bear > bull


def touches(df: pd.DataFrame) -> list[int]:
    out = []
    last = None
    prev_dist = None
    for i, (t, r) in enumerate(df.iterrows()):
        mp = r.get("max_pain")
        spot = r.get("spot")
        if not isinstance(mp, (int, float)) or not isinstance(spot, (int, float)):
            continue
        dist = abs(float(spot) - float(mp))
        hit = prev_dist is not None and prev_dist > TOUCH >= dist
        prev_dist = dist
        if not hit:
            continue
        if last is not None and (t - df.index[last]).total_seconds() < COOLDOWN * 60:
            continue
        last = i
        out.append(i)
    return out


def simulate(df: pd.DataFrame, i_entry: int, side: str) -> dict | None:
    if i_entry + 2 >= len(df):
        return None
    row = df.iloc[i_entry]
    strike = float(row.get("atm_strike") or 0)
    entry = premium(df, df.index[i_entry], strike, side)
    if entry <= 0:
        return None
    for k in range(i_entry + 1, len(df)):
        t = df.index[k]
        px = premium(df, t, strike, side)
        if px <= 0:
            continue
        ret = px / entry - 1
        if ret <= -SL:
            px = entry * (1 - SL)
        elif ret >= TP:
            px = entry * (1 + TP)
        else:
            held = (t - df.index[i_entry]).total_seconds() / 60
            mp = float(df.iloc[k].get("max_pain") or 0)
            spot = float(df.iloc[k].get("spot") or 0)
            structural = side == "CE" and spot < mp - 15 or side == "PE" and spot > mp + 15
            if held >= MAX_HOLD or structural or t.time() >= pd.Timestamp("15:10").time():
                pass
            else:
                continue
        c = option_round_trip_cost(entry, px, LOT, is_short=False)
        return {
            "side": side, "strike": strike, "entry": entry, "exit": px,
            "net": c["net_pnl"], "gross": c["gross_pnl"], "costs": c["costs"],
            "ret": px / entry - 1, "t": df.index[i_entry], "date": df.iloc[i_entry]["date"],
        }
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=None)
    args = ap.parse_args(argv)
    frames = []
    for path in sorted(TAPE.glob("2026-*.jsonl")):
        if ".gaps." in path.name:
            continue
        df = load(path)
        if len(df) > 60:
            frames.append(df)
    if not frames:
        print("no tape")
        return 1

    if args.date:
        frames = [f for f in frames if str(f["date"].iloc[0]) == args.date]
        if not frames:
            print("no day")
            return 1

    trades = []
    for df in frames:
        idx = touches(df)
        for n, i in enumerate(idx, 1):
            if i + CONFIRM + 2 >= len(df):
                continue
            mp = float(df.iloc[i]["max_pain"])
            spot = float(df.iloc[i]["spot"])
            hold = bool((df.iloc[i + 1 : i + CONFIRM + 1]["spot"] >= mp - HOLD_TOL).all())
            c = i + CONFIRM
            above_twap = float(df.iloc[c]["spot"]) > float(df.iloc[c]["twap"])
            bull, bear = flow(df, c, "CE")
            regime = "bull" if float(df.iloc[c]["spot"]) > float(df.iloc[0]["spot"]) and above_twap else (
                "bear" if float(df.iloc[c]["spot"]) < float(df.iloc[0]["spot"]) and not above_twap else "neutral"
            )
            side = None
            if hold and above_twap and bull:
                side = "CE"
            elif (not hold) and (not above_twap) and bear:
                side = "PE"
            if side is None:
                continue
            tr = simulate(df, c + 1, side)
            if tr:
                tr.update({"touch_no": n, "hold": hold, "above_twap": above_twap,
                           "bull": bull, "bear": bear, "regime": regime})
                trades.append(tr)

    if not trades:
        print("no trades")
        return 1
    d = pd.DataFrame(trades)
    print(f"trades: {len(d)} over {d['date'].nunique()} days")
    print(f"  win% {(d['net'] > 0).mean():.0%}  net ₹{d['net'].sum():+,.0f}  "
          f"avg ₹{d['net'].mean():+,.0f}  PF {d.loc[d['net'] > 0, 'net'].sum() / max(1, -d.loc[d['net'] < 0, 'net'].sum()):.2f}")
    for key in ("regime", "hold", "above_twap", "touch_no"):
        print(f"\nby {key}:")
        for val, g in d.groupby(key):
            pf = g.loc[g["net"] > 0, "net"].sum() / max(1, -g.loc[g["net"] < 0, "net"].sum())
            print(f"  {str(val):<8} n={len(g):>3}  win={(g['net'] > 0).mean():.0%}  "
                  f"avg=₹{g['net'].mean():+,.0f}  net=₹{g['net'].sum():+,.0f}  PF={pf:.2f}")
    print("\nby day:")
    for day, g in d.groupby("date"):
        print(f"  {day}  n={len(g):>2}  net=₹{g['net'].sum():+,.0f}  win={(g['net'] > 0).mean():.0%}")
    print("\ntrades:")
    print(d[["t", "side", "strike", "entry", "exit", "ret", "net", "regime", "touch_no"]].to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
