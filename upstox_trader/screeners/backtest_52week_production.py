#!/usr/bin/env python3
"""
52-Week High Chaser - PRODUCTION STRATEGY
==========================================
Optimized for 80%+ Win Rate with Adaptive Volatility Scaling

Key Features:
1. Volatility-Adjusted Entry Thresholds (ATR-based)
2. Dynamic ADX filtering based on market regime
3. Volume-weighted confirmation
4. Trailing stops with volatility adjustment
5. Multi-stock diversification
"""

import sys
import os
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import time
from typing import Dict, List, Tuple

# Add project root to sys.path
_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_screeners_dir = _current_file_dir
_upstox_trader_dir = os.path.dirname(_screeners_dir)
_project_root_dir = os.path.dirname(_upstox_trader_dir)

if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)

from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage
from rich.console import Console
from rich.table import Table
from rich.progress import track

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

    return adx, plus_di, minus_di


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


def get_volatility_regime(df: pd.DataFrame, lookback: int = 50) -> str:
    """
    Detect current volatility regime
    Returns: 'LOW', 'MEDIUM', 'HIGH'
    """
    if len(df) < lookback:
        return 'MEDIUM'

    recent_atr = df['atr'].iloc[-lookback:]
    current_atr = df['atr'].iloc[-1]

    p33 = recent_atr.quantile(0.33)
    p67 = recent_atr.quantile(0.67)

    if current_atr < p33:
        return 'LOW'
    elif current_atr < p67:
        return 'MEDIUM'
    else:
        return 'HIGH'


def get_adaptive_params(vol_regime: str, base_adx: float = 25.0) -> Dict:
    """
    Returns adaptive parameters based on volatility regime

    LOW Volatility: Tighter filters, smaller stops
    MEDIUM Volatility: Balanced parameters
    HIGH Volatility: Looser filters, wider stops
    """
    if vol_regime == 'LOW':
        return {
            'min_adx': base_adx - 5,
            'min_volume_multiple': 1.3,
            'atr_sl_multiple': 1.8,
            'trailing_stop_pct': 1.0,
            'entry_threshold_pct': 4.0
        }
    elif vol_regime == 'HIGH':
        return {
            'min_adx': base_adx + 5,
            'min_volume_multiple': 1.8,
            'atr_sl_multiple': 2.5,
            'trailing_stop_pct': 1.8,
            'entry_threshold_pct': 6.0
        }
    else:  # MEDIUM
        return {
            'min_adx': base_adx,
            'min_volume_multiple': 1.5,
            'atr_sl_multiple': 2.0,
            'trailing_stop_pct': 1.5,
            'entry_threshold_pct': 5.0
        }


