#!/usr/bin/env python3
"""Monitor paper SENSEX option positions through the trading day.

Polls every N seconds, appends a CSV row to experiments/data/paper_sensex_log.csv,
and stops after market close or when --max-samples reached.

Usage:
  python scripts/paper_options_monitor.py [--interval 300] [--max-samples 96]
"""
import argparse
import csv
import os
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import config as root_config
IST = root_config.IST

from scripts.paper_options_tracker import (
    load_positions, save_positions, fetch_spot, fetch_chain, get_contract_ltp, get_token,
)

LOG_FILE = Path(__file__).parent.parent / "experiments" / "data" / "paper_sensex_log.csv"


def sample_once(ts):
    token = get_token()
    positions = load_positions()
    spot = fetch_spot(token)
    expiries = {p["expiry"] for p in positions if p["status"] == "OPEN"}
    chain_cache = {}
    rows = []
    total = 0.0
    for p in positions:
        if p["status"] != "OPEN":
            total += p.get("gross_pnl", 0)
            continue
        expiry = p["expiry"]
        if expiry not in chain_cache:
            chain_cache[expiry] = fetch_chain(expiry, token)
        ltp = get_contract_ltp(chain_cache[expiry], p["strike"], p["type"], token)
        pnl = (ltp - p["premium"]) * p["qty"] * p["lot_size"]

        # auto-close on target / SL (net P&L in ₹)
        reason = None
        if p.get("target") is not None and pnl >= p["target"]:
            reason = "TARGET"
        elif p.get("sl") is not None and pnl <= p["sl"]:
            reason = "SL"
        if reason:
            p["exit_premium"] = round(ltp, 2)
            p["closed_at"] = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S")
            p["status"] = "CLOSED"
            p["exit_reason"] = reason
            p["gross_pnl"] = round(pnl, 2)
            print(f"  AUTO-CLOSE #{p['id']} ({reason}) @ ₹{ltp:.2f} → ₹{pnl:+,.2f}", flush=True)

        total += pnl
        rows.append({
            "ts": ts, "spot": round(spot, 2),
            "id": p["id"], "strike": p["strike"], "type": p["type"],
            "ltp": round(ltp, 2), "pnl": round(pnl, 2), "status": p["status"],
            "reason": p.get("exit_reason", ""),
        })
    save_positions(positions)
    return spot, rows, round(total, 2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval", type=int, default=300)
    parser.add_argument("--max-samples", type=int, default=96)
    args = parser.parse_args()

    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    write_header = not LOG_FILE.exists()
    samples = 0
    while samples < args.max_samples:
        now = datetime.now(IST)
        if now.hour >= 15 and now.minute >= 30:
            print("Market closed; stopping monitor.", file=sys.stderr)
            break
        ts = now.strftime("%Y-%m-%d %H:%M:%S")
        try:
            spot, rows, total = sample_once(ts)
            with open(LOG_FILE, "a", newline="") as f:
                w = csv.DictWriter(f, fieldnames=["ts","spot","id","strike","type","ltp","pnl","status","reason"])
                if write_header:
                    w.writeheader()
                    write_header = False
                for r in rows:
                    w.writerow(r)
            print(f"{ts}  spot={spot:,.2f}  total_pnl={total:+,.2f}", flush=True)
        except Exception as e:
            print(f"{ts}  ERROR: {e}", file=sys.stderr, flush=True)
        samples += 1
        time.sleep(args.interval)

    print("Monitor finished.", file=sys.stderr)


if __name__ == "__main__":
    main()
