#!/usr/bin/env python3
"""Autoresearch wave 2 — wall-to-wall OI trades.

Enter at one OI wall (fade), target the OPPOSITE wall in full, stop only if the
entry wall breaks. Requires a wide corridor so the wall-to-wall move is worth
the risk. 6 workers, logs to the same autoresearch state.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "wall_replay"))
sys.path.insert(0, str(ROOT))
import batch  # noqa: E402
import hist_batch as hb  # noqa: E402
import parallel as pl  # noqa: E402

HIST = ROOT / "experiments" / "data" / "nifty_hist"
TAPE = ROOT / "experiments" / "data" / "nifty_tape"
OUT = ROOT / "reports" / "WALL_REPLAY" / "autoresearch"
(OUT / "experiments").mkdir(parents=True, exist_ok=True)

BASE = {**hb.AGGR, "failed_fade": False, "wall_oi_rising": True, "hour_max": 12,
        "give": 0.2, "strike": "wall", "prox_atr": 1.25, "reject_bars": 1}
W2W = {**BASE, "target_mode": "full", "partial": False, "arm": 99, "stop": 0.5,
       "wall_stop_pts": 25, "min_corridor": 80}

CONFIGS = [
    ("w2w base (cor80, wallstop25, full)", {}),
    ("corridor 50", {"min_corridor": 50}),
    ("corridor 100", {"min_corridor": 100}),
    ("corridor 120", {"min_corridor": 120}),
    ("corridor 150", {"min_corridor": 150}),
    ("wall stop 15", {"wall_stop_pts": 15}),
    ("wall stop 35", {"wall_stop_pts": 35}),
    ("trail on (arm15, give20)", {"arm": 0.15, "give": 0.2, "hold": 60}),
    ("cor100 + wallstop35", {"min_corridor": 100, "wall_stop_pts": 35}),
    ("cor120 + wallstop35", {"min_corridor": 120, "wall_stop_pts": 35}),
    ("1 trade/day", {"max_per_day": 1}),
    ("cor100 + 1/day", {"min_corridor": 100, "max_per_day": 1}),
    ("cor120 + 1/day", {"min_corridor": 120, "max_per_day": 1}),
    ("hour 14", {"hour_max": 14}),
    ("cor100 + hour14", {"min_corridor": 100, "hour_max": 14}),
    ("cor100 + stop35% + wallstop25", {"min_corridor": 100, "stop": 0.35}),
    ("cor100 + wallstop15", {"min_corridor": 100, "wall_stop_pts": 15}),
    ("cor100 + trail arm15 give50", {"min_corridor": 100, "arm": 0.15, "give": 0.5, "hold": 60}),
    ("cor100 + partial + hold60", {"min_corridor": 100, "target_mode": "partial", "partial": True,
                                   "hold": 60, "arm": 0.15}),
    ("cor100 + 1/day + wallstop35", {"min_corridor": 100, "max_per_day": 1, "wall_stop_pts": 35}),
]


def sessions():
    all_d = sorted(p.stem for p in HIST.glob("*.jsonl") if not p.stem.startswith("_") and ".gaps" not in p.stem)
    batch.TAPE = HIST
    batch._CACHE.clear()
    batch.DATES = all_d
    d = [x for x in all_d if hb.chain_complete(x)]
    live = sorted(p.stem for p in TAPE.glob("2026-*.jsonl") if ".gaps" not in p.stem)
    return [x for x in d if x < "2025-11-01"], [x for x in d if x >= "2025-11-01"], live


def main() -> None:
    train, test, live = sessions()
    print(f"train {len(train)} test {len(test)} live {len(live)} workers={pl.WORKERS}", flush=True)
    jsonl = OUT / "autoresearch.jsonl"
    with jsonl.open("a") as f:
        f.write(json.dumps({"type": "config", "name": "fade-w2w",
                            "metricName": "test_net", "metricUnit": "INR",
                            "bestDirection": "higher"}) + "\n")
    worklog = OUT / "experiments" / "worklog.md"
    best = None
    for n, (name, over) in enumerate(CONFIGS, start=1):
        cfg = {**W2W, **over}
        t0 = time.time()
        tr = pl.run_dates(train, cfg, HIST)
        te = pl.run_dates(test, cfg, HIST)
        lv = pl.run_dates(live, cfg, TAPE)
        a, b, c = hb.curve_stats(tr), hb.curve_stats(te), hb.curve_stats(lv)
        score = b["net"] if (a["pf"] >= 1.3 and a["n"] >= 6) else -1e9
        row = {"run": n, "commit": "-", "metric": round(score, 1),
               "metrics": {"train_net": round(a["net"]), "train_pf": round(a["pf"], 2),
                           "train_n": a["n"], "test_net": round(b["net"]),
                           "test_pf": round(b["pf"], 2), "test_n": b["n"],
                           "test_dd": round(b["dd"]), "test_avg": round(b["avg"]),
                           "live_net": round(c["net"]), "live_n": c["n"],
                           "secs": round(time.time() - t0, 1)},
               "status": "keep" if (best is None or score > best[1]) and score > -1e8 else "discard",
               "description": name, "timestamp": int(time.time()), "segment": 1}
        if row["status"] == "keep":
            best = (name, score)
        with jsonl.open("a") as f:
            f.write(json.dumps(row) + "\n")
        with worklog.open("a") as f:
            f.write(f"### W2W {n}: {name} — test_net={b['net']:+.0f} ({row['status']})\n"
                    f"- train: n={a['n']} net={a['net']:+.0f} PF={a['pf']:.2f} DD={a['dd']:+.0f}\n"
                    f"- test:  n={b['n']} net={b['net']:+.0f} PF={b['pf']:.2f} DD={b['dd']:+.0f} avg={b['avg']:+.0f}\n"
                    f"- live:  n={c['n']} net={c['net']:+.0f}\n- config: {over}\n\n")
        print(f"{n:2d} {name:44s} TR n={a['n']:2d} PF={a['pf']:5.2f} | "
              f"TE n={b['n']:2d} PF={b['pf']:5.2f} net={b['net']:+8.0f} DD={b['dd']:+7.0f} "
              f"avg={b['avg']:+5.0f} | LIVE n={c['n']:2d} {c['net']:+6.0f} | {row['status']}", flush=True)
    print(f"\nbest: {best}")


if __name__ == "__main__":
    main()
