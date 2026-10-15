#!/usr/bin/env python3
"""Non-GEX mean-reversion rules on MNQ front-month 1-minute bars.

Rules (no options data needed):
  * overnight-value failed breakout: short after price pokes above the
    overnight VAH and closes back below it; long mirror at VAL.
  * target = overnight POC (or developing VWAP).
  * stop = failure extreme +/- buffer.
  * EOD exit at 16:00 ET.
Baselines: buy&hold RTH, and random entry/exit.

Usage:
  python run_value_reversion.py --start 2023-10-31 --end 2026-09-29
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from collections import defaultdict
from datetime import time as dtime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import ET, UTC, Trade, summarize, per_session_table, simulate_bar_path, value_area  # noqa: E402
from data_store import build_front_month  # noqa: E402


def sessions_from_bars(df: pd.DataFrame):
    """Yield (session_day_iso, overnight_bars, rth_bars) dicts, ET-based."""
    ts = pd.to_datetime(df["ts"], unit="ms", utc=True).dt.tz_convert(ET)
    et = pd.DataFrame({
        "ts": df["ts"].values,
        "open": df["open"].values, "high": df["high"].values,
        "low": df["low"].values, "close": df["close"].values,
        "volume": df["volume"].values,
        "h": ts.dt.hour.values, "m": ts.dt.minute.values, "d": ts.dt.date.values,
    })
    tod = et["h"] * 60 + et["m"]
    session_day = pd.to_datetime(et["d"]).dt.date + pd.to_timedelta(
        np.where(tod >= 18 * 60, 1, 0), unit="D")
    et["session"] = session_day
    et["tod"] = tod
    for day, grp in et.groupby("session"):
        on = grp[grp["tod"] < 9 * 60 + 30]
        rth = grp[(grp["tod"] >= 9 * 60 + 30) & (grp["tod"] < 16 * 60)]
        if len(rth) < 60 or len(on) < 60:
            continue
        on_b = on.sort_values("ts").to_dict("records")
        rth_b = rth.sort_values("ts").to_dict("records")
        yield str(day), on_b, rth_b


def overnight_value(on_bars, bin_size: float):
    profile: dict[float, float] = defaultdict(float)
    for b in on_bars:
        price = round(b["close"] / bin_size) * bin_size
        profile[price] += b["volume"]
    return value_area(profile)


def rth_vwap(bars, upto_idx):
    num = den = 0.0
    for b in bars[:upto_idx + 1]:
        tp = (b["high"] + b["low"] + b["close"]) / 3
        num += tp * b["volume"]
        den += b["volume"]
    return num / den if den else None


def find_failed_breakout(rth_bars, level, side, stop_buffer, target_mode, poc, opposite, vwap_at,
                         max_excursion=None):
    """Return (entry_idx, entry, stop, target) or None."""
    above = False
    extreme = None
    for i, b in enumerate(rth_bars):
        if side == "short":
            if b["high"] > level:
                above = True
                extreme = b["high"] if extreme is None else max(extreme, b["high"])
            if above and b["close"] < level:
                if max_excursion is not None and (extreme - level) > max_excursion:
                    return None
                entry = b["close"]
                stop = extreme + stop_buffer
                tg = {"poc": poc, "opposite": opposite, "vwap": vwap_at(i)}[target_mode]
                if tg is None or (side == "short" and tg >= entry) or (side == "long" and tg <= entry):
                    tg = entry - 20 if side == "short" else entry + 20
                if i >= len(rth_bars) - 2:
                    return None
                return i, entry, stop, tg
        else:
            if b["low"] < level:
                above = True
                extreme = b["low"] if extreme is None else min(extreme, b["low"])
            if above and b["close"] > level:
                if max_excursion is not None and (level - extreme) > max_excursion:
                    return None
                entry = b["close"]
                stop = extreme - stop_buffer
                tg = {"poc": poc, "opposite": opposite, "vwap": vwap_at(i)}[target_mode]
                if tg is None or (side == "short" and tg >= entry) or (side == "long" and tg <= entry):
                    tg = entry - 20 if side == "short" else entry + 20
                if i >= len(rth_bars) - 2:
                    return None
                return i, entry, stop, tg
    return None


def run(df, stop_buffer=15.0, stop_sweep=None, bin_size=5.0, target_mode="poc",
        both_sides=True, max_excursion=None):
    trades = []
    bhold = []
    sessions = 0
    for day, on_b, rth_b in sessions_from_bars(df):
        poc, vah, val = overnight_value(on_b, bin_size)
        if poc is None:
            continue
        sessions += 1
        # buy & hold RTH baseline
        bh = Trade(day=day, side="long", entry_ts=rth_b[0]["ts"], entry=rth_b[0]["open"],
                   stop=0, target=1e9, rule="BUY_HOLD")
        bh.exit, bh.exit_ts, bh.reason = rth_b[-1]["close"], rth_b[-1]["ts"], "EOD"
        bh.points = bh.exit - bh.entry
        bh.mfe = max(b["high"] for b in rth_b) - bh.entry
        bh.mae = bh.entry - min(b["low"] for b in rth_b)
        bhold.append(bh)

        if not both_sides:
            continue
        for side, level, opp in (("short", vah, val), ("long", val, vah)):
            res = find_failed_breakout(rth_b, level, side, stop_buffer, target_mode,
                                       poc, opp, lambda i: rth_vwap(rth_b, i),
                                       max_excursion=max_excursion)
            if res is None:
                continue
            i, entry, stop, tg = res
            t = simulate_bar_path(side, entry, stop, tg, rth_b, i, day,
                                  rule=f"FB_{side}_{target_mode}")
            t.extras = {"vah": vah, "val": val, "poc": poc}
            trades.append(t)
    return trades, bhold, sessions


def random_baseline(df, n_iter=3000, seed=7):
    rng = random.Random(seed)
    sym = []
    for day, on_b, rth_b in sessions_from_bars(df):
        if len(rth_b) < 60:
            continue
        for _ in range(3):
            i = rng.randrange(1, len(rth_b) - 2)
            side = rng.choice(["long", "short"])
            entry = rth_b[i]["close"]
            if side == "long":
                stop = entry - 15
                target = entry + 15
            else:
                stop = entry + 15
                target = entry - 15
            t = simulate_bar_path(side, entry, stop, target, rth_b, i, day, rule="RANDOM")
            sym.append(t)
    return sym


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2023-10-31")
    ap.add_argument("--end", default="2026-09-29")
    ap.add_argument("--bin", type=float, default=5.0)
    ap.add_argument("--buffer", type=float, default=15.0)
    ap.add_argument("--target", default="poc", choices=["poc", "opposite", "vwap"])
    ap.add_argument("--max-excursion", type=float, default=None)
    ap.add_argument("--out", default="/tmp/opencode/value_reversion.json")
    args = ap.parse_args()

    df = build_front_month(args.start, args.end)
    df = df[pd.to_datetime(df["ts"], unit="ms", utc=True).dt.date
            >= pd.Timestamp(args.start).date()]

    main_trades, bhold, sessions = run(df, stop_buffer=args.buffer, bin_size=args.bin,
                                       target_mode=args.target, max_excursion=args.max_excursion)
    rand = random_baseline(df)

    sweep = {}
    for buf in [8, 12, 15, 20, 25, 30, 40, 50]:
        tr, _, _ = run(df, stop_buffer=float(buf), bin_size=args.bin, target_mode=args.target,
                       max_excursion=args.max_excursion)
        sweep[buf] = summarize(tr, f"buffer={buf}")

    capped = {}
    for me in [20, 30, 40, 60]:
        tr, _, _ = run(df, stop_buffer=15.0, bin_size=args.bin, target_mode=args.target,
                       max_excursion=float(me))
        capped[f"max_exc={me}"] = summarize(tr, f"cap {me}")

    result = {
        "config": vars(args),
        "sessions": sessions,
        "main": summarize(main_trades, f"FB target={args.target} buffer={args.buffer}"),
        "buy_hold": summarize(bhold, "BUY_HOLD_RTH"),
        "random": summarize(rand, "RANDOM 15/15"),
        "stop_sweep": sweep,
        "capped_variants": capped,
        "per_session": per_session_table(main_trades),
        "trades": [t.__dict__ for t in main_trades],
    }
    Path(args.out).write_text(json.dumps(result, indent=2, default=str))
    for k in ("main", "buy_hold", "random"):
        print(k, json.dumps(result[k]))
    print("capped:")
    for b, s in capped.items():
        print(f"  {b:>12} -> trades={s['trades']:>4} win={s.get('win_rate')} avg={s.get('avg_net_points')} tot={s.get('total_net_points')} dd={s.get('worst_drawdown_points')}")
    print("stop sweep:")
    for b, s in sweep.items():
        print(f"  {b:>3} pts -> trades={s['trades']:>4} win={s.get('win_rate')} "
              f"avg={s.get('avg_net_points')} tot={s.get('total_net_points')} dd={s.get('worst_drawdown_points')}")


if __name__ == "__main__":
    main()
