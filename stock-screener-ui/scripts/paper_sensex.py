#!/usr/bin/env python3
"""Paper SENSEX options tool — single script for tracking, strategy, and monitoring.

Consolidates the former paper_options_tracker / monitor / strategy / sr_levels /
check / force / status scripts into ONE entry point.

Subcommands:
  chain        — show SENSEX option chain near spot
  open         — open a paper position (--strike --type [--premium --target --sl])
  close        — close a paper position (--id [--premium --reason])
  update       — set target/SL on an open position (--id --target/--sl/--clear-*)
  pnl          — show running P&L of all paper positions
  positions    — dump all paper positions (json)
  spot         — show SENSEX spot
  levels       — S/R levels (pivots + OI magnets + max pain)
  check        — snapshot book + levels + zone (text or --json)
  force        — evaluate strategy NOW on live data; open if signaled (--dry-run)
  monitor      — poll loop with auto-close + strategy auto-entry (--until HH:MM --strategy)
  status       — write last-check/current-time line to status file every N sec

Data lives in experiments/data/paper_sensex_options.json (positions),
paper_sensex_log.csv (monitor), paper_sensex_status.txt (status).
Uses the shared Upstox token from DB. Upstox v2 endpoints only (verified in docs).
"""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import config as root_config
IST = root_config.IST

# ---------------------------------------------------------------------------
# paths / constants
# ---------------------------------------------------------------------------
DATA = Path(__file__).parent.parent / "experiments" / "data"
POSITIONS_FILE = DATA / "paper_sensex_options.json"
LOG_FILE = DATA / "paper_sensex_log.csv"
STATUS_FILE = DATA / "paper_sensex_status.txt"
LOT_SIZE = 20
INDEX_KEY = "BSE_INDEX|SENSEX"
DEFAULT_EXPIRY = "2026-08-06"

# --- strategy tuning ---
ZONE_PTS = 50.0
BREAK_BUFFER = 15.0
CONFIRM_SAMPLES = 2
TARGET_NET = 600.0
SL_NET = -400.0
TRAIL_TRIGGER = 400.0    # activate trailing once P&L reaches this (₹)
TRAIL_DIST = 250.0       # trailing stop distance behind the peak (₹)
COOLDOWN_POLLS = 4
MAX_OPEN = 1

# ---------------------------------------------------------------------------
# api helpers
# ---------------------------------------------------------------------------
def get_token() -> str:
    from db.models import get_shared_broker_token
    data = get_shared_broker_token("upstox")
    if data and data.get("access_token"):
        return data["access_token"]
    raise SystemExit("ERROR: No Upstox token in DB. Connect broker in Settings.")


def _get(url: str, params: dict = None, timeout: int = 20):
    import httpx
    return httpx.get(url, params=params or {},
                     headers={"Authorization": f"Bearer {get_token()}", "Accept": "application/json"},
                     timeout=timeout)


def fetch_spot(token: str | None = None) -> float:
    j = _get("https://api.upstox.com/v2/market-quote/ohlc",
             {"instrument_key": INDEX_KEY, "interval": "1d"}, timeout=15).json()
    if j.get("status") == "success" and j.get("data"):
        k = list(j["data"].keys())[0]
        return float(j["data"][k].get("last_price", 0))
    return 0.0


def fetch_day_ohlc(token: str | None = None) -> dict:
    j = _get("https://api.upstox.com/v2/market-quote/ohlc",
             {"instrument_key": INDEX_KEY, "interval": "1d"}, timeout=15).json()
    k = list(j["data"].keys())[0]
    o = j["data"][k].get("ohlc", {})
    return {
        "open": float(o.get("open") or 0), "high": float(o.get("high") or 0),
        "low": float(o.get("low") or 0), "close": float(o.get("close") or 0),
        "last": float(j["data"][k].get("last_price") or 0),
    }


def fetch_chain(expiry: str = DEFAULT_EXPIRY, token: str | None = None) -> dict:
    j = _get("https://api.upstox.com/v2/option/chain",
             {"instrument_key": INDEX_KEY, "expiry_date": expiry}).json()
    if j.get("status") != "success":
        raise SystemExit(f"API error: {j}")
    return j


def nearest_expiry(token: str | None = None) -> str:
    j = _get("https://api.upstox.com/v2/option/contract",
             {"instrument_key": INDEX_KEY}).json()
    expiries = sorted({c.get("expiry") for c in j.get("data", []) if c.get("expiry")})
    return expiries[0] if expiries else DEFAULT_EXPIRY