def run_backtest_production(ticker: str, num_days: int = 1095, use_adaptive: bool = True) -> Dict:
    """
    Production backtest with adaptive parameters
    """

    console.print(f"\n[bold cyan]Testing: {ticker} | Adaptive: {use_adaptive}[/bold cyan]")

    screener = TVScreenerUsage(enable_paper_trading=False)

    # Load instruments
    screener.upstox_api.get_instrument_key("NIFTY", instrument_type="INDEX")

    # Fetch historical data
    from_date = (datetime.now() - timedelta(days=num_days + 500)).strftime('%Y-%m-%d')
    to_date = datetime.now().strftime('%Y-%m-%d')

    console.print(f"[dim]Fetching {num_days + 500} days of data...[/dim]")

    df = screener.upstox_api.fetch_historical_data_v3(
        symbol=ticker,
        unit="days",
        interval=1,
        from_date=from_date,
        to_date=to_date
    )

    if df is None or df.empty:
        console.print(f"[red]No data for {ticker}[/red]")
        return None

    # Calculate indicators
    df['52w_high'] = df['high'].rolling(window=252, min_periods=100).max().shift(1)
    df['adx'], _, _ = calculate_adx(df['high'], df['low'], df['close'])
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

    console.print(f"[green]✅ Data loaded: {len(df)} days[/green]")

    # Base parameters (PROVEN from original backtest)
    BASE_PARAMS = {
        'min_rsi': 50,
        'max_rsi': 70,
        'max_holding_days': 15,
        'min_days_since_52w': 20,
        'cooldown_days': 30
    }

    trades = []
    current_position = None
    entry_price = 0
    entry_time = None
    entry_52w_high = 0
    entry_atr = 0
    highest_price = 0
    highest_profit = 0
    last_exit_date = None
    days_in_trade = 0
    trailing_active = False

    for timestamp, row in df.iterrows():
        current_date = timestamp.date()
        current_price = row['close']
        high_52w = row['52w_high']

        if pd.isna(high_52w):
            continue

        # Get volatility regime and adaptive params
        if use_adaptive:
            vol_regime = get_volatility_regime(df[df.index <= timestamp])
            adaptive_params = get_adaptive_params(vol_regime)
        else:
            adaptive_params = get_adaptive_params('MEDIUM')

        # Combine base and adaptive params
        params = {**BASE_PARAMS, **adaptive_params}

        days_from_last_exit = None
        if last_exit_date:
            days_from_last_exit = (current_date - last_exit_date).days

        distance_to_52w_pct = ((high_52w - current_price) / current_price) * 100
        in_cooldown = last_exit_date and days_from_last_exit < params['cooldown_days']

        # ENTRY LOGIC
        if current_position is None and not in_cooldown:
            if distance_to_52w_pct <= params['entry_threshold_pct'] and distance_to_52w_pct > 0:

                days_since_52w = row['days_since_52w_high']
                if pd.isna(days_since_52w) or days_since_52w < params['min_days_since_52w']:
                    continue

                # Apply filters
                entry_allowed = True

                # ADX filter
                if pd.isna(row['adx']) or row['adx'] < params['min_adx']:
                    entry_allowed = False

                # Volume filter
                if not pd.isna(row['vol_avg']) and row['volume'] < (params['min_volume_multiple'] * row['vol_avg']):
                    entry_allowed = False

                # RSI filter
                if pd.isna(row['rsi']) or row['rsi'] < params['min_rsi'] or row['rsi'] > params['max_rsi']:
                    entry_allowed = False

                # MA filter
                ma_50 = row['ma_50']
                ma_200 = row['ma_200']
                if not pd.isna(ma_50) and not pd.isna(ma_200):
                    if current_price < ma_50 or current_price < ma_200:
                        entry_allowed = False

                if entry_allowed:
                    current_position = 'LONG'
                    entry_price = current_price
                    entry_time = timestamp
                    entry_52w_high = high_52w
                    entry_atr = row['atr']
                    highest_price = current_price
                    highest_profit = 0
                    days_in_trade = 0
                    trailing_active = False

                    console.print(
                        f"[green]📈 LONG {ticker} @ ₹{current_price:.2f} | "
                        f"52W: ₹{high_52w:.2f} | Dist: {distance_to_52w_pct:.2f}% | "
                        f"Vol: {vol_regime if use_adaptive else 'FIXED'}[/green]"
                    )

        # EXIT LOGIC
        if current_position == 'LONG':
            days_in_trade += 1
            pnl_pct = ((current_price - entry_price) / entry_price) * 100

            if row['high'] > highest_price:
                highest_price = row['high']
                highest_profit = ((highest_price - entry_price) / entry_price) * 100

            exit_reason = None
            exit_price = current_price

            # Trailing stop activation
            if row['high'] >= entry_52w_high and not trailing_active:
                trailing_active = True

            # Trailing stop exit
            if trailing_active:
                drawdown = ((highest_price - current_price) / highest_price) * 100
                if drawdown >= params['trailing_stop_pct']:
                    exit_reason = f'TRAILING_STOP'

            # ATR stop loss
            if not exit_reason and current_price <= (entry_price - (entry_atr * params['atr_sl_multiple'])):
                exit_reason = 'ATR_SL'

            # Max holding days
            if not exit_reason and days_in_trade >= params['max_holding_days']:
                exit_reason = 'MAX_HOLDING_DAYS'

            # New 52W high
            if not exit_reason and high_52w > entry_52w_high * 1.05:
                exit_reason = 'NEW_52W_HIGH'

            # ADX weakening
            if not exit_reason and not pd.isna(row['adx']) and row['adx'] < 20:
                exit_reason = 'ADX_WEAKENING'

            if exit_reason:
                trades.append({
                    'entry_time': entry_time,
                    'exit_time': timestamp,
                    'entry_price': entry_price,
                    'exit_price': exit_price,
                    'pnl_pct': pnl_pct,
                    'days_held': days_in_trade,
                    'highest_pnl_pct': highest_profit,
                    'reason': exit_reason
                })

                color = 'green' if 'TRAILING' in exit_reason else 'red' if 'SL' in exit_reason else 'yellow'
                console.print(
                    f"[{color}]{'📈' if 'TRAILING' in exit_reason else '🛑' if 'SL' in exit_reason else '⏰'} "
                    f"EXIT {ticker} @ ₹{exit_price:.2f} | P&L: {pnl_pct:+.2f}% | "
                    f"Highest: {highest_profit:+.2f}% | {exit_reason}[/{color}]"
                )

                current_position = None
                last_exit_date = current_date
                trailing_active = False

    # Calculate metrics
    if not trades:
        console.print(f"[yellow]No trades generated for {ticker}[/yellow]")
        return None

    winning_trades = [t for t in trades if t['pnl_pct'] > 0]
    losing_trades = [t for t in trades if t['pnl_pct'] <= 0]

    total_trades = len(trades)
    win_count = len(winning_trades)
    win_rate = (win_count / total_trades * 100) if total_trades > 0 else 0
    total_pnl_pct = sum(t['pnl_pct'] for t in trades)
    avg_days_held = sum(t['days_held'] for t in trades) / total_trades

    gross_profit = sum(t['pnl_pct'] for t in winning_trades)
    gross_loss = abs(sum(t['pnl_pct'] for t in losing_trades))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0

    expectancy = total_pnl_pct / total_trades

    console.print(f"[bold cyan]Results for {ticker}:[/bold cyan]")
    console.print(f"  Trades: {total_trades}")
    console.print(f"  Win Rate: [bold green]{win_rate:.1f}%[/bold green]")
    console.print(f"  Profit Factor: {profit_factor:.2f}")
    console.print(f"  Expectancy: {expectancy:+.2f}%")
    console.print(f"  Total P&L: {total_pnl_pct:+.2f}%")

    return {
        'ticker': ticker,
        'total_trades': total_trades,
        'winning_trades': win_count,
        'losing_trades': len(losing_trades),
        'win_rate': win_rate,
        'total_pnl_pct': total_pnl_pct,
        'profit_factor': profit_factor,
        'expectancy': expectancy,
        'avg_days_held': avg_days_held,
        'trades': trades
    }


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="52-Week High Production Backtest"
    )
    parser.add_argument('--symbol', '-s', type=str,
                       default='EICHERMOT,TATAMOTORS,BAJFINANCE,ADANIENT,SHRIRAMFIN,TITAN',
                       help='Comma-separated symbols to test')
    parser.add_argument('--days', '-d', type=int, default=1095,
                       help='Backtest period in days')
    parser.add_argument('--no-adaptive', action='store_true',
                       help='Use fixed parameters instead of adaptive')

    args = parser.parse_args()

    symbols = [s.strip().upper() for s in args.symbol.split(',')]

    console.print("[bold cyan]╔════════════════════════════════════════════════════════════╗[/bold cyan]")
    console.print("[bold cyan]║     52-WEEK HIGH CHASER - PRODUCTION BACKTEST           ║[/bold cyan]")
    console.print("[bold cyan]║           Target: 80%+ Win Rate with Adaptive Params    ║[/bold cyan]")
    console.print("[bold cyan]╚════════════════════════════════════════════════════════════╝[/bold cyan]")

    results = []

    for symbol in symbols:
        try:
            result = run_backtest_production(symbol, args.days, use_adaptive=not args.no_adaptive)
            if result:
                results.append(result)
            time.sleep(1)
        except Exception as e:
            console.print(f"[red]Error with {symbol}: {e}[/red]")
            continue

    # Final Summary
    console.print("\n" + "="*80)
    console.print("[bold yellow]📊 FINAL PRODUCTION RESULTS[/bold yellow]")
    console.print("="*80)

    table = Table(title="Production Strategy Performance")
    table.add_column("Ticker", style="cyan")
    table.add_column("Trades", justify="right")
    table.add_column("Win Rate", justify="right", style="green")
    table.add_column("Profit Factor", justify="right")
    table.add_column("Expectancy %", justify="right")
    table.add_column("Total P&L %", justify="right")

    for r in results:
        table.add_row(
            r['ticker'],
            str(r['total_trades']),
            f"{r['win_rate']:.1f}%",
            f"{r['profit_factor']:.2f}",
            f"{r['expectancy']:+.2f}",
            f"{r['total_pnl_pct']:+.1f}"
        )

    console.print(table)

    # Aggregate metrics
    total_trades = sum(r['total_trades'] for r in results)
    total_wins = sum(r['winning_trades'] for r in results)
    aggregate_win_rate = (total_wins / total_trades * 100) if total_trades > 0 else 0
    total_pnl = sum(r['total_pnl_pct'] for r in results)

    console.print(f"\n[bold yellow]Aggregate Performance:[/bold yellow]")
    console.print(f"  Total Trades: {total_trades}")
    console.print(f"  Aggregate Win Rate: [bold cyan]{aggregate_win_rate:.2f}%[/bold cyan]")
    console.print(f"  Total P&L: {total_pnl:+.2f}%")

    if aggregate_win_rate >= 80:
        console.print("\n[bold green blink]🎉 SUCCESS: 80%+ WIN RATE ACHIEVED! 🎉[/bold green blink]")
    elif aggregate_win_rate >= 70:
        console.print("\n[bold yellow]⚠️  CLOSE: 70-80% win rate[/bold yellow]")
    else:
        console.print("\n[bold red]❌ Target not met[/bold red]")

    console.print("\n[bold green]Production Backtest Complete![/bold green]")


if __name__ == "__main__":
    main()
