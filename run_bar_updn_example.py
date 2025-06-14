
#!/usr/bin/env python3
"""
Example usage of the BarUpDn Extreme Backtester (Binance Only)
"""

from bar_updn_extreme_backtest import run_extreme_backtest, BarUpDnBacktester, DataFetcher
from datetime import datetime, timedelta
from rich.console import Console

console = Console()

# Replace with your actual Binance API keys
BINANCE_API_KEY = "your_binance_api_key"
BINANCE_API_SECRET = "your_binance_api_secret"


def example_multi_symbol_backtest():
    """Run backtest on multiple symbols using Binance API"""
    console.print("[bold green]Running Multi-Symbol BarUpDn Backtest[/bold green]")

    symbols = ["BTCUSDT", "ETHUSDT"]
    results = {}

    for symbol in symbols:
        console.print(f"\n[yellow]Testing {symbol}...[/yellow]")
        result = run_extreme_backtest(
            symbol=symbol,
            days_back=7,
            api_key=BINANCE_API_KEY,
            api_secret=BINANCE_API_SECRET,
            save_results_flag=True
        )
        if result:
            results[symbol] = result

    if results:
        console.print("\n[bold cyan]Performance Comparison:[/bold cyan]")
        for symbol, result in results.items():
            console.print(f"{symbol}: {result.total_return_percent:.2f}% return, {result.win_rate:.1f}% win rate")

    return results

def example_custom_parameters():
    """Run backtest with custom strategy parameters using Binance API"""
    console.print("[bold green]Running Custom Parameters BarUpDn Backtest[/bold green]")

    from bar_updn_extreme_backtest import BarUpDnStrategy

    custom_strategy = BarUpDnStrategy(
        sl_percent=2.0,
        trailing_stop_points=30.0,
        position_size_percent=15.0,
        max_intraday_loss_percent=1.5
    )

    backtester = BarUpDnBacktester(initial_capital=10000)
    backtester.strategy = custom_strategy

    # Initialize DataFetcher with Binance API keys
    fetcher = DataFetcher(api_key=BINANCE_API_KEY, api_secret=BINANCE_API_SECRET)
    end_date = datetime.now()
    start_date = end_date - timedelta(days=7)

    try:
        df = fetcher.fetch_data("BTCUSDT", start_date, end_date)
        result = backtester.run_backtest(df, "BTCUSDT")

        console.print(f"[green]Custom Parameters Result:[/green]")
        console.print(f"Return: {result.total_return_percent:.2f}%")
        console.print(f"Win Rate: {result.win_rate:.1f}%")
        console.print(f"Total Trades: {result.total_trades}")

        return result

    except Exception as e:
        console.print(f"[red]Error: {str(e)}[/red]")
        return None

if __name__ == "__main__":
    console.print("[bold blue]BarUpDn Strategy Backtesting Examples (Binance Only)[/bold blue]\n")

    console.print("1. Multi-symbol backtest...")
    multi_results = example_multi_symbol_backtest()

    console.print("\n" + "="*50 + "\n")

    console.print("2. Custom parameters...")
    custom_result = example_custom_parameters()
    console.print("\n[bold green]All examples completed![/bold green]")

    if multi_results:
        best_symbol = max(multi_results, key=lambda x: multi_results[x].total_return_percent)
        console.print(f"Best performing symbol: {best_symbol} ({multi_results[best_symbol].total_return_percent:.2f}%)")