#!/usr/bin/env python3
"""
Run 52-Week High Chaser Backtest using NautilusTrader

This script demonstrates how to run a backtest for the 52-week high chaser strategy
using NautilusTrader's BacktestEngine.

Prerequisites:
    pip install nautilus_trader pandas rich

Usage:
    python run_nautilus_52w_backtest.py
"""

import sys
import os
from datetime import datetime, timedelta
from decimal import Decimal

import pandas as pd
from rich.console import Console
from rich.table import Table

from nautilus_trader.backtest.config import BacktestEngineConfig
from nautilus_trader.backtest.engine import BacktestEngine
from nautilus_trader.model import BarType, InstrumentId, Money, Symbol, TraderId, Venue
from nautilus_trader.model.currencies import INR
from nautilus_trader.model.enums import AccountType, OmsType
from nautilus_trader.model.instruments import Equity
from nautilus_trader.model.objects import Price, Quantity
from nautilus_trader.persistence.wranglers import BarDataWrangler

# Import our custom strategy
from nautilus_52week_high_chaser import FiftyTwoWeekHighChaser, FiftyTwoWeekHighChaserConfig

# Add project root for Upstox API access
_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_screeners_dir = _current_file_dir
_upstox_trader_dir = os.path.dirname(_screeners_dir)
_project_root_dir = os.path.dirname(_upstox_trader_dir)

if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)

from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage

console = Console(width=200)  # Wider console for full table display


def create_equity_instrument(symbol: str, instrument_id: InstrumentId) -> Equity:
    """Create an Equity instrument for Indian stocks."""
    return Equity(
        instrument_id=instrument_id,
        raw_symbol=Symbol(symbol),
        currency=INR,
        price_precision=2,
        price_increment=Price.from_str("0.01"),
        lot_size=Quantity.from_str("1"),
        ts_event=0,
        ts_init=0,
        isin=None,  # Would need actual ISIN
    )


def load_historical_data_from_csv(csv_path: str, instrument: Equity) -> list:
    """
    Load historical data from a CSV file and convert to Nautilus Bar objects.

    Expected CSV format:
        timestamp, open, high, low, close, volume

    Args:
        csv_path: Path to the CSV file
        instrument: The instrument the data is for

    Returns:
        List of Bar objects
    """
    df = pd.read_csv(csv_path, parse_dates=["timestamp"])
    df = df.set_index("timestamp")

    bar_type = BarType.from_str(f"{instrument.id}-1-DAY-LAST-EXTERNAL")
    wrangler = BarDataWrangler(bar_type=bar_type, instrument=instrument)
    bars = wrangler.process(df)

    return bars


def fetch_data_from_upstox(symbol: str, num_days: int, instrument: Equity) -> list:
    """
    Fetch historical data from Upstox API and convert to Nautilus Bar objects.

    Args:
        symbol: The stock symbol (e.g., "RELIANCE")
        num_days: Number of days of backtest data needed
        instrument: The Nautilus instrument for the data

    Returns:
        List of Bar objects
    """
    print(f"\nFetching {symbol} data from Upstox API...")

    # Calculate date range (need extra days for 52-week high calculation)
    today = datetime.now()
    to_date = today.strftime('%Y-%m-%d')
    from_date = (today - timedelta(days=num_days + 400)).strftime('%Y-%m-%d')  # Extra 400 days for 52w high

    print(f"Date range: {from_date} to {to_date}")

    # Initialize Upstox API
    screener = TVScreenerUsage(enable_paper_trading=False)

    # Ensure instrument data is loaded
    screener.upstox_api.get_instrument_key("NIFTY", instrument_type="INDEX")

    # Fetch historical daily data
    historical_df = screener.upstox_api.fetch_historical_data_v3(
        symbol=symbol,
        unit="days",
        interval=1,
        from_date=from_date,
        to_date=to_date
    )

    if historical_df is None or historical_df.empty:
        raise ValueError(f"Could not fetch data for {symbol}")

    print(f"Fetched {len(historical_df)} daily candles")

    # Prepare DataFrame for Nautilus (needs columns: open, high, low, close, volume)
    # Keep only the required columns
    df = historical_df[['open', 'high', 'low', 'close', 'volume']].copy()

    # Ensure the index is a proper DatetimeIndex with UTC timezone
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index)

    # Convert to UTC if not already timezone-aware
    if df.index.tz is None:
        df.index = df.index.tz_localize('UTC')
    else:
        df.index = df.index.tz_convert('UTC')

    # Convert to Nautilus bars
    bar_type = BarType.from_str(f"{instrument.id}-1-DAY-LAST-EXTERNAL")
    wrangler = BarDataWrangler(bar_type=bar_type, instrument=instrument)
    bars = wrangler.process(df)

    return bars




