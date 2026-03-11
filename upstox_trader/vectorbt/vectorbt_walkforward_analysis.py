#!/usr/bin/env python3
"""
VectorBT Walk-Forward Analysis for Upstox Trading Strategy
Implements rolling window optimization and out-of-sample testing
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import numpy as np
import vectorbt as vbt
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

from config_and_utils.free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import argparse
import time

# Import robust fetcher
from robust_5min_fetcher import Robust5MinFetcher

console = Console()

class VectorBTWalkForward:
    """
    Walk-Forward Analysis using VectorBT for robust strategy testing
    """
    
    def __init__(self, api):
        self.api = api
        self.results = {}
        
    def fetch_data(self, symbol, days=300, timeframe='15min'):
        """Fetch historical data using V3 API with enhanced error handling and robust 5-min fetcher"""
        console.print(f"📊 Fetching {days} days of {timeframe} data for {symbol}...")
        
        # Parse timeframe
        if timeframe.endswith('min'):
            unit = 'minutes'
            interval = int(timeframe.replace('min', ''))
        elif timeframe.endswith('H'):
            unit = 'hours'
            interval = int(timeframe.replace('H', ''))
        else:
            unit = 'days'
            interval = 1
        
        # Use robust fetcher for 5-minute data
        if interval == 5 and days > 15:
            console.print("[cyan]🚀 Using robust 5-minute fetcher for maximum data...[/cyan]")
            try:
                robust_fetcher = Robust5MinFetcher(self.api)
                df = robust_fetcher.fetch_maximum_5min_data(symbol, target_days=days)
                if df is not None and not df.empty:
                    console.print(f"[green]✅ Robust fetcher success: {len(df)} records from {df.index[0]} to {df.index[-1]}[/green]")
                    return df
                else:
                    console.print("[yellow]⚠️ Robust fetcher failed, falling back to standard method...[/yellow]")
            except Exception as e:
                console.print(f"[yellow]⚠️ Robust fetcher error: {str(e)[:50]}..., falling back...[/yellow]")
        
        # Standard fetching logic for other timeframes or small 5-min requests
        # Adjust date range based on timeframe limitations
        if unit == 'minutes' and interval <= 5:  # 1-min and 5-min data
            console.print("[yellow]⚠️  High-frequency data has API limitations. Using recent data...[/yellow]")
            days = min(days, 15)  # Limit to 15 days for high-frequency data
        elif unit == 'minutes' and interval <= 15:  # 15-min data
            days = min(days, 90)  # Limit to 90 days for 15-min data
        elif unit == 'hours':  # Hourly data
            console.print("[yellow]⚠️  Hourly data has API limitations. Using recent data...[/yellow]")
            days = min(days, 90)  # Limit to 90 days for hourly data
        # Daily, weekly, monthly data - no limits needed (available from 2000)
        
        to_date = datetime.now().strftime('%Y-%m-%d')
        from_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        
        try:
            df = self.api.fetch_historical_data_v3(
                symbol=symbol,
                unit=unit,
                interval=interval,
                to_date=to_date,
                from_date=from_date
            )
        except Exception as e:
            console.print(f"[red]❌ API Error for {symbol}: {str(e)}[/red]")
            
            # Try with even shorter range for high-frequency data
            if interval <= 5:
                console.print("[yellow]🔄 Trying with 7-day range...[/yellow]")
                try:
                    from_date = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
                    df = self.api.fetch_historical_data_v3(
                        symbol=symbol,
                        unit=unit,
                        interval=interval,
                        to_date=to_date,
                        from_date=from_date
                    )
                    console.print("[green]✅ 7-day range successful[/green]")
                except:
                    console.print(f"[red]❌ Even 7-day range failed for {symbol}[/red]")
                    return None
            else:
                return None
        
        if df is None or df.empty:
            console.print(f"[red]❌ No data available for {symbol}[/red]")
            console.print(f"[yellow]💡 Try these alternatives:[/yellow]")
            console.print(f"[yellow]   • Use --timeframe 15min (more reliable)[/yellow]")
            console.print(f"   • Try popular symbols: RELIANCE, TCS, INFY, HDFC")
            console.print(f"   • Check symbol spelling and availability")
            return None
            
        # Ensure we have OHLCV columns
        required_cols = ['open', 'high', 'low', 'close', 'volume']
        for col in required_cols:
            if col not in df.columns:
                console.print(f"[red]❌ Missing column: {col}[/red]")
                return None
        
        console.print(f"[green]✅ Fetched {len(df)} records from {df.index[0]} to {df.index[-1]}[/green]")
        return df
    
    def calculate_support_resistance_signals(self, data, lookback=50, min_touches=2, threshold=0.5):
        """
        Calculate support and resistance based signals using vectorized operations
        """
        close = data['close']
        high = data['high']
        low = data['low']
        
        # Initialize signals
        buy_signals = pd.Series(False, index=data.index)
        sell_signals = pd.Series(False, index=data.index)
        
        # Rolling windows for S&R calculation
        for i in range(lookback, len(data)):
            window_data = data.iloc[i-lookback:i]
            current_price = close.iloc[i]
            
            # Find local peaks and troughs
            highs = window_data['high']
            lows = window_data['low']
            
            # Simple peak detection - can be enhanced
            local_highs = highs[highs == highs.rolling(5, center=True).max()].dropna()
            local_lows = lows[lows == lows.rolling(5, center=True).min()].dropna()
            
            # Identify support and resistance levels
            resistance_levels = []
            support_levels = []
            
            # Group similar levels
            for high_val in local_highs.values:
                similar_highs = local_highs[abs(local_highs - high_val) / high_val * 100 < threshold]
                if len(similar_highs) >= min_touches:
                    resistance_levels.append(high_val)
            
            for low_val in local_lows.values:
                similar_lows = local_lows[abs(local_lows - low_val) / low_val * 100 < threshold]
                if len(similar_lows) >= min_touches:
                    support_levels.append(low_val)
            
            # Generate signals
            if support_levels:
                nearest_support = max([s for s in support_levels if s < current_price], default=None)
                if nearest_support and (current_price - nearest_support) / nearest_support * 100 <= 0.25:
                    buy_signals.iloc[i] = True
            
            if resistance_levels:
                nearest_resistance = min([r for r in resistance_levels if r > current_price], default=None)
                if nearest_resistance and (nearest_resistance - current_price) / current_price * 100 <= 0.25:
                    sell_signals.iloc[i] = True
        
        return buy_signals, sell_signals
    
    def run_walk_forward_analysis(self, symbol, train_period=90, test_period=30, total_periods=6, 
                                timeframe='15min', optimize_params=True):
        """
        Run walk-forward analysis with rolling optimization windows
        """
        console.print(Panel.fit(f"🚀 VectorBT Walk-Forward Analysis: {symbol}", style="bold blue"))
        
        # Calculate total days needed
        total_days = (train_period + test_period) * total_periods
        
        # Fetch data
        data = self.fetch_data(symbol, days=total_days, timeframe=timeframe)
        if data is None:
            return None
        
        # Convert days to bars based on timeframe
        if timeframe.endswith('min'):
            interval_minutes = int(timeframe.replace('min', ''))
            bars_per_day = (6.5 * 60) // interval_minutes  # 6.5 hours trading day
        elif timeframe.endswith('H'):
            bars_per_day = 6.5 // int(timeframe.replace('H', ''))
        else:
            bars_per_day = 1  # Daily
        
        train_bars = int(train_period * bars_per_day)
        test_bars = int(test_period * bars_per_day)
        
        console.print(f"[yellow]Using {train_bars} bars for training, {test_bars} bars for testing[/yellow]")
        
        results = []
        equity_curves = []
        
        # Walk-forward windows
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
            console=console
        ) as progress:
            
            task = progress.add_task("Running walk-forward analysis...", total=total_periods)
            
            for period in range(total_periods):
                # Define train and test windows in bars
                train_start = period * test_bars
                train_end = train_start + train_bars
                test_start = train_end
                test_end = test_start + test_bars
                
                if test_end >= len(data):
                    # Adjust for remaining data
                    test_end = len(data)
                    test_start = max(0, test_end - test_bars)
                    if test_start <= train_end:
                        break
                
                # Split data
                train_data = data.iloc[train_start:train_end]
                test_data = data.iloc[test_start:test_end]
                
                progress.update(task, advance=1, 
                               description=f"Period {period+1}: Training on {len(train_data)} bars ({train_period}d), Testing on {len(test_data)} bars ({test_period}d)")
                
                # Optimize parameters on training data
                if optimize_params:
                    best_params = self.optimize_parameters(train_data)
                else:
                    best_params = {'lookback': 50, 'min_touches': 2, 'threshold': 0.5}
                
                # Generate signals on test data
                buy_signals, sell_signals = self.calculate_support_resistance_signals(
                    test_data, **best_params
                )
                
                # Run backtest on test period using VectorBT
                portfolio = self.run_vectorbt_backtest(test_data, buy_signals, sell_signals)
                
                # Store results - properly handle VectorBT method calls
                try:
                    # VectorBT returns percentages, convert to regular format
                    total_return = portfolio.total_return() * 100  # Convert to percentage
                    sharpe_ratio = portfolio.sharpe_ratio()
                    max_drawdown = abs(portfolio.max_drawdown()) * 100  # Convert to positive percentage
                    
                    # Handle trades metrics safely
                    if portfolio.trades.count() > 0:
                        win_rate = portfolio.trades.win_rate() * 100  # Convert to percentage
                        total_trades = portfolio.trades.count()
                    else:
                        win_rate = 0
                        total_trades = 0
                        
                except Exception as e:
                    console.print(f"[yellow]VectorBT metrics error: {e}[/yellow]")
                    # Fallback to basic calculations
                    equity = portfolio.value()
                    total_return = (equity.iloc[-1] / equity.iloc[0] - 1) * 100
                    sharpe_ratio = 0
                    max_drawdown = 0
                    win_rate = 0
                    total_trades = 0
                
                # Debug print signals count
                buy_count = buy_signals.sum()
                sell_count = sell_signals.sum()
                console.print(f"[dim]Period {period+1}: {buy_count} buy signals, {sell_count} sell signals, {total_trades} trades executed[/dim]")
                
                period_result = {
                    'period': period + 1,
                    'train_start': train_data.index[0],
                    'train_end': train_data.index[-1],
                    'test_start': test_data.index[0],
                    'test_end': test_data.index[-1],
                    'params': best_params,
                    'total_return': total_return,
                    'sharpe_ratio': sharpe_ratio,
                    'max_drawdown': max_drawdown,
                    'win_rate': win_rate,
                    'total_trades': total_trades,
                    'buy_signals': buy_count,
                    'sell_signals': sell_count,
                    'equity_curve': portfolio.value()
                }
                
                results.append(period_result)
                equity_curves.append(portfolio.value())
        
        # Combine equity curves - handle empty case
        if equity_curves:
            combined_equity = pd.concat(equity_curves)
        else:
            console.print("[red]❌ No equity curves generated - insufficient data for analysis[/red]")
            return None
        
        # Generate comprehensive report
        self.generate_walkforward_report(results, combined_equity, symbol)
        
        return results
    
    def optimize_parameters(self, train_data):
        """
        Optimize strategy parameters on training data
        """
        lookback_range = [30, 40, 50, 60, 70]
        threshold_range = [0.3, 0.5, 0.7]
        min_touches_range = [2, 3]
        
        best_sharpe = -np.inf
        best_params = {}
        
        for lookback in lookback_range:
            for threshold in threshold_range:
                for min_touches in min_touches_range:
                    # Generate signals
                    buy_signals, sell_signals = self.calculate_support_resistance_signals(
                        train_data, lookback=lookback, min_touches=min_touches, threshold=threshold
                    )
                    
                    # Quick backtest
                    if buy_signals.any() or sell_signals.any():
                        portfolio = self.run_vectorbt_backtest(train_data, buy_signals, sell_signals)
                        
                        try:
                            sharpe = portfolio.sharpe_ratio()
                            if sharpe > best_sharpe:
                                best_sharpe = sharpe
                                best_params = {
                                    'lookback': lookback,
                                    'min_touches': min_touches,
                                    'threshold': threshold
                                }
                        except:
                            # Skip if Sharpe calculation fails
                            continue
        
        return best_params if best_params else {'lookback': 50, 'min_touches': 2, 'threshold': 0.5}
    
    def run_vectorbt_backtest(self, data, buy_signals, sell_signals):
        """
        Run backtest using VectorBT - Fixed implementation
        """
        # Create proper entries and exits for long positions
        long_entries = buy_signals
        long_exits = sell_signals
        
        # Create entries and exits for short positions  
        short_entries = sell_signals
        short_exits = buy_signals
        
        try:
            # Run portfolio simulation with proper VectorBT parameters
            portfolio = vbt.Portfolio.from_signals(
                close=data['close'],
                entries=long_entries,
                exits=long_exits,
                short_entries=short_entries,
                short_exits=short_exits,
                init_cash=100000,  # Starting capital
                fees=0.001,        # 0.1% fees
                freq='15min',      # Frequency for proper calculations
                direction='both'   # Allow both long and short positions
            )
            
            return portfolio
            
        except Exception as e:
            console.print(f"[red]VectorBT error: {e}[/red]")
            # Fallback: create simple long-only portfolio
            portfolio = vbt.Portfolio.from_signals(
                close=data['close'],
                entries=long_entries,
                exits=long_exits,
                init_cash=100000,
                fees=0.001,
                freq='15min'
            )
            return portfolio
    
    def generate_walkforward_report(self, results, combined_equity, symbol):
        """
        Generate comprehensive walk-forward analysis report
        """
        console.print(Panel.fit("📊 Walk-Forward Analysis Results", style="bold green"))
        
        # Summary statistics
        total_returns = [r['total_return'] for r in results]
        sharpe_ratios = [r['sharpe_ratio'] for r in results]
        max_drawdowns = [r['max_drawdown'] for r in results]
        win_rates = [r['win_rate'] for r in results]
        
        # Create summary table
        summary_table = Table(title=f"{symbol} Walk-Forward Summary", show_header=True)
        summary_table.add_column("Metric", style="cyan")
        summary_table.add_column("Mean", style="green", justify="right")
        summary_table.add_column("Std", style="yellow", justify="right")
        summary_table.add_column("Min", style="red", justify="right")
        summary_table.add_column("Max", style="green", justify="right")
        
        metrics = [
            ("Total Return %", total_returns),
            ("Sharpe Ratio", sharpe_ratios),
            ("Max Drawdown %", max_drawdowns),
            ("Win Rate %", win_rates)
        ]
        
        for metric_name, values in metrics:
            summary_table.add_row(
                metric_name,
                f"{np.mean(values):.2f}",
                f"{np.std(values):.2f}",
                f"{np.min(values):.2f}",
                f"{np.max(values):.2f}"
            )
        
        console.print(summary_table)
        
        # Period-by-period results
        period_table = Table(title="Period-by-Period Results", show_header=True)
        period_table.add_column("Period", style="cyan")
        period_table.add_column("Test Period", style="dim")
        period_table.add_column("Return %", style="magenta", justify="right")
        period_table.add_column("Sharpe", style="green", justify="right")
        period_table.add_column("Max DD %", style="red", justify="right")
        period_table.add_column("Win Rate %", style="yellow", justify="right")
        period_table.add_column("Trades", style="blue", justify="right")
        
        for result in results:
            return_color = "green" if result['total_return'] > 0 else "red"
            period_table.add_row(
                str(result['period']),
                f"{result['test_start'].strftime('%Y-%m-%d')} to {result['test_end'].strftime('%Y-%m-%d')}",
                f"[{return_color}]{result['total_return']:.2f}[/{return_color}]",
                f"{result['sharpe_ratio']:.2f}",
                f"{result['max_drawdown']:.2f}",
                f"{result['win_rate']:.1f}",
                str(result['total_trades'])
            )
        
        console.print(period_table)
        
        # Overall performance metrics
        overall_return = (combined_equity.iloc[-1] / combined_equity.iloc[0] - 1) * 100
        overall_sharpe = self.calculate_sharpe_ratio(combined_equity)
        overall_max_dd = self.calculate_max_drawdown(combined_equity)
        
        overall_text = f"""[green]📈 OVERALL WALK-FORWARD PERFORMANCE[/green]
