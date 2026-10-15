#!/usr/bin/env python3
"""GEX call-wall / put-wall fade on NDX, using UW historical GEX.

Now possible because `/api/stock/NDX/gex-levels?date=` and
`/api/stock/NDX/spot-exposures?date=` both serve history back to 2023-10-30.

Rule (per session D):
  * levels are the PRIOR trading day's EOD gex-levels (no look-ahead);
  * intraday path is NDX cash 1-minute price from spot-exposures(D);
  * SHORT after price trades above the prior call_wall and prints back below it;
  * LONG mirror at the prior put_wall;
  * target = prior gamma_magnet (fallback gamma_flip / fixed);
  * stop = failure extreme +/- buffer; EOD exit at the last minute.

A same-day-levels variant is also run to expose how much of any edge is pure
look-ahead (same-day levels are only finalised after the close).

Usage: python run_gex_wall_fade.py
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import Trade, summarize, per_session_table, ROUND_TRIP_COST_POINTS  # noqa: E402
import gex_store  # noqa: E402


def load_prices(day: str):
    rows = gex_store.load_spot(day)
    out = []
    for r in rows:
        try:
            p = float(r["price"])
        except (KeyError, TypeError, ValueError):
            continue
        ts = r.get("start_time") or r.get("time")
        out.append({"ts": ts, "price": p})
    out.sort(key=lambda x: str(x["ts"]))
    return out


def simulate_price_path(side, entry, stop, target, path, start_i, day, rule):
    t = Trade(day=day, side=side, entry_ts=path[start_i]["ts"] if isinstance(path[start_i]["ts"], int) else 0,
              entry=entry, stop=stop, target=target, rule=rule)
    mae = mfe = 0.0
    for i in range(start_i + 1, len(path)):
        p = path[i]["price"]
        if side == "long":
            mae = max(mae, entry - p)
            mfe = max(mfe, p - entry)
            if p <= stop:
                t.exit, t.reason, t.bars_held = stop, "STOP", i - start_i
                break
            if p >= target:
                t.exit, t.reason, t.bars_held = target, "TARGET", i - start_i
                break
        else:
            mae = max(mae, p - entry)
            mfe = max(mfe, entry - p)
            if p >= stop:
                t.exit, t.reason, t.bars_held = stop, "STOP", i - start_i
                break
            if p <= target:
                t.exit, t.reason, t.bars_held = target, "TARGET", i - start_i
                break
    else:
        t.exit, t.reason, t.bars_held = path[-1]["price"], "EOD", len(path) - 1 - start_i
    t.mae, t.mfe = mae, mfe
    t.points = (t.exit - entry) if side == "long" else (entry - t.exit)
    return t


def find_fade(path, level, side, stop_buffer, max_stop=None, max_excursion=None):
    above = False
    extreme = None
    for i, row in enumerate(path):
        p = row["price"]
        if side == "short":
            if p > level:
                above = True
                extreme = p if extreme is None else max(extreme, p)
            if above and p < level:
                if max_excursion is not None and (extreme - level) > max_excursion:
                    return None
                stop = extreme + stop_buffer
                if max_stop is not None:
                    stop = min(stop, p + max_stop)
                return i, p, stop
        else:
            if p < level:
                above = True
                extreme = p if extreme is None else min(extreme, p)
            if above and p > level:
                if max_excursion is not None and (level - extreme) > max_excursion:
                    return None
                stop = extreme - stop_buffer
                if max_stop is not None:
                    stop = max(stop, p - max_stop)
                return i, p, stop
    return None


def run(days, levels_by_day, stop_buffer=15.0, use_same_day=False, buffer_sweep=None,
        max_stop=None, max_excursion=None):
    trades = []
    touches = {"call": 0, "put": 0}
    for day in days:
        path = load_prices(day)
        if len(path) < 60:
            continue
        # prior available levels
        lvl = levels_by_day.get(day if use_same_day else None)
        if not use_same_day:
            lvl = None
            for d in reversed(days):
                if d < day and d in levels_by_day:
                    lvl = levels_by_day[d]
                    break
        if not lvl:
            continue
        call_wall = _f(lvl.get("call_wall"))
        put_wall = _f(lvl.get("put_wall"))
        magnet = _f(lvl.get("gamma_magnet"))
        flip = _f(lvl.get("gamma_flip"))
        hi = max(p["price"] for p in path)
        lo = min(p["price"] for p in path)
        if call_wall and hi > call_wall:
            touches["call"] += 1
        if put_wall and lo < put_wall:
            touches["put"] += 1

        for side, level in (("short", call_wall), ("long", put_wall)):
            if level is None:
                continue
            res = find_fade(path, level, side, stop_buffer, max_stop, max_excursion)
            if not res:
                continue
            i, entry, stop = res
            if i >= len(path) - 2:
                continue
            cand = magnet if magnet else flip
            if side == "short":
                target = cand if (cand and cand < entry) else (flip if (flip and flip < entry) else entry - 20)
            else:
                target = cand if (cand and cand > entry) else (flip if (flip and flip > entry) else entry + 20)
            t = simulate_price_path(side, entry, stop, target, path, i, day,
                                    rule=f"GEX_FADE_{side}")
            t.extras = {"call_wall": call_wall, "put_wall": put_wall,
                        "magnet": magnet, "flip": flip, "level_src": "same_day" if use_same_day else "prior_day"}
            trades.append(t)
    return trades, touches


def _f(x):
    try:
        return float(x) if x is not None else None
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--buffer", type=float, default=15.0)
    ap.add_argument("--max-stop", type=float, default=None)
    ap.add_argument("--max-excursion", type=float, default=None)
    ap.add_argument("--out", default="/tmp/opencode/gex_wall_fade.json")
    args = ap.parse_args()

    days = sorted(p.stem.split("_")[-1] for p in gex_store.SPOT_CACHE.glob("NDX_*.json"))
    levels_by_day = {}
    for p in sorted(gex_store.CACHE.glob("NDX_*.json")):
        day = p.stem.split("_")[-1]
        best = gex_store.load_levels_best(day)
        if best and best.get("call_wall") is not None:
            levels_by_day[best.get("date", day)] = best
    days = [d for d in days if len(gex_store.load_spot(d)) >= 60]
    print(f"sessions with GEX+price: {len(days)}  ({days[0]} .. {days[-1]})")
    print(f"days with usable levels: {len(levels_by_day)}")

    trades, touches = run(days, levels_by_day, stop_buffer=args.buffer,
                          max_stop=args.max_stop, max_excursion=args.max_excursion)
    same_day, _ = run(days, levels_by_day, stop_buffer=args.buffer, use_same_day=True,
                      max_stop=args.max_stop, max_excursion=args.max_excursion)

    sweep = {}
    for buf in [8, 12, 15, 20, 25, 30, 40, 50]:
        tr, _ = run(days, levels_by_day, stop_buffer=float(buf),
                    max_stop=args.max_stop, max_excursion=args.max_excursion)
        sweep[buf] = summarize(tr, f"buffer={buf}")

    # capped variants: bounded stop + sane excursion band
    variants = {}
    for ms, me in [(25, 25), (40, 40), (40, 60), (60, 80)]:
        tr, _ = run(days, levels_by_day, stop_buffer=15.0, max_stop=ms, max_excursion=me)
        variants[f"max_stop={ms}_max_exc={me}"] = summarize(tr, f"cap {ms}/{me}")

    result = {
        "sessions": len(days),
        "first_day": days[0], "last_day": days[-1],
        "call_wall_touched_sessions": touches["call"],
        "put_wall_touched_sessions": touches["put"],
        "main_prior_day_levels": summarize(trades, f"GEX fade prior-day buffer={args.buffer}"),
        "same_day_levels_LOOKAHEAD": summarize(same_day, "GEX fade same-day (LEAKY)"),
        "stop_sweep": sweep,
        "capped_variants": variants,
        "per_session": per_session_table(trades),
        "trades": [t.__dict__ for t in trades],
    }
    Path(args.out).write_text(json.dumps(result, indent=2, default=str))
    print("touches:", touches)
    print("PRIOR-DAY (honest):", json.dumps(result["main_prior_day_levels"]))
    print("SAME-DAY (leaky)  :", json.dumps(result["same_day_levels_LOOKAHEAD"]))
    print("capped variants:")
    for k, s in variants.items():
        print(f"  {k:>24} -> n={s['trades']:>4} win={s.get('win_rate')} avg={s.get('avg_net_points')} tot={s.get('total_net_points')} dd={s.get('worst_drawdown_points')}")
    print("stop sweep:")
    for b, s in sweep.items():
        print(f"  {b:>3} -> n={s['trades']:>4} win={s.get('win_rate')} avg={s.get('avg_net_points')} tot={s.get('total_net_points')} dd={s.get('worst_drawdown_points')}")


if __name__ == "__main__":
    main()
