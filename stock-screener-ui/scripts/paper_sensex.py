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
CANDLE_CACHE_DIR = DATA / "sensex_1m_cache"
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

# --- strategy config registry (multi-strategy sweep) ---
# Each entry is one named strategy config. Rule variants:
#   all-rules      = support_bounce + resistance_reject + breakdown + breakout
#   breakdown-only = only breakdown (PE) on down-days
#   bounce-reject  = only support_bounce (CE) + resistance_reject (PE)
#   no-trend       = all rules but trend_filter off (chases bounces too)
ALL_RULES = ["support_bounce", "resistance_reject", "breakdown", "breakout"]
BREAKDOWN_ONLY = ["breakdown"]
BOUNCE_REJECT = ["support_bounce", "resistance_reject"]

def _mk(name, target, sl, trail_trigger, trail_dist, rules, trend_filter=True, **kw):
    return {"name": name, "target": target, "sl": sl,
            "trail_trigger": trail_trigger, "trail_dist": trail_dist,
            "rules": rules, "trend_filter": trend_filter, **kw}

def strategy_configs():
    """Curated ~24-30 configs spanning targets × SL × trail × rule variants."""
    cfgs = []
    for rules, tf, tag in [
        (ALL_RULES, True, "all"),
        (BREAKDOWN_ONLY, True, "brk"),
        (BOUNCE_REJECT, True, "bnc"),
        (ALL_RULES, False, "notrend"),
    ]:
        for target in (300.0, 600.0, 900.0):
            for sl in (-200.0, -400.0):
                for trail, t_trig, t_dist in [("off", 1e9, 250.0), ("on", 400.0, 250.0)]:
                    name = f"{tag}-t{target:.0f}-sl{abs(sl):.0f}-{trail}"
                    cfgs.append(_mk(name, target, sl, t_trig, t_dist, rules, tf))
    return cfgs

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
    if j.get("status") != "success" or not j.get("data"):
        return {"open": 0, "high": 0, "low": 0, "close": 0, "last": 0}
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
# multi-day 1-min candle cache (for sweep)
# ---------------------------------------------------------------------------
def fetch_candles_range(from_date: str, to_date: str, token: str | None = None) -> list:
    """Fetch SENSEX 1-min candles for a date range (Upstox V2 historical). Returns raw rows."""
    import urllib.parse
    token = token or get_token()
    key = urllib.parse.quote(INDEX_KEY, safe="")
    url = f"https://api.upstox.com/v2/historical-candle/{key}/1minute/{to_date}/{from_date}"
    j = _get(url, timeout=30).json()
    if j.get("status") != "success":
        raise SystemExit(f"fetch_candles_range API error: {j}")
    return j["data"]["candles"]


def cmd_fetch_candles(args):
    """Fetch last N days of SENSEX 1-min candles into sensex_1m_cache/<date>.json."""
    CANDLE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    token = get_token()
    from_date = (datetime.now(IST) - timedelta(days=args.days)).strftime("%Y-%m-%d")
    to_date = datetime.now(IST).strftime("%Y-%m-%d")
    print(f"Fetching SENSEX 1-min candles {from_date} .. {to_date} ...", file=sys.stderr)
    rows = fetch_candles_range(from_date, to_date, token)
    rows.sort(key=lambda r: r[0])
    # group by date
    by_day = {}
    for r in rows:
        d = r[0][:10]
        by_day.setdefault(d, []).append(r)
    saved = 0
    for d, day_rows in sorted(by_day.items()):
        out = CANDLE_CACHE_DIR / f"{d}.json"
        with open(out, "w") as f:
            json.dump(day_rows, f)
        saved += 1
        print(f"  {d}: {len(day_rows)} candles -> {out.name}", file=sys.stderr)
    print(f"Saved {saved} day-files to {CANDLE_CACHE_DIR}", file=sys.stderr)


def load_candle_days() -> list:
    """Return sorted list of (date_str, candles_asc) from the cache."""
    if not CANDLE_CACHE_DIR.exists():
        return []
    days = []
    for p in sorted(CANDLE_CACHE_DIR.glob("*.json")):
        with open(p) as f:
            rows = json.load(f)
        rows.sort(key=lambda r: r[0])
        days.append((p.stem, rows))
    return days


def day_ohlc_from_candles(rows: list) -> dict:
    if not rows:
        return {"open": 0, "high": 0, "low": 0, "close": 0}
    return {
        "open": float(rows[0][1]),
        "high": max(float(r[2]) for r in rows),
        "low": min(float(r[3]) for r in rows),
        "close": float(rows[-1][4]),
    }


