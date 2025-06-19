#!/usr/bin/env python3
"""
Aggressive Strategy Walk-Forward Analysis
Validates the aggressive profit maximizer across multiple time periods
Tests for overfitting and parameter stability
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

class AggressiveWalkForwardAnalysis:
    """Walk-forward analysis for the aggressive profit maximizer strategy"""
    
    def __init__(self, symbols: List[str] = None):
        # Focus on the proven performers from aggressive strategy
        self.symbols = symbols or ['ETHUSDT', 'BTCUSDT', 'SOLUSDT']
        self.fetcher = EnhancedDataFetcher()
        
        # Use EXACT parameters from successful aggressive strategy
        self.aggressive_params = {
            'lookback_periods': 12,
            'volume_multiplier': 1.2,
            'min_breakout_percent': 0.04,
            'sl_percent': 1.8,
            'tp_percent': 8.0,
            'base_position_size_percent': 12.0,
            'max_position_size_percent': 20.0,
            'leverage_effect': 1.5,
            'momentum_threshold': 0.01,
            'max_portfolio_risk': 35.0,
            'trailing_stop_percent': 1.2,
            'max_concurrent_positions': 3
        }
        
        # Walk-forward configuration
        self.wf_config = {
            'training_period_days': 25,    # 25 days for training
            'testing_period_days': 7,      # 7 days for testing  
            'step_size_days': 5,           # 5 days step forward
            'total_analysis_days': 120,    # 4 months total
            'min_trades_required': 3       # Minimum trades per window
        }
        
    def aggressive_market_regime(self, df: pd.DataFrame) -> Dict:
        """Same market regime analysis as successful aggressive strategy"""
        
        lookback_bars = 20 * 24 * 4  # 20 days
        recent_data = df.tail(lookback_bars) if len(df) > lookback_bars else df
        
        if len(recent_data) < 100:
            return {'favorable': False, 'confidence': 0.0, 'opportunity_score': 0}
        
        # Same analysis as aggressive strategy
        returns = recent_data['close'].pct_change().dropna()
        volatility = returns.std() * np.sqrt(96 * 365)
        
        momentum_1h = (recent_data['close'].iloc[-4] - recent_data['close'].iloc[-8]) / recent_data['close'].iloc[-8]
        momentum_4h = (recent_data['close'].iloc[-1] - recent_data['close'].iloc[-16]) / recent_data['close'].iloc[-16]
        
        volume_ma_short = recent_data['volume'].tail(96).mean()
        volume_ma_long = recent_data['volume'].mean()
        volume_surge = volume_ma_short / volume_ma_long
        
        # Aggressive scoring (same as successful strategy)
        opportunities = 0
        profit_factors = []
        
        if abs(momentum_1h) > 0.005 or abs(momentum_4h) > 0.01:
            opportunities += 1
            profit_factors.append("📈 Short-term momentum detected")
        
        if volatility > 0.001:
            opportunities += 1
            profit_factors.append("⚡ Price movement available")
        
        if volume_surge > 0.8:
            opportunities += 1
            profit_factors.append("📊 Volume activity present")
        
        # Force minimum opportunity (aggressive approach)
        if opportunities == 0:
            opportunities = 1
            profit_factors.append("🔍 Micro-opportunities available")
        
        confidence = min(opportunities / 3.0, 1.0)
        
        return {
            'favorable': opportunities >= 1,
            'confidence': max(confidence, 0.3),
            'opportunity_score': opportunities,
            'profit_factors': profit_factors,
            'volatility': volatility,
            'momentum_strength': max(abs(momentum_1h), abs(momentum_4h)) * 100,
            'volume_factor': volume_surge
        }
    
    def generate_aggressive_signals(self, df: pd.DataFrame, analysis: Dict) -> pd.DataFrame:
        """Same signal generation as successful aggressive strategy"""
        
        df = df.copy()
        df['signal'] = 'HOLD'
        df['signal_type'] = 'NONE'
        df['confidence'] = 0.0
        df['position_size'] = 0.0
        
        # Same indicators as aggressive strategy
        df['sma_fast'] = df['close'].rolling(8).mean()
        df['sma_slow'] = df['close'].rolling(16).mean()
        df['volume_ma'] = df['volume'].rolling(20).mean()
        df['high_max'] = df['high'].rolling(self.aggressive_params['lookback_periods']).max().shift(1)
        df['low_min'] = df['low'].rolling(self.aggressive_params['lookback_periods']).min().shift(1)
        
        df['momentum'] = df['close'].pct_change(4)
        df['rsi'] = self._calculate_rsi(df['close'], 10)
        df['macd'] = df['sma_fast'] - df['sma_slow']
        df['macd_signal'] = df['macd'].rolling(3).mean()
        df['volatility'] = df['close'].pct_change().rolling(10).std()
        
        # Same signal generation logic
        for i in range(50, len(df)):
            row = df.iloc[i]
            
            if pd.isna(row['high_max']) or pd.isna(row['sma_fast']):
                continue
            
            signals = []
            
            # 1. Traditional Breakout
            breakout_up = row['close'] > row['high_max'] * (1 + self.aggressive_params['min_breakout_percent']/100)
            volume_ok = row['volume'] > row['volume_ma'] * self.aggressive_params['volume_multiplier']
            
            if breakout_up and volume_ok:
                signals.append(('LONG', 'BREAKOUT', 0.8))
            
            # 2. Momentum Breakout
            momentum_strong = row['momentum'] > self.aggressive_params['momentum_threshold']
            trend_up = row['sma_fast'] > row['sma_slow']
            
            if momentum_strong and trend_up and row['rsi'] < 75:
                signals.append(('LONG', 'MOMENTUM', 0.6))
            
            # 3. Volume Spike Scalping
            volume_spike = row['volume'] > row['volume_ma'] * 2.0
            price_move = abs(row['close'] - df['close'].iloc[i-1]) / df['close'].iloc[i-1]
            
            if volume_spike and price_move > 0.003:
                direction = 'LONG' if row['close'] > df['close'].iloc[i-1] else 'SHORT'
                if direction == 'LONG':
                    signals.append((direction, 'SCALP', 0.5))
            
            # 4. MACD Crossover
            if (row['macd'] > row['macd_signal'] and 
                df['macd'].iloc[i-1] <= df['macd_signal'].iloc[i-1]):
                signals.append(('LONG', 'MACD', 0.4))
            
            # Select best signal (same logic)
            if signals:
                best_signal = max(signals, key=lambda x: x[2])
                
                df.iloc[i, df.columns.get_loc('signal')] = best_signal[0]
                df.iloc[i, df.columns.get_loc('signal_type')] = best_signal[1]
                df.iloc[i, df.columns.get_loc('confidence')] = best_signal[2]
                
                # Same position sizing
                base_size = self.aggressive_params['base_position_size_percent']
                confidence_mult = best_signal[2] * 1.5
                volatility_mult = min(row['volatility'] * 1000, 1.5)
                
                position_size = base_size * confidence_mult * volatility_mult
                position_size = min(position_size, self.aggressive_params['max_position_size_percent'])
                
                df.iloc[i, df.columns.get_loc('position_size')] = position_size
        
        return df
    
    def run_walk_forward_analysis(self) -> Dict:
        """Run comprehensive walk-forward analysis"""
        
        console.print(Panel.fit(
            f"[bold red]🔍 AGGRESSIVE STRATEGY WALK-FORWARD VALIDATION[/bold red]\n"
            f"Testing the 4.63% return aggressive strategy\n"
            f"Training Period: {self.wf_config['training_period_days']} days\n"
            f"Testing Period: {self.wf_config['testing_period_days']} days\n"
            f"Step Size: {self.wf_config['step_size_days']} days\n"
            f"Total Analysis: {self.wf_config['total_analysis_days']} days\n"
            f"CRITICAL: Validating for overfitting!",
            border_style="red"
        ))
        
        # Calculate walk-forward windows
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.wf_config['total_analysis_days'] + 30)
        
        # Generate time windows
        windows = self._generate_wf_windows(start_date, end_date)
        console.print(f"[cyan]Generated {len(windows)} walk-forward windows[/cyan]")
        
        # Load data for all symbols
        symbol_data = {}
        for symbol in self.symbols:
            console.print(f"[yellow]Loading data for {symbol}...[/yellow]")
            try:
                df = self.fetcher.fetch_data(symbol, start_date, end_date, timeframe='15m')
                if df is not None and len(df) > 2000:
                    symbol_data[symbol] = df
                    console.print(f"[green]✅ {symbol}: {len(df)} bars loaded[/green]")
                else:
                    console.print(f"[red]✗ {symbol}: Insufficient data[/red]")
            except Exception as e:
                console.print(f"[red]✗ {symbol}: Error - {str(e)}[/red]")
        
        if not symbol_data:
            console.print("[red]No valid data for walk-forward analysis![/red]")
            return {}
        
        # Run walk-forward test for each symbol
        all_results = {}
        
        for symbol in symbol_data.keys():
            console.print(f"\n[red]🔍 Walk-forward testing {symbol}...[/red]")
            
            symbol_results = self._test_symbol_walkforward(
                symbol, symbol_data[symbol], windows
            )
            all_results[symbol] = symbol_results
        
        # Compile comprehensive results
        wf_results = self._compile_walkforward_results(all_results, windows)
        
        # Display results
        self._display_walkforward_results(wf_results)
        
        return wf_results
    
    def _generate_wf_windows(self, start_date: datetime, end_date: datetime) -> List[Dict]:
        """Generate walk-forward time windows"""
        
        windows = []
        current_start = start_date
        
        while current_start + timedelta(
            days=self.wf_config['training_period_days'] + self.wf_config['testing_period_days']
        ) <= end_date:
            
            train_end = current_start + timedelta(days=self.wf_config['training_period_days'])
            test_start = train_end
            test_end = test_start + timedelta(days=self.wf_config['testing_period_days'])
            
            windows.append({
                'train_start': current_start,
                'train_end': train_end,
                'test_start': test_start,
                'test_end': test_end,
                'window_id': len(windows) + 1
            })
            
            current_start += timedelta(days=self.wf_config['step_size_days'])
        
        return windows
    
    def _test_symbol_walkforward(self, symbol: str, df: pd.DataFrame, windows: List[Dict]) -> Dict:
        """Test a single symbol across all walk-forward windows"""
        
        window_results = []
        
        with Progress(
            TextColumn(f"[cyan]{symbol}[/cyan]"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
            console=console
        ) as progress:
            
            task = progress.add_task("Walk-forward testing", total=len(windows))
            
            for window in windows:
                # Get training and testing data
                train_data = df[
                    (df.index >= window['train_start']) & 
                    (df.index < window['train_end'])
                ]
                
                test_data = df[
                    (df.index >= window['test_start']) & 
                    (df.index < window['test_end'])
                ]
                
                if len(train_data) < 1000 or len(test_data) < 100:
                    progress.advance(task)
                    continue
                
                # Market regime analysis on training data
                regime = self.aggressive_market_regime(train_data)
                
                # Generate signals on test data
                test_signals = self.generate_aggressive_signals(test_data, regime)
                
                # Run backtest on test period
                window_result = self._run_window_backtest(test_signals, symbol, window)
                window_result['window_id'] = window['window_id']
                window_result['regime'] = regime
                
                window_results.append(window_result)
                progress.advance(task)
        
        return {
            'symbol': symbol,
            'window_results': window_results,
            'total_windows': len(windows),
            'profitable_windows': len([r for r in window_results if r['return_percent'] > 0]),
            'avg_return': np.mean([r['return_percent'] for r in window_results]) if window_results else 0,
            'win_rate_avg': np.mean([r['win_rate'] for r in window_results]) if window_results else 0,
            'consistency_score': self._calculate_consistency_score(window_results)
        }
    
    def _run_window_backtest(self, df: pd.DataFrame, symbol: str, window: Dict) -> Dict:
        """Run backtest for a single window"""
        
        portfolio_value = 10000.0
        positions = []
        trades = []
        
        for i, row in df.iterrows():
            
            # Exit management
            for pos_idx in range(len(positions) - 1, -1, -1):
                position = positions[pos_idx]
                exit_info = self._check_aggressive_exits(position, row, i)
                
                if exit_info['should_exit']:
                    pnl = position['size'] * (row['close'] - position['entry_price'])
                    
                    # Apply leverage effect (same as aggressive)
                    if self.aggressive_params['leverage_effect'] > 1:
                        pnl *= self.aggressive_params['leverage_effect']
                    
                    portfolio_value += pnl
                    
                    trades.append({
                        'return_pct': (row['close'] - position['entry_price']) / position['entry_price'] * 100,
                        'pnl': pnl,
                        'exit_reason': exit_info['reason']
                    })
                    
                    positions.pop(pos_idx)
            
            # Entry management
            if (row['signal'] == 'LONG' and 
                len(positions) < self.aggressive_params['max_concurrent_positions']):
                
                position_size_pct = row['position_size']
                current_exposure = sum(p['size_pct'] for p in positions)
                
                if current_exposure + position_size_pct <= self.aggressive_params['max_portfolio_risk']:
                    position_value = portfolio_value * position_size_pct / 100
                    
                    new_position = {
                        'entry_price': row['close'],
                        'size': position_value / row['close'],
                        'size_pct': position_size_pct,
                        'confidence': row['confidence'],
                        'highest_price': row['close']
                    }
                    
                    positions.append(new_position)
        
        # Calculate window results
        if trades:
            winning_trades = [t for t in trades if t['pnl'] > 0]
            win_rate = len(winning_trades) / len(trades) * 100
            total_return = (portfolio_value - 10000) / 10000 * 100
            
            return {
                'return_percent': total_return,
                'win_rate': win_rate,
                'total_trades': len(trades),
                'profitable_trades': len(winning_trades),
                'avg_win': np.mean([t['return_pct'] for t in trades if t['pnl'] > 0]) if winning_trades else 0,
                'avg_loss': np.mean([t['return_pct'] for t in trades if t['pnl'] < 0]) if len(trades) > len(winning_trades) else 0,
                'max_gain': max([t['return_pct'] for t in trades]) if trades else 0,
                'max_loss': min([t['return_pct'] for t in trades]) if trades else 0
            }
        
        return {
            'return_percent': 0,
            'win_rate': 0,
            'total_trades': 0,
            'profitable_trades': 0,
            'avg_win': 0,
            'avg_loss': 0,
            'max_gain': 0,
            'max_loss': 0
        }
    
    def _check_aggressive_exits(self, position: Dict, row: pd.Series, timestamp) -> Dict:
        """Same exit logic as successful aggressive strategy"""
        
        current_price = row['close']
        entry_price = position['entry_price']
        current_return = (current_price - entry_price) / entry_price * 100
        
        if current_price > position['highest_price']:
            position['highest_price'] = current_price
        
        # Same exit conditions as aggressive strategy
        if current_return <= -self.aggressive_params['sl_percent']:
            return {'should_exit': True, 'reason': 'STOP_LOSS'}
        
        if current_return >= self.aggressive_params['tp_percent']:
            return {'should_exit': True, 'reason': 'TAKE_PROFIT'}
        
        trailing_stop_price = position['highest_price'] * (1 - self.aggressive_params['trailing_stop_percent']/100)
        if current_price <= trailing_stop_price and current_return > 0.5:
            return {'should_exit': True, 'reason': 'TRAILING_STOP'}
        
        return {'should_exit': False, 'reason': None}
    
    def _calculate_consistency_score(self, window_results: List[Dict]) -> float:
        """Calculate consistency score across windows"""
        
        if not window_results:
            return 0.0
        
        returns = [r['return_percent'] for r in window_results]
        win_rates = [r['win_rate'] for r in window_results]
        
        # Consistency = (avg_return / std_return) + (profitable_windows / total_windows)
        return_consistency = np.mean(returns) / np.std(returns) if np.std(returns) > 0 else 0
        profit_consistency = len([r for r in returns if r > 0]) / len(returns)
        
        return (return_consistency + profit_consistency) / 2
    
    def _compile_walkforward_results(self, all_results: Dict, windows: List[Dict]) -> Dict:
        """Compile comprehensive walk-forward results"""
        
        summary = {
            'total_windows': len(windows),
            'symbols_tested': list(all_results.keys()),
            'window_period': f"{self.wf_config['training_period_days']}d train / {self.wf_config['testing_period_days']}d test",
            'symbol_performance': {}
        }
        
        # Portfolio aggregation
        portfolio_returns = []
        portfolio_win_rates = []
        
        for window_id in range(1, len(windows) + 1):
            window_return = 0
            window_trades = 0
            window_wins = 0
            
            for symbol_result in all_results.values():
                for window_result in symbol_result['window_results']:
                    if window_result['window_id'] == window_id:
                        window_return += window_result['return_percent']
                        window_trades += window_result['total_trades']
                        window_wins += window_result['profitable_trades']
            
            if window_trades > 0:
                portfolio_returns.append(window_return)
                portfolio_win_rates.append(window_wins / window_trades * 100)
        
        # Calculate overall metrics
        summary['portfolio_performance'] = {
            'avg_return_per_window': np.mean(portfolio_returns) if portfolio_returns else 0,
            'avg_win_rate': np.mean(portfolio_win_rates) if portfolio_win_rates else 0,
            'profitable_windows': len([r for r in portfolio_returns if r > 0]),
            'total_analyzed_windows': len(portfolio_returns),
            'success_rate': len([r for r in portfolio_returns if r > 0]) / len(portfolio_returns) * 100 if portfolio_returns else 0,
            'consistency_score': np.mean(portfolio_returns) / np.std(portfolio_returns) if len(portfolio_returns) > 1 and np.std(portfolio_returns) > 0 else 0
        }
        
        # Individual symbol performance
        for symbol, results in all_results.items():
            summary['symbol_performance'][symbol] = {
                'avg_return': results['avg_return'],
                'avg_win_rate': results['win_rate_avg'],
                'profitable_windows': results['profitable_windows'],
                'total_windows': results['total_windows'],
                'success_rate': results['profitable_windows'] / results['total_windows'] * 100 if results['total_windows'] > 0 else 0,
                'consistency_score': results['consistency_score']
            }
        
        summary['all_results'] = all_results
        return summary
    
    def _display_walkforward_results(self, results: Dict):
        """Display comprehensive walk-forward results"""
        
        console.print(f"\n[bold red]🔍 AGGRESSIVE STRATEGY WALK-FORWARD RESULTS[/bold red]")
        
        # Portfolio performance summary
        portfolio_perf = results['portfolio_performance']
        
        console.print(Panel.fit(
            f"[bold yellow]📊 PORTFOLIO WALK-FORWARD SUMMARY[/bold yellow]\n\n"
            f"Total Windows Analyzed: {portfolio_perf['total_analyzed_windows']}\n"
            f"Average Return per Window: {portfolio_perf['avg_return_per_window']:.2f}%\n"
            f"Average Win Rate: {portfolio_perf['avg_win_rate']:.1f}%\n"
            f"Profitable Windows: {portfolio_perf['profitable_windows']}/{portfolio_perf['total_analyzed_windows']}\n"
            f"Success Rate: {portfolio_perf['success_rate']:.1f}%\n"
            f"Consistency Score: {portfolio_perf['consistency_score']:.2f}",
            border_style="yellow"
        ))
        
        # Individual symbol results
        symbol_table = Table(title="Walk-Forward Symbol Performance")
        symbol_table.add_column("Symbol", style="red")
        symbol_table.add_column("Avg Return%", justify="right", style="green")
        symbol_table.add_column("Avg Win Rate%", justify="right")
        symbol_table.add_column("Success Rate%", justify="right")
        symbol_table.add_column("Consistency", justify="right")
        symbol_table.add_column("Grade", style="yellow")
        
        for symbol, perf in results['symbol_performance'].items():
            # Grade the performance
            if perf['success_rate'] > 60 and perf['avg_return'] > 1.0:
                grade = "A"
            elif perf['success_rate'] > 40 and perf['avg_return'] > 0:
                grade = "B"
            elif perf['success_rate'] > 25:
                grade = "C"
            else:
                grade = "F"
            
            symbol_table.add_row(
                symbol,
                f"{perf['avg_return']:.2f}",
                f"{perf['avg_win_rate']:.1f}",
                f"{perf['success_rate']:.1f}",
                f"{perf['consistency_score']:.2f}",
                grade
            )
        
        console.print(symbol_table)
        
        # Reality check
        console.print(f"\n[bold cyan]🎯 REALITY CHECK vs ORIGINAL BACKTEST[/bold cyan]")
        
        original_return = 4.63  # From aggressive strategy
        wf_return = portfolio_perf['avg_return_per_window'] * (30/7)  # Estimate monthly
        
        console.print(f"   Original Backtest Return: {original_return:.2f}%")
        console.print(f"   Walk-Forward Estimate: {wf_return:.2f}%")
        console.print(f"   Performance Gap: {original_return - wf_return:.2f}%")
        
        if wf_return >= original_return * 0.7:  # Within 30% of original
            console.print(f"\n[bold green]✅ VALIDATION PASSED![/bold green]")
            console.print("   🎊 Strategy appears robust across time periods")
            console.print("   💪 Minimal overfitting detected")
            console.print("   🚀 Safe to proceed with live trading")
        elif wf_return >= original_return * 0.4:  # Within 60% of original
            console.print(f"\n[bold yellow]⚠️ MODERATE VALIDATION[/bold yellow]")
            console.print("   📊 Some performance degradation detected")
            console.print("   🔧 Strategy may need parameter adjustment")
            console.print("   📈 Proceed with caution and smaller sizes")
        else:
            console.print(f"\n[bold red]❌ VALIDATION FAILED![/bold red]")
            console.print("   💥 Significant overfitting detected")
            console.print("   🚫 Strategy not reliable for live trading")
            console.print("   🛠️ Requires major redesign or abandonment")
        
        # Save walk-forward results
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"aggressive_walkforward_results_{timestamp}.json"
        
        with open(filename, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        
        console.print(f"\n[green]✅ Walk-forward results saved to: {filename}[/green]")
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        """Calculate RSI"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))

