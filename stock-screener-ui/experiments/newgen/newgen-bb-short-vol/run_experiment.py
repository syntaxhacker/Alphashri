#!/usr/bin/env python3
"""Run one NEWGEN experiment and log it atomically (jsonl + worklog + dashboard).

Usage: python run_experiment.py "<description>" [keep|discard|crash]
Strategy selected via NEWGEN_STRATEGY + strategy env vars (see benchmark.py).
"""
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.join(HERE, 'benchmark.py')
JSONL = os.path.join(HERE, 'autoresearch_newgen-bb-short-vol.jsonl')
WORKLOG = os.path.join(HERE, 'worklog_newgen-bb-short-vol.md')
DASH = os.path.join(HERE, 'autoresearch-dashboard_newgen-bb-short-vol.md')


def _head():
    try:
        r = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True)
        return r.stdout.strip() or 'unknown'
    except Exception:
        return 'unknown'


def atomic_append(path, text):
    existing = ''
    if os.path.exists(path):
        with open(path) as f:
            existing = f.read()
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or '.', prefix='.tmp_')
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(existing + text)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def load_results():
    results = []
    if os.path.exists(JSONL):
        with open(JSONL) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                if obj.get('run'):
                    results.append(obj)
    return results


def rebuild_dashboard(results):
    rows = []
    for r in sorted(results, key=lambda x: x['run']):
        m = r.get('metrics', {})
        rows.append(
            f"| {r['run']} | {m.get('strategy', '?')} | {r['metric']} | {m.get('win_rate', 0)}% "
            f"| {m.get('net_pnl', 0)} | {m.get('total_trades', 0)} | {m.get('tp_exits', 0)} "
            f"| {m.get('sl_exits', 0)} | {m.get('eod_exits', 0)} | {r['status']} | {r['description']} |"
        )
    best = {}
    for r in results:
        if r['status'] == 'discard' or r['status'] == 'crash':
            continue
        s = r.get('metrics', {}).get('strategy', '?')
        if s not in best or r['metric'] > best[s]['metric']:
            best[s] = r
    best_lines = []
    for s in sorted(best):
        r = best[s]
        m = r.get('metrics', {})
        best_lines.append(
            f"- **{s}**: run {r['run']} PF={r['metric']} WR={m.get('win_rate', 0)}% "
            f"net={m.get('net_pnl', 0)} trades={m.get('total_trades', 0)} — {r['description']}"
        )
    md = f"""# Autoresearch Dashboard — newgen-bb-short-vol

Objective: maximize **profit_factor** for NEWGEN across 3 intraday strategies (bb / short / vol).
Primary metric: profit_factor (higher better). Reliability requires total_trades >= 10.

## Best kept config per strategy

{chr(10).join(best_lines) if best_lines else '_none yet_'}

## All runs ({len(rows)})

| Run | Strategy | PF | WR% | Net PnL | Trades | TP | SL | EOD | Status | Description |
|-----|----------|-----|-----|---------|--------|----|----|-----|--------|-------------|
{chr(10).join(rows)}
"""
    with open(DASH, 'w') as f:
        f.write(md)


def main():
    desc = sys.argv[1] if len(sys.argv) > 1 else '?'
    status = sys.argv[2] if len(sys.argv) > 2 else 'keep'
    if status not in ('keep', 'discard', 'crash'):
        status = 'keep'
    strategy = os.environ.get('NEWGEN_STRATEGY', 'bb')
    env = dict(os.environ)
    proc = subprocess.run([sys.executable, BENCH], capture_output=True, text=True, env=env)
    metrics = {}
    for line in proc.stdout.splitlines():
        if line.startswith('METRIC '):
            parts = line[len('METRIC '):].split('=', 1)
            if len(parts) == 2:
                metrics[parts[0]] = parts[1].strip()
    if proc.returncode != 0:
        status = 'crash'
    pf = float(metrics.get('profit_factor') or 0.0)
    results = load_results()
    run = max([r['run'] for r in results] or [0]) + 1
    line = {
        'run': run, 'commit': _head(), 'metric': pf,
        'metrics': {
            'win_rate': float(metrics.get('win_rate') or 0.0),
            'net_pnl': float(metrics.get('net_pnl') or 0.0),
            'total_trades': int(metrics.get('total_trades') or 0),
            'tp_exits': int(metrics.get('tp_exits') or 0),
            'sl_exits': int(metrics.get('sl_exits') or 0),
            'eod_exits': int(metrics.get('eod_exits') or 0),
            'strategy': strategy,
        },
        'status': status, 'description': desc,
        'timestamp': int(datetime.now(timezone.utc).timestamp()),
        'segment': 0,
    }
    atomic_append(JSONL, json.dumps(line) + '\n')
    stderr_desc = ''
    for ln in proc.stderr.splitlines():
        if ln.startswith('DESC '):
            stderr_desc = ln[len('DESC '):]
    entry = (f"### Run {run}: [{strategy}] {desc} — status={status}\n"
             f"- PF={pf} WR={line['metrics']['win_rate']}% net={line['metrics']['net_pnl']} "
             f"trades={line['metrics']['total_trades']} TP={line['metrics']['tp_exits']} "
             f"SL={line['metrics']['sl_exits']} EOD={line['metrics']['eod_exits']}\n"
             f"- run: {stderr_desc}\n\n")
    atomic_append(WORKLOG, entry)
    rebuild_dashboard(load_results())
    print(f"RUN {run} [{strategy}] status={status} PF={pf} metrics={line['metrics']} desc={desc}")


if __name__ == '__main__':
    main()
