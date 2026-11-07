#!/usr/bin/env python3
"""Fade-only wall book with a CORRECT opposite-break exit.

The shipped engine exits a long CE when `spot < put_wall` — but the live walls
are not side-filtered, so the put wall can sit ABOVE spot and the exit fires the
bar after entry (26 of 60 fade trades, -8,923). Here the opposite exit only
fires on a real break of the fade's own wall:

    fade put  (long CE at a put wall w below spot): exit if prev >= w > spot
    fade call (long PE at a call wall w above spot): exit if prev <= w < spot

Entries keep the shipped fade rules (top-OI wall for >=3 bars, price within
0.5xATR, max-pain room, 2-bar rejection). Optional filters via cfg.

Run:
    .venv/bin/python scripts/wall_replay/hist_fade.py
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


def _px(r, strike, opt):
    leg = (r.get("chain") or {}).get(str(int(strike)))
    return float(leg[0] if opt == "CE" else leg[1]) if leg and len(leg) >= 2 else 0.0


def _oi(r, strike, opt):
    leg = (r.get("chain") or {}).get(str(int(strike)))
    return float(leg[2] if opt == "CE" else leg[3]) if leg and len(leg) >= 4 else 0.0


def _oi5(rs, i, strike, opt):
    now, then = _oi(rs[i], strike, opt), _oi(rs[max(0, i - 5)], strike, opt)
    return None if (now <= 0 or then <= 0) else now - then


def _ok(cfg, rs, i, spot, why, wall):
    tm = datetime.fromisoformat(rs[i]["t"]).time()
    if datetime.fromisoformat(rs[i]["t"]).strftime("%a") in cfg.get("dow_skip", []):
        return False
    if "min_atr" in cfg or "max_atr" in cfg:
        closes = [float(x["spot"]) for x in rs[max(0, i - 14): i + 1]]
        atr = sum(abs(closes[j] - closes[j - 1]) for j in range(1, len(closes))) / max(1, len(closes) - 1)
        if atr < cfg.get("min_atr", 0) or atr > cfg.get("max_atr", 1e9):
            return False
    if cfg.get("trend") in ("with", "against"):
        closes = [float(x["spot"]) for x in rs[: i + 1]]
        vwap = sum(closes[-30:]) / len(closes[-30:])
        bull = why in ("fade put", "failed down")
        with_trend = (spot > vwap) if bull else (spot < vwap)
        if cfg["trend"] == "with" and not with_trend:
            return False
        if cfg["trend"] == "against" and with_trend:
            return False
    if tm.hour < cfg.get("hour_min", 0) or tm.hour > cfg.get("hour_max", 23):
        return False
    if "max_day_chg" in cfg and abs(spot - float(rs[0]["spot"])) > cfg["max_day_chg"]:
        return False
    if "mp_max" in cfg:
        mp = float(rs[i].get("max_pain") or 0)
        if mp and abs(mp - spot) > cfg["mp_max"]:
            return False
    if "dte_min" in cfg or "dte_max" in cfg:
        dte = (datetime.fromisoformat(rs[i]["expiry"]).date()
               - datetime.fromisoformat(rs[i]["t"][:10]).date()).days
        if dte < cfg.get("dte_min", 0) or dte > cfg.get("dte_max", 99):
            return False
    return True


def run(date: str, cfg: dict) -> list[dict]:
    rs = batch.rows(date)
    closes = [float(r["spot"]) for r in rs]
    trades, pos = [], None
    last_exit_i = -999
    top = {"put": (0.0, 0), "call": (0.0, 0)}
    last_break = None

    for i in range(1, len(rs) - 1):
        r, spot = rs[i], float(rs[i]["spot"])
        tm = datetime.fromisoformat(r["t"]).time()
        prev = float(rs[i - 1]["spot"])

        if pos:
            p = _px(r, pos["strike"], pos["opt"])
            if p > 0:
                pos["best"] = max(pos["best"], p)
                fav = (p - pos["entry"]) / pos["entry"]
                held = i - int(pos["entry_i"])
                gate = held >= int(cfg.get("hold", 0))
                give = cfg.get("runner_give", cfg["give"]) if pos.get("partial") else cfg["give"]
                if gate and fav >= cfg["arm"]:
                    pos["stop"] = max(pos["stop"], pos["entry"] + (1 - give) * (pos["best"] - pos["entry"]))
                if cfg.get("be_after") and fav >= cfg["be_after"]:
                    pos["stop"] = max(pos["stop"], pos["entry"])

                # CORRECT opposite: a real break of the fade's own wall
                w = float(pos["wall"])
                if pos["why"] in ("fade put", "failed down"):   # long CE, support below
                    d = _oi5(rs, i, w, "PE")
                    opp = prev >= w > spot and (w - spot) >= 5 and d is not None and abs(d) >= cfg["oi"]
                else:                              # long PE, resistance above
                    d = _oi5(rs, i, w, "CE")
                    opp = prev <= w < spot and (spot - w) >= 5 and d is not None and abs(d) >= cfg["oi"]

                at_target = ((spot >= pos["target_spot"]) if pos["opt"] == "CE"
                             else (spot <= pos["target_spot"])) and p > pos["entry"]
                target_hit = gate and at_target
                if cfg.get("target_mode") == "full" and at_target:
                    reason_full = "TARGET"
                else:
                    reason_full = None
                if cfg.get("partial_pct") and fav >= cfg["partial_pct"] and not pos.get("partial"):
                    pq = LOT // 2
                    cp = costs.option_round_trip_cost(pos["entry"], p, pq)
                    pos.update({"partial": True, "partial_px": p, "partial_time": r["t"],
                                "partial_net": cp["net_pnl"], "partial_gross": cp["gross_pnl"],
                                "partial_costs": cp["costs"], "qty": LOT - pq})
                if target_hit and cfg.get("partial") and not pos.get("partial"):
                    pq = LOT // 2
                    cp = costs.option_round_trip_cost(pos["entry"], p, pq)
                    pos.update({"partial": True, "partial_px": p, "partial_time": r["t"],
                                "partial_net": cp["net_pnl"], "partial_gross": cp["gross_pnl"],
                                "partial_costs": cp["costs"], "qty": LOT - pq})
                reason = reason_full
                # time stop: a trade that is not working after N bars is cut
                if cfg.get("time_stop_bars") and held >= cfg["time_stop_bars"] and fav <= cfg.get("time_stop_max", 0.0):
                    reason = "TIME"
                # structural stop: price went back through the wall (thesis dead)
                if cfg.get("wall_stop_pts"):
                    if pos["why"] in ("fade put", "failed down") and spot < w - cfg["wall_stop_pts"]:
                        reason = "WALLSTOP"
                    elif pos["why"] in ("fade call", "failed up") and spot > w + cfg["wall_stop_pts"]:
                        reason = "WALLSTOP"
                if reason:
                    pass
                elif p <= pos["stop"]:
                    reason = "STOP"
                elif opp:
                    reason = "OPPOSITE"
                elif tm >= time(cfg.get("eod_hour", 15), cfg.get("eod_min", 0)):
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

        if (tm < time(9, 30) and cfg.get("open", "0930") != "early") or i - last_exit_i < cfg.get("cooldown", 15):
            continue
        if cfg.get("max_per_day") and sum(1 for t in trades if t["entry_time"][:10] == r["t"][:10]) >= cfg["max_per_day"]:
            continue

        calls = (r.get("walls") or {}).get("calls") or []
        puts = (r.get("walls") or {}).get("puts") or []
        if not calls or not puts:
            continue
        a = batch.atr(closes[: i + 1])
        mp = float(r.get("max_pain") or 0)
        corridor = calls[0]["strike"] - puts[0]["strike"]
        if top["put"][0] == puts[0]["strike"]:
            top["put"] = (puts[0]["strike"], top["put"][1] + 1)
        else:
            top["put"] = (puts[0]["strike"], 1)
        if top["call"][0] == calls[0]["strike"]:
            top["call"] = (calls[0]["strike"], top["call"][1] + 1)
        else:
            top["call"] = (calls[0]["strike"], 1)

        # remember the latest break so a failure can be faded
        cprev = (rs[i - 1].get("walls") or {}).get("calls") or []
        pprev = (rs[i - 1].get("walls") or {}).get("puts") or []
        if cprev:
            bw = cprev[0]["strike"]
            if prev < bw <= spot and spot - bw >= cfg.get("break", 1):
                last_break = {"i": i, "w": bw, "dir": "up"}
        if pprev:
            bw = pprev[0]["strike"]
            if prev > bw >= spot and bw - spot >= cfg.get("break", 1):
                last_break = {"i": i, "w": bw, "dir": "down"}

        # failed-break fade: the break went back inside -> fade the wall
        if cfg.get("failed_fade") and last_break and i - last_break["i"] <= cfg.get("fade_window", 10):
            bw = float(last_break["w"]); conf = cfg.get("confirm", 5)
            if last_break["dir"] == "up" and spot <= bw - conf:
                strike = bw + 50 if cfg.get("strike") == "itm" else bw
                fill = _px(rs[i + 1], strike, "PE")
                if fill > 0 and _ok(cfg, rs, i, spot, "failed up", bw):
                    pos = {"dir": "LONG", "opt": "PE", "strike": strike, "entry": fill,
                           "best": fill, "stop": fill * (1 - cfg["stop"]),
                           "target_spot": puts[0]["strike"], "entry_time": rs[i + 1]["t"],
                           "entry_i": i + 1, "why": "failed up", "wall": bw}
                    last_break = None
                    continue
            if last_break["dir"] == "down" and spot >= bw + conf:
                strike = bw - 50 if cfg.get("strike") == "itm" else bw
                fill = _px(rs[i + 1], strike, "CE")
                if fill > 0 and _ok(cfg, rs, i, spot, "failed down", bw):
                    pos = {"dir": "LONG", "opt": "CE", "strike": strike, "entry": fill,
                           "best": fill, "stop": fill * (1 - cfg["stop"]),
                           "target_spot": calls[0]["strike"], "entry_time": rs[i + 1]["t"],
                           "entry_i": i + 1, "why": "failed down", "wall": bw}
                    last_break = None
                    continue

        def wall_ok(w, opt):
            if cfg.get("wall_oi_min") and _oi(r, w, opt) < cfg["wall_oi_min"]:
                return False
            if cfg.get("wall_oi_rising"):
                d = _oi5(rs, i, w, opt)
                if d is None or d < cfg.get("wall_oi_rise_min", 0):
                    return False
            return True

        # fade put: support held -> long CE
        if cfg.get("fade_put", True) and top["put"][1] >= cfg.get("wall_bars", 3) and corridor >= cfg.get("min_corridor", cfg["corridor"]):
            w = puts[0]["strike"]
            prox = max(cfg.get("prox_min", 5), cfg.get("prox_atr", 0.5) * a)
            if 0 <= spot - w <= prox and mp - spot >= cfg["room"] and wall_ok(w, "PE"):
                rej = (closes[i] > closes[i - 1] > closes[i - 2]) if cfg.get("reject_bars", 2) >= 2 else (closes[i] > closes[i - 1])
                if rej and _ok(cfg, rs, i, spot, "fade put", w):
                    strike = w - 50 if cfg.get("strike") == "itm" else w
                    fill = _px(rs[i + 1], strike, "CE")
                    if fill > 0:
                        pos = {"dir": "LONG", "opt": "CE", "strike": strike, "entry": fill,
                               "best": fill, "stop": fill * (1 - cfg["stop"]),
                               "target_spot": calls[0]["strike"], "entry_time": rs[i + 1]["t"],
                               "entry_i": i + 1, "why": "fade put", "wall": w}
                        continue
        # fade call: resistance held -> long PE
        if cfg.get("fade_call", True) and top["call"][1] >= cfg.get("wall_bars", 3) and corridor >= cfg.get("min_corridor", cfg["corridor"]):
            w = calls[0]["strike"]
            prox = max(cfg.get("prox_min", 5), cfg.get("prox_atr", 0.5) * a)
            if 0 <= w - spot <= prox and spot - mp >= cfg["room"] and wall_ok(w, "CE"):
                rej = (closes[i] < closes[i - 1] < closes[i - 2]) if cfg.get("reject_bars", 2) >= 2 else (closes[i] < closes[i - 1])
                if rej and _ok(cfg, rs, i, spot, "fade call", w):
                    strike = w + 50 if cfg.get("strike") == "itm" else w
                    fill = _px(rs[i + 1], strike, "PE")
                    if fill > 0:
                        pos = {"dir": "LONG", "opt": "PE", "strike": strike, "entry": fill,
                               "best": fill, "stop": fill * (1 - cfg["stop"]),
                               "target_spot": puts[0]["strike"], "entry_time": rs[i + 1]["t"],
                               "entry_i": i + 1, "why": "fade call", "wall": w}
                        continue
    return trades


def main() -> None:
    import hist_batch as hb

    batch.TAPE = HIST
    batch._CACHE.clear()
    dates = sorted(p.stem for p in HIST.glob("*.jsonl") if not p.stem.startswith("_"))
    batch.DATES = dates
    dates = [d for d in dates if hb.chain_complete(d)]
    train = [d for d in dates if d < "2025-11-01"]
    test = [d for d in dates if d >= "2025-11-01"]
    A = {**hb.AGGR, "failed_fade": False, "wall_oi_rising": True, "hour_max": 12,
         "give": 0.2, "strike": "wall", "prox_atr": 1.25, "reject_bars": 1}
    print(f"train {len(train)}  test {len(test)}  (final fade config)")
    for label, ds in (("TRAIN", train), ("TEST", test), ("ALL", dates)):
        tr = []
        for d in ds:
            tr += run(d, A)
        s = hb.curve_stats(tr)
        print(f"{label:5s} n={s['n']:3d} win={s['win']:3d} net={s['net']:+8.0f} "
              f"PF={s['pf']:5.2f} DD={s['dd']:+8.0f} avg={s['avg']:+6.0f}")
    tr = []
    for d in dates:
        tr += run(d, A)
    g = defaultdict(list)
    for t in tr:
        g[t["reason"]].append(t)
    print("exits:", {k: (len(v), round(sum(x["net"] for x in v))) for k, v in g.items()})
    g = defaultdict(list)
    for t in tr:
        g[t["why"]].append(t)
    print("entries:", {k: (len(v), round(sum(x["net"] for x in v))) for k, v in g.items()})


if __name__ == "__main__":
    main()
