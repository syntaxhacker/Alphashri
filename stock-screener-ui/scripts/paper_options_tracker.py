#!/usr/bin/env python3
"""Paper SENSEX Options Tracker — track paper option positions for today.

Uses the shared Upstox access token (DB) to fetch live SENSEX option chain
LTPs, records paper positions locally, and reports running P&L.

Commands:
  python scripts/paper_options_tracker.py chain [--expiry 2026-08-06] [--near ATM]
  python scripts/paper_options_tracker.py open  --strike 78800 --type CE --qty 1 [--premium 342.55]
  python scripts/paper_options_tracker.py close --id 1 [--premium 400.0]
  python scripts/paper_options_tracker.py pnl
  python scripts/paper_options_tracker.py positions
  python scripts/paper_options_tracker.py spot

Paper positions persist to experiments/data/paper_sensex_options.json
"""
import argparse
import json
import sys
import os
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import config as root_config
IST = root_config.IST

POSITIONS_FILE = Path(__file__).parent.parent / "experiments" / "data" / "paper_sensex_options.json"
LOT_SIZE = 20  # SENSEX options lot size
INDEX_KEY = "BSE_INDEX|SENSEX"


def get_token() -> str:
    from db.models import get_shared_broker_token
    data = get_shared_broker_token("upstox")
    if data and data.get("access_token"):
        return data["access_token"]
    raise SystemExit("ERROR: No Upstox token in DB. Connect broker in Settings.")


def fetch_chain(expiry: str, token: str) -> dict:
    import httpx
    r = httpx.get(
        "https://api.upstox.com/v2/option/chain",
        params={"instrument_key": INDEX_KEY, "expiry_date": expiry},
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=20,
    )
    r.raise_for_status()
    j = r.json()
    if j.get("status") != "success":
        raise SystemExit(f"API error: {j}")
    return j


def fetch_spot(token: str) -> float:
    import httpx
    r = httpx.get(
        "https://api.upstox.com/v2/market-quote/ohlc",
        params={"instrument_key": INDEX_KEY, "interval": "1d"},
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=15,
    )
    j = r.json()
    if j.get("status") == "success" and j.get("data"):
        k = list(j["data"].keys())[0]
        return float(j["data"][k].get("last_price", 0))
    return 0.0


def get_contract_ltp(chain: dict, strike: float, opt_type: str, token: str) -> float:
    """Find contract instrument key from chain, fetch live quote LTP."""
    for row in chain.get("data", []):
        if abs(row.get("strike_price", 0) - strike) < 1:
            side = row.get("call_options" if opt_type == "CE" else "put_options") or {}
            ikey = side.get("instrument_key")
            # Chain's market_data.ltp is already live; prefer it as first fallback.
            md_ltp = (side.get("market_data") or {}).get("ltp", 0)
            if not ikey:
                return float(md_ltp or 0)
            import httpx
            r = httpx.get(
                "https://api.upstox.com/v2/market-quote/ltp",
                params={"instrument_key": ikey},
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                timeout=15,
            )
            j = r.json()
            if j.get("status") == "success" and j.get("data"):
                k = list(j["data"].keys())[0]
                lp = j["data"][k].get("last_price")
                if lp is not None:
                    return float(lp)
            if md_ltp:
                return float(md_ltp)
            return 0.0
    return 0.0


def load_positions() -> list:
    if POSITIONS_FILE.exists():
        return json.loads(POSITIONS_FILE.read_text())
    return []


def save_positions(positions: list):
    POSITIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    POSITIONS_FILE.write_text(json.dumps(positions, indent=2))


def next_id(positions: list) -> int:
    return max([p["id"] for p in positions], default=0) + 1


