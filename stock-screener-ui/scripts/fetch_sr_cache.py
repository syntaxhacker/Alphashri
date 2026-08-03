"""
Fetch and cache all data needed for SR Breakout optimization.
Run once, then benchmark uses the cached pickle file.

Usage:
    cd stock-screener-ui && python scripts/fetch_sr_cache.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import os
import pickle
import time
from datetime import datetime, timedelta

from rich.console import Console

console = Console()

SYMBOLS = [
    "APOLLOPIPE", "CARBORUNIV", "COFORGE", "DEEDEV", "GOKULAGRO",
    "JBMA", "NOCIL", "PERSISTENT", "POLYMED", "PREMIERENE",
    "ROSSARI", "SANGHVIMOV", "SGMART", "SHILPAMED", "SOLARWORLD",
    "SPORTKING", "STERTOOLS", "TMB",
]

TRADE_DATE = "2026-04-02"
PREV_DATE = "2026-04-01"

CACHE_DIR = Path(__file__).parent.parent / "experiments"
CACHE_FILE = CACHE_DIR / "sr_data_cache.pkl"


def main():
    from upstox_trader.config_and_utils.upstox_api import UpstoxAPI
    from trading.sr_breakout_signals import SRBreakoutSignalGenerator

    api_key = os.getenv("UPSTOX_API_KEY") or os.getenv("UPSTOX_CLIENT_ID")
    api_secret = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")
    if not api_key or not api_secret:
        console.print("[red]UPSTOX_API_KEY and UPSTOX_API_SECRET env vars required[/red]")
        sys.exit(1)

    api = UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=True)
    gen = SRBreakoutSignalGenerator({"sl_pct": 1.0, "tp_pct": 3.0, "pivot_type": "classic", "breakout_buffer_pct": 0.1})

    cache = {}

    for i, symbol in enumerate(SYMBOLS):
        console.print(f"[dim]({i+1}/{len(SYMBOLS)}) {symbol}...[/dim]", end=" ")
        time.sleep(0.3)

        from_date = (datetime.strptime(PREV_DATE, "%Y-%m-%d") - timedelta(days=10)).strftime("%Y-%m-%d")
        daily_df = api.fetch_historical_data_v3(
            symbol=symbol, unit="days", interval=1,
            to_date=TRADE_DATE, from_date=from_date,
        )
        if daily_df is None or daily_df.empty or len(daily_df) < 2:
            console.print("[red]skip daily[/red]")
            continue

        prev_row = daily_df.iloc[-2]
        prev_high = float(prev_row["high"])
        prev_low = float(prev_row["low"])
        prev_close = float(prev_row["close"])

        intraday_df = api.fetch_historical_data_v3(
            symbol=symbol, unit="minutes", interval=1,
            to_date=TRADE_DATE, from_date=TRADE_DATE,
        )
        if intraday_df is None or intraday_df.empty:
            console.print("[red]skip intraday[/red]")
            continue

        pivot_classic = gen.calculate_pivot_points(prev_high, prev_low, prev_close)
        gen_fib = SRBreakoutSignalGenerator({"sl_pct": 1.0, "tp_pct": 3.0, "pivot_type": "fibonacci", "breakout_buffer_pct": 0.1})
        pivot_fib = gen_fib.calculate_pivot_points(prev_high, prev_low, prev_close)
        gen_cam = SRBreakoutSignalGenerator({"sl_pct": 1.0, "tp_pct": 3.0, "pivot_type": "camarilla", "breakout_buffer_pct": 0.1})
        pivot_cam = gen_cam.calculate_pivot_points(prev_high, prev_low, prev_close)

        cache[symbol] = {
            "prev_high": prev_high,
            "prev_low": prev_low,
            "prev_close": prev_close,
            "intraday": intraday_df,
            "pivot_classic": pivot_classic,
            "pivot_fibonacci": pivot_fib,
            "pivot_camarilla": pivot_cam,
        }
        console.print(f"[green]ok ({len(intraday_df)} candles)[/green]")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(CACHE_FILE, "wb") as f:
        pickle.dump(cache, f)

    console.print(f"\n[bold green]Cached {len(cache)} symbols to {CACHE_FILE}[/bold green]")


if __name__ == "__main__":
    main()
