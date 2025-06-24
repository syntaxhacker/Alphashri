#!/usr/bin/env python3
"""
IMPROVED ETH Walkforward Analysis with Enhanced Strategy
Better breakout strategy with multiple confirmations and adaptive parameters
"""

import vectorbt as vbt
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
import optuna
from datetime import datetime, timedelta
from rich.console import Console
from rich.table import Table
import time
import warnings
warnings.filterwarnings('ignore')

# Import enhanced data fetcher
from enhanced_data_fetcher import EnhancedDataFetcher

# VectorBT imports
try:
    import vectorbt as vbt
    HAS_VECTORBT = True
except ImportError:
    HAS_VECTORBT = False
    print("❌ VectorBT not found. Install with: pip install vectorbt")

console = Console()

class ImprovedETHWalkForwardAnalyzer:
    """Enhanced ETH walkforward analyzer with improved strategy"""
    
    def __init__(self, data_fetcher):
        self.console = Console()
        self.data_fetcher = data_fetcher
        
        # Walkforward parameters - optimized
        self.training_days = 45      # Increased training period
        self.testing_days = 10       # Longer testing period
        self.step_days = 5           # Larger steps for more diverse windows
        
        self.walkforward_results = []
        
    def fetch_eth_data(self, days=180):
        """Fetch ETH data for walkforward analysis"""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        self.console.print(f"[cyan]📊 Fetching ETHUSDT 1h data for {days} days (6 months)...[/cyan]")
        
        data = self.data_fetcher.fetch_data(
            symbol='ETHUSDT',
            start_date=start_date,
            end_date=end_date,
            timeframe='1h'
        )
        
        if data.empty:
            self.console.print("[red]❌ No ETH data available[/red]")
            return None
        
        self.console.print(f"[green]✅ Fetched {len(data)} bars for ETHUSDT[/green]")
        self.console.print(f"[cyan]📈 Price range: ${data['close'].min():.2f} - ${data['close'].max():.2f}[/cyan]")
        
        return data
    
    def calculate_enhanced_indicators(self, data):
        """Calculate enhanced technical indicators"""
        df = data.copy()
        
        # Price-based indicators
        df['ema_fast'] = df['close'].ewm(span=12).mean()
        df['ema_slow'] = df['close'].ewm(span=26).mean()
        df['ema_trend'] = df['close'].ewm(span=50).mean()
        
        # Volatility indicators
        df['atr'] = self.calculate_atr(df, 14)
        df['bb_upper'], df['bb_lower'] = self.calculate_bollinger_bands(df, 20, 2)
        df['bb_width'] = (df['bb_upper'] - df['bb_lower']) / df['close']
        
        # Volume indicators
        df['volume_ema'] = df['volume'].ewm(span=20).mean()
        df['volume_ratio'] = df['volume'] / df['volume_ema']
        
        # Momentum indicators
        df['rsi'] = self.calculate_rsi(df, 14)
        df['macd'], df['macd_signal'] = self.calculate_macd(df)
        
        # Trend strength
        df['adx'] = self.calculate_adx(df, 14)
        
        # Support/Resistance levels
        df['resistance'] = df['high'].rolling(window=20).max()
        df['support'] = df['low'].rolling(window=20).min()
        
        return df
    
    def calculate_atr(self, data, period=14):
        """Calculate Average True Range"""
        high_low = data['high'] - data['low']
        high_close = np.abs(data['high'] - data['close'].shift())
        low_close = np.abs(data['low'] - data['close'].shift())
        
        tr = np.maximum(high_low, np.maximum(high_close, low_close))
        return tr.rolling(window=period).mean()
    
    def calculate_bollinger_bands(self, data, period=20, std_dev=2):
        """Calculate Bollinger Bands"""
        sma = data['close'].rolling(window=period).mean()
        std = data['close'].rolling(window=period).std()
        
        upper = sma + (std * std_dev)
        lower = sma - (std * std_dev)
        
        return upper, lower
    
    def calculate_rsi(self, data, period=14):
        """Calculate Relative Strength Index"""
        delta = data['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        
        rs = gain / loss
        return 100 - (100 / (1 + rs))
    
    def calculate_macd(self, data, fast=12, slow=26, signal=9):
        """Calculate MACD"""
        ema_fast = data['close'].ewm(span=fast).mean()
        ema_slow = data['close'].ewm(span=slow).mean()
        
        macd = ema_fast - ema_slow
        macd_signal = macd.ewm(span=signal).mean()
        
        return macd, macd_signal
    
    def calculate_adx(self, data, period=14):
        """Calculate Average Directional Index (simplified)"""
        high_diff = data['high'].diff()
        low_diff = data['low'].diff()
        
        dm_plus = np.where((high_diff > low_diff) & (high_diff > 0), high_diff, 0)
        dm_minus = np.where((low_diff > high_diff) & (low_diff > 0), low_diff, 0)
        
        tr = self.calculate_atr(data, 1)
        
        di_plus = 100 * pd.Series(dm_plus).rolling(window=period).mean() / tr.rolling(window=period).mean()
        di_minus = 100 * pd.Series(dm_minus).rolling(window=period).mean() / tr.rolling(window=period).mean()
        
        dx = 100 * np.abs(di_plus - di_minus) / (di_plus + di_minus)
        adx = dx.rolling(window=period).mean()
        
        return adx.fillna(0)
    
    def create_improved_strategy_signals(self, data, lookback=20, volume_mult=1.5, 
                                       breakout_pct=0.015, rsi_threshold=30, 
                                       adx_threshold=25, bb_threshold=0.02):
        """Create improved strategy with multiple confirmations"""
        
        df = self.calculate_enhanced_indicators(data)
        
        # Entry conditions - must ALL be true
        long_conditions = [
            # 1. Price breakout above resistance
            df['close'] > df['resistance'].shift(1) * (1 + breakout_pct),
            
            # 2. Volume confirmation
            df['volume_ratio'] > volume_mult,
            
            # 3. Trend confirmation - EMAs aligned
            df['ema_fast'] > df['ema_slow'],
            df['ema_slow'] > df['ema_trend'],
            
            # 4. RSI not overbought
            df['rsi'] < (100 - rsi_threshold),
            
            # 5. MACD bullish
            df['macd'] > df['macd_signal'],
            
            # 6. Strong trend (ADX)
            df['adx'] > adx_threshold,
            
            # 7. Volatility expansion
            df['bb_width'] > bb_threshold,
            
            # 8. Price above Bollinger middle
            df['close'] > (df['bb_upper'] + df['bb_lower']) / 2
        ]
        
        short_conditions = [
            # 1. Price breakdown below support
            df['close'] < df['support'].shift(1) * (1 - breakout_pct),
            
            # 2. Volume confirmation
            df['volume_ratio'] > volume_mult,
            
            # 3. Trend confirmation - EMAs aligned bearish
            df['ema_fast'] < df['ema_slow'],
            df['ema_slow'] < df['ema_trend'],
            
            # 4. RSI not oversold
            df['rsi'] > rsi_threshold,
            
            # 5. MACD bearish
            df['macd'] < df['macd_signal'],
            
            # 6. Strong trend (ADX)
            df['adx'] > adx_threshold,
            
            # 7. Volatility expansion
            df['bb_width'] > bb_threshold,
            
            # 8. Price below Bollinger middle
            df['close'] < (df['bb_upper'] + df['bb_lower']) / 2
        ]
        
        # Combine all conditions
        long_entries = np.all(long_conditions, axis=0)
        short_entries = np.all(short_conditions, axis=0)
        
        # Exit conditions - dynamic stop loss and take profit
        df['stop_loss_long'] = df['close'] - (df['atr'] * 2)
        df['take_profit_long'] = df['close'] + (df['atr'] * 3)
        df['stop_loss_short'] = df['close'] + (df['atr'] * 2)
        df['take_profit_short'] = df['close'] - (df['atr'] * 3)
        
        return long_entries, short_entries, df
    
    def optimize_on_training_data(self, train_data):
        """Optimize strategy parameters using Optuna"""
        best_params = None
        best_score = -np.inf
        
        def objective(trial):
            # Parameter ranges - more conservative
            lookback = trial.suggest_int('lookback', 15, 30)
            volume_mult = trial.suggest_float('volume_mult', 1.2, 2.5)
            breakout_pct = trial.suggest_float('breakout_pct', 0.008, 0.025)
            rsi_threshold = trial.suggest_int('rsi_threshold', 20, 40)
            adx_threshold = trial.suggest_int('adx_threshold', 15, 35)
            bb_threshold = trial.suggest_float('bb_threshold', 0.01, 0.04)
            
            try:
                long_entries, short_entries, enhanced_df = self.create_improved_strategy_signals(
                    train_data, lookback, volume_mult, breakout_pct, 
                    rsi_threshold, adx_threshold, bb_threshold
                )
                
                if long_entries.sum() == 0 and short_entries.sum() == 0:
                    return -1000  # Penalty for no trades
                
                # Create exits based on stops and targets
                long_exits, short_exits = self.create_dynamic_exits(
                    train_data, enhanced_df, long_entries, short_entries
                )
                
                pf = vbt.Portfolio.from_signals(
                    close=train_data['close'],
                    entries=long_entries,
                    exits=long_exits,
                    short_entries=short_entries,
                    short_exits=short_exits,
                    init_cash=10000,
                    fees=0.001,
                    freq='h'
                )
                
                stats = pf.stats()
                
                total_return = float(stats.get('Total Return [%]', 0))
                sharpe = float(stats.get('Sharpe Ratio', 0))
                max_dd = float(stats.get('Max Drawdown [%]', 0))
                win_rate = float(stats.get('Win Rate [%]', 0))
                total_trades = int(stats.get('Total Trades', 0))
                
                # Enhanced scoring function
                if total_trades < 3:  # Minimum trade requirement
                    return -1000
                
                # Multi-objective optimization
                return_score = total_return / 100  # Normalize
                sharpe_score = min(sharpe, 3) / 3  # Cap and normalize Sharpe
                dd_penalty = max_dd / 100  # Drawdown penalty
                trade_bonus = min(total_trades, 20) / 20  # Trade frequency bonus
                
                score = (return_score * 0.4 + sharpe_score * 0.3 + 
                        trade_bonus * 0.2 - dd_penalty * 0.1)
                
                return score
                
            except Exception as e:
                return -1000
        
        # Run optimization
        study = optuna.create_study(direction='maximize', sampler=optuna.samplers.TPESampler())
        study.optimize(objective, n_trials=50, show_progress_bar=False)  # More trials
        
        if study.best_value > -999:
            return study.best_params
        
        return None
    
    def create_dynamic_exits(self, data, enhanced_df, long_entries, short_entries):
        """Create dynamic exit signals based on ATR stops"""
        long_exits = pd.Series(False, index=data.index)
        short_exits = pd.Series(False, index=data.index)
        
        # Track positions
        long_position = False
        short_position = False
        entry_price = 0
        stop_loss = 0
        take_profit = 0
        
        for i in range(1, len(data)):
            current_price = data['close'].iloc[i]
            
            # Long position management
            if long_entries.iloc[i] and not long_position:
                long_position = True
                entry_price = current_price
                stop_loss = current_price - (enhanced_df['atr'].iloc[i] * 2)
                take_profit = current_price + (enhanced_df['atr'].iloc[i] * 3)
            
            elif long_position:
                # Trailing stop
                new_stop = current_price - (enhanced_df['atr'].iloc[i] * 2)
                stop_loss = max(stop_loss, new_stop)
                
                # Exit conditions
                if (current_price <= stop_loss or 
                    current_price >= take_profit or
                    enhanced_df['rsi'].iloc[i] > 80):  # Overbought exit
                    long_exits.iloc[i] = True
                    long_position = False
            
            # Short position management
            if short_entries.iloc[i] and not short_position:
                short_position = True
                entry_price = current_price
                stop_loss = current_price + (enhanced_df['atr'].iloc[i] * 2)
                take_profit = current_price - (enhanced_df['atr'].iloc[i] * 3)
            
            elif short_position:
                # Trailing stop
                new_stop = current_price + (enhanced_df['atr'].iloc[i] * 2)
                stop_loss = min(stop_loss, new_stop)
                
                # Exit conditions
                if (current_price >= stop_loss or 
                    current_price <= take_profit or
                    enhanced_df['rsi'].iloc[i] < 20):  # Oversold exit
                    short_exits.iloc[i] = True
                    short_position = False
        
        return long_exits, short_exits
    
    def test_on_out_of_sample(self, test_data, params):
        """Test optimized parameters on out-of-sample data"""
        if not params:
            return None
        
        try:
            long_entries, short_entries, enhanced_df = self.create_improved_strategy_signals(
                test_data, 
                params['lookback'], 
                params['volume_mult'], 
                params['breakout_pct'],
                params['rsi_threshold'],
                params['adx_threshold'],
                params['bb_threshold']
            )
            
            if long_entries.sum() == 0 and short_entries.sum() == 0:
                return {
                    'return': 0,
                    'sharpe': 0,
                    'trades': 0,
                    'win_rate': 0,
                    'max_dd': 0
                }
            
            long_exits, short_exits = self.create_dynamic_exits(
                test_data, enhanced_df, long_entries, short_entries
            )
            
            pf = vbt.Portfolio.from_signals(
                close=test_data['close'],
                entries=long_entries,
                exits=long_exits,
                short_entries=short_entries,
                short_exits=short_exits,
                init_cash=10000,
                fees=0.001,
                freq='h'
            )
            
            stats = pf.stats()
            
            return {
                'return': float(stats.get('Total Return [%]', 0)),
                'sharpe': float(stats.get('Sharpe Ratio', 0)),
                'trades': int(stats.get('Total Trades', 0)),
                'win_rate': float(stats.get('Win Rate [%]', 0)),
                'max_dd': float(stats.get('Max Drawdown [%]', 0)),
                'equity_curve': pf.value().values
            }
            
        except Exception as e:
            return None
    
    def run_walkforward_analysis(self, data):
        """Run complete walkforward analysis"""
        self.console.print("[yellow]🔄 Running walkforward analysis...[/yellow]")
        
        total_hours = len(data)
        training_hours = self.training_days * 24
        testing_hours = self.testing_days * 24
        step_hours = self.step_days * 24
        
        results = []
        
        # Rolling window analysis
        start_idx = 0
        window_count = 0
        
        while start_idx + training_hours + testing_hours <= total_hours:
            window_count += 1
            
            # Define training and testing periods
            train_start = start_idx
            train_end = start_idx + training_hours
            test_start = train_end
            test_end = test_start + testing_hours
            
            # Extract data
            train_data = data.iloc[train_start:train_end].copy()
            test_data = data.iloc[test_start:test_end].copy()
            
            # Get dates for tracking
            train_period = f"{train_data.index[0].strftime('%m-%d')} to {train_data.index[-1].strftime('%m-%d')}"
            test_period = f"{test_data.index[0].strftime('%m-%d')} to {test_data.index[-1].strftime('%m-%d')}"
            
            self.console.print(f"[cyan]📊 Window {window_count}: Train({train_period}) → Test({test_period})[/cyan]")
            
            # Optimize on training data
            best_params = self.optimize_on_training_data(train_data)
            
            if best_params:
                # Test on training data (in-sample performance)
                train_result = self.test_on_out_of_sample(train_data, best_params)
                
                # Test on out-of-sample data
                test_result = self.test_on_out_of_sample(test_data, best_params)
                
                if test_result and train_result:
                    result = {
                        'window': window_count,
                        'train_start': train_data.index[0],
                        'train_end': train_data.index[-1],
                        'test_start': test_data.index[0],
                        'test_end': test_data.index[-1],
                        'train_period': train_period,
                        'test_period': test_period,
                        'best_params': best_params,
                        'train_return': train_result['return'],
                        'train_sharpe': train_result['sharpe'],
                        'train_trades': train_result['trades'],
                        'train_win_rate': train_result['win_rate'],
                        'train_max_dd': train_result['max_dd'],
                        'test_return': test_result['return'],
                        'test_sharpe': test_result['sharpe'],
                        'test_trades': test_result['trades'],
                        'test_win_rate': test_result['win_rate'],
                        'test_max_dd': test_result['max_dd'],
                        'equity_curve': test_result.get('equity_curve', [])
                    }
                    
                    results.append(result)
                    
                    # Show progress
                    self.console.print(f"[green]✓ Return: {test_result['return']:.2f}%, Sharpe: {test_result['sharpe']:.2f}, Trades: {test_result['trades']}[/green]")
            
            # Step forward
            start_idx += step_hours
        
        self.walkforward_results = results
        self.console.print(f"[green]✅ Completed {len(results)} walkforward windows[/green]")
        
        return results
    
    def create_simple_visualizations(self):
        """Create simple, clear visualizations with in-sample vs out-of-sample comparison"""
        if not self.walkforward_results:
            self.console.print("[red]❌ No walkforward results to visualize[/red]")
            return
        
        # Extract metrics for plotting
        train_returns = [r['train_return'] for r in self.walkforward_results]
        test_returns = [r['test_return'] for r in self.walkforward_results]
        windows = [r['window'] for r in self.walkforward_results]
        test_periods = [r['test_period'] for r in self.walkforward_results]
        
        # Create 2x3 grid for more comprehensive analysis
        fig, ((ax1, ax2, ax3), (ax4, ax5, ax6)) = plt.subplots(2, 3, figsize=(18, 12))
        
        # 1. In-Sample vs Out-of-Sample Performance (KEY CHART)
        ax1.plot(windows, train_returns, 'b-o', linewidth=2, markersize=6, label='In-Sample (Train)', alpha=0.8)
        ax1.plot(windows, test_returns, 'r-o', linewidth=2, markersize=6, label='Out-of-Sample (Test)', alpha=0.8)
        ax1.axhline(y=0, color='black', linestyle='--', linewidth=1, alpha=0.5)
        ax1.set_title('In-Sample vs Out-of-Sample Returns', fontsize=14, fontweight='bold')
        ax1.set_xlabel('Window Number', fontsize=12)
        ax1.set_ylabel('Return (%)', fontsize=12)
        ax1.legend(fontsize=10)
        ax1.grid(True, alpha=0.3)
        
        # 2. Rolling Window Performance (Out-of-Sample Only)
        ax2.plot(windows, test_returns, 'r-o', linewidth=3, markersize=8)
        ax2.axhline(y=0, color='black', linestyle='--', linewidth=2)
        ax2.set_title('Out-of-Sample Returns per Window', fontsize=14, fontweight='bold')
        ax2.set_xlabel('Window Number', fontsize=12)
        ax2.set_ylabel('Return (%)', fontsize=12)
        ax2.grid(True, alpha=0.3)
        
        # Add value labels for extreme returns
        for i, v in enumerate(test_returns):
            if abs(v) > 10:  # Only label significant returns
                ax2.annotate(f'{v:.1f}%', (windows[i], v), textcoords="offset points", 
                           xytext=(0,15), ha='center', fontsize=9, fontweight='bold')
        
        # 3. Cumulative Performance Comparison
        cumulative_train = np.cumsum(train_returns)
        cumulative_test = np.cumsum(test_returns)
        ax3.plot(windows, cumulative_train, 'b-', linewidth=2, label='In-Sample Cumulative', alpha=0.8)
        ax3.plot(windows, cumulative_test, 'r-', linewidth=2, label='Out-of-Sample Cumulative', alpha=0.8)
        ax3.set_title('Cumulative Returns Comparison', fontsize=14, fontweight='bold')
        ax3.set_xlabel('Window Number', fontsize=12)
        ax3.set_ylabel('Cumulative Return (%)', fontsize=12)
        ax3.legend(fontsize=10)
        ax3.grid(True, alpha=0.3)
        
        # Final return annotations
        ax3.annotate(f'Train Total: {cumulative_train[-1]:.1f}%', 
                    xy=(windows[-1], cumulative_train[-1]), 
                    xytext=(-60, 20), textcoords='offset points',
                    bbox=dict(boxstyle='round,pad=0.3', facecolor='lightblue'),
                    fontsize=10, fontweight='bold')
        ax3.annotate(f'Test Total: {cumulative_test[-1]:.1f}%', 
                    xy=(windows[-1], cumulative_test[-1]), 
                    xytext=(-60, -20), textcoords='offset points',
                    bbox=dict(boxstyle='round,pad=0.3', facecolor='lightcoral'),
                    fontsize=10, fontweight='bold')
        
        # 4. Performance Correlation (Overfitting Check)
        ax4.scatter(train_returns, test_returns, alpha=0.7, s=50, c='purple')
        
        # Add correlation line
        if len(train_returns) > 1:
            z = np.polyfit(train_returns, test_returns, 1)
            p = np.poly1d(z)
            ax4.plot(train_returns, p(train_returns), "g--", alpha=0.8, linewidth=2)
            
            # Calculate correlation
            correlation = np.corrcoef(train_returns, test_returns)[0,1]
            ax4.text(0.05, 0.95, f'Correlation: {correlation:.3f}', 
                    transform=ax4.transAxes, fontsize=12, fontweight='bold',
                    bbox=dict(boxstyle='round', facecolor='white', alpha=0.8))
        
        ax4.axhline(y=0, color='black', linestyle='-', alpha=0.3)
        ax4.axvline(x=0, color='black', linestyle='-', alpha=0.3)
        ax4.set_title('Train vs Test Performance\n(Overfitting Check)', fontsize=14, fontweight='bold')
        ax4.set_xlabel('In-Sample Return (%)', fontsize=12)
        ax4.set_ylabel('Out-of-Sample Return (%)', fontsize=12)
        ax4.grid(True, alpha=0.3)
        
        # 5. Return Distribution Comparison
        ax5.hist(train_returns, bins=min(10, len(train_returns)), alpha=0.5, color='blue', 
                label='In-Sample', edgecolor='black', density=True)
        ax5.hist(test_returns, bins=min(10, len(test_returns)), alpha=0.5, color='red', 
                label='Out-of-Sample', edgecolor='black', density=True)
        ax5.axvline(x=np.mean(train_returns), color='blue', linestyle='--', linewidth=2, 
                   label=f'Train Avg: {np.mean(train_returns):.2f}%')
        ax5.axvline(x=np.mean(test_returns), color='red', linestyle='--', linewidth=2, 
                   label=f'Test Avg: {np.mean(test_returns):.2f}%')
        ax5.set_title('Return Distribution Comparison', fontsize=14, fontweight='bold')
        ax5.set_xlabel('Return (%)', fontsize=12)
        ax5.set_ylabel('Density', fontsize=12)
        ax5.legend(fontsize=10)
        ax5.grid(True, alpha=0.3)
        
        # 6. Performance Statistics Summary
        ax6.axis('off')
        
        # Calculate key statistics
        train_avg = np.mean(train_returns)
        test_avg = np.mean(test_returns)
        train_win_rate = len([r for r in train_returns if r > 0]) / len(train_returns) * 100
        test_win_rate = len([r for r in test_returns if r > 0]) / len(test_returns) * 100
        train_vol = np.std(train_returns)
        test_vol = np.std(test_returns)
        
        stats_text = f"""
PERFORMANCE SUMMARY

In-Sample (Training):
• Average Return: {train_avg:.2f}%
• Win Rate: {train_win_rate:.1f}%
• Volatility: {train_vol:.2f}%
• Total Return: {cumulative_train[-1]:.2f}%

Out-of-Sample (Testing):
• Average Return: {test_avg:.2f}%
• Win Rate: {test_win_rate:.1f}%
• Volatility: {test_vol:.2f}%
• Total Return: {cumulative_test[-1]:.2f}%

Strategy Assessment:
• Performance Gap: {train_avg - test_avg:.2f}%
• Overfitting Risk: {"HIGH" if (train_avg - test_avg) > 2 else "MODERATE" if (train_avg - test_avg) > 1 else "LOW"}
• Correlation: {np.corrcoef(train_returns, test_returns)[0,1]:.3f}
        """
        
        ax6.text(0.1, 0.9, stats_text, transform=ax6.transAxes, fontsize=12,
                verticalalignment='top', fontfamily='monospace',
                bbox=dict(boxstyle='round', facecolor='lightgray', alpha=0.8))
        
        plt.tight_layout()
        plt.savefig('eth_walkforward_detailed.png', dpi=300, bbox_inches='tight')
        plt.close()
        
        self.console.print("[green]✅ Detailed in-sample vs out-of-sample visualizations saved as 'eth_walkforward_detailed.png'[/green]")
    
    def display_summary_statistics(self):
        """Display comprehensive summary statistics"""
        if not self.walkforward_results:
            return
        
        returns = [r['test_return'] for r in self.walkforward_results]
        sharpes = [r['test_sharpe'] if not (np.isnan(r['test_sharpe']) or np.isinf(r['test_sharpe'])) else 0 for r in self.walkforward_results]
        win_rates = [r['test_win_rate'] for r in self.walkforward_results]
        
        # Summary statistics
        self.console.print("\n[bold green]📊 WALKFORWARD SUMMARY STATISTICS[/bold green]")
        
        stats_table = Table(title="ETH Walkforward Performance Summary")
        stats_table.add_column("Metric", style="cyan")
        stats_table.add_column("Value", style="green")
        
        # Calculate comprehensive stats
        total_return = sum(returns)
        avg_return = np.mean(returns)
        std_return = np.std(returns)
        sharpe_overall = avg_return / std_return if std_return > 0 else 0
        positive_windows = sum(1 for r in returns if r > 0)
        total_windows = len(returns)
        stability_pct = (positive_windows / total_windows) * 100
        
        stats_table.add_row("Total Windows", str(total_windows))
        stats_table.add_row("Positive Windows", f"{positive_windows} ({stability_pct:.1f}%)")
        stats_table.add_row("Total Return", f"{total_return:.2f}%")
        stats_table.add_row("Average Return per Window", f"{avg_return:.2f}%")
        stats_table.add_row("Return Volatility", f"{std_return:.2f}%")
        stats_table.add_row("Overall Sharpe Ratio", f"{sharpe_overall:.2f}")
        stats_table.add_row("Best Window Return", f"{max(returns):.2f}%")
        stats_table.add_row("Worst Window Return", f"{min(returns):.2f}%")
        stats_table.add_row("Average Win Rate", f"{np.mean(win_rates):.1f}%")
        
        self.console.print(stats_table)
        
        # Detailed window results
        self.console.print("\n[bold cyan]📋 DETAILED WINDOW RESULTS[/bold cyan]")
        
        results_table = Table(title="Individual Window Performance")
        results_table.add_column("Window", style="cyan", width=6)
        results_table.add_column("Test Period", style="yellow", width=12)
        results_table.add_column("Return %", style="green", width=8)
        results_table.add_column("Sharpe", style="blue", width=6)
        results_table.add_column("Trades", style="white", width=6)
        results_table.add_column("Win Rate %", style="magenta", width=9)
        results_table.add_column("Max DD %", style="red", width=8)
        
        for result in self.walkforward_results:
            results_table.add_row(
                str(result['window']),
                result['test_period'],
                f"{result['test_return']:.2f}",
                f"{result['test_sharpe']:.2f}" if not (np.isnan(result['test_sharpe']) or np.isinf(result['test_sharpe'])) else "N/A",
                str(result['test_trades']),
                f"{result['test_win_rate']:.1f}",
                f"{result['test_max_dd']:.2f}"
            )
        
        self.console.print(results_table)

def run_eth_walkforward_analysis():
    """Main function to run ETH walkforward analysis"""
    
    console.print("[bold blue]🚀 ETH Walkforward Analysis with VectorBT[/bold blue]")
    console.print("[cyan]Rolling windows optimization with detailed visualizations[/cyan]")
    
    if not HAS_VECTORBT:
        console.print("[red]❌ VectorBT not available[/red]")
        return
    
    # API credentials
    API_KEY = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    API_SECRET = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
    
    # Initialize data fetcher
    data_fetcher = EnhancedDataFetcher(
        api_key=API_KEY,
        api_secret=API_SECRET,
        cache_dir='vectorbt_cache'
    )
    
    # Initialize analyzer
    analyzer = ImprovedETHWalkForwardAnalyzer(data_fetcher)
    
    # Fetch ETH data
    eth_data = analyzer.fetch_eth_data(days=180)  # 6 months of data
    if eth_data is None:
        return
    
    # Run walkforward analysis
    results = analyzer.run_walkforward_analysis(eth_data)
    
    if not results:
        console.print("[red]❌ No walkforward results generated[/red]")
        return
    
    # Display summary statistics
    analyzer.display_summary_statistics()
    
    # Create detailed in-sample vs out-of-sample visualizations
    analyzer.create_simple_visualizations()
    
    console.print("\n[bold green]🎉 ETH Walkforward Analysis Complete![/bold green]")
    console.print("[cyan]Check 'eth_walkforward_detailed.png' for in-sample vs out-of-sample analysis[/cyan]")

if __name__ == "__main__":
    run_eth_walkforward_analysis() 