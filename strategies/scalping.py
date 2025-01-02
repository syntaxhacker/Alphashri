import time
import pandas as pd
import numpy as np
from typing import Optional, Dict
import talib
from strategies.base_strategy import BaseStrategy
from utils.gpu_utils import to_cpu

class ScalpingStrategy(BaseStrategy):
    def __init__(self):
        super().__init__()
        # Override base parameters for ultra-aggressive scalping
        self.min_trade_interval = 1  # 1 second between trades
        self.max_trade_duration = 15  # 15 seconds max hold time
        self.stop_loss = 0.002  # 0.2%
        self.take_profit = 0.004  # 0.4%
        self.max_spread_pct = 0.02  # 2% - Allow higher spreads
        self.min_data_points = 2  # Need only 2 data points
        self.leverage = 10  # Use 10x leverage
        
    def calculate_indicators(self, df: pd.DataFrame, gpu_data: Optional[Dict] = None) -> None:
        """Calculate technical indicators optimized for 1-minute scalping"""
        if len(df) < self.min_data_points:
            return
            
        if gpu_data:
            # Faster EMA crossover
            df['ema_2'] = to_cpu(talib.EMA(gpu_data['close'], timeperiod=2))
            df['ema_5'] = to_cpu(talib.EMA(gpu_data['close'], timeperiod=5))
            
            # RSI for momentum
            df['rsi'] = to_cpu(talib.RSI(gpu_data['close'], timeperiod=4))
            
            # Fast Stochastic for overbought/oversold
            fastk, fastd = talib.STOCHF(gpu_data['high'], gpu_data['low'], gpu_data['close'], 
                                      fastk_period=2, fastd_period=2)
            df['stoch_k'] = to_cpu(fastk)
            df['stoch_d'] = to_cpu(fastd)
            
            # Volume indicators
            df['volume_sma'] = to_cpu(talib.SMA(gpu_data['volume'], timeperiod=2))
            df['volume_ratio'] = gpu_data['volume'] / df['volume_sma']
            
        else:
            # Faster EMA crossover
            df['ema_2'] = talib.EMA(df['close'], timeperiod=2)
            df['ema_5'] = talib.EMA(df['close'], timeperiod=5)
            
            # RSI for momentum
            df['rsi'] = talib.RSI(df['close'], timeperiod=4)
            
            # Fast Stochastic for overbought/oversold
            fastk, fastd = talib.STOCHF(df['high'], df['low'], df['close'], 
                                      fastk_period=2, fastd_period=2)
            df['stoch_k'] = fastk
            df['stoch_d'] = fastd
            
            # Volume indicators
            df['volume_sma'] = talib.SMA(df['volume'], timeperiod=2)
            df['volume_ratio'] = df['volume'] / df['volume_sma']
        
        # Calculate price momentum and volatility
        df['momentum'] = df['close'].pct_change(periods=1)
        df['volatility'] = df['close'].pct_change().rolling(window=2).std()
        
    def generate_signals(self, df: pd.DataFrame, current_position: str = 'FLAT', 
                        current_price: float = None, current_bid: float = None, 
                        current_ask: float = None) -> str:
        """Generate trading signals for ultra-fast scalping strategy"""
        if len(df) < self.min_data_points:
            return 'HOLD'
            
        # Get latest indicators
        latest = df.iloc[-1]
        prev = df.iloc[-2] if len(df) > 1 else latest
        
        # Core signal generation
        signal = 'HOLD'
        
        # Ultra-aggressive long entry conditions
        long_signal = (
            latest['ema_2'] > latest['ema_5'] or  # Either trend
            (latest['rsi'] < 40 and latest['stoch_k'] > latest['stoch_d'])  # Or oversold bounce
        )
        
        # Ultra-aggressive short entry conditions
        short_signal = (
            latest['ema_2'] < latest['ema_5'] or  # Either trend
            (latest['rsi'] > 60 and latest['stoch_k'] < latest['stoch_d'])  # Or overbought drop
        )
        
        # Position management with quick exits
        if current_position == 'FLAT':
            if long_signal:
                signal = 'BUY'
            elif short_signal:
                signal = 'SELL'
                
        elif current_position == 'LONG':
            if current_price and self.entry_price:
                price_change = (current_price - self.entry_price) / self.entry_price
                if price_change <= -self.stop_loss or price_change >= self.take_profit:
                    signal = 'CLOSE'
                    
        elif current_position == 'SHORT':
            if current_price and self.entry_price:
                price_change = (self.entry_price - current_price) / self.entry_price
                if price_change <= -self.stop_loss or price_change >= self.take_profit:
                    signal = 'CLOSE'
                    
        return signal 