def oi_anchors_from_live(token=None) -> tuple:
    """Approximate OI support/resistance from the live chain (res=high CE OI, sup=high PE OI)."""
    try:
        chain = fetch_chain(token=token)
        ce, pe = [], []
        for c in chain.get("data", []):
            st = c.get("strike_price")
            if not st:
                continue
            ce_oi = ((c.get("call_options") or {}).get("market_data") or {}).get("oi", 0) or 0
            pe_oi = ((c.get("put_options") or {}).get("market_data") or {}).get("oi", 0) or 0
            if ce_oi > 2_000_000:
                ce.append((float(st), float(ce_oi)))
            if pe_oi > 1_500_000:
                pe.append((float(st), float(pe_oi)))
        ce.sort(key=lambda x: x[1], reverse=True)
        pe.sort(key=lambda x: x[1], reverse=True)
        oi_res = min(ce[:3], key=lambda x: abs(x[0] - 79000))[0] if ce else 79000.0
        oi_sup = max(pe[:3], key=lambda x: abs(x[0] - 79000))[0] if pe else 78500.0
        return oi_sup, oi_res
    except Exception:
        return 78500.0, 79000.0


# ---------------------------------------------------------------------------
# multi-day strategy sweep
# ---------------------------------------------------------------------------
# Option trading charges (NSE/BSE index options, premium-based, per lot):
#   STT 0.1% on sell side only, brokerage 0.03% (min ₹20) both sides,
#   exchange 0.03503% both sides, SEBI ₹10/crore, GST 18% on brk+exch+sebi,
#   stamp 0.003% buy side. Charged on PREMIUM value (premium × lot).
OPT_BROKERAGE_PCT = 0.0003
OPT_STT_PCT = 0.001         # 0.1% on sell side (options)
OPT_EXCHANGE_PCT = 0.0003503
OPT_SEBI_PCT = 0.000001
OPT_STAMP_PCT = 0.00003
OPT_GST_PCT = 0.18
OPT_MIN_BROKERAGE = 20.0


def option_costs(entry_premium: float, exit_premium: float, lot: int) -> float:
    """Round-trip trading charges on a SENSEX option trade (premium value based)."""
    buy_val = entry_premium * lot
    sell_val = exit_premium * lot
    buy_brk = min(OPT_MIN_BROKERAGE, buy_val * OPT_BROKERAGE_PCT)
    buy_exch = buy_val * OPT_EXCHANGE_PCT
    buy_sebi = buy_val * OPT_SEBI_PCT
    buy_stamp = buy_val * OPT_STAMP_PCT
    buy_gst = OPT_GST_PCT * (buy_brk + buy_exch + buy_sebi)
    buy_total = buy_brk + buy_stamp + buy_exch + buy_sebi + buy_gst
    sell_brk = min(OPT_MIN_BROKERAGE, sell_val * OPT_BROKERAGE_PCT)
    sell_stt = sell_val * OPT_STT_PCT
    sell_exch = sell_val * OPT_EXCHANGE_PCT
    sell_sebi = sell_val * OPT_SEBI_PCT
    sell_gst = OPT_GST_PCT * (sell_brk + sell_exch + sell_sebi)
    sell_total = sell_brk + sell_stt + sell_exch + sell_sebi + sell_gst
    return round(buy_total + sell_total, 2)


