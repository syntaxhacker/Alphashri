#!/usr/bin/env python3
"""Premium-selling strategies on the NIFTY 1-min chain.

Structures (all defined per session):
  straddle      sell ATM CE + ATM PE
  strangle      sell CE at the call wall + PE at the put wall
  iron_condor   strangle + buy 100-pt wings
  bull_put      sell PE at the put wall + buy PE 100 lower
  bear_call     sell CE at the call wall + buy CE 100 higher

Entry at a fixed time, exit on a % of credit target / stop, or 15:15.
Costs: options_paper/costs.py (short legs pay STT on the sell).
Signal/fill: entry at the bar's close, exit at the bar's close.

Run:
    .venv/bin/python scripts/wall_replay/hist_premium.py
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
_DATES = None


def dates() -> list[str]:
    global _DATES
    if _DATES is None:
        _DATES = sorted(p.stem for p in HIST.glob("*.jsonl")
                        if not p.stem.startswith("_") and ".gaps" not in p.stem)
    return _DATES


def _px(r, strike, opt):
    leg = (r.get("chain") or {}).get(str(int(strike)))
    return float(leg[0] if opt == "CE" else leg[1]) if leg and len(leg) >= 2 else 0.0


def atm(spot):
    return round(spot / 50.0) * 50.0


def prev_close(date: str) -> float:
    ds = dates()
    i = ds.index(date)
    if i <= 0:
        return 0.0
    rs = batch.rows(ds[i - 1])
    return float(rs[-1]["spot"]) if rs else 0.0


def _atr(rs, i, n=14):
    cl = [float(r["spot"]) for r in rs[max(0, i - n): i + 1]]
    return sum(abs(cl[j] - cl[j - 1]) for j in range(1, len(cl))) / max(1, len(cl) - 1)


def legs_for(kind, spot, row, cfg):
    calls = (row.get("walls") or {}).get("calls") or []
    puts = (row.get("walls") or {}).get("puts") or []
    cw = calls[0]["strike"] if calls else atm(spot) + 100
    pw = puts[0]["strike"] if puts else atm(spot) - 100
    a = atm(spot)
    if kind == "straddle":
        return [(a, "CE", -1), (a, "PE", -1)]
    if kind == "strangle":
        sk = cfg.get("skew_pts", 0)
        cw = max(cw + sk, a + 50)
        pw = min(pw + sk, a - 50)
        return [(cw, "CE", -1), (pw, "PE", -1)]
    if kind == "iron_condor":
        sk = cfg.get("skew_pts", 0)
        cw = max(cw + sk, a + 50)
        pw = min(pw + sk, a - 50)
        return [(cw, "CE", -1), (pw, "PE", -1),
                (cw + 100, "CE", 1), (pw - 100, "PE", 1)]
    if kind == "bull_put":
        return [(pw, "PE", -1), (pw - 100, "PE", 1)]
    if kind == "bear_call":
        return [(cw, "CE", -1), (cw + 100, "CE", 1)]
    return []


def run(date: str, cfg: dict) -> list[dict]:
    rs = batch.rows(date)
    if len(rs) < 60:
        return []
    ent = time(cfg.get("entry_hour", 9), cfg.get("entry_min", 45))
    ex = time(cfg.get("exit_hour", 15), cfg.get("exit_min", 15))
    kind = cfg.get("kind", "strangle")
    trades = []
    pos = None
    for i, r in enumerate(rs[:-1]):
        tm = datetime.fromisoformat(r["t"]).time()
        spot = float(r["spot"])
        if pos is None and tm >= ent and i < len(rs) - 2:
            pdc = prev_close(date)
            if cfg.get("max_open_move"):
                if abs(spot - float(rs[0]["spot"])) / float(rs[0]["spot"]) > cfg["max_open_move"]:
                    continue
            if cfg.get("max_gap") and pdc:
                if abs(float(rs[0]["spot"]) - pdc) / pdc > cfg["max_gap"]:
                    continue
            if cfg.get("min_atr") or cfg.get("max_atr"):
                a = _atr(rs, i)
                if a < cfg.get("min_atr", 0) or a > cfg.get("max_atr", 1e9):
                    continue
            ecfg = dict(cfg)
            if cfg.get("dynamic_skew"):
                pdc2 = prev_close(date)
                if pdc2:
                    ecfg["skew_pts"] = cfg["dynamic_skew"] if spot > pdc2 else -cfg["dynamic_skew"]
            legs = legs_for(kind, spot, r, ecfg)
            legs = [(k, o, s) for k, o, s in legs if _px(r, k, o) > 0]
            if len(legs) < 2:
                continue
            entry = {f"{k}{o}": _px(r, k, o) for k, o, s in legs}
            credit = sum(-s * entry[f"{k}{o}"] for k, o, s in legs)
            if credit <= 0:
                continue
            pos = {"legs": legs, "entry": entry, "credit": credit,
                   "entry_time": r["t"], "entry_i": i, "spot": spot}
            continue
        if pos:
            # short (s=-1): pnl = (entry - cur); long (s=+1): pnl = (cur - entry)
            gross = 0.0
            for k, o, s in pos["legs"]:
                cur = _px(r, k, o) or pos["entry"][f"{k}{o}"]
                gross += (pos["entry"][f"{k}{o}"] - cur) * (-s)
            reason = None
            if not cfg.get("hold_to_expiry"):
                if gross >= cfg.get("target", 0.5) * pos["credit"]:
                    reason = "TARGET"
                elif gross <= -cfg.get("stop", 2.0) * pos["credit"]:
                    reason = "STOP"
            if reason is None and tm >= ex:
                reason = "TIME"
            if reason:
                net = 0.0
                cst = 0.0
                for k, o, s in pos["legs"]:
                    cur = _px(r, k, o) or pos["entry"][f"{k}{o}"]
                    c = costs.option_round_trip_cost(pos["entry"][f"{k}{o}"], cur, LOT,
                                                     is_short=(s == -1))
                    net += c["net_pnl"]
                    cst += c["costs"]
                trades.append({**pos, "exit_time": r["t"], "exit_spot": spot,
                               "net": net, "gross": net + cst, "costs": cst,
                               "reason": reason, "kind": kind})
                pos = None
                break
    return trades


def stats(tr):
    n = len(tr)
    w = sum(1 for t in tr if t["net"] > 0)
    net = sum(t["net"] for t in tr)
    gw = sum(t["net"] for t in tr if t["net"] > 0)
    gl = -sum(t["net"] for t in tr if t["net"] < 0)
    eq = peak = dd = 0.0
    for t in sorted(tr, key=lambda x: x["exit_time"]):
        eq += t["net"]
        peak = max(peak, eq)
        dd = min(dd, eq - peak)
    return n, w, net, (gw / gl if gl else 0.0), dd


def main() -> None:
    import hist_batch as hb
    ds = dates()
    batch.TAPE = HIST
    batch._CACHE.clear()
    batch.DATES = ds
    ds = [d for d in ds if hb.chain_complete(d)]
    train = [d for d in ds if d < "2025-11-01"]
    test = [d for d in ds if d >= "2025-11-01"]
    V = [
        ("straddle", {"kind": "straddle", "target": 0.5, "stop": 2.0}),
        ("strangle", {"kind": "strangle", "target": 0.5, "stop": 2.0}),
        ("iron condor", {"kind": "iron_condor", "target": 0.5, "stop": 2.0}),
        ("bull put", {"kind": "bull_put", "target": 0.5, "stop": 2.0}),
        ("bear call", {"kind": "bear_call", "target": 0.5, "stop": 2.0}),
        ("strangle 25/2", {"kind": "strangle", "target": 0.25, "stop": 2.0}),
        ("strangle 50/1", {"kind": "strangle", "target": 0.5, "stop": 1.0}),
        ("condor 50/1", {"kind": "iron_condor", "target": 0.5, "stop": 1.0}),
        ("strangle 10:30", {"kind": "strangle", "target": 0.5, "stop": 2.0, "entry_hour": 10, "entry_min": 30}),
        ("strangle 12:00", {"kind": "strangle", "target": 0.5, "stop": 2.0, "entry_hour": 12, "entry_min": 0}),
    ]
    print(f"{'structure':16s} {'TRn':>4s} {'TRPF':>5s} {'TRnet':>8s} | {'TEn':>4s} {'TEPF':>5s} {'TEnet':>8s} {'TEDD':>7s} {'TEwin':>5s}")
    for name, cfg in V:
        a = stats([t for d in train for t in run(d, cfg)])
        b = stats([t for d in test for t in run(d, cfg)])
        print(f"{name:16s} {a[0]:4d} {a[3]:5.2f} {a[2]:+8.0f} | {b[0]:4d} {b[3]:5.2f} {b[2]:+8.0f} {b[4]:+7.0f} {b[1]/max(1,b[0])*100:4.0f}%")


if __name__ == "__main__":
    main()
