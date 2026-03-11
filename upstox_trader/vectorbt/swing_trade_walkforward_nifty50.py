#!/usr/bin/env python3
"""
Swing Trading Walk-Forward Analysis for NIFTY 50 stocks
Implements a swing trading strategy using RSI, Moving Averages, and Volume
with VectorBT walk-forward validation across all NIFTY 50 stocks
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
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

# Import robust fetcher
from robust_5min_fetcher import Robust5MinFetcher

console = Console()

# NIFTY 50 stocks (complete list as of 2024)
NIFTY_50_STOCKS = [
    "RELIANCE"
]

class SwingTradingWalkForward:
    """
    Swing Trading Walk-Forward Analysis using VectorBT
    Implements RSI + Moving Average + Volume strategy optimized for swing trades
    Enhanced with PPO-style parameter optimization for maximum P&L
    """
    
    def __init__(self, api):
        self.api = api
        self.results = {}
        self.capital_per_symbol = 10000  # 10,000 rupees per symbol
        self.best_global_params = None
        self.best_global_pnl = -float('inf')
        self.param_search_history = []
        self.learning_rate = 0.1
        self.exploration_rate = 0.2
        
    def fetch_data(self, symbol, days=1500, timeframe='1D'):
        """Fetch historical data using V3 API with enhanced error handling"""
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
        
        # Adjust date range based on timeframe limitations
        if unit == 'minutes' and interval <= 5:  # 1-min and 5-min data
            days = min(days, 15)  # Limit to 15 days for high-frequency data
        elif unit == 'minutes' and interval <= 15:  # 15-min data
            days = min(days, 90)  # Limit to 90 days for 15-min data
        elif unit == 'hours':  # Hourly data
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
            return None
        
        if df is None or df.empty:
            console.print(f"[red]❌ No data available for {symbol}[/red]")
            return None
            
        # Ensure we have OHLCV columns
        required_cols = ['open', 'high', 'low', 'close', 'volume']
        for col in required_cols:
            if col not in df.columns:
                console.print(f"[red]❌ Missing column: {col}[/red]")
                return None
        
        console.print(f"[green]✅ Fetched {len(df)} records from {df.index[0]} to {df.index[-1]}[/green]")
        return df
    
    def calculate_swing_trading_signals(self, data, rsi_period=14, rsi_buy=45, rsi_sell=65, 
                                      ma_short=5, ma_long=12, volume_ma=10):
        """
        Calculate swing trading signals using RSI, Moving Averages, and Volume
        
        Entry Conditions:
        - RSI < 45 (moderately oversold) AND trending up
        - Price approaching but above long MA for support
        - Volume above recent average for confirmation
        
        Exit Conditions:  
        - RSI > 65 (moderately overbought) for profit taking
        - Price breaks below long MA or RSI turns down from high levels
        """
        # Calculate indicators
        close = data['close']
        volume = data['volume']
        
        # RSI calculation
        delta = close.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=rsi_period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=rsi_period).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        
        # Moving averages
        ma_short_series = close.rolling(window=ma_short).mean()
        ma_long_series = close.rolling(window=ma_long).mean()
        volume_ma_series = volume.rolling(window=volume_ma).mean()
        
        # Initialize signals
        buy_signals = pd.Series(False, index=data.index)
        sell_signals = pd.Series(False, index=data.index)
        
        # Ultra aggressive conditions for maximum trade frequency
        volume_above_avg = volume > volume_ma_series
        
        # Generate buy signals - EXTREMELY AGGRESSIVE for 400+ day performance
        buy_conditions = (
            (close > ma_short_series) |  # Price above short MA OR
            (rsi < rsi_buy) |            # RSI oversold OR  
            (volume > volume_ma_series * 1.5)  # High volume breakout
        )
        
        # Generate sell signals - Hold for much longer trends
        sell_conditions = (
            (rsi > 85) |  # Very overbought OR
            (close < ma_long_series * 0.95)  # 5% below long MA (major trend break)
        )
        
        buy_signals = buy_conditions
        sell_signals = sell_conditions
        
        
        return buy_signals, sell_signals
    
    def run_walk_forward_analysis(self, symbol, train_period=60, test_period=20, total_periods=6, 
                                timeframe='1D', optimize_params=True):
        """
        Run walk-forward analysis with rolling optimization windows
        """
        # Calculate total days needed - extended for long history test
        total_days = (train_period + test_period) * total_periods
        total_days = max(total_days, 1500)  # Minimum 1500 days for long history test
        
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
        
        results = []
        equity_curves = []
        
        # Walk-forward windows
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
            
            # Optimize parameters on training data with robust method
            if optimize_params:
                best_params = self.optimize_parameters(train_data, min_trades=1)  # Lower threshold for more signals
            else:
                best_params = self.get_default_params()
            
            # Generate signals on test data
            buy_signals, sell_signals = self.calculate_swing_trading_signals(
                test_data, **best_params
            )
            
            # Run backtest on test period using VectorBT
            portfolio = self.run_vectorbt_backtest(test_data, buy_signals, sell_signals, timeframe)
            
            # Store results - properly handle VectorBT method calls with P&L focus
            try:
                # Calculate P&L metrics
                final_value = portfolio.value().iloc[-1]
                initial_value = self.capital_per_symbol
                total_pnl = final_value - initial_value  # Absolute P&L in rupees
                
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
                # Fallback to basic calculations
                equity = portfolio.value()
                final_value = equity.iloc[-1]
                initial_value = self.capital_per_symbol
                total_pnl = final_value - initial_value
                total_return = (equity.iloc[-1] / equity.iloc[0] - 1) * 100
                sharpe_ratio = 0
                max_drawdown = 0
                win_rate = 0
                total_trades = 0
            
            # Debug print signals count
            buy_count = buy_signals.sum()
            sell_count = sell_signals.sum()
            
            
            period_result = {
                'period': period + 1,
                'train_start': train_data.index[0].strftime('%Y-%m-%d'),
                'train_end': train_data.index[-1].strftime('%Y-%m-%d'),
                'test_start': test_data.index[0].strftime('%Y-%m-%d'),
                'test_end': test_data.index[-1].strftime('%Y-%m-%d'),
                'params': best_params,
                'total_return': total_return,
                'total_pnl': total_pnl,  # P&L in rupees
                'final_value': final_value,  # Final portfolio value
                'sharpe_ratio': sharpe_ratio,
                'max_drawdown': max_drawdown,
                'win_rate': win_rate,
                'total_trades': int(total_trades),
                'buy_signals': int(buy_count),
                'sell_signals': int(sell_count),
                'param_stability': self.check_param_stability(results, best_params) if results else 1.0
            }
            
            results.append(period_result)
            equity_curves.append(portfolio.value())
        
        # Combine equity curves - handle empty case
        if equity_curves:
            combined_equity = pd.concat(equity_curves)
        else:
            return None
        
        # Calculate overall metrics
        overall_return = (combined_equity.iloc[-1] / combined_equity.iloc[0] - 1) * 100
        overall_sharpe = self.calculate_sharpe_ratio(combined_equity)
        overall_max_dd = self.calculate_max_drawdown(combined_equity)
        
        # Calculate additional metrics
        total_winning_trades = sum(r['total_trades'] * r['win_rate'] / 100 for r in results if r['total_trades'] > 0)
        avg_trade_duration = self.estimate_avg_trade_duration(results)
        
        return {
            'symbol': symbol,
            'status': 'SUCCESS',
            'periods': results,
            'overall_return': overall_return,
            'overall_sharpe': overall_sharpe,
            'overall_max_dd': overall_max_dd,
            'total_trades': int(sum(r['total_trades'] for r in results)),
            'total_pnl': sum(r.get('total_pnl', 0) for r in results),  # Total P&L across all periods
            'avg_win_rate': np.mean([r['win_rate'] for r in results]),
            'profitable_periods': len([r for r in results if r.get('total_pnl', 0) > 0]),
            'total_periods': len(results),
            'winning_trades': total_winning_trades,
            'avg_trade_duration': avg_trade_duration,
            'param_stability': np.mean([r.get('param_stability', 1.0) for r in results])
        }
    
    def optimize_parameters_ppo_style(self, train_data, generation=0, max_generations=20):
        """
        PPO-style parameter optimization for maximum P&L
        Continuously searches until best parameters found
        """
        best_pnl = -float('inf')
        best_params = None
        
        for gen in range(max_generations):
            console.print(f"[yellow]Generation {gen + 1}/{max_generations} - Searching for optimal P&L...[/yellow]")
            
            # Generate parameter candidates using exploration vs exploitation
            if gen == 0 or np.random.random() < self.exploration_rate:
                # Exploration: wider parameter search
                candidate_params = self.generate_exploration_params()
            else:
                # Exploitation: refine around best known parameters
                candidate_params = self.generate_exploitation_params()
            
            generation_best_pnl = -float('inf')
            generation_best_params = None
            
            for params in candidate_params:
                # Evaluate parameters for P&L
                result = self.evaluate_parameters_for_pnl(train_data, params)
                if result and result['total_pnl'] > generation_best_pnl:
                    generation_best_pnl = result['total_pnl']
                    generation_best_params = params
            
            # Update global best if improved
            if generation_best_pnl > best_pnl:
                best_pnl = generation_best_pnl
                best_params = generation_best_params
                console.print(f"[green]🎯 New best P&L: ₹{best_pnl:.2f} (Gen {gen + 1})[/green]")
                
                # Update global tracking
                if best_pnl > self.best_global_pnl:
                    self.best_global_pnl = best_pnl
                    self.best_global_params = best_params
            else:
                console.print(f"[dim]Gen {gen + 1}: ₹{generation_best_pnl:.2f} (no improvement)[/dim]")
            
            # Early stopping if no improvement for 5 generations (faster for 50 stocks)
            if gen > 5 and all(h['pnl'] <= best_pnl for h in self.param_search_history[-5:]):
                console.print(f"[cyan]Early stopping at generation {gen + 1} - No improvement for 5 generations[/cyan]")
                break
            
            # Store history
            self.param_search_history.append({
                'generation': gen + 1,
                'pnl': generation_best_pnl,
                'params': generation_best_params
            })
            
            # Adaptive exploration rate (decrease over time)
            self.exploration_rate *= 0.95
        
        return best_params if best_params else self.get_default_params()
    
    def generate_exploration_params(self):
        """Generate diverse parameter combinations for exploration"""
        # ULTRA AGGRESSIVE parameter ranges for massive trade frequency
        rsi_buy_levels = list(range(50, 75, 5))   # 50-70: Much higher for way more trades
        rsi_sell_levels = list(range(80, 95, 5))  # 80-90: Hold winners much longer
        ma_short_periods = [2, 3, 5]              # Ultra short MAs for maximum signals
        ma_long_periods = [8, 10, 12]             # Shorter for more crossovers
        
        params_list = []
        for rsi_buy in rsi_buy_levels:
            for rsi_sell in rsi_sell_levels:
                for ma_short in ma_short_periods:
                    for ma_long in ma_long_periods:
                        if ma_short < ma_long and rsi_buy < rsi_sell:
                            params_list.append({
                                'rsi_period': 14,
                                'rsi_buy': rsi_buy,
                                'rsi_sell': rsi_sell,
                                'ma_short': ma_short,
                                'ma_long': ma_long,
                                'volume_ma': 10
                            })
        
        # Return random sample for efficiency
        return np.random.choice(params_list, min(20, len(params_list)), replace=False).tolist()
    
    def generate_exploitation_params(self):
        """Generate parameter variations around current best"""
        if not self.best_global_params:
            return self.generate_exploration_params()
        
        base_params = self.best_global_params
        variations = []
        
        # Small variations around best parameters
        for delta in [-2, -1, 0, 1, 2]:
            for param_name in ['rsi_buy', 'rsi_sell', 'ma_short', 'ma_long']:
                new_params = base_params.copy()
                new_value = base_params[param_name] + delta
                
                # Apply constraints - wider ranges for better returns
                if param_name == 'rsi_buy' and 30 <= new_value <= 65:
                    new_params[param_name] = new_value
                elif param_name == 'rsi_sell' and 65 <= new_value <= 90:
                    new_params[param_name] = new_value
                elif param_name == 'ma_short' and 3 <= new_value <= 10:
                    new_params[param_name] = new_value
                elif param_name == 'ma_long' and 8 <= new_value <= 20:
                    new_params[param_name] = new_value
                
                # Ensure valid combinations
                if (new_params['ma_short'] < new_params['ma_long'] and 
                    new_params['rsi_buy'] < new_params['rsi_sell']):
                    variations.append(new_params)
        
        return variations[:15]  # Limit to 15 variations
    
    def evaluate_parameters_for_pnl(self, data, params):
        """Evaluate parameters specifically for P&L maximization"""
        try:
            buy_signals, sell_signals = self.calculate_swing_trading_signals(data, **params)
            
            if not buy_signals.any():
                return None
                
            portfolio = self.run_vectorbt_backtest(data, buy_signals, sell_signals, '1D')
            
            # Calculate absolute P&L
            final_value = portfolio.value().iloc[-1]
            total_pnl = final_value - self.capital_per_symbol  # Profit/Loss in rupees
            
            total_trades = portfolio.trades.count() if hasattr(portfolio.trades, 'count') else 0
            if total_trades == 0:
                return None
            
            return {
                'total_trades': total_trades,
                'total_pnl': total_pnl,
                'final_value': final_value,
                'total_return_pct': (final_value / self.capital_per_symbol - 1) * 100
            }
            
        except Exception:
            return None
    
    def optimize_parameters(self, train_data, min_trades=2):
        """
        Main optimization function - uses PPO-style approach
        """
        return self.optimize_parameters_ppo_style(train_data)
    
    def evaluate_parameters(self, data, params):
        """
        Evaluate parameter set on given data
        """
        try:
            buy_signals, sell_signals = self.calculate_swing_trading_signals(data, **params)
            
            if not buy_signals.any():
                return None
                
            portfolio = self.run_vectorbt_backtest(data, buy_signals, sell_signals, '1D')
            
            # Calculate robust metrics
            total_trades = portfolio.trades.count() if hasattr(portfolio.trades, 'count') else 0
            if total_trades == 0:
                return None
                
            total_return = portfolio.total_return() * 100
            sharpe_ratio = portfolio.sharpe_ratio()
            max_drawdown = abs(portfolio.max_drawdown()) * 100
            win_rate = portfolio.trades.win_rate() * 100 if total_trades > 0 else 0
            
            return {
                'total_trades': total_trades,
                'total_return': total_return,
                'sharpe_ratio': sharpe_ratio,
                'max_drawdown': max_drawdown,
                'win_rate': win_rate,
                'profit_factor': self.calculate_profit_factor(portfolio),
                'consistency_score': self.calculate_consistency_score(portfolio)
            }
            
        except Exception:
            return None
    
    def calculate_profit_factor(self, portfolio):
        """
        Calculate profit factor (gross profit / gross loss)
        """
        try:
            if hasattr(portfolio.trades, 'pnl'):
                pnl = portfolio.trades.pnl
                gross_profit = pnl[pnl > 0].sum()
                gross_loss = abs(pnl[pnl < 0].sum())
                return gross_profit / gross_loss if gross_loss > 0 else 0
            return 0
        except:
            return 0
    
    def calculate_consistency_score(self, portfolio):
        """
        Calculate consistency score based on drawdown periods
        """
        try:
            equity = portfolio.value()
            returns = equity.pct_change().dropna()
            positive_periods = (returns > 0).sum()
            total_periods = len(returns)
            return positive_periods / total_periods if total_periods > 0 else 0
        except:
            return 0
    
    def select_best_parameters(self, candidate_params):
        """
        Select best parameters using ensemble scoring to avoid overfitting
        """
        if not candidate_params:
            return self.get_default_params()
        
        # Score each parameter set using multiple criteria
        scored_params = []
        
        for params, result in candidate_params:
            # Composite score with multiple factors
            score = 0
            
            # Factor 1: Risk-adjusted return (30%)
            if result['max_drawdown'] > 0:
                risk_adj_return = result['total_return'] / result['max_drawdown']
                score += 0.3 * min(risk_adj_return / 10, 1)  # Normalize
            
            # Factor 2: Sharpe ratio (25%)
            if result['sharpe_ratio'] > 0:
                score += 0.25 * min(result['sharpe_ratio'] / 2, 1)  # Normalize
            
            # Factor 3: Win rate (20%)
            score += 0.2 * (result['win_rate'] / 100)
            
            # Factor 4: Profit factor (15%)
            if result['profit_factor'] > 1:
                score += 0.15 * min((result['profit_factor'] - 1) / 2, 1)
            
            # Factor 5: Consistency (10%)
            score += 0.1 * result['consistency_score']
            
            # Penalty for too few trades
            if result['total_trades'] < 5:
                score *= 0.8
            
            scored_params.append((params, result, score))
        
        # Sort by score and return best
        scored_params.sort(key=lambda x: x[2], reverse=True)
        return scored_params[0][0]
    
    def get_default_params(self):
        """
        Return ULTRA AGGRESSIVE parameters for maximum returns
        """
        return {
            'rsi_period': 14, 'rsi_buy': 65, 'rsi_sell': 85,  # Much higher thresholds
            'ma_short': 2, 'ma_long': 8, 'volume_ma': 5       # Ultra short for max signals
        }
    
    def check_param_stability(self, previous_results, current_params):
        """
        Check how stable parameters are across periods
        """
        if not previous_results:
            return 1.0
        
        # Get the last period's parameters
        last_params = previous_results[-1]['params']
        
        # Calculate similarity score
        similarity = 0
        total_params = 0
        
        for key in ['rsi_buy', 'rsi_sell', 'ma_short', 'ma_long']:
            if key in current_params and key in last_params:
                # Normalized difference (lower is better)
                if key.startswith('rsi'):
                    max_diff = 30  # RSI range
                else:
                    max_diff = 20  # MA range
                    
                diff = abs(current_params[key] - last_params[key])
                similarity += max(0, 1 - diff / max_diff)
                total_params += 1
        
        return similarity / total_params if total_params > 0 else 0.0
    
    def run_vectorbt_backtest(self, data, buy_signals, sell_signals, timeframe, stop_loss_pct=0.15):
        """
        Run backtest using VectorBT - optimized for swing trading with risk management
        Uses 10,000 rupees capital per symbol for P&L maximization
        """
        # Create proper entries and exits for long positions
        long_entries = buy_signals
        long_exits = sell_signals
        
        # Add stop-loss protection
        close_prices = data['close']
        stop_loss_exits = pd.Series(False, index=data.index)
        
        # Simple stop-loss: if price drops 15% from entry, exit (much wider for trend following)
        for i in range(1, len(data)):
            if long_entries.iloc[:i].any():  # If we have any entries before this point
                last_entry_idx = long_entries.iloc[:i].where(long_entries.iloc[:i]).last_valid_index()
                if last_entry_idx is not None:
                    entry_price = close_prices.loc[last_entry_idx]
                    current_price = close_prices.iloc[i]
                    if current_price < entry_price * (1 - stop_loss_pct):
                        stop_loss_exits.iloc[i] = True
        
        # Combine regular exits with stop-loss exits
        combined_exits = long_exits | stop_loss_exits
        
        try:
            # Run portfolio simulation with 10K rupees capital per symbol
            portfolio = vbt.Portfolio.from_signals(
                close=data['close'],
                entries=long_entries,
                exits=combined_exits,
                init_cash=self.capital_per_symbol,  # 10,000 rupees per symbol
                fees=0.0002,       # 0.02% fees (minimal for frequent trading)
                size=1.0,          # Use 100% of capital for maximum P&L
                freq=timeframe,    # Frequency for proper calculations
                direction='longonly'  # Long-only for swing trading
            )
            
            return portfolio
            
        except Exception as e:
            # Fallback: create simple long-only portfolio
            portfolio = vbt.Portfolio.from_signals(
                close=data['close'],
                entries=long_entries,
                exits=combined_exits,
                init_cash=self.capital_per_symbol,
                fees=0.001,
                freq=timeframe
            )
            return portfolio
    
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
    
    def estimate_avg_trade_duration(self, results):
        """Estimate average trade duration based on test periods"""
        if not results:
            return 0
        total_periods = len(results)
        total_trades = sum(r['total_trades'] for r in results)
        if total_trades == 0:
            return 0
        # Rough estimate: test period length / trades per period
        avg_test_period_days = 20  # Our test period
        return avg_test_period_days / (total_trades / total_periods) if total_periods > 0 else 0

def process_single_stock(symbol, api, train_period, test_period, total_periods, timeframe, optimize_params):
    """Process a single stock for walk-forward analysis"""
    try:
        analyzer = SwingTradingWalkForward(api)
        result = analyzer.run_walk_forward_analysis(
            symbol=symbol,
            train_period=train_period,
            test_period=test_period,
            total_periods=total_periods,
            timeframe=timeframe,
            optimize_params=optimize_params
        )
        
        if result is None:
            return {
                'symbol': symbol,
                'status': 'FAILED',
                'error': 'No data or insufficient data for analysis'
            }
        
        return result
        
    except Exception as e:
        return {
            'symbol': symbol,
            'status': 'ERROR',
            'error': str(e)
        }

def run_nifty50_swing_analysis(train_period=60, test_period=120, total_periods=8, 
                              timeframe='1D', optimize_params=True, max_workers=8):
    """Run swing trading walk-forward analysis on all NIFTY 50 stocks"""
    console.print(Panel.fit("🚀 NIFTY 50 SWING TRADING WALK-FORWARD ANALYSIS", style="bold blue"))
    console.print(f"[cyan]Strategy: RSI + Moving Average + Volume Swing Trading[/cyan]")
    console.print(f"[cyan]Timeframe: {timeframe} | Train: {train_period}d | Test: {test_period}d | Periods: {total_periods}[/cyan]")
    
    # Initialize API
    api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
    
    results = []
    failed_stocks = []
    
    start_time = time.time()
    
    # Use rich progress bar for better visualization
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TimeElapsedColumn(),
        console=console
    ) as progress:
        
        task = progress.add_task("Processing NIFTY 50 stocks...", total=len(NIFTY_50_STOCKS))
        
        # Process stocks with limited concurrency
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all jobs
            future_to_symbol = {
                executor.submit(process_single_stock, symbol, api, train_period, 
                              test_period, total_periods, timeframe, optimize_params): symbol 
                for symbol in NIFTY_50_STOCKS
            }
            
            # Collect results as they complete
            for future in as_completed(future_to_symbol):
                symbol = future_to_symbol[future]
                try:
                    result = future.result()
                    results.append(result)
                    
                    if result['status'] == 'SUCCESS':
                        total_pnl = result.get('total_pnl', 0)
                        status_msg = f"✅ {symbol}: ₹{total_pnl:.2f} P&L, {result['total_trades']} trades"
                    else:
                        status_msg = f"❌ {symbol}: {result.get('error', 'Failed')}"
                        failed_stocks.append(symbol)
                    
                    progress.update(task, advance=1, description=status_msg)
                    
                except Exception as exc:
                    progress.update(task, advance=1, description=f"❌ {symbol}: Exception: {exc}")
                    failed_stocks.append(symbol)
    
    end_time = time.time()
    
    # Generate comprehensive report
    generate_swing_report(results, failed_stocks, timeframe, train_period, test_period, 
                         total_periods, end_time - start_time)
    
    return results

def generate_swing_report(results, failed_stocks, timeframe, train_period, test_period, 
                         total_periods, execution_time):
    """Generate comprehensive swing trading performance report"""
    console.print(Panel.fit("📊 SWING TRADING WALK-FORWARD RESULTS", style="bold blue"))
    
    # Filter successful results
    successful_results = [r for r in results if r['status'] == 'SUCCESS' and r['total_trades'] > 0]
    
    if not successful_results:
        console.print("[red]No successful analyses with trades. Cannot generate meaningful report.[/red]")
        return
    
    # Overall statistics
    total_stocks_processed = len(results)
    successful_stocks = len([r for r in results if r['status'] == 'SUCCESS'])
    stocks_with_trades = len(successful_results)
    
    # Performance metrics
    total_trades_all = sum(r['total_trades'] for r in successful_results)
    avg_return = np.mean([r['overall_return'] for r in successful_results])
    avg_sharpe = np.mean([r['overall_sharpe'] for r in successful_results])
    avg_max_dd = np.mean([r['overall_max_dd'] for r in successful_results])
    avg_win_rate = np.mean([r['avg_win_rate'] for r in successful_results])
    total_winning_trades = sum(r.get('winning_trades', 0) for r in successful_results)
    avg_trade_duration = np.mean([r.get('avg_trade_duration', 0) for r in successful_results])
    avg_param_stability = np.mean([r.get('param_stability', 1.0) for r in successful_results])
    total_pnl_all = sum(r.get('total_pnl', 0) for r in successful_results)
    
    # Summary panel
    summary_text = f"""[cyan]📈 EXECUTION SUMMARY[/cyan]