def cmd_chain(args):
    token = get_token()
    expiry = args.expiry
    if not expiry:
        r = __import__("httpx").get(
            "https://api.upstox.com/v2/option/contract",
            params={"instrument_key": INDEX_KEY},
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=20,
        ).json()
        expiries = sorted({c.get("expiry") for c in r.get("data", []) if c.get("expiry")})
        expiry = expiries[0]
    chain = fetch_chain(expiry, token)
    spot = fetch_spot(token)
    contracts = chain.get("data", [])
    rows = []
    for c in contracts:
        st = c.get("strike_price")
        if st is None:
            continue
        ce = c.get("call_options") or {}
        pe = c.get("put_options") or {}
        rows.append((st,
                     (ce.get("market_data") or {}).get("ltp", 0),
                     (ce.get("market_data") or {}).get("oi", 0),
                     (pe.get("market_data") or {}).get("ltp", 0),
                     (pe.get("market_data") or {}).get("oi", 0)))
    rows.sort()
    print(f"SENSEX spot: {spot:,.2f}  expiry: {expiry}  ({datetime.now(IST).strftime('%H:%M:%S')} IST)")
    print(f"{'Strike':>10} {'CE LTP':>10} {'CE OI':>12} {'PE LTP':>10} {'PE OI':>12}  {'ITM?':>5}")
    for st, ce_ltp, ce_oi, pe_ltp, pe_oi in rows:
        if args.near and abs(st - spot) > args.near:
            continue
        itm = "CE" if st < spot else "PE" if st > spot else "ATM"
        print(f"{st:>10,.0f} {ce_ltp:>10.2f} {ce_oi:>12,.0f} {pe_ltp:>10.2f} {pe_oi:>12,.0f}  {itm:>5}")


def cmd_open(args):
    token = get_token()
    expiry = args.expiry
    if not expiry:
        r = __import__("httpx").get(
            "https://api.upstox.com/v2/option/contract",
            params={"instrument_key": INDEX_KEY},
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=20,
        ).json()
        expiries = sorted({c.get("expiry") for c in r.get("data", []) if c.get("expiry")})
        expiry = expiries[0]
    chain = fetch_chain(expiry, token)
    spot = fetch_spot(token)
    ltp = get_contract_ltp(chain, args.strike, args.type, token)
    premium = args.premium if args.premium else ltp
    if premium <= 0:
        raise SystemExit(f"ERROR: no live premium for {args.strike} {args.type}; pass --premium explicitly")
    positions = load_positions()
    pid = next_id(positions)
    positions.append({
        "id": pid,
        "underlying": "SENSEX",
        "expiry": expiry,
        "strike": args.strike,
        "type": args.type,
        "qty": args.qty,
        "premium": premium,
        "lot_size": LOT_SIZE,
        "cost": premium * args.qty * LOT_SIZE,
        "target": args.target,
        "sl": args.sl,
        "opened_at": datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S"),
        "closed_at": None,
        "exit_premium": None,
        "exit_reason": None,
        "status": "OPEN",
        "entry_spot": spot,
    })
    save_positions(positions)
    print(f"OPEN paper position #{pid}: SENSEX {args.strike} {args.type} x{args.qty} lot "
          f"@ ₹{premium:.2f} (cost ₹{positions[-1]['cost']:,.0f}, spot {spot:,.2f})"
          + (f" target ₹{args.target:,.0f}" if args.target else "")
          + (f" SL ₹{args.sl:,.0f}" if args.sl else ""))


def cmd_update(args):
    positions = load_positions()
    p = next((x for x in positions if x["id"] == args.id and x["status"] == "OPEN"), None)
    if not p:
        raise SystemExit(f"ERROR: open position #{args.id} not found")
    if args.target is not None:
        p["target"] = args.target
    if args.sl is not None:
        p["sl"] = args.sl
    if args.clear_target:
        p["target"] = None
    if args.clear_sl:
        p["sl"] = None
    save_positions(positions)
    print(f"UPDATE #{args.id}: target={p.get('target')} SL={p.get('sl')}")


