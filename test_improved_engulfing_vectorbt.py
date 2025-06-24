#!/usr/bin/env python3
"""
🕯️ IMPROVED VECTORBT TEST: Simple Engulfing Pattern Strategy

Your logic works (finds patterns), but needs better exits!

Improvements:
1. Mean reversion exits (back to middle of range)  
2. Profit targets and stop losses
3. Better time-based exits
4. Volume confirmation
"""

import vectorbt as vbt
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

from enhanced_data_fetcher import EnhancedDataFetcher

class ImprovedEngulfingTest:
    def __init__(self):
        self.data_fetcher = EnhancedDataFetcher(
            api_key="d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3",
            api_secret="7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c",
            cache_dir="vectorbt_cache"
        )
    
    def fetch_test_data(self, symbol='BTCUSDT', days=90):
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        print(f"📊 Fetching {symbol} 1h data for {days} days...")
        
        data = self.data_fetcher.fetch_data(
            symbol=symbol, start_date=start_date, end_date=end_date, timeframe='1h'
        )
        
        if data.empty:
            return None
        
        print(f"✅ Fetched {len(data)} bars")
        return data
    
    def detect_patterns(self, data):
        df = data.copy()
        
        # Add indicators
        df['ma_20'] = df['close'].rolling(20).mean()
        df['volume_ma'] = df['volume'].rolling(20).mean()
        df['volume_ratio'] = df['volume'] / df['volume_ma']
        
        # Support/Resistance
        df['support'] = df['low'].rolling(20).min()
        df['resistance'] = df['high'].rolling(20).max()
        df['price_position'] = (df['close'] - df['support']) / (df['resistance'] - df['support'])
        
        # Candlestick properties
        df['is_green'] = df['close'] > df['open']
        df['body_size'] = abs(df['close'] - df['open'])
        
        long_signals = pd.Series(False, index=df.index)
        short_signals = pd.Series(False, index=df.index)
        
        print("🔍 Detecting IMPROVED patterns...")
        
        for i in range(25, len(df)):
            # Get 3-candle momentum
            momentum_candles = df.iloc[i-3:i]
            current = df.iloc[i]
            previous = df.iloc[i-1]
            
            # Skip if missing data
            if pd.isna(current['price_position']) or pd.isna(current['volume_ratio']):
                continue
            
            all_green = all(momentum_candles['is_green'])
            all_red = all(~momentum_candles['is_green'])
            
            if not (all_green or all_red):
                continue
            
            # Momentum strength
            momentum_pct = abs((momentum_candles['close'].iloc[-1] - momentum_candles['open'].iloc[0]) / momentum_candles['open'].iloc[0]) * 100
            if momentum_pct < 0.05:  # 0.05% minimum
                continue
                
            # Volume confirmation
            if current['volume_ratio'] < 1.1:
                continue
            
            # Engulfing check
            current_body = current['body_size']
            previous_body = previous['body_size']
            
            # BUY: Red momentum + Bullish engulfing at oversold
            if (all_red and current['is_green'] and not previous['is_green'] and
                current['open'] <= previous['close'] and current['close'] >= previous['open'] and
                current_body >= previous_body * 1.2 and current['price_position'] < 0.3):
                long_signals.iloc[i] = True
            
            # SELL: Green momentum + Bearish engulfing at overbought
            elif (all_green and not current['is_green'] and previous['is_green'] and
                  current['open'] >= previous['close'] and current['close'] <= previous['open'] and
                  current_body >= previous_body * 1.2 and current['price_position'] > 0.7):
                short_signals.iloc[i] = True
        
        print(f"✅ Found {long_signals.sum()} BUY and {short_signals.sum()} SELL signals")
        return long_signals, short_signals, df
    
    def create_exits(self, data, long_signals, short_signals):
        long_exits = pd.Series(False, index=data.index)
        short_exits = pd.Series(False, index=data.index)
        
        # Track positions
        long_pos = False
        short_pos = False
        entry_price = 0
        entry_idx = 0
        
        for i in range(len(data)):
            price = data['close'].iloc[i]
            
            # Long position management
            if long_signals.iloc[i] and not long_pos:
                long_pos = True
                entry_price = price
                entry_idx = i
            elif long_pos:
                profit_pct = (price - entry_price) / entry_price * 100
                
                # Exit conditions
                if (profit_pct >= 2.0 or  # 2% profit target
                    profit_pct <= -1.5 or  # 1.5% stop loss
                    (not pd.isna(data['ma_20'].iloc[i]) and price > data['ma_20'].iloc[i]) or  # Above MA20
                    i - entry_idx >= 12):  # 12 hour time stop
                    long_exits.iloc[i] = True
                    long_pos = False
            
            # Short position management  
            if short_signals.iloc[i] and not short_pos:
                short_pos = True
                entry_price = price
                entry_idx = i
            elif short_pos:
                profit_pct = (entry_price - price) / entry_price * 100
                
                # Exit conditions
                if (profit_pct >= 2.0 or  # 2% profit target
                    profit_pct <= -1.5 or  # 1.5% stop loss
                    (not pd.isna(data['ma_20'].iloc[i]) and price < data['ma_20'].iloc[i]) or  # Below MA20
                    i - entry_idx >= 12):  # 12 hour time stop
                    short_exits.iloc[i] = True
                    short_pos = False
        
        return long_exits, short_exits
    
    def run_backtest(self, data, long_signals, short_signals):
        long_exits, short_exits = self.create_exits(data, long_signals, short_signals)
        
        portfolio = vbt.Portfolio.from_signals(
            close=data['close'],
            entries=long_signals, exits=long_exits,
            short_entries=short_signals, short_exits=short_exits,
            init_cash=10000, fees=0.001, freq='1h'
        )
        return portfolio
    
    def analyze_results(self, portfolio):
        print("\n" + "="*50)
        print("📊 IMPROVED ENGULFING RESULTS")
        print("="*50)
        
        stats = portfolio.stats()
        
        total_return = stats['Total Return [%]']
        total_trades = stats['Total Trades']
        win_rate = stats['Win Rate [%]']
        sharpe_ratio = stats['Sharpe Ratio']
        max_drawdown = stats['Max Drawdown [%]']
        
        print(f"�� Total Return: {total_return:.2f}%")
        print(f"🎯 Win Rate: {win_rate:.1f}%")
        print(f"📊 Total Trades: {total_trades}")
        print(f"⚡ Sharpe Ratio: {sharpe_ratio:.2f}")
        print(f"📉 Max Drawdown: {max_drawdown:.2f}%")
        
        if total_return > 0:
            print("\n✅ IMPROVED: Strategy now shows POSITIVE returns!")
        else:
            print("\n❌ Still negative, but improvements made")
        
        return stats

def main():
    tester = ImprovedEngulfingTest()
    
    print("🕯️ Testing IMPROVED Engulfing Strategy")
    print("Added: Volume filters + Overbought/Oversold + Smart exits")
    
    try:
        data = tester.fetch_test_data('BTCUSDT', 60)
        if data is not None:
            long_signals, short_signals, enhanced_data = tester.detect_patterns(data)
            
            if long_signals.sum() > 0 or short_signals.sum() > 0:
                portfolio = tester.run_backtest(enhanced_data, long_signals, short_signals)
                tester.analyze_results(portfolio)
            else:
                print("❌ No signals found!")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()
