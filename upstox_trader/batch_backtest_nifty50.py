#!/usr/bin/env python3
"""
Batch Backtester for NIFTY 50 stocks using Upstox V3 API
Runs the support & resistance strategy on all NIFTY 50 stocks
and provides comprehensive performance analysis
"""

import time
import pandas as pd
from datetime import datetime, timedelta
import os
import sys
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from tqdm import tqdm
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.progress import Progress, TaskID, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config_and_utils.free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG
from backtest_upstox_strategy import StrategyBacktester, fetch_and_resample_data

console = Console()

# NIFTY 50 stocks (as of 2024)
NIFTY_50_STOCKS = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "ITC", 
    "SBIN", "BHARTIARTL", "KOTAKBANK", "ASIANPAINT", "LT", "AXISBANK", 
    "MARUTI", "SUNPHARMA", "ULTRACEMCO", "TITAN", "WIPRO", "NESTLEIND", 
    "POWERGRID", "NTPC", "TATAMOTORS", "HCLTECH", "ONGC", "BAJFINANCE", 
    "M&M", "TECHM", "COALINDIA", "TATASTEEL", "ADANIPORTS", "BAJAJFINSV", 
    "HINDALCO", "GRASIM", "BRITANNIA", "SHREECEM", "INDUSINDBK", "DRREDDY", 
    "EICHERMOT", "UPL", "CIPLA", "APOLLOHOSP", "DIVISLAB", "TATACONSUM", 
    "HEROMOTOCO", "ADANIENT", "BAJAJ-AUTO", "SBILIFE", "HDFCLIFE", 
    "JSWSTEEL", "LTIM"
]

def backtest_single_stock(symbol, timeframe, duration_days, api):
    """Backtest strategy for a single stock"""
    try:
        print(f"📊 Processing {symbol}...")
        
        # Fetch data
        historical_data = fetch_and_resample_data(api, symbol, timeframe, duration_days)
        
        if historical_data is None or historical_data.empty:
            return {
                'symbol': symbol,
                'status': 'FAILED',
                'error': 'No data available',
                'total_trades': 0,
                'win_rate': 0,
                'total_pnl': 0,
                'avg_pnl': 0,
                'data_points': 0
            }
        
        # Run backtest
        backtester = StrategyBacktester(historical_data, symbol=symbol)
        
        # Capture backtest results by running without printing
        import io
        import contextlib
        
        f = io.StringIO()
        with contextlib.redirect_stdout(f):
            backtester.run_backtest()
        
        # Calculate metrics
        total_trades = len(backtester.trades)
        if total_trades == 0:
            win_rate = 0
            avg_pnl = 0
        else:
            winning_trades = sum(1 for t in backtester.trades if t['pnl'] > 0)
            win_rate = (winning_trades / total_trades) * 100
            avg_pnl = backtester.total_pnl_pct / total_trades
        
        return {
            'symbol': symbol,
            'status': 'SUCCESS',
            'total_trades': total_trades,
            'winning_trades': sum(1 for t in backtester.trades if t['pnl'] > 0),
            'losing_trades': total_trades - sum(1 for t in backtester.trades if t['pnl'] > 0),
            'win_rate': win_rate,
            'total_pnl': backtester.total_pnl_pct,
            'avg_pnl': avg_pnl,
            'data_points': len(historical_data),
            'date_range': f"{historical_data.index[0].strftime('%Y-%m-%d')} to {historical_data.index[-1].strftime('%Y-%m-%d')}",
            'trades': backtester.trades
        }
        
    except Exception as e:
        return {
            'symbol': symbol,
            'status': 'ERROR',
            'error': str(e),
            'total_trades': 0,
            'win_rate': 0,
            'total_pnl': 0,
            'avg_pnl': 0,
            'data_points': 0
        }