• Combined Return: {overall_return:.2f}%
• Combined Sharpe Ratio: {overall_sharpe:.2f}
• Combined Max Drawdown: {overall_max_dd:.2f}%
• Consistency: {len([r for r in results if r['total_return'] > 0])} out of {len(results)} periods profitable
• Average Period Return: {np.mean(total_returns):.2f}% ± {np.std(total_returns):.2f}%"""
        
        console.print(Panel(overall_text, title="🎯 Overall Performance", style="green"))
        
        # Save results
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save detailed results to CSV
        results_df = pd.DataFrame(results)
        filename = f"walkforward_results_{symbol}_{timestamp}.csv"
        results_df.to_csv(filename, index=False)
        
        # Save equity curve
        equity_filename = f"walkforward_equity_{symbol}_{timestamp}.csv"
        combined_equity.to_csv(equity_filename)
        
        console.print(f"[green]💾 Results saved to: {filename}[/green]")
        console.print(f"[green]💾 Equity curve saved to: {equity_filename}[/green]")
        
        # Generate plots
        self.create_walkforward_plots(results, combined_equity, symbol, timestamp)
    
    def calculate_sharpe_ratio(self, equity_curve, risk_free_rate=0.05):
        """Calculate Sharpe ratio from equity curve"""
        returns = equity_curve.pct_change().dropna()
        excess_returns = returns - risk_free_rate / 252  # Daily risk-free rate
        return np.sqrt(252) * excess_returns.mean() / returns.std() if returns.std() > 0 else 0
    
    def calculate_max_drawdown(self, equity_curve):
        """Calculate maximum drawdown"""
        peak = equity_curve.expanding().max()
        drawdown = (equity_curve - peak) / peak
        return abs(drawdown.min()) * 100
    
    def create_walkforward_plots(self, results, combined_equity, symbol, timestamp):
        """Create comprehensive visualization plots"""
        # Create subplots
        fig = make_subplots(
            rows=3, cols=2,
            subplot_titles=[
                "Combined Equity Curve",
                "Period Returns",
                "Rolling Sharpe Ratio",
                "Rolling Max Drawdown",
                "Win Rate by Period",
                "Parameter Stability"
            ],
            specs=[[{"colspan": 2}, None],
                   [{}, {}],
                   [{}, {}]]
        )
        
        # 1. Combined equity curve
        fig.add_trace(
            go.Scatter(
                x=combined_equity.index,
                y=combined_equity.values,
                mode='lines',
                name='Equity Curve',
                line=dict(color='blue', width=2)
            ),
            row=1, col=1
        )
        
        # 2. Period returns
        periods = [r['period'] for r in results]
        returns = [r['total_return'] for r in results]
        colors = ['green' if r > 0 else 'red' for r in returns]
        
        fig.add_trace(
            go.Bar(
                x=periods,
                y=returns,
                name='Period Returns',
                marker_color=colors
            ),
            row=2, col=1
        )
        
        # 3. Rolling Sharpe ratio
        sharpe_ratios = [r['sharpe_ratio'] for r in results]
        fig.add_trace(
            go.Scatter(
                x=periods,
                y=sharpe_ratios,
                mode='lines+markers',
                name='Sharpe Ratio',
                line=dict(color='orange')
            ),
            row=2, col=2
        )
        
        # 4. Rolling Max Drawdown
        max_drawdowns = [r['max_drawdown'] for r in results]
        fig.add_trace(
            go.Scatter(
                x=periods,
                y=max_drawdowns,
                mode='lines+markers',
                name='Max Drawdown',
                line=dict(color='red')
            ),
            row=3, col=1
        )
        
        # 5. Win Rate by Period
        win_rates = [r['win_rate'] for r in results]
        fig.add_trace(
            go.Scatter(
                x=periods,
                y=win_rates,
                mode='lines+markers',
                name='Win Rate',
                line=dict(color='green')
            ),
            row=3, col=2
        )
        
        # Update layout
        fig.update_layout(
            title=f"Walk-Forward Analysis: {symbol}",
            height=1000,
            showlegend=False
        )
        
        # Save plot
        plot_filename = f"walkforward_analysis_{symbol}_{timestamp}.html"
        fig.write_html(plot_filename)
        
        console.print(f"[green]📊 Interactive plot saved to: {plot_filename}[/green]")

def main():
    start_time = datetime.now()
    
    parser = argparse.ArgumentParser(description="VectorBT Walk-Forward Analysis")
    parser.add_argument("--symbol", type=str, default="RELIANCE", help="Stock symbol")
    parser.add_argument("--timeframe", type=str, default="15min", help="Timeframe (15min, 30min, 1H, 1D)")
    parser.add_argument("--train-period", type=int, default=90, help="Training period in days")
    parser.add_argument("--test-period", type=int, default=30, help="Test period in days")
    parser.add_argument("--total-periods", type=int, default=6, help="Number of walk-forward periods")
    parser.add_argument("--optimize", action="store_true", help="Optimize parameters")
    
    args = parser.parse_args()
    
    # Validate inputs - ALL timeframes are actually supported!
    supported_timeframes = ['1min', '5min', '15min', '30min', '1H', '2H', '1D']
    if args.timeframe not in supported_timeframes:
        console.print(f"[red]❌ Invalid timeframe: {args.timeframe}[/red]")
        console.print(f"[yellow]💡 Upstox V3 API supports: {', '.join(supported_timeframes)}[/yellow]")
        console.print(f"[yellow]📊 Recommended: --timeframe 15min (good balance)[/yellow]")
        return
    
    # Warn about date range limitations for high-frequency data
    if args.timeframe in ['1min', '5min']:
        total_days_needed = (args.train_period + args.test_period) * args.total_periods
        if total_days_needed > 30:
            console.print(f"[yellow]⚠️  {args.timeframe} data limited to 30 days by API[/yellow]")
            console.print(f"[yellow]💡 Reducing analysis scope automatically...[/yellow]")
    
    # Initialize API
    try:
        api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
    except Exception as e:
        console.print(f"[red]❌ Failed to initialize Upstox API: {e}[/red]")
        console.print("[yellow]💡 Check your credentials in config.py[/yellow]")
        return
    
    # Run walk-forward analysis
    wf_analyzer = VectorBTWalkForward(api)
    
    try:
        results = wf_analyzer.run_walk_forward_analysis(
            symbol=args.symbol.upper(),  # Ensure uppercase
            train_period=args.train_period,
            test_period=args.test_period,
            total_periods=args.total_periods,
            timeframe=args.timeframe,
            optimize_params=args.optimize
        )
        
        if results:
            execution_time = datetime.now() - start_time
            hours, remainder = divmod(execution_time.total_seconds(), 3600)
            minutes, seconds = divmod(remainder, 60)
            console.print(f"[blue]🎉 Walk-forward analysis completed successfully![/blue]")
            console.print(f"[dim]Execution time: {int(hours):01d}h:{int(minutes):02d}m:{int(seconds):02d}s sec[/dim]")
        else:
            console.print("[red]❌ Walk-forward analysis failed[/red]")
            console.print("[yellow]💡 Troubleshooting tips:[/yellow]")
            console.print("   • Try a different symbol (e.g., RELIANCE, TCS, INFY)")
            console.print("   • Use --timeframe 15min for better data availability")
            console.print("   • Check internet connection and API limits")
            console.print("   • Verify symbol exists and is actively traded")
            
    except KeyboardInterrupt:
        console.print("\n[yellow]⚠️  Analysis interrupted by user[/yellow]")
    except Exception as e:
        console.print(f"[red]❌ Unexpected error: {e}[/red]")
        import traceback
        console.print("[dim]" + traceback.format_exc() + "[/dim]")

if __name__ == "__main__":
    main()
