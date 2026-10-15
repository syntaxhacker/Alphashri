#!/usr/bin/env python3
"""Tick-level backtest of the overnight-value rules on real MNQ ticks.

Ticks are only available for a small, gappy set of days (see inventory), so this
is a *fidelity* check, not a statistical sample.  Overnight POC/VAH/VAL come
from the dense 1-minute bars; entry/exit execution uses the actual traded tick
path, honouring every tick, and a CVD filter uses the aggressor side carried in
the tick record (``is_ask`` -> +size).

Usage: python run_tick_backtest.py
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import ET, Trade, summarize, per_session_table, ROUND_TRIP_COST_POINTS  # noqa: E402
from data_store import build_front_month, load_day_ticks, tick_days  # noqa: E402
from run_value_reversion import sessions_from_bars, overnight_value  # noqa: E402


def tick_cvd(ticks, entry_ts, window_ms=60_000):
    signed = 0.0
    for t in ticks:
        if entry_ts - window_ms <= t["ts"] <= entry_ts:
            signed += t["size"] if t["is_ask"] else -t["size"]
    return signed


def find_fade_ticks(ticks, level, side, stop_buffer):
    above = False
    extreme = None
    for i, t in enumerate(ticks):
        p = t["price"]
        if side == "short":
            if p > level:
                above = True
                extreme = p if extreme is None else max(extreme, p)
            if above and p < level:
                return i, p, extreme + stop_buffer
        else:
            if p < level:
                above = True
                extreme = p if extreme is None else min(extreme, p)
            if above and p > level:
                return i, p, extreme - stop_buffer
    return None


def simulate_ticks(side, entry, stop, target, ticks, start_i, day, rule):
    t = Trade(day=day, side=side, entry_ts=ticks[start_i]["ts"], entry=entry,
              stop=stop, target=target, rule=rule)
    mae = mfe = 0.0
    for i in range(start_i + 1, len(ticks)):
        p = ticks[i]["price"]
        if side == "long":
            mae = max(mae, entry - p); mfe = max(mfe, p - entry)
            if p <= stop:
                t.exit, t.reason, t.bars_held = stop, "STOP", i - start_i; break
            if p >= target:
                t.exit, t.reason, t.bars_held = target, "TARGET", i - start_i; break
        else:
            mae = max(mae, p - entry); mfe = max(mfe, entry - p)
            if p >= stop:
                t.exit, t.reason, t.bars_held = stop, "STOP", i - start_i; break
            if p <= target:
                t.exit, t.reason, t.bars_held = target, "TARGET", i - start_i; break
    else:
        t.exit, t.reason, t.bars_held = ticks[-1]["price"], "EOD", len(ticks) - 1 - start_i
    t.mae, t.mfe = mae, mfe
    t.points = (t.exit - entry) if side == "long" else (entry - t.exit)
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--buffer", type=float, default=15.0)
    ap.add_argument("--min-ticks", type=int, default=200_000)
    ap.add_argument("--out", default="/tmp/opencode/tick_backtest.json")
    args = ap.parse_args()

    tdays = tick_days()
    density = {d: sum(1 for _ in v) for d, v in tdays.items()}
    # overnight value from bars
    bars = build_front_month("2026-03-01", "2026-09-30")
    bar_sessions = {d: (on, rth) for d, on, rth in sessions_from_bars(bars)}

    rows = []
    all_bh = []
    trades_all, trades_cvd = [], []
    for day in sorted(tdays):
        nblocks = density[day]
        df = load_day_ticks(day)
        if df.empty:
            continue
        ist = pd.to_datetime(df["ts"], unit="ms", utc=True).dt.tz_convert(ET)
        tod = ist.dt.hour * 60 + ist.dt.minute
        rth = df[(tod.values >= 9 * 60 + 30) & (tod.values < 16 * 60)].to_dict("records")
        if len(rth) < args.min_ticks:
            rows.append({"day": day, "blocks": nblocks, "ticks": len(df),
                         "rth_ticks": len(rth), "status": "too_thin"})
            continue
        sess = bar_sessions.get(day)
        if not sess:
            rows.append({"day": day, "blocks": nblocks, "ticks": len(df),
                         "rth_ticks": len(rth), "status": "no_overnight_bars"})
            continue
        on_bars, _ = sess
        poc, vah, val = overnight_value(on_bars, 5.0)
        if poc is None:
            continue

        bh = Trade(day=day, side="long", entry_ts=rth[0]["ts"], entry=rth[0]["price"],
                   stop=0, target=1e12, rule="BUY_HOLD_TICKS")
        bh.exit, bh.reason, bh.exit_ts = rth[-1]["price"], "EOD", rth[-1]["ts"]
        bh.points = bh.exit - bh.entry
        bh.mfe = max(r["price"] for r in rth) - bh.entry
        bh.mae = bh.entry - min(r["price"] for r in rth)
        all_bh.append(bh)

        day_trades = []
        for side, level in (("short", vah), ("long", val)):
            res = find_fade_ticks(rth, level, side, args.buffer)
            if not res:
                continue
            i, entry, stop = res
            if i >= len(rth) - 3:
                continue
            target = poc if ((side == "short" and poc < entry) or (side == "long" and poc > entry)) \
                else (entry - 20 if side == "short" else entry + 20)
            t = simulate_ticks(side, entry, stop, target, rth, i, day, f"TICK_FB_{side}")
            cvd = tick_cvd(rth, t.entry_ts)
            agrees = (cvd < 0) if side == "short" else (cvd > 0)
            t.extras = {"cvd": round(cvd, 1), "cvd_agrees": agrees}
            trades_all.append(t)
            if agrees:
                trades_cvd.append(t)
            day_trades.append(t)
        rows.append({"day": day, "blocks": nblocks, "ticks": len(df), "rth_ticks": len(rth),
                     "status": "traded" if day_trades else "no_setup",
                     "poc": poc, "vah": vah, "val": val,
                     "trades": len(day_trades),
                     "net": round(sum(t.net_points for t in day_trades), 2)})

    result = {
        "days_with_ticks": len(tdays),
        "days_summary": rows,
        "fidelity_note": f"trades only on days with >= {args.min_ticks:,} RTH ticks",
        "all_trades": summarize(trades_all, "tick FB (all)"),
        "cvd_filtered": summarize(trades_cvd, "tick FB (CVD agrees)"),
        "buy_hold_ticks": summarize(all_bh, "BUY_HOLD (tick sessions)"),
        "per_session": per_session_table(trades_all),
        "trades": [t.__dict__ for t in trades_all],
    }
    Path(args.out).write_text(json.dumps(result, indent=2, default=str))
    dense = [r for r in rows if r["status"] == "traded"]
    print(f"days with ticks: {len(tdays)}; days >= {args.min_ticks:,} RTH ticks: {len(dense)}")
    for r in rows:
        print(f"  {r['day']} blocks={r['blocks']:>3} ticks={r['ticks']:>8,} rth={r['rth_ticks']:>8,} {r['status']}")
    print("ALL :", json.dumps(result["all_trades"]))
    print("CVD :", json.dumps(result["cvd_filtered"]))
    print("B&H :", json.dumps(result["buy_hold_ticks"]))


if __name__ == "__main__":
    main()
