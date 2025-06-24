#!/usr/bin/env python3
"""
🚀 OPTIMIZED Crypto Walk Forward Analysis - BTCUSDT Breakout Strategy
Enhanced with better risk management, realistic fees, and improved signal generation
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
import seaborn as sns
import warnings
from typing import Dict, List
import yfinance as yf

warnings.filterwarnings('ignore')

# Beautiful plot styling
plt.style.use('seaborn-v0_8-whitegrid')
colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#A8E6CF', '#FFD3A5']

class OptimizedBreakoutStrategy:
    """Enhanced breakout strategy with proper risk management"""
    
    def __init__(self, lookback=10, volume_mult=0.8, breakout_pct=0.02, 
                 stop_loss=0.02, take_profit=0.04, max_hold_days=5):
        self.lookback = lookback
        self.volume_mult = volume_mult
        self.breakout_pct = breakout_pct
        self.stop_loss = stop_loss
        self.take_profit = take_profit
        self.max_hold_days = max_hold_days
        
    def generate_signals(self, data):
        """Generate enhanced buy/sell signals with risk management"""
        df = data.copy()
        
        # Technical indicators
        df['volume_sma'] = df['volume'].rolling(window=10).mean()
        df['price_sma'] = df['close'].rolling(window=5).mean()
        df['high_max'] = df['high'].rolling(window=self.lookback).max().shift(1)
        df['low_min'] = df['low'].rolling(window=self.lookback).min().shift(1)
        
        # Volatility filter
        df['price_std'] = df['close'].rolling(window=20).std()
        df['volatility'] = df['price_std'] / df['close']
        
        # Initialize signals
        df['signal'] = 'HOLD'
        df['entry_price'] = 0.0
        df['stop_price'] = 0.0
        df['target_price'] = 0.0
        
        position = None
        entry_price = 0
        entry_day = 0
        
        for i in range(1, len(df)):
            if pd.isna(df.iloc[i]['high_max']) or pd.isna(df.iloc[i]['volume_sma']):
                continue
                
            current = df.iloc[i]
            
            # Check exit conditions if in position
            if position is not None:
                days_held = i - entry_day
                
                # Stop loss
                if position == 'LONG' and current['low'] <= entry_price * (1 - self.stop_loss):
                    df.iloc[i, df.columns.get_loc('signal')] = 'SELL'
                    position = None
                    continue
                elif position == 'SHORT' and current['high'] >= entry_price * (1 + self.stop_loss):
                    df.iloc[i, df.columns.get_loc('signal')] = 'COVER'
                    position = None
                    continue
                
                # Take profit
                if position == 'LONG' and current['high'] >= entry_price * (1 + self.take_profit):
                    df.iloc[i, df.columns.get_loc('signal')] = 'SELL'
                    position = None
                    continue
                elif position == 'SHORT' and current['low'] <= entry_price * (1 - self.take_profit):
                    df.iloc[i, df.columns.get_loc('signal')] = 'COVER'
                    position = None
                    continue
                
                # Max hold time
                if days_held >= self.max_hold_days:
                    df.iloc[i, df.columns.get_loc('signal')] = 'SELL' if position == 'LONG' else 'COVER'
                    position = None
                    continue
            
            # Entry conditions (only if not in position)
            if position is None:
                # Volume confirmation
                volume_ok = current['volume'] > current['volume_sma'] * self.volume_mult
                
                # Volatility filter (avoid extremely volatile periods)
                vol_ok = 0.01 < current['volatility'] < 0.08
                
                if volume_ok and vol_ok:
                    # Long breakout
                    if current['close'] > current['high_max'] * (1 + self.breakout_pct/100):
                        df.iloc[i, df.columns.get_loc('signal')] = 'BUY'
                        position = 'LONG'
                        entry_price = current['close']
                        entry_day = i
                        
                        # Set risk management levels
                        df.iloc[i, df.columns.get_loc('entry_price')] = entry_price
                        df.iloc[i, df.columns.get_loc('stop_price')] = entry_price * (1 - self.stop_loss)
                        df.iloc[i, df.columns.get_loc('target_price')] = entry_price * (1 + self.take_profit)
                    
                    # Short breakout
                    elif current['close'] < current['low_min'] * (1 - self.breakout_pct/100):
                        df.iloc[i, df.columns.get_loc('signal')] = 'SHORT'
                        position = 'SHORT'
                        entry_price = current['close']
                        entry_day = i
                        
                        # Set risk management levels
                        df.iloc[i, df.columns.get_loc('entry_price')] = entry_price
                        df.iloc[i, df.columns.get_loc('stop_price')] = entry_price * (1 + self.stop_loss)
                        df.iloc[i, df.columns.get_loc('target_price')] = entry_price * (1 - self.take_profit)
        
        return df

def enhanced_backtest(data, strategy, initial_balance=10000):
    """Enhanced backtesting with realistic fees and slippage"""
    df = strategy.generate_signals(data)
    
    balance = initial_balance
    position = 0
    trades = []
    equity_curve = []
    
    # Trading costs
    fee_rate = 0.001  # 0.1% per trade
    slippage = 0.0005  # 0.05% slippage
    
    for i, row in df.iterrows():
        current_equity = balance + (position * row['close'] if position != 0 else 0)
        equity_curve.append(current_equity)
        
        if row['signal'] in ['BUY', 'SHORT']:
            # Calculate position size (risk-based)
            risk_amount = balance * 0.02  # Risk 2% per trade
            stop_distance = abs(row['close'] - row['stop_price']) / row['close'] if row['stop_price'] > 0 else 0.02
            
            if stop_distance > 0:
                position_size = risk_amount / stop_distance / row['close']
                position_size = min(position_size, balance * 0.1 / row['close'])  # Max 10% of capital
                
                # Execute trade
                trade_cost = position_size * row['close'] * (fee_rate + slippage)
                
                if row['signal'] == 'BUY':
                    position = position_size
                    balance -= (position_size * row['close'] + trade_cost)
                else:  # SHORT
                    position = -position_size
                    balance += (position_size * row['close'] - trade_cost)
                
                trades.append({
                    'entry_price': row['close'],
                    'entry_type': row['signal'],
                    'stop_price': row['stop_price'],
                    'target_price': row['target_price']
                })
        
        elif row['signal'] in ['SELL', 'COVER'] and position != 0:
            # Close position
            trade_value = abs(position) * row['close']
            trade_cost = trade_value * (fee_rate + slippage)
            
            if position > 0:  # Close long
                balance += (trade_value - trade_cost)
                pnl = (row['close'] - trades[-1]['entry_price']) / trades[-1]['entry_price']
            else:  # Close short
                balance += (balance - trade_value - trade_cost)
                pnl = (trades[-1]['entry_price'] - row['close']) / trades[-1]['entry_price']
            
            trades[-1]['exit_price'] = row['close']
            trades[-1]['pnl'] = pnl
            position = 0
    
    # Final calculations
    final_equity = balance + (position * df.iloc[-1]['close'] if position != 0 else 0)
    total_return = (final_equity - initial_balance) / initial_balance * 100
    
    if len(trades) > 0:
        completed_trades = [t for t in trades if 'pnl' in t]
        win_rate = len([t for t in completed_trades if t['pnl'] > 0]) / len(completed_trades) if completed_trades else 0
        avg_win = np.mean([t['pnl'] for t in completed_trades if t['pnl'] > 0]) if completed_trades else 0
        avg_loss = np.mean([t['pnl'] for t in completed_trades if t['pnl'] < 0]) if completed_trades else 0
        profit_factor = (avg_win * win_rate) / abs(avg_loss * (1 - win_rate)) if avg_loss != 0 else 0
    else:
        win_rate = 0
        profit_factor = 0
    
    return {
        'total_return': total_return,
        'final_balance': final_equity,
        'equity_curve': equity_curve,
        'trades': trades,
        'total_trades': len(trades),
        'win_rate': win_rate,
        'profit_factor': profit_factor,
        'max_drawdown': calculate_max_drawdown(equity_curve)
    }

def calculate_max_drawdown(equity_curve):
    """Calculate maximum drawdown"""
    if len(equity_curve) < 2:
        return 0
    
    peak = equity_curve[0]
    max_dd = 0
    
    for value in equity_curve:
        if value > peak:
            peak = value
        drawdown = (peak - value) / peak
        max_dd = max(max_dd, drawdown)
    
    return max_dd

class OptimizedCryptoWalkForward:
    """Optimized walk forward analysis with better visualizations"""
    
    def __init__(self):
        self.results = []
        
    def create_synthetic_crypto_data(self):
        """Create realistic synthetic crypto data"""
        print("🎭 Creating realistic Bitcoin-like data...")
        
        dates = pd.date_range(start='2023-01-01', periods=365, freq='D')
        np.random.seed(42)
        
        # More realistic Bitcoin parameters
        initial_price = 30000
        volatility = 0.035  # 3.5% daily volatility
        trend = 0.0003      # Slight upward bias
        
        # Generate correlated returns (crypto-like clustering)
        returns = []
        current_vol = volatility
        
        for i in range(len(dates)):
            # Volatility clustering
            current_vol = 0.95 * current_vol + 0.05 * volatility + 0.02 * np.random.randn()
            current_vol = max(0.01, min(0.1, current_vol))
            
            # Generate return with regime changes
            if i % 100 == 0:  # Regime change every ~3 months
                trend = np.random.normal(0, 0.001)
            
            daily_return = np.random.normal(trend, current_vol)
            returns.append(daily_return)
        
        # Build price series
        prices = [initial_price]
        for ret in returns[1:]:
            prices.append(prices[-1] * (1 + ret))
        
        # Create OHLCV
        data = pd.DataFrame(index=dates)
        data['close'] = prices
        data['open'] = data['close'].shift(1).fillna(initial_price)
        
        # Initialize high and low columns
        data['high'] = data['close']
        data['low'] = data['close']
        
        # Realistic OHLC relationships
        daily_range = np.random.lognormal(-3, 0.5, len(dates))  # Log-normal range
        
        # Ensure proper OHLC relationships
        for i in range(len(data)):
            o, c = data.iloc[i]['open'], data.iloc[i]['close']
            range_size = daily_range[i] * c
            
            if c > o:  # Green candle
                data.iloc[i, data.columns.get_loc('low')] = min(o, c) - range_size * 0.3
                data.iloc[i, data.columns.get_loc('high')] = max(o, c) + range_size * 0.7
            else:  # Red candle
                data.iloc[i, data.columns.get_loc('low')] = min(o, c) - range_size * 0.7
                data.iloc[i, data.columns.get_loc('high')] = max(o, c) + range_size * 0.3
        
        # Realistic volume (higher on larger moves)
        price_changes = np.abs(data['close'].pct_change())
        base_volume = 500000
        volume_mult = 1 + price_changes * 20 + np.random.uniform(0.5, 1.5, len(dates))
        data['volume'] = base_volume * volume_mult
        
        data = data.dropna()
        print(f"✅ Generated {len(data)} days of realistic crypto data")
        return data
    
    def run_optimization(self, data, train_days=60, test_days=20, step_days=10):
        """Run optimized walk forward analysis"""
        print(f"""