def run_batch_backtest(timeframe="15min", duration_days=100, max_workers=3):
    """Run backtest on all NIFTY 50 stocks"""
    console.print(Panel.fit("🚀 NIFTY 50 BATCH BACKTESTER", style="bold blue"))
    console.print(f"[cyan]Timeframe: {timeframe} | Duration: {duration_days} days | Workers: {max_workers}[/cyan]")
    
    # Initialize API
    api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
    
    results = []
    failed_stocks = []
    
    start_time = time.time()
    
    # Use rich progress bar for better visualization
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TimeElapsedColumn(),
        console=console
    ) as progress:
        
        task = progress.add_task("Processing NIFTY 50 stocks...", total=len(NIFTY_50_STOCKS))
        
        # Process stocks with limited concurrency
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all jobs
            future_to_symbol = {
                executor.submit(backtest_single_stock, symbol, timeframe, duration_days, api): symbol 
                for symbol in NIFTY_50_STOCKS
            }
            
            # Collect results as they complete
            for future in as_completed(future_to_symbol):
                symbol = future_to_symbol[future]
                try:
                    result = future.result()
                    results.append(result)
                    
                    if result['status'] == 'SUCCESS':
                        status_msg = f"✅ {symbol}: {result['total_trades']} trades, {result['win_rate']:.1f}% win rate"
                    else:
                        status_msg = f"❌ {symbol}: {result.get('error', 'Failed')}"
                        failed_stocks.append(symbol)
                    
                    progress.update(task, advance=1, description=status_msg)
                    
                except Exception as exc:
                    progress.update(task, advance=1, description=f"❌ {symbol}: Exception: {exc}")
                    failed_stocks.append(symbol)
    
    end_time = time.time()
    
    # Generate comprehensive report
    generate_rich_report(results, failed_stocks, timeframe, duration_days, end_time - start_time)
    
    return results

def generate_rich_report(results, failed_stocks, timeframe, duration_days, execution_time):
    """Generate comprehensive performance report using rich tables"""
    console.print(Panel.fit("📊 COMPREHENSIVE PERFORMANCE REPORT", style="bold blue"))
    
    # Filter successful results
    successful_results = [r for r in results if r['status'] == 'SUCCESS' and r['total_trades'] > 0]
    
    if not successful_results:
        console.print("[red]No successful backtests with trades. Cannot generate meaningful report.[/red]")
        return
    
    # Overall statistics
    total_stocks_processed = len(results)
    successful_stocks = len([r for r in results if r['status'] == 'SUCCESS'])
    stocks_with_trades = len(successful_results)
    
    # Performance metrics
    total_trades_all = sum(r['total_trades'] for r in successful_results)
    total_pnl_all = sum(r['total_pnl'] for r in successful_results)
    avg_win_rate = sum(r['win_rate'] for r in successful_results) / len(successful_results)
    
    # Summary panel
    summary_text = f"""[cyan]📈 EXECUTION SUMMARY[/cyan]
• Execution Time: {execution_time:.1f} seconds
• Stocks Processed: {total_stocks_processed}
• Successful: {successful_stocks}
• With Trades: {stocks_with_trades}
• Failed: {len(failed_stocks)}

[cyan]📊 AGGREGATE PERFORMANCE[/cyan]
• Total Trades Executed: {total_trades_all:,}
• Combined P&L: {total_pnl_all:.2f}%
• Average Win Rate: {avg_win_rate:.2f}%
• Average P&L per Stock: {total_pnl_all/len(successful_results):.2f}%"""
    
    console.print(Panel(summary_text, title="📊 Performance Summary", style="cyan"))
    
    # Sort results for tables
    successful_results_by_pnl = sorted(successful_results, key=lambda x: x['total_pnl'], reverse=True)
    successful_results_by_winrate = sorted(successful_results, key=lambda x: x['win_rate'], reverse=True)
    
    # Create performance table sorted by P&L
    display_performance_table(successful_results_by_pnl, "🏆 PERFORMANCE LEADERBOARD (by Total P&L)", sort_by="pnl")
    
    console.print()
    
    # Create performance table sorted by Win Rate
    display_performance_table(successful_results_by_winrate, "🎯 WIN RATE LEADERBOARD (by Win Rate)", sort_by="winrate")
    
    # Performance distribution
    profitable_stocks = len([r for r in successful_results if r['total_pnl'] > 0])
    unprofitable_stocks = len([r for r in successful_results if r['total_pnl'] < 0])
    
    # Win rate distribution
    high_win_rate = len([r for r in successful_results if r['win_rate'] >= 50])
    medium_win_rate = len([r for r in successful_results if 30 <= r['win_rate'] < 50])
    low_win_rate = len([r for r in successful_results if r['win_rate'] < 30])
    
    distribution_text = f"""[green]📊 PERFORMANCE DISTRIBUTION[/green]
• Profitable Stocks: {profitable_stocks} ({profitable_stocks/len(successful_results)*100:.1f}%)
• Unprofitable Stocks: {unprofitable_stocks} ({unprofitable_stocks/len(successful_results)*100:.1f}%)

[yellow]🎯 WIN RATE DISTRIBUTION[/yellow]
• High (≥50%): {high_win_rate} stocks
• Medium (30-49%): {medium_win_rate} stocks
• Low (<30%): {low_win_rate} stocks"""
    
    console.print(Panel(distribution_text, title="📈 Distribution Analysis", style="green"))
    
    if failed_stocks:
        failed_text = f"[red]❌ FAILED STOCKS ({len(failed_stocks)})[/red]\n" + ", ".join(failed_stocks)
        console.print(Panel(failed_text, title="⚠️ Failed Stocks", style="red"))
    
    # Save detailed results to JSON
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"nifty50_backtest_results_{timestamp}.json"
    
    with open(filename, 'w') as f:
        json.dump({
            'metadata': {
                'timeframe': timeframe,
                'duration_days': duration_days,
                'execution_time': execution_time,
                'timestamp': timestamp
            },
            'summary': {
                'total_stocks': total_stocks_processed,
                'successful_stocks': successful_stocks,
                'stocks_with_trades': stocks_with_trades,
                'failed_stocks': len(failed_stocks),
                'total_trades': total_trades_all,
                'combined_pnl': total_pnl_all,
                'avg_win_rate': avg_win_rate
            },
            'results': results,
            'failed_stocks': failed_stocks
        }, f, indent=2)
    
    console.print(f"\n[green]💾 Detailed results saved to: {filename}[/green]")
    console.print("[blue]🎉 Batch backtest completed successfully![/blue]")

