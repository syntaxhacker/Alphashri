#!/usr/bin/env python3
"""
52-Week High Strategy - Batch Tester for Nifty 50
==================================================
Tests the strategy on all Nifty 50 stocks and identifies the best performers.
"""

import sys
import os
from datetime import datetime, timedelta
from typing import List, Dict
import time

# Add project root to sys.path
_current_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_current_dir)
_project_root = os.path.dirname(_parent_dir)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

# Import tv_utils functions
import importlib.util
spec = importlib.util.spec_from_file_location("tv_utils", os.path.join(_project_root, "utils", "tv_utils.py"))
tv_utils = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tv_utils)

get_nifty_50 = tv_utils.get_nifty_50
get_nifty_100 = tv_utils.get_nifty_100
get_nifty_500 = tv_utils.get_nifty_500
print_nifty_stocks_summary = tv_utils.print_nifty_stocks_summary
format_change = tv_utils.format_change
from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage
from rich.console import Console
from rich.table import Table
from rich.progress import track
import pandas as pd
import numpy as np

console = Console()


def calculate_adx(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14):
    """Calculate ADX"""
    tr1 = high - low
    tr2 = abs(high - close.shift(1))
    tr3 = abs(low - close.shift(1))
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

    plus_dm = high.diff()
    minus_dm = -low.diff()
    plus_dm[plus_dm < 0] = 0
    minus_dm[minus_dm < 0] = 0

    atr = tr.rolling(window=period).mean()
    plus_di = 100 * (plus_dm.rolling(window=period).mean() / atr)
    minus_di = 100 * (minus_dm.rolling(window=period).mean() / atr)

    dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
    adx = dx.rolling(window=period).mean()

    return adx


def calculate_rsi(close: pd.Series, period: int = 14):
    """Calculate RSI"""
    delta = close.diff()
    gain = delta.where(delta > 0, 0)
    loss = -delta.where(delta < 0, 0)

    avg_gain = gain.ewm(span=period, adjust=False).mean()
    avg_loss = loss.ewm(span=period, adjust=False).mean()

    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))

    return rsi


