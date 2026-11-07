#!/usr/bin/env python3
"""v3.1 wall playbook — parameter sweep over the whole tape (one request).

Signal at bar t, fill at t+1, stops/targets walked forward. The sweep is
in-sample: it shows sensitivity, not proof. A config is only interesting if it
keeps PF > 1.3 with enough trades, not if it wins the grid.
"""

from __future__ import annotations

import itertools
import json
import math
import statistics
import sys
from datetime import datetime, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from options_paper import costs  # noqa: E402

TAPE = ROOT / "experiments" / "data" / "nifty_tape"
LOT = 65
DEFAULT = {"break": 5, "oi": 500_000, "stop": 0.15, "arm": 0.15, "give": 0.10, "corridor": 50, "room": 40, "hold": 20, "ema": False, "partial": True, "gex": "none", "target": "wall", "htf": "none", "vwap": "none", "vol": "none", "mp": "none", "open": "0930", "strike": "wall", "iv": "none", "vol_mult": 1.0, "fade_bars": 2}


_CACHE = {}
DATES = sorted(p.stem for p in TAPE.glob("2026-*.jsonl") if ".gaps" not in p.stem)


def prev_close(date):
    idx = DATES.index(date) if date in DATES else -1
    if idx <= 0:
        return 0.0
    rs = rows(DATES[idx - 1])
    return float(rs[-1]["spot"]) if rs else 0.0


def vol(r, strike, opt):
    leg = (r.get("chain") or {}).get(str(int(strike))) or (r.get("chain") or {}).get(str(strike))
    if leg and len(leg) >= 6:
        return float(leg[4] if opt == "CE" else leg[5])
    return 0.0


def vol5(rs, i, strike, opt):
    now, then = vol(rs[i], strike, opt), vol(rs[max(0, i - 5)], strike, opt)
    return None if (now <= 0 or then <= 0) else now - then


