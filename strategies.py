from abc import ABC, abstractmethod
from typing import Dict, Optional, List, Tuple
import pandas as pd
import pandas_ta as ta
import numpy as np
from datetime import datetime
import torch

# Import GPU helper functions
def to_cpu(tensor: torch.Tensor) -> np.ndarray:
    """Convert GPU tensor to numpy array"""
    if torch.is_tensor(tensor):
        return tensor.cpu().numpy()
    return tensor

class BaseStrategy(ABC):
    """Base class for all trading strategies"""
    
    def __init__(self, stop_loss: float = 0.02, take_profit: float = 0.04, position_size: float = 0.2):
        self.stop_loss = stop_loss
        self.take_profit = take_profit
        self.position_size = position_size
        self.use_gpu = False
        
    def calculate_indicators(self, df: pd.DataFrame, gpu_data: Dict = None) -> pd.DataFrame:
        """Calculate technical indicators with optional GPU acceleration"""
        if gpu_data is not None:
            self.use_gpu = True
            return self._calculate_indicators_gpu(df, gpu_data)
        return self._calculate_indicators_cpu(df)
    
    @abstractmethod
    def _calculate_indicators_cpu(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate indicators using CPU"""
        pass
        
    @abstractmethod
    def _calculate_indicators_gpu(self, df: pd.DataFrame, gpu_data: Dict) -> pd.DataFrame:
        """Calculate indicators using GPU"""
        pass
        
    @abstractmethod
    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate trading signals from data"""
        pass

class TrendFollowingStrategy(BaseStrategy):
    """Trend following strategy using moving averages and momentum"""
    
    def _calculate_indicators_cpu(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate indicators using CPU"""
        # Ensure numeric columns are float
        for col in ['high', 'low', 'close', 'volume']:
            df[col] = df[col].astype(float)
            
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
    
    def _calculate_indicators_gpu(self, df: pd.DataFrame, gpu_data: Dict) -> pd.DataFrame:
        """Calculate indicators using GPU"""
        import torch
        import torch.nn.functional as F
        
        # Get data from GPU dict and ensure float32
        high = gpu_data['high'].to(torch.float32)
        low = gpu_data['low'].to(torch.float32)
        close = gpu_data['close'].to(torch.float32)
        volume = gpu_data['volume'].to(torch.float32)
        
        # Calculate EMAs using GPU
        alpha_fast = 2.0 / (8 + 1)
        alpha_slow = 2.0 / (21 + 1)
        
        ema_fast = torch.zeros_like(close, dtype=torch.float32)
        ema_slow = torch.zeros_like(close, dtype=torch.float32)
        
        ema_fast[0] = close[0]
        ema_slow[0] = close[0]
        
        for i in range(1, len(close)):
            ema_fast[i] = alpha_fast * close[i] + (1 - alpha_fast) * ema_fast[i-1]
            ema_slow[i] = alpha_slow * close[i] + (1 - alpha_slow) * ema_slow[i-1]
        
        # Move results back to DataFrame
        df['ema_fast'] = to_cpu(ema_fast).astype(np.float32)
        df['ema_slow'] = to_cpu(ema_slow).astype(np.float32)
        
        # Calculate other indicators on CPU for now
        # (We'll gradually move more calculations to GPU as needed)
        df = self._calculate_indicators_cpu(df)
        
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
    
    def _calculate_indicators_cpu(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate indicators using CPU"""
        # Ensure numeric columns are float
        for col in ['high', 'low', 'close', 'volume']:
            df[col] = df[col].astype(float)
            
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
        
        # Calculate MFI
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
        df['mfi'] = 100 - (100 / (1 + money_ratio))
        df['mfi'] = df['mfi'].fillna(50)
        
        return df
    
    def _calculate_indicators_gpu(self, df: pd.DataFrame, gpu_data: Dict) -> pd.DataFrame:
        """Calculate indicators using GPU"""
        import torch
        import torch.nn.functional as F
        
        # Get data from GPU dict
        high = gpu_data['high']
        low = gpu_data['low']
        close = gpu_data['close']
        volume = gpu_data['volume']
        
        # Calculate Bollinger Bands on GPU
        window = 20
        std_dev = 2
        
        # Calculate rolling mean and std using GPU
        rolling_mean = torch.zeros_like(close)
        rolling_std = torch.zeros_like(close)
        
        for i in range(window-1, len(close)):
            window_data = close[i-window+1:i+1]
            rolling_mean[i] = torch.mean(window_data)
            rolling_std[i] = torch.std(window_data)
        
        upper_band = rolling_mean + (rolling_std * std_dev)
        lower_band = rolling_mean - (rolling_std * std_dev)
        
        # Move results back to DataFrame
        df['bbands_upper'] = to_cpu(upper_band)
        df['bbands_middle'] = to_cpu(rolling_mean)
        df['bbands_lower'] = to_cpu(lower_band)
        df['bbands_width'] = (df['bbands_upper'] - df['bbands_lower']) / df['bbands_middle']
        
        # Calculate other indicators on CPU for now
        df = self._calculate_indicators_cpu(df)
        
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