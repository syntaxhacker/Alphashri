#!/usr/bin/env python3
"""Corrected wall engine for the historical archive.

`batch.run()` has two latent assumptions that only hold on the live tape:

1. `r["walls"]` is ranked without a side filter, so a put wall can sit ABOVE
   spot. The "opposite break" exit then fires on `spot < w` even when nothing
   broke.
2. The break compares spot with the CURRENT bar's wall. Once the strike is
   crossed it drops out of the side-filtered list, so `prev < w <= spot` can
   never fire (with side-filtered walls there are zero breaks).

This engine fixes both: walls are side-filtered (calls >= spot, puts <= spot)
and the break is tested against the PREVIOUS bar's wall.

Same config keys as batch.AGGR. Usage:
    .venv/bin/python scripts/wall_replay/hist_fixed.py
"""

from __future__ import annotations

import sys
from collections import defaultdict
from datetime import datetime, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "wall_replay"))
sys.path.insert(0, str(ROOT))
import batch  # noqa: E402
from options_paper import costs  # noqa: E402

LOT = 65
HIST = ROOT / "experiments" / "data" / "nifty_hist"


def walls_at(r: dict, spot: float, band: float = 300.0) -> tuple[list, list]:
    ch = {int(k): v for k, v in (r.get("chain") or {}).items()}
    near = {k: v for k, v in ch.items() if abs(k - spot) <= band and len(v) >= 6} or \
           {k: v for k, v in ch.items() if len(v) >= 6}
    calls = sorted(((k, v[2]) for k, v in near.items() if k >= spot and v[2] > 0),
                   key=lambda x: -x[1])[:3]
    puts = sorted(((k, v[3]) for k, v in near.items() if k <= spot and v[3] > 0),
                  key=lambda x: -x[1])[:3]
    return ([{"strike": float(k), "oi": o} for k, o in calls],
            [{"strike": float(k), "oi": o} for k, o in puts])


def _oi(r: dict, strike: float, opt: str) -> float:
    leg = (r.get("chain") or {}).get(str(int(strike)))
    return float(leg[2] if opt == "CE" else leg[3]) if leg and len(leg) >= 4 else 0.0


def _oi5(rs: list, i: int, strike: float, opt: str) -> float | None:
    now, then = _oi(rs[i], strike, opt), _oi(rs[max(0, i - 5)], strike, opt)
    return None if (now <= 0 or then <= 0) else now - then


def _fill(r: dict, strike: float, opt: str) -> float:
    leg = (r.get("chain") or {}).get(str(int(strike)))
    return float(leg[0] if opt == "CE" else leg[1]) if leg and len(leg) >= 2 else 0.0


def _filters_ok(cfg, rs, i, spot, why, wall, opt) -> bool:
    tm = datetime.fromisoformat(rs[i]["t"]).time()
    if "hour_min" in cfg and tm.hour < int(cfg["hour_min"]):
        return False
    if "hour_max" in cfg and tm.hour > int(cfg["hour_max"]):
        return False
    if "max_day_chg" in cfg:
        chg = spot - float(rs[0]["spot"])
        if abs(chg) > float(cfg["max_day_chg"]):
            return False
    if "oi_min" in cfg or "oi_max" in cfg:
        d = abs(_oi5(rs, i, wall, opt) or 0)
        if "oi_min" in cfg and d < float(cfg["oi_min"]):
            return False
        if "oi_max" in cfg and d > float(cfg["oi_max"]):
            return False
    if "mp_max" in cfg:
        mp = float(rs[i].get("max_pain") or 0)
        if mp and abs(mp - spot) > float(cfg["mp_max"]):
            return False
    return True


def _entry(cfg, rs, i, spot, why, opt, wall, target_spot, strike):
    r = rs[i]
    fill = _fill(rs[i + 1], strike, opt)
    if fill <= 0:
        return None
    return {"dir": "LONG", "opt": opt, "strike": strike, "entry": fill, "best": fill,
            "stop": fill * (1 - cfg["stop"]), "target_spot": target_spot,
            "entry_time": rs[i + 1]["t"], "entry_i": i + 1, "why": why,
            "wall": wall}


