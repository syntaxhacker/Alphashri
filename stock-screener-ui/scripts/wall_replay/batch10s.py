#!/usr/bin/env python3
"""v3.1 wall playbook on the 10-second chain (Oct 26-30) — larger sample.

The 1-minute tape gives 6-9 trades; the 10s chain has ~5x the rows and no
pre-computed walls, so the walls and max pain are derived from the chain OI.
Signal at row t, fill at t+1; stops/targets walked forward.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from options_paper import costs  # noqa: E402

DIR = ROOT / "experiments" / "data" / "nifty_chain10s"
LOT = 65
CFG = {"break": 5, "oi": 500_000, "stop": 0.15, "arm": 0.15, "give": 0.20}
DATES = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]


def load(date):
    p = DIR / f"{date}.jsonl"
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]


def chain(r):
    out = {}
    for row in r.get("rows") or []:
        try:
            out[float(row[0])] = (float(row[1]), float(row[4]), float(row[2]), float(row[5]))
        except (IndexError, TypeError, ValueError):
            continue
    return out


def walls(ch, spot):
    calls = sorted([(s, v[2]) for s, v in ch.items() if s >= spot and v[2] > 0], key=lambda x: -x[1])[:3]
    puts = sorted([(s, v[3]) for s, v in ch.items() if s <= spot and v[3] > 0], key=lambda x: -x[1])[:3]
    return calls, puts


def max_pain(ch):
    ks = sorted(ch)
    best, best_k = None, 0.0
    for k in ks:
        pain = sum(max(0.0, k - s) * ch[s][2] for s in ks) + sum(max(0.0, s - k) * ch[s][3] for s in ks)
        if best is None or pain < best:
            best, best_k = pain, k
    return best_k


def px(r, strike, opt):
    v = chain(r).get(float(strike))
    return 0.0 if not v else (v[0] if opt == "CE" else v[1])


def oi(r, strike, opt):
    v = chain(r).get(float(strike))
    return 0.0 if not v else (v[2] if opt == "CE" else v[3])


def oi30(rs, i, strike, opt):
    now, then = oi(rs[i], strike, opt), oi(rs[max(0, i - 30)], strike, opt)
    return None if (now <= 0 or then <= 0) else now - then


def atr(spots):
    d = [abs(spots[i] - spots[i - 1]) for i in range(max(1, len(spots) - 14), len(spots))]
    return sum(d) / len(d) if d else 0.0


def run(date):
    rs = load(date)
    spots = [float(r["spot"]) for r in rs]
    trades, pos = [], None
    last_exit = -999
    top = {"put": (0.0, 0), "call": (0.0, 0)}

    for i in range(1, len(rs) - 1):
        r, spot = rs[i], float(rs[i]["spot"])
        tm = datetime.fromisoformat(r["t"]).time()
        ch = chain(r)

        if pos:
            p = px(r, pos["strike"], pos["opt"])
            if p > 0:
                long = True
                pos["best"] = max(pos["best"], p)
                fav = (p - pos["entry"]) / pos["entry"]
                if fav >= CFG["arm"]:
                    trail = pos["entry"] + (1 - CFG["give"]) * (pos["best"] - pos["entry"])
                    pos["stop"] = max(pos["stop"], trail)
                calls, puts = walls(ch, spot)
                opp = bool(puts) and spot < puts[0][0] and (puts[0][0] - spot) >= 5 and \
                    abs(oi30(rs, i, puts[0][0], "PE") or 0) >= CFG["oi"]
                reason = None
                if p <= pos["stop"]:
                    reason = "STOP"
                elif spot >= pos["target_spot"] and p > pos["entry"]:
                    reason = "TARGET"
                elif opp:
                    reason = "OPPOSITE"
                elif tm >= time(15, 0):
                    reason = "EOD"
                if reason:
                    res = costs.option_round_trip_cost(pos["entry"], p, LOT, is_short=False)
                    trades.append({**pos, "exit": p, "net": res["net_pnl"], "reason": reason})
                    pos = None
                    last_exit = i
            if pos:
                continue

        if tm < time(9, 30) or i - last_exit < 90:  # 90 x 10s = 15 min
            continue
        calls, puts = walls(ch, spot)
        if not calls or not puts:
            continue
        sup, res = puts[0], calls[0]
        top["put"] = (sup[0], top["put"][1] + 1 if top["put"][0] == sup[0] else 1)
        top["call"] = (res[0], top["call"][1] + 1 if top["call"][0] == res[0] else 1)
        a = atr(spots[: i + 1])
        mp = max_pain(ch)
        corridor = res[0] - sup[0]
        prev = float(rs[i - 1]["spot"])

        if prev < res[0] <= spot and (spot - res[0]) >= CFG["break"]:
            d = oi30(rs, i, res[0], "CE")
            nxt = calls[1] if len(calls) > 1 else None
            if d is not None and abs(d) >= CFG["oi"] and (not nxt or nxt[0] - spot >= 50):
                fill = px(rs[i + 1], res[0], "CE")
                if fill > 0:
                    pos = {"opt": "CE", "strike": res[0], "entry": fill, "best": fill,
                           "stop": fill * (1 - CFG["stop"]),
                           "target_spot": nxt[0] if nxt else spot + 100, "why": "break up"}
                    continue
        if prev > sup[0] >= spot and (sup[0] - spot) >= CFG["break"]:
            d = oi30(rs, i, sup[0], "PE")
            nxt = puts[1] if len(puts) > 1 else None
            if d is not None and abs(d) >= CFG["oi"] and (not nxt or spot - nxt[0] >= 50):
                fill = px(rs[i + 1], sup[0], "PE")
                if fill > 0:
                    pos = {"opt": "PE", "strike": sup[0], "entry": fill, "best": fill,
                           "stop": fill * (1 - CFG["stop"]),
                           "target_spot": nxt[0] if nxt else spot - 100, "why": "break down"}
                    continue
        if top["put"][1] >= 18 and corridor >= 50 and 0 <= spot - sup[0] <= max(5, 0.5 * a) and mp - spot >= 40:
            if spots[i] > spots[i - 6] > spots[i - 12]:
                fill = px(rs[i + 1], sup[0], "CE")
                if fill > 0:
                    pos = {"opt": "CE", "strike": sup[0], "entry": fill, "best": fill,
                           "stop": fill * (1 - CFG["stop"]), "target_spot": res[0], "why": "fade put"}
                    continue
        if top["call"][1] >= 18 and corridor >= 50 and 0 <= res[0] - spot <= max(5, 0.5 * a) and spot - mp >= 40:
            if spots[i] < spots[i - 6] < spots[i - 12]:
                fill = px(rs[i + 1], res[0], "PE")
                if fill > 0:
                    pos = {"opt": "PE", "strike": res[0], "entry": fill, "best": fill,
                           "stop": fill * (1 - CFG["stop"]), "target_spot": sup[0], "why": "fade call"}
                    continue
    return trades


def main():
    total = []
    for d in DATES:
        tr = run(d)
        total += tr
        net = sum(t["net"] for t in tr)
        w = sum(1 for t in tr if t["net"] > 0)
        print(f"{d} n={len(tr)} win={w} net={net:+.0f} " +
              " ".join(f"{t['opt']}@{t['strike']:.0f}:{t['net']:+.0f}({t['reason'][:3]},{t['why'][:6]})" for t in tr))
    n = len(total)
    w = sum(1 for t in total if t["net"] > 0)
    net = sum(t["net"] for t in total)
    gw = sum(t["net"] for t in total if t["net"] > 0)
    gl = -sum(t["net"] for t in total if t["net"] < 0)
    print(f"\nTOTAL n={n} win={w} ({(w/n*100 if n else 0):.0f}%) net={net:+,.0f} PF={(gw/gl if gl else 0):.2f}")


if __name__ == "__main__":
    main()