def run_backtest_with_csv_data(csv_path: str, symbol: str):
    """
    Run a backtest using historical data from a CSV file.

    Args:
        csv_path: Path to the CSV file with historical data
        symbol: The symbol/ticker being backtested

    Expected CSV format:
        timestamp, open, high, low, close, volume
    """
    print("=" * 80)
    print(f"52-Week High Chaser Backtest for {symbol}")
    print("=" * 80)

    # Configuration
    venue = Venue("SIMULATED")
    instrument_id = InstrumentId.from_str(f"{symbol}.{venue}")

    # Create instrument
    instrument = create_equity_instrument(symbol, instrument_id)

    # Load data from CSV
    print(f"\nLoading data from {csv_path}...")
    bars = load_historical_data_from_csv(csv_path, instrument)
    print(f"Loaded {len(bars)} daily bars")

    # Configure backtest engine
    config = BacktestEngineConfig(
        trader_id=TraderId("BACKTESTER-001"),
    )

    # Build the backtest engine
    engine = BacktestEngine(config=config)

    # Add a trading venue
    engine.add_venue(
        venue=venue,
        oms_type=OmsType.NETTING,
        account_type=AccountType.CASH,
        base_currency=INR,
        starting_balances=[Money(1_000_000.0, INR)],  # Rs. 10 lakh
    )

    # Add instrument
    engine.add_instrument(instrument)

    # Add data
    engine.add_data(bars)

    # Configure strategy (use EXTERNAL bar type for historical data)
    bar_type = BarType.from_str(f"{instrument_id}-1-DAY-LAST-EXTERNAL")
    strategy_config = FiftyTwoWeekHighChaserConfig(
        instrument_id=instrument_id,
        bar_type=bar_type,
        entry_threshold_pct=3.0,
        stop_loss_pct=3.0,  # Stop loss at -3% (balance between R:R and noise)
        trailing_stop_activation_pct=2.0,  # Activate trailing stop after 2% profit
        trailing_stop_pct=3.0,  # Trail at 3% below highest price
        max_risk_per_trade_pct=1.0,  # Max 1% of capital at risk per trade
        max_total_loss_pct=5.0,  # Stop trading if total loss exceeds 5%
        max_consecutive_losses=3,  # Stop after 3 consecutive losses
        cooldown_bars=30,
        max_holding_bars=30,
        trade_size=Decimal("500"),  # Max 500 shares (will be limited by risk)
        order_id_tag=f"{symbol}_001",
    )

    # Instantiate and add strategy
    strategy = FiftyTwoWeekHighChaser(config=strategy_config)
    engine.add_strategy(strategy=strategy)

    # Run the backtest
    print("\nRunning backtest...")
    engine.run()

    # Generate reports
    print("\n" + "=" * 80)
    print("BACKTEST RESULTS")
    print("=" * 80)

    engine.trader.generate_account_report(venue)
    engine.trader.generate_positions_report()
    engine.trader.generate_order_fills_report()

    engine.dispose()


