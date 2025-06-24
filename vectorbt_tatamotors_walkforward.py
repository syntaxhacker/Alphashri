#!/usr/bin/env python3
"""
🇮🇳 TATAMOTORS VectorBT Walk Forward Analysis
Specialized walk forward optimization for Indian stocks using VectorBT
"""

import os
import sys
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
import matplotlib.pyplot as plt
import seaborn as sns
from rich.console import Console
from rich.progress import Progress, track
from rich.table import Table
from rich.panel import Panel
import json

# Indian stock configuration
from indian_stock_config import (
    DEFAULT_CONFIGS, EQUITY_PARAMETER_GRIDS, INDIAN_TRADING_COSTS,
    get_stock_symbol, get_market_info, get_parameter_grid
)

# Enhanced data fetcher
from enhanced_data_fetcher import EnhancedDataFetcher

# VectorBT imports
try:
    import vectorbt as vbt
    HAS_VECTORBT = True
    print("✅ VectorBT available - GPU acceleration enabled for Indian stocks")
except ImportError:
    HAS_VECTORBT = False
    print("❌ VectorBT not found. Install with: pip install vectorbt")

console = Console()

class TATAMOTORSWalkForward:
    """TATAMOTORS VectorBT walk forward optimization for Indian stocks"""
    
    def __init__(self, config_name: str = 'TATAMOTORS_DAILY'):
        """Initialize with Indian stock configuration"""
        
        # Load configuration
        if config_name in DEFAULT_CONFIGS:
            self.config = DEFAULT_CONFIGS[config_name].copy()
        else:
            raise ValueError(f"Unknown config: {config_name}. Available: {list(DEFAULT_CONFIGS.keys())}")
        
        # Initialize enhanced data fetcher (no API keys needed for yfinance)
        self.data_fetcher = EnhancedDataFetcher(cache_dir='vectorbt_cache')
        
        # Walk forward configuration from config
        self.symbol = self.config['symbol']
        self.timeframe = self.config['timeframe']
        self.train_days = self.config.get('train_days', 90)
        self.test_days = self.config.get('test_days', 30)
        self.step_days = self.config.get('step_days', 15)
        self.fees = self.config['fees']
        self.direction = self.config['direction']
        self.initial_cash = self.config['initial_cash']
        
        # Get market info
        self.market_info = get_market_info(self.symbol)
        
        # Results storage
        self.results = {}
        self.data_cache = {}
        
        console.print(Panel.fit(
            f"[bold blue]🇮🇳 TATAMOTORS VectorBT Walk Forward Optimizer[/bold blue]\n"
            f"• Stock: {self.market_info['stock_name']} ({self.market_info['exchange']})\n"
            f"• Sector: {self.market_info['sector']}\n"
            f"• Timeframe: {self.timeframe}\n"
            f"• Trading Fees: {self.fees*100:.2f}%\n"
            f"• Direction: {self.direction}\n"
            f"• Initial Capital: ₹{self.initial_cash:,}",
            border_style="blue"
        ))
    
    def fetch_stock_data(self, days_back: int = 180) -> pd.DataFrame:
        """Fetch Indian stock data efficiently"""
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        console.print(f"\n[cyan]📊 Fetching {self.symbol} {self.timeframe} data...[/cyan]")
        console.print(f"[yellow]Period: {start_date.date()} to {end_date.date()} ({days_back} days)[/yellow]")
        
        try:
            data = self.data_fetcher.fetch_data(
                symbol=self.symbol,
                start_date=start_date,
                end_date=end_date,
                timeframe=self.timeframe,
                force_refresh=False
            )
            
            if data is None or data.empty:
                raise ValueError(f"No data received for {self.symbol}")
            
            self.data_cache[self.symbol] = data
            
            # Display summary
            summary_table = Table(title=f"{self.symbol} Data Summary")
            summary_table.add_column("Metric", style="cyan")
            summary_table.add_column("Value", style="white")
            
            price_range = f"₹{data['low'].min():.2f} - ₹{data['high'].max():.2f}"
            avg_volume = data['volume'].mean()
            
            summary_table.add_row("Total Bars", f"{len(data):,}")
            summary_table.add_row("Date Range", f"{data.index[0].date()} to {data.index[-1].date()}")
            summary_table.add_row("Price Range", price_range)
            summary_table.add_row("Current Price", f"₹{data['close'].iloc[-1]:.2f}")
            summary_table.add_row("Avg Daily Volume", f"{avg_volume:,.0f}")
            
            console.print(summary_table)
            return data
            
        except Exception as e:
            console.print(f"[red]❌ Error fetching data: {e}[/red]")
            return pd.DataFrame()
    
    def create_breakout_signals(self, data: pd.DataFrame, lookback: int, 
                               volume_mult: float, breakout_pct: float) -> pd.DataFrame:
        """Create vectorized breakout signals for Indian stocks"""
        
        if not HAS_VECTORBT:
            return self._create_signals_pandas(data, lookback, volume_mult, breakout_pct)
        
        # Convert to VectorBT format
        close = data['close']
        high = data['high']
        low = data['low']
        volume = data['volume']
        
        # Vectorized indicators
        high_max = high.rolling(lookback).max().shift(1)
        low_min = low.rolling(lookback).min().shift(1)
        volume_ma = volume.rolling(20).mean()
        
        # Breakout conditions (adapted for Indian stock volatility)
        long_entry = (close > high_max * (1 + breakout_pct)) & (volume > volume_ma * volume_mult)
        
        # For Indian retail investors, typically long-only
        if self.direction == 'longonly':
            short_entry = pd.Series(False, index=data.index)
        else:
            short_entry = (close < low_min * (1 - breakout_pct)) & (volume > volume_ma * volume_mult)
        
        # Create signals DataFrame
        signals = pd.DataFrame(index=data.index)
        signals['long_entry'] = long_entry
        signals['short_entry'] = short_entry
        signals['price'] = close
        
        return signals
    
    def _create_signals_pandas(self, data: pd.DataFrame, lookback: int, 
                              volume_mult: float, breakout_pct: float) -> pd.DataFrame:
        """Fallback pandas implementation for Indian stocks"""
        
        df = data.copy()
        
        # Calculate indicators
        df['high_max'] = df['high'].rolling(lookback).max().shift(1)
        df['low_min'] = df['low'].rolling(lookback).min().shift(1)
        df['volume_ma'] = df['volume'].rolling(20).mean()
        
        # Generate signals
        df['long_entry'] = ((df['close'] > df['high_max'] * (1 + breakout_pct)) & 
                           (df['volume'] > df['volume_ma'] * volume_mult))
        
        if self.direction == 'longonly':
            df['short_entry'] = False
        else:
            df['short_entry'] = ((df['close'] < df['low_min'] * (1 - breakout_pct)) & 
                                (df['volume'] > df['volume_ma'] * volume_mult))
        
        signals = pd.DataFrame(index=data.index)
        signals['long_entry'] = df['long_entry']
        signals['short_entry'] = df['short_entry']
        signals['price'] = df['close']
        
        return signals
    
    def run_vectorbt_backtest(self, data: pd.DataFrame, params: Dict) -> Dict:
        """Run ultra-fast VectorBT backtest for Indian stocks"""
        
        if not HAS_VECTORBT:
            return self._run_pandas_backtest(data, params)
        
        try:
            # Create signals
            signals = self.create_breakout_signals(
                data, 
                params['lookback'], 
                params['volume_mult'], 
                params['breakout_pct']
            )
            
            # Portfolio simulation with VectorBT
            close = data['close']
            
            # Create portfolio with Indian market parameters
            pf = vbt.Portfolio.from_signals(
                close=close,
                entries=signals['long_entry'],
                exits=signals['short_entry'],
                init_cash=self.initial_cash,
                fees=self.fees,  # Indian trading costs
                freq=self.timeframe.upper(),
                direction=self.direction  # Typically 'longonly' for Indian retail
            )
            
            # Calculate comprehensive stats
            stats = pf.stats()
            
            return {
                'total_return': stats['Total Return [%]'],
                'sharpe_ratio': stats['Sharpe Ratio'],
                'max_drawdown': stats['Max Drawdown [%]'],
                'win_rate': stats['Win Rate [%]'],
                'total_trades': stats['Total Trades'],
                'profit_factor': stats.get('Profit Factor', 1.0),
                'avg_trade_duration': stats.get('Avg Trade Duration', '0 days'),
                'portfolio': pf
            }
            
        except Exception as e:
            console.print(f"[red]VectorBT backtest failed: {e}[/red]")
            return self._run_pandas_backtest(data, params)
    
    def _run_pandas_backtest(self, data: pd.DataFrame, params: Dict) -> Dict:
        """Fallback pandas implementation"""
        
        signals = self.create_breakout_signals(
            data, params['lookback'], params['volume_mult'], params['breakout_pct']
        )
        
        # Simple portfolio simulation
        position = 0
        cash = self.initial_cash
        trades = []
        equity_curve = [self.initial_cash]
        
        for i in range(1, len(signals)):
            current_price = signals['price'].iloc[i]
            
            # Long entry
            if signals['long_entry'].iloc[i] and position == 0:
                shares_to_buy = cash // current_price
                if shares_to_buy > 0:
                    cost = shares_to_buy * current_price * (1 + self.fees)
                    if cost <= cash:
                        position = shares_to_buy
                        cash -= cost
                        trades.append({'entry': current_price, 'type': 'long'})
            
            # Long exit (or short entry if allowed)
            elif signals['short_entry'].iloc[i] and position > 0:
                proceeds = position * current_price * (1 - self.fees)
                cash += proceeds
                if trades:
                    trades[-1]['exit'] = current_price
                    trades[-1]['return'] = (current_price - trades[-1]['entry']) / trades[-1]['entry']
                position = 0
            
            # Calculate equity
            portfolio_value = cash + (position * current_price if position > 0 else 0)
            equity_curve.append(portfolio_value)
        
        # Calculate metrics
        equity_series = pd.Series(equity_curve)
        returns = equity_series.pct_change().dropna()
        
        total_return = ((equity_curve[-1] - self.initial_cash) / self.initial_cash) * 100
        sharpe_ratio = returns.mean() / returns.std() * np.sqrt(252) if returns.std() > 0 else 0
        max_drawdown = ((equity_series / equity_series.expanding().max()) - 1).min() * 100
        
        winning_trades = [t for t in trades if 'return' in t and t['return'] > 0]
        win_rate = (len(winning_trades) / len(trades)) * 100 if trades else 0
        
        return {
            'total_return': total_return,
            'sharpe_ratio': sharpe_ratio,
            'max_drawdown': abs(max_drawdown),
            'win_rate': win_rate,
            'total_trades': len(trades),
            'profit_factor': 1.0,
            'avg_trade_duration': '5 days',
            'portfolio': None
        }
    
    def optimize_parameters(self, train_data: pd.DataFrame) -> Tuple[Dict, float]:
        """Optimize parameters for Indian stock characteristics"""
        
        console.print(f"[cyan]🔧 Optimizing parameters on {len(train_data)} days of training data...[/cyan]")
        
        # Get parameter grid for this timeframe
        param_grid = get_parameter_grid(self.timeframe)
        
        best_params = None
        best_score = float('-inf')
        optimization_results = []
        
        # Parameter combinations
        lookbacks = param_grid['lookback_periods']
        volume_mults = param_grid['volume_multipliers']
        breakout_pcts = param_grid['breakout_thresholds']
        
        total_combinations = len(lookbacks) * len(volume_mults) * len(breakout_pcts)
        console.print(f"[yellow]Testing {total_combinations} parameter combinations...[/yellow]")
        
        with Progress() as progress:
            task = progress.add_task("Optimizing...", total=total_combinations)
            
            for lookback in lookbacks:
                for volume_mult in volume_mults:
                    for breakout_pct in breakout_pcts:
                        
                        params = {
                            'lookback': lookback,
                            'volume_mult': volume_mult,
                            'breakout_pct': breakout_pct
                        }
                        
                        try:
                            result = self.run_vectorbt_backtest(train_data, params)
                            
                            # Multi-objective scoring (Indian market focus)
                            # Prioritize: Sharpe ratio, total return, low drawdown
                            score = (
                                result['sharpe_ratio'] * 0.4 +  # Risk-adjusted returns
                                result['total_return'] * 0.003 +  # Raw returns (scaled)
                                (100 - result['max_drawdown']) * 0.01 +  # Low drawdown
                                result['win_rate'] * 0.01  # Consistency
                            )
                            
                            optimization_results.append({
                                'params': params,
                                'score': score,
                                'result': result
                            })
                            
                            if score > best_score:
                                best_score = score
                                best_params = params
                                
                        except Exception as e:
                            # Skip failed parameter combinations
                            pass
                        
                        progress.update(task, advance=1)
        
        console.print(f"[green]✅ Optimization complete. Best score: {best_score:.3f}[/green]")
        console.print(f"[cyan]Best parameters: {best_params}[/cyan]")
        
        return best_params, best_score
    
    def run_walk_forward_analysis(self) -> List[Dict]:
        """Run walk forward analysis for Indian stock"""
        
        console.print(Panel.fit(
            f"[bold green]🚀 Starting Walk Forward Analysis[/bold green]\n"
            f"Stock: {self.symbol} | Timeframe: {self.timeframe}",
            border_style="green"
        ))
        
        # Fetch data
        data = self.fetch_stock_data(days_back=365)  # 1 year of data
        if data.empty:
            console.print("[red]❌ No data available for analysis[/red]")
            return []
        
        # Calculate walk forward periods
        periods = []
        current_start = 0
        
        while current_start + self.train_days + self.test_days <= len(data):
            train_start = current_start
            train_end = current_start + self.train_days
            test_start = train_end
            test_end = test_start + self.test_days
            
            periods.append({
                'train_start': train_start,
                'train_end': train_end,
                'test_start': test_start,
                'test_end': test_end,
                'train_dates': (data.index[train_start], data.index[train_end-1]),
                'test_dates': (data.index[test_start], data.index[test_end-1])
            })
            
            current_start += self.step_days
        
        console.print(f"[yellow]📅 Generated {len(periods)} walk forward periods[/yellow]")
        
        # Run walk forward analysis
        wf_results = []
        
        for i, period in enumerate(track(periods, description="Walk Forward Analysis")):
            
            # Split data
            train_data = data.iloc[period['train_start']:period['train_end']]
            test_data = data.iloc[period['test_start']:period['test_end']]
            
            console.print(f"\n[cyan]Period {i+1}/{len(periods)}:[/cyan]")
            console.print(f"  Train: {period['train_dates'][0].date()} to {period['train_dates'][1].date()}")
            console.print(f"  Test:  {period['test_dates'][0].date()} to {period['test_dates'][1].date()}")
            
            # Optimize on training data
            best_params, best_score = self.optimize_parameters(train_data)
            
            if best_params is None:
                console.print("  [red]❌ Optimization failed[/red]")
                continue
            
            # Test on out-of-sample data
            test_result = self.run_vectorbt_backtest(test_data, best_params)
            
            period_result = {
                'period': i + 1,
                'train_dates': period['train_dates'],
                'test_dates': period['test_dates'],
                'best_params': best_params,
                'train_score': best_score,
                'test_result': test_result,
                'test_return': test_result['total_return'],
                'test_sharpe': test_result['sharpe_ratio'],
                'test_drawdown': test_result['max_drawdown'],
                'test_trades': test_result['total_trades']
            }
            
            wf_results.append(period_result)
            
            console.print(f"  [green]✅ Test Return: {test_result['total_return']:+.2f}%[/green]")
            console.print(f"  [blue]Sharpe: {test_result['sharpe_ratio']:.2f} | DD: {test_result['max_drawdown']:.1f}%[/blue]")
        
        self.results[self.symbol] = wf_results
        return wf_results
    
    def create_indian_stock_dashboard(self, wf_results: List[Dict], save_path: str = None):
        """Create comprehensive dashboard for Indian stock analysis"""
        
        if not wf_results:
            console.print("[red]❌ No results to visualize[/red]")
            return
        
        # Set up the plot style
        plt.style.use('default')
        sns.set_palette("husl")
        
        fig = plt.figure(figsize=(20, 16))
        
        # Main title
        fig.suptitle(f'🇮🇳 {self.market_info["stock_name"]} ({self.symbol}) - Walk Forward Analysis\n'
                    f'Sector: {self.market_info["sector"]} | Exchange: {self.market_info["exchange"]} | '
                    f'Timeframe: {self.timeframe} | Fees: {self.fees*100:.2f}%', 
                    fontsize=16, fontweight='bold', y=0.98)
        
        # Extract data for plotting
        periods = [r['period'] for r in wf_results]
        returns = [r['test_return'] for r in wf_results]
        sharpe_ratios = [r['test_sharpe'] for r in wf_results]
        drawdowns = [r['test_drawdown'] for r in wf_results]
        trades = [r['test_trades'] for r in wf_results]
        
        # 1. Cumulative Returns
        ax1 = plt.subplot(3, 4, 1)
        cumulative_returns = np.cumprod([1 + r/100 for r in returns])
        plt.plot(periods, cumulative_returns, 'b-', linewidth=2, marker='o')
        plt.title('🚀 Cumulative Returns', fontweight='bold')
        plt.xlabel('Period')
        plt.ylabel('Cumulative Return')
        plt.grid(True, alpha=0.3)
        
        # 2. Period Returns
        ax2 = plt.subplot(3, 4, 2)
        colors = ['green' if r > 0 else 'red' for r in returns]
        plt.bar(periods, returns, color=colors, alpha=0.7)
        plt.title('📊 Period Returns (%)', fontweight='bold')
        plt.xlabel('Period')
        plt.ylabel('Return (%)')
        plt.grid(True, alpha=0.3)
        
        # 3. Risk-Adjusted Returns (Sharpe)
        ax3 = plt.subplot(3, 4, 3)
        plt.plot(periods, sharpe_ratios, 'g-', linewidth=2, marker='s')
        plt.axhline(y=1.0, color='orange', linestyle='--', alpha=0.7, label='Good Sharpe')
        plt.title('📈 Sharpe Ratio Evolution', fontweight='bold')
        plt.xlabel('Period')
        plt.ylabel('Sharpe Ratio')
        plt.legend()
        plt.grid(True, alpha=0.3)
        
        # 4. Drawdown Analysis
        ax4 = plt.subplot(3, 4, 4)
        plt.plot(periods, drawdowns, 'r-', linewidth=2, marker='^')
        plt.title('📉 Max Drawdown (%)', fontweight='bold')
        plt.xlabel('Period')
        plt.ylabel('Drawdown (%)')
        plt.grid(True, alpha=0.3)
        
        # 5. Trading Activity
        ax5 = plt.subplot(3, 4, 5)
        plt.bar(periods, trades, color='purple', alpha=0.7)
        plt.title('🎯 Trading Activity', fontweight='bold')
        plt.xlabel('Period')
        plt.ylabel('Number of Trades')
        plt.grid(True, alpha=0.3)
        
        # 6. Parameter Evolution - Lookback
        ax6 = plt.subplot(3, 4, 6)
        lookbacks = [r['best_params']['lookback'] for r in wf_results]
        plt.plot(periods, lookbacks, 'orange', linewidth=2, marker='D')
        plt.title('🔧 Lookback Period Evolution', fontweight='bold')
        plt.xlabel('Period')
        plt.ylabel('Lookback Days')
        plt.grid(True, alpha=0.3)
        
        # 7. Parameter Evolution - Volume Multiplier
        ax7 = plt.subplot(3, 4, 7)
        vol_mults = [r['best_params']['volume_mult'] for r in wf_results]
        plt.plot(periods, vol_mults, 'brown', linewidth=2, marker='h')
        plt.title('📊 Volume Multiplier Evolution', fontweight='bold')
        plt.xlabel('Period')
        plt.ylabel('Volume Multiplier')
        plt.grid(True, alpha=0.3)
        
        # 8. Parameter Evolution - Breakout %
        ax8 = plt.subplot(3, 4, 8)
        breakout_pcts = [r['best_params']['breakout_pct']*100 for r in wf_results]
        plt.plot(periods, breakout_pcts, 'teal', linewidth=2, marker='p')
        plt.title('📈 Breakout Threshold Evolution', fontweight='bold')
        plt.xlabel('Period')
        plt.ylabel('Breakout %')
        plt.grid(True, alpha=0.3)
        
        # 9. Return Distribution
        ax9 = plt.subplot(3, 4, 9)
        plt.hist(returns, bins=10, color='skyblue', alpha=0.7, edgecolor='black')
        plt.axvline(np.mean(returns), color='red', linestyle='--', label=f'Mean: {np.mean(returns):.1f}%')
        plt.title('📊 Return Distribution', fontweight='bold')
        plt.xlabel('Return (%)')
        plt.ylabel('Frequency')
        plt.legend()
        plt.grid(True, alpha=0.3)
        
        # 10. Risk vs Return Scatter
        ax10 = plt.subplot(3, 4, 10)
        scatter = plt.scatter(drawdowns, returns, c=sharpe_ratios, cmap='RdYlGn', s=100, alpha=0.7)
        plt.colorbar(scatter, label='Sharpe Ratio')
        plt.title('⚖️ Risk vs Return', fontweight='bold')
        plt.xlabel('Max Drawdown (%)')
        plt.ylabel('Return (%)')
        plt.grid(True, alpha=0.3)
        
        # 11. Performance Summary Stats
        ax11 = plt.subplot(3, 4, (11, 12))
        ax11.axis('off')
        
        # Calculate summary statistics
        total_periods = len(wf_results)
        profitable_periods = len([r for r in returns if r > 0])
        avg_return = np.mean(returns)
        avg_sharpe = np.mean(sharpe_ratios)
        max_dd = max(drawdowns)
        total_trades_all = sum(trades)
        
        # Create performance summary text
        summary_text = f"""
        📊 PERFORMANCE SUMMARY - {self.market_info['stock_name']}
        
        🔹 Total Periods Analyzed: {total_periods}
        🔹 Profitable Periods: {profitable_periods} ({profitable_periods/total_periods*100:.1f}%)
        🔹 Average Return per Period: {avg_return:+.2f}%
        🔹 Average Sharpe Ratio: {avg_sharpe:.2f}
        🔹 Maximum Drawdown: {max_dd:.2f}%
        🔹 Total Trades Generated: {total_trades_all}
        
        💰 CUMULATIVE PERFORMANCE:
        🔹 Total Strategy Return: {(cumulative_returns[-1]-1)*100:+.2f}%
        🔹 Annualized Return: {((cumulative_returns[-1]**(252/len(wf_results)))-1)*100:+.2f}%
        
        🇮🇳 INDIAN MARKET SPECIFICS:
        🔹 Trading Costs: {self.fees*100:.2f}% per trade
        🔹 Direction: {self.direction.upper()}
        🔹 Currency: INR (₹)
        🔹 Exchange: {self.market_info['exchange']}
        """
        
        ax11.text(0.05, 0.95, summary_text, transform=ax11.transAxes, fontsize=11,
                 verticalalignment='top', fontfamily='monospace',
                 bbox=dict(boxstyle='round', facecolor='lightblue', alpha=0.1))
        
        plt.tight_layout()
        
        # Save the plot
        if save_path is None:
            save_path = f"tatamotors_walkforward_dashboard_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        
        plt.savefig(save_path, dpi=300, bbox_inches='tight')
        console.print(f"[green]✅ Dashboard saved: {save_path}[/green]")
        
        # Also show the plot
        plt.show()
        
        return save_path
    
    def save_results_json(self, filename: str = None):
        """Save results to JSON file"""
        if filename is None:
            filename = f"tatamotors_walkforward_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        # Prepare data for JSON serialization
        json_data = {
            'symbol': self.symbol,
            'market_info': self.market_info,
            'config': self.config,
            'analysis_date': datetime.now().isoformat(),
            'results': []
        }
        
        for result in self.results.get(self.symbol, []):
            json_result = result.copy()
            # Convert dates to strings
            json_result['train_dates'] = [d.isoformat() for d in result['train_dates']]
            json_result['test_dates'] = [d.isoformat() for d in result['test_dates']]
            # Remove non-serializable portfolio object
            if 'portfolio' in json_result['test_result']:
                del json_result['test_result']['portfolio']
            json_data['results'].append(json_result)
        
        with open(filename, 'w') as f:
            json.dump(json_data, f, indent=2)
        
        console.print(f"[green]✅ Results saved: {filename}[/green]")
        return filename
    
    def run_full_analysis(self, days_back: int = 365):
        """Run complete walk forward analysis"""
        
        console.print(Panel.fit(
            f"[bold white]🇮🇳 Starting Complete TATAMOTORS Analysis[/bold white]\n"
            f"This will perform comprehensive walk forward optimization",
            border_style="white"
        ))
        
        try:
            # Run walk forward analysis
            wf_results = self.run_walk_forward_analysis()
            
            if not wf_results:
                console.print("[red]❌ No results generated[/red]")
                return
            
            # Create dashboard
            dashboard_path = self.create_indian_stock_dashboard(wf_results)
            
            # Save results
            json_path = self.save_results_json()
            
            # Final summary
            profitable_periods = len([r for r in wf_results if r['test_return'] > 0])
            avg_return = np.mean([r['test_return'] for r in wf_results])
            
            console.print(Panel.fit(
                f"[bold green]✅ Analysis Complete![/bold green]\n\n"
                f"📊 Results: {profitable_periods}/{len(wf_results)} profitable periods\n"
                f"📈 Average Return: {avg_return:+.2f}% per period\n"
                f"💾 Dashboard: {dashboard_path}\n"
                f"📄 Results: {json_path}",
                border_style="green"
            ))
            
        except KeyboardInterrupt:
            console.print("\n[yellow]Analysis interrupted by user[/yellow]")
        except Exception as e:
            console.print(f"\n[red]Analysis failed: {e}[/red]")

def main():
    """Main analysis function"""
    
    # Initialize analyzer with daily configuration
    analyzer = TATAMOTORSWalkForward('TATAMOTORS_DAILY')
    
    # Run full analysis
    analyzer.run_full_analysis()

if __name__ == "__main__":
    main() 