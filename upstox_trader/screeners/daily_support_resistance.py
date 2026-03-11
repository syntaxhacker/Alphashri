#!/usr/bin/env python3
"""
Calculate 1D support/resistance levels for a stock using Upstox historical data.

Examples:
  python upstox_trader/screeners/daily_support_resistance.py RELIANCE
  python upstox_trader/screeners/daily_support_resistance.py TCS --lookback 180 --history-days 730
  python upstox_trader/screeners/daily_support_resistance.py INFY --json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path


# Make local module imports work when run as a script.
SCRIPT_DIR = Path(__file__).resolve().parent
UPSTOX_TRADER_DIR = SCRIPT_DIR.parent
if str(UPSTOX_TRADER_DIR) not in sys.path:
    sys.path.append(str(UPSTOX_TRADER_DIR))

try:
    from config import UPSTOX_CONFIG
    from config_and_utils.free_indian_apis import UpstoxAPI
    from screeners.core.technical_analysis import (
        find_nearest_levels,
        identify_support_resistance_levels,
    )
except ImportError as exc:
    print(f"Import error: {exc}")
    print("Run from repository root, or ensure upstox_trader dependencies are available.")
    sys.exit(1)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Compute 1D support/resistance levels from Upstox daily candles."
    )
    parser.add_argument("symbol", help="Stock symbol, e.g. RELIANCE")
    parser.add_argument("--lookback", type=int, default=120, help="Candles used for S/R detection")
    parser.add_argument("--history-days", type=int, default=365, help="Total days to fetch")
    parser.add_argument(
        "--level-threshold",
        type=float,
        default=0.5,
        help="Percent threshold for grouping/touches",
    )
    parser.add_argument("--min-touches", type=int, default=2, help="Minimum touches for valid level")
    parser.add_argument("--bounce-threshold", type=float, default=0.25, help="Used for near-level tag")
    parser.add_argument("--exchange", default="NSE_EQ", help="Exchange segment (default: NSE_EQ)")
    parser.add_argument("--instrument-type", default="EQ", help="Instrument type (default: EQ)")
    parser.add_argument("--top", type=int, default=5, help="Top N support/resistance levels to print")
    parser.add_argument("--api-key", default=None, help="Override API key (optional)")
    parser.add_argument("--api-secret", default=None, help="Override API secret (optional)")
    parser.add_argument("--quiet-api", action="store_true", help="Suppress connector logs")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON output")
    return parser


def as_candle_data(df):
    candle_data = []
    for idx, row in df.iterrows():
        candle_data.append(
            {
                "datetime": idx,
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row.get("volume", 0.0)),
            }
        )
    return candle_data


def main() -> int:
    args = build_parser().parse_args()

    api_key = args.api_key or os.getenv("UPSTOX_API_KEY") or UPSTOX_CONFIG.get("api_key")
    api_secret = args.api_secret or os.getenv("UPSTOX_API_SECRET") or UPSTOX_CONFIG.get("api_secret")
    if not api_key or not api_secret:
        print("Missing Upstox credentials. Set config.py or pass --api-key and --api-secret.")
        return 1

    to_date = datetime.now().date()
    from_date = to_date - timedelta(days=args.history_days)

    api = UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=args.quiet_api)
    df = api.fetch_historical_data_v3(
        symbol=args.symbol,
        unit="days",
        interval=1,
        to_date=to_date.isoformat(),
        from_date=from_date.isoformat(),
        instrument_type=args.instrument_type,
        exchange=args.exchange,
    )

    if df is None or df.empty:
        print(f"No daily candle data returned for {args.symbol}.")
        return 1

    df = df.sort_index()
    if len(df) < args.lookback:
        print(
            f"Insufficient candles for lookback={args.lookback}. "
            f"Fetched {len(df)} candles. Increase --history-days or reduce --lookback."
        )
        return 1

    candle_data = as_candle_data(df)
    support_levels, resistance_levels = identify_support_resistance_levels(
        candle_data=candle_data,
        lookback_periods=args.lookback,
        level_threshold=args.level_threshold,
        min_touches=args.min_touches,
        bounce_threshold=args.bounce_threshold,
    )

    current_price = float(df["close"].iloc[-1])
    nearest_support, nearest_resistance = find_nearest_levels(
        current_price=current_price,
        support_levels=support_levels,
        resistance_levels=resistance_levels,
    )

    result = {
        "symbol": args.symbol.upper(),
        "timeframe": "1D",
        "current_price": current_price,
        "as_of": str(df.index[-1]),
        "candles_fetched": int(len(df)),
        "lookback": args.lookback,
        "support_levels": support_levels,
        "resistance_levels": resistance_levels,
        "nearest_support": nearest_support,
        "nearest_resistance": nearest_resistance,
    }

    # Actionable context for current price.
    contextual_support_levels = sorted([l for l in support_levels if l < current_price], reverse=True)
    contextual_resistance_levels = sorted([l for l in resistance_levels if l > current_price], reverse=True)
    result["contextual_support_levels"] = contextual_support_levels
    result["contextual_resistance_levels"] = contextual_resistance_levels

    if args.json:
        print(json.dumps(result, indent=2, default=str))
        return 0

    print(f"Symbol: {result['symbol']} | Timeframe: {result['timeframe']}")
    print(f"As of: {result['as_of']}")
    print(f"Current price: {current_price:.2f}")
    print(f"Candles fetched: {result['candles_fetched']} | Lookback: {args.lookback}")
    print("")

    support_to_print = contextual_support_levels[: args.top]
    resistance_to_print = contextual_resistance_levels[: args.top]

    print("Support levels below current price (high to low):")
    if support_to_print:
        for i, level in enumerate(support_to_print, start=1):
            delta = ((current_price - level) / level) * 100 if level else 0.0
            marker = " <== nearest" if nearest_support is not None and abs(level - nearest_support) < 1e-9 else ""
            print(f"  S{i}: {level:.2f} ({delta:+.2f}%){marker}")
    else:
        print("  None")

    print("Resistance levels above current price (high to low):")
    if resistance_to_print:
        for i, level in enumerate(resistance_to_print, start=1):
            delta = ((level - current_price) / current_price) * 100 if current_price else 0.0
            marker = " <== nearest" if nearest_resistance is not None and abs(level - nearest_resistance) < 1e-9 else ""
            print(f"  R{i}: {level:.2f} ({delta:+.2f}%){marker}")
    else:
        print("  None")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