def get_contract_ltp(chain: dict, strike: float, opt_type: str, token: str | None = None) -> float:
    for row in chain.get("data", []):
        if abs(row.get("strike_price", 0) - strike) < 1:
            side = row.get("call_options" if opt_type == "CE" else "put_options") or {}
            md_ltp = (side.get("market_data") or {}).get("ltp", 0)
            ikey = side.get("instrument_key")
            if not ikey:
                return float(md_ltp or 0)
            j = _get("https://api.upstox.com/v2/market-quote/ltp",
                     {"instrument_key": ikey}, timeout=15).json()
            if j.get("status") == "success" and j.get("data"):
                k = list(j["data"].keys())[0]
                lp = j["data"][k].get("last_price")
                if lp is not None:
                    return float(lp)
            if md_ltp:
                return float(md_ltp)
            return 0.0
    return 0.0


# ---------------------------------------------------------------------------
# position persistence
# ---------------------------------------------------------------------------
def load_positions() -> list:
    if POSITIONS_FILE.exists():
        return json.loads(POSITIONS_FILE.read_text())
    return []


def save_positions(positions: list):
    POSITIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    POSITIONS_FILE.write_text(json.dumps(positions, indent=2))


def next_id(positions: list) -> int:
    return max([p["id"] for p in positions], default=0) + 1


# ---------------------------------------------------------------------------
# S/R levels
# ---------------------------------------------------------------------------
def pivot_levels(o, h, l, c, style: str = "classic") -> dict:
    pp = (h + l + c) / 3 if c else (h + l + o) / 3
    hl = h - l
    if style == "fibonacci":
        return {"r3": pp + hl, "r2": pp + 0.618 * hl, "r1": pp + 0.382 * hl,
                "pp": pp, "s1": pp - 0.382 * hl, "s2": pp - 0.618 * hl, "s3": pp - hl}
    return {"r3": h + 2 * (pp - l), "r2": pp + hl, "r1": 2 * pp - l, "pp": pp,
            "s1": 2 * pp - h, "s2": pp - hl, "s3": l - 2 * (h - pp)}


def oi_levels(chain: dict, top_n: int = 6, min_oi: float = 1_000_000) -> dict:
    ce, pe = [], []
    for c in chain.get("data", []):
        st = c.get("strike_price")
        if not st:
            continue
        ce_oi = ((c.get("call_options") or {}).get("market_data") or {}).get("oi", 0) or 0
        pe_oi = ((c.get("put_options") or {}).get("market_data") or {}).get("oi", 0) or 0
        if ce_oi >= min_oi:
            ce.append((st, float(ce_oi)))
        if pe_oi >= min_oi:
            pe.append((st, float(pe_oi)))
    ce.sort(key=lambda x: x[1], reverse=True)
    pe.sort(key=lambda x: x[1], reverse=True)
    return {"resistance": ce[:top_n], "support": pe[:top_n]}


def max_pain(chain: dict, spot: float) -> float:
    rows = []
    for c in chain.get("data", []):
        st = c.get("strike_price")
        if not st:
            continue
        rows.append({"strike": float(st),
                     "ce": float(((c.get("call_options") or {}).get("market_data") or {}).get("oi", 0) or 0),
                     "pe": float(((c.get("put_options") or {}).get("market_data") or {}).get("oi", 0) or 0)})
    if not rows:
        return spot
    strikes = [r["strike"] for r in rows]
    best, min_loss = 0, float("inf")
    for t in strikes:
        loss = sum((t - r["strike"]) * r["ce"] if t > r["strike"] else (r["strike"] - t) * r["pe"]
                   for r in rows)
        if loss < min_loss:
            min_loss, best = loss, t
    return best