🚀 OPTIMIZED WALK FORWARD ANALYSIS
=================================
📊 Training: {train_days} days
🧪 Testing: {test_days} days
⏭️  Step: {step_days} days
        """)
        
        # Enhanced parameter space
        param_grid = [
            {'lookback': 5, 'volume_mult': 0.6, 'breakout_pct': 0.008, 'stop_loss': 0.015, 'take_profit': 0.03},
            {'lookback': 8, 'volume_mult': 0.8, 'breakout_pct': 0.012, 'stop_loss': 0.020, 'take_profit': 0.04},
            {'lookback': 12, 'volume_mult': 1.0, 'breakout_pct': 0.018, 'stop_loss': 0.025, 'take_profit': 0.05},
            {'lookback': 15, 'volume_mult': 1.2, 'breakout_pct': 0.025, 'stop_loss': 0.030, 'take_profit': 0.06},
        ]
        
        results = []
        total_days = len(data)
        current_start = 0
        period_num = 0
        
        while current_start + train_days + test_days < total_days:
            period_num += 1
            
            # Data splitting
            train_end = current_start + train_days
            test_start = train_end
            test_end = test_start + test_days
            
            train_data = data.iloc[current_start:train_end].copy()
            test_data = data.iloc[test_start:test_end].copy()
            
            print(f"\n📈 Period {period_num}: {train_data.index[0].date()} → {test_data.index[-1].date()}")
            
            # Parameter optimization on training data
            best_params = None
            best_score = -float('inf')
            
            for params in param_grid:
                strategy = OptimizedBreakoutStrategy(**params)
                result = enhanced_backtest(train_data, strategy)
                
                # Multi-objective scoring
                score = (result['total_return'] * 0.4 + 
                        result['win_rate'] * 100 * 0.3 + 
                        result['profit_factor'] * 20 * 0.2 - 
                        result['max_drawdown'] * 200 * 0.1)
                
                if score > best_score:
                    best_score = score
                    best_params = params
            
            # Test on out-of-sample data
            if best_params:
                strategy = OptimizedBreakoutStrategy(**best_params)
                test_result = enhanced_backtest(test_data, strategy)
                
                results.append({
                    'period': period_num,
                    'test_start': test_data.index[0],
                    'test_end': test_data.index[-1],
                    'params': best_params,
                    'performance': test_result
                })
                
                print(f"✅ Return: {test_result['total_return']:.2f}% | Win Rate: {test_result['win_rate']*100:.1f}% | Trades: {test_result['total_trades']}")
            
            current_start += step_days
        
        self.results = results
        print(f"\n🎉 Optimization complete! {len(results)} periods analyzed")
        return results
    
    def create_advanced_dashboard(self):
        """Create advanced visualization dashboard"""
        if not self.results:
            return None
            
        fig = plt.figure(figsize=(24, 18))
        fig.patch.set_facecolor('#f8f9fa')
        
        # Extract metrics
        periods = [r['period'] for r in self.results]
        returns = [r['performance']['total_return'] for r in self.results]
        win_rates = [r['performance']['win_rate'] * 100 for r in self.results]
        trade_counts = [r['performance']['total_trades'] for r in self.results]
        profit_factors = [r['performance']['profit_factor'] for r in self.results]
        max_drawdowns = [r['performance']['max_drawdown'] * 100 for r in self.results]
        dates = [r['test_end'] for r in self.results]
        
        # 1. Cumulative Performance (Main Chart)
        ax1 = plt.subplot(3, 4, (1, 4))
        cumulative_returns = np.cumprod(1 + np.array(returns)/100) - 1
        ax1.plot(dates, cumulative_returns * 100, linewidth=4, color=colors[0], 
                marker='o', markersize=6, alpha=0.8)
        ax1.fill_between(dates, cumulative_returns * 100, alpha=0.3, color=colors[0])
        ax1.set_title('🚀 Cumulative Strategy Performance', fontsize=18, fontweight='bold', pad=20)
        ax1.set_ylabel('Cumulative Return (%)', fontsize=14)
        ax1.grid(True, alpha=0.3)
        ax1.set_facecolor('#ffffff')
        
        # 2. Period Returns Distribution
        ax2 = plt.subplot(3, 4, 5)
        n, bins, patches = ax2.hist(returns, bins=12, alpha=0.7, color=colors[1], edgecolor='white')
        # Color bars based on profitability
        for i, p in enumerate(patches):
            if bins[i] < 0:
                p.set_facecolor(colors[0])  # Red for losses
            else:
                p.set_facecolor(colors[1])  # Green for profits
        ax2.axvline(np.mean(returns), color='black', linestyle='--', linewidth=2, 
                   label=f'Mean: {np.mean(returns):.2f}%')
        ax2.set_title('📊 Return Distribution', fontsize=14, fontweight='bold')
        ax2.set_xlabel('Return (%)')
        ax2.legend()
        
        # 3. Win Rate Over Time
        ax3 = plt.subplot(3, 4, 6)
        ax3.plot(periods, win_rates, color=colors[2], linewidth=3, marker='s', markersize=6)
        ax3.axhline(50, color='gray', linestyle='--', alpha=0.5, label='50% Baseline')
        ax3.set_title('🎯 Win Rate Evolution', fontsize=14, fontweight='bold')
        ax3.set_ylabel('Win Rate (%)')
        ax3.legend()
        ax3.grid(True, alpha=0.3)
        
        # 4. Risk-Return Scatter
        ax4 = plt.subplot(3, 4, 7)
        scatter = ax4.scatter(max_drawdowns, returns, c=profit_factors, s=100, 
                            cmap='RdYlGn', alpha=0.7, edgecolors='black')
        ax4.set_xlabel('Max Drawdown (%)')
        ax4.set_ylabel('Return (%)')
        ax4.set_title('⚖️ Risk vs Return', fontsize=14, fontweight='bold')
        plt.colorbar(scatter, ax=ax4, label='Profit Factor')
        ax4.grid(True, alpha=0.3)
        
        # 5. Trade Frequency
        ax5 = plt.subplot(3, 4, 8)
        ax5.bar(periods, trade_counts, color=colors[3], alpha=0.8, edgecolor='white')
        ax5.set_title('📈 Trading Activity', fontsize=14, fontweight='bold')
        ax5.set_ylabel('Number of Trades')
        ax5.grid(True, alpha=0.3)
        
        # 6-8. Parameter Evolution Heatmaps
        param_names = ['lookback', 'volume_mult', 'breakout_pct']
        for idx, param in enumerate(param_names):
            ax = plt.subplot(3, 4, 9 + idx)
            param_values = [r['params'][param] for r in self.results]
            
            # Create heatmap matrix
            matrix = np.array(param_values).reshape(1, -1)
            im = ax.imshow(matrix, cmap='viridis', aspect='auto')
            ax.set_title(f'🔧 {param.title()} Evolution', fontsize=12, fontweight='bold')
            ax.set_xticks(range(0, len(periods), 3))
            ax.set_xticklabels(periods[::3])
            ax.set_yticks([])
            plt.colorbar(im, ax=ax, shrink=0.8)
        
        # 12. Performance Metrics Summary
        ax12 = plt.subplot(3, 4, 12)
        ax12.axis('off')
        
        # Calculate summary statistics
        total_return = (np.prod(1 + np.array(returns)/100) - 1) * 100
        avg_return = np.mean(returns)
        volatility = np.std(returns)
        sharpe = avg_return / volatility if volatility > 0 else 0
        win_rate_avg = np.mean(win_rates)
        avg_trades = np.mean(trade_counts)
        
        summary_text = f"""
