"""Atomic logger for newgen-orb-15m autoresearch state.

Usage:
  python3 experiments/newgen/newgen-orb-15m/log.py <run> <commit> <pf> <wr> <net> <ntrades> <tp> <sl> <eod> <status> <description>
Writes one JSON result line to autoresearch_newgen-orb-15m.jsonl (atomic: temp + rename).
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
JSONL = os.path.join(PROJ, "autoresearch_newgen-orb-15m.jsonl")


def main():
    args = sys.argv[1:]
    run, commit, pf, wr, net, ntrades, tp, sl, eod, status = args[:10]
    description = args[10] if len(args) > 10 else ""
    entry = {
        "run": int(run),
        "commit": commit,
        "metric": float(pf),
        "metrics": {
            "win_rate": float(wr),
            "net_pnl": float(net),
            "total_trades": int(ntrades),
            "tp_exits": int(tp),
            "sl_exits": int(sl),
            "eod_exits": int(eod),
        },
        "status": status,
        "description": description,
        "timestamp": int(time.time()),
        "segment": 0,
    }
    tmp = JSONL + f".tmp.{os.getpid()}"
    with open(JSONL, "r") as f:
        existing = f.read()
    with open(tmp, "w") as f:
        f.write(existing)
        if not existing.endswith("\n"):
            f.write("\n")
        f.write(json.dumps(entry) + "\n")
    os.replace(tmp, JSONL)
    with open(JSONL, "r") as f:
        n = sum(1 for line in f if '"run":' in line)
    print(f"logged run {run}; total result lines: {n}")


if __name__ == "__main__":
    main()
