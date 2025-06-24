#!/usr/bin/env python3
"""
Beautiful & Simple Walk Forward Analysis for BTCUSDT Crypto Breakout Strategy
Focused visualization with essential metrics and beautiful charts
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta
import warnings
from typing import Dict, List
import yfinance as yf

# Import local modules
try:
    from strategies.breakout_strategy import BreakoutStrategy
    from backtester.backtest_engine import BacktestEngine
except ImportError:
    print("⚠️  Could not import local modules. Creating standalone version...")
    BreakoutStrategy = None
    BacktestEngine = None

warnings.filterwarnings('ignore')

# Set beautiful plot style
plt.style.use('seaborn-v0_8-darkgrid')
sns.set_palette("Set2")

class SimpleBreakoutStrategy:
    """Simplified breakout strategy for standalone use"""
    
    def __init__(self, lookback=10, volume_mult=0.8, breakout_pct=0.01):
        self.lookback = lookback
        self.volume_mult = volume_mult
        self.breakout_pct = breakout_pct
        
    def generate_signals(self, data):
        """Generate buy/sell signals"""
        df = data.copy()
        
        # Calculate indicators
        df['volume_ma'] = df['volume'].rolling(window=10).mean()  # Shorter window
        df['high_max'] = df['high'].rolling(window=self.lookback).max().shift(1)
        df['low_min'] = df['low'].rolling(window=self.lookback).min().shift(1)
        
        # Generate signals
        df['signal'] = 'HOLD'
        
        # More aggressive breakout conditions
        breakout_up = (df['close'] > df['high_max'] * (1 + self.breakout_pct/100)) & \
                     (df['volume'] > df['volume_ma'] * self.volume_mult)
        
        breakout_down = (df['close'] < df['low_min'] * (1 - self.breakout_pct/100)) & \
                       (df['volume'] > df['volume_ma'] * self.volume_mult)
        
        df.loc[breakout_up, 'signal'] = 'BUY'
        df.loc[breakout_down, 'signal'] = 'SELL'
        
        return df

def simple_backtest(data, strategy, initial_balance=10000):
    """Simple backtesting function"""
    df = strategy.generate_signals(data)
    
    balance = initial_balance
    position = 0
    trades = []
    equity_curve = [initial_balance]
    
    for i, row in df.iterrows():
        if row['signal'] == 'BUY' and position <= 0:
            if position < 0:  # Close short
                balance += position * row['close']
                trades.append(position * row['close'])
            # Open long
            position = balance / row['close']
            balance = 0
            
        elif row['signal'] == 'SELL' and position >= 0:
            if position > 0:  # Close long
                balance += position * row['close']
                trades.append(position * row['close'] - initial_balance)
            # Open short
            position = -balance / row['close']
            balance = 0
            
        # Calculate current equity
        current_equity = balance + (position * row['close'] if position != 0 else 0)
        equity_curve.append(current_equity)
    
    # Close final position
    if position != 0:
        balance += position * df.iloc[-1]['close']
    
    total_return = (balance - initial_balance) / initial_balance * 100
    
    return {
        'total_return': total_return,
        'final_balance': balance,
        'equity_curve': equity_curve[1:],  # Remove initial value
        'trades': trades,
        'total_trades': len(trades)
    }

class CryptoWalkForwardViz:
    """Beautiful walk forward analysis visualization"""
    
    def __init__(self, symbol="BTC-USD"):
        self.symbol = symbol
        self.results = []
        
    def fetch_crypto_data(self, period="1y"):
        """Fetch BTCUSDT data"""
        print(f"🔄 Fetching Bitcoin data...")
        
        try:
            # Try multiple ticker symbols for Bitcoin
            symbols_to_try = ["BTC-USD", "BTCUSD=X", "BTC-USD"]
            
            for symbol in symbols_to_try:
                try:
                    print(f"  📡 Trying {symbol}...")
                    ticker = yf.Ticker(symbol)
                    data = ticker.history(period=period, interval="1d")
                    
                    if not data.empty:
                        # Clean data
                        data.columns = [col.lower() for col in data.columns]
                        data = data.dropna()
                        
                        print(f"✅ Got {len(data)} days of Bitcoin data from {data.index[0].date()} to {data.index[-1].date()}")
                        return data
                        
                except Exception as e:
                    print(f"  ❌ {symbol} failed: {e}")
                    continue
            
            # If all fail, create synthetic data for demonstration
            print("📊 Creating synthetic Bitcoin-like data for demonstration...")
            return self.create_synthetic_crypto_data()
            
        except Exception as e:
            print(f"❌ Error: {e}")
            return self.create_synthetic_crypto_data()
    
    def create_synthetic_crypto_data(self):
        """Create synthetic crypto data for demonstration"""
        print("🎭 Generating synthetic Bitcoin-like price data...")
        
        # Generate 365 days of synthetic data
        dates = pd.date_range(start='2023-01-01', periods=365, freq='D')
        
        # Parameters for Bitcoin-like behavior
        np.random.seed(42)  # For reproducible results
        initial_price = 30000
        volatility = 0.04  # 4% daily volatility
        trend = 0.0005     # Slight upward trend
        
        # Generate price movements
        returns = np.random.normal(trend, volatility, len(dates))
        prices = [initial_price]
        
        for i in range(1, len(dates)):
            new_price = prices[-1] * (1 + returns[i])
            prices.append(new_price)
        
        # Create OHLCV data
        data = pd.DataFrame(index=dates)
        data['close'] = prices
        
        # Generate OHLC from close prices
        daily_range = np.random.uniform(0.01, 0.05, len(dates))  # 1-5% daily range
        
        data['open'] = data['close'].shift(1).fillna(initial_price)
        data['high'] = data['close'] * (1 + daily_range/2)
        data['low'] = data['close'] * (1 - daily_range/2)
        
        # Ensure OHLC relationships are correct
        data['high'] = np.maximum(data['high'], np.maximum(data['open'], data['close']))
        data['low'] = np.minimum(data['low'], np.minimum(data['open'], data['close']))
        
        # Generate volume (higher volume on larger price moves)
        price_changes = np.abs(data['close'].pct_change())
        base_volume = 1000000  # Base volume
        volume_multiplier = 1 + price_changes * 10  # More volume on big moves
        data['volume'] = base_volume * volume_multiplier * np.random.uniform(0.5, 2.0, len(dates))
        
        data = data.dropna()
        print(f"✅ Created {len(data)} days of synthetic Bitcoin data")
        return data
    
    def run_walk_forward(self, data, train_days=90, test_days=30, step_days=15):
        """Run walk forward analysis"""
        print(f"""
