"""Append a run result to autoresearch_newgen-sr.jsonl + worklog + dashboard.

Usage:
  python3 log_run.py --run N --metric PF --wins 3 --losses 4 --net -100.5 --total 10 \
    --tp 3 --sl 5 --eod 2 --status keep --desc "..." --commit b63ee0a
"""
import argparse
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
JSONL = os.path.join(HERE, "autoresearch_newgen-sr.jsonl")
WORKLOG = os.path.join(os.path.dirname(os.path.dirname(HERE)), "worklog_newgen-sr.md")
DASH = os.path.join(HERE, "autoresearch-dashboard_newgen-sr.md")
MD = os.path.join(HERE, "autoresearch_newgen-sr.md")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--run", type=int, required=True)
    p.add_argument("--metric", type=float, required=True)
    p.add_argument("--wins", type=int, default=0)
    p.add_argument("--losses", type=int, default=0)
    p.add_argument("--net", type=float, default=0.0)
    p.add_argument("--total", type=int, default=0)
    p.add_argument("--tp", type=int, default=0)
    p.add_argument("--sl", type=int, default=0)
    p.add_argument("--eod", type=int, default=0)
    p.add_argument("--status", default="keep")
    p.add_argument("--desc", default="")
    p.add_argument("--commit", default="b63ee0a")
    args = p.parse_args()

    result = {
        "run": args.run,
        "commit": args.commit,
        "metric": args.metric,
        "metrics": {
            "win_rate": round(args.wins / args.total * 100, 1) if args.total else 0.0,
            "net_pnl": round(args.net, 2),
            "total_trades": args.total,
            "tp_exits": args.tp,
            "sl_exits": args.sl,
            "eod_exits": args.eod,
        },
        "status": args.status,
        "description": args.desc,
        "timestamp": int(time.time()),
        "segment": 0,
    }

    with open(JSONL, "a") as f:
        f.write(json.dumps(result) + "\n")

    with open(WORKLOG, "a") as f:
        f.write(f"\n### Run {args.run}: {args.desc} — PF={args.metric} "
                f"({args.status})\n"
                f"- metrics: WR={result['metrics']['win_rate']}% net={result['metrics']['net_pnl']} "
                f"trades={args.total} TP={args.tp} SL={args.sl} EOD={args.eod}\n")

    with open(MD, "a") as f:
        f.write(f"- Run {args.run}: {args.desc} — PF={args.metric}, net={result['metrics']['net_pnl']}, "
                f"trades={args.total}, WR={result['metrics']['win_rate']}%, "
                f"TP={args.tp}/SL={args.sl}/EOD={args.eod} ({args.status})\n")

    # Regenerate dashboard
    with open(JSONL) as f:
        lines = [json.loads(l) for l in f if l.strip()]
    runs = [r for r in lines if r.get("type") != "config"]
    config = next(r for r in lines if r.get("type") == "config")
    kept = [r for r in runs if r["status"] == "keep"]
    discarded = [r for r in runs if r["status"] == "discard"]
    crashed = [r for r in runs if r["status"] == "crash"]
    best = max(runs, key=lambda r: r["metric"]) if runs else None

    rows = []
    for r in runs:
        m = r["metrics"]
        rows.append(
            f"| {r['run']} | {r['commit']} | {r['metric']} | {m['total_trades']} | "
            f"{m['win_rate']} | {m['net_pnl']} | {r['status']} | {r['description']} |"
        )
    table = "\n".join(rows)

    best_delta = ""
    if best:
        best_delta = f" (#{best['run']}, +{(best['metric'] / kept[0]['metric'] - 1) * 100:.1f}%)" if kept else ""
    dash = f"""# Autoresearch Dashboard: newgen-sr

**Runs:** {len(runs)} | **Kept:** {len(kept)} | **Discarded:** {len(discarded)} | **Crashed:** {len(crashed)}
**Baseline:** profit_factor: {kept[0]['metric'] if kept else '—'} (#{kept[0]['run'] if kept else '—'})
**Best:** profit_factor: {best['metric'] if best else '—'}{best_delta}

| # | commit | profit_factor | total_trades | win_rate | net_pnl | status | description |
|---|--------|---------------|--------------|----------|---------|--------|-------------|
{table}
"""
    with open(DASH, "w") as f:
        f.write(dash)
    print(f"logged run {args.run}: PF={args.metric} status={args.status}")


if __name__ == "__main__":
    main()
