#!/usr/bin/env python3
"""Global cue snapshot: US index futures, cash indices, VIX, crude, GIFT Nifty, USD.

Answers the only question that matters before the Indian open: what does the
overnight tape hand us?

Usage:
    python scripts/market/futures_cue.py
    python scripts/market/futures_cue.py --ndx-contrib
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from market.tv_client import scanner_frame  # noqa: E402

FUTURES = ["CME_MINI:NQ1!", "CME_MINI:MNQ1!", "CME_MINI:MES1!", "CBOT_MINI:ES1!",
           "CBOT_MINI:YM1!", "CBOT_MINI:RTY1!", "NYMEX:CL1!", "SGX:NI1!", "CME_MINI:GC1!"]

CASH = ["NASDAQ:QQQ", "AMEX:SPY", "NASDAQ:NDX", "NASDAQ:IXIC", "SP:SPX", "DJ:DJI",
        "CBOE:VIX", "NASDAQ:SOX", "AMEX:IWM", "AMEX:GLD", "AMEX:USO", "AMEX:TLT", "AMEX:HYG"]

# Nasdaq-100 / QQQ weights (source: stockanalysis.com QQQ holdings, updated Oct 2026)
QQQ_WEIGHTS = {
    "NVDA": 8.16, "AAPL": 7.81, "MSFT": 6.18, "AMZN": 4.42, "MU": 4.40, "AMD": 3.78,
    "META": 3.27, "GOOGL": 3.15, "TSLA": 3.02, "GOOG": 2.93, "SPCX": 2.73, "WMT": 2.49,
    "AVGO": 2.48, "INTC": 2.08, "PLTR": 1.92, "COST": 1.90, "CSCO": 1.81, "LRCX": 1.47,
    "AMAT": 1.41, "NFLX": 1.25, "PANW": 1.22, "TXN": 1.09, "CRWD": 1.01, "LIN": 1.00,
    "AMGN": 0.99, "ARM": 0.57,
}

INDEX_COLS = ["name", "description", "close", "change", "open", "high", "low", "volume",
              "change|15", "change|60", "SMA20", "SMA50", "SMA200", "RSI", "Recommend.All",
              "Perf.W", "Perf.1M", "price_52_week_high"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ndx-contrib", action="store_true",
                    help="print QQQ weight x change contribution table")
    args = ap.parse_args()

    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 30)
    pd.set_option("display.max_rows", 100)

    fut = scanner_frame("futures", columns=["name", "description", "close", "change", "open",
                                            "high", "low", "volume"], tickers=FUTURES, limit=40)
    print("\n=== FUTURES / COMMODITIES (TV live) ===")
    print(fut[["sym", "description", "close", "change", "open", "high", "low", "volume"]].to_string(index=False))

    cash = scanner_frame("america", columns=INDEX_COLS, tickers=CASH, limit=40)
    print("\n=== CASH INDICES / ETFs ===")
    print(cash[["sym", "close", "change", "change|15", "change|60", "volume", "RSI",
                "Recommend.All", "Perf.W", "Perf.1M"]].to_string(index=False))

    if args.ndx_contrib:
        cols = ["name", "close", "change", "market_cap_basic", "sector"]
        df = scanner_frame("america", columns=cols, tickers=[f"NASDAQ:{s}" for s in QQQ_WEIGHTS],
                           limit=60)
        df = df[df["sym"].isin(QQQ_WEIGHTS)]
        df["wt"] = df["sym"].map(QQQ_WEIGHTS)
        df["contrib_bps"] = (df["wt"] / 100 * df["change"] * 100).round(1)
        df = df.sort_values("contrib_bps")
        print("\n=== QQQ / NDX CONTRIBUTION (weight x today's move) ===")
        print(df[["sym", "wt", "close", "change", "contrib_bps"]].to_string(index=False))
        print(f"drag {df[df.contrib_bps < 0].contrib_bps.sum():.1f} bps | "
              f"push {df[df.contrib_bps > 0].contrib_bps.sum():.1f} bps | "
              f"net {df.contrib_bps.sum():.1f} bps")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
