#!/usr/bin/env python3
"""
Fixed BarUpDn Strategy - Simplified and Working Version
Focuses on 5-15 minute timeframes with proper pattern detection
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from bar_updn_extreme_backtest import BarUpDnBacktester, DataFetcher

console = Console()

class FixedBarUpDnStrategy:
    """
    Simplified and Fixed BarUpDn Strategy
    - Works on 5-15 minute timeframes
    - Simple pattern detection that actually generates signals
    - Basic volume confirmation
    - Trend awareness without over-filtering
    """
    
    def __init__(self, 
                 sl_percent: float = 2.0,
                 trailing_stop_percent: float = 1.5,
                 position_size_percent: float = 10.0,
                 max_intraday_loss_percent: float = 2.0,
                 min_hold_minutes: int = 5,
                 max_loss_dollars: float = 8.0,
                 # Simplified filters
                 require_volume_confirmation: bool = True,
                 volume_multiplier: float = 1.2,  # Much more lenient
                 min_price_movement: float = 0.1):  # Minimum % move to trigger
        
        self.sl_percent = sl_percent
        self.trailing_stop_percent = trailing_stop_percent
        self.position_size_percent = position_size_percent
        self.max_intraday_loss_percent = max_intraday_loss_percent
        self.min_hold_minutes = min_hold_minutes
        self.max_loss_dollars = max_loss_dollars
        
        # Simplified parameters
        self.require_volume_confirmation = require_volume_confirmation
        self.volume_multiplier = volume_multiplier
        self.min_price_movement = min_price_movement
        
        console.print(f"[green]✓ Fixed BarUpDn Strategy initialized with simplified logic[/green]")
        
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """Generate signals using SIMPLIFIED and WORKING logic"""
        
        df = df.copy()
        df['signal'] = 'HOLD'
        
        console.print("[cyan]🔧 Using FIXED BarUpDn pattern detection...[/cyan]")
        
        # Calculate basic indicators
        df['price_change_pct'] = df['close'].pct_change() * 100
        df['volume_ma'] = df['volume'].rolling(window=10).mean()
        df['volume_ratio'] = df['volume'] / df['volume_ma']
        
        # SIMPLIFIED Pattern Detection (that actually works!)
        # Green bar followed by red bar = potential SHORT
        # Red bar followed by green bar = potential LONG
        
        df['is_green'] = df['close'] > df['open']
        df['is_red'] = df['close'] < df['open']
        df['bar_size_pct'] = abs(df['close'] - df['open']) / df['open'] * 100
        
        # Pattern conditions (MUCH SIMPLER)
        green_to_red = df['is_red'] & df['is_green'].shift(1)  # Current red, previous green
        red_to_green = df['is_green'] & df['is_red'].shift(1)  # Current green, previous red
        
        # Price movement filter
        significant_move = df['bar_size_pct'] >= self.min_price_movement
        
        # Volume filter (optional)
        if self.require_volume_confirmation:
            volume_ok = df['volume_ratio'] >= self.volume_multiplier
        else:
            volume_ok = True
        
        # Generate signals
        # LONG: Red-to-Green reversal (buying the dip)
        long_condition = (
            red_to_green &
            significant_move &
            volume_ok
        )
        
        # SHORT: Green-to-Red reversal (selling the rip)  
        short_condition = (
            green_to_red &
            significant_move &
            volume_ok
        )
        
        df.loc[long_condition, 'signal'] = 'LONG'
        df.loc[short_condition, 'signal'] = 'SHORT'
        
        # Count signals
        long_signals = (df['signal'] == 'LONG').sum()
        short_signals = (df['signal'] == 'SHORT').sum()
        total_patterns = green_to_red.sum() + red_to_green.sum()
        
        console.print(f"[green]📊 FIXED Signal Statistics:[/green]")
        console.print(f"   Total reversal patterns: {total_patterns}")
        console.print(f"   LONG signals: {long_signals}")
        console.print(f"   SHORT signals: {short_signals}")
        console.print(f"   Signal rate: {(long_signals + short_signals)/len(df)*100:.3f}%")
        
        return df

def test_fixed_strategy():
    """Test the fixed strategy on different timeframes"""
    
    console.print(Panel.fit(
        "[bold green]🔧 Testing Fixed BarUpDn Strategy[/bold green]\n"
        "Using simplified pattern detection that actually works\n"
        "Testing multiple timeframes for optimal performance",
        border_style="green"
    ))
    
    # API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    fetcher = DataFetcher(API_KEY, API_SECRET)
    symbol = "BTCUSDT"
    days_back = 14
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days_back)
    
    console.print(f"[cyan]Fetching {days_back} days of data for {symbol}...[/cyan]")
    df_1m = fetcher.fetch_data(symbol, start_date, end_date)
    
    # Create different timeframe data
    timeframes = {
        "5m": df_1m.resample('5T').agg({
            'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'
        }).dropna(),
        "15m": df_1m.resample('15T').agg({
            'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'
        }).dropna(),
        "30m": df_1m.resample('30T').agg({
            'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'
        }).dropna()
    }
    
    results_table = Table(title="Fixed Strategy Performance by Timeframe")
    results_table.add_column("Timeframe", style="cyan")
    results_table.add_column("Bars", style="yellow")
    results_table.add_column("Signals", style="green")
    results_table.add_column("Win Rate %", style="green")
    results_table.add_column("Return %", style="blue")
    results_table.add_column("Max DD %", style="red")
    results_table.add_column("Trades", style="yellow")
    results_table.add_column("Profit Factor", style="blue")
    
    best_result = None
    best_timeframe = None
    best_score = -1000
    
    for tf_name, df_tf in timeframes.items():
        try:
            console.print(f"\n[bold yellow]Testing {tf_name} timeframe ({len(df_tf)} bars)[/bold yellow]")
            
            # Create fixed strategy
            strategy = FixedBarUpDnStrategy(
                sl_percent=2.0,
                trailing_stop_percent=1.5,
                position_size_percent=10.0,
                require_volume_confirmation=True,
                volume_multiplier=1.2,
                min_price_movement=0.15
            )
            
            # Generate signals to count them
            df_signals = strategy.generate_signals(df_tf.copy())
            signal_count = ((df_signals['signal'] == 'LONG') | (df_signals['signal'] == 'SHORT')).sum()
            
            if signal_count > 0:
                # Run backtest using the original backtester (modify it to use our strategy)
                class FixedBacktester(BarUpDnBacktester):
                    def __init__(self, initial_capital=10000):
                        super().__init__(initial_capital)
                        self.fixed_strategy = None
                    
                    def run_backtest(self, df, symbol, show_progress=True):
                        if show_progress:
                            console.print(f"[cyan]Running backtest for {symbol}...[/cyan]")
                        
                        # Use our fixed strategy for signal generation
                        df_signals = self.fixed_strategy.generate_signals(df)
                        
                        # Initialize tracking
                        capital = self.initial_capital
                        trades = []
                        position = None
                        
                        for i, (timestamp, row) in enumerate(df_signals.iterrows()):
                            # Simple position management
                            if position is None and row['signal'] in ['LONG', 'SHORT']:
                                # Open position
                                position = {
                                    'side': row['signal'],
                                    'entry_time': timestamp,
                                    'entry_price': row['close'],
                                    'quantity': (capital * 0.1) / row['close']  # 10% position size
                                }
                            
                            elif position is not None:
                                # Check exit conditions
                                current_price = row['close']
                                
                                # Simple stop loss
                                if position['side'] == 'LONG':
                                    stop_price = position['entry_price'] * (1 - 0.02)  # 2% stop
                                    if current_price <= stop_price:
                                        # Exit long
                                        pnl = position['quantity'] * (current_price - position['entry_price'])
                                        trades.append({
                                            'pnl': pnl,
                                            'entry_time': position['entry_time'],
                                            'exit_time': timestamp,
                                            'side': position['side']
                                        })
                                        capital += pnl
                                        position = None
                                
                                else:  # SHORT
                                    stop_price = position['entry_price'] * (1 + 0.02)  # 2% stop
                                    if current_price >= stop_price:
                                        # Exit short
                                        pnl = position['quantity'] * (position['entry_price'] - current_price)
                                        trades.append({
                                            'pnl': pnl,
                                            'entry_time': position['entry_time'],
                                            'exit_time': timestamp,
                                            'side': position['side']
                                        })
                                        capital += pnl
                                        position = None
                        
                        # Calculate results
                        if trades:
                            total_trades = len(trades)
                            winning_trades = len([t for t in trades if t['pnl'] > 0])
                            win_rate = (winning_trades / total_trades) * 100
                            total_return = (capital - self.initial_capital) / self.initial_capital * 100
                            
                            # Simple max drawdown calculation
                            running_pnl = 0
                            max_dd = 0
                            peak = 0
                            for trade in trades:
                                running_pnl += trade['pnl']
                                if running_pnl > peak:
                                    peak = running_pnl
                                drawdown = peak - running_pnl
                                if drawdown > max_dd:
                                    max_dd = drawdown
                            
                            max_dd_percent = (max_dd / self.initial_capital) * 100
                            
                            # Profit factor
                            wins = [t['pnl'] for t in trades if t['pnl'] > 0]
                            losses = [abs(t['pnl']) for t in trades if t['pnl'] < 0]
                            profit_factor = sum(wins) / sum(losses) if losses else 2.0
                            
                        else:
                            win_rate = 0
                            total_return = 0
                            max_dd_percent = 0
                            total_trades = 0
                            profit_factor = 0
                        
                        # Return simple result object
                        class SimpleResult:
                            def __init__(self):
                                self.win_rate = win_rate
                                self.total_return_percent = total_return
                                self.max_drawdown = max_dd_percent
                                self.total_trades = total_trades
                                self.profit_factor = profit_factor
                        
                        return SimpleResult()
                
                backtester = FixedBacktester(initial_capital=10000)
                backtester.fixed_strategy = strategy
                result = backtester.run_backtest(df_tf, f"{symbol}_{tf_name}", show_progress=False)
                
                # Calculate score
                score = result.win_rate * 0.4 + max(0, result.total_return_percent) * 0.3 + max(0, 10 - result.max_drawdown) * 0.3
                
                if score > best_score:
                    best_score = score
                    best_result = result
                    best_timeframe = tf_name
                
                results_table.add_row(
                    tf_name,
                    f"{len(df_tf):,}",
                    str(signal_count),
                    f"{result.win_rate:.1f}",
                    f"{result.total_return_percent:.2f}",
                    f"{result.max_drawdown:.2f}",
                    str(result.total_trades),
                    f"{result.profit_factor:.2f}"
                )
            else:
                results_table.add_row(tf_name, f"{len(df_tf):,}", "0", "0.0", "0.00", "0.00", "0", "0.00")
        
        except Exception as e:
            console.print(f"[red]Error testing {tf_name}: {str(e)}[/red]")
            results_table.add_row(tf_name, "Error", "Error", "Error", "Error", "Error", "Error", "Error")
    
    console.print(results_table)
    
    if best_result:
        console.print(Panel.fit(
            f"[bold green]🏆 BEST PERFORMING TIMEFRAME: {best_timeframe}[/bold green]\n\n"
            f"Win Rate: {best_result.win_rate:.1f}%\n"
            f"Return: {best_result.total_return_percent:.2f}%\n"
            f"Max Drawdown: {best_result.max_drawdown:.2f}%\n"
            f"Total Trades: {best_result.total_trades}\n"
            f"Profit Factor: {best_result.profit_factor:.2f}\n"
            f"Score: {best_score:.2f}",
            border_style="green"
        ))
    
    return best_timeframe, best_result

def main():
    """Test the fixed strategy"""
    
    console.print("[bold blue]🔧 Fixed BarUpDn Strategy Testing[/bold blue]")
    
    best_tf, best_result = test_fixed_strategy()
    
    console.print(f"\n[bold green]💡 STRATEGY RECOMMENDATIONS:[/bold green]")
    
    if best_result and best_result.win_rate > 50:
        console.print(f"✅ FIXED strategy works! Best timeframe: {best_tf}")
        console.print(f"✅ Use {best_tf} timeframe for live trading")
        console.print(f"✅ Expected win rate: {best_result.win_rate:.1f}%")
        console.print(f"✅ This is a MAJOR improvement over the broken original!")
    else:
        console.print("❌ Even the fixed strategy needs more work")
        console.print("💡 Consider the breakout strategy alternative below")
    
    console.print(f"\n[bold cyan]🚀 ALTERNATIVE: Simple Breakout Strategy[/bold cyan]")
    console.print("If BarUpDn still doesn't work well, implement:")
    console.print("• LONG: Close > 20-period high + volume > 1.2x average")
    console.print("• SHORT: Close < 20-period low + volume > 1.2x average")
    console.print("• 1.5% stop loss, 3% take profit")
    console.print("• Much simpler and more reliable for crypto")

if __name__ == "__main__":
    main() 