def run_day_sweep(cfg: dict, rows: list, oi_sup: float, oi_res: float,
                  target: float, sl: float, trail_trigger: float, trail_dist: float,
                  t_years: float, iv: float = 0.19, lot: int = LOT_SIZE,
                  cooldown_min: int = 5, include_costs: bool = True) -> dict:
    """Replay one strategy config on one day's 1-min candles. Returns day metrics."""
    if not rows:
        return {"trades": 0, "net": 0.0, "wins": 0, "losses": 0, "max_dd": 0.0}
    day_ohlc = day_ohlc_from_candles(rows)
    day_open = day_ohlc["open"]
    from scripts.paper_sensex import RangeStrategy
    strat = RangeStrategy(**cfg)
    cum_low, cum_high = float("inf"), 0.0
    anchor_low = None
    cooldown_until = 0.0
    trades = []
    pos = None
    t0 = None

    def bs_premium(side, spot, strike, t, iv, r=0.05):
        import math
        def ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
        if t <= 1e-6:
            t = 1e-6
        d1 = (math.log(spot / strike) + (r + iv * iv / 2) * t) / (iv * math.sqrt(t))
        d2 = d1 - iv * math.sqrt(t)
        if side == "CE":
            bs = spot * ncdf(d1) - strike * math.exp(-r * t) * ncdf(d2)
        else:
            bs = strike * math.exp(-r * t) * ncdf(-d2) - spot * ncdf(-d1)
        intr = max(spot - strike, 0) if side == "CE" else max(strike - spot, 0)
        return max(bs, intr)

    for i, r in enumerate(rows):
        ts = r[0]
        hm = ts[11:16]
        spot = float(r[4])
        cum_low = min(cum_low, float(r[3]))
        cum_high = max(cum_high, float(r[2]))

        sup_cands = [x for x in [oi_sup, cum_low] if x < spot]
        res_cands = [x for x in [oi_res, cum_high] if x > spot]
        sup = max(sup_cands) if sup_cands else cum_low
        res = min(res_cands) if res_cands else cum_high
        down_day = spot < day_open
        up_day = spot > day_open
        if down_day and anchor_low is None:
            anchor_low = cum_low
        sup_anchor = anchor_low if anchor_low is not None else cum_low

        levels = {"day": {"open": day_open, "high": cum_high, "low": cum_low},
                  "next_support": sup, "next_resistance": res, "max_pain": day_open}

        if pos:
            pnl_hi = (bs_premium(pos["side"], float(r[2]), pos["strike"], t_years, iv) - pos["premium"]) * lot
            pnl_lo = (bs_premium(pos["side"], float(r[3]), pos["strike"], t_years, iv) - pos["premium"]) * lot
            pos["peak"] = max(pos.get("peak", pnl_lo), pnl_hi, pnl_lo)
            reason = None
            exit_prem = None
            if pnl_lo <= sl:
                pos.update(reason="SL", pnl=sl)
                exit_prem = pos["premium"] + sl / lot
            elif pos.get("peak") >= trail_trigger and pnl_hi <= pos["peak"] - trail_dist:
                pos.update(reason="TRAIL", pnl=round(pos["peak"] - trail_dist, 2))
                exit_prem = pos["premium"] + (pos["peak"] - trail_dist) / lot
            elif pnl_hi >= target:
                pos.update(reason="TARGET", pnl=target)
                exit_prem = pos["premium"] + target / lot
            elif hm >= "15:20":
                exit_prem = bs_premium(pos["side"], spot, pos["strike"], t_years, iv)
                pos.update(reason="EOD", pnl=round((exit_prem - pos["premium"]) * lot, 2))
            if pos.get("reason"):
                if include_costs and exit_prem is not None:
                    pos["pnl"] = round(pos["pnl"] - option_costs(pos["premium"], exit_prem, lot), 2)
                trades.append(pos)
                pos = None
                cooldown_until = i + cooldown_min
            continue

        if i < cooldown_until:
            continue

        decision = strat.decide_with_levels(spot, levels, i, 1 if pos else 0)
        if decision.get("action") == "open":
            side = decision["side"]
            base = round(spot / 100) * 100
            strike = base + (100 if side == "CE" else -100)  # strike just above/below spot
            premium = bs_premium(side, spot, strike, t_years, iv)
            pos = {"side": side, "strike": strike, "entry": spot, "premium": premium,
                   "time": hm, "peak": 0.0, "signal": decision.get("reason", "")}

    if pos:
        exit_prem = bs_premium(pos["side"], spot, pos["strike"], t_years, iv)
        pos.update(reason="EOD", pnl=round((exit_prem - pos["premium"]) * lot, 2))
        if include_costs:
            pos["pnl"] = round(pos["pnl"] - option_costs(pos["premium"], exit_prem, lot), 2)
        trades.append(pos)

    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    net = round(sum(t["pnl"] for t in trades), 2)
    # max drawdown from cumulative P&L
    cum, peak, mdd = 0.0, 0.0, 0.0
    for t in trades:
        cum += t["pnl"]
        peak = max(peak, cum)
        mdd = min(mdd, cum - peak)
    return {"trades": len(trades), "wins": len(wins), "losses": len(losses),
            "net": net, "max_dd": round(mdd, 2), "day": day_ohlc["close"]}