def run_backtest_with_upstox_data(symbol: str, num_days: int = 365 * 3):
    """
    Run a backtest using real data from Upstox API.

    Args:
        symbol: The stock symbol (e.g., "RELIANCE")
        num_days: Number of days for the backtest period (default: 3 years)
    """
    print("=" * 80)
    print(f"52-Week High Chaser Backtest for {symbol}")
    print("=" * 80)

    # Configuration
    venue = Venue("SIMULATED")
    instrument_id = InstrumentId.from_str(f"{symbol}.{venue}")

    # Create instrument
    instrument = create_equity_instrument(symbol, instrument_id)

    # Fetch data from Upstox
    bars = fetch_data_from_upstox(symbol, num_days, instrument)
    print(f"Loaded {len(bars)} daily bars for backtest")

    # Configure backtest engine
    config = BacktestEngineConfig(
        trader_id=TraderId("BACKTESTER-001"),
    )

    # Build the backtest engine
    engine = BacktestEngine(config=config)

    # Add a trading venue
    engine.add_venue(
        venue=venue,
        oms_type=OmsType.NETTING,
        account_type=AccountType.CASH,
        base_currency=INR,
        starting_balances=[Money(1_000_000.0, INR)],  # Rs. 10 lakh
    )

    # Add instrument
    engine.add_instrument(instrument)

    # Add data
    engine.add_data(bars)

    # Configure strategy (use EXTERNAL bar type for historical data)
    bar_type = BarType.from_str(f"{instrument_id}-1-DAY-LAST-EXTERNAL")
    strategy_config = FiftyTwoWeekHighChaserConfig(
        instrument_id=instrument_id,
        bar_type=bar_type,
        entry_threshold_pct=3.0,
        stop_loss_pct=3.0,  # Stop loss at -3% (balance between R:R and noise)
        trailing_stop_activation_pct=2.0,  # Activate trailing stop after 2% profit
        trailing_stop_pct=3.0,  # Trail at 3% below highest price
        max_risk_per_trade_pct=1.0,  # Max 1% of capital at risk per trade
        max_total_loss_pct=5.0,  # Stop trading if total loss exceeds 5%
        max_consecutive_losses=3,  # Stop after 3 consecutive losses
        cooldown_bars=30,
        max_holding_bars=30,
        trade_size=Decimal("500"),  # Max 500 shares (will be limited by risk)
        order_id_tag=f"{symbol}_001",
    )

    # Instantiate and add strategy
    strategy = FiftyTwoWeekHighChaser(config=strategy_config)
    engine.add_strategy(strategy=strategy)

    # Run the backtest
    console.print("\n[bold cyan]Running backtest...[/bold cyan]")
    engine.run()

    # Generate reports with Rich tables
    console.print("\n" + "=" * 80, style="bold blue")
    console.print("[bold green]BACKTEST RESULTS[/bold green]")
    console.print("=" * 80, style="bold blue")

    # Get portfolio stats via Cache
    cache = engine.cache

    # Get positions from cache
    positions = cache.positions()

    # Get account info
    account = cache.account_for_venue(venue)
    ending_balance = 0.0
    if account:
        ending_balance = float(account.balance_total())

    total_pnl = ending_balance - 1_000_000.0

    # Get trades from strategy
    trades = strategy.trades

    # Calculate win/loss stats from trades
    winning = sum(1 for t in trades if t['pnl_amount'] > 0)
    losing = sum(1 for t in trades if t['pnl_amount'] < 0)
    total_closed = winning + losing

    # Create Performance Summary Table
    perf_table = Table(title="Performance Summary", style="bold green")
    perf_table.add_column("Metric", style="cyan", width=25)
    perf_table.add_column("Value", justify="right", style="bold yellow")

    perf_table.add_row("Symbol", symbol)
    perf_table.add_row("Starting Balance", "Rs. 1,000,000.00")
    perf_table.add_row("Ending Balance", f"Rs. {ending_balance:,.2f}")

    pnl_style = "green" if total_pnl >= 0 else "red"
    perf_table.add_row("PnL (total)", f"Rs. {total_pnl:,.2f}", style=pnl_style)
    perf_table.add_row("PnL % (total)", f"{(total_pnl / 1_000_000) * 100:.2f}%", style=pnl_style)

    if total_closed > 0:
        win_rate = (winning / total_closed * 100)
        wr_style = "green" if win_rate >= 50 else "red"
        perf_table.add_row("Win Rate", f"{win_rate:.1f}%", style=wr_style)

    perf_table.add_row("Total Trades", str(len(trades)))
    perf_table.add_row("Winning Trades", str(winning), style="green")
    perf_table.add_row("Losing Trades", str(losing), style="red" if losing > 0 else "dim")

    console.print(perf_table)

    # Create Trades Table
    if trades:
        trades_table = Table(title="Trade History", style="bold blue")
        trades_table.add_column("#", justify="center", width=3)
        trades_table.add_column("Entry Date", style="cyan", width=20)
        trades_table.add_column("Exit Date", style="cyan", width=20)
        trades_table.add_column("Entry", justify="right", style="green")
        trades_table.add_column("Exit", justify="right", style="red")
        trades_table.add_column("52W High", justify="right", style="blue")
        trades_table.add_column("Dist%", justify="right", style="magenta")
        trades_table.add_column("Shares", justify="right")
        trades_table.add_column("PnL%", justify="right")
        trades_table.add_column("PnL ₹", justify="right")
        trades_table.add_column("Bars", justify="right")
        trades_table.add_column("R:R", justify="right", style="dim")
        trades_table.add_column("Reason", style="yellow", width=15)

        for i, t in enumerate(trades, 1):
            # Format dates to human readable
            if t['entry_date']:
                # Convert nanoseconds to datetime
                entry_ts = int(t['entry_date']) / 1_000_000_000 if isinstance(t['entry_date'], int) else t['entry_date']
                try:
                    entry_dt = datetime.fromtimestamp(entry_ts) if isinstance(entry_ts, (int, float)) else entry_ts
                    entry_date = entry_dt.strftime('%Y-%m-%d %H:%M') if hasattr(entry_dt, 'strftime') else str(entry_ts)[:16]
                except:
                    entry_date = str(t['entry_date'])[:19]
            else:
                entry_date = "-"

            if t['exit_date']:
                exit_ts = int(t['exit_date']) / 1_000_000_000 if isinstance(t['exit_date'], int) else t['exit_date']
                try:
                    exit_dt = datetime.fromtimestamp(exit_ts) if isinstance(exit_ts, (int, float)) else exit_ts
                    exit_date = exit_dt.strftime('%Y-%m-%d %H:%M') if hasattr(exit_dt, 'strftime') else str(exit_ts)[:16]
                except:
                    exit_date = str(t['exit_date'])[:19]
            else:
                exit_date = "-"

            # Color code PnL
            pnl_pct = t['pnl_pct']
            pnl_style = "green" if pnl_pct >= 0 else "red"

            # Color code reason
            reason = t['reason']
            if "52W_HIGH" in reason:
                reason_style = "green"
            elif "STOP_LOSS" in reason:
                reason_style = "red"
            else:
                reason_style = "yellow"

            trades_table.add_row(
                str(i),
                entry_date,
                exit_date,
                f"{t['entry_price']:.2f}",
                f"{t['exit_price']:.2f}",
                f"{t['52w_high']:.2f}",
                f"{t['distance_pct']:.1f}%",
                str(t['shares']),
                f"[{pnl_style}]{pnl_pct:+.2f}%[/{pnl_style}]",
                f"[{pnl_style}]₹{t['pnl_amount']:,.0f}[/{pnl_style}]",
                str(t['bars_held']),
                f"1:{t['risk_reward']:.1f}",
                f"[{reason_style}]{reason}[/{reason_style}]",
            )

        console.print(trades_table)

    # Create Strategy Config Table
    config_table = Table(title="Strategy Configuration", style="dim")
    config_table.add_column("Parameter", style="cyan")
    config_table.add_column("Value", justify="right", style="white")

    config_table.add_row("Entry Threshold", f"{strategy_config.entry_threshold_pct}%")
    config_table.add_row("Stop Loss", f"{strategy_config.stop_loss_pct}%")
    config_table.add_row("Trailing Stop Activation", f"{strategy_config.trailing_stop_activation_pct}%")
    config_table.add_row("Trailing Stop %", f"{strategy_config.trailing_stop_pct}%")
    config_table.add_row("Max Risk Per Trade", f"{strategy_config.max_risk_per_trade_pct}%")
    config_table.add_row("Max Total Loss", f"{strategy_config.max_total_loss_pct}%")
    config_table.add_row("Max Consec Losses", str(strategy_config.max_consecutive_losses))
    config_table.add_row("Cooldown Bars", str(strategy_config.cooldown_bars))
    config_table.add_row("Max Holding Bars", str(strategy_config.max_holding_bars))

    console.print(config_table)

    # Show if trading was stopped early
    if strategy.trading_stopped:
        console.print(f"\n[bold red]⚠️  TRADING STOPPED: {strategy.stop_reason}[/bold red]")

    # Clean up
    engine.dispose()

    console.print("\n" + "=" * 80, style="bold green")
    console.print("[bold green]Backtest completed successfully![/bold green]")
    console.print("=" * 80, style="bold green")

    # Return results for batch processing
    return {
        'symbol': symbol,
        'total_trades': len(trades),
        'winning_trades': winning,
        'losing_trades': losing,
        'win_rate': (winning / len(trades) * 100) if trades else 0,
        'pnl_pct': (total_pnl / 1_000_000) * 100,
        'pnl_amount': total_pnl,
        'max_win': max((t['pnl_amount'] for t in trades), default=0),
        'max_loss': min((t['pnl_amount'] for t in trades), default=0),
        'trading_stopped': strategy.trading_stopped,
        'stop_reason': strategy.stop_reason,
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="52-Week High Chaser Backtest using NautilusTrader",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_nautilus_52w_backtest.py RELIANCE
  python run_nautilus_52w_backtest.py COCHINSHIP --days 730
  python run_nautilus_52w_backtest.py TCS --days 365
  python run_nautilus_52w_backtest.py --batch   # Run on top 20 NSE stocks
  python run_nautilus_52w_backtest.py HDFCBANK --csv /path/to/data.csv
        """
    )
    parser.add_argument(
        "symbol",
        nargs="?",
        default="RELIANCE",
        help="Stock symbol to backtest (default: RELIANCE)"
    )
    parser.add_argument(
        "--days",
        type=int,
        default=1095,
        help="Number of days for backtest (default: 1095 = 3 years)"
    )
    parser.add_argument(
        "--csv",
        type=str,
        help="Path to CSV file with historical data"
    )
    parser.add_argument(
        "--batch",
        action="store_true",
        help="Run backtest on top 20 NSE stocks"
    )

    args = parser.parse_args()

    if args.batch:
        # Top 20 NSE stocks by market cap (excluding indexes like NIFTY 50)
        TOP_20_STOCKS = [
            "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
            "HINDUNILVR", "ITC", "SBIN", "BHARTIARTL", "KOTAKBANK",
            "LT", "AXISBANK", "BAJFINANCE", "ASIANPAINT", "MARUTI",
            "SUNPHARMA", "TITAN", "DMART", "WIPRO", "HCLTECH"
        ]

        console.print(f"[bold cyan]Running batch backtest on {len(TOP_20_STOCKS)} NSE stocks...[/bold cyan]")
        console.print(f"[dim]Days: {args.days}[/dim]")
        console.print()

        results = []
        for symbol in TOP_20_STOCKS:
            try:
                console.print(f"[bold yellow]>>> Backtesting {symbol}...[/bold yellow]")
                result = run_backtest_with_upstox_data(symbol, num_days=args.days)
                if result:
                    results.append(result)
            except Exception as e:
                console.print(f"[red]Error running backtest for {symbol}: {e}[/red]")
                continue

        # Print summary table
        if results:
            console.print("\n" + "=" * 80, style="bold blue")
            console.print("[bold green]BATCH BACKTEST SUMMARY[/bold green]")
            console.print("=" * 80, style="bold blue")

            summary_table = Table(title="All Stocks Performance", style="bold green")
            summary_table.add_column("Symbol", style="cyan", width=12)
            summary_table.add_column("Trades", justify="right")
            summary_table.add_column("Win Rate", justify="right")
            summary_table.add_column("PnL %", justify="right")
            summary_table.add_column("PnL ₹", justify="right")
            summary_table.add_column("Max Win", justify="right", style="green")
            summary_table.add_column("Max Loss", justify="right", style="red")

            total_pnl = 0
            total_trades = 0
            total_winners = 0

            for r in sorted(results, key=lambda x: x['pnl_pct'], reverse=True):
                pnl_style = "green" if r['pnl_pct'] >= 0 else "red"
                summary_table.add_row(
                    r['symbol'],
                    str(r['total_trades']),
                    f"{r['win_rate']:.1f}%",
                    f"[{pnl_style}]{r['pnl_pct']:+.2f}%[/{pnl_style}]",
                    f"[{pnl_style}]₹{r['pnl_amount']:,.0f}[/{pnl_style}]",
                    f"₹{r['max_win']:,.0f}",
                    f"₹{r['max_loss']:,.0f}",
                )
                total_pnl += r['pnl_amount']
                total_trades += r['total_trades']
                total_winners += r['winning_trades']

            console.print(summary_table)

            # Overall summary
            console.print(f"\n[bold]Overall:[/bold] {total_trades} trades | "
                         f"Win Rate: {(total_winners/total_trades*100) if total_trades > 0 else 0:.1f}% | "
                         f"Total PnL: ₹{total_pnl:,.0f}")

    elif args.csv:
        console.print(f"[bold cyan]Running with CSV data from {args.csv}...[/bold cyan]")
        run_backtest_with_csv_data(args.csv, args.symbol)
    else:
        console.print(f"[bold cyan]Running backtest for {args.symbol} ({args.days} days)...[/bold cyan]")
        run_backtest_with_upstox_data(args.symbol, num_days=args.days)
