from typing import Dict, Optional

import pandas as pd
import talib

from strategies.base_strategy import BaseStrategy
from utils.gpu_utils import to_cpu

class TrendFollowingStrategy(BaseStrategy):
    def calculate_indicators(self, df: pd.DataFrame, gpu_data: Optional[Dict] = None) -> None:
        """Calculate technical indicators for trend following strategy"""
        if gpu_data:
            # Calculate EMAs on GPU
            df['ema_short'] = to_cpu(talib.EMA(gpu_data['close'], timeperiod=12))
            df['ema_long'] = to_cpu(talib.EMA(gpu_data['close'], timeperiod=26))
            
            # Calculate ADX on GPU
            df['adx'] = to_cpu(talib.ADX(gpu_data['high'], gpu_data['low'], gpu_data['close'], timeperiod=14))
            
            # Calculate RSI on GPU
            df['rsi'] = to_cpu(talib.RSI(gpu_data['close'], timeperiod=14))
            
            # Calculate Stochastic on GPU
            slowk, slowd = talib.STOCH(gpu_data['high'], gpu_data['low'], gpu_data['close'],
                                     fastk_period=14, slowk_period=3, slowk_matype=0, slowd_period=3, slowd_matype=0)
            df['stoch_k'] = to_cpu(slowk)
            df['stoch_d'] = to_cpu(slowd)
            
            # Calculate MACD on GPU
            macd, signal, hist = talib.MACD(gpu_data['close'], fastperiod=12, slowperiod=26, signalperiod=9)
            df['macd'] = to_cpu(macd)
            df['macd_signal'] = to_cpu(signal)
            df['macd_hist'] = to_cpu(hist)
            
            # Calculate volume indicators on GPU
            df['volume_sma'] = to_cpu(talib.SMA(gpu_data['volume'], timeperiod=20))
            
        else:
            # Calculate EMAs
            df['ema_short'] = talib.EMA(df['close'], timeperiod=12)
            df['ema_long'] = talib.EMA(df['close'], timeperiod=26)
            
            # Calculate ADX
            df['adx'] = talib.ADX(df['high'], df['low'], df['close'], timeperiod=14)
            
            # Calculate RSI
            df['rsi'] = talib.RSI(df['close'], timeperiod=14)
            
            # Calculate Stochastic
            slowk, slowd = talib.STOCH(df['high'], df['low'], df['close'],
                                     fastk_period=14, slowk_period=3, slowk_matype=0, slowd_period=3, slowd_matype=0)
            df['stoch_k'] = slowk
            df['stoch_d'] = slowd
            
            # Calculate MACD
            macd, signal, hist = talib.MACD(df['close'], fastperiod=12, slowperiod=26, signalperiod=9)
            df['macd'] = macd
            df['macd_signal'] = signal
            df['macd_hist'] = hist
            
            # Calculate volume indicators
            df['volume_sma'] = talib.SMA(df['volume'], timeperiod=20)
            
        # Drop NaN values after indicator calculation
        df.dropna(inplace=True)
        
    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate trading signals for trend following strategy"""
        signals = pd.Series(index=df.index, data='HOLD')
        
        # Trend conditions
        uptrend = (df['ema_short'] > df['ema_long']) & (df['adx'] > 20)
        downtrend = (df['ema_short'] < df['ema_long']) & (df['adx'] > 20)
        
        # Momentum conditions
        bullish_momentum = (
            (df['rsi'] > 40) & (df['rsi'] < 75) &  # RSI not overbought/oversold
            ((df['stoch_k'] > df['stoch_d']) | (df['macd'] > df['macd_signal']))  # Either Stochastic or MACD confirms
        )
        
        bearish_momentum = (
            (df['rsi'] < 60) & (df['rsi'] > 25) &  # RSI not overbought/oversold
            ((df['stoch_k'] < df['stoch_d']) | (df['macd'] < df['macd_signal']))  # Either Stochastic or MACD confirms
        )
        
        # Volume confirmation
        volume_confirmation = df['volume'] > df['volume_sma']
        
        # Generate buy signals
        buy_signals = uptrend & bullish_momentum & volume_confirmation
        signals[buy_signals] = 'BUY'
        
        # Generate sell signals
        sell_signals = downtrend & bearish_momentum & volume_confirmation
        signals[sell_signals] = 'SELL'
        
        return signals 