def main():
    """Main function for aggressive walk-forward analysis"""
    
    console.print(Panel.fit(
        "[bold red]🔍 AGGRESSIVE STRATEGY VALIDATION[/bold red]\n"
        "Walk-Forward Analysis of 4.63% Return Strategy\n"
        "Testing for overfitting and parameter stability\n"
        "CRITICAL: Must validate before live trading!",
        border_style="red"
    ))
    
    # Initialize walk-forward analysis
    wf_analyzer = AggressiveWalkForwardAnalysis()
    
    # Run comprehensive walk-forward test
    results = wf_analyzer.run_walk_forward_analysis()
    
    console.print(f"\n[bold red]🔍 Aggressive strategy walk-forward validation complete![/bold red]")
    
    # Final validation message
    console.print(Panel.fit(
        "[bold red]🚨 VALIDATION COMPLETE - DECISION TIME[/bold red]\n\n"
        "This analysis reveals the TRUE performance of the aggressive strategy\n"
        "across multiple time periods and market conditions.\n\n"
        "✅ PASSED: Strategy is robust and ready for live trading\n"
        "⚠️ CAUTION: Some overfitting, proceed with smaller sizes\n"
        "❌ FAILED: Strategy is overfitted, do not use live\n\n"
        "The difference between 80% win rate (fantasy) and reality!",
        border_style="red"
    ))

if __name__ == "__main__":
    main() 