#!/usr/bin/env python3
"""
BarUpDn Strategy Implementation
Pattern-based reversal strategy with volume and trend filters
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


class BarUpDnStrategy(BaseStrategy):
    """Enhanced BarUpDn pattern strategy"""
    
    def __init__(self, **kwargs):
        # Default parameters  
        defaults = {
            'sl_percent': 3.0,
            'trailing_stop_percent': 1.5,
            'position_size_percent': 10.0,
            'max_intraday_loss_percent': 2.0,
            'min_hold_minutes': 60,
            'volume_threshold_multiplier': 1.5,
            'min_body_size_percent': 0.15,
            'use_volume_filter': True,
            'use_trend_filter': True
        }
        defaults.update(kwargs)
        super().__init__("BarUpDn Enhanced", **defaults)
    
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """Generate enhanced BarUpDn signals"""
        df = self.preprocess_data(df)
        df['signal'] = 'HOLD'
        
        # Calculate indicators
        df = self._calculate_indicators(df)
        
        # Pattern detection
        barupdn_pattern = self._detect_barupdn_pattern(df)
        bardnup_pattern = self._detect_bardnup_pattern(df)
        
        # Apply filters
        filters = self._apply_filters(df)
        
        # Generate signals
        df.loc[bardnup_pattern & filters, 'signal'] = 'LONG'
        df.loc[barupdn_pattern & filters, 'signal'] = 'SHORT'
        
        return df
    
    def _calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate technical indicators"""
        # Basic candle analysis
        df['body_size_percent'] = abs(df['close'] - df['open']) / df['open'] * 100
        df['is_bar_up'] = df['close'] > df['open']
        df['is_bar_dn'] = df['close'] < df['open']
        
        # Volume analysis
        df['volume_ma_20'] = df['volume'].rolling(window=20).mean()
        df['volume_ratio'] = df['volume'] / df['volume_ma_20']
        
        # Trend analysis
        df['ema_fast'] = df['close'].ewm(span=9).mean()
        df['ema_slow'] = df['close'].ewm(span=21).mean()
        df['trend_bullish'] = (df['ema_fast'] > df['ema_slow']) & (df['close'] > df['ema_fast'])
        df['trend_bearish'] = (df['ema_fast'] < df['ema_slow']) & (df['close'] < df['ema_fast'])
        
        # RSI
        df['rsi'] = self._calculate_rsi(df['close'])
        
        return df
    
    def _detect_barupdn_pattern(self, df: pd.DataFrame) -> pd.Series:
        """Detect BarUpDn pattern (SHORT signal)"""
        return (
            df['is_bar_dn'] &  # Current candle is red
            df['is_bar_up'].shift(1) &  # Previous candle was green
            (df['open'] >= df['close'].shift(1) * 0.999) &  # Opens near previous close
            (df['close'] < df['open'].shift(1))  # Closes below previous open
        )
    
    def _detect_bardnup_pattern(self, df: pd.DataFrame) -> pd.Series:
        """Detect BarDnUp pattern (LONG signal)"""
        return (
            df['is_bar_up'] &  # Current candle is green
            df['is_bar_dn'].shift(1) &  # Previous candle was red
            (df['open'] <= df['close'].shift(1) * 1.001) &  # Opens near previous close
            (df['close'] > df['open'].shift(1))  # Closes above previous open
        )
    
    def _apply_filters(self, df: pd.DataFrame) -> pd.Series:
        """Apply quality filters"""
        filters = pd.Series(True, index=df.index)
        
        # Volume filter
        if self.parameters['use_volume_filter']:
            vol_mult = self.parameters['volume_threshold_multiplier']
            filters &= df['volume_ratio'] >= vol_mult
        
        # Body size filter
        min_body = self.parameters['min_body_size_percent']
        filters &= df['body_size_percent'] >= min_body
        
        # RSI filter (avoid extremes)
        filters &= (df['rsi'] >= 25) & (df['rsi'] <= 75)
        
        # Volume minimum
        filters &= df['volume'] > 100
        
        return filters
    
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
            'sl_percent': Real(1.5, 4.5, name='sl_percent'),
            'trailing_stop_percent': Real(0.5, 3.0, name='trailing_stop_percent'),
            'position_size_percent': Real(5.0, 20.0, name='position_size_percent'),
            'max_intraday_loss_percent': Real(0.5, 3.0, name='max_intraday_loss_percent'),
            'min_hold_minutes': Integer(15, 120, name='min_hold_minutes'),
            'volume_threshold_multiplier': Real(1.0, 2.5, name='volume_threshold_multiplier'),
            'min_body_size_percent': Real(0.05, 0.5, name='min_body_size_percent')
        }
    
    def get_display_name(self) -> str:
        return f"BarUpDn (SL:{self.parameters['sl_percent']:.1f}%, Trail:{self.parameters['trailing_stop_percent']:.1f}%)" 