def display_performance_table(results, title, sort_by="pnl", max_rows=20):
    """Display performance results in a rich table"""
    table = Table(title=title, show_header=True, header_style="bold magenta")
    
    table.add_column("Rank", style="dim", width=4, justify="right")
    table.add_column("Symbol", style="cyan", width=10)
    table.add_column("Trades", justify="right", style="blue", width=6)
    table.add_column("Win Rate", justify="right", style="green", width=8)
    table.add_column("Total P&L", justify="right", style="magenta", width=10)
    table.add_column("Avg P&L", justify="right", style="yellow", width=8)
    table.add_column("W/L", justify="right", style="cyan", width=6)
    table.add_column("Data Points", justify="right", style="dim", width=10)
    
    for i, result in enumerate(results[:max_rows], 1):
        # Color coding for P&L
        pnl_color = "green" if result['total_pnl'] > 0 else "red"
        win_rate_color = "green" if result['win_rate'] >= 50 else "yellow" if result['win_rate'] >= 30 else "red"
        
        # Format values
        win_rate_str = f"{result['win_rate']:.1f}%"
        total_pnl_str = f"{result['total_pnl']:+.2f}%"
        avg_pnl_str = f"{result['avg_pnl']:+.2f}%"
        wl_ratio = f"{result['winning_trades']}/{result['losing_trades']}"
        
        table.add_row(
            str(i),
            result['symbol'],
            str(result['total_trades']),
            f"[{win_rate_color}]{win_rate_str}[/{win_rate_color}]",
            f"[{pnl_color}]{total_pnl_str}[/{pnl_color}]",
            f"[{pnl_color}]{avg_pnl_str}[/{pnl_color}]",
            wl_ratio,
            f"{result['data_points']:,}"
        )
    
    console.print(table)
    console.print(f"[dim]Showing top {min(len(results), max_rows)} of {len(results)} stocks with trades[/dim]")

def main():
    parser = argparse.ArgumentParser(description="NIFTY 50 Batch Backtester")
    parser.add_argument("--timeframe", type=str, default="15min", 
                       help="Candlestick timeframe (e.g., '5min', '15min', '1H')")
    parser.add_argument("--duration", type=int, default=100, 
                       help="Duration in days to backtest")
    parser.add_argument("--workers", type=int, default=3, 
                       help="Number of concurrent workers (be nice to API)")
    
    args = parser.parse_args()
    
    run_batch_backtest(
        timeframe=args.timeframe,
        duration_days=args.duration,
        max_workers=args.workers
    )

if __name__ == "__main__":
    main()