def cmd_sweep(args):
    """Multi-day backtest sweep over all strategy configs; rank by robustness."""
    days = load_candle_days()
    if not days:
        raise SystemExit("No candle cache. Run: python3 scripts/paper_sensex.py fetch-candles")
    if args.days:
        days = days[-args.days:]
    oi_sup, oi_res = oi_anchors_from_live()
    dte = (datetime(2026, 8, 6, tzinfo=IST) - datetime.now(IST)).total_seconds() / 86400.0
    t_years = max(dte, 1) / 365.0

    cfgs = strategy_configs()
    results = []
    for cfg in cfgs:
        per_day = []
        for date, rows in days:
            r = run_day_sweep(cfg, rows, oi_sup, oi_res,
                              cfg["target"], cfg["sl"], cfg["trail_trigger"], cfg["trail_dist"],
                              t_years, iv=0.19, include_costs=not args.no_costs)
            per_day.append(r)
        nets = [r["net"] for r in per_day]
        pos_days = [r for r in per_day if r["net"] > 0]
        total_trades = sum(r["trades"] for r in per_day)
        wins = sum(r["wins"] for r in per_day)
        losses = sum(r["losses"] for r in per_day)
        import statistics
        median = statistics.median(nets)
        results.append({
            "config": cfg["name"], "params": cfg,
            "days": len(per_day), "median_net": round(median, 2),
            "mean_net": round(statistics.mean(nets), 2),
            "pct_profitable_days": round(len(pos_days) / len(per_day) * 100, 1) if per_day else 0,
            "total_net": round(sum(nets), 2),
            "total_trades": total_trades, "wins": wins, "losses": losses,
            "win_rate": round(wins / total_trades * 100, 1) if total_trades else 0,
            "max_dd": round(min(r["max_dd"] for r in per_day), 2),
            "per_day": per_day,
        })

    # rank by median day P&L (primary), then % profitable days
    results.sort(key=lambda r: (r["median_net"], r["pct_profitable_days"]), reverse=True)

    print(f"\n=== SENSEX STRATEGY SWEEP — {len(days)} days ({days[0][0]}..{days[-1][0]}) ===")
    print(f"Configs: {len(cfgs)} | ranked by median day P&L (robustness)")
    print(f"{'#':>2} {'config':<28} {'days':>4} {'med':>8} {'mean':>8} {'%pos':>5} {'net':>9} {'tr':>4} {'WR%':>5} {'maxDD':>8}")
    for i, r in enumerate(results, 1):
        print(f"{i:>2} {r['config']:<28} {r['days']:>4} {r['median_net']:>8,.0f} {r['mean_net']:>8,.0f} "
              f"{r['pct_profitable_days']:>5.0f} {r['total_net']:>9,.0f} {r['total_trades']:>4} "
              f"{r['win_rate']:>5.1f} {r['max_dd']:>8,.0f}")

    # hold-out: last 2 days excluded -> confirm winner holds
    if len(days) > 3:
        hold = [r for r in results]
        print("\n=== HOLD-OUT CHECK (last 2 days) ===")
        for r in results[:5]:
            hold_nets = [d["net"] for d in r["per_day"][-2:]]
            print(f"  {r['config']:<28} last-2-day net {sum(hold_nets):>+9,.0f}")

    # save JSONL + trade logs
    sweep_json = DATA / f"paper_sensex_sweep_{datetime.now(IST).strftime('%Y-%m-%d')}.jsonl"
    with open(sweep_json, "w") as f:
        for r in results:
            slim = {k: v for k, v in r.items() if k != "per_day"}
            slim["per_day_nets"] = [d["net"] for d in r["per_day"]]
            f.write(json.dumps(slim) + "\n")
    print(f"\nsaved: {sweep_json}")


def cmd_sweep_live(args):
    """Live signal board across all strategy configs (read-only, virtual P&L)."""
    import time as _t
    cfgs = strategy_configs()
    strats = [RangeStrategy(**{k: v for k, v in c.items() if k != "name"}) for c in cfgs]
    poll = 0
    runs = 1 if args.once else 10**9
    while poll < runs:
        lv = scan_levels()
        spot = lv["spot"]
        lines = []
        lines.append(f"[{datetime.now(IST).strftime('%H:%M:%S')}] SENSEX {spot:,.0f}  "
                     f"(down-day {spot < lv['day']['open']})  sup {lv['next_support']:,.0f} res {lv['next_resistance']:,.0f}")
        lines.append(f"{'#':>2} {'config':<24} {'signal':<14} {'zone':<12}")
        for i, (cfg, strat) in enumerate(zip(cfgs, strats), 1):
            decision = strat.decide_with_levels(spot, lv, poll, 0)
            sig = "LONG/CE" if decision.get("action") == "open" and decision.get("side") == "CE" else \
                  ("SHORT/PE" if decision.get("action") == "open" and decision.get("side") == "PE" else "WAIT")
            lines.append(f"{i:>2} {cfg['name']:<24} {sig:<14} {_zone(spot, lv):<12}")
        out = "\n".join(lines)
        print(out, flush=True)
        poll += 1
        _t.sleep(5 if args.follow else 30)


