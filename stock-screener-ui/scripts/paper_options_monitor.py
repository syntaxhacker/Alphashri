#!/usr/bin/env python3
"""Monitor paper SENSEX option positions through the trading day + optional strategy.

Polls every N seconds:
  - samples open paper positions (auto-close on target/SL)
  - appends a CSV row to experiments/data/paper_sensex_log.csv
  - if --strategy is set, runs the range strategy and auto-opens positions on signals
Stops after market close or when --max-samples reached.

Usage:
  python scripts/paper_options_monitor.py [--interval 300] [--max-samples 96] [--strategy]
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
INDEX_KEY = "BSE_INDEX|SENSEX"


def fetch_day_ohlc(token: str):
    import httpx
    r = httpx.get(
        "https://api.upstox.com/v2/market-quote/ohlc",
        params={"instrument_key": INDEX_KEY, "interval": "1d"},
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=15,
    )
    j = r.json()
    k = list(j["data"].keys())[0]
    ohlc = j["data"][k].get("ohlc", {})
    return {
        "open": float(ohlc.get("open") or 0),
        "high": float(ohlc.get("high") or 0),
        "low": float(ohlc.get("low") or 0),
        "close": float(ohlc.get("close") or 0),
        "last": float(j["data"][k].get("last_price") or 0),
    }


def nearest_expiry(token: str) -> str:
    import httpx
    r = httpx.get(
        "https://api.upstox.com/v2/option/contract",
        params={"instrument_key": INDEX_KEY},
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=20,
    ).json()
    expiries = sorted({c.get("expiry") for c in r.get("data", []) if c.get("expiry")})
    return expiries[0] if expiries else ""


def sample_once(ts, token, strategy=None, poll_index=0):
    positions = load_positions()
    spot = fetch_spot(token)
    expiries = {p["expiry"] for p in positions if p["status"] == "OPEN"}
    chain_cache = {}
    rows = []
    total = 0.0
    closed_any = False
    for p in positions:
        if p["status"] != "OPEN":
            total += p.get("gross_pnl", 0)
            continue
        expiry = p["expiry"]
        if expiry not in chain_cache:
            chain_cache[expiry] = fetch_chain(expiry, token)
        ltp = get_contract_ltp(chain_cache[expiry], p["strike"], p["type"], token)
        pnl = (ltp - p["premium"]) * p["qty"] * p["lot_size"]

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
            closed_any = True
            print(f"  AUTO-CLOSE #{p['id']} ({reason}) @ ₹{ltp:.2f} → ₹{pnl:+,.2f}", flush=True)
            if strategy:
                strategy.mark_closed(poll_index)

        total += pnl
        rows.append({
            "ts": ts, "spot": round(spot, 2),
            "id": p["id"], "strike": p["strike"], "type": p["type"],
            "ltp": round(ltp, 2), "pnl": round(pnl, 2), "status": p["status"],
            "reason": p.get("exit_reason", ""),
        })

    # strategy auto-entry
    if strategy is not None:
        open_count = sum(1 for p in positions if p["status"] == "OPEN")
        ohlc = fetch_day_ohlc(token)
        # use S/R-aware levels if available (OI magnets + pivots + max pain)
        from scripts.paper_sr_levels import scan as sr_scan
        try:
            levels = sr_scan(token)
        except Exception:
            levels = {
                "spot": ohlc["last"], "day": ohlc,
                "next_support": ohlc["low"], "next_resistance": ohlc["high"],
                "max_pain": ohlc["last"],
            }
        decision = strategy.decide_with_levels(ohlc["last"], levels, poll_index, open_count)
        if decision.get("action") == "open":
            expiry = nearest_expiry(token)
            chain = fetch_chain(expiry, token)
            strike = strategy.pick_strike(ohlc["last"], decision["side"], chain)
            premium = strategy.premium_for(chain, strike, decision["side"]) if strike else 0.0
            if strike and premium > 0:
                from scripts.paper_options_tracker import next_id
                pid = next_id(positions)
                positions.append({
                    "id": pid,
                    "underlying": "SENSEX", "expiry": expiry,
                    "strike": strike, "type": decision["side"], "qty": 1,
                    "premium": premium, "lot_size": 20,
                    "cost": premium * 20,
                    "target": strategy.target_net, "sl": strategy.sl_net,
                    "opened_at": datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S"),
                    "closed_at": None, "exit_premium": None, "exit_reason": None,
                    "status": "OPEN", "entry_spot": ohlc["last"],
                })
                save_positions(positions)
                print(f"  STRATEGY OPEN #{pid}: {decision['side']} {strike:,.0f} "
                      f"@ ₹{premium:.2f} ({decision['reason']})", flush=True)

    save_positions(positions)
    return spot, rows, round(total, 2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval", type=int, default=300)
    parser.add_argument("--max-samples", type=int, default=96)
    parser.add_argument("--strategy", action="store_true", help="run range strategy auto-entry")
    args = parser.parse_args()

    strategy = None
    if args.strategy:
        from scripts.paper_sensex_strategy import RangeStrategy
        strategy = RangeStrategy()
        print("Range strategy ENABLED (support→CE / resistance→PE, momentum-confirmed)", file=sys.stderr)

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
            token = get_token()
            spot, rows, total = sample_once(ts, token, strategy=strategy, poll_index=samples)
            with open(LOG_FILE, "a", newline="") as f:
                w = csv.DictWriter(f, fieldnames=["ts","spot","id","strike","type","ltp","pnl","status","reason"])
                if write_header:
                    w.writeheader()
                    write_header = False
                for r in rows:
                    w.writerow(r)
            tag = "  [strategy]" if strategy else ""
            print(f"{ts}  spot={spot:,.2f}  total_pnl={total:+,.2f}{tag}", flush=True)
        except Exception as e:
            print(f"{ts}  ERROR: {e}", file=sys.stderr, flush=True)
        samples += 1
        time.sleep(args.interval)

    print("Monitor finished.", file=sys.stderr)


if __name__ == "__main__":
    main()