🚀 WALK FORWARD ANALYSIS STARTING
================================
📊 Training: {train_days} days
🧪 Testing: {test_days} days  
⏭️  Step: {step_days} days
        """)
        
        results = []
        
        # Parameter combinations to test - More aggressive for signal generation
        param_combinations = [
            {'lookback': 3, 'volume_mult': 0.5, 'breakout_pct': 0.005},
            {'lookback': 5, 'volume_mult': 0.7, 'breakout_pct': 0.01},
            {'lookback': 7, 'volume_mult': 0.8, 'breakout_pct': 0.015},
            {'lookback': 10, 'volume_mult': 1.0, 'breakout_pct': 0.02},
            {'lookback': 15, 'volume_mult': 1.2, 'breakout_pct': 0.025},
        ]
        
        total_days = len(data)
        current_start = 0
        period_num = 0
        
        while current_start + train_days + test_days < total_days:
            period_num += 1
            
            # Split data
            train_end = current_start + train_days
            test_start = train_end
            test_end = test_start + test_days
            
            train_data = data.iloc[current_start:train_end].copy()
            test_data = data.iloc[test_start:test_end].copy()
            
            print(f"\n📈 Period {period_num}: {train_data.index[0].date()} → {test_data.index[-1].date()}")
            
            # Optimize on training data
            best_params = None
            best_return = -float('inf')
            
            for params in param_combinations:
                strategy = SimpleBreakoutStrategy(**params)
                result = simple_backtest(train_data, strategy)
                
                if result['total_return'] > best_return:
                    best_return = result['total_return']
                    best_params = params
            
            # Test on out-of-sample data
            if best_params:
                strategy = SimpleBreakoutStrategy(**best_params)
                test_result = simple_backtest(test_data, strategy)
                
                results.append({
                    'period': period_num,
                    'test_start': test_data.index[0],
                    'test_end': test_data.index[-1],
                    'params': best_params,
                    'train_return': best_return,
                    'test_return': test_result['total_return'],
                    'trades': test_result['total_trades'],
                    'equity_curve': test_result['equity_curve']
                })
                
                print(f"✅ Test Return: {test_result['total_return']:.2f}% | Trades: {test_result['total_trades']}")
            
            current_start += step_days
        
        self.results = results
        print(f"\n🎉 Analysis complete! {len(results)} periods tested")
        return results
    
    def create_beautiful_dashboard(self):
        """Create stunning visualization dashboard"""
        if not self.results:
            print("❌ No results to visualize")
            return
        
        # Set up the figure with a beautiful style
        fig = plt.figure(figsize=(20, 16))
        fig.patch.set_facecolor('#f8f9fa')
        
        # Color palette
        colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD']
        
        # 1. Cumulative Returns Over Time (Main chart)
        ax1 = plt.subplot(3, 3, (1, 3))
        
        dates = [r['test_end'] for r in self.results]
        returns = [r['test_return'] for r in self.results]
        cumulative_returns = np.cumprod(1 + np.array(returns)/100) - 1
        
        ax1.plot(dates, cumulative_returns * 100, 
                linewidth=4, color=colors[0], marker='o', markersize=8,
                markerfacecolor='white', markeredgewidth=2, alpha=0.8)
        ax1.fill_between(dates, cumulative_returns * 100, alpha=0.3, color=colors[0])
        ax1.set_title('🚀 Cumulative Strategy Returns Over Time', fontsize=18, fontweight='bold', pad=20)
        ax1.set_ylabel('Cumulative Return (%)', fontsize=14)
        ax1.grid(True, alpha=0.3)
        ax1.set_facecolor('#ffffff')
        
        # 2. Period-by-Period Returns
        ax2 = plt.subplot(3, 3, 4)
        bars = ax2.bar(range(len(returns)), returns, 
                      color=[colors[1] if r > 0 else colors[0] for r in returns],
                      alpha=0.8, edgecolor='white', linewidth=2)
        ax2.axhline(y=0, color='black', linestyle='-', alpha=0.5)
        ax2.set_title('📊 Period Returns', fontsize=14, fontweight='bold')
        ax2.set_ylabel('Return (%)', fontsize=12)
        ax2.set_xlabel('Period', fontsize=12)
        ax2.grid(True, alpha=0.3)
        
        # 3. Rolling Sharpe Ratio Approximation
        ax3 = plt.subplot(3, 3, 5)
        rolling_std = pd.Series(returns).rolling(window=3, min_periods=1).std()
        rolling_mean = pd.Series(returns).rolling(window=3, min_periods=1).mean()
        sharpe_approx = rolling_mean / rolling_std
        
        ax3.plot(range(len(sharpe_approx)), sharpe_approx, 
                color=colors[2], linewidth=3, marker='s', markersize=6)
        ax3.axhline(y=0, color='black', linestyle='--', alpha=0.5)
        ax3.set_title('📈 Rolling Risk-Adjusted Returns', fontsize=14, fontweight='bold')
        ax3.set_ylabel('Sharpe Approximation', fontsize=12)
        ax3.grid(True, alpha=0.3)
        
        # 4. Trade Count per Period
        ax4 = plt.subplot(3, 3, 6)
        trade_counts = [r['trades'] for r in self.results]
        ax4.bar(range(len(trade_counts)), trade_counts, 
               color=colors[3], alpha=0.8, edgecolor='white', linewidth=2)
        ax4.set_title('🎯 Trades per Period', fontsize=14, fontweight='bold')
        ax4.set_ylabel('Number of Trades', fontsize=12)
        ax4.grid(True, alpha=0.3)
        
        # 5. Parameter Evolution Heatmap
        ax5 = plt.subplot(3, 3, 7)
        param_data = []
        param_names = ['lookback', 'volume_mult', 'breakout_pct']
        
        for param in param_names:
            param_values = [r['params'][param] for r in self.results]
            param_data.append(param_values)
        
        im = ax5.imshow(param_data, cmap='RdYlBu_r', aspect='auto')
        ax5.set_yticks(range(len(param_names)))
        ax5.set_yticklabels(param_names)
        ax5.set_title('🔧 Parameter Evolution', fontsize=14, fontweight='bold')
        ax5.set_xlabel('Period', fontsize=12)
        plt.colorbar(im, ax=ax5, shrink=0.8)
        
        # 6. Win Rate Analysis
        ax6 = plt.subplot(3, 3, 8)
        positive_periods = sum(1 for r in returns if r > 0)
        negative_periods = len(returns) - positive_periods
        
        wedges, texts, autotexts = ax6.pie([positive_periods, negative_periods], 
                                          labels=['Winning Periods', 'Losing Periods'],
                                          colors=[colors[4], colors[5]], 
                                          autopct='%1.1f%%',
                                          startangle=90,
                                          textprops={'fontsize': 12})
        ax6.set_title('🎲 Win Rate Distribution', fontsize=14, fontweight='bold')
        
        # 7. Return Distribution
        ax7 = plt.subplot(3, 3, 9)
        ax7.hist(returns, bins=10, alpha=0.7, color=colors[1], 
                edgecolor='white', linewidth=2)
        ax7.axvline(np.mean(returns), color=colors[0], linestyle='--', 
                   linewidth=3, label=f'Mean: {np.mean(returns):.2f}%')
        ax7.set_title('📈 Return Distribution', fontsize=14, fontweight='bold')
        ax7.set_xlabel('Return (%)', fontsize=12)
        ax7.set_ylabel('Frequency', fontsize=12)
        ax7.legend()
        ax7.grid(True, alpha=0.3)
        
        plt.tight_layout(pad=3.0)
        
        # Add main title
        fig.suptitle('🚀 BTCUSDT Crypto Breakout Strategy - Walk Forward Analysis Dashboard 🚀', 
                    fontsize=24, fontweight='bold', y=0.98)
        
        return fig
    
    def print_summary_stats(self):
        """Print beautiful summary statistics"""
        if not self.results:
            return
        
        returns = [r['test_return'] for r in self.results]
        trade_counts = [r['trades'] for r in self.results]
        
        print(f"""
