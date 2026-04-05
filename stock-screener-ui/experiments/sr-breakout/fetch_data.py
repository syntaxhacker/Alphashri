"""
Multi-day data fetcher for SR Breakout validation.
Fetches daily + 1-min intraday data for multiple trading days in parallel.

Usage:
    cd stock-screener-ui && python experiments/sr-breakout/fetch_data.py
    # Or specify date range:
    python experiments/sr-breakout/fetch_data.py --from 2026-03-01 --to 2026-04-04
    # Or number of trading days:
    python experiments/sr-breakout/fetch_data.py --days 60
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

import argparse
import os
import pickle
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

import pandas as pd
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn

console = Console()

SYMBOLS = [
    "APOLLOPIPE", "CARBORUNIV", "COFORGE", "DEEDEV", "GOKULAGRO",
    "HCLTECH", "IOC", "JBMA", "KPITTECH", "LTIM",
    "NOCIL", "PERSISTENT", "POLYMED", "PREMIERENE", "RELIANCE",
    "ROSSARI", "SANGHVIMOV", "SGMART", "SHILPAMED", "SOLARWORLD",
    "SPORTKING", "STERTOOLS", "TATAPOWER", "TCS", "TMB",
    "TITAN", "TRENT", "WIPRO",
]

DATA_DIR = Path(__file__).parent / "data"


def get_api():
    from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
    api_key = os.getenv("UPSTOX_API_KEY") or os.getenv("UPSTOX_CLIENT_ID")
    api_secret = os.getenv("UPSTOX_API_SECRET") or os.getenv("UPSTOX_CLIENT_SECRET")
    if not api_key or not api_secret:
        console.print("[red]UPSTOX_API_KEY and UPSTOX_API_SECRET env vars required[/red]")
        sys.exit(1)
    return UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=True)


def get_trading_days(from_date: str, to_date: str) -> list:
    api = get_api()
    df = api.fetch_historical_data_v3(
        symbol="RELIANCE", unit="days", interval=1,
        to_date=to_date, from_date=from_date,
    )
    if df is None or df.empty:
        return []
    days = [d.strftime("%Y-%m-%d") for d in df.index]
    console.print(f"[dim]Found {len(days)} trading days from {from_date} to {to_date}[/dim]")
    return days


def fetch_daily_for_symbol(api, symbol, from_date: str, to_date: str):
    df = api.fetch_historical_data_v3(
        symbol=symbol, unit="days", interval=1,
        to_date=to_date, from_date=from_date,
    )
    return symbol, df


def fetch_intraday_for_symbol_day(api, symbol, day: str):
    df = api.fetch_historical_data_v3(
        symbol=symbol, unit="minutes", interval=1,
        to_date=day, from_date=day,
    )
    return symbol, day, df


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="from_date", default=None)
    parser.add_argument("--to", dest="to_date", default=None)
    parser.add_argument("--days", type=int, default=None)
    args = parser.parse_args()

    if args.days:
        to_date = datetime.now().strftime("%Y-%m-%d")
        from_date = (datetime.now() - timedelta(days=args.days * 2)).strftime("%Y-%m-%d")
    else:
        to_date = args.to_date or (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        from_date = args.from_date or (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")

    console.print(Panel(
        f"[bold cyan]SR Breakout Multi-Day Data Fetcher[/bold cyan]\n"
        f"From: {from_date} | To: {to_date}\n"
        f"Symbols: {len(SYMBOLS)}",
        border_style="cyan",
    ))

    api = get_api()

    trading_days = get_trading_days(from_date, to_date)
    if not trading_days:
        console.print("[red]No trading days found[/red]")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "daily").mkdir(exist_ok=True)
    (DATA_DIR / "intraday").mkdir(exist_ok=True)

    daily_cache = {}
    intraday_cache = {}

    loaded_daily = 0
    loaded_intraday = 0

    daily_pkl = DATA_DIR / "daily" / "all_daily.pkl"
    if daily_pkl.exists():
        with open(daily_pkl, "rb") as f:
            daily_cache = pickle.load(f)
        loaded_daily = len(daily_cache)
        console.print(f"[dim]Loaded {loaded_daily} cached daily data files[/dim]")

    intraday_pkl = DATA_DIR / "intraday" / "all_intraday.pkl"
    if intraday_pkl.exists():
        with open(intraday_pkl, "rb") as f:
            intraday_cache = pickle.load(f)
        loaded_intraday = len(intraday_cache)
        console.print(f"[dim]Loaded {loaded_intraday} cached intraday data files[/dim]")

    symbols_to_fetch_daily = [s for s in SYMBOLS if s not in daily_cache]
    missing_pairs = []
    for day in trading_days:
        for s in SYMBOLS:
            if (s, day) not in intraday_cache:
                missing_pairs.append((s, day))

    console.print(f"\n[bold]Fetching daily data for {len(symbols_to_fetch_daily)} symbols...[/bold]")
    if symbols_to_fetch_daily:
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {
                executor.submit(fetch_daily_for_symbol, api, s, from_date, to_date): s
                for s in symbols_to_fetch_daily
            }
            with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), BarColumn(), TaskProgressColumn()) as progress:
                task = progress.add_task("Fetching...", total=len(futures))
                for future in as_completed(futures):
                    symbol = futures[future]
                    try:
                        sym, df = future.result()
                        if df is not None and not df.empty:
                            daily_cache[sym] = df
                            progress.update(task, advance=1, description=f"{sym} ({len(df)} days)")
                        else:
                            progress.update(task, advance=1, description=f"{sym} (empty)")
                    except Exception as e:
                        progress.update(task, advance=1, description=f"{sym} (error: {e})")
                    time.sleep(0.1)

        with open(daily_pkl, "wb") as f:
            pickle.dump(daily_cache, f)
        console.print(f"[green]Saved daily data: {len(daily_cache)} symbols[/green]")

    console.print(f"\n[bold]Fetching 1-min intraday data...[/bold]")
    console.print(f"[dim]Total symbol-day pairs to fetch: {len(missing_pairs)}[/dim]")

    fetched = 0
    errors = 0
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {}
        for s, day in missing_pairs:
            futures[executor.submit(fetch_intraday_for_symbol_day, api, s, day)] = (s, day)

        with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), BarColumn(), TaskProgressColumn()) as progress:
            task = progress.add_task("Fetching...", total=len(futures))
            for future in as_completed(futures):
                s, day = futures[future]
                try:
                    sym, d, df = future.result()
                    if df is not None and not df.empty:
                        intraday_cache[(sym, d)] = df
                        fetched += 1
                    errors += 0
                    progress.update(task, advance=1, description=f"{sym} {d} ({fetched} ok)")
                    if fetched % 50 == 0:
                        with open(intraday_pkl, "wb") as f:
                            pickle.dump(intraday_cache, f)
                except Exception as e:
                    errors += 1
                    progress.update(task, advance=1, description=f"{sym} {d} (err)")
                time.sleep(0.05)

    with open(intraday_pkl, "wb") as f:
        pickle.dump(intraday_cache, f)

    total_intraday = len(intraday_cache)
    console.print(Panel(
        f"[bold green]Fetch complete[/bold green]\n\n"
        f"Daily data: {len(daily_cache)} symbols ({loaded_daily} cached, {len(symbols_to_fetch_daily)} new)\n"
        f"Intraday data: {total_intraday} symbol-day pairs ({loaded_intraday} cached, {fetched} new, {errors} errors)\n"
        f"Trading days: {trading_days[0]} to {trading_days[-1]}",
        border_style="green",
    ))

    days_file = DATA_DIR / "trading_days.txt"
    with open(days_file, "w") as f:
        for d in trading_days:
            f.write(d + "\n")


if __name__ == "__main__":
    from rich.panel import Panel
    main()
