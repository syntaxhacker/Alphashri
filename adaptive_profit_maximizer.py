#!/usr/bin/env python3
"""
Adaptive Profit Maximizer - Smart Strategy Optimization
Automatically adapts to market conditions and optimizes for maximum profitability
Combines all best techniques with dynamic parameter adjustment
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

class AdaptiveProfitMaximizer:
    """Adaptive strategy that learns and optimizes for maximum profitability"""
    
    def __init__(self, symbols: List[str] = None):
        # Start with proven performers
        self.symbols = symbols or ['ETHUSDT', 'BTCUSDT', 'SOLUSDT']
        self.fetcher = EnhancedDataFetcher()
        
        # Adaptive parameters that adjust based on performance
        self.adaptive_params = {
            # Base parameters (conservative start)
            'base_lookback': 14,
            'base_volume_mult': 1.3,
            'base_breakout_pct': 0.06,
            'base_position_size': 8.0,
            'max_position_size': 18.0,
            
            # Adaptive ranges
            'lookback_range': [8, 20],
            'volume_mult_range': [1.1, 1.8],
            'breakout_pct_range': [0.03, 0.12],
            'position_size_range': [4.0, 22.0],
            
            # Risk management
            'base_sl_percent': 2.5,
            'base_tp_percent': 7.0,
            'adaptive_sl_range': [1.5, 4.0],
            'adaptive_tp_range': [4.0, 12.0],
            
            # Portfolio management
            'max_portfolio_risk': 30.0,
            'max_concurrent_positions': 3,
            
            # Adaptation settings
            'adaptation_frequency': 'weekly',
            'performance_window': 20,  # Trades to look back for adaptation
            'success_threshold': 60.0,  # Win rate threshold for aggressive mode
            'loss_threshold': 40.0,     # Win rate threshold for conservative mode
        }
        
        # Performance tracking
        self.performance_history = []
        self.current_mode = 'moderate'  # Start moderate
        self.adaptation_cycle = 0
        
        # Mode-specific parameters
        self.modes = {
            'conservative': {
                'position_size_mult': 0.7,
                'sl_mult': 0.8,
                'tp_mult': 0.9,
                'volume_mult_adj': 1.2,
                'breakout_adj': 1.3,
                'risk_mult': 0.8
            },
            'moderate': {
                'position_size_mult': 1.0,
                'sl_mult': 1.0,
                'tp_mult': 1.0,
                'volume_mult_adj': 1.0,
                'breakout_adj': 1.0,
                'risk_mult': 1.0
            },
            'aggressive': {
                'position_size_mult': 1.4,
                'sl_mult': 0.9,
                'tp_mult': 1.3,
                'volume_mult_adj': 0.85,
                'breakout_adj': 0.8,
                'risk_mult': 1.3
            }
        }
        
    def adapt_strategy(self):
        """Adapt strategy parameters based on recent performance"""
        
        if len(self.performance_history) < 10:
            return  # Need minimum data for adaptation
        
        recent_trades = self.performance_history[-self.adaptive_params['performance_window']:]
        
        # Calculate recent performance metrics
        win_rate = sum(1 for trade in recent_trades if trade['profitable']) / len(recent_trades) * 100
        avg_return = np.mean([trade['return_pct'] for trade in recent_trades])
        total_profit = sum(trade['pnl'] for trade in recent_trades)
        
        console.print(f"[cyan]📊 Recent Performance Analysis:[/cyan]")
        console.print(f"   Win Rate: {win_rate:.1f}%")
        console.print(f"   Avg Return: {avg_return:.2f}%")
        console.print(f"   Total Profit: ${total_profit:.2f}")
        
        # Determine new mode based on performance
        previous_mode = self.current_mode
        
        if win_rate >= self.adaptive_params['success_threshold'] and total_profit > 100:
            self.current_mode = 'aggressive'
            console.print(f"[green]🚀 Switching to AGGRESSIVE mode - performance is strong![/green]")
        elif win_rate <= self.adaptive_params['loss_threshold'] or total_profit < -50:
            self.current_mode = 'conservative'
            console.print(f"[yellow]🛡️ Switching to CONSERVATIVE mode - protecting capital[/yellow]")
        else:
            self.current_mode = 'moderate'
            console.print(f"[blue]📊 Staying in MODERATE mode - balanced approach[/blue]")
        
        if previous_mode != self.current_mode:
            console.print(f"[magenta]⚡ Mode change: {previous_mode.upper()} → {self.current_mode.upper()}[/magenta]")
        
        self.adaptation_cycle += 1
    
    def get_current_parameters(self) -> Dict:
        """Get current parameters based on adaptive mode"""
        
        mode_config = self.modes[self.current_mode]
        
        return {
            'lookback_periods': int(self.adaptive_params['base_lookback'] * mode_config.get('breakout_adj', 1.0)),
            'volume_multiplier': self.adaptive_params['base_volume_mult'] * mode_config.get('volume_mult_adj', 1.0),
            'min_breakout_percent': self.adaptive_params['base_breakout_pct'] * mode_config.get('breakout_adj', 1.0),
            'sl_percent': self.adaptive_params['base_sl_percent'] * mode_config.get('sl_mult', 1.0),
            'tp_percent': self.adaptive_params['base_tp_percent'] * mode_config.get('tp_mult', 1.0),
            'base_position_size': self.adaptive_params['base_position_size'] * mode_config.get('position_size_mult', 1.0),
            'max_position_size': min(
                self.adaptive_params['max_position_size'] * mode_config.get('position_size_mult', 1.0),
                25.0  # Hard cap
            ),
            'max_portfolio_risk': self.adaptive_params['max_portfolio_risk'] * mode_config.get('risk_mult', 1.0)
        }
    
    def smart_market_analysis(self, df: pd.DataFrame, symbol: str) -> Dict:
        """Smart market analysis that adapts to current mode"""
        
        if len(df) < 100:
            return {'favorable': False, 'confidence': 0.0}
        
        recent = df.tail(300)  # Last ~18 hours
        
        # Multi-timeframe analysis
        short_momentum = (recent['close'].iloc[-4] - recent['close'].iloc[-8]) / recent['close'].iloc[-8]
        med_momentum = (recent['close'].iloc[-1] - recent['close'].iloc[-16]) / recent['close'].iloc[-16]
        long_momentum = (recent['close'].iloc[-1] - recent['close'].iloc[-48]) / recent['close'].iloc[-48]
        
        # Volume analysis
        volume_ma = recent['volume'].rolling(30).mean()
        current_volume = recent['volume'].tail(10).mean()
        volume_strength = current_volume / volume_ma.iloc[-1] if volume_ma.iloc[-1] > 0 else 1.0
        
        # Volatility assessment
        returns = recent['close'].pct_change().dropna()
        volatility = returns.std()
        vol_percentile = np.percentile(returns.rolling(50).std().dropna(), 70)
        
        # Trend analysis
        sma_20 = recent['close'].rolling(20).mean()
        sma_50 = recent['close'].rolling(50).mean()
        trend_strength = abs(sma_20.iloc[-1] - sma_50.iloc[-1]) / sma_50.iloc[-1] if len(sma_50) > 0 else 0
        
        # Mode-specific scoring
        if self.current_mode == 'conservative':
            # Conservative mode: Higher requirements
            score = 0
            if abs(short_momentum) > 0.008 and abs(med_momentum) > 0.015:
                score += 30
            if volume_strength > 1.4:
                score += 25
            if 0.3 < volatility < 0.8:  # Moderate volatility
                score += 25
            if trend_strength > 0.02:
                score += 20
            
            confidence_threshold = 70
            
        elif self.current_mode == 'aggressive':
            # Aggressive mode: Lower requirements, more opportunities
            score = 0
            if abs(short_momentum) > 0.003:
                score += 25
            if abs(med_momentum) > 0.008:
                score += 20
            if volume_strength > 1.1:
                score += 20
            if volatility > 0.001:  # Any volatility
                score += 20
            if trend_strength > 0.005:
                score += 15
            
            confidence_threshold = 40
            
        else:  # Moderate mode
            score = 0
            if abs(short_momentum) > 0.005:
                score += 25
            if abs(med_momentum) > 0.012:
                score += 20
            if volume_strength > 1.2:
                score += 20
            if volatility > 0.002:
                score += 20
            if trend_strength > 0.015:
                score += 15
            
            confidence_threshold = 55
        
        # Final assessment
        favorable = score >= confidence_threshold
        confidence = min(score / 100.0, 1.0)
        
        return {
            'favorable': favorable,
            'confidence': confidence,
            'score': score,
            'mode': self.current_mode,
            'momentum_strength': max(abs(short_momentum), abs(med_momentum)) * 100,
            'volume_strength': volume_strength,
            'volatility': volatility,
            'trend_strength': trend_strength
        }
    
    def generate_adaptive_signals(self, df: pd.DataFrame, analysis: Dict, symbol: str) -> pd.DataFrame:
        """Generate signals adapted to current market conditions and mode"""
        
        if not analysis['favorable']:
            df['signal'] = 'HOLD'
            df['confidence'] = 0.0
            df['position_size'] = 0.0
            return df
        
        # Get current adaptive parameters
        params = self.get_current_parameters()
        
        df = df.copy()
        df['signal'] = 'HOLD'
        df['confidence'] = 0.0
        df['position_size'] = 0.0
        
        # Calculate indicators with adaptive parameters
        df['volume_ma'] = df['volume'].rolling(20).mean()
        df['high_max'] = df['high'].rolling(params['lookback_periods']).max().shift(1)
        df['momentum'] = df['close'].pct_change(4)
        df['rsi'] = self._calculate_rsi(df['close'], 14)
        df['volume_ratio'] = df['volume'] / df['volume_ma']
        
        # Generate signals with mode-specific logic
        for i in range(50, len(df)):
            row = df.iloc[i]
            
            if pd.isna(row['high_max']):
                continue
            
            # Adaptive breakout detection
            breakout_threshold = 1 + params['min_breakout_percent']/100
            breakout_condition = row['close'] > row['high_max'] * breakout_threshold
            
            # Adaptive volume condition  
            volume_condition = row['volume_ratio'] > params['volume_multiplier']
            
            # Additional filters based on mode
            if self.current_mode == 'conservative':
                # Conservative: Strict filters
                momentum_ok = row['momentum'] > 0.01
                rsi_ok = 30 < row['rsi'] < 70
                additional_ok = momentum_ok and rsi_ok
                base_confidence = 0.6
                
            elif self.current_mode == 'aggressive':
                # Aggressive: Relaxed filters
                momentum_ok = row['momentum'] > 0.002
                rsi_ok = row['rsi'] < 80
                additional_ok = momentum_ok and rsi_ok
                base_confidence = 0.8
                
            else:  # Moderate
                momentum_ok = row['momentum'] > 0.005
                rsi_ok = 30 < row['rsi'] < 75
                additional_ok = momentum_ok and rsi_ok
                base_confidence = 0.7
            
            # Generate signal if all conditions met
            if breakout_condition and volume_condition and additional_ok:
                
                # Calculate adaptive confidence
                confidence = base_confidence * analysis['confidence']
                
                # Volume boost
                if row['volume_ratio'] > params['volume_multiplier'] * 1.5:
                    confidence += 0.1
                
                # Momentum boost
                if row['momentum'] > 0.01:
                    confidence += 0.1
                
                confidence = min(confidence, 1.0)
                
                # Minimum confidence threshold by mode
                min_confidence = {'conservative': 0.7, 'moderate': 0.5, 'aggressive': 0.4}
                
                if confidence >= min_confidence[self.current_mode]:
                    df.iloc[i, df.columns.get_loc('signal')] = 'LONG'
                    df.iloc[i, df.columns.get_loc('confidence')] = confidence
                    
                    # Calculate adaptive position size
                    position_size = self._calculate_adaptive_position_size(
                        confidence, params, analysis
                    )
                    df.iloc[i, df.columns.get_loc('position_size')] = position_size
        
        return df
    
    def _calculate_adaptive_position_size(self, confidence: float, params: Dict, analysis: Dict) -> float:
        """Calculate position size adapted to current mode and confidence"""
        
        base_size = params['base_position_size']
        
        # Confidence scaling
        confidence_mult = confidence ** 1.5
        
        # Mode-specific adjustments
        if self.current_mode == 'conservative':
            size_mult = 0.8  # Smaller positions
        elif self.current_mode == 'aggressive':
            size_mult = 1.3  # Larger positions
        else:
            size_mult = 1.0
        
        # Market condition adjustments
        if analysis['volume_strength'] > 1.5:
            size_mult *= 1.1
        
        if analysis['momentum_strength'] > 1.0:
            size_mult *= 1.1
        
        # Calculate final size
        final_size = base_size * confidence_mult * size_mult
        
        # Apply limits
        final_size = min(final_size, params['max_position_size'])
        final_size = max(final_size, 2.0)  # Minimum 2%
        
        return final_size
    
    def adaptive_backtest(self, days_back: int = 35) -> Dict:
        """Run adaptive backtest with learning and optimization"""
        
        console.print(Panel.fit(
            "[bold purple]🧠 ADAPTIVE PROFIT MAXIMIZER[/bold purple]\n"
            f"Smart Learning Strategy: ACTIVE\n"
            f"Current Mode: {self.current_mode.upper()}\n"
            f"Adaptation Cycle: {self.adaptation_cycle}\n"
            f"Auto-adjusts parameters based on performance\n"
            f"Learns from market conditions and optimizes",
            border_style="purple"
        ))
        
        # Load data for all symbols
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back + 20)
        
        all_results = {}
        
        # Test each symbol and adapt
        for symbol in self.symbols:
            console.print(f"\n[purple]🧠 Adaptive testing {symbol}...[/purple]")
            
            try:
                df = self.fetcher.fetch_data(symbol, start_date, end_date, timeframe='15m')
                
                if df is None or len(df) < 500:
                    console.print(f"[red]✗ {symbol}: Insufficient data[/red]")
                    continue
                
                # Smart market analysis
                analysis = self.smart_market_analysis(df, symbol)
                
                console.print(f"[cyan]Mode: {analysis['mode'].upper()}[/cyan]")
                console.print(f"[cyan]Market Score: {analysis['score']}/100[/cyan]")
                console.print(f"[cyan]Favorable: {'YES' if analysis['favorable'] else 'NO'}[/cyan]")
                
                if analysis['favorable']:
                    # Generate adaptive signals
                    test_bars = days_back * 24 * 4
                    test_data = df.tail(test_bars)
                    signals = self.generate_adaptive_signals(test_data, analysis, symbol)
                    
                    # Run adaptive backtest
                    result = self._run_adaptive_backtest(signals, symbol, analysis)
                    all_results[symbol] = result
                    
                    # Learn from results
                    if result['trades']:
                        self.performance_history.extend(result['trades'])
                    
                    # Adapt strategy based on recent performance
                    if len(self.performance_history) >= 15:
                        self.adapt_strategy()
                
            except Exception as e:
                console.print(f"[red]✗ {symbol}: Error - {str(e)}[/red]")
        
        # Compile adaptive results
        adaptive_results = {
            'individual_results': all_results,
            'final_mode': self.current_mode,
            'adaptation_cycles': self.adaptation_cycle,
            'total_performance_records': len(self.performance_history)
        }
        
        # Calculate portfolio performance
        total_return = sum(r['total_return_percent'] for r in all_results.values())
        adaptive_results['portfolio_return'] = total_return
        
        self._display_adaptive_results(adaptive_results)
        
        return adaptive_results
    
    def _run_adaptive_backtest(self, df: pd.DataFrame, symbol: str, analysis: Dict) -> Dict:
        """Run backtest with adaptive parameters"""
        
        params = self.get_current_parameters()
        portfolio_value = 10000.0
        positions = []
        trades = []
        
        for i, row in df.iterrows():
            
            # Exit management
            for pos_idx in range(len(positions) - 1, -1, -1):
                position = positions[pos_idx]
                exit_info = self._check_adaptive_exits(position, row, i, params)
                
                if exit_info['should_exit']:
                    # Calculate results
                    exit_value = position['shares'] * row['close']
                    original_value = position['shares'] * position['entry_price']
                    pnl = exit_value - original_value
                    return_pct = (row['close'] - position['entry_price']) / position['entry_price'] * 100
                    
                    portfolio_value += pnl
                    
                    # Record trade for learning
                    trade_record = {
                        'entry_time': position['entry_time'],
                        'exit_time': i,
                        'return_pct': return_pct,
                        'pnl': pnl,
                        'profitable': pnl > 0,
                        'exit_reason': exit_info['reason'],
                        'mode': self.current_mode,
                        'confidence': position['confidence']
                    }
                    
                    trades.append(trade_record)
                    positions.pop(pos_idx)
            
            # Entry management
            if (row['signal'] == 'LONG' and 
                len(positions) < self.adaptive_params['max_concurrent_positions']):
                
                position_size_pct = row['position_size']
                position_value = portfolio_value * position_size_pct / 100
                
                if position_value <= portfolio_value * 0.8:  # Keep some cash
                    new_position = {
                        'entry_price': row['close'],
                        'entry_time': i,
                        'shares': position_value / row['close'],
                        'confidence': row['confidence'],
                        'highest_price': row['close']
                    }
                    
                    positions.append(new_position)
        
        # Calculate results
        if trades:
            winning_trades = [t for t in trades if t['profitable']]
            win_rate = len(winning_trades) / len(trades) * 100
            total_return = (portfolio_value - 10000) / 10000 * 100
            
            avg_win = np.mean([t['return_pct'] for t in trades if t['profitable']]) if winning_trades else 0
            avg_loss = np.mean([t['return_pct'] for t in trades if not t['profitable']]) if len(trades) > len(winning_trades) else 0
            
            return {
                'symbol': symbol,
                'win_rate': win_rate,
                'total_return_percent': total_return,
                'total_trades': len(trades),
                'avg_win': avg_win,
                'avg_loss': avg_loss,
                'trades': trades,
                'mode_used': self.current_mode
            }
        
        return {
            'symbol': symbol,
            'win_rate': 0,
            'total_return_percent': 0,
            'total_trades': 0,
            'avg_win': 0,
            'avg_loss': 0,
            'trades': [],
            'mode_used': self.current_mode
        }
    
    def _check_adaptive_exits(self, position: Dict, row: pd.Series, timestamp, params: Dict) -> Dict:
        """Check adaptive exits based on current mode parameters"""
        
        current_price = row['close']
        entry_price = position['entry_price']
        current_return = (current_price - entry_price) / entry_price * 100
        
        # Update highest price
        if current_price > position['highest_price']:
            position['highest_price'] = current_price
        
        # Adaptive stop loss
        if current_return <= -params['sl_percent']:
            return {'should_exit': True, 'reason': 'STOP_LOSS'}
        
        # Adaptive take profit
        if current_return >= params['tp_percent']:
            return {'should_exit': True, 'reason': 'TAKE_PROFIT'}
        
        # Trailing stop (mode dependent)
        trailing_pct = 1.5 if self.current_mode == 'conservative' else 1.2 if self.current_mode == 'moderate' else 1.0
        trailing_stop = position['highest_price'] * (1 - trailing_pct/100)
        
        if current_price <= trailing_stop and current_return > 1.0:
            return {'should_exit': True, 'reason': 'TRAILING_STOP'}
        
        return {'should_exit': False, 'reason': None}
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        """Calculate RSI"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))
    
    def _display_adaptive_results(self, results: Dict):
        """Display adaptive results with learning insights"""
        
        console.print(f"\n[bold purple]🧠 ADAPTIVE PROFIT MAXIMIZER RESULTS[/bold purple]")
        
        # Individual results
        if results['individual_results']:
            results_table = Table(title="Adaptive Strategy Performance")
            results_table.add_column("Symbol", style="purple")
            results_table.add_column("Return%", justify="right", style="green")
            results_table.add_column("Win Rate%", justify="right")
            results_table.add_column("Trades", justify="right")
            results_table.add_column("Mode Used", style="cyan")
            results_table.add_column("Avg Win%", justify="right")
            
            for symbol, result in results['individual_results'].items():
                results_table.add_row(
                    symbol,
                    f"{result['total_return_percent']:.2f}",
                    f"{result['win_rate']:.1f}",
                    str(result['total_trades']),
                    result['mode_used'].upper(),
                    f"{result['avg_win']:.1f}"
                )
            
            console.print(results_table)
        
        # Adaptive insights
        portfolio_return = results.get('portfolio_return', 0)
        monthly_return = portfolio_return * (30/35)
        
        console.print(f"\n[bold green]🧠 ADAPTIVE INSIGHTS[/bold green]")
        console.print(f"   💰 Portfolio Return: {portfolio_return:.2f}%")
        console.print(f"   📈 Monthly Estimate: {monthly_return:.2f}%")
        console.print(f"   🎯 Final Mode: {results['final_mode'].upper()}")
        console.print(f"   🔄 Adaptation Cycles: {results['adaptation_cycles']}")
        console.print(f"   📊 Learning Records: {results['total_performance_records']}")
        
        # Performance assessment
        if monthly_return > 6:
            console.print(f"\n[bold green]🚀 ADAPTIVE SUCCESS![/bold green]")
            console.print("   🧠 Strategy learning and optimizing effectively")
            console.print("   📈 Strong performance through adaptation")
        elif monthly_return > 3:
            console.print(f"\n[bold cyan]🧠 ADAPTIVE PROGRESS[/bold cyan]")
            console.print("   ✅ Strategy showing good learning capability")
            console.print("   📊 Positive adaptation to market conditions")
        elif monthly_return > 0:
            console.print(f"\n[bold yellow]🧠 ADAPTIVE LEARNING[/bold yellow]")
            console.print("   📚 Strategy gathering data and adapting")
            console.print("   🔧 Continuous optimization in progress")
        else:
            console.print(f"\n[bold orange]🧠 ADAPTIVE CHALLENGES[/bold orange]")
            console.print("   📉 Difficult market conditions for learning")
            console.print("   🛡️ Strategy protecting capital while adapting")
        
        # Save adaptive results
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"adaptive_profit_maximizer_{timestamp}.json"
        
        with open(filename, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        
        console.print(f"\n[green]✅ Adaptive results saved to: {filename}[/green]")

def main():
    """Main function for adaptive profit maximizer"""
    
    console.print(Panel.fit(
        "[bold purple]🧠 ADAPTIVE PROFIT MAXIMIZER[/bold purple]\n"
        "Smart learning strategy that adapts to market conditions\n"
        "Automatically optimizes parameters based on performance\n"
        "Switches between conservative/moderate/aggressive modes\n"
        "Maximum profitability through intelligent adaptation",
        border_style="purple"
    ))
    
    # Initialize adaptive strategy
    strategy = AdaptiveProfitMaximizer()
    
    # Run adaptive backtest
    results = strategy.adaptive_backtest(days_back=35)
    
    console.print(f"\n[bold purple]🧠 Adaptive profit optimization complete![/bold purple]")
    
    # Final adaptive recommendations
    console.print(Panel.fit(
        "[bold purple]🧠 ADAPTIVE PROFIT MAXIMIZATION GUIDE[/bold purple]\n\n"
        "1. 🎯 Smart Mode Switching: Conservative/Moderate/Aggressive\n"
        "2. 📚 Continuous Learning: Adapts from every trade\n"
        "3. 🔄 Parameter Optimization: Adjusts based on performance\n"
        "4. 🛡️ Risk Protection: Reduces exposure when struggling\n"
        "5. 🚀 Opportunity Maximization: Increases size when winning\n"
        "6. 📊 Market Condition Adaptation: Responds to regime changes\n"
        "7. 🧠 Intelligence Over Aggression: Smart beats forceful\n\n"
        "[green]ADAPTIVE TARGET: Consistent profitable growth[/green]\n"
        "[yellow]The strategy that learns and improves over time[/yellow]",
        border_style="purple"
    ))

if __name__ == "__main__":
    main() 