• Execution Time: {execution_time:.1f} seconds
• Stocks Processed: {total_stocks_processed}
• Successful: {successful_stocks}
• With Trades: {stocks_with_trades}
• Failed: {len(failed_stocks)}

[cyan]📊 AGGREGATE PERFORMANCE[/cyan]
• Total P&L Generated: ₹{total_pnl_all:.2f} (across all symbols)
• Capital Deployed: ₹{len(successful_results) * 10000:,} (₹10K per symbol)
• Total Trades Executed: {total_trades_all:,}
• Winning Trades: {total_winning_trades:.0f} ({total_winning_trades/total_trades_all*100:.1f}% of all trades)
• Average Return: {avg_return:.2f}%
• Average Sharpe Ratio: {avg_sharpe:.2f}
• Average Max Drawdown: {avg_max_dd:.2f}%
• Average Win Rate: {avg_win_rate:.2f}%
• Avg Trade Duration: {avg_trade_duration:.1f} days
• Parameter Stability: {avg_param_stability:.2f} (1.0 = most stable)"""
    
    console.print(Panel(summary_text, title="📊 Performance Summary", style="cyan"))
    
    # Sort results for leaderboard
    successful_results_by_pnl = sorted(successful_results, key=lambda x: x.get('total_pnl', 0), reverse=True)
    successful_results_by_sharpe = sorted(successful_results, key=lambda x: x['overall_sharpe'], reverse=True)
    
    # Create performance table sorted by P&L
    display_swing_table(successful_results_by_pnl, "💰 P&L LEADERBOARD (₹10K per Symbol)", sort_by="pnl")
    
    console.print()
    
    # Create performance table sorted by Sharpe
    display_swing_table(successful_results_by_sharpe, "📈 SHARPE RATIO LEADERBOARD", sort_by="sharpe")
    
    # Performance distribution
    profitable_stocks = len([r for r in successful_results if r['overall_return'] > 0])
    unprofitable_stocks = len([r for r in successful_results if r['overall_return'] < 0])
    
    # Consistency analysis
    highly_consistent = len([r for r in successful_results if r['profitable_periods'] >= r['total_periods'] * 0.7])
    moderately_consistent = len([r for r in successful_results if r['profitable_periods'] >= r['total_periods'] * 0.5])
    
    distribution_text = f"""[green]📊 PERFORMANCE DISTRIBUTION[/green]