╔══════════════════════════════════════════════════════════════╗
║                    📊 ANALYSIS SUMMARY                       ║
╠══════════════════════════════════════════════════════════════╣
║  Total Periods Tested: {len(self.results):>6}                               ║
║  Average Return/Period: {np.mean(returns):>10.2f}%                       ║
║  Best Period Return: {np.max(returns):>13.2f}%                       ║
║  Worst Period Return: {np.min(returns):>12.2f}%                       ║
║  Return Volatility: {np.std(returns):>14.2f}%                       ║
║  Win Rate: {sum(1 for r in returns if r > 0)/len(returns)*100:>21.1f}%                       ║
║  Average Trades/Period: {np.mean(trade_counts):>8.1f}                       ║
║  Total Cumulative Return: {(np.prod(1 + np.array(returns)/100) - 1)*100:>6.2f}%                  ║
╚══════════════════════════════════════════════════════════════╝
        """)

def main():
    """Run the complete crypto walk forward analysis"""
    
    print("""
    🌟 BEAUTIFUL CRYPTO WALK FORWARD ANALYSIS 🌟
    ============================================
    
    📈 Strategy: Breakout with Volume Confirmation
    💰 Asset: BTCUSDT (Bitcoin)
    🔄 Method: Rolling Window Optimization
    
    """)
    
    # Initialize analyzer
    analyzer = CryptoWalkForwardViz("BTC-USD")
    
    # Fetch data
    data = analyzer.fetch_crypto_data("1y")
    if data is None:
        return
    
    # Run analysis
    results = analyzer.run_walk_forward(data, train_days=60, test_days=20, step_days=10)
    
    if not results:
        print("❌ No results generated")
        return
    
    # Create beautiful dashboard
    fig = analyzer.create_beautiful_dashboard()
    if fig:
        plt.savefig('crypto_walkforward_beautiful_dashboard.png', 
                   dpi=300, bbox_inches='tight', facecolor='#f8f9fa')
        print("✅ Beautiful dashboard saved as 'crypto_walkforward_beautiful_dashboard.png'")
        plt.close(fig)  # Close figure to save memory
    
    # Print summary
    analyzer.print_summary_stats()
    
    print("""
    🎉 ANALYSIS COMPLETE!
    ====================
    
    📁 Generated: crypto_walkforward_beautiful_dashboard.png
    💡 The dashboard shows strategy performance across different market periods
    📊 Each period was optimized independently to prevent overfitting
    
    """)

if __name__ == "__main__":
    main() 