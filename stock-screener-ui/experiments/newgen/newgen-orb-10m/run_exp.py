"""Run a benchmark experiment, parse metrics, log atomically to JSONL + worklog + dashboard.

Usage: python run_exp.py --run N --desc "..." [env overrides as NEWGEN_*=...]
"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime

from pathlib import Path

ROOT = Path(__file__).parent.parent.parent.parent
JSONL = ROOT / "autoresearch_newgen-orb-10m.jsonl"
WORKLOG = ROOT / "experiments" / "worklog_newgen-orb-10m.md"
DASH = ROOT / "autoresearch-dashboard_newgen-orb-10m.md"
BENCH = Path(__file__).parent / "benchmark.py"

def commit_hash() -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "--short=7", "HEAD"],
                             capture_output=True, text=True, cwd=ROOT)
        return out.stdout.strip()
    except Exception:
        return "unknown"

def main() -> None:
    args = sys.argv[1:]
    run_n = None
    desc = ""
    for a in args:
        if a.startswith("--run="):
            run_n = int(a.split("=", 1)[1])
        elif a.startswith("--desc="):
            desc = a.split("=", 1)[1]
    if run_n is None:
        sys.exit("--run=N required")

    env = dict(os.environ)
    info_env = {}
    for a in args:
        if a.startswith("NEWGEN_"):
            key, val = a.split("=", 1)
            env[key] = val
            info_env[key] = val

    proc = subprocess.run([sys.executable, str(BENCH)], capture_output=True, text=True, env=env)
    metrics = {}
    for line in proc.stdout.splitlines():
        m = re.match(r"METRIC (\w+)=(.+)", line)
        if m:
            k, v = m.group(1), m.group(2)
            try:
                metrics[k] = float(v)
            except ValueError:
                metrics[k] = v
    info_line = [l for l in proc.stderr.splitlines() if l.startswith("INFO ")][0][5:]

    if proc.returncode != 0:
        status = "crash"
        metric = 0.0
    else:
        metric = metrics.get("profit_factor", 0.0)
        if run_n == 1:
            status = "keep"
        else:
            # keep if strictly better than current best (in current segment)
            best = best_pf(JSONL)
            status = "keep" if metric > best else "discard"

    entry = {
        "run": run_n,
        "commit": commit_hash(),
        "metric": metric,
        "metrics": {
            "win_rate": metrics.get("win_rate", 0.0),
            "net_pnl": metrics.get("net_pnl", 0.0),
            "total_trades": metrics.get("total_trades", 0.0),
            "tp_exits": metrics.get("tp_exits", 0.0),
            "sl_exits": metrics.get("sl_exits", 0.0),
            "eod_exits": metrics.get("eod_exits", 0.0),
        },
        "status": status,
        "description": f"{desc} [{info_line}]",
        "timestamp": int(time.time()),
        "segment": 0,
    }

    atomic_append(JSONL, entry)
    append_worklog(run_n, desc, info_env, metrics, status, metric)
    regenerate_dashboard()

    print(json.dumps(entry, indent=2))
    print(f"run={run_n} status={status} PF={metric}")

def best_pf(jsonl: Path) -> float:
    best = -1.0
    try:
        lines = jsonl.read_text().strip().splitlines()
    except FileNotFoundError:
        return best
    for ln in lines:
        if not ln.strip():
            continue
        try:
            d = json.loads(ln)
        except Exception:
            continue
        if d.get("type") == "config" or d.get("status") == "crash":
            continue
        if d.get("segment", 0) != 0:
            continue
        best = max(best, d.get("metric", 0.0))
    return best

def atomic_append(path: Path, entry: dict) -> None:
    tmp = path.with_suffix(".tmp")
    existing = path.read_text() if path.exists() else ""
    payload = existing.rstrip("\n") + "\n" + json.dumps(entry) + "\n"
    tmp.write_text(payload)
    json.loads(json.dumps(entry))  # sanity
    os.replace(tmp, path)

def append_worklog(run_n, desc, info_env, metrics, status, metric) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    with open(WORKLOG, "a") as f:
        f.write(f"\n### Run {run_n}: {desc} — PF={metric} ({status.upper()})\n")
        f.write(f"- Timestamp: {ts}\n")
        f.write(f"- Config: {info_env if info_env else '(defaults)'}\n")
        f.write(f"- Result: PF={metric}, WR={metrics.get('win_rate')}%, "
                f"net=₹{metrics.get('net_pnl')}, trades={metrics.get('total_trades')}, "
                f"tp={metrics.get('tp_exits')}, sl={metrics.get('sl_exits')}, "
                f"eod={metrics.get('eod_exits')}\n")

def regenerate_dashboard() -> None:
    runs, keeps, discards, crashes = [], [], 0, 0
    baseline = None
    with open(JSONL) as f:
        for ln in f:
            ln = ln.strip()
            if not ln:
                continue
            d = json.loads(ln)
            if d.get("type") == "config":
                continue
            runs.append(d)
            if d["status"] == "keep":
                keeps.append(d)
            elif d["status"] == "discard":
                discards += 1
            else:
                crashes += 1
    if not runs:
        return
    baseline = runs[0]["metric"]
    best = max(runs, key=lambda d: d["metric"])
    lines = [
        "# Autoresearch Dashboard: newgen-orb-10m",
        "",
        f"**Runs:** {len(runs)} | **Kept:** {len(keeps)} | **Discarded:** {discards} | **Crashed:** {crashes}",
        f"**Baseline:** profit_factor: {baseline} (#1)",
        f"**Best:** profit_factor: {best['metric']} (#{best['run']}, "
        f"{'+' if best['metric'] >= baseline else ''}{round((best['metric']-baseline)/baseline*100,1)}%)",
        "",
        "| # | commit | PF | win_rate | net_pnl | trades | status | description |",
        "|---|--------|-----|----------|---------|--------|--------|-------------|",
    ]
    for d in runs:
        m = d["metrics"]
        delta = f" ({'+' if d['metric']>=baseline else ''}{round((d['metric']-baseline)/baseline*100,1)}%)" if baseline else ""
        lines.append(f"| {d['run']} | {d['commit']} | {d['metric']} | {m['win_rate']}% | ₹{m['net_pnl']} | "
                     f"{int(m['total_trades'])} | {d['status']} | {d['description']} |")
    DASH.write_text("\n".join(lines) + "\n")

if __name__ == "__main__":
    main()
