#!/usr/bin/env python3
"""Run the wall book on the USB historical archive (397 sessions, 2024-09 -> 2026-03).

Same engine and config as `scripts/wall_replay/report.py` (AGGR): 1-pt break,
OI >= 100k, ITM-50 strike, 20-min hold, +15% arm, 10% give-back, 15% stop,
volume-at-the-wall, EOD 15:00, partial at the next wall.

Usage:
    .venv/bin/python scripts/wall_replay/hist_batch.py            # AGGR + sweep
    .venv/bin/python scripts/wall_replay/hist_batch.py --no-sweep
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "wall_replay"))
import batch  # noqa: E402

HIST = ROOT / "experiments" / "data" / "nifty_hist"
OUT = ROOT / "reports" / "WALL_REPLAY" / "hist"
OUT.mkdir(parents=True, exist_ok=True)

AGGR = {"break": 1, "oi": 100_000, "stop": 0.15, "arm": 0.15, "give": 0.10,
        "corridor": 30, "room": 20, "hold": 20, "ema": False, "partial": True,
        "gex": "none", "target": "wall", "htf": "none", "vwap": "none",
        "vol": "break", "mp": "none", "strike": "itm"}


def chain_complete(date: str) -> bool:
    """True when the front chain is a 50-pt grid within +/-300 of spot.

    The early archive folders are a sparse strike sample (gaps of 100-400 pts),
    so the wall ranking there is meaningless. Only the 2025-06-26+ folders are
    a complete 50-pt grid.
    """
    rs = batch.rows(date)
    if len(rs) < 340:
        return False
    if rs[0]["t"][11:16] > "09:20" or rs[-1]["t"][11:16] < "15:20":
        return False
    r = rs[len(rs) // 2]
    spot = float(r["spot"])
    ks = sorted(float(k) for k in r["chain"])
    near = [k for k in ks if abs(k - spot) <= 300]
    if len(near) < 12:
        return False
    return max(near[i + 1] - near[i] for i in range(len(near) - 1)) <= 50


def use_hist() -> list[str]:
    batch.TAPE = HIST
    batch._CACHE.clear()
    dates = sorted(p.stem for p in HIST.glob("*.jsonl") if not p.stem.startswith("_"))
    batch.DATES = dates
    return dates


def curve_stats(trades: list[dict]) -> dict:
    eq, peak, dd = 0.0, 0.0, 0.0
    for t in sorted(trades, key=lambda x: x["exit_time"]):
        eq += t["net"]
        peak = max(peak, eq)
        dd = min(dd, eq - peak)
    n = len(trades)
    wins = [t for t in trades if t["net"] > 0]
    gw = sum(t["net"] for t in wins)
    gl = -sum(t["net"] for t in trades if t["net"] < 0)
    return {"n": n, "win": len(wins), "net": sum(t["net"] for t in trades),
            "pf": (gw / gl if gl else 0.0), "dd": dd,
            "avg": (sum(t["net"] for t in trades) / n if n else 0.0),
            "gross": sum(t["gross"] for t in trades),
            "costs": sum(t["costs"] for t in trades)}


def run_all(dates: list[str], cfg: dict) -> list[dict]:
    out = []
    for d in dates:
        try:
            out += batch.run(d, cfg)
        except Exception as exc:  # noqa: BLE001
            print(f"  !! {d}: {exc}", file=sys.stderr)
    return out


def fmt(s: dict) -> str:
    return (f"n={s['n']:3d} win={s['win']:3d} net={s['net']:+9.0f} "
            f"PF={s['pf']:5.2f} DD={s['dd']:+8.0f} avg={s['avg']:+7.0f}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-sweep", action="store_true")
    args = ap.parse_args()

    all_dates = use_hist()
    dates = [d for d in all_dates if chain_complete(d)]
    print(f"historical sessions: {len(all_dates)}  ({all_dates[0]} -> {all_dates[-1]})")
    print(f"complete-chain sessions: {len(dates)}  ({dates[0]} -> {dates[-1]})", flush=True)

    trades = run_all(dates, AGGR)
    s = curve_stats(trades)
    print("\n=== AGGR (current book) ===")
    print(fmt(s))
    print(f"  gross={s['gross']:+.0f} costs={s['costs']:.0f}")

    # per month
    bym = defaultdict(list)
    for t in trades:
        bym[t["entry_time"][:7]].append(t)
    print("\nby month:")
    for m in sorted(bym):
        print(f"  {m} {fmt(curve_stats(bym[m]))}")

    # by entry type / exit reason
    for key, label in (("why", "entry"), ("reason", "exit"), ("opt", "leg")):
        g = defaultdict(list)
        for t in trades:
            g[t[key]].append(t)
        print(f"\nby {label}:")
        for k in sorted(g, key=lambda x: -sum(t["net"] for t in g[x])):
            print(f"  {k:12s} {fmt(curve_stats(g[k]))}")

    # daily
    byd = defaultdict(list)
    for t in trades:
        byd[t["entry_time"][:10]].append(t)
    neg = sorted((sum(t["net"] for t in v), k) for k, v in byd.items())[:8]
    pos = sorted(((sum(t["net"] for t in v), k) for k, v in byd.items()), reverse=True)[:8]
    print("\nworst days:", ", ".join(f"{k}:{v:+.0f}" for v, k in neg))
    print("best days: ", ", ".join(f"{k}:{v:+.0f}" for v, k in pos))

    (OUT / "hist_trades.json").write_text(json.dumps(
        [{k: t.get(k) for k in ("entry_time", "exit_time", "opt", "strike", "entry",
                                "exit", "net", "gross", "costs", "reason", "why",
                                "partial", "partial_px")} for t in trades], indent=1))

    if not args.no_sweep:
        print("\n=== sensitivity (net / n / PF) ===")
        rows = []
        grid = {
            "break": [1, 2, 3, 5],
            "oi": [100_000, 300_000, 500_000],
            "stop": [0.15, 0.20, 0.25],
            "give": [0.10, 0.20, 0.30],
            "hold": [0, 10, 20],
            "strike": ["itm", "wall"],
        }
        for k, vals in grid.items():
            for v in vals:
                cfg = {**AGGR, k: v}
                tr = run_all(dates, cfg)
                st = curve_stats(tr)
                rows.append((k, v, st))
                print(f"  {k:7s}={str(v):8s} net={st['net']:+9.0f} n={st['n']:3d} "
                      f"PF={st['pf']:5.2f} DD={st['dd']:+8.0f}")
        (OUT / "hist_sweep.json").write_text(json.dumps(
            [{"param": k, "value": v, **st} for k, v, st in rows], indent=1))


if __name__ == "__main__":
    main()
