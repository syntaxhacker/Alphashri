#!/usr/bin/env python3
"""Out-of-sample validation for ORB strategy params.

Runs best params on train/test split and reports performance on both,
so future autoresearch can validate against overfitting.

Usage: python3 experiments/oos_validate.py
  ORB_CACHE_DIR=../experiments/data
  ORB_SYMBOLS=           comma-separated symbols (default: all)
  ORB_TRAIN_END=2026-02-28  last date of training period
  ORB_TEST_END=2026-04-09   last date of test period
  ORB_COOLDOWN=50, ORB_SL=1.2, ORB_TP=2.0, ORB_BUFFER=0.62, etc.
"""
import os
import sys
import subprocess
import json

ENV = {
    "OR_MIN": os.environ.get("ORB_OR_MIN", "45"),
    "SL": os.environ.get("ORB_SL", "1.2"),
    "TP": os.environ.get("ORB_TP", "2.0"),
    "BUFFER": os.environ.get("ORB_BUFFER", "0.62"),
    "COOLDOWN": os.environ.get("ORB_COOLDOWN", "50"),
    "SHORTS": os.environ.get("ORB_SHORTS", "0"),
    "EOD_EXIT": os.environ.get("ORB_EOD_EXIT", "900"),
    "SYMBOLS": os.environ.get("ORB_SYMBOLS", ""),
    "TRAIN_END": os.environ.get("ORB_TRAIN_END", "2026-02-28"),
    "TEST_END": os.environ.get("ORB_TEST_END", "2026-04-09"),
    "CACHE_DIR": os.environ.get("ORB_CACHE_DIR", "../experiments/data"),
}


def parse_metrics(output: str) -> dict[str, float]:
    metrics = {}
    for line in output.splitlines():
        if line.startswith("METRIC "):
            parts = line[7:].split("=", 1)
            if len(parts) == 2:
                try:
                    metrics[parts[0]] = float(parts[1])
                except ValueError:
                    metrics[parts[0]] = parts[1]
    return metrics


def run_benchmark(label: str, date_start: str, date_end: str) -> dict:
    env = os.environ.copy()
    env.update({
        "ORB_OR_MIN": ENV["OR_MIN"],
        "ORB_SL": ENV["SL"],
        "ORB_TP": ENV["TP"],
        "ORB_BUFFER": ENV["BUFFER"],
        "ORB_COOLDOWN": ENV["COOLDOWN"],
        "ORB_SHORTS": ENV["SHORTS"],
        "ORB_EOD_EXIT": ENV["EOD_EXIT"],
        "ORB_CACHE_DIR": ENV["CACHE_DIR"],
        "ORB_DATE_START": date_start,
        "ORB_DATE_END": date_end,
    })
    if ENV["SYMBOLS"]:
        env["ORB_SYMBOLS"] = ENV["SYMBOLS"]

    result = subprocess.run(
        [sys.executable, "experiments/orb_benchmark.py"],
        capture_output=True, text=True, env=env,
    )
    print(result.stderr, file=sys.stderr)

    if result.returncode != 0:
        print(f"  {label}: CRASHED", file=sys.stderr)
        print(result.stdout, file=sys.stderr)
        return {"status": "crash", "error": result.stderr}

    metrics = parse_metrics(result.stdout)
    print(f"  {label}: PF={metrics.get('profit_factor', '?')}, "
          f"WR={metrics.get('win_rate', '?')}%, "
          f"trades={metrics.get('total_trades', '?')}, "
          f"net={metrics.get('net_pnl', '?')}", file=sys.stderr)
    return metrics


def main():
    first_date = "2025-12-11"
    test_start = pd.Timestamp(ENV["TRAIN_END"]) + pd.DateOffset(days=1)
    test_start = test_start.strftime("%Y-%m-%d")

    train = run_benchmark("TRAIN", first_date, ENV["TRAIN_END"])
    test = run_benchmark("TEST", test_start, ENV["TEST_END"])
    full = run_benchmark("FULL", first_date, ENV["TEST_END"])

    print(f"\n{'='*60}", file=sys.stderr)
    print(f"OOS Validation Results", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)
    print(f"Symbols: {ENV['SYMBOLS'] or 'all'}", file=sys.stderr)
    print(f"Params: CD={ENV['COOLDOWN']} SL={ENV['SL']}% TP={ENV['TP']}% buf={ENV['BUFFER']}%", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)
    print(f"{'Split':<10} {'Trades':<8} {'WR%':<8} {'PF':<8} {'Net P&L':<12}", file=sys.stderr)
    print(f"{'-'*50}", file=sys.stderr)
    for label, m in [("Train", train), ("Test", test), ("Full", full)]:
        pf = m.get("profit_factor", 0)
        wr = m.get("win_rate", 0)
        nt = m.get("total_trades", 0)
        npnl = m.get("net_pnl", 0)
        print(f"{label:<10} {nt:<8} {wr:<8} {pf:<8} Rs {npnl:>,.2f}", file=sys.stderr)

    if train.get("profit_factor", 0) > 0 and test.get("profit_factor", 0) > 0:
        change = ((test["profit_factor"] - train["profit_factor"]) / train["profit_factor"]) * 100
        print(f"\nOOS delta: {change:+.1f}%", file=sys.stderr)
        if change > -10:
            print("STATUS: VALID (params hold out-of-sample)", file=sys.stderr)
        elif change < -30:
            print("STATUS: OVERFIT (severe OOS degradation)", file=sys.stderr)
        else:
            print("STATUS: MODERATE (some degradation, investigate)", file=sys.stderr)

    # METRIC lines for autoresearch
    print(f"METRIC oos_pf_train={train.get('profit_factor', 0)}")
    print(f"METRIC oos_pf_test={test.get('profit_factor', 0)}")
    print(f"METRIC oos_pf_full={full.get('profit_factor', 0)}")
    print(f"METRIC oos_delta_pct={change:.1f}")


if __name__ == "__main__":
    import pandas as pd
    main()
