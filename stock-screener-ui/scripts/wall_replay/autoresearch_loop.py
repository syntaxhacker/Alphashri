#!/usr/bin/env python3
"""Autoresearch wave: exit/hold configurations for the wall-fade book.

Runs each config on train / test / live with 6 workers, logs to
reports/WALL_REPLAY/autoresearch/autoresearch.jsonl + experiments/worklog.md.

Usage:
    .venv/bin/python scripts/wall_replay/autoresearch_loop.py
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

CONFIGS = [
    ("baseline (51 trades)", {}),
    ("hold 60", {"hold": 60}),
    ("hold 120", {"hold": 120}),
    ("hold to EOD", {"hold": 999}),
    ("no partial", {"partial": False}),
    ("no partial + hold EOD", {"partial": False, "hold": 999}),
    ("no trail + no partial + hold EOD", {"partial": False, "hold": 999, "arm": 99}),
    ("stop 25%", {"stop": 0.25}),
    ("stop 35%", {"stop": 0.35}),
    ("stop 50%", {"stop": 0.50}),
    ("wall stop 15 pts", {"wall_stop_pts": 15}),
    ("wall stop 25 pts", {"wall_stop_pts": 25}),
    ("wall stop 35 pts", {"wall_stop_pts": 35}),
    ("1 trade/day", {"max_per_day": 1}),
    ("no partial + stop 35%", {"partial": False, "stop": 0.35}),
    ("no partial + wall stop 20", {"partial": False, "wall_stop_pts": 20}),
    ("no trail + no partial + stop 35% + 1/day",
     {"partial": False, "hold": 999, "arm": 99, "stop": 0.35, "max_per_day": 1}),
    ("no trail + no partial + wall stop 25 + 1/day",
     {"partial": False, "hold": 999, "arm": 99, "wall_stop_pts": 25, "max_per_day": 1}),
    ("no trail + no partial + hold EOD + hour 14",
     {"partial": False, "hold": 999, "arm": 99, "hour_max": 14}),
    ("no trail + no partial + wall stop 25 + hour 14",
     {"partial": False, "hold": 999, "arm": 99, "wall_stop_pts": 25, "hour_max": 14}),
]


def sessions() -> tuple[list[str], list[str], list[str]]:
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
    if not jsonl.exists():
        jsonl.write_text(json.dumps({"type": "config", "name": "fade-hold",
                                     "metricName": "test_net", "metricUnit": "INR",
                                     "bestDirection": "higher"}) + "\n")
    worklog = OUT / "experiments" / "worklog.md"
    if not worklog.exists():
        worklog.write_text("# Worklog — fade hold study\n\n")

    best = None
    for n, (name, over) in enumerate(CONFIGS, start=1):
        cfg = {**BASE, **over}
        t0 = time.time()
        tr = pl.run_dates(train, cfg, HIST)
        te = pl.run_dates(test, cfg, HIST)
        lv = pl.run_dates(live, cfg, TAPE)
        a, b, c = hb.curve_stats(tr), hb.curve_stats(te), hb.curve_stats(lv)
        score = b["net"] if (a["pf"] >= 1.3 and a["n"] >= 10) else -1e9
        row = {"run": n, "commit": "-", "metric": round(score, 1),
               "metrics": {"train_net": round(a["net"]), "train_pf": round(a["pf"], 2),
                           "train_n": a["n"], "test_net": round(b["net"]),
                           "test_pf": round(b["pf"], 2), "test_n": b["n"],
                           "test_dd": round(b["dd"]), "live_net": round(c["net"]),
                           "live_n": c["n"], "secs": round(time.time() - t0, 1)},
               "status": "keep" if (best is None or score > best[1]) and score > -1e8 else "discard",
               "description": name, "timestamp": int(time.time()), "segment": 0}
        if row["status"] == "keep":
            best = (name, score)
        with jsonl.open("a") as f:
            f.write(json.dumps(row) + "\n")
        with worklog.open("a") as f:
            f.write(f"### Run {n}: {name} — test_net={b['net']:+.0f} ({row['status']})\n"
                    f"- train: n={a['n']} net={a['net']:+.0f} PF={a['pf']:.2f} DD={a['dd']:+.0f}\n"
                    f"- test:  n={b['n']} net={b['net']:+.0f} PF={b['pf']:.2f} DD={b['dd']:+.0f}\n"
                    f"- live:  n={c['n']} net={c['net']:+.0f}\n"
                    f"- config: {over}\n\n")
        print(f"{n:2d} {name:48s} TR n={a['n']:2d} PF={a['pf']:5.2f} | "
              f"TE n={b['n']:2d} PF={b['pf']:5.2f} net={b['net']:+8.0f} DD={b['dd']:+7.0f} | "
              f"LIVE n={c['n']:2d} {c['net']:+6.0f} | {row['status']}", flush=True)

    print(f"\nbest: {best}")


if __name__ == "__main__":
    main()
