#!/usr/bin/env python3
"""
Mean Reversion Strategy Implementation
Strategy that identifies oversold/overbought conditions and trades the reversion to mean
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


class MeanReversionStrategy(BaseStrategy):
    """Mean reversion strategy using RSI and Bollinger Bands"""
    
    def __init__(self, **kwargs):
        # Default parameters
        defaults = {
            'rsi_period': 14,
            'rsi_oversold': 30,
            'rsi_overbought': 70,
            'bb_period': 20,
            'bb_std_dev': 2.0,
            'volume_confirmation': True,
            'volume_multiplier': 1.2,
            'sl_percent': 2.0,
            'tp_percent': 3.0,
            'trailing_stop_percent': 1.0,
            'position_size_percent': 10.0,
            'min_hold_minutes': 30
        }
        defaults.update(kwargs)
        super().__init__("Mean Reversion", **defaults)
    
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """Generate mean reversion signals"""
        df = self.preprocess_data(df)
        df['signal'] = 'HOLD'
        
        # Extract parameters
        rsi_period = self.parameters['rsi_period']
        rsi_oversold = self.parameters['rsi_oversold']
        rsi_overbought = self.parameters['rsi_overbought']
        bb_period = self.parameters['bb_period']
        bb_std = self.parameters['bb_std_dev']
        vol_mult = self.parameters['volume_multiplier']
        
        # Calculate indicators
        df = self._calculate_indicators(df, rsi_period, bb_period, bb_std)
        
        # Mean reversion conditions
        oversold_condition = (df['rsi'] < rsi_oversold) & (df['close'] <= df['bb_lower'])
        overbought_condition = (df['rsi'] > rsi_overbought) & (df['close'] >= df['bb_upper'])
        
        # Volume confirmation
        if self.parameters['volume_confirmation']:
            volume_confirm = df['volume'] > df['volume_ma'] * vol_mult
            oversold_condition &= volume_confirm
            overbought_condition &= volume_confirm
        
        # Additional filters for quality
        # Avoid extreme market conditions
        not_extreme = (df['rsi'] > 15) & (df['rsi'] < 85)
        
        # Price action confirmation (rejection from extreme levels)
        bullish_rejection = (df['low'] <= df['bb_lower']) & (df['close'] > df['low'] + (df['high'] - df['low']) * 0.5)
        bearish_rejection = (df['high'] >= df['bb_upper']) & (df['close'] < df['high'] - (df['high'] - df['low']) * 0.5)
        
        # Generate signals
        df.loc[oversold_condition & not_extreme & bullish_rejection, 'signal'] = 'LONG'
        df.loc[overbought_condition & not_extreme & bearish_rejection, 'signal'] = 'SHORT'
        
        return df
    
    def _calculate_indicators(self, df: pd.DataFrame, rsi_period: int, bb_period: int, bb_std: float) -> pd.DataFrame:
        """Calculate technical indicators"""
        # RSI
        df['rsi'] = self._calculate_rsi(df['close'], rsi_period)
        
        # Bollinger Bands
        df['bb_middle'] = df['close'].rolling(window=bb_period).mean()
        bb_std_calc = df['close'].rolling(window=bb_period).std()
        df['bb_upper'] = df['bb_middle'] + (bb_std_calc * bb_std)
        df['bb_lower'] = df['bb_middle'] - (bb_std_calc * bb_std)
        
        # Volume analysis
        df['volume_ma'] = df['volume'].rolling(window=20).mean()
        
        # Price position within Bollinger Bands
        df['bb_position'] = (df['close'] - df['bb_lower']) / (df['bb_upper'] - df['bb_lower'])
        
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
            'rsi_period': Integer(10, 21, name='rsi_period'),
            'rsi_oversold': Real(20, 35, name='rsi_oversold'),
            'rsi_overbought': Real(65, 80, name='rsi_overbought'),
            'bb_period': Integer(15, 25, name='bb_period'),
            'bb_std_dev': Real(1.5, 2.5, name='bb_std_dev'),
            'volume_multiplier': Real(1.0, 2.0, name='volume_multiplier'),
            'sl_percent': Real(1.0, 3.5, name='sl_percent'),
            'tp_percent': Real(2.0, 5.0, name='tp_percent'),
            'trailing_stop_percent': Real(0.5, 2.5, name='trailing_stop_percent'),
            'position_size_percent': Real(5.0, 20.0, name='position_size_percent'),
            'min_hold_minutes': Integer(15, 90, name='min_hold_minutes')
        }
    
    def get_display_name(self) -> str:
        return f"MeanRev (RSI:{self.parameters['rsi_period']}, BB:{self.parameters['bb_period']}, T:{self.parameters['trailing_stop_percent']:.1f}%)" 