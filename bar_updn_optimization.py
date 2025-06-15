#!/usr/bin/env python3
"""
BarUpDn Strategy Parameter Optimization and Visualization
"""

import itertools
import json
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
import pandas as pd
import numpy as np
from rich.console import Console
from rich.progress import Progress, BarColumn, TextColumn, TimeElapsedColumn
from rich.table import Table
from rich.panel import Panel
from pathlib import Path
import concurrent.futures
from dataclasses import asdict

from bar_updn_extreme_backtest import (
    BarUpDnStrategy, BarUpDnBacktester, DataFetcher, 
    BacktestResult, TradeResult, run_extreme_backtest
)
from enhanced_data_fetcher import EnhancedDataFetcher
from enhanced_html_generator import generate_enhanced_html_report

console = Console()

class ParameterOptimizer:
    """Parameter optimization for BarUpDn strategy"""
    
    def __init__(self, symbols: List[str], days_back: int = 14, 
                 api_key: str = None, api_secret: str = None):
        self.symbols = symbols
        self.days_back = days_back
        self.api_key = api_key
        self.api_secret = api_secret
        self.fetcher = EnhancedDataFetcher(api_key, api_secret)
        
        # Pre-fetch data for all symbols using enhanced caching
        self.data_cache = {}
        self._fetch_all_data()
    
    def _fetch_all_data(self):
        """Pre-fetch data for all symbols using enhanced caching"""
        console.print("[cyan]📊 Pre-fetching data with intelligent caching...[/cyan]")
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.days_back)
        
        # Show cache statistics first
        self.fetcher.get_cache_summary()
        
        for symbol in self.symbols:
            try:
                df = self.fetcher.fetch_data(symbol, start_date, end_date)
                self.data_cache[symbol] = df
            except Exception as e:
                console.print(f"[red]✗ Failed to fetch {symbol}: {str(e)}[/red]")
                self.data_cache[symbol] = None
    
    def optimize_parameters(self, 
                          sl_range: List[float] = [2.0, 3.5, 5.0],
                          trailing_range: List[float] = [0.5, 1.0, 1.5],  # Now percentages
                          position_range: List[float] = [5.0, 10.0, 15.0],
                          loss_limit_range: List[float] = [1.5, 2.0, 2.5]) -> Dict:
        """
        Optimize strategy parameters across all combinations
        """
        
        # Generate parameter combinations
        param_combinations = list(itertools.product(
            sl_range, trailing_range, position_range, loss_limit_range
        ))
        
        console.print(f"[bold cyan]Testing {len(param_combinations)} parameter combinations across {len(self.symbols)} symbols...[/bold cyan]")
        
        all_results = []
        best_overall = None
        best_overall_score = -float('inf')
        
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
        ) as progress:
            
            task = progress.add_task("Optimizing parameters...", total=len(param_combinations))
            
            for sl, trailing, position, loss_limit in param_combinations:
                combo_results = []
                
                # Test this parameter combination on all symbols
                for symbol in self.symbols:
                    if self.data_cache[symbol] is None:
                        continue
                    
                    try:
                        # Create strategy with these parameters
                        strategy = BarUpDnStrategy(
                            sl_percent=sl,
                            trailing_stop_percent=trailing,  # Now percentage
                            position_size_percent=position,
                            max_intraday_loss_percent=loss_limit,
                            min_hold_minutes=15  # Add minimum hold time
                        )
                        
                        # Run backtest
                        backtester = BarUpDnBacktester(initial_capital=10000)
                        backtester.strategy = strategy
                        result = backtester.run_backtest(self.data_cache[symbol], symbol, show_progress=False)
                        
                        # Store raw OHLCV data for candlestick charts
                        result.raw_data = self.data_cache[symbol].copy()
                        
                        # Add parameter info to result
                        result.parameters = {
                            'sl_percent': sl,
                            'trailing_stop_percent': trailing,  # Updated parameter name
                            'position_size_percent': position,
                            'max_intraday_loss_percent': loss_limit
                        }
                        
                        combo_results.append(result)
                        
                    except Exception as e:
                        console.print(f"[red]Error testing {symbol} with params {sl}/{trailing}/{position}/{loss_limit}: {str(e)}[/red]")
                
                # Calculate combined score for this parameter combination
                if combo_results:
                    avg_return = np.mean([r.total_return_percent for r in combo_results])
                    avg_sharpe = np.mean([r.sharpe_ratio for r in combo_results if not np.isnan(r.sharpe_ratio)])
                    avg_win_rate = np.mean([r.win_rate for r in combo_results])
                    avg_drawdown = np.mean([r.max_drawdown for r in combo_results])
                    
                    # Combined score (return * sharpe * win_rate / drawdown)
                    combined_score = (avg_return * (1 + avg_sharpe) * avg_win_rate) / max(avg_drawdown, 1)
                    
                    combo_data = {
                        'parameters': {
                            'sl_percent': sl,
                            'trailing_stop_percent': trailing,  # Updated parameter name
                            'position_size_percent': position,
                            'max_intraday_loss_percent': loss_limit
                        },
                        'results': combo_results,
                        'metrics': {
                            'avg_return_percent': avg_return,
                            'avg_sharpe_ratio': avg_sharpe,
                            'avg_win_rate': avg_win_rate,
                            'avg_drawdown': avg_drawdown,
                            'combined_score': combined_score,
                            'total_trades': sum([r.total_trades for r in combo_results])
                        }
                    }
                    
                    all_results.append(combo_data)
                    
                    # Track best overall
                    if combined_score > best_overall_score:
                        best_overall_score = combined_score
                        best_overall = combo_data
                
                progress.update(task, advance=1)
        
        # Sort results by combined score
        all_results.sort(key=lambda x: x['metrics']['combined_score'], reverse=True)
        
        return {
            'all_results': all_results,
            'best_parameters': best_overall,
            'optimization_summary': {
                'total_combinations_tested': len(param_combinations),
                'symbols_tested': self.symbols,
                'date_range': f"{datetime.now() - timedelta(days=self.days_back)} to {datetime.now()}",
                'best_score': best_overall_score
            }
        }

def display_optimization_results(optimization_results: Dict):
    """Display optimization results in a nice table"""
    
    best = optimization_results['best_parameters']
    all_results = optimization_results['all_results']
    
    # Best parameters table
    console.print(Panel.fit(
        f"[bold green]🏆 BEST PARAMETERS FOUND[/bold green]\n\n"
        f"Stop Loss: {best['parameters']['sl_percent']}%\n"
        f"Trailing Stop: {best['parameters']['trailing_stop_percent']}%\n"
        f"Position Size: {best['parameters']['position_size_percent']}%\n"
        f"Max Daily Loss: {best['parameters']['max_intraday_loss_percent']}%\n\n"
        f"[cyan]Performance:[/cyan]\n"
        f"Avg Return: {best['metrics']['avg_return_percent']:.2f}%\n"
        f"Avg Win Rate: {best['metrics']['avg_win_rate']:.1f}%\n"
        f"Avg Sharpe: {best['metrics']['avg_sharpe_ratio']:.2f}\n"
        f"Combined Score: {best['metrics']['combined_score']:.2f}",
        border_style="green"
    ))
    
    # Top 10 results table
    table = Table(title="Top 10 Parameter Combinations")
    table.add_column("Rank", style="cyan")
    table.add_column("SL%", style="yellow")
    table.add_column("Trail", style="yellow")
    table.add_column("Pos%", style="yellow")
    table.add_column("DayLoss%", style="yellow")
    table.add_column("Avg Return%", style="green")
    table.add_column("Win Rate%", style="green")
    table.add_column("Sharpe", style="green")
    table.add_column("Score", style="bold green")
    
    for i, result in enumerate(all_results[:10], 1):
        params = result['parameters']
        metrics = result['metrics']
        
        table.add_row(
            str(i),
            f"{params['sl_percent']:.1f}",
            f"{params['trailing_stop_percent']:.1f}",  # Updated parameter name
            f"{params['position_size_percent']:.1f}",
            f"{params['max_intraday_loss_percent']:.1f}",
            f"{metrics['avg_return_percent']:.2f}",
            f"{metrics['avg_win_rate']:.1f}",
            f"{metrics['avg_sharpe_ratio']:.2f}",
            f"{metrics['combined_score']:.2f}"
        )
    
    console.print(table)

