from abc import ABC, abstractmethod
from typing import Dict, Optional, List, Tuple
import pandas as pd
import pandas_ta as ta
import numpy as np
from datetime import datetime

class BaseStrategy(ABC):
    """Base class for all trading strategies"""
    
    def __init__(self, stop_loss: float = 0.02, take_profit: float = 0.04, position_size: float = 0.2):
        self.stop_loss = stop_loss
        self.take_profit = take_profit
        self.position_size = position_size
        
    @abstractmethod
    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate trading signals from data"""
        pass
        
    @abstractmethod
    def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate technical indicators needed for the strategy"""
        pass

class TrendFollowingStrategy(BaseStrategy):
    """Trend following strategy using moving averages and momentum"""
    
    def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate technical indicators for trend following"""
        # Trend indicators
        df['ema_fast'] = ta.ema(df['close'], length=8)
        df['ema_slow'] = ta.ema(df['close'], length=21)
        df['sma_50'] = ta.sma(df['close'], length=50)
        df['sma_200'] = ta.sma(df['close'], length=200)
        df['adx'] = ta.adx(df['high'], df['low'], df['close'])['ADX_14']
        
        # Momentum indicators
        df['rsi'] = ta.rsi(df['close'], length=14)
        stoch = ta.stoch(df['high'], df['low'], df['close'])
        df['stoch_k'] = stoch['STOCHk_14_3_3']
        df['stoch_d'] = stoch['STOCHd_14_3_3']
        macd = ta.macd(df['close'])
        df['macd'] = macd['MACD_12_26_9']
        df['macd_signal'] = macd['MACDs_12_26_9']
        df['macd_hist'] = macd['MACDh_12_26_9']
        
        # Market regime
        df['regime'] = np.where(
            (df['sma_50'] > df['sma_200']) & (df['adx'] > 25),
            'UPTREND',
            np.where(
                (df['sma_50'] < df['sma_200']) & (df['adx'] > 25),
                'DOWNTREND',
                'SIDEWAYS'
            )
        )
        
        return df
    
    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate trading signals based on trend following rules"""
        signals = pd.Series(index=df.index, data='HOLD')
        
        for i in range(len(df)):
            if i < 200:  # Skip until we have enough data
                continue
                
            # Check market regime
            if df['regime'].iloc[i] == 'DOWNTREND' and df['adx'].iloc[i] > 30:
                signals.iloc[i] = 'HOLD'
                continue
            
            # Entry conditions
            trend_condition = (
                df['ema_fast'].iloc[i] > df['ema_slow'].iloc[i] or
                df['close'].iloc[i] > df['sma_50'].iloc[i]
            )
            
            momentum_condition = (
                df['rsi'].iloc[i] < 45 or
                df['stoch_k'].iloc[i] < df['stoch_d'].iloc[i] or
                df['macd_hist'].iloc[i] > df['macd_hist'].iloc[i-1]
            )
            
            # Exit conditions
            exit_condition = (
                df['rsi'].iloc[i] > 75 or
                (df['stoch_k'].iloc[i] > 85 and df['stoch_k'].iloc[i] < df['stoch_k'].iloc[i-1]) or
                (df['macd'].iloc[i] < df['macd_signal'].iloc[i] and df['macd_hist'].iloc[i] < 0) or
                df['ema_fast'].iloc[i] < df['ema_slow'].iloc[i]
            )
            
            if trend_condition and momentum_condition:
                signals.iloc[i] = 'BUY'
            elif exit_condition:
                signals.iloc[i] = 'SELL'
                
        return signals

