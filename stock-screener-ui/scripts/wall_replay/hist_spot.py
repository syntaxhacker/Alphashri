#!/usr/bin/env python3
"""Spot-signal strategies executed on NIFTY options (1-min chain).

Signals are computed on the NIFTY spot only; execution is the ATM option.
Candidates: opening-range breakout, VWAP trend, VWAP fade, prior-day
high/low, max-pain magnet, gap fade, momentum burst.

Same data as the wall book: experiments/data/nifty_hist/<date>.jsonl.
Signal at bar t, fill at t+1. Costs from options_paper/costs.py.
"""

from __future__ import annotations

import statistics
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


def _ema(vals, n):
    if not vals:
        return 0.0
    k = 2.0 / (n + 1)
    out = vals[0]
    for v in vals[1:]:
        out = v * k + out * (1 - k)
    return out


def _atr(closes, n=14):
    d = [abs(closes[i] - closes[i - 1]) for i in range(max(1, len(closes) - n), len(closes))]
    return sum(d) / len(d) if d else 0.0


def prev_day(date: str) -> tuple[float, float, float]:
    ds = dates()
    i = ds.index(date)
    if i <= 0:
        return 0.0, 0.0, 0.0
    rs = batch.rows(ds[i - 1])
    if not rs:
        return 0.0, 0.0, 0.0
    sp = [float(r["spot"]) for r in rs]
    return max(sp), min(sp), sp[-1]


def atm(spot: float) -> float:
    return round(spot / 50.0) * 50.0


def run(date: str, cfg: dict) -> list[dict]:
    rs = batch.rows(date)
    if len(rs) < 60:
        return []
    closes = [float(r["spot"]) for r in rs]
    pdh, pdl, pdc = prev_day(date)
    # opening range 09:15-09:29
    or_rows = [float(r["spot"]) for r in rs if r["t"][11:16] <= "09:29"]
    orh, orl = (max(or_rows), min(or_rows)) if or_rows else (0.0, 0.0)
    kind = cfg.get("kind", "orb")
    trades, pos = [], None
    last_exit = -999

    for i in range(1, len(rs) - 1):
        r, spot = rs[i], float(rs[i]["spot"])
        tm = datetime.fromisoformat(r["t"]).time()
        prev = closes[i - 1]

        if pos:
            p = _px(r, pos["strike"], pos["opt"])
            if p > 0:
                pos["best"] = max(pos["best"], p)
                fav = (p - pos["entry"]) / pos["entry"]
                held = i - pos["entry_i"]
                if held >= cfg.get("hold", 0) and fav >= cfg.get("arm", 0.15):
                    pos["stop"] = max(pos["stop"], pos["entry"] + (1 - cfg.get("give", 0.2)) * (pos["best"] - pos["entry"]))
                reason = None
                if p <= pos["stop"]:
                    reason = "STOP"
                elif cfg.get("target") and p >= pos["entry"] * (1 + cfg["target"]):
                    reason = "TARGET"
                elif tm >= time(cfg.get("eod_hour", 15), cfg.get("eod_min", 0)):
                    reason = "EOD"
                if reason:
                    cq = costs.option_round_trip_cost(pos["entry"], p, LOT)
                    trades.append({**pos, "exit": p, "net": cq["net_pnl"],
                                   "entry_spot": pos.get("entry_spot"), "exit_spot": spot,
                                   "points": (spot - pos["entry_spot"]) * (1 if pos["opt"] == "CE" else -1),
                                   "gross": cq["gross_pnl"], "costs": cq["costs"],
                                   "reason": reason, "exit_time": r["t"]})
                    pos = None
                    last_exit = i
            if pos:
                continue

        if tm < time(9, 30) or i - last_exit < cfg.get("cooldown", 15):
            continue
        if cfg.get("max_per_day") and sum(1 for t in trades if t["entry_time"][:10] == date) >= cfg["max_per_day"]:
            continue

        a = _atr(closes[: i + 1])
        vwap = sum(closes[max(0, i - 29): i + 1]) / len(closes[max(0, i - 29): i + 1])
        e9 = _ema(closes[: i + 1], 9)
        e21 = _ema(closes[: i + 1], 21)
        mp = float(r.get("max_pain") or 0)
        sig = None
        if cfg.get("gap_align") and pdc:
            gap = closes[0] - pdc
            if (sig if False else None) is None:
                pass
        if cfg.get("min_pd_range") and pdh and pdl and pdc:
            if (pdh - pdl) / pdc < cfg["min_pd_range"]:
                continue
        if cfg.get("min_or_pct") and orh and orl:
            if (orh - orl) / closes[0] < cfg["min_or_pct"]:
                continue
        if kind == "orb" and orh and orl:
            if prev <= orh < spot:
                sig = "CE"
            elif prev >= orl > spot:
                sig = "PE"
        elif kind == "vwap_trend":
            if spot > vwap and e9 > e21 and closes[i - 1] <= vwap:
                sig = "CE"
            elif spot < vwap and e9 < e21 and closes[i - 1] >= vwap:
                sig = "PE"
        elif kind == "vwap_fade":
            if spot > vwap + cfg.get("z", 1.5) * a and closes[i] < closes[i - 1]:
                sig = "PE"
            elif spot < vwap - cfg.get("z", 1.5) * a and closes[i] > closes[i - 1]:
                sig = "CE"
        elif kind == "pdhl" and pdh and pdl:
            if prev <= pdh < spot:
                sig = "CE"
            elif prev >= pdl > spot:
                sig = "PE"
        elif kind == "maxpain" and mp:
            if mp - spot >= cfg.get("mp_dist", 80):
                sig = "CE"
            elif spot - mp >= cfg.get("mp_dist", 80):
                sig = "PE"
        elif kind == "gap" and pdc:
            gap = (closes[0] - pdc) / pdc
            if gap > cfg.get("gap_pct", 0.004):
                sig = "PE"
            elif gap < -cfg.get("gap_pct", 0.004):
                sig = "CE"
        elif kind == "momentum":
            if i >= 6:
                ret = (spot - closes[i - 5]) / closes[i - 5]
                sd = statistics.pstdev([(closes[j] - closes[j - 1]) / closes[j - 1] for j in range(max(1, i - 30), i + 1)])
                if ret > cfg.get("sig_mult", 2.0) * sd:
                    sig = "CE"
                elif ret < -cfg.get("sig_mult", 2.0) * sd:
                    sig = "PE"

        if not sig:
            continue
        if cfg.get("gap_align") and pdc:
            gap = closes[0] - pdc
            if sig == "CE" and gap <= 0:
                continue
            if sig == "PE" and gap >= 0:
                continue
        side = cfg.get("side", "both")
        if side == "long" and sig != "CE":
            continue
        if side == "short" and sig != "PE":
            continue
        strike = atm(spot) + (-50 if sig == "CE" else 50) * (1 if cfg.get("strike") == "itm" else 0)
        fill = _px(rs[i + 1], strike, sig)
        if fill <= 0:
            continue
        pos = {"dir": "LONG", "opt": sig, "strike": strike, "entry": fill, "best": fill,
               "entry_spot": float(rs[i + 1]["spot"]),
               "stop": fill * (1 - cfg.get("stop", 0.2)), "entry_i": i + 1,
               "entry_time": rs[i + 1]["t"], "why": kind}
    return trades