def vol_med(rs, i, strike, opt):
    vals = []
    for j in range(5, i + 1, 5):
        v = vol5(rs, j, strike, opt)
        if v and v > 0:
            vals.append(v)
    return sorted(vals)[len(vals) // 2] if vals else 0.0


def _mp_ok(cfg, r, spot, why):
    if cfg.get("mp", "none") == "none":
        return True
    mp = float(r.get("max_pain") or 0)
    if not mp:
        return True
    if why == "break up":
        return mp >= spot - 5
    if why == "break down":
        return mp <= spot + 5
    return True


def _vol_ok(cfg, rs, i, strike, opt, why):
    mode = cfg.get("vol", "none")
    if mode == "none":
        return True
    if mode == "break" and why.startswith("fade"):
        return True
    if mode == "fade" and why.startswith("break"):
        return True
    v = vol5(rs, i, strike, opt)
    if v is None:
        return True
    if v <= 0:
        return False
    med = vol_med(rs, i, strike, opt)
    if med <= 0:
        return True
    return v >= (1.5 * med if mode == "ratio" else med * float(cfg.get("vol_mult", 1.0)))


def _vwap_ok(cfg, closes, i, spot, why):
    mode = cfg.get("vwap", "none")
    if mode == "none":
        return True
    win = closes[max(0, i - 29): i + 1]
    vwap = sum(win) / len(win) if win else spot
    bull = why in ("break up", "fade put")
    if mode == "trend":
        return (spot > vwap) if bull else (spot < vwap)
    if mode == "fade":
        return (spot < vwap) if bull else (spot > vwap)
    if mode == "dist":
        return abs(spot - vwap) >= 20
    if mode == "combo":
        if why.startswith("fade"):
            return abs(spot - vwap) >= 15
        return (spot > vwap) if why == "break up" else (spot < vwap)
    return True


def _htf_ok(cfg, closes, i, spot, why, date):
    mode = cfg.get("htf", "none")
    if mode == "none":
        return True
    bull = why in ("break up", "fade put")
    if mode == "daily":
        bias = "up" if spot > prev_close(date) else "down"
    else:
        fast, slow = {"ema15": (9, 30), "ema30": (9, 60), "ema60": (9, 120)}[mode]
        bias = "up" if ema(closes[: i + 1], fast) > ema(closes[: i + 1], slow) else "down"
    return bias == ("up" if bull else "down")
_GEX = {}


def gex_regime(date, row):
    """Report GEX regime at the row's minute (snapshot), cached per date."""
    if date not in _GEX:
        out = {}
        p = ROOT / "experiments" / "data" / "nifty_snapshots" / f"{date}.jsonl"
        if p.exists():
            with open(p) as f:
                for line in f:
                    if not line.strip():
                        continue
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    g = (r.get("report") or {}).get("gex") or {}
                    reg = g.get("regime")
                    if reg:
                        out[r["t"][11:16]] = reg
        _GEX[date] = out
    return _GEX[date].get(row["t"][11:16], "flat")


def rows(date):
    if date not in _CACHE:
        _CACHE[date] = [json.loads(l) for l in (TAPE / f"{date}.jsonl").read_text().splitlines() if l.strip()]
    return _CACHE[date]


def px(r, strike, opt):
    leg = (r.get("chain") or {}).get(str(int(strike))) or (r.get("chain") or {}).get(str(strike))
    if leg and len(leg) >= (1 if opt == "CE" else 2):
        return float(leg[0] if opt == "CE" else leg[1])
    atm = r.get("atm_strike")
    if atm and abs(float(strike) - float(atm)) < 0.5:
        return float(r.get("atm_ce_ltp") if opt == "CE" else r.get("atm_pe_ltp") or 0)
    return 0.0


def oi(r, strike, opt):
    leg = (r.get("chain") or {}).get(str(int(strike))) or (r.get("chain") or {}).get(str(strike))
    if leg and len(leg) >= 4:
        return float(leg[2] if opt == "CE" else leg[3])
    for w in (r.get("walls") or {}).get("calls" if opt == "CE" else "puts") or []:
        if abs(float(w.get("strike") or 0) - float(strike)) < 0.5:
            return float(w.get("oi") or 0)
    return 0.0


def oi5(rs, i, strike, opt):
    now, then = oi(rs[i], strike, opt), oi(rs[max(0, i - 5)], strike, opt)
    return None if (now <= 0 or then <= 0) else now - then


def ema(vals, n=9):
    if not vals:
        return 0.0
    k = 2.0 / (n + 1)
    out = vals[0]
    for v in vals[1:]:
        out = v * k + out * (1 - k)
    return out


def atr(closes):
    d = [abs(closes[i] - closes[i - 1]) for i in range(max(1, len(closes) - 14), len(closes))]
    return sum(d) / len(d) if d else 0.0


def _rv30(closes):
    if len(closes) < 8:
        return None
    r = [closes[j] / closes[j - 1] - 1 for j in range(1, len(closes))][-30:]
    if len(r) < 5:
        return None
    return statistics.stdev(r) * math.sqrt(252 * 375) * 100


def _iv_ok(cfg, r, closes, opt):
    mode = cfg.get("iv", "none")
    if mode == "none":
        return True
    iv = r.get("atm_ce_iv") if opt == "CE" else r.get("atm_pe_iv")
    if not iv:
        return False
    rv = _rv30(closes)
    if not rv:
        return False
    return float(iv) / rv >= 1.15


def _try_entry(cfg, rs, i, date, closes, spot, why, opt, strike, target_spot):
    r = rs[i]
    wall_strike = strike
    if cfg.get("strike") == "itm":
        strike = strike - 50 if opt == "CE" else strike + 50
    if why.startswith("break"):
        gex_ok = not (cfg.get("gex") in ("break_short", "both")) or gex_regime(date, r) == "short"
    else:
        gex_ok = not (cfg.get("gex") in ("fade_long", "both")) or gex_regime(date, r) == "long"
    htf_ok = _htf_ok(cfg, closes, i, spot, why, date)
    vwap_ok = _vwap_ok(cfg, closes, i, spot, why)
    vol_ok = _vol_ok(cfg, rs, i, wall_strike, opt, why)
    mp_ok = _mp_ok(cfg, r, spot, why)
    iv_ok = _iv_ok(cfg, r, closes, opt)
    fill = px(rs[i + 1], strike, opt)
    if fill > 0 and gex_ok and htf_ok and vwap_ok and vol_ok and mp_ok and iv_ok:
        return {"dir": "LONG", "opt": opt, "strike": strike, "entry": fill,
                "best": fill, "stop": fill * (1 - cfg["stop"]),
                "target_spot": target_spot, "entry_time": rs[i + 1]["t"],
                "entry_i": i + 1, "why": why}
    return None


def run(date, cfg):
    rs = rows(date)
    closes = [float(r["spot"]) for r in rs]
    trades, pos = [], None
    last_exit_i = -999
    top = {"put": (0.0, 0), "call": (0.0, 0)}

    for i in range(1, len(rs) - 1):
        r, spot = rs[i], float(rs[i]["spot"])
        tm = datetime.fromisoformat(r["t"]).time()

        if pos:
            p = px(r, pos["strike"], pos["opt"])
            if p > 0:
                long = pos["dir"] == "LONG"
                pos["best"] = max(pos["best"], p) if long else min(pos["best"], p)
                fav = ((p - pos["entry"]) / pos["entry"]) if long else ((pos["entry"] - p) / pos["entry"])
                held = i - int(pos.get("entry_i", i))
                gate = held >= int(cfg.get("hold", 0))
                if gate and fav >= cfg["arm"]:
                    trail = (pos["entry"] + (1 - cfg["give"]) * (pos["best"] - pos["entry"]) if long
                             else pos["entry"] - (1 - cfg["give"]) * (pos["entry"] - pos["best"]))
                    pos["stop"] = max(pos["stop"], trail) if long else min(pos["stop"], trail)
                calls, puts = ((r.get("walls") or {}).get("calls") or [],
                               (r.get("walls") or {}).get("puts") or [])
                opp = False
                if long and puts:
                    w = puts[0]["strike"]
                    opp = spot < w and (w - spot) >= 5 and abs(oi5(rs, i, w, "PE") or 0) >= cfg["oi"]
                if not long and calls:
                    w = calls[0]["strike"]
                    opp = spot > w and (spot - w) >= 5 and abs(oi5(rs, i, w, "CE") or 0) >= cfg["oi"]
                e9 = ema(closes[: i + 1], int(cfg.get('ema_n', 9)))
                ema_exit = (gate and cfg.get("ema") and (
                    (long and spot < e9 and p > pos["entry"]) or
                    (not long and spot > e9 and p < pos["entry"])))
                target_hit = gate and (((spot >= pos["target_spot"]) and (p > pos["entry"])) if long else
                                       ((spot <= pos["target_spot"]) and (p < pos["entry"])))
                if target_hit and cfg.get("partial") and not pos.get("partial"):
                    pq = LOT // 2
                    cp = costs.option_round_trip_cost(pos["entry"], p, pq, is_short=(not long))
                    pos.update({"partial": True, "partial_px": p, "partial_time": r["t"],
                                "partial_net": cp["net_pnl"], "partial_gross": cp["gross_pnl"],
                                "partial_costs": cp["costs"], "qty": LOT - pq})
                reason = None
                if (p <= pos["stop"]) if long else (p >= pos["stop"]):
                    reason = "STOP"
                elif target_hit and not pos.get("partial") and not cfg.get("partial"):
                    reason = "TARGET"
                elif ema_exit:
                    reason = "EMA"
                elif opp:
                    reason = "OPPOSITE"
                elif tm >= time(15, 0):
                    reason = "EOD"
                if reason:
                    q = int(pos.get("qty", LOT))
                    cq = costs.option_round_trip_cost(pos["entry"], p, q, is_short=(not long))
                    net = cq["net_pnl"] + float(pos.get("partial_net", 0))
                    gross = cq["gross_pnl"] + float(pos.get("partial_gross", 0))
                    cst = cq["costs"] + float(pos.get("partial_costs", 0))
                    trades.append({**pos, "exit": p, "net": net, "gross": gross,
                                   "costs": cst, "reason": reason, "exit_time": r["t"]})
                    pos = None
                    last_exit_i = i
            if pos:
                continue

        if (tm < time(9, 30) and cfg.get("open", "0930") != "early") or i - last_exit_i < 15:
            continue
        calls, puts = ((r.get("walls") or {}).get("calls") or [],
                       (r.get("walls") or {}).get("puts") or [])
        sup = puts[0] if puts else None
        res = calls[0] if calls else None
        if sup:
            top["put"] = (sup["strike"], top["put"][1] + 1 if top["put"][0] == sup["strike"] else 1)
        if res:
            top["call"] = (res["strike"], top["call"][1] + 1 if top["call"][0] == res["strike"] else 1)
        a = atr(closes[: i + 1])
        mp = float(r.get("max_pain") or 0)
        corridor = (res["strike"] - sup["strike"]) if (res and sup) else 0.0
        prev = float(rs[i - 1]["spot"])

        # break up
        if res:
            w = res["strike"]
            if prev < w <= spot and (spot - w) >= cfg["break"]:
                d = oi5(rs, i, w, "CE")
                nxt = calls[1] if len(calls) > 1 else None
                if d is not None and abs(d) >= cfg["oi"] and (not nxt or nxt["strike"] - spot >= 50):
                    flip = float(r.get("flip") or 0)
                    tgt = flip if (cfg.get("target") == "flip" and flip > spot + 50) else (nxt["strike"] if nxt else spot + 100)
                    if cfg.get("target") == "max_pain" and mp > 0:
                        tgt = mp
                    pos = _try_entry(cfg, rs, i, date, closes, spot, "break up", "CE", w, tgt)
                    if pos:
                        continue
        # break down
        if sup:
            w = sup["strike"]
            if prev > w >= spot and (w - spot) >= cfg["break"]:
                d = oi5(rs, i, w, "PE")
                nxt = puts[1] if len(puts) > 1 else None
                if d is not None and abs(d) >= cfg["oi"] and (not nxt or spot - nxt["strike"] >= 50):
                    flip = float(r.get("flip") or 0)
                    tgt = flip if (cfg.get("target") == "flip" and flip < spot - 50) else (nxt["strike"] if nxt else spot - 100)
                    if cfg.get("target") == "max_pain" and mp > 0:
                        tgt = mp
                    pos = _try_entry(cfg, rs, i, date, closes, spot, "break down", "PE", w, tgt)
                    if pos:
                        continue
        # fade put
        if sup and top["put"][1] >= 3 and corridor >= cfg["corridor"]:
            if 0 <= spot - sup["strike"] <= max(5, 0.5 * a) and mp - spot >= cfg["room"]:
                if (closes[i] > closes[i - 1] > closes[i - 2]) if cfg.get("fade_bars", 2) >= 2 else (closes[i] > closes[i - 1]):
                    flip = float(r.get("flip") or 0)
                    tgt = flip if (cfg.get("target") == "flip" and flip > spot + 50) else (res["strike"] if res else spot + 100)
                    if cfg.get("target") == "max_pain" and mp > 0:
                        tgt = mp
                    pos = _try_entry(cfg, rs, i, date, closes, spot, "fade put", "CE", sup["strike"], tgt)
                    if pos:
                        continue
        # fade call
        if res and top["call"][1] >= 3 and corridor >= cfg["corridor"]:
            if 0 <= res["strike"] - spot <= max(5, 0.5 * a) and spot - mp >= cfg["room"]:
                if (closes[i] < closes[i - 1] < closes[i - 2]) if cfg.get("fade_bars", 2) >= 2 else (closes[i] < closes[i - 1]):
                    flip = float(r.get("flip") or 0)
                    tgt = flip if (cfg.get("target") == "flip" and flip < spot - 50) else (sup["strike"] if sup else spot - 100)
                    if cfg.get("target") == "max_pain" and mp > 0:
                        tgt = mp
                    pos = _try_entry(cfg, rs, i, date, closes, spot, "fade call", "PE", res["strike"], tgt)
                    if pos:
                        continue
    return trades


def stats(trades):
    n = len(trades)
    w = sum(1 for t in trades if t["net"] > 0)
    net = sum(t["net"] for t in trades)
    gw = sum(t["net"] for t in trades if t["net"] > 0)
    gl = -sum(t["net"] for t in trades if t["net"] < 0)
    return n, w, net, (gw / gl if gl else 0.0)


def main():
    dates = sorted(p.stem for p in TAPE.glob("2026-*.jsonl") if ".gaps" not in p.stem)
    # default run
    print("DEFAULT", DEFAULT)
    total = []
    for d in dates:
        tr = run(d, DEFAULT)
        total += tr
        n, w, net, pf = stats(tr)
        print(f"  {d} n={n} win={w} net={net:+.0f} " +
              " ".join(f"{t['opt']}@{t['strike']:.0f}:{t['net']:+.0f}({t['reason'][:3]},{t['why'][:6]})" for t in tr))
    n, w, net, pf = stats(total)
    print(f"  TOTAL n={n} win={w} net={net:+.0f} PF={pf:.2f}\n")

    # sweep
    results = []
    for brk, oim, stp, arm, cor, rm in itertools.product(
            [1, 2, 3, 5], [100_000, 200_000, 300_000, 500_000],
            [0.15, 0.20, 0.25], [0.10, 0.15], [30, 50], [20, 40]):
        cfg = {"break": brk, "oi": oim, "stop": stp, "arm": arm, "give": 0.20,
               "corridor": cor, "room": rm}
        tr = []
        for d in dates:
            tr += run(d, cfg)
        n, w, net, pf = stats(tr)
        results.append((net, n, w, pf, cfg))
    results.sort(key=lambda r: r[0], reverse=True)
    print("TOP 12 BY NET")
    for net, n, w, pf, cfg in results[:12]:
        print(f"  net={net:+7.0f} n={n:2d} win={w:2d} PF={pf:4.2f} "
              f"brk={cfg['break']} oi={cfg['oi']//1000}k stop={cfg['stop']:.2f} arm={cfg['arm']:.2f} cor={cfg['corridor']} rm={cfg['room']}")
    print("\nROBUST (n>=20, PF>=1.3, sorted by net)")
    robust = [r for r in results if r[1] >= 20 and r[3] >= 1.3]
    robust.sort(key=lambda r: r[0], reverse=True)
    for net, n, w, pf, cfg in robust[:10]:
        print(f"  net={net:+7.0f} n={n:2d} win={w:2d} PF={pf:4.2f} "
              f"brk={cfg['break']} oi={cfg['oi']//1000}k stop={cfg['stop']:.2f} arm={cfg['arm']:.2f} cor={cfg['corridor']} rm={cfg['room']}")
    if not robust:
        print("  none")


if __name__ == "__main__":
    main()
