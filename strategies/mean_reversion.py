from typing import Dict, Optional

import pandas as pd
import talib

from strategies.base_strategy import BaseStrategy
from utils.gpu_utils import to_cpu

class MeanReversionStrategy(BaseStrategy):
    def calculate_indicators(self, df: pd.DataFrame, gpu_data: Optional[Dict] = None) -> None:
        """Calculate technical indicators for mean reversion strategy"""
        if gpu_data:
            # Calculate Bollinger Bands on GPU
            df['bb_middle'] = to_cpu(talib.SMA(gpu_data['close'], timeperiod=20))
            df['bb_upper'] = df['bb_middle'] + 2 * to_cpu(talib.STDDEV(gpu_data['close'], timeperiod=20))
            df['bb_lower'] = df['bb_middle'] - 2 * to_cpu(talib.STDDEV(gpu_data['close'], timeperiod=20))
            
            # Calculate RSI on GPU
            df['rsi'] = to_cpu(talib.RSI(gpu_data['close'], timeperiod=14))
            
            # Calculate CCI on GPU
            df['cci'] = to_cpu(talib.CCI(gpu_data['high'], gpu_data['low'], gpu_data['close'], timeperiod=20))
            
            # Calculate volume indicators on GPU
            df['volume_sma'] = to_cpu(talib.SMA(gpu_data['volume'], timeperiod=20))
            
        else:
            # Calculate Bollinger Bands
            df['bb_middle'] = talib.SMA(df['close'], timeperiod=20)
            df['bb_upper'] = df['bb_middle'] + 2 * talib.STDDEV(df['close'], timeperiod=20)
            df['bb_lower'] = df['bb_middle'] - 2 * talib.STDDEV(df['close'], timeperiod=20)
            
            # Calculate RSI
            df['rsi'] = talib.RSI(df['close'], timeperiod=14)
            
            # Calculate CCI
            df['cci'] = talib.CCI(df['high'], df['low'], df['close'], timeperiod=20)
            
            # Calculate volume indicators
            df['volume_sma'] = talib.SMA(df['volume'], timeperiod=20)
            
        # Drop NaN values after indicator calculation
        df.dropna(inplace=True)
        
    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate trading signals for mean reversion strategy"""
        signals = pd.Series(index=df.index, data='HOLD')
        
        # Oversold conditions (buy signals)
        oversold = (
            (df['close'] < df['bb_lower']) &  # Price below lower Bollinger Band
            (df['rsi'] < 30) &  # RSI oversold
            (df['cci'] < -100) &  # CCI oversold
            (df['volume'] > df['volume_sma'])  # Above average volume
        )
        signals[oversold] = 'BUY'
        
        # Overbought conditions (sell signals)
        overbought = (
            (df['close'] > df['bb_upper']) &  # Price above upper Bollinger Band
            (df['rsi'] > 70) &  # RSI overbought
            (df['cci'] > 100) &  # CCI overbought
            (df['volume'] > df['volume_sma'])  # Above average volume
        )
        signals[overbought] = 'SELL'
        
        return signals 