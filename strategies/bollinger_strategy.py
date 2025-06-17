#!/usr/bin/env python3
"""
Bollinger Bands Strategy Implementation
Strategy based on Bollinger Band squeezes, expansions and volatility analysis
"""

import pandas as pd
import numpy as np
from .base_strategy import BaseStrategy
from typing import Dict
try:
    from skopt.space import Real, Integer
except ImportError:
    print("Warning: scikit-optimize not installed. Install with: pip install scikit-optimize")
    Real = Integer = None


class BollingerStrategy(BaseStrategy):
    """Bollinger Bands strategy with volatility and squeeze detection"""
    
    def __init__(self, **kwargs):
        # Default parameters
        defaults = {
            'bb_period': 20,
            'bb_std_dev': 2.0,
            'squeeze_threshold': 0.1,
            'expansion_threshold': 0.25,
            'volume_multiplier': 1.4,
            'rsi_period': 14,
            'rsi_neutral_low': 40,
            'rsi_neutral_high': 60,
            'volatility_period': 10,
            'min_volatility': 0.5,
            'sl_percent': 2.3,
            'tp_percent': 3.8,
            'trailing_stop_percent': 1.3,
            'position_size_percent': 10.0,
            'min_hold_minutes': 25
        }
        defaults.update(kwargs)
        super().__init__("Bollinger Bands", **defaults)
    
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """Generate Bollinger Bands signals"""
        df = self.preprocess_data(df)
        df['signal'] = 'HOLD'
        
        # Extract parameters
        bb_period = self.parameters['bb_period']
        bb_std = self.parameters['bb_std_dev']
        squeeze_threshold = self.parameters['squeeze_threshold']
        expansion_threshold = self.parameters['expansion_threshold']
        vol_mult = self.parameters['volume_multiplier']
        rsi_period = self.parameters['rsi_period']
        rsi_low = self.parameters['rsi_neutral_low']
        rsi_high = self.parameters['rsi_neutral_high']
        volatility_period = self.parameters['volatility_period']
        min_volatility = self.parameters['min_volatility']
        
        # Calculate indicators
        df = self._calculate_indicators(df, bb_period, bb_std, rsi_period, volatility_period)
        
        # Squeeze and expansion detection
        squeeze_condition = df['bb_bandwidth'] < squeeze_threshold
        expansion_condition = df['bb_bandwidth'] > expansion_threshold
        expanding_from_squeeze = (df['bb_bandwidth'] > df['bb_bandwidth'].shift(1)) & squeeze_condition.shift(1)
        
        # Price position and momentum
        price_near_lower = df['bb_position'] < 0.2
        price_near_upper = df['bb_position'] > 0.8
        price_middle_zone = (df['bb_position'] >= 0.3) & (df['bb_position'] <= 0.7)
        
        # Volatility conditions
        sufficient_volatility = df['volatility'] > min_volatility
        
        # Volume confirmation
        volume_confirm = df['volume'] > df['volume_ma'] * vol_mult
        
        # RSI conditions (avoid extreme overbought/oversold)
        rsi_neutral = (df['rsi'] >= rsi_low) & (df['rsi'] <= rsi_high)
        
        # Momentum direction
        price_momentum_up = (df['close'] > df['close'].shift(2)) & (df['ema_short'] > df['ema_short'].shift(1))
        price_momentum_down = (df['close'] < df['close'].shift(2)) & (df['ema_short'] < df['ema_short'].shift(1))
        
        # Strategy 1: Squeeze breakout
        bullish_breakout = (expanding_from_squeeze & (df['close'] > df['bb_middle']) & 
                           price_momentum_up & volume_confirm & rsi_neutral & sufficient_volatility)
        bearish_breakout = (expanding_from_squeeze & (df['close'] < df['bb_middle']) & 
                           price_momentum_down & volume_confirm & rsi_neutral & sufficient_volatility)
        
        # Strategy 2: Mean reversion from bands
        bullish_reversion = (price_near_lower & (df['close'] > df['low'].shift(1)) & 
                            ~expansion_condition & volume_confirm & (df['rsi'] < 35))
        bearish_reversion = (price_near_upper & (df['close'] < df['high'].shift(1)) & 
                            ~expansion_condition & volume_confirm & (df['rsi'] > 65))
        
        # Strategy 3: Trend continuation on band walks
        bullish_trend = (expansion_condition & (df['bb_position'] > 0.7) & 
                        price_momentum_up & (df['close'] > df['ema_long']) & volume_confirm)
        bearish_trend = (expansion_condition & (df['bb_position'] < 0.3) & 
                        price_momentum_down & (df['close'] < df['ema_long']) & volume_confirm)
        
        # Generate signals (prioritize breakouts, then reversions, then trends)
        df.loc[bullish_breakout | bullish_reversion | bullish_trend, 'signal'] = 'LONG'
        df.loc[bearish_breakout | bearish_reversion | bearish_trend, 'signal'] = 'SHORT'
        
        return df
    
    def _calculate_indicators(self, df: pd.DataFrame, bb_period: int, bb_std: float, 
                             rsi_period: int, volatility_period: int) -> pd.DataFrame:
        """Calculate technical indicators"""
        # Bollinger Bands
        df['bb_middle'] = df['close'].rolling(window=bb_period).mean()
        bb_std_calc = df['close'].rolling(window=bb_period).std()
        df['bb_upper'] = df['bb_middle'] + (bb_std_calc * bb_std)
        df['bb_lower'] = df['bb_middle'] - (bb_std_calc * bb_std)
        
        # Bollinger Band analysis
        df['bb_bandwidth'] = (df['bb_upper'] - df['bb_lower']) / df['bb_middle']
        df['bb_position'] = (df['close'] - df['bb_lower']) / (df['bb_upper'] - df['bb_lower'])
        
        # EMAs for trend analysis
        df['ema_short'] = df['close'].ewm(span=9).mean()
        df['ema_long'] = df['close'].ewm(span=21).mean()
        
        # Volume analysis
        df['volume_ma'] = df['volume'].rolling(window=20).mean()
        
        # RSI
        df['rsi'] = self._calculate_rsi(df['close'], rsi_period)
        
        # Volatility (ATR-like)
        df['high_low'] = df['high'] - df['low']
        df['high_close'] = abs(df['high'] - df['close'].shift(1))
        df['low_close'] = abs(df['low'] - df['close'].shift(1))
        df['true_range'] = df[['high_low', 'high_close', 'low_close']].max(axis=1)
        df['volatility'] = df['true_range'].rolling(window=volatility_period).mean() / df['close'] * 100
        
        # Price momentum
        df['momentum_3'] = ((df['close'] / df['close'].shift(3)) - 1) * 100
        df['momentum_5'] = ((df['close'] / df['close'].shift(5)) - 1) * 100
        
        return df
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        """Calculate RSI indicator"""
        delta = prices.diff()
        gain = delta.where(delta > 0, 0).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))
    
    def get_parameter_space(self) -> Dict:
        """Return parameter space for Bayesian optimization"""
        return {
            'bb_period': Integer(15, 25, name='bb_period'),
            'bb_std_dev': Real(1.6, 2.6, name='bb_std_dev'),
            'squeeze_threshold': Real(0.05, 0.2, name='squeeze_threshold'),
            'expansion_threshold': Real(0.15, 0.4, name='expansion_threshold'),
            'volume_multiplier': Real(1.1, 2.0, name='volume_multiplier'),
            'rsi_period': Integer(10, 20, name='rsi_period'),
            'rsi_neutral_low': Real(30, 45, name='rsi_neutral_low'),
            'rsi_neutral_high': Real(55, 70, name='rsi_neutral_high'),
            'volatility_period': Integer(5, 15, name='volatility_period'),
            'min_volatility': Real(0.3, 1.2, name='min_volatility'),
            'sl_percent': Real(1.5, 4.0, name='sl_percent'),
            'tp_percent': Real(2.8, 6.5, name='tp_percent'),
            'trailing_stop_percent': Real(0.7, 3.0, name='trailing_stop_percent'),
            'position_size_percent': Real(5.0, 20.0, name='position_size_percent'),
            'min_hold_minutes': Integer(15, 75, name='min_hold_minutes')
        }
    
    def get_display_name(self) -> str:
        return f"Bollinger (BB:{self.parameters['bb_period']}, Std:{self.parameters['bb_std_dev']:.1f}, T:{self.parameters['trailing_stop_percent']:.1f}%)" 