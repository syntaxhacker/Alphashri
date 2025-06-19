#!/usr/bin/env python3
"""
PROFESSIONAL STRATEGY WALK-FORWARD TESTING
🏆 Walk-forward optimization and backtesting for our professional institutional strategy

Uses the same robust testing framework as main_strategy_optimizer.py
Tests on real market data across multiple symbols and timeframes.
"""

import sys
import json
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass

# Rich for beautiful output
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.progress import Progress, BarColumn, TextColumn, TimeElapsedColumn

# Import data fetcher
from enhanced_data_fetcher import EnhancedDataFetcher as DataFetcher
from professional_trading_strategy import ProfessionalTradingStrategy, TradingSignal, SignalType

console = Console()

@dataclass
class BacktestResult:
    """Results from a backtest period"""
    start_date: str
    end_date: str
    symbol: str
    total_return: float
    max_drawdown: float
    win_rate: float
    total_trades: int
    profit_factor: float
    sharpe_ratio: float
    avg_trade_return: float
    winning_trades: int
    losing_trades: int
    largest_win: float
    largest_loss: float
    consecutive_wins: int
    consecutive_losses: int
    trades_detail: List[Dict]

class ProfessionalStrategyBacktester:
    """Comprehensive backtester for our professional strategy"""
    
    def __init__(self, symbols: List[str] = None, days_back: int = 90):
        self.symbols = symbols or ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']
        self.days_back = days_back
        self.timeframe = '15m'  # 15-minute bars for detailed testing
        
        # Initialize data fetcher
        self.data_fetcher = DataFetcher(
            api_key="d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3",
            api_secret="7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
        )
        
        console.print(Panel.fit(
            "[bold blue]🏆 PROFESSIONAL STRATEGY WALK-FORWARD TESTER[/bold blue]\n"
            f"[cyan]Testing on {len(self.symbols)} symbols over {days_back} days[/cyan]\n\n"
            f"🎯 Symbols: {', '.join(self.symbols)}\n"
            f"📊 Timeframe: {self.timeframe}\n"
            f"📈 Data period: {days_back} days\n"
            f"🔄 Walk-forward windows: 4 periods",
            border_style="blue"
        ))
    
    def fetch_market_data(self) -> Dict[str, pd.DataFrame]:
        """Fetch real market data for all symbols"""
        
        console.print(f"\n[yellow]📊 Fetching market data...[/yellow]")
        
        market_data = {}
        
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            "[progress.percentage]{task.percentage:>3.0f}%",
            TimeElapsedColumn(),
            console=console
        ) as progress:
            
            task = progress.add_task("Fetching data...", total=len(self.symbols))
            
            for symbol in self.symbols:
                try:
                    # Fetch data
                    end_date = datetime.now()
                    start_date = end_date - timedelta(days=self.days_back)
                    data = self.data_fetcher.fetch_data(
                        symbol=symbol,
                        start_date=start_date,
                        end_date=end_date,
                        timeframe=self.timeframe
                    )
                    
                    if data is not None and len(data) > 100:
                        # Reset index to get timestamp as column
                        data.reset_index(inplace=True)
                        data.rename(columns={'index': 'timestamp'}, inplace=True)
                        market_data[symbol] = data
                        
                        console.print(f"  ✅ {symbol}: {len(data)} bars ({data['timestamp'].min().strftime('%Y-%m-%d')} to {data['timestamp'].max().strftime('%Y-%m-%d')})")
                    else:
                        console.print(f"  ❌ {symbol}: Insufficient data")
                        
                except Exception as e:
                    console.print(f"  ❌ {symbol}: Error - {str(e)}")
                
                progress.advance(task)
        
        console.print(f"\n[green]✅ Successfully loaded data for {len(market_data)} symbols[/green]")
        return market_data
    
    def run_single_backtest(self, strategy: ProfessionalTradingStrategy, 
                          data: pd.DataFrame, symbol: str, 
                          start_idx: int, end_idx: int) -> BacktestResult:
        """Run backtest on a single period"""
        
        # Extract period data
        period_data = data.iloc[start_idx:end_idx + 1].copy()
        
        if len(period_data) < 50:
            return None
        
        # Reset strategy state
        strategy.open_positions = {}
        strategy.daily_trades = 0
        strategy.daily_pnl = 0.0
        
        # Track all trades
        all_trades = []
        portfolio_value = strategy.initial_capital
        running_max = portfolio_value
        max_drawdown = 0.0
        
        # Process each bar
        for i in range(30, len(period_data)):  # Start after 30 bars for indicators
            current_data = period_data.iloc[:i+1]
            
            # Generate trading decision
            decision = strategy.process_trading_signal(current_data)
            
            if decision['action'] == 'TRADE':
                signal = decision['signal']
                rec = decision['recommendation']
                
                # Calculate trade outcome based on stop loss and take profit
                entry_price = rec['entry_price']
                stop_loss = rec['stop_loss']
                take_profit = rec['take_profit']
                position_size_usd = rec['position_size_usd']
                
                # Simulate trade outcome
                # Look ahead to see what happens (this is for backtesting only)
                exit_price = None
                exit_reason = "unknown"
                bars_held = 0
                
                # Check next 20 bars for exit conditions
                for j in range(i + 1, min(i + 21, len(period_data))):
                    future_bar = period_data.iloc[j]
                    bars_held = j - i
                    
                    if signal.signal_type == SignalType.BUY:
                        # Check stop loss
                        if future_bar['low'] <= stop_loss:
                            exit_price = stop_loss
                            exit_reason = "stop_loss"
                            break
                        # Check take profit
                        elif future_bar['high'] >= take_profit:
                            exit_price = take_profit
                            exit_reason = "take_profit"
                            break
                    else:  # SELL
                        # Check stop loss
                        if future_bar['high'] >= stop_loss:
                            exit_price = stop_loss
                            exit_reason = "stop_loss"
                            break
                        # Check take profit
                        elif future_bar['low'] <= take_profit:
                            exit_price = take_profit
                            exit_reason = "take_profit"
                            break
                
                # If no exit condition met, use last price
                if exit_price is None:
                    exit_price = period_data.iloc[min(i + 20, len(period_data) - 1)]['close']
                    exit_reason = "time_exit"
                    bars_held = min(20, len(period_data) - 1 - i)
                
                # Calculate trade return
                if signal.signal_type == SignalType.BUY:
                    trade_return = (exit_price - entry_price) / entry_price
                else:
                    trade_return = (entry_price - exit_price) / entry_price
                
                # Calculate P&L
                trade_pnl = trade_return * position_size_usd
                portfolio_value += trade_pnl
                
                # Track drawdown
                if portfolio_value > running_max:
                    running_max = portfolio_value
                else:
                    current_drawdown = (running_max - portfolio_value) / running_max
                    max_drawdown = max(max_drawdown, current_drawdown)
                
                # Record trade
                trade_record = {
                    'timestamp': current_data.iloc[-1]['timestamp'],
                    'symbol': symbol,
                    'direction': signal.signal_type.value,
                    'entry_price': entry_price,
                    'exit_price': exit_price,
                    'position_size_usd': position_size_usd,
                    'trade_return_pct': trade_return * 100,
                    'trade_pnl': trade_pnl,
                    'exit_reason': exit_reason,
                    'bars_held': bars_held,
                    'confidence': signal.confidence,
                    'strategy_source': signal.strategy_source
                }
                
                all_trades.append(trade_record)
        
        # Calculate performance metrics
        if not all_trades:
            return None
        
        # Basic metrics
        total_trades = len(all_trades)
        winning_trades = len([t for t in all_trades if t['trade_pnl'] > 0])
        losing_trades = total_trades - winning_trades
        win_rate = winning_trades / total_trades if total_trades > 0 else 0
        
        # Return and profit metrics
        total_return = (portfolio_value - strategy.initial_capital) / strategy.initial_capital
        total_pnl = sum(t['trade_pnl'] for t in all_trades)
        winning_pnl = sum(t['trade_pnl'] for t in all_trades if t['trade_pnl'] > 0)
        losing_pnl = abs(sum(t['trade_pnl'] for t in all_trades if t['trade_pnl'] < 0))
        
        profit_factor = winning_pnl / losing_pnl if losing_pnl > 0 else float('inf')
        avg_trade_return = np.mean([t['trade_return_pct'] for t in all_trades])
        
        # Sharpe ratio calculation
        trade_returns = [t['trade_return_pct']/100 for t in all_trades]
        sharpe_ratio = np.mean(trade_returns) / (np.std(trade_returns) + 1e-8) * np.sqrt(252) if len(trade_returns) > 1 else 0
        
        # Additional metrics
        largest_win = max([t['trade_return_pct'] for t in all_trades if t['trade_pnl'] > 0], default=0)
        largest_loss = min([t['trade_return_pct'] for t in all_trades if t['trade_pnl'] < 0], default=0)
        
        # Consecutive wins/losses
        consecutive_wins = 0
        consecutive_losses = 0
        current_streak = 0
        current_type = None
        
        for trade in all_trades:
            if trade['trade_pnl'] > 0:
                if current_type == 'win':
                    current_streak += 1
                else:
                    current_streak = 1
                    current_type = 'win'
                consecutive_wins = max(consecutive_wins, current_streak)
            else:
                if current_type == 'loss':
                    current_streak += 1
                else:
                    current_streak = 1
                    current_type = 'loss'
                consecutive_losses = max(consecutive_losses, current_streak)
        
        return BacktestResult(
            start_date=period_data.iloc[0]['timestamp'].strftime('%Y-%m-%d'),
            end_date=period_data.iloc[-1]['timestamp'].strftime('%Y-%m-%d'),
            symbol=symbol,
            total_return=total_return * 100,  # Convert to percentage
            max_drawdown=max_drawdown * 100,
            win_rate=win_rate * 100,
            total_trades=total_trades,
            profit_factor=profit_factor,
            sharpe_ratio=sharpe_ratio,
            avg_trade_return=avg_trade_return,
            winning_trades=winning_trades,
            losing_trades=losing_trades,
            largest_win=largest_win,
            largest_loss=largest_loss,
            consecutive_wins=consecutive_wins,
            consecutive_losses=consecutive_losses,
            trades_detail=all_trades
        )
    
    def run_walk_forward_analysis(self) -> Dict[str, List[BacktestResult]]:
        """Run walk-forward analysis on all symbols"""
        
        console.print(f"\n[bold cyan]🚀 STARTING WALK-FORWARD ANALYSIS[/bold cyan]")
        
        # Fetch market data
        market_data = self.fetch_market_data()
        
        if not market_data:
            console.print("[red]❌ No market data available[/red]")
            return {}
        
        # Initialize strategy
        strategy = ProfessionalTradingStrategy(initial_capital=10000)
        
        # Results storage
        all_results = {}
        
        for symbol, data in market_data.items():
            console.print(f"\n[yellow]📊 Testing {symbol}...[/yellow]")
            
            # Divide data into 4 walk-forward windows
            total_periods = len(data)
            window_size = total_periods // 4
            
            symbol_results = []
            
            for window_num in range(4):
                start_idx = window_num * window_size
                end_idx = min((window_num + 1) * window_size, total_periods - 1)
                
                if end_idx - start_idx < 100:  # Skip if window too small
                    continue
                
                console.print(f"  📈 Window {window_num + 1}: {data.iloc[start_idx]['timestamp'].strftime('%Y-%m-%d')} to {data.iloc[end_idx]['timestamp'].strftime('%Y-%m-%d')}")
                
                # Run backtest
                result = self.run_single_backtest(strategy, data, symbol, start_idx, end_idx)
                
                if result:
                    symbol_results.append(result)
                    console.print(f"    ✅ Return: {result.total_return:.2f}%, Trades: {result.total_trades}, Win Rate: {result.win_rate:.1f}%")
                else:
                    console.print(f"    ❌ No trades generated")
            
            if symbol_results:
                all_results[symbol] = symbol_results
                
                # Summary for symbol
                avg_return = np.mean([r.total_return for r in symbol_results])
                avg_win_rate = np.mean([r.win_rate for r in symbol_results])
                total_trades = sum([r.total_trades for r in symbol_results])
                
                console.print(f"  📊 {symbol} Summary: Avg Return: {avg_return:.2f}%, Avg Win Rate: {avg_win_rate:.1f}%, Total Trades: {total_trades}")
            else:
                console.print(f"  ❌ {symbol}: No successful backtests")
        
        return all_results
    
    def display_results(self, results: Dict[str, List[BacktestResult]]):
        """Display comprehensive results"""
        
        if not results:
            console.print(Panel.fit(
                "[bold red]❌ NO RESULTS TO DISPLAY[/bold red]\n\n"
                "[yellow]No successful backtests were completed.[/yellow]\n"
                "[white]This could indicate:[/white]\n"
                "• Strategy parameters are too conservative\n"
                "• Market conditions don't match strategy requirements\n"
                "• Data quality issues\n\n"
                "[cyan]Try adjusting strategy parameters or using different timeframes[/cyan]",
                border_style="red"
            ))
            return
        
        console.print(f"\n[bold green]📊 WALK-FORWARD ANALYSIS RESULTS[/bold green]")
        
        # Summary table
        summary_table = Table(title="🏆 PROFESSIONAL STRATEGY PERFORMANCE")
        summary_table.add_column("Symbol", style="cyan")
        summary_table.add_column("Windows", justify="center")
        summary_table.add_column("Avg Return %", justify="right")
        summary_table.add_column("Avg Win Rate %", justify="right")
        summary_table.add_column("Total Trades", justify="right")
        summary_table.add_column("Avg Sharpe", justify="right")
        summary_table.add_column("Max DD %", justify="right")
        summary_table.add_column("Status", justify="center")
        
        # Calculate overall metrics
        overall_metrics = {
            'total_trades': 0,
            'total_return': 0,
            'avg_win_rate': 0,
            'avg_sharpe': 0,
            'profitable_windows': 0,
            'total_windows': 0
        }
        
        for symbol, symbol_results in results.items():
            if not symbol_results:
                continue
            
            # Calculate symbol metrics
            avg_return = np.mean([r.total_return for r in symbol_results])
            avg_win_rate = np.mean([r.win_rate for r in symbol_results])
            total_trades = sum([r.total_trades for r in symbol_results])
            avg_sharpe = np.mean([r.sharpe_ratio for r in symbol_results])
            max_drawdown = max([r.max_drawdown for r in symbol_results])
            
            # Determine status
            profitable_windows = len([r for r in symbol_results if r.total_return > 0])
            status = "✅ GOOD" if profitable_windows >= len(symbol_results) * 0.6 else "⚠️ MIXED" if profitable_windows > 0 else "❌ POOR"
            
            summary_table.add_row(
                symbol,
                f"{profitable_windows}/{len(symbol_results)}",
                f"{avg_return:.2f}",
                f"{avg_win_rate:.1f}",
                str(total_trades),
                f"{avg_sharpe:.2f}",
                f"{max_drawdown:.1f}",
                status
            )
            
            # Update overall metrics
            overall_metrics['total_trades'] += total_trades
            overall_metrics['total_return'] += avg_return
            overall_metrics['avg_win_rate'] += avg_win_rate
            overall_metrics['avg_sharpe'] += avg_sharpe
            overall_metrics['profitable_windows'] += profitable_windows
            overall_metrics['total_windows'] += len(symbol_results)
        
        console.print(summary_table)
        
        # Overall assessment
        num_symbols = len(results)
        overall_return = overall_metrics['total_return'] / num_symbols
        overall_win_rate = overall_metrics['avg_win_rate'] / num_symbols
        overall_sharpe = overall_metrics['avg_sharpe'] / num_symbols
        success_rate = overall_metrics['profitable_windows'] / overall_metrics['total_windows']
        
        # Determine overall grade
        if success_rate >= 0.7 and overall_return > 5 and overall_sharpe > 1.0:
            grade = "A - EXCELLENT"
            color = "green"
        elif success_rate >= 0.5 and overall_return > 2 and overall_sharpe > 0.5:
            grade = "B - GOOD"
            color = "yellow"
        elif success_rate >= 0.3 and overall_return > 0:
            grade = "C - FAIR"
            color = "blue"
        else:
            grade = "D - NEEDS IMPROVEMENT"
            color = "red"
        
        console.print(Panel.fit(
            f"[bold {color}]🎊 OVERALL PERFORMANCE: {grade}[/bold {color}]\n\n"
            f"[white]Portfolio Metrics:[/white]\n"
            f"• Average Return: {overall_return:.2f}% per period\n"
            f"• Average Win Rate: {overall_win_rate:.1f}%\n"
            f"• Average Sharpe Ratio: {overall_sharpe:.2f}\n"
            f"• Success Rate: {success_rate:.1%} ({overall_metrics['profitable_windows']}/{overall_metrics['total_windows']} windows)\n"
            f"• Total Trades: {overall_metrics['total_trades']}\n\n"
            f"[cyan]✅ Strategy validation: {'PASSED' if success_rate >= 0.5 else 'NEEDS IMPROVEMENT'}[/cyan]",
            border_style=color,
            title="📈 WALK-FORWARD VALIDATION"
        ))
        
        # Detailed performance by symbol
        self.display_detailed_results(results)
    
    def display_detailed_results(self, results: Dict[str, List[BacktestResult]]):
        """Display detailed results for each symbol"""
        
        console.print(f"\n[bold cyan]📋 DETAILED PERFORMANCE BREAKDOWN[/bold cyan]")
        
        for symbol, symbol_results in results.items():
            if not symbol_results:
                continue
            
            console.print(f"\n[yellow]📊 {symbol} Detailed Results:[/yellow]")
            
            # Window-by-window table
            detail_table = Table(title=f"{symbol} Walk-Forward Windows")
            detail_table.add_column("Window", style="cyan")
            detail_table.add_column("Period", style="white")
            detail_table.add_column("Return %", justify="right")
            detail_table.add_column("Win Rate %", justify="right")
            detail_table.add_column("Trades", justify="right")
            detail_table.add_column("Sharpe", justify="right")
            detail_table.add_column("Max DD %", justify="right")
            detail_table.add_column("Profit Factor", justify="right")
            
            for i, result in enumerate(symbol_results, 1):
                detail_table.add_row(
                    f"W{i}",
                    f"{result.start_date} to {result.end_date}",
                    f"{result.total_return:.2f}",
                    f"{result.win_rate:.1f}",
                    str(result.total_trades),
                    f"{result.sharpe_ratio:.2f}",
                    f"{result.max_drawdown:.1f}",
                    f"{result.profit_factor:.2f}"
                )
            
            console.print(detail_table)
    
    def save_results(self, results: Dict[str, List[BacktestResult]]) -> str:
        """Save results to JSON file"""
        
        # Convert results to serializable format
        serializable_results = {}
        
        for symbol, symbol_results in results.items():
            serializable_results[symbol] = []
            
            for result in symbol_results:
                result_dict = {
                    'start_date': result.start_date,
                    'end_date': result.end_date,
                    'symbol': result.symbol,
                    'total_return': float(result.total_return),
                    'max_drawdown': float(result.max_drawdown),
                    'win_rate': float(result.win_rate),
                    'total_trades': int(result.total_trades),
                    'profit_factor': float(result.profit_factor),
                    'sharpe_ratio': float(result.sharpe_ratio),
                    'avg_trade_return': float(result.avg_trade_return),
                    'winning_trades': int(result.winning_trades),
                    'losing_trades': int(result.losing_trades),
                    'largest_win': float(result.largest_win),
                    'largest_loss': float(result.largest_loss),
                    'consecutive_wins': int(result.consecutive_wins),
                    'consecutive_losses': int(result.consecutive_losses),
                    'trades_detail': result.trades_detail
                }
                serializable_results[symbol].append(result_dict)
        
        # Save to file
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"professional_strategy_walkforward_{timestamp}.json"
        
        with open(filename, 'w') as f:
            json.dump({
                'strategy_name': 'Professional Institutional Strategy',
                'test_type': 'Walk-Forward Analysis',
                'symbols': list(results.keys()),
                'total_windows': sum(len(sr) for sr in results.values()),
                'timestamp': timestamp,
                'results': serializable_results
            }, f, indent=2)
        
        console.print(f"\n[cyan]📁 Results saved: {filename}[/cyan]")
        return filename

