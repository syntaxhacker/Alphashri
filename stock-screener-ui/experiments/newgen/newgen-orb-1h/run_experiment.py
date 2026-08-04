"""Helper to run one ORB benchmark experiment and log it atomically.

Usage:
  python run_experiment.py "<description>" '{"NEWGEN_OR_MIN":"15",...}'

Reads the autoresearch JSONL to compute run number + best-so-far PF, runs the
benchmark with the given env overrides, parses METRIC lines, and appends a
result line to the JSONL (atomic rename), plus a worklog entry and dashboard
regeneration.
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent
NAME = "newgen-orb-1h"
DATA = BASE.parent.parent  # experiments/
JSONL = DATA / f"autoresearch_{NAME}.jsonl"
WORKLOG = DATA / f"worklog_{NAME}.md"
DASH = DATA / f"autoresearch-dashboard_{NAME}.md"
MD = DATA / f"autoresearch_{NAME}.md"

SECONDARIES = ["win_rate", "net_pnl", "total_trades", "tp_exits", "sl_exits", "eod_exits"]


def get_head():
    try:
        r = subprocess.run(["git", "rev-parse", "--short=7", "HEAD"],
                           capture_output=True, text=True, cwd=BASE)
        return r.stdout.strip()
    except Exception:
        return "nohash"


def load_jsonl():
    if not JSONL.exists():
        return []
    out = []
    for line in JSONL.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def append_jsonl(entry: dict):
    rows = load_jsonl()
    rows.append(entry)
    tmp = JSONL.with_suffix(".jsonl.tmp")
    with open(tmp, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    tmp.replace(JSONL)  # atomic rename
    # verify
    final = load_jsonl()
    assert len(final) == len(rows), f"verify failed: {len(final)} != {len(rows)}"


def run_benchmark(env_overrides):
    env = os.environ.copy()
    for k, v in env_overrides.items():
        env[k] = str(v)
    r = subprocess.run([sys.executable, str(BASE / "benchmark.py")],
                       env=env, capture_output=True, text=True, timeout=120)
    return r


def parse_metrics(out: str):
    m = {}
    for line in out.splitlines():
        if line.startswith("METRIC "):
            body = line[len("METRIC "):]
            k, _, v = body.partition("=")
            m[k] = float(v)
    return m


def update_dashboard(runs):
    seg_runs = [r for r in runs if r.get("type") == "config"]  # configs
    results = [r for r in runs if "run" in r and r.get("type") != "config"]
    results = [r for r in runs if isinstance(r.get("metric"), (int, float))]
    kept = [r for r in results if r["status"] == "keep"]
    discarded = [r for r in results if r["status"] == "discard"]
    crashed = [r for r in results if r["status"] == "crash"]
    baseline = next((r for r in results if r["run"] == 1), None)
    best = max(kept, key=lambda r: r["metric"]) if kept else None
    bl_val = baseline["metric"] if baseline else 0.0

    lines = [f"# Autoresearch Dashboard: {NAME}"]
    lines.append("")
    lines.append(f"**Runs:** {len(results)} | **Kept:** {len(kept)} | "
                 f"**Discarded:** {len(discarded)} | **Crashed:** {len(crashed)}")
    if baseline:
        lines.append(f"**Baseline:** profit_factor: {baseline['metric']} (#1)")
    if best:
        lines.append(f"**Best:** profit_factor: {best['metric']} (#{best['run']}, "
                     f"{((best['metric'] - bl_val) / bl_val * 100):+.1f}%)")
    lines.append("")
    lines.append("| # | commit | profit_factor | status | description |")
    lines.append("|---|--------|---------------|--------|-------------|")
    for r in results:
        delta = ""
        if baseline and bl_val:
            delta = f" ({((r['metric'] - bl_val) / bl_val * 100):+.1f}%)"
        desc = r.get("description", "")
        lines.append(f"| {r['run']} | {r['commit']} | {r['metric']}{delta} | "
                     f"{r['status']} | {desc} |")
    lines.append("")
    # flag low-trade configs
    low = [r for r in results if r["metrics"].get("total_trades", 0) < 5]
    if low:
        lines.append(f"**NOTE:** {len(low)} runs had <5 trades (flagged unreliable): "
                     + ", ".join(f"#{r['run']}" for r in low))
    lines.append("")
    tmp = DASH.with_suffix(".md.tmp")
    tmp.write_text("\n".join(lines))
    tmp.replace(DASH)


def append_worklog(entry: dict, run_num: int):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    m = entry["metrics"]
    block = (f"\n### Run {run_num}: {entry['description']} — "
             f"PF={entry['metric']} ({entry['status'].upper()})\n"
             f"- Timestamp: {ts}\n"
             f"- Result: PF={entry['metric']}, win_rate={m['win_rate']}%, "
             f"net_pnl={m['net_pnl']}, trades={m['total_trades']}, "
             f"TP={m['tp_exits']}/SL={m['sl_exits']}/EOD={m['eod_exits']}\n")
    if WORKLOG.exists():
        text = WORKLOG.read_text()
    else:
        text = f"# Worklog: {NAME}\n"
    # insert before the trailing "## Key Insights" section if present
    marker = "## Key Insights"
    if marker in text:
        head, _, tail = text.partition(marker)
        text = head + block + "\n" + marker + tail
    else:
        text = text + block
    tmp = WORKLOG.with_suffix(".md.tmp")
    tmp.write_text(text)
    tmp.replace(WORKLOG)


def main():
    if len(sys.argv) < 3:
        print("usage: run_experiment.py <description> <json-env-overrides>")
        sys.exit(2)
    desc = sys.argv[1]
    env_overrides = json.loads(sys.argv[2])

    rows = load_jsonl()
    results = [r for r in rows if isinstance(r.get("metric"), (int, float))]
    run_num = max([r["run"] for r in results], default=0) + 1
    segment = sum(1 for r in rows if r.get("type") == "config") - 1 if rows else 0

    commit = get_head()
    r = run_benchmark(env_overrides)
    ts = int(time.time())

    if r.returncode != 0:
        entry = {
            "run": run_num, "commit": commit, "metric": 0.0,
            "metrics": {"win_rate": 0.0, "net_pnl": 0.0, "total_trades": 0,
                        "tp_exits": 0, "sl_exits": 0, "eod_exits": 0},
            "status": "crash", "description": desc, "timestamp": ts, "segment": segment,
        }
        print(f"CRASHED: {desc}")
        print(r.stderr[-2000:])
    else:
        metrics = parse_metrics(r.stdout)
        pf = metrics.get("profit_factor", 0.0)
        kept_pfs = [x["metric"] for x in results if x["status"] == "keep"]
        best_so_far = max(kept_pfs, default=0.0)
        status = "keep" if pf > best_so_far else "discard"
        entry = {
            "run": run_num, "commit": commit, "metric": pf,
            "metrics": {k: metrics.get(k, 0.0) for k in SECONDARIES},
            "status": status, "description": desc, "timestamp": ts, "segment": segment,
        }
        print(f"RUN {run_num}: PF={pf} {status} (best_so_far={best_so_far}) "
              f"trades={metrics.get('total_trades', 0)} {desc}")

    append_jsonl(entry)
    append_worklog(entry, run_num)
    update_dashboard(load_jsonl())
    # also append a one-liner to the md file's tried section
    with open(MD, "a") as f:
        f.write(f"- Run {run_num}: {desc} → PF={entry['metric']}, "
                f"trades={entry['metrics'].get('total_trades', 0)}, "
                f"{entry['status']}\n")


if __name__ == "__main__":
    main()