def scan_levels(token: str | None = None, expiry: str = DEFAULT_EXPIRY) -> dict:
    ohlc = fetch_day_ohlc(token)
    chain = fetch_chain(expiry, token)
    spot = ohlc["last"] or ohlc["close"]
    piv = pivot_levels(ohlc["open"], ohlc["high"], ohlc["low"], ohlc["close"])
    oi = oi_levels(chain)
    oi_sup = oi["support"][0][0] if oi["support"] else None
    oi_res = oi["resistance"][0][0] if oi["resistance"] else None
    sup_cands = [x for x in [oi_sup, ohlc["low"], piv["s1"]] if x and x < spot]
    res_cands = [x for x in [oi_res, ohlc["high"], piv["r1"]] if x and x > spot]
    return {
        "spot": round(spot, 2),
        "day": {"open": ohlc["open"], "high": ohlc["high"], "low": ohlc["low"]},
        "pivots": {k: round(v, 2) for k, v in piv.items()},
        "oi_support": [(round(s, 2), round(oi_v, 0)) for s, oi_v in oi["support"]],
        "oi_resistance": [(round(s, 2), round(oi_v, 0)) for s, oi_v in oi["resistance"]],
        "max_pain": round(max_pain(chain, spot), 2),
        "next_support": round(max(sup_cands) if sup_cands else (oi_sup or ohlc["low"]), 2),
        "next_resistance": round(min(res_cands) if res_cands else (oi_res or ohlc["high"]), 2),
    }


# ---------------------------------------------------------------------------
# strategy
# ---------------------------------------------------------------------------
class RangeStrategy:
    def __init__(self):
        self._recent = []
        self._cooldown_until = 0
        self.target_net = TARGET_NET
        self.sl_net = SL_NET
        self._anchor_low = None   # fixed day-low anchor for breakdown (down-day)
        self._anchor_high = None  # fixed day-high anchor for breakout (up-day)

    def _momentum(self, spot: float) -> float:
        if len(self._recent) < 2:
            return 0.0
        return self._recent[-1][0] - self._recent[-2][0]

    def update(self, spot: float, now=None):
        now = now or datetime.now(IST)
        self._recent.append((spot, now))
        if len(self._recent) > 5:
            self._recent.pop(0)

    def _consecutive_in_zone(self, zone_check) -> bool:
        if len(self._recent) < CONFIRM_SAMPLES:
            return False
        return all(zone_check(s) for s, _ in self._recent[-CONFIRM_SAMPLES:])

    def decide_with_levels(self, spot: float, levels: dict, poll_index: int,
                           open_positions: int) -> dict:
        self.update(spot)
        if open_positions >= MAX_OPEN:
            return {"action": "none"}
        if poll_index < self._cooldown_until:
            return {"action": "none"}
        day = levels.get("day", {})
        low, high = day.get("low", 0), day.get("high", 0)
        if high <= low:
            return {"action": "none"}
        # Trend filter: only trade WITH the day's direction.
        # spot < open = down-day -> shorts only (PE). spot > open = up-day -> longs only (CE).
        day_open = day.get("open", 0)
        down_day = day_open > 0 and spot < day_open
        up_day = day_open > 0 and spot > day_open

        # Anchor the breakdown/breakout level ONCE and FREEZE it.
        # The bug: the day-low ratchets down on every new low in a cascade, so
        # `spot <= daylow - 15` never triggers (it chases the falling low).
        # Fix: lock the anchor at the day-low captured when the strategy FIRST
        # observes a down-day, and never move it lower. A genuine break below a
        # fixed level then fires the PE.
        if down_day and self._anchor_low is None:
            self._anchor_low = low
        if up_day and self._anchor_high is None:
            self._anchor_high = high
        sup_anchor = self._anchor_low if self._anchor_low is not None else low
        res_anchor = self._anchor_high if self._anchor_high is not None else high

        sup = levels.get("next_support") or sup_anchor
        res = levels.get("next_resistance") or res_anchor
        sup_zone = sup + ZONE_PTS
        res_zone = res - ZONE_PTS
        sup_break = sup - BREAK_BUFFER
        res_break = res + BREAK_BUFFER
        mom = self._momentum(spot)
        trend = "down" if down_day else ("up" if up_day else "flat")
        extra = f"support={sup:,.0f} resistance={res:,.0f} maxpain={levels.get('max_pain',0):,.0f} trend={trend}"
        # LONG-side rules only on an up/flat day
        if not down_day:
            if spot <= sup_zone and mom >= 0 and self._consecutive_in_zone(lambda s: s <= sup_zone):
                return {"action": "open", "side": "CE", "bias": "LONG",
                        "reason": f"OI/pivot support bounce @ {spot:,.0f} ({extra})"}
            if spot >= res_break and mom >= 0 and self._consecutive_in_zone(lambda s: s >= res_break):
                return {"action": "open", "side": "CE", "bias": "LONG",
                        "reason": f"resistance BREAKOUT @ {spot:,.0f} (broke {res:,.0f})"}
        # SHORT-side rules only on a down/flat day
        if not up_day:
            if spot >= res_zone and mom <= 0 and self._consecutive_in_zone(lambda s: s >= res_zone):
                return {"action": "open", "side": "PE", "bias": "SHORT",
                        "reason": f"OI/pivot resistance reject @ {spot:,.0f} ({extra})"}
            if spot <= sup_break and mom <= 0 and self._consecutive_in_zone(lambda s: s <= sup_break):
                return {"action": "open", "side": "PE", "bias": "SHORT",
                        "reason": f"support BREAKDOWN @ {spot:,.0f} (broke {sup:,.0f})"}
        return {"action": "none"}

    def mark_closed(self, poll_index: int):
        self._cooldown_until = poll_index + COOLDOWN_POLLS

    def pick_strike(self, spot: float, side: str, chain: dict) -> float | None:
        best, best_diff = None, float("inf")
        for c in chain.get("data", []):
            st = c.get("strike_price")
            if st is None:
                continue
            ltp = ((c.get("call_options") or {}).get("market_data") or {}).get("ltp", 0) \
                if side == "CE" else ((c.get("put_options") or {}).get("market_data") or {}).get("ltp", 0)
            if ltp and ltp > 0 and abs(st - spot) < best_diff:
                best_diff, best = abs(st - spot), st
        return best

    def premium_for(self, chain: dict, strike: float, side: str) -> float:
        for c in chain.get("data", []):
            if abs((c.get("strike_price") or 0) - strike) < 1:
                side_d = c.get("call_options" if side == "CE" else "put_options") or {}
                return float((side_d.get("market_data") or {}).get("ltp", 0) or 0)
        return 0.0