# ---------------------------------------------------------------------------
# strategy
# ---------------------------------------------------------------------------
class RangeStrategy:
    def __init__(self, **params):
        self._recent = []
        self._cooldown_until = 0
        # exit params
        self.target_net = float(params.get("target", TARGET_NET))
        self.sl_net = float(params.get("sl", SL_NET))
        self.trail_trigger = float(params.get("trail_trigger", TRAIL_TRIGGER))
        self.trail_dist = float(params.get("trail_dist", TRAIL_DIST))
        # entry params
        self.zone_pts = float(params.get("zone_pts", ZONE_PTS))
        self.break_buffer = float(params.get("break_buffer", BREAK_BUFFER))
        self.confirm_samples = int(params.get("confirm_samples", CONFIRM_SAMPLES))
        self.cooldown_polls = int(params.get("cooldown_polls", COOLDOWN_POLLS))
        self.max_open = int(params.get("max_open", MAX_OPEN))
        # rule flags (which signals fire)
        self.rules = set(params.get("rules", ["support_bounce", "resistance_reject", "breakdown", "breakout"]))
        self.trend_filter = bool(params.get("trend_filter", True))
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
        if len(self._recent) < self.confirm_samples:
            return False
        return all(zone_check(s) for s, _ in self._recent[-self.confirm_samples:])

    def decide_with_levels(self, spot: float, levels: dict, poll_index: int,
                           open_positions: int) -> dict:
        self.update(spot)
        if open_positions >= self.max_open:
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
        if self.trend_filter:
            allow_long = not down_day
            allow_short = not up_day
        else:
            allow_long = allow_short = True

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

        # On a down-day, the breakdown anchor MUST be the frozen first-day low
        # (not the moving next_support which ratchets down and never triggers).
        if down_day:
            sup = sup_anchor
        else:
            sup = levels.get("next_support") or sup_anchor
        if up_day:
            res = res_anchor
        else:
            res = levels.get("next_resistance") or res_anchor
        sup_zone = sup + self.zone_pts
        res_zone = res - self.zone_pts
        sup_break = sup - self.break_buffer
        res_break = res + self.break_buffer
        mom = self._momentum(spot)
        trend = "down" if down_day else ("up" if up_day else "flat")
        extra = f"support={sup:,.0f} resistance={res:,.0f} maxpain={levels.get('max_pain',0):,.0f} trend={trend}"
        # LONG-side rules only on an up/flat day
        if allow_long:
            if "support_bounce" in self.rules and spot <= sup_zone and mom >= 0 and self._consecutive_in_zone(lambda s: s <= sup_zone):
                return {"action": "open", "side": "CE", "bias": "LONG",
                        "reason": f"OI/pivot support bounce @ {spot:,.0f} ({extra})"}
            if "breakout" in self.rules and spot >= res_break and mom >= 0 and self._consecutive_in_zone(lambda s: s >= res_break):
                return {"action": "open", "side": "CE", "bias": "LONG",
                        "reason": f"resistance BREAKOUT @ {spot:,.0f} (broke {res:,.0f})"}
        # SHORT-side rules only on a down/flat day
        if allow_short:
            if "resistance_reject" in self.rules and spot >= res_zone and mom <= 0 and self._consecutive_in_zone(lambda s: s >= res_zone):
                return {"action": "open", "side": "PE", "bias": "SHORT",
                        "reason": f"OI/pivot resistance reject @ {spot:,.0f} ({extra})"}
            if "breakdown" in self.rules and spot <= sup_break and mom <= 0 and self._consecutive_in_zone(lambda s: s <= sup_break):
                return {"action": "open", "side": "PE", "bias": "SHORT",
                        "reason": f"support BREAKDOWN @ {spot:,.0f} (broke {sup:,.0f})"}
        return {"action": "none"}

    def mark_closed(self, poll_index: int):
        self._cooldown_until = poll_index + self.cooldown_polls

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
# scalp strategy (momentum / range — OOS-validated)
# ---------------------------------------------------------------------------
class ScalpStrategy:
    """Momentum or range scalp on 1-min SENSEX. OOS-validated configs:
    momentum lb5 thr10 tgt300/sl150 (best OOS +857), range lb5 tgt300/sl150.
    Needs the live spot series (fed each poll). target/sl are ₹ net per lot.
    """
    def __init__(self, style="momentum", lookback=5, thr=10.0,
                 target=300.0, sl=-150.0, cooldown=2):
        self.style = style
        self.lookback = lookback
        self.thr = thr
        self.target = target
        self.sl = sl
        self.cooldown = cooldown
        self._spots = []
        self._cooldown_until = 0
        self._pos_side = None
        self.target_net = target
        self.sl_net = sl

    def _momentum(self):
        if len(self._spots) < self.lookback + 1:
            return 0.0
        return self._spots[-1] - self._spots[-self.lookback - 1]

    def update(self, spot: float):
        self._spots.append(spot)
        if len(self._spots) > 60:
            self._spots = self._spots[-60:]

    def decide(self, spot: float, poll_index: int, open_positions: int) -> dict:
        self.update(spot)
        if open_positions >= 1:
            return {"action": "none"}
        if poll_index < self._cooldown_until:
            return {"action": "none"}
        if len(self._spots) < self.lookback + 1:
            return {"action": "none"}
        side = None
        if self.style == "momentum":
            mom = self._momentum()
            if mom >= self.thr:
                side = "CE"
            elif mom <= -self.thr:
                side = "PE"
        elif self.style == "range":
            lo = min(self._spots[-self.lookback:])
            hi = max(self._spots[-self.lookback:])
            if spot <= lo + 5:
                side = "CE"
            elif spot >= hi - 5:
                side = "PE"
        if not side:
            return {"action": "none"}
        return {"action": "open", "side": side, "reason": f"{self.style} scalp (lb={self.lookback} thr={self.thr})"}

    def mark_closed(self, poll_index: int):
        self._cooldown_until = poll_index + self.cooldown

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
    costs = option_costs(p["premium"], exit_p, p["qty"] * LOT_SIZE)
    p["exit_premium"] = exit_p
    p["closed_at"] = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S")
    p["status"] = "CLOSED"
    p["exit_reason"] = args.reason or "MANUAL"
    p["gross_pnl"] = round(gross, 2)
    p["costs"] = costs
    p["net_pnl"] = round(gross - costs, 2)
    save_positions(positions)
    print(f"CLOSE #{args.id}: exit ₹{exit_p:.2f} → gross ₹{gross:+,.2f} "
          f"(costs ₹{costs:.2f}, net ₹{p['net_pnl']:+,.2f}) ({p['exit_reason']})")


