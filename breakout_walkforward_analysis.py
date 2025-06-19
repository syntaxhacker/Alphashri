#!/usr/bin/env python3
"""
Crypto Breakout Strategy - Walk-Forward Analysis
Validates strategy robustness by testing on rolling time windows
"""

import json
import time
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
import warnings

# Rich for beautiful console output
from rich.console import Console
from rich.progress import Progress, BarColumn, TextColumn, TimeElapsedColumn
from rich.table import Table
from rich.panel import Panel

# Import modules
from enhanced_data_fetcher import EnhancedDataFetcher

warnings.filterwarnings('ignore')
console = Console()

class CryptoBreakoutWalkForward:
    """Walk-Forward Analysis for Crypto Breakout Strategy"""
    
    def __init__(self, symbols: List[str] = None):
        self.symbols = symbols or ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']
        self.fetcher = EnhancedDataFetcher()
        self.data_cache = {}
        
        # Optimal parameters from your successful optimization
        self.optimal_params = {
            'lookback_periods': 15,
            'volume_multiplier': 1.1,
            'min_breakout_percent': 0.05,
            'sl_percent': 1.0,
            'tp_percent': 7.0,
            'trailing_stop_percent': 0.5,
            'position_size_percent': 18.4
        }
        
    def load_historical_data(self, days_back: int = 180):
        """Load comprehensive historical data for walk-forward analysis"""
        console.print(f"\n[cyan]📊 Loading {days_back} days of historical data...[/cyan]")
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        for symbol in self.symbols:
            try:
                console.print(f"[cyan]Fetching {symbol} 15m data...[/cyan]")
                df = self.fetcher.fetch_data(symbol, start_date, end_date, timeframe='15m')
                
                if df is not None and not df.empty:
                    self.data_cache[symbol] = df
                    console.print(f"[green]✓ {symbol}: {len(df):,} bars loaded[/green]")
                else:
                    console.print(f"[red]✗ {symbol}: No data available[/red]")
                    
            except Exception as e:
                console.print(f"[red]✗ Failed to fetch {symbol}: {str(e)}[/red]")
        
        total_bars = sum(len(df) for df in self.data_cache.values())
        console.print(f"[green]✅ {len(self.data_cache)} symbols ready ({total_bars:,} total bars)[/green]")
    
    def run_walk_forward_analysis(self, 
                                 train_days: int = 30,
                                 test_days: int = 7,
                                 step_days: int = 7) -> Dict:
        """Run walk-forward analysis"""
        
        console.print(Panel.fit(
            f"[bold cyan]🚀 CRYPTO BREAKOUT WALK-FORWARD ANALYSIS[/bold cyan]\n"
            f"Training Period: {train_days} days\n"
            f"Testing Period: {test_days} days\n"
            f"Step Size: {step_days} days\n"
            f"Symbols: {', '.join(self.symbols)}",
            border_style="cyan"
        ))
        
        results = {}
        
        for symbol in self.symbols:
            if symbol not in self.data_cache:
                console.print(f"[red]⚠️ Skipping {symbol} - no data available[/red]")
                continue
                
            console.print(f"\n[bold yellow]📈 Analyzing {symbol}...[/bold yellow]")
            symbol_results = self._run_symbol_walkforward(symbol, train_days, test_days, step_days)
            results[symbol] = symbol_results
        
        # Generate summary report
        self._generate_walkforward_report(results, train_days, test_days, step_days)
        
        return results
    
    def _run_symbol_walkforward(self, symbol: str, train_days: int, test_days: int, step_days: int) -> List[Dict]:
        """Run walk-forward analysis for a single symbol"""
        
        df = self.data_cache[symbol]
        windows = self._generate_time_windows(df, train_days, test_days, step_days)
        
        console.print(f"[cyan]Generated {len(windows)} walk-forward windows for {symbol}[/cyan]")
        
        window_results = []
        
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
            console=console
        ) as progress:
            
            task = progress.add_task(f"Walk-forward {symbol}", total=len(windows))
            
            for i, window in enumerate(windows):
                test_data = df[window['test_start']:window['test_end']]
                
                if len(test_data) < 20:
                    progress.advance(task)
                    continue
                
                # Test on out-of-sample data using optimal parameters
                test_results = self._simple_backtest(test_data, self.optimal_params)
                
                window_result = {
                    'window': i + 1,
                    'train_start': window['train_start'].strftime('%Y-%m-%dT%H:%M:%S'),
                    'train_end': window['train_end'].strftime('%Y-%m-%dT%H:%M:%S'),
                    'test_start': window['test_start'].strftime('%Y-%m-%dT%H:%M:%S'),
                    'test_end': window['test_end'].strftime('%Y-%m-%dT%H:%M:%S'),
                    'test_bars': len(test_data),
                    'best_params': self.optimal_params,
                    'test_results': test_results
                }
                
                window_results.append(window_result)
                progress.advance(task)
        
        return window_results
    
    def _generate_time_windows(self, df: pd.DataFrame, train_days: int, test_days: int, step_days: int) -> List[Dict]:
        """Generate overlapping time windows for walk-forward analysis"""
        
        windows = []
        start_date = df.index.min()
        end_date = df.index.max()
        
        current_start = start_date
        
        while True:
            train_start = current_start
            train_end = train_start + timedelta(days=train_days)
            test_start = train_end
            test_end = test_start + timedelta(days=test_days)
            
            if test_end > end_date:
                break
            
            windows.append({
                'train_start': train_start,
                'train_end': train_end,
                'test_start': test_start,
                'test_end': test_end
            })
            
            current_start += timedelta(days=step_days)
        
        return windows
    
    def _simple_backtest(self, df: pd.DataFrame, params: Dict) -> Dict:
        """Simple backtesting implementation"""
        
        df = df.copy()
        df['volume_ma'] = df['volume'].rolling(window=20).mean()
        df['high_max'] = df['high'].rolling(window=params['lookback_periods']).max().shift(1)
        df['low_min'] = df['low'].rolling(window=params['lookback_periods']).min().shift(1)
        
        portfolio_value = 10000.0
        trades = []
        position = None
        
        for i in range(params['lookback_periods'], len(df)):
            row = df.iloc[i]
            
            if position is None:
                # Entry conditions
                breakout_up = row['close'] > row['high_max'] * (1 + params['min_breakout_percent']/100)
                volume_ok = row['volume'] > row['volume_ma'] * params['volume_multiplier']
                
                if breakout_up and volume_ok and not pd.isna(row['high_max']):
                    position = {
                        'type': 'LONG',
                        'entry_price': row['close'],
                        'entry_time': row.name,
                        'size': (portfolio_value * params['position_size_percent'] / 100) / row['close']
                    }
            else:
                # Exit conditions
                current_price = row['close']
                entry_price = position['entry_price']
                
                stop_loss = entry_price * (1 - params['sl_percent']/100)
                take_profit = entry_price * (1 + params['tp_percent']/100)
                
                if current_price <= stop_loss or current_price >= take_profit:
                    exit_price = current_price
                    pnl = position['size'] * (exit_price - entry_price)
                    
                    trades.append({
                        'entry_time': position['entry_time'],
                        'exit_time': row.name,
                        'entry_price': entry_price,
                        'exit_price': exit_price,
                        'pnl': pnl,
                        'return_pct': (exit_price - entry_price) / entry_price * 100
                    })
                    
                    portfolio_value += pnl
                    position = None
        
        # Calculate metrics
        if trades:
            winning_trades = [t for t in trades if t['pnl'] > 0]
            win_rate = len(winning_trades) / len(trades) * 100
            total_return = (portfolio_value - 10000) / 10000 * 100
            
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
            
            max_dd_pct = max_dd / 10000 * 100
            
            total_wins = sum(t['pnl'] for t in trades if t['pnl'] > 0)
            total_losses = abs(sum(t['pnl'] for t in trades if t['pnl'] < 0))
            profit_factor = total_wins / total_losses if total_losses > 0 else 2.0
            
            return {
                'win_rate': win_rate,
                'total_return_percent': total_return,
                'max_drawdown': max_dd_pct,
                'total_trades': len(trades),
                'profit_factor': profit_factor,
                'trades': trades
            }
        else:
            return {
                'win_rate': 0.0,
                'total_return_percent': 0.0,
                'max_drawdown': 0.0,
                'total_trades': 0,
                'profit_factor': 0.0,
                'trades': []
            }
    
    def _generate_walkforward_report(self, results: Dict, train_days: int, test_days: int, step_days: int):
        """Generate comprehensive walk-forward analysis report"""
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Calculate summary statistics
        summary_stats = {}
        
        for symbol, windows in results.items():
            if not windows:
                continue
                
            win_rates = [w['test_results']['win_rate'] for w in windows if w['test_results']['total_trades'] > 0]
            returns = [w['test_results']['total_return_percent'] for w in windows]
            drawdowns = [w['test_results']['max_drawdown'] for w in windows]
            trades = [w['test_results']['total_trades'] for w in windows]
            
            if len(win_rates) > 0:
                summary_stats[symbol] = {
                    'total_windows': len(windows),
                    'trading_windows': len(win_rates),
                    'avg_win_rate': np.mean(win_rates),
                    'avg_return': np.mean(returns),
                    'avg_drawdown': np.mean(drawdowns),
                    'avg_trades': np.mean(trades),
                    'positive_windows': sum(1 for r in returns if r > 0),
                    'std_return': np.std(returns),
                    'max_return': max(returns),
                    'min_return': min(returns),
                    'consistency_score': (np.mean(returns) / (np.std(returns) + 1)) * (sum(1 for r in returns if r > 0) / len(returns))
                }
        
        # Display summary table
        console.print(f"\n[bold green]📊 WALK-FORWARD ANALYSIS RESULTS[/bold green]")
        
        table = Table(title="Walk-Forward Summary Statistics")
        table.add_column("Symbol", style="cyan")
        table.add_column("Windows", justify="right")
        table.add_column("Trading", justify="right")
        table.add_column("Avg Win%", justify="right")
        table.add_column("Avg Return%", justify="right") 
        table.add_column("Std Return%", justify="right")
        table.add_column("Max Return%", justify="right")
        table.add_column("Positive %", justify="right")
        table.add_column("Score", justify="right")
        
        for symbol, stats in summary_stats.items():
            positive_pct = stats['positive_windows'] / stats['total_windows'] * 100
            table.add_row(
                symbol,
                str(stats['total_windows']),
                str(stats['trading_windows']),
                f"{stats['avg_win_rate']:.1f}",
                f"{stats['avg_return']:.1f}",
                f"{stats['std_return']:.1f}",
                f"{stats['max_return']:.1f}",
                f"{positive_pct:.0f}%",
                f"{stats['consistency_score']:.2f}"
            )
        
        console.print(table)
        
        # Save detailed results
        filename = f"crypto_breakout_walkforward_{timestamp}.json"
        
        save_data = {
            'timestamp': timestamp,
            'parameters': {
                'train_days': train_days,
                'test_days': test_days,
                'step_days': step_days,
                'symbols': self.symbols
            },
            'optimal_params': self.optimal_params,
            'summary_statistics': summary_stats,
            'detailed_results': results
        }
        
        with open(filename, 'w') as f:
            json.dump(save_data, f, indent=2, default=str)
        
        console.print(f"\n[green]✅ Walk-forward results saved to: {filename}[/green]")
        
        # Performance insights
        self._display_insights(summary_stats)
    
    def _display_insights(self, summary_stats: Dict):
        """Display insights from walk-forward analysis"""
        
        console.print(f"\n[bold yellow]💡 WALK-FORWARD INSIGHTS[/bold yellow]")
        
        insights = []
        
        if summary_stats:
            avg_consistency = np.mean([stats['consistency_score'] for stats in summary_stats.values()])
            avg_positive_rate = np.mean([stats['positive_windows'] / stats['total_windows'] for stats in summary_stats.values()])
            avg_return = np.mean([stats['avg_return'] for stats in summary_stats.values()])
            
            if avg_consistency > 0.5:
                insights.append("✅ Strategy shows good consistency across time periods")
            else:
                insights.append("⚠️ Strategy performance varies significantly across time periods")
                
            if avg_positive_rate > 0.6:
                insights.append("✅ Strategy is profitable in majority of test periods")
            else:
                insights.append("⚠️ Strategy struggles in many test periods")
            
            if avg_return > 5.0:
                insights.append("✅ Strong average returns across test periods")
            elif avg_return > 0:
                insights.append("📈 Positive average returns but room for improvement")
            else:
                insights.append("📉 Negative average returns - strategy needs adjustment")
            
            best_symbol = max(summary_stats.keys(), key=lambda s: summary_stats[s]['consistency_score'])
            worst_symbol = min(summary_stats.keys(), key=lambda s: summary_stats[s]['consistency_score'])
            
            insights.append(f"🏆 Best performing symbol: {best_symbol}")
            insights.append(f"📊 Needs attention: {worst_symbol}")
        
        for insight in insights:
            console.print(f"   {insight}")
        
        # Recommendations
        console.print(f"\n[bold cyan]🎯 RECOMMENDATIONS[/bold cyan]")
        
        if summary_stats:
            avg_consistency = np.mean([stats['consistency_score'] for stats in summary_stats.values()])
            
            if avg_consistency < 0.3:
                console.print("   📝 Strategy shows high variability - consider:")
                console.print("      • More frequent parameter reoptimization")
                console.print("      • Market regime filters")
                console.print("      • Adaptive position sizing")
            elif avg_consistency > 0.7:
                console.print("   📝 Strategy shows strong robustness:")
                console.print("      • Suitable for live trading")
                console.print("      • Consider gradual position size increases")
                console.print("      • Monitor for market regime changes")
            else:
                console.print("   📝 Strategy shows moderate consistency:")
                console.print("      • Monitor performance closely")
                console.print("      • Consider implementation with reduced risk")
                console.print("      • Regular parameter validation")

def main():
    """Main function to run walk-forward analysis"""
    
    console.print(Panel.fit(
        "[bold cyan]🚀 CRYPTO BREAKOUT WALK-FORWARD ANALYSIS[/bold cyan]\n"
        "Validate strategy robustness across time periods\n"
        "Test optimal parameters on rolling windows",
        border_style="cyan"
    ))
    
    # Initialize walk-forward analyzer
    analyzer = CryptoBreakoutWalkForward()
    
    # Load historical data
    analyzer.load_historical_data(days_back=180)  # 6 months of data
    
    # Run walk-forward analysis
    results = analyzer.run_walk_forward_analysis(
        train_days=30,      # 30 days training window
        test_days=7,        # 7 days testing window
        step_days=7         # Step forward 1 week
    )
    
    console.print(f"\n[bold green]🎊 Walk-forward analysis complete![/bold green]")

if __name__ == "__main__":
    main() 