#!/usr/bin/env python3
"""
🕯️ VECTORBT TEST: Simple Engulfing Pattern Strategy

Test the user's simple logic:
1. Check last 3 candles for momentum (all green or all red)
2. Wait for opposite engulfing candle (reversal signal)  
3. Take trade in direction of engulfing candle

Let's see if this simple approach actually works!
"""

import vectorbt as vbt
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

# Import our data fetcher
from enhanced_data_fetcher import EnhancedDataFetcher

class SimpleEngulfingVectorbtTest:
    """Test simple engulfing strategy with vectorbt"""
    
    def __init__(self):
        self.data_fetcher = EnhancedDataFetcher(
            api_key="d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3",
            api_secret="7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c",
            cache_dir="vectorbt_cache"
        )
    
    def fetch_test_data(self, symbol='BTCUSDT', days=90):
        """Fetch data for testing"""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        print(f"📊 Fetching {symbol} 1h data for {days} days...")
        
        data = self.data_fetcher.fetch_data(
            symbol=symbol,
            start_date=start_date,
            end_date=end_date,
            timeframe='1h'
        )
        
        if data.empty:
            print(f"❌ No data available for {symbol}")
            return None
        
        print(f"✅ Fetched {len(data)} bars for {symbol}")
        print(f"📈 Price range: ${data['close'].min():.2f} - ${data['close'].max():.2f}")
        
        return data
    
    def detect_candlestick_patterns(self, data):
        """Detect simple engulfing patterns using the user's exact logic"""
        df = data.copy()
        
        # Create candlestick properties
        df['is_green'] = df['close'] > df['open']
        df['body_size'] = abs(df['close'] - df['open'])
        
        # Initialize signals
        long_signals = pd.Series(False, index=df.index)
        short_signals = pd.Series(False, index=df.index)
        
        print("🔍 Detecting engulfing patterns...")
        
        # Parameters (matching the simple trader)
        momentum_candles = 3    # Check last 3 candles
        min_momentum = 0.08     # 0.08% minimum momentum
        engulf_ratio = 1.3      # 30% bigger engulfing body
        
        signal_count = 0
        
        # Loop through data starting from index 4 (need 4 candles minimum)
        for i in range(4, len(df)):
            # Get momentum candles (last 3 candles before current)
            momentum_start_idx = i - momentum_candles
            momentum_candles_data = df.iloc[momentum_start_idx:i]
            
            current_candle = df.iloc[i]
            previous_candle = df.iloc[i-1]
            
            # Check momentum direction
            all_green = all(momentum_candles_data['is_green'])
            all_red = all(~momentum_candles_data['is_green'])
            
            if not (all_green or all_red):
                continue  # No clear momentum
            
            # Calculate momentum strength
            momentum_start_price = momentum_candles_data['open'].iloc[0]
            momentum_end_price = momentum_candles_data['close'].iloc[-1]
            momentum_pct = abs((momentum_end_price - momentum_start_price) / momentum_start_price) * 100
            
            if momentum_pct < min_momentum:
                continue  # Not enough momentum
            
            # Check engulfing pattern
            current_body = current_candle['body_size']
            previous_body = previous_candle['body_size']
            
            # Bullish engulfing after red momentum
            if (all_red and 
                current_candle['is_green'] and 
                not previous_candle['is_green'] and
                current_candle['open'] <= previous_candle['close'] and
                current_candle['close'] >= previous_candle['open'] and
                current_body >= previous_body * engulf_ratio):
                
                long_signals.iloc[i] = True
                signal_count += 1
                if signal_count <= 5:  # Print first 5 signals for debugging
                    print(f"🔺 BUY Signal {signal_count}: Red momentum ({momentum_pct:.2f}%) + Bullish Engulfing at {df.index[i]}")
            
            # Bearish engulfing after green momentum
            elif (all_green and 
                  not current_candle['is_green'] and 
                  previous_candle['is_green'] and
                  current_candle['open'] >= previous_candle['close'] and
                  current_candle['close'] <= previous_candle['open'] and
                  current_body >= previous_body * engulf_ratio):
                
                short_signals.iloc[i] = True
                signal_count += 1
                if signal_count <= 5:  # Print first 5 signals for debugging
                    print(f"🔻 SELL Signal {signal_count}: Green momentum ({momentum_pct:.2f}%) + Bearish Engulfing at {df.index[i]}")
        
        print(f"✅ Found {long_signals.sum()} BUY signals and {short_signals.sum()} SELL signals")
        return long_signals, short_signals, df
    
    def run_vectorbt_backtest(self, data, long_signals, short_signals):
        """Run vectorbt backtest with simple exits"""
        print("🚀 Running vectorbt backtest...")
        
        # Simple exit strategy: opposite signal or time-based
        long_exits = short_signals.copy()  # Exit long on short signal
        short_exits = long_signals.copy()  # Exit short on long signal
        
        # Add time-based exits (hold for max 24 hours)
        max_hold_periods = 24  # 24 hours for 1h data
        
        # Improve exits by adding time-based closing
        for i in range(len(long_signals)):
            if long_signals.iloc[i]:  # Long entry
                # Set exit after max_hold_periods or at next short signal
                exit_idx = min(i + max_hold_periods, len(long_signals) - 1)
                if not any(short_signals.iloc[i+1:exit_idx+1]):  # No short signal in between
                    long_exits.iloc[exit_idx] = True
        
        for i in range(len(short_signals)):
            if short_signals.iloc[i]:  # Short entry
                # Set exit after max_hold_periods or at next long signal
                exit_idx = min(i + max_hold_periods, len(short_signals) - 1)
                if not any(long_signals.iloc[i+1:exit_idx+1]):  # No long signal in between
                    short_exits.iloc[exit_idx] = True
        
        # Run vectorbt portfolio simulation
        portfolio = vbt.Portfolio.from_signals(
            close=data['close'],
            entries=long_signals,
            exits=long_exits,
            short_entries=short_signals,
            short_exits=short_exits,
            init_cash=10000,
            fees=0.001,  # 0.1% trading fees
            freq='1h'
        )
        
        return portfolio
    
    def analyze_results(self, portfolio, data):
        """Analyze backtest results"""
        print("\n" + "="*60)
        print("📊 SIMPLE ENGULFING STRATEGY BACKTEST RESULTS")
        print("="*60)
        
        # Get portfolio statistics
        stats = portfolio.stats()
        
        # Basic performance metrics
        total_return = stats['Total Return [%]']
        total_trades = stats['Total Trades']
        win_rate = stats['Win Rate [%]']
        sharpe_ratio = stats['Sharpe Ratio']
        max_drawdown = stats['Max Drawdown [%]']
        
        print(f"📈 Total Return: {total_return:.2f}%")
        print(f"🎯 Win Rate: {win_rate:.1f}%")
        print(f"📊 Total Trades: {total_trades}")
        print(f"⚡ Sharpe Ratio: {sharpe_ratio:.2f}")
        print(f"📉 Max Drawdown: {max_drawdown:.2f}%")
        
        # Trade analysis
        if total_trades > 0:
            trades = portfolio.trades.records_readable
            avg_trade_duration = trades['Duration'].mean()
            avg_return_per_trade = trades['Return [%]'].mean()
            
            print(f"⏱️  Avg Trade Duration: {avg_trade_duration:.1f} hours")
            print(f"💰 Avg Return per Trade: {avg_return_per_trade:.2f}%")
            
            # Winning vs losing trades
            winning_trades = trades[trades['PnL'] > 0]
            losing_trades = trades[trades['PnL'] < 0]
            
            if len(winning_trades) > 0:
                avg_win = winning_trades['Return [%]'].mean()
                print(f"✅ Avg Winning Trade: {avg_win:.2f}%")
            
            if len(losing_trades) > 0:
                avg_loss = losing_trades['Return [%]'].mean()
                print(f"❌ Avg Losing Trade: {avg_loss:.2f}%")
        
        # Performance assessment
        print("\n" + "="*40)
        print("🎯 STRATEGY ASSESSMENT")
        print("="*40)
        
        if total_return > 0:
            print("✅ POSITIVE: Strategy shows positive returns")
        else:
            print("❌ NEGATIVE: Strategy shows negative returns")
        
        if win_rate > 50:
            print("✅ GOOD: Win rate above 50%")
        else:
            print("⚠️  LOW: Win rate below 50%")
        
        if total_trades >= 10:
            print("✅ ACTIVE: Sufficient trading activity")
        else:
            print("⚠️  INACTIVE: Low trading activity")
        
        if sharpe_ratio > 1.0:
            print("✅ EXCELLENT: Good risk-adjusted returns")
        elif sharpe_ratio > 0.5:
            print("👍 DECENT: Moderate risk-adjusted returns")
        else:
            print("👎 POOR: Poor risk-adjusted returns")
        
        return stats

def main():
    """Run the simple engulfing strategy test"""
    tester = SimpleEngulfingVectorbtTest()
    
    print("🕯️ Testing Simple Engulfing Pattern Strategy")
    print("Your Logic: 3-Candle Momentum + Opposite Engulfing = Trade")
    print()
    
    # Test on BTC
    try:
        data = tester.fetch_test_data('BTCUSDT', 60)  # 60 days of data
        if data is not None:
            long_signals, short_signals, enhanced_data = tester.detect_candlestick_patterns(data)
            
            if long_signals.sum() > 0 or short_signals.sum() > 0:
                portfolio = tester.run_vectorbt_backtest(data, long_signals, short_signals)
                stats = tester.analyze_results(portfolio, data)
            else:
                print("❌ No signals found! Strategy may be too restrictive.")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()