def cmd_close(args):
    positions = load_positions()
    p = next((x for x in positions if x["id"] == args.id and x["status"] == "OPEN"), None)
    if not p:
        raise SystemExit(f"ERROR: open position #{args.id} not found")
    token = get_token()
    chain = fetch_chain(p["expiry"], token)
    ltp = get_contract_ltp(chain, p["strike"], p["type"], token)
    exit_p = args.premium if args.premium else ltp
    gross = (exit_p - p["premium"]) * p["qty"] * LOT_SIZE
    p["exit_premium"] = exit_p
    p["closed_at"] = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S")
    p["status"] = "CLOSED"
    p["exit_reason"] = args.reason or "MANUAL"
    p["gross_pnl"] = round(gross, 2)
    save_positions(positions)
    print(f"CLOSE #{args.id}: exit ₹{exit_p:.2f} → gross P&L ₹{gross:+,.2f} ({p['exit_reason']})")


def cmd_pnl(args):
    token = get_token()
    positions = load_positions()
    if not positions:
        print("No paper positions yet.")
        return
    spot = fetch_spot(token)
    print(f"SENSEX spot: {spot:,.2f}  ({datetime.now(IST).strftime('%H:%M:%S')} IST)")
    total = 0.0
    print(f"{'id':>3} {'type':>4} {'strike':>9} {'qty':>4} {'entry':>9} {'ltp':>9} {'pnl':>11} {'target':>9} {'sl':>9} {'status':>7}")
    for p in positions:
        if p["status"] == "OPEN":
            chain = fetch_chain(p["expiry"], token)
            ltp = get_contract_ltp(chain, p["strike"], p["type"], token)
            pnl = (ltp - p["premium"]) * p["qty"] * LOT_SIZE
        else:
            ltp = p.get("exit_premium", 0)
            pnl = p.get("gross_pnl", 0)
        total += pnl
        tgt = f"{p['target']:,.0f}" if p.get("target") else "-"
        sl = f"{p['sl']:,.0f}" if p.get("sl") else "-"
        print(f"{p['id']:>3} {p['type']:>4} {p['strike']:>9,.0f} {p['qty']:>4} "
              f"{p['premium']:>9.2f} {ltp:>9.2f} {pnl:>+11,.2f} {tgt:>9} {sl:>9} {p['status']:>7}")
    print(f"TOTAL paper P&L: ₹{total:+,.2f}")


def cmd_positions(args):
    positions = load_positions()
    if not positions:
        print("No paper positions yet.")
        return
    print(json.dumps(positions, indent=2))


def cmd_spot(args):
    token = get_token()
    print(f"SENSEX spot: {fetch_spot(token):,.2f}")


def main():
    parser = argparse.ArgumentParser(description="Paper SENSEX options tracker")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("chain", help="Show option chain near spot")
    p.add_argument("--expiry")
    p.add_argument("--near", type=float, default=1000)
    p.set_defaults(func=cmd_chain)

    p = sub.add_parser("open", help="Open a paper position")
    p.add_argument("--strike", type=float, required=True)
    p.add_argument("--type", choices=["CE", "PE"], required=True)
    p.add_argument("--qty", type=int, default=1)
    p.add_argument("--premium", type=float)
    p.add_argument("--expiry")
    p.add_argument("--target", type=float, help="net P&L ₹ to auto-close at (profit)")
    p.add_argument("--sl", type=float, help="net P&L ₹ to auto-close at (loss, negative)")
    p.set_defaults(func=cmd_open)

    p = sub.add_parser("update", help="Set target/SL on an open position")
    p.add_argument("--id", type=int, required=True)
    p.add_argument("--target", type=float)
    p.add_argument("--sl", type=float)
    p.add_argument("--clear-target", action="store_true")
    p.add_argument("--clear-sl", action="store_true")
    p.set_defaults(func=cmd_update)

    p = sub.add_parser("close", help="Close a paper position")
    p.add_argument("--id", type=int, required=True)
    p.add_argument("--premium", type=float)
    p.add_argument("--reason", choices=["MANUAL", "TARGET", "SL", "EOD"])
    p.set_defaults(func=cmd_close)

    p = sub.add_parser("pnl", help="Show running P&L")
    p.set_defaults(func=cmd_pnl)

    p = sub.add_parser("positions", help="Dump all paper positions")
    p.set_defaults(func=cmd_positions)

    p = sub.add_parser("spot", help="Show SENSEX spot")
    p.set_defaults(func=cmd_spot)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