# ---------------------------------------------------------------------------
# position commands
# ---------------------------------------------------------------------------
def cmd_chain(args):
    token = get_token()
    expiry = args.expiry or nearest_expiry(token)
    chain = fetch_chain(expiry, token)
    spot = fetch_spot(token)
    rows = []
    for c in chain.get("data", []):
        st = c.get("strike_price")
        if st is None:
            continue
        ce = (c.get("call_options") or {}).get("market_data") or {}
        pe = (c.get("put_options") or {}).get("market_data") or {}
        if args.near and abs(st - spot) > args.near:
            continue
        itm = "CE" if st < spot else "PE" if st > spot else "ATM"
        rows.append((st, ce.get("ltp", 0), ce.get("oi", 0), pe.get("ltp", 0), pe.get("oi", 0), itm))
    rows.sort()
    print(f"SENSEX spot: {spot:,.2f}  expiry: {expiry}  ({datetime.now(IST).strftime('%H:%M:%S')} IST)")
    print(f"{'Strike':>10} {'CE LTP':>10} {'CE OI':>12} {'PE LTP':>10} {'PE OI':>12}  {'ITM?':>5}")
    for st, ce_ltp, ce_oi, pe_ltp, pe_oi, itm in rows:
        print(f"{st:>10,.0f} {ce_ltp:>10.2f} {ce_oi:>12,.0f} {pe_ltp:>10.2f} {pe_oi:>12,.0f}  {itm:>5}")