def cmd_pnl(args):
    token = get_token()
    positions = load_positions()
    if not positions:
        print("No paper positions yet.")
        return
    spot = fetch_spot(token)
    print(f"SENSEX spot: {spot:,.2f}  ({datetime.now(IST).strftime('%H:%M:%S')} IST)")
    total = 0.0
    print(f"{'id':>3} {'type':>4} {'strike':>9} {'qty':>4} {'entry':>9} {'ltp':>9} {'pnl':>11} {'costs':>7} {'target':>9} {'sl':>9} {'status':>7}")
    for p in positions:
        if p["status"] == "OPEN":
            chain = fetch_chain(p["expiry"], token)
            ltp = get_contract_ltp(chain, p["strike"], p["type"], token)
            pnl = (ltp - p["premium"]) * p["qty"] * LOT_SIZE
            costs = p.get("costs", 0)
        else:
            ltp = p.get("exit_premium", 0)
            pnl = p.get("gross_pnl", 0)
            costs = p.get("costs", 0)
            pnl = pnl - costs if p.get("net_pnl") is None else p.get("net_pnl", 0)
        total += pnl
        tgt = f"{p['target']:,.0f}" if p.get("target") else "-"
        sl = f"{p['sl']:,.0f}" if p.get("sl") else "-"
        print(f"{p['id']:>3} {p['type']:>4} {p['strike']:>9,.0f} {p['qty']:>4} "
              f"{p['premium']:>9.2f} {ltp:>9.2f} {pnl:>+11,.2f} {costs:>7.2f} {tgt:>9} {sl:>9} {p['status']:>7}")
    print(f"TOTAL paper P&L (net of costs): ₹{total:+,.2f}")


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
    total = sum(p.get("net_pnl", p.get("gross_pnl", 0)) for p in closed)
    for p in opens:
        chain = fetch_chain(p["expiry"])
        ltp = get_contract_ltp(chain, p["strike"], p["type"])
        costs = option_costs(p["premium"], ltp, p["qty"] * p["lot_size"])
        total += (ltp - p["premium"]) * p["qty"] * p["lot_size"] - costs
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
            netp = p.get("net_pnl", p.get("gross_pnl", 0))
            print(f"    CLOSED #{p['id']} {p['type']} {p['strike']:,.0f} {netp:+,.0f} ({p.get('exit_reason')})")


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
            total += p.get("net_pnl", p.get("gross_pnl", 0))
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
            p["costs"] = option_costs(p["premium"], ltp, p["lot_size"] * p["qty"])
            p["gross_pnl"] = round(pnl, 2)
            p["net_pnl"] = round(pnl - p["costs"], 2)
            print(f"  AUTO-CLOSE #{p['id']} ({reason}) @ ₹{ltp:.2f} → ₹{pnl:+,.2f} "
                  f"(costs ₹{p['costs']:.2f}, net ₹{p['net_pnl']:+,.2f})", flush=True)
            if strategy:
                strategy.mark_closed(poll_index)
        total += pnl
        rows.append({"ts": ts, "spot": round(spot, 2), "id": p["id"], "strike": p["strike"],
                     "type": p["type"], "ltp": round(ltp, 2), "pnl": round(pnl, 2),
                     "status": p["status"], "reason": p.get("exit_reason", "")})

    if strategy is not None:
        open_count = sum(1 for p in positions if p["status"] == "OPEN")
        lv = scan_levels(token)
        if isinstance(strategy, ScalpStrategy):
            decision = strategy.decide(lv["spot"], poll_index, open_count)
        else:
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
        if args.scalp:
            strategy = ScalpStrategy(style=args.scalp_style, lookback=args.scalp_lb,
                                     thr=args.scalp_thr, target=args.scalp_tgt, sl=args.scalp_sl)
            print(f"SCALP strategy ENABLED: style={args.scalp_style} lb={args.scalp_lb} "
                  f"thr={args.scalp_thr} tgt+{args.scalp_tgt}/sl{args.scalp_sl}", file=sys.stderr)
        elif args.config:
            cfg = next((c for c in strategy_configs() if c["name"] == args.config), None)
            if cfg is None:
                raise SystemExit(f"Unknown config '{args.config}'. Available: " +
                                 ", ".join(c["name"] for c in strategy_configs()))
            strategy = RangeStrategy(**{k: v for k, v in cfg.items() if k != "name"})
            print(f"Strategy ENABLED: config={args.config} (target {strategy.target_net:,.0f} "
                  f"SL {strategy.sl_net:,.0f} trail {strategy.trail_trigger:,.0f}/{strategy.trail_dist:,.0f})",
                  file=sys.stderr)
        else:
            strategy = RangeStrategy()
            print("Range strategy ENABLED (default config)", file=sys.stderr)
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
# top-5 horse-race (parallel virtual books, live)
# ---------------------------------------------------------------------------
TOP5 = [
    {"name": "momentum-lb5-t300", "type": "scalp", "style": "momentum", "lb": 5, "thr": 10, "target": 300, "sl": -150},
    {"name": "momentum-lb3-t500", "type": "scalp", "style": "momentum", "lb": 3, "thr": 10, "target": 500, "sl": -200},
    {"name": "range-lb5-t300", "type": "scalp", "style": "range", "lb": 5, "thr": 10, "target": 300, "sl": -150},
    {"name": "range-lb3-t300", "type": "scalp", "style": "range", "lb": 3, "thr": 10, "target": 300, "sl": -150},
    {"name": "notrend-t600-sl200", "type": "range", "config": "notrend-t600-sl200-on"},
]