def calculate_technical_indicators(df):
    """Calculate technical indicators for the BarUpDn strategy"""
    try:
        import talib
    except ImportError:
        console.print("[yellow]⚠️ TA-Lib not installed. Installing basic indicators...[/yellow]")
        # Fallback to basic calculations
        return calculate_basic_indicators(df)
    
    indicators = {}
    
    # MACD (Moving Average Convergence Divergence)
    macd, macd_signal, macd_hist = talib.MACD(df['close'].values)
    indicators['macd'] = {
        'macd': macd.tolist(),
        'signal': macd_signal.tolist(),
        'histogram': macd_hist.tolist()
    }
    
    # RSI (Relative Strength Index)
    rsi = talib.RSI(df['close'].values, timeperiod=14)
    indicators['rsi'] = rsi.tolist()
    
    # Bollinger Bands
    bb_upper, bb_middle, bb_lower = talib.BBANDS(df['close'].values, timeperiod=20)
    indicators['bollinger'] = {
        'upper': bb_upper.tolist(),
        'middle': bb_middle.tolist(),
        'lower': bb_lower.tolist()
    }
    
    # EMAs (Exponential Moving Averages) - key for BarUpDn strategy
    ema_9 = talib.EMA(df['close'].values, timeperiod=9)
    ema_21 = talib.EMA(df['close'].values, timeperiod=21)
    ema_50 = talib.EMA(df['close'].values, timeperiod=50)
    indicators['ema'] = {
        'ema9': ema_9.tolist(),
        'ema21': ema_21.tolist(),
        'ema50': ema_50.tolist()
    }
    
    # Volume indicators
    if 'volume' in df.columns:
        volume_sma = talib.SMA(df['volume'].values, timeperiod=20)
        indicators['volume_sma'] = volume_sma.tolist()
        indicators['volume'] = df['volume'].tolist()
    
    # Stochastic Oscillator
    stoch_k, stoch_d = talib.STOCH(df['high'].values, df['low'].values, df['close'].values)
    indicators['stochastic'] = {
        'k': stoch_k.tolist(),
        'd': stoch_d.tolist()
    }
    
    return indicators

