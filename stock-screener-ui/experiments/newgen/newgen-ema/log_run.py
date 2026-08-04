"""Log an experiment result into newgen-ema state files (atomic).

Usage:
  python3 experiments/newgen/newgen-ema/log_run.py "<description>" --run <N>

Reads METRIC key=value lines from stdin. Determines keep/discard vs the best PF
so far (>= best_so_far with total_trades>=10 -> keep; baseline forced keep).
Appends JSONL atomically and regenerates worklog + dashboard.
"""
import json
import os
import re
import sys
import tempfile
from datetime import datetime

SESSION = "newgen-ema"
BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)))
JSONL = os.path.join(BASE, "autoresearch_newgen-ema.jsonl")
WORKLOG = os.path.join(BASE, "worklog_newgen-ema.md")
DASH = os.path.join(BASE, "autoresearch-dashboard_newgen-ema.md")
MD = os.path.join(BASE, "autoresearch_newgen-ema.md")

COMMIT = os.popen("git rev-parse --short=7 HEAD 2>/dev/null").read().strip() or "unknown"


def parse_metrics(text):
    m = {}
    for line in text.splitlines():
        mm = re.match(r"METRIC (\w+)=([-\d.]+)", line.strip())
        if mm:
            m[mm.group(1)] = float(mm.group(2)) if "." in mm.group(2) else int(mm.group(2))
    return m


def read_state():
    if not os.path.exists(JSONL):
        return {"config": None, "runs": []}
    runs = []
    config = None
    with open(JSONL) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") == "config":
                config = obj
            elif "run" in obj:
                runs.append(obj)
    return {"config": config, "runs": runs}


def best_pf(runs, segment=0):
    vals = [r["metric"] for r in runs if r.get("segment") == segment and r["status"] == "keep"]
    return max(vals) if vals else 0.0


def append_jsonl(entry):
    tmp = tempfile.NamedTemporaryFile("w", dir=BASE, delete=False, suffix=".tmp")
    try:
        with open(JSONL) as f:
            for line in f:
                tmp.write(line)
        tmp.write(json.dumps(entry) + "\n")
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp.close()
        os.replace(tmp.name, JSONL)
    except Exception:
        if os.path.exists(tmp.name):
            os.remove(tmp.name)
        raise


def update_md(entry, desc):
    lines = [line.strip("\n") for line in open(WORKLOG)] if os.path.exists(WORKLOG) else []
    with open(WORKLOG, "a") as f:
        f.write(f"### Run {entry['run']}:\n")
        f.write(f"- {desc}\n")
        f.write(f"- commit={entry['commit']} metric={entry['metric']} "
                f"status={entry['status']} timestamp={entry['timestamp']}\n")


def regenerate_dashboard():
    state = read_state()
    runs = sorted(state["runs"], key=lambda r: r.get("run", 0))
    if not runs:
        return
    lines = [
        "# newgen-ema Autoresearch Dashboard",
        "",
        "Goal: maximize profit_factor (higher is better) for NEWGEN EMA cross intraday.",
        "",
        "| Run | TF | fast/slow | SL% | TP% | CD | shorts | EOD | PF | win_rate | net_pnl | trades | tp/sl/eod | status |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in runs:
        d = r.get("description", "")
        if "|" in d:
            parts = d.split("|")
            cfg = parts[:9]
            ddesc = " ".join(parts[9:]) if len(parts) > 9 else ""
            row = [f"r{r.get('run')}"] + [p.strip() for p in cfg] + [
                str(r.get("metric")),
                str(r["metrics"].get("win_rate", "")),
                str(r["metrics"].get("net_pnl", "")),
                str(r["metrics"].get("total_trades", "")),
                f"{r['metrics'].get('tp_exits',0)}/{r['metrics'].get('sl_exits',0)}/{r['metrics'].get('eod_exits',0)}",
                r.get("status", ""),
            ]
            lines.append("| " + " | ".join(row) + " |")
    tmp = tempfile.NamedTemporaryFile("w", dir=BASE, delete=False, suffix=".tmp")
    try:
        tmp.write("\n".join(lines) + "\n")
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp.close()
        os.replace(tmp.name, DASH)
    except Exception:
        if os.path.exists(tmp.name):
            os.remove(tmp.name)
        raise


def main():
    args = sys.argv[1:]
    desc = args[0] if args else "no description"
    force_keep = "--force_keep" in args
    text = sys.stdin.read()
    metrics = parse_metrics(text)

    pf = metrics.get("profit_factor", 0.0)
    total = metrics.get("total_trades", 0)
    state = read_state()
    runs = state["runs"]
    seg = max([r.get("segment", 0) for r in runs], default=0) if runs else 0
    run_num = max([r["run"] for r in runs], default=0) + 1

    prev_best = best_pf(runs, seg)

    if force_keep or (pf >= prev_best and prev_best == 0.0 and run_num == 1):
        status = "keep"
    elif pf >= prev_best and total >= 10:
        status = "keep"
    else:
        status = "discard"

    secondaries = {
        "win_rate": metrics.get("win_rate", 0),
        "net_pnl": metrics.get("net_pnl", 0),
        "total_trades": total,
        "tp_exits": metrics.get("tp_exits", 0),
        "sl_exits": metrics.get("sl_exits", 0),
        "eod_exits": metrics.get("eod_exits", 0),
    }
    entry = {
        "run": run_num,
        "commit": COMMIT,
        "metric": round(pf, 4),
        "metrics": secondaries,
        "status": status,
        "description": desc,
        "timestamp": int(datetime.now().timestamp()),
        "segment": seg,
    }
    append_jsonl(entry)
    update_md(entry, desc)
    regenerate_dashboard()
    print(json.dumps(entry))


if __name__ == "__main__":
    main()
