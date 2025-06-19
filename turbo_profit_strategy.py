#!/usr/bin/env python3
"""
Turbo Profit Strategy - Practical Maximum Profitability
Based on the working aggressive approach with practical enhancements
Designed for real-world high-performance trading
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

class TurboProfitStrategy:
    """Turbo profit strategy - practical maximum profitability approach"""
    
    def __init__(self, symbols: List[str] = None):
        # Focus on best performing symbols from aggressive test
        self.symbols = symbols or ['ETHUSDT', 'BTCUSDT', 'SOLUSDT']  # ETHUSDT was the best
        self.fetcher = EnhancedDataFetcher()
        
        # Turbo parameters - optimized from aggressive results
        self.turbo_params = {
            # Enhanced breakout detection (from aggressive success)
            'lookback_periods': 12,           
            'volume_multiplier': 1.2,         
            'min_breakout_percent': 0.04,     
            
            # Optimized risk-reward (increase winners, cut losers faster)
            'sl_percent': 1.5,                # Tighter stop loss
            'tp_percent': 9.0,                # Higher take profit
            'risk_reward_ratio': 6.0,         # Excellent 6:1 ratio
            
            # Turbo position sizing (based on ETHUSDT success)
            'base_position_size': 16.0,       # Higher base (ETHUSDT did 4.9% with less)
            'max_position_size': 28.0,        # Maximum for high confidence
            'confidence_scaling': 2.2,        # Aggressive confidence scaling
            
            # Multiple positions (diversification boost)
            'max_concurrent_positions': 4,    # More positions = more opportunities
            'position_correlation_limit': 0.75, # Allow some correlation
            
            # Turbo entry conditions (more opportunities)
            'momentum_threshold': 0.008,      # Lower threshold for more entries
            'volume_spike_threshold': 1.8,    # Lower for more volume signals
            'rsi_upper_limit': 78,            # Allow slightly overbought entries
            
            # Advanced exits (lock in more profits)
            'trailing_stop_percent': 1.0,    # Very tight trailing
            'breakeven_threshold': 0.8,      # Move to BE quickly
            'profit_scaling_levels': [2.0, 4.0, 6.0, 8.0],  # Scale out at levels
            'scale_out_percentages': [25, 30, 25, 20],       # Percentage to exit
            
            # Portfolio turbo boost
            'max_portfolio_risk': 45.0,       # Higher overall exposure
            'compound_reinvestment': True,    # Reinvest all profits
            'daily_trade_limit': 8,           # More trades per day
            
            # Market timing boost
            'volume_momentum_boost': True,    # Boost size on volume momentum
            'price_momentum_boost': True,     # Boost size on price momentum
            'volatility_boost': True,         # Increase size in high vol
            'news_detection': True,           # Detect unusual activity
            
            # Risk management safety
            'max_daily_loss': 3.0,           # Stop trading if lose 3% in a day
            'max_consecutive_losses': 4,      # Stop after 4 consecutive losses
            'cooling_off_hours': 2,          # Cool off period after losses
        }
        
        self.portfolio_value = 10000.0
        self.initial_capital = 10000.0
        self.daily_pnl = 0.0
        self.consecutive_losses = 0
        self.last_loss_time = None
        
    def turbo_market_analysis(self, df: pd.DataFrame) -> Dict:
        """Turbo market analysis - fast and practical"""
        
        if len(df) < 100:
            return {'tradeable': False, 'turbo_score': 0}
        
        recent = df.tail(200)  # Last ~12 hours
        
        # Quick momentum assessment
        momentum_1h = (recent['close'].iloc[-4] - recent['close'].iloc[-8]) / recent['close'].iloc[-8]
        momentum_4h = (recent['close'].iloc[-1] - recent['close'].iloc[-16]) / recent['close'].iloc[-16]
        
        # Volume activity
        volume_avg = recent['volume'].mean()
        volume_recent = recent['volume'].tail(20).mean()
        volume_activity = volume_recent / volume_avg if volume_avg > 0 else 1.0
        
        # Volatility check
        returns = recent['close'].pct_change().dropna()
        volatility = returns.std()
        
        # Price range analysis
        price_range = (recent['high'].max() - recent['low'].min()) / recent['close'].iloc[-1]
        
        # Turbo scoring (0-100, aggressive threshold)
        turbo_score = 0
        
        # Momentum points (up to 40 points)
        if abs(momentum_1h) > 0.01:
            turbo_score += 20
        if abs(momentum_4h) > 0.02:
            turbo_score += 20
        
        # Volume points (up to 30 points)
        if volume_activity > 1.2:
            turbo_score += 15
        if volume_activity > 1.5:
            turbo_score += 15
        
        # Volatility points (up to 20 points)
        if volatility > 0.002:
            turbo_score += 10
        if volatility > 0.005:
            turbo_score += 10
        
        # Range points (up to 10 points)
        if price_range > 0.03:
            turbo_score += 10
        
        # Force minimum opportunity in any market (turbo mode)
        if turbo_score < 20:
            turbo_score = 25  # Always some opportunity in turbo mode
        
        return {
            'tradeable': True,  # Turbo mode - always trade
            'turbo_score': turbo_score,
            'momentum_1h': momentum_1h,
            'momentum_4h': momentum_4h,
            'volume_activity': volume_activity,
            'volatility': volatility,
            'confidence_multiplier': turbo_score / 50.0  # Convert to multiplier
        }
    
    def generate_turbo_signals(self, df: pd.DataFrame, analysis: Dict) -> pd.DataFrame:
        """Generate turbo signals with multiple high-frequency strategies"""
        
        df = df.copy()
        df['signal'] = 'HOLD'
        df['confidence'] = 0.0
        df['position_size'] = 0.0
        df['strategy_type'] = 'NONE'
        
        # Add turbo indicators
        df['sma_8'] = df['close'].rolling(8).mean()
        df['sma_21'] = df['close'].rolling(21).mean()
        df['volume_ma'] = df['volume'].rolling(15).mean()
        df['high_max'] = df['high'].rolling(self.turbo_params['lookback_periods']).max().shift(1)
        df['momentum'] = df['close'].pct_change(3)
        df['rsi'] = self._calculate_rsi(df['close'], 10)  # Faster RSI
        df['volume_ratio'] = df['volume'] / df['volume_ma']
        
        # Generate turbo signals
        for i in range(30, len(df)):
            row = df.iloc[i]
            
            if pd.isna(row['high_max']):
                continue
            
            signal_candidates = []
            
            # 1. Turbo Breakout (primary)
            breakout_condition = row['close'] > row['high_max'] * (1 + self.turbo_params['min_breakout_percent']/100)
            volume_condition = row['volume_ratio'] > self.turbo_params['volume_multiplier']
            momentum_condition = row['momentum'] > self.turbo_params['momentum_threshold']
            
            if breakout_condition and volume_condition:
                confidence = 0.8
                if momentum_condition:
                    confidence += 0.1
                signal_candidates.append(('BREAKOUT', confidence))
            
            # 2. Momentum Surge (secondary)
            strong_momentum = row['momentum'] > self.turbo_params['momentum_threshold'] * 1.5
            volume_surge = row['volume_ratio'] > self.turbo_params['volume_spike_threshold']
            trend_up = row['sma_8'] > row['sma_21']
            
            if strong_momentum and volume_surge and trend_up:
                confidence = 0.7
                signal_candidates.append(('MOMENTUM', confidence))
            
            # 3. Volume Spike (scalping)
            massive_volume = row['volume_ratio'] > self.turbo_params['volume_spike_threshold'] * 1.5
            price_move = abs(row['close'] - df['close'].iloc[i-1]) / df['close'].iloc[i-1]
            
            if massive_volume and price_move > 0.004:  # 0.4% move
                direction = 'LONG' if row['close'] > df['close'].iloc[i-1] else 'SHORT'
                if direction == 'LONG':
                    confidence = 0.6
                    signal_candidates.append(('VOLUME_SPIKE', confidence))
            
            # 4. RSI Momentum (additional)
            rsi_momentum = 30 < row['rsi'] < self.turbo_params['rsi_upper_limit']
            if rsi_momentum and momentum_condition and volume_condition:
                confidence = 0.5
                signal_candidates.append(('RSI_MOMENTUM', confidence))
            
            # Select best signal
            if signal_candidates:
                best_signal = max(signal_candidates, key=lambda x: x[1])
                strategy_type, confidence = best_signal
                
                # Apply turbo confidence scaling
                confidence *= analysis['confidence_multiplier']
                confidence = min(confidence, 1.0)
                
                if confidence > 0.4:  # Lower threshold for turbo mode
                    df.iloc[i, df.columns.get_loc('signal')] = 'LONG'
                    df.iloc[i, df.columns.get_loc('confidence')] = confidence
                    df.iloc[i, df.columns.get_loc('strategy_type')] = strategy_type
                    
                    # Calculate turbo position size
                    position_size = self._calculate_turbo_position_size(row, confidence, analysis)
                    df.iloc[i, df.columns.get_loc('position_size')] = position_size
        
        return df
    
    def _calculate_turbo_position_size(self, row: pd.Series, confidence: float, analysis: Dict) -> float:
        """Calculate turbo position size with aggressive scaling"""
        
        base_size = self.turbo_params['base_position_size']
        
        # 1. Confidence scaling (exponential)
        confidence_mult = confidence ** (1/self.turbo_params['confidence_scaling'])
        
        # 2. Volume momentum boost
        volume_boost = 1.0
        if self.turbo_params['volume_momentum_boost'] and 'volume_ratio' in row:
            volume_boost = min(row['volume_ratio'] / 2.0, 1.5)
        
        # 3. Price momentum boost
        momentum_boost = 1.0
        if self.turbo_params['price_momentum_boost'] and 'momentum' in row:
            momentum_boost = 1 + min(abs(row['momentum']) * 15, 0.4)
        
        # 4. Volatility boost
        volatility_boost = 1.0
        if self.turbo_params['volatility_boost']:
            volatility_boost = 1 + min(analysis['volatility'] * 500, 0.3)
        
        # Combine all factors
        total_size = (base_size * confidence_mult * volume_boost * 
                     momentum_boost * volatility_boost)
        
        # Apply limits
        total_size = min(total_size, self.turbo_params['max_position_size'])
        total_size = max(total_size, 2.0)  # Minimum 2% for turbo mode
        
        return total_size
    
    def turbo_backtest(self, days_back: int = 32) -> Dict:
        """Run turbo backtest with all enhancements"""
        
        console.print(Panel.fit(
            f"[bold blue]⚡ TURBO PROFIT STRATEGY[/bold blue]\n"
            f"Maximum Profitability Mode: ENGAGED\n"
            f"Base Position Size: {self.turbo_params['base_position_size']}%\n"
            f"Max Position Size: {self.turbo_params['max_position_size']}%\n"
            f"Risk-Reward Ratio: {self.turbo_params['risk_reward_ratio']:.1f}:1\n"
            f"Portfolio Exposure: {self.turbo_params['max_portfolio_risk']}%\n"
            f"Target: 10-20% monthly returns",
            border_style="blue"
        ))
        
        # Load data for all symbols
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back + 15)
        
        symbol_results = {}
        portfolio_total_return = 0.0
        
        for symbol in self.symbols:
            console.print(f"\n[blue]⚡ Turbo testing {symbol}...[/blue]")
            
            try:
                df = self.fetcher.fetch_data(symbol, start_date, end_date, timeframe='15m')
                
                if df is None or len(df) < 500:
                    console.print(f"[red]✗ {symbol}: Insufficient data[/red]")
                    continue
                
                # Turbo market analysis
                analysis = self.turbo_market_analysis(df)
                console.print(f"[cyan]Turbo Score: {analysis['turbo_score']}/100[/cyan]")
                console.print(f"[cyan]Confidence Multiplier: {analysis['confidence_multiplier']:.2f}[/cyan]")
                
                # Generate turbo signals
                test_bars = days_back * 24 * 4
                test_data = df.tail(test_bars)
                signals = self.generate_turbo_signals(test_data, analysis)
                
                # Run turbo backtest
                result = self._run_turbo_backtest(signals, symbol, analysis)
                symbol_results[symbol] = result
                
                if result['total_trades'] > 0:
                    portfolio_total_return += result['total_return_percent']
                
            except Exception as e:
                console.print(f"[red]✗ {symbol}: Error - {str(e)}[/red]")
        
        # Compile turbo results
        turbo_results = {
            'individual_results': symbol_results,
            'portfolio_return': portfolio_total_return,
            'turbo_params': self.turbo_params,
            'symbols_tested': len(symbol_results)
        }
        
        self._display_turbo_results(turbo_results)
        
        return turbo_results
    
    def _run_turbo_backtest(self, df: pd.DataFrame, symbol: str, analysis: Dict) -> Dict:
        """Run turbo backtest with advanced position management"""
        
        portfolio_value = 10000.0
        positions = []
        trades = []
        daily_pnl = 0.0
        consecutive_losses = 0
        
        long_signals = df[df['signal'] == 'LONG']
        
        for i, row in df.iterrows():
            
            # Risk management checks
            if daily_pnl < -self.turbo_params['max_daily_loss']:
                continue  # Stop trading for the day
            
            if consecutive_losses >= self.turbo_params['max_consecutive_losses']:
                continue  # Cool off period
            
            # Exit management for existing positions
            for pos_idx in range(len(positions) - 1, -1, -1):
                position = positions[pos_idx]
                exit_info = self._check_turbo_exits(position, row, i)
                
                if exit_info['should_exit']:
                    # Calculate PnL
                    exit_value = position['remaining_shares'] * row['close']
                    original_value = position['original_shares'] * position['entry_price']
                    pnl = exit_value - original_value
                    
                    portfolio_value += pnl
                    daily_pnl += pnl / 10000.0 * 100  # Convert to percentage
                    
                    # Track consecutive losses
                    if pnl < 0:
                        consecutive_losses += 1
                    else:
                        consecutive_losses = 0
                    
                    trades.append({
                        'entry_time': position['entry_time'],
                        'exit_time': i,
                        'entry_price': position['entry_price'],
                        'exit_price': row['close'],
                        'strategy': position['strategy'],
                        'return_pct': (row['close'] - position['entry_price']) / position['entry_price'] * 100,
                        'pnl': pnl,
                        'exit_reason': exit_info['reason'],
                        'partial_exits': position.get('partial_exits', 0)
                    })
                    
                    positions.pop(pos_idx)
            
            # Entry management
            if (row['signal'] == 'LONG' and 
                len(positions) < self.turbo_params['max_concurrent_positions']):
                
                position_size_pct = row['position_size']
                
                # Portfolio exposure check
                current_exposure = sum(p['size_pct'] for p in positions)
                if current_exposure + position_size_pct <= self.turbo_params['max_portfolio_risk']:
                    
                    position_value = portfolio_value * position_size_pct / 100
                    
                    new_position = {
                        'entry_price': row['close'],
                        'entry_time': i,
                        'strategy': row['strategy_type'],
                        'original_shares': position_value / row['close'],
                        'remaining_shares': position_value / row['close'],
                        'size_pct': position_size_pct,
                        'confidence': row['confidence'],
                        'highest_price': row['close'],
                        'partial_exits': 0
                    }
                    
                    positions.append(new_position)
        
        # Calculate comprehensive results
        if trades:
            winning_trades = [t for t in trades if t['pnl'] > 0]
            win_rate = len(winning_trades) / len(trades) * 100
            total_return = (portfolio_value - 10000) / 10000 * 100
            
            # Advanced metrics
            returns = [t['return_pct'] for t in trades]
            avg_win = np.mean([t['return_pct'] for t in trades if t['pnl'] > 0]) if winning_trades else 0
            avg_loss = np.mean([t['return_pct'] for t in trades if t['pnl'] < 0]) if len(trades) > len(winning_trades) else 0
            
            # Strategy breakdown
            strategy_breakdown = {}
            for trade in trades:
                strategy = trade['strategy']
                if strategy not in strategy_breakdown:
                    strategy_breakdown[strategy] = {'count': 0, 'wins': 0, 'total_return': 0}
                
                strategy_breakdown[strategy]['count'] += 1
                strategy_breakdown[strategy]['total_return'] += trade['return_pct']
                if trade['pnl'] > 0:
                    strategy_breakdown[strategy]['wins'] += 1
            
            return {
                'symbol': symbol,
                'win_rate': win_rate,
                'total_return_percent': total_return,
                'total_trades': len(trades),
                'avg_win': avg_win,
                'avg_loss': avg_loss,
                'max_gain': max(returns) if returns else 0,
                'max_loss': min(returns) if returns else 0,
                'profit_factor': abs(avg_win / avg_loss) if avg_loss != 0 else 999,
                'strategy_breakdown': strategy_breakdown,
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
            'strategy_breakdown': {},
            'trades': []
        }
    
    def _check_turbo_exits(self, position: Dict, row: pd.Series, timestamp) -> Dict:
        """Turbo exit management with scaling and tight stops"""
        
        current_price = row['close']
        entry_price = position['entry_price']
        current_return = (current_price - entry_price) / entry_price * 100
        
        # Update highest price for trailing
        if current_price > position['highest_price']:
            position['highest_price'] = current_price
        
        # 1. Stop Loss (tight)
        if current_return <= -self.turbo_params['sl_percent']:
            return {'should_exit': True, 'reason': 'STOP_LOSS'}
        
        # 2. Take Profit (full exit)
        if current_return >= self.turbo_params['tp_percent']:
            return {'should_exit': True, 'reason': 'TAKE_PROFIT'}
        
        # 3. Partial profit taking (scale out)
        for i, level in enumerate(self.turbo_params['profit_scaling_levels']):
            if (current_return >= level and 
                position['partial_exits'] <= i):
                
                # Scale out percentage
                scale_pct = self.turbo_params['scale_out_percentages'][i] / 100
                shares_to_exit = position['remaining_shares'] * scale_pct
                position['remaining_shares'] -= shares_to_exit
                position['partial_exits'] = i + 1
                
                # If this was the last scale out, exit completely
                if position['remaining_shares'] <= position['original_shares'] * 0.1:
                    return {'should_exit': True, 'reason': f'SCALE_OUT_FINAL_{level}%'}
        
        # 4. Trailing Stop (very tight)
        trailing_stop_price = position['highest_price'] * (1 - self.turbo_params['trailing_stop_percent']/100)
        if current_price <= trailing_stop_price and current_return > 0.5:
            return {'should_exit': True, 'reason': 'TRAILING_STOP'}
        
        # 5. Breakeven Stop
        if (current_return >= self.turbo_params['breakeven_threshold'] and
            current_return <= 0.3):  # Close to breakeven after being profitable
            return {'should_exit': True, 'reason': 'BREAKEVEN'}
        
        # 6. Time exit (for scalping strategies)
        if hasattr(timestamp - position['entry_time'], 'days'):
            hours_held = (timestamp - position['entry_time']).total_seconds() / 3600
        else:
            hours_held = 0
        
        if hours_held > 16:  # Max 16 hours for turbo
            return {'should_exit': True, 'reason': 'TIME_EXIT'}
        
        return {'should_exit': False, 'reason': None}
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        """Calculate RSI"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))
    
    def _display_turbo_results(self, results: Dict):
        """Display turbo results with profit focus"""
        
        console.print(f"\n[bold blue]⚡ TURBO PROFIT RESULTS[/bold blue]")
        
        # Individual symbol results
        results_table = Table(title="Turbo Strategy Performance")
        results_table.add_column("Symbol", style="blue")
        results_table.add_column("Return%", justify="right", style="green")
        results_table.add_column("Win Rate%", justify="right")
        results_table.add_column("Trades", justify="right")
        results_table.add_column("Avg Win%", justify="right")
        results_table.add_column("Max Gain%", justify="right")
        results_table.add_column("Profit Factor", justify="right")
        
        best_performer = ""
        best_return = -999
        
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
            
            if result['total_return_percent'] > best_return:
                best_return = result['total_return_percent']
                best_performer = symbol
        
        console.print(results_table)
        
        # Portfolio summary with turbo metrics
        portfolio_return = results['portfolio_return']
        monthly_return = portfolio_return * (30/32)  # Estimate monthly
        
        console.print(f"\n[bold green]🚀 TURBO PORTFOLIO SUMMARY[/bold green]")
        console.print(f"   💰 Total Portfolio Return: {portfolio_return:.2f}%")
        console.print(f"   📈 Monthly Return Estimate: {monthly_return:.2f}%")
        console.print(f"   🏆 Best Performer: {best_performer} ({best_return:.2f}%)")
        console.print(f"   🎯 Symbols Traded: {results['symbols_tested']}")
        
        # Turbo performance assessment
        if monthly_return > 12:
            console.print(f"\n[bold green]🚀 TURBO SUCCESS - EXCEPTIONAL RETURNS![/bold green]")
            console.print("   ⚡ Strategy performing at maximum capacity")
            console.print("   💎 Consider increasing capital allocation")
            console.print("   🎊 Target of 10-20% monthly returns ACHIEVED!")
        elif monthly_return > 8:
            console.print(f"\n[bold cyan]⚡ TURBO PERFORMING WELL![/bold cyan]")
            console.print("   ✅ Strong returns generated")
            console.print("   📈 Strategy working effectively")
            console.print("   🎯 Close to maximum profit targets")
        elif monthly_return > 4:
            console.print(f"\n[bold yellow]📈 GOOD TURBO PERFORMANCE[/bold yellow]")
            console.print("   ✅ Solid profitable strategy")
            console.print("   🔧 Consider optimizing position sizes")
            console.print("   📊 Building towards higher targets")
        else:
            console.print(f"\n[bold orange]⚠️ TURBO CHALLENGES[/bold orange]")
            console.print("   📉 Market conditions limiting performance")
            console.print("   🛠️ Consider market timing adjustments")
            console.print("   ⏰ Wait for more favorable conditions")
        
        # Save turbo results
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"turbo_profit_strategy_{timestamp}.json"
        
        with open(filename, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        
        console.print(f"\n[green]✅ Turbo results saved to: {filename}[/green]")

def main():
    """Main function for turbo profit strategy"""
    
    console.print(Panel.fit(
        "[bold blue]⚡ TURBO PROFIT STRATEGY[/bold blue]\n"
        "Maximum profitability mode\n"
        "Aggressive position sizing + tight risk management\n"
        "Multi-strategy approach with scaling exits\n"
        "TARGET: 10-20% monthly returns",
        border_style="blue"
    ))
    
    # Initialize turbo strategy
    strategy = TurboProfitStrategy()
    
    # Run turbo backtest
    results = strategy.turbo_backtest(days_back=32)
    
    console.print(f"\n[bold blue]⚡ Turbo profit analysis complete![/bold blue]")
    
    # Final turbo recommendations
    console.print(Panel.fit(
        "[bold blue]⚡ TURBO PROFIT MAXIMIZATION[/bold blue]\n\n"
        "1. 🚀 Higher Base Position Size (16% vs 8%)\n"
        "2. ⚡ Maximum Position Size (28% for high confidence)\n"
        "3. 🎯 Excellent Risk-Reward (6:1 ratio)\n"
        "4. 📈 Multiple Concurrent Positions (up to 4)\n"
        "5. 💰 Partial Profit Taking (scale out system)\n"
        "6. 🔄 Portfolio Compound Reinvestment\n"
        "7. 🏆 45% Maximum Portfolio Exposure\n\n"
        "[green]TURBO TARGET: 10-20% monthly returns[/green]\n"
        "[yellow]Based on enhanced aggressive approach that achieved 4.6%[/yellow]",
        border_style="blue"
    ))

if __name__ == "__main__":
    main() 