def cmd_open(args):
    token = get_token()
    expiry = args.expiry or nearest_expiry(token)
    chain = fetch_chain(expiry, token)
    spot = fetch_spot(token)
    ltp = get_contract_ltp(chain, args.strike, args.type, token)
    premium = args.premium if args.premium else ltp
    if premium <= 0:
        raise SystemExit(f"ERROR: no live premium for {args.strike} {args.type}; pass --premium explicitly")
    positions = load_positions()
    pid = next_id(positions)
    positions.append({
        "id": pid, "underlying": "SENSEX", "expiry": expiry,
        "strike": args.strike, "type": args.type, "qty": args.qty,
        "premium": premium, "lot_size": LOT_SIZE, "cost": premium * args.qty * LOT_SIZE,
        "target": args.target, "sl": args.sl, "peak_pnl": 0.0,
        "opened_at": datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S"),
        "closed_at": None, "exit_premium": None, "exit_reason": None,
        "status": "OPEN", "entry_spot": spot,
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
    print(f"SENSEX spot: {fetch_spot():,.2f}")


def cmd_levels(args):
    lv = scan_levels()
    print(f"SENSEX spot: {lv['spot']:,.2f}   max pain: {lv['max_pain']:,.0f}")
    print(f"Day: O={lv['day']['open']:,.0f} H={lv['day']['high']:,.0f} L={lv['day']['low']:,.0f}")
    p = lv["pivots"]
    print(f"\nPivots (classic): R3={p['r3']:,.0f} R2={p['r2']:,.0f} R1={p['r1']:,.0f} "
          f"PP={p['pp']:,.0f} S1={p['s1']:,.0f} S2={p['s2']:,.0f} S3={p['s3']:,.0f}")
    print(f"\nNEAREST: support {lv['next_support']:,.0f} | resistance {lv['next_resistance']:,.0f}")
    print("\nResistance (CE OI magnets):")
    for s, oi in lv["oi_resistance"][:6]:
        print(f"  {s:,.0f}  CE OI {oi:,.0f}")
    print("\nSupport (PE OI magnets):")
    for s, oi in lv["oi_support"][:6]:
        print(f"  {s:,.0f}  PE OI {oi:,.0f}")


# ---------------------------------------------------------------------------
# check / force
# ---------------------------------------------------------------------------
def _zone(spot, lv):
    sup, res = lv["next_support"], lv["next_resistance"]
    if spot <= sup - BREAK_BUFFER:
        return "BELOW support (breakdown zone)"
    if spot >= res + BREAK_BUFFER:
        return "ABOVE resistance (breakout zone)"
    if spot <= sup + ZONE_PTS:
        return "support zone (bounce candidate)"
    if spot >= res - ZONE_PTS:
        return "resistance zone (reject candidate)"
    return "mid-range"


def cmd_check(args):
    lv = scan_levels()
    positions = load_positions()
    spot = lv["spot"]
    opens = [p for p in positions if p["status"] == "OPEN"]
    closed = [p for p in positions if p["status"] == "CLOSED"]
    total = sum(p.get("gross_pnl", 0) for p in closed)
    for p in opens:
        chain = fetch_chain(p["expiry"])
        ltp = get_contract_ltp(chain, p["strike"], p["type"])
        total += (ltp - p["premium"]) * p["qty"] * p["lot_size"]
    snap = {
        "time": datetime.now(IST).strftime("%H:%M:%S"),
        "spot": spot, "day": lv["day"],
        "support": lv["next_support"], "resistance": lv["next_resistance"],
        "max_pain": lv["max_pain"], "zone": _zone(spot, lv),
        "open_positions": len(opens), "total_pnl": round(total, 2),
        "positions": positions,
    }
    if args.json:
        print(json.dumps(snap, default=str, indent=2))
        return
    print(f"[{snap['time']}] SENSEX {spot:,.2f}  day L={lv['day']['low']:,.0f} H={lv['day']['high']:,.0f}")
    print(f"  support={snap['support']:,.0f}  resistance={snap['resistance']:,.0f}  maxpain={snap['max_pain']:,.0f}")
    print(f"  zone: {snap['zone']}")
    print(f"  open positions: {snap['open_positions']}  total P&L: ₹{snap['total_pnl']:+,.2f}")
    for p in positions:
        if p["status"] == "OPEN":
            print(f"    OPEN #{p['id']} {p['type']} {p['strike']:,.0f} @ {p['premium']:.2f} "
                  f"tgt={p.get('target')} sl={p.get('sl')}")
        else:
            print(f"    CLOSED #{p['id']} {p['type']} {p['strike']:,.0f} {p.get('gross_pnl'):+,.0f} ({p.get('exit_reason')})")


def cmd_force(args):
    """Evaluate strategy NOW on live data; open if signaled (no poll wait)."""
    lv = scan_levels()
    positions = load_positions()
    open_count = sum(1 for p in positions if p["status"] == "OPEN")
    if open_count >= MAX_OPEN:
        print(json.dumps({"action": "skip", "reason": f"{open_count} open already"}))
        return
    strat = RangeStrategy()
    spot = lv["spot"]
    strat.update(spot)
    decision = strat.decide_with_levels(spot, lv, poll_index=0, open_positions=open_count)
    if decision.get("action") != "open":
        print(json.dumps({"action": "none", "spot": spot, "zone": _zone(spot, lv),
                          "decision": decision}, default=str))
        return
    expiry = nearest_expiry()
    chain = fetch_chain(expiry)
    strike = strat.pick_strike(spot, decision["side"], chain)
    premium = strat.premium_for(chain, strike, decision["side"]) if strike else 0.0
    if not strike or premium <= 0:
        print(json.dumps({"action": "error", "reason": f"no premium for {strike} {decision['side']}"}))
        return
    if args.dry_run:
        print(json.dumps({"action": "would_open", "side": decision["side"], "strike": strike,
                          "premium": premium, "reason": decision["reason"], "spot": spot}))
        return
    pid = next_id(positions)
    positions.append({
        "id": pid, "underlying": "SENSEX", "expiry": expiry,
        "strike": strike, "type": decision["side"], "qty": 1,
        "premium": premium, "lot_size": LOT_SIZE, "cost": premium * LOT_SIZE,
        "target": strat.target_net, "sl": strat.sl_net, "peak_pnl": 0.0,
        "opened_at": datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S"),
        "closed_at": None, "exit_premium": None, "exit_reason": None,
        "status": "OPEN", "entry_spot": spot,
    })
    save_positions(positions)
    print(json.dumps({"action": "opened", "id": pid, "side": decision["side"], "strike": strike,
                      "premium": premium, "reason": decision["reason"], "spot": spot}))


# ---------------------------------------------------------------------------
# monitor (poll loop with auto-close + optional strategy auto-entry)
# ---------------------------------------------------------------------------
def sample_once(ts, token, strategy=None, poll_index=0):
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
        # track peak P&L for trailing
        peak = p.get("peak_pnl") if p.get("peak_pnl") is not None else pnl
        if pnl > peak:
            p["peak_pnl"] = pnl
            peak = pnl
        reason = None
        # fixed SL first
        if p.get("sl") is not None and pnl <= p["sl"]:
            reason = "SL"
        # trailing: once past trigger, stop out if it gives back TRAIL_DIST from peak
        elif p.get("peak_pnl") is not None and p["peak_pnl"] >= TRAIL_TRIGGER:
            if pnl <= p["peak_pnl"] - TRAIL_DIST:
                reason = "TRAIL"
        # fixed target as a backstop (still closes a solid win)
        elif p.get("target") is not None and pnl >= p["target"]:
            reason = "TARGET"
        if reason:
            p["exit_premium"] = round(ltp, 2)
            p["closed_at"] = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S")
            p["status"] = "CLOSED"
            p["exit_reason"] = reason
            p["gross_pnl"] = round(pnl, 2)
            print(f"  AUTO-CLOSE #{p['id']} ({reason}) @ ₹{ltp:.2f} → ₹{pnl:+,.2f}", flush=True)
            if strategy:
                strategy.mark_closed(poll_index)
        total += pnl
        rows.append({"ts": ts, "spot": round(spot, 2), "id": p["id"], "strike": p["strike"],
                     "type": p["type"], "ltp": round(ltp, 2), "pnl": round(pnl, 2),
                     "status": p["status"], "reason": p.get("exit_reason", "")})

    if strategy is not None:
        open_count = sum(1 for p in positions if p["status"] == "OPEN")
        lv = scan_levels(token)
        decision = strategy.decide_with_levels(lv["spot"], lv, poll_index, open_count)
        if decision.get("action") == "open":
            expiry = nearest_expiry(token)
            chain = fetch_chain(expiry, token)
            strike = strategy.pick_strike(lv["spot"], decision["side"], chain)
            premium = strategy.premium_for(chain, strike, decision["side"]) if strike else 0.0
            if strike and premium > 0:
                pid = next_id(positions)
                positions.append({
                    "id": pid, "underlying": "SENSEX", "expiry": expiry,
                    "strike": strike, "type": decision["side"], "qty": 1,
                    "premium": premium, "lot_size": LOT_SIZE, "cost": premium * LOT_SIZE,
                    "target": strategy.target_net, "sl": strategy.sl_net, "peak_pnl": 0.0,
                    "opened_at": datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S"),
                    "closed_at": None, "exit_premium": None, "exit_reason": None,
                    "status": "OPEN", "entry_spot": lv["spot"],
                })
                save_positions(positions)
                print(f"  STRATEGY OPEN #{pid}: {decision['side']} {strike:,.0f} "
                      f"@ ₹{premium:.2f} ({decision['reason']})", flush=True)
    save_positions(positions)
    return spot, rows, round(total, 2)


def cmd_monitor(args):
    strategy = None
    if args.strategy:
        strategy = RangeStrategy()
        print("Range strategy ENABLED (support→CE / resistance→PE, momentum-confirmed)", file=sys.stderr)
    stop_h, stop_m = (int(x) for x in args.until.split(":"))
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    write_header = not LOG_FILE.exists()
    samples = 0
    while samples < args.max_samples:
        now = datetime.now(IST)
        if now.hour > stop_h or (now.hour == stop_h and now.minute >= stop_m):
            print(f"Reached stop time {args.until}; stopping monitor.", file=sys.stderr)
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
            try:
                lv = scan_levels(token)
                print(f"{ts}  spot={spot:,.2f}  total_pnl={total:+,.2f}  "
                      f"sup={lv['next_support']:,.0f} res={lv['next_resistance']:,.0f} "
                      f"maxpain={lv['max_pain']:,.0f}  [strategy]", flush=True)
            except Exception:
                tag = "  [strategy]" if strategy else ""
                print(f"{ts}  spot={spot:,.2f}  total_pnl={total:+,.2f}{tag}", flush=True)
        except Exception as e:
            print(f"{ts}  ERROR: {e}", file=sys.stderr, flush=True)
        samples += 1
        time.sleep(args.interval)
    print("Monitor finished.", file=sys.stderr)


def cmd_status(args):
    stop_h, stop_m = (int(x) for x in args.until.split(":"))
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    while True:
        now = datetime.now(IST)
        if now.hour > stop_h or (now.hour == stop_h and now.minute >= stop_m):
            line = f"[{now.strftime('%H:%M:%S')}] reached {args.until} IST — stopping."
            with open(STATUS_FILE, "a") as f:
                f.write(line + "\n")
            print(line, flush=True)
            break
        try:
            r = subprocess.run([sys.executable, __file__, "check"], capture_output=True,
                               text=True, timeout=90)
            summary = r.stdout.strip().splitlines()
            brief = " | ".join(summary[1:3]) if len(summary) >= 3 else r.stdout.strip()
            line = f"[{now.strftime('%H:%M:%S')}] {brief}"
        except Exception as e:
            line = f"[{now.strftime('%H:%M:%S')}] ERROR: {e}"
        with open(STATUS_FILE, "a") as f:
            f.write(line + "\n")
        print(line, flush=True)
        time.sleep(args.interval)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Paper SENSEX options — tracker + strategy + monitor (single script)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("chain"); p.add_argument("--expiry"); p.add_argument("--near", type=float, default=1000)
    p.set_defaults(func=cmd_chain)

    p = sub.add_parser("open")
    p.add_argument("--strike", type=float, required=True); p.add_argument("--type", choices=["CE","PE"], required=True)
    p.add_argument("--qty", type=int, default=1); p.add_argument("--premium", type=float)
    p.add_argument("--expiry"); p.add_argument("--target", type=float); p.add_argument("--sl", type=float)
    p.set_defaults(func=cmd_open)

    p = sub.add_parser("update")
    p.add_argument("--id", type=int, required=True); p.add_argument("--target", type=float)
    p.add_argument("--sl", type=float); p.add_argument("--clear-target", action="store_true")
    p.add_argument("--clear-sl", action="store_true")
    p.set_defaults(func=cmd_update)

    p = sub.add_parser("close")
    p.add_argument("--id", type=int, required=True); p.add_argument("--premium", type=float)
    p.add_argument("--reason", choices=["MANUAL","TARGET","SL","EOD","TRAIL"])
    p.set_defaults(func=cmd_close)

    p = sub.add_parser("pnl"); p.set_defaults(func=cmd_pnl)
    p = sub.add_parser("positions"); p.set_defaults(func=cmd_positions)
    p = sub.add_parser("spot"); p.set_defaults(func=cmd_spot)
    p = sub.add_parser("levels"); p.set_defaults(func=cmd_levels)

    p = sub.add_parser("check"); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_check)

    p = sub.add_parser("force"); p.add_argument("--dry-run", action="store_true"); p.set_defaults(func=cmd_force)

    p = sub.add_parser("monitor")
    p.add_argument("--interval", type=int, default=120); p.add_argument("--max-samples", type=int, default=100000)
    p.add_argument("--until", default="15:30"); p.add_argument("--strategy", action="store_true")
    p.set_defaults(func=cmd_monitor)

    p = sub.add_parser("status")
    p.add_argument("--interval", type=int, default=300); p.add_argument("--until", default="15:30")
    p.set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