def run(date: str, cfg: dict) -> list[dict]:
    rs = batch.rows(date)
    closes = [float(r["spot"]) for r in rs]
    trades, pos = [], None
    last_exit_i = -999
    top = {"put": (0.0, 0), "call": (0.0, 0)}

    for i in range(1, len(rs) - 1):
        r, spot = rs[i], float(rs[i]["spot"])
        tm = datetime.fromisoformat(r["t"]).time()

        if pos:
            p = _fill(r, pos["strike"], pos["opt"])
            if p > 0:
                pos["best"] = max(pos["best"], p)
                fav = (p - pos["entry"]) / pos["entry"]
                held = i - int(pos["entry_i"])
                gate = held >= int(cfg.get("hold", 0))
                if gate and fav >= cfg["arm"]:
                    trail = pos["entry"] + (1 - cfg["give"]) * (pos["best"] - pos["entry"])
                    pos["stop"] = max(pos["stop"], trail)

                # opposite break: the put wall in force on the PREVIOUS bar
                pprev, _ = walls_at(rs[i - 1], float(rs[i - 1]["spot"]))
                opp = False
                if pprev:
                    w = pprev[0]["strike"]
                    d = _oi5(rs, i, w, "PE")
                    opp = (float(rs[i - 1]["spot"]) >= w > spot and (w - spot) >= 5
                           and d is not None and abs(d) >= cfg["oi"])

                target_hit = gate and spot >= pos["target_spot"] and p > pos["entry"]
                if target_hit and cfg.get("partial") and not pos.get("partial"):
                    pq = LOT // 2
                    cp = costs.option_round_trip_cost(pos["entry"], p, pq)
                    pos.update({"partial": True, "partial_px": p, "partial_time": r["t"],
                                "partial_net": cp["net_pnl"], "partial_gross": cp["gross_pnl"],
                                "partial_costs": cp["costs"], "qty": LOT - pq})
                reason = None
                if p <= pos["stop"]:
                    reason = "STOP"
                elif opp:
                    reason = "OPPOSITE"
                elif tm >= time(15, 0):
                    reason = "EOD"
                if reason:
                    q = int(pos.get("qty", LOT))
                    cq = costs.option_round_trip_cost(pos["entry"], p, q)
                    trades.append({**pos, "exit": p,
                                   "net": cq["net_pnl"] + float(pos.get("partial_net", 0)),
                                   "gross": cq["gross_pnl"] + float(pos.get("partial_gross", 0)),
                                   "costs": cq["costs"] + float(pos.get("partial_costs", 0)),
                                   "reason": reason, "exit_time": r["t"]})
                    pos = None
                    last_exit_i = i
            if pos:
                continue

        if (tm < time(9, 30) and cfg.get("open", "0930") != "early") or i - last_exit_i < 15:
            continue

        calls_prev, puts_prev = walls_at(rs[i - 1], float(rs[i - 1]["spot"]))
        calls, puts = walls_at(r, spot)
        prev = float(rs[i - 1]["spot"])
        a = batch.atr(closes[: i + 1])
        mp = float(r.get("max_pain") or 0)
        corridor = (calls[0]["strike"] - puts[0]["strike"]) if (calls and puts) else 0.0
        if puts:
            top["put"] = (puts[0]["strike"], top["put"][1] + 1 if top["put"][0] == puts[0]["strike"] else 1)
        if calls:
            top["call"] = (calls[0]["strike"], top["call"][1] + 1 if top["call"][0] == calls[0]["strike"] else 1)

        # break up: cross the call wall that was in force on the previous bar
        if calls_prev and not cfg.get("no_break"):
            w = calls_prev[0]["strike"]
            if prev < w <= spot and (spot - w) >= cfg["break"]:
                d = _oi5(rs, i, w, "CE")
                nxt = calls[0]["strike"] if calls else None
                if d is not None and abs(d) >= cfg["oi"] and (not nxt or nxt - spot >= 50):
                    if not _filters_ok(cfg, rs, i, spot, "break up", w, "CE"):
                        continue
                    strike = w - 50 if cfg.get("strike") == "itm" else w
                    pos = _entry(cfg, rs, i, spot, "break up", "CE", w, nxt or spot + 100, strike)
                    if pos:
                        continue
        # break down
        if puts_prev and not cfg.get("no_break"):
            w = puts_prev[0]["strike"]
            if prev > w >= spot and (w - spot) >= cfg["break"]:
                d = _oi5(rs, i, w, "PE")
                nxt = puts[0]["strike"] if puts else None
                if d is not None and abs(d) >= cfg["oi"] and (not nxt or spot - nxt >= 50):
                    if not _filters_ok(cfg, rs, i, spot, "break down", w, "PE"):
                        continue
                    strike = w + 50 if cfg.get("strike") == "itm" else w
                    pos = _entry(cfg, rs, i, spot, "break down", "PE", w, nxt or spot - 100, strike)
                    if pos:
                        continue
        # fade put (support held)
        if puts and not cfg.get("no_fade") and top["put"][1] >= 3 and corridor >= cfg["corridor"]:
            w = puts[0]["strike"]
            if 0 <= spot - w <= max(5, 0.5 * a) and mp - spot >= cfg["room"]:
                if closes[i] > closes[i - 1] > closes[i - 2]:
                    strike = w - 50 if cfg.get("strike") == "itm" else w
                    pos = _entry(cfg, rs, i, spot, "fade put", "CE", w,
                                 calls[0]["strike"] if calls else spot + 100, strike)
                    if pos:
                        continue
        # fade call (resistance held)
        if calls and not cfg.get("no_fade") and top["call"][1] >= 3 and corridor >= cfg["corridor"]:
            w = calls[0]["strike"]
            if 0 <= w - spot <= max(5, 0.5 * a) and spot - mp >= cfg["room"]:
                if closes[i] < closes[i - 1] < closes[i - 2]:
                    strike = w + 50 if cfg.get("strike") == "itm" else w
                    pos = _entry(cfg, rs, i, spot, "fade call", "PE", w,
                                 puts[0]["strike"] if puts else spot - 100, strike)
                    if pos:
                        continue
    return trades