def stats(tr):
    n = len(tr)
    pts = [t.get("points", 0) for t in tr]
    w = sum(1 for t in tr if t["net"] > 0)
    net = sum(t["net"] for t in tr)
    gw = sum(t["net"] for t in tr if t["net"] > 0)
    gl = -sum(t["net"] for t in tr if t["net"] < 0)
    eq = peak = dd = 0.0
    for t in sorted(tr, key=lambda x: x["exit_time"]):
        eq += t["net"]
        peak = max(peak, eq)
        dd = min(dd, eq - peak)
    return n, w, net, (gw / gl if gl else 0.0), dd, (sum(pts) / n if n else 0.0), (max(pts) if pts else 0.0), sum(pts)


def main() -> None:
    ds = dates()
    batch.TAPE = HIST
    batch._CACHE.clear()
    batch.DATES = ds
    train = [d for d in ds if d < "2025-11-01"]
    test = [d for d in ds if d >= "2025-11-01"]
    V = [
        ("ORB", {"kind": "orb", "stop": 0.20, "target": 0.40, "hold": 30, "give": 0.2}),
        ("ORB trail", {"kind": "orb", "stop": 0.20, "target": 0, "hold": 30, "give": 0.2}),
        ("VWAP trend", {"kind": "vwap_trend", "stop": 0.20, "target": 0, "hold": 30, "give": 0.2}),
        ("VWAP fade", {"kind": "vwap_fade", "stop": 0.20, "target": 0.30, "hold": 30, "give": 0.2}),
        ("PDH/PDL", {"kind": "pdhl", "stop": 0.20, "target": 0.40, "hold": 30, "give": 0.2}),
        ("max pain", {"kind": "maxpain", "stop": 0.20, "target": 0, "hold": 30, "give": 0.2}),
        ("gap fade", {"kind": "gap", "stop": 0.20, "target": 0.30, "hold": 30, "give": 0.2}),
        ("momentum", {"kind": "momentum", "stop": 0.20, "target": 0.40, "hold": 30, "give": 0.2}),
    ]
    print(f"{'strategy':12s} {'TR n':>4s} {'TR PF':>5s} {'TR net':>8s} | {'TE n':>4s} {'TE PF':>5s} {'TE net':>8s} {'TE DD':>7s}")
    for name, cfg in V:
        a = stats([t for d in train for t in run(d, cfg)])
        b = stats([t for d in test for t in run(d, cfg)])
        print(f"{name:12s} {a[0]:4d} {a[3]:5.2f} {a[2]:+8.0f} | {b[0]:4d} {b[3]:5.2f} {b[2]:+8.0f} {b[4]:+7.0f} pts {b[5]:+5.1f} max {b[6]:+5.0f}")


if __name__ == "__main__":
    main()