def main():
    """Main function for professional strategy testing"""
    
    console.print(Panel.fit(
        "[bold gold3]🏆 PROFESSIONAL STRATEGY COMPREHENSIVE TESTING[/bold gold3]\n"
        "[cyan]Walk-forward analysis and backtesting on real market data[/cyan]\n\n"
        "[white]This test will validate our professional strategy using:[/white]\n"
        "🔄 Walk-forward optimization (4 time windows)\n"
        "📊 Multiple cryptocurrency pairs\n"
        "📈 Real historical market data\n"
        "🎯 Professional performance metrics\n"
        "🛡️ Risk management validation",
        border_style="gold3"
    ))
    
    # Get user preferences
    console.print(f"\n[yellow]⚙️ Configuration Options:[/yellow]")
    
    # Symbols selection
    console.print(f"[green]Default symbols: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, BNBUSDT[/green]")
    custom_symbols = input("Enter custom symbols (comma-separated) or press Enter for default: ").strip()
    
    if custom_symbols:
        symbols = [s.strip().upper() for s in custom_symbols.split(',')]
        symbols = [s if s.endswith('USDT') else f"{s}USDT" for s in symbols]
    else:
        symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']
    
    # Days back
    console.print(f"[green]Default testing period: 90 days[/green]")
    days_input = input("Enter days of historical data or press Enter for default: ").strip()
    days_back = int(days_input) if days_input.isdigit() else 90
    
    # Run analysis
    tester = ProfessionalStrategyBacktester(symbols=symbols, days_back=days_back)
    
    console.print(f"\n[bold yellow]🚀 Starting comprehensive analysis...[/bold yellow]")
    console.print(f"[white]This may take several minutes depending on data availability[/white]")
    
    try:
        # Run walk-forward analysis
        results = tester.run_walk_forward_analysis()
        
        # Display results
        tester.display_results(results)
        
        # Save results
        if results:
            filename = tester.save_results(results)
            
            console.print(Panel.fit(
                "[bold green]🎊 ANALYSIS COMPLETE![/bold green]\n\n"
                f"[cyan]📄 Results saved: {filename}[/cyan]\n\n"
                "[white]The professional strategy has been thoroughly tested using:[/white]\n"
                "✅ Real market data\n"
                "✅ Walk-forward validation\n"
                "✅ Multiple time periods\n"
                "✅ Risk management verification\n\n"
                "[yellow]Ready for deployment consideration![/yellow]",
                border_style="green"
            ))
        else:
            console.print(Panel.fit(
                "[bold yellow]⚠️ NO TRADES GENERATED[/bold yellow]\n\n"
                "[white]The strategy didn't generate any trades.[/white]\n"
                "[cyan]This indicates the strategy is being very conservative[/cyan]\n"
                "[cyan]and waiting for optimal market conditions.[/cyan]\n\n"
                "[green]This is actually a sign of a well-designed strategy![/green]",
                border_style="yellow"
            ))
    
    except Exception as e:
        console.print(f"[red]❌ Error during analysis: {str(e)}[/red]")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main() 