def cmd_top5(args):
    """Run 5 strategies as parallel virtual books on live spot; log all trades to CSV.

    Each strategy gets the same live spot each poll. Each keeps its own virtual
    open position with target/SL (from its config). Every trade (open + close)
    is appended to experiments/data/top5_live_<date>.csv so we can compare
    live performance across the 5 OOS-validated strategies.
    """
    import time as _t
    # build strategies
    strats = []
    for s in TOP5:
        if s["type"] == "scalp":
            strats.append({
                "name": s["name"], "obj": ScalpStrategy(style=s["style"], lookback=s["lb"],
                                                        thr=s["thr"], target=s["target"], sl=s["sl"]),
                "target": s["target"], "sl": s["sl"], "pos": None, "wins": 0, "losses": 0,
                "net": 0.0, "trades": 0, "last_entry": None,
            })
        else:
            cfg = next(c for c in strategy_configs() if c["name"] == s["config"])
            strats.append({
                "name": s["name"], "obj": RangeStrategy(**{k: v for k, v in cfg.items() if k != "name"}),
                "target": cfg["target"], "sl": cfg["sl"], "pos": None, "wins": 0, "losses": 0,
                "net": 0.0, "trades": 0, "last_entry": None,
            })

    csv_path = DATA / f"top5_live_{datetime.now(IST).strftime('%Y-%m-%d')}.csv"
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    write_hdr = not csv_path.exists()

    # Resume: load any existing trades from today's CSV so a restart preserves
    # each strategy's tallies (net/trades/W-L) and re-opens any OPEN position.
    if csv_path.exists() and csv_path.stat().st_size > 0:
        try:
            with open(csv_path) as _f:
                for _r in csv.DictReader(_f):
                    _cfg = _r.get("config")
                    _s = next((x for x in strats if x["name"] == _cfg), None)
                    if not _s:
                        continue
                    _reason = _r.get("reason", "")
                    if _reason == "OPEN":
                        # re-open the virtual position
                        _s["pos"] = {
                            "side": _r.get("side"), "strike": float(_r.get("strike", 0)),
                            "type": _r.get("side"), "premium": float(_r.get("premium", 0)),
                            "entry": float(_r.get("entry", 0)), "expiry": DEFAULT_EXPIRY,
                            "entry_time": _r.get("ts", ""),
                        }
                    elif _r.get("pnl"):
                        _p = float(_r.get("pnl", 0))
                        _s["net"] += _p
                        _s["trades"] += 1
                        _s["wins" if _p > 0 else "losses"] += 1
            print(f"[top5] resumed {len(strats)} strategies from {csv_path.name} "
                  f"(nets: {', '.join(f'{x['name']}={x['net']:,.0f}' for x in strats)})",
                  file=sys.stderr)
        except Exception as e:
            print(f"[top5] resume skipped ({e})", file=sys.stderr)

    stop_h, stop_m = (int(x) for x in args.until.split(":"))
    poll = 0
    # day-open for the range strategy's levels
    ohlc = fetch_day_ohlc()
    day_open = ohlc["open"]

    while True:
        now = datetime.now(IST)
        if now.hour > stop_h or (now.hour == stop_h and now.minute >= stop_m):
            print(f"[top5] reached {args.until}; stopping.", file=sys.stderr)
            break
        ts = now.strftime("%H:%M:%S")
        try:
            token = get_token()
            lv = scan_levels(token)
            spot = lv["spot"]
        except Exception as e:
            print(f"[top5 {ts}] data error: {e}", file=sys.stderr, flush=True)
            _t.sleep(args.interval)
            continue

        with open(csv_path, "a", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["ts", "config", "side", "strike", "entry", "premium",
                                              "exit", "reason", "pnl", "net_cum"])
            if write_hdr:
                w.writeheader(); write_hdr = False
            for s in strats:
                obj = s["obj"]
                if isinstance(obj, ScalpStrategy):
                    obj.update(spot)
                if s["pos"]:
                    ltp = get_contract_ltp(fetch_chain(s["pos"]["expiry"], token), s["pos"]["strike"], s["pos"]["type"], token)
                    pnl = (ltp - s["pos"]["premium"]) * LOT_SIZE
                    reason = None
                    if pnl <= s["sl"]:
                        reason = "SL"
                    elif pnl >= s["target"]:
                        reason = "TARGET"
                    elif now.hour >= 15:
                        reason = "EOD"
                    if reason:
                        costs = option_costs(s["pos"]["premium"], ltp, LOT_SIZE)
                        net = pnl - costs
                        s["net"] += net; s["trades"] += 1
                        s["wins" if net > 0 else "losses"] += 1
                        w.writerow({"ts": ts, "config": s["name"], "side": s["pos"]["type"],
                                    "strike": s["pos"]["strike"], "entry": s["pos"]["entry"],
                                    "premium": s["pos"]["premium"], "exit": round(ltp, 2),
                                    "reason": reason, "pnl": round(net, 2), "net_cum": round(s["net"], 2)})
                        s["pos"] = None
                        obj.mark_closed(poll)
                        continue
                open_count = 1 if s["pos"] else 0
                if isinstance(obj, ScalpStrategy):
                    dec = obj.decide(spot, poll, open_count)
                else:
                    dec = obj.decide_with_levels(spot, lv, poll, open_count)
                if dec.get("action") == "open":
                    expiry = nearest_expiry(token)
                    chain = fetch_chain(expiry, token)
                    strike = obj.pick_strike(spot, dec["side"], chain)
                    premium = obj.premium_for(chain, strike, dec["side"]) if strike else 0.0
                    if strike and premium > 0:
                        s["pos"] = {"side": dec["side"], "strike": strike, "type": dec["side"],
                                    "premium": premium, "entry": spot, "expiry": expiry, "entry_time": ts}
                        s["last_entry"] = ts
                        w.writerow({"ts": ts, "config": s["name"], "side": dec["side"],
                                    "strike": strike, "entry": round(spot, 2), "premium": round(premium, 2),
                                    "exit": "", "reason": "OPEN", "pnl": 0, "net_cum": round(s["net"], 2)})

        # live board
        print(f"\n[{ts}] SENSEX {spot:,.0f}")
        print(f"{'strategy':<18} {'pos':>6} {'net':>10} {'trades':>7} {'W/L':>8}")
        for s in strats:
            side = f"{s['pos']['side']}@{s['pos']['strike']:,.0f}" if s["pos"] else "-"
            print(f"{s['name']:<18} {side:>6} {s['net']:>10,.0f} {s['trades']:>7} "
                  f"{s['wins']}/{s['losses']}", flush=True)
        poll += 1
        _t.sleep(args.interval)

    print(f"[top5] results -> {csv_path}")


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
    p.add_argument("--config", help="named strategy config to run (e.g. notrend-t600-sl200-on)")
    p.add_argument("--scalp", action="store_true", help="run scalp strategy instead of range")
    p.add_argument("--scalp-style", default="momentum", choices=["momentum", "range"])
    p.add_argument("--scalp-lb", type=int, default=5, help="scalp lookback bars")
    p.add_argument("--scalp-thr", type=float, default=10.0, help="momentum threshold pts")
    p.add_argument("--scalp-tgt", type=float, default=300.0, help="scalp target ₹ net")
    p.add_argument("--scalp-sl", type=float, default=-150.0, help="scalp SL ₹ net")
    p.set_defaults(func=cmd_monitor)

    p = sub.add_parser("status")
    p.add_argument("--interval", type=int, default=300); p.add_argument("--until", default="15:30")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("fetch-candles", help="fetch N days of SENSEX 1-min candles into cache")
    p.add_argument("--days", type=int, default=20)
    p.set_defaults(func=cmd_fetch_candles)

    p = sub.add_parser("sweep", help="multi-day backtest sweep across all strategy configs")
    p.add_argument("--days", type=int, default=0, help="limit to last N day-files (0=all)")
    p.add_argument("--no-costs", action="store_true", help="exclude option trading charges")
    p.set_defaults(func=cmd_sweep)

    p = sub.add_parser("sweep-live", help="live signal board across all strategy configs")
    p.add_argument("--follow", type=int, default=0, help="config index to promote to real position mgmt")
    p.add_argument("--once", action="store_true", help="print one snapshot and exit")
    p.set_defaults(func=cmd_sweep_live)

    p = sub.add_parser("top5", help="live horse-race: 5 OOS-validated strategies, parallel virtual books")
    p.add_argument("--interval", type=int, default=60)
    p.add_argument("--until", default="15:30")
    p.set_defaults(func=cmd_top5)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
