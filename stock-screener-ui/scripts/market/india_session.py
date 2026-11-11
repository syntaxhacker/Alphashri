#!/usr/bin/env python3
"""Next-session setup for the Indian market (NSE).

Blocks:
  1. INDEX CLOSE + tomorrow's classic pivot points / fib levels
  2. BREADTH  (Nifty 50 constituents, adv/decline) and sector rotation
  3. WATCHLISTS built with the same filters as the repo's TradingView scanners
     (pre-breakout accumulation, intraday breakout, momentum, near-52w-high)
  4. OVERNIGHT CUES (GIFT Nifty, crude, US futures) so the open can be anticipated

Usage:
    python scripts/market/india_session.py
    python scripts/market/india_session.py --watchlists-only
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from market.tv_client import scanner_frame  # noqa: E402

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

# Nifty 50 constituents (Wikipedia, incl. the Sep-2026 reshuffle)
NIFTY50 = """ADANIENT ADANIPORTS APOLLOHOSP ASIANPAINT AXISBANK BAJAJ-AUTO BAJFINANCE BAJAJFINSV BEL
BHARTIARTL BSE CIPLA COALINDIA DRREDDY EICHERMOT ETERNAL GRASIM HCLTECH HDFCBANK HDFCLIFE HINDALCO
HINDUNILVR ICICIBANK INDIGO INFY ITC JIOFIN JSWSTEEL KOTAKBANK LT M&M MARUTI MAXHEALTH NESTLEIND NTPC
ONGC POWERGRID RELIANCE SBILIFE SHRIRAMFIN SBIN SUNPHARMA TCS TATACONSUM TMPV TATASTEEL TECHM
TITAN TRENT ULTRACEMCO""".split()

INDICES = ["NSE:NIFTY", "NSE:BANKNIFTY", "NSE:INDIAVIX", "NSE:PSUBANK", "NSE:NIFTYNXT50",
           "NSEIX:NIFTY", "SGX:NI1!"]

STOCK_COLS = ["name", "description", "close", "change", "volume", "relative_volume_10d_calc",
              "market_cap_basic", "sector", "RSI", "ADX", "ATR", "gap", "high", "low", "open",
              "price_52_week_high", "price_52_week_low", "EMA20", "EMA50", "SMA200"]


def _pivots(row: pd.Series) -> pd.Series:
    high, low, close = row["high"], row["low"], row["close"]
    pivot = (high + low + close) / 3
    return pd.Series({
        "prev_close": close / (1 + row["change"] / 100),
        "P": pivot, "R1": 2 * pivot - low, "R2": pivot + high - low, "R3": high + 2 * (pivot - low),
        "S1": 2 * pivot - high, "S2": pivot - high + low, "S3": low - 2 * (high - pivot),
        "fib23.6": low + (high - low) * 0.236, "fib38.2": low + (high - low) * 0.382,
        "fib50": (high + low) / 2, "fib61.8": low + (high - low) * 0.618,
    })


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--watchlists-only", action="store_true")
    args = ap.parse_args()

    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 40)
    pd.set_option("display.max_rows", 200)
    now = dt.datetime.now(IST)
    print(f"INDIA SETUP — {now:%a %d %b %Y %H:%M} IST")

    if not args.watchlists_only:
        idx = scanner_frame("india", columns=["name", "description", "close", "change", "open",
                                              "high", "low", "volume", "SMA20", "SMA50", "SMA200",
                                              "RSI", "Recommend.All", "Perf.W", "Perf.1M",
                                              "price_52_week_high"], tickers=INDICES, limit=30)
        print("\n=== INDICES (today's close) ===")
        print(idx[["sym", "close", "change", "open", "high", "low", "SMA20", "SMA50", "SMA200",
                   "RSI", "Recommend.All", "Perf.W", "Perf.1M"]].to_string(index=False))

        nifty = idx[idx["sym"] == "NIFTY"]
        if not nifty.empty:
            piv = _pivots(nifty.iloc[0])
            print("\n=== NIFTY PIVOTS for the next session ===")
            for k, v in piv.items():
                print(f"   {k:>10s} {v:10.2f}")

        universe = scanner_frame("india", columns=STOCK_COLS,
                                 filters=[{"left": "market_cap_basic", "operation": "greater",
                                           "right": 1_000_000_000}], limit=2000)
        universe["mcap_cr"] = (universe["market_cap_basic"] / 1e7).round(0)
        c50 = universe[universe["sym"].isin(NIFTY50)]
        print("\n=== NIFTY 50 CONSTITUENTS (today) ===")
        print(c50[["sym", "close", "change", "volume", "relative_volume_10d_calc", "RSI", "ADX",
                   "mcap_cr", "sector"]].sort_values("change").to_string(index=False))
        if not c50.empty:
            up = int((c50["change"] > 0).sum())
            print(f"\nBREADTH: {up} up / {len(c50) - up} down | avg {c50['change'].mean():+.2f}% | "
                  f"median {c50['change'].median():+.2f}%")

        sec = universe[universe["mcap_cr"] > 500].dropna(subset=["sector", "change"]).copy()
        sec["w"] = sec["market_cap_basic"] * sec["change"]
        rot = (sec.groupby("sector")
               .apply(lambda x: pd.Series({
                   "n": len(x),
                   "w_chg%": round(x["w"].sum() / x["market_cap_basic"].sum(), 2),
                   "lead": x.loc[x["change"].idxmax(), "sym"],
                   "lag": x.loc[x["change"].idxmin(), "sym"],
                   "lag%": round(x["change"].min(), 2)}))
               .sort_values("w_chg%"))
        print("\n=== SECTOR ROTATION (mcap-weighted, >₹500cr) ===")
        print(rot.to_string())

    # --- watchlists, same filters as the repo's TradingView scanners ---
    pre, _ = scanner_frame("india", columns=STOCK_COLS, filters=[
        {"left": "close", "operation": "greater", "right": 50},
        {"left": "volume", "operation": "greater", "right": 500000},
        {"left": "market_cap_basic", "operation": "greater", "right": 2_000_000_000},
        {"left": "relative_volume_10d_calc", "operation": "greater", "right": 1.2},
        {"left": "RSI", "operation": "in_range", "right": [40, 65]},
        {"left": "change", "operation": "in_range", "right": [-2, 3]}],
        sort="relative_volume_10d_calc", limit=50)
    pre = pre[pre["price_52_week_high"] > pre["close"]].copy()
    pre["mcap_cr"] = (pre["market_cap_basic"] / 1e7).round(0)
    pre["acc_score"] = ((pre["relative_volume_10d_calc"] - 1) * 20 + (65 - pre["RSI"]) / 5
                        + (pre["price_52_week_high"] / pre["close"] - 1) * 100)
    print("\n=== WATCHLIST: PRE-BREAKOUT ACCUMULATION ===")
    print(pre.sort_values("acc_score", ascending=False)[
        ["sym", "close", "change", "volume", "relative_volume_10d_calc", "RSI", "ADX",
         "price_52_week_high", "mcap_cr", "sector", "acc_score"]].head(15).to_string(index=False))

    brk, _ = scanner_frame("india", columns=STOCK_COLS, filters=[
        {"left": "market_cap_basic", "operation": "greater", "right": 500_000_000},
        {"left": "volume", "operation": "greater", "right": 100_000},
        {"left": "close", "operation": "greater", "right": 50},
        {"left": "relative_volume_10d_calc", "operation": "greater", "right": 1.5},
        {"left": "ADX", "operation": "greater", "right": 25},
        {"left": "RSI", "operation": "in_range", "right": [45, 75]}],
        sort="relative_volume_10d_calc", limit=50)
    brk = brk[brk["close"] > brk["EMA20"]]
    brk["mcap_cr"] = (brk["market_cap_basic"] / 1e7).round(0)
    print("\n=== WATCHLIST: INTRADAY BREAKOUT (ADX>25, RVOL>1.5, >EMA20) ===")
    print(brk[["sym", "close", "change", "gap", "volume", "relative_volume_10d_calc", "RSI",
               "ADX", "ATR", "price_52_week_high", "mcap_cr", "sector"]].head(15).to_string(index=False))

    near, _ = scanner_frame("india", columns=STOCK_COLS, filters=[
        {"left": "market_cap_basic", "operation": "greater", "right": 500_000_000}],
        sort="close", limit=2500)
    near["to_high%"] = (near["price_52_week_high"] / near["close"] - 1) * 100
    near = near[(near["to_high%"] < 2.0) & (near["to_high%"] > 0) & (near["volume"] > 200000)]
    near["mcap_cr"] = (near["market_cap_basic"] / 1e7).round(0)
    print("\n=== WATCHLIST: JUST BELOW 52-WEEK HIGH ===")
    print(near.sort_values("to_high%")[["sym", "close", "change", "volume",
                                         "relative_volume_10d_calc", "RSI", "to_high%",
                                         "mcap_cr", "sector"]].head(15).to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
