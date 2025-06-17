#!/usr/bin/env python3
"""
EMA Crossover Strategy Implementation
Trend-following strategy using multiple EMA crossovers with volume and momentum confirmation
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


class EMACrossoverStrategy(BaseStrategy):
    """EMA crossover strategy with trend and momentum filters"""
    
    def __init__(self, **kwargs):
        # Default parameters
        defaults = {
            'ema_fast': 9,
            'ema_slow': 21,
            'ema_trend': 50,
            'volume_multiplier': 1.3,
            'momentum_period': 10,
            'momentum_threshold': 0.5,
            'min_trend_strength': 0.2,
            'sl_percent': 2.2,
            'tp_percent': 3.5,
            'trailing_stop_percent': 1.2,
            'position_size_percent': 10.0,
            'min_hold_minutes': 20
        }
        defaults.update(kwargs)
        super().__init__("EMA Crossover", **defaults)
    
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """Generate EMA crossover signals"""
        df = self.preprocess_data(df)
        df['signal'] = 'HOLD'
        
        # Extract parameters
        ema_fast = self.parameters['ema_fast']
        ema_slow = self.parameters['ema_slow']
        ema_trend = self.parameters['ema_trend']
        vol_mult = self.parameters['volume_multiplier']
        momentum_period = self.parameters['momentum_period']
        momentum_threshold = self.parameters['momentum_threshold']
        min_trend_strength = self.parameters['min_trend_strength']
        
        # Calculate indicators
        df = self._calculate_indicators(df, ema_fast, ema_slow, ema_trend, momentum_period)
        
        # EMA crossover conditions
        bullish_crossover = (df['ema_fast'] > df['ema_slow']) & (df['ema_fast'].shift(1) <= df['ema_slow'].shift(1))
        bearish_crossover = (df['ema_fast'] < df['ema_slow']) & (df['ema_fast'].shift(1) >= df['ema_slow'].shift(1))
        
        # Trend confirmation
        bullish_trend = (df['ema_slow'] > df['ema_trend']) & (df['trend_strength'] > min_trend_strength)
        bearish_trend = (df['ema_slow'] < df['ema_trend']) & (df['trend_strength'] > min_trend_strength)
        
        # Volume confirmation
        volume_confirm = df['volume'] > df['volume_ma'] * vol_mult
        
        # Momentum confirmation
        bullish_momentum = df['momentum'] > momentum_threshold
        bearish_momentum = df['momentum'] < -momentum_threshold
        
        # Price action confirmation
        price_above_fast_ema = df['close'] > df['ema_fast']
        price_below_fast_ema = df['close'] < df['ema_fast']
        
        # Additional filters
        not_overbought = df['rsi'] < 75
        not_oversold = df['rsi'] > 25
        
        # Generate signals
        long_condition = (bullish_crossover & bullish_trend & volume_confirm & 
                         bullish_momentum & price_above_fast_ema & not_overbought)
        short_condition = (bearish_crossover & bearish_trend & volume_confirm & 
                          bearish_momentum & price_below_fast_ema & not_oversold)
        
        df.loc[long_condition, 'signal'] = 'LONG'
        df.loc[short_condition, 'signal'] = 'SHORT'
        
        return df
    
    def _calculate_indicators(self, df: pd.DataFrame, ema_fast: int, ema_slow: int, 
                             ema_trend: int, momentum_period: int) -> pd.DataFrame:
        """Calculate technical indicators"""
        # EMAs
        df['ema_fast'] = df['close'].ewm(span=ema_fast).mean()
        df['ema_slow'] = df['close'].ewm(span=ema_slow).mean()
        df['ema_trend'] = df['close'].ewm(span=ema_trend).mean()
        
        # Volume analysis
        df['volume_ma'] = df['volume'].rolling(window=20).mean()
        
        # Momentum (rate of change)
        df['momentum'] = ((df['close'] / df['close'].shift(momentum_period)) - 1) * 100
        
        # Trend strength (distance between EMAs)
        df['trend_strength'] = abs(df['ema_slow'] - df['ema_trend']) / df['ema_trend'] * 100
        
        # RSI for additional filtering
        df['rsi'] = self._calculate_rsi(df['close'])
        
        # EMA spread (for signal quality)
        df['ema_spread'] = abs(df['ema_fast'] - df['ema_slow']) / df['ema_slow'] * 100
        
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
            'ema_fast': Integer(5, 15, name='ema_fast'),
            'ema_slow': Integer(16, 30, name='ema_slow'),
            'ema_trend': Integer(35, 70, name='ema_trend'),
            'volume_multiplier': Real(1.0, 2.2, name='volume_multiplier'),
            'momentum_period': Integer(5, 20, name='momentum_period'),
            'momentum_threshold': Real(0.2, 1.5, name='momentum_threshold'),
            'min_trend_strength': Real(0.1, 0.8, name='min_trend_strength'),
            'sl_percent': Real(1.2, 4.0, name='sl_percent'),
            'tp_percent': Real(2.5, 6.0, name='tp_percent'),
            'trailing_stop_percent': Real(0.6, 2.8, name='trailing_stop_percent'),
            'position_size_percent': Real(5.0, 20.0, name='position_size_percent'),
            'min_hold_minutes': Integer(10, 60, name='min_hold_minutes')
        }
    
    def get_display_name(self) -> str:
        return f"EMA Cross ({self.parameters['ema_fast']}/{self.parameters['ema_slow']}/{self.parameters['ema_trend']}, T:{self.parameters['trailing_stop_percent']:.1f}%)" 