class MeanReversionStrategy(BaseStrategy):
    """Mean reversion strategy using Bollinger Bands and RSI"""
    
    def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate technical indicators for mean reversion"""
        # Debug logging
        print(f"\nDataFrame info before type conversion:")
        print(df.dtypes)
        print("\nSample of data:")
        print(df.head())
        
        # Ensure numeric columns are float
        for col in ['high', 'low', 'close', 'volume']:
            df[col] = df[col].astype(float)
            print(f"\n{col} dtype after conversion: {df[col].dtype}")
            print(f"{col} sample values: {df[col].head()}")
            
        # Volatility indicators
        df['atr'] = ta.atr(df['high'], df['low'], df['close'])
        bbands = ta.bbands(df['close'], length=20, std=2)
        df['bbands_upper'] = bbands['BBU_20_2.0']
        df['bbands_middle'] = bbands['BBM_20_2.0']
        df['bbands_lower'] = bbands['BBL_20_2.0']
        df['bbands_width'] = (df['bbands_upper'] - df['bbands_lower']) / df['bbands_middle']
        
        # Momentum and volume
        df['rsi'] = ta.rsi(df['close'], length=14)
        df['obv'] = ta.obv(df['close'], df['volume'])
        
        print("\nBefore MFI calculation:")
        print("High dtype:", df['high'].dtype)
        print("Low dtype:", df['low'].dtype)
        print("Close dtype:", df['close'].dtype)
        print("Volume dtype:", df['volume'].dtype)
        
        # Fix MFI calculation by ensuring float type and handling NaN values
        df['high'] = df['high'].astype(float)
        df['low'] = df['low'].astype(float)
        df['close'] = df['close'].astype(float)
        df['volume'] = df['volume'].astype(float)
        
        # Check for NaN values
        print("\nNaN values in data:")
        print(df[['high', 'low', 'close', 'volume']].isna().sum())
        
        # Calculate MFI with proper type handling
        try:
            # Create money flow
            typical_price = (df['high'] + df['low'] + df['close']) / 3
            money_flow = typical_price * df['volume']
            
            # Calculate positive and negative money flow
            positive_flow = money_flow.where(typical_price > typical_price.shift(1), 0.0)
            negative_flow = money_flow.where(typical_price < typical_price.shift(1), 0.0)
            
            # Calculate money flow ratio
            period = 14  # Standard MFI period
            positive_mf = positive_flow.rolling(window=period).sum()
            negative_mf = negative_flow.rolling(window=period).sum()
            
            # Avoid division by zero
            money_ratio = positive_mf / negative_mf.replace(0, float('nan'))
            
            # Calculate MFI
            mfi = 100 - (100 / (1 + money_ratio))
            
            # Handle NaN values
            mfi = mfi.fillna(50)  # Fill NaN with neutral value
            df['mfi'] = mfi
            
            print("\nCustom MFI calculation successful")
            print("MFI sample values:", df['mfi'].head())
            
        except Exception as e:
            print(f"\nError in MFI calculation: {str(e)}")
            print("Data causing error:")
            print(df[['high', 'low', 'close', 'volume']].head())
            # Set neutral MFI value in case of error
            df['mfi'] = 50
        
        # VWAP
        df['typical_price'] = (df['high'] + df['low'] + df['close']) / 3
        df['price_volume'] = df['typical_price'] * df['volume']
        df['cumulative_volume'] = df['volume'].rolling(window=20).sum()
        df['cumulative_pv'] = df['price_volume'].rolling(window=20).sum()
        df['vwap'] = df['cumulative_pv'] / df['cumulative_volume']
        
        return df
    
    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate trading signals based on mean reversion rules"""
        signals = pd.Series(index=df.index, data='HOLD')
        
        for i in range(len(df)):
            if i < 20:  # Skip until we have enough data
                continue
            
            # Entry conditions
            oversold_condition = (
                df['close'].iloc[i] < df['bbands_lower'].iloc[i] and
                df['rsi'].iloc[i] < 30 and
                df['mfi'].iloc[i] < 20
            )
            
            # Volume confirmation
            volume_condition = (
                df['obv'].iloc[i] > df['obv'].iloc[i-1] or
                df['volume'].iloc[i] > df['volume'].iloc[i-1]
            )
            
            # Exit conditions
            overbought_condition = (
                df['close'].iloc[i] > df['bbands_upper'].iloc[i] or
                df['rsi'].iloc[i] > 70 or
                df['mfi'].iloc[i] > 80
            )
            
            if oversold_condition and volume_condition:
                signals.iloc[i] = 'BUY'
            elif overbought_condition:
                signals.iloc[i] = 'SELL'
                
        return signals

class StrategyFactory:
    """Factory class for creating strategy instances"""
    
    @staticmethod
    def create_strategy(strategy_name: str, **kwargs) -> BaseStrategy:
        """Create a strategy instance by name"""
        strategies = {
            'trend_following': TrendFollowingStrategy,
            'mean_reversion': MeanReversionStrategy
        }
        
        if strategy_name not in strategies:
            raise ValueError(f"Unknown strategy: {strategy_name}")
            
        return strategies[strategy_name](**kwargs) 