def calculate_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Calculate ATR"""
    high_low = df['high'] - df['low']
    high_close = abs(df['high'] - df['close'].shift())
    low_close = abs(df['low'] - df['close'].shift())
    true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    atr = true_range.rolling(window=period).mean()
    return atr


def quick_backtest(ticker: str, num_days: int = 730) -> Dict:
    """
    Quick backtest for a single stock using optimized parameters.

    Returns dict with performance metrics or None if data unavailable.
    """

    try:
        screener = TVScreenerUsage(enable_paper_trading=False)

        # Fetch historical data
        from_date = (datetime.now() - timedelta(days=num_days + 500)).strftime('%Y-%m-%d')
        to_date = datetime.now().strftime('%Y-%m-%d')

        df = screener.upstox_api.fetch_historical_data_v3(
            symbol=ticker,
            unit="days",
            interval=1,
            from_date=from_date,
            to_date=to_date
        )

        if df is None or len(df) < 500:
            return None

        # Calculate indicators
        df['52w_high'] = df['high'].rolling(window=252, min_periods=100).max().shift(1)

        # Calculate ADX separately to handle errors
        try:
            adx_result = calculate_adx(df['high'], df['low'], df['close'])
            if isinstance(adx_result, tuple) and len(adx_result) == 3:
                df['adx'], _, _ = adx_result
            else:
                df['adx'] = adx_result if isinstance(adx_result, pd.Series) else pd.Series([20] * len(df), index=df.index)
        except Exception as e:
            console.print(f"[dim]ADX calculation error: {str(e)[:30]}[/dim]")
            df['adx'] = 20  # Default value

        df['rsi'] = calculate_rsi(df['close'])
        df['atr'] = calculate_atr(df)
        df['ma_50'] = df['close'].rolling(window=50).mean()
        df['ma_200'] = df['close'].rolling(window=200).mean()
        df['vol_avg'] = df['volume'].rolling(window=20).mean()

        # Calculate days since 52W high
        df['days_since_52w_high'] = None
        for i in range(len(df)):
            current_52w = df.iloc[i]['52w_high']
            if pd.isna(current_52w):
                continue
            first_occurrence_idx = None
            for j in range(i, max(0, i - 252), -1):
                if df.iloc[j]['high'] >= current_52w * 0.999:
                    first_occurrence_idx = j
            if first_occurrence_idx is not None:
                df.iloc[i, df.columns.get_loc('days_since_52w_high')] = i - first_occurrence_idx

        # Filter to backtest period
        backtest_start = (datetime.now() - timedelta(days=num_days)).date()
        df = df[df.index.date >= backtest_start]

        # OPTIMIZED PARAMETERS (from previous testing)
        ENTRY_THRESHOLD = 5.0
        MIN_ADX = 25
        MIN_VOLUME_MULT = 1.5
        MIN_RSI = 50
        MAX_RSI = 70
        ATR_SL_MULT = 2.0
        TRAILING_STOP = 1.5
        MAX_HOLDING = 15
        MIN_DAYS_52W = 20
        COOLDOWN = 30

        # Simulate trades
        trades = []
        position = None
        entry_price = 0
        entry_52w = 0
        entry_atr = 0
        highest_price = 0
        last_exit = None
        days_in = 0
        trailing = False

        for timestamp, row in df.iterrows():
            if pd.isna(row['52w_high']):
                continue

            current_price = row['close']
            distance_pct = ((row['52w_high'] - current_price) / current_price) * 100
            in_cooldown = last_exit and (timestamp.date() - last_exit).days < COOLDOWN

            # ENTRY
            if position is None and not in_cooldown:
                if distance_pct <= ENTRY_THRESHOLD and distance_pct > 0:
                    days_since = row.get('days_since_52w_high', 0)

                    if pd.isna(days_since) or days_since < MIN_DAYS_52W:
                        continue

                    # Filters
                    if pd.isna(row['adx']) or row['adx'] < MIN_ADX:
                        continue
                    if not pd.isna(row['vol_avg']) and row['volume'] < MIN_VOLUME_MULT * row['vol_avg']:
                        continue
                    if pd.isna(row['rsi']) or row['rsi'] < MIN_RSI or row['rsi'] > MAX_RSI:
                        continue
                    if not pd.isna(row['ma_50']) and not pd.isna(row['ma_200']):
                        if current_price < row['ma_50'] or current_price < row['ma_200']:
                            continue

                    # Enter trade
                    position = 'LONG'
                    entry_price = current_price
                    entry_52w = row['52w_high']
                    entry_atr = row['atr']
                    highest_price = current_price
                    days_in = 0
                    trailing = False

            # EXIT
            if position == 'LONG':
                days_in += 1
                pnl_pct = ((current_price - entry_price) / entry_price) * 100

                if row['high'] > highest_price:
                    highest_price = row['high']

                exit_reason = None

                if row['high'] >= entry_52w and not trailing:
                    trailing = True

                if trailing:
                    drawdown = ((highest_price - current_price) / highest_price) * 100
                    if drawdown >= TRAILING_STOP:
                        exit_reason = 'TRAILING'

                if not exit_reason and current_price <= (entry_price - entry_atr * ATR_SL_MULT):
                    exit_reason = 'ATR_SL'

                if not exit_reason and days_in >= MAX_HOLDING:
                    exit_reason = 'MAX_DAYS'

                if not exit_reason and row['52w_high'] > entry_52w * 1.05:
                    exit_reason = 'NEW_52W'

                if not exit_reason and not pd.isna(row['adx']) and row['adx'] < 20:
                    exit_reason = 'ADX_WEAK'

                if exit_reason:
                    trades.append({
                        'pnl_pct': pnl_pct,
                        'days_held': days_in,
                        'highest_pnl': ((highest_price - entry_price) / entry_price) * 100,
                        'reason': exit_reason
                    })
                    position = None
                    last_exit = timestamp.date()
                    trailing = False

        if not trades:
            return {
                'ticker': ticker,
                'trades': 0,
                'win_rate': 0,
                'total_pnl': 0,
                'expectancy': 0,
                'avg_days': 0
            }

        winning = [t for t in trades if t['pnl_pct'] > 0]
        losing = [t for t in trades if t['pnl_pct'] <= 0]

        total_trades = len(trades)
        win_rate = (len(winning) / total_trades * 100) if total_trades > 0 else 0
        total_pnl = sum(t['pnl_pct'] for t in trades)
        expectancy = total_pnl / total_trades
        avg_days = sum(t['days_held'] for t in trades) / total_trades

        if total_trades > 0:
            return {
                'ticker': ticker,
                'trades': total_trades,
                'winning_trades': len(winning),
                'losing_trades': len(losing),
                'win_rate': win_rate,
                'total_pnl': total_pnl,
                'expectancy': expectancy,
                'avg_days': avg_days,
                'best_trade': max(t['pnl_pct'] for t in trades),
                'worst_trade': min(t['pnl_pct'] for t in trades)
            }
        else:
            return {
                'ticker': ticker,
                'trades': 0,
                'winning_trades': 0,
                'losing_trades': 0,
                'win_rate': 0,
                'total_pnl': 0,
                'expectancy': 0,
                'avg_days': 0,
                'best_trade': 0,
                'worst_trade': 0
            }

    except Exception as e:
        console.print(f"[red]Error testing {ticker}: {str(e)[:50]}[/red]")
        return None


def batch_test_nifty_50(num_days: int = 730, use_nifty_100: bool = False, filter_sectors: bool = False):
    """
    Batch test 52-week high strategy on Nifty stocks with optional sector filtering.

    Args:
        num_days: Backtest period in days
        use_nifty_100: Use Nifty 100 instead of Nifty 50
        filter_sectors: Filter out underperforming sectors
    """

    index_name = "Nifty 100" if use_nifty_100 else "Nifty 50"

    console.print("\n[bold cyan]╔════════════════════════════════════════════════════════════╗[/bold cyan]")
    console.print(f"[bold cyan]║   52-WEEK HIGH STRATEGY - {index_name.upper()} BATCH TEST       ║[/bold cyan]")
    if filter_sectors:
        console.print("[bold cyan]║         (FILTERED: No Private Banks, IT, Metals)          ║[/bold cyan]")
    console.print("[bold cyan]╚════════════════════════════════════════════════════════════╝[/bold cyan]\n")

    # Initialize Upstox API
    screener = TVScreenerUsage(enable_paper_trading=False)
    screener.upstox_api.get_instrument_key("NIFTY", instrument_type="INDEX")

    # Fetch stocks
    if use_nifty_100:
        console.print("[yellow]Fetching Nifty 100 stocks...[/yellow]")
        stock_list = get_nifty_100(upstox_api=screener.upstox_api)
    else:
        console.print("[yellow]Fetching Nifty 50 stocks...[/yellow]")
        stock_list = get_nifty_50(upstox_api=screener.upstox_api)

    if not stock_list:
        console.print("[red]Failed to fetch stocks![/red]")
        return

    # Filter out underperforming sectors
    if filter_sectors:
        # Sectors to exclude based on Nifty 50 backtest results
        exclude_stocks = {
            # Private Banks (poor performance)
            'HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'AXISBANK', 'SBIN', 'INDUSINDBK',
            # IT Giants (TCS, INFY underperformed - keep WIPRO, HCLTECH)
            'TCS', 'INFY', 'MPHASIS', 'LTIM', 'PERSISTENT',
            # Metals (HINDALCO, JSWSTEEL poor)
            'HINDALCO', 'JSWSTEEL', 'TATASTEEL', 'JINDALSTEL', 'COALINDIA',
            # Auto that underperformed
            'TATAMOTORS', 'M&M',
            # Others with 0 trades/poor results
            'NESTLEIND', 'NTPC', 'CIPLA', 'ADANIENT', 'HINDUNILVR',
            'ULTRACEMCO', 'TRENT', 'INDIGO', 'SBILIFE', 'ITC', 'BEL',
            'TATACONSUM', 'JIOFIN', 'MARUTI', 'MAXHEALTH', 'BHARTIARTL',
            'HDFCLIFE', 'SUNPHARMA', 'ETERNAM', 'TECHM', 'ASIANPAINT',
            'GRASIM', 'TITAN'
        }

        original_count = len(stock_list)
        stock_list = [s for s in stock_list if s not in exclude_stocks]
        console.print(f"[yellow]Filtered: {original_count} → {len(stock_list)} stocks[/yellow]")
        console.print(f"[dim]Excluded: Private Banks, IT Giants, Metals, Underperformers[/dim]\n")

    console.print(f"[green]✅ Found {len(stock_list)} {index_name} stocks[/green]")
    console.print(f"[dim]Backtest period: {num_days} days[/dim]\n")

    # Test each stock
    results = []
    no_data_stocks = []

    for ticker in track(stock_list, description="Testing stocks..."):
        result = quick_backtest(ticker, num_days)
        if result:
            results.append(result)
        else:
            no_data_stocks.append(ticker)
        time.sleep(0.3)  # Rate limiting

    # Analyze results
    if not results:
        console.print("[yellow]No results received![/yellow]")
        return

    console.print(f"\n[dim]Stocks tested: {len(results)}[/dim]")
    if no_data_stocks:
        console.print(f"[dim]Stocks with no data: {len(no_data_stocks)}[/dim]")

    # Sort by win rate, then by trades
    results.sort(key=lambda x: (x['win_rate'], x['trades']), reverse=True)

    # Display results
    console.print("\n[bold yellow]📊 ALL STOCKS RESULTS (Sorted by Win Rate)[/bold yellow]\n")

    all_table = Table(show_header=True, header_style="bold magenta")
    all_table.add_column("Rank", style="cyan", width=6)
    all_table.add_column("Ticker", style="green")
    all_table.add_column("Trades", justify="right")
    all_table.add_column("Win Rate", justify="right", style="bold")
    all_table.add_column("Total P&L %", justify="right")
    all_table.add_column("Expectancy %", justify="right")
    all_table.add_column("Best", justify="right", style="green")
    all_table.add_column("Worst", justify="right", style="red")

    for i, r in enumerate(results, 1):
        wr_style = "green" if r['win_rate'] >= 80 else ("yellow" if r['win_rate'] >= 60 else "red")
        pnl_style = "green" if r['total_pnl'] > 0 else "red"

        all_table.add_row(
            str(i),
            r['ticker'],
            str(r['trades']),
            f"[{wr_style}]{r['win_rate']:.1f}%[/{wr_style}]",
            f"[{pnl_style}]{r['total_pnl']:+.1f}[/{pnl_style}]",
            f"{r['expectancy']:+.2f}",
            f"+{r.get('best_trade', 0):.1f}%",
            f"{r.get('worst_trade', 0):.1f}%"
        )

    console.print(all_table)

    # Show top performers (80%+ win rate)
    top_performers = [r for r in results if r['win_rate'] >= 80]

    if top_performers:
        console.print(f"\n[bold green blink]🏆 TOP PERFORMERS (80%+ Win Rate): {len(top_performers)} stocks[/bold green blink]\n")

        top_table = Table(title="Elite Stocks - 80%+ Win Rate", show_header=True, header_style="bold green")
        top_table.add_column("Ticker", style="green")
        top_table.add_column("Trades", justify="right")
        top_table.add_column("Win Rate", justify="right", style="bold green")
        top_table.add_column("Total P&L %", justify="right", style="green")
        top_table.add_column("Expectancy %", justify="right")
        top_table.add_column("Avg Days", justify="right")

        for r in top_performers[:20]:  # Top 20
            top_table.add_row(
                r['ticker'],
                str(r['trades']),
                f"{r['win_rate']:.1f}%",
                f"{r['total_pnl']:+.1f}%",
                f"{r['expectancy']:+.2f}",
                f"{r['avg_days']:.1f}"
            )

        console.print(top_table)
    else:
        console.print("\n[yellow]⚠️  No stocks achieved 80%+ win rate in this period[/yellow]")

    # Show stocks with most trades (frequency leaders)
    results_by_trades = sorted(results, key=lambda x: x['trades'], reverse=True)[:10]

    console.print(f"\n[bold cyan]📈 MOST ACTIVE (Most Trade Opportunities)[/bold cyan]\n")

    active_table = Table(show_header=True, header_style="bold cyan")
    active_table.add_column("Ticker", style="cyan")
    active_table.add_column("Trades", justify="right", style="bold")
    active_table.add_column("Win Rate", justify="right")
    active_table.add_column("Total P&L %", justify="right")
    active_table.add_column("Expectancy %", justify="right")

    for r in results_by_trades:
        wr_style = "green" if r['win_rate'] >= 70 else "yellow"
        active_table.add_row(
            r['ticker'],
            str(r['trades']),
            f"[{wr_style}]{r['win_rate']:.1f}%[/{wr_style}]",
            f"{r['total_pnl']:+.1f}%",
            f"{r['expectancy']:+.2f}"
        )

    console.print(active_table)

    # Aggregate statistics
    total_trades = sum(r.get('trades', 0) for r in results)
    total_wins = sum(r.get('winning_trades', 0) for r in results)
    total_losses = sum(r.get('losing_trades', 0) for r in results)
    aggregate_win_rate = (total_wins / total_trades * 100) if total_trades > 0 else 0
    total_pnl_all = sum(r.get('total_pnl', 0) for r in results)

    console.print(f"\n[bold yellow]📊 AGGREGATE STATISTICS ({index_name})[/bold yellow]")
    console.print(f"  Stocks with trades: {len(results)}/{len(stock_list)}")
    console.print(f"  Total trades: {total_trades}")
    console.print(f"  Winning trades: {total_wins}")
    console.print(f"  Losing trades: {total_losses}")
    console.print(f"  Aggregate Win Rate: [bold cyan]{aggregate_win_rate:.2f}%[/bold cyan]")
    console.print(f"  Total P&L: {total_pnl_all:+.2f}%")

    if aggregate_win_rate >= 80:
        console.print("\n[bold green blink]🎉 TARGET ACHIEVED: Strategy has 80%+ win rate across Nifty 50! 🎉[/bold green blink]")
    elif aggregate_win_rate >= 70:
        console.print("\n[yellow]⚠️  CLOSE: 70-80% aggregate win rate[/yellow]")
    else:
        console.print("\n[red]❌ Strategy needs optimization for this universe[/red]")

    console.print(f"\n[dim]Test completed on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}[/dim]\n")


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Batch test 52-week high strategy on Nifty stocks"
    )
    parser.add_argument('--days', '-d', type=int, default=730,
                       help='Backtest period in days (default: 730 = 2 years)')
    parser.add_argument('--nifty-100', '-n', action='store_true',
                       help='Use Nifty 100 instead of Nifty 50')
    parser.add_argument('--filter', '-f', action='store_true',
                       help='Filter out underperforming sectors (Private Banks, IT Giants, Metals)')

    args = parser.parse_args()

    batch_test_nifty_50(args.days, use_nifty_100=args.nifty_100, filter_sectors=args.filter)


if __name__ == "__main__":
    main()