def main() -> None:
    import hist_batch as hb

    batch.TAPE = HIST
    batch._CACHE.clear()
    dates = sorted(p.stem for p in HIST.glob("*.jsonl") if not p.stem.startswith("_"))
    batch.DATES = dates
    dates = [d for d in dates if hb.chain_complete(d)]
    print(f"complete-chain sessions: {len(dates)} ({dates[0]} -> {dates[-1]})", flush=True)

    tr = []
    for d in dates:
        tr += run(d, hb.AGGR)
    s = hb.curve_stats(tr)
    print(f"FIXED AGGR  n={s['n']} win={s['win']} net={s['net']:+.0f} PF={s['pf']:.2f} "
          f"DD={s['dd']:+.0f} gross={s['gross']:+.0f} costs={s['costs']:.0f}")
    for key, label in (("why", "entry"), ("reason", "exit"), ("opt", "leg")):
        g = defaultdict(list)
        for t in tr:
            g[t[key]].append(t)
        print(f"by {label}:")
        for k in sorted(g, key=lambda x: -sum(t["net"] for t in g[x])):
            print(f"  {k:12s} {hb.fmt(hb.curve_stats(g[k]))}")
    bym = defaultdict(list)
    for t in tr:
        bym[t["entry_time"][:7]].append(t)
    print("by month:")
    for m in sorted(bym):
        print(f"  {m} {hb.fmt(hb.curve_stats(bym[m]))}")


if __name__ == "__main__":
    main()