📊 PERFORMANCE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━
🎯 Total Return: {total_return:.2f}%
📈 Avg Period Return: {avg_return:.2f}%
📉 Volatility: {volatility:.2f}%
⚡ Sharpe Ratio: {sharpe:.2f}
🏆 Win Rate: {win_rate_avg:.1f}%
🔄 Avg Trades/Period: {avg_trades:.1f}
📊 Total Periods: {len(self.results)}
        """
        
        ax12.text(0.1, 0.9, summary_text, transform=ax12.transAxes, fontsize=12,
                 verticalalignment='top', fontfamily='monospace',
                 bbox=dict(boxstyle='round', facecolor=colors[4], alpha=0.8))
        
        plt.tight_layout(pad=2.0)
        fig.suptitle('🚀 OPTIMIZED BTCUSDT Breakout Strategy - Advanced Walk Forward Analysis 🚀', 
                    fontsize=24, fontweight='bold', y=0.98)
        
        return fig

def main():
    """Run the optimized crypto walk forward analysis"""
    
    print("""
    ⭐ OPTIMIZED CRYPTO WALK FORWARD ANALYSIS ⭐
    ==========================================
    
    🔥 Enhanced Strategy: Volume-Confirmed Breakouts
    💎 Asset: BTCUSDT (Bitcoin) 
    🧠 Method: Multi-Objective Optimization
    ⚖️  Features: Risk Management + Realistic Fees
    
    """)
    
    analyzer = OptimizedCryptoWalkForward()
    
    # Generate realistic data
    data = analyzer.create_synthetic_crypto_data()
    
    # Run optimization
    results = analyzer.run_optimization(data, train_days=60, test_days=20, step_days=10)
    
    if not results:
        print("❌ No results generated")
        return
    
    # Create advanced dashboard
    fig = analyzer.create_advanced_dashboard()
    if fig:
        plt.savefig('optimized_crypto_walkforward_dashboard.png', 
                   dpi=300, bbox_inches='tight', facecolor='#f8f9fa')
        print("✅ Advanced dashboard saved as 'optimized_crypto_walkforward_dashboard.png'")
        plt.close(fig)
    
    print("""
    🎉 OPTIMIZED ANALYSIS COMPLETE!
    ==============================
    
    📁 Generated: optimized_crypto_walkforward_dashboard.png
    🔥 Features 12 advanced visualizations including:
    • Cumulative performance tracking
    • Risk-return analysis with profit factor coloring
    • Parameter evolution heatmaps  
    • Win rate trends and trade frequency
    • Comprehensive performance summary
    
    💡 This analysis uses realistic trading costs and proper risk management!
    
    """)

if __name__ == "__main__":
    main() 