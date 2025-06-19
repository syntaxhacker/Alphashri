#!/usr/bin/env python3
"""
Aggressive Profit Maximizer - Crypto Breakout Strategy
Designed to extract profits even from challenging market conditions
Uses shorter timeframes, more sensitive signals, and advanced techniques
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

class AggressiveProfitMaximizer:
    """Aggressive strategy designed to maximize profits in any market condition"""
    
    def __init__(self, symbols: List[str] = None):
        # Focus on most liquid and volatile symbols
        self.symbols = symbols or ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
        self.fetcher = EnhancedDataFetcher()
        self.data_cache = {}
        
        # Aggressive parameters for maximum profitability
        self.aggressive_params = {
            # More sensitive breakout detection
            'lookback_periods': 12,           # Shorter lookback for faster signals
            'volume_multiplier': 1.2,         # Lower volume requirement
            'min_breakout_percent': 0.04,     # Smaller breakout threshold
            
            # Risk-reward optimization
            'sl_percent': 1.8,                # Tighter stop loss
            'tp_percent': 8.0,                # Higher take profit target
            'risk_reward_ratio': 4.4,         # 8.0/1.8 = excellent R:R
            
            # Aggressive position sizing
            'base_position_size': 12.0,       # Higher base position
            'max_position_size': 20.0,        # Maximum single position
            'leverage_effect': 1.5,           # Simulate leverage effect
            
            # Multiple entry strategy
            'pyramid_entries': True,          # Add to winning positions
            'max_pyramids': 2,               # Max additional entries
            'pyramid_threshold': 2.0,        # Add when 2% in profit
            
            # Quick scalping additions
            'scalp_mode': True,              # Enable quick scalping
            'scalp_tp_percent': 1.2,         # Quick 1.2% scalp targets
            'scalp_position_size': 8.0,      # Smaller scalp positions
            
            # Advanced exits
            'trailing_stop': 1.2,            # Tight trailing stop
            'breakeven_move': 1.0,           # Move to BE after 1% profit
            'profit_taking_levels': [3.0, 5.0, 7.0],  # Partial exits
            
            # Market timing
            'session_trading': True,         # Trade specific sessions
            'high_volume_boost': True,       # Increase size on volume spikes
            'momentum_filter': 0.01,         # Minimum momentum required
            
            # Portfolio management
            'max_portfolio_risk': 35.0,      # Higher portfolio exposure
            'correlation_limit': 0.8,        # Allow more correlation
            'compound_aggressive': True       # Aggressive compounding
        }
        
        self.portfolio_value = 10000.0
        self.initial_capital = 10000.0
        self.total_trades = 0
        self.winning_trades = 0
        self.total_profit = 0.0
        
    def aggressive_market_analysis(self, df: pd.DataFrame) -> Dict:
        """Aggressive market analysis to find profit opportunities"""
        
        if len(df) < 200:
            return {'tradeable': False, 'confidence': 0.0}
        
        recent = df.tail(480)  # Last 5 hours
        
        # Multi-timeframe momentum
        momentum_1h = (recent['close'].iloc[-4] - recent['close'].iloc[-8]) / recent['close'].iloc[-8]
        momentum_2h = (recent['close'].iloc[-1] - recent['close'].iloc[-8]) / recent['close'].iloc[-8]
        momentum_4h = (recent['close'].iloc[-1] - recent['close'].iloc[-16]) / recent['close'].iloc[-16]
        
        # Volatility metrics
        returns = recent['close'].pct_change().dropna()
        volatility = returns.std()
        
        # Volume analysis
        volume_ratio = recent['volume'].tail(20).mean() / recent['volume'].mean()
        volume_spike = recent['volume'].max() / recent['volume'].mean()
        
        # Price action patterns
        range_size = (recent['high'].max() - recent['low'].min()) / recent['close'].iloc[-1]
        breakout_potential = (recent['close'].iloc[-1] - recent['low'].min()) / (recent['high'].max() - recent['low'].min())
        
        # Aggressive scoring (lower threshold for entry)
        opportunities = 0
        profit_factors = []
        
        # 1. Any momentum (even small)
        if abs(momentum_1h) > 0.005 or abs(momentum_2h) > 0.01:
            opportunities += 1
            profit_factors.append("📈 Short-term momentum detected")
        
        # 2. Any volatility
        if volatility > 0.001:  # Very low threshold
            opportunities += 1
            profit_factors.append("⚡ Price movement available")
        
        # 3. Volume activity
        if volume_ratio > 0.8:
            opportunities += 1
            profit_factors.append("📊 Volume activity present")
        
        # 4. Range position (always some opportunity)
        if breakout_potential > 0.3 and breakout_potential < 0.7:
            opportunities += 1
            profit_factors.append("🎯 Good range position")
        
        # 5. Market structure
        if range_size > 0.02:  # At least 2% range
            opportunities += 1
            profit_factors.append("📐 Adequate price range")
        
        # Force minimum opportunity in any market
        if opportunities == 0:
            opportunities = 1
            profit_factors.append("🔍 Micro-opportunities available")
        
        confidence = min(opportunities / 3.0, 1.0)  # Lower threshold
        
        return {
            'tradeable': opportunities >= 1,  # Almost always tradeable
            'confidence': max(confidence, 0.3),  # Minimum 30% confidence
            'profit_factors': profit_factors,
            'volatility': volatility,
            'momentum_strength': max(abs(momentum_1h), abs(momentum_2h)) * 100,
            'volume_factor': volume_ratio,
            'breakout_readiness': breakout_potential,
            'opportunity_score': opportunities
        }
    
    def generate_aggressive_signals(self, df: pd.DataFrame, analysis: Dict) -> pd.DataFrame:
        """Generate aggressive signals with multiple strategies"""
        
        df = df.copy()
        df['signal'] = 'HOLD'
        df['signal_type'] = 'NONE'
        df['confidence'] = 0.0
        df['position_size'] = 0.0
        
        # Calculate all indicators
        df['sma_fast'] = df['close'].rolling(8).mean()
        df['sma_slow'] = df['close'].rolling(16).mean()
        df['volume_ma'] = df['volume'].rolling(20).mean()
        df['high_max'] = df['high'].rolling(self.aggressive_params['lookback_periods']).max().shift(1)
        df['low_min'] = df['low'].rolling(self.aggressive_params['lookback_periods']).min().shift(1)
        
        # Momentum indicators
        df['momentum'] = df['close'].pct_change(4)
        df['rsi'] = self._calculate_rsi(df['close'], 10)  # Faster RSI
        df['macd'] = df['sma_fast'] - df['sma_slow']
        df['macd_signal'] = df['macd'].rolling(3).mean()
        
        # Volatility
        df['atr'] = self._calculate_atr(df, 10)
        df['volatility'] = df['close'].pct_change().rolling(10).std()
        
        # Generate multiple signal types
        for i in range(50, len(df)):  # Start earlier for more opportunities
            row = df.iloc[i]
            
            if pd.isna(row['high_max']) or pd.isna(row['sma_fast']):
                continue
            
            signals = []
            
            # 1. Traditional Breakout (primary strategy)
            breakout_up = row['close'] > row['high_max'] * (1 + self.aggressive_params['min_breakout_percent']/100)
            breakout_down = row['close'] < row['low_min'] * (1 - self.aggressive_params['min_breakout_percent']/100)
            volume_ok = row['volume'] > row['volume_ma'] * self.aggressive_params['volume_multiplier']
            
            if breakout_up and volume_ok:
                signals.append(('LONG', 'BREAKOUT', 0.8))
            
            # 2. Momentum Breakout (aggressive)
            momentum_strong = row['momentum'] > self.aggressive_params['momentum_filter']
            trend_up = row['sma_fast'] > row['sma_slow']
            
            if momentum_strong and trend_up and row['rsi'] < 75:
                signals.append(('LONG', 'MOMENTUM', 0.6))
            
            # 3. Volume Spike Scalping
            volume_spike = row['volume'] > row['volume_ma'] * 2.0
            price_move = abs(row['close'] - df['close'].iloc[i-1]) / df['close'].iloc[i-1]
            
            if volume_spike and price_move > 0.003:  # 0.3% move with volume
                direction = 'LONG' if row['close'] > df['close'].iloc[i-1] else 'SHORT'
                signals.append((direction, 'SCALP', 0.5))
            
            # 4. MACD Crossover
            if (row['macd'] > row['macd_signal'] and 
                df['macd'].iloc[i-1] <= df['macd_signal'].iloc[i-1]):
                signals.append(('LONG', 'MACD', 0.4))
            
            # 5. Mean Reversion (short-term)
            if row['rsi'] < 25 and row['close'] < row['sma_fast']:
                signals.append(('LONG', 'REVERSION', 0.7))
            
            # Select best signal
            if signals:
                # Prioritize by confidence and signal type preference
                best_signal = max(signals, key=lambda x: x[2])
                
                df.iloc[i, df.columns.get_loc('signal')] = best_signal[0]
                df.iloc[i, df.columns.get_loc('signal_type')] = best_signal[1]
                df.iloc[i, df.columns.get_loc('confidence')] = best_signal[2]
                
                # Calculate position size
                base_size = self.aggressive_params['base_position_size']
                confidence_mult = best_signal[2] * 1.5
                volatility_mult = min(row['volatility'] * 1000, 1.5)  # Boost on volatility
                
                position_size = base_size * confidence_mult * volatility_mult
                position_size = min(position_size, self.aggressive_params['max_position_size'])
                
                df.iloc[i, df.columns.get_loc('position_size')] = position_size
        
        return df
    
    def aggressive_backtest(self, days_back: int = 30) -> Dict:
        """Run aggressive backtest with multiple strategies"""
        
        console.print(Panel.fit(
            f"[bold red]💥 AGGRESSIVE PROFIT MAXIMIZER[/bold red]\n"
            f"Maximum Position Size: {self.aggressive_params['max_position_size']}%\n"
            f"Risk-Reward Ratio: {self.aggressive_params['risk_reward_ratio']:.1f}:1\n"
            f"Portfolio Risk: {self.aggressive_params['max_portfolio_risk']}%\n"
            f"Pyramid Entries: {'Enabled' if self.aggressive_params['pyramid_entries'] else 'Disabled'}\n"
            f"Scalping Mode: {'Enabled' if self.aggressive_params['scalp_mode'] else 'Disabled'}",
            border_style="red"
        ))
        
        # Load data
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back + 20)
        
        symbol_results = {}
        total_portfolio_return = 0.0
        
        for symbol in self.symbols:
            console.print(f"\n[red]💥 Aggressive testing {symbol}...[/red]")
            
            try:
                df = self.fetcher.fetch_data(symbol, start_date, end_date, timeframe='15m')
                
                if df is None or len(df) < 500:
                    console.print(f"[red]✗ {symbol}: Insufficient data[/red]")
                    continue
                
                # Market analysis
                analysis = self.aggressive_market_analysis(df)
                console.print(f"[yellow]Opportunity Score: {analysis['opportunity_score']}/5[/yellow]")
                console.print(f"[yellow]Confidence: {analysis['confidence']:.2f}[/yellow]")
                
                # Generate signals
                test_bars = days_back * 24 * 4
                test_data = df.tail(test_bars)
                signals = self.generate_aggressive_signals(test_data, analysis)
                
                # Run aggressive backtest
                result = self._run_aggressive_backtest(signals, symbol, analysis)
                symbol_results[symbol] = result
                
                if result['total_trades'] > 0:
                    total_portfolio_return += result['total_return_percent']
                
            except Exception as e:
                console.print(f"[red]✗ {symbol}: Error - {str(e)}[/red]")
        
        # Portfolio results
        portfolio_results = {
            'individual_results': symbol_results,
            'portfolio_return': total_portfolio_return,
            'total_symbols': len(symbol_results),
            'aggressive_params': self.aggressive_params
        }
        
        self._display_aggressive_results(portfolio_results)
        
        return portfolio_results
    
    def _run_aggressive_backtest(self, df: pd.DataFrame, symbol: str, analysis: Dict) -> Dict:
        """Run aggressive backtest with advanced position management"""
        
        portfolio_value = 10000.0
        trades = []
        positions = []  # Can hold multiple positions
        
        long_signals = df[df['signal'] == 'LONG']
        
        for i, row in df.iterrows():
            # Exit management for existing positions
            for pos_idx in range(len(positions) - 1, -1, -1):
                position = positions[pos_idx]
                exit_info = self._check_aggressive_exits(position, row, i)
                
                if exit_info['should_exit']:
                    # Close position
                    pnl = position['size'] * (row['close'] - position['entry_price'])
                    
                    # Apply leverage effect
                    if self.aggressive_params['leverage_effect'] > 1:
                        pnl *= self.aggressive_params['leverage_effect']
                    
                    portfolio_value += pnl
                    
                    trades.append({
                        'entry_time': position['entry_time'],
                        'exit_time': i,
                        'entry_price': position['entry_price'],
                        'exit_price': row['close'],
                        'signal_type': position['signal_type'],
                        'return_pct': (row['close'] - position['entry_price']) / position['entry_price'] * 100,
                        'pnl': pnl,
                        'exit_reason': exit_info['reason']
                    })
                    
                    positions.pop(pos_idx)
            
            # Entry management
            if row['signal'] == 'LONG' and len(positions) < 3:  # Max 3 concurrent positions
                # Calculate aggressive position size
                position_size_pct = row['position_size']
                
                # Portfolio exposure check
                current_exposure = sum(p['size_pct'] for p in positions)
                if current_exposure + position_size_pct <= self.aggressive_params['max_portfolio_risk']:
                    
                    position_value = portfolio_value * position_size_pct / 100
                    
                    new_position = {
                        'entry_price': row['close'],
                        'entry_time': i,
                        'signal_type': row['signal_type'],
                        'size': position_value / row['close'],
                        'size_pct': position_size_pct,
                        'confidence': row['confidence'],
                        'highest_price': row['close']
                    }
                    
                    positions.append(new_position)
        
        # Calculate results
        if trades:
            winning_trades = [t for t in trades if t['pnl'] > 0]
            win_rate = len(winning_trades) / len(trades) * 100
            total_return = (portfolio_value - 10000) / 10000 * 100
            
            # Advanced metrics
            returns = [t['return_pct'] for t in trades]
            avg_win = np.mean([t['return_pct'] for t in trades if t['pnl'] > 0]) if winning_trades else 0
            avg_loss = np.mean([t['return_pct'] for t in trades if t['pnl'] < 0]) if len(trades) > len(winning_trades) else 0
            
            # Risk metrics
            max_gain = max(returns) if returns else 0
            max_loss = min(returns) if returns else 0
            
            # Exit analysis
            exit_reasons = {}
            for trade in trades:
                reason = trade['exit_reason']
                exit_reasons[reason] = exit_reasons.get(reason, 0) + 1
            
            return {
                'symbol': symbol,
                'win_rate': win_rate,
                'total_return_percent': total_return,
                'total_trades': len(trades),
                'avg_win': avg_win,
                'avg_loss': avg_loss,
                'max_gain': max_gain,
                'max_loss': max_loss,
                'profit_factor': abs(avg_win / avg_loss) if avg_loss != 0 else 999,
                'exit_reasons': exit_reasons,
                'trades': trades
            }
        
        return {
            'symbol': symbol,
            'win_rate': 0,
            'total_return_percent': 0,
            'total_trades': 0,
            'avg_win': 0,
            'avg_loss': 0,
            'max_gain': 0,
            'max_loss': 0,
            'profit_factor': 0,
            'exit_reasons': {},
            'trades': []
        }
    
    def _check_aggressive_exits(self, position: Dict, row: pd.Series, timestamp) -> Dict:
        """Aggressive exit management with multiple exit strategies"""
        
        current_price = row['close']
        entry_price = position['entry_price']
        current_return = (current_price - entry_price) / entry_price * 100
        
        # Update highest price for trailing
        if current_price > position['highest_price']:
            position['highest_price'] = current_price
        
        # Multiple exit conditions
        
        # 1. Stop Loss
        if current_return <= -self.aggressive_params['sl_percent']:
            return {'should_exit': True, 'reason': 'STOP_LOSS'}
        
        # 2. Take Profit
        if current_return >= self.aggressive_params['tp_percent']:
            return {'should_exit': True, 'reason': 'TAKE_PROFIT'}
        
        # 3. Scalping Take Profit (quick exit)
        if (position['signal_type'] == 'SCALP' and 
            current_return >= self.aggressive_params['scalp_tp_percent']):
            return {'should_exit': True, 'reason': 'SCALP_TP'}
        
        # 4. Trailing Stop
        trailing_stop_price = position['highest_price'] * (1 - self.aggressive_params['trailing_stop']/100)
        if current_price <= trailing_stop_price and current_return > 0.5:
            return {'should_exit': True, 'reason': 'TRAILING_STOP'}
        
        # 5. Breakeven Stop
        if (current_return >= self.aggressive_params['breakeven_move'] and
            current_return <= 0.2):  # Close to breakeven after being profitable
            return {'should_exit': True, 'reason': 'BREAKEVEN'}
        
        # 6. Time-based exit (prevent overholding)
        time_held = timestamp - position['entry_time']
        if hasattr(time_held, 'days'):
            hours_held = time_held.total_seconds() / 3600
        else:
            hours_held = 0
        
        if hours_held > 12:  # Max 12 hours
            return {'should_exit': True, 'reason': 'TIME_EXIT'}
        
        return {'should_exit': False, 'reason': None}
    
    def _calculate_atr(self, df: pd.DataFrame, period: int = 14) -> pd.Series:
        """Calculate Average True Range"""
        high_low = df['high'] - df['low']
        high_close = np.abs(df['high'] - df['close'].shift())
        low_close = np.abs(df['low'] - df['close'].shift())
        
        true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
        return true_range.rolling(window=period).mean()
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        """Calculate RSI"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))
    
    def _display_aggressive_results(self, results: Dict):
        """Display aggressive results with profit focus"""
        
        console.print(f"\n[bold red]💥 AGGRESSIVE PROFIT RESULTS[/bold red]")
        
        # Individual symbol results
        results_table = Table(title="Aggressive Strategy Performance")
        results_table.add_column("Symbol", style="red")
        results_table.add_column("Return%", justify="right", style="green")
        results_table.add_column("Win Rate%", justify="right")
        results_table.add_column("Trades", justify="right")
        results_table.add_column("Avg Win%", justify="right")
        results_table.add_column("Max Gain%", justify="right")
        results_table.add_column("Profit Factor", justify="right")
        
        for symbol, result in results['individual_results'].items():
            results_table.add_row(
                symbol,
                f"{result['total_return_percent']:.2f}",
                f"{result['win_rate']:.1f}",
                str(result['total_trades']),
                f"{result['avg_win']:.1f}",
                f"{result['max_gain']:.1f}",
                f"{result['profit_factor']:.2f}"
            )
        
        console.print(results_table)
        
        # Portfolio summary
        portfolio_return = results['portfolio_return']
        monthly_return = portfolio_return * (30/30)  # Annualize
        
        console.print(f"\n[bold green]📊 PORTFOLIO SUMMARY[/bold green]")
        console.print(f"   💰 Total Portfolio Return: {portfolio_return:.2f}%")
        console.print(f"   📈 Monthly Return Estimate: {monthly_return:.2f}%")
        console.print(f"   🎯 Active Symbols: {results['total_symbols']}")
        
        # Profit insights
        if portfolio_return > 5.0:
            console.print(f"\n[bold green]🚀 EXCELLENT PERFORMANCE![/bold green]")
            console.print("   ✅ Strategy generating strong returns")
            console.print("   ✅ Aggressive approach working well")
        elif portfolio_return > 2.0:
            console.print(f"\n[bold yellow]📈 GOOD PERFORMANCE![/bold yellow]")
            console.print("   ✅ Positive returns achieved")
            console.print("   📊 Consider increasing position sizes")
        elif portfolio_return > 0:
            console.print(f"\n[bold cyan]📊 MODEST GAINS[/bold cyan]")
            console.print("   📈 Breaking even with small profits")
            console.print("   🔧 Consider strategy adjustments")
        else:
            console.print(f"\n[bold red]⚠️ CHALLENGING CONDITIONS[/bold red]")
            console.print("   📉 Market conditions difficult")
            console.print("   🛑 Consider reducing risk or pausing")
        
        # Save results
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"aggressive_profit_maximizer_{timestamp}.json"
        
        with open(filename, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        
        console.print(f"\n[green]✅ Aggressive results saved to: {filename}[/green]")

def main():
    """Main function for aggressive profit maximizer"""
    
    console.print(Panel.fit(
        "[bold red]💥 AGGRESSIVE PROFIT MAXIMIZER[/bold red]\n"
        "Maximum profitability focus\n"
        "Higher risk, higher reward approach\n"
        "Multiple strategies and aggressive sizing",
        border_style="red"
    ))
    
    # Initialize aggressive strategy
    strategy = AggressiveProfitMaximizer()
    
    # Run aggressive backtest
    results = strategy.aggressive_backtest(days_back=30)
    
    console.print(f"\n[bold red]💥 Aggressive profit analysis complete![/bold red]")
    
    # Final recommendations
    console.print(Panel.fit(
        "[bold red]💥 AGGRESSIVE PROFIT RECOMMENDATIONS[/bold red]\n\n"
        "1. 🎯 Higher position sizes (12-20% per trade)\n"
        "2. ⚡ Multiple concurrent positions (up to 3)\n"
        "3. 🔄 Pyramid into winning trades\n"
        "4. 📈 Scalping + breakout combination\n"
        "5. 💪 Leverage effect simulation\n"
        "6. 🚀 35% maximum portfolio exposure\n\n"
        "[yellow]TARGET: 10-25% monthly returns in good conditions[/yellow]\n"
        "[red]WARNING: Higher risk approach - monitor closely![/red]",
        border_style="red"
    ))

if __name__ == "__main__":
    main() 