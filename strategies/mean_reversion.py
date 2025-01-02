from typing import Dict, Optional
import time

import pandas as pd
import talib

from strategies.base_strategy import BaseStrategy
from utils.gpu_utils import to_cpu

class MeanReversionStrategy(BaseStrategy):
    def __init__(self):
        super().__init__()
        self.last_trade_time = 0
        self.min_trade_interval = 10  # Minimum seconds between trades
        self.min_hold_time = 15  # Minimum seconds to hold a position
        self.position_entry_time = 0
        
    def calculate_indicators(self, df: pd.DataFrame, gpu_data: Optional[Dict] = None) -> None:
        """Calculate technical indicators for mean reversion strategy"""
        if gpu_data:
            # Calculate Bollinger Bands on GPU
            df['bb_middle'] = to_cpu(talib.SMA(gpu_data['close'], timeperiod=10))  # Faster period
            df['bb_upper'] = df['bb_middle'] + 1.5 * to_cpu(talib.STDDEV(gpu_data['close'], timeperiod=10))  # Less deviation
            df['bb_lower'] = df['bb_middle'] - 1.5 * to_cpu(talib.STDDEV(gpu_data['close'], timeperiod=10))
            
            # Calculate RSI on GPU
            df['rsi'] = to_cpu(talib.RSI(gpu_data['close'], timeperiod=7))  # Faster period
            
            # Calculate CCI on GPU
            df['cci'] = to_cpu(talib.CCI(gpu_data['high'], gpu_data['low'], gpu_data['close'], timeperiod=10))
            
            # Calculate volume indicators on GPU
            df['volume_sma'] = to_cpu(talib.SMA(gpu_data['volume'], timeperiod=10))
            
        else:
            # Calculate Bollinger Bands
            df['bb_middle'] = talib.SMA(df['close'], timeperiod=10)
            df['bb_upper'] = df['bb_middle'] + 1.5 * talib.STDDEV(df['close'], timeperiod=10)
            df['bb_lower'] = df['bb_middle'] - 1.5 * talib.STDDEV(df['close'], timeperiod=10)
            
            # Calculate RSI
            df['rsi'] = talib.RSI(df['close'], timeperiod=7)
            
            # Calculate CCI
            df['cci'] = talib.CCI(df['high'], df['low'], df['close'], timeperiod=10)
            
            # Calculate volume indicators
            df['volume_sma'] = talib.SMA(df['volume'], timeperiod=10)
            
        # Drop NaN values after indicator calculation
        df.dropna(inplace=True)
        
    def generate_signals(self, df: pd.DataFrame, current_position: str = 'FLAT', current_price: float = None) -> str:
        """Generate trading signals for mean reversion strategy"""
        if len(df) < 10:  # Need at least 10 candles for indicators
            return 'HOLD'
            
        # Get the latest indicators
        latest = df.iloc[-1]
        current_time = time.time()
        
        # Check trade interval
        if current_time - self.last_trade_time < self.min_trade_interval:
            return 'HOLD'
            
        # Check hold time for existing positions
        if current_position != 'FLAT' and current_time - self.position_entry_time < self.min_hold_time:
            return 'HOLD'
        
        # Oversold conditions (buy signals)
        oversold = (
            (latest['close'] < latest['bb_lower']) and  # Price below lower BB
            (latest['rsi'] < 35) and  # Less extreme RSI
            (latest['cci'] < -80) and  # Less extreme CCI
            (latest['volume'] > latest['volume_sma'])  # Above average volume
        )
        
        # Overbought conditions (sell signals)
        overbought = (
            (latest['close'] > latest['bb_upper']) and  # Price above upper BB
            (latest['rsi'] > 65) and  # Less extreme RSI
            (latest['cci'] > 80) and  # Less extreme CCI
            (latest['volume'] > latest['volume_sma'])  # Above average volume
        )
        
        # Generate signals based on conditions and current position
        signal = 'HOLD'
        if current_position == 'FLAT':
            if oversold:
                signal = 'BUY'
                self.last_trade_time = current_time
                self.position_entry_time = current_time
            elif overbought:
                signal = 'SELL'
                self.last_trade_time = current_time
                self.position_entry_time = current_time
        elif current_position == 'LONG':
            if overbought:
                signal = 'CLOSE'
                self.last_trade_time = current_time
        elif current_position == 'SHORT':
            if oversold:
                signal = 'CLOSE'
                self.last_trade_time = current_time
                
        return signal 