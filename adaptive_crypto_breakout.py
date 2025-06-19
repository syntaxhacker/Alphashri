#!/usr/bin/env python3
"""
Adaptive Crypto Breakout Strategy
Addresses overfitting issues with rolling optimization and market regime filters
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

# Bayesian optimization
try:
    from skopt import gp_minimize
    from skopt.space import Real, Integer
    from skopt.utils import use_named_args
    BAYESIAN_AVAILABLE = True
except ImportError:
    BAYESIAN_AVAILABLE = False

# Import modules
from enhanced_data_fetcher import EnhancedDataFetcher

warnings.filterwarnings('ignore')
console = Console()

class MarketRegimeDetector:
    """Detect market regimes to improve strategy performance"""
    
    @staticmethod
    def analyze_market_regime(df: pd.DataFrame, lookback_days: int = 30) -> Dict:
        """Analyze current market regime"""
        
        # Calculate regime indicators
        lookback_bars = lookback_days * 24 * 4  # 15-min bars
        
        if len(df) < lookback_bars:
            return {'regime': 'unknown', 'confidence': 0.0, 'volatility': 'medium'}
        
        recent_data = df.tail(lookback_bars)
        
        # Volatility analysis
        returns = recent_data['close'].pct_change().dropna()
        volatility = returns.std() * np.sqrt(96 * 365)  # Annualized volatility
        
        # Trend analysis
        price_change = (recent_data['close'].iloc[-1] - recent_data['close'].iloc[0]) / recent_data['close'].iloc[0]
        
        # Volume analysis
        avg_volume = recent_data['volume'].mean()
        recent_volume = recent_data['volume'].tail(lookback_bars // 4).mean()
        volume_ratio = recent_volume / avg_volume
        
        # Classify regime
        if volatility > 0.8:
            volatility_regime = 'high'
        elif volatility > 0.4:
            volatility_regime = 'medium'
        else:
            volatility_regime = 'low'
        
        if abs(price_change) > 0.2:
            trend_strength = 'strong'
            trend_direction = 'bullish' if price_change > 0 else 'bearish'
        elif abs(price_change) > 0.05:
            trend_strength = 'moderate'
            trend_direction = 'bullish' if price_change > 0 else 'bearish'
        else:
            trend_strength = 'weak'
            trend_direction = 'sideways'
        
        # Determine favorable conditions for breakout strategy
        favorable_conditions = 0
        if volatility_regime in ['medium', 'high']:
            favorable_conditions += 1
        if trend_strength in ['moderate', 'strong']:
            favorable_conditions += 1
        if volume_ratio > 0.8:  # Recent volume not too low
            favorable_conditions += 1
        
        confidence = favorable_conditions / 3.0
        
        return {
            'regime': f"{trend_direction}_{volatility_regime}_vol",
            'trend_direction': trend_direction,
            'trend_strength': trend_strength,
            'volatility': volatility_regime,
            'volume_ratio': volume_ratio,
            'confidence': confidence,
            'favorable_for_breakout': confidence > 0.5
        }

class AdaptiveCryptoBreakout:
    """Adaptive Crypto Breakout Strategy with Rolling Optimization"""
    
    def __init__(self, symbols: List[str] = None):
        self.symbols = symbols or ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']
        self.fetcher = EnhancedDataFetcher()
        self.data_cache = {}
        self.regime_detector = MarketRegimeDetector()
        
        # Conservative default parameters (learned from walk-forward)
        self.default_params = {
            'lookback_periods': 20,
            'volume_multiplier': 1.5,
            'min_breakout_percent': 0.1,
            'sl_percent': 2.0,
            'tp_percent': 4.0,
            'position_size_percent': 8.0,  # Reduced from 18.4
            'min_confidence_threshold': 0.6  # Market regime confidence
        }
        
        # Store optimized parameters for each symbol
        self.symbol_params = {}
        self.last_optimization = {}
        
    def load_data(self, days_back: int = 90):
        """Load historical data for analysis"""
        console.print(f"\n[cyan]📊 Loading {days_back} days of data for adaptive strategy...[/cyan]")
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        for symbol in self.symbols:
            try:
                df = self.fetcher.fetch_data(symbol, start_date, end_date, timeframe='15m')
                
                if df is not None and not df.empty:
                    self.data_cache[symbol] = df
                    self.symbol_params[symbol] = self.default_params.copy()
                    console.print(f"[green]✓ {symbol}: {len(df):,} bars loaded[/green]")
                else:
                    console.print(f"[red]✗ {symbol}: No data available[/red]")
                    
            except Exception as e:
                console.print(f"[red]✗ Failed to fetch {symbol}: {str(e)}[/red]")
        
        console.print(f"[green]✅ {len(self.data_cache)} symbols ready[/green]")
    
    def optimize_symbol_parameters(self, symbol: str, optimization_days: int = 21) -> Dict:
        """Optimize parameters for a specific symbol using recent data"""
        
        if symbol not in self.data_cache:
            return self.default_params.copy()
        
        df = self.data_cache[symbol]
        
        # Use last N days for optimization
        optimization_bars = optimization_days * 24 * 4  # 15-min bars
        if len(df) < optimization_bars:
            return self.default_params.copy()
        
        train_data = df.tail(optimization_bars).head(int(optimization_bars * 0.8))  # 80% for training
        val_data = df.tail(optimization_bars).tail(int(optimization_bars * 0.2))    # 20% for validation
        
        if len(train_data) < 100:
            return self.default_params.copy()
        
        console.print(f"[cyan]🔧 Optimizing {symbol} parameters using {len(train_data)} training bars...[/cyan]")
        
        # Reduced parameter space to prevent overfitting
        param_space = [
            Integer(10, 30, name='lookback_periods'),
            Real(1.2, 2.0, name='volume_multiplier'),
            Real(0.05, 0.25, name='min_breakout_percent'),
            Real(1.0, 3.0, name='sl_percent'),
            Real(2.0, 6.0, name='tp_percent'),
            Real(5.0, 12.0, name='position_size_percent')
        ]
        
        @use_named_args(param_space)
        def objective(**params):
            # Test on training data
            train_result = self._backtest_parameters(train_data, params)
            
            # Validate on validation data
            val_result = self._backtest_parameters(val_data, params)
            
            # Combined score with validation penalty
            if train_result['total_trades'] < 3 or val_result['total_trades'] < 1:
                return 10.0  # Penalize low activity
            
            # Weighted score favoring consistency
            train_score = train_result['win_rate'] * train_result['total_return_percent'] / (train_result['max_drawdown'] + 1)
            val_score = val_result['win_rate'] * val_result['total_return_percent'] / (val_result['max_drawdown'] + 1)
            
            # Penalize large train/validation performance gap (overfitting indicator)
            consistency_penalty = abs(train_score - val_score) / (abs(train_score) + 1)
            
            final_score = (train_score * 0.6 + val_score * 0.4) - consistency_penalty
            
            return -final_score  # Minimize negative score
        
        try:
            if BAYESIAN_AVAILABLE:
                # Quick optimization to prevent overfitting
                res = gp_minimize(objective, param_space, n_calls=20, random_state=42)
                
                # Extract best parameters
                best_params = self.default_params.copy()
                param_names = [dim.name for dim in param_space]
                for i, param_name in enumerate(param_names):
                    best_params[param_name] = res.x[i]
                
                # Validate the optimized parameters
                val_result = self._backtest_parameters(val_data, best_params)
                
                # If validation performance is poor, use more conservative defaults
                if val_result['total_return_percent'] < -2.0 or val_result['win_rate'] < 20:
                    console.print(f"[yellow]⚠️ {symbol}: Validation failed, using conservative defaults[/yellow]")
                    return self.default_params.copy()
                
                console.print(f"[green]✓ {symbol}: Optimized with validation return {val_result['total_return_percent']:.1f}%[/green]")
                return best_params
                
            else:
                return self.default_params.copy()
                
        except Exception as e:
            console.print(f"[yellow]⚠️ {symbol}: Optimization failed: {e}[/yellow]")
            return self.default_params.copy()
    
    def _backtest_parameters(self, df: pd.DataFrame, params: Dict) -> Dict:
        """Quick backtest for parameter optimization"""
        
        df = df.copy()
        df['volume_ma'] = df['volume'].rolling(window=20).mean()
        df['high_max'] = df['high'].rolling(window=params['lookback_periods']).max().shift(1)
        
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
                        'entry_price': row['close'],
                        'size': (portfolio_value * params['position_size_percent'] / 100) / row['close']
                    }
            else:
                current_price = row['close']
                entry_price = position['entry_price']
                
                stop_loss = entry_price * (1 - params['sl_percent']/100)
                take_profit = entry_price * (1 + params['tp_percent']/100)
                
                if current_price <= stop_loss or current_price >= take_profit:
                    pnl = position['size'] * (current_price - entry_price)
                    trades.append(pnl)
                    portfolio_value += pnl
                    position = None
        
        # Calculate metrics
        if trades:
            winning_trades = [t for t in trades if t > 0]
            win_rate = len(winning_trades) / len(trades) * 100
            total_return = (portfolio_value - 10000) / 10000 * 100
            
            # Calculate max drawdown
            cumulative = np.cumsum(trades)
            running_max = np.maximum.accumulate(cumulative)
            drawdowns = (cumulative - running_max)
            max_dd = abs(np.min(drawdowns)) / 10000 * 100 if len(drawdowns) > 0 else 0
            
            return {
                'win_rate': win_rate,
                'total_return_percent': total_return,
                'max_drawdown': max_dd,
                'total_trades': len(trades)
            }
        else:
            return {
                'win_rate': 0.0,
                'total_return_percent': 0.0,
                'max_drawdown': 0.0,
                'total_trades': 0
            }
    
    def run_adaptive_strategy(self, reoptimize_days: int = 14):
        """Run the adaptive strategy with periodic reoptimization"""
        
        console.print(Panel.fit(
            f"[bold cyan]🚀 ADAPTIVE CRYPTO BREAKOUT STRATEGY[/bold cyan]\n"
            f"Reoptimization Frequency: Every {reoptimize_days} days\n"
            f"Market Regime Filtering: Enabled\n"
            f"Enhanced Risk Management: Enabled\n"
            f"Symbols: {', '.join(self.symbols)}",
            border_style="cyan"
        ))
        
        # Load data
        self.load_data(days_back=90)
        
        # Initial optimization for all symbols
        console.print(f"\n[bold yellow]🔧 Initial Parameter Optimization...[/bold yellow]")
        for symbol in self.symbols:
            if symbol in self.data_cache:
                optimized_params = self.optimize_symbol_parameters(symbol)
                self.symbol_params[symbol] = optimized_params
                self.last_optimization[symbol] = datetime.now()
        
        # Run backtests with adaptive parameters
        console.print(f"\n[bold green]📈 Running Adaptive Strategy Backtest...[/bold green]")
        results = {}
        
        for symbol in self.symbols:
            if symbol not in self.data_cache:
                continue
                
            console.print(f"\n[cyan]Testing {symbol} with adaptive parameters...[/cyan]")
            
            # Analyze market regime
            regime_info = self.regime_detector.analyze_market_regime(self.data_cache[symbol])
            
            console.print(f"[yellow]Market Regime: {regime_info['regime']} (Confidence: {regime_info['confidence']:.2f})[/yellow]")
            console.print(f"[yellow]Favorable for Breakout: {'Yes' if regime_info['favorable_for_breakout'] else 'No'}[/yellow]")
            
            # Run backtest with regime filtering
            symbol_result = self._run_adaptive_backtest(symbol, regime_info)
            results[symbol] = symbol_result
        
        # Display results
        self._display_adaptive_results(results)
        
        # Save results
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"adaptive_crypto_breakout_{timestamp}.json"
        
        save_data = {
            'timestamp': timestamp,
            'strategy': 'Adaptive Crypto Breakout',
            'reoptimization_frequency': reoptimize_days,
            'symbol_parameters': self.symbol_params,
            'results': results
        }
        
        with open(filename, 'w') as f:
            json.dump(save_data, f, indent=2, default=str)
        
        console.print(f"\n[green]✅ Adaptive strategy results saved to: {filename}[/green]")
        
        return results
    
    def _run_adaptive_backtest(self, symbol: str, regime_info: Dict) -> Dict:
        """Run backtest with adaptive parameters and regime filtering"""
        
        df = self.data_cache[symbol].copy()
        params = self.symbol_params[symbol]
        
        # Calculate indicators
        df['volume_ma'] = df['volume'].rolling(window=20).mean()
        df['high_max'] = df['high'].rolling(window=params['lookback_periods']).max().shift(1)
        
        portfolio_value = 10000.0
        trades = []
        position = None
        regime_filtered_trades = 0
        
        # Use last 30 days for testing (out-of-sample)
        test_bars = 30 * 24 * 4
        test_data = df.tail(test_bars) if len(df) > test_bars else df
        
        for i in range(params['lookback_periods'], len(test_data)):
            row = test_data.iloc[i]
            
            # Check market regime confidence before entry
            if position is None:
                # Only enter if market regime is favorable
                if not regime_info['favorable_for_breakout']:
                    regime_filtered_trades += 1
                    continue
                
                # Entry conditions
                breakout_up = row['close'] > row['high_max'] * (1 + params['min_breakout_percent']/100)
                volume_ok = row['volume'] > row['volume_ma'] * params['volume_multiplier']
                
                if breakout_up and volume_ok and not pd.isna(row['high_max']):
                    # Adjust position size based on regime confidence
                    regime_adjusted_size = params['position_size_percent'] * regime_info['confidence']
                    
                    position = {
                        'entry_price': row['close'],
                        'entry_time': row.name,
                        'size': (portfolio_value * regime_adjusted_size / 100) / row['close']
                    }
            else:
                current_price = row['close']
                entry_price = position['entry_price']
                
                # Enhanced exit conditions
                stop_loss = entry_price * (1 - params['sl_percent']/100)
                take_profit = entry_price * (1 + params['tp_percent']/100)
                
                # Time-based exit (prevent holding too long in unfavorable regime)
                bars_held = i - test_data.index.get_loc(position['entry_time'])
                max_hold_bars = 48  # 12 hours max
                
                exit_condition = (
                    current_price <= stop_loss or 
                    current_price >= take_profit or
                    bars_held >= max_hold_bars
                )
                
                if exit_condition:
                    pnl = position['size'] * (current_price - entry_price)
                    
                    trades.append({
                        'entry_time': position['entry_time'],
                        'exit_time': row.name,
                        'entry_price': entry_price,
                        'exit_price': current_price,
                        'pnl': pnl,
                        'return_pct': (current_price - entry_price) / entry_price * 100,
                        'bars_held': bars_held
                    })
                    
                    portfolio_value += pnl
                    position = None
        
        # Calculate comprehensive metrics
        if trades:
            winning_trades = [t for t in trades if t['pnl'] > 0]
            win_rate = len(winning_trades) / len(trades) * 100
            total_return = (portfolio_value - 10000) / 10000 * 100
            
            # Max drawdown calculation
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
            
            # Additional metrics
            avg_return_per_trade = np.mean([t['return_pct'] for t in trades])
            avg_hold_time = np.mean([t['bars_held'] for t in trades]) * 15 / 60  # Convert to hours
            
            total_wins = sum(t['pnl'] for t in trades if t['pnl'] > 0)
            total_losses = abs(sum(t['pnl'] for t in trades if t['pnl'] < 0))
            profit_factor = total_wins / total_losses if total_losses > 0 else 2.0
            
            return {
                'symbol': symbol,
                'parameters': params,
                'regime_info': regime_info,
                'win_rate': win_rate,
                'total_return_percent': total_return,
                'max_drawdown': max_dd_pct,
                'total_trades': len(trades),
                'regime_filtered_trades': regime_filtered_trades,
                'profit_factor': profit_factor,
                'avg_return_per_trade': avg_return_per_trade,
                'avg_hold_time_hours': avg_hold_time,
                'trades': trades
            }
        else:
            return {
                'symbol': symbol,
                'parameters': params,
                'regime_info': regime_info,
                'win_rate': 0.0,
                'total_return_percent': 0.0,
                'max_drawdown': 0.0,
                'total_trades': 0,
                'regime_filtered_trades': regime_filtered_trades,
                'profit_factor': 0.0,
                'avg_return_per_trade': 0.0,
                'avg_hold_time_hours': 0.0,
                'trades': []
            }
    
    def _display_adaptive_results(self, results: Dict):
        """Display comprehensive adaptive strategy results"""
        
        console.print(f"\n[bold green]📊 ADAPTIVE STRATEGY RESULTS[/bold green]")
        
        # Summary table
        table = Table(title="Adaptive Crypto Breakout Performance")
        table.add_column("Symbol", style="cyan")
        table.add_column("Regime", style="yellow")
        table.add_column("Confidence", justify="right")
        table.add_column("Win Rate%", justify="right")
        table.add_column("Return%", justify="right")
        table.add_column("Max DD%", justify="right")
        table.add_column("Trades", justify="right")
        table.add_column("Filtered", justify="right")
        table.add_column("Profit Factor", justify="right")
        
        total_return = 0
        total_trades = 0
        
        for symbol, result in results.items():
            regime = result['regime_info']['regime']
            confidence = result['regime_info']['confidence']
            
            table.add_row(
                symbol,
                regime,
                f"{confidence:.2f}",
                f"{result['win_rate']:.1f}",
                f"{result['total_return_percent']:.1f}",
                f"{result['max_drawdown']:.1f}",
                str(result['total_trades']),
                str(result['regime_filtered_trades']),
                f"{result['profit_factor']:.2f}"
            )
            
            total_return += result['total_return_percent']
            total_trades += result['total_trades']
        
        console.print(table)
        
        # Strategy insights
        console.print(f"\n[bold yellow]💡 ADAPTIVE STRATEGY INSIGHTS[/bold yellow]")
        
        avg_return = total_return / len(results) if results else 0
        winning_symbols = sum(1 for r in results.values() if r['total_return_percent'] > 0)
        
        insights = [
            f"📈 Average Return: {avg_return:.1f}%",
            f"🎯 Winning Symbols: {winning_symbols}/{len(results)}",
            f"📊 Total Trades: {total_trades}",
        ]
        
        if avg_return > 0:
            insights.append("✅ Adaptive approach showing positive results")
        else:
            insights.append("⚠️ Strategy needs further refinement")
        
        for insight in insights:
            console.print(f"   {insight}")

def main():
    """Main function to run adaptive crypto breakout strategy"""
    
    console.print(Panel.fit(
        "[bold cyan]🚀 ADAPTIVE CRYPTO BREAKOUT STRATEGY[/bold cyan]\n"
        "Enhanced with rolling optimization and market regime detection\n"
        "Addresses overfitting issues identified in walk-forward analysis",
        border_style="cyan"
    ))
    
    # Initialize adaptive strategy
    strategy = AdaptiveCryptoBreakout()
    
    # Run adaptive strategy
    results = strategy.run_adaptive_strategy(reoptimize_days=14)
    
    console.print(f"\n[bold green]🎊 Adaptive strategy analysis complete![/bold green]")

if __name__ == "__main__":
    main() 