• Profitable Stocks: {profitable_stocks} ({profitable_stocks/len(successful_results)*100:.1f}%)
• Unprofitable Stocks: {unprofitable_stocks} ({unprofitable_stocks/len(successful_results)*100:.1f}%)

[yellow]🎯 CONSISTENCY ANALYSIS[/yellow]
• Highly Consistent (≥70% periods profitable): {highly_consistent} stocks
• Moderately Consistent (≥50% periods profitable): {moderately_consistent} stocks
• Average Periods per Stock: {np.mean([r['total_periods'] for r in successful_results]):.1f}"""
    
    console.print(Panel(distribution_text, title="📈 Distribution Analysis", style="green"))
    
    if failed_stocks:
        failed_text = f"[red]❌ FAILED STOCKS ({len(failed_stocks)})[/red]\n" + ", ".join(failed_stocks)
        console.print(Panel(failed_text, title="⚠️ Failed Stocks", style="red"))
    
    # Save detailed results to JSON
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"nifty50_swing_walkforward_{timestamp}.json"
    
    with open(filename, 'w') as f:
        json.dump({
            'metadata': {
                'strategy': 'Swing Trading (RSI + MA + Volume)',
                'timeframe': timeframe,
                'train_period': train_period,
                'test_period': test_period,
                'total_periods': total_periods,
                'execution_time': execution_time,
                'timestamp': timestamp
            },
            'summary': {
                'total_stocks': total_stocks_processed,
                'successful_stocks': successful_stocks,
                'stocks_with_trades': stocks_with_trades,
                'failed_stocks': len(failed_stocks),
                'total_trades': int(total_trades_all),
                'avg_return': avg_return,
                'avg_sharpe': avg_sharpe,
                'avg_max_dd': avg_max_dd,
                'avg_win_rate': avg_win_rate
            },
            'results': results,
            'failed_stocks': failed_stocks
        }, f, indent=2)
    
    console.print(f"\n[green]💾 Detailed results saved to: {filename}[/green]")
    console.print("[blue]🎉 Swing trading walk-forward analysis completed successfully![/blue]")

def display_swing_table(results, title, sort_by="return", max_rows=20):
    """Display swing trading results in a rich table"""
    table = Table(title=title, show_header=True, header_style="bold magenta")
    
    table.add_column("Rank", style="dim", width=4, justify="right")
    table.add_column("Symbol", style="cyan", width=10)
    table.add_column("P&L ₹", justify="right", style="bold green", width=10)
    table.add_column("Return %", justify="right", style="magenta", width=10)
    table.add_column("Sharpe", justify="right", style="green", width=8)
    table.add_column("Max DD %", justify="right", style="red", width=10)
    table.add_column("Win Rate %", justify="right", style="yellow", width=10)
    table.add_column("Trades", justify="right", style="blue", width=8)
    
    for i, result in enumerate(results[:max_rows], 1):
        # Color coding
        pnl_value = result.get('total_pnl', 0)
        pnl_color = "green" if pnl_value > 0 else "red"
        return_color = "green" if result['overall_return'] > 0 else "red"
        sharpe_color = "green" if result['overall_sharpe'] > 1 else "yellow" if result['overall_sharpe'] > 0.5 else "red"
        
        # Format values
        pnl_str = f"{pnl_value:+.2f}"
        return_str = f"{result['overall_return']:+.2f}%"
        sharpe_str = f"{result['overall_sharpe']:.2f}"
        max_dd_str = f"{result['overall_max_dd']:.2f}%"
        win_rate_str = f"{result['avg_win_rate']:.1f}%"
        
        table.add_row(
            str(i),
            result['symbol'],
            f"[{pnl_color}]{pnl_str}[/{pnl_color}]",
            f"[{return_color}]{return_str}[/{return_color}]",
            f"[{sharpe_color}]{sharpe_str}[/{sharpe_color}]",
            max_dd_str,
            win_rate_str,
            str(result['total_trades'])
        )
    
    console.print(table)
    console.print(f"[dim]Showing top {min(len(results), max_rows)} of {len(results)} stocks with trades[/dim]")

def main():
    parser = argparse.ArgumentParser(description="NIFTY 50 Swing Trading Walk-Forward Analysis")
    parser.add_argument("--timeframe", type=str, default="1D", 
                       help="Timeframe (1D for daily, 4H for 4-hour)")
    parser.add_argument("--train-period", type=int, default=120, 
                       help="Training period in days")
    parser.add_argument("--test-period", type=int, default=90, 
                       help="Testing period in days")
    parser.add_argument("--total-periods", type=int, default=8, 
                       help="Number of walk-forward periods")
    parser.add_argument("--optimize", action="store_true", 
                       help="Optimize parameters during walk-forward")
    parser.add_argument("--workers", type=int, default=8, 
                       help="Number of concurrent workers")
    
    args = parser.parse_args()
    
    run_nifty50_swing_analysis(
        train_period=args.train_period,
        test_period=args.test_period,
        total_periods=args.total_periods,
        timeframe=args.timeframe,
        optimize_params=args.optimize,
        max_workers=args.workers
    )

if __name__ == "__main__":
    main()