def calculate_basic_indicators(df):
    """Basic indicator calculations without TA-Lib"""
    indicators = {}
    
    # Simple Moving Averages
    df['sma_20'] = df['close'].rolling(window=20).mean()
    df['sma_50'] = df['close'].rolling(window=50).mean()
    
    # Basic RSI calculation
    delta = df['close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    
    # Basic MACD
    ema_12 = df['close'].ewm(span=12).mean()
    ema_26 = df['close'].ewm(span=26).mean()
    macd = ema_12 - ema_26
    macd_signal = macd.ewm(span=9).mean()
    macd_hist = macd - macd_signal
    
    # Bollinger Bands
    bb_period = 20
    bb_std = 2
    bb_middle = df['close'].rolling(window=bb_period).mean()
    bb_std_dev = df['close'].rolling(window=bb_period).std()
    bb_upper = bb_middle + (bb_std_dev * bb_std)
    bb_lower = bb_middle - (bb_std_dev * bb_std)
    
    # Stochastic Oscillator
    stoch_period = 14
    stoch_k_period = 3
    stoch_d_period = 3
    
    low_min = df['low'].rolling(window=stoch_period).min()
    high_max = df['high'].rolling(window=stoch_period).max()
    stoch_k_raw = 100 * (df['close'] - low_min) / (high_max - low_min)
    stoch_k = stoch_k_raw.rolling(window=stoch_k_period).mean()
    stoch_d = stoch_k.rolling(window=stoch_d_period).mean()
    
    indicators = {
        'macd': {
            'macd': macd.fillna(0).tolist(),
            'signal': macd_signal.fillna(0).tolist(),
            'histogram': macd_hist.fillna(0).tolist()
        },
        'rsi': rsi.fillna(50).tolist(),
        'ema': {
            'ema9': df['close'].ewm(span=9).mean().fillna(df['close']).tolist(),
            'ema21': df['close'].ewm(span=21).mean().fillna(df['close']).tolist(),
            'ema50': df['close'].ewm(span=50).mean().fillna(df['close']).tolist()
        },
        'bollinger': {
            'upper': bb_upper.fillna(df['close']).tolist(),
            'middle': bb_middle.fillna(df['close']).tolist(),
            'lower': bb_lower.fillna(df['close']).tolist()
        },
        'stochastic': {
            'k': stoch_k.fillna(50).tolist(),
            'd': stoch_d.fillna(50).tolist()
        }
    }
    
    return indicators

def generate_comprehensive_html_chart(optimization_results: Dict, output_file: str = "bar_updn_analysis.html"):
    """
    Generate a modern, comprehensive HTML chart with enhanced statistics and full-width charts
    """
    
    console.print("[cyan]📊 Generating compact HTML visualization with simplified layout...[/cyan]")
    console.print("[yellow]💡 Compact Features: Simple tables, large charts (700px), minimal design, full-width layout[/yellow]")
    
    # Get best results for visualization
    best_params = optimization_results['best_parameters']
    best_results = best_params['results']
    
    # Enhanced data preparation with comprehensive trade analytics
    chart_data = {
        'symbols': [],
        'equity_curves': {},
        'candlestick_data': {},
        'trades': {},
        'indicators': {},
        'parameters': best_params['parameters'],
        'summary': best_params['metrics'],
        'trade_analytics': {},  # New: comprehensive trade analysis
        'performance_metrics': {}  # New: enhanced performance metrics
    }
    
    def format_trades_for_table(trades_list):
        """Format trades for Apache ECharts-style table"""
        if not trades_list:
            return []
        
        formatted_trades = []
        for i, trade in enumerate(trades_list, 1):
            # Calculate duration
            entry_time = pd.to_datetime(trade['entry_time'])
            exit_time = pd.to_datetime(trade['exit_time'])
            duration = exit_time - entry_time
            
            # Format duration nicely
            if duration.days > 0:
                duration_str = f"{duration.days}d {duration.seconds//3600}h {(duration.seconds%3600)//60}m"
            elif duration.seconds >= 3600:
                duration_str = f"{duration.seconds//3600}h {(duration.seconds%3600)//60}m"
            else:
                duration_str = f"{duration.seconds//60}m {duration.seconds%60}s"
            
            formatted_trades.append({
                'trade_number': i,
                'entry_time': trade['entry_time'],
                'exit_time': trade['exit_time'],
                'side': trade['side'],
                'entry_price': trade['entry_price'],
                'exit_price': trade['exit_price'],
                'pnl': trade['pnl'],
                'pnl_percent': trade['pnl_percent'],
                'total_pnl': trade['total_pnl'],  # Add total P&L
                'exit_reason': trade['exit_reason'],
                'duration': duration_str,
                'quantity': trade.get('quantity', 1),
                'entry_timestamp': trade['entry_timestamp'],
                'exit_timestamp': trade['exit_timestamp']
            })
        
        return formatted_trades
    
    for result in best_results:
        symbol = result.symbol
        chart_data['symbols'].append(symbol)
        
        # Equity curve data for line chart
        equity_df = result.equity_curve.reset_index()
        chart_data['equity_curves'][symbol] = {
            'timestamps': [int(pd.to_datetime(ts).timestamp()) for ts in equity_df['timestamp']],
            'equity': equity_df['equity'].tolist(),
            'initial_capital': result.initial_capital,
            'final_capital': result.final_capital,
            'return_percent': result.total_return_percent
        }
        
        # Enhanced trade analytics
        trades_data = []
        running_total_pnl = 0
        monthly_pnl = {}
        trade_durations = []
        win_streak = 0
        loss_streak = 0
        max_win_streak = 0
        max_loss_streak = 0
        current_win_streak = 0
        current_loss_streak = 0
        
        for trade in result.trades:
            running_total_pnl += trade.pnl
            
            # Calculate trade duration
            duration_minutes = (trade.exit_time - trade.entry_time).total_seconds() / 60
            trade_durations.append(duration_minutes)
            
            # Track win/loss streaks
            if trade.pnl > 0:
                current_win_streak += 1
                current_loss_streak = 0
                max_win_streak = max(max_win_streak, current_win_streak)
            else:
                current_loss_streak += 1
                current_win_streak = 0
                max_loss_streak = max(max_loss_streak, current_loss_streak)
            
            # Monthly PnL tracking
            month_key = trade.entry_time.strftime('%Y-%m')
            if month_key not in monthly_pnl:
                monthly_pnl[month_key] = 0
            monthly_pnl[month_key] += trade.pnl
            
            trades_data.append({
                'entry_time': trade.entry_time.strftime('%Y-%m-%d %H:%M:%S'),
                'exit_time': trade.exit_time.strftime('%Y-%m-%d %H:%M:%S'),
                'side': trade.side,
                'entry_price': trade.entry_price,
                'exit_price': trade.exit_price,
                'pnl': trade.pnl,
                'pnl_percent': trade.pnl_percent,
                'total_pnl': running_total_pnl,
                'exit_reason': trade.exit_reason,
                'quantity': trade.quantity if hasattr(trade, 'quantity') else 1,
                'entry_timestamp': int(trade.entry_time.timestamp()),
                'exit_timestamp': int(trade.exit_time.timestamp()),
                'duration_minutes': duration_minutes
            })
        
        # Comprehensive trade analytics
        chart_data['trade_analytics'][symbol] = {
            'avg_trade_duration': np.mean(trade_durations) if trade_durations else 0,
            'median_trade_duration': np.median(trade_durations) if trade_durations else 0,
            'max_win_streak': max_win_streak,
            'max_loss_streak': max_loss_streak,
            'monthly_pnl': monthly_pnl,
            'win_trades': [t for t in trades_data if t['pnl'] > 0],
            'loss_trades': [t for t in trades_data if t['pnl'] <= 0],
            'avg_win': np.mean([t['pnl'] for t in trades_data if t['pnl'] > 0]) if any(t['pnl'] > 0 for t in trades_data) else 0,
            'avg_loss': np.mean([t['pnl'] for t in trades_data if t['pnl'] <= 0]) if any(t['pnl'] <= 0 for t in trades_data) else 0,
            'largest_win': max([t['pnl'] for t in trades_data]) if trades_data else 0,
            'largest_loss': min([t['pnl'] for t in trades_data]) if trades_data else 0
        }
        
        # Enhanced performance metrics
        chart_data['performance_metrics'][symbol] = {
            'total_trades': result.total_trades,
            'win_rate': result.win_rate,
            'profit_factor': (sum(t['pnl'] for t in trades_data if t['pnl'] > 0) / 
                            abs(sum(t['pnl'] for t in trades_data if t['pnl'] <= 0))) if any(t['pnl'] <= 0 for t in trades_data) else 2.0,
            'sharpe_ratio': result.sharpe_ratio if hasattr(result, 'sharpe_ratio') and not np.isnan(result.sharpe_ratio) else 0,
            'max_drawdown': result.max_drawdown,
            'total_return': result.total_return_percent,
            'calmar_ratio': result.total_return_percent / result.max_drawdown if result.max_drawdown > 0 else 0,
            'avg_trade_return': result.total_return_percent / result.total_trades if result.total_trades > 0 else 0
        }
        
        # Candlestick data from raw OHLCV data
        if hasattr(result, 'raw_data') and result.raw_data is not None:
            ohlcv = result.raw_data.copy()
            ohlcv['timestamp'] = pd.to_datetime(ohlcv.index)
            candlestick_data = []
            
            for _, row in ohlcv.iterrows():
                candlestick_data.append({
                    'time': int(row['timestamp'].timestamp()),
                    'open': float(row['open']),
                    'high': float(row['high']),
                    'low': float(row['low']),
                    'close': float(row['close']),
                    'volume': float(row.get('volume', 0))
                })
            
            chart_data['candlestick_data'][symbol] = candlestick_data
            
            # Calculate technical indicators
            try:
                indicators = calculate_technical_indicators(ohlcv)
                chart_data['indicators'][symbol] = indicators
                console.print(f"[green]✓ Technical indicators calculated for {symbol}[/green]")
            except Exception as e:
                console.print(f"[yellow]⚠️ Could not calculate indicators for {symbol}: {str(e)}[/yellow]")
                chart_data['indicators'][symbol] = {}
        
        # Store formatted trades for table display
        chart_data['trades'][symbol] = format_trades_for_table(trades_data)
    
    # Generate modern HTML with enhanced layout and analytics
    html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BarUpDn Strategy Analysis - Enhanced 2025</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/dist/ag-grid-community.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/styles/ag-grid.css">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/styles/ag-theme-alpine.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            background: #1a1a1a;
            color: #e0e0e0;
            line-height: 1.4;
            font-size: 14px;
        }}
        
        body.light-mode {{
            background: #f8f9fa;
            color: #333;
        }}
        
        .container {{
            width: 100%;
            margin: 0;
            padding: 5px;
            background: #2d2d2d;
        }}
        
        .light-mode .container {{
            background: white;
        }}
        
        .header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px;
            padding: 8px 15px;
            background: #3a3a3a;
            border-bottom: 1px solid #555;
            position: relative;
        }}
        
        .light-mode .header {{
            background: #f8f9fa;
            border-bottom-color: #dee2e6;
        }}
        
        .header-left {{
            display: flex;
            align-items: center;
            gap: 15px;
        }}
        
        .header h1 {{
            font-size: 1.3rem;
            font-weight: 600;
            margin: 0;
            color: #fff;
        }}
        
        .light-mode .header h1 {{
            color: #333;
        }}
        
        .header p {{
            font-size: 0.8rem;
            color: #ccc;
            margin: 0;
        }}
        
        .light-mode .header p {{
            color: #666;
        }}
        
        .header-right {{
            display: flex;
            align-items: center;
            gap: 10px;
        }}
        
        .dark-mode-toggle {{
            background: #007bff;
            border: none;
            color: white;
            padding: 5px 10px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }}
        
        .light-mode .dark-mode-toggle {{
            background: #6c757d;
        }}
        
        /* Compact Vertical Statistics Table */
        .symbol-stats {{
            width: 280px;
            border-collapse: collapse;
            margin: 5px 0;
            font-size: 11px;
        }}
        
        .symbol-stats th,
        .symbol-stats td {{
            padding: 3px 6px;
            text-align: left;
            border-bottom: 1px solid #dee2e6;
        }}
        
        .symbol-stats th {{
            background: #3a3a3a;
            font-weight: 600;
            font-size: 10px;
            width: 120px;
            border-bottom-color: #555;
        }}
        
        .light-mode .symbol-stats th {{
            background: #f8f9fa;
            border-bottom-color: #dee2e6;
        }}
        
        .symbol-stats td {{
            font-weight: 500;
            width: 80px;
            border-bottom-color: #555;
        }}
        
        .light-mode .symbol-stats td {{
            border-bottom-color: #dee2e6;
        }}
        
        /* Side by side layout for analytics */
        .analytics-container {{
            display: flex;
            gap: 20px;
            padding: 5px 8px;
            flex-wrap: wrap;
        }}
        
        .analytics-section {{
            flex: 1;
            min-width: 300px;
        }}
        
        .symbol-stats-container {{
            flex: 0 0 300px;
        }}
        
        .analytics-section h3,
        .symbol-stats-container h3 {{
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 10px;
            color: #fff;
        }}
        
        .light-mode .analytics-section h3,
        .light-mode .symbol-stats-container h3 {{
            color: #333;
        }}
        
        .positive {{
            color: #28a745;
            font-weight: 600;
        }}
        
        .negative {{
            color: #dc3545;
            font-weight: 600;
        }}
        
        .neutral {{
            color: #007bff;
            font-weight: 600;
        }}
        
        .chart-container {{
            margin: 5px 0;
            background: #2d2d2d;
            border: 1px solid #555;
        }}
        
        .light-mode .chart-container {{
            background: white;
            border-color: #dee2e6;
        }}
        
        .chart-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 5px 8px;
            background: #3a3a3a;
            border-bottom: 1px solid #555;
        }}
        
        .light-mode .chart-header {{
            background: #f8f9fa;
            border-bottom-color: #dee2e6;
        }}
        
        .chart-header h2 {{
            font-size: 1.1rem;
            font-weight: 600;
            color: #fff;
            margin: 0;
        }}
        
        .light-mode .chart-header h2 {{
            color: #333;
        }}
        
        .fullscreen-btn {{
            background: #007bff;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }}
        
        .light-mode .fullscreen-btn {{
            background: #6c757d;
        }}
        
        .symbol-tabs {{
            display: flex;
            margin: 5px 8px;
            gap: 3px;
            flex-wrap: wrap;
        }}
        
        .tab {{
            padding: 4px 8px;
            cursor: pointer;
            border: 1px solid #555;
            background: #3a3a3a;
            font-size: 12px;
            color: #ccc;
            border-radius: 3px;
        }}
        
        .light-mode .tab {{
            background: #f8f9fa;
            border-color: #dee2e6;
            color: #495057;
        }}
        
        .tab:hover {{
            background: #4a4a4a;
        }}
        
        .light-mode .tab:hover {{
            background: #e9ecef;
        }}
        
        .tab.active {{
            background: #6c757d;
            color: white;
            border-color: #6c757d;
        }}
        
        .light-mode .tab.active {{
            background: #007bff;
            border-color: #007bff;
        }}
        
        /* Compact Chart Sizing - FULL WIDTH */
        .chart-content {{
            padding: 0;
            width: 100%;
        }}
        
        #symbol-content {{
            width: 100%;
            height: 100%;
            padding: 5px;
        }}
        
        #symbol-content > div {{
            width: 100% !important;
        }}
        
        [id*="candlestick-chart"] {{
            width: 100% !important;
            height: 900px !important;
        }}
        
        .ag-theme-alpine {{
            height: 500px !important;
            width: 100% !important;
            font-size: 12px;
        }}
        
        .light-mode .ag-theme-alpine {{
            --ag-background-color: #ffffff;
            --ag-header-background-color: #f8f9fa;
            --ag-odd-row-background-color: #f8f9fa;
            --ag-row-hover-color: #e9ecef;
            --ag-selected-row-background-color: #007bff;
            --ag-foreground-color: #333;
            --ag-header-foreground-color: #333;
            --ag-border-color: #dee2e6;
        }}
        
        .ag-theme-alpine {{
            --ag-background-color: #2d2d2d;
            --ag-header-background-color: #3a3a3a;
            --ag-odd-row-background-color: #333;
            --ag-row-hover-color: #4a4a4a;
            --ag-selected-row-background-color: #007bff;
            --ag-foreground-color: #e0e0e0;
            --ag-header-foreground-color: #fff;
            --ag-border-color: #555;
        }}
        
        /* Compact Indicator Controls */
        .indicator-controls {{
            display: flex;
            gap: 3px;
            margin: 5px 8px;
            flex-wrap: wrap;
        }}
        
        .indicator-btn {{
            background: #3a3a3a;
            border: 1px solid #555;
            color: #ccc;
            padding: 3px 6px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 10px;
        }}
        
        .light-mode .indicator-btn {{
            background: #f8f9fa;
            border-color: #dee2e6;
            color: #495057;
        }}
        
        .indicator-btn:hover {{
            background: #4a4a4a;
        }}
        
        .light-mode .indicator-btn:hover {{
            background: #e9ecef;
        }}
        
        .indicator-btn.active {{
            background: #6c757d;
            color: white;
            border-color: #6c757d;
        }}
        
        .light-mode .indicator-btn.active {{
            background: #007bff;
            border-color: #007bff;
        }}
        
        .trade-info {{
            background: #1e3a8a;
            padding: 5px 8px;
            margin: 5px 8px;
            font-size: 11px;
            display: none;
            border: 1px solid #3b82f6;
            color: #e0e0e0;
        }}
        
        .light-mode .trade-info {{
            background: #e3f2fd;
            border-color: #bbdefb;
            color: inherit;
        }}
        
        .fullscreen-overlay {{
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.95);
            z-index: 10000;
            padding: 20px;
            box-sizing: border-box;
        }}
        
        .fullscreen-content {{
            width: 100%;
            height: 100%;
            background: #2d3748;
            padding: 20px;
            position: relative;
            display: flex;
            flex-direction: column;
            border-radius: 15px;
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
        }}
        
        .light-mode .fullscreen-content {{
            background: white;
        }}
        
        .fullscreen-close {{
            position: absolute;
            top: 15px;
            right: 20px;
            background: #ef4444;
            color: white;
            border: none;
            width: 35px;
            height: 35px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 18px;
            z-index: 10001;
            transition: all 0.3s ease;
        }}
        
        .fullscreen-close:hover {{
            background: #dc2626;
            transform: scale(1.1);
        }}
        
        .fullscreen-chart {{
            flex: 1;
            min-height: 0;
        }}
        
        @media (max-width: 768px) {{
            .container {{
                margin: 2px;
                padding: 2px;
            }}
            
            .header {{
                padding: 5px;
            }}
            
            .header h1 {{
                font-size: 1.1rem;
            }}
            
            .chart-header {{
                padding: 3px 5px;
            }}
            
            .symbol-tabs {{
                margin: 3px 5px;
            }}
            
            [id*="candlestick-chart"] {{
                height: 600px !important;
            }}
            
            .ag-theme-alpine {{
                height: 350px !important;
            }}
            
            .symbol-stats {{
                width: 100%;
                float: none;
                margin-bottom: 10px;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-left">
                <h1>BarUpDn Strategy Analysis</h1>
                <p>Enhanced Trading Analytics Dashboard - Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
            </div>
            <div class="header-right">
                <button class="fullscreen-btn" onclick="openFullscreen('symbol-content', 'Trading Analysis')">
                    Fullscreen
                </button>
                <button class="dark-mode-toggle" onclick="toggleDarkMode()">☀️ Light Mode</button>
            </div>
        </div>

        <div class="chart-container">
            <div class="symbol-tabs">
                {' '.join([f'<button class="tab" onclick="showSymbol(\'{symbol}\', this)">{symbol}</button>' for symbol in chart_data['symbols']])}
            </div>
            
            <div class="indicator-controls">
                <button class="indicator-btn active" onclick="toggleIndicator('candlestick', this)">Candlesticks</button>
                <button class="indicator-btn" onclick="toggleIndicator('ema', this)">EMA</button>
                <button class="indicator-btn" onclick="toggleIndicator('bollinger', this)">Bollinger</button>
                <button class="indicator-btn" onclick="toggleIndicator('macd', this)">MACD</button>
                <button class="indicator-btn" onclick="toggleIndicator('rsi', this)">RSI</button>
                <button class="indicator-btn" onclick="toggleIndicator('stochastic', this)">Stochastic</button>
                <button class="indicator-btn" onclick="toggleIndicator('volume', this)">Volume</button>
            </div>
            
            <div class="trade-info" id="trade-info">
                <strong>Selected Trade:</strong> <span id="trade-details">Click on a trade row to see details</span>
            </div>
            
            <div class="chart-content">
                <div id="symbol-content">
                    <!-- Will be populated by Apache ECharts -->
                </div>
            </div>
        </div>
        
        <!-- Trade Analytics Section -->
        <div class="chart-container">
            <div id="trade-analytics-content">
                <!-- Will be populated by JavaScript -->
            </div>
        </div>
        
        <!-- Fullscreen Overlay -->
        <div id="fullscreen-overlay" class="fullscreen-overlay">
            <div class="fullscreen-content">
                <button class="fullscreen-close" onclick="closeFullscreen()">×</button>
                <h2 id="fullscreen-title"></h2>
                <div id="fullscreen-chart-container" class="fullscreen-chart"></div>
            </div>
        </div>
    </div>

    <script>
        const chartData = {json.dumps(chart_data, indent=2)};
        let currentSymbol = '';
        let echartsInstances = {{}};
        let selectedTradeIndex = -1;
        let activeIndicators = {{'candlestick': true}};
        let isDarkMode = true;
        
        // ag-Grid column definitions with auto-sizing and full-width expansion
        const tradeColumns = [
            {{ field: 'trade_number', headerName: '#', flex: 0, width: 60, 
               cellStyle: {{ textAlign: 'center', fontWeight: 'bold' }}, resizable: true }},
            {{ field: 'entry_time', headerName: 'Entry Time', flex: 1, minWidth: 160, 
               cellRenderer: params => new Date(params.value).toLocaleString(), resizable: true }},
            {{ field: 'exit_time', headerName: 'Exit Time', flex: 1, minWidth: 160,
               cellRenderer: params => new Date(params.value).toLocaleString(), resizable: true }},
            {{ field: 'side', headerName: 'Side', flex: 0, width: 80,
               cellStyle: params => params.value === 'LONG' ? {{color: '#28a745', fontWeight: 'bold'}} : {{color: '#dc3545', fontWeight: 'bold'}}, resizable: true }},
            {{ field: 'entry_price', headerName: 'Entry Price', flex: 1, minWidth: 120,
               cellRenderer: params => '$' + params.value.toFixed(4), resizable: true }},
            {{ field: 'exit_price', headerName: 'Exit Price', flex: 1, minWidth: 120,
               cellRenderer: params => '$' + params.value.toFixed(4), resizable: true }},
            {{ field: 'pnl', headerName: 'P&L', flex: 1, minWidth: 100,
               cellRenderer: params => {{
                   const value = params.value;
                   const color = value >= 0 ? '#28a745' : '#dc3545';
                   return `<span style="color: ${{color}}; font-weight: bold;">$${{value.toFixed(2)}}</span>`;
               }}, resizable: true }},
            {{ field: 'pnl_percent', headerName: 'P&L %', flex: 1, minWidth: 90,
               cellRenderer: params => {{
                   const value = params.value;
                   const color = value >= 0 ? '#28a745' : '#dc3545';
                   return `<span style="color: ${{color}}; font-weight: bold;">${{value.toFixed(2)}}%</span>`;
               }}, resizable: true }},
            {{ field: 'total_pnl', headerName: 'Total P&L', flex: 1, minWidth: 110,
               cellRenderer: params => {{
                   const value = params.value;
                   const color = value >= 0 ? '#28a745' : '#dc3545';
                   return `<span style="color: ${{color}}; font-weight: bold;">$${{value.toFixed(2)}}</span>`;
               }}, resizable: true }},
            {{ field: 'duration', headerName: 'Duration', flex: 1, minWidth: 100,
               cellStyle: {{ textAlign: 'center' }}, resizable: true }},
            {{ field: 'exit_reason', headerName: 'Exit Reason', flex: 1, minWidth: 140, resizable: true }}
        ];
        
        let tradesGrid = null;
        
        // Dark mode toggle
        function toggleDarkMode() {{
            isDarkMode = !isDarkMode;
            document.body.classList.toggle('light-mode', !isDarkMode);
            
            const toggleBtn = document.querySelector('.dark-mode-toggle');
            toggleBtn.textContent = isDarkMode ? '☀️ Light Mode' : '🌙 Dark Mode';
            
            // Update all charts with new theme
            Object.values(echartsInstances).forEach(chart => {{
                if (chart && !chart.isDisposed()) {{
                    chart.dispose();
                }}
            }});
            echartsInstances = {{}};
            
            // Re-render current symbol
            if (currentSymbol) {{
                setTimeout(() => showSymbol(currentSymbol), 100);
            }}
        }}
        
        // Indicator toggle
        function toggleIndicator(indicator, button) {{
            activeIndicators[indicator] = !activeIndicators[indicator];
            button.classList.toggle('active', activeIndicators[indicator]);
            
            // Update chart
            if (currentSymbol && echartsInstances[currentSymbol]) {{
                updateChartWithHighlight(echartsInstances[currentSymbol], currentSymbol, selectedTradeIndex);
            }}
        }}
        
        // Function to highlight selected trade on chart with auto-fit
        function highlightTradeOnChart(trade, tradeIndex) {{
            if (!echartsInstances[currentSymbol]) return;
            
            const chart = echartsInstances[currentSymbol];
            selectedTradeIndex = tradeIndex;
            
            // Show trade info
            const tradeInfo = document.getElementById('trade-info');
            const tradeDetails = document.getElementById('trade-details');
            const duration = new Date(trade.exit_timestamp * 1000) - new Date(trade.entry_timestamp * 1000);
            const durationStr = Math.floor(duration / 60000) + 'm ' + Math.floor((duration % 60000) / 1000) + 's';
            
            tradeDetails.innerHTML = `
                Trade #${{trade.trade_number}} | ${{trade.side}} | 
                Entry: $${{trade.entry_price.toFixed(4)}} | Exit: $${{trade.exit_price.toFixed(4)}} | 
                P&L: <span style="color: ${{trade.pnl >= 0 ? '#28a745' : '#dc3545'}}">$${{trade.pnl.toFixed(2)}}</span> | 
                Duration: ${{durationStr}}
            `;
            tradeInfo.style.display = 'block';
            
            // Update chart with highlighted trade and auto-fit
            updateChartWithHighlight(chart, currentSymbol, tradeIndex, true);
            
            console.log(`✓ Highlighted trade ${{tradeIndex + 1}} on chart: ${{trade.side}} at ${{new Date(trade.entry_timestamp * 1000).toLocaleString()}}`);
        }}
        
        // Function to update chart with trade highlight and indicators
        function updateChartWithHighlight(chart, symbol, highlightIndex, autoFit = false) {{
            const candlestickData = chartData.candlestick_data[symbol] || [];
            const tradesData = chartData.trades[symbol] || [];
            const indicators = chartData.indicators[symbol] || {{}};
            
            if (candlestickData.length === 0) return;
            
            // Prepare candlestick data for ECharts
            const dates = [];
            const ohlcData = [];
            const volumeData = [];
            
            candlestickData.forEach(bar => {{
                const date = new Date(bar.time * 1000);
                dates.push(date.toISOString().split('T')[0] + ' ' + date.toTimeString().split(' ')[0]);
                ohlcData.push([bar.open, bar.close, bar.low, bar.high]);
                volumeData.push(bar.volume || 0);
            }});
            
            // Prepare trade markers
            const entryMarkers = [];
            const exitMarkers = [];
            let autoFitRange = null;
            
            tradesData.forEach((trade, index) => {{
                const entryDate = new Date(trade.entry_timestamp * 1000);
                const exitDate = new Date(trade.exit_timestamp * 1000);
                const entryDateStr = entryDate.toISOString().split('T')[0] + ' ' + entryDate.toTimeString().split(' ')[0];
                const exitDateStr = exitDate.toISOString().split('T')[0] + ' ' + exitDate.toTimeString().split(' ')[0];
                
                // Find the closest date index
                const entryIndex = dates.findIndex(d => d >= entryDateStr);
                const exitIndex = dates.findIndex(d => d >= exitDateStr);
                
                // Calculate auto-fit range for highlighted trade
                if (index === highlightIndex && autoFit && entryIndex >= 0 && exitIndex >= 0) {{
                    const padding = Math.max(10, Math.floor((exitIndex - entryIndex) * 0.2));
                    const startIndex = Math.max(0, entryIndex - padding);
                    const endIndex = Math.min(dates.length - 1, exitIndex + padding);
                    autoFitRange = {{
                        start: (startIndex / dates.length) * 100,
                        end: (endIndex / dates.length) * 100
                    }};
                }}
                
                if (entryIndex >= 0) {{
                    const isHighlighted = index === highlightIndex;
                    entryMarkers.push({{
                        name: `${{trade.side}} Entry`,
                        coord: [entryIndex, trade.entry_price],
                        value: trade.entry_price,
                        symbol: trade.side === 'LONG' ? 'triangle' : 'diamond',
                        symbolSize: isHighlighted ? 20 : 12,
                        itemStyle: {{
                            color: isHighlighted ? '#FFD700' : (trade.side === 'LONG' ? '#2196F3' : '#e91e63'),
                            borderColor: isHighlighted ? '#FF8C00' : '#fff',
                            borderWidth: 2
                        }},
                        label: {{
                            show: isHighlighted,
                            formatter: `${{trade.side}} Entry\\n$${{trade.entry_price.toFixed(4)}}`,
                            position: trade.side === 'LONG' ? 'bottom' : 'top',
                            color: isDarkMode ? '#e0e0e0' : '#333',
                            backgroundColor: isDarkMode ? 'rgba(45, 55, 72, 0.9)' : 'rgba(255, 255, 255, 0.9)',
                            borderColor: isDarkMode ? '#4a5568' : '#ccc',
                            borderWidth: 1,
                            borderRadius: 4,
                            padding: [4, 8]
                        }}
                    }});
                }}
                
                if (exitIndex >= 0) {{
                    const isHighlighted = index === highlightIndex;
                    exitMarkers.push({{
                        name: `Exit`,
                        coord: [exitIndex, trade.exit_price],
                        value: trade.exit_price,
                        symbol: 'circle',
                        symbolSize: isHighlighted ? 18 : 10,
                        itemStyle: {{
                            color: isHighlighted ? '#FFD700' : (trade.pnl >= 0 ? '#4CAF50' : '#F44336'),
                            borderColor: isHighlighted ? '#FF8C00' : '#fff',
                            borderWidth: 2
                        }},
                        label: {{
                            show: isHighlighted,
                            formatter: `Exit\\n${{trade.pnl >= 0 ? '+' : ''}}$${{trade.pnl.toFixed(2)}}`,
                            position: trade.pnl >= 0 ? 'top' : 'bottom',
                            color: isDarkMode ? '#e0e0e0' : '#333',
                            backgroundColor: isDarkMode ? 'rgba(45, 55, 72, 0.9)' : 'rgba(255, 255, 255, 0.9)',
                            borderColor: isDarkMode ? '#4a5568' : '#ccc',
                            borderWidth: 1,
                            borderRadius: 4,
                            padding: [4, 8]
                        }}
                    }});
                }}
            }});
            
            // Build series array based on active indicators
            const series = [];
            const grids = [];
            const yAxes = [];
            const xAxes = [];
            
            let gridIndex = 0;
            let yAxisIndex = 0;
            
            // Calculate how many indicator panels we need
            let indicatorCount = 0;
            if (activeIndicators.volume && volumeData.some(v => v > 0)) indicatorCount++;
            if (activeIndicators.macd && indicators.macd) indicatorCount++;
            if (activeIndicators.rsi && indicators.rsi) indicatorCount++;
            if (activeIndicators.stochastic && indicators.stochastic) indicatorCount++;
            
            // Calculate main chart height based on number of indicators
            const indicatorPanelHeight = 18; // Each indicator panel takes 18% height
            const mainChartHeight = Math.max(40, 85 - (indicatorCount * indicatorPanelHeight));
            
            // Main price chart grid
            grids.push({{
                left: '8%',
                right: '8%',
                top: '8%',
                height: mainChartHeight + '%'
            }});
            
            xAxes.push({{
                type: 'category',
                data: dates,
                gridIndex: gridIndex,
                boundaryGap: false,
                axisLine: {{ onZero: false }},
                splitLine: {{ show: false }},
                axisLabel: {{
                    show: false,
                    color: isDarkMode ? '#e0e0e0' : '#333'
                }}
            }});
            
            yAxes.push({{
                scale: true,
                gridIndex: gridIndex,
                splitArea: {{ show: true }},
                axisLabel: {{
                    formatter: '${{value}}',
                    color: isDarkMode ? '#e0e0e0' : '#333'
                }},
                axisLine: {{ lineStyle: {{ color: isDarkMode ? '#4a5568' : '#ccc' }} }},
                splitLine: {{ lineStyle: {{ color: isDarkMode ? '#4a5568' : '#eee' }} }}
            }});
            
            // Candlestick series
            if (activeIndicators.candlestick) {{
                series.push({{
                    name: 'Candlestick',
                    type: 'candlestick',
                    data: ohlcData,
                    xAxisIndex: gridIndex,
                    yAxisIndex: yAxisIndex,
                    itemStyle: {{
                        color: '#00da3c',
                        color0: '#ec0000',
                        borderColor: '#008F28',
                        borderColor0: '#8A0000'
                    }},
                    markPoint: {{
                        data: [...entryMarkers, ...exitMarkers],
                        silent: false
                    }}
                }});
            }}
            
            // EMA indicators
            if (activeIndicators.ema && indicators.ema) {{
                if (indicators.ema.ema9) {{
                    series.push({{
                        name: 'EMA 9',
                        type: 'line',
                        data: indicators.ema.ema9,
                        xAxisIndex: gridIndex,
                        yAxisIndex: yAxisIndex,
                        smooth: true,
                        lineStyle: {{ width: 1, color: '#ff6b6b' }},
                        showSymbol: false
                    }});
                }}
                if (indicators.ema.ema21) {{
                    series.push({{
                        name: 'EMA 21',
                        type: 'line',
                        data: indicators.ema.ema21,
                        xAxisIndex: gridIndex,
                        yAxisIndex: yAxisIndex,
                        smooth: true,
                        lineStyle: {{ width: 1, color: '#4ecdc4' }},
                        showSymbol: false
                    }});
                }}
                if (indicators.ema.ema50) {{
                    series.push({{
                        name: 'EMA 50',
                        type: 'line',
                        data: indicators.ema.ema50,
                        xAxisIndex: gridIndex,
                        yAxisIndex: yAxisIndex,
                        smooth: true,
                        lineStyle: {{ width: 2, color: '#45b7d1' }},
                        showSymbol: false
                    }});
                }}
            }}
            
            // Bollinger Bands
            if (activeIndicators.bollinger && indicators.bollinger) {{
                series.push({{
                    name: 'BB Upper',
                    type: 'line',
                    data: indicators.bollinger.upper,
                    xAxisIndex: gridIndex,
                    yAxisIndex: yAxisIndex,
                    lineStyle: {{ width: 1, color: '#ffa726', type: 'dashed' }},
                    showSymbol: false
                }});
                series.push({{
                    name: 'BB Middle',
                    type: 'line',
                    data: indicators.bollinger.middle,
                    xAxisIndex: gridIndex,
                    yAxisIndex: yAxisIndex,
                    lineStyle: {{ width: 1, color: '#66bb6a' }},
                    showSymbol: false
                }});
                series.push({{
                    name: 'BB Lower',
                    type: 'line',
                    data: indicators.bollinger.lower,
                    xAxisIndex: gridIndex,
                    yAxisIndex: yAxisIndex,
                    lineStyle: {{ width: 1, color: '#ffa726', type: 'dashed' }},
                    showSymbol: false
                }});
            }}
            
            gridIndex++;
            yAxisIndex++;
            
            // Track current position for indicator panels
            let currentTop = mainChartHeight + 3; // Start after main chart with small gap
            
            // Volume chart
            if (activeIndicators.volume && volumeData.some(v => v > 0)) {{
                grids.push({{
                    left: '8%',
                    right: '8%',
                    top: currentTop + '%',
                    height: indicatorPanelHeight + '%'
                }});
                
                xAxes.push({{
                    type: 'category',
                    data: dates,
                    gridIndex: gridIndex,
                    boundaryGap: false,
                    axisLabel: {{ show: false }}
                }});
                
                yAxes.push({{
                    gridIndex: gridIndex,
                    axisLabel: {{
                        color: isDarkMode ? '#e0e0e0' : '#333',
                        formatter: function(value) {{
                            return value > 1000000 ? (value/1000000).toFixed(1) + 'M' : 
                                   value > 1000 ? (value/1000).toFixed(1) + 'K' : value;
                        }}
                    }},
                    axisLine: {{ lineStyle: {{ color: isDarkMode ? '#4a5568' : '#ccc' }} }}
                }});
                
                series.push({{
                    name: 'Volume',
                    type: 'bar',
                    data: volumeData,
                    xAxisIndex: gridIndex,
                    yAxisIndex: yAxisIndex,
                    itemStyle: {{ color: '#42a5f5', opacity: 0.7 }}
                }});
                
                gridIndex++;
                yAxisIndex++;
                currentTop += indicatorPanelHeight + 1; // Add small gap between indicators
            }}
            
            // MACD chart
            if (activeIndicators.macd && indicators.macd) {{
                grids.push({{
                    left: '8%',
                    right: '8%',
                    top: currentTop + '%',
                    height: indicatorPanelHeight + '%'
                }});
                
                xAxes.push({{
                    type: 'category',
                    data: dates,
                    gridIndex: gridIndex,
                    boundaryGap: false,
                    axisLabel: {{ show: false }}
                }});
                
                yAxes.push({{
                    gridIndex: gridIndex,
                    axisLabel: {{ color: isDarkMode ? '#e0e0e0' : '#333' }},
                    axisLine: {{ lineStyle: {{ color: isDarkMode ? '#4a5568' : '#ccc' }} }}
                }});
                
                series.push({{
                    name: 'MACD',
                    type: 'line',
                    data: indicators.macd.macd,
                    xAxisIndex: gridIndex,
                    yAxisIndex: yAxisIndex,
                    lineStyle: {{ color: '#2196F3' }},
                    showSymbol: false
                }});
                
                series.push({{
                    name: 'MACD Signal',
                    type: 'line',
                    data: indicators.macd.signal,
                    xAxisIndex: gridIndex,
                    yAxisIndex: yAxisIndex,
                    lineStyle: {{ color: '#FF9800' }},
                    showSymbol: false
                }});
                
                series.push({{
                    name: 'MACD Histogram',
                    type: 'bar',
                    data: indicators.macd.histogram,
                    xAxisIndex: gridIndex,
                    yAxisIndex: yAxisIndex,
                    itemStyle: {{ 
                        color: function(params) {{
                            return params.data >= 0 ? '#4CAF50' : '#F44336';
                        }}
                    }}
                }});
                
                gridIndex++;
                yAxisIndex++;
                currentTop += indicatorPanelHeight + 1;
            }}
            
            // RSI chart
            if (activeIndicators.rsi && indicators.rsi) {{
                grids.push({{
                    left: '8%',
                    right: '8%',
                    top: currentTop + '%',
                    height: indicatorPanelHeight + '%'
                }});
                
                xAxes.push({{
                    type: 'category',
                    data: dates,
                    gridIndex: gridIndex,
                    boundaryGap: false,
                    axisLabel: {{ 
                        show: !activeIndicators.stochastic, // Show labels if this is the last indicator
                        color: isDarkMode ? '#e0e0e0' : '#333',
                        formatter: function(value) {{
                            return value.split(' ')[1];
                        }}
                    }}
                }});
                
                yAxes.push({{
                    gridIndex: gridIndex,
                    min: 0,
                    max: 100,
                    axisLabel: {{ color: isDarkMode ? '#e0e0e0' : '#333' }},
                    axisLine: {{ lineStyle: {{ color: isDarkMode ? '#4a5568' : '#ccc' }} }},
                    splitLine: {{
                        show: true,
                        lineStyle: {{ 
                            color: isDarkMode ? '#4a5568' : '#eee',
                            type: 'dashed'
                        }}
                    }}
                }});
                
                series.push({{
                    name: 'RSI',
                    type: 'line',
                    data: indicators.rsi,
                    xAxisIndex: gridIndex,
                    yAxisIndex: yAxisIndex,
                    lineStyle: {{ color: '#9C27B0' }},
                    showSymbol: false,
                    markLine: {{
                        data: [
                            {{ yAxis: 70, lineStyle: {{ color: '#F44336', type: 'dashed' }} }},
                            {{ yAxis: 30, lineStyle: {{ color: '#4CAF50', type: 'dashed' }} }}
                        ],
                        silent: true
                    }}
                }});
                
                gridIndex++;
                yAxisIndex++;
                currentTop += indicatorPanelHeight + 1;
            }}
            
            // Stochastic chart
            if (activeIndicators.stochastic && indicators.stochastic) {{
                grids.push({{
                    left: '8%',
                    right: '8%',
                    top: currentTop + '%',
                    height: indicatorPanelHeight + '%'
                }});
                
                xAxes.push({{
                    type: 'category',
                    data: dates,
                    gridIndex: gridIndex,
                    boundaryGap: false,
                    axisLabel: {{ 
                        show: true, // Always show labels on the last indicator
                        color: isDarkMode ? '#e0e0e0' : '#333',
                        formatter: function(value) {{
                            return value.split(' ')[1];
                        }}
                    }}
                }});
                
                yAxes.push({{
                    gridIndex: gridIndex,
                    min: 0,
                    max: 100,
                    axisLabel: {{ color: isDarkMode ? '#e0e0e0' : '#333' }},
                    axisLine: {{ lineStyle: {{ color: isDarkMode ? '#4a5568' : '#ccc' }} }}
                }});
                
                series.push({{
                    name: 'Stoch %K',
                    type: 'line',
                    data: indicators.stochastic.k,
                    xAxisIndex: gridIndex,
                    yAxisIndex: yAxisIndex,
                    lineStyle: {{ color: '#FF5722' }},
                    showSymbol: false
                }});
                
                series.push({{
                    name: 'Stoch %D',
                    type: 'line',
                    data: indicators.stochastic.d,
                    xAxisIndex: gridIndex,
                    yAxisIndex: yAxisIndex,
                    lineStyle: {{ color: '#795548' }},
                    showSymbol: false
                }});
            }}
            
            // Chart options
            const option = {{
                backgroundColor: isDarkMode ? '#1e1e2e' : '#ffffff',
                tooltip: {{
                    trigger: 'axis',
                    axisPointer: {{ type: 'cross' }},
                    backgroundColor: isDarkMode ? 'rgba(45, 55, 72, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                    borderColor: isDarkMode ? '#4a5568' : '#ccc',
                    textStyle: {{ color: isDarkMode ? '#e0e0e0' : '#333' }}
                }},
                legend: {{
                    data: series.map(s => s.name),
                    textStyle: {{ color: isDarkMode ? '#e0e0e0' : '#333' }}
                }},
                grid: grids,
                xAxis: xAxes,
                yAxis: yAxes,
                dataZoom: [
                    {{
                        type: 'inside',
                        start: autoFitRange ? autoFitRange.start : 0,
                        end: autoFitRange ? autoFitRange.end : 100,
                        xAxisIndex: Array.from({{ length: xAxes.length }}, (_, i) => i)
                    }},
                    {{
                        show: true,
                        type: 'slider',
                        bottom: '2%',
                        start: autoFitRange ? autoFitRange.start : 0,
                        end: autoFitRange ? autoFitRange.end : 100,
                        xAxisIndex: Array.from({{ length: xAxes.length }}, (_, i) => i),
                        backgroundColor: isDarkMode ? '#2d3748' : '#f8f9fa',
                        fillerColor: isDarkMode ? '#4a5568' : '#667eea',
                        borderColor: isDarkMode ? '#4a5568' : '#ccc',
                        handleStyle: {{ color: isDarkMode ? '#81c784' : '#667eea' }},
                        textStyle: {{ color: isDarkMode ? '#e0e0e0' : '#333' }}
                    }}
                ],
                series: series
            }};
            
            chart.setOption(option, true);
        }}
        
        // Fullscreen functionality
        function openFullscreen(elementId, title) {{
            const element = document.getElementById(elementId);
            const overlay = document.getElementById('fullscreen-overlay');
            const container = document.getElementById('fullscreen-chart-container');
            const titleElement = document.getElementById('fullscreen-title');
            
            titleElement.textContent = title;
            
            // Clone the element
            const clone = element.cloneNode(true);
            clone.id = elementId + '-fullscreen';
            
            // Clear and add to fullscreen container
            container.innerHTML = '';
            container.appendChild(clone);
            
            // Show overlay
            overlay.style.display = 'block';
            
            // Re-render charts in fullscreen
            if (currentSymbol) {{
                setTimeout(() => {{
                    showSymbolFullscreen(currentSymbol, clone);
                }}, 100);
            }}
        }}
        
        function closeFullscreen() {{
            document.getElementById('fullscreen-overlay').style.display = 'none';
        }}
        
        function showSymbolFullscreen(symbol, container) {{
            // Create fullscreen version
            container.innerHTML = `
                <div style="height: 70%; margin-bottom: 15px;">
                    <div id="candlestick-chart-fullscreen" style="width: 100%; height: 100%;"></div>
                </div>
                <div style="height: 25%;">
                    <h3>Trade History for ${{symbol}} (${{chartData.trades[symbol].length}} trades)</h3>
                    <div id="trades-grid-fullscreen" class="ag-theme-alpine" style="height: calc(100% - 40px);"></div>
                </div>
            `;
            
            setTimeout(() => {{
                const chartContainer = document.getElementById('candlestick-chart-fullscreen');
                if (chartContainer) {{
                    const fullscreenChart = echarts.init(chartContainer);
                    echartsInstances['fullscreen'] = fullscreenChart;
                    updateChartWithHighlight(fullscreenChart, symbol, selectedTradeIndex);
                    
                    // Handle resize
                    window.addEventListener('resize', () => {{
                        fullscreenChart.resize();
                    }});
                }}
                
                // Initialize fullscreen trades grid
                const gridOptions = {{
                    columnDefs: tradeColumns,
                    rowData: chartData.trades[symbol],
                    defaultColDef: {{
                        sortable: true,
                        filter: true,
                        resizable: true,
                        suppressSizeToFit: false,
                        flex: 1
                    }},
                    pagination: false,
                    enableRangeSelection: true,
                    animateRows: true,
                    rowHeight: 40,
                    suppressHorizontalScroll: false,
                    enableCellTextSelection: true,
                    domLayout: 'normal',
                    rowSelection: 'single',
                    onRowClicked: (event) => {{
                        const trade = event.data;
                        const tradeIndex = trade.trade_number - 1;
                        highlightTradeOnChart(trade, tradeIndex);
                        if (echartsInstances['fullscreen']) {{
                            updateChartWithHighlight(echartsInstances['fullscreen'], symbol, tradeIndex);
                        }}
                    }},
                    onGridReady: (params) => {{
                        setTimeout(() => {{
                            params.api.sizeColumnsToFit();
                            params.api.autoSizeAllColumns();
                        }}, 100);
                    }}
                }};
                
                agGrid.createGrid(document.getElementById('trades-grid-fullscreen'), gridOptions);
            }}, 100);
        }}
        
        // Update trades grid with full-width auto-sizing
        function updateTradesGrid(symbol) {{
            const gridDiv = document.getElementById('trades-grid');
            if (!gridDiv) {{
                console.error('trades-grid element not found');
                return;
            }}
            
            const rowData = chartData.trades[symbol] || [];
            console.log(`Setting up trades grid for ${{symbol}} with ${{rowData.length}} trades`);
            
            if (tradesGrid) {{
                tradesGrid.destroy();
                tradesGrid = null;
            }}
            
            // Ensure the container is visible and has dimensions
            gridDiv.style.height = '500px';
            gridDiv.style.width = '100%';
            gridDiv.style.display = 'block';
            
            const gridOptions = {{
                columnDefs: tradeColumns,
                rowData: rowData,
                defaultColDef: {{
                    sortable: true,
                    filter: true,
                    resizable: true,
                    suppressSizeToFit: false,
                    flex: 1
                }},
                pagination: false,
                enableRangeSelection: true,
                animateRows: true,
                rowHeight: 40,
                suppressHorizontalScroll: false,
                enableCellTextSelection: true,
                domLayout: 'normal',
                rowSelection: 'single',
                onRowClicked: (event) => {{
                    const trade = event.data;
                    const tradeIndex = trade.trade_number - 1;
                    console.log('Row clicked:', trade);
                    highlightTradeOnChart(trade, tradeIndex);
                }},
                onGridReady: (params) => {{
                    console.log('Grid ready with', params.api.getDisplayedRowCount(), 'rows');
                    setTimeout(() => {{
                        params.api.sizeColumnsToFit();
                        params.api.autoSizeAllColumns();
                    }}, 100);
                }},
                onGridSizeChanged: (params) => {{
                    params.api.sizeColumnsToFit();
                }},
                onFirstDataRendered: (params) => {{
                    params.api.sizeColumnsToFit();
                }}
            }};
            
            try {{
                tradesGrid = agGrid.createGrid(gridDiv, gridOptions);
                console.log('ag-Grid created successfully');
            }} catch (error) {{
                console.error('Error creating ag-Grid:', error);
            }}
        }}
        
        // Enhanced symbol analysis with comprehensive analytics
        function showSymbol(symbol, targetElement = null) {{
            currentSymbol = symbol;
            selectedTradeIndex = -1; // Reset selection
            
            // Update active tab
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            if (targetElement && targetElement.classList) {{
                targetElement.classList.add('active');
            }} else {{
                // Find the tab for this symbol and activate it
                const tabs = document.querySelectorAll('.tab');
                tabs.forEach(tab => {{
                    if (tab.textContent.trim() === symbol) {{
                        tab.classList.add('active');
                    }}
                }});
            }}
            
            const candlestickData = chartData.candlestick_data[symbol] || [];
            const tradesData = chartData.trades[symbol];
            const analytics = chartData.trade_analytics[symbol] || {{}};
            const metrics = chartData.performance_metrics[symbol] || {{}};
            
            // Enhanced content HTML with larger charts
            const contentHTML = `
                <div style="width: 100%; padding: 0;">
                    <div style="height: 900px; margin-bottom: 10px; width: 100%;">
                        <div id="candlestick-chart-${{symbol}}" style="width: 100%; height: 100%;"></div>
                    </div>
                    <div style="margin: 10px 0;">
                        <h3 style="font-size: 1.1rem; color: #333; font-weight: 600;">📊 Trade History for ${{symbol}} (${{tradesData.length}} trades)</h3>
                    </div>
                    <div id="trades-grid" class="ag-theme-alpine" style="width: 100%; height: 500px;"></div>
                </div>
            `;
            
            document.getElementById('symbol-content').innerHTML = contentHTML;
            
            // Update trade analytics section
            updateTradeAnalytics(symbol);
            
            // Clean up existing charts
            if (echartsInstances[symbol]) {{
                echartsInstances[symbol].dispose();
            }}
            
            // Create ECharts candlestick chart
            console.log(`Creating ECharts candlestick chart for ${{symbol}} with ${{candlestickData.length}} bars and ${{tradesData.length}} trades`);
            
            if (candlestickData.length > 0) {{
                const chartContainer = document.getElementById(`candlestick-chart-${{symbol}}`);
                if (!chartContainer) {{
                    console.error(`Candlestick container not found for ${{symbol}}`);
                    return;
                }}
                
                // Initialize ECharts instance
                const chart = echarts.init(chartContainer);
                echartsInstances[symbol] = chart;
                
                // Update chart with initial data
                updateChartWithHighlight(chart, symbol, -1);
                
                // Handle window resize
                window.addEventListener('resize', () => {{
                    chart.resize();
                }});
                
                console.log(`✓ ECharts candlestick chart created for ${{symbol}} with ${{candlestickData.length}} bars`);
                
            }} else {{
                console.warn(`No candlestick data available for ${{symbol}}`);
                const candlestickContainer = document.getElementById(`candlestick-chart-${{symbol}}`);
                if (candlestickContainer) {{
                    candlestickContainer.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666; font-size: 16px;">No OHLCV data available for this symbol</div>';
                }}
            }}
            
            // Initialize trades grid
            updateTradesGrid(symbol);
        }}
        
        // Compact trade analytics display with symbol stats side by side
        function updateTradeAnalytics(symbol) {{
            const analytics = chartData.trade_analytics[symbol] || {{}};
            const metrics = chartData.performance_metrics[symbol] || {{}};
            
            const analyticsHTML = `
                <div class="analytics-container">
                    <div class="symbol-stats-container">
                        <h3>Symbol Parameters & Metrics</h3>
                        <table class="symbol-stats">
                            <tr><th>Stop Loss</th><td class="neutral">${{chartData.parameters.sl_percent}}%</td></tr>
                            <tr><th>Trailing Stop</th><td class="neutral">${{chartData.parameters.trailing_stop_percent.toFixed(1)}}%</td></tr>
                            <tr><th>Position Size</th><td class="neutral">${{chartData.parameters.position_size_percent}}%</td></tr>
                            <tr><th>Win Rate</th><td class="${{metrics.win_rate >= 50 ? 'positive' : 'negative'}}">${{metrics.win_rate.toFixed(1)}}%</td></tr>
                            <tr><th>Return</th><td class="${{metrics.total_return >= 0 ? 'positive' : 'negative'}}">${{metrics.total_return.toFixed(2)}}%</td></tr>
                            <tr><th>Max Drawdown</th><td class="${{metrics.max_drawdown <= 5 ? 'positive' : 'negative'}}">${{metrics.max_drawdown.toFixed(2)}}%</td></tr>
                            <tr><th>Sharpe Ratio</th><td class="${{metrics.sharpe_ratio >= 1 ? 'positive' : 'negative'}}">${{metrics.sharpe_ratio.toFixed(2)}}</td></tr>
                            <tr><th>Profit Factor</th><td class="${{metrics.profit_factor >= 1.5 ? 'positive' : 'negative'}}">${{metrics.profit_factor.toFixed(2)}}</td></tr>
                            <tr><th>Total Trades</th><td class="neutral">${{metrics.total_trades}}</td></tr>
                        </table>
                    </div>
                    
                    <div class="analytics-section">
                        <h3>Trade Analytics</h3>
                        <div style="display: flex; gap: 20px;">
                            <table class="symbol-stats" style="width: 280px;">
                                <tr><th>Total Trades</th><td>${{metrics.total_trades || 0}}</td></tr>
                                <tr><th>Win Rate</th><td class="${{(metrics.win_rate || 0) >= 50 ? 'positive' : 'negative'}}">${{(metrics.win_rate || 0).toFixed(1)}}%</td></tr>
                                <tr><th>Profit Factor</th><td class="${{(metrics.profit_factor || 0) >= 1.5 ? 'positive' : 'negative'}}">${{(metrics.profit_factor || 0).toFixed(2)}}</td></tr>
                                <tr><th>Total Return</th><td class="${{(metrics.total_return || 0) >= 0 ? 'positive' : 'negative'}}">${{(metrics.total_return || 0).toFixed(2)}}%</td></tr>
                                <tr><th>Avg Win</th><td class="positive">$${{(analytics.avg_win || 0).toFixed(2)}}</td></tr>
                                <tr><th>Avg Loss</th><td class="negative">$${{(analytics.avg_loss || 0).toFixed(2)}}</td></tr>
                            </table>
                            
                            <table class="symbol-stats" style="width: 280px;">
                                <tr><th>Largest Win</th><td class="positive">$${{(analytics.largest_win || 0).toFixed(2)}}</td></tr>
                                <tr><th>Largest Loss</th><td class="negative">$${{(analytics.largest_loss || 0).toFixed(2)}}</td></tr>
                                <tr><th>Avg Duration</th><td>${{Math.round(analytics.avg_trade_duration || 0)}} min</td></tr>
                                <tr><th>Max Win Streak</th><td class="positive">${{analytics.max_win_streak || 0}}</td></tr>
                                <tr><th>Max Loss Streak</th><td class="negative">${{analytics.max_loss_streak || 0}}</td></tr>
                                <tr><th>Sharpe Ratio</th><td class="${{(metrics.sharpe_ratio || 0) >= 1 ? 'positive' : 'negative'}}">${{(metrics.sharpe_ratio || 0).toFixed(2)}}</td></tr>
                            </table>
                        </div>
                    </div>
                </div>
            `;
            
            document.getElementById('trade-analytics-content').innerHTML = analyticsHTML;
        }}
        
        // Initialize with enhanced functionality
        window.onload = function() {{
            console.log('Initializing Enhanced Apache ECharts trading view...');
            if (chartData.symbols.length > 0) {{
                document.querySelector('.tab').classList.add('active');
                showSymbol(chartData.symbols[0]);
            }}
        }};
        
        // Keyboard shortcuts
        document.addEventListener('keydown', function(event) {{
            if (event.key === 'Escape') {{
                closeFullscreen();
            }}
            if (event.key === 'f' || event.key === 'F') {{
                if (event.ctrlKey || event.metaKey) {{
                    event.preventDefault();
                    if (document.getElementById('fullscreen-overlay').style.display !== 'block') {{
                        openFullscreen('symbol-content', 'Trading Analysis');
                    }}
                }}
            }}
        }});
    </script>
</body>
</html>
"""
    
    # Save HTML file
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    console.print(f"[green]✓ Compact HTML chart saved to {output_file}[/green]")
    console.print(f"[yellow]📊 Features: Simple Tables, Full-Width Charts (700px), Minimal Design, Compact Layout[/yellow]")
    console.print(f"[cyan]💡 Design: No cards, clean tables, large charts, responsive layout[/cyan]")

def run_complete_optimization(symbols: List[str] = ["BTCUSDT", "ETHUSDT"], 
                             api_key: str = None, api_secret: str = None,
                             days_back: int = 14):
    """Run complete optimization and generate visualization"""
    
    console.print(Panel.fit(
        f"[bold cyan]🔍 BarUpDn Strategy Complete Optimization[/bold cyan]\n"
        f"Symbols: {', '.join(symbols)}\n"
        f"Days Back: {days_back}\n"
        f"Analysis: Parameter optimization + Comprehensive visualization",
        border_style="cyan"
    ))
    
    # Initialize optimizer
    optimizer = ParameterOptimizer(symbols, days_back, api_key, api_secret)
    
    # Run optimization
    console.print("\n[bold yellow]🚀 Starting Parameter Optimization...[/bold yellow]")
    results = optimizer.optimize_parameters()
    
    # Display results
    console.print("\n[bold green]📊 Optimization Complete![/bold green]")
    display_optimization_results(results)
    
    # Generate Apache ECharts visualization
    console.print("\n[bold cyan]🎨 Generating Apache ECharts™ Visualization...[/bold cyan]")
    generate_comprehensive_html_chart(results)
    
    # Save optimization results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = f"optimization_results_{timestamp}.json"
    
    # Convert results to JSON-serializable format
    def serialize_for_json(obj):
        """Custom serialization function for complex objects"""
        if hasattr(obj, 'isoformat'):  # datetime objects
            return obj.isoformat()
        elif hasattr(obj, 'to_dict'):  # pandas objects
            return obj.to_dict()
        elif isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        else:
            return str(obj)
    
    json_results = results.copy()
    for combo in json_results['all_results']:
        # Convert BacktestResult objects to dictionaries
        serialized_results = []
        for result in combo['results']:
            # Convert the result to a serializable format
            result_dict = {
                'symbol': result.symbol,
                'start_date': result.start_date.isoformat() if hasattr(result.start_date, 'isoformat') else str(result.start_date),
                'end_date': result.end_date.isoformat() if hasattr(result.end_date, 'isoformat') else str(result.end_date),
                'initial_capital': float(result.initial_capital),
                'final_capital': float(result.final_capital),
                'total_return': float(result.total_return),
                'total_return_percent': float(result.total_return_percent),
                'total_trades': int(result.total_trades),
                'winning_trades': int(result.winning_trades),
                'losing_trades': int(result.losing_trades),
                'win_rate': float(result.win_rate),
                'avg_win': float(result.avg_win),
                'avg_loss': float(result.avg_loss),
                'max_drawdown': float(result.max_drawdown),
                'max_drawdown_percent': float(result.max_drawdown_percent),
                'sharpe_ratio': float(result.sharpe_ratio) if not np.isnan(result.sharpe_ratio) else None,
                'trades': [
                    {
                        'entry_time': trade.entry_time.isoformat(),
                        'exit_time': trade.exit_time.isoformat(),
                        'entry_price': float(trade.entry_price),
                        'exit_price': float(trade.exit_price),
                        'side': str(trade.side),
                        'quantity': float(trade.quantity),
                        'pnl': float(trade.pnl),
                        'pnl_percent': float(trade.pnl_percent),
                        'stop_loss': float(trade.stop_loss),
                        'exit_reason': str(trade.exit_reason)
                    }
                    for trade in result.trades
                ],
                # Convert equity curve to simple format
                'equity_curve': {
                    'timestamps': [ts.isoformat() if hasattr(ts, 'isoformat') else str(ts) 
                                 for ts in result.equity_curve.index],
                    'equity': [float(val) for val in result.equity_curve['equity']],
                    'position': [str(val) for val in result.equity_curve['position']]
                },
                # Convert daily returns
                'daily_returns': {
                    str(k): float(v) if not np.isnan(v) else None 
                    for k, v in result.daily_returns.items()
                }
            }
            
            # Add parameters if they exist
            if hasattr(result, 'parameters'):
                result_dict['parameters'] = result.parameters
                
            serialized_results.append(result_dict)
        
        combo['results'] = serialized_results
    
    with open(results_file, 'w') as f:
        json.dump(json_results, f, indent=2, default=serialize_for_json)
    
    console.print(f"[green]✓ Optimization results saved to {results_file}[/green]")
    
    return results

if __name__ == "__main__":
    # Run with Binance API keys
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    symbols = ["BTCUSDT", "ETHUSDT"]
    
    results = run_complete_optimization(
        symbols=symbols,
        api_key=API_KEY,
        api_secret=API_SECRET,
        days_back=7  # Start with shorter period for testing
    )