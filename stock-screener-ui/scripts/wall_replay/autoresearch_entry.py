#!/usr/bin/env python3
"""Autoresearch wave 3 — entry-side filters on top of the hold-60 fade.

One dimension at a time, then the winners get combined in wave 4.
Gate: train PF >= 1.5 (stricter than the earlier 1.3) and train n >= 10.
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

BASE = {**hb.AGGR, "failed_fade": False, "wall_oi_rising": True, "hour_max": 12,
        "give": 0.2, "strike": "wall", "prox_atr": 1.25, "reject_bars": 1, "hold": 60}

CONFIGS = [
    ("base hold60", {}),
    ("hour 9-11", {"hour_max": 11}),
    ("hour 10-12", {"hour_min": 10, "hour_max": 12}),
    ("hour 9-13", {"hour_max": 13}),
    ("skip Monday", {"dow_skip": ["Mon"]}),
    ("skip Friday", {"dow_skip": ["Fri"]}),
    ("dte 0-2", {"dte_min": 0, "dte_max": 2}),
    ("dte 1-4", {"dte_min": 1, "dte_max": 4}),
    ("dte >=1 (no expiry day)", {"dte_min": 1}),
    ("wall OI >= 5M", {"wall_oi_min": 5_000_000}),
    ("wall OI >= 10M", {"wall_oi_min": 10_000_000}),
    ("OI rise >= 100k", {"wall_oi_rise_min": 100_000}),
    ("prox 1.0 ATR", {"prox_atr": 1.0}),
    ("prox 1.5 ATR", {"prox_atr": 1.5}),
    ("reject 2-bar", {"reject_bars": 2}),
    ("strike 50 ITM", {"strike": "itm"}),
    ("stop 20%", {"stop": 0.20}),
    ("stop 25%", {"stop": 0.25}),
    ("give 15%", {"give": 0.15}),
    ("give 30%", {"give": 0.30}),
    ("hold 45", {"hold": 45}),
    ("hold 75", {"hold": 75}),
    ("hold 90", {"hold": 90}),
    ("no partial", {"partial": False}),
    ("EOD 14:30", {"eod_hour": 14, "eod_min": 30}),
    ("trend with", {"trend": "with"}),
    ("trend against", {"trend": "against"}),
    ("ATR >= 8", {"min_atr": 8}),
    ("ATR <= 20", {"max_atr": 20}),
    ("skip Mon + hour 9-11", {"dow_skip": ["Mon"], "hour_max": 11}),
    ("skip Mon + give 15", {"dow_skip": ["Mon"], "give": 0.15}),
    ("hour 9-11 + give 15", {"hour_max": 11, "give": 0.15}),
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
        f.write(json.dumps({"type": "config", "name": "fade-entry",
                            "metricName": "test_net", "metricUnit": "INR",
                            "bestDirection": "higher"}) + "\n")
    worklog = OUT / "experiments" / "worklog.md"
    best = None
    for n, (name, over) in enumerate(CONFIGS, start=1):
        cfg = {**BASE, **over}
        t0 = time.time()
        tr = pl.run_dates(train, cfg, HIST)
        te = pl.run_dates(test, cfg, HIST)
        lv = pl.run_dates(live, cfg, TAPE)
        a, b, c = hb.curve_stats(tr), hb.curve_stats(te), hb.curve_stats(lv)
        score = b["net"] if (a["pf"] >= 1.5 and a["n"] >= 10) else -1e9
        row = {"run": n, "commit": "-", "metric": round(score, 1),
               "metrics": {"train_net": round(a["net"]), "train_pf": round(a["pf"], 2),
                           "train_n": a["n"], "test_net": round(b["net"]),
                           "test_pf": round(b["pf"], 2), "test_n": b["n"],
                           "test_dd": round(b["dd"]), "live_net": round(c["net"]),
                           "live_n": c["n"], "secs": round(time.time() - t0, 1)},
               "status": "keep" if (best is None or score > best[1]) and score > -1e8 else "discard",
               "description": name, "timestamp": int(time.time()), "segment": 2}
        if row["status"] == "keep":
            best = (name, score)
        with jsonl.open("a") as f:
            f.write(json.dumps(row) + "\n")
        with worklog.open("a") as f:
            f.write(f"### Entry {n}: {name} — test_net={b['net']:+.0f} ({row['status']})\n"
                    f"- train: n={a['n']} net={a['net']:+.0f} PF={a['pf']:.2f} DD={a['dd']:+.0f}\n"
                    f"- test:  n={b['n']} net={b['net']:+.0f} PF={b['pf']:.2f} DD={b['dd']:+.0f}\n"
                    f"- live:  n={c['n']} net={c['net']:+.0f}\n- config: {over}\n\n")
        print(f"{n:2d} {name:28s} TR n={a['n']:2d} PF={a['pf']:5.2f} net={a['net']:+7.0f} | "
              f"TE n={b['n']:2d} PF={b['pf']:5.2f} net={b['net']:+8.0f} DD={b['dd']:+7.0f} | "
              f"LIVE n={c['n']:2d} {c['net']:+6.0f} | {row['status']}", flush=True)
    print(f"\nbest: {best}")


if __name__ == "__main__":
    main()
