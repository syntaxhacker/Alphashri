"""
Monitor CPU, memory, and cycle timing for all running bot processes.

Usage:
    python scripts/monitor_bots.py [--interval 5] [--count 60]

Sample every N seconds for M samples, print a live table.
Press Ctrl+C to stop early.
"""

import argparse
import os
import re
import signal
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

try:
    import psutil
except ImportError:
    print("psutil not installed. Run: pip install psutil")
    sys.exit(1)


def get_bot_pids():
    """Find all runner_cli.py bot processes."""
    bots = []
    for proc in psutil.process_iter(['pid', 'cmdline', 'create_time']):
        try:
            cmdline = proc.info.get('cmdline') or []
            if any('runner_cli.py' in c for c in cmdline):
                bot_id = None
                for c in cmdline:
                    if c.startswith('--bot-id='):
                        bot_id = c.split('=')[1]
                bots.append({
                    'pid': proc.info['pid'],
                    'bot_id': bot_id or '?',
                    'create_time': proc.info['create_time'],
                    'proc': proc,
                })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return sorted(bots, key=lambda b: int(b['bot_id']) if b['bot_id'].isdigit() else 0)


def get_uvicorn_pids():
    """Find uvicorn API server processes."""
    uvs = []
    for proc in psutil.process_iter(['pid', 'cmdline', 'name']):
        try:
            cmdline = proc.info.get('cmdline') or []
            name = proc.info.get('name') or ''
            if 'uvicorn' in name or any('uvicorn' in c for c in cmdline):
                uvs.append({
                    'pid': proc.info['pid'],
                    'proc': proc,
                })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return uvs


def get_cycle_stats(bot_id, log_paths):
    """Read bot log to extract recent cycle times."""
    for lp in log_paths:
        if not lp.exists():
            continue
        try:
            with open(lp) as f:
                lines = f.readlines()[-50:]
            times = []
            for line in lines:
                m = re.search(r'--- Cycle (\d+) @ (\d{2}:\d{2}:\d{2}) ---', line)
                if m:
                    times.append((int(m.group(1)), m.group(2)))
            if len(times) >= 2:
                intervals = []
                for i in range(1, min(len(times), 6)):
                    t1 = times[-i - 1][1]
                    t2 = times[-i][1]
                    h1, m1, s1 = map(int, t1.split(':'))
                    h2, m2, s2 = map(int, t2.split(':'))
                    secs = (h2 * 3600 + m2 * 60 + s2) - (h1 * 3600 + m1 * 60 + s1)
                    if 0 < secs < 300:
                        intervals.append(secs)
                if intervals:
                    avg_gap = sum(intervals) / len(intervals)
                    count = times[-1][0]
                    return count, avg_gap
            if times:
                return times[-1][0], 0
        except (OSError, IOError):
            pass
    return 0, 0


def format_rss(bytes_val):
    for unit in ('B', 'K', 'M', 'G'):
        if bytes_val < 1024:
            return f"{bytes_val:.0f}{unit}"
        bytes_val /= 1024
    return f"{bytes_val:.1f}T"


def main():
    parser = argparse.ArgumentParser(description='Monitor bot processes')
    parser.add_argument('--interval', type=int, default=5, help='Sample interval (seconds)')
    parser.add_argument('--count', type=int, default=120, help='Max samples')
    args = parser.parse_args()

    log_dir = Path('/tmp')
    sample = 0

    def handle_sigint(sig, frame):
        print("\n\nMonitoring stopped.")
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_sigint)

    print(f"Monitoring bot processes every {args.interval}s for {args.count} samples...")
    print(f"{'PID':>7} {'BOT':>6} {'CPU%':>6} {'MEM%':>6} {'RSS':>8} {'CYCLES':>7} {'CYCLE':>7} {'STATE':>8}")
    print("-" * 65)

    while sample < args.count:
        sample += 1
        bots = get_bot_pids()
        uvs = get_uvicorn_pids()

        total_cpu = 0.0
        for b in bots:
            try:
                p = b['proc']
                cpu = p.cpu_percent(interval=0)
                mem = p.memory_percent()
                rss = p.memory_info().rss
                status = p.status()
                bot_id = b['bot_id']
                log_paths = [
                    log_dir / f'bot-1-{bot_id}.log',
                    log_dir / f'bot-{bot_id}.log',
                ]
                cyc, avg = get_cycle_stats(bot_id, log_paths)
                total_cpu += cpu
                cyc_str = f"{cyc}" if cyc else "-"
                avg_str = f"{avg:.0f}s" if avg else "-"
                print(f"{b['pid']:>7} {bot_id:>6} {cpu:>5.1f}% {mem:>5.1f}% {format_rss(rss):>8} {cyc_str:>7} {avg_str:>7} {status:>8}")
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        if bots:
            avg_cpu = total_cpu / len(bots)
            total_mem = sum(
                b['proc'].memory_percent() for b in bots
                if b['proc'].is_running()
            )
            print("-" * 65)
            print(f"Bots: {len(bots)}  |  Avg CPU: {avg_cpu:.1f}%  |  Total CPU: {total_cpu:.1f}%  |  Total MEM: {total_mem:.1f}%")
        else:
            print(f"{'No bot processes found':>50}")

        for u in uvs:
            try:
                p = u['proc']
                cpu = p.cpu_percent(interval=0)
                mem = p.memory_percent()
                rss = p.memory_info().rss
                print(f"{u['pid']:>7} {'API':>6} {cpu:>5.1f}% {mem:>5.1f}% {format_rss(rss):>8} {'-':>7} {'-':>7} {'-':>8}")
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        print()

        if sample < args.count:
            time.sleep(args.interval)


if __name__ == '__main__':
    main()
